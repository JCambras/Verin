import { randomBytes } from "node:crypto";
import type { Role } from "@contracts/roles";
import {
  SETUP_ATTESTATION_STATEMENT_VERSION,
  type SetupAttestationChallengeVM,
} from "./setup-model";
import type { SetupActivationCommand } from "./setup-activation-contract";

export const SETUP_ATTESTATION_TTL_MS = 5 * 60 * 1000;
const ATTESTATIONS_PER_SESSION = 4;
const MAX_SESSIONS = 64;
const ATTESTATION_TOKEN = /^[a-f0-9]{64}$/;

export interface SetupAttestationScope {
  readonly orgId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly role: Role;
}

interface StoredAttestation {
  readonly challenge: SetupAttestationChallengeVM;
  readonly expiresAt: number;
}

const shared = globalThis as typeof globalThis & {
  __verinSetupAttestations?: Map<
    string,
    Map<string, StoredAttestation>
  >;
};

function bySession(): Map<string, Map<string, StoredAttestation>> {
  shared.__verinSetupAttestations ??= new Map();
  return shared.__verinSetupAttestations;
}

function scopeKey(scope: SetupAttestationScope): string {
  return JSON.stringify([
    scope.orgId,
    scope.userId,
    scope.sessionId,
    scope.role,
  ]);
}

function trimOldest<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function dropExpired(
  entries: Map<string, StoredAttestation>,
  now: number,
): void {
  for (const [token, stored] of entries) {
    if (stored.expiresAt <= now) entries.delete(token);
  }
}

export function issueSetupAttestation(
  scope: SetupAttestationScope,
  draft: {
    readonly generation: number;
    readonly selectionsHash: string;
  },
): SetupAttestationChallengeVM {
  const token = randomBytes(32).toString("hex");
  const challenge: SetupAttestationChallengeVM = Object.freeze({
    token,
    draftGeneration: draft.generation,
    selectionsHash: draft.selectionsHash,
    statementVersion: SETUP_ATTESTATION_STATEMENT_VERSION,
    actor: Object.freeze({
      opaqueId: scope.userId,
      role: scope.role,
    }),
  });
  const key = scopeKey(scope);
  const entries =
    bySession().get(key) ?? new Map<string, StoredAttestation>();
  const now = Date.now();
  dropExpired(entries, now);
  entries.set(token, {
    challenge,
    expiresAt: now + SETUP_ATTESTATION_TTL_MS,
  });
  trimOldest(entries, ATTESTATIONS_PER_SESSION);
  bySession().delete(key);
  bySession().set(key, entries);
  trimOldest(bySession(), MAX_SESSIONS);
  return challenge;
}

export function consumeSetupAttestation(
  scope: SetupAttestationScope,
  command: SetupActivationCommand,
  selectionsHash: string,
): SetupAttestationChallengeVM | null {
  if (!ATTESTATION_TOKEN.test(command.attestationToken)) return null;
  const key = scopeKey(scope);
  const entries = bySession().get(key);
  if (!entries) return null;
  const now = Date.now();
  dropExpired(entries, now);
  const stored = entries.get(command.attestationToken);
  if (!stored) return null;
  entries.delete(command.attestationToken);
  if (entries.size === 0) bySession().delete(key);
  const challenge = stored.challenge;
  if (
    stored.expiresAt <= now ||
    command.statementVersion !==
      SETUP_ATTESTATION_STATEMENT_VERSION ||
    challenge.statementVersion !== command.statementVersion ||
    challenge.draftGeneration !== command.draftGeneration ||
    challenge.selectionsHash !== selectionsHash ||
    challenge.actor.opaqueId !== scope.userId ||
    challenge.actor.role !== scope.role
  ) {
    return null;
  }
  return challenge;
}
