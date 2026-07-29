import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function assertNoAxeViolations(page: Page, context: string): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations, `${context}\n${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
}
