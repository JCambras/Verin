/**
 * The in-process registry of ACTIVATED setup snapshots (F1). A snapshot is immutable
 * once activated, so this only ever hands back the exact frozen object the activation
 * produced - it never rebuilds, recomputes, or substitutes one.
 *
 * Two properties the registry itself must carry:
 *  - BOUNDED. Every distinct selection combination produces a distinct snapshot, so an
 *    unbounded map lets repeated activation grow memory without limit. Entries expire
 *    (TTL) and each principal keeps only the most recent few (LRU).
 *  - SCOPED. A snapshot is readable only by the principal that activated it: a snapshot
 *    hash is not a capability, and one org must never read another's activation.
 *
 * A miss - evicted, expired, another principal, another server instance, or a restart -
 * is a FAILURE, never a fallback: the caller must fail closed and name what is
 * unavailable rather than recompute an outcome or borrow a signed record.
 */
import type { Role } from "@contracts/roles";
import type { SetupActivatedSnapshotVM } from "./setup-model";

/** Long enough to walk the journey from activation to export, short enough that an
 * abandoned rehearsal does not retain a snapshot for the life of the process. */
export const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
/** A presenter re-activates while tuning choices; only the newest few are reachable. */
export const SNAPSHOTS_PER_PRINCIPAL = 8;
/** A bound on concurrently-remembered principals, so the outer map cannot grow either. */
const MAX_PRINCIPALS = 64;
const ACTIVATION_TOKEN = /^[a-f0-9]{64}$/;

export function isSetupActivationToken(value: string): boolean {
  return ACTIVATION_TOKEN.test(value);
}

/** Who activated a snapshot. Resolved server-side from the session, never from a
 * query string or a request body (charter #7/#12). */
export interface SetupActivationScope {
  readonly orgId: string;
  readonly userId: string;
  readonly sessionLineageId: string;
  readonly role: Role;
}

interface StoredSnapshot {
  readonly snapshot: SetupActivatedSnapshotVM;
  readonly expiresAt: number;
}

const shared = globalThis as typeof globalThis & {
  __verinSetupActivationSnapshots?: Map<string, Map<string, StoredSnapshot>>;
};

/** Cached on globalThis, not a module-local: Next bundles route handlers and server
 * components separately, so a module-local map would give the Server Action and the
 * record page two different registries. */
function byPrincipal(): Map<string, Map<string, StoredSnapshot>> {
  shared.__verinSetupActivationSnapshots ??= new Map();
  return shared.__verinSetupActivationSnapshots;
}

function scopeKey(scope: SetupActivationScope): string {
  return JSON.stringify([
    scope.orgId,
    scope.userId,
    scope.sessionLineageId,
    scope.role,
  ]);
}

/** Map iteration order is insertion order, so re-inserting a key makes it the most
 * recently used and `keys().next()` yields the least recently used. */
function touch<K, V>(map: Map<K, V>, key: K, value: V, limit: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function dropExpired(entries: Map<string, StoredSnapshot>, now: number): void {
  for (const [hash, stored] of entries) {
    if (stored.expiresAt <= now) entries.delete(hash);
  }
}

export function registerActivatedSetupSnapshot(
  scope: SetupActivationScope,
  snapshot: SetupActivatedSnapshotVM,
): void {
  if (!isSetupActivationToken(snapshot.snapshotHash)) {
    throw new Error("Activated setup snapshot has an invalid token");
  }
  const now = Date.now();
  const key = scopeKey(scope);
  const entries = byPrincipal().get(key) ?? new Map<string, StoredSnapshot>();
  dropExpired(entries, now);
  touch(
    entries,
    snapshot.snapshotHash,
    { snapshot, expiresAt: now + SNAPSHOT_TTL_MS },
    SNAPSHOTS_PER_PRINCIPAL,
  );
  touch(byPrincipal(), key, entries, MAX_PRINCIPALS);
}

/** The frozen snapshot this principal activated under `snapshotHash`, or null. Null is
 * the only miss signal: the caller fails closed on it. */
export function activatedSetupSnapshot(
  scope: SetupActivationScope,
  snapshotHash: string,
): SetupActivatedSnapshotVM | null {
  if (!isSetupActivationToken(snapshotHash)) return null;
  const now = Date.now();
  const key = scopeKey(scope);
  const entries = byPrincipal().get(key);
  if (!entries) return null;
  dropExpired(entries, now);
  const stored = entries.get(snapshotHash);
  if (!stored) {
    if (entries.size === 0) byPrincipal().delete(key);
    return null;
  }
  touch(entries, snapshotHash, stored, SNAPSHOTS_PER_PRINCIPAL);
  touch(byPrincipal(), key, entries, MAX_PRINCIPALS);
  return stored.snapshot;
}
