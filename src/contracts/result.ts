/**
 * Result<T, E> — explicit success/failure, no thrown exceptions in business logic
 * (charter alignment with Iris ADR-0003). Every error path is visible in the type
 * signature. Exceptions are reserved for programmer errors and system boundaries.
 */
import type { AppError } from "./errors";

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = AppError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/**
 * Unwrap a Result, throwing on error. ONLY for system boundaries and tests —
 * never in business logic (that is what the type is for).
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap() called on Err: ${JSON.stringify(r.error)}`);
}

export function map<T, U, E>(r: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}
