# ADR-0033: Sibling append-only decision ledger and replay storage

**Status:** Accepted (amends ADR-0007, ADR-0018, and ADR-0019)
**Date:** 2026-07-28
**Deciders:** Founding architect (executing v3 prompt 7 and its accepted design report)
**Relates to:** Charter non-negotiables #1, #2, #7, #13; v3 invariants 2, 4, 5, 23, 30
**Informed by:** `docs/v3/verin-architecture-v3.md` §§5, 12, 15, 16, 18; prompt 7; `verin-ledgerdesign-l7/report.md`

## Context

The existing `audit_log` is an operational audit plane. Its fixed ten-field hash
preimage and asynchronous at-least-once outbox delivery are already recorded
history. Decision events are the source for projections and future replay. They
must commit synchronously with the immutable decision record and must hash the
complete typed event bytes.

Putting both fact classes in one table would either change old audit preimages,
leave typed fields outside the hash, or make authoritative decision state lag its
business transaction. Splitting an overloaded hash chain later would require
rewriting retained history, so topology is the irreversible choice prompt 7 must
settle now.

## Decision

- Add `decision_ledger` as a sibling to `audit_log`. It owns an independent,
  GENESIS-rooted, per-organization sequence and hash chain. Its versioned hash
  preimage binds the exact canonical typed-event bytes and the producer provenance,
  followed by the prior hash.
- Freeze the prompt-7 vocabulary at 16 discriminated event types, including
  `ApprovalStageExpired` and `ApprovalStageEscalated`. Each event records ledger
  schema and canonical serializer versions. Old bytes are never rewritten.
- Persist immutable `evidence_snapshots`, `decision_input_bundles`, ordered bundle
  evidence membership, and `decision_records`. Full canonical bytes and the
  schema, serializer, engine, primitive-set, and time-zone registry versions
  needed for later replay are retained. This prompt stores replay inputs but does
  not evaluate or re-evaluate a decision.
- Decision-input bundle schema 1.8.0 carries an immutable, duplicate-free,
  tenant-scoped `regulatoryVersionRefs` collection. The canonical bundle hash binds
  its deterministic order. Every regulatory citation in a decision result,
  precedence trace, or recursive explanation must match an exact bundle pin.
  Bundle schema 1.7.0 remains readable through its frozen codec and upcasts with an
  empty regulatory collection.
- `recordDecision` writes evidence, bundle, immutable decision, its recording
  events, the chain anchor, and derived projection state in one transaction.
  Later facts use `appendDecisionEvents`. Both lock the tenant row before reading
  the chain head, which serializes sequence assignment on Postgres and PGlite
  without a failed-transaction retry fork. Later appends require a nominal
  transaction capability and use a savepoint, so a caller that catches an append
  error cannot commit a prefix. Every database failure maps to the repository error
  contract after best-effort savepoint cleanup that preserves the original error.
  No decision-ledger outbox exists.
- Composite `(org_id, id)` foreign keys make decision, evidence, membership,
  causation, and exception-triggering links structurally same-tenant. Every
  reference an event can name is a promoted column L3 re-derives from the payload.
  Repository boundaries validate the canonical source hashes named by recording and
  approval events. The tenant fence classifies ledger anchors and projection
  checkpoints as tenant data and permits only exact reviewed capability escapes.
- A recorded-version structural validator binds approval stages, execution steps,
  verification rules, reservations, decision uniqueness, evidence ordering, and
  eligible causal and exception triggers to the exact immutable decision that
  authorizes them. Every decision-scoped fact follows its `DecisionRecorded` fact
  in immutable sequence. Append, whole-ledger verification, bounded register replay,
  and rebuild call that same authority before projection. Invalid or
  pre-initialization references never reach the projection fold.
- Every immutable string leaf is classified by its complete structural path at one
  storage boundary. Attribution is an opaque retained-text reference; hashes and
  timestamps keep their canonical forms; decision explanations, summaries, reasons,
  and external statuses are closed-registry codes or opaque references; every
  remaining string is a bounded lexical identifier. An unclassified path fails
  closed even if its leaf name is already used elsewhere. A schema traversal
  companion requires every declared string path to exist in that inventory, and
  submitted immutable bytes are never rewritten.
- Every ledger row stores versioned provenance for the producer that appended it.
  A direct producer is the exact three-field `source`/`asOf`/`confidence` arm and
  cannot claim `source=computed`. The `computed-v1.0.0` arm additionally binds exact
  canonical provenance bytes containing the algorithm identity, ordered tenant-scoped
  ledger-entry inputs and their entry hashes, observation time, confidence, trace
  digest, and append-only trace reference. Both write paths reject missing, extra,
  ambiguous, cross-tenant, unsupported-version, non-canonical, digest-mismatched, or
  compliance-ineligible computed provenance. Legacy plain computed rows remain readable
  only as demonstrations. Surfaces classify a row from the verified stored value,
  never from an actor name.
