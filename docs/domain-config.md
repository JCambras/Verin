# The domain configuration contract

**Normative for v3 prompt 10.** Governed by [ADR-0058](./adr/0058-domain-configuration-schema.md).
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

Until the evaluator assembles a context plane (prompt 16), a `{context:…}` read is refused wherever the
INTERIM substrate would have to resolve it: `{from: context}` value sources and `{context:…}` inside
command text. Reason-code copy still admits it - the evaluator is what renders that copy, and it will
have the plane. The refusal names the key and says why (D-247): admitting the read would let a document
load clean and then fail at the step that consumed it, after earlier steps had committed real records.

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
- **A composite key is composed of SEGMENTS, never of one pre-joined value.** Every segment is escaped
  before the join, which is what makes the rendered bytes an injective encoding of the resolved tuple -
  and what makes the arity recoverable from those bytes, so no one-segment key can ever collide with a
  multi-segment one. The corollary bites: a lone segment whose VALUE already carries the separator gets
  escaped, so a key like account opening's `finalize:<applicationId>` must be authored as the two
  segments it is. It is (D-245), and the bytes it renders are asserted against the column the
  application row records - the exactly-once guard the finalize adapter derives its per-write sub-keys
  from (charter #16).
- **A reachable template is a CHECKED template.** Reference closure and the no-dead-configuration rule
  share one scope: a conflict-key template or a reservation reachable through a CAPABILITY is
  type-checked exactly like one the intent lists directly (D-248). The two scopes disagreeing is how a
  text slot inside a coordination key, or a bucket over a non-date source, used to load clean.
- **`$ref.kind` is a closed vocabulary, enforced at LOAD.** A deferred tenant-scoped reference names one
  of `PARAMETER_REF_KINDS` and a non-empty class. Checked at bind instead, a typo substituted cleanly,
  then dropped the class out of the checklist a surface builds its firm registry from - a request-time
  failure on a screen that cannot recover from one.
- **A suspended execution is bound to the version it started under.** The engine's cursor is POSITIONAL
  and the plan is versioned data, so `startFlow` persists `domainConfigVersionId` and the composition
  root refuses to drive a stored cursor under a different one (D-246). It states that precondition as a
  `ResumeGuard` the ENGINE calls against the state IT loaded, rather than loading the row itself first:
  one round trip instead of two, and the version checked is provably the version driven (D-255,
  ADR-0011 as amended by ADR-0058). A MISSING version is LEGACY and resumes - it predates the pinning,
  and refusing it would make the guard's first act on deployment the stranding of every in-flight
  execution. A KNOWN and DIFFERENT one refuses as `superseded-version`, and a recorded value that is not
  a version string is neither, so it fails closed as `unreadable-version` - separate registered stages
  because an absent `configVersionStarted` is also what a shape violation produces, and one stage could
  not tell the operator which it was (D-260). Both refusals are operator-recoverable, so they reach the
  provider as `retry-later` (§10) rather than as a discarded signature. Resuming against the PINNED
  document is the end state and stays owned by PC-4 (prompts 15/19); until then the refusal is loud
  rather than silently resuming at the wrong step.
- **Evaluation order is derived, not authored.** Prompt 8's parameters bind context keys directly, so the
  dataflow edges are already in the parameters. The loader topologically orders the bindings and rejects
  a cycle. Shuffling the YAML changes nothing.
- **Nothing may be unreachable from an intent.** A declared evidence kind, binding, capability, plan,
  conflict key, reservation, verification rule or policy slot that no intent reaches is dead
  configuration, and dead configuration cannot ship.
- **`maxAge` is a domain FLOOR, not the policy window.** The floor exists so a firm cannot configure a
  window looser than the evidence can support.
- **`$ref` placeholders may nest only as deep as a fault path can be REPORTED.** A parameter value is
  opaque to this schema by design, so the walk that substitutes deferred references is the one emitter
  whose fault path grows with the DOCUMENT rather than with the schema. `MAX_CONFIGURED_VALUE_DEPTH`
  (`src/domain/config/errors.ts`) is refused at admission, and the operator channel's `configPath` shape
  reads its per-segment subscript cap from that same constant - so a graph the loader admits always has
  a location the channel can carry, and neither side is an opinion about the other (D-262). The channel's
  `MAX_CONFIG_DIAGNOSIS_LENGTH` ceiling is the SECOND bound on the same graph, and it binds independently:
  a graph inside the depth bound whose accumulated path outgrows 128 characters is refused too, and the
  refusal says so - `path-too-long`, meaning FLATTEN THE GRAPH, never the `unnameable-segment` cause,
  which means RENAME THE KEY (D-268). BOTH bounds apply to BOTH container kinds: a list POSITION is
  admitted through the same step as an object key (`childConfigSubscript`), so an object graph and a list
  graph whose accumulated paths are the same length get the same verdict (D-269).
- **Command types name commands, never domains.** What a command DOES - its span, its SQL, its audit
  action - lives in `src/infrastructure/execution-adapters.ts`, as static literals the observability
  vocabulary fence can still derive from real call sites. What it REFUSES is a fact about the document,
  not about the adapter: a payload field the compiled command did not carry, a registration outside the
  vocabulary the store accepts, and a command type with no runner are all stated through the
  `ConfiguredRefusal` port the compiled plan carries, so they inherit one classification, one wire
  sentence and one operator line with every other configuration refusal (D-263).
- **`presentation` is load-bearing at the REQUEST boundary, not only on screen.** A text slot's
  `maxLength` and an enum slot's `values` are exactly what `/api/flows/account-opening` admits, through
  the same `IntakeForm` projection the page renders (`admitIntakeSubmission` in
  `src/domain/config/intake-view.ts`), and `presentation.surfaces` is the journey's progress rail in
  declared order. Adding a registration to a document therefore can never render a select option the
  API refuses with a 400, and a renamed station cannot leave the screen disagreeing with the document.
- **The journey's LIVE station is declared, never positional.** `presentation.form.surface` names the
  station the form stands on and `awaitingSurface` the one it stands on while the flow is suspended at
  its external gate (absent for a domain whose plan never suspends). Both must name a declared surface
  or the document does not load, and the shipped journey resolves them through the `IntakeForm`
  projection - so it holds no station id of its own, and renaming or reordering `surfaces` moves the
  rail instead of emptying it.
- **A top-level section may not declare one id twice.** `intents`, `evidence`, `primitiveBindings`,
  `policy.slots`, `instructionKinds`, `prohibitions`, `blockers`, `authority.templates`,
  `execution.capabilities`, `execution.planTemplates`, `conflictKeys`, `reservations` and `verification`
  all become maps keyed by id, so a duplicate would SHADOW rather than fail - and two consumers of one
  section can then disagree, which is how a `verification` id declared twice loads as "awaits nothing"
  and compiles as "awaits externally", suspending a step whose write already committed. One collected
  rule in `src/domain/config/document.ts` refuses all thirteen, naming the offending id.
- **A value source must be AVAILABLE where it is read, not merely declared.** A `step-output` source
  resolves only against the CONSUMING step's transitive `dependsOn` closure, and an `await-observation`
  source only where an externally-gated step sits inside that closure; a conflict key and a reservation
  quantity resolve to coordinate a decision BEFORE the plan runs, so neither is available there. Checked
  against the whole plan instead, a payload field of the second step naming the third step's output
  loads clean and then fails mid-plan - after the first step's write has committed (proof PF-306).
- **A slot a capability reads must have a TRANSPORT, and a command text is checked against the intent
  that renders it.** The interim resolver reads a slot only through its declared `triggerField`, which
  the grammar forbids on any slot that is not `supplied-by-trigger`, so a capability sourcing a
  `bound-by-primitive` or `derived` slot is refused when the plan is COMPILED - naming the slot and its
  resolution - rather than compiling into a step that commits its predecessors and then cannot resolve
  its own payload. The refusal is at compile rather than at load because the authoring is legal: money
  movement's `household` and `source-account` ARE selected by primitives, and prompt 16's context plane
  is what supplies them (`docs/domain-config-gaps.md` §3). Separately, a `{slot:…}` placeholder in
  `commandText` resolves through ONE intent's resolver while the completeness stage holds copy to the
  union of every intent's slots, so the closure stage checks each command text against the slots of the
  intent whose plan reaches it (proofs PF-313, PF-314).
- **Flow data has three writers, and they share one camelCase namespace.** A slot's `triggerField`, a
  capability's `publishes[].as`, and the fields of the observation that closes an awaited rule all land
  in the same record, so the loader refuses a collision between any two of them and a collision with the
  reserved platform keys (`executionScope`, `initiatedBy`, `clientRequestId`). None of these fails
  closed on its own: an alias equal to `executionScope` replaces the per-execution idempotency scope for
  every later step, and an alias or trigger field equal to an awaited observation's field shadows it
  under the engine's merge order - which is how a finalized account would take its open date from what
  the advisor typed (proofs PF-304, PF-307).
- **A label id a surface asks for must exist.** The demo reads its slot, evidence-kind and action labels
  through `src/app/demo/vocabulary.ts`, which resolves every id it renders ONCE as a `Result` and states
  an undeclared one as a typed fault the shared mint turns into the `undeclaredCopy` refusal (§10) -
  never a throw, because that path is server-rendered (D-267). RULE F of the
  domain-configuration fence binds every id the shipped tree asks for to the published copy - resolved
  by symbol, failing closed on a non-literal id - so a rename is a BUILD failure rather than a refusal
  screen on the demo journey (proof PF-296).
- **An enum slot that feeds a typed store column is FENCED equal to it.** `registration-type`'s declared
  `values` and `ACCOUNT_TYPES` (`src/domain/schema/entities.ts`, the union the house-CRM's account-type
  column accepts) are two copies of one vocabulary, and CD-1 leaves the shipped copy unrenamed - so RULE G
  of the domain-configuration fence proves them EQUAL in both directions, and fails closed if no single
  enum slot supplies the shipped `accountType` transport field. Unbound, a registration added to the
  document alone would be admitted by the request boundary and then refused by the execution adapter at
  the third step, after the household and contact writes had committed (proof PF-297; the boundary's own
  zero-writes refusal is proof PF-298).

## 8. Authoring workflow

1. Edit or add `config/domains/<id>.yaml`.
2. Run `pnpm test` - `src/__tests__/fitness/domain-configuration.test.ts` loads and binds the shipped
   bytes through the real engine and reports the computed hash when it disagrees with the pin.
3. Update `config/domains/versions.json` with the computed hash, in the same commit, under a BUMPED
   `version` if the previous version was published.
4. State the change in `authorship.changeFromParent`. The loader checks that declaration against the
   diff it COMPUTES from the parent document's bytes whenever those bytes are available to it - which
   today is the empty baseline every first version (`parentVersion: null`) diffs against, so a first
   version's record must match its own bytes exactly, section for section. A version that declares a
   parent whose bytes this loader was not given is held only to stating a NON-EMPTY change; making that
   case a real byte check needs somewhere for a superseded document's canonical bytes to live, which is
   the persisted configuration-version registry deferred to prompts 15/19 (PC-4 in
   [the gap report](./domain-config-gaps.md)).

A running deployment memoizes a SUCCESSFUL load per domain id - a published version is immutable, so a
changed file is a different version and a deployment restarts to pick one up. A FAILURE is never cached:
a transient read error, or a document an operator has just restored, clears on the next request rather
than disabling the configured flow for the life of the process.

## 9. A type-resolution rule this module learned the hard way

Do not name a Zod schema type, or any deeply recursive type, in the signature of an EXPORTED function
under `src/domain/`. The repo's sealed-authority fences expand a parameter's type structurally; a schema
generic drags its whole nested shape through dozens of method signatures, and across this module's
twenty-odd composed schemas that walk exhausted a fence worker's heap - which vitest reports as a
partial run, not a failure. Export named types and narrow ports instead (D-222, and the collapsed-export
comments in each section module).

## 10. What a configuration refusal says, and to whom

A refusal of the published document has three audiences - the submitter, an external sender, and the
operator - and each is told a different thing on purpose. The rules below are enforced by RULES I-M of
the domain-configuration fence, which derive what they check - the mint sites, the surfaces that decide
an instruction, the admitted diagnosis shapes - from the real modules and their real emitter output
rather than from a hand-kept list.

- **One mint.** A configuration module never mints an `AppError`. It states the typed
  `DomainConfigError` it found, and the `ConfiguredRefusal` port (`src/domain/config/errors.ts`) turns
  that fault into the one refusal shape through the stage arm it belongs to - `uncompilable`,
  `unrunnableStep`, `intakeMismatch`, `undeclaredCopy` (a surface renders a label the document declares
  no copy for; kept apart from `unbindable` because the firm supplied everything the document asked of
  it, so an operator sent to the firm registry would be looking in the wrong place - D-267). Nine
  hand-written mints saying the same thing in their own words
  is what produced a server error with nothing to quote, an external provider holding our internal ids,
  and no operator line at all (D-260/D-261). Pure domain code reaches no logger, which is why the
  conversion is a port rather than a function in the module that found the fault.
- **A retry category belongs to a CAUSE, never to a call site.** Every refusal whose cause is "this
  deployment cannot resolve or compile its published configuration" is operator-recoverable and
  therefore `retry-later`, wherever it arises - the load, the version guard, the compile, and a command
  type this build has no adapter for included. The mint marks it (`operatorRecoverable`,
  `src/contracts/client-retry.ts`) and every surface READS the instruction (`clientRetryFor`) instead of
  choosing one, so a refusal added later inherits the classification without anyone remembering to
  (D-257). A surface whose OTHER arm carries no instruction at all - the intake accessor answers a
  submitter's own omission with a plain VALIDATION, which has no `retry` field - asks `causeRetryFor`,
  which answers what the cause dictates or `null`. `clientRetryFor` is defined in terms of it, so the two
  can never disagree and no call site invents a fallback it could never send (D-265).
- **The client is TOLD what to do next; it never infers it from a status.** The instruction is a closed
  vocabulary - `retry-with-new-identity`, `retry-with-same-identity`, `retry-later`, `do-not-retry` -
  and permanent-versus-transient was a false binary: a superseded version or a broken document clears on
  an OPERATOR action, so answering it "do not retry" throws away completable work while "retry now"
  spends a sender's budget against a condition no retry changes (D-253/D-254/D-255). The status is a
  message to that audience about what to do: 409 / 500 / 503 with `Retry-After` / 422 to the browser
  (`src/app/_server/refusal.ts`), one do-not-redeliver 422 or the same paced 503 to the e-sign provider
  (`src/app/api/esign/webhook/route.ts`, D-251). It matters at the intake boundary because the journey
  mints one request identity per form session and a fresh identity is a fresh EXECUTION: burning one on
  a refusal the submitter cannot fix opens duplicate household, contact and application rows.
- **No deployment internal crosses the boundary.** Dotted document paths, file names, environment
  variable names, hashes and version ids reach neither a user-facing surface - static copy included -
  nor the external provider. The wire carries this repo's own generic sentence plus the refusal's
  correlation reference, which is the only thing the person staring at the failure can hand to
  operations (D-256/D-258/D-259).
- **The diagnosis goes to the operator, as REGISTERED STRUCTURED VALUES.** The stage and code
  (`configStage`, `configCode`) and the document location (`configPath`) travel as registered fields on
  the log line the same correlation id joins, never as prose, because the observability vocabulary
  admits only registered enums and ids and degrades anything else to `[REDACTED]`. That safety property
  is also why the admitted `configPath` shape is derived from what the emitters actually produce and
  bounded by `MAX_CONFIGURED_VALUE_DEPTH` (§7): a path the emitter can build and the shape cannot
  express would censor the very location the operator needs (D-262).
- **A LOCATION is built from segments, and the one constructor carries only what the channel can
  express.** `src/domain/config/errors.ts` states the channel's capacity once - the segment grammar and
  the length ceiling - and `configError`, `configPathFrom` (the grammar stage's builder) and the
  observability shape all read it. A document KEY is author-chosen and may be anything: one carrying
  whitespace or non-ASCII would censor the whole location, and one carrying a `.` is worse than
  censored, since joining it SHAPES perfectly while naming a node the document does not have. So a
  parameter name or graph key the channel cannot name as one segment is refused at ADMISSION beside the
  depth bound, and every fault reports the deepest NAMEABLE ancestor rather than a fabricated node
  (D-266).
- **A location that could not go deeper says WHICH limit stopped it.** `childConfigPath` answers with a
  typed step rather than the parent, so the two limits are distinguishable by construction instead of by
  a sentinel each caller re-interprets: `unnameable-segment` and `path-too-long` reach the operator as
  the registered enum `configPathLimit`, beside `configStage`/`configCode`/`configPath`, and a fault whose
  `path` IS its exact location carries no limit at all. Reporting a length truncation as a naming problem
  sent an operator to rename ordinary camelCase keys that were fine (D-268).
- **A location and its limit are ONE value.** `ConfigPath` is the only way to build a location, it is
  carriable by construction, and it carries the limit that ended it - so `configError` takes no limit
  argument, no emitter can drop one, and `limit: undefined` can only ever mean COMPLETE. An emitter that
  descended hands over the STEP; one handing over a raw dotted path knows no limit, so the constructor's
  own truncation owns the one it hits. Extracting `.path` from a step and passing the string is the one
  hole the type cannot close, and the fence rejects it with `file:line` (D-269).
- **A surface that reads configured copy fails as a VALUE.** The demo station page renders on the
  server from the published document, so it resolves its vocabulary before building anything and renders
  the refusal - generic sentence, correlation reference, no internals - when this deployment cannot
  supply it. Removing the published document must break that journey visibly and honestly, never as a
  stack trace (X-9, D-267).
