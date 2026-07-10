import type { UIMessage } from "ai";

import type { components } from "@phoenix/api/__generated__/v1";

/** Wire schema of the chat stream's `message_metadata` payload. */
type AssistantMessageMetadata =
  components["schemas"]["AssistantMessageMetadata"];

/** Wire schema of the transient `data-session-summary` stream chunk. */
type SessionSummaryChunk = components["schemas"]["SessionSummaryChunk"];

/** Wire schema of the transient `data-graphql-result` stream chunk. */
type GraphQLResultChunk = components["schemas"]["GraphQLResultChunk"];

/**
 * Payloads of the custom `data-*` chunks the backend chat route streams
 * alongside the message. Keys are the chunk type without the `data-` prefix.
 */
type AgentUIDataTypes = {
  "session-summary": SessionSummaryChunk["data"];
  "graphql-result": GraphQLResultChunk["data"];
};

/**
 * AI SDK `UIMessage` parameterized with the backend's wire schemas, sourced
 * from the generated OpenAPI types.
 */
export type AgentUIMessage = UIMessage<
  AssistantMessageMetadata,
  AgentUIDataTypes
>;
