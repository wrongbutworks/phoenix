/**
 * Claim page for `px setup` (`/cli-setup?session=…`).
 *
 * The terminal printed a verification code and opened this page. The user
 * confirms the code matches, picks (or creates) a project, and authorizes —
 * which mints an API key that the terminal receives by polling. Phishing
 * resistance: the Authorize button is inert until the user actively
 * confirms the code comparison.
 */

import { css } from "@emotion/react";
import { useState } from "react";
import { ListBox, Popover } from "react-aria-components";
import { useLoaderData, useRevalidator } from "react-router";

import { authFetch } from "@phoenix/authFetch";
import {
  Alert,
  Button,
  Checkbox,
  Flex,
  Heading,
  Input,
  Label,
  Select,
  SelectChevronUpDownIcon,
  SelectItem,
  SelectValue,
  Text,
  TextField,
  View,
} from "@phoenix/components";
import { BASE_URL } from "@phoenix/config";

import { PhoenixLogo } from "../auth/PhoenixLogo";
import type { CliSetupLoaderData } from "./cliSetupLoader";

// AuthLayout's fixed 200px top padding clips this page's taller content, so
// the claim page carries its own centered-card shell (same visual language).
const shellCSS = css`
  width: 100%;
  min-height: 100vh;
  box-sizing: border-box;
  padding: var(--global-dimension-size-600) var(--global-dimension-size-200);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(
    90% 60% at 50% 30%,
    rgba(5, 145, 193, 0.4) 0%,
    transparent 100%
  );
`;

const CREATE_NEW_PROJECT_KEY = "__create_new_project__";

const verificationCodeCSS = css`
  font-family: var(--code-font-family, monospace);
  font-size: var(--global-dimension-static-font-size-500);
  letter-spacing: 0.2em;
  text-align: center;
  padding: var(--global-dimension-size-200);
  border: 1px solid var(--global-color-grey-300);
  border-radius: var(--global-rounding-medium);
  background-color: var(--global-color-grey-100);
  user-select: all;
`;

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "done" }
  | { phase: "error"; message: string };

