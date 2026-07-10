import { describe, expect, it } from "vitest";

import type { WizardDeps } from "../../src/setup/deps";
import { HeadlessInputError, WizardFatalError } from "../../src/setup/errors";
import { resolveWizardInputs } from "../../src/setup/options";
import {
  defaultProjectName,
  establishConnection,
  resolveOrCreateProject,
  validateProjectName,
} from "../../src/setup/steps/connect";
import {
  buildFakeDeps,
  fakeFetch,
  jsonResponse,
  scriptedPrompter,
} from "./fakes";

const ENDPOINT = "http://localhost:6006";
const PROJECT = { id: "UHJvamVjdDox", name: "my-app", description: null };

function headlessInputs(deps: WizardDeps) {
  return resolveWizardInputs(deps);
}

describe("validateProjectName", () => {
  it("rejects empty names and URL-hostile characters", () => {
    expect(validateProjectName("")).toBeDefined();
    expect(validateProjectName("  ")).toBeDefined();
    expect(validateProjectName("a/b")).toBeDefined();
    expect(validateProjectName("a?b")).toBeDefined();
    expect(validateProjectName("a#b")).toBeDefined();
    expect(validateProjectName("my-app")).toBeUndefined();
  });
});

describe("defaultProjectName", () => {
  it("uses the cwd basename", () => {
    expect(defaultProjectName("/home/user/my-app")).toBe("my-app");
  });
});

describe("resolveOrCreateProject (resolve-first, spec §3.3)", () => {
  it("uses an existing project without POSTing", async () => {
    let posted = false;
    const deps = buildFakeDeps({
      fetch: fakeFetch((url, init) => {
        if (init?.method === "POST") {
          posted = true;
          return jsonResponse(500, {});
        }
        return jsonResponse(200, { data: PROJECT });
      }),
    });
    const result = await resolveOrCreateProject(deps, ENDPOINT, "my-app");
    expect(result).toEqual({ kind: "ok", project: PROJECT, created: false });
    expect(posted).toBe(false);
  });

  it("creates the project on 404", async () => {
    const deps = buildFakeDeps({
      fetch: fakeFetch((url, init) =>
        init?.method === "POST"
          ? jsonResponse(201, { data: PROJECT })
          : jsonResponse(404, { detail: "not found" })
      ),
    });
    const result = await resolveOrCreateProject(deps, ENDPOINT, "my-app");
    expect(result).toEqual({ kind: "ok", project: PROJECT, created: true });
  });

  it("re-GETs after a create failure (duplicate-name 500 race)", async () => {
    let gets = 0;
    const deps = buildFakeDeps({
      fetch: fakeFetch((url, init) => {
        if (init?.method === "POST") {
          return jsonResponse(500, { detail: "IntegrityError" });
        }
        gets += 1;
        return gets === 1
          ? jsonResponse(404, { detail: "not found" })
          : jsonResponse(200, { data: PROJECT });
      }),
    });
    const result = await resolveOrCreateProject(deps, ENDPOINT, "my-app");
    expect(result).toEqual({ kind: "ok", project: PROJECT, created: false });
    expect(gets).toBe(2);
  });

  it("surfaces unauthorized so callers can switch lanes", async () => {
    const deps = buildFakeDeps({
      fetch: fakeFetch((url, init) =>
        init?.method === "POST"
          ? jsonResponse(403, { detail: "viewers cannot write" })
          : jsonResponse(404, { detail: "not found" })
      ),
    });
    const result = await resolveOrCreateProject(deps, ENDPOINT, "my-app");
    expect(result).toEqual({ kind: "unauthorized", status: 403 });
  });
});

describe("establishConnection headless lanes", () => {
  it("auth-off resolves or creates and returns no key", async () => {
    const deps = buildFakeDeps({
      options: { noInput: true, project: "my-app" },
      fetch: fakeFetch(() => jsonResponse(200, { data: PROJECT })),
    });
    const connection = await establishConnection(deps, {
      endpoint: ENDPOINT,
      authEnabled: false,
      inputs: headlessInputs(deps),
    });
    expect(connection).toEqual({
      endpoint: ENDPOINT,
      projectName: "my-app",
      projectId: PROJECT.id,
    });
  });

  it("auth-off without a project exits INVALID_ARGUMENT", async () => {
    const deps = buildFakeDeps({ options: { noInput: true } });
    await expect(
      establishConnection(deps, {
        endpoint: ENDPOINT,
        authEnabled: false,
        inputs: headlessInputs(deps),
      })
    ).rejects.toThrow(HeadlessInputError);
  });

  it("auth-on requires PHOENIX_API_KEY", async () => {
    const deps = buildFakeDeps({
      options: { noInput: true, project: "my-app" },
    });
    await expect(
      establishConnection(deps, {
        endpoint: ENDPOINT,
        authEnabled: true,
        inputs: headlessInputs(deps),
      })
    ).rejects.toThrow(HeadlessInputError);
  });

  it("auth-on resolves the project with the bearer key", async () => {
    let sawBearer = false;
    const deps = buildFakeDeps({
      options: { noInput: true, project: "my-app" },
      env: { PHOENIX_API_KEY: "sk-live" },
      fetch: fakeFetch((url, init) => {
        const headers = init?.headers as Record<string, string>;
        sawBearer = headers?.authorization === "Bearer sk-live";
        return jsonResponse(200, { data: PROJECT });
      }),
    });
    const connection = await establishConnection(deps, {
      endpoint: ENDPOINT,
      authEnabled: true,
      inputs: headlessInputs(deps),
    });
    expect(sawBearer).toBe(true);
    expect(connection.apiKey).toBe("sk-live");
  });

  it("auth-on headless never creates a project", async () => {
    const deps = buildFakeDeps({
      options: { noInput: true, project: "brand-new" },
      env: { PHOENIX_API_KEY: "sk-live" },
      fetch: fakeFetch(() => jsonResponse(404, { detail: "not found" })),
    });
    await expect(
      establishConnection(deps, {
        endpoint: ENDPOINT,
        authEnabled: true,
        inputs: headlessInputs(deps),
      })
    ).rejects.toThrow(WizardFatalError);
  });
});

describe("establishConnection interactive auth-off", () => {
  it("prompts for a project name with the cwd default", async () => {
    const prompter = scriptedPrompter([undefined]); // accept the default
    const deps = buildFakeDeps({
      cwd: "/home/user/my-app",
      prompter,
      fetch: fakeFetch(() => jsonResponse(200, { data: PROJECT })),
    });
    const connection = await establishConnection(deps, {
      endpoint: ENDPOINT,
      authEnabled: false,
      inputs: resolveWizardInputs(deps),
    });
    expect(connection.projectName).toBe("my-app");
    expect(prompter.transcript).toHaveLength(1);
  });
});
