/**
 * Loader for the CLI setup claim page (`/cli-setup?session=…`).
 *
 * Bootstraps the wizard session (verification code + liveness) and the
 * project list before render. Auth is enforced by the route tree — an
 * unauthenticated hit is redirected to login with a returnUrl that
 * preserves the session query param.
 */

import type { LoaderFunctionArgs } from "react-router";

import { authFetch } from "@phoenix/authFetch";
import { BASE_URL } from "@phoenix/config";

export type CliSetupSessionStatus =
  | "pending"
  | "complete"
  | "claimed"
  | "expired";

export interface CliSetupSessionInfo {
  status: CliSetupSessionStatus;
  verification_code: string;
  expires_at: string;
  viewer_blocked: boolean;
}

export interface CliSetupProject {
  id: string;
  name: string;
}

export type CliSetupLoaderData =
  | {
      kind: "ready";
      sessionToken: string;
      info: CliSetupSessionInfo;
      projects: CliSetupProject[];
    }
  | { kind: "missing-session" }
  | { kind: "unknown-session" };

export async function cliSetupLoader({
  request,
}: LoaderFunctionArgs): Promise<CliSetupLoaderData> {
  const sessionToken = new URL(request.url).searchParams.get("session");
  if (!sessionToken) {
    return { kind: "missing-session" };
  }

  const infoResponse = await authFetch(
    `${BASE_URL}/auth/setup-sessions/info?session_token=${encodeURIComponent(sessionToken)}`
  );
  if (infoResponse.status === 404) {
    return { kind: "unknown-session" };
  }
  if (!infoResponse.ok) {
    throw new Error(`Failed to load setup session (${infoResponse.status})`);
  }
  const info = (await infoResponse.json()) as CliSetupSessionInfo;

  let projects: CliSetupProject[] = [];
  if (info.status === "pending" && !info.viewer_blocked) {
    const projectsResponse = await authFetch(
      `${BASE_URL}/v1/projects?limit=100`
    );
    if (projectsResponse.ok) {
      const body = (await projectsResponse.json()) as {
        data: CliSetupProject[];
      };
      projects = body.data;
    }
  }

  return { kind: "ready", sessionToken, info, projects };
}
