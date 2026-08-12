/**
 * WHAT THE DEMO SHOWS WHEN THE CONFIGURED VOCABULARY CANNOT BE RESOLVED (D-251).
 *
 * The station page renders on the SERVER, and the labels it shows are read from a
 * published domain configuration at request time. Removing that document must
 * break this journey - that is the X-9 honesty check, and inventing labels would
 * be the dead-configuration failure prompt 10 exists to prevent - but it must
 * break it VISIBLY, as a rendered state, never as a stack trace.
 *
 * The copy carries NO deployment internals (D-243): no document path, file name,
 * version or hash. What it does carry is the refusal's own correlation reference,
 * which the operator's log line carries too - the one thing a person staring at
 * this screen can hand over so the diagnosis can be found under it. A refusal that
 * minted no reference (an unrecorded demo branch) simply shows none rather than an
 * empty label.
 */
import type { AppError } from "@contracts/errors";
import { EmptyState } from "@app/presentation/ui";
import { SurfaceShell } from "./shared";

export function DemoUnavailable({ error }: { error: AppError }) {
  const reference = error.context?.["correlationId"];
  return (
    <SurfaceShell
      title="This journey cannot be shown"
      description="The demo reads its vocabulary from a published configuration, and this deployment cannot supply it."
    >
      <EmptyState
        title="Configured vocabulary unavailable"
        description={
          typeof reference === "string" && reference.length > 0
            ? `Nothing was lost. Your operations team must restore this deployment; quote reference ${reference}.`
            : "Nothing was lost. Your operations team must restore this deployment."
        }
      />
    </SurfaceShell>
  );
}
