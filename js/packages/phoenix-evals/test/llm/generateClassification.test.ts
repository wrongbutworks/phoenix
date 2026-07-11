import { OpenTelemetry } from "@ai-sdk/otel";
import { generateObject, type Telemetry } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { generateClassification } from "../../src/llm/generateClassification";

vi.mock(import("ai"), async (importOriginal) => ({
  ...(await importOriginal()),
  generateObject: vi.fn(),
}));

type GlobalWithAiSdkTelemetry = typeof globalThis & {
  AI_SDK_TELEMETRY_INTEGRATIONS?: Telemetry[];
};

afterEach(() => {
  delete (globalThis as GlobalWithAiSdkTelemetry).AI_SDK_TELEMETRY_INTEGRATIONS;
  vi.mocked(generateObject).mockReset();
});

describe("generateClassification", () => {
  test("preserves global integrations while adding Phoenix tracing", async () => {
    const loggingIntegration: Telemetry = { onStart: vi.fn() };
    (globalThis as GlobalWithAiSdkTelemetry).AI_SDK_TELEMETRY_INTEGRATIONS = [
      loggingIntegration,
    ];
    vi.mocked(generateObject).mockResolvedValue({
      object: { label: "correct", explanation: "The answer matches." },
    } as Awaited<ReturnType<typeof generateObject>>);

    await generateClassification({
      model: new MockLanguageModelV3({}),
      labels: ["correct", "incorrect"],
      prompt: "Classify this answer.",
    });

    const telemetry = vi.mocked(generateObject).mock.calls[0]?.[0].telemetry;
    expect(telemetry).toEqual(
      expect.objectContaining({
        integrations: expect.arrayContaining([loggingIntegration]),
      })
    );
    expect(Array.isArray(telemetry?.integrations)).toBe(true);
    const integrations = telemetry?.integrations as Telemetry[];
    expect(integrations).toHaveLength(2);
    expect(integrations[1]).toBeInstanceOf(OpenTelemetry);
  });
});
