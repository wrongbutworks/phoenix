import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { python } from "@codemirror/lang-python";
import { css } from "@emotion/react";
import CodeMirror from "@uiw/react-codemirror";
import { useState } from "react";

import type { AgentContext } from "@phoenix/agent/context/agentContextTypes";
import { useAdvertiseAgentContext } from "@phoenix/agent/context/useAdvertiseAgentContext";
import {
  Button,
  DialogTrigger,
  Flex,
  Icon,
  IconButton,
  Icons,
  Label,
  Popover,
  View,
} from "@phoenix/components";
import { pierreDark, pierreLight } from "@phoenix/components/code";
import { fieldBaseCSS } from "@phoenix/components/core/field/styles";
import {
  FilterConditionField,
  filterConditionCodeMirrorCSS,
  filterConditionFieldCSS,
} from "@phoenix/components/filter";
import { useTheme } from "@phoenix/contexts";
import { useTracingContext } from "@phoenix/contexts/TracingContext";

import { useSpanFilters } from "./SpanFiltersContext";
import { validateSpanFilterCondition } from "./spanFilterValidation";

function filterConditionCompletions(
  context: CompletionContext
): CompletionResult | null {
  const word = context.matchBefore(/\w*/);
  if (!word) return null;

  if (word.from === word.to && !context.explicit) return null;

  return {
    from: word.from,
    options: [
      {
        label: "span_kind",
        type: "variable",
        info: "The span variant: CHAIN, LLM, RETRIEVER, TOOL, etc.",
      },
      {
        label: "status_code",
        type: "variable",
        info: "The span status: OK, UNSET, or ERROR",
      },
      {
        label: "input.value",
        type: "variable",
        info: "The input value of a span, typically a query",
      },
      {
        label: "output.value",
        type: "variable",
        info: "The output value of a span, typically a response",
      },
      {
        label: "name",
        type: "variable",
        info: "The name given to a span - e.x. OpenAI",
      },
      {
        label: "latency_ms",
        type: "variable",
        info: "Latency (i.e. duration) in milliseconds",
      },
      {
        label: "cumulative_token_count.prompt",
        type: "variable",
        info: "Sum of token count for prompt from self and all child spans",
      },
      {
        label: "cumulative_token_count.completion",
        type: "variable",
        info: "Sum of token count for completion from self and all child spans",
      },
      {
        label: "cumulative_token_count.total",
        type: "variable",
        info: "Sum of token count total (prompt + completion) from self and all child spans",
      },
      {
        label: "llm spans",
        type: "text",
        apply: "span_kind == 'LLM'",
        detail: "macro",
      },
      {
        label: "retriever spans",
        type: "text",
        apply: "span_kind == 'RETRIEVER'",
        detail: "macro",
      },
      {
        label: "search input",
        type: "text",
        apply: "'' in input.value",
        detail: "macro",
      },
      {
        label: "search output",
        type: "text",
        apply: "'' in output.value",
        detail: "macro",
      },
      {
        label: "status_code error",
        type: "text",
        apply: "status_code == 'ERROR'",
        detail: "macro",
      },
      {
        label: "Latency >= 10s",
        type: "text",
        apply: "latency_ms >= 10_000",
        detail: "macro",
      },
      {
        label: "Tokens >= 1,000",
        type: "text",
        apply: "llm.token_count.total >= 1_000",
        detail: "macro",
      },
      {
        label: "Hallucinations",
        type: "text",
        apply: "annotations['Hallucination'].label == 'hallucinated'",
        detail: "macro",
      },
      {
        label: "Annotations",
        type: "text",
        apply: "annotations['Hallucination'].label == 'hallucinated'",
        detail: "macro",
      },
      {
        label: "Metadata",
        type: "text",
        apply: "metadata['topic'] == 'agent'",
        detail: "macro",
      },
      {
        label: "Substring",
        type: "text",
        apply: "'agent' in input.value",
        detail: "macro",
      },
    ],
  };
}

