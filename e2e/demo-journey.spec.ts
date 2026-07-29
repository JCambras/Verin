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

test("the seven-minute journey is clickable end-to-end on labeled fakes", async ({ page }) => {
  await login(page, PRINCIPAL);

  // Launcher.
  await page.getByRole("link", { name: "Demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Money-movement demo" })).toBeVisible();
  await checkAxe(page, "launcher");
  await snap(page, 0, "launcher");

  // 1 - Household workspace (canonical journey: recent bank change under Firm A).
  await page.getByRole("link", { name: "Run the seven-minute journey" }).click();
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
  await expect(page.getByText("specialist-review stage")).toBeVisible();
  await checkAxe(page, "decision");
  await snap(page, 4, "decision");

  // 5 - Policy trace: versions in mono, precedence rows.
  await page.getByRole("link", { name: "View the policy trace" }).click();
  await expect(page.getByText("FA-4.2").first()).toBeVisible();
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
  await expect(page.getByText("FB-2.1").first()).toBeVisible();
  await expect(page.getByText("$48,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$96,000.00", { exact: true })).toBeVisible();
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
  await expect(page.getByText("a3f9c2e41b7d5f08c6a92e13b48d70f5e21c9a6b3d84f07a5c1e92b64d38a7f0")).toBeVisible();
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
    page.getByRole("button", { name: "Reduce the amount or free additional liquidity" }),
  ).toBeVisible();
  await expect(page.getByText("twelve-month reserve blocks the first request")).toBeVisible();
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
  await page.goto("/app/demo/decision?scenario=permanent-prohibition&firm=firm-a");
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
  }
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
  await expect(page.getByRole("button", { name: "Request independent verification of the bank instruction" })).toBeVisible();
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

  await page.goto("/app/demo/authority?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByText(/Approved ·/)).toHaveCount(2);
  await page.getByRole("link", { name: "Continue after recorded approvals" }).click();
  await expect(page.getByTestId("voided-approval")).toHaveCount(2);
  await page.getByRole("link", { name: "Re-evaluate with current evidence" }).click();
  await expect(page.getByTestId("derived-decision")).toBeVisible();
  await expect(page.getByText("$237,000.00", { exact: true })).toBeVisible();
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

  await page.goto("/app/demo/record?scenario=approval-invalidation&firm=firm-a");
  const lifecycle = page.getByTestId("signed-lifecycle-event");
  await expect(lifecycle).toHaveCount(13);
  await expect(page.getByTestId("decision-binding")).toHaveCount(2);
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

  await page.goto("/app/demo/policy-authoring?scenario=approval-invalidation&firm=firm-a");
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
