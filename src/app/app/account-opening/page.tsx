/**
 * The shipped account-opening screen, RENDERED FROM CONFIGURATION (v3 prompt
 * 10; ADR-0057).
 *
 * This server component reads the published `account-opening` domain
 * configuration and hands the client journey its intake form. There is no
 * fallback field list: if the configuration is missing, invalid, or has drifted
 * from its pinned hash, this page says so and renders no form - which is what
 * makes the configuration load-bearing rather than decorative (the X-9 honesty
 * check). The same failure stops the POST route, so a half-working screen is
 * not reachable either.
 */
import { ACCOUNT_OPENING_DOMAIN, loadIntakeForm } from "@infra/config/domain-config-source";
import { IntakeJourney } from "./intake-journey";

export const runtime = "nodejs";

export default function AccountOpeningPage() {
  const view = loadIntakeForm(ACCOUNT_OPENING_DOMAIN);
  if (!view.ok) {
    // A USER-FACING SCREEN NAMES NO DEPLOYMENT INTERNALS (D-243). This used to
    // tell an advisor to restore a YAML path they have no access to and cannot
    // act on, and gave them nothing to quote to operations. The reference is the
    // one the refusal's own log line carries, so the person staring at the
    // failure can hand it over and an operator finds the diagnosis under it.
    const reference = view.error.context?.["correlationId"];
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Open an account</h1>
        <p role="alert" className="text-sm text-destructive">
          This deployment is not currently able to start account openings, so no application can be
          created. Your operations team must restore it.
          {reference === undefined ? null : <> Quote reference <code>{String(reference)}</code>.</>}
        </p>
      </div>
    );
  }
  return <IntakeJourney view={view.value} />;
}
