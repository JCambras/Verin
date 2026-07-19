# ADR-0002: Result<T,E> over thrown exceptions, with a typed AppError taxonomy

**Status:** Accepted
**Date:** 2026-07-18
**Deciders:** Founding architect
**Relates to:** Charter non-negotiable #1
**Informed by:** retro-r7 do-again #30; don't-again #14 (error-message info-leak fixed three times because routes returned `error.message` raw)

## Context

Meridian threw and try/caught ad hoc; error paths were invisible in type signatures and sanitization was
routed around three separate times, leaking internal detail. Iris moved to `Result<T,E>` with a typed
taxonomy so "every error path is visible in the type signature."

## Decision

Business logic returns `Result<T, E = AppError>` (`src/contracts/result.ts`) and never throws. `AppError`
(`src/contracts/errors.ts`) is a code + safe sentence-form message + optional non-PII context; each code
maps to `{status, logLevel, category, retryable}`. `toResponse()` produces the client body — code +
message only, never a stack trace or internal context. Adapter boundaries MAY throw a *typed* `AppError`
(never a bare `Error` — the no-bare-throw fence, Phase B); the HTTP boundary catches and maps via
`isAppError()`. `unwrap()` exists only for system boundaries and tests.

## Alternatives Rejected

| Alternative | Why Rejected |
|-------------|--------------|
| Thrown exceptions + try/catch (Meridian) | Error paths invisible in types; sanitization repeatedly bypassed. |
| A third-party Result library | A ~20-line contract with no dependency is simpler and dependency-free (supply chain). |

## Trade-offs and Costs

- **Gained:** exhaustive, typed error handling; a single client-safe response mapper; no info leaks by construction.
- **Sacrificed:** some `Result` threading boilerplate vs. throwing.

## Consequences

Sentence-form messages are doctrine (brand voice: "Salesforce didn't respond", not "Error 502"). The
no-bare-throw-in-CRM-path fence enforces typed throws at the adapter boundary.

## Revisit When

Result threading produces measurable, repeated boilerplate pain, or the platform moves to a language with
native result types.
