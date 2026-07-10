/**
 * Steps 7 + 9: verification and production hand-off checkpoints (spec §3.7).
 *
 * Each checkpoint is a deliberately single-option select — not skippable,
 * but cancellable like everything else.
 */

import * as COPY from "../copy";
import type { WizardDeps } from "../deps";
import type { Connection } from "./connect";

export function tracesUrl(connection: Connection): string {
  return `${connection.endpoint}/projects/${connection.projectId}/traces`;
}

export async function runVerificationCheckpoint(
  deps: WizardDeps,
  connection: Connection
): Promise<void> {
  deps.prompter.note(
    COPY.VERIFY.instructions(tracesUrl(connection)),
    COPY.VERIFY.title
  );
  await deps.prompter.select<boolean>({
    message: COPY.VERIFY.checkpointMessage,
    options: [{ value: true, label: COPY.VERIFY.checkpointLabel }],
  });
}

export async function runProductionCheckpoint(
  deps: WizardDeps,
  { authEnabled }: { authEnabled: boolean }
): Promise<void> {
  deps.prompter.note(
    authEnabled ? COPY.PRODUCTION.bodyAuthOn : COPY.PRODUCTION.bodyAuthOff,
    COPY.PRODUCTION.title
  );
  await deps.prompter.select<boolean>({
    message: COPY.PRODUCTION.checkpointMessage,
    options: [{ value: true, label: COPY.PRODUCTION.checkpointLabel }],
  });
}