type SpanFilterConditionFieldProps = {
  /**
   * Callback when the condition is valid
   */
  onValidCondition: (condition: string) => void;
  placeholder?: string;
};
export function SpanFilterConditionField(props: SpanFilterConditionFieldProps) {
  const {
    onValidCondition,
    placeholder = "filter condition (e.x. span_kind == 'LLM')",
  } = props;
  const [advertisedFilterCondition, setAdvertisedFilterCondition] =
    useState("");
  const { filterCondition, setFilterCondition, appendFilterCondition } =
    useSpanFilters();

  const projectId = useTracingContext((state) => state.projectId);

  const advertisedContext: AgentContext | null = (() => {
    // Advertise a project context that carries the current spanFilter while
    // the field is mounted. The merge in `selectActiveContexts` layers this
    // on top of the route-derived project context (which carries no filter)
    // so the server sees a single project entry with the filter included.
    // An in-progress invalid edit surfaces as empty rather than a known-bad
    // expression.
    if (!projectId) {
      return null;
    }
    return {
      type: "project",
      projectNodeId: projectId,
      spanFilter: advertisedFilterCondition,
    };
  })();

  // Keep the agent's mounted UI context aligned with the current validated
  // filter expression while this field is rendered. The matching agent
  // client action for `set_spans_filter` is registered by
  // `SpanFiltersProvider`, which owns the underlying state.
  useAdvertiseAgentContext(advertisedContext);

  return (
    <FilterConditionField
      ariaLabel="Span filter condition"
      className="span-filter-condition-field"
      completions={filterConditionCompletions}
      onChange={setFilterCondition}
      onValidCondition={onValidCondition}
      onValidationStatusChange={({ condition, isValid }) => {
        const trimmedCondition = condition.trim();
        setAdvertisedFilterCondition(
          isValid && trimmedCondition ? trimmedCondition : ""
        );
      }}
      placeholder={placeholder}
      tokenRegex={/\w*/}
      validateCondition={(condition) =>
        validateSpanFilterCondition(condition, projectId)
      }
      validationKey={projectId}
      value={filterCondition}
      extras={
        <DialogTrigger>
          <IconButton
            aria-label="Open span filter condition builder"
            css={css`
              color: var(--global-text-color-700);
              border-left: 1px solid var(--global-input-field-border-color);
              border-bottom: 0;
              border-top: 0;
              padding-left: var(--global-dimension-static-size-100);
              padding-right: var(--global-dimension-static-size-100);
              border-radius: 0;
              height: 36px !important;
            `}
            className="button--reset"
          >
            <Icon svg={<Icons.Plus />} />
          </IconButton>
          <Popover placement="bottom right">
            <FilterConditionBuilder
              onAddFilterConditionSnippet={appendFilterCondition}
            />
          </Popover>
        </DialogTrigger>
      }
    />
  );
}

/**
 * Component to build up a filter condition via snippets of conditions
 * E.x. filter by kind, filter by token count, etc.
 */
function FilterConditionBuilder(props: {
  onAddFilterConditionSnippet: (condition: string) => void;
}) {
  const { onAddFilterConditionSnippet } = props;
  return (
    <View
      width="500px"
      padding="size-200"
      borderRadius="medium"
      backgroundColor="gray-75"
    >
      <Flex direction="column" gap="size-100">
        <FilterConditionSnippet
          key="kind"
          label="filter by kind"
          initialSnippet="span_kind == 'LLM'"
          onAddFilterConditionSnippet={onAddFilterConditionSnippet}
        />
        <FilterConditionSnippet
          key="token_count"
          label="filter by token count"
          initialSnippet="cumulative_token_count.total > 1000"
          onAddFilterConditionSnippet={onAddFilterConditionSnippet}
        />
        <FilterConditionSnippet
          key="annotation_label"
          label="filter by annotation label"
          initialSnippet="annotations['Hallucination'].label == 'hallucinated'"
          onAddFilterConditionSnippet={onAddFilterConditionSnippet}
        />
        <FilterConditionSnippet
          key="eval_label"
          label="filter by evaluation label"
          initialSnippet="evals['Hallucination'].label == 'hallucinated'"
          onAddFilterConditionSnippet={onAddFilterConditionSnippet}
        />
        <FilterConditionSnippet
          key="eval_score"
          label="filter by evaluation score"
          initialSnippet="evals['Hallucination'].score < 1"
          onAddFilterConditionSnippet={onAddFilterConditionSnippet}
        />
        <FilterConditionSnippet
          key="metadata"
          label="filter by metadata"
          initialSnippet="metadata['topic'] == 'agent'"
          onAddFilterConditionSnippet={onAddFilterConditionSnippet}
        />
        <FilterConditionSnippet
          key="substring"
          label="filter by substring"
          initialSnippet="'agent' in input.value"
          onAddFilterConditionSnippet={onAddFilterConditionSnippet}
        />
      </Flex>
    </View>
  );
}

/**
 * A snippet of filter condition that can be added to the filter condition field
 */
function FilterConditionSnippet(props: {
  label: string;
  initialSnippet: string;
  onAddFilterConditionSnippet: (condition: string) => void;
}) {
  const { initialSnippet, onAddFilterConditionSnippet } = props;
  const [snippet, setSnippet] = useState<string>(initialSnippet);
  const { theme } = useTheme();
  const codeMirrorTheme = theme === "light" ? pierreLight : pierreDark;
  return (
    <div css={fieldBaseCSS}>
      <Label>{props.label}</Label>
      <Flex direction="row" width="100%" gap="size-100">
        <div
          css={css(
            filterConditionFieldCSS,
            css`
              flex: 1 1 auto;
            `
          )}
        >
          <CodeMirror
            value={snippet}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              bracketMatching: true,
              syntaxHighlighting: true,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
            extensions={[python()]}
            editable={true}
            onChange={setSnippet}
            theme={codeMirrorTheme}
            css={filterConditionCodeMirrorCSS}
          />
        </div>
        <Button
          aria-label="Add to filter condition"
          variant="default"
          onPress={() => onAddFilterConditionSnippet(snippet)}
          leadingVisual={<Icon svg={<Icons.PlusCircle />} />}
        />
      </Flex>
    </div>
  );
}
