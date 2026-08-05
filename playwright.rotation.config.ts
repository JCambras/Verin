import { createE2eConfig } from "./playwright.config";

const PORT = Number(process.env.VERIN_E2E_ROTATION_PORT ?? 3101);

export default createE2eConfig({
  port: PORT,
  dataDirectory: ".verin-data-e2e-rotation",
  sessionTtlMinutes: "1",
  suiteName: "session-rotation",
  testMatch: /session-rotation\.spec\.ts/,
});
