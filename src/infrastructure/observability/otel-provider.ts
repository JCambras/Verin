/**
 * OTLP span export (ADR-0013, charter #14). Registers a NodeTracerProvider with a
 * batching OTLP/HTTP exporter when OTEL_EXPORTER_OTLP_ENDPOINT is configured;
 * without an endpoint no provider is registered and the OTel API stays a no-op
 * (the in-memory test ring in tracer.ts is unaffected either way). Guarded on
 * globalThis, not a module-local flag: Next bundles route handlers and server
 * components separately (the getDb lesson), and the OTel global registry refuses
 * a second provider registration.
 */
import { NodeTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { getConfig } from "@infra/config";

const REGISTERED = Symbol.for("verin.otel.provider-registered");

export function registerOtelProviderIfConfigured(): void {
  const cfg = getConfig();
  if (!cfg.otel.endpoint) return;
  const g = globalThis as { [REGISTERED]?: boolean };
  if (g[REGISTERED]) return;
  g[REGISTERED] = true;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: cfg.otel.serviceName }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: cfg.otel.endpoint }))],
  });
  provider.register();
}
