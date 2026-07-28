import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { login, PRINCIPAL } from "./helpers";

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1100 },
] as const;

/** `choiceInputs` records whether the step renders radio/checkbox controls, so the
 * 44px label check below fails loudly instead of passing on an empty match set
 * (charter #4: detection is not verification). */
const STEPS = [
  { id: "profiles", heading: "Start with the policy, not the request", action: "Continue with both firms", choiceInputs: false },
  { id: "controls", heading: "Confirm the controls no firm can weaken", action: "Confirm required controls", choiceInputs: false },
  { id: "posture", heading: "Begin conservatively, then make differences explicit", action: "Use this starting posture", choiceInputs: false },
  { id: "choices", heading: "Tune only the decisions that can legitimately differ", action: "Review signed impact", choiceInputs: true },
  { id: "impact", heading: "See the impact on signed examples", action: "Send for approval", choiceInputs: false },
  { id: "activation", heading: "A different human acknowledges immutable versions", action: "Acknowledge and activate demonstration", choiceInputs: true },
  { id: "request", heading: "Run the Smiths request under both profiles", action: "Run under both profiles", choiceInputs: false },
  { id: "outcomes", heading: "Identical facts, different correct outcomes", action: "View complete proof trail", choiceInputs: false },
  { id: "proof", heading: "Every outcome has a proof trail", action: "Export decision record", choiceInputs: false },
] as const;

async function settle(page: Page) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
}

