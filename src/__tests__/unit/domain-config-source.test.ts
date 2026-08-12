import { beforeEach, describe, expect, it, vi } from "vitest";
import { toResponse, type AppError } from "@contracts/errors";
import { CLIENT_RETRY, clientRetryFor } from "@contracts/client-retry";
import { MACHINE_RECORD_ID_RE } from "@contracts/record-id";

/**
 * WHAT A CONFIGURATION REFUSAL SAYS, AND TO WHOM (D-240/D-242).
 *
 * `toResponse` returns an `AppError`'s message verbatim, and these refusals used
 * to build it from `formatDomainConfigErrors` output - dotted document paths and
 * per-stage loader messages - and, for a drifted document, the pinned and read
 * SHA-256 hashes plus the version id. That reached a BROWSER through the intake
 * route and an EXTERNAL e-sign provider through the webhook's JSON body.
 *
 * The rule these assert is not "say less": it is that the diagnosis and the
 * sentence go to DIFFERENT audiences and are joined by a correlation id, so
 * narrowing the message costs nothing an operator needs.
 *
 * AND THE DESTINATION IS PROVEN TO CARRY IT. The first attempt routed the
 * diagnosis into `AppError.context` as prose, which nothing reads and which this
 * repository's log formatter would have censored anyway - so everyone believed the
 * information existed and it went nowhere. These tests therefore read the BYTES
 * THE REAL LOGGER EMITS, through the real `loggerOptions`, rather than the object
 * handed to it.
 */
const emitted = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock("@infra/observability/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@infra/observability/logger")>();
  const { default: pino } = await import("pino");
  const probe = pino(actual.loggerOptions, {
    write(chunk: string) {
      emitted.lines.push(chunk);
    },
  });
  return { ...actual, log: probe };
});

/**
 * A ROOT-LEVEL loader failure, which is the one shape `firstFault` has to treat
 * differently: `loadDomainConfig` emits an EMPTY path for a document that is not a
 * plain record, and a schema issue at the document root joins to one too. Sealing
 * that empty string printed "[REDACTED]" on the operator's line for exactly those
 * failures, which reads as a value withheld for safety rather than one the loader
 * never had. Injected here because `config/domains/` is content-hash pinned: a
 * document authored to fail this way cannot be published.
 */
const injected = vi.hoisted(() => ({ fault: null as null | { code: string; path: string; message: string } }));

vi.mock("@domain/config/load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@domain/config/load")>();
  return {
    ...actual,
    loadDomainConfig: (input: unknown) =>
      injected.fault === null ? actual.loadDomainConfig(input) : { ok: false as const, error: [injected.fault] },
  };
});

const { ACCOUNT_OPENING_DOMAIN, configuredRefusal, loadIntakeForm, loadPublishedDomainConfig } =
  await import("@infra/config/domain-config-source");
const { makeExecutionAdapters } = await import("@infra/execution-adapters");
const { systemWriteActor } = await import("@contracts/principal");

/** A published document this file loads NOWHERE else, so no memoized success hides the injection. */
const UNMEMOIZED_DOMAIN = "money-movement";

const HEX_DIGEST = /[0-9a-f]{32}/;
const DOTTED_DOCUMENT_PATH = /\b[a-z]+\.[a-z][A-Za-z-]+\.[A-Za-z-]+/;
const REDACTED = "[REDACTED]";

function refusalOf(domainConfigId: string) {
  const sourced = loadPublishedDomainConfig(domainConfigId);
  expect(sourced.ok, `${domainConfigId} must not resolve`).toBe(false);
  if (sourced.ok) throw new Error("unreachable");
  return sourced.error;
}

/** The last line the REAL logger actually wrote, parsed back from its bytes. */
function lastLogLine(): Record<string, unknown> {
  const line = emitted.lines.at(-1);
  expect(line, "the refusal emitted no log line at all").toBeDefined();
  return JSON.parse(String(line)) as Record<string, unknown>;
}

