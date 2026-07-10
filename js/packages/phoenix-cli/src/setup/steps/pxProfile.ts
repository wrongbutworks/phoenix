/**
 * Step 8: opt-in px profile configuration (spec §3.8).
 *
 * Because the wizard *is* px, everything here is in-process — the profile
 * (including the API key, when auth is on) is written through px's own
 * settings module (`~/.px/settings.json`, dir 0700, file 0600). No argv or
 * subprocess ever carries the secret. Any failure is a non-fatal warning;
 * the wizard proceeds regardless.
 */

import {
  getStoredActiveProfile,
  loadSettings,
  saveSettings,
  type ProfileEntry,
} from "../../settings";
import * as COPY from "../copy";
import type { WizardDeps } from "../deps";
import { WizardCancelledError } from "../errors";
import { redactForDisplay } from "../util/redact";
import type { Connection } from "./connect";

/** `local` for localhost, else the host with dots → dashes. */
export function profileNameForEndpoint(endpoint: string): string {
  const host = new URL(endpoint).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return "local";
  }
  return host.replace(/\./g, "-");
}

export interface PxProfileStepArgs {
  connection: Connection;
  /** Override the settings file path (tests). */
  settingsPath?: string;
}

export async function runPxProfileStep(
  deps: WizardDeps,
  { connection, settingsPath }: PxProfileStepArgs
): Promise<void> {
  try {
    const settings = loadSettings({ settingsPath });
    const active = getStoredActiveProfile(settings);

    // A fully-configured active profile pointing elsewhere is a conflict —
    // ask before switching, never clobber silently. A partially configured
    // profile (missing endpoint or project) is non-conflicting.
    const conflicting =
      active !== undefined &&
      Boolean(active.entry.endpoint) &&
      Boolean(active.entry.project) &&
      (active.entry.endpoint !== connection.endpoint ||
        active.entry.project !== connection.projectName);

    const optedIn = await deps.prompter.select<boolean>(
      conflicting && active
        ? {
            message: COPY.PX_PROFILE.conflictMessage(
              active.name,
              active.entry.endpoint ?? ""
            ),
            options: [
              { value: false, label: COPY.PX_PROFILE.conflictNo },
              { value: true, label: COPY.PX_PROFILE.conflictYes },
            ],
          }
        : {
            message: COPY.PX_PROFILE.optInMessage,
            options: [
              { value: true, label: COPY.PX_PROFILE.optInYes },
              { value: false, label: COPY.PX_PROFILE.optInNo },
            ],
          }
    );
    if (!optedIn) {
      return;
    }

    const profileName = profileNameForEndpoint(connection.endpoint);
    const entry: ProfileEntry = {
      endpoint: connection.endpoint,
      project: connection.projectName,
    };
    if (connection.apiKey) {
      entry.apiKey = connection.apiKey;
    }
    settings.profiles[profileName] = {
      ...settings.profiles[profileName],
      ...entry,
    };
    settings.activeProfile = profileName;
    saveSettings(settings, { settingsPath });
    deps.prompter.line(COPY.PX_PROFILE.created(profileName));
  } catch (error) {
    if (error instanceof WizardCancelledError) {
      throw error;
    }
    deps.prompter.line(COPY.PX_PROFILE.failed(redactForDisplay(String(error))));
  }
}
