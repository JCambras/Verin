import { test, expect } from "@playwright/test";
import { login, PRINCIPAL } from "./helpers";

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
