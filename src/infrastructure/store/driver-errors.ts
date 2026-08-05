/**
 * Driver-failure classification, shared by every write chokepoint. Mapping all
 * failures to one code destroys the diagnosis (a swallowed TypeError once surfaced as
 * a generic 409), so each chokepoint logs the real error PII-safely and only a real
 * SQLSTATE integrity violation becomes the client-resolvable conflict.
 */
import { classifyErrorMetadata } from "@infra/observability/safe-reason";

/**
 * Driver/exception text can quote row values (a unique-violation detail may embed an
 * email); the pino redaction is field-NAME-based and cannot see into free text, so a
 * PII-shaped reason is replaced wholesale before it reaches the log.
 */
export function classifyStoreFailure(e: unknown) {
  const metadata = classifyErrorMetadata(e);
  return Object.freeze({
    appError: metadata.appError,
    constraint: metadata.sqlState?.startsWith("23") ?? false,
    reason: metadata.reason,
  });
}
