# Generation-4 enforcement proof log

One entry per rule (`M-E1..M-E16`) plus the named vacuity entries (`M-V1..M-V3`): each records the injected
violation, the exact failure output, and the revert. A rule with no entry is an unproven rule; the blocking
job fails unless the mapping is total in both directions. Mutations run in disposable local clones against
real repository state; no mutation writes to any remote.

## M-E1 (rule E1)
- Injected: in a disposable clone of this PR's tree with the real `origin/main` fetched,
  `git merge origin/main --allow-unrelated-histories -X ours`, then `node enforcement/run.mjs` under a
  push-context environment.
- Observed (exit 1): `E1 FAIL 644938fd628e7bdd5842c5b7941b0aba0b1d69ab - generation-4 shares history with
  origin/main: merge-base 644938fd628e7bdd5842c5b7941b0aba0b1d69ab`.
- Reverted: `git reset --hard HEAD^`; clone discarded; the shipped tree never carried the merge.

## M-E2 (rule E2)
- Subject: the real platform event payload of this stack's own pull request (PR-1a), captured from the
  blocking job's `cat "$GITHUB_EVENT_PATH"` step of that PR's first CI run. Why this subject: the
  platform-supplied base ref is the entire input; a genuinely mistargeted PR would be the violation itself,
  and creating a second repository is a network write section 3 forbids. This limitation is recorded here
  rather than smoothed.
- Captured: run 32402570676's payload for PR #46 - event `pull_request`, `base.ref: generation-4`,
  `base.sha: 71ef1955c3f65710ab5010832a67f27a2aa76cfe`, `head.ref: fm/gen4-pr-1a`.
- Arm 1, the real payload unaltered, through the shipped stack: `E2 PASS`.
- Arm 2, the same real payload with `base.ref` set to `main` (exit 1): `E2 FAIL base.ref - this pull
  request targets 'main', not generation-4`.
- Arm 3, the same real payload with the base ref deleted (exit 1): `E2 FAIL base.ref - pull_request
  payload carries no base ref; a missing field is not agreement; failing closed`.
- Reverted: the altered copies were temporary files; the shipped rule and the captured payload are unchanged.

## M-E3 (rule E3)
- Subject: the real API answer for this repository (`GET /repos/JCambras/Verin`, `default_branch: main`).
  The default branch is never actually changed to test this rule: DC-6 reserves that to the captain.
- Arm 1, real answer through the shipped stack: `E3 PASS`.
- Arm 2, the same real answer with the field set to `generation-4` (exit 1): `E3 FAIL default-branch - the
  repository default branch is 'generation-4', expected 'main'`.
- Arm 3, no credential, so the query genuinely fails (exit 1): `E3 FAIL default-branch - the repository
  default branch could not be read (no credential (GITHUB_TOKEN unset); refusing an unauthenticated read);
  an unanswered question is never treated as 'main'; failing closed`.
- Reverted: altered copy was a temporary file; nothing shipped changed.

## M-E4 (rule E4)
- Injected: a pull-request payload declaring two seam ids, through the shipped stack (exit 1):
  `E4 FAIL pr-body - more than one declared seam id: Gen4EnforcementContract, AccessContext`.
- Injected: a declared id not in `CONSTITUTION.md`'s closed roadmap list (exit 1): `E4 FAIL pr-body -
  declared seam id 'NotARatifiedSeam' is not in CONSTITUTION.md's closed roadmap list`.
- Reverted: payloads were temporary files; the closed list in `CONSTITUTION.md` is unchanged.

## M-E5 (rule E5)
All eight subcases ran in a disposable clone as simulated pull requests against the shipped stack, each
injected on a detached head and discarded. Exact failure lines (exit 1 in every failing arm):
1. Mixed overflow - a qualifying 40-line registered generated artifact plus a 401-line hand file:
   `E5 FAIL Bucket H, reviewable text lines - ... measured 415 exceeds hard ceiling 400` while printing
   `gen.txt - bucket G, added 40 lines`, proving the generated file neither counts toward nor conceals H.
2. A hand-authored runbook alone: `... measured 401 exceeds hard ceiling 400`, with
   `docs/runbook-restore.md - bucket H, added 401 lines`.
3. A hand-authored fixture, snapshot, and evidence manifest, one at a time: each
   `E5 FAIL Bucket H ... measured 401 exceeds hard ceiling 400`.
4. Generated-only overflow: 17 registered reproducing artifacts -> `Bucket G ... 17 artifacts exceeds hard
   ceiling 16`; separately two 4.5 MB artifacts -> `9437186 gross bytes exceeds hard ceiling 8 MB`.
5. A generated text artifact hand-edited by one byte: `bucket-G artifact failed its qualification
   (reproduced=false ...) reclassified to H`, then `measured 514 exceeds hard ceiling 400` counting its 500
   lines in H - both failures in one run.
6. A generated binary with broken regeneration: reclassified to B, never a line count; nine crossed
   `9 artifacts exceeds hard ceiling 8`, and a 7 MB one crossed `7340048 gross bytes exceeds hard ceiling
   6 MB` with `img-big.bin - bucket B, added 0 lines, 7340048 bytes`.
