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
 * Note: `@arizeai/phoenix-evals` keeps an equivalent lazy tracer in
 * `src/telemetry/index.ts` (it cannot depend on this package); keep the two
 * implementations in sync.
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

/**
 * Whether an already-registered integration is an OpenTelemetry integration.
 * Uses an instanceof check plus a constructor-name fallback so integrations
 * constructed from a different copy of `@ai-sdk/otel` are still recognized.
 */
function isOpenTelemetryIntegration(integration: unknown): boolean {
  if (integration instanceof OpenTelemetry) {
    return true;
  }
  const constructorName = (integration as { constructor?: { name?: string } })
    ?.constructor?.name;
  return (
    constructorName === "OpenTelemetry" ||
    constructorName === "LegacyOpenTelemetry"
  );
}

type AiModule = {
  registerTelemetry?: (...integrations: object[]) => void;
};

/**
 * The integration this module registered, if any. Serves as a Phoenix-side
 * idempotency guard that does not depend on reading the AI SDK's internal
 * integration storage.
 */
let phoenixIntegration: OpenTelemetry | null = null;

/**
 * Resets this module's registration state. Intended for tests only.
 *
 * @internal
 */
export function resetAiSdkTelemetryRegistrationForTesting(): void {
  phoenixIntegration = null;
}

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
 * - this helper has already registered an integration, or
 * - an `OpenTelemetry` integration is already registered by the application
 *   (to avoid duplicate spans). Non-OpenTelemetry integrations (e.g. logging
 *   integrations) do not suppress registration — the AI SDK supports multiple
 *   integrations, and OpenTelemetry span export still needs to be configured.
 *
 * @returns `true` if an OpenTelemetry integration is registered (by this call
 *   or before), `false` when the `ai` package (v7+) is not available.
 */
export function registerAiSdkTelemetry(): boolean {
  if (phoenixIntegration) {
    // Already registered by this module; never double-register even if the
    // AI SDK's internal integration storage cannot be read.
    return true;
  }

  const existingIntegrations = getRegisteredAiSdkTelemetryIntegrations();
  if (existingIntegrations?.some(isOpenTelemetryIntegration)) {
    // The application already configured OpenTelemetry-based AI SDK
    // telemetry; don't add a duplicate integration.
    return true;
  }

  let ai: AiModule;
  try {
    // The `ai` package is ESM-only; require() of ESM is supported unflagged
    // on Node.js >=22.12 (hence this package's engines field).
    const requireModule = createRequire(import.meta.url);
    ai = requireModule("ai") as AiModule;
  } catch {
    // The AI SDK is not installed — nothing to instrument.
    return false;
  }

  if (typeof ai.registerTelemetry !== "function") {
    return false;
  }

  const integration = new OpenTelemetry({
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
  });
  ai.registerTelemetry(integration);
  phoenixIntegration = integration;
  return true;
}