export function CliSetupPage() {
  const loaderData = useLoaderData<CliSetupLoaderData>();
  const revalidator = useRevalidator();
  const [codeConfirmed, setCodeConfirmed] = useState(false);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(
    null
  );
  const [newProjectName, setNewProjectName] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({
    phase: "idle",
  });

  if (loaderData.kind === "missing-session") {
    return (
      <CliSetupShell>
        <Alert variant="danger" title="Missing setup session">
          This page needs the link from your terminal. Re-run{" "}
          <code>px setup</code> and use the URL it prints.
        </Alert>
      </CliSetupShell>
    );
  }
  if (loaderData.kind === "unknown-session") {
    return (
      <CliSetupShell>
        <Alert variant="danger" title="Unknown setup session">
          This setup link isn&apos;t valid anymore. Re-run <code>px setup</code>{" "}
          in your terminal to get a fresh one.
        </Alert>
      </CliSetupShell>
    );
  }

  const { info, projects, sessionToken } = loaderData;

  if (submitState.phase === "done") {
    return (
      <CliSetupShell>
        <Alert variant="success" title="Terminal authorized">
          You can close this tab and return to your terminal.
        </Alert>
      </CliSetupShell>
    );
  }
  if (info.status === "expired") {
    return (
      <CliSetupShell>
        <Alert variant="warning" title="Setup session expired">
          This session timed out before it was authorized. Re-run{" "}
          <code>px setup</code> in your terminal to start a new one.
        </Alert>
      </CliSetupShell>
    );
  }
  if (info.status === "claimed" || info.status === "complete") {
    return (
      <CliSetupShell>
        <Alert variant="warning" title="Setup session already used">
          This setup link was already used. If that wasn&apos;t you, re-run{" "}
          <code>px setup</code> and consider revoking recent API keys in
          settings.
        </Alert>
      </CliSetupShell>
    );
  }
  if (info.viewer_blocked) {
    return (
      <CliSetupShell>
        <Alert variant="danger" title="Your role can't send traces">
          Viewer accounts can&apos;t create API keys that ingest traces. Ask an
          admin to upgrade your role, or have them run <code>px setup</code>.
        </Alert>
      </CliSetupShell>
    );
  }

  const isCreatingNew = selectedProjectKey === CREATE_NEW_PROJECT_KEY;
  const canAuthorize =
    codeConfirmed &&
    selectedProjectKey !== null &&
    (!isCreatingNew || newProjectName.trim().length > 0) &&
    submitState.phase !== "submitting";

  const onAuthorize = async () => {
    setSubmitState({ phase: "submitting" });
    try {
      let projectId = selectedProjectKey;
      if (isCreatingNew) {
        const createResponse = await authFetch(`${BASE_URL}/v1/projects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: newProjectName.trim() }),
        });
        if (!createResponse.ok) {
          throw new Error(
            `Couldn't create the project (HTTP ${createResponse.status}).`
          );
        }
        const created = (await createResponse.json()) as {
          data: { id: string };
        };
        projectId = created.data.id;
      }
      const completeResponse = await authFetch(
        `${BASE_URL}/auth/setup-sessions/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_token: sessionToken,
            project_id: projectId,
          }),
        }
      );
      if (completeResponse.status === 410) {
        // Session aged out mid-flow — reload to render the expired state.
        revalidator.revalidate();
        setSubmitState({
          phase: "error",
          message: "The session expired — re-run `px setup`.",
        });
        return;
      }
      if (!completeResponse.ok) {
        const detail = await completeResponse
          .json()
          .then((body: { detail?: string }) => body.detail)
          .catch(() => undefined);
        throw new Error(
          detail ?? `Authorization failed (HTTP ${completeResponse.status}).`
        );
      }
      setSubmitState({ phase: "done" });
    } catch (error) {
      setSubmitState({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <CliSetupShell>
      <Flex direction="column" gap="size-200">
        <Heading level={1}>Connect your terminal</Heading>
        <Text color="text-700">
          <code>px setup</code> is waiting for you to authorize it. First, make
          sure this code matches the one printed in your terminal:
        </Text>
        <div css={verificationCodeCSS} data-testid="verification-code">
          {info.verification_code}
        </div>
        <Checkbox isSelected={codeConfirmed} onChange={setCodeConfirmed}>
          This code matches my terminal: {info.verification_code}
        </Checkbox>
        <Select
          value={selectedProjectKey}
          onChange={(key) => {
            if (key != null) {
              setSelectedProjectKey(String(key));
            }
          }}
        >
          <Label>Send traces to project</Label>
          <Button>
            <SelectValue />
            <SelectChevronUpDownIcon />
          </Button>
          <Popover>
            <ListBox>
              <SelectItem
                key={CREATE_NEW_PROJECT_KEY}
                id={CREATE_NEW_PROJECT_KEY}
                textValue="Create a new project"
              >
                ＋ Create a new project…
              </SelectItem>
              {projects.map((project) => (
                <SelectItem
                  key={project.id}
                  id={project.id}
                  textValue={project.name}
                >
                  {project.name}
                </SelectItem>
              ))}
            </ListBox>
          </Popover>
        </Select>
        {isCreatingNew && (
          <TextField value={newProjectName} onChange={setNewProjectName}>
            <Label>New project name</Label>
            <Input placeholder="my-app" />
          </TextField>
        )}
        {submitState.phase === "error" && (
          <Alert variant="danger">{submitState.message}</Alert>
        )}
        <Text color="text-700" size="XS">
          Authorizing creates an API key named &quot;cli-setup&quot; for your
          account. The key is scoped to your role (not to the project) and can
          be revoked any time in settings.
        </Text>
        <Button
          variant="primary"
          isDisabled={!canAuthorize}
          onPress={onAuthorize}
        >
          {submitState.phase === "submitting" ? "Authorizing…" : "Authorize"}
        </Button>
      </Flex>
    </CliSetupShell>
  );
}

function CliSetupShell({ children }: { children: React.ReactNode }) {
  return (
    <main css={shellCSS}>
      <View
        borderColor="default"
        borderWidth="thin"
        width="size-5000"
        padding="size-400"
        backgroundColor="gray-75"
        borderRadius="medium"
      >
        <Flex direction="column" gap="size-200" alignItems="center">
          <PhoenixLogo />
        </Flex>
        <View paddingTop="size-200">{children}</View>
      </View>
    </main>
  );
}
