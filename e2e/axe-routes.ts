import { DEMO_SURFACES } from "../src/app/demo/surface-contract";

export interface AxeRoute {
  readonly path: string;
  readonly readySelector: string;
}

function axeRoute(path: string, readySelector: string): AxeRoute {
  return Object.freeze({ path, readySelector });
}

export const PUBLIC_AXE_ROUTES = Object.freeze([
  axeRoute("/", "h1"),
] satisfies readonly AxeRoute[]);

export const LOGIN_AXE_ROUTES = Object.freeze([
  axeRoute("/login", "#email"),
] satisfies readonly AxeRoute[]);

export const AUTHENTICATED_AXE_ROUTES = Object.freeze([
  axeRoute("/app", "main h1"),
  axeRoute("/app/account-opening", 'input[name="householdName"]'),
  axeRoute("/app/console", '[data-testid="household-list"]'),
  axeRoute("/app/audit", '[data-testid="audit-verdict"]'),
] satisfies readonly AxeRoute[]);

export const DEMO_AXE_ROUTES = Object.freeze([
  axeRoute("/app/demo", "[data-demo-launcher]"),
  ...DEMO_SURFACES.map((surface) =>
    axeRoute(
      `/app/demo/${surface.station}?scenario=recent-bank-change-block&firm=firm-a`,
      `[data-demo-surface="${surface.station}"]`,
    ),
  ),
] satisfies readonly AxeRoute[]);
