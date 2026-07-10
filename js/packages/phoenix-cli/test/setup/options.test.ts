import { describe, expect, it } from "vitest";

import { resolveWizardInputs } from "../../src/setup/options";
import { buildFakeDeps } from "./fakes";

describe("resolveWizardInputs", () => {
  it("prefers flags over env vars", () => {
    const inputs = resolveWizardInputs(
      buildFakeDeps({
        options: { endpoint: "http://flag:6006", project: "flag-project" },
        env: {
          PHOENIX_HOST: "http://env:6006",
          PHOENIX_PROJECT: "env-project",
        },
      })
    );
    expect(inputs.endpoint).toBe("http://flag:6006");
    expect(inputs.project).toBe("flag-project");
  });

  it("accepts PHOENIX_COLLECTOR_ENDPOINT and PHOENIX_PROJECT_NAME as aliases", () => {
    const inputs = resolveWizardInputs(
      buildFakeDeps({
        env: {
          PHOENIX_COLLECTOR_ENDPOINT: "http://collector:6006",
          PHOENIX_PROJECT_NAME: "named-project",
        },
      })
    );
    expect(inputs.endpoint).toBe("http://collector:6006");
    expect(inputs.project).toBe("named-project");
  });

  it("prefers the canonical px env vars over the aliases", () => {
    const inputs = resolveWizardInputs(
      buildFakeDeps({
        env: {
          PHOENIX_HOST: "http://host:6006",
          PHOENIX_COLLECTOR_ENDPOINT: "http://collector:6006",
          PHOENIX_PROJECT: "px-project",
          PHOENIX_PROJECT_NAME: "sdk-project",
        },
      })
    );
    expect(inputs.endpoint).toBe("http://host:6006");
    expect(inputs.project).toBe("px-project");
  });

  it("reads the API key from env only", () => {
    const inputs = resolveWizardInputs(
      buildFakeDeps({ env: { PHOENIX_API_KEY: "sk-test" } })
    );
    expect(inputs.apiKey).toBe("sk-test");
  });

  it("is headless when --no-input is passed", () => {
    const inputs = resolveWizardInputs(
      buildFakeDeps({ options: { noInput: true } })
    );
    expect(inputs.headless).toBe(true);
  });

  it("is headless when stdin is not a TTY", () => {
    const inputs = resolveWizardInputs(buildFakeDeps({ stdinIsTTY: false }));
    expect(inputs.headless).toBe(true);
  });

  it("env vars alone do not trigger headless mode", () => {
    const inputs = resolveWizardInputs(
      buildFakeDeps({ env: { PHOENIX_API_KEY: "ambient" } })
    );
    expect(inputs.headless).toBe(false);
  });
});
