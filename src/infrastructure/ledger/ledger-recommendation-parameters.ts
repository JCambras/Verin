import { SubjectRefSchema } from "@contracts/decision-core/v1-7/ids";
import { hasSensitiveAccountReference } from "@contracts/pii";

type ParameterSchema = (value: unknown) => boolean;

const PARAMETER_SCHEMAS = new Map<string, ParameterSchema>([
  ["amountUsd", (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= Number.MAX_SAFE_INTEGER / 100 &&
    !hasSensitiveAccountReference(value)],
  ["sourceSubject", (value) => SubjectRefSchema.safeParse(value).success],
]);

export function isRegisteredLedgerRecommendationParameter(
  key: string,
  value: unknown,
): boolean {
  return PARAMETER_SCHEMAS.get(key)?.(value) === true;
}
