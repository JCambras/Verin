/**
 * Tracing (ADR-0013, charter #14). withSpan wraps every flow step and every
 * external/store call so latency and failures are observable. Spans go to the
 * OpenTelemetry API (the deploy target registers an exporting provider, pointed
 * at a collector via OTEL_EXPORTER_OTLP_ENDPOINT) AND to an in-memory ring the
 * tests assert on — so "traces exist" is verifiable, not modeled. The
 * observability-coverage fence checks the engine + external calls are wrapped.
 */
import { trace, SpanStatusCode, type Attributes } from "@opentelemetry/api";
import { getConfig } from "@infra/config";

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

const tracer = trace.getTracer(getConfig().otel.serviceName);

/** Run `fn` inside a span. Records to OTel and the in-memory ring. */
export async function withSpan<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  const span = tracer.startSpan(name, { attributes });
  const started = performance.now();
  try {
    const result = await fn();
    span.setStatus({ code: SpanStatusCode.OK });
    record({ name, attributes, ok: true, durationMs: performance.now() - started, endedAt: Date.now() });
    return result;
  } catch (e) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: e instanceof Error ? e.message : "error" });
    record({ name, attributes, ok: false, durationMs: performance.now() - started, endedAt: Date.now() });
    throw e;
  } finally {
    span.end();
  }
}
