# Verin STRIDE threat model (foundation)

**Owner:** the security red-team persona (`docs/personas/` — maintained, attacked each audit round).
**Scope:** the walking-skeleton foundation — identity/sessions, RBAC/authz at the port, the two
tamper-evident chains (operational audit + decision ledger), the simulated e-sign webhook, the house-CRM
store, and config/secrets. Updated when a new entry point or asset is added. Every High/Critical threat
names a concrete exploit (attacker, entry point, payload, result) and the control + the fence/gate that
enforces it. If a threat has no enforcing mechanism, it is listed as an explicit gap with an owner and
date (never omitted).

## Assets & trust boundaries

- **Identity/session** - session cookie ↔ server-side session record. Read-only callers use
  `resolveSession`; request handlers share one memoized `requirePrincipal` resolution, which may renew and rotate.
- **Authorization** - RBAC checked server-side at the port. Sealed tenant authority and `org_id` predicates
  scope ordinary repository/port calls; exact capability-keyed, pre-auth, and readiness escapes are reviewed.
  A per-action `ActionGrant` gates every governed action (v3 §15).
- **Audit chain** — append-only, hash-chained `audit_log`; the "prove it wasn't edited" asset.
- **Decision ledger** — the sibling append-only, hash-chained `decision_ledger` plus its immutable replay
  sources (`evidence_snapshots`, `decision_input_bundles` + membership, `decision_records`) and per-org
  `decision_ledger_anchor` (ADR-0041). Independent of `audit_log`: a separate chain, a separate anchor, and
  its own L1-L4 verification. The "prove the decision was made on these exact inputs" asset; read-only
  exposure is `/app/ledger` → `/api/ledger` (both `audit.export` and `pii.view`).
- **e-sign webhook** — an unauthenticated-by-network external callback that resumes a suspended flow.
- **House-CRM store** — the system of record (identity PII lives here).
- **Replay-corpus fixtures** - `fixtures/corpus/`: author-invented synthetic cases today, plus a
  captain-gated intake for anonymized real defect history that ships EMPTY (ADR-0052).
- **Populated-world fixtures** - `fixtures/world/`: a hundred generated, labeled-synthetic households
  (ADR-0057). They are EVIDENCE read through `HouseholdWorldSource` under a `pii.view` grant, not house-CRM
  records; the CRM holds only the projected households, people and open items, each stamped
  `record_origin = 'world-fixture'`. The asset here is the boundary: none of it may reach production.
- **Config/secrets** — `SESSION_SECRET`, `ESIGN_WEBHOOK_SECRET`, DB DSN.

Trust boundaries: client → app (never trust client identity/role); app → store (org-scoped); external
e-sign → webhook (verify signature); operator → house-CRM console (RBAC + audited).

## STRIDE analysis

### S — Spoofing
- **T-S1 (High): forge identity by supplying a role/identity header.** *Exploit:* attacker sends
  `x-user-role: principal` or a crafted identity header to a port call. *Control:* identity resolved only
  from the HMAC-signed cookie + server-side session; no client-supplied role/identity is ever trusted
  (ADR-0008). *Fence:* `no-client-role-header`, `auth-enforcement`.
- **T-S2 (High): forge/replay a session cookie.** *Exploit:* attacker crafts or replays a cookie.
  *Control:* cookie HMAC-signed with `SESSION_SECRET`; server-side session record with expiry and a
  revocation list; opaque id rotated on sliding renewal (anti-fixation, ADR-0008). *Fence:* `auth-enforcement`.
- **T-S3 (High): spoof the e-sign webhook.** *Exploit:* attacker POSTs a fake "signed" callback to finalize
  a flow. *Control:* webhook verifies an HMAC signature over the TOKEN with `ESIGN_WEBHOOK_SECRET`
  (`esign.ts` signs the token string alone); the payload is server-constructed (`{ signedAt }`) and never
  trusted — trusted flow state takes precedence over the payload on resume (`engine.ts`), and the resume
  token must match a suspended flow. A real e-sign vendor integration must sign token+payload; until then
  this wording matches the code exactly (no overclaim). *Fence:* webhook-signature test (Phase E).