7. A hand-authored font with a gallery row: `E5 PASS` (enters B immediately); removing its gallery row:
   `bucket-B artifact has no review-gallery row (path + SHA-256)`; nine hand binaries and a 7 MB capture
   then crossed the B count and byte ceilings for the intended reasons.
8. Binary-only: nine gallery-listed screenshots -> B count failure; two 3.5 MB screenshots -> B byte
   failure; two small screenshots with the gallery deleted ->
   `bucket-B artifact has no review-gallery row` for each, under both ceilings.
- Reverted: every mutation was a detached-head commit in the clone; the branch never moved.

## M-E6 (rule E6)
- Injected: `enforcement/orphan.mjs` exporting `orphanHelper` with no caller (exit 1):
  `E6 FAIL enforcement/orphan.mjs - new exported symbol 'orphanHelper' has no non-test caller reachable
  from a live entry path`.
- Then a test-only caller (`orphan.test.mjs`): the same failure - a test caller is not reachability.
- Then wired into the live runner entry: `E6 PASS`. Reverted: detached-head commits, discarded.

## M-E7 (rule E7)
- Injected: a real surface `src/ui/balance-card.tsx` rendering `{account.balance}` bare (exit 1):
  `E7 FAIL src/ui/balance-card.tsx - metric-class render without provenance (no source/asOf):
  <span>{account.balance}</span>` - and the plain `{household.name}` on the same surface passed untouched,
  proving the rule does not fire on every render. Reverted.

## M-E8 (rule E8)
- Injected: `["E99", () => []]` - an always-PASS check with no companion (exit 1): `E8 FAIL E99 - new
  PASS-emitting check E99 ships with no companion mutation entry added to docs/proof-log.md in this PR`.
- Then an entry with an Injected line but no recorded failure: `E8 FAIL E99 - companion entry for E99
  records no observed failure; a companion that never failed proves nothing`. Reverted.

## M-E9 (rule E9)
- Injected: `src/sync/push.ts` fetching a literal host (exit 1): `E9 FAIL src/sync/push.ts:2 - outbound
  network host 'api.salesforce.example.com' is not on the allowlist (which is empty until slice 9)`.
- Then the host assembled from `process.env`: `E9 FAIL src/sync/push.ts:3 - outbound call with an
  unresolved destination; a host the rule cannot read is a host it refuses`. Reverted.

## M-E10 (rule E10)
- Injected: in the clone, one byte of `fixtures/golden/GC-01-firm-a-happy-path.json` changed on a commit
  the oracle ref was pointed at (exit 1, before any parse): `E10 FAIL fixtures/golden/GC-01-...json -
  signed truth changed before parsing: expected sha256 9144263da1c06055c4203248cd6664b3c7666ecb1d4e7b
  9ef69c5abec88bc4ac, read 6fd9f136800692a09288d750500b1caf604d3d5a85577200731c3b9e9f679d75; refusing to
  continue` - both digests printed, no downstream step ran. Reverted: the clone's oracle ref re-fetched.

## M-E11 (rule E11)
The honest-empty tree first reported the required positive result, never skipped:
`E11 report: manifests=0 lockfiles=0 directDependencies=0`. In disposable copies of that tree, each injected
one-sided subject failed naming the subject and the missing proof (exit 1): an empty recognized manifest
(`a dependency manifest appeared with no lockfile; the ratified baseline requires a complete frozen
lockfile`), a lockfile alone (`a lockfile (pnpm-lock.yaml) appeared with no manifest; a partial subject
leaves the honest-empty state and lacks the complete non-empty proof`), and a manifest declaring one
dependency without the baseline (both failures above, subject named). In the separate scratch baseline -
the complete ratified allowlists installed with corepack pnpm 10.15.0, frozen lockfile, all rules
passing before injection - the four non-empty arms each failed: a hand-edited resolved version
(`E11 FAIL react - 'react' is declared 19.2.8 but the lockfile resolves 19.2.9; manifest and lockfile
disagree`, plus the frozen-lockfile install failing); a caret range (`'next' is declared as '^16.3.1', a range; every entry
is an exact version`); an unratified package (`'left-pad' is in neither ratified allowlist; a new package
needs captain ratification`); and `@types/node` moved to a real current non-22 major in manifest and lock
(`the executing Node runtime major is 22 but @types/node is 24.13.3 (major 24); the majors must be
equal` - the runtime side reads `process.versions.node`, not a manifest string). Reverted each time.

## M-E12 (rule E12)
- Injected into the passing baseline: `lodash@4.17.20` (exit 1): `E12 FAIL lodash - 'lodash' 4.17.20
  carries advisory GHSA-35jh-r3h4-6jhm (high), at or above the declared floor` plus four more real advisories from the
  live registry. Then `jszip@3.10.1`: `'jszip' 3.10.1 carries license '(MIT OR GPL-3.0-or-later)', which
  is off the declared allowlist` - every arm of a dual expression must be allowed. Reverted.
