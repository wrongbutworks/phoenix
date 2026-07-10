/**
 * Full-flow wizard tests: scripted select answers through fake deps
 * (spec §10). Real fs only via temp dirs.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HeadlessInputError,
  WizardCancelledError,
} from "../../src/setup/errors";
import { headlessSummary, runWizard } from "../../src/setup/wizard";
import {
  CANCEL,
  buildFakeDeps,
  fakeFetch,
  gitExecFake,
  jsonResponse,
  scriptedPrompter,
} from "./fakes";

const PROJECT = { id: "UHJvamVjdDox", name: "my-app", description: null };
const LOCAL = "http://localhost:6006";

function authOffFetch() {
  return fakeFetch((url, init) => {
    if (url.includes("/v1/projects?limit=1")) {
      return jsonResponse(200, { data: [] });
    }
    if (url.includes("/v1/projects/") && init?.method === "GET") {
      return jsonResponse(200, { data: PROJECT });
    }
    return undefined;
  });
}

describe("runWizard", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-setup-wizard-"));
    settingsPath = path.join(dir, "px-settings.json");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("auth-off happy path via the manual lane", async () => {
    const prompter = scriptedPrompter([
      "local", // deployment
      "my-app", // project name
      "manual", // instrumentation mode
      true, // I've finished instrumenting
      true, // I can see traces
      false, // no px profile
      true, // production noted
    ]);
    const deps = buildFakeDeps({
      cwd: dir,
      prompter,
      fetch: authOffFetch(),
      exec: gitExecFake(),
    });
    deps.settingsPath = settingsPath;

    const result = await runWizard(deps);
    expect(result.headless).toBe(false);
    expect(result.authEnabled).toBe(false);
    expect(result.connection).toEqual({
      endpoint: LOCAL,
      projectName: "my-app",
      projectId: PROJECT.id,
    });

    const env = fs.readFileSync(path.join(dir, ".env.phoenix"), "utf-8");
    expect(env).toContain("PHOENIX_PROJECT_NAME=my-app");
    expect(env).not.toContain("PHOENIX_API_KEY");
    expect(fs.existsSync(path.join(dir, ".phoenix.json"))).toBe(true);
    // Traces URL surfaced at the verification checkpoint.
    expect(
      prompter.output.some((message) =>
        message.includes(`${LOCAL}/projects/${PROJECT.id}/traces`)
      )
    ).toBe(true);
  });

  it("auth-on happy path with a pasted API key", async () => {
    const prompter = scriptedPrompter([
      "sk-pasted", // API key
      "my-app", // project name
      "ownAgent", // instrumentation mode
      true, // I've run the prompt
      true, // I can see traces
      false, // no px profile
      true, // production noted
    ]);
    const deps = buildFakeDeps({
      cwd: dir,
      prompter,
      options: { endpoint: LOCAL },
      exec: gitExecFake(),
      fetch: fakeFetch((url, init) => {
        if (url.includes("/v1/projects?limit=1")) {
          return jsonResponse(401, { detail: "unauthorized" });
        }
        if (url.includes("/v1/projects/") && init?.method === "GET") {
          const headers = init.headers as Record<string, string>;
          expect(headers.authorization).toBe("Bearer sk-pasted");
          return jsonResponse(200, { data: PROJECT });
        }
        return undefined;
      }),
    });
    deps.settingsPath = settingsPath;

    const result = await runWizard(deps);
    expect(result.authEnabled).toBe(true);
    expect(result.connection.apiKey).toBe("sk-pasted");

    const env = fs.readFileSync(path.join(dir, ".env.phoenix"), "utf-8");
    expect(env).toContain("PHOENIX_API_KEY=sk-pasted");
  });

  it("re-prompts only for a rejected API key", async () => {
    const prompter = scriptedPrompter([
      "sk-rejected", // API key
      "my-app", // project name
      "sk-pasted", // replacement API key
      "manual",
      true,
      true,
      false,
      true,
    ]);
    const deps = buildFakeDeps({
      cwd: dir,
      prompter,
      options: { endpoint: LOCAL },
      exec: gitExecFake(),
      fetch: fakeFetch((url, init) => {
        if (url.includes("/v1/projects?limit=1")) {
          return jsonResponse(401, { detail: "unauthorized" });
        }
        if (url.includes("/v1/projects/") && init?.method === "GET") {
          const headers = init.headers as Record<string, string>;
          if (headers.authorization === "Bearer sk-rejected") {
            return jsonResponse(401, { detail: "unauthorized" });
          }
          return jsonResponse(200, { data: PROJECT });
        }
        return undefined;
      }),
    });
    deps.settingsPath = settingsPath;

    const result = await runWizard(deps);
    expect(result.connection.apiKey).toBe("sk-pasted");
    expect(
      prompter.transcript.filter((message) => message === "Phoenix API key")
    ).toHaveLength(2);
    expect(
      prompter.transcript.filter(
        (message) => message === "Phoenix project name for this app's traces"
      )
    ).toHaveLength(1);
  });

  it("cancelling any prompt unwinds with WizardCancelledError", async () => {
    const prompter = scriptedPrompter([CANCEL]);
    const deps = buildFakeDeps({
      cwd: dir,
      prompter,
      fetch: authOffFetch(),
      exec: gitExecFake(),
    });
    await expect(runWizard(deps)).rejects.toThrow(WizardCancelledError);
  });

  it("declining the dirty-tree gate stops as a cancel", async () => {
    const prompter = scriptedPrompter([false]);
    const deps = buildFakeDeps({
      cwd: dir,
      prompter,
      fetch: authOffFetch(),
      exec: gitExecFake({ dirtyFiles: ["src/app.py"] }),
    });
    await expect(runWizard(deps)).rejects.toThrow(WizardCancelledError);
  });

  it("headless runs steps 1–4 only and prompts for nothing", async () => {
    const prompter = scriptedPrompter([]);
    const deps = buildFakeDeps({
      cwd: dir,
      prompter,
      options: { noInput: true, endpoint: LOCAL, project: "my-app" },
      fetch: authOffFetch(),
      exec: gitExecFake(),
    });
    const result = await runWizard(deps);
    expect(result.headless).toBe(true);
    expect(prompter.transcript).toEqual([]);
    expect(fs.existsSync(path.join(dir, ".env.phoenix"))).toBe(true);

    const summary = headlessSummary(result);
    expect(summary).toContain("projectId: UHJvamVjdDox");
    expect(summary).not.toContain("sk-");
  });

  it("headless without a project exits with the exact remediation", async () => {
    const deps = buildFakeDeps({
      cwd: dir,
      options: { noInput: true, endpoint: LOCAL },
      fetch: authOffFetch(),
      exec: gitExecFake(),
    });
    await expect(runWizard(deps)).rejects.toThrow(HeadlessInputError);
  });
});
