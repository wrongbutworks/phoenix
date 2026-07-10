/**
 * Fake `WizardDeps` builders for wizard unit tests. No test spawns a real
 * agent or a real server (spec §10).
 */

import type {
  CommandSpec,
  ExecResult,
  StreamingChild,
} from "../../src/setup/agents/types";
import type {
  Prompter,
  SelectOption,
  WizardDeps,
  WizardOptions,
} from "../../src/setup/deps";
import { WizardCancelledError } from "../../src/setup/errors";

/** Sentinel answer that simulates Ctrl-C / Escape on a prompt. */
export const CANCEL = Symbol("cancel");

export type ScriptedAnswer = unknown | typeof CANCEL;

export interface ScriptedPrompter extends Prompter {
  /** Prompts asked, in order, for assertions. */
  transcript: string[];
  /** Notes/lines emitted, for copy assertions. */
  output: string[];
}

/**
 * A prompter that answers prompts from a FIFO script. Selects verify the
 * scripted answer is one of the offered option values.
 */
export function scriptedPrompter(answers: ScriptedAnswer[]): ScriptedPrompter {
  const queue = [...answers];
  const transcript: string[] = [];
  const output: string[] = [];

  function next(message: string): ScriptedAnswer {
    if (queue.length === 0) {
      throw new Error(`No scripted answer left for prompt: ${message}`);
    }
    return queue.shift();
  }

  return {
    transcript,
    output,
    async select<T>(args: {
      message: string;
      options: Array<SelectOption<T>>;
    }): Promise<T> {
      transcript.push(args.message);
      const answer = next(args.message);
      if (answer === CANCEL) {
        throw new WizardCancelledError();
      }
      const match = args.options.find((option) => option.value === answer);
      if (!match) {
        throw new Error(
          `Scripted answer ${String(answer)} is not an option for: ${args.message}`
        );
      }
      return match.value;
    },
    async textInput(args: {
      message: string;
      defaultValue?: string;
      validate?: (value: string) => string | undefined;
    }): Promise<string> {
      transcript.push(args.message);
      const answer = next(args.message);
      if (answer === CANCEL) {
        throw new WizardCancelledError();
      }
      const value =
        answer === undefined ? (args.defaultValue ?? "") : String(answer);
      const problem = args.validate?.(value);
      if (problem) {
        throw new Error(
          `Scripted answer "${value}" failed validation: ${problem}`
        );
      }
      return value;
    },
    async passwordInput(args: {
      message: string;
      validate?: (value: string) => string | undefined;
    }): Promise<string> {
      transcript.push(args.message);
      const answer = next(args.message);
      if (answer === CANCEL) {
        throw new WizardCancelledError();
      }
      const value = String(answer ?? "");
      const problem = args.validate?.(value);
      if (problem) {
        throw new Error(
          `Scripted answer "${value}" failed validation: ${problem}`
        );
      }
      return value;
    },
    note(message: string): void {
      output.push(message);
    },
    line(message: string): void {
      output.push(message);
    },
    intro(message: string): void {
      output.push(message);
    },
    outro(message: string): void {
      output.push(message);
    },
  };
}

export type FetchHandler = (
  url: string,
  init: RequestInit | undefined
) => Response | Promise<Response> | undefined;

/** Build a fetch fake from an ordered list of handlers (first match wins). */
export function fakeFetch(...handlers: FetchHandler[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const handler of handlers) {
      const response = await handler(url, init);
      if (response) {
        return response;
      }
    }
    throw new TypeError(`fetch failed: no fake handler for ${url}`);
  }) as typeof fetch;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface FakeDepsArgs {
  cwd?: string;
  env?: Record<string, string | undefined>;
  options?: WizardOptions;
  stdinIsTTY?: boolean;
  prompter?: Prompter;
  fetch?: typeof fetch;
  exec?: (spec: CommandSpec) => Promise<ExecResult>;
  writeClipboard?: (text: string) => Promise<boolean>;
  now?: () => number;
}

export function buildFakeDeps(args: FakeDepsArgs = {}): WizardDeps {
  return {
    cwd: args.cwd ?? "/tmp/fake-cwd",
    env: args.env ?? {},
    options: args.options ?? {},
    stdinIsTTY: args.stdinIsTTY ?? true,
    prompter: args.prompter ?? scriptedPrompter([]),
    writeClipboard: args.writeClipboard ?? (async () => true),
    fetch:
      args.fetch ??
      (async () => {
        throw new TypeError("fetch failed: no fake fetch configured");
      }),
    exec: args.exec ?? (async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    spawnStreaming: (): StreamingChild => {
      throw new Error("spawnStreaming not faked");
    },
    now: args.now ?? (() => 0),
  };
}

/** Standard git exec fake: inside a work tree, clean or dirty. */
export function gitExecFake({
  isRepo = true,
  dirtyFiles = [] as string[],
} = {}): (spec: CommandSpec) => Promise<ExecResult> {
  return async (spec: CommandSpec) => {
    if (spec.command !== "git") {
      return { exitCode: 127, stdout: "", stderr: "not faked" };
    }
    if (spec.args[0] === "rev-parse") {
      return isRepo
        ? { exitCode: 0, stdout: "true\n", stderr: "" }
        : { exitCode: 128, stdout: "", stderr: "not a git repository" };
    }
    if (spec.args[0] === "status") {
      return {
        exitCode: 0,
        stdout: dirtyFiles.map((file) => ` M ${file}`).join("\n"),
        stderr: "",
      };
    }
    return { exitCode: 1, stdout: "", stderr: "unexpected git call" };
  };
}
