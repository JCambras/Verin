/**
 * THE NON-DETERMINISM VOCABULARY (v3 prompt 11, ADR-0039).
 *
 * WHICH origins are banned and WHAT an operator is told each one is - pure
 * string and set algebra over origin NAMES, with no AST, no filesystem and no
 * scan state. The scanner's mutable state lives beside it in
 * `_corpus-nondeterminism-origins.ts`; holding the vocabulary apart from that
 * state is what stops a change to the walk from quietly widening (or narrowing)
 * what the fence reports.
 */
export type OriginSet = ReadonlySet<string>;

export const originSet = (...values: Array<string | undefined>): OriginSet | undefined => {
  const result = new Set(values.filter((value): value is string => value !== undefined));
  return result.size === 0 ? undefined : result;
};

export const mergeOrigins = (
  ...values: Array<OriginSet | undefined>
): OriginSet | undefined => {
  const result = new Set(values.flatMap((value) => [...(value ?? [])]));
  return result.size === 0 ? undefined : result;
};

/** Ambient host-I/O entry points, reported under their own bare name. */
export const HOST_GLOBALS: readonly string[] = [
  "fetch",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
];

/** Node modules whose every member is host I/O, reported as `<module>.<member>`. */
export const HOST_MODULES: readonly string[] = [
  "fs",
  "fs/promises",
  "child_process",
  "net",
  "http",
  "https",
  "http2",
  "dns",
  "dns/promises",
  "dgram",
  "tls",
];

export const hostIoApi = (api: string): boolean =>
  HOST_GLOBALS.includes(api) ||
  HOST_MODULES.some((module) => api.startsWith(`${module}.`));

export const CRYPTO_RANDOM_MEMBERS: ReadonlySet<string> = new Set([
  "randomUUID",
  "randomBytes",
  "randomFill",
  "randomFillSync",
  "randomInt",
  "getRandomValues",
  "generateKey",
  "generateKeySync",
  "generateKeyPair",
  "generateKeyPairSync",
  "generatePrime",
  "generatePrimeSync",
]);

const BANNED_CALLS: ReadonlySet<string> = new Set([
  "Math.random",
  "Date.now",
  "performance.now",
  ...[...CRYPTO_RANDOM_MEMBERS].flatMap((name) => [
    `crypto.${name}`,
    `crypto.webcrypto.${name}`,
    `crypto.subtle.${name}`,
    `crypto.webcrypto.subtle.${name}`,
  ]),
]);

const apiName = (origin: string): string =>
  origin.startsWith("crypto.") ? origin.split(".").at(-1)! : origin;

export const sensitiveOriginApi = (origin: string): string | undefined => {
  if (origin.endsWith(".[computed]")) return origin;
  if (origin === "eval" || origin === "Function") return origin;
  if (BANNED_CALLS.has(origin)) return apiName(origin);
  if (origin.startsWith("process.env")) return "process.env";
  if (origin.startsWith("process.hrtime")) return "process.hrtime";
  if (origin.startsWith("process.")) {
    return origin.split(".").slice(0, 2).join(".");
  }
  if (origin.startsWith("os.")) {
    return origin.split(".").slice(0, 2).join(".");
  }
  if (HOST_GLOBALS.includes(origin)) {
    return origin;
  }
  const hostModule = HOST_MODULES.find((candidate) => origin.startsWith(`${candidate}.`));
  if (hostModule !== undefined) {
    return origin.split(".").slice(0, 2).join(".");
  }
  return undefined;
};

export const moduleOrigin = (moduleName: string): string | undefined => {
  const normalized = moduleName.replace(/^node:/, "");
  if (normalized === "crypto") return "crypto";
  if (normalized === "process") return "process";
  if (normalized === "perf_hooks") return "performance";
  if (normalized === "os") return "os";
  return HOST_MODULES.includes(normalized) ? normalized : undefined;
};

/** Globals a `globalThis.<member>` / `global.<member>` hop may re-enter through. */
const AMBIENT_ROOTS: ReadonlySet<string> = new Set([
  "Math",
  "Date",
  "performance",
  "process",
  "crypto",
  "Intl",
  "eval",
  "Function",
  "fetch",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
]);

/** The seed origins every source file starts from - a FRESH map per file, so no
 * binding learned in one file can be believed in the next. */
export const initialOrigins = (): Map<string, OriginSet> =>
  new Map<string, OriginSet>([
    ["Math", new Set(["Math"])],
    ["Date", new Set(["Date"])],
    ["performance", new Set(["performance"])],
    ["process", new Set(["process"])],
    ["crypto", new Set(["crypto"])],
    ["Intl", new Set(["Intl"])],
    ["globalThis", new Set(["globalThis"])],
    ["global", new Set(["global"])],
    ["eval", new Set(["eval"])],
    ["Function", new Set(["Function"])],
    ["fetch", new Set(["fetch"])],
    ["WebSocket", new Set(["WebSocket"])],
    ["EventSource", new Set(["EventSource"])],
    ["XMLHttpRequest", new Set(["XMLHttpRequest"])],
  ]);

export const memberOrigin = (
  base: string,
  member: string,
): string | undefined =>
  base === "globalThis" || base === "global"
    ? AMBIENT_ROOTS.has(member) ? member : undefined
    : `${base}.${member}`;

export const memberOrigins = (
  bases: OriginSet | undefined,
  member: string,
): OriginSet | undefined => mergeOrigins(
  ...[...(bases ?? [])].map((base) => originSet(memberOrigin(base, member))),
);
