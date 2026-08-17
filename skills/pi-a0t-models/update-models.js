#!/usr/bin/env node
// update-models.js — Fetch the venice.ai text model catalog and write pi's
// models.json grouped by family (newest families first, newest version first
// within each family). Optionally live-probe each model against the a0t
// endpoint and keep only working ones.
//
// Usage:  node update-models.js [--probe] [--api-key <key>] [--save-key]
//   --probe         Live-probe each catalog model against the a0t endpoint and
//                   keep only working ones (needs an API key, ~3-5 min).
//   --api-key <key> Use this a0t API key for probing (highest precedence).
//   --save-key      Persist --api-key to ~/.pi/agent/auth.json (same format
//                   as /login), so no manual key setup is needed.
//   --no-probe      Accepted for backwards compatibility (probing is off by
//                   default).
//
// Zero-setup bootstrap: the default run needs no API key and no existing
// auth.json or models.json — it just writes the full venice text catalog as
// a0t models, ready for pi to use once a key is configured.
//
// Key resolution order (--probe only): --api-key flag, ~/.pi/agent/auth.json,
// then the AGENT_ZERO / A0T_API_KEY environment variables. If --probe is
// requested but no key is found, a bootstrap a0t provider with an empty model
// list is written to models.json (so that /login a0t works) and the script
// exits with next-step instructions.
//
// Replaces the a0t provider in ~/.pi/agent/models.json; all other
// providers and top-level keys are preserved. On its first write it backs
// up an existing models.json to models.json.bak (never overwritten).

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

function parseArgs(argv) {
  const args = { probe: false, apiKey: undefined, saveKey: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--probe') args.probe = true;
    else if (a === '--no-probe') { /* default behavior; accepted for backwards compatibility */ }
    else if (a === '--save-key') args.saveKey = true;
    else if (a === '--api-key') {
      const v = argv[++i];
      if (!v) throw new Error('--api-key requires a value');
      args.apiKey = v;
    } else {
      throw new Error('Unknown argument: ' + a);
    }
  }
  if (args.saveKey && !args.apiKey) throw new Error('--save-key requires --api-key');
  return args;
}

// Returns the key or null if none is configured anywhere.
function getApiKey(flagKey) {
  if (flagKey) return flagKey;
  try {
    const auth = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    if (auth.a0t && auth.a0t.key) return auth.a0t.key;
  } catch (e) { /* fall through */ }
  return process.env.AGENT_ZERO || process.env.A0T_API_KEY || null;
}

// Persist the key to auth.json in pi's own /login format, preserving all
// other provider entries. Aborts on an unparseable file.
function saveApiKey(key) {
  let auth = {};
  if (fs.existsSync(AUTH_PATH)) {
    const raw = fs.readFileSync(AUTH_PATH, 'utf8').trim();
    if (raw) {
      try {
        auth = JSON.parse(raw);
      } catch (e) {
        throw new Error('Cannot parse ' + AUTH_PATH + ' (' + e.message + '). Fix or remove it and retry.');
      }
      if (typeof auth !== 'object' || auth === null || Array.isArray(auth)) {
        throw new Error(AUTH_PATH + ' is not a JSON object. Fix or remove it and retry.');
      }
    }
  }
  auth.a0t = { type: 'api_key', key };
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 });
}

// The a0t provider entry written to models.json.
function a0tProviderEntry(models) {
  return {
    baseUrl: 'https://llm.agent-zero.ai/v1',
    api: 'openai-completions',
    apiKey: '$AGENT_ZERO',
    authHeader: true,
    compat: { supportsReasoningEffort: false },
    models,
  };
}

// Read models.json for merging. Aborts on an unparseable file rather than
// clobbering it. Returns {} when the file is missing or empty.
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
  if (!raw) return {};
  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error('Cannot parse ' + CONFIG_PATH + ' (' + e.message + '). Fix or remove it and retry.');
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(CONFIG_PATH + ' is not a JSON object. Fix or remove it and retry.');
  }
  return config;
}

// Back up an existing models.json to models.json.bak before the first
// write. Never overwrites an existing backup.
function backupConfig() {
  const bak = CONFIG_PATH + '.bak';
  if (!fs.existsSync(CONFIG_PATH) || fs.existsSync(bak)) return;
  fs.copyFileSync(CONFIG_PATH, bak);
  log('Backed up existing config to ' + bak);
}

// Write a bootstrap a0t provider with an empty model list so that pi's
// /login a0t becomes available. Never touches an existing a0t entry.
function writeBootstrapProvider() {
  const config = readConfig();
  if (typeof config.providers !== 'object' || config.providers === null) config.providers = {};
  if (config.providers.a0t) return false;
  config.providers.a0t = a0tProviderEntry([]);
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  backupConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  return true;
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
  const args = parseArgs(process.argv.slice(2));
  const apiKey = getApiKey(args.apiKey);

  if (args.saveKey) {
    saveApiKey(args.apiKey);
    log('Saved a0t API key to ' + AUTH_PATH + ' (same format as /login).');
  }

  if (args.probe && !apiKey) {
    log('Probing needs an a0t API key (checked --api-key, ' + AUTH_PATH + ', AGENT_ZERO / A0T_API_KEY).');
    if (writeBootstrapProvider()) {
      log('Wrote a bootstrap a0t provider (no models yet) to ' + CONFIG_PATH + '.');
    }
    log('\nNext step — pick one:');
    log('  1. Start pi and run  /login a0t  to paste your key, then re-run with --probe.');
    log('  2. Pass the key directly:  node update-models.js --probe --api-key <key> [--save-key]');
    log('  3. Skip probing (default, no key needed):  node update-models.js');
    return;
  }

  log('Fetching venice.ai model catalog…');
  const vRes = await fetch(VENICE_URL);
  const vData = await vRes.json();
  const textModels = (vData.data || []).filter(m => m.type === 'text');
  log('Found ' + textModels.length + ' text models.');

  const byId = {};
  for (const m of textModels) byId[m.id] = m;

  // Determine working set
  let workingIds;
  if (!args.probe) {
    workingIds = textModels.map(m => m.id);
    log('Probe off (default; pass --probe to live-test each model). Using all ' + workingIds.length + ' text models.');
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

  // Merge into the existing models.json: replace only the a0t provider
  // entry, leave all other providers and top-level keys untouched.
  const config = readConfig();
  if (typeof config.providers !== 'object' || config.providers === null) config.providers = {};

  const preserved = Object.keys(config.providers).filter(k => k !== 'a0t').length;

  // Assigning to an existing key keeps its position; a new key is appended.
  config.providers.a0t = a0tProviderEntry(models);

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  backupConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  log('Wrote ' + models.length + ' a0t models to ' + CONFIG_PATH +
    (preserved ? ' (preserved ' + preserved + ' other provider' + (preserved > 1 ? 's' : '') + ')' : ''));

  // Print family summary
  log('\nFamily order (newest first):');
  for (const f of familyOrder) {
    log('  ' + f + ': ' + groups[f].length + ' models');
  }
}

main().catch(e => { log('ERROR: ' + e.message); process.exit(1); });