- Falsification note: the first baseline run genuinely failed E12 on the ratified set's own transitive
  MPL-2.0 and LGPL-3.0-or-later licenses, and E11 on a pin-parser defect that swallowed sentence-ending
  periods; the declared allowlist was extended by name in CONSTITUTION.md and the parser fixed, in this
  same PR - the rule found two real defects before any mutation was injected.

## M-E13 (rule E13)
- Injected: in a disposable clone, an AWS-key-shaped string committed in `config-creds.js`, then removed
  in a later commit; the shipped scan still failed (exit 1): `E13 FAIL 908e9e8e3785:config-creds.js -
  gitleaks-class rule 'aws-access-key-id' matched a credential-shaped byte in commit 908e9e8e3785, file
  config-creds.js` - the scan reads the whole history, not the tip diff. The injected value was a
  documentation-reserved example key, not a live credential. Reverted with the clone. The pinned
  gitleaks action runs beside this rule in CI as an independent whole-history layer.

## M-E14 (rule E14)
- Injected: a file calling `eval(input)`; the pinned semgrep engine (1.174.0) ran the repo-owned
  `gen4-sast-rules v1` ruleset and the shipped rule failed (exit 1): `E14 FAIL src-probe.mjs:1 - SAST
  rule 'enforcement.gen4-no-eval' (ERROR) matched at src-probe.mjs:1`. With no report present the rule
  fails closed (`no SAST report was provided by the pinned semgrep step (SEMGREP_REPORT); failing
  closed`). Reverted.

## M-E15 (rule E15)
The honest-empty tree first reported the required positive result: `E15 report: releaseArtifacts=0
sbomClaims=0` - never skipped. One-sided subjects injected in disposable copies each failed (exit 1): an artifact
alone (`release artifact 'release/orphan-artifact.tgz' is the subject of no SBOM`) and an SBOM claim
alone (`SBOM 'sbom.cdx.json' names no release subject in this tree (subject: release/nothing.tgz)`). In
the scratch baseline carrying one real packed release artifact and its matching 291-component SBOM (all
rules passing before injection), removing one component failed in one direction
(`E15 FAIL sbom.cdx.json - component 'zod@4.4.3' is in the resolved lockfile but missing from the SBOM`), adding one failed in the other
(`component 'ghost-package@9.9.9' is in the SBOM but the resolved lockfile does not contain it`), and
re-subjecting the SBOM failed both the orphaned artifact and the orphaned claim. Reverted each time.

## M-V2 (rule E15)
- Injected: on the non-empty scratch subject from M-E15, the SBOM's component list replaced with zero
  components (exit 1): `SBOM 'sbom.cdx.json' carries zero components; an empty inventory is the easiest
  false pass and never reports clean`. Reverted. This is the non-empty path, not the honest build-free
  state.

## M-E16 (rule E16)
Subject: a disposable scratch clone carrying the complete ratified baseline, a real `GovernedRuntime` in
TypeScript over a real PostgreSQL client (`pg` 8.23.0 against the pinned `postgres:18.6` image, by digest)
and a real fake provider, a typed seven-row registry spanning all six classes (the class-6 external row
carries an explicit `unreachableInSlice` classification), OpenTelemetry in-memory span and metric capture,
and a real end-to-end test exercising the flow. The happy path passes all six comparisons whole. Every
subcase was injected, observed failing with the exact operation and defect, reverted, and none is caught
by a substring search. Selected exact lines (the full battery transcript is in the PR-1d body):
1. Missing span: `... 'store.insert-account' has 0 completed span(s); exactly one is required (span)`.
2. Missing metric: `... its required metric 'count' recorded a total of 0; exactly once per node is
   required (metric)`. 3. Missing log: `... emitted 0 structured log record(s); ... (log)`.
4. Phantom entry (exit 1): `E16 FAIL store.never-run - registered operation was never exercised and
   carries no unreachableInSlice classification` - the other direction.
5. Source shape is not emission: every emission call left in the source, made unreachable at runtime; the
   source greps clean and E16 still failed all three, because it reads the capture and not the text.
6. Unregistered internal step: unobtainable identity by construction - `tsc` refused all three forcings
   (TS2339 no such gateway entry; TS2339 no generic `enter`; TS2305 the raw interpreter is not exported) -
   and the behavioral relabel failed `exercised operation 'flow.sneaky-read' is absent from the typed
   registry`.
7. Adapter direct-call path: the product-target scan named each raw acquisition at file:line (pg import,
   `new pg.Pool`+`process.env`, `globalThis.fetch`), and the undenied probe failed
   `the start-up probe found 'fetch'/'rawClient' available in the capability-denied product target`.
8. Raw-capability bypass: direct pool work outside the interpreter failed the multiset comparison
   (`invocations count 1 != rawExecutions count 0` naming op, gateway and id); a forged token drew the
   typed refusal naming op, gateway and SemanticEffectId.
9. Semantic-effect smuggling: with every non-semantic field held byte-constant, changing only the SQL
   predicate (and separately only the provider endpoint) refused construction printing both digests
   (`registry digest semfx.v1:9ac7... != constructed digest semfx.v1:4c51...`); two callers of the
   unmodified entry reproduced its one id `semfx.v1:11fb...` in both raw captures.
