const localStorage = (() => {
  try {
    const s = window.localStorage;
    const probeKey = '__prism_storage_probe__';
    s.setItem(probeKey, '1');
    s.removeItem(probeKey);
    return s;
  } catch (_err) {
    const mem = new Map();
    return {
      getItem(key) {
        return mem.has(String(key)) ? mem.get(String(key)) : null;
      },
      setItem(key, value) {
        mem.set(String(key), String(value));
      },
      removeItem(key) {
        mem.delete(String(key));
      },
      clear() {
        mem.clear();
      },
      key(index) {
        const keys = Array.from(mem.keys());
        return keys[index] ?? null;
      },
      get length() {
        return mem.size;
      }
    };
  }
})();

const app = {
  state: {
    apiKey: localStorage.getItem('or_api_key') || '',
    chats: JSON.parse(localStorage.getItem('or_chats') || '[]'),
    currentChatId: null,
    selectedModel: localStorage.getItem('or_selected_model') || '',
    offlineModel: localStorage.getItem('or_offline_model') || '',
    gradingModel: localStorage.getItem('or_grading_model') || 'openai/gpt-4o-mini',
    mode: localStorage.getItem('or_mode') || 'single',
    transparency: localStorage.getItem('or_transparency') !== 'false',
    models: [],
    multiModels: JSON.parse(localStorage.getItem('or_multi_models') || '[]'),
    multiModelRetries: JSON.parse(localStorage.getItem('or_multi_model_retries') || '{}'),
    multiExhaustOnFailure: localStorage.getItem('or_multi_exhaust_on_failure') !== 'false',
    showGraderTable: localStorage.getItem('or_show_grader_table') !== 'false',
    singleModelRetry: localStorage.getItem('or_single_model_retry') === 'true',
    gradingModelRetry: localStorage.getItem('or_grading_model_retry') === 'true',
    weights: {
      helpfulness: Number(localStorage.getItem('or_weight_helpfulness') || 5),
      accuracy: Number(localStorage.getItem('or_weight_accuracy') || 5),
      clarity: Number(localStorage.getItem('or_weight_clarity') || 5),
      speed: Number(localStorage.getItem('or_weight_speed') || 5),
      earlyStopCount: Number(localStorage.getItem('or_early_stop_count') || 2)
    },
    totalInputTokens: Number(localStorage.getItem('or_total_in') || 0),
    totalOutputTokens: Number(localStorage.getItem('or_total_out') || 0),
    multiCutoffSec: Number(localStorage.getItem('or_multi_cutoff_sec') || (Number(localStorage.getItem('or_multi_cutoff_ms') || 5000) / 1000)),
    isGenerating: false,
    runId: 0,
    abortedRuns: {},
    rearrangeMode: false,
    draggingModelId: null,
    // Offline / debug additions
    offline: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
    connectionStatus: (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'connected',
    modelSwitching: false,
    localServerOnline: false,
    quizGenerating: false,
    awaitingQuizFollowup: false,
    debugConsoleVisible: localStorage.getItem('or_debug_console_visible') !== 'false',
    theme: localStorage.getItem('or_theme') === 'light' ? 'light' : 'dark'
    ,goalPrompt: localStorage.getItem('or_goal_prompt') || ''
    ,subagentEnabled: localStorage.getItem('or_subagent_enabled') !== 'false'
    ,subagentLikelihood: Number(localStorage.getItem('or_subagent_likelihood') || 50)
    ,user: null
    ,authBootHandled: false
    ,pendingUploads: []
    ,voiceSupported: false
    ,isListening: false
    ,voiceRecognition: null
    ,voiceTranscriptFinal: ''
    ,voiceSessionBaseText: ''
    ,voiceTranscriptInterim: ''
    ,voiceTranscriptCumulative: ''
  },

  TOOL_PROMPT: "IMPORTANT FORMATTING RULES: Use <code>...</code> ONLY for real code snippets, shell commands, config blocks, JSON, or exact tool/API payloads that users may copy/run. Use <copytext>...</copytext> for non-code text the user should copy (emails, templates, prompts, messages, etc.). Do NOT wrap normal prose, summaries, or plain lists in <code> or <copytext>. Keep explanations outside these tags.",
  SUBAGENT_PROMPT: "You may delegate a focused subtask by emitting a tag exactly like: <subagent model=\"MODEL_ID\">TASK_TEXT</subagent>. Only use models from the user's configured Multi-AI model list. If model is omitted, the app will pick the first configured Multi-AI model. CRITICAL: when delegating, do NOT also complete those delegated deliverables yourself in the same response. Let subagents produce the actual deliverable content.",

  getSubagentPrompt() {
    const p = Math.max(0, Math.min(100, Number(this.state.subagentLikelihood) || 0));
    let policy = '';
    if (p <= 33) {
      policy = 'LAW: You may delegate only when you deem the task worthy; still aim to delegate about 50% of suitable prompts.';
    } else if (p <= 66) {
      policy = 'LAW: Be very likely to delegate; for most suitable prompts, you should emit at least one subagent task.';
    } else {
      policy = 'LAW (MANDATORY): You MUST use subagents for every user request in this mode. This is not optional. You MUST split the request into multiple smaller focused subagent tasks (not one big task), and each subagent task must cover only a narrow piece of the work. Do NOT delegate the entire request to a single subagent. For multi-part requests, emit 2+ subagent tasks (and typically 3+ when the user asks for multiple outputs/files). Always emit valid <subagent ...>...</subagent> tags. After emitting subagent tasks, do NOT produce the full deliverable content yourself; subagents must generate it.';
    }
    return `${this.SUBAGENT_PROMPT}\nSubagent likelihood setting: ${p}% (3-zone law mode). ${policy}`;
  },

  // ── Storage compression helpers ──────────────────────────────────────────
  // Compresses a string using a simple run-length + short-key encoding.
  // Reduces localStorage usage by ~40-60% on average.
  _compress(str) {
    if (!str) return str;
    try {
      // Step 1: Shorten common JSON keys
      const keyMap = {
        '"selectedModel"': '"m"', '"gradingModel"': '"g"', '"multiModels"': '"mm"',
        '"multiModelRetries"': '"mr"', '"singleModelRetry"': '"sr"', '"gradingModelRetry"': '"gr"',
        '"multiCutoffSec"': '"cs"', '"totalInputTokens"': '"ti"', '"totalOutputTokens"': '"to"',
        '"currentChatId"': '"ci"', '"createdAt"': '"ca"', '"messages"': '"ms"',
        '"content"': '"c"', '"role"': '"r"', '"model"': '"md"', '"title"': '"t"',
        '"selectedIndex"': '"si"', '"variants"': '"v"', '"htmlTable"': '"ht"',
        '"token_usage"': '"tu"', '"latencyMs"': '"lm"'
      };
      let s = str;
      for (const [long, short] of Object.entries(keyMap)) {
        s = s.split(long).join(short);
      }
      // Step 2: Lighter indent
      s = s.replace(/\n\s+/g, ' ');
      s = s.replace(/, /g, ',');
      return s;
    } catch (_) { return str; }
  },

  _decompress(str) {
    if (!str) return str;
    try {
      const reverseMap = {
        '"m"': '"selectedModel"', '"g"': '"gradingModel"', '"mm"': '"multiModels"',
        '"mr"': '"multiModelRetries"', '"sr"': '"singleModelRetry"', '"gr"': '"gradingModelRetry"',
        '"cs"': '"multiCutoffSec"', '"ti"': '"totalInputTokens"', '"to"': '"totalOutputTokens"',
        '"ci"': '"currentChatId"', '"ca"': '"createdAt"', '"ms"': '"messages"',
        '"c"': '"content"', '"r"': '"role"', '"md"': '"model"', '"t"': '"title"',
        '"si"': '"selectedIndex"', '"v"': '"variants"', '"ht"': '"htmlTable"',
        '"tu"': '"token_usage"', '"lm"': '"latencyMs"'
      };
      let s = str;
      for (const [short, long] of Object.entries(reverseMap)) {
        s = s.split(short).join(long);
      }
      return s;
    } catch (_) { return str; }
  },

  debugLog(message) {
    try {
      const ts = new Date().toLocaleTimeString();
      const line = `[${ts}] ${String(message || '')}`;
      console.log('[AiChatCLide]', line);
      const el = document.getElementById('debugConsole');
      if (!el || !this.state.debugConsoleVisible) return;
      const row = document.createElement('div');
      row.className = 'debug-line';
      row.textContent = line;
      el.appendChild(row);
      while (el.children.length > 200) el.removeChild(el.firstChild);
      el.scrollTop = el.scrollHeight;
    } catch (_) {}
  },

  init() {
    this.debugLog('init() start');
    this.sanitizeAndRepairStorage();
    try {
      const raw = localStorage.getItem('or_chats_compressed');
      if (raw) {
        this.state.chats = JSON.parse(this._decompress(raw));
        this.debugLog(`init: loaded ${this.state.chats.length} compressed chats`);
      } else {
        this.state.chats = JSON.parse(localStorage.getItem('or_chats') || '[]');
        this.debugLog(`init: loaded ${this.state.chats.length} chats (uncompressed)`);
      }
    } catch (_) {
      this.state.chats = JSON.parse(localStorage.getItem('or_chats') || '[]');
    }
    this.bindEvents();
    this.loadSettings();
    this.ensureActiveChat();
    this.renderChatList();
    this.renderMessages();
    this.updateTokenStats();
    this.updateStorageUsage();
    this.updateTransparencyBadge();
    this.updateOfflineBadge();
    this.updateApiSourceBadge();
    this.updateModeButtons();
    this.updateDebugConsoleVisibility();
    this.renderPendingUploads();
    this.setupVoiceInput();
    this.applySettingTooltips();
    this.startOfflineHealthMonitor();
    this.refreshOfflineModelChoices().then(() => {
      if (this.state.offline && !this.state.offlineModel) {
        const modal = document.getElementById('offlineModelModal');
        if (modal) modal.style.display = 'flex';
      }
    });
    if (!this.state.apiKey) document.getElementById('apiModal').style.display = 'flex';
    else this.fetchAndCacheModels();
    this.debugLog('init() complete');
  },

  sanitizeAndRepairStorage() {
    this.debugLog('sanitizeAndRepairStorage()');
    try {
      const raw = JSON.parse(localStorage.getItem('or_chats') || '[]');
      if (Array.isArray(raw)) {
        const fixed = raw.filter(c => c && typeof c === 'object' && Array.isArray(c.messages));
        localStorage.setItem('or_chats', JSON.stringify(fixed));
        this.debugLog(`sanitizeAndRepairStorage: ${fixed.length} chats`);
      }
    } catch (_) {
      localStorage.setItem('or_chats', '[]');
    }
    const safeKeys = {
      or_mode: ['single', 'multi'],
      or_transparency: ['true', 'false'],
      or_single_model_retry: ['true', 'false'],
      or_grading_model_retry: ['true', 'false']
    };
    Object.entries(safeKeys).forEach(([k, allowed]) => {
      const v = localStorage.getItem(k);
      if (v == null) return;
      if (!allowed.includes(v)) localStorage.removeItem(k);
    });
    this.debugLog('sanitizeAndRepairStorage() complete');
  },

  applySettingTooltips() {
    const tips = {
      settingsApiKey: 'Your OpenRouter API key, stored locally in this browser.',
      singleModelSearch: 'Primary model used in Single mode conversations.',
      gradingModel: 'Judge model that grades candidate answers in Multi mode.',
      gradingPrompt: 'Custom grading instructions used by the grading model.',
      multiModelSearch: 'Search and add candidate models used in Multi mode.',
      weightHelpfulness: 'Weight of helpfulness in final multi-model score.',
      weightAccuracy: 'Weight of factual accuracy in final multi-model score.',
      weightClarity: 'Weight of clarity/readability in final multi-model score.',
      weightSpeed: 'Weight of response speed (lower latency scores better).',
      earlyStopCount: 'No longer used for stopping; kept for backward compatibility.',
      temperature: 'Creativity/randomness of responses. Lower is more deterministic.',
      maxTokens: 'Maximum response length allowed from each model.',
      transparencyMode: 'Show live model-by-model generation and detailed grading views.'
    };
    Object.entries(tips).forEach(([id, tip]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.title = tip;
      const group = el.closest('.setting-group');
      const label = group?.querySelector('label');
      if (label && !label.title) label.title = tip;
    });
  },

  updateMultiExhaustHint() {
    const hint = document.getElementById('multiExhaustModeHint');
    if (!hint) return;
    if (this.state.multiExhaustOnFailure) {
      hint.textContent = 'Failed models are replaced by remaining models until your whole list is tried.';
    } else {
      hint.textContent = 'Only the first 10 selected models are used.';
    }
  },

  normalizeAssistantContent(content) {
    let text = String(content || '');
    text = text.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, (_m, code) => `<code>${code}</code>`);
    return text;
  },

  isErrorLikeResponse(content) {
    const t = String(content || '').trim().toLowerCase();
    if (!t) return true;
    return (
      t.startsWith('error:') ||
      t.startsWith('error from ') ||
      t.startsWith('exception:') ||
      t.startsWith('failed:') ||
      t.includes('api error') ||
      t.includes('server error') ||
      t.includes('internal error') ||
      t.includes('rate limit') ||
      t.includes('timed out') ||
      t.includes('timeout') ||
      t.includes('failed to') ||
      t.includes('could not') ||
      t.includes('unable to') ||
      t.includes('unauthorized') ||
      t.includes('forbidden') ||
      t.includes('invalid api key') ||
      t.includes('no content returned')
    );
  },

  parseRetryDelayMs(content) {
    const text = String(content || '').toLowerCase();
    if (!text.includes('retry')) return null;
    const m = text.match(/(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?)/i);
    if (!m) return 1500;
    const n = Number(m[1]);
    const unit = (m[2] || '').toLowerCase();
    if (!Number.isFinite(n) || n <= 0) return 1500;
    if (unit.startsWith('ms')) return Math.round(n);
    if (unit.startsWith('m')) return Math.round(n * 60000);
    return Math.round(n * 1000);
  },

  isUsableFinalVariant(response) {
    if (!response) return false;
    const content = String(response.content || '').trim();
    if (!content) return false;
    if (this.isErrorLikeResponse(content)) return false;
    return true;
  },

  firstWordIsError(text) {
    const first = String(text || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
    return first === 'error' || first === 'error:';
  },

  parseSubagentTags(content) {
    const tags = [];
    const re = /<subagent(?:\s+model="([^"]*)")?\s*>([\s\S]*?)<\/subagent\s*[>}]/gi;
    let m;
    while ((m = re.exec(String(content || ''))) !== null) {
      const model = String(m[1] || '').trim();
      const task = String(m[2] || '').trim();
      if (!task) continue;
      tags.push({ model, task, fullTag: m[0] });
    }

    // Support longcat-style tool call payloads
    const txt = String(content || '');
    const lcBlockRe = /<longcat_tool_call>\s*subagent[\s\S]*?<\/longcat_tool_call>/gi;
    let lb;
    while ((lb = lcBlockRe.exec(txt)) !== null) {
      const block = String(lb[0] || '');
      const pairRe = /<longcat_arg_key>\s*([^<]+?)\s*<\/longcat_arg_key>\s*<longcat_arg_value>([\s\S]*?)<\/longcat_arg_value>/gi;
      let pm;
      let model = '';
      let task = '';
      while ((pm = pairRe.exec(block)) !== null) {
        const key = String(pm[1] || '').trim().toLowerCase();
        const val = String(pm[2] || '').trim();
        if (!val) continue;
        if (key === 'model') model = val;
        if (key === 'text' || key === 'description' || key === 'task' || key === 'prompt') task = val;
      }
      if (task) tags.push({ model, task, fullTag: block });
    }

    // Support compact variant: <longcat_tool_call>subagent model="..."> ... </subagent>
    const lcCompactRe = /<longcat_tool_call>\s*subagent(?:\s+model="([^"]*)")?\s*>?([\s\S]*?)<\/subagent\s*[>}]/gi;
    let lc;
    while ((lc = lcCompactRe.exec(txt)) !== null) {
      const model = String(lc[1] || '').trim();
      const task = String(lc[2] || '').trim();
      if (!task) continue;
      tags.push({ model, task, fullTag: lc[0] });
    }

    return tags;
  },

  stripSubagentTags(content) {
    return String(content || '')
      .replace(/<subagent(?:\s+model="[^"]*")?\s*>[\s\S]*?<\/subagent\s*[>}]/gi, '')
      .replace(/<longcat_tool_call>[\s\S]*?<\/longcat_tool_call>/gi, '')
      .replace(/<longcat_arg_key>[\s\S]*?<\/longcat_arg_key>/gi, '')
      .replace(/<longcat_arg_value>[\s\S]*?<\/longcat_arg_value>/gi, '')
      .trim();
  },

  resolveSubagentModel(modelId) {
    const pool = Array.isArray(this.state.multiModels) ? this.state.multiModels.filter(Boolean) : [];
    if (!pool.length) return this.state.selectedModel || null;
    if (!modelId) return pool[0];
    if (pool.includes(modelId)) return modelId;
    const lower = String(modelId).toLowerCase();
    return pool.find((m) => String(m).toLowerCase() === lower) || pool[0];
  },

  async runSubagentTask(model, task) {
    const t0 = performance.now();
    this.debugLog(`[Subagent] starting model=${model}`);
    try {
      const out = await chatCompletion(
        model,
        [
          { role: 'system', content: 'You are a focused subagent. Complete only the assigned task and return your result clearly.' },
          { role: 'user', content: task }
        ],
        { temperature: 0.3, max_tokens: Math.min(2048, this.getMaxTokens()), retries: this.state.singleModelRetry ? 3 : 1 }
      );
      const text = out?.choices?.[0]?.message?.content || '';
      this.state.totalInputTokens += out?.usage?.prompt_tokens || 0;
      this.state.totalOutputTokens += out?.usage?.completion_tokens || 0;
      this.updateTokenStats();
      this.debugLog(`[Subagent] done model=${model} in ${Math.round(performance.now() - t0)}ms`);
      return { model, text, error: null };
    } catch (e) {
      this.debugLog(`[Subagent] failed model=${model}: ${e?.message || e}`);
      return { model, text: '', error: e?.message || String(e) };
    }
  },

  async handleSubagentRequests(rawContent, chat, runId) {
    if (this.state.abortedRuns[runId]) return;
    if (this.state.abortedRuns['subagents:' + runId]) return;
    const tags = this.parseSubagentTags(rawContent);
    const shouldForceSubagents = !!this.state.subagentEnabled && Number(this.state.subagentLikelihood || 0) > 66;
    const latestUserPrompt = [...(chat?.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';

    const inferredTags = (() => {
      if (!shouldForceSubagents || tags.length) return [];
      const txt = String(latestUserPrompt || '').toLowerCase();
      const asksSnakeFiles = txt.includes('snake') && txt.includes('file') && (txt.includes('html') || txt.includes('index.html')) && txt.includes('css') && txt.includes('js');
      if (asksSnakeFiles) {
        return [
          { model: '', task: 'Create index.html for a browser Snake game. Include canvas, score UI, and script/style links. Return only file content.', fullTag: '' },
          { model: '', task: 'Create style.css for the Snake game UI. Include layout, game board styling, score styling, and game-over visual state. Return only file content.', fullTag: '' },
          { model: '', task: 'Create script.js for a working Snake game (movement, collision, food, score, restart). Return only file content.', fullTag: '' }
        ];
      }
      return [
        { model: '', task: `Complete this user request as a focused subtask output:\n\n${latestUserPrompt}`.trim(), fullTag: '' }
      ];
    })();

    const effectiveTags = tags.length ? tags : inferredTags;
    if (!effectiveTags.length) return;

    const requests = effectiveTags
      .map((t) => ({ model: this.resolveSubagentModel(t.model), task: t.task }))
      .filter((x) => !!x.model && !!x.task);

    if (!requests.length) {
      chat.messages.push({ role: 'assistant', model: 'Subagent', content: 'Subagent requested, but no valid Multi-AI models are configured.' });
      this.persistChats();
      this.renderMessages();
      return;
    }

    const buildSubagentBadgeHtml = (items) => {
      const safe = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const thinkingDots = '<span class="thinking-dots" aria-label="thinking"><span></span><span></span><span></span></span>';
      const cards = items.map((it, i) => {
        const cls = it.status === 'completed' ? 'done' : it.status === 'failed' ? 'failed' : 'running';
        const label = `Subagent ${i + 1}`;
        const stateText = it.status === 'completed' ? 'completed' : it.status === 'failed' ? 'failed' : 'running';
        const showThinking = it.status === 'running';
        const detail = it.status === 'failed' && it.error ? ` — ${safe(it.error)}` : '';
        return `<div class="subagent-status-card ${cls}"><div class="subagent-status-model">${label} • ${safe(it.model)}</div><div class="subagent-status-state">${stateText}${showThinking ? ` ${thinkingDots}` : ''}${detail}</div></div>`;
      }).join('');
      return `<div class="subagent-status-wrap">${cards}</div>`;
    };

    const status = requests.map((r) => ({ model: r.model, status: 'running', error: '' }));
    const badgeMsg = { role: 'assistant', model: 'Subagent Status', htmlTable: true, content: buildSubagentBadgeHtml(status) };
    chat.messages.push(badgeMsg);
    this.persistChats();
    this.renderMessages();

    this.debugLog(`[Subagent] spawning ${requests.length} task(s) in parallel`);

    const results = await Promise.all(requests.map(async (r, idx) => {
      const out = await this.runSubagentTask(r.model, r.task);
      if (out.error) {
        status[idx].status = 'failed';
        status[idx].error = out.error;
      } else {
        status[idx].status = 'completed';
      }
      badgeMsg.content = buildSubagentBadgeHtml(status);
      this.persistChats();
      this.renderMessages();
      return out;
    }));
    if (this.state.abortedRuns[runId]) return;

    const subagentVariants = results.map((r) => ({
      model: r.model,
      content: r.error ? `Error: ${r.error}` : (r.text || '(No content returned)')
    }));
    chat.messages.push({
      role: 'assistant',
      model: 'Subagent Versions',
      variants: subagentVariants,
      selectedIndex: 0
    });
    this.persistChats();
    this.renderMessages();
  },

  bindEvents() {
    window.addEventListener('online', () => {
      this.debugLog('bindEvents: online event');
      this.state.offline = false;
      this.handleBackOnline();
    });
    window.addEventListener('offline', () => {
      this.debugLog('bindEvents: offline event');
      this.state.offline = true;
      this.state.connectionStatus = 'offline';
      this.updateOfflineBadge();
      this.updateComposerAvailability();
    });
    window.addEventListener('beforeunload', () => {
      this.shutdownOfflineServerIfRunning();
    });

    const bindSearch = (id, type) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => this.renderModelDropdown(type, el.value));
      el.addEventListener('focus', () => this.renderModelDropdown(type, el.value));
    };
    bindSearch('singleModelSearch', 'single');
    bindSearch('gradingModel', 'grading');
    bindSearch('multiModelSearch', 'multi');

    const singleRetry = document.getElementById('singleModelRetry');
    if (singleRetry) singleRetry.addEventListener('change', () => {
      this.state.singleModelRetry = !!singleRetry.checked;
      localStorage.setItem('or_single_model_retry', String(this.state.singleModelRetry));
    });

    const gradingRetry = document.getElementById('gradingModelRetry');
    if (gradingRetry) gradingRetry.addEventListener('change', () => {
      this.state.gradingModelRetry = !!gradingRetry.checked;
      localStorage.setItem('or_grading_model_retry', String(this.state.gradingModelRetry));
    });

    const showGraderTable = document.getElementById('showGraderTable');
    if (showGraderTable) showGraderTable.addEventListener('change', () => {
      this.state.showGraderTable = !!showGraderTable.checked;
      localStorage.setItem('or_show_grader_table', String(this.state.showGraderTable));
    });

    const offlineModelSetting = document.getElementById('offlineModelSetting');
    if (offlineModelSetting) offlineModelSetting.addEventListener('change', () => {
      this.debugLog(`offlineModelSetting change: ${offlineModelSetting.value}`);
      this.state.offlineModel = offlineModelSetting.value || '';
      localStorage.setItem('or_offline_model', this.state.offlineModel);
      if (this.state.offlineModel) {
        this.switchOfflineModelOnServer(this.state.offlineModel);
        if (this.state.offline) this.setModelUsed(this.state.offlineModel);
      }
    });

    ['weightHelpfulness', 'weightAccuracy', 'weightClarity', 'weightSpeed', 'earlyStopCount', 'temperature', 'maxTokens', 'multiCutoffSec', 'subagentLikelihood'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => this.updateWeightLabels());
      el.addEventListener('change', () => this.saveWeights());
    });

    const tr = document.getElementById('transparencyMode');
    if (tr) tr.addEventListener('change', () => {
      this.state.transparency = tr.checked;
      localStorage.setItem('or_transparency', String(this.state.transparency));
      this.updateTransparencyBadge();
    });

    const dbg = document.getElementById('debugConsoleToggle');
    if (dbg) dbg.addEventListener('change', () => {
      this.state.debugConsoleVisible = !!dbg.checked;
      localStorage.setItem('or_debug_console_visible', String(this.state.debugConsoleVisible));
      this.updateDebugConsoleVisibility();
      this.debugLog(`Debug console ${this.state.debugConsoleVisible ? 'enabled' : 'disabled'}`);
    });

    const subagentToggle = document.getElementById('subagentToggle');
    if (subagentToggle) subagentToggle.addEventListener('change', () => {
      this.state.subagentEnabled = !!subagentToggle.checked;
      localStorage.setItem('or_subagent_enabled', String(this.state.subagentEnabled));
      this.debugLog(`Subagent mode ${this.state.subagentEnabled ? 'enabled' : 'disabled'}`);
    });

    const subagentLikelihood = document.getElementById('subagentLikelihood');
    if (subagentLikelihood) subagentLikelihood.addEventListener('change', () => {
      this.state.subagentLikelihood = Math.max(0, Math.min(100, Number(subagentLikelihood.value) || 0));
      localStorage.setItem('or_subagent_likelihood', String(this.state.subagentLikelihood));
    });

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) themeToggle.addEventListener('change', () => {
      this.state.theme = themeToggle.checked ? 'light' : 'dark';
      localStorage.setItem('or_theme', this.state.theme);
      this.applyTheme();
    });

    const exhaust = document.getElementById('multiExhaustOnFailure');
    if (exhaust) exhaust.addEventListener('change', () => {
      this.state.multiExhaustOnFailure = !!exhaust.checked;
      localStorage.setItem('or_multi_exhaust_on_failure', String(this.state.multiExhaustOnFailure));
      this.updateMultiExhaustHint();
    });

    document.addEventListener('click', (e) => {
      [['singleModelSearch', 'singleModelDropdown'], ['gradingModel', 'gradingModelDropdown'], ['multiModelSearch', 'multiModelDropdown']]
        .forEach(([input, dd]) => {
          if (!e.target.closest(`#${input}`) && !e.target.closest(`#${dd}`)) document.getElementById(dd)?.classList.remove('open');
        });
      if (!e.target.closest('.model-chip-menu-wrap')) {
        document.querySelectorAll('.model-chip-menu.open').forEach((m) => m.classList.remove('open'));
      }
    });

    const attachBtn = document.getElementById('attachBtn');
    const fileInput = document.getElementById('fileInput');
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target?.files || []);
        await this.queuePendingUploads(files);
        fileInput.value = '';
      });
    }

    const micBtn = document.getElementById('micBtn');
    if (micBtn) {
      micBtn.addEventListener('click', () => this.toggleVoiceInput());
    }
  },

  setupVoiceInput() {
    try {
      const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
      const micBtn = document.getElementById('micBtn');
      if (!SpeechRecognitionCtor || !micBtn) {
        this.state.voiceSupported = false;
        if (micBtn) {
          micBtn.style.display = 'none';
        }
        return;
      }

      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        this.state.isListening = true;
        this.state.voiceTranscriptInterim = '';
        this.updateVoiceButtonState();
        this.renderLiveVoiceTranscript();
      };

      recognition.onresult = (event) => {
        const input = document.getElementById('userInput');
        if (!input) return;

        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const res = event.results[i];
          const transcript = String(res?.[0]?.transcript || '').trim();
          if (!transcript) continue;
          if (res.isFinal) {
            this.state.voiceTranscriptFinal = `${this.state.voiceTranscriptFinal} ${transcript}`.trim();
          } else {
            interim = `${interim} ${transcript}`.trim();
          }
        }

        const base = this.state.voiceSessionBaseText || '';
        const finalText = this.state.voiceTranscriptFinal || '';
        this.state.voiceTranscriptInterim = interim;
        const composedVoice = [finalText, interim].filter(Boolean).join(' ').trim();
        input.value = [base, composedVoice].filter(Boolean).join(base && composedVoice ? ' ' : '').trim();
        this.autoResize(input);
        this.renderLiveVoiceTranscript();
      };

      recognition.onerror = (event) => {
        const err = String(event?.error || 'unknown');
        this.debugLog(`voice recognition error: ${err}`);
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          this.showToast('Microphone permission was denied.', 'warning');
        } else if (err !== 'no-speech' && err !== 'aborted') {
          this.showToast('Voice input error. Please try again.', 'warning');
        }
      };

      recognition.onend = () => {
        this.state.isListening = false;
        this.state.voiceTranscriptInterim = '';
        this.updateVoiceButtonState();
        this.renderLiveVoiceTranscript();
      };

      this.state.voiceSupported = true;
      this.state.voiceRecognition = recognition;
      this.updateVoiceButtonState();
    } catch (e) {
      this.state.voiceSupported = false;
      this.state.voiceRecognition = null;
      this.debugLog(`setupVoiceInput error: ${e?.message || e}`);
    }
  },

  updateVoiceButtonState() {
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;
    const supported = !!this.state.voiceSupported;
    micBtn.style.display = supported ? '' : 'none';
    micBtn.classList.toggle('listening', !!this.state.isListening);
    micBtn.setAttribute('aria-label', this.state.isListening ? 'Stop voice input' : 'Start voice input');
    micBtn.title = this.state.isListening ? 'Stop voice input' : 'Voice input';
  },

  toggleVoiceInput() {
    if (!this.state.voiceSupported || !this.state.voiceRecognition) {
      this.showToast('Voice input is not supported in this browser.', 'warning');
      return;
    }
    if (this.state.isListening) {
      this.stopVoiceInput();
      return;
    }
    this.startVoiceInput();
  },

  startVoiceInput() {
    try {
      const input = document.getElementById('userInput');
      this.state.voiceSessionBaseText = String(input?.value || '').trim();
      this.state.voiceTranscriptFinal = '';
      this.state.voiceTranscriptInterim = '';
      this.state.voiceTranscriptCumulative = this.state.voiceSessionBaseText;
      this.state.voiceRecognition.start();
    } catch (e) {
      this.debugLog(`startVoiceInput error: ${e?.message || e}`);
      this.showToast('Could not start voice input.', 'warning');
    }
  },

  stopVoiceInput() {
    try {
      if (this.state.voiceRecognition && this.state.isListening) {
        this.state.voiceRecognition.stop();
      }
    } catch (e) {
      this.debugLog(`stopVoiceInput error: ${e?.message || e}`);
    }
  },

  renderLiveVoiceTranscript() {
    const el = document.getElementById('voiceLive');
    if (!el) return;
    const finalText = String(this.state.voiceTranscriptFinal || '').trim();
    const interimText = String(this.state.voiceTranscriptInterim || '').trim();
    const base = String(this.state.voiceSessionBaseText || '').trim();
    const heard = [base, finalText, interimText].filter(Boolean).join(' ').trim();
    this.state.voiceTranscriptCumulative = heard;
    el.style.display = 'none';
    el.textContent = '';
  },

  async shutdownOfflineServerIfRunning() {
    try {
      if (window.offlineApi && typeof window.offlineApi.stopServer === 'function') {
        await window.offlineApi.stopServer();
        this.debugLog('shutdownOfflineServerIfRunning: done');
      }
    } catch (_e) {}
  },

  async handleBackOnline() {
    this.debugLog('handleBackOnline()');
    this.state.connectionStatus = 'connecting';
    this.updateOfflineBadge();
    this.updateComposerAvailability();
    await this.shutdownOfflineServerIfRunning();
    try {
      await fetchModels();
      this.state.connectionStatus = 'connected';
      this.debugLog('handleBackOnline: ✅ connected');
    } catch (e) {
      this.debugLog(`handleBackOnline: ❌ ${e?.message || e}`);
      this.state.connectionStatus = 'connecting';
    }
    this.updateOfflineBadge();
    this.updateApiSourceBadge();
    this.updateComposerAvailability();
  },

  loadSettings() {
    this.debugLog('loadSettings()');
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('settingsApiKey', this.state.apiKey);
    setVal('singleModelSearch', this.state.selectedModel);
    setVal('gradingModel', this.state.gradingModel);
    setVal('gradingPrompt', localStorage.getItem('or_grading_prompt') || document.getElementById('gradingPrompt')?.value || '');
    setVal('temperature', localStorage.getItem('or_temperature') || document.getElementById('temperature')?.value || '0.7');
    setVal('maxTokens', localStorage.getItem('or_max_tokens') || document.getElementById('maxTokens')?.value || '4096');
    setVal('subagentLikelihood', String(this.state.subagentLikelihood ?? 50));
    setVal('multiCutoffSec', String(this.state.multiCutoffSec || 5));
    setVal('weightHelpfulness', String(this.state.weights.helpfulness));
    setVal('weightAccuracy', String(this.state.weights.accuracy));
    setVal('weightClarity', String(this.state.weights.clarity));
    setVal('weightSpeed', String(this.state.weights.speed));
    setVal('earlyStopCount', String(this.state.weights.earlyStopCount));
    const tr = document.getElementById('transparencyMode'); if (tr) tr.checked = this.state.transparency;
    const dbg = document.getElementById('debugConsoleToggle'); if (dbg) dbg.checked = !!this.state.debugConsoleVisible;
    const sub = document.getElementById('subagentToggle'); if (sub) sub.checked = !!this.state.subagentEnabled;
    const themeToggle = document.getElementById('themeToggle'); if (themeToggle) themeToggle.checked = this.state.theme === 'light';
    const exhaust = document.getElementById('multiExhaustOnFailure'); if (exhaust) exhaust.checked = !!this.state.multiExhaustOnFailure;
    this.updateMultiExhaustHint();
    const singleRetry = document.getElementById('singleModelRetry'); if (singleRetry) singleRetry.checked = !!this.state.singleModelRetry;
    const gradingRetry = document.getElementById('gradingModelRetry'); if (gradingRetry) gradingRetry.checked = !!this.state.gradingModelRetry;
    const showGraderTable = document.getElementById('showGraderTable'); if (showGraderTable) showGraderTable.checked = !!this.state.showGraderTable;
    this.updateWeightLabels();
    this.updateDebugConsoleVisibility();
    this.applyTheme();
    this.renderMultiModelList();
    this.setModelUsed(this.state.selectedModel || '-');
    const hint = document.getElementById('singleModelSelectedHint');
    if (hint && this.state.selectedModel) hint.textContent = `Selected: ${this.state.selectedModel}`;
    const offSel = document.getElementById('offlineModelSetting');
    if (offSel && this.state.offlineModel) offSel.value = this.state.offlineModel;
  },

  async refreshOfflineModelChoices(force = false) {
    this.debugLog(`refreshOfflineModelChoices(force=${force})`);
    const settingSel = document.getElementById('offlineModelSetting');
    const modalSel = document.getElementById('offlineModelSelect');
    try {
      const previous = this.state.offlineModel || localStorage.getItem('or_offline_model') || '';
      const fallbackOptions = ['local/llama-2-7b-chat', 'local/deepseek-llm-7b-base'];
      if (!this.state.offline && !force) {
        const fill = (sel) => {
          if (!sel) return; sel.innerHTML = '';
          fallbackOptions.forEach((id) => {
            const opt = document.createElement('option'); opt.value = id; opt.textContent = id; sel.appendChild(opt);
          });
          sel.value = previous && fallbackOptions.includes(previous) ? previous : fallbackOptions[0];
        };
        fill(settingSel); fill(modalSel);
        this.state.offlineModel = (settingSel?.value || modalSel?.value || '').trim();
        localStorage.setItem('or_offline_model', this.state.offlineModel);
        return;
      }
      let ids = [];
      try {
        const res = await fetch('http://127.0.0.1:5000/v1/models', { method: 'GET' });
        if (res.ok) {
          const payload = await res.json();
          if (Array.isArray(payload?.data)) ids = payload.data.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
        }
      } catch (_e) { this.debugLog('refreshOfflineModelChoices: local server not reachable'); }
      const options = ids.length ? ids : fallbackOptions;
      const fill = (sel) => {
        if (!sel) return; sel.innerHTML = '';
        options.forEach((id) => {
          const opt = document.createElement('option'); opt.value = id; opt.textContent = id; sel.appendChild(opt);
        });
        sel.value = previous && options.includes(previous) ? previous : options[0];
      };
      fill(settingSel); fill(modalSel);
      this.state.offlineModel = (settingSel?.value || modalSel?.value || '').trim();
      localStorage.setItem('or_offline_model', this.state.offlineModel);
    } catch (e) {
      this.debugLog(`refreshOfflineModelChoices: error ${e?.message || e}`);
      console.error('Failed loading offline models', e);
    }
  },

  saveOfflineModelFromModal() {
    this.debugLog('saveOfflineModelFromModal()');
    const modal = document.getElementById('offlineModelModal');
    const sel = document.getElementById('offlineModelSelect');
    const settingSel = document.getElementById('offlineModelSetting');
    const picked = (sel?.value || '').trim();
    if (!picked) return alert('Please choose an offline model.');
    this.state.offlineModel = picked;
    localStorage.setItem('or_offline_model', picked);
    if (settingSel) settingSel.value = picked;
    this.switchOfflineModelOnServer(picked);
    if (this.state.offline) this.setModelUsed(picked);
    if (modal) modal.style.display = 'none';
  },

  saveOfflineModelManual() {
    this.debugLog('saveOfflineModelManual()');
    const input = document.getElementById('offlineModelManualInput');
    const settingSel = document.getElementById('offlineModelSetting');
    const modal = document.getElementById('offlineModelModal');
    const picked = (input?.value || '').trim();
    if (!picked) return alert('Type an offline model id first.');
    this.state.offlineModel = picked;
    localStorage.setItem('or_offline_model', picked);
    if (settingSel) {
      const opt = document.createElement('option'); opt.value = picked; opt.textContent = picked; settingSel.appendChild(opt);
      settingSel.value = picked;
    }
    this.switchOfflineModelOnServer(picked);
    if (this.state.offline) this.setModelUsed(picked);
    if (modal) modal.style.display = 'none';
  },

  async switchOfflineModelOnServer(modelId) {
    this.debugLog(`switchOfflineModelOnServer("${modelId}")`);
    try {
      if (window.offlineApi && typeof window.offlineApi.switchModel === 'function') {
        await window.offlineApi.switchModel(modelId);
        return;
      }
      const r = await fetch('http://127.0.0.1:5000/v1/switch-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: modelId })
      });
      if (!r.ok) {
        const isCode = String(modelId).toLowerCase().includes('deepseek') || String(modelId).toLowerCase().includes('code');
        await fetch(`http://127.0.0.1:5000/model/${isCode ? 'code' : 'chat'}`, { method: 'POST' });
      }
    } catch (e) {
      this.debugLog(`switchOfflineModelOnServer: ❌ ${e?.message || e}`);
    }
  },

  async ensureOfflineModelReady() {
    this.debugLog(`ensureOfflineModelReady() offline=${this.state.offline}`);
    if (!this.state.offline) return true;
    // Avoid hitting /v1/models on every send. Only refresh choices when missing.
    if (!this.state.offlineModel) {
      await this.refreshOfflineModelChoices();
    }
    if (this.state.offlineModel) {
      this.switchOfflineModelOnServer(this.state.offlineModel);
      this.setModelUsed(this.state.offlineModel);
      return true;
    }
    const modal = document.getElementById('offlineModelModal');
    if (modal) modal.style.display = 'flex';
    return false;
  },

  async isLocalOfflineServerReachable() {
    const now = Date.now();
    if (this._offlineReachabilityCache && (now - this._offlineReachabilityCache.ts) < 8000) {
      return this._offlineReachabilityCache.ok;
    }
    try {
      // Lightweight health check endpoint (do not fetch models repeatedly).
      const r = await fetch('http://127.0.0.1:5000/', { method: 'GET' });
      const ok = !!r.ok;
      this._offlineReachabilityCache = { ts: now, ok };
      return ok;
    } catch (_) {
      this._offlineReachabilityCache = { ts: now, ok: false };
      return false;
    }
  },

  async ensureOfflineServerRunning() {
    if (!this.state.offline) return true;
    const ok = await this.isLocalOfflineServerReachable();
    this.state.localServerOnline = !!ok;
    this.updateComposerAvailability();
    if (ok) return true;
    alert('Offline mode detected, but local AI server is not running.\n\nPlease run: AiChatCLide\\offline-launcher.bat');
    return false;
  },

  startOfflineHealthMonitor() {
    const runCheck = async () => {
      // Skip checks while tab is hidden to avoid unnecessary local server polling.
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!this.state.offline) {
        this.state.localServerOnline = true;
        this.updateComposerAvailability();
        return;
      }
      const ok = await this.isLocalOfflineServerReachable();
      this.state.localServerOnline = !!ok;
      this.updateComposerAvailability();
    };
    runCheck();
    if (this._offlineHealthTimer) clearInterval(this._offlineHealthTimer);
    // Poll less aggressively to prevent request spam in offline mode.
    this._offlineHealthTimer = setInterval(runCheck, 12000);
  },

  saveSettings() {
    this.debugLog('saveSettings()');
    const get = (id, d='') => document.getElementById(id)?.value?.trim?.() ?? d;
    this.state.gradingModel = get('gradingModel', this.state.gradingModel);
    localStorage.setItem('or_grading_model', this.state.gradingModel);
    this.state.singleModelRetry = !!document.getElementById('singleModelRetry')?.checked;
    this.state.gradingModelRetry = !!document.getElementById('gradingModelRetry')?.checked;
    this.state.showGraderTable = !!document.getElementById('showGraderTable')?.checked;
    localStorage.setItem('or_single_model_retry', String(this.state.singleModelRetry));
    localStorage.setItem('or_grading_model_retry', String(this.state.gradingModelRetry));
    localStorage.setItem('or_show_grader_table', String(this.state.showGraderTable));
    localStorage.setItem('or_grading_prompt', get('gradingPrompt', ''));
    localStorage.setItem('or_temperature', get('temperature', '0.7'));
    localStorage.setItem('or_max_tokens', get('maxTokens', '4096'));
    this.state.multiExhaustOnFailure = !!document.getElementById('multiExhaustOnFailure')?.checked;
    localStorage.setItem('or_multi_exhaust_on_failure', String(this.state.multiExhaustOnFailure));
    this.state.multiCutoffSec = Number(get('multiCutoffSec', '5')) || 5;
    localStorage.setItem('or_multi_cutoff_sec', String(this.state.multiCutoffSec));
    localStorage.setItem('or_transparency', String(this.state.transparency));
    this.state.subagentEnabled = !!document.getElementById('subagentToggle')?.checked;
    localStorage.setItem('or_subagent_enabled', String(this.state.subagentEnabled));
    this.state.subagentLikelihood = Math.max(0, Math.min(100, Number(get('subagentLikelihood', String(this.state.subagentLikelihood || 50))) || 0));
    localStorage.setItem('or_subagent_likelihood', String(this.state.subagentLikelihood));
    this.saveWeights();
  },

  saveWeights() {
    this.debugLog('saveWeights()');
    const n = (id, d) => Number(document.getElementById(id)?.value || d);
    this.state.weights = {
      helpfulness: n('weightHelpfulness', 5),
      accuracy: n('weightAccuracy', 5),
      clarity: n('weightClarity', 5),
      speed: n('weightSpeed', 5),
      earlyStopCount: n('earlyStopCount', 2)
    };
    localStorage.setItem('or_weight_helpfulness', String(this.state.weights.helpfulness));
    localStorage.setItem('or_weight_accuracy', String(this.state.weights.accuracy));
    localStorage.setItem('or_weight_clarity', String(this.state.weights.clarity));
    localStorage.setItem('or_weight_speed', String(this.state.weights.speed));
    localStorage.setItem('or_early_stop_count', String(this.state.weights.earlyStopCount));
  },

  updateWeightLabels() {
    const map = [['weightHelpfulness','wHelpVal'],['weightAccuracy','wAccVal'],['weightClarity','wClarVal'],['weightSpeed','wSpeedVal'],['earlyStopCount','earlyStopVal'],['temperature','temperatureVal'],['maxTokens','maxTokensVal'],['subagentLikelihood','subagentLikelihoodVal']];
    map.forEach(([s,l])=>{ const sv=document.getElementById(s)?.value; const lv=document.getElementById(l); if(lv&&sv!==undefined) lv.textContent=sv; });
    const secV = document.getElementById('multiCutoffSec')?.value;
    const secL = document.getElementById('multiCutoffSecVal');
    if (secL && secV !== undefined) secL.textContent = Number(secV).toFixed(1);
  },

  ensureActiveChat() { if (!this.state.currentChatId && this.state.chats.length) this.state.currentChatId = this.state.chats[0].id; },
  getCurrentChat() { return this.state.chats.find((c) => c.id === this.state.currentChatId) || null; },
  persistChats() {
    const raw = JSON.stringify(this.state.chats);
    localStorage.setItem('or_chats', raw);
    try { localStorage.setItem('or_chats_compressed', this._compress(raw)); } catch (_) {}
    // If signed in, queue chat snapshots for cloud backup
    try {
      if (this.state.user?.id && typeof prismSync !== 'undefined' && prismSync.enqueue) {
        this.state.chats.forEach((chat) => {
          if (!chat?.id) return;
          prismSync.enqueue('chat', chat.id, {
            title: chat.title || 'New Chat',
            messages: Array.isArray(chat.messages) ? chat.messages : [],
            model: chat.model || this.state.selectedModel || '',
            mode: chat.mode || 'single',
            timestamp: Date.now()
          }, 'upsert');
        });
      }
    } catch (_) {}
    this.updateStorageUsage();
  },

  getUserScopedKey(baseKey, userId) {
    return `${baseKey}:${userId || 'guest'}`;
  },

  saveUserScopedSnapshot(userId) {
    if (!userId) return;
    try {
      localStorage.setItem(this.getUserScopedKey('or_chats_user', userId), JSON.stringify(this.state.chats || []));
      localStorage.setItem(this.getUserScopedKey('or_multi_models_user', userId), JSON.stringify(this.state.multiModels || []));
      localStorage.setItem(this.getUserScopedKey('or_multi_model_retries_user', userId), JSON.stringify(this.state.multiModelRetries || {}));
    } catch (_) {}
  },

  loadUserScopedSnapshot(userId) {
    if (!userId) return { chats: [], multiModels: [], multiModelRetries: {} };
    try {
      return {
        chats: JSON.parse(localStorage.getItem(this.getUserScopedKey('or_chats_user', userId)) || '[]'),
        multiModels: JSON.parse(localStorage.getItem(this.getUserScopedKey('or_multi_models_user', userId)) || '[]'),
        multiModelRetries: JSON.parse(localStorage.getItem(this.getUserScopedKey('or_multi_model_retries_user', userId)) || '{}')
      };
    } catch (_) {
      return { chats: [], multiModels: [], multiModelRetries: {} };
    }
  },

  async pullCloudChatsForUser(userId) {
    if (!userId || typeof prismSupabase === 'undefined') return [];
    try {
      const sb = prismSupabase.getClient();
      if (!sb) return [];
      const { data, error } = await sb
        .from('chats')
        .select('id,title,messages,model,mode,updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (Array.isArray(data) ? data : []).map((r) => ({
        id: r.id,
        title: r.title || 'New Chat',
        messages: Array.isArray(r.messages) ? r.messages : [],
        model: r.model || '',
        mode: r.mode || 'single',
        createdAt: r.updated_at || new Date().toISOString(),
        timestamp: r.updated_at ? new Date(r.updated_at).getTime() : Date.now()
      }));
    } catch (e) {
      this.debugLog(`pullCloudChatsForUser warning: ${e?.message || e}`);
      return [];
    }
  },

  async pullCloudPreferencesForUser(userId) {
    if (!userId || typeof prismSupabase === 'undefined') return null;
    try {
      const sb = prismSupabase.getClient();
      if (!sb) return null;
      const { data, error } = await sb
        .from('profiles')
        .select('preferences, api_key')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return {
        preferences: data?.preferences || null,
        apiKey: data?.api_key || ''
      };
    } catch (_) {
      return null;
    }
  },

  async pushCloudPreferencesForUser(userId) {
    if (!userId || typeof prismSupabase === 'undefined') return;
    try {
      const sb = prismSupabase.getClient();
      if (!sb) return;
      await sb
        .from('profiles')
        .update({
          preferences: {
            multiModels: this.state.multiModels || [],
            multiModelRetries: this.state.multiModelRetries || {}
          },
          api_key: this.state.apiKey || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
    } catch (_) {
      // optional column/path; ignore if schema doesn't include preferences
    }
  },

  async getDefaultApiKeyFromAppConfig() {
    try {
      if (typeof prismSupabase === 'undefined' || !prismSupabase.getAppConfig) return '';
      const cfg = await prismSupabase.getAppConfig();
      return String(cfg?.openrouter_api_key || '').trim();
    } catch (_) {
      return '';
    }
  },

  async persistApiKeyToProfile(userId, apiKey) {
    if (!userId || typeof prismSupabase === 'undefined') return;
    try {
      const sb = prismSupabase.getClient();
      if (!sb) return;
      await sb
        .from('profiles')
        .update({
          api_key: apiKey || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
    } catch (_) {
      // optional schema path; ignore if unavailable
    }
  },

  showToast(message, type = 'info', duration = 2800) {
    const safeType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
    let wrap = document.querySelector('.toast-container');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-container';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `toast ${safeType}`;
    el.textContent = String(message || 'Done');
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 280);
    }, Math.max(1200, Number(duration) || 2800));
  },

  async handleAuthChange(user, session) {
    const previousUserId = this.state.user?.id || null;
    const isInitialBootEvent = !this.state.authBootHandled;
    this.state.authBootHandled = true;
    this.state.user = user || null;

    if (!this.state.user && previousUserId) {
      this.saveUserScopedSnapshot(previousUserId);
      this.state.chats = [];
      this.state.currentChatId = null;
      this.state.multiModels = [];
      this.state.multiModelRetries = {};
      localStorage.removeItem('or_multi_models');
      localStorage.removeItem('or_multi_model_retries');
      this.persistChats();
      this.renderChatList();
      this.renderMessages();
      this.renderMultiModelList();
      this.showToast('Signed out. Local view cleared until next sign-in.', 'info', 2200);
      return;
    }

    if (this.state.user) {
      if (isInitialBootEvent) {
        this.showToast(`Connected as ${this.state.user.email || 'user'}`, 'success', 2200);
      }
      try {
        const scoped = this.loadUserScopedSnapshot(this.state.user.id);
        const cloudChats = await this.pullCloudChatsForUser(this.state.user.id);
        this.state.chats = cloudChats.length ? cloudChats : (scoped.chats || []);
        this.state.currentChatId = this.state.chats[0]?.id || null;
        this.persistChats();

        const cloudPrefs = await this.pullCloudPreferencesForUser(this.state.user.id);
        const localModels = Array.isArray(scoped.multiModels) ? scoped.multiModels.filter(Boolean) : [];
        const cloudModels = Array.isArray(cloudPrefs?.preferences?.multiModels) ? cloudPrefs.preferences.multiModels.filter(Boolean) : [];
        const localRetries = (scoped.multiModelRetries && typeof scoped.multiModelRetries === 'object') ? scoped.multiModelRetries : {};
        const cloudRetries = (cloudPrefs?.preferences?.multiModelRetries && typeof cloudPrefs.preferences.multiModelRetries === 'object') ? cloudPrefs.preferences.multiModelRetries : {};

        const cloudApiKey = String(cloudPrefs?.apiKey || '').trim();
        const defaultApiKey = await this.getDefaultApiKeyFromAppConfig();
        const resolvedApiKey = cloudApiKey || this.state.apiKey || defaultApiKey;
        if (resolvedApiKey) {
          this.state.apiKey = resolvedApiKey;
          localStorage.setItem('or_api_key', resolvedApiKey);
          const settingsKey = document.getElementById('settingsApiKey');
          if (settingsKey) settingsKey.value = resolvedApiKey;
          await this.persistApiKeyToProfile(this.state.user.id, resolvedApiKey);
        }

        // Local is authoritative when present: override cloud list with local list.
        const useLocalAsSourceOfTruth = localModels.length > 0;
        this.state.multiModels = useLocalAsSourceOfTruth ? [...new Set(localModels)] : [...new Set(cloudModels)];
        this.state.multiModelRetries = useLocalAsSourceOfTruth ? { ...localRetries } : { ...cloudRetries };
        localStorage.setItem('or_multi_models', JSON.stringify(this.state.multiModels));
        localStorage.setItem('or_multi_model_retries', JSON.stringify(this.state.multiModelRetries));
        this.renderMultiModelList();
        this.renderChatList();
        this.renderMessages();

        // Queue all existing chats for cloud backup and force a sync pass
        this.persistChats();
        this.saveUserScopedSnapshot(this.state.user.id);
        // Force cloud preferences to match local authoritative model list.
        await this.pushCloudPreferencesForUser(this.state.user.id);
        if (typeof prismStorage !== 'undefined' && prismStorage.syncLocalFiles) {
          await prismStorage.syncLocalFiles();
        }
        if (typeof prismSync !== 'undefined' && prismSync.forceSync) {
          await prismSync.forceSync();
        }
      } catch (e) {
        this.debugLog(`handleAuthChange sync warning: ${e?.message || e}`);
      }
    }
  },

  updateUserState(user) {
    this.state.user = user || null;
  },

  updateStorageUsage() {
    const fill = document.getElementById('storageUsageFill');
    const txt = document.getElementById('storageUsageText');
    const pct = document.getElementById('storageUsagePct');
    if (!fill || !txt || !pct) return;
    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i) || '';
      const v = localStorage.getItem(k) || '';
      totalBytes += (k.length + v.length) * 2;
    }
    const maxBytes = 5 * 1024 * 1024;
    const ratio = Math.max(0, Math.min(100, (totalBytes / maxBytes) * 100));
    const kb = totalBytes / 1024;
    fill.style.width = `${ratio.toFixed(1)}%`;
    txt.textContent = `${kb.toFixed(1)} KB used / 5120 KB`;
    pct.textContent = `${ratio.toFixed(1)}%`;
  },

  async fetchAndCacheModels() {
    this.debugLog('fetchAndCacheModels()');
    try { this.state.models = await fetchModels(); this.debugLog(`fetchAndCacheModels: ✅ ${this.state.models.length} models`); }
    catch (e) { this.debugLog(`fetchAndCacheModels: ❌ ${e?.message || e}`); console.error(e); this.state.models = []; }
  },

  renderModelDropdown(type, query) {
    const id = type === 'single' ? 'singleModelDropdown' : type === 'grading' ? 'gradingModelDropdown' : 'multiModelDropdown';
    const dd = document.getElementById(id); if (!dd) return;
    const q = (query || '').toLowerCase().trim();
    const models = (this.state.models || []).filter((m) => !q || m.id.toLowerCase().includes(q)).slice(0, 80);
    dd.innerHTML = '';
    models.forEach((m) => {
      const opt = document.createElement('div'); opt.className = 'model-option'; opt.textContent = m.id;
      opt.onclick = () => { if (type==='single') this.selectSingleModel(m.id); else if (type==='grading') this.selectGradingModel(m.id); else this.addMultiModel(m.id); };
      dd.appendChild(opt);
    });
    dd.classList.add('open');
  },

  addMultiModel(modelId) {
    this.debugLog(`addMultiModel("${modelId}")`);
    if (!this.state.multiModels.includes(modelId)) {
      this.state.multiModels.push(modelId);
      localStorage.setItem('or_multi_models', JSON.stringify(this.state.multiModels));
      if (typeof this.state.multiModelRetries[modelId] !== 'boolean') {
        this.state.multiModelRetries[modelId] = false;
        localStorage.setItem('or_multi_model_retries', JSON.stringify(this.state.multiModelRetries));
      }
      this.renderMultiModelList();
      if (this.state.user?.id) this.pushCloudPreferencesForUser(this.state.user.id);
    }
    document.getElementById('multiModelDropdown')?.classList.remove('open');
    const inpt = document.getElementById('multiModelSearch'); if (inpt) inpt.value = '';
  },

  removeMultiModel(modelId) {
    this.debugLog(`removeMultiModel("${modelId}")`);
    this.state.multiModels = this.state.multiModels.filter((m) => m !== modelId);
    delete this.state.multiModelRetries[modelId];
    localStorage.setItem('or_multi_models', JSON.stringify(this.state.multiModels));
    localStorage.setItem('or_multi_model_retries', JSON.stringify(this.state.multiModelRetries));
    this.renderMultiModelList();
    if (this.state.user?.id) this.pushCloudPreferencesForUser(this.state.user.id);
  },

  setMultiModelRetry(modelId, enabled) {
    this.state.multiModelRetries[modelId] = !!enabled;
    localStorage.setItem('or_multi_model_retries', JSON.stringify(this.state.multiModelRetries));
    if (this.state.user?.id) this.pushCloudPreferencesForUser(this.state.user.id);
  },

  moveMultiModel(modelId, direction) {
    const idx = this.state.multiModels.indexOf(modelId);
    if (idx < 0) return;
    const nextIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= this.state.multiModels.length) return;
    const arr = [...this.state.multiModels];
    [arr[idx], arr[nextIdx]] = [arr[nextIdx], arr[idx]];
    this.state.multiModels = arr;
    localStorage.setItem('or_multi_models', JSON.stringify(this.state.multiModels));
    this.renderMultiModelList();
    if (this.state.user?.id) this.pushCloudPreferencesForUser(this.state.user.id);
  },

  toggleRearrangeMode() {
    this.state.rearrangeMode = !this.state.rearrangeMode;
    const btn = document.getElementById('toggleRearrangeBtn');
    const hint = document.getElementById('rearrangeHint');
    if (btn) {
      btn.textContent = this.state.rearrangeMode ? 'Done' : 'Rearrange';
      btn.classList.toggle('active', this.state.rearrangeMode);
    }
    if (hint) hint.style.display = this.state.rearrangeMode ? '' : 'none';
    this.renderMultiModelList();
  },

  reorderMultiModelsByDrag(fromModelId, toModelId) {
    if (!fromModelId || !toModelId || fromModelId === toModelId) return;
    const arr = [...this.state.multiModels];
    const from = arr.indexOf(fromModelId);
    const to = arr.indexOf(toModelId);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    this.state.multiModels = arr;
    localStorage.setItem('or_multi_models', JSON.stringify(this.state.multiModels));
    this.renderMultiModelList();
    if (this.state.user?.id) this.pushCloudPreferencesForUser(this.state.user.id);
  },

  renderMultiModelList() {
    const wrap = document.getElementById('multiModelList'); if (!wrap) return;
    wrap.innerHTML = '';
    this.state.multiModels.forEach((m, idx) => {
      const chip = document.createElement('div');
      chip.className = 'model-chip';
      const retryChecked = !!this.state.multiModelRetries[m];
      chip.innerHTML = `
        <span class="model-chip-name" title="${m.replace(/"/g, '"')}">${this.state.rearrangeMode ? '☰ ' : ''}${m}</span>
        <div class="model-chip-menu-wrap">
          <button class="model-chip-menu-btn" aria-label="Model actions">⋯</button>
          <div class="model-chip-menu">
            <label class="model-chip-menu-check">
              <input type="checkbox" ${retryChecked ? 'checked' : ''}>
              Retry up to 3 times
            </label>
            <button class="model-chip-menu-row danger">Remove</button>
          </div>
        </div>
      `;
      const menuBtn = chip.querySelector('.model-chip-menu-btn');
      const menu = chip.querySelector('.model-chip-menu');
      const retryCb = chip.querySelector('.model-chip-menu-check input');
      const removeBtn = chip.querySelector('.model-chip-menu-row.danger');
      if (this.state.rearrangeMode) {
        chip.setAttribute('draggable', 'true');
        chip.classList.add('drag-enabled');
        chip.addEventListener('dragstart', (e) => {
          this.state.draggingModelId = m;
          chip.classList.add('dragging');
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        chip.addEventListener('dragend', () => {
          chip.classList.remove('dragging');
          this.state.draggingModelId = null;
        });
        chip.addEventListener('dragover', (e) => { e.preventDefault(); chip.classList.add('drag-over'); });
        chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
        chip.addEventListener('drop', (e) => {
          e.preventDefault();
          chip.classList.remove('drag-over');
          this.reorderMultiModelsByDrag(this.state.draggingModelId, m);
        });
      }
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.model-chip-menu.open').forEach((x) => { if (x !== menu) x.classList.remove('open'); });
        menu.classList.toggle('open');
      };
      retryCb.onchange = (e) => this.setMultiModelRetry(m, !!e.target.checked);
      removeBtn.onclick = () => this.removeMultiModel(m);
      wrap.appendChild(chip);
    });
  },

  selectSingleModel(modelId) {
    this.debugLog(`selectSingleModel("${modelId}")`);
    this.state.selectedModel = modelId;
    localStorage.setItem('or_selected_model', modelId);
    const i = document.getElementById('singleModelSearch'); if (i) i.value = modelId;
    document.getElementById('singleModelDropdown')?.classList.remove('open');
    const h = document.getElementById('singleModelSelectedHint'); if (h) h.textContent = `Selected: ${modelId}`;
    this.setModelUsed(modelId);
  },

  selectGradingModel(modelId) {
    this.debugLog(`selectGradingModel("${modelId}")`);
    this.state.gradingModel = modelId;
    localStorage.setItem('or_grading_model', modelId);
    const i = document.getElementById('gradingModel'); if (i) i.value = modelId;
    document.getElementById('gradingModelDropdown')?.classList.remove('open');
  },

  setModelUsed(modelId) { const el = document.getElementById('modelUsed'); if (el) el.textContent = `Model: ${modelId || '-'}`; },

  toggleSettings() {
    this.saveSettings();
    document.getElementById('settingsPanel')?.classList.toggle('open');
    document.getElementById('overlay')?.classList.toggle('open');
    this.updateStorageUsage();
  },

  saveApiKey() {
    const key = document.getElementById('apiKeyInput')?.value.trim();
    this.debugLog(`saveApiKey() key.length=${key?.length || 0}`);
    if (!key) return alert('Please enter an API key.');
    this.state.apiKey = key; localStorage.setItem('or_api_key', key);
    if (this.state.user?.id) this.persistApiKeyToProfile(this.state.user.id, key);
    this.updateStorageUsage();
    const s = document.getElementById('settingsApiKey'); if (s) s.value = key;
    this.closeApiModal(); this.fetchAndCacheModels();
  },

  closeApiModal() { const m = document.getElementById('apiModal'); if (m) m.style.display = 'none'; },

  saveApiKeyFromSettings() {
    const key = document.getElementById('settingsApiKey')?.value.trim();
    this.debugLog(`saveApiKeyFromSettings() key.length=${key?.length || 0}`);
    if (!key) return alert('Please enter an API key.');
    this.state.apiKey = key; localStorage.setItem('or_api_key', key); if (this.state.user?.id) this.persistApiKeyToProfile(this.state.user.id, key); this.updateStorageUsage(); alert('API key saved. Loading models...'); this.fetchAndCacheModels();
  },

  setMode(mode) {
    this.debugLog(`setMode("${mode}") offline=${this.state.offline}`);
    const next = mode === 'multi' ? 'multi' : 'single';
    if (next === 'multi' && this.state.offline) {
      this.debugLog('setMode: multi+offline -> showing popup, staying single');
      this.state.mode = 'multi';
      localStorage.setItem('or_mode', 'multi');
      this.updateModeButtons();
      this.openOfflineMultiPopup();
      this.updateComposerAvailability();
      return;
    }
    this.state.mode = next;
    localStorage.setItem('or_mode', this.state.mode);
    this.updateModeButtons();
    this.updateComposerAvailability();
  },

  updateModeButtons() { const s=document.getElementById('singleModeBtn'); const m=document.getElementById('multiModeBtn'); if (s) s.classList.toggle('active', this.state.mode==='single'); if (m) m.classList.toggle('active', this.state.mode==='multi'); },

  toggleTransparency() { this.state.transparency = !this.state.transparency; localStorage.setItem('or_transparency', String(this.state.transparency)); const cb = document.getElementById('transparencyMode'); if (cb) cb.checked=this.state.transparency; this.updateTransparencyBadge(); },

  updateTransparencyBadge() { const b=document.getElementById('transparencyBadge'); if(b) b.classList.toggle('show', this.state.transparency); },

  updateOfflineBadge() {
    this.state.offline = typeof navigator !== 'undefined' ? navigator.onLine === false : this.state.offline;
    const b = document.getElementById('offlineBadge');
    if (!b) return;
    b.classList.remove('connecting', 'connected');
    if (this.state.offline) this.state.connectionStatus = 'offline';
    if (this.state.modelSwitching) {
      b.classList.add('show', 'connecting'); b.textContent = 'Model Connecting...'; b.title = 'Please wait while local model is switching.';
    } else if (this.state.connectionStatus === 'offline') {
      b.classList.add('show'); b.textContent = 'Offline'; b.title = 'Offline mode active. Use local server (offline-launcher.bat).';
    } else if (this.state.connectionStatus === 'connecting') {
      b.classList.add('show', 'connecting'); b.textContent = 'Connecting API...'; b.title = 'Connecting to online API...';
    } else {
      b.classList.add('show', 'connected'); b.textContent = 'Connected'; b.title = 'Connected to online API.';
    }
    this.updateApiSourceBadge();
  },

  updateApiSourceBadge() {
    const el = document.getElementById('apiSourceBadge');
    if (!el) return;
    if (this.state.offline) { el.textContent = 'API: Local'; el.title = 'Using local offline server'; return; }
    if (this.state.connectionStatus === 'connecting') { el.textContent = 'API: Connecting...'; el.title = 'Connecting to OpenRouter'; return; }
    el.textContent = 'API: OpenRouter'; el.title = 'Using OpenRouter online API';
  },

  openOfflineMultiPopup() { const m = document.getElementById('offlineMultiModal'); if (m) m.style.display = 'flex'; },
  closeOfflineMultiPopup() { const m = document.getElementById('offlineMultiModal'); if (m) m.style.display = 'none'; },

  forceSingleModeFromOfflinePopup() {
    this.debugLog('forceSingleModeFromOfflinePopup()');
    this.state.mode = 'single';
    localStorage.setItem('or_mode', 'single');
    this.updateModeButtons();
    this.closeOfflineMultiPopup();
    this.updateComposerAvailability();
  },

  updateComposerAvailability() {
    const input = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const micBtn = document.getElementById('micBtn');
    if (!input || !sendBtn) return;
    const blocked =
      (this.state.offline && this.state.mode === 'multi') ||
      (this.state.offline && !this.state.localServerOnline) ||
      this.state.quizGenerating ||
      this.state.modelSwitching ||
      this.state.connectionStatus === 'connecting';
    input.disabled = blocked;
    sendBtn.disabled = blocked;
    if (micBtn) micBtn.disabled = blocked || this.state.isGenerating;
    if (this.state.modelSwitching) {
      input.placeholder = 'Please wait, local model is connecting...';
    } else if (this.state.quizGenerating) {
      input.placeholder = 'Generating quiz questions...';
    } else if (this.state.connectionStatus === 'connecting') {
      input.placeholder = 'Please wait, connecting API...';
    } else if (this.state.offline && !this.state.localServerOnline) {
      input.placeholder = 'Offline local server not detected. Run offline-launcher.bat.';
    } else if (blocked) {
      input.placeholder = 'Multi-Grade not supported offline. Switch to Single mode.';
    } else if (!input.value) {
      input.placeholder = 'Type your message...';
    }
  },

  toggleSidebar() {
    const sb = document.querySelector('.sidebar');
    const btn = document.getElementById('sidebarToggleBtn');
    const topBtn = document.getElementById('topSidebarToggleBtn');
    if (!sb) return;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (isMobile) {
      sb.classList.toggle('open');
      const isOpen = sb.classList.contains('open');
      if (btn) btn.title = isOpen ? 'Hide chats' : 'Show chats';
      if (topBtn) topBtn.title = isOpen ? 'Hide chats' : 'Show chats';
      if (topBtn) topBtn.setAttribute('aria-label', isOpen ? 'Hide chats' : 'Show chats');
      return;
    }

    sb.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', sb.classList.contains('collapsed'));
    if (btn) btn.textContent = '☰';
    if (btn) btn.title = sb.classList.contains('collapsed') ? 'Show chats' : 'Hide chats';
    if (topBtn) topBtn.title = sb.classList.contains('collapsed') ? 'Show chats' : 'Hide chats';
    if (topBtn) topBtn.setAttribute('aria-label', sb.classList.contains('collapsed') ? 'Show chats' : 'Hide chats');
  },

  newChat() {
    this.debugLog('newChat()');
    const chat = {
      id: String(Date.now()),
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      messages: [],
      mode: this.state.mode || 'single',
      model: this.state.selectedModel || ''
    };
    this.state.chats.unshift(chat); this.state.currentChatId = chat.id; this.persistChats(); this.renderChatList(); this.renderMessages();
  },

  renderChatList() {
    const list = document.getElementById('chatList'); if (!list) return; list.innerHTML = '';
    this.state.chats.forEach((chat) => {
      const safeDate = chat?.createdAt ? new Date(chat.createdAt) : null;
      const dateText = (safeDate && !Number.isNaN(safeDate.getTime()))
        ? safeDate.toLocaleDateString()
        : '—';
      const item = document.createElement('div'); item.className = `chat-item${chat.id===this.state.currentChatId?' active':''}`;
      item.innerHTML = `
        <div class="chat-main" title="${chat.title.replace(/"/g, '"')}">
          <span class="chat-title">${chat.title}</span>
          <span class="chat-date">${dateText}</span>
        </div>
        <div class="chat-menu-wrap">
          <button class="chat-menu-btn" aria-label="Chat actions">⋯</button>
          <div class="chat-menu">
            <button class="chat-menu-item">Rename</button>
            <button class="chat-menu-item danger">Delete</button>
          </div>
        </div>
      `;
      item.querySelector('.chat-main').onclick = () => { this.state.currentChatId = chat.id; this.renderChatList(); this.renderMessages(); };
      item.querySelector('.chat-menu-btn').onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.chat-menu.open').forEach((m) => m.classList.remove('open'));
        item.querySelector('.chat-menu').classList.toggle('open');
      };
      item.querySelector('.chat-menu-item:not(.danger)').onclick = (e) => { e.stopPropagation(); this.renameChat(chat.id); };
      item.querySelector('.chat-menu-item.danger').onclick = (e) => { e.stopPropagation(); this.deleteChat(chat.id); };
      list.appendChild(item);
    });
  },

  async deleteChat(chatId) {
    const chat = this.state.chats.find(c => c.id === chatId);
    if (!chat) return;
    const ok = await this.showThemedConfirm({
      title: 'Delete Chat',
      message: `Delete chat "${chat.title}"? This cannot be undone.`,
      confirmText: 'Delete Chat',
      cancelText: 'Cancel'
    });
    if (!ok) return;

    try {
      if (this.state.user?.id && typeof prismSync !== 'undefined' && prismSync.enqueue) {
        prismSync.enqueue('chat', chatId, { timestamp: Date.now() }, 'delete');
      }
    } catch (_) {}

    this.state.chats = this.state.chats.filter((c) => c.id !== chatId);
    if (this.state.currentChatId === chatId) this.state.currentChatId = this.state.chats[0]?.id || null;
    this.persistChats();
    this.renderChatList();
    this.renderMessages();
  },

  renameChat(chatId) {
    const chat = this.state.chats.find(c => c.id === chatId);
    if (!chat) return;
    this.showThemedRename({
      title: 'Rename Chat',
      message: 'Enter a new chat name.',
      initialValue: chat.title || ''
    }).then((next) => {
      if (next == null) return;
      const title = String(next).trim();
      if (!title) return;
      chat.title = title;
      this.persistChats();
      this.renderChatList();
    });
  },

  showThemedRename({ title = 'Rename Chat', message = 'Enter a new name.', initialValue = '' } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('themedRenameModal');
      const titleEl = document.getElementById('themedRenameTitle');
      const msgEl = document.getElementById('themedRenameMessage');
      const inputEl = document.getElementById('themedRenameInput');
      const okBtn = document.getElementById('themedRenameOkBtn');
      const cancelBtn = document.getElementById('themedRenameCancelBtn');
      if (!modal || !titleEl || !msgEl || !inputEl || !okBtn || !cancelBtn) return resolve(null);

      titleEl.textContent = title;
      msgEl.textContent = message;
      inputEl.value = String(initialValue || '');
      modal.style.display = 'flex';
      requestAnimationFrame(() => modal.classList.add('open'));

      const cleanup = (val) => {
        modal.classList.remove('open');
        modal.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        modal.onclick = null;
        inputEl.onkeydown = null;
        resolve(val);
      };

      okBtn.onclick = (e) => { e.stopPropagation(); cleanup(inputEl.value); };
      cancelBtn.onclick = (e) => { e.stopPropagation(); cleanup(null); };
      modal.onclick = (e) => { if (e.target === modal) cleanup(null); };
      inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); cleanup(inputEl.value); }
        if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
      };

      setTimeout(() => {
        inputEl.focus();
        try { inputEl.setSelectionRange(0, inputEl.value.length); } catch (_) {}
      }, 0);
    });
  },

  renderMessageContent(container, content) {
    const text = this.normalizeAssistantContent(content || '');
    const regex = /<(code|copytext)>([\s\S]*?)<\/\1>/gi;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const before = text.slice(lastIndex, match.index);
      if (before) container.appendChild(document.createTextNode(before));
      const tag = (match[1] || '').toLowerCase();
      const codeText = match[2] || '';
      const isCopyText = tag === 'copytext';
      const block = document.createElement('div');
      block.className = isCopyText ? 'copy-text-block' : 'code-block';
      const head = document.createElement('div');
      head.className = isCopyText ? 'copy-text-head' : 'code-head';
      const label = document.createElement('span');
      label.textContent = isCopyText ? 'Copy Text' : 'Code';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-code-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(codeText);
          copyBtn.textContent = 'Copied';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
        } catch (_) {
          copyBtn.textContent = 'Failed';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
        }
      };
      head.appendChild(label);
      head.appendChild(copyBtn);
      const pre = document.createElement(isCopyText ? 'div' : 'pre');
      if (isCopyText) {
        pre.className = 'copy-text-body';
        pre.textContent = codeText;
      } else {
        const code = document.createElement('code');
        code.textContent = codeText;
        pre.appendChild(code);
      }
      block.appendChild(head);
      block.appendChild(pre);
      container.appendChild(block);
      lastIndex = regex.lastIndex;
    }
    const after = text.slice(lastIndex);
    if (after) container.appendChild(document.createTextNode(after));
  },

  renderMessages() {
    const messages = document.getElementById('messages'); if (!messages) return;
    const chat = this.getCurrentChat();
    if (!chat || !chat.messages.length) { messages.innerHTML = `<div class="welcome" id="welcomeScreen"><h1>Prism</h1><p>Start a conversation by typing below.<br>Choose a model from the settings panel.</p></div>`; return; }
    const near = this.isNearBottom();
    messages.innerHTML = '';
    chat.messages.forEach((msg) => {
      const div = document.createElement('div'); div.className = `message ${msg.role}`;
      if (msg.role === 'assistant' && msg.htmlTable && !msg.compactHtml) div.classList.add('full-width');
      const box = document.createElement('div');
      box.className = 'message-box';
      if (msg.role === 'assistant' && this.state.transparency && msg.model) {
        const label = document.createElement('div'); label.className='model-label'; label.textContent = `${msg.model}`; box.appendChild(label);
      }
      if (msg.variants && Array.isArray(msg.variants) && msg.variants.length) {
        const wrap = document.createElement('div');
        wrap.className = 'variant-viewer';
        const idx = Math.max(0, Math.min(msg.selectedIndex || 0, msg.variants.length - 1));
        const current = msg.variants[idx];
        const nav = document.createElement('div');
        nav.className = 'variant-nav';
        const prev = document.createElement('button');
        prev.className = 'variant-btn';
        prev.textContent = '←';
        prev.disabled = idx <= 0;
        prev.onclick = () => { msg.selectedIndex = Math.max(0, idx - 1); this.renderMessages(); };
        const meta = document.createElement('div');
        meta.className = 'variant-meta';
        meta.textContent = `${idx + 1}/${msg.variants.length} • ${current.model}`;
        const next = document.createElement('button');
        next.className = 'variant-btn';
        next.textContent = '→';
        next.disabled = idx >= msg.variants.length - 1;
        next.onclick = () => { msg.selectedIndex = Math.min(msg.variants.length - 1, idx + 1); this.renderMessages(); };
        nav.appendChild(prev); nav.appendChild(meta); nav.appendChild(next);
        const body = document.createElement('div');
        body.className = 'variant-body';
        this.renderMessageContent(body, current.content || '');
        wrap.appendChild(nav);
        wrap.appendChild(body);
        box.appendChild(wrap);
      } else if (msg.htmlTable) {
        const wrap = document.createElement('div'); wrap.innerHTML = msg.content; box.appendChild(wrap);
      } else {
        const body = document.createElement('div'); this.renderMessageContent(body, msg.content || ''); box.appendChild(body);
      }
      div.appendChild(box);
      messages.appendChild(div);
    });
    this.scrollToBottomIfNear(near);
  },

  isNearBottom() {
    const m = document.getElementById('messages'); if (!m) return true;
    return (m.scrollHeight - m.scrollTop - m.clientHeight) < 140;
  },

  scrollToBottomIfNear(nearOrForce = false) {
    const m = document.getElementById('messages'); if (!m) return;
    if (nearOrForce === true) m.scrollTop = m.scrollHeight;
  },

  addLoading() {
    const m = document.getElementById('messages'); if (!m) return;
    const d = document.createElement('div'); d.className='message assistant'; d.id='loadingMsg'; d.innerHTML='<div class="loading"><span></span><span></span><span></span></div>';
    m.appendChild(d); m.scrollTop = m.scrollHeight;
  },

  removeLoading() { document.getElementById('loadingMsg')?.remove(); },

  setGeneratingUI(isGenerating) {
    const sendBtn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (sendBtn) sendBtn.style.display = isGenerating ? 'none' : '';
    if (stopBtn) stopBtn.style.display = isGenerating ? '' : 'none';
  },

  stopGeneration() {
    if (!this.state.isGenerating) return;
    this.state.abortedRuns[this.state.runId] = true;
    this.state.abortedRuns['subagents:' + this.state.runId] = true;
    this.state.isGenerating = false;
    this.setGeneratingUI(false);
    this.removeLoading();
  },

  getTemperature() { return parseFloat(document.getElementById('temperature')?.value || '0.7') || 0.7; },
  getMaxTokens() { return parseInt(document.getElementById('maxTokens')?.value || '4096', 10) || 4096; },
  getMultiCutoffMs() { return Math.max(500, Math.round((parseFloat(document.getElementById('multiCutoffSec')?.value || String(this.state.multiCutoffSec || 5)) || 5) * 1000)); },
  getMaxGradedModels() { return Math.max(1, this.state.multiModels.length || 1); },
  getGradingPrompt() { return document.getElementById('gradingPrompt')?.value || 'Rate responses and return JSON array.'; },

  updateTokenStats() {
    localStorage.setItem('or_total_in', String(this.state.totalInputTokens));
    localStorage.setItem('or_total_out', String(this.state.totalOutputTokens));
    const el = document.getElementById('tokenStats'); if (el) el.textContent = `Tokens: ${this.state.totalInputTokens} (in) / ${this.state.totalOutputTokens} (out)`;
  },

  updateDebugConsoleVisibility() {
    const el = document.getElementById('debugConsole');
    if (!el) return;
    el.style.display = this.state.debugConsoleVisible ? 'block' : 'none';
  },

  applyTheme() {
    const next = this.state.theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
  },

  addSystemNotice(text) {
    let chat = this.getCurrentChat();
    if (!chat) { this.newChat(); chat = this.getCurrentChat(); }
    chat.messages.push({ role: 'assistant', model: 'System', content: String(text || '') });
    this.persistChats();
    this.renderMessages();
  },

  buildChatCompression(chat) {
    const msgs = Array.isArray(chat?.messages) ? chat.messages : [];
    const cleaned = msgs
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const model = m.model && m.role === 'assistant' ? ` [${m.model}]` : '';
        const content = String(m.content || '').replace(/\s+/g, ' ').trim();
        return `${role}${model}: ${content}`;
      })
      .filter(Boolean);

    if (!cleaned.length) return 'No prior chat content to compress.';

    // Keep a manageable compact context size.
    const compact = cleaned.join('\n').slice(0, 12000);
    return [
      'Compressed conversation context:',
      compact,
      '',
      'Instruction: Use this as prior context for future replies.'
    ].join('\n');
  },

  getGoalSystemPrompt() {
    const goal = String(this.state.goalPrompt || '').trim();
    if (!goal) return '';
    return `Persistent goal: ${goal}\nBefore finalizing each response, silently self-check whether your answer meets this goal. If it does not, improve it before returning.`;
  },

  getSlashCommands() {
    return [
      { cmd: '/compress', desc: 'Compact current chat into a single context message.' },
      { cmd: '/plan ', desc: 'Ask the model to plan step-by-step before implementation.' },
      { cmd: '/goal ', desc: 'Set a persistent response goal used for self-checking.' },
      { cmd: '/goal clear', desc: 'Clear the persistent goal.' },
      { cmd: '/quiz ', desc: 'Generate questions and open SAT Quiz.' },
      { cmd: '/clear', desc: 'Clear all messages in current chat.' }
    ];
  },

  buildQuizGenerationPrompt(topic) {
    const t = String(topic || 'mixed practice quiz').trim();
    return [
      'You are a highly specific, supportive tutor and test-prep coach.',
      `The student says: "I am going to take a test about: ${t}. Help me study and create a practice quiz."`,
      'Build a focused practice quiz based on that exact request.',
      'The spec can include question type, topic, length, and example style. Follow it closely.',
      'Return ONLY valid JSON (no markdown fences, no commentary).',
      'Schema: {"title":"string","questions":[{"text":"string","options":["A","B","C","D"],"correctIdx":0-3,"explanation":"string","domain":"Math or Reading and Writing","skill":"string","difficulty":"Easy/Medium/Hard"}]}',
      'Rules: exactly 4 options each, one correct answer, concise explanation that teaches the student. If no length is specified, default to 6 questions.'
    ].join('\n');
  },

  normalizeQuizPayload(raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const qs = Array.isArray(parsed?.questions) ? parsed.questions : [];
    const out = qs.map((q, i) => {
      const options = Array.isArray(q?.options) ? q.options.slice(0, 4).map((x) => String(x || '').replace(/^\s*[A-Da-d]\s*[\)\].:\-]\s*/, '').trim()) : [];
      while (options.length < 4) options.push(`Option ${String.fromCharCode(65 + options.length)}`);
      const correctIdx = Math.max(0, Math.min(3, Number(q?.correctIdx)));
      return {
        num: i + 1,
        text: String(q?.text || `Question ${i + 1}`),
        options,
        optionLetters: ['A', 'B', 'C', 'D'],
        correctIdx,
        correctAnswer: ['A', 'B', 'C', 'D'][correctIdx],
        explanation: String(q?.explanation || 'No explanation provided.'),
        domain: String(q?.domain || ''),
        skill: String(q?.skill || ''),
        difficulty: String(q?.difficulty || '')
      };
    }).filter((q) => q.text && q.options.length === 4);
    return {
      title: String(parsed?.title || 'AI SAT Quiz'),
      questions: out
    };
  },

  openSatQuizWithQuestions(payload) {
    try {
      localStorage.setItem('sat_quiz_injected', JSON.stringify(payload));
      window.open('sat-quiz.html', '_blank');
      return true;
    } catch (_) {
      return false;
    }
  },

  attachQuizScoreBridge() {
    if (this._quizScoreBridgeAttached) return;
    this._quizScoreBridgeAttached = true;
    if (!this._processedQuizPayloadKeys) this._processedQuizPayloadKeys = new Set();
    const consumeQuizPayload = async (data) => {
      if (!data || data.type !== 'sat_quiz_finished') return false;
      const payloadKey = (() => {
        try {
          return JSON.stringify({
            type: data.type,
            title: data.title || '',
            score: data.score || {},
            details: Array.isArray(data.details) ? data.details : []
          });
        } catch (_) {
          return `${data.type}|${data.title || ''}|${Date.now()}`;
        }
      })();
      if (this._processedQuizPayloadKeys.has(payloadKey)) return false;
      this._processedQuizPayloadKeys.add(payloadKey);
      if (this._processedQuizPayloadKeys.size > 20) {
        const first = this._processedQuizPayloadKeys.values().next().value;
        if (first) this._processedQuizPayloadKeys.delete(first);
      }
      const s = data.score || {};
      const title = data.title || 'SAT Quiz';
      const details = Array.isArray(data.details) ? data.details : [];
      let chat = this.getCurrentChat();
      if (!chat) { this.newChat(); chat = this.getCurrentChat(); }
      const model = this.state.offline ? (this.state.offlineModel || this.state.selectedModel || 'AI') : (this.state.selectedModel || 'AI');
      chat.messages.push({ role: 'assistant', model, content: 'Reviewing your quiz results and preparing next steps...' });
      this.persistChats();
      this.renderMessages();
      try {
        const analysisPrompt = [
          'You are a supportive SAT tutor. Interpret the completed quiz results and coach the student.',
          `Quiz title: ${title}`,
          `Score: ${s.correct || 0}/${s.total || 0}`,
          `Accuracy: ${s.accuracy || 0}%`,
          `Answered: ${s.answered || 0}, Wrong: ${s.wrong || 0}`,
          'Per-question results:',
          ...(details.length ? details.map((d, i) => `${i + 1}) ${d.isCorrect ? 'Correct' : 'Incorrect'} | You: ${d.userAnswer || 'Unanswered'} | Correct: ${d.correctAnswer || '?'} | ${d.question || ''}`) : ['No per-question details available.']),
          'Provide: (1) quick performance summary, (2) top weaknesses, (3) specific next study steps, (4) suggest generating another quiz with a focused topic.'
        ].join('\n');
        const completion = await chatCompletion(model, [{ role: 'user', content: analysisPrompt }], { temperature: 0.5, max_tokens: 900, retries: this.state.singleModelRetry ? 3 : 1 });
        const content = completion?.choices?.[0]?.message?.content || 'Nice work finishing your quiz. I recommend generating another focused set to strengthen weak areas.';
        chat.messages.push({ role: 'assistant', model, content });
      } catch (_e) {
        chat.messages.push({ role: 'assistant', model, content: `You scored ${s.correct || 0}/${s.total || 0} (${s.accuracy || 0}%). Next: review missed questions, then generate a focused follow-up quiz on weak areas.` });
      }
      this.persistChats();
      this.renderMessages();
      return true;
    };
    window.addEventListener('message', (event) => {
      consumeQuizPayload(event?.data);
    });

    if (!this._quizScorePollTimer) {
      this._quizScorePollTimer = setInterval(() => {
        try {
          const raw = localStorage.getItem('sat_quiz_finished_payload');
          if (!raw) return;
          localStorage.removeItem('sat_quiz_finished_payload');
          const parsed = JSON.parse(raw);
          consumeQuizPayload(parsed);
        } catch (_) {}
      }, 700);
    }
  },

  updateSlashMenu(inputText = '') {
    const menu = document.getElementById('slashMenu');
    if (!menu) return;
    const text = String(inputText || '');
    const lines = text.split('\n');
    const firstLine = lines[0] || '';
    const slashIdx = firstLine.lastIndexOf('/');
    if (slashIdx < 0) {
      menu.style.display = 'none';
      menu.innerHTML = '';
      return;
    }

    const q = firstLine.slice(slashIdx).toLowerCase();
    const allCommands = this.getSlashCommands();
    const options = allCommands.filter((x) => x.cmd.startsWith(q) || x.cmd.includes(q));

    const qTrimmed = q.trimEnd();
    const isExactCommandMatch = allCommands.some((x) => {
      const cmd = String(x.cmd || '').toLowerCase();
      return cmd === q || cmd.trimEnd() === qTrimmed;
    });
    if (isExactCommandMatch) {
      menu.innerHTML = '';
      menu.style.display = 'none';
      return;
    }

    if (!options.length) {
      menu.innerHTML = '';
      menu.style.display = 'none';
      return;
    }

    menu.innerHTML = options.map((x) => (
      `<button type="button" class="slash-menu-item" data-cmd="${x.cmd.replace(/"/g, '&quot;')}"><span class="slash-menu-cmd">${x.cmd}</span><span class="slash-menu-desc">${x.desc}</span></button>`
    )).join('');
    menu.style.display = 'block';

    menu.querySelectorAll('.slash-menu-item').forEach((btn) => {
      btn.onclick = () => {
        const value = btn.getAttribute('data-cmd') || '';
        const input = document.getElementById('userInput');
        if (!input) return;
        const current = String(input.value || '');
        const lineArr = current.split('\n');
        const currentFirstLine = lineArr[0] || '';
        const currentSlashIdx = currentFirstLine.lastIndexOf('/');
        if (currentSlashIdx >= 0) {
          lineArr[0] = `${currentFirstLine.slice(0, currentSlashIdx)}${value}`;
          input.value = lineArr.join('\n');
        } else {
          input.value = value;
        }
        this.autoResize(input);
        this.updateSlashMenu(input.value);
        input.focus();
        try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
      };
    });
  },

  bindGlobalSlashTrigger() {
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      const inEditable = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      const input = document.getElementById('userInput');
      if (!input) return;

      // If user is already typing in another editable field, don't hijack their slash.
      if (inEditable && target !== input) return;

      // If user is in chat input, normal typing/input event will handle menu updates.
      if (target === input) return;

      event.preventDefault();
      input.focus();
      if (!input.value.trim()) input.value = '/';
      this.autoResize(input);
      this.updateSlashMenu(input.value);
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) {}
    });
  },

  async handleSlashCommand(rawInput, chat) {
    const text = String(rawInput || '').trim();
    if (!text.startsWith('/')) return false;

    const [cmdRaw, ...rest] = text.split(' ');
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(' ').trim();

    if (cmd === '/compress') {
      const compacted = this.buildChatCompression(chat);
      chat.messages = [{ role: 'assistant', model: 'System', content: compacted }];
      return { handled: true };
    }

    if (cmd === '/plan') {
      const goal = arg || 'the requested task';
      return {
        handled: false,
        transformedText: `Create a concise step-by-step plan for accomplishing this task before doing it: ${goal}. Include assumptions, edge cases, and verification steps.`
      };
    }

    if (cmd === '/goal') {
      if (!arg) {
        chat.messages.push({ role: 'assistant', model: 'System', content: 'Usage: /goal <persistent goal text>' });
      } else if (arg.toLowerCase() === 'clear' || arg.toLowerCase() === 'off' || arg.toLowerCase() === 'none') {
        this.state.goalPrompt = '';
        localStorage.removeItem('or_goal_prompt');
        chat.messages.push({ role: 'assistant', model: 'System', content: 'Goal cleared.' });
      } else {
        this.state.goalPrompt = arg.slice(0, 500);
        localStorage.setItem('or_goal_prompt', this.state.goalPrompt);
        chat.messages.push({ role: 'assistant', model: 'System', content: `Goal set: ${this.state.goalPrompt}` });
      }
      return { handled: true };
    }

    if (cmd === '/quiz') {
      const topic = arg || 'mixed practice quiz, 6 questions';
      if (!this.state.selectedModel) {
        chat.messages.push({ role: 'assistant', model: 'AI', content: 'Pick a chat model in Settings first.' });
        return { handled: true };
      }
      this.state.quizGenerating = true;
      this.updateComposerAvailability();
      const model = this.state.offline ? (this.state.offlineModel || this.state.selectedModel || 'AI') : (this.state.selectedModel || 'AI');
      const renderQuizProgress = (phase, tone = 'working') => {
        const toneClass = tone === 'done' ? 'quiz-progress-done' : tone === 'error' ? 'quiz-progress-error' : 'quiz-progress-working';
        return `<div class="quiz-progress-wrap ${toneClass}"><span class="quiz-progress-badge">${phase}</span><span class="thinking-dots" aria-label="loading"><span></span><span></span><span></span></span></div>`;
      };
      const progressMsg = { role: 'assistant', model, htmlTable: true, compactHtml: true, content: renderQuizProgress('Creating questions') };
      chat.messages.push(progressMsg);
      this.persistChats();
      this.renderMessages();
      try {
        const completion = await chatCompletion(
          model,
          [{ role: 'user', content: this.buildQuizGenerationPrompt(topic) }],
          { temperature: 0.6, max_tokens: 1800, retries: this.state.singleModelRetry ? 3 : 1 }
        );
        const content = completion?.choices?.[0]?.message?.content || '{}';
        const normalized = this.normalizeQuizPayload(content);
        if (!normalized.questions.length) throw new Error('No valid quiz questions returned.');
        progressMsg.content = renderQuizProgress('Transferring questions');
        this.persistChats();
        this.renderMessages();
        const opened = this.openSatQuizWithQuestions(normalized);
        if (!opened) throw new Error('Could not open SAT quiz window.');
        chat.messages.push({ role: 'assistant', model, content: `Quiz ready. Opened SAT Quiz with ${normalized.questions.length} questions.` });
        progressMsg.content = `<div class="quiz-progress-wrap quiz-progress-done"><span class="quiz-progress-badge">Complete</span></div>`;
      } catch (e) {
        chat.messages.push({ role: 'assistant', model, content: `Quiz generation failed: ${e?.message || e}` });
        progressMsg.content = `<div class="quiz-progress-wrap quiz-progress-error"><span class="quiz-progress-badge">Failed</span></div>`;
      } finally {
        this.state.quizGenerating = false;
        this.updateComposerAvailability();
        this.persistChats();
        this.renderMessages();
      }
      return { handled: true };
    }

    if (cmd === '/clear') {
      chat.messages = [];
      return { handled: true };
    }

    chat.messages.push({ role: 'assistant', model: 'System', content: `Unknown command: ${cmd}` });
    return { handled: true };
  },

  showThemedConfirm({ title = 'Warning', message = 'Are you sure?', confirmText = 'Confirm', cancelText = 'Cancel' } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('themedConfirmModal');
      const titleEl = document.getElementById('themedConfirmTitle');
      const msgEl = document.getElementById('themedConfirmMessage');
      const okBtn = document.getElementById('themedConfirmOkBtn');
      const cancelBtn = document.getElementById('themedConfirmCancelBtn');
      if (!modal || !titleEl || !msgEl || !okBtn || !cancelBtn) return resolve(false);

      titleEl.textContent = title;
      msgEl.textContent = message;
      okBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;
      modal.style.display = 'flex';
      requestAnimationFrame(() => modal.classList.add('open'));

      const cleanup = (val) => {
        modal.classList.remove('open');
        modal.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        modal.onclick = null;
        resolve(val);
      };

      okBtn.onclick = (e) => { e.stopPropagation(); cleanup(true); };
      cancelBtn.onclick = (e) => { e.stopPropagation(); cleanup(false); };
      modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
    });
  },

  async sendMessage() {
    this.debugLog('sendMessage()');
    if (this.state.offline && this.state.mode === 'multi') {
      this.debugLog('sendMessage: offline+multi -> popup');
      this.openOfflineMultiPopup();
      this.addSystemNotice('Offline mode does not support Multi-Grade. Switch to Single mode to continue.');
      this.updateComposerAvailability();
      return;
    }
    if (this.state.isGenerating) { this.addSystemNotice('Already generating. Press Stop or wait.'); return; }
    if (this.state.isListening) this.stopVoiceInput();
    const input = document.getElementById('userInput'); if (!input) return;
    let text = input.value.trim();
    const hasUploads = Array.isArray(this.state.pendingUploads) && this.state.pendingUploads.length > 0;
    if (!text && !hasUploads) return;
    if (!text && hasUploads) text = 'Please analyze the attached file(s).';

    this.state.awaitingQuizFollowup = false;

    let chat = this.getCurrentChat(); if (!chat) { this.newChat(); chat = this.getCurrentChat(); }
    const slashResult = await this.handleSlashCommand(text, chat);
    if (slashResult?.handled) {
      input.value = '';
      this.updateSlashMenu('');
      this.persistChats();
      this.renderChatList();
      this.renderMessages();
      return;
    }
    if (slashResult?.transformedText) text = slashResult.transformedText;

    if (!this.state.offline && !this.state.user) {
      this.addSystemNotice('Please sign in to use online model capabilities.');
      if (typeof openAuthModal === 'function') openAuthModal();
      return;
    }
    if (!this.state.offline && !this.state.apiKey) {
      const fallbackKey = await this.getDefaultApiKeyFromAppConfig();
      if (fallbackKey) {
        this.state.apiKey = fallbackKey;
        localStorage.setItem('or_api_key', fallbackKey);
        if (this.state.user?.id) this.persistApiKeyToProfile(this.state.user.id, fallbackKey);
        const settingsKey = document.getElementById('settingsApiKey');
        if (settingsKey) settingsKey.value = fallbackKey;
      } else {
        document.getElementById('apiModal').style.display='flex'; this.addSystemNotice('Add API key first.'); return;
      }
    }
    if (!this.state.selectedModel) { this.addSystemNotice('Pick a chat model in Settings first.'); return; }

    if (this.state.offline) {
      this.debugLog('sendMessage: offline mode');
      const serverOk = await this.ensureOfflineServerRunning();
      if (!serverOk) { this.removeLoading(); this.addSystemNotice('Offline server unreachable. Run offline-launcher.bat, then try again.'); this.updateComposerAvailability(); return; }
      const modelOk = await this.ensureOfflineModelReady();
      if (!modelOk) { this.removeLoading(); this.addSystemNotice('Select an offline model to continue.'); this.updateComposerAvailability(); return; }
    }

    const attachmentPrompt = this.getPendingUploadsPrompt();

    chat = this.getCurrentChat(); if (!chat) { this.newChat(); chat = this.getCurrentChat(); }
    chat.messages.push({
      role:'user',
      content:text,
      attachmentContext: attachmentPrompt || '',
      attachments: (this.state.pendingUploads || []).map((f) => ({ name: f.name, size: f.size, type: f.type }))
    });
    if (chat.title==='New Chat') chat.title = text.slice(0,40) || 'New Chat';
    chat.mode = this.state.mode || 'single';
    chat.model = this.state.selectedModel || chat.model || '';
    input.value='';
    this.updateSlashMenu('');
    this.clearPendingUploads();
    this.renderChatList();
    this.renderMessages();
    this.persistChats();
    this.addLoading();

    this.state.isGenerating = true; this.setGeneratingUI(true); this.state.runId += 1; const runId = this.state.runId; delete this.state.abortedRuns[runId];
    this.debugLog(`sendMessage: runId=${runId} mode=${this.state.mode}`);
    if (this.state.mode === 'single') this.sendSingle(chat, runId); else this.sendMulti(chat, runId);
  },

  async sendSingle(chat, runId) {
    this.debugLog('sendSingle() started');
    try {
      const preferred = this.state.offline
        ? [this.state.offlineModel || this.state.selectedModel].filter(Boolean)
        : (this.state.multiModels.length ? [...this.state.multiModels] : [this.state.selectedModel]).filter(Boolean);
      const candidates = [...new Set(preferred.length ? preferred : [this.state.selectedModel])].filter(Boolean);
      this.debugLog(`sendSingle: candidates = [${candidates.join(', ')}]`);
      if (!candidates.length) throw new Error('No candidate models configured for Single mode.');

      const history = [{ role: 'system', content: this.TOOL_PROMPT }];
      const goalPrompt = this.getGoalSystemPrompt();
      if (goalPrompt) history.push({ role: 'system', content: goalPrompt });
      if (this.state.subagentEnabled && this.state.multiModels.length) history.push({ role: 'system', content: this.getSubagentPrompt() });
      history.push(...this.buildModelHistory(chat.messages));
      const failedModels = [];
      let winner = null;
      let streamMsg = null;

      const upsertSingleStatus = (text) => {
        const statusModel = 'Single Mode Status';
        const last = chat.messages[chat.messages.length - 1];
        if (last && last.role === 'assistant' && last.model === statusModel) {
          last.content = text;
        } else {
          chat.messages.push({ role: 'assistant', model: statusModel, content: text });
        }
        this.persistChats();
        this.renderMessages();
      };

      for (const model of candidates) {
        if (this.state.abortedRuns[runId]) { this.debugLog('sendSingle: aborted'); return; }
        this.debugLog(`sendSingle: trying ${model}`);
        streamMsg = { role: 'assistant', model: `${model} (streaming)`, content: '' };
        chat.messages.push(streamMsg);
        this.persistChats();
        this.renderMessages();
        try {
          let streamedContent = '';
          await chatCompletionStream(
            model,
            history,
            { temperature: this.getTemperature(), max_tokens: this.getMaxTokens(), retries: this.state.singleModelRetry ? 3 : 1 },
            (delta) => {
    if (this.state.abortedRuns[runId] || this.state.abortedRuns['subagents:' + runId]) return;
              streamedContent += delta;
              if (streamMsg) {
                streamMsg.content = streamedContent;
                this.renderMessages();
              }
            },
            () => !!this.state.abortedRuns[runId]
          );
          if (this.state.abortedRuns[runId]) { this.debugLog('sendSingle: aborted after response'); return; }
          const rawContent = streamedContent || '';
          this.debugLog(`sendSingle: ${model} returned ${rawContent.length} chars`);
          const displayContent = this.stripSubagentTags(rawContent);
          const normalized = this.normalizeAssistantContent(displayContent);
          const fallbackNormalized = this.normalizeAssistantContent(rawContent);
          const finalContent = (normalized && normalized.trim()) || (fallbackNormalized && fallbackNormalized.trim()) || '(No content returned)';
          this.debugLog(`sendSingle: ✅ ${model} wins`);
          if (streamMsg) {
            streamMsg.model = model;
            streamMsg.content = finalContent;
          }
          winner = { model, content: finalContent, token_usage: {}, rawContent };
          break;
        } catch (err) {
          this.debugLog(`sendSingle: ❌ ${model} error: ${err?.message || err}`);
          if (streamMsg) {
            chat.messages = chat.messages.filter((m) => m !== streamMsg);
            streamMsg = null;
          }
          upsertSingleStatus(`Model ${model} errored. Retrying/switching model...`);
          failedModels.push(model);
          this.persistChats();
          this.renderMessages();
        }
      }

      if (!winner) {
        this.debugLog(`sendSingle: all failed: [${failedModels.join(', ')}]`);
        const failList = failedModels.length ? failedModels.join(', ') : 'none';
        const failureContent = this.state.transparency
          ? `Error: All single-mode model attempts failed.\nFailed models: ${failList}`
          : 'Error: All single-mode model attempts failed.';
        chat.messages.push({ role: 'assistant', model: candidates[0] || this.state.selectedModel, content: failureContent });
        this.setModelUsed(candidates[0] || this.state.selectedModel || '-');
        return;
      }

      this.debugLog(`sendSingle: winner=${winner.model}`);
      if (!streamMsg) {
        chat.messages.push({ role: 'assistant', model: winner.model, token_usage: winner.token_usage, content: `${winner.content}` });
      }
      if (failedModels.length) {
        upsertSingleStatus(`Failed models before success: ${failedModels.join(', ')}`);
      }
      this.setModelUsed(winner.model);
      if (winner.rawContent) {
        await this.handleSubagentRequests(winner.rawContent, chat, runId);
      }
    } catch (err) {
      this.debugLog(`sendSingle: top-level error: ${err?.message || err}`);
      if (!this.state.abortedRuns[runId]) chat.messages.push({ role:'assistant', content:`Error: ${err.message || err}`, model:this.state.selectedModel });
    } finally {
      this.state.isGenerating = false;
      this.setGeneratingUI(false);
      this.removeLoading();
      this.persistChats();
      this.renderMessages();
      this.debugLog('sendSingle: done');
    }
  },

  buildScoreTable(parsed, responses) {
    const byModel = {};
    responses.forEach(r => { byModel[r.model] = r; });
    const rows = (Array.isArray(parsed) ? parsed : [])
      .filter((p) => { const r = byModel[p.model]; return !!r && this.isUsableFinalVariant(r); })
      .map((p) => {
      const r = byModel[p.model] || {};
      return `<tr><td>${p.model || '-'}</td><td>${p.helpfulness ?? '-'}</td><td>${p.accuracy ?? '-'}</td><td>${p.clarity ?? '-'}</td><td>${p.specificity ?? '-'}</td><td>${p.weightedScore ?? '-'}</td><td>${r.latencyMs ?? '-'}</td></tr>`;
    }).join('');
    return `<table class="score-table"><thead><tr><th>Model</th><th>Help</th><th>Acc</th><th>Clar</th><th>Specificity</th><th>Weighted</th><th>ms</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  async sendMulti(chat, runId) {
    this.debugLog('sendMulti()');
    if (this.state.offline) {
      this.debugLog('sendMulti: offline, falling back to single');
      return this.sendSingle(chat, runId);
    }
    const gradingModel = (document.getElementById('gradingModel')?.value || this.state.gradingModel || '').trim();
    if (!gradingModel) { this.state.isGenerating = false; this.removeLoading(); return alert('Please set a grading model in settings.'); }

    const preferred = (this.state.multiModels.length ? [...this.state.multiModels] : [this.state.selectedModel]).filter(Boolean);
    const mergedPool = [...new Set(preferred)].filter((m) => m !== gradingModel);
    const initialLimit = Math.min(10, mergedPool.length);
    let candidates = mergedPool.slice(0, initialLimit);
    if (!candidates.length && this.state.selectedModel) candidates = [this.state.selectedModel];
    const reserveQueue = this.state.multiExhaustOnFailure ? mergedPool.slice(candidates.length) : [];

    const responses = [];
    const successfulByModel = {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const excludedModels = new Set();
    const runStatusByModel = {};
    const finishedAtByModel = {};
    let settledCount = 0;
    let workersDone = 0;
    let usableCount = 0;
    let collectionClosed = false;
    candidates.forEach((m) => { runStatusByModel[m] = 'queued'; });
    let liveStatusMsg = null;

      const buildRunStatusHtml = () => {
      const statusRank = (status) => {
        const s = String(status || '');
        if (s.startsWith('running') || s.startsWith('queued')) return 0;
        if (s.startsWith('completed')) return 1;
        return 2;
      };
      const cssClassFor = (status) => {
        if (String(status).startsWith('completed')) return 'done';
        if (String(status).startsWith('failed') || String(status).startsWith('excluded')) return 'failed';
        return 'running';
      };
      const orderedModels = [...candidates].sort((a, b) => {
        const sa = runStatusByModel[a] || 'queued';
        const sb = runStatusByModel[b] || 'queued';
        const ra = statusRank(sa);
        const rb = statusRank(sb);
        if (ra !== rb) return ra - rb;
        if (ra === 1) return (finishedAtByModel[b] || 0) - (finishedAtByModel[a] || 0);
        if (ra === 2) return (finishedAtByModel[a] || 0) - (finishedAtByModel[b] || 0);
        return a.localeCompare(b);
      });
      const thinkingDots = '<span class="thinking-dots" aria-label="thinking"><span></span><span></span><span></span></span>';
      const cards = orderedModels.map((m) => {
        const s = runStatusByModel[m] || 'queued';
        const cls = cssClassFor(s);
        const showThinking = s.startsWith('running') || s.startsWith('queued') || s.startsWith('retrying');
        return `<div class="run-status-card ${cls}"><div class="run-status-model">${m}</div><div class="run-status-state">${s}${showThinking ? ` ${thinkingDots}` : ''}</div></div>`;
      }).join('');
      return `<div class="run-status-wrap">${cards}</div>`;
    };

    const refreshRunStatus = () => {
      if (!liveStatusMsg) return;
      liveStatusMsg.content = buildRunStatusHtml();
      const near = this.isNearBottom();
      this.renderMessages();
      this.scrollToBottomIfNear(near);
    };

    if (this.state.transparency) {
      liveStatusMsg = { role: 'assistant', model: 'Model Run Status', content: buildRunStatusHtml(), htmlTable: true };
      chat.messages.push(liveStatusMsg);
      refreshRunStatus();
    }

    const reqs = candidates.map(async (initialModel) => {
      let model = initialModel;
      let done = false;
      while (!done) {
      const t0 = performance.now();
      let firstWordChecked = false;
      runStatusByModel[model] = 'running';
      refreshRunStatus();

      try {
        let streamedContent = '';
        await chatCompletionStream(
          model,
          (() => { const base = [{ role: 'system', content: this.TOOL_PROMPT }]; const gp = this.getGoalSystemPrompt(); if (gp) base.push({ role: 'system', content: gp }); const filtered = chat.messages.filter(m => !(m.model && String(m.model).includes('(streaming)'))); return [...base, ...this.buildModelHistory(filtered)] })(),
          { temperature: this.getTemperature(), max_tokens: this.getMaxTokens(), retries: this.state.multiModelRetries[model] ? 3 : 1 },
          (delta) => {
            if (this.state.abortedRuns[runId]) return;
            streamedContent += delta;
            if (!firstWordChecked) {
              const trimmed = streamedContent.trim();
              if (trimmed.length > 0) {
                firstWordChecked = true;
                if (this.firstWordIsError(trimmed)) {
                  excludedModels.add(model);
                  runStatusByModel[model] = 'excluded (error-like start)';
                  refreshRunStatus();
                  return;
                }
              }
            }
          },
          () => !!this.state.abortedRuns[runId]
        );
        if (this.state.abortedRuns[runId]) return;
        if (excludedModels.has(model)) return;
        let normalized = this.normalizeAssistantContent(streamedContent || '');
        let isErr = this.isErrorLikeResponse(normalized);
        if (isErr) {
          const delayMs = this.parseRetryDelayMs(normalized);
          if (delayMs && !this.state.abortedRuns[runId]) {
            runStatusByModel[model] = `retrying in ${Math.ceil(delayMs / 1000)}s`;
            refreshRunStatus();
            await sleep(delayMs);
            try {
              let retryStreamedContent = '';
              await chatCompletionStream(
                model,
                (() => { const base = [{ role: 'system', content: this.TOOL_PROMPT }]; const gp = this.getGoalSystemPrompt(); if (gp) base.push({ role: 'system', content: gp }); return [...base, ...this.buildModelHistory(chat.messages)]; })(),
                { temperature: this.getTemperature(), max_tokens: this.getMaxTokens(), retries: 1 },
                (delta) => { if (!this.state.abortedRuns[runId]) retryStreamedContent += delta; },
                () => !!this.state.abortedRuns[runId]
              );
              const retryNormalized = this.normalizeAssistantContent(retryStreamedContent || '');
              const retryErr = this.isErrorLikeResponse(retryNormalized);
              if (!retryErr) { normalized = retryNormalized; isErr = false; }
            } catch (retryErr) {}
          }
        }
        const resultObj = { model, content: normalized, usage: {}, latencyMs: Math.round(performance.now()-t0), isError: isErr };
        if (!collectionClosed) responses.push(resultObj);
        else runStatusByModel[model] = 'completed (late)';
        runStatusByModel[model] = isErr ? 'completed (error-like content)' : 'completed';
        finishedAtByModel[model] = Date.now();
        if (!isErr) { usableCount += 1; successfulByModel[model] = resultObj; }
        refreshRunStatus();
        if (isErr && reserveQueue.length) {
          const nextModel = reserveQueue.shift();
          runStatusByModel[nextModel] = 'queued';
          refreshRunStatus();
          model = nextModel;
          continue;
        }
        done = true;
      } catch (e) {
        if (this.state.abortedRuns[runId]) return;
        if (!collectionClosed) responses.push({ model, content: `Error from ${model}: ${e.message || e}`, usage: {}, latencyMs: Math.round(performance.now()-t0), isError: true });
        runStatusByModel[model] = 'failed';
        finishedAtByModel[model] = Date.now();
        refreshRunStatus();
        if (reserveQueue.length) {
          const nextModel = reserveQueue.shift();
          runStatusByModel[nextModel] = 'queued';
          refreshRunStatus();
          model = nextModel;
          continue;
        }
        done = true;
      } finally { settledCount += 1; }
      }
      workersDone += 1;
    });

    try {
      const minReady = Math.max(1, Math.min(3, Math.ceil(candidates.length / 2)));
      let readyAt = 0;
      while (workersDone < candidates.length) {
        if (usableCount >= minReady) { if (!readyAt) readyAt = Date.now(); if (Date.now() - readyAt >= this.getMultiCutoffMs()) break; }
        await sleep(120);
      }
      collectionClosed = true;
      const finalResponses = responses.slice();
      if (!finalResponses.length) throw new Error('No model responses returned.');

      const nonErrorResponses = finalResponses.filter((r) => this.isUsableFinalVariant(r));
      const poolForWinner = nonErrorResponses.length ? nonErrorResponses : finalResponses.filter((r) => String(r.content || '').trim());
      if (!poolForWinner.length) throw new Error('No successful model responses available.');

      const w = this.state.weights;
      const latestUserGoal = [...chat.messages].reverse().find((m) => m.role === 'user')?.content || '';
      const pack = finalResponses.map((r, i) => `[${i}] ${r.model} (latencyMs=${r.latencyMs})\n${r.content}`).join('\n\n');
      let graded = null;
      let parsed = [];
      let gradingFailed = false;
      let graderStatusMsg = null;
      const setGraderStatus = (text) => {
        if (!this.state.transparency) return;
        if (!graderStatusMsg) { graderStatusMsg = { role: 'assistant', model: 'Grader Status', content: text, htmlTable: true }; chat.messages.push(graderStatusMsg); }
        else { graderStatusMsg.content = text; }
        this.renderMessages();
      };
      setGraderStatus(`Preparing grader ${gradingModel}...`);
      try {
        const gradingMessages = [
          { role: 'system', content: this.TOOL_PROMPT },
          { role: 'system', content: `${this.getGradingPrompt()}\nYou are a strict evaluator for model responses. You MUST evaluate each response against the user's original goal/prompt.\n\nScoring rubric (1-10 each):\n- helpfulness: Does this response actually achieve the user's stated goal? Is it actionable and practically useful for that exact request?\n- accuracy: Is it factually and technically correct with sound logic and no hallucinations?\n- clarity: Is it organized, readable, and easy to follow without ambiguity?\n- specificity: How directly and completely does it satisfy the user's exact goal with concrete steps/details/edge cases?\n\nCritical rules:\n1) Do NOT use response speed/latency/time as any scoring factor.\n2) Heavily penalize responses that do not address the user's exact goal.\n3) Penalize vagueness, filler, contradictions, missing implementation detail, or unsafe guidance.\n4) Return ONLY valid JSON (no markdown, no prose).\n\nOutput schema (array sorted best-first): [{"model":"string","helpfulness":number,"accuracy":number,"clarity":number,"specificity":number,"weightedScore":number,"reason":"short specific reason tied to user goal","bestForPromptType":"short phrase"}]\n\nWeighted scoring formula: weightedScore=((helpfulness*${w.helpfulness})+(accuracy*${w.accuracy})+(clarity*${w.clarity})+(specificity*${w.speed})) / (${w.helpfulness + w.accuracy + w.clarity + w.speed})` },
          { role: 'user', content: `Original user goal/prompt:\n${latestUserGoal}\n\nGrade these candidate responses against that goal:\n\n${pack}` }
        ];
        const maxGradeAttempts = this.state.gradingModelRetry ? 3 : 1;
        let gradeAttempt = 0;
        let lastGradeErr = null;
        while (gradeAttempt < maxGradeAttempts) {
          gradeAttempt += 1;
          setGraderStatus(`Currently grading with ${gradingModel} (attempt ${gradeAttempt}/${maxGradeAttempts})...`);
          try { graded = await chatCompletion(gradingModel, gradingMessages, { temperature: 0.1, max_tokens: 1200, retries: 1 }); setGraderStatus(`✅ Grading completed with ${gradingModel}.`); break; }
          catch (e) {
            lastGradeErr = e;
            setGraderStatus(`Grader error. Retrying ${gradingModel} (${gradeAttempt + 1}/${maxGradeAttempts})...`);
          }
        }
        if (!graded) throw lastGradeErr || new Error('Grading failed');
        if (this.state.abortedRuns[runId] && finalResponses.length === 0) return;
        parsed = JSON.parse(graded?.choices?.[0]?.message?.content || '[]');
      } catch {
        gradingFailed = true;
        setGraderStatus(`❌ Grading failed on ${gradingModel}; using fallback ranking.`);
        parsed = poolForWinner.map((r, idx) => ({ model: r.model, helpfulness: 5, accuracy: 5, clarity: 5, specificity: 5, weightedScore: Math.max(1, 10 - idx), reason: idx === 0 ? 'Fallback: grading model unavailable; selected first successful response.' : 'Fallback candidate (grading unavailable).' }));
      }

      const winnerModel = Array.isArray(parsed) && parsed[0]?.model ? parsed[0].model : poolForWinner[0].model;
      const winner = poolForWinner.find((r) => r.model === winnerModel) || poolForWinner[0];
      const ordered = [];
      const listForVersions = finalResponses.filter((r) => this.isUsableFinalVariant(r));
      const fallbackVersions = Object.values(successfulByModel).filter((r) => this.isUsableFinalVariant(r));
      const versionByModel = {};
      [...listForVersions, ...fallbackVersions].forEach((r) => { if (!r?.model) return; versionByModel[r.model] = r; });
      const effectiveVersions = Object.values(versionByModel);
      if (Array.isArray(parsed) && parsed.length) {
        parsed.forEach((p) => { const found = effectiveVersions.find((r) => r.model === p.model); if (found) ordered.push(found); });
        effectiveVersions.forEach((r) => { if (!ordered.find((x) => x.model === r.model)) ordered.push(r); });
      } else { ordered.push(...effectiveVersions); }
      const gradedModels = new Set(effectiveVersions.map((r) => r.model));
      const filteredParsed = (Array.isArray(parsed) ? parsed : []).filter((p) => gradedModels.has(p.model));
      const tableParsed = filteredParsed.length ? filteredParsed : ordered.map((r, i) => ({ model: r.model, helpfulness: '-', accuracy: '-', clarity: '-', specificity: '-', weightedScore: `${Math.max(1, ordered.length - i)}` }));
      const bestVariantIndex = Math.max(0, ordered.findIndex((x) => x.model === (winner.model || winnerModel)));
      if (this.state.transparency) {
        if (liveStatusMsg) chat.messages = chat.messages.filter((m) => m !== liveStatusMsg);
        chat.messages.push({ role: 'assistant', content: winner.content || 'No content returned.', model: winner.model });
        if (ordered.length) {
          chat.messages.push({ role: 'assistant', model: 'Model Versions', variants: ordered, selectedIndex: bestVariantIndex });
        } else {
          chat.messages.push({ role:'assistant', content:'No successful non-error model versions to display.', model:'Model Versions' });
        }
        // Intentionally hidden per settings request: do not show "Recommended model for this prompt" advisory message.
        if (gradingFailed) {
          setGraderStatus(`❌ Grading failed on ${gradingModel}; fallback winner selected from successful model outputs.`);
        }
        if (this.state.showGraderTable) {
          chat.messages.push({ role:'assistant', content:this.buildScoreTable(tableParsed, effectiveVersions), model:'Score Table', htmlTable:true });
        }
      } else {
        chat.messages.push({ role:'assistant', content:winner.content || 'No content returned.', model:winner.model });
      }

      finalResponses.forEach((r) => { this.state.totalInputTokens += r.usage?.prompt_tokens || 0; this.state.totalOutputTokens += r.usage?.completion_tokens || 0; });
      this.state.totalInputTokens += graded?.usage?.prompt_tokens || 0;
      this.state.totalOutputTokens += graded?.usage?.completion_tokens || 0;
      this.updateTokenStats();
      this.setModelUsed(this.state.selectedModel || '-');
    } catch (err) {
      if (!this.state.abortedRuns[runId]) chat.messages.push({ role:'assistant', content:`Error: ${err.message || err}`, model:gradingModel });
    } finally {
      this.state.isGenerating = false;
      this.setGeneratingUI(false);
      this.removeLoading();
      this.persistChats();
      this.renderMessages();
    }
  },

  handleKey(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  },

  autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    this.updateSlashMenu(textarea.value);
  },

  async queuePendingUploads(files = []) {
    if (!Array.isArray(files) || !files.length) return;
    const maxSizeBytes = 10 * 1024 * 1024;
    const textLikeTypes = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/x-javascript'];
    for (const file of files) {
      if (!file) continue;
      if (file.size > maxSizeBytes) {
        this.showToast(`Skipped ${file.name}: max 10MB per file.`, 'warning');
        continue;
      }

      let extractedText = '';
      let extractedImageDataUrl = '';
      try {
        const mime = String(file.type || '').toLowerCase();
        const name = String(file.name || '').toLowerCase();
        const isTextLike =
          textLikeTypes.some((t) => mime.startsWith(t) || mime === t) ||
          /\.(txt|md|json|csv|log|js|ts|html|css|xml|yaml|yml)$/i.test(name);
        const isImageLike = mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|ico)$/i.test(name);
        if (isTextLike && typeof file.text === 'function') {
          extractedText = await file.text();
        }
        if (isImageLike) {
          extractedImageDataUrl = await this.fileToDataUrl(file);
        }
      } catch (e) {
        this.debugLog(`queuePendingUploads text extract warning: ${e?.message || e}`);
      }

      this.state.pendingUploads.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        file,
        textContent: extractedText,
        imageDataUrl: extractedImageDataUrl
      });

      try {
        if (this.state.user?.id && typeof prismStorage !== 'undefined' && prismStorage.addFile) {
          await prismStorage.addFile(this.state.user.id, file, 'chat-upload');
        }
      } catch (e) {
        this.debugLog(`queuePendingUploads storage warning: ${e?.message || e}`);
      }
    }
    this.renderPendingUploads();
  },

  renderPendingUploads() {
    const wrap = document.getElementById('pendingUploads');
    if (!wrap) return;
    const uploads = Array.isArray(this.state.pendingUploads) ? this.state.pendingUploads : [];
    if (!uploads.length) {
      wrap.innerHTML = '';
      wrap.style.display = 'none';
      return;
    }

    wrap.style.display = 'flex';
    wrap.innerHTML = '';
    uploads.forEach((item, index) => {
      const chip = document.createElement('div');
      chip.className = 'pending-upload-chip';
      const sizeKb = Math.max(1, Math.round((Number(item.size) || 0) / 1024));
      chip.innerHTML = `<span class="name">${item.name}</span><span class="meta">${sizeKb} KB</span>`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'pending-upload-remove';
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove file';
      removeBtn.onclick = () => this.removePendingUpload(index);
      chip.appendChild(removeBtn);
      wrap.appendChild(chip);
    });
  },

  removePendingUpload(index) {
    if (!Array.isArray(this.state.pendingUploads)) return;
    this.state.pendingUploads.splice(index, 1);
    this.renderPendingUploads();
  },

  clearPendingUploads() {
    this.state.pendingUploads = [];
    this.renderPendingUploads();
  },

  getPendingUploadsPrompt() {
    const uploads = Array.isArray(this.state.pendingUploads) ? this.state.pendingUploads : [];
    if (!uploads.length) return '';
    const lines = uploads.map((f, i) => `- ${i + 1}. ${f.name} (${Math.max(1, Math.round((Number(f.size) || 0) / 1024))} KB, ${f.type || 'unknown'})`);
    const contentBlocks = uploads
      .map((f, i) => {
        const raw = String(f?.textContent || '').trim();
        if (!raw && f?.imageDataUrl) {
          const maxImageChars = 50000;
          const img = String(f.imageDataUrl);
          const clipped = img.length > maxImageChars ? `${img.slice(0, maxImageChars)}...[truncated]` : img;
          return `File ${i + 1} (${f.name}) image data URL:\n${clipped}`;
        }
        if (!raw) return `File ${i + 1} (${f.name}): content not embedded (non-text or unreadable).`;
        const clipped = raw.length > 12000 ? `${raw.slice(0, 12000)}\n...[truncated]` : raw;
        return `File ${i + 1} (${f.name}) content:\n${clipped}`;
      })
      .join('\n\n');
    return `Attached files:\n${lines.join('\n')}\n\n${contentBlocks}\n\nPlease use the attached file content when answering.`;
  },

  async fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(file);
      } catch (e) {
        reject(e);
      }
    });
  },

  buildModelHistory(messages = []) {
    return (Array.isArray(messages) ? messages : []).map((m) => {
      if (!m || typeof m !== 'object') return m;
      if (m.role === 'user' && m.attachmentContext) {
        return {
          role: 'user',
          content: `${String(m.content || '')}\n\n${String(m.attachmentContext || '')}`
        };
      }
      return { role: m.role, content: String(m.content || '') };
    });
  },

  exportChat() {
    const chat = this.getCurrentChat(); if (!chat) return alert('No active chat to export.');
    const blob = new Blob([JSON.stringify(chat, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `chat-${chat.id}.json`; a.click(); URL.revokeObjectURL(url);
  },

  importChat(event) {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.messages)) throw new Error('Invalid format');
        if (!data.id) data.id = String(Date.now()); if (!data.createdAt) data.createdAt = new Date().toISOString(); if (!data.title) data.title = 'Imported Chat';
        const idx = this.state.chats.findIndex((c) => c.id === data.id); if (idx >= 0) this.state.chats[idx] = data; else this.state.chats.unshift(data);
        this.state.currentChatId = data.id; this.persistChats(); this.renderChatList(); this.renderMessages();
      } catch { alert('Invalid chat file.'); }
      finally { event.target.value = ''; }
    };
    reader.readAsText(file);
  },

  importChatPrompt() { document.getElementById('importFile')?.click(); },

  exportAllData() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), localStorage: {} };
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i); if (!k) continue;
      payload.localStorage[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `aichatclide-all-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
  },

  importAllData(event) {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== 'object' || !data.localStorage || typeof data.localStorage !== 'object') throw new Error('Invalid format');
        if (!confirm('Import all data and overwrite current settings/chats?')) return;
        const authKeyPattern = /^sb-.*-auth-token$/i;
        Object.entries(data.localStorage).forEach(([k, v]) => {
          // Never import auth/session tokens so current user stays signed in.
          if (authKeyPattern.test(String(k || ''))) return;
          if (typeof v === 'string') localStorage.setItem(k, v);
          else if (v == null) localStorage.removeItem(k);
          else localStorage.setItem(k, String(v));
        });
        this.state.apiKey = localStorage.getItem('or_api_key') || '';
        this.state.chats = JSON.parse(localStorage.getItem('or_chats') || '[]');
        this.state.selectedModel = localStorage.getItem('or_selected_model') || '';
        this.state.gradingModel = localStorage.getItem('or_grading_model') || 'openai/gpt-4o-mini';
        this.state.mode = localStorage.getItem('or_mode') || 'single';
        this.state.transparency = localStorage.getItem('or_transparency') !== 'false';
        this.state.multiModels = JSON.parse(localStorage.getItem('or_multi_models') || '[]');
        this.state.multiModelRetries = JSON.parse(localStorage.getItem('or_multi_model_retries') || '{}');
        this.state.multiExhaustOnFailure = localStorage.getItem('or_multi_exhaust_on_failure') !== 'false';
        this.state.showGraderTable = localStorage.getItem('or_show_grader_table') !== 'false';
        this.state.singleModelRetry = localStorage.getItem('or_single_model_retry') === 'true';
        this.state.gradingModelRetry = localStorage.getItem('or_grading_model_retry') === 'true';
        this.state.weights = {
          helpfulness: Number(localStorage.getItem('or_weight_helpfulness') || 5),
          accuracy: Number(localStorage.getItem('or_weight_accuracy') || 5),
          clarity: Number(localStorage.getItem('or_weight_clarity') || 5),
          speed: Number(localStorage.getItem('or_weight_speed') || 5),
          earlyStopCount: Number(localStorage.getItem('or_early_stop_count') || 2)
        };
        this.state.totalInputTokens = Number(localStorage.getItem('or_total_in') || 0);
        this.state.totalOutputTokens = Number(localStorage.getItem('or_total_out') || 0);
        this.state.multiCutoffSec = Number(localStorage.getItem('or_multi_cutoff_sec') || (Number(localStorage.getItem('or_multi_cutoff_ms') || 5000) / 1000));
        this.ensureActiveChat();
        this.loadSettings();
        this.updateModeButtons();
        this.updateTransparencyBadge();
        this.renderChatList();
        this.renderMessages();
        this.updateTokenStats();
        this.updateStorageUsage();
        await this.fetchAndCacheModels();
        if (this.state.user?.id && typeof prismSync !== 'undefined' && prismSync.forceSync) {
          await prismSync.forceSync();
        }
        this.debugLog('importAllData:  complete');
        alert('All data imported successfully.');
      } catch (err) { alert(`Import failed: ${err?.message || err}`); }
      finally { event.target.value = ''; }
    };
    reader.readAsText(file);
  },

  async deleteAllChats() {
    const ok = await this.showThemedConfirm({
      title: 'Chat Vault Warning',
      message: 'Delete all chats? Your settings and API key will stay safe.',
      confirmText: 'Delete Chats'
    });
    if (!ok) return;

    try {
      if (this.state.user?.id && typeof prismSync !== 'undefined' && prismSync.enqueue) {
        this.state.chats.forEach((chat) => {
          if (!chat?.id) return;
          prismSync.enqueue('chat', chat.id, { timestamp: Date.now() }, 'delete');
        });
      }
    } catch (_) {}

    this.state.chats = [];
    this.state.currentChatId = null;
    localStorage.removeItem('or_chats');
    localStorage.removeItem('or_chats_compressed');
    this.renderChatList();
    this.renderMessages();
    this.updateStorageUsage();
  },

  async deleteApiKeyWithWarnings() {
    const warned1 = await this.showThemedConfirm({
      title: 'First Warning',
      message: 'You are about to remove your OpenRouter API key. This will disable online requests until you re-enter it.',
      confirmText: 'Continue'
    });
    if (!warned1) return;
    const warned2 = await this.showThemedConfirm({
      title: 'Second Warning',
      message: 'Deleting the API key will immediately break online chat calls. Are you absolutely sure?',
      confirmText: 'Still Continue'
    });
    if (!warned2) return;
    const warned3 = await this.showThemedConfirm({
      title: 'Final Warning',
      message: 'This is your last confirmation. Delete API key now?',
      confirmText: 'Delete API Key'
    });
    if (!warned3) return;

    this.state.apiKey = '';
    localStorage.removeItem('or_api_key');
    const settingsKey = document.getElementById('settingsApiKey');
    if (settingsKey) settingsKey.value = '';
    const modalKey = document.getElementById('apiKeyInput');
    if (modalKey) modalKey.value = '';
    this.updateStorageUsage();
    await this.showThemedConfirm({
      title: ' API Key Deleted',
      message: 'API key deleted. Add a new key to use online mode again.',
      confirmText: 'OK',
      cancelText: 'OK'
    });
    const modal = document.getElementById('apiModal');
    if (modal) modal.style.display = 'flex';
  },

  async clearAllData() {
    const ok = await this.showThemedConfirm({
      title: 'Full Reset Warning',
      message: 'Clear chats and settings? Your API key will be preserved.',
      confirmText: 'Clear Data'
    });
    if (!ok) return;
    ['or_chats','or_selected_model','or_grading_model','or_mode','or_transparency','or_grading_prompt',
     'or_max_graded_models','or_temperature','or_max_tokens','or_total_in','or_total_out','or_multi_models',
     'or_weight_helpfulness','or_weight_accuracy','or_weight_clarity','or_weight_speed','or_early_stop_count',
     'or_multi_model_retries','or_single_model_retry','or_grading_model_retry','or_multi_exhaust_on_failure','or_show_grader_table'].forEach((k) => localStorage.removeItem(k));
    this.state.chats = []; this.state.currentChatId = null; this.state.selectedModel = ''; this.state.totalInputTokens = 0; this.state.totalOutputTokens = 0;
    const single = document.getElementById('singleModelSearch'); if (single) single.value = '';
    this.setModelUsed('-'); this.updateTokenStats(); this.updateStorageUsage(); this.renderChatList(); this.renderMessages(); this.scrollToBottomIfNear(true);
  }
};

window.addEventListener('DOMContentLoaded', () => {
  app.init();
  app.bindGlobalSlashTrigger();
  app.attachQuizScoreBridge();
});