import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, PRINCIPAL } from "./helpers";

/**
 * Walking-skeleton E2E (v3 prompt 3, Gate 0): the seven-minute journey is clickable
 * end to end on labeled fakes, every required screen exists, and the UI does not
 * invent decisions (the same request under a different firm lands on the RECORDED
 * different outcome). Every surface passes axe (charter #9) and carries at least
 * one visible development-only provenance badge (design §11.2), and a screenshot of
 * every required screen is captured to demo-screens/ (prompt 3 deliverable).
 */

const SHOTS = "demo-screens";

async function checkAxe(page: Page, name: string) {
  // Settle the surface-entry fade (design §12.2) first: scanning mid-animation
  // reads blended colors and reports false contrast failures.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${name}:${v.id}`), JSON.stringify(serious, null, 2)).toEqual([]);
}

async function snap(page: Page, index: number, name: string) {
  // Settle the surface-entry fade (design §12.2) before capturing: a mid-fade
  // screenshot is washed out and non-deterministic across runs.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  await page.screenshot({ path: `${SHOTS}/${String(index).padStart(2, "0")}-${name}.png`, fullPage: true });
}

/** Every fake-backed surface must show the development-only provenance badge. */
async function expectDevBadge(page: Page) {
  expect(await page.getByTestId("dev-provenance-badge").count()).toBeGreaterThan(0);
}

async function expectFullDecisionBinding(page: Page) {
  const binding = page.getByTestId("decision-binding").first();
  await expect(binding).toBeVisible();
  const values = await binding.locator("dd").allTextContents();
  expect(values).toHaveLength(2);
  for (const value of values) {
    expect(value).toMatch(/^[0-9a-f]{64}$/);
  }
}

