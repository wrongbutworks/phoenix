/**
 * Client for the setup-session (device-auth-style) protocol (spec §4).
 *
 * `session_token` identifies the session and appears in the browser URL;
 * `poll_token` authorizes polling and never leaves the terminal. Polling
 * runs every 2s, backs off +1s per HTTP 429 (capped at 30s), and gives up
 * after a 3-minute hard timeout.
 */

import type { WizardDeps } from "../deps";
import { RestNetworkError, restRequest } from "./restClient";

const CREATE_TIMEOUT_MS = 15_000;
const POLL_REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_BACKOFF_INCREMENT_MS = 1_000;
const POLL_INTERVAL_CAP_MS = 30_000;
const POLL_HARD_TIMEOUT_MS = 3 * 60_000;

export interface SetupSession {
  sessionToken: string;
  pollToken: string;
  expiresAt: string;
  /** Path (starting with /) on the app origin, e.g. /cli-setup?session=… */
  loginPath: string;
  verificationCode: string;
}

export type CreateSessionResult =
  | { kind: "created"; session: SetupSession }
  | { kind: "unsupported" }
  | { kind: "error"; detail: string };

export async function createSetupSession(
  deps: Pick<WizardDeps, "fetch">,
  endpoint: string
): Promise<CreateSessionResult> {
  let response;
  try {
    response = await restRequest({
      deps,
      method: "POST",
      url: `${endpoint}/auth/setup-sessions`,
      timeoutMs: CREATE_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof RestNetworkError) {
      return { kind: "error", detail: error.message };
    }
    throw error;
  }
  if (response.status === 404 || response.status === 405) {
    // Older Phoenix without the setup-session endpoints.
    return { kind: "unsupported" };
  }
  const body = response.json as Record<string, unknown> | undefined;
  if (
    (response.status === 200 || response.status === 201) &&
    body &&
    typeof body.session_token === "string" &&
    typeof body.poll_token === "string" &&
    typeof body.login_path === "string" &&
    typeof body.verification_code === "string"
  ) {
    return {
      kind: "created",
      session: {
        sessionToken: body.session_token,
        pollToken: body.poll_token,
        expiresAt: String(body.expires_at ?? ""),
        loginPath: body.login_path,
        verificationCode: body.verification_code,
      },
    };
  }
  return { kind: "error", detail: `HTTP ${response.status}` };
}

export type PollResult =
  | {
      kind: "complete";
      apiKey: string;
      projectId: string;
      projectName: string;
    }
  | { kind: "expired" }
  | { kind: "claimed" }
  | { kind: "timedOut" }
  | { kind: "error"; detail: string };

export async function pollSetupSession(
  deps: Pick<WizardDeps, "fetch" | "sleep" | "now">,
  endpoint: string,
  session: Pick<SetupSession, "sessionToken" | "pollToken">
): Promise<PollResult> {
  const deadline = deps.now() + POLL_HARD_TIMEOUT_MS;
  let interval = POLL_INTERVAL_MS;
  const url = `${endpoint}/auth/setup-sessions/poll?session_token=${encodeURIComponent(
    session.sessionToken
  )}`;

  while (deps.now() < deadline) {
    let response;
    try {
      response = await restRequest({
        deps,
        method: "GET",
        url,
        apiKey: session.pollToken,
        timeoutMs: POLL_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof RestNetworkError) {
        // Transient network blips shouldn't kill a pending session.
        await deps.sleep(interval);
        continue;
      }
      throw error;
    }

    if (response.status === 429) {
      interval = Math.min(
        interval + POLL_BACKOFF_INCREMENT_MS,
        POLL_INTERVAL_CAP_MS
      );
      await deps.sleep(interval);
      continue;
    }

    const body = response.json as Record<string, unknown> | undefined;
    const status = body?.status;
    if (response.status === 200 && typeof status === "string") {
      if (status === "pending") {
        await deps.sleep(interval);
        continue;
      }
      if (status === "expired") {
        return { kind: "expired" };
      }
      if (status === "claimed") {
        return { kind: "claimed" };
      }
      if (
        status === "complete" &&
        typeof body?.api_key === "string" &&
        typeof body?.project_id === "string" &&
        typeof body?.project_name === "string"
      ) {
        return {
          kind: "complete",
          apiKey: body.api_key,
          projectId: body.project_id,
          projectName: body.project_name,
        };
      }
    }
    return { kind: "error", detail: `HTTP ${response.status}` };
  }
  return { kind: "timedOut" };
}