- Computed derivation traces live in append-only `decision_provenance_traces`.
  A trace identity can be reused only for byte-identical content. Online append verifies
  every named ledger input before retaining the trace. Replay checks the exact chain-bound
  provenance bytes, recomputes the trace digest, matches the retained trace, verifies
  every referenced entry hash and earlier sequence, and recursively rejects fixture or
  demonstration ancestry. Whole-ledger verification and rebuild reject orphan traces.
  Bounded replay excludes a decision when any computed input lies outside its verified
  window instead of upgrading the mutable trace table into cryptographic authority.
- Every immutable evidence, bundle, and decision source is bound to the exact
  chain entry that first recorded it. The binding is append-only and tenant-scoped,
  and provenance is read from the bound chain row instead of copied into mutable
  metadata. Decision initialization folds the event producer, bundle producer,
  decision producer, and every exact bundle member through one least-trust
  authority shared by online append, rebuild, and verified register replay.
- Evidence snapshots and input bundles are content-addressed and reusable: a later
  decision over the same immutable inputs links the stored bytes. Reuse demands byte
  equality, so an id collision with different bytes is refused, never overwritten.
  Each evidence-recording event binds a digest of the complete canonical snapshot
  metadata in addition to the encrypted content hash.
- All immutable source and computed-trace tables reject UPDATE, DELETE, and TRUNCATE through database
  triggers. A ts-morph anti-fork fence assigns each table to one exact insert-owning
  module, scans operator scripts, and resolves side-effect-free static string
  composition before matching. A statically rooted query or exec argument that
  cannot be resolved fails closed. Callee provenance follows direct, bound,
  reassigned, destructured, and object-literal query or exec wrappers, while bound
  parameter values are not interpreted as SQL text. Repository exports expose no
  immutable update or delete operation.
- Projection state is a cache. Online append and rebuild call the same pure,
  sequence-driven fold. The fold records stated facts only. It does not infer
  quorum, eligibility, execution readiness, or any later-prompt decision. Derived
  state is never located by physical row order. Active reservation exclusivity is
  derived from preceding immutable creation and release events, never from the
  mutable reservation index. Matching tenant-scoped partial indexes cover the
  creation-reference expression and the release anti-join. A reservation generation is keyed by
  reservation reference, owning decision reference, and its creation ledger-entry
  identity. A release cites that exact generation. Reuse is allowed after release
  only through a new creation identity, and a delayed old-generation release cannot
  affect the new generation. Projection rows persist derived provenance for repair and
  operator reads, but the register never trusts them: it replays the exact verified
  event window and verifies the immutable sources needed by every state it displays.
  Rebuild preview reads only bounded projection metadata, so malformed mutable JSON
  cannot prevent `--apply` from clearing and replaying derived state.
- Verification is layered: L1 checks gaps, links, and hashes over stored bytes; L2
  dispatches recorded schema/serializer versions and proves canonical round-trip;
  L3 re-derives promoted columns from the typed payload; L4 compares count,
  sequence, and head hash with the anchor. The existing CI chain gate verifies
  both audit-class stores unbounded, dispatches immutable evidence, bundle, and
  decision rows through recorded source codecs, verifies computed provenance and
  its retained inputs transitively, and refuses a zero-entry pass.
- A request path may verify a bounded window: the most recent entries, anchored to
  the stored hash of the row preceding them, with L4 still compared against tenant
  totals. The register verifies, reads, and replays that window under one tenant-locked
  transaction and displays only decisions whose complete replay sources fall inside
  it. The latest evidence recording at or before a decision is selected through the
  tenant-scoped partial index with an ordered lateral `LIMIT 1` lookup and then
  compared with the verified window start. Every source binding consumed by the
  bounded path is also checked against the tenant-scoped
  predecessor of its exact evidence, decision, or input-bundle identity. Evidence
  identity uses its existing partial ledger index; migration 8 promotes input-bundle
  identity and adds partial indexes for bundle and decision recording facts so all
  three checks use the same bounded ordering authority. L3 compares the promoted
  bundle identity with the immutable decision record, so any different valid bundle
  reference still fails verification.
  The mutable binding table does not establish first-recording authority. Any
  replay-source failure returns all
  L1-L4 levels, no trusted decisions, and a bounded PII-safe reason. The gate's
  unbounded run is an integrity-verification control, not an examiner export.
  Evidence membership reads stop at the maximum number of recording facts that can
  fit before the decision in the exact window, plus one sentinel row. A larger
  bundle is marked incomplete without materializing the rest of its membership.
- The seeded `/app/ledger` register is read-only, uses typed view models, and shows
  both the raw event register and replayed decision state, so the projection fold is
  reachable in the PR that lands it. Rows produced by a synthetic source carry the
  shared `synthetic fixture` badge, derived from parsed stored provenance. Invalid
  provenance renders as `untrusted provenance`, never as real. No fake decision,
  status, or execution history is presented as real.
- The unbounded full-source examiner export is explicitly deferred. The bounded
  register returns recent summaries, truncated hashes, and no replay-source
  payloads, so it cannot satisfy that contract. A later design must resolve
  authorization, streaming or pagination, retention of generated exports, and
  resource bounds before adding a delivery path. The trigger is an external
  examiner or regulated-customer export requirement, before the capability is
  represented as available.
