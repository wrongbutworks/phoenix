/**
 * Dependency injection seam for the setup wizard.
 *
 * Every side effect the wizard performs — env access, network, subprocesses,
 * clipboard, browser, time — goes through `WizardDeps`. No other module under
 * `setup/` may touch `process.env`, `fetch`, `child_process`, the clipboard,
 * or the browser opener directly. This is what makes the whole wizard
 * unit-testable with fakes (spec §1.2, §10).
 */

import { spawn } from "node:child_process";
import * as process from "node:process";

import type { CommandSpec, ExecResult, StreamingChild } from "./agents/types";
import { createClackPrompter } from "./ui/prompter";

export interface WizardOptions {
  /** --endpoint: pre-answer the deployment question */
  endpoint?: string;
  /** --project: name or Relay Global ID */
  project?: string;
  /** --no-input: headless mode (also auto-on when !stdin.isTTY, per px convention) */
  noInput?: boolean;
  /** hidden --app-url: browser-flow origin override (dev) */
  appUrl?: string;
  /** hidden --api-url: REST origin override (dev) */
  apiUrl?: string;
}

export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
  /** Rendered unselectable with the reason appended to the label. */
  disabled?: boolean;
}

export interface Prompter {
  /** Throws WizardCancelledError on Ctrl-C / Escape. */
  select<T>(args: {
    message: string;
    options: Array<SelectOption<T>>;
  }): Promise<T>;
  /** Throws WizardCancelledError on Ctrl-C / Escape. */
  textInput(args: {
    message: string;
    defaultValue?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string>;
  /** Non-interactive display of a block of text between prompts. */
  note(message: string, title?: string): void;
  /** One-line status/warning between prompts (stderr). */
  line(message: string): void;
  /** Open the wizard session frame. */
  intro(message: string): void;
  /** Close the wizard session frame. */
  outro(message: string): void;
}

export interface WizardDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  options: WizardOptions;
  stdinIsTTY: boolean;
  /** Override the px settings file location (tests only). */
  settingsPath?: string;
  /** Real: clack-backed ui/prompter.ts; tests: scripted answers. */
  prompter: Prompter;
  /** Resolves false when the browser could not be opened — not fatal. */
  openBrowser(url: string): Promise<boolean>;
  writeClipboard(text: string): Promise<boolean>;
  /** Injected for tests. */
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  /** One-shot subprocess (git, probes). Never throws on non-zero exit. */
  exec(spec: CommandSpec): Promise<ExecResult>;
  /** Long-running subprocess with streamed stdout (agent runs). */
  spawnStreaming(spec: CommandSpec): StreamingChild;
  now(): number;
}

function execOnce(spec: CommandSpec): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      // Command not found and similar spawn failures surface as a non-zero
      // exit with the message on stderr rather than a throw.
      resolve({ exitCode: 127, stdout, stderr: String(error) });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    if (spec.stdin !== undefined) {
      child.stdin.write(spec.stdin);
    }
    child.stdin.end();
  });
}

function spawnStreamingChild(spec: CommandSpec): StreamingChild {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env ? { ...process.env, ...spec.env } : process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (spec.stdin !== undefined) {
    child.stdin.write(spec.stdin);
  }
  child.stdin.end();

  async function* iterateStdout(): AsyncIterable<string> {
    for await (const chunk of child.stdout) {
      yield (chunk as Buffer).toString("utf-8");
    }
  }

  return {
    stdout: iterateStdout(),
    wait: () =>
      new Promise((resolve) => {
        child.on("close", (code) => resolve({ exitCode: code ?? 1 }));
        child.on("error", () => resolve({ exitCode: 127 }));
      }),
    kill: () => {
      child.kill("SIGTERM");
    },
  };
}

/**
 * Open a URL in the default browser. Resolves false on failure — callers
 * always have a copy/paste fallback.
 */
async function openBrowser(url: string): Promise<boolean> {
  const platform = process.platform;
  const spec: CommandSpec =
    platform === "darwin"
      ? { command: "open", args: [url] }
      : platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", url] }
        : { command: "xdg-open", args: [url] };
  const result = await execOnce(spec);
  return result.exitCode === 0;
}

/**
 * Write text to the system clipboard. Resolves false on failure — callers
 * fall back to printing the text.
 */
async function writeClipboard(text: string): Promise<boolean> {
  const platform = process.platform;
  const candidates: CommandSpec[] =
    platform === "darwin"
      ? [{ command: "pbcopy", args: [], stdin: text }]
      : platform === "win32"
        ? [{ command: "clip", args: [], stdin: text }]
        : [
            { command: "wl-copy", args: [], stdin: text },
            {
              command: "xclip",
              args: ["-selection", "clipboard"],
              stdin: text,
            },
          ];
  for (const candidate of candidates) {
    const result = await execOnce(candidate);
    if (result.exitCode === 0) {
      return true;
    }
  }
  return false;
}

export function buildDefaultDeps(options: WizardOptions): WizardDeps {
  return {
    cwd: process.cwd(),
    env: process.env,
    options,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    prompter: createClackPrompter(),
    openBrowser,
    writeClipboard,
    fetch: globalThis.fetch.bind(globalThis),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    exec: execOnce,
    spawnStreaming: spawnStreamingChild,
    now: () => Date.now(),
  };
}
