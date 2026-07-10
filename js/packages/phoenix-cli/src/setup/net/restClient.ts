/**
 * Minimal fetch wrapper for the Phoenix v1 REST surface used by the wizard
 * (spec §1.1). Deliberately tiny: timeouts, JSON parsing, and typed results —
 * no retries, no client classes.
 */

import type { WizardDeps } from "../deps";

export interface RestResponse {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or undefined when the body was not JSON. */
  json?: unknown;
  /** Raw text body (for error surfacing; redact before display). */
  text: string;
}

export class RestNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestNetworkError";
  }
}

export interface RestRequestArgs {
  deps: Pick<WizardDeps, "fetch">;
  method: "GET" | "POST";
  url: string;
  apiKey?: string;
  body?: unknown;
  timeoutMs: number;
}

/**
 * Perform a single HTTP request. Throws `RestNetworkError` for
 * network-level failures (unreachable, DNS, timeout); returns a
 * `RestResponse` for anything that produced an HTTP status.
 */
export async function restRequest({
  deps,
  method,
  url,
  apiKey,
  body,
  timeoutMs,
}: RestRequestArgs): Promise<RestResponse> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) {
    headers["authorization"] = `Bearer ${apiKey}`;
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new RestNetworkError(String(error));
  }
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { ok: response.ok, status: response.status, json, text };
}

/**
 * Normalize a user-provided endpoint to an origin-like base URL with no
 * trailing slash. Throws TypeError on unparseable input (callers validate
 * first in interactive mode).
 */
export function normalizeEndpoint(input: string): string {
  const url = new URL(input.trim());
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export interface ProjectResource {
  id: string;
  name: string;
  description?: string | null;
}

/** Extract `{ data: Project }` from a v1 response body. */
export function parseProjectResponse(
  json: unknown
): ProjectResource | undefined {
  if (
    typeof json === "object" &&
    json !== null &&
    "data" in json &&
    typeof (json as { data: unknown }).data === "object" &&
    (json as { data: unknown }).data !== null
  ) {
    const data = (json as { data: Record<string, unknown> }).data;
    if (typeof data.id === "string" && typeof data.name === "string") {
      return {
        id: data.id,
        name: data.name,
        description:
          typeof data.description === "string" ? data.description : null,
      };
    }
  }
  return undefined;
}
