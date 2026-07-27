/**
 * Tracing (ADR-0013, charter #14). withSpan wraps every flow step and every
 * external/store call so latency and failures are observable. Spans go to the
 * OpenTelemetry API — exported over OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is set
 * (otel-provider.ts registers the NodeTracerProvider) — AND to an in-memory ring
 * the tests assert on, so "traces exist" is verifiable, not modeled. The
 * observability-coverage fence checks the engine + external calls are wrapped.
 */
import { trace, SpanStatusCode, type Attributes } from "@opentelemetry/api";
import { getConfig } from "@infra/config";
import {
  isPIIField,
  looksLikeAmbiguousSensitiveText,
  REDACTED,
} from "@contracts/pii";
import { registerOtelProviderIfConfigured } from "./otel-provider";
import { safeReason } from "./logger";

export interface RecordedSpan {
  name: string;
  attributes: Attributes;
  ok: boolean;
  durationMs: number;
  endedAt: number;
}

const RING_MAX = 512;
const ring: RecordedSpan[] = [];

export function recentSpans(): readonly RecordedSpan[] {
  return ring;
}

function record(s: RecordedSpan): void {
  ring.push(s);
  if (ring.length > RING_MAX) ring.shift();
}

registerOtelProviderIfConfigured();
const tracer = trace.getTracer(getConfig().otel.serviceName);

/**
 * PII backstop at the trace boundary (v3 §15.4): span attributes are exported
 * over OTLP, so a PII-shaped string VALUE is replaced wholesale before it can
 * leave the process, and — mirroring scrub()'s key rule at the log boundary —
 * any attribute under a PII-named KEY is redacted regardless of value type
 * ({ phone: 2125550142 } must not survive as a raw number). Callers pass
 * identifiers (opaque userId, orgId) — this guard exists for the day one doesn't.
 */
function scrubAttributes(attributes: Attributes): Attributes {
  const scrub = (v: unknown): unknown =>
    (typeof v === "string" || typeof v === "number") &&
    looksLikeAmbiguousSensitiveText(String(v))
      ? REDACTED
      : v;
  const out: Record<string, Attributes[string]> = {};
  for (const [k, v] of Object.entries(attributes)) {
    out[k] = isPIIField(k) ? REDACTED : ((Array.isArray(v) ? v.map(scrub) : scrub(v)) as Attributes[string]);
  }
  return out;
}

/** Run `fn` inside a span. Records to OTel and the in-memory ring. */
export async function withSpan<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  const attrs = scrubAttributes(attributes);
  const span = tracer.startSpan(name, { attributes: attrs });
  const started = performance.now();
  try {
    const result = await fn();
    span.setStatus({ code: SpanStatusCode.OK });
    record({ name, attributes: attrs, ok: true, durationMs: performance.now() - started, endedAt: Date.now() });
    return result;
  } catch (e) {
    // Exception text can quote row values (a driver detail may embed an email);
    // the status message is PII-scrubbed like every other trace field.
    span.setStatus({ code: SpanStatusCode.ERROR, message: safeReason(e) });
    record({ name, attributes: attrs, ok: false, durationMs: performance.now() - started, endedAt: Date.now() });
    throw e;
  } finally {
    span.end();
  }
}
