import { test, expect } from "@playwright/test";
import { login, PRINCIPAL } from "./helpers";

/**
 * The dynamic demo route accepts only the stations in DEMO_SEQUENCE: an unknown
 * station segment 404s instead of rendering a stray surface.
 */
test("unknown demo stations 404 instead of rendering a surface", async ({ page }) => {
  await login(page, PRINCIPAL);
  const unknownStation = await page.goto("/app/demo/not-a-station");
  expect(unknownStation?.status()).toBe(404);
});
