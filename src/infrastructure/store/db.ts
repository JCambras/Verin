/**
 * The swappable SQL driver (ADR-0004, D-006). PGlite (real Postgres, WASM) in
 * dev/CI; a node-postgres adapter behind this same interface in production. SQL is
 * portable Postgres, so nothing above this file changes when the driver swaps.
 * This interface is infra-internal — domain never sees SQL.
 */
import { PGlite } from "@electric-sql/pglite";
import { resolve, isAbsolute } from "node:path";
import { getConfig } from "@infra/config";
import { appError } from "@contracts/errors";
import { MIGRATION_SQL } from "./migrations";

export interface SqlResult<T> {
  rows: T[];
}

export interface SqlQueryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<T>>;
}

export interface SqlDb extends SqlQueryable {
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T>;
  /** Dump the whole store for backup (ADR-0019). */
  dump(): Promise<Blob>;
  close(): Promise<void>;
}

function wrap(pg: PGlite): SqlDb {
  // PGlite is a single connection and cannot run concurrent queries. Serialize
  // every top-level operation (query/exec/transaction) so overlapping HTTP
  // requests never collide on the one instance. A transaction holds the lock for
  // its whole duration, preserving atomicity.
  let lock: Promise<unknown> = Promise.resolve();
  function serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = lock.then(op, op);
    lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    query<T>(sql: string, params?: unknown[]): Promise<SqlResult<T>> {
      return serialize(async () => {
        const res = await pg.query<T>(sql, params as unknown[] | undefined);
        return { rows: res.rows };
      });
    },
    exec(sql: string): Promise<void> {
      return serialize(async () => {
        await pg.exec(sql);
      });
    },
    transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> {
      return serialize(() =>
        pg.transaction(async (tx) => {
          const q: SqlQueryable = {
            async query<U>(sql: string, params?: unknown[]) {
              const res = await tx.query<U>(sql, params as unknown[] | undefined);
              return { rows: res.rows };
            },
          };
          return fn(q);
        }) as Promise<T>,
      );
    },
    dump(): Promise<Blob> {
      return serialize(async () => {
        const file = await pg.dumpDataDir("none");
        return file as Blob;
      });
    },
    async close(): Promise<void> {
      await pg.close();
    },
  };
}

/** Restore a store from a backup dump (ADR-0019 — used by the backup-restore drill). */
export async function createDbFromDump(dump: Blob): Promise<SqlDb> {
  const pg = new PGlite({ loadDataDir: dump });
  await pg.waitReady;
  return wrap(pg);
}

/** Create a fresh in-memory store (tests) or a directory-backed store (dev). */
export async function createDb(opts?: { dataDir?: string | null }): Promise<SqlDb> {
  const cfg = getConfig();
  if (cfg.store.driver === "postgres") {
    // Deferred (D-006 / sacrificial register): production adapter not built yet.
    throw appError("STORE_UNAVAILABLE", "postgres store adapter is deferred (ADR-0004/D-006); use VERIN_STORE_DRIVER=pglite for dev/CI");
  }
  const configured = opts && "dataDir" in opts ? opts.dataDir : cfg.store.dataDir;
  // Resolve relative dirs to an absolute path so every process (seed, server)
  // opens the SAME store regardless of its working directory.
  const dataDir = configured && !isAbsolute(configured) ? resolve(process.cwd(), configured) : configured;
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = wrap(pg);
  await db.exec(MIGRATION_SQL);
  return db;
}

// App-process singleton. Stored on globalThis because Next.js bundles route
// handlers and server components/actions SEPARATELY — a module-local singleton
// would be instantiated once per bundle, opening two independent PGlite instances
// (writes to one invisible to the other). globalThis is shared across bundles, so
// there is exactly ONE store per process.
const globalStore = globalThis as unknown as { __verinDb?: Promise<SqlDb> };
export function getDb(): Promise<SqlDb> {
  if (!globalStore.__verinDb) {
    const creating = createDb();
    globalStore.__verinDb = creating;
    // A rejected promise must not be memoized: a transient startup failure (dataDir
    // lock held by a finishing seed) would otherwise fail every request until restart.
    creating.catch(() => {
      if (globalStore.__verinDb === creating) globalStore.__verinDb = undefined;
    });
  }
  return globalStore.__verinDb;
}

/** Test-only: an isolated in-memory db. */
export function createMemoryDb(): Promise<SqlDb> {
  return createDb({ dataDir: null });
}
