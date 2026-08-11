# The domain configuration contract

**Normative for v3 prompt 10.** Governed by [ADR-0056](./adr/0056-domain-configuration-schema.md).
The SCHEMA is the source of truth (`src/domain/config/`); this document states the contract the schema
enforces, so a reviewer can tell an intended rule from an accident. Where this prose and the schema
disagree, the schema wins and this file is the defect.

Gaps, corrections and deferrals: [`domain-config-gaps.md`](./domain-config-gaps.md).

---

## 1. What a domain configuration is

One immutable document per `(domain, version)`, authored by Verin, published as inert YAML at
`config/domains/<domainConfigId>.yaml`. It carries:

- **no firm identity** - `bindDomainConfig` refuses a `firmId` found anywhere in its graph;
- **no household data** - it declares instruction KINDS, never instruction instances;
- **no judgment** - thresholds, reserve horizons, approver roles and staleness windows are FIRM policy
  and live in the policy AST that validates against this document's policy slot.

Its identity is `${domainConfigId}@${version}` plus the SHA-256 over its canonical bytes, pinned in
`config/domains/versions.json`. Editing a published document without bumping its version fails the build.

## 2. The one grammar rule

> Every string that is not a human LABEL is an identifier drawn from a closed, load-checked vocabulary,
> and every composite value is built from a closed SEGMENT GRAMMAR - never from string interpolation.

There is exactly one interpolation mechanism in the whole system: the placeholders `{slot:<slot-id>}` and
`{context:<published-key>}`, rendered deterministically against already-published values. A brace that is
not one of those two forms is a load error, in copy and in command text alike.

## 3. The thirteen sections

| Section | Declares | Never declares |
|---|---|---|
| `intents` | actions, slots, slot types, how each slot resolves, risk class, reversibility | who may approve, what a threshold is |
| `evidence` | evidence kinds, their closed path dictionary and declared types, a freshness FLOOR, what absence means, who may supply it | an observation, a firm's staleness window |
| `primitiveBindings` | which catalog primitives this domain uses, with their configured parameters | any arithmetic; primitives are the only place the plane computes |
| `policy` | the closed VOCABULARY a firm policy may use: settable parameters, selectable strategies, referenceable templates and codes | any policy |
| `instructionKinds` | which household instruction kinds exist, their shape, what they feed, the code a violation raises | the class-to-effect mapping (platform code, so a firm cannot reinterpret a client mandate) |
| `prohibitions` | prohibition CODES and which `VersionedSourceRef` arms may raise each | a prohibition instance |
| `blockers` | resolvable blocker codes and the evidence kinds that resolve them | a blocker instance |
| `authority` | approval template SLOTS and their kind | the `ApprovalTemplate` record (it carries firmId and roles) |
| `execution` | capabilities (one external action each) and plan templates (the DAG over them) | a span name, a table, an audit code, an SQL statement |
| `conflictKeys` | coordination key templates, as segments | a rendered key |
| `reservations` | resource kind, quantity source, creation point, TTL, release events, claim visibility | a reservation instance |
| `verification` | observed statuses, what closes a rule and with what proof, whether it awaits an external observation | a stronger state than a source reported |
| `presentation` | labels, per-code copy, status labels, the intake form, journey surfaces | a conditional |

Every field carries a human `describes`. That is deliberate: the schema has to be traversable as an
interview clipboard when the genesis interview lands, and retrofitting descriptions is the expensive
version. No interview machinery exists today.

## 4. Authorship provenance and diffability

Every version records `authorship`:

- `authoredBy` - `platform-team`, `genesis-interview`, or `proposed-by-system`, plus the author id;
- `authoredAt` - a canonical timestamp;
- `basis` - what the version was drafted FROM (a ratified document, a shipped implementation, a signed
  truth set, a firm interview, observed operation), each with a reference and a description;
- `parentVersion` - the version this one supersedes, or `null`;
- `changeFromParent` - the change stated AS DATA, one entry per top-level section.

The loader recomputes the diff against the parent (the EMPTY document when a version declares none) and
REFUSES a document whose declaration disagrees with its own bytes. A declared change is therefore a
checked claim, not a comment.

## 5. Tenancy

The document is firm-neutral. `bindDomainConfig(loaded, firmRegistry)` is the only place a firm enters:
it mints `DomainConfigVersionRef`, `ExecutionTargetRef`, `VerificationRuleRef`, `ApprovalTemplateRef`,
`ReservationRef`, `RoleRef` and `EvidenceSourceRef`, and refuses when the firm supplies no identifier for
a class the document references. It never invents one.

A parameter position that genuinely needs a tenant-scoped reference carries the ONE closed placeholder
`{ $ref: { kind, class } }`. A key-shaping parameter may never carry one: the published key space must be
identical for every firm (D-184/D-185), and the loader says so.

## 6. The seven load stages

1. **inert document** - a plain data record (the adapter has already refused tags, anchors, aliases and
   merge keys);
2. **grammar** - strict, readonly objects: an unknown key is a parse failure;
3. **reference closure** - every name closes over the vocabulary that owns it;
4. **type check** - slot type against its use site, bucket granularity against a date-typed source,
   positive freshness floors;
5. **coherence** - the binding dataflow DAG, plan acyclicity, and the no-dead-configuration rule;
6. **completeness** - two-sided copy coverage and a submittable intake form;
7. **identity** - version shape, catalog and grammar agreement, authorship provenance.

Errors accumulate within a stage; a document loads only when the list is EMPTY. Loading is TOTAL - every
rejection is a value, never a throw.

## 7. Rules that are easy to get wrong

- **A `text` slot may reach a command payload but never a key.** A household name is what a CRM create
  IS; unbounded, editable bytes inside a conflict or idempotency key would make a coordination identity
  unstable. Load-checked.
- **Evaluation order is derived, not authored.** Prompt 8's parameters bind context keys directly, so the
  dataflow edges are already in the parameters. The loader topologically orders the bindings and rejects
  a cycle. Shuffling the YAML changes nothing.
- **Nothing may be unreachable from an intent.** A declared evidence kind, binding, capability, plan,
  conflict key, reservation, verification rule or policy slot that no intent reaches is dead
  configuration, and dead configuration cannot ship.
- **`maxAge` is a domain FLOOR, not the policy window.** The floor exists so a firm cannot configure a
  window looser than the evidence can support.
- **Command types name commands, never domains.** What a command DOES - its span, its SQL, its audit
  action - lives in `src/infrastructure/execution-adapters.ts`, as static literals the observability
  vocabulary fence can still derive from real call sites.

## 8. Authoring workflow

1. Edit or add `config/domains/<id>.yaml`.
2. Run `pnpm test` - `src/__tests__/fitness/domain-configuration.test.ts` loads and binds the shipped
   bytes through the real engine and reports the computed hash when it disagrees with the pin.
3. Update `config/domains/versions.json` with the computed hash, in the same commit, under a BUMPED
   `version` if the previous version was published.
4. State the change in `authorship.changeFromParent`. The loader checks it against the bytes.

## 9. A type-resolution rule this module learned the hard way

Do not name a Zod schema type, or any deeply recursive type, in the signature of an EXPORTED function
under `src/domain/`. The repo's sealed-authority fences expand a parameter's type structurally; a schema
generic drags its whole nested shape through dozens of method signatures, and across this module's
twenty-odd composed schemas that walk exhausted a fence worker's heap - which vitest reports as a
partial run, not a failure. Export named types and narrow ports instead (D-193, and the collapsed-export
comments in each section module).
