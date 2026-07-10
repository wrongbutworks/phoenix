/**
 * Step 3: establish the connection (spec §3.3, §4).
 *
 * Lane dispatch: auth-off (resolve-first project create), auth-on
 * interactive (browser wizard session, with paste-an-API-key fallback for
 * deployments without setup-session support), and headless (env-provided
 * key). All lanes converge on `Connection`.
 */

import * as path from "node:path";

import * as COPY from "../copy";
import type { WizardDeps } from "../deps";
import {
  HeadlessInputError,
  WizardCancelledError,
  WizardFatalError,
} from "../errors";
import {
  RestNetworkError,
  parseProjectResponse,
  restRequest,
  type ProjectResource,
} from "../net/restClient";
import { createSetupSession, pollSetupSession } from "../net/setupSession";
import type { ResolvedWizardInputs } from "../options";
import { redactForDisplay } from "../util/redact";

export interface Connection {
  /** Normalized origin, no trailing slash. */
  endpoint: string;
  projectName: string;
  /** Relay Global ID, e.g. "UHJvamVjdDox". */
  projectId: string;
  /** Present iff auth is enabled on the deployment. */
  apiKey?: string;
}

const REST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Project helpers
// ---------------------------------------------------------------------------

/** Names are used as URL path identifiers; '/', '?', '#' are invalid. */
export function validateProjectName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || /[/?#]/.test(trimmed)) {
    return COPY.CONNECT.projectNameInvalid;
  }
  return undefined;
}

