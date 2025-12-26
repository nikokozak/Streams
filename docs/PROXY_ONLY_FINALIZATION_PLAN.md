# Proxy-Only Finalization Plan (Ticker Alpha)

This document is the **single source of truth** for finishing the “proxy-only” migration and restoring intent-based dispatch (search vs. frontier models) **without any local vendor keys**.

Scope:
- Ticker (Swift + WebView) **must not** call any vendor APIs directly (OpenAI/Anthropic/Perplexity).
- Ticker-Proxy (Phoenix) becomes the only network path for LLM requests, restatements, modifiers, and routing.
- Intent classification runs **client-side** (MLX), and the intent result is sent to the proxy. The proxy chooses provider+model.

Non-goals:
- Re-architecting prompts/content model beyond what is required for proxy-only.
- Perfectly “one-call” restatements (we intentionally keep restatement and response as separate calls for migration safety).

---

## P0 Requirements (hard constraints)

### Proxy-only networking
- Ticker makes **zero** HTTP requests to:
  - `api.openai.com`
  - `api.anthropic.com`
  - `api.perplexity.ai`
- Ticker stores **no** vendor API keys locally (Keychain, Application Support, UserDefaults, env-var fallback).
- All LLM-related requests go through the proxy:
  - Inference streaming: `POST /v1/llm/request` (`stream: true`)
  - Restatement: `POST /v1/llm/request` (`stream: false`)
  - Modifier label + modifier apply: `POST /v1/llm/request` (streaming optional)
  - Search routing: still `POST /v1/llm/request` (proxy decides provider/model)

### Safe fallbacks
- If intent classification fails or is disabled, the request must still succeed by using the user’s default provider/model selection.
- If proxy is unreachable:
  - The app should surface an actionable error and must not hang indefinitely (timeouts).

### Extensible “intent” contract
Intent is designed so more types can be added later without breaking old clients:
- Proxy accepts unknown intent fields.
- Proxy treats unknown intent types as “no routing override”.

---

## Architecture (what should own what)

### Non-negotiable invariants (to avoid fragmentation)
- There is exactly **one** codepath in Ticker that can talk to an LLM: the proxy client.
- Restatement/modifiers/search are **not special cases**: they are just different request presets sent through the same proxy client.
- No “shadow” logic is allowed to remain that:
  - uses vendor endpoints directly, or
  - checks vendor `isConfigured` flags, or
  - depends on vendor keys for unrelated features (e.g. classifier gating).

### Client (Ticker) responsibilities
- UI + local persistence + bridge messaging.
- Generate `device_id` and persist the **device key** (the proxy-issued serial) per existing DeviceKeyService behavior.
- Generate a request-id per request (diagnostics optional).
- Run **local intent classification** (MLX) and attach intent to the proxy request.

### Proxy (Ticker-Proxy) responsibilities
- Auth + device binding enforcement.
- Rate limiting and token budgets.
- Provider selection and request routing based on:
  1) intent override (e.g. search → Perplexity)
  2) client preference (default provider)
  3) proxy defaults
- **Model ID selection defaults live on the proxy** (configurable via env).

### Recommended client structure (so “proxy-only” is enforceable)
Create/keep a single Swift entrypoint for proxy LLM requests:
- `ProxyLLMService` (or a renamed `TickerProxyLLMClient`) should own:
  - building `/v1/llm/request` JSON bodies
  - applying functional + diagnostic headers (via `DeviceKeyService.applyDiagnosticsHeaders`)
  - parsing SSE events + errors
  - emitting structured errors upstream (so UI gets consistent messaging)

Then use small “presets” (not separate networking code) for:
- inference (streaming)
- restatement (non-stream)
- modifier label (non-stream)
- modifier apply (streaming)

This prevents “we fixed inference but forgot restatement/modifiers”.

---

## Model/Provider configuration (coalesced on the proxy)

### Goal
Stop hardcoding vendor model IDs in the Ticker client. The proxy owns “what model ID to use” so changes require only server env updates.

### Naming convention (avoid confusion)
Use a dedicated env file name for AI/provider defaults:
- Local file (not committed): `.env.ai.providers`
- Committed template: `.env.ai.providers.example`

This keeps “AI provider defaults” separate from other env/secrets and makes it obvious what to edit.

### Proxy runtime config (recommended env vars)
Add these env-configurable defaults in `Ticker-Proxy/config/runtime.exs` (names can vary; keep them consistent):

- OpenAI:
  - `OPENAI_DEFAULT_TEXT_MODEL` (default: `gpt-4o-mini`)
  - `OPENAI_DEFAULT_VISION_MODEL` (default: `gpt-4o`)
- Anthropic:
  - `ANTHROPIC_DEFAULT_TEXT_MODEL` (default: `claude-sonnet-4-20250514`)
  - `ANTHROPIC_DEFAULT_VISION_MODEL` (default: `claude-sonnet-4-20250514`)
- Perplexity (search):
  - `PERPLEXITY_DEFAULT_MODEL` (default: `sonar`)

Deployment note:
- In Fly, set these via `fly secrets set ...` (or equivalent) rather than relying on a checked-in `.env`.
- Recommended workflow:
  - Copy `.env.ai.providers.example` → `.env.ai.providers`
  - Edit `.env.ai.providers` locally
  - Apply values to Fly secrets (scripted or manual) and do not commit `.env.ai.providers`

**Fallback requirement**: defaults must match the prior local dispatch behavior:
- OpenAI text: `gpt-4o-mini`
- OpenAI vision: `gpt-4o`
- Anthropic: `claude-sonnet-4-20250514`
- Perplexity search: `sonar`

