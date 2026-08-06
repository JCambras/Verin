import { test, expect, type Page } from "@playwright/test";
import { ROTATION_SESSION_TTL_MINUTES } from "../playwright.config";
import { login, PRINCIPAL } from "./helpers";

const TTL_MS = ROTATION_SESSION_TTL_MINUTES * 60_000;
/** `resolveAndRenewSession` slides a session once it passes the halfway mark of its
 * TTL (RENEW_WHEN_REMAINING_FRACTION). */
const RENEW_WHEN_REMAINING_FRACTION = 0.5;

async function sessionCookie(page: Page) {
  const cookie = (await page.context().cookies()).find(
    (candidate) => candidate.name === "verin_session",
  );
  if (!cookie) throw new Error("no verin_session cookie is set");
  return cookie;
}

/**
 * Wait until the CURRENT session has actually crossed its renewal half-life, read
 * from the cookie the server just issued rather than from a hand-tuned sleep. The
 * probe returns the moment the window opens, and a session that never opens one
 * fails loudly instead of passing on a sleep that happened to be long enough.
 */
async function waitForRenewalWindow(page: Page): Promise<void> {
  const cookie = await sessionCookie(page);
  expect(
    cookie.expires,
    "the session cookie must carry a server-issued expiry",
  ).toBeGreaterThan(0);
  const renewsAtMs =
    cookie.expires * 1000 - TTL_MS * RENEW_WHEN_REMAINING_FRACTION;
  await expect
    .poll(() => Date.now() >= renewsAtMs, {
      timeout: TTL_MS,
      intervals: [250],
    })
    .toBe(true);
}

test("session rotation preserves setup state only within the same login lineage", async ({
  page,
}) => {
  test.setTimeout(TTL_MS * 2 + 60_000);
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
  const cookieBeforeAttestationRotation = (await sessionCookie(page)).value;

  await waitForRenewalWindow(page);
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
  const cookieAfterAttestationRotation = (await sessionCookie(page)).value;
  expect(cookieAfterAttestationRotation).not.toBe(
    cookieBeforeAttestationRotation,
  );

  await waitForRenewalWindow(page);
  const renewed = await page.goto("/api/me");
  expect(renewed?.status()).toBe(200);
  const cookieAfterSnapshotRotation = (await sessionCookie(page)).value;
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
