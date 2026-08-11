/**
 * The shipped account-opening screen, RENDERED FROM CONFIGURATION (v3 prompt
 * 10; ADR-0056).
 *
 * This server component reads the published `account-opening` domain
 * configuration and hands the client journey its intake form. There is no
 * fallback field list: if the configuration is missing, invalid, or has drifted
 * from its pinned hash, this page says so and renders no form - which is what
 * makes the configuration load-bearing rather than decorative (the X-9 honesty
 * check). The same failure stops the POST route, so a half-working screen is
 * not reachable either.
 */
import { loadIntakeForm } from "@infra/config/domain-config-source";
import { ACCOUNT_OPENING_DOMAIN } from "@infra/wire";
import { IntakeJourney } from "./intake-journey";

export const runtime = "nodejs";

export default function AccountOpeningPage() {
  const view = loadIntakeForm(ACCOUNT_OPENING_DOMAIN);
  if (!view.ok) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Open an account</h1>
        <p role="alert" className="text-sm text-destructive">
          This flow is configuration-driven and its published configuration could not be loaded, so no
          application can be started. Restore <code>config/domains/account-opening.yaml</code> and reload.
        </p>
      </div>
    );
  }
  return <IntakeJourney view={view.value} />;
}
