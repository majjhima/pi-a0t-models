---
name: a0t-models
description: Manage a0t (agent-zero.ai) provider models in pi's models.json. Fetches the venice.ai text model catalog, live-probes each against the a0t endpoint to find working models, then writes the config grouped by family with newest families and newest versions first. Use when adding, updating, or refreshing a0t models.
---

# A0T Models

Manages the `a0t` provider entries in pi's `models.json` by selecting from the venice.ai text model catalog.

## What It Does

1. Fetches all text models from `https://api.venice.ai/api/v1/models`
2. Live-probes each model against `https://llm.agent-zero.ai/v1/chat/completions` to confirm it works (sequential, 30s timeout each — gentle on resources)
3. Filters to working models only (HTTP 200 with a real completion)
4. Groups models by family (GLM, Claude, GPT, Gemini, Gemma, Grok, Qwen, DeepSeek, Kimi, etc.)
5. Sorts families newest-first (by newest member's release date), and within each family sorts newest-version-first
6. Writes the result to `~/.pi/agent/models.json` (the only location pi reads), replacing only the `a0t` provider entry — all other providers and top-level keys are preserved. If the existing file can't be parsed, the script aborts instead of clobbering it.

## Usage

Run `update-models.js` from this skill's directory (paths below are relative to it):

```bash
# Full refresh: fetch catalog, probe all models, write config
node update-models.js

# Skip probing (use all venice text models without testing — faster but may include broken ones)
node update-models.js --no-probe
```

The script reads the a0t API key from `~/.pi/agent/auth.json`. It takes ~3-5 minutes for a full probe of ~100+ models.

## Sorting Logic

- **Family order**: families are ordered by their newest member's `created` date, descending (newest family first).
- **Within-family order**: sorted by version number (descending), then `created` date (descending), then name (ascending) as a tiebreaker.
- The `e2ee-` prefix (end-to-end-encrypted variants) is stripped for family detection, so encrypted variants group with their base family.

## Family Detection

| Family | ID prefixes |
|--------|------------|
| glm | `zai-org-glm-*`, `z-ai-glm-*`, `olafangensan-glm-*`, `e2ee-glm-*` |
| claude | `claude-*` |
| gpt | `openai-gpt-*` (not OSS) |
| gpt-oss | `openai-gpt-oss-*`, `e2ee-gpt-oss-*` |
| gemini | `gemini-*` |
| gemma | `google-gemma-*`, `gemma-*`, `e2ee-gemma-*` |
| grok | `grok-*` |
| qwen | `qwen*`, `e2ee-qwen*` |
| deepseek | `deepseek-*`, `e2ee-deepseek-*` |
| kimi | `kimi-*` |
| minimax | `minimax-*` |
| mistral | `mistral-*` |
| aion | `aion-labs-*` |
| llama | `llama-*` |
| hermes | `hermes-*` |
| venice | `venice-uncensored-*` |
| nvidia | `nvidia-*` |
| seed | `seed-*` |
| mercury | `mercury-*` |
| mimo | `xiaomi-mimo-*` |
| inkling | `inkling` |

## Model Entry Fields

Each model entry is derived from the venice catalog:
- `name`: `"A0T "` + venice display name
- `reasoning`: from venice's `supportsReasoning` capability
- `input`: `["text", "image"]` if vision-capable, else `["text"]`
- `contextWindow`: from venice's `context_length`
- `maxTokens`: from venice's `maxCompletionTokens`
- `cost.input/output/cacheRead`: from venice's pricing (USD per million tokens)
- `cost.cacheWrite`: always 0

## Files

- `update-models.js` — main script
- `SKILL.md` — this file
