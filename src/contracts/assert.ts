/**
 * Programmer-error assertions (ADR-0002: exceptions are reserved for programmer
 * errors and system boundaries; business logic returns Result). Lives in
 * contracts so domain/infrastructure never need a bare `throw new Error(` (the
 * no-bare-throw fence). Use for "this cannot happen unless the caller is buggy".
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`invariant violated: ${message}`);
}
