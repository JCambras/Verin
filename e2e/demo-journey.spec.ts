import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ADVISOR, login, PRINCIPAL } from "./helpers";

/**
 * Setup-first and walking-skeleton E2E: governance setup is clickable end to end
 * on labeled fakes, every required screen exists, and the UI does not
 * invent decisions (the same request under a different firm lands on the RECORDED
 * different outcome). Every surface passes axe (charter #9) and carries at least
 * one visible development-only provenance badge (design §11.2), and a screenshot of
 * every required screen is captured to demo-screens/ (prompt 3 deliverable).
 */

const SHOTS = "demo-screens";
const IDENTITY_FIELDS = [
  "snapshot-version",
  "snapshot-hash",
  "scenario",
  "firm",
  "decision-id",
  "input-hash",
  "policy-version",
  "configuration-hash",
  "configuration-provenance",
  "disposition",
  "explanation",
  "decision-hash",
  "bundle-hash",
] as const;

async function checkAxe(page: Page, name: string) {
  // Settle the surface-entry fade (design §12.2) first: scanning mid-animation
  // reads blended colors and reports false contrast failures.
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${name}:${v.id}`), JSON.stringify(serious, null, 2)).toEqual([]);
}

async function snap(page: Page, index: number, name: string) {
  // Settle the surface-entry fade (design §12.2) before capturing: a mid-fade
  // screenshot is washed out and non-deterministic across runs.
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
  await page.screenshot({ path: `${SHOTS}/${String(index).padStart(2, "0")}-${name}.png`, fullPage: true });
}

/** Every fake-backed surface must show the development-only provenance badge. */
async function expectDevBadge(page: Page) {
  expect(await page.getByTestId("dev-provenance-badge").count()).toBeGreaterThan(0);
}

async function readProofIdentity(
  page: Page,
  firmId: "firm-a" | "firm-b",
): Promise<Map<string, string>> {
  const identity = new Map<string, string>();
  for (const field of IDENTITY_FIELDS) {
    const value = (
      await page.getByTestId(`identity-${firmId}-${field}`).textContent()
    )?.trim();
    expect(value, `${firmId} ${field} must be shown before export`).toBeTruthy();
    identity.set(field, value!);
  }
  return identity;
}

async function expectRecordIdentity(
  page: Page,
  identity: ReadonlyMap<string, string>,
) {
  for (const [field, value] of identity) {
    await expect(page.getByTestId(`record-identity-${field}`)).toHaveText(value);
  }
}

test("the setup-first journey is clickable end-to-end on labeled fakes", async ({ page }) => {
  await login(page, PRINCIPAL);

  await page.getByRole("link", { name: "Demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Money-movement demo" })).toBeVisible();
  await checkAxe(page, "launcher");
  await snap(page, 0, "launcher");

  // 1 - Profiles precede the Smiths request.
  await page.getByRole("link", { name: "Start with governance setup" }).click();
  await expect(page.getByRole("heading", { name: "Start with the policy, not the request" })).toBeVisible();
  await expect(page.getByTestId("setup-journey")).toContainText("Firm A");
  await expect(page.getByTestId("setup-journey")).toContainText("Firm B");
  await expectDevBadge(page);
  await checkAxe(page, "setup-profiles");
  await snap(page, 1, "setup-profiles");

  // 2 - Universal safety is visible and has no off switch.
  await page.getByRole("button", { name: "Continue with both firms" }).click();
  await expect(page.getByRole("heading", { name: "Confirm the controls no firm can weaken" })).toBeVisible();
  await expect(page.getByTestId("setup-journey")).toContainText("Required");
  await expect(page.getByTestId("setup-journey").getByRole("checkbox")).toHaveCount(0);
  await checkAxe(page, "setup-controls");
  await snap(page, 2, "setup-controls");

  // 3 - The conservative posture exposes exact values.
  await page.getByRole("button", { name: "Confirm required controls" }).click();
  await expect(page.getByRole("heading", { name: "Begin conservatively, then make differences explicit" })).toBeVisible();
  await expect(page.getByText("12 months", { exact: true })).toBeVisible();
  await expect(page.getByText("2 distinct operations approvers above $25,000")).toBeVisible();
  await checkAxe(page, "setup-posture");
  await snap(page, 3, "setup-posture");

  // 4 - Five closed-choice groups, signed reserve floors, unresolved requester rule.
  await page.getByRole("button", { name: "Use this starting posture" }).click();
  await expect(page.getByRole("heading", { name: "Tune only the decisions that can legitimately differ" })).toBeVisible();
  await expect(page.getByTestId("policy-group-reserve")).toBeVisible();
  await expect(page.getByTestId("policy-group-freshness")).toBeVisible();
  await expect(page.getByTestId("policy-group-bank-change")).toBeVisible();
  await expect(page.getByTestId("policy-group-threshold")).toBeVisible();
  await expect(page.getByTestId("policy-group-expiry")).toBeVisible();
  await expect(page.getByText("$48,000.00").first()).toBeVisible();
  await expect(page.getByText("$96,000.00").first()).toBeVisible();
  await expect(page.getByTestId("requester-awaiting-decision")).toBeVisible();
  // Arrow-keying a radio group must announce the CHOICE, not the whole expanded card.
  // The detail block is attached with aria-describedby, so it is a description - the
  // accessible NAME stays the option label plus its authority badge.
  const selectedReserve = page
    .getByTestId("choice-reserve-firm-a")
    .getByRole("radio", { name: /6 months/ });
  await expect(selectedReserve).toBeChecked();
  await expect(selectedReserve).toHaveAccessibleName("6 months Captain-signed");
  await expect(selectedReserve).toHaveAccessibleDescription(/Reserve dollars are derived/);
  // Firm B's freshness default is only recommended: it must not read as signed.
  await expect(
    page.getByTestId("choice-freshness-firm-b").getByRole("radio", { name: /30 calendar days/ }),
  ).toHaveAccessibleName("30 calendar days Recommended · not signed");
  await checkAxe(page, "setup-choices");
  await snap(page, 4, "setup-choices");

  // 5 - Signed cases show different correct effects without ranking the firms.
  await page.getByRole("button", { name: "Review signed impact" }).click();
  await expect(page.getByRole("heading", { name: "See the impact on signed examples" })).toBeVisible();
  await expect(page.getByTestId("signed-impact-recent-bank")).toContainText("GC-03 / GC-04");
  await expect(page.getByTestId("signed-impact-recent-bank")).toContainText(
    "changed 2026-07-22 · 6 days ago",
  );
  await expect(page.getByTestId("signed-impact-stale-withdrawals")).toContainText(
    "Planned-withdrawal evidence observed 2026-06-09 · 49 days old",
  );
  await expect(page.getByTestId("signed-impact-stale-withdrawals")).toContainText(
    "Available cash remains fresh as of 2026-07-26",
  );
  await expect(page.getByTestId("signed-impact-low-headroom")).toContainText("GC-05");
  await checkAxe(page, "setup-impact");
  await snap(page, 5, "setup-impact");

  // 6 - Local activation requires an authenticated Principal acknowledgment.
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByRole("heading", { name: "A Principal acknowledges the simulated lifecycle" })).toBeVisible();
  await expect(page.getByText("FA-MM-DEMO-1.0").first()).toBeVisible();
  await expect(page.getByText("FB-MM-DEMO-1.0").first()).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge and activate demonstration" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Confirm the demonstration" })).toBeVisible();
  await page.getByRole("checkbox").check();
  await expect(page.getByTestId("setup-attestation")).toContainText("principal");
  await checkAxe(page, "setup-activation");
  await snap(page, 6, "setup-activation");

  // 7 - The same Smiths request names each policy version and derived reserve.
  await page.getByRole("button", { name: "Acknowledge and activate demonstration" }).click();
  await expect(page.getByRole("heading", { name: "Run the Smiths request under both profiles" })).toBeVisible();
  await expect(page.getByText("$75,000.00").first()).toBeVisible();
  await expect(page.getByText("$8,000.00").first()).toBeVisible();
  await expect(page.getByText("$48,000.00").first()).toBeVisible();
  await expect(page.getByText("$96,000.00").first()).toBeVisible();
  await checkAxe(page, "setup-request");
  await snap(page, 7, "setup-request");

  // 8 - Phone-safe comparison keeps question, Firm A, then Firm B in DOM order.
  await page.getByRole("button", { name: "Run under both profiles" }).click();
  await expect(page.getByRole("heading", { name: "Identical facts, different correct outcomes" })).toBeVisible();
  await expect(page.getByTestId("outcome-firm-a")).toContainText("Submitted · not verified");
  await expect(page.getByTestId("outcome-firm-b")).toContainText("Blocked decision recorded");
  await expect(page.getByTestId("outcome-firm-b")).toContainText("No authority");
  // The untouched profiles carry DIFFERENT authority: every Firm A default is signed,
  // while two of Firm B's five are only house recommendations.
  await expect(
    page.getByTestId("outcome-firm-a-configuration-provenance"),
  ).toHaveText("Captain-signed configuration");
  await expect(
    page.getByTestId("outcome-firm-b-configuration-provenance"),
  ).toHaveText("Recommended configuration · pending captain signoff");
  await checkAxe(page, "setup-outcomes");
  await snap(page, 8, "setup-outcomes");

  // 9 - Both complete trails lead to the watermarked export entry.
  await page.getByRole("button", { name: "View complete proof trail" }).click();
  await expect(page.getByRole("heading", { name: "Every outcome has a proof trail" })).toBeVisible();
  await expect(page.getByTestId("proof-firm-a")).toBeVisible();
  await expect(page.getByTestId("proof-firm-b")).toBeVisible();
  await expect(page.getByTestId("proof-firm-a-eligible-role")).toHaveText(
    "Operations",
  );
  await expect(page.getByTestId("proof-firm-b-eligible-role")).toHaveText(
    "None - automatic or not reached",
  );
  await expect(
    page.getByTestId("proof-firm-a-requester-participation"),
  ).toHaveText("Unbound in this demonstration");
  await expect(
    page.getByTestId("proof-firm-b-requester-participation"),
  ).toHaveText("Unbound in this demonstration");
  await expect(page.getByRole("button", { name: "Export decision record" })).toBeVisible();
  await checkAxe(page, "setup-proof");
  await snap(page, 9, "setup-proof");
});

test("bank-change impact follows the complete Firm B authority selection", async ({
  page,
}) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/demo/setup");
  for (const label of [
    "Continue with both firms",
    "Confirm required controls",
    "Use this starting posture",
  ]) {
    await page.getByRole("button", { name: label }).click();
  }

  await page
    .getByTestId("choice-threshold-firm-a")
    .getByRole("radio", { name: /Above \$100,000/ })
    .check();
  await page.getByRole("button", { name: "Review signed impact" }).click();
  const recentBank = page.getByTestId("signed-impact-recent-bank");
  await expect(recentBank).toContainText("Projection from signed case");
  await expect(
    recentBank.getByTestId("impact-firm-a"),
  ).toContainText("Projected outcome");
  await expect(
    recentBank.getByTestId("impact-firm-a-varied"),
  ).toBeVisible();
  await expect(
    recentBank.getByTestId("impact-firm-a"),
  ).not.toContainText("Captain-signed outcome");

  await page.getByRole("button", { name: "Back" }).click();
  await page
    .getByTestId("choice-threshold-firm-a")
    .getByRole("radio", { name: /Above \$25,000/ })
    .check();
  await page
    .getByTestId("choice-bank-change-firm-b")
    .getByRole("radio", { name: /Specialist review/ })
    .check();
  await page
    .getByTestId("choice-threshold-firm-b")
    .getByRole("radio", { name: /Above \$100,000/ })
    .check();
  await page.getByRole("button", { name: "Review signed impact" }).click();

  const impact = page
    .getByTestId("signed-impact-recent-bank")
    .getByTestId("impact-firm-b");
  await expect(impact).toContainText(
    "Specialist review; no dual approval at this amount",
  );
  await expect(impact).toContainText(
    "configured $100,000 threshold",
  );

  await page.getByRole("button", { name: "Back" }).click();
  await page
    .getByTestId("choice-threshold-firm-b")
    .getByRole("radio", { name: /Above \$25,000/ })
    .check();
  await page.getByRole("button", { name: "Review signed impact" }).click();
  await expect(impact).toContainText(
    "Specialist review, then two distinct operations approvers",
  );
  await expect(impact).toContainText(
    "configured $25,000 threshold",
  );
  await checkAxe(page, "setup-threshold-sensitive-impact");
});

/** The proof step claims hash-bound identity. Following each export must land on a
 * record carrying the SAME identifiers - and each firm must have its own export, so a
 * two-firm proof cannot be funnelled into one firm's record. */
test("each firm's export lands on the record whose identifiers the proof step showed", async ({ page }) => {
  await login(page, PRINCIPAL);

  for (const [index, firmId] of (["firm-a", "firm-b"] as const).entries()) {
    await page.goto("/app/demo/setup");
    for (const label of [
      "Continue with both firms",
      "Confirm required controls",
      "Use this starting posture",
      "Review signed impact",
      "Send for approval",
    ]) {
      await page.getByRole("button", { name: label }).click();
    }
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Acknowledge and activate demonstration" }).click();
    await page.getByRole("button", { name: "Run under both profiles" }).click();
    await page.getByRole("button", { name: "View complete proof trail" }).click();

    // Read the complete activated configuration and canonical decision identity.
    const shown = await readProofIdentity(page, firmId);
    expect(shown.get("decision-id")).toContain(firmId);

    // Export without choosing a firm names the gap instead of guessing one.
    await page.getByRole("button", { name: "Export decision record" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose which profile" })).toBeVisible();

    const firmLabel = firmId === "firm-a" ? "Firm A" : "Firm B";
    await page.getByTestId("export-choice").getByRole("radio", { name: new RegExp(firmLabel) }).check();
    await page.getByRole("button", { name: "Export decision record" }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/app/demo/record\\?scenario=recent-bank-change-block&firm=${firmId}&activation=[a-f0-9]{64}$`,
      ),
    );

    // Byte-for-byte: the frozen version, configuration, outcome, and all identity
    // hashes survive the export boundary.
    await expectRecordIdentity(page, shown);
    await expect(
      page
        .locator('section[aria-label="Intent"]')
        .getByTestId("dev-provenance-badge")
        .first(),
    ).toHaveText("demo input");
    // The export never makes a stronger provenance claim than the screen that produced
    // it: an untouched Firm B is recommended-pending-signoff, not captain-signed.
    await expect(page.getByTestId("record-identity-configuration-provenance")).toHaveText(
      firmId === "firm-a"
        ? "Captain-signed configuration"
        : "Recommended configuration · pending captain signoff",
    );
    await expect(
      page.getByTestId("record-identity-eligible-role"),
    ).toHaveText(
      firmId === "firm-a"
        ? "Operations"
        : "None - automatic or not reached",
    );
    await expect(
      page.getByTestId("record-identity-requester-participation"),
    ).toHaveText("Unbound in this demonstration");
    // The numbers an examiner checks the horizon prose against, on the artifact itself.
    await expect(page.getByTestId("record-reserve-horizon")).toHaveText(
      firmId === "firm-a" ? "6 months of planned withdrawals" : "12 months of planned withdrawals",
    );
    await expect(page.getByTestId("record-reserve-floor")).toContainText(
      firmId === "firm-a" ? "$48,000.00" : "$96,000.00",
    );
    await expect(page.getByTestId("record-reserve-headroom")).toContainText(
      firmId === "firm-a" ? "$297,000.00" : "$249,000.00",
    );
    if (firmId === "firm-a") {
      const authority = page.locator(
        'section[aria-label="Authority and approvals"]',
      );
      await expect(
        authority.locator(":scope > div > p:first-child"),
      ).toHaveText([
        "Stage 1 - Bank-instruction specialist review",
        "Stage 2 - Dual operations approval",
      ]);
      await expect(authority).toContainText("Reviewed · Jul 28, 10:15");
      await expect(authority).toContainText("Approved · Jul 28, 10:32");
      await expect(authority).toContainText("Approved · Jul 28, 10:41");
    }
    await checkAxe(page, `record-${firmId}`);
    await snap(page, 10 + index, `record-${firmId}`);
  }
});

