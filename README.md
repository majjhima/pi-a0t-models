# pi-a0t-models

A [pi](https://github.com/earendil-works/pi-coding-agent) package providing the **a0t-models** skill. The skill manages the `a0t` provider ([agent-zero.ai](https://agent-zero.ai)) entries in pi's `models.json` by selecting from the venice.ai text model catalog.

It fetches the catalog, live-probes each model against the a0t endpoint, keeps only the ones that actually work, groups them by family (GLM, Claude, GPT, Gemini, Grok, Qwen, DeepSeek, Kimi, …), sorts newest families and newest versions first, and writes the result to pi's model configuration.

## Prerequisites

- pi installed and working
- An a0t API key from agent-zero.ai
- Node.js 18+ (for the built-in `fetch` API)

## Installation

```bash
# From git (once pushed)
pi install git:github.com/majjhima/pi-a0t-models

# Or from a local checkout
pi install /path/to/pi-a0t-models
```

Restart pi (or start a new session) after installing so the skill is discovered.

## Before configuring any models

Complete these steps **before** running the skill or writing any model configuration:

1. **Install the package** (see above) and confirm pi sees the skill:
   ```bash
   pi list
   ```
   In an interactive session you can also check that `/skill:a0t-models` is available.

2. **Configure your a0t API key.** The script reads the key from `~/.pi/agent/auth.json`. Add an `a0t` entry:
   ```json
   {
     "a0t": {
       "key": "YOUR_A0T_API_KEY"
     }
   }
   ```
   Alternatively, export it as an environment variable instead:
   ```bash
   export AGENT_ZERO="YOUR_A0T_API_KEY"   # or A0T_API_KEY
   ```

3. **Back up any existing model config** (cheap insurance). The script only replaces the `a0t` provider entry in `~/.pi/agent/models.json` — other providers are preserved — and it aborts rather than touch an unparseable file, but a backup costs nothing:
   ```bash
   cp ~/.pi/agent/models.json ~/.pi/agent/models.json.bak 2>/dev/null
   ```

4. **Set aside a few minutes.** A full run probes every venice text model sequentially (30s timeout each) and takes ~3–5 minutes for 100+ models. Use `--no-probe` if you want a fast, untested config instead.

## Usage

Once the steps above are done, either let pi run the skill:

```
/skill:a0t-models
```

or simply ask pi to "add/refresh the a0t models" — the skill loads automatically when the task matches.

You can also run the script directly (path depends on where the package is installed; the command below uses the git install location):

```bash
# Full refresh: fetch catalog, probe all models, write config
node ~/.pi/agent/git/github.com/majjhima/pi-a0t-models/skills/a0t-models/update-models.js

# Skip probing (use all venice text models without testing — faster but may include broken ones)
node ~/.pi/agent/git/github.com/majjhima/pi-a0t-models/skills/a0t-models/update-models.js --no-probe
```

After the config is written, restart pi and pick a model with `/model` — the a0t models appear as `A0T <name>`, grouped newest families first.

## What the script does

1. Fetches all text models from `https://api.venice.ai/api/v1/models`
2. Live-probes each against `https://llm.agent-zero.ai/v1/chat/completions` (sequential, 30s timeout)
3. Keeps only working models (HTTP 200 with a real completion)
4. Groups by family; `e2ee-` encrypted variants group with their base family
5. Sorts families by newest member's release date, and versions newest-first within each family
6. Derives each entry's `reasoning`, `input` modalities, `contextWindow`, `maxTokens`, and `cost` from the venice catalog
7. Merges the provider config (`baseUrl`, `apiKey: $AGENT_ZERO`, etc.) plus the model list into `~/.pi/agent/models.json`, replacing only the `a0t` provider entry and leaving all other providers and top-level keys untouched

## Package structure

```
pi-a0t-models/
├── package.json            # pi manifest: exposes ./skills
├── README.md
├── LICENSE
└── skills/
    └── a0t-models/
        ├── SKILL.md        # skill instructions (loaded on-demand by the agent)
        └── update-models.js
```

## License

MIT
