/**
 * Typed errors for the setup wizard.
 *
 * `WizardCancelledError` is thrown by the prompter whenever the user cancels
 * (Ctrl-C / Escape on any prompt) and unwinds the whole wizard to a single
 * catch site in the command handler, which prints the support outro and
 * exits with `ExitCode.CANCELLED`.
 */

export class WizardCancelledError extends Error {
  constructor() {
    super("Setup cancelled by user");
    this.name = "WizardCancelledError";
  }
}

/**
 * Thrown in headless mode when a prompt site has no value available from
 * flags or environment variables. Carries the exact remediation text so the
 * command handler can print it and exit `INVALID_ARGUMENT`.
 */
export class HeadlessInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeadlessInputError";
  }
}

/**
 * Thrown when a step fails in a way the wizard cannot recover from
 * (e.g. headless dirty git tree). Exits `FAILURE`.
 */
export class WizardFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WizardFatalError";
  }
}
