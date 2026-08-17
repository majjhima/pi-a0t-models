---
name: pi-a0t-models
description: Manage a0t (agent-zero.ai) provider models in pi's models.json. Fetches the venice.ai text model catalog and writes the config grouped by family with newest families and newest versions first; can optionally live-probe each model against the a0t endpoint to keep only working ones. Use when adding, updating, or refreshing a0t models.
---

# A0T Models

Manages the `a0t` provider entries in pi's `models.json` by selecting from the venice.ai text model catalog.

## What It Does

1. Fetches all text models from `https://api.venice.ai/api/v1/models`
2. Groups models by family (GLM, Claude, GPT, Gemini, Gemma, Grok, Qwen, DeepSeek, Kimi, etc.)
3. Sorts families newest-first (by newest member's release date), and within each family sorts newest-version-first
4. Writes the result to `~/.pi/agent/models.json` (the only location pi reads), replacing only the `a0t` provider entry — all other providers and top-level keys are preserved. If the existing file can't be parsed, the script aborts instead of clobbering it. On its first write, an existing models.json is backed up to `models.json.bak` (the backup is never overwritten).

With `--probe`, each catalog model is first live-tested against `https://llm.agent-zero.ai/v1/chat/completions` (sequential, 30s timeout each — gentle on resources) and only working models (HTTP 200 with a real completion) are kept. Probing is off by default so the script runs with zero setup: no API key, no existing `auth.json` or `models.json` required.

## Usage

Run `update-models.js` from this skill's directory (paths below are relative to it):

```bash
# Default: fetch catalog and write config. No key needed — works on a fresh
# pi install before any auth or models are defined.
node update-models.js

# Live-probe each model against a0t and keep only working ones (needs a key)
node update-models.js --probe

# First-time probing setup in one command: store the key (same format as /login) and probe
node update-models.js --probe --api-key <key> --save-key
```

The API key is only needed with `--probe`. Resolution order: `--api-key` flag, `~/.pi/agent/auth.json` (written by `/login a0t` or `--save-key`), then the `AGENT_ZERO` / `A0T_API_KEY` environment variables.

If `--probe` is requested but no key is found, the script writes a bootstrap `a0t` provider with an empty model list to `models.json` (enough for `/login a0t` to work in pi) and exits with instructions — it never requires manual key-file editing. A full probe of ~100+ models takes ~3-5 minutes.

After the config is written, the user still needs an a0t key configured (`/login a0t` in pi, or `--api-key ... --save-key`) before the models can actually be used.

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