async function assertAxe(page: Page, label: string) {
  await settle(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(blocking.map((violation) => `${label}:${violation.id}`), JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function assertNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
}

async function assertReachableTargets(page: Page, expectChoiceInputs: boolean) {
  const actions = page.locator("a[href], button");
  for (let index = 0; index < await actions.count(); index += 1) {
    const action = actions.nth(index);
    if (!(await action.isVisible())) continue;
    const box = await action.boundingBox();
    expect(box, `visible action ${index} must have a box`).not.toBeNull();
    expect(box!.width, `action ${index} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `action ${index} height`).toBeGreaterThanOrEqual(44);
  }

  const inputs = page
    .getByTestId("setup-journey")
    .locator('input[type="radio"], input[type="checkbox"]');
  const inputCount = await inputs.count();
  expect(inputCount > 0, `step renders ${inputCount} choice inputs`).toBe(expectChoiceInputs);
  for (let index = 0; index < inputCount; index += 1) {
    const input = inputs.nth(index);
    if (!(await input.isVisible())) continue;
    const id = await input.getAttribute("id");
    const label = id
      ? page.locator(`label[for="${id}"]`)
      : input.locator("xpath=ancestor::label");
    const box = await label.boundingBox();
    expect(box, `input ${index} must have a reachable label`).not.toBeNull();
    expect(box!.width, `input label ${index} width`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `input label ${index} height`).toBeGreaterThanOrEqual(44);
  }
}

async function assertActionClearance(page: Page) {
  const actionRow = page.getByTestId("setup-action-row");
  const clearance = await actionRow.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      paddingBottom: Number.parseFloat(style.paddingBottom),
      position: style.position,
    };
  });
  expect(clearance.paddingBottom).toBeGreaterThanOrEqual(24);
  expect(["fixed", "sticky"]).not.toContain(clearance.position);
}

async function capture(page: Page, width: number, index: number, stepId: string) {
  await settle(page);
  const directory = `demo-screens/setup/${width}`;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: `${directory}/${String(index + 1).padStart(2, "0")}-${stepId}.png`,
    fullPage: true,
  });
}

async function walkSetup(page: Page, width: number) {
  await page.goto("/app/demo/setup");
  for (let index = 0; index < STEPS.length; index += 1) {
    const step = STEPS[index]!;
    await expect(page.getByRole("heading", { level: 1, name: step.heading })).toBeVisible();
    await assertNoPageOverflow(page);
    await assertReachableTargets(page, step.choiceInputs);
    await assertActionClearance(page);
    await assertAxe(page, `${width}-${step.id}`);

    if (step.id === "choices") {
      await expect(page.getByTestId("policy-group-bank-change")).toContainText(
        "Specialist review, then normal authority",
      );
      await expect(page.getByTestId("requester-awaiting-decision")).toBeVisible();
    }
    if (step.id === "activation") {
      await page.getByRole("checkbox").check();
    }
    if (step.id === "outcomes") {
      await expect(page.getByRole("table")).toHaveCount(0);
      const order = await page.evaluate(() => {
        const question = document.querySelector('[data-testid="outcome-question"]')!;
        const firmA = document.querySelector('[data-testid="outcome-firm-a"]')!;
        const firmB = document.querySelector('[data-testid="outcome-firm-b"]')!;
        return [
          question.compareDocumentPosition(firmA) & Node.DOCUMENT_POSITION_FOLLOWING,
          firmA.compareDocumentPosition(firmB) & Node.DOCUMENT_POSITION_FOLLOWING,
        ];
      });
      expect(order).toEqual([4, 4]);
      await expect(page.getByTestId("outcome-firm-a")).toContainText("Firm A");
      await expect(page.getByTestId("outcome-firm-b")).toContainText("Firm B");
    }

    await capture(page, width, index, step.id);
    if (index < STEPS.length - 1) {
      await page.getByRole("button", { name: step.action }).click();
    }
  }
}

test("every primary setup step passes responsive, overflow, target, axe, and screenshot proof", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page, PRINCIPAL);
  for (const viewport of WIDTHS) {
    await page.setViewportSize(viewport);
    await walkSetup(page, viewport.width);
  }
});

test("the full setup journey is keyboard operable and announces activation errors", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.goto("/app/demo/setup");

  for (const step of STEPS.slice(0, 3)) {
    const action = page.getByRole("button", { name: step.action });
    await action.focus();
    await page.keyboard.press("Enter");
  }

  const alternateReserve = page
    .getByTestId("choice-reserve-firm-a")
    .getByRole("radio", { name: /9 months/ });
  await alternateReserve.focus();
  await page.keyboard.press("Space");
  await expect(alternateReserve).toBeChecked();

  for (const step of STEPS.slice(3, 5)) {
    const action = page.getByRole("button", { name: step.action });
    await action.focus();
    await page.keyboard.press("Enter");
  }

  const activate = page.getByRole("button", { name: STEPS[5].action });
  await activate.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Confirm the distinct-human" })).toBeVisible();

  const attestation = page.getByRole("checkbox");
  await attestation.focus();
  await page.keyboard.press("Space");
  await expect(attestation).toBeChecked();
  await activate.focus();
  await page.keyboard.press("Enter");

  for (const step of STEPS.slice(6, 8)) {
    const action = page.getByRole("button", { name: step.action });
    await action.focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("heading", { name: STEPS[8].heading })).toBeVisible();
  const exportButton = page.getByRole("button", { name: STEPS[8].action });
  await exportButton.focus();
  await expect(exportButton).toBeFocused();
});

test("200 percent text, reduced motion, and software-keyboard posture stay safe", async ({ page }) => {
  await login(page, PRINCIPAL);
  await page.setViewportSize(WIDTHS[0]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app/demo/setup");

  const duration = await page.getByTestId("setup-journey").evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).animationDuration) * 1000,
  );
  expect(duration).toBeLessThanOrEqual(0.001);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await assertNoPageOverflow(page);
  await expect(page.getByRole("heading", { name: STEPS[0].heading })).toBeVisible();

  for (const step of STEPS.slice(0, 5)) {
    await page.getByRole("button", { name: step.action }).click();
  }
  await expect(page.locator('input:not([type="checkbox"]):not([type="radio"])')).toHaveCount(0);
  const checkbox = page.getByRole("checkbox");
  await checkbox.focus();
  await checkbox.scrollIntoViewIfNeeded();
  await assertNoPageOverflow(page);
  await assertActionClearance(page);
  await expect(page.getByTestId("setup-action-row")).toBeVisible();
});
