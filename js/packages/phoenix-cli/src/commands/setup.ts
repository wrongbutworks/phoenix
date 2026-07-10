/**
 * `px setup` — the agent-first onboarding wizard (registration only).
 *
 * `setup` is a deliberate exception to the CLI's noun-verb rule —
 * onboarding is a wizard, not a resource (precedent: `gh browse`-style
 * top-level specials). All behavior lives in `../setup/wizard.ts` behind
 * the `WizardDeps` seam.
 */

import { Command } from "commander";

import { ExitCode, getExitCodeForError } from "../exitCodes";
import { writeError, writeOutput } from "../io";
import * as COPY from "../setup/copy";
import { buildDefaultDeps, type WizardOptions } from "../setup/deps";
import {
  HeadlessInputError,
  WizardCancelledError,
  WizardFatalError,
} from "../setup/errors";
import { headlessSummary, runWizard } from "../setup/wizard";

interface SetupCommandOptions {
  endpoint?: string;
  project?: string;
  input?: boolean;
  appUrl?: string;
  apiUrl?: string;
}

async function setupHandler(options: SetupCommandOptions): Promise<void> {
  const wizardOptions: WizardOptions = {
    endpoint: options.endpoint,
    project: options.project,
    noInput: options.input === false,
    appUrl: options.appUrl,
    apiUrl: options.apiUrl,
  };
  const deps = buildDefaultDeps(wizardOptions);

  try {
    const result = await runWizard(deps);
    if (result.headless) {
      writeOutput({ message: headlessSummary(result) });
    }
    process.exit(ExitCode.SUCCESS);
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      writeError({ message: COPY.CANCEL_OUTRO });
      process.exit(ExitCode.CANCELLED);
    }
    if (error instanceof HeadlessInputError) {
      writeError({ message: error.message });
      process.exit(ExitCode.INVALID_ARGUMENT);
    }
    if (error instanceof WizardFatalError) {
      writeError({ message: error.message });
      process.exit(ExitCode.FAILURE);
    }
    writeError({ message: String(error) });
    process.exit(getExitCodeForError(error));
  }
}

export function createSetupCommand(): Command {
  const command = new Command("setup");
  command
    .description(
      "Interactive onboarding wizard: connect this app to Phoenix and get traces flowing.\n" +
        "(A top-level command, unlike the CLI's usual noun-verb layout — onboarding is a wizard, not a resource.)"
    )
    .option(
      "--endpoint <url>",
      "Phoenix endpoint (skips the deployment question)"
    )
    .option("--project <name>", "Phoenix project name or ID")
    .option(
      "--no-input",
      "Headless mode: no prompts; resolves the connection, writes hand-off files, and exits"
    )
    .addOption(
      command
        .createOption("--app-url <url>", "Browser-flow origin override (dev)")
        .hideHelp()
    )
    .addOption(
      command
        .createOption("--api-url <url>", "REST origin override (dev)")
        .hideHelp()
    )
    .action(setupHandler)
    .addHelpText(
      "after",
      `
Examples:
  px setup
  px setup --endpoint https://phoenix.example.com
  px setup --no-input --endpoint http://localhost:6006 --project my-app
`
    );
  return command;
}
