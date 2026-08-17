# pi-a0t-models

A [pi](https://github.com/earendil-works/pi-coding-agent) package providing the **pi-a0t-models** skill. The skill manages the `a0t` provider ([agent-zero.ai](https://agent-zero.ai)) entries in pi's `models.json` by selecting from the venice.ai text model catalog.

It fetches the catalog, groups models by family (GLM, Claude, GPT, Gemini, Grok, Qwen, DeepSeek, Kimi, …), sorts newest families and newest versions first, and writes the result to pi's model configuration. Optionally (`--probe`) it live-tests each model against the a0t endpoint first and keeps only the ones that actually work.

## Prerequisites

Just a working pi install. An a0t API key from agent-zero.ai is only needed for `--probe`, and to actually use the models in pi.

## Installation

```bash
# From git (once pushed)
pi install git:github.com/majjhima/pi-a0t-models

# Or from a local checkout
pi install /path/to/pi-a0t-models
```

Restart pi (or start a new session) after installing so the skill is discovered.

## Usage

### Fresh pi install — run the script directly

Skills are executed by pi's agent, which needs a working model itself — so with nothing configured yet, invoking the skill fails ("No API key found for the selected model"). Run the script in a terminal instead. cd into the skill directory (`skills/pi-a0t-models` inside the package, wherever your install method placed it; `find ~/.pi -name update-models.js 2>/dev/null` will locate it), then one command does the whole setup — writes `~/.pi/agent/models.json` and stores your key in the same format as `/login`:

```bash
node update-models.js --api-key YOUR_A0T_API_KEY --save-key
```

No key yet? Plain `node update-models.js` still writes the full catalog; add the key later with `/login a0t` inside pi.

Then start pi and pick a model with `/model` — the a0t models appear as `A0T <name>`, grouped newest families first.

### pi already configured — use the skill

```
/skill:pi-a0t-models
```

or simply ask pi to "add/refresh the a0t models" — the skill loads automatically when the task matches. To keep only models confirmed working on the a0t endpoint, ask for a run with `--probe` (needs an a0t key configured; ~3–5 minutes for 100+ models, sequential, 30s timeout each). Restart pi afterwards so it picks up the new config.

You can always run the script by hand too — same directory as above:

```bash
node update-models.js          # fetch catalog, write config (no key needed)
node update-models.js --probe  # keep only working models (needs a key)
```

Either way, the script only replaces the `a0t` provider entry in `models.json`: other providers are preserved, it aborts rather than touch an unparseable file, and the first time it writes the file it backs it up to `models.json.bak` (never overwritten).

## What the script does

1. Fetches all text models from `https://api.venice.ai/api/v1/models`
2. With `--probe` only: live-tests each against `https://llm.agent-zero.ai/v1/chat/completions` (sequential, 30s timeout) and keeps only working models (HTTP 200 with a real completion)
3. Groups by family; `e2ee-` encrypted variants group with their base family
4. Sorts families by newest member's release date, and versions newest-first within each family
5. Derives each entry's `reasoning`, `input` modalities, `contextWindow`, `maxTokens`, and `cost` from the venice catalog
6. Merges the provider config (`baseUrl`, `apiKey: $AGENT_ZERO`, etc.) plus the model list into `~/.pi/agent/models.json`, replacing only the `a0t` provider entry and leaving all other providers and top-level keys untouched

## Package structure

```
pi-a0t-models/
├── package.json            # pi manifest: exposes ./skills
├── README.md
├── LICENSE
└── skills/
    └── pi-a0t-models/
        ├── SKILL.md        # skill instructions (loaded on-demand by the agent)
        └── update-models.js
```

## License

MIT