describe("the domain-configuration source refuses without leaking its diagnosis", () => {
  beforeEach(() => {
    emitted.lines = [];
    injected.fault = null;
  });

  it("is not asserting on a broken baseline: the shipped document DOES resolve", () => {
    expect(loadIntakeForm(ACCOUNT_OPENING_DOMAIN).ok).toBe(true);
  });

  it.each([
    ["Not A Published Id", "unpublished"],
    ["no-such-published-domain", "unpublished"],
  ])("answers %s with one generic sentence and a reference", (domainConfigId, stage) => {
    const error = refusalOf(domainConfigId);
    const correlationId = error.context?.["correlationId"];
    expect(typeof correlationId).toBe("string");
    expect(MACHINE_RECORD_ID_RE.test(String(correlationId))).toBe(true);
    // The reference is ON THE WIRE - that is the whole point of narrowing the
    // message - and the diagnosis is NOT.
    expect(error.message).toContain(String(correlationId));
    expect(error.message).not.toMatch(HEX_DIGEST);
    expect(error.message).not.toMatch(DOTTED_DOCUMENT_PATH);
    expect(error.message).not.toContain(domainConfigId);
    // ...and the same message is what a client actually receives.
    expect(toResponse(error).body.error.message).toBe(error.message);
    expect(error.context?.["stage"]).toBe(stage);
    // The refusal states its own instruction through its CAUSE, so no surface has
    // to know which failures are operator-recoverable (D-241).
    expect(clientRetryFor(error, CLIENT_RETRY.none)).toBe(CLIENT_RETRY.later);
  });

  it("mints a DISTINCT reference per refusal, so two incidents never share a log line", () => {
    const first = refusalOf("no-such-published-domain").context?.["correlationId"];
    const second = refusalOf("no-such-published-domain").context?.["correlationId"];
    expect(first).not.toBe(second);
  });

  it("emits the diagnosis to the operator as REGISTERED values the formatter passes through", () => {
    const error = refusalOf("no-such-published-domain");
    const line = lastLogLine();
    // The join between the sentence a client quotes and the line an operator reads.
    expect(line["correlationId"]).toBe(error.context?.["correlationId"]);
    // The stage and the document, structured - so an operator can ask for every
    // refusal at a given stage for a given document, which prose could not answer.
    expect(line["configStage"]).toBe("unpublished");
    expect(line["domainConfigId"]).toBe("no-such-published-domain");
    expect(line["msg"]).toBe("domain configuration could not be resolved");
    expect(line["level"]).toBe(50);
    // Nothing here degraded: that is the check whose absence let a dead channel ship.
    expect(Object.values(line)).not.toContain(REDACTED);
  });

  it("degrades a diagnosis value that is not the shape it declares, rather than logging it", () => {
    // A document id is checked BEFORE it reaches the filesystem, so this refusal
    // is the one that can carry a value from outside the closed shape.
    refusalOf("Not A Published Id");
    expect(lastLogLine()["domainConfigId"]).toBe(REDACTED);
  });

  it("states WHICH loader fault it is, beside where - the most diagnostic bit of all", () => {
    injected.fault = { code: "unknown-reference", path: "intents.open-account.slots.email", message: "no such slot" };
    refusalOf(UNMEMOIZED_DOMAIN);
    const line = lastLogLine();
    expect(line["configStage"]).toBe("invalid");
    // A stage and a path with no statement of the fault left the most common
    // refusal saying only that something, somewhere, was wrong with the document.
    expect(line["configCode"]).toBe("unknown-reference");
    expect(line["configPath"]).toBe("intents.open-account.slots.email");
    expect(Object.values(line)).not.toContain(REDACTED);
  });

  it.each([
    ["a document that is not a plain record", { code: "not-inert", path: "", message: "must be a plain data record" }],
    ["a schema issue at the document ROOT", { code: "grammar", path: "", message: "required" }],
  ])("reports %s as having NO path, never as a censored one", (_case, fault) => {
    // An empty loader path used to be sealed, printing "[REDACTED]" for exactly
    // the root-level failures - which an operator reads as a value withheld for
    // safety rather than one the loader never had.
    injected.fault = fault;
    refusalOf(UNMEMOIZED_DOMAIN);
    const line = lastLogLine();
    expect(line).not.toHaveProperty("configPath");
    expect(line["configCode"]).toBe(fault.code);
    expect(Object.values(line)).not.toContain(REDACTED);
  });

  it("answers a surface asking for copy the document does not declare, through the same mint", () => {
    // The stage a demo station page raises when the document loaded and BOUND and
    // then said none of the words it renders (D-251). It is kept apart from
    // `unbindable` because the firm supplied everything the document asked of it -
    // an operator sent to the firm registry would be looking in the wrong place.
    const error = configuredRefusal(UNMEMOIZED_DOMAIN).undeclaredCopy({
      code: "incomplete",
      path: "presentation.copy.slots.household",
      message: "no copy for a label this journey renders",
    });
    const correlationId = error.context?.["correlationId"];
    expect(error.message).toContain(String(correlationId));
    expect(error.message).not.toMatch(DOTTED_DOCUMENT_PATH);
    expect(clientRetryFor(error, CLIENT_RETRY.none)).toBe(CLIENT_RETRY.later);
    const line = lastLogLine();
    expect(line["correlationId"]).toBe(correlationId);
    expect(line["configStage"]).toBe("undeclared-copy");
    expect(line["configPath"]).toBe("presentation.copy.slots.household");
    expect(Object.values(line)).not.toContain(REDACTED);
  });
});

