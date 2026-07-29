import { DEMO_SURFACES } from "../src/app/demo/surface-contract";

export interface AxeRoute {
  readonly path: string;
  readonly readySelector: string;
}

export const PUBLIC_AXE_ROUTES = [
  { path: "/", readySelector: "h1" },
] as const satisfies readonly AxeRoute[];

export const LOGIN_AXE_ROUTES = [
  { path: "/login", readySelector: "#email" },
] as const satisfies readonly AxeRoute[];

export const AUTHENTICATED_AXE_ROUTES = [
  { path: "/app", readySelector: "main h1" },
  {
    path: "/app/account-opening",
    readySelector: 'input[name="householdName"]',
  },
  { path: "/app/console", readySelector: '[data-testid="household-list"]' },
  { path: "/app/audit", readySelector: '[data-testid="audit-verdict"]' },
] as const satisfies readonly AxeRoute[];

export const DEMO_AXE_ROUTES = [
  {
    path: "/app/demo",
    readySelector: "[data-demo-launcher]",
  },
  ...DEMO_SURFACES.map((surface) => ({
    path: `/app/demo/${surface.station}?scenario=recent-bank-change-block&firm=firm-a`,
    readySelector: `[data-demo-surface="${surface.station}"]`,
  })),
] as const satisfies readonly AxeRoute[];
