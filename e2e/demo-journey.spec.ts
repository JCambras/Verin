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

  // 3 - Evidence: sources, observed vs retrieved, an explicit gap row.
  await page.getByRole("link", { name: "Gather evidence" }).click();
  await expect(page.getByTestId("evidence-missing")).toBeVisible();
  await expect(page.getByText("retrieved Jul 26, 09:14").first()).toBeVisible();
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

  // 6 - Authority: dual approval + specialist review; requester cannot approve.
  await page.getByRole("link", { name: "Continue to authority" }).click();
  await expect(page.getByText("Dual operations approval").first()).toBeVisible();
  await expect(page.getByText("Bank-instruction specialist review").first()).toBeVisible();
  await expect(page.getByText("the requester cannot approve")).toBeVisible();
  await expect(page.getByText(/Approval binds to decision/)).toBeVisible();
  await checkAxe(page, "authority");
  await snap(page, 6, "authority");

  // 7 - Safety: revalidation, reservation + idempotency inspectable.
  await page.getByRole("link", { name: "Approve this movement" }).click();
  await expect(page.getByText("Material evidence re-checked")).toBeVisible();
  await page.getByRole("button", { name: "Verify source" }).click();
  await expect(page.getByText("mm-smiths-renovation-aug15-4c7f").first()).toBeVisible();
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

  for (const surface of ["workspace", "evidence", "decision", "authority"]) {
    await page.goto(`/app/demo/${surface}?scenario=approval-invalidation&firm=firm-a`);
    await expect(page.getByText("$15,000.00", { exact: true })).toHaveCount(0);
  }
  await page.goto("/app/demo/safety?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByTestId("voided-approval")).toBeVisible();
  await expect(page.getByText("Approval voided - evidence changed").first()).toBeVisible();
  await expect(page.getByTestId("what-changed")).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$15,000.00", { exact: true })).toBeVisible();
  const changedText = await page.getByTestId("what-changed").innerText();
  expect(changedText.indexOf("Initial decision")).toBeLessThan(changedText.indexOf("Pre-execution revalidation"));
  await expect(page.getByRole("link", { name: "Re-evaluate with current evidence" })).toBeVisible();
  await checkAxe(page, "safety-invalidation");
  await snap(page, 15, "safety-invalidation");
  await page.goto("/app/demo/record?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByText("$15,000.00", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/demo/workspace?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByText("$15,000.00", { exact: true })).toHaveCount(0);
  await page.goto("/app/demo/safety?scenario=approval-invalidation&firm=firm-a");
  await expect(page.getByText("$15,000.00", { exact: true })).toBeVisible();
  await checkAxe(page, "safety-invalidation-mobile");
  await snap(page, 19, "safety-invalidation-mobile");
  await page.setViewportSize({ width: 1280, height: 720 });

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

  await page.goto("/app/demo/authority?scenario=specialist-review-expiration&firm=firm-a");
  await expect(page.getByText("Escalated, then expired")).toBeVisible();
  await expect(page.getByText("escalated to the operations manager, then expired unresolved")).toBeVisible();
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
