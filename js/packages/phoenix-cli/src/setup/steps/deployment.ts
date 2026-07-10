/**
 * Step 2: deployment resolution + auth probe (spec §3.2).
 *
 * Two options — Local or Remote ("paste your instance URL"). The probe is
 * an unauthenticated
 * `GET /v1/projects?limit=1`: 200 → auth off, 401/403 → auth on, anything
 * else → troubleshoot copy and re-ask (max 3 attempts).
 */

import * as COPY from "../copy";
import type { WizardDeps } from "../deps";
import { WizardCancelledError, WizardFatalError } from "../errors";
import {
  RestNetworkError,
  normalizeEndpoint,
  restRequest,
} from "../net/restClient";
import { redactForDisplay } from "../util/redact";

export interface DeploymentResolution {
  /** Normalized origin, no trailing slash. */
  endpoint: string;
  authEnabled: boolean;
}

const PROBE_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const DEFAULT_LOCAL_ENDPOINT = "http://localhost:6006";

export type ProbeOutcome =
  | { kind: "authOff" }
  | { kind: "authOn" }
  | { kind: "unreachable"; detail: string }
  | { kind: "notPhoenix"; detail: string };

/**
 * Probe an endpoint to determine reachability and whether auth is enabled.
 */
export async function probeEndpoint(
  deps: Pick<WizardDeps, "fetch">,
  endpoint: string
): Promise<ProbeOutcome> {
  let response;
  try {
    response = await restRequest({
      deps,
      method: "GET",
      url: `${endpoint}/v1/projects?limit=1`,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof RestNetworkError) {
      return { kind: "unreachable", detail: redactForDisplay(error.message) };
    }
    throw error;
  }
  if (response.status === 200 && response.json !== undefined) {
    return { kind: "authOff" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "authOn" };
  }
  return {
    kind: "notPhoenix",
    detail: `HTTP ${response.status}`,
  };
}

function validateUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return COPY.DEPLOYMENT.remoteUrlInvalid;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return COPY.DEPLOYMENT.remoteUrlInvalid;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return COPY.DEPLOYMENT.remoteUrlInvalid;
  }
  return undefined;
}

async function promptForEndpoint(deps: WizardDeps): Promise<string> {
  const choice = await deps.prompter.select<"local" | "remote">({
    message: COPY.DEPLOYMENT.selectMessage,
    options: [
      {
        value: "local",
        label: COPY.DEPLOYMENT.localLabel,
        hint: COPY.DEPLOYMENT.localHint,
      },
      {
        value: "remote",
        label: COPY.DEPLOYMENT.remoteLabel,
        hint: COPY.DEPLOYMENT.remoteHint,
      },
    ],
  });
  if (choice === "local") {
    return DEFAULT_LOCAL_ENDPOINT;
  }
  const url = await deps.prompter.textInput({
    message: COPY.DEPLOYMENT.remoteUrlMessage,
    validate: validateUrl,
  });
  return url;
}

export interface ResolveDeploymentArgs {
  /** Pre-answered endpoint from --endpoint / env (skips the select). */
  presetEndpoint?: string;
  headless: boolean;
}

export async function resolveDeployment(
  deps: WizardDeps,
  { presetEndpoint, headless }: ResolveDeploymentArgs
): Promise<DeploymentResolution> {
  let attempts = 0;
  let candidate = presetEndpoint;

  for (;;) {
    if (candidate === undefined) {
      candidate = await promptForEndpoint(deps);
    }
    let endpoint: string;
    try {
      endpoint = normalizeEndpoint(candidate);
    } catch {
      if (headless) {
        throw new WizardFatalError(COPY.DEPLOYMENT.remoteUrlInvalid);
      }
      deps.prompter.line(COPY.DEPLOYMENT.remoteUrlInvalid);
      candidate = undefined;
      continue;
    }

    deps.prompter.line(COPY.DEPLOYMENT.probing(endpoint));
    const outcome = await probeEndpoint(deps, endpoint);

    if (outcome.kind === "authOff") {
      deps.prompter.line(COPY.DEPLOYMENT.authOff);
      return { endpoint, authEnabled: false };
    }
    if (outcome.kind === "authOn") {
      deps.prompter.line(COPY.DEPLOYMENT.authOn);
      return { endpoint, authEnabled: true };
    }

    if (headless) {
      throw new WizardFatalError(COPY.DEPLOYMENT.headlessUnreachable(endpoint));
    }

    attempts += 1;
    deps.prompter.line(
      outcome.kind === "unreachable"
        ? COPY.DEPLOYMENT.unreachable(endpoint)
        : COPY.DEPLOYMENT.notPhoenix(endpoint, outcome.detail)
    );

    if (attempts >= MAX_ATTEMPTS) {
      deps.prompter.line(COPY.DEPLOYMENT.gaveUp);
      throw new WizardCancelledError();
    }

    const retry = await deps.prompter.select<boolean>({
      message: COPY.DEPLOYMENT.retryMessage,
      options: [
        { value: true, label: COPY.DEPLOYMENT.retryYes },
        { value: false, label: COPY.DEPLOYMENT.retryNo },
      ],
    });
    if (!retry) {
      throw new WizardCancelledError();
    }
    candidate = undefined;
  }
}
