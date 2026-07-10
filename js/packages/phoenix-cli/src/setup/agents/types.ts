/**
 * Contracts for coding-agent orchestration (spec §5.1).
 *
 * Phase 1/3 of the wizard uses only `CommandSpec` / `ExecResult` /
 * `StreamingChild` (for git preflight and probes). The `Adapter` contract is
 * implemented by `claude.ts` / `codex.ts` in the agent-lane phase.
 */

import type { WizardDeps } from "../deps";

export type OutcomeVerb =
  | "thinking"
  | "reading"
  | "editing"
  | "running"
  | "completed"
  | "failed";

export interface CodingToolEvent {
  verb: OutcomeVerb;
  /** Humanized path or command (util/paths.ts). */
  target?: string;
  /** Compacted tool-input summary. */
  detail?: string;
}

export interface CodingToolStatus {
  installed: boolean;
  /** installed && logged in && smoke passed */
  usable: boolean;
  version?: string;
  /** e.g. "subscription", "api-key" */
  authMode?: string;
  /** User-visible: "not installed", "not logged in — run `claude login`", "smoke test failed" */
  reason?: string;
}

export interface CommandSpec {
  command: string;
  args: string[];
  stdin?: string;
  env?: Record<string, string>;
  cwd?: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Handle on a long-running child process whose stdout is consumed as a
 * stream (agent runs). `wait()` resolves when the process exits.
 */
export interface StreamingChild {
  stdout: AsyncIterable<string>;
  wait(): Promise<{ exitCode: number }>;
  kill(): void;
}

export interface Adapter {
  id: "claude" | "codex";
  /** "Claude Code", "Codex" */
  label: string;
  /** Binary name for PATH discovery. */
  command: string;
  /** Probe + smoke. */
  status(deps: WizardDeps): Promise<CodingToolStatus>;
  smokeCommand(args: { cwd: string; prompt: string }): CommandSpec;
  runCommand(args: {
    cwd: string;
    prompt: string;
    env: Record<string, string>;
  }): CommandSpec;
  parseEvents(jsonValue: unknown, cwd: string): CodingToolEvent[];
  parseFinalText(jsonValue: unknown): string | undefined;
}