test("a changed selection freezes, exports, and requires reactivation after another edit", async ({
  page,
  context,
}) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/demo/setup");
  for (const label of [
    "Continue with both firms",
    "Confirm required controls",
    "Use this starting posture",
    "Review signed impact",
    "Send for approval",
  ]) {
    await page.getByRole("button", { name: label }).click();
  }
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Acknowledge and activate demonstration" })
    .click();
  await page.getByRole("button", { name: "Run under both profiles" }).click();
  await page
    .getByRole("button", { name: "View complete proof trail" })
    .click();
  const priorIdentity = await readProofIdentity(page, "firm-a");
  const priorHash = priorIdentity.get("snapshot-hash")!;

  for (const heading of [
    "Identical facts, different correct outcomes",
    "Run the Smiths request under both profiles",
    "A Principal acknowledges the simulated lifecycle",
    "See the impact on signed examples",
    "Tune only the decisions that can legitimately differ",
  ]) {
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  await page
    .getByTestId("choice-reserve-firm-a")
    .getByRole("radio", { name: /9 months/ })
    .check();
  await page.getByRole("button", { name: "Review signed impact" }).click();
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page
    .getByRole("button", { name: "Acknowledge and activate demonstration" })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Confirm the demonstration" }),
  ).toBeVisible();

  const priorRecord = await context.newPage();
  await priorRecord.goto(
    `/app/demo/record?scenario=recent-bank-change-block&firm=firm-a&activation=${priorHash}`,
  );
  await expectRecordIdentity(priorRecord, priorIdentity);
  await priorRecord.close();

  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Acknowledge and activate demonstration" })
    .click();
  const changedVersion = (
    await page.getByTestId("request-snapshot-version").textContent()
  )?.trim();
  const changedHash = (
    await page.getByTestId("request-snapshot-hash").textContent()
  )?.trim();
  const changedPolicy = (
    await page.getByTestId("request-firm-a-policy-version").textContent()
  )?.trim();
  expect(changedVersion).not.toBe(priorIdentity.get("snapshot-version"));
  expect(changedHash).not.toBe(priorHash);
  expect(changedPolicy).not.toBe("FA-4.2");

  await page.getByRole("button", { name: "Run under both profiles" }).click();
  const changedDisposition = (
    await page.getByTestId("outcome-firm-a-disposition").textContent()
  )?.trim();
  const changedExplanation = (
    await page.getByTestId("outcome-firm-a-explanation").textContent()
  )?.trim();
  await page
    .getByRole("button", { name: "View complete proof trail" })
    .click();
  const changedIdentity = await readProofIdentity(page, "firm-a");
  expect(changedIdentity.get("snapshot-version")).toBe(changedVersion);
  expect(changedIdentity.get("snapshot-hash")).toBe(changedHash);
  expect(changedIdentity.get("policy-version")).toBe(changedPolicy);
  expect(changedIdentity.get("disposition")).toBe("proceed");
  expect(changedIdentity.get("explanation")).toBe(changedExplanation);
  expect(changedIdentity.get("decision-id")).not.toBe(
    priorIdentity.get("decision-id"),
  );
  expect(changedIdentity.get("bundle-hash")).not.toBe(
    priorIdentity.get("bundle-hash"),
  );
  expect(changedIdentity.get("decision-hash")).not.toBe(
    priorIdentity.get("decision-hash"),
  );
  expect(changedDisposition).toBe("proceed");

  await page
    .getByTestId("export-choice")
    .getByRole("radio", { name: /Firm A/ })
    .check();
  await page.getByRole("button", { name: "Export decision record" }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/app/demo/record\\?scenario=recent-bank-change-block&firm=firm-a&activation=${changedHash}$`,
    ),
  );
  await expectRecordIdentity(page, changedIdentity);

  // The exported record must state the ACTIVATED nine-month horizon. The old prose
  // branched on six-vs-twelve, so a nine-month activation printed "twelve" beside its
  // own $72,000 floor - a self-contradicting examiner-grade artifact.
  const reserveRow = page
    .getByRole("listitem")
    .filter({ hasText: "Cash-reserve floor" });
  await expect(reserveRow).toContainText("9 months of planned withdrawals");
  await expect(reserveRow).not.toContainText("twelve");
  await expect(reserveRow).not.toContainText("six");
  // The prose is checkable on the artifact: the record prints the derived floor and
  // the post-reserve headroom the activated nine-month horizon produces.
  await expect(page.getByTestId("record-reserve-horizon")).toHaveText(
    "9 months of planned withdrawals",
  );
  await expect(page.getByTestId("record-reserve-floor")).toContainText("$72,000.00");
  await expect(page.getByTestId("record-reserve-headroom")).toContainText("$273,000.00");
  // A supported horizon is a house default, never a captain-signed configuration.
  await expect(page.getByTestId("record-identity-configuration-provenance")).toHaveText(
    "House-default demonstration configuration",
  );
});

test("the UI does not invent decisions: dispositions are the recorded contract outcomes", async ({ page }) => {
  await login(page, PRINCIPAL);

  await page.goto("/app/demo/workspace?scenario=stale-evidence&firm=firm-a");
  await expect(
    page.getByText("Available cash", { exact: true }).locator(".."),
  ).toContainText("as of 2026-07-26");
  // The taxable account balance IS the available-cash datum, so the accounts row and
  // the liquidity block state ONE observation date - the same $420,000 can never
  // appear twice on one screen under two different "as of" days.
  await expect(
    page.getByText("Smith Family Taxable", { exact: true }).locator("xpath=ancestor::li[1]"),
  ).toContainText("as of 2026-07-26");
  await expect(
    page.getByText("Joint Taxable", { exact: true }).locator("xpath=ancestor::li[1]"),
  ).toContainText("as of 2026-07-24");
  await expect(
    page
      .getByText("Planned monthly withdrawal", { exact: true })
      .locator(".."),
  ).toContainText("as of 2026-06-09");
  await page.goto("/app/demo/evidence?scenario=stale-evidence&firm=firm-a");
  await expect(
    page
      .getByText("Available cash in the taxable brokerage account", {
        exact: true,
      })
      .locator(".."),
  ).toContainText("as of 2026-07-26");
  await expect(
    page
      .getByText("Planned monthly withdrawal", { exact: true })
      .locator(".."),
  ).toContainText("as of 2026-06-09");
  await page.goto("/app/demo/decision?scenario=stale-evidence&firm=firm-a");
  await expect(page.getByTestId("blocker-row")).toContainText(
    "Planned-withdrawal evidence is 49 days old",
  );
  await page.goto("/app/demo/record?scenario=stale-evidence&firm=firm-a");
  await expect(page.getByTestId("record-reserve-state")).toContainText(
    "Reserve calculation not evaluated",
  );
  await expect(page.getByTestId("record-reserve-state").locator("..")).toContainText(
    "no reserve floor or headroom was calculated",
  );
  await expect(page.getByTestId("record-reserve-floor")).toHaveCount(0);
  await expect(page.getByTestId("record-reserve-headroom")).toHaveCount(0);

  await page.goto(
    "/app/demo/evidence?scenario=recent-bank-change-block&firm=firm-a",
  );
  await expect(
    page
      .getByText("Bank instruction on file", { exact: true })
      .locator(".."),
  ).toContainText("as of 2026-07-22");

  // Same request, same evidence, Firm B: BLOCKED with resolving affordances (amber).
  await page.goto("/app/demo/decision?scenario=recent-bank-change-block&firm=firm-b");
  await expect(page.getByTestId("disposition-blocked")).toBeVisible();
  await expect(page.getByTestId("blocker-row")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request independent verification of the bank instruction" })).toBeVisible();
  await checkAxe(page, "decision-blocked");
  await snap(page, 13, "decision-blocked-firm-b");
  // Downstream stations honestly do not exist for a blocked journey.
  await page.goto("/app/demo/authority?scenario=recent-bank-change-block&firm=firm-b");
  await expect(page.getByText("Authority not reached")).toBeVisible();
  await page.goto("/app/demo/execution?scenario=recent-bank-change-block&firm=firm-b");
  await expect(page.getByText("Execution not reached")).toBeVisible();

  // Prohibited: solid stamp, versioned source, ZERO resolving affordances.
  await page.goto("/app/demo/decision?scenario=permanent-prohibition&firm=firm-a");
  const card = page.getByTestId("disposition-prohibited");
  await expect(card).toBeVisible();
  await expect(card.getByText("Prohibited", { exact: true })).toBeVisible();
  await expect(card.getByText("HH-INSTR-SMITH-004 v3")).toBeVisible();
  await expect(card.getByText("Verin will not route this for approval")).toBeVisible();
  expect(await page.getByTestId("blocker-row").count()).toBe(0);
  // The only interactive elements are inspective: the WhyBubble and the two links.
  expect(await card.getByRole("button").count()).toBe(1);
  await expect(card.getByRole("button", { name: "Why did Verin do this?" })).toBeVisible();
  await expect(card.getByRole("link", { name: "View the policy trace" })).toBeVisible();
  await checkAxe(page, "decision-prohibited");
  await snap(page, 14, "decision-prohibited");
  await page.goto(
    "/app/demo/record?scenario=permanent-prohibition&firm=firm-a",
  );
  await expect(page.getByTestId("record-reserve-state")).toContainText(
    "Reserve calculation not applicable",
  );
  await expect(page.getByTestId("record-reserve-floor")).toHaveCount(0);
  await expect(page.getByTestId("record-reserve-headroom")).toHaveCount(0);

  // The approval-invalidation moment: the voided approval STAYS, what changed is
  // announced, one clear next action.
  await page.goto("/app/demo/safety?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByTestId("voided-approval")).toBeVisible();
  await expect(page.getByText("Approval voided - evidence changed").first()).toBeVisible();
  await expect(page.getByTestId("what-changed")).toContainText(
    "A $15,000 pending distribution posted after this approval was given.",
  );
  await expect(page.getByTestId("what-changed")).not.toContainText(
    "bank instruction changed",
  );
  await expect(page.getByRole("link", { name: "Re-evaluate with current evidence" })).toBeVisible();
  await checkAxe(page, "safety-invalidation");
  await snap(page, 15, "safety-invalidation");

  // Duplicate retry: the product claim in plain words, keys matching byte-for-byte.
  await page.goto("/app/demo/execution?scenario=duplicate-retry&firm=firm-a");
  await expect(page.getByText("Already submitted once - Verin did not send it again.")).toBeVisible();
  await expect(page.getByText("Duplicate suppressed")).toBeVisible();
  await snap(page, 16, "execution-duplicate-suppressed");

  // Delayed NIGO: first-class appended row with its resolving affordance.
  await page.goto("/app/demo/verification?scenario=delayed-nigo&firm=firm-a");
  await expect(page.getByText("Returned NIGO", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fix and resubmit the authorization" })).toBeVisible();
  await snap(page, 17, "verification-delayed-nigo");

  // Specialist-review expiration under Firm B: no specialist stage exists there -
  // the recorded per-firm split blocks until independently verified (contract §2).
  await page.goto("/app/demo/decision?scenario=specialist-review-expiration&firm=firm-b");
  await expect(page.getByTestId("disposition-blocked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request independent verification of the bank instruction" })).toBeVisible();
  await page.goto("/app/demo/authority?scenario=specialist-review-expiration&firm=firm-b");
  await expect(page.getByText("Authority not reached")).toBeVisible();
});

test("print posture: the record's identity header prints complete; app chrome and buttons do not", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/demo/record?scenario=recent-bank-change-block&firm=firm-a");
  await page.emulateMedia({ media: "print" });
  // Design §9: wordmark, watermark chip, decision id, and the FULL hashes stay on paper.
  await expect(page.getByTestId("record-watermark")).toBeVisible();
  await expect(page.getByTestId("record-identity-decision-id")).toHaveText(
    /^dec-firm-a-[a-f0-9]{24}$/,
  );
  await expect(page.getByTestId("record-identity-decision-hash")).toHaveText(
    /^[a-f0-9]{64}$/,
  );
  // App chrome and interactive controls disappear.
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Print this record" })).toBeHidden();
});

test("unknown branch ids 404 instead of silently rendering a different branch", async ({ page }) => {
  await login(page, PRINCIPAL);
  const badScenario = await page.goto("/app/demo/decision?scenario=not-a-branch&firm=firm-a");
  expect(badScenario?.status()).toBe(404);
  const badFirm = await page.goto("/app/demo/decision?scenario=safe-proceed&firm=firm-c");
  expect(badFirm?.status()).toBe(404);
  // Absent params still land on the default branch.
  const defaulted = await page.goto("/app/demo/decision");
  expect(defaulted?.status()).toBe(200);
  await expect(page.getByTestId("disposition-proceed")).toBeVisible();

  const missingSnapshot = "f".repeat(64);
  const failedClosed = await page.goto(
    `/app/demo/record?scenario=recent-bank-change-block&firm=firm-a&activation=${missingSnapshot}`,
  );
  expect(failedClosed?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Decision record unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "activated setup snapshot" }),
  ).toBeVisible();
  await expect(page.getByTestId("record-identity-decision-id")).toHaveCount(0);
});

test("setup activation rejects a signed-in advisor", async ({ page }) => {
  await login(page, ADVISOR);
  await page.goto("/app/demo/setup");
  for (const label of [
    "Continue with both firms",
    "Confirm required controls",
    "Use this starting posture",
    "Review signed impact",
    "Send for approval",
  ]) {
    await page.getByRole("button", { name: label }).click();
  }
  await page.getByRole("checkbox").check();
  await expect(
    page.getByRole("alert").filter({ hasText: "Principal role" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "A Principal acknowledges the simulated lifecycle",
    }),
  ).toBeVisible();
});

test("an explicit empty activation parameter cannot render a static record", async ({
  page,
}) => {
  await login(page, PRINCIPAL);
  await page.goto(
    "/app/demo/record?scenario=recent-bank-change-block&firm=firm-a&activation=",
  );
  await expect(
    page.getByRole("heading", { name: "Decision record unavailable" }),
  ).toBeVisible();
  await expect(page.getByTestId("record-identity-decision-id")).toHaveCount(0);
});

test("activated records require explicit scenario and firm parameters", async ({
  page,
}) => {
  await login(page, PRINCIPAL);
  const activation = "a".repeat(64);
  for (const query of [
    `activation=${activation}`,
    `scenario=recent-bank-change-block&activation=${activation}`,
    `firm=firm-a&activation=${activation}`,
  ]) {
    await page.goto(`/app/demo/record?${query}`);
    await expect(
      page.getByRole("heading", { name: "Decision record unavailable" }),
    ).toBeVisible();
    await expect(page.getByTestId("record-identity-decision-id")).toHaveCount(0);
  }
});

test("an activated record is unavailable to another authenticated session", async ({
  page,
  browser,
}) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/demo/setup");
  for (const label of [
    "Continue with both firms",
    "Confirm required controls",
    "Use this starting posture",
    "Review signed impact",
    "Send for approval",
  ]) {
    await page.getByRole("button", { name: label }).click();
  }
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Acknowledge and activate demonstration" })
    .click();
  const activation = (
    await page.getByTestId("request-snapshot-hash").textContent()
  )?.trim();
  expect(activation).toMatch(/^[a-f0-9]{64}$/);

  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await login(otherPage, PRINCIPAL);
    await otherPage.goto(
      `/app/demo/record?scenario=recent-bank-change-block&firm=firm-a&activation=${activation}`,
    );
    await expect(
      otherPage.getByRole("heading", {
        name: "Decision record unavailable",
      }),
    ).toBeVisible();
    await expect(
      otherPage.getByRole("alert").filter({
        hasText: "not available to this authenticated session",
      }),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test("session rotation preserves setup state only within the same login lineage", async ({
  page,
}) => {
  test.setTimeout(130_000);
  await login(page, PRINCIPAL);
  await page.goto("/app/demo/setup");
  for (const label of [
    "Continue with both firms",
    "Confirm required controls",
    "Use this starting posture",
    "Review signed impact",
    "Send for approval",
  ]) {
    await page.getByRole("button", { name: label }).click();
  }
  await page.getByRole("checkbox").check();
  await page.getByTestId("setup-attestation").waitFor();
  const cookieBeforeAttestationRotation = (
    await page.context().cookies()
  ).find((cookie) => cookie.name === "verin_session")!.value;

  await page.waitForTimeout(31_000);
  await page
    .getByRole("button", {
      name: "Acknowledge and activate demonstration",
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Run the Smiths request under both profiles",
    }),
  ).toBeVisible();
  const activation = (
    await page.getByTestId("request-snapshot-hash").textContent()
  )?.trim();
  expect(activation).toMatch(/^[a-f0-9]{64}$/);
  const cookieAfterAttestationRotation = (
    await page.context().cookies()
  ).find((cookie) => cookie.name === "verin_session")!.value;
  expect(cookieAfterAttestationRotation).not.toBe(
    cookieBeforeAttestationRotation,
  );

  await page.waitForTimeout(31_000);
  const renewed = await page.goto("/api/me");
  expect(renewed?.status()).toBe(200);
  const cookieAfterSnapshotRotation = (
    await page.context().cookies()
  ).find((cookie) => cookie.name === "verin_session")!.value;
  expect(cookieAfterSnapshotRotation).not.toBe(
    cookieAfterAttestationRotation,
  );

  await page.goto(
    `/app/demo/record?scenario=recent-bank-change-block&firm=firm-a&activation=${activation}`,
  );
  await expect(
    page.getByRole("heading", { name: "Decision record" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login$/);
  await login(page, PRINCIPAL);
  await page.goto(
    `/app/demo/record?scenario=recent-bank-change-block&firm=firm-a&activation=${activation}`,
  );
  await expect(
    page.getByRole("heading", {
      name: "Decision record unavailable",
    }),
  ).toBeVisible();
});

test("legacy comparison and query activation aliases redirect to setup without activating", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/demo/policy-authoring?scenario=recent-bank-change-block&firm=firm-a&approved=1");
  await expect(page).toHaveURL(/\/app\/demo\/setup$/);
  await expect(page.getByRole("heading", { name: "Start with the policy, not the request" })).toBeVisible();
  await expect(page.getByText("Demonstration versions activated locally")).toHaveCount(0);

  await page.goto("/app/demo/comparison?scenario=recent-bank-change-block&firm=firm-a");
  await expect(page).toHaveURL(/\/app\/demo\/setup$/);

  // A bookmarked alias reaches setup even when its query names a branch that no
  // longer exists: the alias never resolves a scenario or builds a journey.
  await page.goto("/app/demo/comparison?scenario=not-a-branch&firm=firm-c");
  await expect(page).toHaveURL(/\/app\/demo\/setup$/);
  await expect(page.getByRole("heading", { name: "Start with the policy, not the request" })).toBeVisible();
});

test("every fake-backed demo surface carries a visible dev provenance badge", async ({ page }) => {
  await login(page, PRINCIPAL);
  const surfaces = [
    "setup",
    "workspace",
    "intent",
    "evidence",
    "decision",
    "policy-trace",
    "authority",
    "safety",
    "execution",
    "verification",
    "record",
  ];
  for (const s of surfaces) {
    await page.goto(`/app/demo/${s}?scenario=recent-bank-change-block&firm=firm-a`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.getByTestId("dev-provenance-badge").count(), `surface ${s} must carry a dev provenance badge`).toBeGreaterThan(0);
  }
});
