/**
 * Clack-backed implementation of the wizard's `Prompter` seam.
 *
 * House rules (spec §1.1): the wizard has no confirm primitive — every
 * choice, including booleans, is a select. Cancellation (Ctrl-C / Escape)
 * maps to `WizardCancelledError`, unwinding to the single catch site in the
 * command handler.
 */

import {
  intro,
  isCancel,
  log,
  note,
  outro,
  password,
  select,
  text,
} from "@clack/prompts";

import type { Prompter, SelectOption } from "../deps";
import { WizardCancelledError } from "../errors";

export function createClackPrompter(): Prompter {
  return {
    async select<T>(args: {
      message: string;
      options: Array<SelectOption<T>>;
    }): Promise<T> {
      // Loop so picking a disabled option explains itself and re-asks
      // instead of proceeding.
      for (;;) {
        // Clack's Option<T> type only resolves for primitive T; the shape
        // we build is valid for both branches, so the cast is safe.
        const answer = await select<T>({
          message: args.message,
          options: args.options.map((option) => ({
            value: option.value,
            label: option.disabled ? `✗ ${option.label}` : option.label,
            hint: option.hint,
          })) as Parameters<typeof select<T>>[0]["options"],
        });
        if (isCancel(answer)) {
          throw new WizardCancelledError();
        }
        const picked = args.options.find((option) => option.value === answer);
        if (picked?.disabled) {
          log.warn(picked.hint ?? "That option is not available.");
          continue;
        }
        return answer as T;
      }
    },

    async textInput(args: {
      message: string;
      defaultValue?: string;
      validate?: (value: string) => string | undefined;
    }): Promise<string> {
      const answer = await text({
        message: args.message,
        defaultValue: args.defaultValue,
        placeholder: args.defaultValue,
        validate: args.validate
          ? (value) => {
              // Clack substitutes defaultValue for an empty submission, but
              // runs validate on the raw (empty) input — validate what will
              // actually be returned.
              const effective =
                !value && args.defaultValue !== undefined
                  ? args.defaultValue
                  : (value ?? "");
              return args.validate?.(effective);
            }
          : undefined,
      });
      if (isCancel(answer)) {
        throw new WizardCancelledError();
      }
      return answer;
    },

    async passwordInput(args: {
      message: string;
      validate?: (value: string) => string | undefined;
    }): Promise<string> {
      const answer = await password({
        message: args.message,
        validate: args.validate
          ? (value) => args.validate?.(value ?? "")
          : undefined,
      });
      if (isCancel(answer)) {
        throw new WizardCancelledError();
      }
      return answer;
    },

    note(message: string, title?: string): void {
      note(message, title);
    },

    line(message: string): void {
      log.message(message);
    },

    intro(message: string): void {
      intro(message);
    },

    outro(message: string): void {
      outro(message);
    },
  };
}
