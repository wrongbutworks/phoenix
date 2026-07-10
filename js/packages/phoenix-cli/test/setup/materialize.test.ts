import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ENV_FILE_NAME,
  JSON_FILE_NAME,
  materializeHandoffFiles,
} from "../../src/setup/steps/materialize";

const CONNECTION = {
  endpoint: "https://phoenix.example.com",
  projectName: "my-app",
  projectId: "UHJvamVjdDox",
};

const NOW = Date.UTC(2026, 6, 8, 12, 0, 0);

describe("materializeHandoffFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-setup-materialize-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function deps() {
    return { cwd: dir, now: () => NOW };
  }

  it("writes both files with mode 0600", () => {
    const result = materializeHandoffFiles(
      deps(),
      { ...CONNECTION, apiKey: "sk-secret" },
      { isGitRepository: false }
    );
    for (const filePath of [result.envFilePath, result.jsonFilePath]) {
      const mode = fs.statSync(filePath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("emits SDK env var names, with the key line when auth is on", () => {
    materializeHandoffFiles(
      deps(),
      { ...CONNECTION, apiKey: "sk-secret" },
      { isGitRepository: false }
    );
    const env = fs.readFileSync(path.join(dir, ENV_FILE_NAME), "utf-8");
    expect(env).toContain(
      "PHOENIX_COLLECTOR_ENDPOINT=https://phoenix.example.com"
    );
    expect(env).toContain("PHOENIX_PROJECT_NAME=my-app");
    expect(env).toContain("PHOENIX_API_KEY=sk-secret");
    expect(env).toContain("do NOT commit");
  });

  it("omits the key line entirely when auth is off", () => {
    materializeHandoffFiles(deps(), CONNECTION, { isGitRepository: false });
    const env = fs.readFileSync(path.join(dir, ENV_FILE_NAME), "utf-8");
    expect(env).not.toContain("PHOENIX_API_KEY");
  });

  it("writes a JSON twin with projectId and generatedAt", () => {
    materializeHandoffFiles(deps(), CONNECTION, { isGitRepository: false });
    const json = JSON.parse(
      fs.readFileSync(path.join(dir, JSON_FILE_NAME), "utf-8")
    );
    expect(json).toMatchObject({
      collectorEndpoint: CONNECTION.endpoint,
      projectName: CONNECTION.projectName,
      projectId: CONNECTION.projectId,
      generatedAt: new Date(NOW).toISOString(),
    });
    expect(json._comment).toContain("do not commit");
  });

  it("gitignores both files in a repo", () => {
    const result = materializeHandoffFiles(deps(), CONNECTION, {
      isGitRepository: true,
    });
    expect(result.gitignoreAppended).toEqual([ENV_FILE_NAME, JSON_FILE_NAME]);
    const gitignore = fs.readFileSync(path.join(dir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(ENV_FILE_NAME);
  });
});
