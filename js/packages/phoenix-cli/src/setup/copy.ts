/**
 * ALL user-facing strings for the setup wizard, organized by step
 * (spec §1.1). Control flow references copy; copy never references control
 * flow. Keep prose here so wording changes never touch step logic.
 */

// ---------------------------------------------------------------------------
// Docs contract (spec §7) — the only three doc URLs the wizard emits.
// ---------------------------------------------------------------------------

export const DOCS = {
  /** Single agent-facing tracing quickstart; the one URL in the prompt. */
  tracingQuickstart:
    "https://arize.com/docs/phoenix/get-started/get-started-tracing",
  /** Linked from the verification checkpoint. */
  troubleshooting:
    "https://arize.com/docs/phoenix/tracing/concepts-tracing/faqs-tracing",
  /** Linked from the manual lane. */
  instrumentationIndex: "https://arize.com/docs/phoenix/quickstart",
} as const;

export const SUPPORT_LINKS = [
  `Docs:            ${DOCS.instrumentationIndex}`,
  `Troubleshooting: ${DOCS.troubleshooting}`,
  "Issues:          https://github.com/Arize-ai/phoenix/issues",
  "Community:       https://arize-ai.slack.com",
].join("\n");

// ---------------------------------------------------------------------------
// Shell / lifecycle
// ---------------------------------------------------------------------------

export const INTRO = "Phoenix setup — from zero to traces in one session.";

export const CANCEL_OUTRO = [
  "Setup cancelled. Nothing else was changed.",
  "",
  SUPPORT_LINKS,
].join("\n");

export const OUTRO_TITLE = "You're set up.";

export const OUTRO_BODY = SUPPORT_LINKS;

// ---------------------------------------------------------------------------
// Step 1: git preflight
// ---------------------------------------------------------------------------

export const GIT = {
  notARepoMessage: "This directory is not a git repository. Continue anyway?",
  notARepoYes: "Yes, continue without git",
  notARepoNo: "No, stop here (recommended)",
  notARepoNoHint:
    "Setup may edit files via a coding agent — git is the undo button.",
  notARepoYesHint: "You will have no easy way to review or revert changes.",
  dirtyMessage: (fileCount: number) =>
    `You have ${fileCount} uncommitted change${fileCount === 1 ? "" : "s"}. Continue anyway?`,
  dirtyYes: "Yes, continue with a dirty tree",
  dirtyNo: "No, stop here so I can commit first (recommended)",
  dirtyNoHint: "A clean tree keeps agent edits separate from your own edits.",
  dirtyYesHint: "Agent edits will be tangled with your uncommitted work.",
  dirtyFileListTitle: "Uncommitted changes",
  andMore: (count: number) => `…and ${count} more`,
  headlessDirty:
    "Refusing to run headless in a dirty git tree. Commit or stash your changes and re-run.",
  headlessNotARepo:
    "Refusing to run headless outside a git repository. Run `git init` (or run setup interactively) and re-run.",
  stopped: "Stopped. Commit your work, then re-run `px setup`.",
} as const;

// ---------------------------------------------------------------------------
// Step 2: deployment resolution
// ---------------------------------------------------------------------------

export const DEPLOYMENT = {
  selectMessage: "Where is your Phoenix instance running?",
  localLabel: "Local — http://localhost:6006",
  localHint: "recommended if you just ran `phoenix serve`",
  remoteLabel: "Remote — paste your instance URL",
  remoteHint: "any Phoenix instance reachable by URL",
  remoteUrlMessage: "Phoenix instance URL",
  remoteUrlInvalid:
    "Enter a full http:// or https:// URL, e.g. https://phoenix.example.com",
  probing: (endpoint: string) => `Checking ${endpoint}…`,
  unreachable: (endpoint: string) =>
    [
      `Could not reach a Phoenix instance at ${endpoint}.`,
      "If it's local, is `phoenix serve` running? If it's remote, check the",
      "URL and that you can reach it from this machine (VPN?).",
    ].join("\n"),
  notPhoenix: (endpoint: string, detail: string) =>
    [
      `${endpoint} responded, but not like a Phoenix instance (${detail}).`,
      "Double-check the URL — it should be the Phoenix root URL, without",
      "a path like /projects.",
    ].join("\n"),
  retryMessage: "Try a different URL?",
  retryYes: "Yes, enter a URL again",
  retryNo: "No, exit setup",
  gaveUp: [
    "Couldn't establish a connection after several attempts.",
    `Setup docs: ${DOCS.instrumentationIndex}`,
  ].join("\n"),
  authOn: "Authentication is enabled on this instance.",
  authOff: "Authentication is off — no API key needed.",
  headlessUnreachable: (endpoint: string) =>
    `Could not reach Phoenix at ${endpoint}. Is it running and reachable from this machine?`,
} as const;

