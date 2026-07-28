import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, PRINCIPAL } from "./helpers";

/**
 * Setup-first and walking-skeleton E2E: governance setup is clickable end to end
 * on labeled fakes, every required screen exists, and the UI does not
 * invent decisions (the same request under a different firm lands on the RECORDED
 * different outcome). Every surface passes axe (charter #9) and carries at least
 * one visible development-only provenance badge (design §11.2), and a screenshot of
 * every required screen is captured to demo-screens/ (prompt 3 deliverable).
 */

const SHOTS = "demo-screens";

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
  await checkAxe(page, "setup-choices");
  await snap(page, 4, "setup-choices");

  // 5 - Signed cases show different correct effects without ranking the firms.
  await page.getByRole("button", { name: "Review signed impact" }).click();
  await expect(page.getByRole("heading", { name: "See the impact on signed examples" })).toBeVisible();
  await expect(page.getByTestId("signed-impact-recent-bank")).toContainText("GC-03 / GC-04");
  await expect(page.getByTestId("signed-impact-low-headroom")).toContainText("GC-05");
  await checkAxe(page, "setup-impact");
  await snap(page, 5, "setup-impact");

  // 6 - Local activation requires a distinct-human acknowledgment.
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByRole("heading", { name: "A different human acknowledges immutable versions" })).toBeVisible();
  await expect(page.getByText("FA-MM-DEMO-1.0").first()).toBeVisible();
  await expect(page.getByText("FB-MM-DEMO-1.0").first()).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge and activate demonstration" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Confirm the distinct-human" })).toBeVisible();
  await page.getByRole("checkbox").check();
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
  await checkAxe(page, "setup-outcomes");
  await snap(page, 8, "setup-outcomes");

  // 9 - Both complete trails lead to the watermarked export entry.
  await page.getByRole("button", { name: "View complete proof trail" }).click();
  await expect(page.getByRole("heading", { name: "Every outcome has a proof trail" })).toBeVisible();
  await expect(page.getByTestId("proof-firm-a")).toBeVisible();
  await expect(page.getByTestId("proof-firm-b")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export decision record" })).toBeVisible();
  await checkAxe(page, "setup-proof");
  await snap(page, 9, "setup-proof");
});

/** The proof step claims hash-bound identity. Following each export must land on a
 * record carrying the SAME identifiers - and each firm must have its own export, so a
 * two-firm proof cannot be funnelled into one firm's record. */
test("each firm's export lands on the record whose identifiers the proof step showed", async ({ page }) => {
  await login(page, PRINCIPAL);

  for (const firmId of ["firm-a", "firm-b"] as const) {
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

    // Read all six canonical values shown immediately before export.
    const shown = new Map<string, string>();
    for (const field of ["scenario", "firm", "decision-id", "input-hash", "decision-hash", "bundle-hash"]) {
      const value = (await page.getByTestId(`identity-${firmId}-${field}`).textContent())?.trim();
      expect(value, `${firmId} ${field} must be shown before export`).toBeTruthy();
      shown.set(field, value!);
    }
    expect(shown.get("decision-id")).toContain(firmId);

    // Export without choosing a firm names the gap instead of guessing one.
    await page.getByRole("button", { name: "Export decision record" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose which profile" })).toBeVisible();

    const firmLabel = firmId === "firm-a" ? "Firm A" : "Firm B";
    await page.getByTestId("export-choice").getByRole("radio", { name: new RegExp(firmLabel) }).check();
    await page.getByRole("button", { name: "Export decision record" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/demo/record\\?scenario=recent-bank-change-block&firm=${firmId}$`));

    // Byte-for-byte: scenario, firm, decision id, shared request/evidence input
    // hash, decision hash, and firm-specific policy-bearing bundle hash survive.
    for (const [field, value] of shown) {
      await expect(page.getByTestId(`record-identity-${field}`)).toHaveText(value);
    }
  }
});

test("the UI does not invent decisions: dispositions are the recorded contract outcomes", async ({ page }) => {
  await login(page, PRINCIPAL);

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

  // The approval-invalidation moment: the voided approval STAYS, what changed is
  // announced, one clear next action.
  await page.goto("/app/demo/safety?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByTestId("voided-approval")).toBeVisible();
  await expect(page.getByText("Approval voided - evidence changed").first()).toBeVisible();
  await expect(page.getByTestId("what-changed")).toBeVisible();
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
  await expect(page.getByText("dec-smiths-renovation-2026-0726").first()).toBeVisible();
  await expect(page.getByText("a3f9c2e41b7d5f08c6a92e13b48d70f5e21c9a6b3d84f07a5c1e92b64d38a7f0")).toBeVisible();
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
