import { createRequire } from "node:module";
import { OpenTelemetry } from "@ai-sdk/otel";
import { trace, type Tracer } from "@opentelemetry/api";

/**
 * The tracer name used for Vercel AI SDK spans.
 */
const AI_SDK_TRACER_NAME = "ai";

/**
 * Returns a lazy tracer that resolves from `trace.getTracer()` on every call,
 * so AI SDK spans follow whichever provider is currently mounted as global.
 * This keeps AI SDK telemetry working across `attachGlobalTracerProvider()` /
 * `detachGlobalTracerProvider()` cycles (e.g. phoenix-client experiments).
 *
 * Cast to `Tracer` is necessary because `startActiveSpan` has multiple
 * overload signatures that cannot be satisfied by a single implementation.
 */
function createLazyTracer(name: string): Tracer {
  return {
    startSpan(spanName, options, context) {
      return trace.getTracer(name).startSpan(spanName, options, context);
    },
    startActiveSpan(...args: unknown[]) {
      const tracer = trace.getTracer(name);
      return Reflect.apply(tracer.startActiveSpan, tracer, args);
    },
  } as Tracer;
}

/**
 * AI SDK v7 keeps globally registered telemetry integrations on
 * `globalThis` (see `registerTelemetry` in the `ai` package).
 */
type GlobalWithAiSdkTelemetry = typeof globalThis & {
  AI_SDK_TELEMETRY_INTEGRATIONS?: unknown[];
};

function getRegisteredAiSdkTelemetryIntegrations(): unknown[] | undefined {
  return (globalThis as GlobalWithAiSdkTelemetry).AI_SDK_TELEMETRY_INTEGRATIONS;
}

type AiModule = {
  registerTelemetry?: (...integrations: object[]) => void;
};

/**
 * Registers an OpenTelemetry telemetry integration for the Vercel AI SDK (v7+)
 * so that AI SDK calls (`generateText`, `streamText`, `generateObject`, etc.)
 * emit spans by default.
 *
 * Since AI SDK v7, telemetry is only emitted once a telemetry integration is
 * registered via `registerTelemetry()`. This helper registers an
 * `OpenTelemetry` integration (from `@ai-sdk/otel`) backed by a lazy tracer
 * that always resolves the current global tracer provider, with the
 * supplemental span attributes recommended for OpenInference enabled.
 *
 * The registration is skipped when:
 * - the `ai` package is not installed (it is an optional peer dependency), or
 * - a telemetry integration is already registered (to avoid duplicate spans).
 *
 * @returns `true` if an integration is registered (by this call or before),
 *   `false` when the `ai` package (v7+) is not available.
 */
export function registerAiSdkTelemetry(): boolean {
  const existingIntegrations = getRegisteredAiSdkTelemetryIntegrations();
  if (existingIntegrations && existingIntegrations.length > 0) {
    // Telemetry is already configured; don't add a duplicate integration.
    return true;
  }

  let ai: AiModule;
  try {
    // The `ai` package is ESM-only; require() of ESM is supported on the
    // Node.js versions (>=22) that AI SDK v7 itself requires.
    const requireModule = createRequire(import.meta.url);
    ai = requireModule("ai") as AiModule;
  } catch {
    // The AI SDK is not installed — nothing to instrument.
    return false;
  }

  if (typeof ai.registerTelemetry !== "function") {
    return false;
  }

  ai.registerTelemetry(
    new OpenTelemetry({
      tracer: createLazyTracer(AI_SDK_TRACER_NAME),
      // Supplemental AI SDK attributes recommended for fuller OpenInference
      // coverage — the OpenInference span processors use these to fill data
      // gaps that GenAI semantic conventions do not cover.
      usage: true,
      providerMetadata: true,
      embedding: true,
      reranking: true,
      runtimeContext: true,
      headers: true,
      toolChoice: true,
      schema: true,
    })
  );
  return true;
}