10. Vacuous/open/misclassified definitions: empty object, truncated validator, unresolved reference,
    generic query form, function-valued constructor and caller-controlled slot each rejected before
    construction naming the closed-language rule; missing fields failed on one row of each effect class
    (store, provider, external); forbidden fields failed on class 1, 2 and 3 rows; a raw effect moved
    under a flow-step failed `no legal multiset row and cannot hide beneath its parent`; empty comparator
    maps beside governed rows failed per-row on the broken bijection, never equality over zero.
11. Missing correlation field: `tsc` refused the wrong kind at the typed entry (TS2345); a parsed value
    forced past the types drew `runtime refusal: correlation for 'decision.record' is missing required
    field 'decisionId'`.
12. False alias: `tsc` refused `RequestId` where `DecisionId` is required (TS2322); forced past the types,
    the purpose tag refused: `field 'decisionId' carries purpose tag 'requestId'; an identifier cannot
    pose as another`. The static sealed-factory fence lands with the runtime it guards in prompt 2.
13. Unsafe emissions: a free-form attribute failed on cardinality against its declared enum domain; a raw
    account reference failed as a PII defect in each of the hyphenated, spaced and bare forms; an ad-hoc
    span name failed `not produced by the declared naming function`.
14. Build tooling in a production bundle: the evidence-tooling import failed the web bundle, then the
    worker bundle, each naming module and bundle; the clean re-run proved both bundles free of it.
- Reverted: every arm was an env-selected mutation in the disposable clone; nothing was promoted, and the
  merged tree gains no line and no dependency from the subject.

## M-V3 (rule E16)
- Injected: a non-empty registry with a capture holding zero telemetry and an empty graph (exit 1):
  `the registry is non-empty but the capture holds zero telemetry and an empty graph; the flow was never
  exercised at all`. A PR that registers no governed operation passes E16 honestly on its empty registry
  delta; a PR that registers one and never ran it does not. Reverted.

## M-V1 (rule E5)
- Injected: a simulated pull request whose base and head are the same commit, so the changed-path list is
  empty (exit 1): `E5 FAIL diff - E5 saw zero changed paths; a check that sees nothing must never report
  clean`. Reverted. A check that sees nothing must never report clean.

## PR-2a proofs (prompt 2 section 6; raw transcripts: docs/evidence/pr2a-transcripts.tar, sha256 91bf9415...)

Every arm was injected, observed failing with the exact line quoted, and reverted; the restored tree's
green run closes the bundle. No heading here names a rule id: the canonical `M-*` mapping above stays total.

### The baseline (spec M-G, rule E11's non-empty path)
1. Caret range: `'next' is declared as '^16.3.1', a range; every entry is an exact version`.
2. Off-allowlist package: `'left-pad' is in neither ratified allowlist; a new package needs captain ratification`.
3. Lockfile deleted: `ERR_PNPM_NO_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is absent`.
4. `@types/node` at major 24 under Node 22: `the executing Node runtime major is 22 but @types/node is 24.13.3 (major 24); the majors must be equal`.
5. `NEXT_TELEMETRY_DISABLED` unset under the capability-denied fixture: this build attempted no
   telemetry, and the armed fixture was proven on a real outbound attempt (`deny-net: refused outbound
   tls connect to 'telemetry.nextjs.org'`); restored, the build completes with zero refusals.

### Sealed authority (spec M-B; the sealed-factory construction rule plus the runtime gateway)
Typed: a cast to `Principal`, a `JSON.parse` fill, casts to `GovernedOperationId` and `RequestId` each
fail the build with file:line; a bare literal fails `tsc` (TS2741, the brand is missing); an
unregistered gateway entry and a generic `enter` fail TS2339. Forced past the types: missing
`requestId`, a wrong purpose tag, a wrong kind, and a structurally valid correlation minted by a
second factory are each refused at the gateway naming the defect; the factory-minted control is accepted.

### The E16 battery against the first real flow (spec M-E, all twelve, plus attributes and naming)
1. Span deleted from sign-in: `operation 'route.sign-in' has 0 completed span(s); exactly one is required (span)`.
2. Metric deleted from the shell's session read: `... its required metric 'count' recorded a total of 0 ... (metric)`.
3. Log deleted from the session-write transaction: `operation 'session.create' emitted 0 structured log record(s) ... (log)`.
4. Phantom row: `registered operation was never exercised and carries no unreachableInSlice classification`.
5. Emissions present in source (grep count 3) but unreachable at runtime: 28 failures - E16 reads the capture, not the text.
6. Unregistered internal step: TS2339 (no entry, no generic `enter`); relabelled in the capture:
   `exercised operation 'flow.sneaky-read' is absent from the typed registry`.
7. Product raw acquisition: `src/app/page.tsx:9 imports the raw database driver directly`, `:10 reads
   the credential environment outside the kernel`, `:11 calls fetch in a product module`; the probe's
   denials stand independently (credential env consumed and deleted by the kernel).
8. Semantic-effect smuggling (only the admitted predicate changed): `refusing construction: registry
   digest semfx.v1:f3ea46e8... != constructed digest semfx.v1:06d0a513...`; two ordinary callers of the
   unmodified entry reproduced one admitted id in both raw captures.
