#!/usr/bin/env node
// update-models.js — Fetch venice.ai text models, probe the a0t endpoint for
// working ones, then write pi's models.json grouped by family (newest families
// first, newest version first within each family).
//
// Usage:  node update-models.js [--no-probe]
//   --no-probe  Skip live probing; trust all venice text models as working.
//
// Reads the a0t API key from ~/.pi/agent/auth.json.
// Writes to ~/.pi/agent/models.json.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const VENICE_URL = 'https://api.venice.ai/api/v1/models';
const A0T_URL = 'https://llm.agent-zero.ai/v1/chat/completions';
const CONFIG_PATH = path.join(HOME, '.pi', 'agent', 'models.json');
const AUTH_PATH = path.join(HOME, '.pi', 'agent', 'auth.json');

// ── helpers ──────────────────────────────────────────────────────────────

function log(msg) { process.stderr.write(msg + '\n'); }

function getApiKey() {
  try {
    const auth = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    if (auth.a0t && auth.a0t.key) return auth.a0t.key;
  } catch (e) { /* fall through */ }
  const env = process.env.AGENT_ZERO || process.env.A0T_API_KEY;
  if (env) return env;
  throw new Error('No a0t API key found in ' + AUTH_PATH + ' or environment');
}

function round(n, dp) {
  if (n == null) return 0;
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON) * f) / f;
}

// Extract version number from a model name for within-family sorting.
// "GLM 5.2" → 5.2, "GPT-5.6 Luna" → 5.6, "GPT OSS 120B" → 120, "Inkling" → 0
function vnum(name) {
  const m = name.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

// Group model IDs into families. Strips the e2ee- prefix (encrypted variants
// belong with their base family).
function family(id) {
  const i = id.startsWith('e2ee-') ? id.slice(5) : id;
  if (i.startsWith('zai-org-glm') || i.startsWith('z-ai-glm') || i.startsWith('olafangensan-glm') || i.startsWith('glm')) return 'glm';
  if (i.startsWith('claude')) return 'claude';
  if (i.startsWith('openai-gpt-oss') || i.startsWith('gpt-oss')) return 'gpt-oss';
  if (i.startsWith('openai-gpt')) return 'gpt';
  if (i.startsWith('gemini')) return 'gemini';
  if (i.startsWith('google-gemma') || i.startsWith('gemma')) return 'gemma';
  if (i.startsWith('grok')) return 'grok';
  if (i.startsWith('qwen')) return 'qwen';
  if (i.startsWith('deepseek')) return 'deepseek';
  if (i.startsWith('kimi')) return 'kimi';
  if (i.startsWith('minimax')) return 'minimax';
  if (i.startsWith('mistral')) return 'mistral';
  if (i.startsWith('aion-labs')) return 'aion';
  if (i === 'inkling') return 'inkling';
  if (i.startsWith('llama')) return 'llama';
  if (i.startsWith('hermes')) return 'hermes';
  if (i.startsWith('venice-uncensored')) return 'venice';
  if (i.startsWith('nvidia')) return 'nvidia';
  if (i.startsWith('seed')) return 'seed';
  if (i.startsWith('mercury')) return 'mercury';
  if (i.startsWith('xiaomi-mimo') || i.startsWith('mimo')) return 'mimo';
  return 'other';
}

// Build a model config entry from a venice model object.
function buildEntry(m) {
  const spec = m.model_spec;
  const caps = spec.capabilities;
  const p = spec.pricing;
  return {
    id: m.id,
    name: 'A0T ' + spec.name,
    reasoning: !!caps.supportsReasoning,
    input: caps.supportsVision ? ['text', 'image'] : ['text'],
    contextWindow: m.context_length,
    maxTokens: spec.maxCompletionTokens,
    cost: {
      input: round(p.input.usd, 6),
      output: round(p.output.usd, 6),
      cacheRead: round((p.cache_input && p.cache_input.usd) || 0, 6),
      cacheWrite: 0,
    },
  };
}

// Probe a single model against the a0t endpoint. Returns true if working.
async function probeModel(apiKey, id) {
  const body = JSON.stringify({
    model: id,
    max_completion_tokens: 4,
    messages: [{ role: 'user', content: 'hi' }],
  });
  try {
    const res = await fetch(A0T_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30000),
    });
    if (res.status !== 200) return false;
    const text = await res.text();
    return text.includes('"choices"') || text.includes('"chat.completion"');
  } catch (e) {
    return false;
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const skipProbe = process.argv.includes('--no-probe');
  const apiKey = getApiKey();

  log('Fetching venice.ai model catalog…');
  const vRes = await fetch(VENICE_URL);
  const vData = await vRes.json();
  const textModels = (vData.data || []).filter(m => m.type === 'text');
  log('Found ' + textModels.length + ' text models.');

  const byId = {};
  for (const m of textModels) byId[m.id] = m;

  // Determine working set
  let workingIds;
  if (skipProbe) {
    workingIds = textModels.map(m => m.id);
    log('Skipping probe; using all ' + workingIds.length + ' text models.');
  } else {
    log('Probing each model against a0t (sequential, 30s timeout each)…');
    workingIds = [];
    let i = 0;
    for (const m of textModels) {
      i++;
      const ok = await probeModel(apiKey, m.id);
      if (ok) workingIds.push(m.id);
      process.stderr.write('\r  [' + i + '/' + textModels.length + '] ' + m.id + ' → ' + (ok ? 'OK' : 'FAIL') + '   ');
    }
    log('\n  Working: ' + workingIds.length + ' / ' + textModels.length);
  }

  // Group by family
  const groups = {};
  for (const id of workingIds) {
    const f = family(id);
    (groups[f] = groups[f] || []).push(id);
  }

  // Sort within each family: version desc, created desc, name asc
  for (const f of Object.keys(groups)) {
    groups[f].sort((a, b) => {
      const ma = byId[a], mb = byId[b];
      const va = vnum(ma.model_spec.name), vb = vnum(mb.model_spec.name);
      if (va !== vb) return vb - va;
      if (ma.created !== mb.created) return mb.created - ma.created;
      return ma.model_spec.name.localeCompare(mb.model_spec.name);
    });
  }

  // Order families by newest member's created date (desc = newest family first)
  const familyOrder = Object.keys(groups).sort((fa, fb) => {
    const ca = Math.max(...groups[fa].map(id => byId[id].created));
    const cb = Math.max(...groups[fb].map(id => byId[id].created));
    return cb - ca;
  });

  // Flatten to final order
  const order = [];
  for (const f of familyOrder) {
    for (const id of groups[f]) order.push(id);
  }

  // Build model entries
  const models = order.map(id => buildEntry(byId[id]));

  const out = {
    providers: {
      a0t: {
        baseUrl: 'https://llm.agent-zero.ai/v1',
        api: 'openai-completions',
        apiKey: '$AGENT_ZERO',
        authHeader: true,
        compat: { supportsReasoningEffort: false },
        models,
      },
    },
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2) + '\n');
  log('Wrote ' + models.length + ' models to ' + CONFIG_PATH);

  // Print family summary
  log('\nFamily order (newest first):');
  for (const f of familyOrder) {
    log('  ' + f + ': ' + groups[f].length + ' models');
  }
}

main().catch(e => { log('ERROR: ' + e.message); process.exit(1); });