/**
 * THE COMMAND ADAPTERS, WHICH ANSWER FOR THE PUBLISHED DOCUMENT TOO (D-247).
 *
 * They were the last site outside the mint, and being outside it cost all three
 * halves of the channel at once: the configured command type and payload field id
 * went to the EXTERNAL e-sign provider verbatim through `toResponse`, the unmarked
 * error made the webhook answer an unpaced 500 against a fault only an operator
 * clears, and no log line was emitted at all. Driven through the REAL port here,
 * because the fence proves the SHAPE and only running it proves the channel.
 */
describe("a command adapter refuses through the same mint as every other stage", () => {
  beforeEach(() => {
    emitted.lines = [];
    injected.fault = null;
  });

  /** A compiled command whose payload is missing a field its runner requires. */
  async function adapterRefusal(commandType: string, payload: Record<string, string>) {
    const adapters = makeExecutionAdapters(
      // Never reached: every refusal below is raised before the first write.
      null as never,
      systemWriteActor("esign-webhook", "org-1"),
      configuredRefusal(ACCOUNT_OPENING_DOMAIN),
    );
    const starter = systemWriteActor("esign-webhook", "org-1");
    return adapters.invoke(
      { capabilityId: "household-create", commandType, payload, idempotencyKey: "k" },
      starter.tenant,
    ).then(
      () => { throw new Error("the adapter must refuse"); },
      (error: unknown) => error as AppError,
    );
  }

  it.each([
    ["a payload field the compiled command did not carry", "household.create", {}, "household-create"],
    ["a command type this build ships no runner for", "no.such.command", { name: "n" }, "household-create"],
  ])("answers %s with the generic sentence, a reference, and retry-later", async (_case, commandType, payload, capabilityId) => {
    const error = await adapterRefusal(commandType, payload);
    const correlationId = error.context?.["correlationId"];
    expect(typeof correlationId).toBe("string");
    expect(error.message).toContain(String(correlationId));
    // NOT on the wire: the configured command type, the payload field, the path.
    expect(error.message).not.toContain(commandType);
    expect(error.message).not.toMatch(DOTTED_DOCUMENT_PATH);
    expect(toResponse(error).body.error.message).toBe(error.message);
    // The instruction is INHERITED from the cause, which is what turns the
    // webhook's unpaced redeliver-forever 500 into a paced 503 + Retry-After.
    expect(clientRetryFor(error, CLIENT_RETRY.sameIdentity)).toBe(CLIENT_RETRY.later);
    // ...and the operator gets the location, as registered structured values.
    const line = lastLogLine();
    expect(line["correlationId"]).toBe(correlationId);
    expect(line["domainConfigId"]).toBe(ACCOUNT_OPENING_DOMAIN);
    expect(String(line["configPath"])).toContain(capabilityId);
    expect(Object.values(line)).not.toContain(REDACTED);
  });

  it("files a registration the store cannot hold as a configuration fault, never a submitter's", async () => {
    // As a VALIDATION this answered the e-sign callback 422 do-not-retry, which
    // discards a signature event outright - and no submission can reach it, since
    // the request boundary already admits only the document's own vocabulary.
    const error = await adapterRefusal("application.create", {
      householdId: "h", contactId: "c", accountType: "not-a-registration",
    });
    expect(error.code).toBe("INTERNAL");
    expect(clientRetryFor(error, CLIENT_RETRY.none)).toBe(CLIENT_RETRY.later);
    expect(error.message).not.toContain("not-a-registration");
    expect(lastLogLine()["configPath"]).toBe("execution.capabilities.household-create.payload.accountType");
  });
});
