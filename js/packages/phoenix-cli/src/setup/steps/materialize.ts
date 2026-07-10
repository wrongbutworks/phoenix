/**
 * Step 4: hand-off file materialization (spec §3.4).
 *
 * Writes `.env.phoenix` + `.phoenix.json` into cwd (deliberately not the
 * repo root — bounded blast radius in monorepos), both mode 0600, then
 * ensures both are gitignored. The files emit the SDK env var names — they
 * configure the user's app, not px.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as COPY from "../copy";
import type { WizardDeps } from "../deps";
import { ensureGitignored } from "../util/gitignoreCoverage";
import type { Connection } from "./connect";

export const ENV_FILE_NAME = ".env.phoenix";
export const JSON_FILE_NAME = ".phoenix.json";

export function renderEnvFile(connection: Connection, isoDate: string): string {
  const lines = [
    COPY.MATERIALIZE.fileHeaderEnv(isoDate),
    `PHOENIX_COLLECTOR_ENDPOINT=${connection.endpoint}`,
    `PHOENIX_PROJECT_NAME=${connection.projectName}`,
  ];
  if (connection.apiKey) {
    lines.push(`PHOENIX_API_KEY=${connection.apiKey}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderJsonFile(
  connection: Connection,
  isoDate: string
): string {
  const payload: Record<string, unknown> = {
    _comment: COPY.MATERIALIZE.fileComment,
    collectorEndpoint: connection.endpoint,
    projectName: connection.projectName,
    projectId: connection.projectId,
    generatedAt: isoDate,
  };
  if (connection.apiKey) {
    payload.apiKey = connection.apiKey;
  }
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export interface MaterializeResult {
  envFilePath: string;
  jsonFilePath: string;
  gitignoreAppended: string[];
}

export function materializeHandoffFiles(
  deps: Pick<WizardDeps, "cwd" | "now">,
  connection: Connection,
  { isGitRepository }: { isGitRepository: boolean }
): MaterializeResult {
  const isoDate = new Date(deps.now()).toISOString();
  const envFilePath = path.join(deps.cwd, ENV_FILE_NAME);
  const jsonFilePath = path.join(deps.cwd, JSON_FILE_NAME);

  fs.writeFileSync(envFilePath, renderEnvFile(connection, isoDate), {
    encoding: "utf-8",
    mode: 0o600,
  });
  fs.writeFileSync(jsonFilePath, renderJsonFile(connection, isoDate), {
    encoding: "utf-8",
    mode: 0o600,
  });
  // Rewrites of an existing file keep its old mode — enforce 0600 anyway.
  fs.chmodSync(envFilePath, 0o600);
  fs.chmodSync(jsonFilePath, 0o600);

  // Applied in the auth-off case too: the file may later gain a key.
  const { appended } = ensureGitignored({
    directory: deps.cwd,
    filenames: [ENV_FILE_NAME, JSON_FILE_NAME],
    isGitRepository,
  });

  return { envFilePath, jsonFilePath, gitignoreAppended: appended };
}
