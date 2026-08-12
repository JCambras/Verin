import { describe, expect, it } from "vitest";
import { toResponse } from "@contracts/errors";
import { MACHINE_RECORD_ID_RE } from "@contracts/record-id";
import {
  ACCOUNT_OPENING_DOMAIN,
  loadIntakeForm,
  loadPublishedDomainConfig,
} from "@infra/config/domain-config-source";

/**
 * WHAT A CONFIGURATION REFUSAL SAYS, AND TO WHOM (D-227).
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
 */
const HEX_DIGEST = /[0-9a-f]{32}/;
const DOTTED_DOCUMENT_PATH = /\b[a-z]+\.[a-z][A-Za-z-]+\.[A-Za-z-]+/;

function refusalOf(domainConfigId: string) {
  const sourced = loadPublishedDomainConfig(domainConfigId);
  expect(sourced.ok, `${domainConfigId} must not resolve`).toBe(false);
  if (sourced.ok) throw new Error("unreachable");
  return sourced.error;
}

describe("the domain-configuration source refuses without leaking its diagnosis", () => {
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
    // The full diagnosis rides in `context`, which `toResponse` has never
    // returned - so it is preserved for the operator rather than deleted.
    expect(error.context?.["stage"]).toBe(stage);
    expect(String(error.context?.["detail"] ?? "").length).toBeGreaterThan(0);
    expect(JSON.stringify(toResponse(error))).not.toContain(String(error.context?.["detail"]));
  });

  it("mints a DISTINCT reference per refusal, so two incidents never share a log line", () => {
    const first = refusalOf("no-such-published-domain").context?.["correlationId"];
    const second = refusalOf("no-such-published-domain").context?.["correlationId"];
    expect(first).not.toBe(second);
  });
});
