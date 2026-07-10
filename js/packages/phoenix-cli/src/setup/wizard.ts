/**
 * The wizard step sequence, and nothing else (spec §1.1, §2).
 *
 * All effects flow through `WizardDeps`; all strings live in `copy.ts`;
 * cancellation unwinds via `WizardCancelledError` to the command handler.
 * Headless mode runs steps 1–4 (git preflight, connection, hand-off files)
 * and stops — it never runs an agent or prompts.
 */

import * as COPY from "./copy";
import type { WizardDeps } from "./deps";
import { WizardCancelledError } from "./errors";
import { resolveWizardInputs } from "./options";
import type { Connection } from "./steps/connect";
import { establishConnection } from "./steps/connect";
import { resolveDeployment } from "./steps/deployment";
import { runGitPreflight } from "./steps/gitPreflight";
import { runInstrumentationStep } from "./steps/instrumentation";
import {
  ENV_FILE_NAME,
  JSON_FILE_NAME,
  materializeHandoffFiles,
} from "./steps/materialize";
import { runPxProfileStep } from "./steps/pxProfile";
import {
  runProductionCheckpoint,
  runVerificationCheckpoint,
  tracesUrl,
} from "./steps/verify";

export interface WizardResult {
  connection: Connection;
  authEnabled: boolean;
  /** True when the run was headless (steps 1–4 only). */
  headless: boolean;
}

export async function runWizard(deps: WizardDeps): Promise<WizardResult> {
  const inputs = resolveWizardInputs(deps);

  if (!inputs.headless) {
    deps.prompter.intro(COPY.INTRO);
  }

  // Step 1: git preflight.
  const git = await runGitPreflight(deps, { headless: inputs.headless });
  if (!git.proceed) {
    throw new WizardCancelledError();
  }

  // Step 2: deployment resolution + auth probe. The hidden --api-url flag
  // overrides the REST origin for development setups.
  const deployment = await resolveDeployment(deps, {
    presetEndpoint: deps.options.apiUrl ?? inputs.endpoint,
    headless: inputs.headless,
  });

  // Step 3: establish the connection (lane dispatch).
  const connection = await establishConnection(deps, {
    endpoint: deployment.endpoint,
    authEnabled: deployment.authEnabled,
    inputs,
  });

  // Step 4: hand-off files + gitignore coverage.
  const materialized = materializeHandoffFiles(deps, connection, {
    isGitRepository: git.isGitRepository,
  });
  if (!inputs.headless) {
    deps.prompter.line(COPY.MATERIALIZE.wrote([ENV_FILE_NAME, JSON_FILE_NAME]));
    if (materialized.gitignoreAppended.length > 0) {
      deps.prompter.line(
        COPY.MATERIALIZE.gitignored(materialized.gitignoreAppended)
      );
    }
  }

  if (inputs.headless) {
    return {
      connection,
      authEnabled: deployment.authEnabled,
      headless: true,
    };
  }

  // Step 6: instrumentation lanes (all converge on verification).
  await runInstrumentationStep(deps, connection, {
    authEnabled: deployment.authEnabled,
  });

  // Step 7: human verification checkpoint.
  await runVerificationCheckpoint(deps, connection);

  // Step 8: opt-in px profile pointing at this endpoint/project.
  await runPxProfileStep(deps, {
    connection,
    settingsPath: deps.settingsPath,
  });

  // Step 9: production hand-off.
  await runProductionCheckpoint(deps, {
    authEnabled: deployment.authEnabled,
  });

  // Step 10: outro.
  deps.prompter.note(COPY.OUTRO_BODY, COPY.OUTRO_TITLE);
  deps.prompter.outro(COPY.OUTRO_TITLE);

  return {
    connection,
    authEnabled: deployment.authEnabled,
    headless: false,
  };
}

export function headlessSummary(result: WizardResult): string {
  const { connection } = result;
  return [
    `endpoint: ${connection.endpoint}`,
    `project: ${connection.projectName}`,
    `projectId: ${connection.projectId}`,
    `files: ${ENV_FILE_NAME}, ${JSON_FILE_NAME}`,
    "",
    COPY.HEADLESS.nextSteps(tracesUrl(connection)),
  ].join("\n");
}
