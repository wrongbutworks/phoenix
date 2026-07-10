/**
 * The instrumentation prompt handed to a coding agent (spec §6).
 *
 * One shared template serves the built-in-agent and own-agent lanes. Every
 * rule is load-bearing (see the rationale table in the spec) — do not trim
 * a rule without replacing the protection it provides.
 */

export interface InstrumentationPromptArgs {
  projectName: string;
  endpoint: string;
  isDefaultEndpoint: boolean;
  quickstartUrl: string;
  authEnabled: boolean;
}

export function buildInstrumentationPrompt({
  projectName,
  endpoint,
  isDefaultEndpoint,
  quickstartUrl,
  authEnabled,
}: InstrumentationPromptArgs): string {
  const credentialVars = authEnabled
    ? "PHOENIX_COLLECTOR_ENDPOINT and PHOENIX_API_KEY"
    : "PHOENIX_COLLECTOR_ENDPOINT";
  const endpointRule = isDefaultEndpoint
    ? ""
    : `\n   Also set the collector endpoint in code only if the quickstart says to; it is ${endpoint}.`;

  return `You are running as part of the Phoenix setup script. Your ONLY task is to add Phoenix
tracing to the application in the current working directory. Do not run setup tools,
onboarding scripts, or this wizard again.

Follow the Phoenix tracing quickstart at exactly this URL, and no other guide:
${quickstartUrl}
That page includes instructions for agents, including how to report completion. Follow them.

Rules:
1. Tracing only. Do not add evals, datasets, prompts, dashboards, or any other feature.
2. Credentials are already provided via environment variables (${credentialVars}), which Phoenix SDKs read
   automatically. Local files \`.env.phoenix\` and \`.phoenix.json\` exist for the human
   operator. NEVER read those files, never print the API key, and never write the API key
   or any secret into source code, config files, or command arguments.
3. Configure the Phoenix project name in code: use the SDK's register/registration call
   with the project name "${projectName}".${endpointRule}
4. Prefer auto-instrumentation packages over hand-written span wrappers. Make the smallest
   correct change.
5. Do not run the application, its tests, or its build. Installing dependencies is allowed.
6. Install SDK packages with the project's existing package manager, pinned to the latest
   stable version you can verify. If this is a monorepo, note the root but only modify
   files at or below the current working directory.
7. Keep changes concise and readable. Do not restructure, reformat, or meaningfully modify
   existing application code.
8. Do not use the \`px\` CLI.

When finished, follow the completion-reporting instructions from the quickstart page:
write the trace-page URL to the file at $PHOENIX_WIZARD_RESULT_FILE if you produced one,
and end your final message with INSTRUMENTATION_COMPLETE on success or
INSTRUMENTATION_INCOMPLETE (plus a one-paragraph reason) otherwise.
`;
}