export function defaultProjectName(cwd: string): string {
  const base = path.basename(cwd).replace(/[/?#]/g, "-").trim();
  return base || "default";
}

type ProjectLookup =
  | { kind: "found"; project: ProjectResource }
  | { kind: "notFound" }
  | { kind: "unauthorized"; status: number }
  | { kind: "error"; detail: string };

async function getProject(
  deps: Pick<WizardDeps, "fetch">,
  endpoint: string,
  identifier: string,
  apiKey?: string
): Promise<ProjectLookup> {
  let response;
  try {
    response = await restRequest({
      deps,
      method: "GET",
      url: `${endpoint}/v1/projects/${encodeURIComponent(identifier)}`,
      apiKey,
      timeoutMs: REST_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof RestNetworkError) {
      return { kind: "error", detail: redactForDisplay(error.message) };
    }
    throw error;
  }
  if (response.status === 200) {
    const project = parseProjectResponse(response.json);
    if (project) {
      return { kind: "found", project };
    }
    return { kind: "error", detail: "unexpected response shape" };
  }
  if (response.status === 404) {
    return { kind: "notFound" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "unauthorized", status: response.status };
  }
  return { kind: "error", detail: `HTTP ${response.status}` };
}

type ProjectCreate =
  | { kind: "created"; project: ProjectResource }
  | { kind: "unauthorized"; status: number }
  | { kind: "error"; detail: string };

async function createProject(
  deps: Pick<WizardDeps, "fetch">,
  endpoint: string,
  name: string,
  apiKey?: string
): Promise<ProjectCreate> {
  let response;
  try {
    response = await restRequest({
      deps,
      method: "POST",
      url: `${endpoint}/v1/projects`,
      body: { name },
      apiKey,
      timeoutMs: REST_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof RestNetworkError) {
      return { kind: "error", detail: redactForDisplay(error.message) };
    }
    throw error;
  }
  if (response.ok) {
    const project = parseProjectResponse(response.json);
    if (project) {
      return { kind: "created", project };
    }
    return { kind: "error", detail: "unexpected response shape" };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: "unauthorized", status: response.status };
  }
  return { kind: "error", detail: `HTTP ${response.status}` };
}

/**
 * Resolve-first, then create (spec §3.3). A duplicate-name POST is an
 * unhandled 500 on today's server, so on any create failure we re-GET by
 * name before surfacing an error (covers create races too).
 */
export async function resolveOrCreateProject(
  deps: Pick<WizardDeps, "fetch">,
  endpoint: string,
  name: string,
  apiKey?: string
): Promise<
  | { kind: "ok"; project: ProjectResource; created: boolean }
  | { kind: "unauthorized"; status: number }
  | { kind: "error"; detail: string }
> {
  const existing = await getProject(deps, endpoint, name, apiKey);
  if (existing.kind === "found") {
    return { kind: "ok", project: existing.project, created: false };
  }
  if (existing.kind === "unauthorized") {
    return existing;
  }
  if (existing.kind === "error") {
    return existing;
  }

  const created = await createProject(deps, endpoint, name, apiKey);
  if (created.kind === "created") {
    return { kind: "ok", project: created.project, created: true };
  }
  if (created.kind === "unauthorized") {
    return created;
  }

  // POST failed (e.g. duplicate-name race → 500): re-GET before surfacing.
  const retry = await getProject(deps, endpoint, name, apiKey);
  if (retry.kind === "found") {
    return { kind: "ok", project: retry.project, created: false };
  }
  return { kind: "error", detail: created.detail };
}

// ---------------------------------------------------------------------------
// Auth-off lane
// ---------------------------------------------------------------------------

async function connectAuthOff(
  deps: WizardDeps,
  endpoint: string,
  inputs: ResolvedWizardInputs
): Promise<Connection | { switchToAuthOn: true }> {
  const projectName =
    inputs.project ??
    (await deps.prompter.textInput({
      message: COPY.CONNECT.projectNameMessage,
      defaultValue: defaultProjectName(deps.cwd),
      validate: validateProjectName,
    }));

  const result = await resolveOrCreateProject(
    deps,
    endpoint,
    projectName.trim()
  );
  if (result.kind === "ok") {
    deps.prompter.line(
      result.created
        ? COPY.CONNECT.createdProject(result.project.name)
        : COPY.CONNECT.usingExistingProject(result.project.name)
    );
    return {
      endpoint,
      projectName: result.project.name,
      projectId: result.project.id,
    };
  }
  if (result.kind === "unauthorized") {
    // The probe said auth-off but a write was refused — treat as auth-on
    // after all (read-only-mode fidelity, spec §3.2).
    deps.prompter.line(COPY.CONNECT.createFailedAuthHint);
    return { switchToAuthOn: true };
  }
  throw new WizardFatalError(COPY.CONNECT.createFailed(result.detail));
}

// ---------------------------------------------------------------------------
// Auth-on lanes
// ---------------------------------------------------------------------------

/**
 * Paste-an-API-key fallback: used when the deployment has no
 * setup-session endpoints, or when the user picks it after a browser-flow
 * failure. The key is validated by resolving (or creating) the project
 * through the authenticated REST surface.
 */
async function connectWithPastedKey(
  deps: WizardDeps,
  endpoint: string,
  inputs: ResolvedWizardInputs
): Promise<Connection> {
  for (;;) {
    const apiKey = await deps.prompter.textInput({
      message: COPY.WIZARD_SESSION.pasteKeyMessage,
      validate: (value) =>
        value.trim() ? undefined : COPY.WIZARD_SESSION.pasteKeyInvalid,
    });
    const projectName =
      inputs.project ??
      (await deps.prompter.textInput({
        message: COPY.CONNECT.projectNameMessage,
        defaultValue: defaultProjectName(deps.cwd),
        validate: validateProjectName,
      }));

    const result = await resolveOrCreateProject(
      deps,
      endpoint,
      projectName.trim(),
      apiKey.trim()
    );
    if (result.kind === "ok") {
      deps.prompter.line(
        result.created
          ? COPY.CONNECT.createdProject(result.project.name)
          : COPY.CONNECT.usingExistingProject(result.project.name)
      );
      return {
        endpoint,
        projectName: result.project.name,
        projectId: result.project.id,
        apiKey: apiKey.trim(),
      };
    }
    if (result.kind === "unauthorized" && result.status === 401) {
      deps.prompter.line(COPY.WIZARD_SESSION.pasteKeyRejected);
      continue;
    }
    throw new WizardFatalError(
      COPY.CONNECT.createFailed(
        result.kind === "unauthorized" ? `HTTP ${result.status}` : result.detail
      )
    );
  }
}

async function connectAuthOnInteractive(
  deps: WizardDeps,
  endpoint: string,
  inputs: ResolvedWizardInputs
): Promise<Connection> {
  for (;;) {
    deps.prompter.line(COPY.WIZARD_SESSION.starting);
    const created = await createSetupSession(deps, endpoint);

    if (created.kind === "unsupported") {
      deps.prompter.line(COPY.WIZARD_SESSION.notSupported);
      return connectWithPastedKey(deps, endpoint, inputs);
    }
    if (created.kind === "error") {
      deps.prompter.line(
        COPY.CONNECT.createFailed(redactForDisplay(created.detail))
      );
      const next = await promptSessionRetry(deps);
      if (next === "retry") {
        continue;
      }
      if (next === "paste") {
        return connectWithPastedKey(deps, endpoint, inputs);
      }
      throw new WizardCancelledError();
    }

    const { session } = created;
    // The claim page lives on the app origin — same as the API origin in
    // every real deployment; --app-url overrides it for development.
    const appOrigin = deps.options.appUrl ?? endpoint;
    const loginUrl = `${appOrigin}${session.loginPath}`;

    deps.prompter.note(
      `${COPY.WIZARD_SESSION.codeIntro} ${session.verificationCode}\n\n${COPY.WIZARD_SESSION.codeExplainer(session.verificationCode)}`
    );
    const opened = await deps.openBrowser(loginUrl);
    deps.prompter.line(
      opened
        ? COPY.WIZARD_SESSION.browserOpened(loginUrl)
        : COPY.WIZARD_SESSION.browserFailed(loginUrl)
    );
    deps.prompter.line(COPY.WIZARD_SESSION.waiting);

    const polled = await pollSetupSession(deps, endpoint, session);
    if (polled.kind === "complete") {
      deps.prompter.line(COPY.WIZARD_SESSION.complete);
      return {
        endpoint,
        projectName: polled.projectName,
        projectId: polled.projectId,
        apiKey: polled.apiKey,
      };
    }

    deps.prompter.line(
      polled.kind === "timedOut"
        ? COPY.WIZARD_SESSION.timedOut
        : polled.kind === "expired"
          ? COPY.WIZARD_SESSION.expired
          : polled.kind === "claimed"
            ? COPY.WIZARD_SESSION.claimed
            : COPY.CONNECT.createFailed(redactForDisplay(polled.detail))
    );
    const next = await promptSessionRetry(deps);
    if (next === "retry") {
      continue;
    }
    if (next === "paste") {
      return connectWithPastedKey(deps, endpoint, inputs);
    }
    throw new WizardCancelledError();
  }
}

function promptSessionRetry(
  deps: WizardDeps
): Promise<"retry" | "paste" | "exit"> {
  return deps.prompter.select<"retry" | "paste" | "exit">({
    message: COPY.WIZARD_SESSION.retryMessage,
    options: [
      { value: "retry", label: COPY.WIZARD_SESSION.retryYes },
      { value: "paste", label: COPY.WIZARD_SESSION.retryPaste },
      { value: "exit", label: COPY.WIZARD_SESSION.retryNo },
    ],
  });
}

// ---------------------------------------------------------------------------
// Headless lanes
// ---------------------------------------------------------------------------

async function connectHeadless(
  deps: WizardDeps,
  endpoint: string,
  authEnabled: boolean,
  inputs: ResolvedWizardInputs
): Promise<Connection> {
  if (!inputs.project) {
    throw new HeadlessInputError(COPY.CONNECT.headlessNeedsProject);
  }
  if (authEnabled && !inputs.apiKey) {
    throw new HeadlessInputError(COPY.CONNECT.headlessNeedsApiKey);
  }

  if (authEnabled) {
    // Resolve only — never create silently with someone's key in CI.
    const lookup = await getProject(
      deps,
      endpoint,
      inputs.project,
      inputs.apiKey
    );
    if (lookup.kind === "found") {
      return {
        endpoint,
        projectName: lookup.project.name,
        projectId: lookup.project.id,
        apiKey: inputs.apiKey,
      };
    }
    if (lookup.kind === "notFound") {
      throw new WizardFatalError(
        COPY.CONNECT.headlessProjectNotFound(inputs.project)
      );
    }
    if (lookup.kind === "unauthorized") {
      throw new WizardFatalError(COPY.CONNECT.headlessAuthRejected);
    }
    throw new WizardFatalError(COPY.CONNECT.createFailed(lookup.detail));
  }

  const nameError = validateProjectName(inputs.project);
  if (nameError) {
    throw new HeadlessInputError(nameError);
  }
  const result = await resolveOrCreateProject(
    deps,
    endpoint,
    inputs.project.trim()
  );
  if (result.kind === "ok") {
    return {
      endpoint,
      projectName: result.project.name,
      projectId: result.project.id,
    };
  }
  throw new WizardFatalError(
    COPY.CONNECT.createFailed(
      result.kind === "unauthorized" ? `HTTP ${result.status}` : result.detail
    )
  );
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export interface EstablishConnectionArgs {
  endpoint: string;
  authEnabled: boolean;
  inputs: ResolvedWizardInputs;
}

export async function establishConnection(
  deps: WizardDeps,
  { endpoint, authEnabled, inputs }: EstablishConnectionArgs
): Promise<Connection> {
  if (inputs.headless) {
    return connectHeadless(deps, endpoint, authEnabled, inputs);
  }
  if (!authEnabled) {
    const result = await connectAuthOff(deps, endpoint, inputs);
    if ("switchToAuthOn" in result) {
      return connectAuthOnInteractive(deps, endpoint, inputs);
    }
    return result;
  }
  return connectAuthOnInteractive(deps, endpoint, inputs);
}