### T — Tampering
- **T-T1 (Critical): edit/delete an audit record.** *Exploit:* attacker/insider `UPDATE`/`DELETE`s
  `audit_log` to hide an action. *Control:* Postgres append-only triggers (`RAISE EXCEPTION`) + hash chain;
  a scheduled job re-verifies the chain and fails on any break. *Fence:* `audited-write-required`,
  `audit-chain-verify` gate, tampered-chain-detected companion (ADR-0007).
- **T-T2 (High): bypass the audited-write helper.** *Exploit:* a new mutation writes without an audit entry.
  *Control:* the anti-fork fence — a mutation must route through `auditedWrite`, and audit calls may appear
  only inside the helper. *Fence:* `audited-write-required` (+ anti-fork).
- **T-T3 (Medium): SQL injection via inputs.** *Control:* parameterized queries only (every adapter binds
  `$n` placeholders). *Fence:* none yet; an injection-defense fence is an explicit gap (see Gaps).
- **T-T4 (Critical): rewrite decision history or fork a second writer into it.** *Exploit:* an
  attacker/insider `UPDATE`/`DELETE`s `decision_ledger` or an immutable replay source to change what a
  decision was made on, or adds a second `INSERT` path that writes rows the chain never covers.
  *Control:* BEFORE UPDATE/DELETE/TRUNCATE triggers on every immutable source table; an independent
  GENESIS-rooted per-org hash chain whose versioned preimage binds the exact stored payload bytes plus
  producer provenance; content-addressed evidence/bundle/record rows; and one allowlisted raw-INSERT owner
  per table (`ledger-store.ts` for the chain, `ledger-sources.ts` for sources) that holds even when the SQL
  is assembled or the table identifier is dynamic. L1-L4 plus retained replay-source verification runs in
  the `audit-chain-verify` gate over BOTH chains. *Fence:* `ledger-append-only`, `audit-chain-verify` gate
  (ADR-0041). *Residual:* the anchor is unkeyed and co-located with its chain — external witnessing/HMAC is
  the ADR-0007 deferral, whose trigger is production deploy.

### R — Repudiation
- **T-R1 (High): "I didn't make that change."** *Control:* every write records `org_id` + `actor` (threaded
  from the session, never `"system"`) + before/after; the chain proves ordering and integrity. *Fence:*
  `audited-write-required` (actor asserted).

### I — Information disclosure
- **T-I1 (High): PII leaks into logs/audit/API bodies, or into an LLM prompt.** *Control:* PII boundary - scrub
  at the audit boundary and require `pii.view` for governed API reads; logs/traces carry only the closed
  observability vocabulary (an unlisted value degrades to `[REDACTED]`). Record-id fields do not trust
  UUID shape alone: direct cryptographic mints retain sealed generated provenance, while request-derived
  UUIDs become tenant- and field-scoped HMAC digests under a domain-separated secret-derived key; raw
  `console.*` is banned. PII-bearing types carry a `PIIBearing` marker and no such type is import-reachable
  from `src/infrastructure/llm/`; anything projected to a model is `Tokenized<T>`, constructible only through
  the scrubber factory. Request text comes from a reviewed static-template factory whose exact sensitive
  spans are masked, and one separator-aware account classifier drives extraction, masking, and residual
  refusal (ADR-0006, ADR-0031). Immutable ledger rows carry their own fail-closed boundary: a value enters
  only if it is a UUID, a hash, a retained-text reference, or a reviewed identifier, and that recognition
  list — production authority, since a listed string is accepted into a real tenant's chain forever — may
  never be widened by a fixture (test vocabulary enters through the reserved-namespace
  `registerTestLedgerIdentifier` seam). *Fence:* `no-pii-in-audit-store`,
  no-console, `observability-vocabulary`, `llm-pii-boundary`, `tokenized-factory-only`,
  `ledger-pii-vocabulary`.
