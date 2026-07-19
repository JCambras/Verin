/**
 * The ONE config module (ADR-0003, charter #7). The only place process.env is
 * read (fence: no-process-env). Zod-validated; getConfig() throws at boot on
 * invalid config. Production superRefine guards refuse to boot on a dangerous
 * config (test placeholders, wrong store driver) — fail closed, never degrade.
 */
import { z } from "zod";

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const PLACEHOLDER_SECRET = /^(ci-only|e2e-only|CHANGEME|change-in-prod)/i;

const schema = z
  .object({
    nodeEnv: z.enum(["development", "production", "test"]).default("development"),
    appEnv: z.enum(["development", "staging", "production"]).default("development"),
    appUrl: z.string().url().default("http://localhost:3000"),
    firmTimezone: z.string().refine(isValidTimezone, "must be a valid IANA timezone").default("America/New_York"),
    store: z.object({
      driver: z.enum(["pglite", "postgres"]).default("pglite"),
      dataDir: z.string().default(".verin-data"),
      databaseUrl: z.string().optional(),
    }),
    session: z.object({
      secret: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
      ttlMinutes: z.coerce.number().int().positive().default(60),
    }),
    esign: z.object({
      webhookSecret: z.string().min(32, "ESIGN_WEBHOOK_SECRET must be at least 32 characters"),
    }),
    log: z.object({ level: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info") }),
    otel: z.object({
      serviceName: z.string().default("verin"),
      endpoint: z.string().url().optional(),
    }),
  })
  .superRefine((cfg, ctx) => {
    // APP_ENV is the real deployment environment. NODE_ENV is set to "production"
    // by `next build`/`next start` even in dev/CI, so it must NOT gate these gates.
    if (cfg.appEnv === "production") {
      if (cfg.store.driver !== "postgres") {
        ctx.addIssue({ code: "custom", message: "PROD_REQUIRES_POSTGRES: production must use the postgres store driver", path: ["store", "driver"] });
      }
      if (cfg.store.driver === "postgres" && !cfg.store.databaseUrl) {
        ctx.addIssue({ code: "custom", message: "PROD_REQUIRES_DATABASE_URL", path: ["store", "databaseUrl"] });
      }
      if (PLACEHOLDER_SECRET.test(cfg.session.secret)) {
        ctx.addIssue({ code: "custom", message: "PROD_PLACEHOLDER_SESSION_SECRET: refusing a placeholder secret in production", path: ["session", "secret"] });
      }
      if (PLACEHOLDER_SECRET.test(cfg.esign.webhookSecret)) {
        ctx.addIssue({ code: "custom", message: "PROD_PLACEHOLDER_ESIGN_SECRET", path: ["esign", "webhookSecret"] });
      }
    }
  });

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

function readEnv(): unknown {
  return {
    nodeEnv: process.env.NODE_ENV,
    appEnv: process.env.APP_ENV,
    appUrl: process.env.APP_URL,
    firmTimezone: process.env.FIRM_TIMEZONE,
    store: {
      driver: process.env.VERIN_STORE_DRIVER,
      dataDir: process.env.VERIN_DATA_DIR,
      databaseUrl: process.env.DATABASE_URL,
    },
    session: {
      secret: process.env.SESSION_SECRET,
      ttlMinutes: process.env.SESSION_TTL_MINUTES,
    },
    esign: { webhookSecret: process.env.ESIGN_WEBHOOK_SECRET },
    log: { level: process.env.LOG_LEVEL },
    otel: {
      serviceName: process.env.OTEL_SERVICE_NAME,
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    },
  };
}

/** Validated config, cached. Throws FATAL at boot on invalid config. */
export function getConfig(): Config {
  if (cached) return cached;
  // Fail closed on the ONE var the whole guard stack keys on: `next start` forces
  // NODE_ENV=production, and an APP_ENV left unset would default to "development" —
  // silently skipping every production superRefine guard and issuing the session
  // cookie with secure:false. Dev/test (NODE_ENV != production) keep the default.
  if (process.env.NODE_ENV === "production" && !process.env.APP_ENV) {
    throw new Error(
      "FATAL: APP_ENV must be set explicitly (development|staging|production) when NODE_ENV=production — refusing to default to development",
    );
  }
  const parsed = schema.safeParse(readEnv());
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`FATAL: invalid configuration: ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: reset the cache so a new env can be validated. */
export function resetConfigForTests(): void {
  cached = null;
}
