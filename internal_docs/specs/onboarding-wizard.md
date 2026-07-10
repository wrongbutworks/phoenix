# Agent-First Onboarding Wizard (`px setup`)

A terminal wizard that takes a developer from **zero** to **"my app is sending traces to
Phoenix, and my production environment is configured"** in a single session. Its central design
decision: the wizard **does not instrument the user's code itself** — it establishes a working
Phoenix connection, materializes that connection into the working directory, then **delegates
the code changes to a locally-installed coding agent** (Claude Code or Codex) running headless
behind a guard-railed prompt, with live progress streamed into the wizard UI and a
sentinel-based completion protocol.

## Status

**Revised for the backend-free auth flow, 2026-07-09.** The wizard ships **inside the px CLI
as `px setup`**, not as a separate package (§1). Authenticated interactive setup temporarily
uses a pasted API key; a future OAuth grant replaces only credential acquisition (§4).
Implementers should treat the choices in this document as decided; deviations go back
through the maintainer. Tracked in
[#14129](https://github.com/Arize-ai/phoenix/issues/14129). Related but **non-blocking**:
[#14130](https://github.com/Arize-ai/phoenix/issues/14130) (SDK credential-file
auto-discovery), [#14131](https://github.com/Arize-ai/phoenix/issues/14131) (project-name env
var unification). All codebase claims below were verified against `main` on 2026-07-07/08; see
[Appendix A](#appendix-a-codebase-grounding).

## Goals

- One command — `px setup` (zero-install: `npx @arizeai/phoenix-cli setup`, or the
  no-Node-required curl installer, §1.3) — from an uninstrumented repo to human-verified
  traces in the Phoenix UI.
- Work against **any deployment**: local `phoenix serve` (auth off) or a remote instance —
  self-hosted or Phoenix Cloud — with auth on or off. The wizard does not distinguish Cloud
  from self-hosted; both are "remote: paste your instance URL".
- Delegate instrumentation to a coding agent safely: git preflight, explicit full-permission
  consent, smoke tests, secret hygiene, and fallback lanes that never dead-end.
- Every lane must work against **today's Phoenix with zero backend changes**.

## Non-Goals (v1)

- Evals, datasets, prompts, or any onboarding beyond tracing. The instrumentation prompt is
  tracing-only by rule.
- Windows-first polish. POSIX is the v1 target; Windows paths are Phase 4. The curl
  installer and compiled binaries (§1.3) are macOS/Linux only in v1.
- SDK discovery of the `.env.phoenix` hand-off file (#14130). The agent-lane mechanism is env
  injection, which works today.
- Organizations/tenancy and the future OAuth grant. Both are separate follow-up work; the
  v1 credential boundary is designed so they do not affect project resolution or later steps.
- Telemetry. The wizard emits **no** funnel events in v1 (resolved 2026-07-08); if a concrete
  funnel-analysis need appears, it is its own reviewed feature.

## Terminology

| Term | Meaning |
|---|---|
| **wizard** | The `px setup` command inside `@arizeai/phoenix-cli`. |
| **deployment** | The Phoenix instance the user connects to (local or remote). |
| **connection** | `{ endpoint, projectName, projectId, apiKey? }` — the wizard's output of step 3. |
| **lane** | A mutually-exclusive path through a step (auth-on vs auth-off; built-in agent vs own-agent vs manual). |
| **hand-off files** | `.env.phoenix` + `.phoenix.json`, written into cwd for the human. |
| **agent / coding tool** | Claude Code or Codex CLI, run headless by the wizard. |
| **sentinel** | `INSTRUMENTATION_COMPLETE` / `INSTRUMENTATION_INCOMPLETE` in agent final text. |
| **credential acquisition** | The auth-on step that currently prompts for an API key and can later be replaced by OAuth. |

---

## 1. Packaging and placement

**The wizard is a px CLI command** (resolved 2026-07-08, superseding the earlier
separate-package default): `px setup`, registered in `js/packages/phoenix-cli` alongside the
existing commands. Two zero-install channels exist: `npx @arizeai/phoenix-cli setup` (Node
users) and a curl installer that downloads a compiled standalone `px` binary and runs
`px setup` (no Node required, §1.3). No new package is published. `setup` is a deliberate exception to the CLI's noun-verb rule — onboarding is a
wizard, not a resource (precedent: `gh browse`-style top-level specials); document it as such
in `--help`.

Being in-CLI has three structural consequences:

- **Prompt framework: `@clack/prompts`.** The earlier "no prompt framework" rule existed to
  keep a standalone npx package light; px already ships clack (see `src/confirm.ts`), so the
  wizard uses it behind the `Prompter` seam (§1.2). The house rules survive the framework:
  every choice — including booleans — is a **select** with labeled options and hints;
  `selectBoolean` orders "No" first for dangerous choices; recommended options say
  "(recommended)"; there is no bare confirm in the wizard. Clack's `isCancel` maps to
  `WizardCancelledError`.
- **Exit codes: px semantics** (`src/exitCodes.ts`; named constants only). User cancel
  (Ctrl-C or any cancelled prompt) exits **`CANCELLED` (2)** — still preceded by the friendly
  support-links outro message, but scripts see px's standard code. Headless missing-input
  exits **`INVALID_ARGUMENT` (3)** with the exact flags/vars needed. Recoverable failures
  degrade to warnings + fallback lanes and still reach the outro with `SUCCESS` (0);
  unexpected crashes exit `FAILURE` (1) via `getExitCodeForError`.
- **The former "px lane" (install/update the px CLI) dissolves.** The user is already running
  px. What remains is an in-process, opt-in **px profile step** (§3.8) that points a px
  profile at the wizard's endpoint/project — including key persistence, since the profile is
  written through px's own settings module (`~/.px/settings.json`, `0600`) with no argv or
  subprocess involved. The two px sibling PRs the old design waited on (stdin/env key passing,
  structured self-update check) are no longer needed by the wizard.

Follow CLI conventions from `js/packages/phoenix-cli/.claude/skills/phoenix-cli-development`:
I/O through `src/io.ts` helpers, options interfaces with descriptive names, `--no-input`
support, help text with examples, README + `.agents/skills/phoenix-cli` skill updates when the
command ships.

### 1.1 Module layout

```
js/packages/phoenix-cli/
  src/
    commands/setup.ts          # registration only: flags → WizardOptions → runWizard(buildDefaultDeps())
    setup/
      wizard.ts                # runWizard(deps): the step sequence, and nothing else
      deps.ts                  # WizardDeps type + buildDefaultDeps()
      options.ts               # flag/env parsing → WizardOptions (via resolveConfig, §1.2)
      copy.ts                  # ALL user-facing strings, organized by step
      errors.ts                # WizardCancelledError, typed step errors
      steps/
        gitPreflight.ts
        deployment.ts          # deployment select + auth probe
        connect.ts             # lane dispatch: authOff | pastedApiKey | headless
        materialize.ts         # hand-off files + gitignore
        instrumentation.ts     # mode select, consent, agent run, own-agent, manual
        verify.ts              # verification + production checkpoints, outro
        pxProfile.ts           # opt-in in-process profile create/activate (§3.8)
      ui/
        prompter.ts            # clack-backed select()/textInput(); cancel → WizardCancelledError
        selectBoolean.ts       # select() wrapper, "No" first for dangerous choices
        spinner.ts             # 150ms-delayed elapsed-time spinner (clack spinner ok)
        ansi.ts                # strip/emit escape codes, single-lining, truncation
      net/
        restClient.ts          # tiny fetch wrapper w/ timeouts (Phoenix v1 REST)
      agents/
        types.ts               # Adapter, CodingToolStatus, CodingToolEvent, CommandSpec
        registry.ts            # [claudeAdapter, codexAdapter]
        claude.ts
        codex.ts
        ndjson.ts              # chunk-tolerant NDJSON buffer
        progress.ts            # rolling 9-line task log renderer (custom; clack has no equivalent)
        run.ts                 # spawn, stream, completion-protocol resolution
      prompt/
        instrumentationPrompt.ts  # buildInstrumentationPrompt(connection, urls)
      util/
        gitignoreCoverage.ts   # `ignore`-package coverage check + banner append
        redact.ts              # Bearer/PHOENIX_API_KEY/token-shape scrubbing
        paths.ts               # humanize paths (cwd-relative, ~/-relative, basename)
  test/setup/                  # mirrors src/setup, vitest, fake deps only
```

New runtime dependency for phoenix-cli: `ignore` (gitignore pattern coverage). Everything else
is already in the package (clack, commander) or Node builtins.

House rules (enforced in review):

- **No confirm primitive in the wizard.** `ui/` exposes `select()`, `textInput()`, and masked
  `passwordInput()`;
  `selectBoolean` is a select. (px's existing `confirmAction` is not used by setup.)
- **All copy in `copy.ts`.** Control flow references copy; copy never references control flow.
- **Every effect behind `WizardDeps`.** No module under `setup/` other than `deps.ts` touches
  `process.env`, `fetch`, `child_process`, or the clipboard directly.

### 1.2 `WizardDeps` and options

```ts
interface WizardOptions {
  endpoint?: string;        // --endpoint: pre-answer deployment question
  project?: string;         // --project: name or Relay Global ID
  noInput?: boolean;        // --no-input: headless mode (also auto-on when !stdin.isTTY, per px convention)
  apiUrl?: string;          // hidden --api-url: REST origin override (dev)
}

interface Prompter {
  select<T>(args: { message: string; options: Array<{ value: T; label: string; hint?: string }> }): Promise<T>;
  textInput(args: { message: string; defaultValue?: string; validate?: (v: string) => string | undefined }): Promise<string>;
  passwordInput(args: { message: string; validate?: (v: string) => string | undefined }): Promise<string>;
  // all throw WizardCancelledError on Ctrl-C / Escape
}

interface WizardDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  options: WizardOptions;
  stdinIsTTY: boolean;
  prompter: Prompter;                                 // real: clack-backed ui/prompter.ts; tests: scripted answers
  writeClipboard(text: string): Promise<boolean>;
  fetch: typeof fetch;                                // injected for tests
  exec(spec: CommandSpec): Promise<ExecResult>;       // one-shot (git, probes)
  spawnStreaming(spec: CommandSpec): StreamingChild;  // agent runs
  now(): number;
}
```

`buildDefaultDeps()` wires real implementations. Tests construct fakes. **Implement this file
first** — it is the reason the whole wizard is unit-testable (§10).

**Headless mode:** `--no-input` or no TTY (px convention). Input resolution goes through px's
`resolveConfig()` precedence — flags, then env (`PHOENIX_HOST`, `PHOENIX_API_KEY`,
`PHOENIX_PROJECT`), then defaults — additionally accepting `PHOENIX_COLLECTOR_ENDPOINT` and
`PHOENIX_PROJECT_NAME` as endpoint/project aliases (per #14131). There are **no
wizard-specific env vars**. The `--no-input` flag — not the presence of env vars — is what
allows ambient credentials to short-circuit prompts, so a `PHOENIX_API_KEY` in a developer
shell is never consumed silently during an interactive run.

**Headless scope** (resolved 2026-07-08): headless runs steps 1–4 only — git preflight
(clean repo required, else exit `FAILURE` with the explanation), connection, hand-off files —
then prints the resolved connection (endpoint, project name, project id; never the key) plus
next-step guidance (quickstart URL, env vars) and exits `SUCCESS`. Headless **never** runs a
coding agent: the full-permissions consent gate stays meaningfully human. Every prompt site in
steps 1–4 must either have a value (flag or env) or exit `INVALID_ARGUMENT` printing the exact
flags/vars needed.

### 1.3 Standalone binary and curl installer

**Decision (2026-07-08):** the compiled artifact is the **full px CLI**, installed as `px`;
the installer then execs `px setup "$@"`. (A setup-only binary was considered and rejected:
same build effort, but the user would end setup without px installed — making the px profile
step configure a tool they don't have — and px gains a no-Node distribution channel for
free.) The `pxi` bin (ink/React TUI) is **not** part of the compiled binary; it stays
npm-only.

**Advertised one-liner** (resolved 2026-07-08: stay self-contained — no external
vanity-URL/redirect ask; the URL lives in one constant so a vanity front can be added later
without code changes):

```sh
curl -fsSL https://raw.githubusercontent.com/Arize-ai/phoenix/main/js/packages/phoenix-cli/scripts/install.sh | sh
```

**Optional in-repo alternative:** the existing GitHub Pages deploy (`gh_pages.yml`) MAY also
publish the script, giving `https://arize-ai.github.io/phoenix/install.sh` — a shorter,
still fully self-contained URL. If adopted, raw-GitHub remains the canonical source (Pages
lags `main` by a deploy) and both URLs must serve byte-identical content. Either way, the
script's repo path is load-bearing for published URLs — comment this at the top of
`install.sh`; moving the file is a breaking change.

**Compilation:** `bun build --compile` over the CLI entry, cross-compiled to four targets —
`bun-darwin-x64`, `bun-darwin-arm64`, `bun-linux-x64`, `bun-linux-arm64` — via a
`build:binary` script in `js/packages/phoenix-cli`. Bun is a **build-time** tool only (CI +
this script); it is not a runtime or package-manager change. Verify during implementation
that the px entry graph compiles cleanly (it must not pull in the pxi/ink surface; if it
does, split the entry). Embed the install channel at compile time (e.g.
`--define PX_INSTALL_CHANNEL="binary"`) so the CLI can tell how it was installed.

**Release plumbing:** phoenix-cli publishes via changesets
(`.github/workflows/typescript-packages-publish.yml`, `createGithubReleases: true`), which
creates a GitHub release tagged `@arizeai/phoenix-cli@X.Y.Z` per publish. A new workflow job
triggers on that release, cross-compiles the four targets, smoke-tests each on a matching
runner matrix (`./px --version`, `./px setup --help`), and uploads assets named
`px-{darwin|linux}-{x64|arm64}.tar.gz` (each containing the `px` binary) to the same
release. Do **not** rely on the repo's `releases/latest` — this monorepo's release stream is
shared with the Python packages, so "latest" is arbitrary.

**Install script** (`js/packages/phoenix-cli/scripts/install.sh`, POSIX sh, modeled on the
braintrust-setup installer):

1. Optional first positional arg = version pin; remaining args pass through to `px setup`.
2. Resolve the version: pinned, else `https://registry.npmjs.org/@arizeai/phoenix-cli/latest`
   → `.version` (jq if present, grep/sed fallback). npm is the source of truth for "latest";
   GitHub is only the asset host.
3. Detect target from `uname -s`/`uname -m` (darwin|linux × x64|arm64; anything else → die
   with a friendly message pointing at the npx path).
4. Download
   `https://github.com/Arize-ai/phoenix/releases/download/@arizeai/phoenix-cli@{version}/px-{target}.tar.gz`
   to a mktemp dir, extract, `chmod +x`, move to `${XDG_BIN_HOME:-$HOME/.local/bin}/px`.
   On download failure, list the most recent phoenix-cli tags so a bad pin is
   self-explanatory.
5. If the install dir is not on `PATH`, say so (one line, with the export to add).
6. Exec the wizard — **reattaching the TTY**: under `curl … | sh`, stdin is the pipe, and the
   wizard auto-enables headless mode on `!stdin.isTTY` (§1.2), so running it naively would
   silently skip every prompt. Linux: `px setup "$@" </dev/tty` when stdin isn't a TTY;
   macOS: the `script -q /dev/null px setup …` PTY trick, as in the reference installer. If
   `/dev/tty` is unavailable (true headless), print the command for the user to run manually
   and exit non-zero rather than degrading into an accidental headless run.

**Self-update:** `px self update` is npm-based and must not try to npm-update a compiled
binary. When `PX_INSTALL_CHANNEL="binary"`, `px self update` re-runs the installer flow
(download latest release asset for the current target and replace its own binary, or at
minimum print the curl one-liner). This ships with the binary lane, not as a follow-up —
shipping a binary channel without an update story strands users on day-one versions.

**Security:** the installer talks to exactly two hosts — the npm registry (version resolve)
and `github.com` (asset download) — over HTTPS. It installs only into the user-writable bin
dir, never sudo. The wizard's own network posture (§8) is unchanged.

---

## 2. End-to-end flow

```
start (px setup — zero-install: npx @arizeai/phoenix-cli setup, or curl installer §1.3)
  │
  ├─ 1. Git preflight
  │     not a repo?  → warn, opt-in to continue (default: stop)
  │     dirty tree?  → list up to 20 files, opt-in to continue
  │
  ├─ 2. Resolve deployment
  │     select: Local (http://localhost:6006) / Remote (paste your instance URL —
  │             self-hosted or Phoenix Cloud; no separate Cloud option)
  │     probe endpoint (unauthenticated GET /v1/projects?limit=1):
  │       200 → auth OFF        401 → auth ON
  │       unreachable → troubleshoot copy ("is `phoenix serve` running?") → re-ask
  │
  ├─ 3. Establish connection
  │     auth OFF: prompt project name (default: cwd directory name)
  │               GET /v1/projects/{name} first; 404 → POST /v1/projects → Global ID
  │     auth ON + headless: resolve project via REST with PHOENIX_API_KEY
  │     auth ON + interactive: paste API key into a masked prompt
  │               resolve/create project with the key; retry only the key on 401
  │
  ├─ 4. Write hand-off files (0600) into cwd, ensure gitignored
  │     endpoint + project always; PHOENIX_API_KEY line only when auth is on
  │     (headless stops here: print connection + next steps, exit 0)
  │
  ├─ 5. (background, overlapped with steps 4–6 prompts) Coding-agent preflight:
  │     discover claude/codex on PATH → auth status → smoke test
  │     (prompt-free by construction; awaited at the mode-select render)
  │
  ├─ 6. Instrumentation mode select:
  │     a) built-in agent  → consent ("full permissions") → pick agent
  │        → run headless with prompt + injected env
  │        → stream progress → sentinel-based outcome
  │        → on abort/failure: re-ask with (b)/(c) only
  │     b) own agent       → prompt to clipboard (fallback: print) → confirm done
  │     c) manual          → docs link → confirm done
  │
  ├─ 7. Verify: "run your app, check {host}/projects/{projectId}/traces" → confirm
  ├─ 8. px profile step (opt-in): point a px profile at this endpoint/project (§3.8)
  ├─ 9. Production hand-off: show env vars prod needs → confirm
  └─ 10. Outro (docs / troubleshooting / GitHub issues / support links)

Cancel (Ctrl-C / cancelled prompt) anywhere → unwind via WizardCancelledError → outro-style
support message → exit CANCELLED (2). Recoverable failures → warning + fallback lane, never a
dead end.
```

Step 5 starts immediately after step 3 resolves and runs while the user reads/answers steps
4–6's prompts; it is prompt-free by construction and its result is awaited exactly once, at
the mode-select render (to label options with availability). No background work ever prompts —
all interactive steps are strictly sequential in the foreground.

---

## 3. Step details

### 3.1 Git preflight (`steps/gitPreflight.ts`)

- Repo check: `git rev-parse --is-inside-work-tree` (exit 0 + `true`).
- Dirty check: `git status --porcelain=v1`; any output = dirty. Show up to 20 paths, then
  `…and N more`.
- Both gates are `selectBoolean` opt-ins with "No, stop here" first and hint copy explaining
  *why* (an agent is about to edit files; git is the undo button; a dirty tree tangles agent
  edits with human edits).
- `git` missing entirely → treat as "not a repo" (same gate, adjusted copy).
- Headless mode: proceed only if clean repo; otherwise exit `FAILURE` with the explanation
  (agents running in CI must not be gated on interactive risk acceptance).

### 3.2 Deployment resolution and auth probe (`steps/deployment.ts`)

Select (skipped when `--endpoint` given) — **two options** (resolved 2026-07-08: no separate
Phoenix Cloud entry; Cloud users paste their instance URL like any remote):

1. **Local** — `http://localhost:6006` "(recommended if you just ran `phoenix serve`)"
2. **Remote** — free-text URL prompt (validate: parseable URL, http/https). Hint copy names
   both cases: "self-hosted Phoenix or your Phoenix Cloud space URL".

Probe: unauthenticated `GET {endpoint}/v1/projects?limit=1`, 10s timeout.

| Result | Meaning | Action |
|---|---|---|
| 200 | auth off | auth-off lane |
| 401 (also accept 403) | auth on | auth-on lane |
| network error / non-JSON / other status | unreachable or not Phoenix | troubleshoot copy, re-ask (max 3 attempts, then offer manual lane docs + exit-friendly select) |

Grounding: with auth enabled the v1 router's `is_authenticated` dependency raises **401** for
missing/invalid tokens (`src/phoenix/server/bearer_auth.py`); 403 arises only from the
viewer-role guard on non-GET requests, so the probe will normally see 401 — accept 403
defensively. Record `{ endpoint, authEnabled }`. Note: verify probe behavior against read-only
mode deployments during Phase 1; if read-only returns 200 but writes are blocked, the auth-off
project-create call in 3.3 surfaces it — treat an auth-ish failure on create as "auth on after
all" and fall through to the auth-on lane with an explanatory line.

### 3.3 Establish connection (`steps/connect.ts`)

All lanes converge on:

```ts
interface Connection {
  endpoint: string;      // normalized origin, no trailing slash
  projectName: string;
  projectId: string;     // Relay Global ID, e.g. "UHJvamVjdDox"
  apiKey?: string;       // present iff authEnabled
}
```

**Auth-off lane:** prompt for project name, default = basename of cwd (sanitized: no `/`,
`?`, `#` — those are invalid in name-as-identifier lookups). **Resolve-first, then create**:
`GET /v1/projects/{name}` — 200 → use the existing project's Global ID; 404 →
`POST /v1/projects` with `{ name }`. If the POST fails anyway (today a duplicate name is an
**unhandled 500**, not a 409 — the route does no existence check and the DB unique constraint
propagates; see Appendix A), re-GET by name before surfacing an error. A sibling fix making
POST return 409 is filed in §9 but the wizard must not depend on it.

**Auth-on interactive lane:** prompt for an API key with masked input, then resolve/create
the project over the existing REST API. A 401 re-prompts only for the key; the selected
project is retained. See the credential-acquisition boundary in §4.

**Auth-on headless lane:** requires `PHOENIX_API_KEY` + project (flag or env). Resolve via
`GET /v1/projects/{project_identifier}` with `Authorization: Bearer` — the identifier accepts
a name or Global ID. Missing values → immediate `INVALID_ARGUMENT` exit with exact
remediation.

### 3.4 Hand-off file materialization (`steps/materialize.ts`)

Write two redundant files into **cwd** (deliberately not repo root — bounded blast radius in
monorepos), both mode `0600`, both with a header explaining: generated by the wizard,
sensitive, do not commit, safe to delete after setup is verified.

`.env.phoenix`:

```bash
# Generated by `px setup` on <ISO date>.
# Contains a Phoenix API key — do NOT commit this file.
# Safe to delete once tracing is verified and production is configured.
PHOENIX_COLLECTOR_ENDPOINT=https://phoenix.example.com
PHOENIX_PROJECT_NAME=my-app
PHOENIX_API_KEY=<key>            # line omitted entirely when auth is off
```

`.phoenix.json` (JSON twin, same fields camel-cased, plus `projectId` and `generatedAt`; a
`_comment` field carries the same warning).

The files emit the **SDK env var names** (`PHOENIX_COLLECTOR_ENDPOINT`,
`PHOENIX_PROJECT_NAME`, `PHOENIX_API_KEY`) — they configure the user's app, not px. Why two
formats: dotenv is `source`-able and `dotenv`-toolable; JSON is trivially parseable by other
tooling. #14130 may later make the dotenv file SDK-discoverable; nothing here depends on that.

`.gitignore` enforcement (`util/gitignoreCoverage.ts`): use the `ignore` npm package to test
whether existing patterns *already cover* each filename (never naive substring search — a
pattern like `.env*` already covers `.env.phoenix`). Append only uncovered names under a
banner:

```
# Added by px setup — local Phoenix credentials
.env.phoenix
.phoenix.json
```

Preserve trailing-newline hygiene (exactly one trailing `\n`; insert a blank line before the
banner if the file didn't end with one). No `.gitignore` and not a repo → skip silently.
Applied in the auth-off case too (defense in depth; the file may later gain a key).

### 3.5 Coding-agent preflight (background)

Starts after step 3; prompt-free by construction (discovery + status probes + smoke tests
only, §5.2); awaited at the instrumentation mode-select render to label options with
availability. Any error surfaces as a per-agent `reason` string on the disabled option, passed
through redaction (§8).

### 3.6 Instrumentation step (`steps/instrumentation.ts`)

Mode select, options labeled with live agent-preflight results (§5):

- a) **Run <Claude Code|Codex> for me (recommended)** — only shown usable when preflight
  passed; hint shows version + auth mode. If no agent is usable, this option appears disabled
  with the reason ("claude: not logged in — run `claude login`").
- b) **Copy a prompt for my own agent** — clipboard write; on failure, print the prompt in a
  fenced block. Then a single-option "I've run it" select.
- c) **I'll do it manually** — print quickstart docs URL. Then "I've finished" select.

Lane (a) requires the **consent gate** first: "This wizard will now invoke <agent> with full
permissions in this directory. Proceed?" — `selectBoolean`, "No, I'll use another method"
first. Abort re-routes to a re-ask with only (b)/(c).

All three lanes converge on step 7 (verification) — the wizard's definition of done is
**human-verified data flow**, not agent self-report.

### 3.7 Verification and production hand-off (`steps/verify.ts`)

Two blocking human checkpoints, each a deliberately single-option select (not skippable, but
cancellable like everything else), with the px profile step (§3.8) between them:

1. **Verify:** "Run your app now (with the vars from `.env.phoenix` exported — e.g.
   `set -a; source .env.phoenix; set +a`), make a request, then open
   `{endpoint}/projects/{projectId}/traces` and confirm traces appear." Include the
   troubleshooting docs URL. If the agent run produced a permalink (§5.4), print it here too.
2. **Production:** show exactly the env vars production needs — `PHOENIX_COLLECTOR_ENDPOINT`,
   `PHOENIX_PROJECT_NAME` (only if the app reads it from env; the agent sets project name in
   code, so this is informational), and `PHOENIX_API_KEY` when auth is on ("copy the value
   from `.env.phoenix` into your production secret store"). Auth-off local deployments get
   adapted copy: "when you deploy Phoenix for real, set these."

Outro: docs, troubleshooting, GitHub issues links from `copy.ts`.

URL facts (from `app/src/Routes.tsx`): traces list `/projects/{projectId}/traces` where
`projectId` is the **Relay Global ID**; per-trace permalink
`/projects/{projectId}/traces/{traceId}?selectedSpanNodeId={spanNodeId}` where `traceId` is
the **OpenTelemetry trace id** and `spanNodeId` is the Relay `Span.id`. Phoenix has no "logs"
page — never generate one.

### 3.8 px profile step (`steps/pxProfile.ts`, opt-in, after verification)

Placement resolved 2026-07-08: **after the verification checkpoint, before the production
hand-off** — the user has just confirmed traces in the UI, so "want px pointed at this
project?" lands naturally and never interrupts the instrumentation flow.

Because the wizard *is* px, everything here is **in-process** — no discovery, no install, no
subprocess, no argv:

1. **Conflict check:** read profiles through px's settings module. If an active,
   fully-configured profile points at a **different** endpoint or project, ask before
   creating/switching; a partially configured profile (missing endpoint or project) is
   non-conflicting. Never clobber silently.
2. **Opt-in select:** "Also point the px CLI at this project? (lets you query traces from
   your terminal)" — decline skips everything.
3. **Configure:** create + activate a profile named from the endpoint host (`local` for
   localhost, else host with dots → dashes), carrying endpoint, project, and — auth-on — the
   API key, written via the settings module (`~/.px/settings.json`, dir `0700`, file `0600`).
   No `ps`-visible secret ever exists.

Any error is a **non-fatal warning** passed through redaction (§8); the wizard proceeds to the
production checkpoint regardless.

---

## 4. Auth credential acquisition (backend-free)

The auth-on interactive flow uses only existing Phoenix APIs:

1. Explain where to create or copy an API key in Phoenix Settings.
2. Read the key through `Prompter.passwordInput`, which masks terminal input.
3. Resolve or create the chosen project with `Authorization: Bearer <key>`.
4. On 401, retain the project choice and return to the key prompt. Other failures use the
   normal connection error path.
5. Return the same `Connection` shape consumed by hand-off, instrumentation, verification,
   and px profile steps.

There is no setup-session table, migration, router, polling client, retention hook, or
frontend claim route. The key is never printed; redaction still guards errors, and local
credential files retain their existing `0600` permissions and gitignore coverage.

### 4.1 Future OAuth grant refactor

OAuth should replace only the `promptForApiKey` credential provider in `steps/connect.ts`.
Keep project resolution and every downstream step independent of how the key was acquired:

```ts
interface CredentialProvider {
  acquireApiKey(args: { endpoint: string }): Promise<string>;
}
```

The OAuth implementation may open a browser and exchange a grant for a Phoenix API key, but
that protocol must be designed separately. Do not reintroduce the deleted setup-session
backend as an interim abstraction. Preserve the pasted-key provider as an explicit fallback
for self-hosted or constrained environments.

Refactor sequence:

1. **Now:** keep masked API-key entry as the only interactive provider and validate the
   result through existing project REST calls.
2. **Introduce the provider boundary:** move credential acquisition out of project
   resolution and inject a `CredentialProvider` into the auth-on connection lane. The lane
   must continue to consume only the returned API key.
3. **Add OAuth:** implement the grant as a second provider, including its own browser/error/
   cancellation behavior, without changing `Connection` or downstream wizard steps.
4. **Retain fallback:** if OAuth is unavailable or the user chooses manual setup, invoke the
   pasted-key provider. Do not silently consume `PHOENIX_API_KEY` in an interactive run.
5. **Contract-test providers:** both providers must return the same credential shape; shared
   tests cover cancellation, redaction, invalid credentials, project retention across retry,
   hand-off file permissions, and px-profile persistence.

---

## 5. Coding-agent orchestration

### 5.1 Adapter contract (`agents/types.ts`)

```ts
type OutcomeVerb = "thinking" | "reading" | "editing" | "running" | "completed" | "failed";

interface CodingToolEvent {
  verb: OutcomeVerb;
  target?: string;       // humanized path or command (util/paths.ts)
  detail?: string;       // compacted tool-input summary
}

interface CodingToolStatus {
  installed: boolean;
  usable: boolean;       // installed && logged in && smoke passed
  version?: string;
  authMode?: string;     // e.g. "subscription", "api-key"
  reason?: string;       // user-visible: "not installed", "not logged in — run `claude login`", "smoke test failed"
}

interface CommandSpec { command: string; args: string[]; stdin?: string; env?: Record<string,string>; cwd?: string; }

interface Adapter {
  id: "claude" | "codex";
  label: string;                        // "Claude Code", "Codex"
  command: string;                      // binary name for PATH discovery
  status(dep: WizardDeps): Promise<CodingToolStatus>;   // probe + smoke
  smokeCommand(args: { cwd: string; prompt: string }): CommandSpec;
  runCommand(args: { cwd: string; prompt: string; env: Record<string,string> }): CommandSpec;
  parseEvents(jsonValue: unknown, cwd: string): CodingToolEvent[];
  parseFinalText(jsonValue: unknown): string | undefined;
}
```

### 5.2 Per-adapter specifics

**Status probes.** Claude: `claude auth status --json` → `{ loggedIn, authMethod,
subscriptionType }`. Codex: `codex login status` → parse the "Logged in using …" line.
Not-installed vs not-logged-in are distinct `reason`s — the mode-select hints show them.

**Smoke test** (runs per-tool, in parallel, during steps 4–6 dead time): run the agent with
tools disabled / read-only sandbox, stdin prompt `Reply with exactly PHOENIX_SETUP_TOOL_OK.`;
require exit 0 **and** the token in stdout. Catches expired auth, broken installs, and org
policy blocks before the user commits to lane (a).

**Run commands** (both take the prompt on stdin and emit NDJSON on stdout):

- Claude: `claude -p --verbose --output-format stream-json --no-session-persistence
  --tools default --permission-mode bypassPermissions --dangerously-skip-permissions`
- Codex: `codex exec --json --ephemeral --skip-git-repo-check -s danger-full-access
  --dangerously-bypass-approvals-and-sandbox -C <cwd> -`

Injected env (parent env spread first, then):

```
PHOENIX_COLLECTOR_ENDPOINT=<endpoint>
PHOENIX_API_KEY=<key>                      # auth-on only
PHOENIX_WIZARD_RESULT_FILE=<tmpfile>       # pre-created empty file, 0600, os tmpdir
```

**Env, never argv** — argv leaks into `ps`.

These flags are unversioned third-party surfaces and **will drift**. Keep them isolated inside
each adapter file; the smoke test is the canary; Phase-4 CI runs the smoke test against real
binaries (§10).

### 5.3 Event normalization and progress UI

`agents/ndjson.ts`: buffer partial chunks, split on newlines, `JSON.parse` per line, silently
drop non-JSON diagnostic lines. Each adapter maps its native events into the 6-verb
vocabulary. `thinking` events are parsed but **not rendered** (noise).

`agents/progress.ts`: a rolling **last-9-lines** log under a title line; discarded on success
(replaced by one summary line), retained on failure. Line hygiene: dedupe consecutive
identicals, strip ANSI/control chars, collapse to single line, truncate to 140 chars. Format:
`read: <path>` / `write: <path>` / `run: <command>`. Paths humanized: cwd-relative if under
cwd, else `~/`-relative, else basename. A 150ms-delayed elapsed-time spinner covers the
pre-first-event gap.

### 5.4 Completion protocol (`agents/run.ts`)

Three channels, checked in priority order after the process exits:

1. **Result file:** if `PHOENIX_WIZARD_RESULT_FILE` contains a
   `https://…/projects/…/traces…` URL, treat as success-with-permalink.
2. **Sentinels in final text:** `INSTRUMENTATION_COMPLETE` → success;
   `INSTRUMENTATION_INCOMPLETE` → warn with the agent's final text (redacted/truncated).
3. **Exit code + regex fallback:** non-zero exit → warn; otherwise scan final text for a
   `/projects/…/traces` permalink; found → success-with-permalink; not found → ambiguous →
   warn ("the agent finished but didn't confirm — verification will tell us").

**Every** failure shape degrades to a warning and proceeds to step 7 (verification). The
sentinels and result-file behavior are instructed via the quickstart docs page (§7), keeping
the CLI and docs in lock-step.

---

## 6. The instrumentation prompt (`prompt/instrumentationPrompt.ts`)

One shared template serves lanes (a) and (b). Template inputs: `projectName`, `endpoint`,
`isDefaultEndpoint`, `quickstartUrl`, `authEnabled`. Draft (iterate via evals, §10):

```
You are running as part of the Phoenix setup script. Your ONLY task is to add Phoenix
tracing to the application in the current working directory. Do not run setup tools,
onboarding scripts, or this wizard again.

Follow the Phoenix tracing quickstart at exactly this URL, and no other guide:
{{quickstartUrl}}
That page includes instructions for agents, including how to report completion. Follow them.

Rules:
1. Tracing only. Do not add evals, datasets, prompts, dashboards, or any other feature.
2. Credentials are already provided via environment variables (PHOENIX_COLLECTOR_ENDPOINT
   {{#authEnabled}}and PHOENIX_API_KEY{{/authEnabled}}), which Phoenix SDKs read
   automatically. Local files `.env.phoenix` and `.phoenix.json` exist for the human
   operator. NEVER read those files, never print the API key, and never write the API key
   or any secret into source code, config files, or command arguments.
3. Configure the Phoenix project name in code: use the SDK's register/registration call
   with the project name "{{projectName}}".
   {{^isDefaultEndpoint}}Also set the collector endpoint in code only if the quickstart
   says to; it is {{endpoint}}.{{/isDefaultEndpoint}}
4. Prefer auto-instrumentation packages over hand-written span wrappers. Make the smallest
   correct change.
5. Do not run the application, its tests, or its build. Installing dependencies is allowed.
6. Install SDK packages with the project's existing package manager, pinned to the latest
   stable version you can verify. If this is a monorepo, note the root but only modify
   files at or below the current working directory.
7. Keep changes concise and readable. Do not restructure, reformat, or meaningfully modify
   existing application code.
8. Do not use the `px` CLI.

When finished, follow the completion-reporting instructions from the quickstart page:
write the trace-page URL to the file at $PHOENIX_WIZARD_RESULT_FILE if you produced one,
and end your final message with INSTRUMENTATION_COMPLETE on success or
INSTRUMENTATION_INCOMPLETE (plus a one-paragraph reason) otherwise.
```

Rule rationale table (each rule is load-bearing; do not trim without replacing the
protection):

| Rule | Protects |
|---|---|
| tracing only | bounded, reviewable diff |
| single docs URL | determinism; docs page is the one source of agent instructions |
| "part of the setup script" | no recursive wizard invocation |
| env-provided creds; never read files/inline key | key stays out of code, diffs, and agent context |
| project name in code | uniform mechanism — the TS SDK has **no** project env var |
| prefer auto-instrumentation | minimal, upgrade-safe diff |
| don't run app code | instruction-level sandboxing; no side effects |
| pinned latest, existing package manager, at/below cwd | reproducibility, repo conventions, bounded blast radius |
| concise changes | reviewability |
| no px | agent env ≠ user shell; avoids nondeterminism |

**Prompt quality is the product.** Budget eval-style iteration across representative repos:
Python/TS, single-package and monorepo, each package manager, at least one repo per major
integration (OpenAI, LangChain, Vercel AI SDK).

---

## 7. Docs contract

Three URLs, all constants in `copy.ts`:

1. **Tracing quickstart** — a **single agent-facing page covering all languages** (resolved
   2026-07-08): the page itself branches on detected language/framework, so the wizard stays
   dumb and the prompt stays one URL. It must be followable end-to-end by an agent with no
   human input, and must contain a "For agents / automated setup" section documenting the
   sentinel strings and `PHOENIX_WIZARD_RESULT_FILE` protocol. Its setup content should be
   derived from / kept in sync with the `.agents/skills/phoenix-tracing` skill (the skill is
   the source material; the wizard-specific completion protocol lives **only** on the docs
   page — skills stay generic). Treat this page as **versioned code**: changes to it are
   reviewed against this spec, because the wizard's completion protocol depends on it.
2. **Troubleshooting** — linked from the verification checkpoint.
3. **Instrumentation docs index** — linked from the manual lane.

---

## 8. Error handling, redaction, security

- **Redaction (`util/redact.ts`)** applied to *all* surfaced subprocess/HTTP error text:
  `Bearer <token>` → `Bearer [REDACTED]`; `PHOENIX_API_KEY=<…>` → `PHOENIX_API_KEY=[REDACTED]`;
  long base64url/JWT-shaped tokens → `[REDACTED]`. Then truncate (500 chars) before display.
- Secrets travel via env, stdin, or in-process settings writes only; never argv, never logged.
- Hand-off files `0600`; `~/.px` already enforces `0700/0600` on its side.
- The permission-bypassed agent run is mitigated by the **triad**: git preflight + consent
  gate + smoke test. These three ship together; removing any one shifts real risk to users.
- The wizard makes **no network calls other than the chosen Phoenix endpoint** (the former
  px-install lane and its npm-registry traffic no longer exist).

---

## 9. Sibling work (tracked separately, not blockers)

| Work | Where | Blocks |
|---|---|---|
| `POST /v1/projects` should return 409 on duplicate name (today: no existence check; DB `UniqueConstraint` → unhandled `IntegrityError` → 500) | `src/phoenix/server/api/routers/v1/projects.py` | nothing (wizard resolves-first, §3.3) |
| gRPC OTLP ingest accepts VIEWER-role API keys while HTTP OTLP rejects them (`ApiKeyInterceptor` validates but never checks role) | `src/phoenix/server/grpc_server.py`, `src/phoenix/server/bearer_auth.py` | nothing (wizard blocks viewers at claim, §4.2); upstream consistency fix |
| SDK `.env.phoenix` auto-discovery | #14130 | nothing |
| Project env var unification (`PHOENIX_PROJECT_NAME` + `PHOENIX_PROJECT` accepted everywhere) | #14131 | nothing (wizard emits `PHOENIX_PROJECT_NAME`, accepts both as input) |
| Quickstart docs page: agent-followable, all-language, sentinel protocol section; content derived from `.agents/skills/phoenix-tracing` | docs | Phase 2 |
| phoenix-cli README + `.agents/skills/phoenix-cli` skill updated for `px setup` | `js/packages/phoenix-cli` | ships with Phase 1 (per CLI checklist) |

(The former px sibling PRs — stdin/env key passing for `px profile create` and
`px self update --check --format json` — are obsolete: the wizard is in-process px, §1.)

---

## 10. Testing strategy

Unit tests live in `js/packages/phoenix-cli/test/setup/`, mirroring `src/setup/`; **no test
spawns a real agent or a real server**. Fake `WizardDeps` throughout.

| Seam | Fixtures / approach |
|---|---|
| `options.ts` | flag/env matrix incl. resolveConfig precedence + `PHOENIX_COLLECTOR_ENDPOINT`/`PHOENIX_PROJECT_NAME` aliases, headless auto-detection |
| deployment probe | fake fetch: 200 / 401 / 403 / ECONNREFUSED / non-JSON |
| auth-on credential entry | masked prompt; 401 re-prompts only the key and retains the project choice |
| auth-off connect | resolve-first matrix: GET 200 / GET 404→POST / POST 500-on-race→re-GET |
| `gitignoreCoverage` | pattern-coverage cases (`.env*` covers `.env.phoenix`; negations; missing trailing newline) |
| hand-off files | content snapshot, mode 0600, key line present/absent by lane |
| px profile step | fake settings module: no profile / conflicting active profile / partial profile; key written only in-process |
| adapter command construction | exact argv/env/stdin snapshots per adapter |
| `parseEvents` / `parseFinalText` | fixture NDJSON lines captured from real claude/codex runs, incl. partial chunks and garbage lines |
| status parsing | canned `claude auth status --json` / `codex login status` outputs |
| completion protocol | result-file / sentinel / exit-code+regex priority matrix |
| `redact.ts` | bearer/env/JWT shapes |
| full-flow | scripted select answers through fake deps: auth-on happy path, auth-off happy path, cancel-at-every-step (always exit `CANCELLED`), every failure→fallback lane, headless stops after step 4 |

Phase-4 CI adds one integration smoke job running the real `claude`/`codex` smoke commands to
catch flag drift (allowed-to-fail initially, promoted once stable).

---

## 11. Implementation phases and acceptance criteria

**Phase 1 — walking skeleton (no backend work).**
`px setup` command registration, DI shell, options (resolveConfig + aliases), copy module, git
preflight, deployment resolution + probe, **auth-off lane** (resolve-first), hand-off files +
gitignore, manual lane, verification + production checkpoints, px profile step (auth-off — no
key), outro, cancel semantics, headless steps 1–4. README + phoenix-cli skill updates.
*Accept:* against a stock local `phoenix serve` (auth off), a user reaches verified traces via
the manual lane; every prompt is a select; Ctrl-C anywhere exits `CANCELLED` (2) with the
support message; `--no-input` with env vars materializes hand-off files and exits 0; unit
suite green.

**Phase 2 — agent lanes.**
Adapter registry, smoke tests, consent gate, headless runs with progress UI, completion
protocol, own-agent clipboard lane, instrumentation prompt, quickstart docs page updated with
the agent/sentinel section (content derived from the phoenix-tracing skill).
*Accept:* on a representative Python and TS repo, lane (a) with Claude Code produces a
reviewable diff, traces verified; lane (b) prompt works when pasted into a fresh agent; all
agent failures degrade to warnings that still reach verification.

**Phase 3 — auth-on lane without backend changes.**
Interactive masked API-key entry, authenticated project resolution/creation, 401 retry,
headless (`--no-input`) path, and px profile key persistence.
*Accept:* against an auth-enabled deployment, a pasted API key reaches `.env.phoenix` and
verified traces; invalid keys re-prompt without losing the project choice; headless mode
works in a TTY-less run with standard env vars. OAuth grant support is a separate follow-up.

**Phase 4 — polish.**
Windows discovery/paths, agent-binary smoke CI, background-overlap tuning.

**Binary distribution lane (parallel; independent of Phases 1–4).**
`build:binary` Bun cross-compilation, release workflow attaching `px-{os}-{arch}.tar.gz`
assets to the changesets release, `scripts/install.sh`, binary-aware `px self update` (§1.3).
Can land any time after Phase 1 — it depends only on the px publish pipeline, not on wizard
internals.
*Accept:* on a clean macOS and Linux machine with no Node installed, the curl one-liner
installs `px` into `~/.local/bin` and lands in the interactive wizard (prompts render — the
TTY reattach works under `curl | sh`); version pinning works; `px self update` on a binary
install replaces the binary rather than attempting an npm update.

## 12. Open questions

- **Read-only / viewer-role probe fidelity** (§3.2): confirm during Phase 1 and adjust the
  probe or the create-fallback. This is a Phase-1 verification task, not a design blocker.

Everything else is resolved (updated 2026-07-09, recorded inline above): packaging → in-CLI
`px setup`; Cloud → folded into the remote-URL option; quickstart → single all-language
agent-facing page derived from the phoenix-tracing skill; authenticated setup → masked API
key paste for now, OAuth grant later; px lane → in-process profile step after
verification; headless → stops after hand-off files, never runs an agent; telemetry → none
in v1; exit codes → px semantics; binary distribution → full px binary via Bun compile +
curl installer; installer hosting → self-contained raw-GitHub URL, optionally also published
via the existing GitHub Pages deploy (§1.3), no external vanity-URL ask (a vanity redirect
can be layered on later by whoever owns the domain, with zero code changes).

---

## Appendix A: Codebase grounding

Facts this design relies on, verified 2026-07-07/08:

- **No org concept:** no `Organization` GraphQL type, no org column in
  `src/phoenix/db/models.py`, no `/v1/organizations` route, no org in px profiles.
- **Auth optional:** `PHOENIX_ENABLE_AUTH` defaults to false (`src/phoenix/config.py`); the
  v1 router adds Bearer auth only when enabled
  (`src/phoenix/server/api/routers/v1/__init__.py`); auth/oauth2 routers are mounted
  conditionally (`src/phoenix/server/app.py`).
- **Unauthenticated v1 requests → 401:** `is_authenticated` raises 401 for missing/invalid
  tokens (`src/phoenix/server/bearer_auth.py:145-164`); 403 comes only from
  `restrict_access_by_viewers`, which blocks **non-GET** requests for VIEWER-role
  credentials (`src/phoenix/server/authorization.py:42-53`).
- **Duplicate project create is a 500 today:** `create_project` does no existence check
  (`src/phoenix/server/api/routers/v1/projects.py:217-225`); the `projects.name`
  `UniqueConstraint` (`src/phoenix/db/models.py`) surfaces as an unhandled `IntegrityError`.
  Hence the wizard's resolve-first strategy (§3.3).
- **Router namespaces:** `/v1`, `/auth`, `/oauth2`, `/graphql` (`app.py:1031-1040`); there is
  no `/api` namespace. Login rate limiting: `ServerRateLimiter` + `fastapi_ip_rate_limiter`
  (+ `BruteForceLoginRateLimiter`) from `phoenix.server.rate_limiters`, wired in
  `src/phoenix/server/api/routers/auth.py`.
- **Key minting is GraphQL-only today:** `createSystemApiKey` / `createUserApiKey`
  (`src/phoenix/server/api/mutations/api_key_mutations.py`); keys are role-scoped JWTs via
  `token_store.create_api_key`; `createUserApiKey` accepts optional `expires_at` and is
  **not** restricted for viewers (permission classes: `IsNotReadOnly, IsLocked`) — the minted
  key inherits the caller's role. The temporary wizard flow asks users to create a key through
  the existing UI and does not add another minting endpoint.
- **Viewer-key ingest inconsistency:** HTTP OTLP `POST /v1/traces` is blocked for viewers by
  the router-level guard; gRPC OTLP's `ApiKeyInterceptor` validates the token but never
  checks role (`src/phoenix/server/grpc_server.py`, `bearer_auth.py:120-142`). This remains
  sibling work rather than setup-wizard backend scope.
- **Project REST exists:** `GET/POST /v1/projects`, `GET /v1/projects/{project_identifier}`
  accepting a Relay Global ID or a name; name-as-identifier can't contain `/ ? #`
  (`src/phoenix/server/api/routers/v1/projects.py`, `…/v1/utils.py`).
- **SDKs are env-only** (no file discovery anywhere): `PHOENIX_API_KEY` +
  `PHOENIX_COLLECTOR_ENDPOINT` in all four SDKs; `PHOENIX_PROJECT_NAME` Python-only; TS
  `register()` takes `projectName` as a parameter only
  (`packages/phoenix-otel/src/phoenix/otel/settings.py`,
  `packages/phoenix-client/src/phoenix/client/utils/config.py`,
  `js/packages/phoenix-otel/src/config.ts`, `js/packages/phoenix-config/src/env.ts`).
- **px CLI surface:** binaries `px`/`phoenix-cli` (npm `@arizeai/phoenix-cli`); commander +
  `@clack/prompts` + ink already in dependencies; semantic exit codes in `src/exitCodes.ts`
  (`SUCCESS=0, FAILURE=1, CANCELLED=2, INVALID_ARGUMENT=3, AUTH_REQUIRED=4,
  NETWORK_ERROR=5`); config resolution via `resolveConfig()` reading `PHOENIX_HOST`,
  `PHOENIX_API_KEY`, `PHOENIX_PROJECT`, `PHOENIX_CLIENT_HEADERS`
  (`js/packages/phoenix-cli/src/config.ts`); profiles in `~/.px/settings.json` (0600, dir
  0700); CLI conventions documented in
  `js/packages/phoenix-cli/.claude/skills/phoenix-cli-development`.
- **Frontend URLs:** `/projects/:projectId/traces` (+ `/:traceId`, span selection via
  `?selectedSpanNodeId=`); `projectId` = Relay Global ID; `traceId` = OTel trace id
  (`app/src/Routes.tsx`).
- **TS release plumbing:** phoenix-cli is **not** in release-please
  (`.release-please-manifest.json` covers only the Python packages + root); JS packages
  publish via changesets with `createGithubReleases: true`
  (`.github/workflows/typescript-packages-publish.yml`), producing GitHub releases tagged
  `@arizeai/phoenix-cli@X.Y.Z` — the attach point for binary assets (§1.3). The repo's
  `releases/latest` is shared across all packages and must not be used to resolve the CLI
  version.