9. Empty, truncated, unresolved, generic, function-valued and caller-controlled definitions each
   refused before construction naming the closed-language rule; a store row stripped of both required
   fields, the fields added to class 1, 2 and 3 rows, a raw execution hidden beneath a non-effect
   parent, and both definition sides emptied all fail per row - never equality over zero.
10. Tampered raw bytes under a kept id: `raw-execution bytes do not reproduce semfx.v1:f3ea46e8...`.
11. Correlation without `requestId`: TS2741 at the typed entry; forced past it: `missing required
    field 'requestId'; the runtime fails closed`.
12. False alias before any second identifier exists: a value with purpose tag `sessionId` in the
    `requestId` slot: `a value cannot pose as another identifier`.
Attributes: an account-shaped `requestId` fails both its digest domain and as a
`hyphenated-account-reference` PII defect; a raw session token, a raw email and a free-form household
name fail on undeclared domains. Naming: a concatenated span name fails the declared naming function.

### The empty capture (spec M-F, vacuity)
With the exercising suite disabled the gate fails, never passes: `the registry is non-empty but the
capture holds zero telemetry and an empty graph; the flow was never exercised at all`.

### The vacuous axe scan (spec M-D)
Pointed at a route that renders nothing, the required loaded-state marker fails first
(`expect(locator).toBeVisible() failed ... element(s) not found`) - an empty render can never pass.

### The two ruled collector sharpenings (GD-002), each with its companion
Owner collector: an over-owner layout still fails (`Canonical owners touched: measured 4 exceeds hard
ceiling 3`) while root bookkeeping files fold into one repository-cluster owner (control clean).
Seam modules: six export lines in the declared seam module fail (`New public seam symbols: measured 6
exceeds hard ceiling 5`); the same lines in an undeclared module measure zero, which is why
`SEAM_MODULES` additions are recorded per slice - the declaration list is the fence.