- **T-I2 (High): cross-tenant read.** *Exploit:* org A reads org B's rows. *Control:* ordinary tenant-row
  queries carry an `org_id` predicate and sealed tenant authority, so an unscoped call cannot compile or
  parse. Exact capability-keyed loads are registered; related rows must agree on organization before work,
  and resume validates its caller context before loading execution state. Ledger links go further: composite
  `(org_id, id)` foreign keys make decision, evidence, membership, and causation references structurally
  same-tenant, so a cross-tenant reference is rejected by the database, not only by a predicate. Pre-auth
  identity and deployment-readiness reads are separately reviewed. *Fence:*
  `org-id-required`, `tenant-context-required` (Phase B; v3 §15.2).
- **T-I3 (Medium): internal error detail leaks to clients.** *Control:* `toResponse` normalizes `unknown`;
  only a factory-authenticated message survives, while a recognized foreign code receives a static
  fallback. Message/context accessors, stacks, and internal context are never returned (ADR-0002).
  A refusal of the published domain configuration goes further, because its own message carried dotted
  document paths and digests to a browser and to the external e-sign provider: it is minted in one shape
  (`ConfiguredRefusal`), the wire gets a generic sentence plus a correlation reference, and the stage,
  code and document location travel to the operator as the registered `configStage`/`configCode`/
  `configPath` log fields, whose admitted shapes derive from what the emitters produce
  (D-256/D-258/D-259/D-262). No deployment internal (document path, file name, environment variable,
  hash, or version id) reaches user-facing copy, static surface literals included.
  *Fence:* `domain-configuration` RULES I-M.
- **T-I4 (High): a secret is committed or a live org domain ships in a doc.** *Control:* gitleaks + the
  no-secret-fallback/no-live-org-domain fence + placeholder-only `.env.example`. *Fence:* `secret-scan`,
  `no-secret-fallback`.
- **T-I5 (High): a config secret leaks into a config dump, log line, trace, or exception message at runtime.**
  *Control:* config secrets leave the config module only as `SecretValue` - the raw string is held off-object
  in a `WeakMap`. Serialization and `util.inspect` yield `[REDACTED]`, while spread and enumeration expose
  no raw property. The raw value is read solely through the free function `revealSecret`, restricted to
  the fence-allowlisted HMAC consumers. *Fence:* `no-secret-fallback` (SecretValue containment; v3 §15.4).
- **T-I6 (High): a residual identifier reaches the repository through real-derived corpus intake.**
  *Exploit:* scrubbed defect history is hand-delivered into `fixtures/corpus/real-derived/` carrying a
  name, account number, or institution inside a narrative or an unanticipated field, and is committed
  forever. *Control:* the partition is deferred and any delivered entry fails validation until the
  captain lifts it; the hand-owned intake schemas are strict at every boundary, carry NO free-text field,
  and admit only canonical instants, `tok:<16 hex>` identities, derived ids, and closed vocabularies, so
  an unanticipated string is rejected rather than stored; every case needs a complete `scrubAttestation`
  whose reviewer is not its scrubber; and diagnostics print bounded safe paths only, never rejected values
  (ADR-0052, `docs/corpus-scrub-procedure.md`). *Fence:* `corpus-intake-attestation`,
  `corpus-provenance-split` (+ the replay/payload companions), run over the empty partition by the
  blocking `corpus` CI gate.

### D — Denial of service
- **T-D1 (Medium): unbounded request body / query.** *Control:* request size limits; bounded queries;
  step/flow timeouts. *Gap (owner: red-team; date: Phase E):* per-tenant rate limiting is a scale-ladder
  item (ADR-0015) — documented, not silently deferred.
- **T-D2 (Medium): webhook flood resumes/replays.** *Control:* idempotency (exactly-once resume) blunts
  replay effect; signature required. *Fence:* idempotency-exactly-once.

