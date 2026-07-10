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

const PROJECTS_PAGE_SIZE = 100;

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

async function loadAllProjects(): Promise<CliSetupProject[]> {
  const projects: CliSetupProject[] = [];
  let cursor: string | null = null;

  do {
    const searchParams = new URLSearchParams({
      limit: String(PROJECTS_PAGE_SIZE),
    });
    if (cursor) {
      searchParams.set("cursor", cursor);
    }

    const response = await authFetch(
      `${BASE_URL}/v1/projects?${searchParams.toString()}`
    );
    if (!response.ok) {
      throw new Error(`Failed to load projects (${response.status})`);
    }

    const body = (await response.json()) as {
      data: CliSetupProject[];
      next_cursor: string | null;
    };
    projects.push(...body.data);
    cursor = body.next_cursor;
  } while (cursor);

  return projects;
}

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

  const projects =
    info.status === "pending" && !info.viewer_blocked
      ? await loadAllProjects()
      : [];

  return { kind: "ready", sessionToken, info, projects };
}
