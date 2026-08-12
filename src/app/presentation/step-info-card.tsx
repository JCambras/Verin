/**
 * StepInfoCard — contextual teaching (ADR-0012; Meridian StepInfoCard). "Step N of
 * M" + why this step exists. Ships LIVE in the account-opening flow.
 */
import { Card } from "./ui";

export function StepInfoCard({ stepNumber, totalSteps, title, body }: { stepNumber: number; totalSteps: number; title: string; body: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">
        Step {stepNumber} of {totalSteps}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
    </Card>
  );
}
