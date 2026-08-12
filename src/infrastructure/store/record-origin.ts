/**
 * WHERE A ROW CAME FROM - a fact about the RECORD, not about the value in it
 * (ADR-0057, charter #3/#7).
 *
 * `prov_source` answers "where did this VALUE come from?" and changes when a
 * human edits the value: an advisor who renames a seeded household has entered
 * that name, and labeling it `fixture` beside a receded "Sample data" badge is
 * the mislabel this repository fences everywhere else.
 *
 * `record_origin` answers a different question - "who put this ROW here?" - and
 * NEVER changes, because editing a demonstration record does not make it the
 * firm's own. The clean-slate guarantee is that a production instance holds zero
 * demonstration records, so the sweep counts THIS column: keying it on
 * `prov_source` would let a demonstration household survive into production
 * simply because somebody typed a new name over it.
 *
 * Two facts, two columns, and neither may answer the other's question.
 */
export const RECORD_ORIGINS = ["firm-record", "world-fixture", "demo-seed"] as const;
export type RecordOrigin = (typeof RECORD_ORIGINS)[number];

/** What a row this firm's own flows wrote carries. The column's DDL default, so
 * a write that predates this distinction is a firm record rather than nothing. */
export const FIRM_RECORD_ORIGIN: RecordOrigin = "firm-record";

/** What the demonstration world's projection writes, and exactly what the
 * clean-slate sweep counts and a purge removes. */
export const WORLD_FIXTURE_ORIGIN: RecordOrigin = "world-fixture";

/** What the demonstration SEED writes outside the world's CRM projection - the
 * synthetic decision chain `pnpm db:seed` records so the audit-chain gate has a
 * real chain to verify. It is not the world, so it does not borrow the world's
 * name; it is demonstration data, so it is classified below. */
export const DEMO_SEED_ORIGIN: RecordOrigin = "demo-seed";

/** The origins a production instance must contain none of. A list rather than a
 * negation of `FIRM_RECORD_ORIGIN`, so a future demonstration origin has to be
 * classified here rather than defaulting into the clean half. */
export const DEMONSTRATION_ORIGINS: readonly RecordOrigin[] = [WORLD_FIXTURE_ORIGIN, DEMO_SEED_ORIGIN];

/** The column carrying it, named once: the sweep, the seed and the fence all
 * read this rather than three string literals that can drift apart. */
export const RECORD_ORIGIN_COLUMN = "record_origin";
