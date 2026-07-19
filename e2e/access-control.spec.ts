import { test, expect } from "@playwright/test";
import { login, ADVISOR } from "./helpers";

/**
 * FAILURE / INTERRUPTION path (charter #8: every flow ships a failure-path spec).
 * The falsifier's attacks, as browser/API assertions:
 *  - unauthenticated mutation is rejected (auth-enforcement, charter #12);
 *  - a forged e-sign webhook is rejected (STRIDE T-S3, charter #16);
 *  - RBAC denies a base advisor the compliance-only audit trail (charter #12);
 *  - a bad login shows a friendly, non-enumerating error.
 */

test("unauthenticated account-opening API is rejected (401)", async ({ request }) => {
  const res = await request.post("/api/flows/account-opening", {
    data: { householdName: "X", firstName: "A", lastName: "B", accountType: "individual" },
  });
  expect(res.status()).toBe(401);
});

test("a forged e-sign webhook (bad signature) is rejected (401)", async ({ request }) => {
  const res = await request.post("/api/esign/webhook", {
    data: { token: "any-token", signature: "deadbeef-not-a-valid-hmac" },
  });
  expect(res.status()).toBe(401);
});

test("RBAC: a base advisor is forbidden from the audit trail (403)", async ({ page }) => {
  await login(page, ADVISOR);

  // The audit page (in the browser, carrying the advisor's session cookie) fetches
  // /api/audit and is denied on ROLE, showing the permission notice — server-side
  // RBAC at the boundary, not merely authentication.
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/audit")),
    page.goto("/app/audit"),
  ]);
  expect(res.status()).toBe(403);
  await expect(page.getByText(/do not have permission/i)).toBeVisible();
});

test("a wrong password shows a friendly error (no user enumeration)", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("principal@verin.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
});

test("an UNKNOWN email shows the same friendly error (constant-work branch, no enumeration)", async ({ page }) => {
  // Exercises the unknown-email failure branch end-to-end: the discarded
  // audit-pipeline mirror must run without surfacing an error to the user.
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@verin.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
});
