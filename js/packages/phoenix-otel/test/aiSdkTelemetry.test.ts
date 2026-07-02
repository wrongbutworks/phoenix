import { OpenTelemetry } from "@ai-sdk/otel";
import { OpenInferenceSimpleSpanProcessor } from "@arizeai/openinference-vercel";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-node";
import { generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, test } from "vitest";

import {
  attachGlobalTracerProvider,
  detachGlobalTracerProvider,
  register,
  registerAiSdkTelemetry,
  resetAiSdkTelemetryRegistrationForTesting,
} from "../src";

type GlobalWithAiSdkTelemetry = typeof globalThis & {
  AI_SDK_TELEMETRY_INTEGRATIONS?: unknown[];
};

function getGlobalIntegrations(): unknown[] | undefined {
  return (globalThis as GlobalWithAiSdkTelemetry).AI_SDK_TELEMETRY_INTEGRATIONS;
}

function clearGlobalIntegrations() {
  delete (globalThis as GlobalWithAiSdkTelemetry).AI_SDK_TELEMETRY_INTEGRATIONS;
}

function createMockModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 20,
          text: 20,
          reasoning: undefined,
        },
      },
      content: [{ type: "text" as const, text: "Hello, world!" }],
      warnings: [],
    }),
  });
}

function createCountingSpanProcessor() {
  let startCount = 0;

  const processor: SpanProcessor = {
    onStart: () => {
      startCount += 1;
    },
    onEnd: () => {},
    forceFlush: async () => {},
    shutdown: async () => {},
  };

  return {
    processor,
    getStartCount: () => startCount,
  };
}

afterEach(() => {
  detachGlobalTracerProvider();
  clearGlobalIntegrations();
  resetAiSdkTelemetryRegistrationForTesting();
});

describe("registerAiSdkTelemetry", () => {
  test("registers a single AI SDK telemetry integration", () => {
    expect(getGlobalIntegrations()).toBeUndefined();

    expect(registerAiSdkTelemetry()).toBe(true);
    expect(getGlobalIntegrations()).toHaveLength(1);

    // A second call must not add a duplicate integration.
    expect(registerAiSdkTelemetry()).toBe(true);
    expect(getGlobalIntegrations()).toHaveLength(1);
  });

  test("skips registration when an OpenTelemetry integration already exists", () => {
    const applicationIntegration = new OpenTelemetry();
    (globalThis as GlobalWithAiSdkTelemetry).AI_SDK_TELEMETRY_INTEGRATIONS = [
      applicationIntegration,
    ];

    expect(registerAiSdkTelemetry()).toBe(true);
    expect(getGlobalIntegrations()).toEqual([applicationIntegration]);
  });

  test("registers alongside a non-OpenTelemetry integration", () => {
    // A logging/analytics integration does not configure OpenTelemetry span
    // export, so Phoenix must still register its own integration.
    const loggingIntegration = { onStart: () => {} };
    (globalThis as GlobalWithAiSdkTelemetry).AI_SDK_TELEMETRY_INTEGRATIONS = [
      loggingIntegration,
    ];

    expect(registerAiSdkTelemetry()).toBe(true);
    const integrations = getGlobalIntegrations();
    expect(integrations).toHaveLength(2);
    expect(integrations?.[0]).toBe(loggingIntegration);
    expect(integrations?.[1]).toBeInstanceOf(OpenTelemetry);
  });

  test("register() registers AI SDK telemetry by default and can opt out", async () => {
    // aiSdkTelemetry defaults to the value of `global` — a non-global
    // register() call must not mutate process-global AI SDK telemetry state.
    const nonGlobalProvider = register({
      url: "http://localhost:6006/v1/traces",
      apiKey: "test",
      spanProcessors: [createCountingSpanProcessor().processor],
      global: false,
    });
    expect(getGlobalIntegrations()).toBeUndefined();

    // A non-global call can opt in explicitly (e.g. when the caller attaches
    // the provider globally themselves).
    const optedInProvider = register({
      url: "http://localhost:6006/v1/traces",
      apiKey: "test",
      spanProcessors: [createCountingSpanProcessor().processor],
      global: false,
      aiSdkTelemetry: true,
    });
    expect(getGlobalIntegrations()).toHaveLength(1);

    await nonGlobalProvider.shutdown();
    await optedInProvider.shutdown();
  });

  test("register({global: true}) can opt out of AI SDK telemetry", async () => {
    const provider = register({
      url: "http://localhost:6006/v1/traces",
      apiKey: "test",
      spanProcessors: [createCountingSpanProcessor().processor],
      global: true,
      aiSdkTelemetry: false,
    });
    expect(getGlobalIntegrations()).toBeUndefined();

    await provider.shutdown();
  });
});

describe("AI SDK span export through OpenInference span processors", () => {
  test("generateText spans are exported as OpenInference spans", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = register({
      url: "http://localhost:6006/v1/traces",
      apiKey: "test",
      spanProcessors: [new OpenInferenceSimpleSpanProcessor({ exporter })],
      global: true,
    });

    try {
      const result = await generateText({
        model: createMockModel(),
        prompt: "Say hello.",
      });
      expect(result.text).toBe("Hello, world!");
      await provider.forceFlush();

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBeGreaterThan(0);

      const openInferenceSpans = spans.filter(
        (span) => span.attributes["openinference.span.kind"] !== undefined
      );
      expect(openInferenceSpans.length).toBeGreaterThan(0);

      const llmSpan = openInferenceSpans.find(
        (span) => span.attributes["openinference.span.kind"] === "LLM"
      );
      expect(llmSpan).toBeDefined();
      expect(llmSpan?.attributes["output.value"]).toBeDefined();
    } finally {
      await provider.shutdown();
    }
  });

  test("AI SDK spans follow global tracer provider swaps", async () => {
    const firstCounter = createCountingSpanProcessor();
    const secondCounter = createCountingSpanProcessor();
    const firstProvider = register({
      url: "http://localhost:6006/v1/traces",
      apiKey: "test",
      spanProcessors: [firstCounter.processor],
      global: false,
    });
    const secondProvider = register({
      url: "http://localhost:6006/v1/traces",
      apiKey: "test",
      spanProcessors: [secondCounter.processor],
      global: false,
    });
    registerAiSdkTelemetry();

    try {
      const firstRegistration = attachGlobalTracerProvider(firstProvider);
      try {
        await generateText({ model: createMockModel(), prompt: "First." });
        expect(firstCounter.getStartCount()).toBeGreaterThan(0);
        expect(secondCounter.getStartCount()).toBe(0);
      } finally {
        firstRegistration.detach();
      }

      const firstStartCount = firstCounter.getStartCount();
      const secondRegistration = attachGlobalTracerProvider(secondProvider);
      try {
        await generateText({ model: createMockModel(), prompt: "Second." });
        expect(firstCounter.getStartCount()).toBe(firstStartCount);
        expect(secondCounter.getStartCount()).toBeGreaterThan(0);
      } finally {
        secondRegistration.detach();
      }
    } finally {
      await firstProvider.shutdown();
      await secondProvider.shutdown();
    }
  });
});
