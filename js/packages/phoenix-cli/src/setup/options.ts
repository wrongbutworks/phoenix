/**
 * Input resolution for the wizard (spec §1.2).
 *
 * Follows px's `resolveConfig()` precedence — flags, then env, then
 * defaults — additionally accepting `PHOENIX_COLLECTOR_ENDPOINT` and
 * `PHOENIX_PROJECT_NAME` as endpoint/project aliases (#14131). There are no
 * wizard-specific env vars. Reads env only through `WizardDeps.env`.
 *
 * Note the `--no-input` flag (or a non-TTY stdin) — not the presence of env
 * vars — is what opts into headless behavior: an ambient `PHOENIX_API_KEY`
 * in a dev shell never silently short-circuits the interactive flow.
 */

import type { WizardDeps } from "./deps";

export interface ResolvedWizardInputs {
  /** Pre-answered endpoint (flag, else env), if any. */
  endpoint?: string;
  /** Pre-answered project name or Relay Global ID (flag, else env), if any. */
  project?: string;
  /** API key from env — used by the headless auth-on lane only. */
  apiKey?: string;
  /** True when --no-input was passed or stdin is not a TTY. */
  headless: boolean;
}

export function resolveWizardInputs(
  deps: Pick<WizardDeps, "env" | "options" | "stdinIsTTY">
): ResolvedWizardInputs {
  const { env, options } = deps;
  const endpoint =
    options.endpoint ??
    env.PHOENIX_HOST ??
    env.PHOENIX_COLLECTOR_ENDPOINT ??
    undefined;
  const project =
    options.project ??
    env.PHOENIX_PROJECT ??
    env.PHOENIX_PROJECT_NAME ??
    undefined;
  const apiKey = env.PHOENIX_API_KEY ?? undefined;
  return {
    endpoint: endpoint?.trim() || undefined,
    project: project?.trim() || undefined,
    apiKey: apiKey?.trim() || undefined,
    headless: Boolean(options.noInput) || !deps.stdinIsTTY,
  };
}
