import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetchMock = vi.hoisted(() =>
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
);

vi.mock("@phoenix/authFetch", () => ({ authFetch: authFetchMock }));

import { BASE_URL } from "@phoenix/config";

import { cliSetupLoader } from "../cliSetupLoader";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function buildLoaderArgs(url: string): LoaderFunctionArgs {
  return {
    request: new Request(url),
    params: {},
    context: {},
  } as LoaderFunctionArgs;
}

describe("cliSetupLoader", () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it("loads every page of projects before returning the selector data", async () => {
    const firstPageProjects = Array.from({ length: 100 }, (_, index) => ({
      id: `project-${index + 1}`,
      name: `Project ${index + 1}`,
    }));
    const finalProject = { id: "project-101", name: "Project 101" };
    const nextCursor = "Project:cursor/101";

    authFetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          status: "pending",
          verification_code: "ABCD-EFGH",
          expires_at: "2026-07-09T20:00:00Z",
          viewer_blocked: false,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: firstPageProjects, next_cursor: nextCursor })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [finalProject], next_cursor: null })
      );

    const result = await cliSetupLoader(
      buildLoaderArgs("http://localhost/cli-setup?session=session-token")
    );

    expect(authFetchMock).toHaveBeenNthCalledWith(
      2,
      `${BASE_URL}/v1/projects?limit=100`
    );
    expect(authFetchMock).toHaveBeenNthCalledWith(
      3,
      `${BASE_URL}/v1/projects?limit=100&cursor=Project%3Acursor%2F101`
    );
    expect(result).toMatchObject({
      kind: "ready",
      projects: [...firstPageProjects, finalProject],
    });
  });
});
