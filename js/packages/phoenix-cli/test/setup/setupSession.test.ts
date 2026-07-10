import { describe, expect, it } from "vitest";

import {
  createSetupSession,
  pollSetupSession,
} from "../../src/setup/net/setupSession";
import { buildFakeDeps, fakeFetch, jsonResponse } from "./fakes";

const ENDPOINT = "http://localhost:6006";
const SESSION = { sessionToken: "sess-token", pollToken: "poll-token" };

const CREATED_BODY = {
  session_token: "sess-token",
  poll_token: "poll-token",
  expires_at: "2026-07-08T00:15:00Z",
  login_path: "/cli-setup?session=sess-token",
  verification_code: "KRFT-2946",
};

describe("createSetupSession", () => {
  it("parses a created session", async () => {
    const deps = buildFakeDeps({
      fetch: fakeFetch(() => jsonResponse(201, CREATED_BODY)),
    });
    const result = await createSetupSession(deps, ENDPOINT);
    expect(result).toEqual({
      kind: "created",
      session: {
        sessionToken: "sess-token",
        pollToken: "poll-token",
        expiresAt: "2026-07-08T00:15:00Z",
        loginPath: "/cli-setup?session=sess-token",
        verificationCode: "KRFT-2946",
      },
    });
  });

  it("maps 404 to unsupported (older Phoenix)", async () => {
    const deps = buildFakeDeps({
      fetch: fakeFetch(() => jsonResponse(404, { detail: "Not Found" })),
    });
    expect(await createSetupSession(deps, ENDPOINT)).toEqual({
      kind: "unsupported",
    });
  });

  it("maps network failure to error", async () => {
    const deps = buildFakeDeps({
      fetch: fakeFetch(() => {
        throw new TypeError("fetch failed");
      }),
    });
    const result = await createSetupSession(deps, ENDPOINT);
    expect(result.kind).toBe("error");
  });
});

describe("pollSetupSession", () => {
  it("polls through pending to complete with the poll token", async () => {
    let calls = 0;
    let sawPollToken = false;
    const deps = buildFakeDeps({
      fetch: fakeFetch((url, init) => {
        calls += 1;
        const headers = init?.headers as Record<string, string>;
        sawPollToken = headers?.authorization === "Bearer poll-token";
        if (calls < 3) {
          return jsonResponse(200, { status: "pending" });
        }
        return jsonResponse(200, {
          status: "complete",
          api_key: "sk-minted",
          project_id: "UHJvamVjdDox",
          project_name: "my-app",
        });
      }),
    });
    const result = await pollSetupSession(deps, ENDPOINT, SESSION);
    expect(result).toEqual({
      kind: "complete",
      apiKey: "sk-minted",
      projectId: "UHJvamVjdDox",
      projectName: "my-app",
    });
    expect(sawPollToken).toBe(true);
    expect(calls).toBe(3);
  });

  it("backs off +1s per 429 and still completes", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const deps = buildFakeDeps({
      fetch: fakeFetch(() => {
        calls += 1;
        if (calls <= 2) {
          return jsonResponse(429, { detail: "rate limited" });
        }
        return jsonResponse(200, {
          status: "complete",
          api_key: "k",
          project_id: "p",
          project_name: "n",
        });
      }),
    });
    const baseSleep = deps.sleep;
    deps.sleep = async (ms: number) => {
      sleeps.push(ms);
      await baseSleep(ms);
    };
    const result = await pollSetupSession(deps, ENDPOINT, SESSION);
    expect(result.kind).toBe("complete");
    // 2000 → +1000 → 3000 after first 429, +1000 → 4000 after second.
    expect(sleeps).toEqual([3000, 4000]);
  });

  it("returns expired and claimed as-is", async () => {
    for (const status of ["expired", "claimed"] as const) {
      const deps = buildFakeDeps({
        fetch: fakeFetch(() => jsonResponse(200, { status })),
      });
      const result = await pollSetupSession(deps, ENDPOINT, SESSION);
      expect(result.kind).toBe(status);
    }
  });

  it("times out after the 3-minute hard deadline", async () => {
    const deps = buildFakeDeps({
      fetch: fakeFetch(() => jsonResponse(200, { status: "pending" })),
    });
    const result = await pollSetupSession(deps, ENDPOINT, SESSION);
    expect(result.kind).toBe("timedOut");
  });
});