### Proxy request semantics for model selection
To keep client changes small:
- Keep existing `model` field, but allow `model: "default"` (or missing model) to mean: “proxy chooses”.
- Proxy chooses based on:
  - Provider chosen (intent override or client preference)
  - Whether the request is multimodal (has image parts)
  - Optional request “purpose” (restatement/modifier/search/inference) if added later

This lets the client stop hardcoding model IDs while keeping the same endpoint.

### Compatibility policy (so we can roll out safely)
Proxy should accept both:
- **Old clients** that send an explicit `model` id
- **New clients** that send `model: "default"` (or omit model)

Routing chooses:
1) provider override from intent (e.g. search → perplexity)
2) provider preference from client (openai/anthropic)
3) default provider (openai)

Model chooses:
- If client provided an explicit model id (and it’s not `"default"`), use it.
- Else pick from env defaults using:
  - provider
  - “has images” (vision vs text)

---

## Intent: client classification + proxy routing

### Client intent object (extensible)
Add optional `intent` to the `/v1/llm/request` body:

```json
{
  "intent": {
    "type": "search",
    "confidence": 0.9,
    "source": "mlx"
  }
}
```

Rules:
- Only `type` is required if intent is present.
- `confidence` and `source` are optional; proxy must ignore unknown fields.
- If `intent` missing, proxy uses default provider selection.

Forward-compatibility recommendation:
- Add an optional `version` field later if the meaning of intent types changes (don’t add it now unless needed).

### Intent types (initial)
Use the existing `QueryIntent` set as the seed (so it can expand):
- `search`
- `knowledge`
- `expand`
- `summarize`
- `rewrite`
- `extract`
- `ambiguous`

### Proxy routing policy (simple, explicit)
Minimal routing override for alpha:
1) If `intent.type == "search"` → force provider `perplexity` and use `PERPLEXITY_DEFAULT_MODEL`.
2) Otherwise → use the user-selected provider preference (e.g. openai/anthropic).
3) If provider preference missing/invalid → default to openai.

Future expansion:
- Add more overrides gradually (e.g. “summarize” uses smaller model).

---

## Implementation steps (Claude checklist)

### Step 1 — Ticker audit: eliminate vendor calls (P0)
Find and remove/disable:
- Any file that hits vendor endpoints directly:
  - `Sources/Ticker/Services/AIService.swift`
  - `Sources/Ticker/Services/PerplexityService.swift`
  - Any Anthropic/OpenAI provider services
- Any gating that checks vendor keys:
  - `hasVendorKey` / `isConfigured` checks tied to OpenAI/Anthropic/Perplexity
- Any Keychain/UserDefaults migration for vendor keys.

Acceptance checks:
- `rg "api\\.openai\\.com|api\\.anthropic\\.com|api\\.perplexity\\.ai" Sources/Ticker` returns nothing actionable.
- No logs like “Perplexity API key not configured”.

Anti-regression tripwire (recommended):
- Add a CI/`precommit` step (or unit test) that fails if any of those vendor domains appear in `Sources/Ticker`.

### Step 2 — Intent classifier lifecycle in Ticker (P0)
Current problem: `WebViewManager.loadMLXClassifier()` requires a Perplexity API key. In proxy-only world that is invalid.

Change:
- Load MLX classifier when `smartRoutingEnabled == true` (only).
- Never require any vendor key to load classifier.
- If MLX fails to load, routing falls back to default provider (no crash, no block).

Important: classification must never block response streaming:
- If classifier isn’t ready, proceed immediately with `intent = nil`.
- Do not `await waitForClassifier()` in the hot path unless you cap it to a tiny timeout (e.g. 50–100ms).

### Step 3 — Pass intent to proxy on every LLM request (P0)
In `ProxyLLMService.swift`:
- Build request JSON with:
  - `provider`: user preference (openai/anthropic) OR omit and let proxy default
  - `model`: `"default"` (preferred) so proxy controls model IDs
  - `intent`: the classifier result if available
  - `messages`: current proxy message parts (base64-only images)
  - `stream`: true/false depending on call type

Source of provider preference:
- Use the user’s existing “Default AI provider” setting as **preference**, not as a final routing decision.

### Step 4 — Restatement through proxy (P0; separate call)
Replace local restatement generation with a non-stream proxy request:
- system prompt = `Prompts.restatement`
- user = raw input
- provider preference = user default provider
- model = `"default"` (proxy chooses)

Parse:
- `"NONE"` → ignore
- else send `restatementGenerated` bridge message and persist.

### Step 5 — Modifiers through proxy (P0)
Replace local modifier label and modifier apply calls with proxy calls:
- label prompt: `Prompts.modifierLabel` (non-stream)
- apply modifier: `Prompts.applyModifier` (stream)

### Step 6 — Proxy server changes (P0)
In `Ticker-Proxy`:
- Accept optional `intent`.
- Add routing module (or controller helper) that:
  - If `intent.type == "search"` → provider = perplexity
  - Else provider = client preference/default
- Add model resolution:
  - If client model is `"default"` or missing, resolve from env defaults using provider + multimodal presence.
  - Keep backwards compatibility if client sends explicit model.
- Update OpenAPI to include intent and default model semantics.
- Add tests:
  - search intent forces perplexity routing
  - unknown intent does not break; falls back
  - model `"default"` resolves to expected env defaults

---

## Sanity checklist (manual QA)

- With a valid device key:
  - Normal prompts stream and complete (OpenAI/Anthropic based on setting).
  - Search-like prompts route to Perplexity (verify proxy response provider).
  - Restatements appear again.
  - Modifiers work again.
- With `smartRoutingEnabled = false`:
  - No intent included; proxy always uses default provider preference.
- With MLX failing to load:
  - Requests still work (no intent).
- No Keychain prompts for vendor keys; no vendor-key settings UI.