test("the seven-minute journey is clickable end-to-end on labeled fakes", async ({ page }) => {
  await login(page, PRINCIPAL);

  // Launcher.
  await page.getByRole("link", { name: "Demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Money-movement demo" })).toBeVisible();
  await checkAxe(page, "launcher");
  await snap(page, 0, "launcher");

  // 1 - Household workspace (canonical journey: recent bank change under Firm A).
  await page.getByRole("link", { name: "Run the seven-minute journey" }).click();
  await expect(page).toHaveURL(
    "/app/demo/workspace?scenario=recent-bank-change-block&firm=firm-a&case=GC-03-recent-bank-change-firm-a",
  );
  await expect(page.getByRole("heading", { name: "The Smith Household" })).toBeVisible();
  await expect(page.getByText("$8,000.00", { exact: true })).toBeVisible();
  await expectDevBadge(page);
  await checkAxe(page, "workspace");
  await snap(page, 1, "workspace");

  // 2 - Contextual intent panel: request + typed slots, LLM draft set apart.
  await page.getByRole("link", { name: "Ask Verin about this household" }).click();
  await expect(page.getByText("Drafted - not yet reviewed")).toBeVisible();
  await expect(page.getByText("$75,000.00").first()).toBeVisible();
  await expectDevBadge(page);
  await checkAxe(page, "intent");
  await snap(page, 2, "intent");

  // 3 - Evidence: exact case sources with observed and retrieved instants.
  await page.getByRole("link", { name: "Gather evidence" }).click();
  await expect(page.getByTestId("evidence-missing")).toHaveCount(0);
  await expect(page.getByText("retrieved Jul 26, 09:30:05").first()).toBeVisible();
  await expect(
    page.getByText(
      /bank instruction · bank-instruction:smiths-primary · house-crm · fresh/,
    ),
  ).toBeVisible();
  await expectDevBadge(page);
  await checkAxe(page, "evidence");
  await snap(page, 3, "evidence");

  // 4 - Recommendation: proceed, with the specialist-review authority summary.
  await page.getByRole("link", { name: "View the recommendation" }).click();
  await expect(page.getByTestId("disposition-proceed")).toBeVisible();
  await expect(page.getByText(/specialist review \(stage 1\)/)).toBeVisible();
  await checkAxe(page, "decision");
  await snap(page, 4, "decision");

  // 5 - Policy trace: versions in mono, precedence rows.
  await page.getByRole("link", { name: "View the policy trace" }).click();
  await expect(page.getByText("firm-a-policy@2026.07.1").first()).toBeVisible();
  await expect(page.getByText("smiths-destination-restriction@v2").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Household destination restriction" })).toBeVisible();
  await checkAxe(page, "policy-trace");
  await snap(page, 5, "policy-trace");

  // 6 - Authority: every ordered stage and quorum is visibly satisfied before Safety.
  await page.getByRole("link", { name: "Continue to authority" }).click();
  await expect(page.getByText("Dual operations approval").first()).toBeVisible();
  await expect(page.getByText("Bank-instruction specialist review").first()).toBeVisible();
  await expect(page.getByText("the requester cannot approve")).toBeVisible();
  await expect(page.getByText(/Approval binds to decision/)).toBeVisible();
  await expect(page.getByText("Awaiting review")).toHaveCount(0);
  await expect(page.getByText("Awaiting prior stage")).toHaveCount(0);
  await expect(page.getByText("Awaiting approval")).toHaveCount(0);
  await expect(page.getByText(/Reviewed ·/)).toBeVisible();
  await expect(page.getByText(/Approved ·/)).toHaveCount(2);
  const stagedAuthorityGate = page.getByRole("region", {
    name: "Approve",
  });
  await expect(stagedAuthorityGate).toContainText(
    "signed account reference subject:smiths-joint-taxable",
  );
  await expect(stagedAuthorityGate).toContainText(
    "account name unavailable",
  );
  await expect(stagedAuthorityGate).not.toContainText(
    "Smith Family Taxable",
  );
  await checkAxe(page, "authority");
  await snap(page, 6, "authority");

  // 7 - Safety: revalidation, reservation + idempotency inspectable.
  await page.getByRole("link", { name: "Continue after recorded approvals" }).click();
  await expect(page.getByText("Material evidence re-checked")).toBeVisible();
  await page.getByRole("button", { name: "Verify source" }).click();
  await expect(page.getByText("idem:GC-03:smiths-75000-2026-08-15").first()).toBeVisible();
  await expect(page.getByText("res:GC-03:liquidity").first()).toBeVisible();
  await checkAxe(page, "safety");
  await snap(page, 7, "safety");

  // 8 - Execution: submitted is NOT settled; deferral stated; fake adapter labeled.
  await page.getByRole("link", { name: "Execute the movement" }).click();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(page.getByText("settlement not yet confirmed")).toBeVisible();
  await expect(page.getByText("deferred pending sandbox access")).toBeVisible();
  await expectDevBadge(page);
  await checkAxe(page, "execution");
  await snap(page, 8, "execution");

  // 9 - Verification: proves vs not-yet, next poll.
  await page.getByRole("link", { name: "View verification" }).click();
  await expect(page.getByText("What this status proves")).toBeVisible();
  await expect(page.getByText("What it does not prove yet")).toBeVisible();
  await expect(page.getByText("Next status poll")).toBeVisible();
  await checkAxe(page, "verification");
  await snap(page, 9, "verification");

  // 10 - Firm A / Firm B: policy versions head the columns; differing rows marked.
  await page.getByRole("link", { name: "Compare Firm A and Firm B" }).click();
  await expect(page.getByText("firm-b-policy@2026.07.1").first()).toBeVisible();
  await expect(page.getByText("$48,000.00", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Planned-withdrawal schedule unavailable", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.getByTestId("comparison-differs").count()).toBeGreaterThan(0);
  await checkAxe(page, "comparison");
  await snap(page, 10, "comparison");

  // 11 - Policy authoring: draft set apart; activation appears only after approval.
  await page.getByRole("link", { name: "Author a policy change" }).click();
  await expect(page.getByText("Always preserve twelve months of planned withdrawals in cash.")).toBeVisible();
  await expect(page.getByTestId("policy-activated")).toHaveCount(0);
  await snap(page, 11, "policy-authoring");
  await page.getByRole("link", { name: "Approve and activate FA-4.3" }).click();
  await expect(page.getByTestId("policy-activated")).toBeVisible();
  await expect(page.getByText("FA-4.2 → FA-4.3")).toBeVisible();
  await checkAxe(page, "policy-authoring-approved");

  // 12 - Printable record: watermark, full hashes, expanded reasoning.
  await page.getByRole("link", { name: "View the printable decision record" }).click();
  await expect(page.getByTestId("record-watermark")).toContainText("Demonstration - not a compliance record");
  await expectFullDecisionBinding(page);
  await checkAxe(page, "record");
  await snap(page, 12, "record");
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

  // Competing liquidity: Firm A's signed branch authority proves the first request
  // proceeds. Firm B's recorded outcome blocks before reservation, but no signed
  // numeric case binds that branch-and-firm pair, so no unrelated figure is copied.
  await page.goto("/app/demo/decision?scenario=competing-liquidity&firm=firm-a");
  await expect(page.getByTestId("disposition-proceed")).toBeVisible();
  await expect(page.getByText("$112,000.00", { exact: true })).toBeVisible();
  await page.goto("/app/demo/decision?scenario=competing-liquidity&firm=firm-b");
  await expect(page.getByTestId("disposition-blocked")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return to a signed scenario" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Exact signed source unavailable for this branch and firm; no resolving evidence or action is projected.",
    ),
  ).toBeVisible();
  await checkAxe(page, "decision-blocked-reserve");
  await snap(page, 18, "decision-blocked-reserve-firm-b");
  await page.goto("/app/demo/workspace?scenario=competing-liquidity&firm=firm-b");
  await expect(page.getByText("Missing signed liquidity authority")).toBeVisible();
  await page.goto("/app/demo/comparison?scenario=competing-liquidity&firm=firm-a");
  await expect(page.getByText("$112,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("Missing signed branch-and-firm liquidity authority")).toBeVisible();
  await page.goto("/app/demo/safety?scenario=competing-liquidity&firm=firm-a");
  const sibling = page.locator(
    '[data-related-source-case="GC-11-simultaneous-distributions-second"]',
  );
  await expect(sibling).toHaveAttribute("data-related-disposition", "blocked");
  const siblingRequestAt = await sibling.getAttribute(
    "data-related-request-instant",
  );
  const siblingDecisionAt = await sibling.getAttribute(
    "data-related-decision-instant",
  );
  const reservationAt = await page
    .getByTestId("reservation-commit-timestamp")
    .getAttribute("data-event-instant");
  expect(Date.parse(siblingDecisionAt!)).toBeGreaterThan(
    Date.parse(siblingRequestAt!),
  );
  expect(Date.parse(reservationAt!)).toBeLessThan(
    Date.parse(siblingRequestAt!),
  );
  await expect(sibling).toContainText(
    "GC-11-simultaneous-distributions-second",
  );
  await page.goto("/app/demo/execution?scenario=competing-liquidity&firm=firm-a");
  const competingExecutionAt = await page
    .getByTestId("timeline-event")
    .first()
    .getAttribute("data-event-instant");
  expect(Date.parse(reservationAt!)).toBeLessThan(
    Date.parse(competingExecutionAt!),
  );

  // Prohibited: solid stamp, versioned source, ZERO resolving affordances.
  await page.goto("/app/demo/decision?scenario=permanent-prohibition&firm=firm-a&case=GC-06-household-restriction");
  const card = page.getByTestId("disposition-prohibited");
  await expect(card).toBeVisible();
  await expect(card.getByText("Prohibited", { exact: true })).toBeVisible();
  await expect(card.getByText("smiths-destination-restriction@v2")).toBeVisible();
  await expect(
    card.getByText("smiths-destination-restriction", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText("destination-not-household-titled", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText(
      "scope:destination:bank-instruction:contractor-business",
    ),
  ).toBeVisible();
  await expect(card.getByText("Verin will not route this for approval")).toBeVisible();
  expect(await page.getByTestId("blocker-row").count()).toBe(0);
  // The only interactive elements are inspective: the WhyBubble and the two links.
  expect(await card.getByRole("button").count()).toBe(1);
  await expect(card.getByRole("button", { name: "Why did Verin do this?" })).toBeVisible();
  await expect(card.getByRole("link", { name: "View the policy trace" })).toBeVisible();
  await checkAxe(page, "decision-prohibited");
  await snap(page, 14, "decision-prohibited");
  await page.goto("/app/demo");
  await expect(
    page.getByRole("link", {
      name: /Permanent prohibition.*GC-07-regulatory-prohibition/,
    }),
  ).toBeVisible();
  await page.goto(
    "/app/demo/decision?scenario=permanent-prohibition&firm=firm-a&case=GC-07-regulatory-prohibition",
  );
  const regulatoryCard = page.getByTestId("disposition-prohibited");
  await expect(
    regulatoryCard.getByText("reg-distribution-holds@2026.02"),
  ).toBeVisible();
  await expect(
    regulatoryCard.getByText("reg-distribution-holds", { exact: true }),
  ).toBeVisible();
  await expect(
    regulatoryCard.getByText("active-legal-hold", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View the policy trace" }).click();
  await expect(page).toHaveURL(/case=GC-07-regulatory-prohibition/);
  await expect(
    page.getByRole("cell", { name: "Regulatory legal hold" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "The destination is on-list; the household instruction is satisfied and is NOT the prohibition source here.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("reg-distribution-holds@2026.02").first(),
  ).toBeVisible();
  await page.goto(
    "/app/demo/record?scenario=permanent-prohibition&firm=firm-a&case=GC-07-regulatory-prohibition",
  );
  await expect(
    page.getByText("reg-distribution-holds@2026.02").first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Precedence trace" })
      .getByText(/Regulatory legal hold: An active legal hold/),
  ).toBeVisible();
  await checkAxe(page, "regulatory-prohibition-record");
  const canonicalRequestInstants: string[] = [];
  for (const firm of ["firm-a", "firm-b"]) {
    await page.goto(
      `/app/demo/intent?scenario=permanent-prohibition&firm=${firm}`,
    );
    await expect(
      page.getByText(
        /The Smiths need \$75,000 for their home renovation by August 15/,
      ),
    ).toBeVisible();
    await expect(page.getByText("$75,000.00", { exact: true })).toBeVisible();
    await expect(page.getByText("$30,000.00", { exact: true })).toHaveCount(0);
    canonicalRequestInstants.push(
      (await page
        .getByTestId("request-timestamp")
        .getAttribute("data-event-instant"))!,
    );
  }
  expect(new Set(canonicalRequestInstants)).toEqual(
    new Set(["2026-07-26T13:30:00.000Z"]),
  );
  await page.goto("/app/demo/evidence?scenario=safe-proceed&firm=firm-a");
  await expect(
    page.getByText(
      /Traditional IRA balance 610000 USD; a distribution here is a taxable event/,
    ),
  ).toBeVisible();
  await expect(page.getByText("$610,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$420,000.00", { exact: true })).toBeVisible();
  await page.goto(
    "/app/demo/workspace?scenario=safe-proceed&firm=firm-a&case=GC-01-firm-a-happy-path",
  );
  const accountRegion = page.getByRole("region", { name: "Accounts" });
  await expect(
    accountRegion.getByText("Signed account reference: subject:smiths-joint-taxable", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    accountRegion.getByText("Signed account reference: subject:smiths-ira", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    accountRegion.getByText("$610,000.00", { exact: true }),
  ).toBeVisible();
  await expect(
    accountRegion.getByText("$310,000.00", { exact: true }),
  ).toHaveCount(0);
  await expect(
    accountRegion.getByText(
      "account name, account type, custodian unavailable in this signed case",
      { exact: true },
    ),
  ).toHaveCount(2);
  await page.getByRole("link", { name: "Ask Verin about this household" }).click();
  await expect(page).toHaveURL(/case=GC-01-firm-a-happy-path/);
  await page.goto("/app/demo/evidence?scenario=permanent-prohibition&firm=firm-a");
  await expect(
    page.getByText(
      /bank instruction · bank-instruction:contractor-business · house-crm · fresh/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Standing destination restriction: distributions may ONLY go to bank instructions titled to the household/,
    ),
  ).toBeVisible();
  await page.goto("/app/demo/workspace?scenario=stale-evidence&firm=firm-a");
  const staleLiquidity = page.getByRole("region", { name: "Liquidity" });
  await expect(staleLiquidity).toContainText(
    "Sample data · as of 2026-06-09",
  );
  await page.goto("/app/demo/intent?scenario=stale-evidence&firm=firm-a");
  await expect(
    page.getByText("Exact signed source unavailable", { exact: true }),
  ).toBeVisible();
  await page.goto("/app/demo/evidence?scenario=stale-evidence&firm=firm-a");
  await expect(
    page.getByText(/Planned-withdrawal schedule last observed 2026-06-09/),
  ).toBeVisible();
  await expect(page.getByText(/47 days before asOf/)).toBeVisible();
  await expect(page.getByText("retrieved Jul 26, 14:00:05").first()).toBeVisible();
  await page.goto("/app/demo/evidence?scenario=ambiguous-instruction&firm=firm-a");
  await expect(page.getByText(/subject:smiths-robert-ana/)).toBeVisible();
  await expect(page.getByText(/subject:smith-family-trust/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/demo/decision?scenario=permanent-prohibition&firm=firm-a");
  await expect(
    page
      .getByTestId("disposition-prohibited")
      .getByText(
        "scope:destination:bank-instruction:contractor-business",
      ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await checkAxe(page, "decision-prohibition-mobile");
  await page.goto("/app/demo/evidence?scenario=stale-evidence&firm=firm-a");
  await expect(page.getByText(/47 days before asOf/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await checkAxe(page, "evidence-exact-mobile");
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto("/app/demo/intent?scenario=approval-invalidation&firm=firm-a");
  const invalidationRequestAt = await page
    .getByTestId("request-timestamp")
    .getAttribute("data-event-instant");
  for (const surface of ["workspace", "evidence", "decision", "authority"]) {
    await page.goto(`/app/demo/${surface}?scenario=approval-invalidation&firm=firm-a`);
    await expect(page.getByText("$15,000.00", { exact: true })).toHaveCount(0);
  }
  await page.goto("/app/demo/safety?scenario=approval-invalidation&firm=firm-a");
  const invalidationRevalidatedAt = await page
    .getByTestId("revalidation-timestamp")
    .getAttribute("data-event-instant");
  expect(Date.parse(invalidationRevalidatedAt!)).toBeGreaterThan(
    Date.parse(invalidationRequestAt!),
  );
  await expect(page.getByTestId("voided-approval")).toHaveCount(2);
  await expect(page.getByText("Approval voided - evidence changed")).toHaveCount(2);
  await expect(page.getByTestId("what-changed")).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$15,000.00", { exact: true })).toBeVisible();
  const changedText = await page.getByTestId("what-changed").innerText();
  expect(changedText.indexOf("Initial decision")).toBeLessThan(changedText.indexOf("Pre-execution revalidation"));
  await expect(page.getByRole("link", { name: "Re-evaluate with current evidence" })).toBeVisible();
  await checkAxe(page, "safety-invalidation");
  await snap(page, 15, "safety-invalidation");
  await page.goto("/app/demo/record?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByText("$15,000.00", { exact: true }).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/demo/workspace?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByText("$15,000.00", { exact: true })).toHaveCount(0);
  await page.goto("/app/demo/safety?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByText("$15,000.00", { exact: true })).toBeVisible();
  await checkAxe(page, "safety-invalidation-mobile");
  await snap(page, 19, "safety-invalidation-mobile");
  await page.setViewportSize({ width: 1280, height: 720 });

  // Duplicate retry: the product claim in plain words, keys matching byte-for-byte.
  await page.goto("/app/demo/intent?scenario=duplicate-retry&firm=firm-a");
  const duplicateRequestAt = await page
    .getByTestId("request-timestamp")
    .getAttribute("data-event-instant");
  await page.goto("/app/demo/execution?scenario=duplicate-retry&firm=firm-a");
  await expect(page.getByText("Already submitted once - Verin did not send it again.")).toBeVisible();
  await expect(page.getByText("Duplicate suppressed")).toBeVisible();
  const duplicateEvents = page.getByTestId("timeline-event");
  await expect(duplicateEvents).toHaveCount(2);
  const duplicateInstants = await duplicateEvents.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-event-instant")!),
  );
  expect(duplicateInstants.every((instant) =>
    Date.parse(instant) > Date.parse(duplicateRequestAt!),
  )).toBe(true);
  expect(Date.parse(duplicateInstants[1]!)).toBeGreaterThan(
    Date.parse(duplicateInstants[0]!),
  );
  await expect(duplicateEvents.nth(0)).toContainText("Jul 26, 16:39");
  await expect(duplicateEvents.nth(1)).toContainText("Jul 26, 16:40");
  await snap(page, 16, "execution-duplicate-suppressed");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/demo/execution?scenario=duplicate-retry&firm=firm-a");
  await expect(page.getByTestId("timeline-event").nth(0)).toContainText(
    "Jul 26, 16:39",
  );
  await expect(page.getByTestId("timeline-event").nth(1)).toContainText(
    "Jul 26, 16:40",
  );
  await page.setViewportSize({ width: 1280, height: 720 });

  // Delayed NIGO: first-class appended row with its resolving affordance.
  await page.goto("/app/demo/safety?scenario=delayed-nigo&firm=firm-b");
  await page.getByRole("button", { name: "Verify source" }).click();
  await expect(page.getByText("idem:GC-14:smiths-75000-2026-08-15")).toBeVisible();
  await expect(page.getByText("res:GC-14:liquidity")).toBeVisible();
  await expect(page.getByText("PT30M")).toBeVisible();
  await expect(page.getByText("conflict:smiths-liquidity")).toBeVisible();
  await page.goto("/app/demo/verification?scenario=delayed-nigo&firm=firm-b");
  await expect(page.getByText("Returned NIGO", { exact: true })).toBeVisible();
  await expect(page.getByText(/signature date predates form version/).first()).toBeVisible();
  await expect(page.getByText(/Status polling stopped after terminal NIGO/)).toBeVisible();
  await expect(page.getByText(/Next status poll/)).toHaveCount(0);
  await expect(page.getByTestId("exception-decision-requested")).toContainText("delayed-nigo");
  await expect(page.getByTestId("exception-decision-requested")).toContainText("StatusObserved");
  await expect(page.getByRole("button", { name: "Fix and resubmit the authorization" })).toBeVisible();
  await checkAxe(page, "verification-delayed-nigo");
  await snap(page, 17, "verification-delayed-nigo");

  // Specialist-review expiration under Firm B: no specialist stage exists there -
  // the recorded per-firm split blocks until independently verified (contract §2).
  await page.goto("/app/demo/decision?scenario=specialist-review-expiration&firm=firm-b");
  await expect(page.getByTestId("disposition-blocked")).toBeVisible();
  await expect(
    page.getByText(
      "Exact signed source unavailable for this branch and firm; no resolving evidence or action is projected.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Return to a signed scenario" }),
  ).toBeVisible();
  await page.goto("/app/demo/authority?scenario=specialist-review-expiration&firm=firm-b");
  await expect(page.getByText("Authority not reached")).toBeVisible();

  await page.goto("/app/demo/authority?scenario=specialist-review-expiration&firm=firm-a");
  await expect(page.getByText("Escalated, then expired")).toBeVisible();
  await expect(page.getByText("escalated to the operations manager, then expired unresolved")).toBeVisible();
  await expect(page.getByText(/Execution mode: sequential · expires after P2D/)).toBeVisible();
  await expect(page.getByText(/Escalates after P1D to operations-manager · specialist-review-idle/)).toBeVisible();
  await expect(page.getByText(/Execution mode: parallel · expires after P3D/)).toBeVisible();
  const authorityEvents = page.getByTestId("authority-event-order").locator("li");
  await expect(authorityEvents).toHaveCount(2);
  await expect(authorityEvents.nth(0)).toHaveAttribute("data-event-type", "ApprovalStageEscalated");
  await expect(authorityEvents.nth(1)).toHaveAttribute("data-event-type", "ApprovalStageExpired");
  await expect(authorityEvents.nth(0)).toContainText("Jul 27, 18:20");
  await expect(authorityEvents.nth(1)).toContainText("Jul 28, 18:20");
  await snap(page, 20, "specialist-expiration");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(authorityEvents.nth(0)).toBeVisible();
  await expect(authorityEvents.nth(1)).toBeVisible();
  await checkAxe(page, "specialist-expiration-mobile");
  await snap(page, 21, "specialist-expiration-mobile");
});

test("signed authority, invalidation, and partial receipts fail closed and remain exact", async ({ page }) => {
  await login(page, PRINCIPAL);

  await page.goto("/app/demo/safety?scenario=partial-salesforce-success&firm=firm-b");
  await expect(page.getByText("Signed liquidity authority unavailable for this branch and firm")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify source" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Execute the movement" })).toHaveCount(0);
  await page.goto("/app/demo/execution?scenario=partial-salesforce-success&firm=firm-b");
  await expect(page.getByText("Execution not reached")).toBeVisible();
  await expect(page.getByText(/signed liquidity authority/i)).toBeVisible();
  await page.goto("/app/demo/verification?scenario=partial-salesforce-success&firm=firm-b");
  await expect(page.getByText("Verification not reached")).toBeVisible();

  await page.goto("/app/demo/authority?scenario=safe-proceed&firm=firm-b");
  await expect(page.getByTestId("automatic-authority")).toBeVisible();
  await expect(page.getByText("Automatic authority", { exact: true })).toBeVisible();
  await expect(page.getByText(/Approval binds to decision/)).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Continue after recorded approvals" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Continue under automatic authority" }),
  ).toBeVisible();
  const automaticAuthorityGate = page.getByRole("region", {
    name: "Continue",
  });
  await expect(automaticAuthorityGate).toContainText(
    "signed account reference subject:smiths-joint-taxable",
  );
  await expect(automaticAuthorityGate).toContainText(
    "account name unavailable",
  );
  await expect(automaticAuthorityGate).not.toContainText(
    "Smith Family Taxable",
  );

  const invalidationContext =
    "scenario=approval-invalidation&firm=firm-a&case=GC-15-approval-invalidation";
  await page.goto(`/app/demo/decision?${invalidationContext}`);
  await expect(
    page.getByRole("region", { name: "Recommended source" }),
  ).toContainText("Balance 300000 USD at first evaluation.");
  await expect(
    page.getByRole("region", { name: "Alternatives considered" }),
  ).toHaveCount(0);
  await page.goto(`/app/demo/policy-authoring?${invalidationContext}`);
  const initialPolicyHeadroom = page
    .getByRole("row")
    .filter({ hasText: "Available after reserve" });
  await expect(initialPolicyHeadroom).toContainText("$252,000.00");
  await expect(initialPolicyHeadroom).toContainText("$204,000.00");

  await page.goto("/app/demo/authority?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByText(/Approved ·/)).toHaveCount(2);
  await page.getByRole("link", { name: "Continue after recorded approvals" }).click();
  await expect(page.getByTestId("voided-approval")).toHaveCount(2);
  await page.getByRole("link", { name: "Re-evaluate with current evidence" }).click();
  await expect(page.getByTestId("derived-decision")).toBeVisible();
  await expect(page.getByText("$237,000.00", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Recommended source" }),
  ).toContainText(
    "Available taxable liquidity remains 300000 USD at pre-execution revalidation.",
  );
  await expect(
    page.getByRole("region", { name: "Recommended source" }),
  ).not.toContainText("first evaluation");
  await expect(
    page.getByRole("region", { name: "Alternatives considered" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Back to the evidence" }).click();
  await expect(page).toHaveURL(/pass=revalidated/);
  await expect(page.getByTestId("refreshed-evidence")).toBeVisible();
  await expect(page.getByText("$15,000.00", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View the recommendation" }).click();
  await expect(page.getByTestId("derived-decision")).toBeVisible();
  await page.getByRole("link", { name: "View the policy trace" }).click();
  await page.getByRole("link", { name: "Continue to authority" }).click();
  await expect(page.getByText("Fresh approval on derived decision")).toHaveCount(2);
  await page.getByRole("link", { name: "Continue after recorded approvals" }).click();
  await expect(page.getByText("Two fresh approvals bind to the derived decision")).toBeVisible();
  await page.getByRole("button", { name: "Verify source" }).click();
  await expect(page.getByText("res:GC-15:liquidity")).toBeVisible();
  await checkAxe(page, "approval-invalidation-revalidated");
  await snap(page, 22, "approval-invalidation-revalidated");
  await page.getByRole("link", { name: "Execute the movement" }).click();
  await page.getByRole("link", { name: "View verification" }).click();
  await expect(page.getByText("Submission accepted by the capability")).toBeVisible();
  await page.getByRole("link", { name: "Compare Firm A and Firm B" }).click();
  await expect(page).toHaveURL(/pass=revalidated/);
  await expect(page.getByText("$237,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$252,000.00", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to verification" }).click();
  await expect(page).toHaveURL(/pass=revalidated/);
  await expect(page.getByText("Submission accepted by the capability")).toBeVisible();

  await page.goto(`/app/demo/record?${invalidationContext}`);
  await expect(page.getByTestId("signed-lifecycle-event")).toHaveCount(6);
  await expect(page.getByTestId("decision-binding")).toHaveCount(1);
  await expect(page.getByText("Derived decision hash", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/idem:GC-15/)).toHaveCount(0);
  await expect(page.getByText(/res:GC-15/)).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Execution" }),
  ).toContainText("returned to Decision");
  await expect(
    page.getByRole("region", { name: "Execution" }),
  ).not.toContainText("Submitted");
  await expect(
    page.getByRole("region", { name: "Verification state at time of export" }),
  ).toContainText("returned to Decision");

  await page.goto(`/app/demo/record?${invalidationContext}&pass=revalidated`);
  const lifecycle = page.getByTestId("signed-lifecycle-event");
  await expect(lifecycle).toHaveCount(13);
  await expect(page.getByTestId("decision-binding")).toHaveCount(2);
  await expect(page.getByText(/idem:GC-15/).first()).toBeVisible();
  await expect(page.getByText(/res:GC-15/).first()).toBeVisible();
  await expect(page.getByText("Original decision hash", { exact: true })).toBeVisible();
  await expect(page.getByText("Derived decision hash", { exact: true })).toBeVisible();
  await expect(page.getByText("Refreshed input-bundle hash", { exact: true })).toBeVisible();
  await expect(lifecycle.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-event-type")))).resolves.toEqual([
    "EvidenceSnapshotRecorded",
    "DecisionRecorded",
    "ApprovalRecorded",
    "ApprovalRecorded",
    "EvidenceSnapshotRecorded",
    "ApprovalInvalidated",
    "DecisionRecorded",
    "ApprovalRecorded",
    "ApprovalRecorded",
    "ReservationCreated",
    "ExecutionStarted",
    "ExecutionSucceeded",
    "StatusObserved",
  ]);
  await expect(
    page.getByRole("region", { name: "Execution" }),
  ).toContainText("Submitted");
  await expect(
    page.getByRole("region", { name: "Verification state at time of export" }),
  ).toContainText("Submission accepted by the capability");
  const lifecycleInstants = await lifecycle.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-event-instant")),
  );
  expect(lifecycleInstants[0]).toBe("2026-07-26T21:45:02.000Z");
  expect(Date.parse(lifecycleInstants[0]!)).toBeLessThan(
    Date.parse(lifecycleInstants[1]!),
  );
  await page.goto("/app/demo/record?scenario=approval-invalidation&firm=firm-b");
  await expect(page.getByTestId("signed-lifecycle-event")).toHaveCount(0);
  await expect(page.getByTestId("automatic-authority")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Execution" })
      .getByText(
        "This journey stopped at Safety because exact signed liquidity authority is unavailable.",
      ),
  ).toBeVisible();
  const unsupportedRevalidation = await page.goto(
    "/app/demo/evidence?scenario=approval-invalidation&firm=firm-b&pass=revalidated",
  );
  expect(unsupportedRevalidation?.status()).toBe(404);

  await page.goto("/app/demo/execution?scenario=partial-salesforce-success&firm=firm-a");
  const completedPart = page.getByTestId("timeline-event").filter({ hasText: "instruction-created" });
  const incompletePart = page.getByTestId("timeline-event").filter({ hasText: "disbursement-scheduled" });
  await expect(completedPart).toContainText("Completed part");
  await expect(incompletePart).toContainText("Unconfirmed");
  await expect(completedPart).toHaveAttribute(
    "data-event-instant",
    "2026-07-26T21:14:10.000Z",
  );
  await expect(incompletePart).toHaveAttribute(
    "data-event-instant",
    "2026-07-28T21:14:00.000Z",
  );
  await expect(page.getByText("Settled · verified")).toHaveCount(0);
  await page.getByRole("link", { name: "View verification" }).click();
  await expect(page.getByText("Completed part: instruction-created")).toBeVisible();
  await expect(page.getByText("Incomplete part: disbursement-scheduled")).toBeVisible();
  await expect(page.getByText(/settled/i)).toHaveCount(0);
  await expect(page.getByTestId("exception-decision-requested")).toContainText(
    "ExceptionDecisionRequested",
  );
  await expect(page.getByTestId("exception-decision-requested")).toContainText(
    "partial-execution",
  );
  await page.goto("/app/demo/record?scenario=partial-salesforce-success&firm=firm-a");
  await expect(page.getByTestId("exception-decision-requested")).toContainText(
    "ExceptionDecisionRequested",
  );

  await page.goto(
    "/app/demo/policy-authoring?scenario=approval-invalidation&firm=firm-a&pass=revalidated",
  );
  await expect(page.getByText("$237,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$189,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$252,000.00", { exact: true })).toHaveCount(0);
  await expect(page.getByText("$204,000.00", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/demo/safety?scenario=approval-invalidation&firm=firm-a&pass=revalidated");
  await expect(page.getByText("Two fresh approvals bind to the derived decision")).toBeVisible();
  await checkAxe(page, "approval-invalidation-revalidated-mobile");
  await snap(page, 23, "approval-invalidation-revalidated-mobile");
});

test("print posture: the record's identity header prints complete; app chrome and buttons do not", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/demo/record?scenario=recent-bank-change-block&firm=firm-a");
  await page.emulateMedia({ media: "print" });
  // Design §9: wordmark, watermark chip, decision id, and the FULL hashes stay on paper.
  await expect(page.getByTestId("record-watermark")).toBeVisible();
  await expect(
    page.getByText(
      "dec:recent-bank-change-block:firm-a:GC-03-recent-bank-change-firm-a:initial",
    ).first(),
  ).toBeVisible();
  await expectFullDecisionBinding(page);
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
  const badCase = await page.goto(
    "/app/demo/decision?scenario=permanent-prohibition&firm=firm-a&case=GC-99-invented",
  );
  expect(badCase?.status()).toBe(404);
  const substitutedCase = await page.goto(
    "/app/demo/decision?scenario=permanent-prohibition&firm=firm-a&case=GC-01-firm-a-happy-path",
  );
  expect(substitutedCase?.status()).toBe(404);
  // Absent params still land on the default branch.
  const defaulted = await page.goto("/app/demo/decision");
  expect(defaulted?.status()).toBe(200);
  await expect(page.getByTestId("disposition-proceed")).toBeVisible();
});

test("the launcher exposes every exact signed firm and case variant", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/demo");

  const variants = [
    ["GC-01-firm-a-happy-path", "safe-proceed", "firm-a"],
    ["GC-02-firm-b-happy-path", "safe-proceed", "firm-b"],
    ["GC-03-recent-bank-change-firm-a", "recent-bank-change-block", "firm-a"],
    ["GC-04-recent-bank-change-firm-b", "recent-bank-change-block", "firm-b"],
    ["GC-06-household-restriction", "permanent-prohibition", "firm-a"],
    ["GC-07-regulatory-prohibition", "permanent-prohibition", "firm-a"],
    ["GC-08-ambiguous-household", "ambiguous-instruction", "firm-a"],
    ["GC-09-stale-evidence", "stale-evidence", "firm-a"],
    ["GC-10-simultaneous-distributions-first", "competing-liquidity", "firm-a"],
    ["GC-11-simultaneous-distributions-second", "competing-liquidity", "firm-a"],
    ["GC-12-duplicate-retry", "duplicate-retry", "firm-a"],
    ["GC-13-partial-salesforce-success", "partial-salesforce-success", "firm-a"],
    ["GC-14-delayed-nigo", "delayed-nigo", "firm-b"],
    ["GC-15-approval-invalidation", "approval-invalidation", "firm-a"],
    ["GC-16-specialist-review-expiration", "specialist-review-expiration", "firm-a"],
  ] as const;

  for (const [caseId, scenarioId, firmId] of variants) {
    await expect(
      page.getByRole("link", { name: new RegExp(caseId) }),
    ).toHaveAttribute(
      "href",
      `/app/demo/workspace?scenario=${scenarioId}&firm=${firmId}&case=${caseId}`,
    );
  }

  await page.goto(
    "/app/demo/decision?scenario=competing-liquidity&firm=firm-a&case=GC-11-simultaneous-distributions-second",
  );
  await expect(page.getByTestId("disposition-blocked")).toBeVisible();
  await page.goto(
    "/app/demo/authority?scenario=competing-liquidity&firm=firm-a&case=GC-11-simultaneous-distributions-second",
  );
  await expect(page.getByText("Authority not reached")).toBeVisible();
  await page.goto(
    "/app/demo/policy-authoring?scenario=competing-liquidity&firm=firm-a&case=GC-11-simultaneous-distributions-second",
  );
  const gc11Headroom = page
    .getByRole("row")
    .filter({ hasText: "Available after reserve" });
  await expect(gc11Headroom).toContainText("-$11,000.00");
  await expect(gc11Headroom).not.toContainText("$64,000.00");
});

test("missing bank-instruction evidence fails closed on Safety and Record", async ({ page }) => {
  await login(page, PRINCIPAL);
  const context = "scenario=dual-approval&firm=firm-a";

  for (const station of ["safety", "record"]) {
    await page.goto(`/app/demo/${station}?${context}`);
    const surface = page.locator("main");
    await expect(surface).toContainText("Evidence missing");
    await expect(surface).toContainText("Bank-instruction check not evaluated");
    await expect(surface).toContainText("Evidence unavailable");
    await expect(surface).not.toContainText(
      "Bank instruction unchanged since the decision",
    );
  }
});

test("exact demo route context survives every inspective and dead-end link", async ({ page }) => {
  await login(page, PRINCIPAL);
  const prohibitedContext =
    "scenario=permanent-prohibition&firm=firm-a&case=GC-07-regulatory-prohibition";

  await page.goto(`/app/demo/decision?${prohibitedContext}`);
  await page.getByRole("link", { name: "View the printable record" }).click();
  await expect(page).toHaveURL(new RegExp(`${prohibitedContext}$`));
  await expect(
    page.getByText("reg-distribution-holds@2026.02").first(),
  ).toBeVisible();

  for (const station of ["authority", "safety", "execution", "verification"]) {
    await page.goto(`/app/demo/${station}?${prohibitedContext}`);
    await page.getByRole("link", { name: "Back to the decision" }).click();
    await expect(page).toHaveURL(new RegExp(`${prohibitedContext}$`));
    await expect(
      page.getByText("reg-distribution-holds@2026.02").first(),
    ).toBeVisible();
  }

  await page.goto(
    "/app/demo/safety?scenario=approval-invalidation&firm=firm-a&case=GC-15-approval-invalidation",
  );
  await page
    .getByRole("link", { name: "Re-evaluate with current evidence" })
    .click();
  await expect(page).toHaveURL(
    /scenario=approval-invalidation&firm=firm-a&case=GC-15-approval-invalidation&pass=revalidated$/,
  );
  await expect(page.getByTestId("derived-decision")).toBeVisible();
});

test("verification proof provenance stays bound to each signed event", async ({ page }) => {
  await login(page, PRINCIPAL);

  await page.goto(
    "/app/demo/verification?scenario=partial-salesforce-success&firm=firm-a&case=GC-13-partial-salesforce-success",
  );
  const partialProofs = page.getByRole("region", {
    name: "What this status proves",
  });
  await expect(
    partialProofs.getByRole("listitem").filter({
      hasText: "Submission accepted by the capability",
    }),
  ).toHaveAttribute("data-event-instant", "2026-07-26T21:14:10.000Z");
  await expect(
    partialProofs.getByRole("listitem").filter({
      hasText: "Completed part: instruction-created",
    }),
  ).toHaveAttribute("data-event-instant", "2026-07-26T21:14:10.000Z");
  await page.goto(
    "/app/demo/record?scenario=partial-salesforce-success&firm=firm-a&case=GC-13-partial-salesforce-success",
  );
  await expect(
    page
      .getByRole("region", {
        name: "Verification state at time of export",
      })
      .getByRole("listitem")
      .filter({ hasText: "Completed part: instruction-created" }),
  ).toHaveAttribute("data-event-instant", "2026-07-26T21:14:10.000Z");

  await page.goto(
    "/app/demo/verification?scenario=delayed-nigo&firm=firm-b&case=GC-14-delayed-nigo",
  );
  const nigoProofs = page.getByRole("region", {
    name: "What this status proves",
  });
  await expect(
    nigoProofs.getByRole("listitem").filter({
      hasText: "Submission accepted by the capability",
    }),
  ).toHaveAttribute("data-event-instant", "2026-07-26T21:44:20.000Z");
  await expect(
    nigoProofs.getByRole("listitem").filter({
      hasText: "Custodian returned the instruction NIGO",
    }),
  ).toHaveAttribute("data-event-instant", "2026-07-28T21:44:00.000Z");
  await page.goto(
    "/app/demo/record?scenario=delayed-nigo&firm=firm-b&case=GC-14-delayed-nigo",
  );
  await expect(
    page
      .getByRole("region", {
        name: "Verification state at time of export",
      })
      .getByRole("listitem")
      .filter({ hasText: "Submission accepted by the capability" }),
  ).toHaveAttribute("data-event-instant", "2026-07-26T21:44:20.000Z");
});

test("printable records carry exact route and lifecycle identity", async ({ page }) => {
  await login(page, PRINCIPAL);

  await page.goto(
    "/app/demo/record?scenario=permanent-prohibition&firm=firm-a&case=GC-06-household-restriction",
  );
  await expect(page.getByTestId("record-context")).toContainText(
    "permanent-prohibition",
  );
  await expect(page.getByTestId("record-context")).toContainText("firm-a");
  await expect(page.getByTestId("record-context")).toContainText(
    "GC-06-household-restriction",
  );
  await expect(page.getByTestId("record-context")).toContainText("initial");
  const householdRecordId = await page
    .getByTestId("record-decision-id")
    .textContent();

  await page.goto(
    "/app/demo/record?scenario=permanent-prohibition&firm=firm-a&case=GC-07-regulatory-prohibition",
  );
  await expect(page.getByTestId("record-decision-id")).not.toHaveText(
    householdRecordId ?? "",
  );

  await page.goto(
    "/app/demo/record?scenario=approval-invalidation&firm=firm-a&case=GC-15-approval-invalidation",
  );
  const initialRecordId = await page
    .getByTestId("record-decision-id")
    .textContent();
  await expect(page.getByTestId("record-context").locator("time")).toHaveAttribute(
    "data-event-instant",
    "2026-07-26T21:45:10.000Z",
  );
  await expect(page.getByTestId("decision-binding")).toHaveAttribute(
    "data-binding-kind",
    "original",
  );
  await page.goto(
    "/app/demo/record?scenario=approval-invalidation&firm=firm-a&case=GC-15-approval-invalidation&pass=revalidated",
  );
  await expect(page.getByTestId("record-context")).toContainText(
    "revalidated",
  );
  await expect(page.getByTestId("record-decision-id")).not.toHaveText(
    initialRecordId ?? "",
  );
  await expect(page.getByTestId("record-context").locator("time")).toHaveAttribute(
    "data-event-instant",
    "2026-07-26T21:58:12.000Z",
  );
});

test("record and approval hashes bind exact case inputs and lifecycle pass", async ({ page }) => {
  await login(page, PRINCIPAL);

  await page.goto(
    "/app/demo/record?scenario=permanent-prohibition&firm=firm-a&case=GC-06-household-restriction",
  );
  const householdBinding = page.getByTestId("decision-binding");
  const householdDecisionHash = await householdBinding.locator("dd").nth(0).textContent();
  const householdBundleHash = await householdBinding.locator("dd").nth(1).textContent();

  await page.goto(
    "/app/demo/record?scenario=permanent-prohibition&firm=firm-a&case=GC-07-regulatory-prohibition",
  );
  const regulatoryBinding = page.getByTestId("decision-binding");
  await expect(regulatoryBinding.locator("dd").nth(0)).not.toHaveText(
    householdDecisionHash ?? "",
  );
  await expect(regulatoryBinding.locator("dd").nth(1)).not.toHaveText(
    householdBundleHash ?? "",
  );

  await page.goto(
    "/app/demo/record?scenario=approval-invalidation&firm=firm-a&case=GC-15-approval-invalidation",
  );
  const initialDecisionHash = await page
    .getByTestId("decision-binding")
    .locator("dd")
    .nth(0)
    .textContent();
  const initialBundleHash = await page
    .getByTestId("decision-binding")
    .locator("dd")
    .nth(1)
    .textContent();
  await page.goto(
    "/app/demo/record?scenario=approval-invalidation&firm=firm-a&case=GC-15-approval-invalidation&pass=revalidated",
  );
  const revalidatedBindings = page.getByTestId("decision-binding");
  await expect(revalidatedBindings).toHaveCount(2);
  await expect(revalidatedBindings.nth(0).locator("dd").nth(0)).toHaveText(
    initialDecisionHash ?? "",
  );
  await expect(revalidatedBindings.nth(0).locator("dd").nth(1)).toHaveText(
    initialBundleHash ?? "",
  );
  const derivedDecisionHash = await revalidatedBindings
    .nth(1)
    .locator("dd")
    .nth(0)
    .textContent();
  const derivedBundleHash = await revalidatedBindings
    .nth(1)
    .locator("dd")
    .nth(1)
    .textContent();
  expect(derivedDecisionHash).not.toBe(initialDecisionHash);
  expect(derivedBundleHash).not.toBe(initialBundleHash);
  await page.goto(
    "/app/demo/authority?scenario=approval-invalidation&firm=firm-a&case=GC-15-approval-invalidation&pass=revalidated",
  );
  await expect(page.getByText(/Approval binds to decision/)).toContainText(
    `${derivedDecisionHash?.slice(0, 8)}…`,
  );
  await expect(page.getByText(/Approval binds to decision/)).toContainText(
    `${derivedBundleHash?.slice(0, 8)}…`,
  );
});

test("policy trace does not infer no recent change from missing evidence", async ({ page }) => {
  await login(page, PRINCIPAL);

  for (const sourceCaseId of [
    "GC-07-regulatory-prohibition",
    "GC-08-ambiguous-household",
  ]) {
    const scenario =
      sourceCaseId === "GC-07-regulatory-prohibition"
        ? "permanent-prohibition"
        : "ambiguous-instruction";
    await page.goto(
      `/app/demo/policy-trace?scenario=${scenario}&firm=firm-a&case=${sourceCaseId}`,
    );
    await expect(
      page.getByText(
        "Not evaluated - exact signed bank-instruction evidence unavailable",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Not triggered - no recent change"),
    ).toHaveCount(0);
  }
});

test("comparison does not claim policy-only causality across an evidence gap", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto(
    "/app/demo/comparison?scenario=competing-liquidity&firm=firm-a&case=GC-10-simultaneous-distributions-first",
  );
  await expect(
    page.getByText(
      "Exact signed equivalent evidence is unavailable for one comparison arm.",
    ),
  ).toBeVisible();
  const dispositionRow = page
    .getByText("Disposition for this request")
    .locator("..")
    .locator("..");
  await dispositionRow
    .getByRole("button", { name: "Why did Verin do this?" })
    .click();
  await expect(
    dispositionRow.getByText(/same evidence - the outcome differs because/i),
  ).toHaveCount(0);
  await expect(
    dispositionRow.getByText(
      "The disposition comparison includes an evidence-authority gap, so the outcome is not attributed solely to policy.",
    ),
  ).toBeVisible();
});

test("exact schedules and cross-firm reruns fail closed", async ({ page }) => {
  await login(page, PRINCIPAL);

  for (const route of [
    {
      scenario: "recent-bank-change-block",
      firm: "firm-b",
      caseId: "GC-04-recent-bank-change-firm-b",
      reserve: "$96,000.00",
    },
    {
      scenario: "permanent-prohibition",
      firm: "firm-a",
      caseId: "GC-06-household-restriction",
      reserve: "$48,000.00",
    },
    {
      scenario: "permanent-prohibition",
      firm: "firm-a",
      caseId: "GC-07-regulatory-prohibition",
      reserve: "$48,000.00",
    },
    {
      scenario: "ambiguous-instruction",
      firm: "firm-a",
      caseId: "GC-08-ambiguous-household",
      reserve: "$48,000.00",
    },
  ]) {
    const context =
      `scenario=${route.scenario}&firm=${route.firm}&case=${route.caseId}`;
    await page.goto(`/app/demo/workspace?${context}`);
    await expect(
      page.getByText(
        `No exact signed planned-withdrawal schedule covers ${route.scenario} for ${route.firm}`,
      ),
    ).toBeVisible();
    await expect(
      page.getByText("$8,000.00", { exact: true }),
    ).toHaveCount(0);

    await page.goto(`/app/demo/policy-authoring?${context}`);
    await expect(
      page.getByText(
        "Not simulated without exact signed schedule evidence",
      ).first(),
    ).toBeVisible();
    await expect(
      page.getByText(route.reserve, { exact: true }),
    ).toHaveCount(0);
  }

  for (const rerun of [
    {
      from:
        "/app/demo/comparison?scenario=safe-proceed&firm=firm-a&case=GC-01-firm-a-happy-path",
      name: "Rerun this request under Firm B",
      href:
        "/app/demo/decision?scenario=safe-proceed&firm=firm-b&case=GC-02-firm-b-happy-path",
    },
    {
      from:
        "/app/demo/comparison?scenario=recent-bank-change-block&firm=firm-a&case=GC-03-recent-bank-change-firm-a",
      name: "Rerun this request under Firm B",
      href:
        "/app/demo/decision?scenario=recent-bank-change-block&firm=firm-b&case=GC-04-recent-bank-change-firm-b",
    },
  ]) {
    await page.goto(rerun.from);
    const link = page.getByRole("link", { name: rerun.name });
    await expect(link).toHaveAttribute("href", rerun.href);
    await link.click();
    await expect(page).toHaveURL(rerun.href);
  }
});

test("every fake-backed demo surface carries a visible dev provenance badge", async ({ page }) => {
  await login(page, PRINCIPAL);
  const surfaces = [
    "workspace",
    "intent",
    "evidence",
    "decision",
    "policy-trace",
    "authority",
    "safety",
    "execution",
    "verification",
    "comparison",
    "policy-authoring",
    "record",
  ];
  for (const s of surfaces) {
    await page.goto(`/app/demo/${s}?scenario=recent-bank-change-block&firm=firm-a`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.getByTestId("dev-provenance-badge").count(), `surface ${s} must carry a dev provenance badge`).toBeGreaterThan(0);
  }
});
