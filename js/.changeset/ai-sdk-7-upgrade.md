---
"@arizeai/phoenix-evals": major
"@arizeai/phoenix-client": major
"@arizeai/phoenix-otel": major
---

Upgrade to AI SDK v7 and OpenInference span processors for AI SDK v7 telemetry.

- `@arizeai/phoenix-evals` now depends on `ai` v7. Evaluator telemetry uses the AI SDK v7 telemetry API with a per-call `OpenTelemetry` integration from `@ai-sdk/otel`, while preserving application logging, metrics, and other globally registered integrations. The `telemetry.tracer` and `telemetry.isEnabled` options keep working as before, and system messages in prompt templates continue to be supported. Requires Node.js >=22.12 and AI SDK v7-compatible model providers (e.g. `@ai-sdk/openai` v4).
- `@arizeai/phoenix-otel` upgrades `@arizeai/openinference-vercel` to v3, which translates AI SDK v7 (`@ai-sdk/otel`) spans to OpenInference. AI SDK telemetry remains explicitly application-configured because its registry is process-global. The package retains its Node.js 18 minimum and ESM/CommonJS entry points. AI SDK v6 spans are no longer translated; stay on 1.x for AI SDK v6.
- `@arizeai/phoenix-client` requires `ai` v7 and `@ai-sdk/otel` as optional peer dependencies. Experiment and eval-test internals register safe AI SDK task tracing without capturing request headers. Core client APIs retain Node.js 18 compatibility; AI SDK v7-backed features require the Node.js version supported by AI SDK v7.
