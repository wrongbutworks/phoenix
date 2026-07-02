---
"@arizeai/phoenix-evals": major
"@arizeai/phoenix-client": major
"@arizeai/phoenix-otel": major
---

Upgrade to AI SDK v7 and OpenInference span processors for AI SDK v7 telemetry.

- `@arizeai/phoenix-evals` now depends on `ai` v7. Evaluator telemetry uses the AI SDK v7 telemetry API with a per-call `OpenTelemetry` integration from `@ai-sdk/otel`, so the `telemetry.tracer` and `telemetry.isEnabled` options keep working as before. System messages in prompt templates continue to be supported. Requires Node.js >=22.12 (AI SDK v7 is ESM-only and the CommonJS build relies on `require()` of ESM, unflagged since Node.js 22.12) and AI SDK v7-compatible model providers (e.g. `@ai-sdk/openai` v4).
- `@arizeai/phoenix-otel` upgrades `@arizeai/openinference-vercel` to v3, which translates AI SDK v7 (`@ai-sdk/otel`) spans to OpenInference. `register()` now also auto-registers an AI SDK telemetry integration when the `ai` package (v7+) is installed — AI SDK calls are traced without per-call configuration. The auto-registration defaults to the value of the `global` option (AI SDK spans route through the global tracer provider); it is skipped when the application already registered its own `OpenTelemetry` integration, and can be disabled with `aiSdkTelemetry: false`. The package is now published as ESM-only (loadable from CommonJS via `require()` on Node.js >=22.12). AI SDK v6 spans are no longer translated; stay on 1.x for AI SDK v6.
- `@arizeai/phoenix-client` requires `ai` v7 as its (optional) peer dependency and Node.js >=22.12. Experiments automatically register AI SDK telemetry for task tracing via `@arizeai/phoenix-otel`.
- Known limitation: test runners with their own CommonJS module registries (e.g. jest without ESM support enabled) cannot load ESM-only packages, so the `@arizeai/phoenix-client/jest` entry point — which loads `@arizeai/phoenix-otel` — requires jest's ESM mode; vitest is unaffected.
