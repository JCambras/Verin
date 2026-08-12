import { beforeEach, describe, expect, it, vi } from "vitest";
import { toResponse } from "@contracts/errors";
import { CLIENT_RETRY, clientRetryFor } from "@contracts/client-retry";
import { MACHINE_RECORD_ID_RE } from "@contracts/record-id";

/**
 * WHAT A CONFIGURATION REFUSAL SAYS, AND TO WHOM (D-227/D-229).
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

const { ACCOUNT_OPENING_DOMAIN, loadIntakeForm, loadPublishedDomainConfig } =
  await import("@infra/config/domain-config-source");

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
    // to know which failures are operator-recoverable (D-228).
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
});
