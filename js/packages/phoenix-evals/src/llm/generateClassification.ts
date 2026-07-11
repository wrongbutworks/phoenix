import { OpenTelemetry } from "@ai-sdk/otel";
import type { Tracer } from "@opentelemetry/api";
import { generateObject, type Telemetry } from "ai";
import { z } from "zod";

import { tracer } from "../telemetry";
import type { ClassificationResult, WithLLM } from "../types/evals";
import type { WithTelemetry } from "../types/otel";
import type { WithPrompt } from "../types/prompts";
export type ClassifyArgs = WithLLM &
  WithTelemetry &
  WithPrompt & {
    /**
     * The labels to classify the example into. E.x. ["correct", "incorrect"]
     */
    labels: [string, ...string[]];
    /**
     * The name of the schema for generating the label and explanation.
     */
    schemaName?: string;
    /**
     * The description of the schema for generating the label and explanation.
     */
    schemaDescription?: string;
  };
/**
 * Telemetry integrations memoized per tracer — the integration config is
 * static, so avoid allocating a new integration on every classification call.
 */
const telemetryIntegrations = new WeakMap<Tracer, OpenTelemetry>();

type GlobalWithAiSdkTelemetry = typeof globalThis & {
  AI_SDK_TELEMETRY_INTEGRATIONS?: Telemetry[];
};

function getGlobalTelemetryIntegrations(): Telemetry[] {
  return (
    (globalThis as GlobalWithAiSdkTelemetry).AI_SDK_TELEMETRY_INTEGRATIONS ?? []
  );
}

function getTelemetryIntegration(integrationTracer: Tracer): OpenTelemetry {
  let integration = telemetryIntegrations.get(integrationTracer);
  if (!integration) {
    integration = new OpenTelemetry({
      tracer: integrationTracer,
      // Supplemental AI SDK attributes recommended for fuller OpenInference
      // coverage of generateObject calls.
      usage: true,
      providerMetadata: true,
      schema: true,
    });
    telemetryIntegrations.set(integrationTracer, integration);
  }
  return integration;
}

/**
 * A function that leverages an llm to perform a classification
 */
export async function generateClassification(
  args: ClassifyArgs
): Promise<ClassificationResult> {
  const { labels, model, schemaName, schemaDescription, telemetry, ...prompt } =
    args;

  const telemetryOptions = {
    isEnabled: telemetry?.isEnabled ?? true,
    functionId: "generateClassification",
    // Per-call integrations replace the AI SDK's global integrations. Carry
    // them forward so application logging, metrics, and custom telemetry keep
    // running alongside Phoenix tracing.
    integrations: [
      ...getGlobalTelemetryIntegrations(),
      getTelemetryIntegration(telemetry?.tracer ?? tracer),
    ],
  };

  const result = await generateObject({
    model,
    schemaName,
    schemaDescription,
    schema: z.object({
      explanation: z.string(), // We place the explanation in hopes it uses reasoning to explain the label.
      label: z.enum(labels),
    }),
    telemetry: telemetryOptions,
    // AI SDK 7 rejects system messages inside `messages` by default; keep
    // accepting them since prompt templates may include system messages.
    allowSystemInMessages: true,
    ...prompt,
  });
  return {
    label: result.object.label,
    explanation: result.object.explanation,
  };
}
