const { decrypt, encrypt } = require('./cryptoService');

// Lazily-required SDKs so the server starts even without all packages installed.
const getSdk = (() => {
  const cache = {};
  return (name) => {
    if (!cache[name]) cache[name] = require(name);
    return cache[name];
  };
})();

const LLM_DEFAULTS = {
  provider: 'anthropic',
  anthropic: { model: 'claude-opus-4-8' },
  openai: { model: 'gpt-4o', baseUrl: '' },
  gemini: { model: 'gemini-2.0-flash' },
  ollama: { model: 'llama3.2', baseUrl: 'http://localhost:11434' },
};

async function getRawLlmSetting() {
  // Lazy-require to avoid circular dependency at module load time
  const { Setting } = require('../models');
  const row = await Setting.findByPk('llm');
  if (!row || !row.value) return {};
  return typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
}

async function getLlmConfig() {
  const stored = await getRawLlmSetting();
  const cfg = { ...LLM_DEFAULTS, ...stored };
  // Deep-merge per-provider defaults
  for (const p of ['anthropic', 'openai', 'gemini', 'ollama']) {
    cfg[p] = { ...LLM_DEFAULTS[p], ...(stored[p] || {}) };
  }
  return cfg;
}

async function saveLlmConfig(patch) {
  const { Setting } = require('../models');
  const current = await getRawLlmSetting();
  const next = { ...LLM_DEFAULTS, ...current, ...patch };

  const providers = ['anthropic', 'openai', 'gemini', 'ollama'];
  for (const p of providers) {
    const patchProvider = patch[p];
    if (!patchProvider) continue;
    const currentProvider = current[p] || {};
    if (patchProvider.apiKey) {
      next[p] = { ...currentProvider, ...patchProvider, apiKeyEnc: encrypt(patchProvider.apiKey) };
      delete next[p].apiKey;
    } else {
      next[p] = { ...currentProvider, ...patchProvider };
    }
  }

  const cleanValue = JSON.parse(JSON.stringify(next));
  const [row, created] = await Setting.findOrCreate({ where: { key: 'llm' }, defaults: { value: cleanValue } });
  if (!created) {
    row.value = cleanValue;
    row.changed('value', true);
    await row.save();
  }
  return next;
}

// Returns the config safe for the frontend (API keys masked)
async function getLlmConfigPublic() {
  const cfg = await getLlmConfig();
  const safe = { provider: cfg.provider };
  for (const p of ['anthropic', 'openai', 'gemini', 'ollama']) {
    const pc = cfg[p] || {};
    safe[p] = { model: pc.model };
    if (p === 'openai') safe[p].baseUrl = pc.baseUrl || '';
    if (p === 'ollama') safe[p].baseUrl = pc.baseUrl || LLM_DEFAULTS.ollama.baseUrl;
    safe[p].hasApiKey = !!(pc.apiKeyEnc || pc.apiKey);
  }
  return safe;
}

function getApiKey(providerConfig) {
  if (!providerConfig) return null;
  if (providerConfig.apiKeyEnc) return decrypt(providerConfig.apiKeyEnc);
  return providerConfig.apiKey || null;
}

async function callLlm({ systemPrompt, userPrompt }) {
  const config = await getLlmConfig();
  const provider = config.provider || 'anthropic';
  const providerCfg = config[provider] || {};

  if (provider === 'anthropic') {
    const apiKey = getApiKey(providerCfg);
    if (!apiKey) throw new Error('Anthropic API key not configured');
    const Anthropic = getSdk('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const model = providerCfg.model || LLM_DEFAULTS.anthropic.model;
    const message = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    return { text: message.content[0].text, provider: 'anthropic', model };
  }

  if (provider === 'openai') {
    const apiKey = getApiKey(providerCfg);
    if (!apiKey) throw new Error('OpenAI API key not configured');
    const { OpenAI } = getSdk('openai');
    const opts = { apiKey };
    if (providerCfg.baseUrl) opts.baseURL = providerCfg.baseUrl;
    const client = new OpenAI(opts);
    const model = providerCfg.model || LLM_DEFAULTS.openai.model;
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
    });
    return { text: completion.choices[0].message.content, provider: 'openai', model };
  }

  if (provider === 'gemini') {
    const apiKey = getApiKey(providerCfg);
    if (!apiKey) throw new Error('Google Gemini API key not configured');
    const { GoogleGenerativeAI } = getSdk('@google/generative-ai');
    const client = new GoogleGenerativeAI(apiKey);
    const model = providerCfg.model || LLM_DEFAULTS.gemini.model;
    const genModel = client.getGenerativeModel({ model });
    const result = await genModel.generateContent(`${systemPrompt}\n\n${userPrompt}`);
    return { text: result.response.text(), provider: 'gemini', model };
  }

  if (provider === 'ollama') {
    const { OpenAI } = getSdk('openai');
    const baseUrl = providerCfg.baseUrl || LLM_DEFAULTS.ollama.baseUrl;
    const client = new OpenAI({ apiKey: 'ollama', baseURL: `${baseUrl}/v1` });
    const model = providerCfg.model || LLM_DEFAULTS.ollama.model;
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return { text: completion.choices[0].message.content, provider: 'ollama', model };
  }

  throw new Error(`Unknown LLM provider: ${provider}`);
}

async function testConnection() {
  const result = await callLlm({
    systemPrompt: 'You are a helpful assistant.',
    userPrompt: 'Respond with exactly one word: OK',
  });
  return result;
}

module.exports = { getLlmConfig, getLlmConfigPublic, saveLlmConfig, callLlm, testConnection, LLM_DEFAULTS };