### E — Elevation of privilege
- **T-E1 (High): a low-privilege actor performs a high-privilege action.** *Exploit:* an `advisor` calls a
  `principal`-only port, or approves/executes a decision. *Control:* server-side RBAC at the port (`requireRole`);
  roles enum in contracts. Every governed human action (view PII, supply evidence, draft/approve policy,
  approve/override a decision, initiate execution, export audit) additionally passes `authorizeGovernedAction`,
  which yields a sealed `ActionGrant` or a typed `FORBIDDEN`; governed route surfaces call `requireActionGrant`,
  never a bare role check, and system actors are refused categorically. Raw decision-history disclosure is
  held to BOTH `audit.export` and `pii.view` on one tenant and actor (`/api/ledger`, ADR-0045), and the
  register withholds entries it could not authenticate rather than showing them unverified. *Fence:*
  `auth-enforcement`, `governed-actions` (routes resolve a session and check role/grant; v3 §15.3).
- **T-E2 (High): demo/seed affordance reachable in production.** *Control:* the config fail-closed guards
  refuse a non-postgres driver or placeholder secrets in production (ADR-0003); the D-036 walking-skeleton
  screens under `/app/demo` are static labeled fakes behind the `/app` auth guard, writing no state
  (ADR-0027 provenance badges). *Fence:* the config superRefine guards plus `demo-skeleton-honesty`
  (skeleton data pinned to the contract); a dedicated demo-mode fence lands with the demo milestone.
- **T-E3 (High): the populated demo world, or the seed that writes it, reaches production.** *Exploit:*
  `pnpm db:seed` is pointed at a production store - it mints two accounts carrying a publicly committed
  password - or a demonstration household survives into a real book and is read as a firm record.
  *Control:* the world is no longer deferred (ADR-0057), so the guarantee is structural on three sides.
  `assertSeedableEnvironment` refuses `APP_ENV=production` before a store is opened and again before any
  write; the fixture evidence adapter refuses to serve anything under `APP_ENV=production`; and every row
  the seed writes NAMES a demonstration `record_origin` at its insert, so `pnpm fixture:check` counts
  them from a table list derived from the shipped DDL and fails on the first one. The origin never moves
  when a value is edited, so editing a seeded record cannot launder it. The seed is IRREVERSIBLE (the
  decision and audit chains it writes are append-only by trigger), so the guarantee is "production was
  never seeded", never "the seed can be undone" - see `docs/world.md`. *Fence:* `clean-slate` and
  `world-provenance`, plus the blocking `world` CI job, which runs the check on a fresh store AND with a
  row floor after the seed (a check that finds nothing proves nothing).

## Gaps (explicit, owned, dated)

| Gap | Owner | Target | Note |
|-----|-------|--------|------|
| Per-tenant rate limiting | red-team persona | scale-ladder trigger | ADR-0015; blunted by idempotency + size limits now. |
| Field-level PII-at-rest encryption | red-team persona | WISP technical control | House-CRM PII relies on transport + access control now. |
| Full DSAR workflow | compliance persona | design contract | ADR-0019 retention hold defined; workflow deferred. |
| Injection-defense fence (T-T3: ban string-built SQL) | founder | next adapter / query surface | Parameterized-only today; not machine-enforced. |

## Attack-round checklist (each audit)

Attempt: (1) an authz bypass (forge role, cross-tenant read); (2) an edit to EITHER chain — the operational
`audit_log` and the `decision_ledger` with its immutable replay sources (UPDATE/DELETE, then
re-verify); (3) a webhook forgery/replay (bad signature; double-fire → assert exactly-once); (4) a secret
leak (planted secret must fail gitleaks + the fence); (5) a corpus-intake miss (deliver a case carrying
free text, an unanticipated field, or a self-reviewed attestation → `pnpm corpus:validate` must reject it
without echoing the rejected value). Findings → `docs/reviews/` and become regression fences.