### The pre-tenant session boundary (5B.2a, this PR's own invariant)
A forged token hash and a tampered signature each resolve to no principal (zero rows under the
session-token GUC policy), proven in the committed suite; exactly one registry operation carries
`authorityClass: 'pre-tenant'`. The full section 6 battery lands with the tenant tables (PR-2a', 2c).

## PR-2a' proofs (the split's second unit; raw transcripts: docs/evidence/pr2a2-transcripts.tar, sha256 de1b444e...)

### The named semantic-effect-smuggling mutation, on the household-register query itself (spec M-E 8's target)
With every non-semantic byte held constant, only the ADMITTED copy's canonicalSql lost its tenant
predicate - the exact mutated bytes are `SELECT id, name, record_origin FROM household ORDER BY name`
(` WHERE org_id = $1` deleted). Construction refused printing both digests: registry
`semfx.v1:0b428c3e...` != constructed `semfx.v1:b24a652f...`. An unregistered internal step against
the household table cannot obtain an id: `TS2339: Property 'enterHouseholdSneakyRead' does not exist`.

### The isolation companion for the tenant-RLS invariant this PR states (section 6 core; full battery in PR-2c)
In the committed suite, one non-superuser session (`current_user=verin_app, rolsuper=false`) proves:
the other tenant's rows genuinely exist (B-scoped count 2), a wrong-tenant read counts 0, the read
with the application predicate deleted returns only the scoped firm's three rows, an `or 1=1` bypass
still sees only them, a wrong-tenant write dies on the policy (`row-level security`), and
`CREATE TABLE` is refused (`permission denied`). The cross-tenant-token arm deferred from PR-2a runs
here too: Firm B's real token lists exactly Mensah and Vance, none of Firm A's book - in the suite
and in the browser.
Counter-run: with `ALTER TABLE household DISABLE ROW LEVEL SECURITY` in the scratch store the same
test FAILS (`expected 5 to be 2` - every firm's rows suddenly visible), and with ENABLE + FORCE
restored it passes: the test is load-bearing on the database, never on the application predicate.

## PR-2b proofs (the workspace; raw transcripts: docs/evidence/pr2b-transcripts.tar, sha256 906d1134...)

### The provenance rule against the first metric-class surface
A naked figure injected beside the honest one fails at file:line:
`metric-class render without provenance (no source/asOf): <p>{view.household.recordCount.count}</p>` -
including inside the bracketed dynamic route. The shipped figure renders only through the
provenance-carrying `DisplayMetric` (label, value, source, asOf, and the ADR-0022-style watermark
whenever any input is a demonstration record). The first attempt of this arm used a mistyped base
sha, so the collector honestly saw no diff; the transcript keeps both runs.

### The watermark is load-bearing, not decorative
Suppressing the demonstration flag on the workspace figure fails the browser proof at exactly the
watermark assertion (`getByText('demonstration - not a compliance record') ... not found`); restored,
it passes. A demonstration-derived figure cannot render clean while that assertion stands.

### Honest absence and the no-leak workspace
`recorded_at` lands NULLABLE with no default - a default cannot answer for rows that already exist,
so a row without one renders "recorded date not on file" and the derived figure is withheld rather
than minted. A malformed id parses before any store work; another firm's real id resolves to the same
honest not-found through the grant-scoped read (committed suite and browser both), so existence never
leaks across the tenant boundary.

## PR-2c proofs (the session and the journey; raw transcripts: docs/evidence/pr2c-transcripts.tar, sha256 e1263642...)

### Renewal and rotation on the cookie-writing path only (5B, spec M-C)
The proxy - Next's always-Node cookie-writing path - is the ONE place rotation lives: one closed
store operation slides a session past its half-life (rotate token, reset created_at, extend expiry in
a single guarded UPDATE), and the fresh value is handed to the downstream render through a stripped,
proxy-owned header. The committed lifecycle test proves the arc: a fresh session does not rotate; the
read-only path resolves the same cookie twice and never rotates; slid past the half-life from outside
the app, the session rotates exactly once; the second resolution in the same request reads the
handed-off id (M-C: never a 401 at the half-life); the rotated-away id is genuinely gone; a freshly
rotated session does not rotate again. In the browser: the advisor stays signed in across the slide
with the cookie value visibly rotated, twice. A probe transcript in the bundle records why migration
004 replaces the session policy whole: PostgreSQL also requires the post-update row to satisfy USING.

### The full section 6 battery, re-run with its counter-run
The committed battery re-ran whole and green; with row-level security disabled it FAILS
(`expected 5 to be 2`); restored with ENABLE + FORCE it passes again.

### The journey anyone can complete
The committed keyboard-only spec drives sign-in, the register and the workspace with no pointer:
typed credentials, native Enter submission, the Tab ring walked to the first row, Enter opening the
workspace, axe clean at the destination.

### The GD-003 sharpening's companion (the E16 PII scan)
Real account references still fail in every position and form: spaced, hyphenated and bare in
ordinary log fields; bare in a correlation key when not a minted id; bare smuggled INTO the minted
list but sitting in a non-correlation key; and a spaced reference can never be laundered through the
minted list (shape-bounded). Exactly one case is excluded - an all-digit minted span id in its own
correlation key - which is the ~4 percent flake the independent pass measured, cured.

## PR-3a proofs (prompt 3 section 6; raw transcripts with every arm's exact injected bytes and its revert: docs/evidence/pr3a-transcripts.tar, sha256 78e6a1f4...; the restored green run closes the bundle)

### The PII battery (M-A), containment (M-B), bounds (M-C)
Four sinks x three reference forms refused naming operation, form and boundary (bundle end to end via
a superuser-injected row; serialization; render; the emission guard); the three legitimate
identifiers pass, the minted all-digit correlation id in its correlation key named explicitly
(GD-003's exact ruled class), while smuggled or out-of-key digits still refuse; a cast and a
JSON.parse fill fail the build at src/evidence/projection.ts:23/:24. M-B: scratch-projection.ts:2
imports PII-bearing bundle.ts, build FAIL. M-C: the LIMIT deleted from both declared copies fails
naming observation_list_for_household_v1; from one copy, construction refuses printing both digests.

### The E16 battery (M-E)
Span, metric and log each deleted from evidence.assemble fail naming the operation and emission while
the source still greps clean; an unshipped registered row with no unreachableInSlice fails the other
direction; the unregistered bounded read refuses three ways (TS2339 twice, the sealed rule at
sneaky.ts:3); the raw client fails by import (bundle.ts:10) and by parameter (the multiset naming op,
gateway, id); a raw span-attribute label refuses at runtime in all three forms; minted-list smuggling still fails the shape-bounded scan.

### Serialization, the store, and the GD-004 companions
One digest across TZ=America/New_York and Asia/Tokyo (evb.v1:f927338c...); preflight proven on a
virgin store (0 of 5) and an upgraded slice-2 store (4 of 5, only 005, then observations only); every
demonstration row reads record_origin='demo-seed' and APP_ENV=production refuses the seed whole.
Three extra exports in the declared seam module fail E5 (measured 5 exceeds hard 4), the same lines
undeclared measure nothing, the table removed fails E5 closed, and the correlation table disagreeing
fails E16 naming the row.

## PR-3b proofs (prompt 3 section 6, the restack's second unit; raw transcripts with exact injected bytes: docs/evidence/pr3b-transcripts.tar, sha256 85bae983...; the restored green runs close the bundle)

### Vacuity (M-D), conflict, freshness
The assembly against a household with no observations returns typed absences for every vocabulary
kind and the surface renders each with its real next step, asserted in the committed suite and
against the rendered page; the absent-card render deleted from the surface fails the browser proof at
`toHaveCount(4)` - a vacuity page can never pass as fine. The assembly mutated to reconcile a
disagreement by recency fails exactly `retains BOTH sides of a disagreement as a typed conflict`
(31 others green); the band mutated to measure against the process clock instead of the supplied asOf
fails exactly `measures freshness against the supplied asOf`.

### The two P1 findings from PR-3a's review, fixed with companions (GD-005)
The as-of filter deleted from both declared copies fails exactly `retrieves at the bundle's own
instant: an observation recorded after asOf does not exist yet`; the over-fetch refusal deleted fails
exactly `refuses to derive completeness claims over a truncated read` (`promise resolved ... instead
of rejecting`). Shipped, the year-2000 retrieval returns typed absences and 201-of-201 rows refuses.

### The receded treatment and the complete axe scan
Delgado renders stale faded-but-readable, aging banded, both conflict sides retained with pills
outside the fade; Okonkwo renders four typed-absence cards; both pass the complete WCAG 2.2 AA set.
The meta-darkening rule deleted from the fade fails the scan with a real `color-contrast` violation -
the treatment is load-bearing, not decorative.

## PR-4a proofs (prompt 4 section 6, the restack's first unit; raw transcripts with exact injected bytes: docs/evidence/pr4a-transcripts.tar, sha256 ea0afe85...; the restored green run closes the bundle)

### The batteries, the migration and seed, and the GD-006 companions
M-A: bytes edited in place (six months re-inked to nine under replica role) refuse naming BOTH
digests, then the exact original bytes resolve again. M-C: a never-published hash returns the typed
NotFound carrying no policy field. M-D: the bound identity cannot be rebound - no app-role write, and
the trigger refuses a superuser's UPDATE and DELETE. M-F: expression, interpolation, embedded query,
unknown key and out-of-vocabulary value each refuse naming the path, zero store writes. Preflight
proven virgin (0 of 6) and upgraded (6 of 6); the seed publishes both firm documents through the real
publish path, origin named at every insert, duplicates skipped, APP_ENV=production refused whole.
M-G: the span deleted from publish, the metric from resolveByHash, and every policy emission left in
source but unreachable each fail E16 naming the operation and emission; the phantom activate fails
the other direction; the unregistered store write fails to build (TS2339), a forged
GovernedOperationId fails the sealed rule at sneaky.ts:2, and appendVersion borrowed under
resolveByHash fails parent linkage; the raw client fails by import (registry.ts:8) and the exported
pool trips the probe; the prefixed identity and whole document bytes refuse on cardinality. Five
extra seam exports fail E5 (7 exceeds hard 6), the same lines undeclared measure nothing, the removed
row-set fails E5 closed, and the correlation table disagreeing fails E16 naming the row.

## PR-4b proofs (prompt 4 section 6, the restack's second unit; raw transcripts with exact injected bytes: docs/evidence/pr4b-transcripts.tar, sha256 d10dc210...; the restored green run closes the bundle)

### The batteries, the harness, and the companions
M-B: nine months published as a NEW version becomes what the sequence derives as in force, while
every previously recorded identity keeps resolving to its own bytes and figures, and nothing was in
force before the first publish (NotFound naming the firm, no policy field). M-C: a superuser-deleted
interior row refuses naming the gap ("sequence number 2 is missing") on both history and in-force;
an empty firm resolves to the typed NotFound naming the firm. M-E: the sequence check refuses an
empty history outright. M-G: the log deleted from resolveInForce fails E16 naming the operation and
emission; the LIMIT deleted from both copies fails the committed bounded-read assertion naming the
statement, and from one copy refuses construction printing both digests; in-force mutated off the
greatest-at-or-before rule fails M-B by name; the vacuous empty-history check fails M-C/M-E by name.
The amplification harness prints BOTH regimes with their diffs (first-encounter gross 4, steady-state
gross 4 - the coupled browser assertion recurs, so the ruled clause excludes nothing) and states the
product path: a firm's policy change is a published version at zero repository diff.

## PR-5a-i proofs (prompt 5 section 6, the announced split's first unit; raw transcripts with every arm's exact injected bytes and its revert: docs/evidence/pr5a1-transcripts.tar, sha256 4f9da407...; battery head 79572d363a946da9b039dbd3caccf38f48b0c6ad - the PR head differs only by this evidence commit)
- M-G closure arms 01-09: a governed-gateway import, a Date.now() call, a process.env read, a raw pg client, a node:https import, a helper-root repoint, an empty graph, an allowlist superset and an answer-key read each fail DecisionPureClosure by name with file:line (arms 02b/03b capture the static refusals; arms 02/03 the capability-denied realm dying on 'Date.now' and 'process.env'); arm 03 exposed the member-access hole in the ambient-global scan, sharpened in this PR so process.env is caught on its expression side.
- M-G emission arms 10/10b/10c: the span, then the metric, then the structured log deleted from route.decision - E16 fails each time naming that operation; arm 11 registers decision.ghost with no unreachableInSlice and fails the other direction; arm 12 leaves emissions in source but unexercised and still fails.
- M-H: the typed entry refuses RequestCorrelation at compile time (arm 13, TS2345); a DecisionId cannot be minted from a RequestId (arm 14, TS2345); a sealed cast fails the sealed-factory rule (arm 15); the runtime arms (a 32-hex request id and a req:-prefixed string refused naming the missing dov.v1 domain, the gateway refusing the wrong kind) run in-suite; the pre-evaluate decision correlation is a CONSTRUCTION result (transcript 18): no factory exists to call before an outcome digest exists.
- M-C (arm 16): the attestation check stubbed to true TYPECHECKS and the sample battery fails on 'sample-blocked produced proceed' - the first sample set survived this stub and was sharpened until it killed it, recorded rather than smoothed.
- M-F and the M-I capture-off half (transcript 17): the capability-denied runner is byte-identical across America/New_York and Asia/Tokyo, twice per case; the capture-on half runs in-suite against the same digests; the restored green run closes the bundle (49 unit tests, E16 PASS over the fresh capture).

## PR-5a-ii proofs (prompt 5 section 6, the announced split's second unit; raw transcripts with every arm's exact injected bytes and its revert: docs/evidence/pr5a2-transcripts.tar, sha256 2a909069...; battery head 4907ef20 - the PR head differs only by this evidence commit)
- M-C (arm 20): the reserve arithmetic stubbed to an effective liquidity of zero TYPECHECKS and the battery fails on 'Henderson at 75000 must proceed, got blocked' - a PASS-emitting check that survives a stubbed implementation is not a check. [RECONCILED by the PR-5a-iii ruling: the original transcript's recorded check command was the narrow filter `vitest run src/tools/e16.test.ts -t "computes a LIVE proceed"`, which the independent pass showed failing on the CLEAN tree too - vacuous as recorded. Transcript 20 is HISTORICAL; the operative evidence is transcript 20b in docs/evidence/pr5a3-transcripts.tar: the same mutation under the FULL-FILE battery, with the clean-tree control passing 48/48 first and the mutation killing the three reserve tests by name.]
- Rule-removal counterexamples: the material-conflict rule deleted (arm 21) and the regulatory-precedence rule deleted (arm 22). [RECONCILED by the PR-5a-iii ruling: this entry originally attributed arm 21 to 'the Delgado battery' and arm 22 to 'the Ashford battery', but BOTH original transcripts recorded the same narrow filter `-t "prohibits a LIVE legal hold"`, which also failed on the clean tree - misattributed AND vacuous as recorded. Transcripts 21/22 are HISTORICAL; the operative evidence is 21b/22b in docs/evidence/pr5a3-transcripts.tar under the full-file battery with passing clean-tree controls: 21b kills the conflict assertion (the blocker set collapses to 'reserve-evidence-missing' where 'material-evidence-conflicting' is demanded), 22b kills the prohibition ('Ashford must prohibit, got proceed') - one test carries both assertions, which is why the honest attribution names assertions, not households.]
- The ratified typed-silence counterexample (arm 23): the not-stated approver role DEFAULTED to operations - the forbidden invented approval - typechecks and fails the Mensah battery on 'must refuse on the typed silence, got proceed'; the shipped rule refuses instead, with an empty resolving-evidence list because only a policy version stating the value can resolve it.
- The two PR-5a-i falsification-ruling obligations, discharged here: transcript 06b regenerates the helper-root arm with ONLY the quoted repoint as its injection - no untracked file is presupposed, the diff is the whole mutation, and the closure refuses naming 'src/decision/helper.ts does not exist; the closure root is gone' on both the graph and edge assertions; and the bare-state visit with a settled-axe assertion now ships as a committed spec beside the operator form (the e2e's bare-form state, asserted before any request exists).
- The restored green run (transcript 24): 52 unit tests, and the capability-denied runner byte-identical across America/New_York and Asia/Tokyo.
- The live axe battery runs in-suite: all three dispositions live (proceed with stages/key/figures, blocked breach with arithmetic, prohibited hold with the stamp and zero affordances), firm B's configuration-only bank-change block, the typed-silence refusal, the bare form and its refusal state - 19 browser proofs with settled axe, screenshots indexed in the gallery.

## PR-5a-iii proofs (prompt 5 section 6, the announced split's third unit; raw transcripts: docs/evidence/pr5a3-transcripts.tar, sha256 50af5c18...; battery head 35d95ff0 - the PR head differs only by this evidence commit). Every transcript in this tar opens with the CLEAN-TREE CONTROL of its exact check command PASSING before the mutation lands - the standing rule from this PR's own carried ruling: a check that fails identically without the mutation is vacuous.
- M-A, the reader half (arm 30): `evaluate`'s input path made to read `expectedDisposition` from the reader - the closure suite fails naming the file and the field ('src/tools/signed-cases.ts reads answer-key fields: expectedDisposition').
- M-A, the engine half (arm 31): the same read injected into src/decision/outcome.ts - refused naming that file:line.
- Closure containment (arm 32): the decision closure made to import the expectations reader - the bidirectional allowlist equality fails (the reachable graph grows past the allowlist) and the forbidden-import assertion fires.
- M-C, extraction stubbed (arm 33): the prose-quantity extraction stubbed - typechecks, and the battery fails on 'Henderson at 75000 must proceed, got blocked' plus the breach arithmetic test.
- The comparison vocabulary is load-bearing (arm 34): one mapping broken and the four-canonical test fails on 'GC-01-firm-a-happy-path must match the signed truth exactly'.
- The carried PR-5a-ii obligation, discharged here: transcripts 20b/21b/22b regenerate the three vacuous arms under the FULL-FILE battery with passing clean-tree controls (see the reconciled PR-5a-ii entries above).
- The restored green run (green-restored.txt): 53 unit tests at the battery head.