// ---------------------------------------------------------------------------
// Step 3: connection
// ---------------------------------------------------------------------------

export const CONNECT = {
  projectNameMessage: "Phoenix project name for this app's traces",
  projectNameInvalid:
    "Project names can't contain '/', '?', or '#' and can't be empty.",
  usingExistingProject: (name: string) => `Using existing project "${name}".`,
  createdProject: (name: string) => `Created project "${name}".`,
  createFailed: (detail: string) => `Couldn't create the project (${detail}).`,
  createFailedAuthHint:
    "The instance refused the write — it may have auth or read-only mode enabled after all. Switching to the authenticated flow.",
  headlessNeedsProject: [
    "Missing project. Provide one of:",
    "  --project <name>",
    "  PHOENIX_PROJECT=<name> (or PHOENIX_PROJECT_NAME=<name>)",
  ].join("\n"),
  headlessNeedsApiKey: [
    "This Phoenix instance has authentication enabled. Headless setup needs an API key. Provide:",
    "  PHOENIX_API_KEY=<key>",
    "and a project via --project or PHOENIX_PROJECT.",
  ].join("\n"),
  headlessProjectNotFound: (identifier: string) =>
    [
      `Project "${identifier}" was not found on this instance.`,
      "Create it in the Phoenix UI, or pass an existing project name or ID.",
    ].join("\n"),
  headlessAuthRejected:
    "The API key was rejected (401). Check PHOENIX_API_KEY.",
} as const;

// ---------------------------------------------------------------------------
// Auth-on browser flow (wizard session, spec §4)
// ---------------------------------------------------------------------------

export const WIZARD_SESSION = {
  starting: "Connecting your terminal to Phoenix…",
  codeIntro: "Your verification code:",
  codeExplainer: (code: string) =>
    [
      "A browser window will open so you can sign in and pick a project.",
      `Before authorizing, check the page shows this same code: ${code}`,
    ].join("\n"),
  browserOpened: (url: string) => `Opened ${url}`,
  browserFailed: (url: string) =>
    `Couldn't open a browser. Open this URL yourself:\n${url}`,
  waiting: "Waiting for you to authorize in the browser…",
  timedOut: "Timed out waiting for browser authorization (3 minutes).",
  expired: "The setup session expired before it was authorized.",
  claimed:
    "This setup session was already used. Re-run `px setup` to start a new one.",
  retryMessage: "What do you want to do?",
  retryYes: "Try the browser flow again",
  retryPaste: "Paste an API key instead",
  retryNo: "Exit setup",
  notSupported: [
    "This Phoenix version doesn't support browser-based CLI setup.",
    "You can paste an API key instead (create one in Phoenix under Settings).",
  ].join("\n"),
  pasteKeyMessage: "Phoenix API key",
  pasteKeyInvalid: "API key can't be empty.",
  pasteKeyRejected:
    "That API key was rejected by the instance (401). Try again.",
  complete: "Terminal authorized.",
} as const;

// ---------------------------------------------------------------------------
// Step 4: hand-off files
// ---------------------------------------------------------------------------

