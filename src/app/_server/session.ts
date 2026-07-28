/**
 * ONE read-only session resolution per request.
 *
 * The /app layout guard and any server component below it ask the same question of
 * the same cookie. PGlite is single-connection and every op is serialized behind a
 * mutex, so a second lookup is a second serialized round-trip - and two reads of a
 * mutable row can in principle disagree. React's `cache()` memoizes per request, so
 * both call sites share one answer.
 *
 * READ-ONLY on purpose: this is the `resolveSession` path (ADR-0008, D-030). Sliding
 * renewal and id rotation live ONLY in `requirePrincipal`, which is reachable from a
 * Route Handler or Server Action - a Server Component cannot write the rotated cookie
 * and would throw.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { getDb } from "@infra/store/db";
import { resolveSession, SESSION_COOKIE } from "@infra/identity/session";
import type { Result } from "@contracts/result";
import type { AppError } from "@contracts/errors";
import type { Principal } from "@contracts/principal";

export const currentSession = cache(
  async (): Promise<Result<Principal, AppError>> =>
    resolveSession(await getDb(), (await cookies()).get(SESSION_COOKIE)?.value),
);
