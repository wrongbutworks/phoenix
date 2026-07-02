import { OpenTelemetry } from "@ai-sdk/otel";
import { generateObject } from "ai";
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
    // A per-call telemetry integration takes precedence over any globally
    // registered integrations, so evaluator spans always flow through the
    // provided (or lazy global) tracer.
    integrations: [
      new OpenTelemetry({
        tracer: telemetry?.tracer ?? tracer,
        usage: true,
        providerMetadata: true,
        toolChoice: true,
        schema: true,
      }),
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