export const MATERIALIZE = {
  wrote: (names: string[]) =>
    `Wrote ${names.join(" and ")} into this directory (readable only by you).`,
  gitignored: (names: string[]) => `Added ${names.join(", ")} to .gitignore.`,
  fileHeaderEnv: (isoDate: string) =>
    [
      `# Generated by \`px setup\` on ${isoDate}.`,
      "# Contains a Phoenix API key — do NOT commit this file.",
      "# Safe to delete once tracing is verified and production is configured.",
    ].join("\n"),
  fileComment:
    "Generated by `px setup`. Sensitive — do not commit. Safe to delete once tracing is verified and production is configured.",
} as const;

// ---------------------------------------------------------------------------
// Step 6: instrumentation
// ---------------------------------------------------------------------------

export const INSTRUMENTATION = {
  modeMessage: "How do you want to instrument this app?",
  ownAgentLabel: "Copy a prompt for my own coding agent",
  ownAgentHint:
    "paste it into Claude Code, Codex, Cursor — any agent you run yourself",
  manualLabel: "I'll do it manually",
  manualHint: "follow the quickstart docs yourself",
  promptCopied:
    "Instrumentation prompt copied to your clipboard. Paste it into your agent in this directory.",
  promptCopyFailed:
    "Couldn't write to the clipboard — here is the prompt to copy:",
  ownAgentDoneMessage: "When your agent has finished:",
  ownAgentDoneLabel: "I've run the prompt",
  manualDocs: (url: string) => `Follow the tracing quickstart: ${url}`,
  manualDoneMessage: "When you've added instrumentation:",
  manualDoneLabel: "I've finished instrumenting",
} as const;

// ---------------------------------------------------------------------------
// Step 7: verification + production hand-off
// ---------------------------------------------------------------------------

export const VERIFY = {
  title: "Verify traces are flowing",
  instructions: (tracesUrl: string) =>
    [
      "1. Run your app with the Phoenix vars exported:",
      "     set -a; source .env.phoenix; set +a",
      "2. Make a request that calls your LLM.",
      `3. Open ${tracesUrl} and confirm traces appear.`,
      "",
      `Not seeing traces? ${DOCS.troubleshooting}`,
    ].join("\n"),
  checkpointMessage: "Confirm when you can see traces:",
  checkpointLabel: "I can see traces in Phoenix",
} as const;

export const PRODUCTION = {
  title: "Production hand-off",
  bodyAuthOn: [
    "Set these in your production environment:",
    "",
    "  PHOENIX_COLLECTOR_ENDPOINT — same value as in .env.phoenix",
    "  PHOENIX_API_KEY            — copy from .env.phoenix into your secret store",
    "",
    "The project name is set in code, so no extra env var is needed for it.",
  ].join("\n"),
  bodyAuthOff: [
    "This instance has no auth, so your app only needs:",
    "",
    "  PHOENIX_COLLECTOR_ENDPOINT — your Phoenix URL",
    "",
    "When you deploy Phoenix for real (with auth), also set PHOENIX_API_KEY.",
  ].join("\n"),
  checkpointMessage: "Production noted?",
  checkpointLabel: "Got it",
} as const;

// ---------------------------------------------------------------------------
// Step 8: px profile
// ---------------------------------------------------------------------------

export const PX_PROFILE = {
  optInMessage:
    "Also point the px CLI at this project? (lets you query traces from your terminal)",
  optInYes: "Yes, create a px profile",
  optInNo: "No thanks",
  conflictMessage: (profileName: string, endpoint: string) =>
    `px is currently using profile "${profileName}" → ${endpoint}. Switch to this project?`,
  conflictYes: "Yes, switch px to this project",
  conflictNo: "No, leave px as-is",
  created: (profileName: string) =>
    `px profile "${profileName}" created and activated. Try: px trace list`,
  failed: (detail: string) =>
    `Couldn't write the px profile (${detail}). You can create one later with \`px profile create\`.`,
} as const;

// ---------------------------------------------------------------------------
// Headless output
// ---------------------------------------------------------------------------

export const HEADLESS = {
  nextSteps: (tracesUrl: string) =>
    [
      "Next steps:",
      "  1. Export the vars:   set -a; source .env.phoenix; set +a",
      `  2. Instrument your app: ${DOCS.tracingQuickstart}`,
      `  3. Watch for traces:  ${tracesUrl}`,
    ].join("\n"),
} as const;