- Extend ADR-0019's six-year audit-class retention to the ledger, evidence,
  bundles, membership, decision records, replay-source bindings, and computed
  provenance traces. A ledger row, its trace, and every retained input named by
  that trace cannot be separated by retention, archival, or pruning. External anchor witnessing or HMAC
  now applies to both chains.
- Amend ADR-0018 ceilings from contracts 3500 to 4800 and infrastructure 2500 to
  8050. The computed-provenance completion measures contracts at 4735 and
  infrastructure at 8010. Domain
  remains below its 1200 ceiling and the per-file 500-line limit is unchanged: the
  repository is split into the chain writer (`ledger-store.ts`), the immutable
  content-addressed source rows (`ledger-sources.ts`), and derived projection and
  reservation state (`ledger-projection-store.ts`), with rebuild orchestration in
  `ledger-rebuild.ts`, recorded-version reference validation in
  `ledger-structural-validator.ts`, and verified request replay in
  `ledger-register.ts`. Contracts
  carry the retained per-version encoders plus the promoted-reference authority
  (`ledger-references.ts`) that storage, verification, and projection share.

## Recorded-version dispatch

Recorded bytes are read with the encoder that wrote them. `LEDGER_SCHEMA_VERSIONS`
lists every ledger schema version this build can decode and grows only by appending;
`LEDGER_SCHEMA_VERSION` selects WRITES alone. The infrastructure registries -
`ledger-schema-registry.ts` (event encoder plus chain preimage) and
`ledger-source-registry.ts` (evidence, bundle, decision codecs) - key on explicit
version literals, never on the current-version constants. Each entry owns its frozen
schema, canonical serializer, and hash or chain-preimage function; replay-source
entries also own their upcast. The retained ledger family lives under `ledger-v1/`;
the retained decision-core graphs live under `v1-7/` and `v1-8/` and import their
exact timezone data, normalizers, and serializer without passing through current
wrappers. Each ledger codec also owns its closed provenance vocabulary, parser, and
canonicalizer, so historical reads never consult the live source vocabulary. Recorded
versions select reads; current constants select writes only. `decision_ledger` and
every immutable source table refuse DELETE,
so dropping or redirecting a key would leave committed rows permanently
unverifiable with no repair path. The
`ledger-schema-registry` fence uses fixed recorded ledger and replay-source fixtures
to prove that every shipped encoding still parses, reproduces exact bytes and hashes,
and verifies L1-L4.

## Later-prompt producers (explicit deferral)

`appendDecisionEvents` is the typed internal write seam this prompt promises, and
Prompt 7 lands exactly two producers: `recordDecision` (the seeded, provenance-
labeled decision history) and the read-only register at `/app/ledger`. The first real
approval, reservation, execution, status, verification, and exception producers
belong to later prompts and are deliberately NOT scaffolded here (charter #5's no-
dead-abstraction rule, read as it is for a foundation prompt). No product path may
claim those capabilities are shipped until their prompt lands them.

## Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Extend `audit_log` | Breaks its frozen hash form or leaves typed data unhashed; asynchronous delivery cannot be authoritative decision state. |
| A second orchestration engine | Prompt 7 is persistence and replay foundation only; the existing workflow engine remains the orchestration substrate. |
| Projection rows as source of truth | Mutable caches cannot provide replay or auditable immutable history; rebuild equality is the stronger contract. |
| Repository-only immutability | Any bypass with ordinary database write access could silently edit history; practical database triggers close that class. |
| Recompute old payload bytes during verification | Serializer evolution could change old bytes; L1 must hash the exact stored preimage forever. |

## Trade-offs and Costs

- **Gained:** atomic decision history, byte-stable replay inputs, structural
  tenancy, independent verification, deterministic rebuild, and an inspectable
  real source of truth without disturbing operational audit history.
- **Sacrificed:** two chains and anchors to operate, more retained storage, and a
  version registry that must remain backward-readable.

## Consequences

Migration version 3 is additive. Migration version 7 adds indexes only. Migration
version 8 promotes the immutable input-bundle identity onto decision-recording
ledger rows and adds its tenant-scoped ordering index. Migration version 9 adds
the append-only computed-provenance trace table and versioned provenance columns,
backfilling existing direct and legacy-computed rows without rewriting their
historical chain preimages. Existing
audit DDL, rows, preimages, outbox, and verification remain byte-compatible.
Future event schema versions add dispatch entries and pure upcasts for projection
use. They never rewrite an old row or hash. Prompt 19 owns decision re-evaluation,
and prompts 18/23/25 own authority, reservation, execution, and status behavior.

The demo's fake `auditPosition`, fake status arrivals, and fake execution history
are deletion or switchover candidates once their producers append real events.
They are not deleted here because prompt 7 has no decision or execution producer;
replacing them now would make the walking skeleton empty or falsely real.

## Revisit When

Production deployment triggers external anchor witnessing/HMAC; a new ledger
schema or serializer version needs a registry/upcast entry; or write volume makes
one-row tenant locking a measured bottleneck.
