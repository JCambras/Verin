import { appError } from "@contracts/errors";
import { safeReason } from "@infra/observability/safe-reason";

type MigrationStage =
  | "ledger-bootstrap"
  | "applied-version-read"
  | "virginity-check"
  | "preflight"
  | "mutation";

interface MigrationIdentity {
  readonly version: number;
  readonly name: string;
}

export function migrationFailure(
  stage: MigrationStage,
  cause: unknown,
  migration?: MigrationIdentity,
) {
  const category = safeReason(cause);
  const identity = migration ? `migration ${migration.version} (${migration.name})` : "migration ledger";
  const outcome = stage === "mutation" ? "failed and was rolled back" : `${stage} failed`;
  return appError("INTERNAL", `${identity} ${outcome} (${category})`, {
    stage,
    category,
    ...(migration ? { version: migration.version, name: migration.name } : {}),
  });
}
