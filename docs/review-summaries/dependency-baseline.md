# pnpm-lock.yaml - bounded diff summary (bucket G qualification)

First lockfile of the program: the complete ratified baseline (ADR-0061 R-7; CONSTITUTION.md), frozen.
Regeneration is proven by the registered frozen-lockfile install, which must not modify it.

Application/runtime (eleven): next 16.3.1, react 19.2.8, react-dom 19.2.8, pg 8.23.0, zod 4.4.3,
@opentelemetry/api 1.9.1, @opentelemetry/sdk-trace-base 2.10.0, @opentelemetry/sdk-trace-node 2.10.0,
@opentelemetry/sdk-metrics 2.10.0, @opentelemetry/resources 2.10.0,
@opentelemetry/semantic-conventions 1.43.0.

Development/test/build (thirteen): typescript 6.0.3, @types/node 22.20.1, @types/react 19.2.18,
@types/react-dom 19.2.4, @types/pg 8.23.1, vitest 4.1.11, @playwright/test 1.62.1,
@axe-core/playwright 4.13.0, eslint 9.39.5, typescript-eslint 8.67.0, prettier 3.9.6, ts-morph 28.0.0,
tsx 4.23.12.

Every entry is exact-pinned; no range appears anywhere in the manifest; the manifest, this lockfile and
CONSTITUTION.md carry the same string for all twenty-four entries (asserted by E11 on every run).

Also the bounded summary for `docs/evidence/verin-0.2.0.cdx.json`: generated from this same frozen
lockfile by `corepack pnpm db sbom` (291 components, sorted, no timestamps), subject
`docs/evidence/verin-0.2.0.tgz`; E15 proves its component set equal to the lockfile's both ways.
