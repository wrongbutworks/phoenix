/**
 * Step 6: instrumentation mode select + lanes (spec §3.6).
 *
 * Current lanes: own-agent (prompt to clipboard, fallback: print) and
 * manual (docs link). The built-in agent lane (spawn Claude Code / Codex
 * headless) is the agent-lane phase and slots in here behind the same mode
 * select. All lanes converge on verification — the wizard's definition of
 * done is human-verified data flow, not agent self-report.
 */

import * as COPY from "../copy";
import type { WizardDeps } from "../deps";
import { buildInstrumentationPrompt } from "../prompt/instrumentationPrompt";
import type { Connection } from "./connect";

export type InstrumentationMode = "ownAgent" | "manual";

const DEFAULT_LOCAL_ENDPOINT = "http://localhost:6006";

export async function runInstrumentationStep(
  deps: WizardDeps,
  connection: Connection,
  { authEnabled }: { authEnabled: boolean }
): Promise<void> {
  const mode = await deps.prompter.select<InstrumentationMode>({
    message: COPY.INSTRUMENTATION.modeMessage,
    options: [
      {
        value: "ownAgent",
        label: COPY.INSTRUMENTATION.ownAgentLabel,
        hint: COPY.INSTRUMENTATION.ownAgentHint,
      },
      {
        value: "manual",
        label: COPY.INSTRUMENTATION.manualLabel,
        hint: COPY.INSTRUMENTATION.manualHint,
      },
    ],
  });

  if (mode === "ownAgent") {
    const prompt = buildInstrumentationPrompt({
      projectName: connection.projectName,
      endpoint: connection.endpoint,
      isDefaultEndpoint: connection.endpoint === DEFAULT_LOCAL_ENDPOINT,
      quickstartUrl: COPY.DOCS.tracingQuickstart,
      authEnabled,
    });
    const copied = await deps.writeClipboard(prompt);
    if (copied) {
      deps.prompter.line(COPY.INSTRUMENTATION.promptCopied);
    } else {
      deps.prompter.line(COPY.INSTRUMENTATION.promptCopyFailed);
      deps.prompter.note(prompt);
    }
    await deps.prompter.select<boolean>({
      message: COPY.INSTRUMENTATION.ownAgentDoneMessage,
      options: [{ value: true, label: COPY.INSTRUMENTATION.ownAgentDoneLabel }],
    });
    return;
  }

  deps.prompter.line(
    COPY.INSTRUMENTATION.manualDocs(COPY.DOCS.tracingQuickstart)
  );
  await deps.prompter.select<boolean>({
    message: COPY.INSTRUMENTATION.manualDoneMessage,
    options: [{ value: true, label: COPY.INSTRUMENTATION.manualDoneLabel }],
  });
}
