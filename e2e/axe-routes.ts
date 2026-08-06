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
  axeRoute("/app/console", '[data-testid="household-count"]'),
  axeRoute("/app/audit", '[data-testid="audit-verdict"]'),
] satisfies readonly AxeRoute[]);

export const DEMO_AXE_ROUTES = Object.freeze([
  axeRoute("/app/demo", "[data-demo-launcher]"),
  axeRoute(
    "/app/demo/workspace?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="workspace"]',
  ),
  axeRoute(
    "/app/demo/intent?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="intent"]',
  ),
  axeRoute(
    "/app/demo/evidence?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="evidence"]',
  ),
  axeRoute(
    "/app/demo/decision?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="decision"]',
  ),
  axeRoute(
    "/app/demo/policy-trace?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="policy-trace"]',
  ),
  axeRoute(
    "/app/demo/authority?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="authority"]',
  ),
  axeRoute(
    "/app/demo/safety?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="safety"]',
  ),
  axeRoute(
    "/app/demo/execution?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="execution"]',
  ),
  axeRoute(
    "/app/demo/verification?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="verification"]',
  ),
  axeRoute(
    "/app/demo/comparison?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="comparison"]',
  ),
  axeRoute(
    "/app/demo/policy-authoring?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="policy-authoring"]',
  ),
  axeRoute(
    "/app/demo/record?scenario=recent-bank-change-block&firm=firm-a",
    '[data-demo-surface="record"]',
  ),
] satisfies readonly AxeRoute[]);
