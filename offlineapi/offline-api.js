// Dedicated offline API layer for local model backend
(function () {
  const OFFLINE_BASE = 'http://127.0.0.1:5000/v1';
  const LEGACY_BASE = 'http://127.0.0.1:5000';

  function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  async function switchModel(modelId) {
    const res = await fetch(OFFLINE_BASE + '/switch-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId })
    });
    if (!res.ok) throw new Error('Offline switch-model failed (' + res.status + ')');
    return res.json();
  }

  async function chatCompletion(model, messages, options) {
    options = options || {};
    try {
      const res = await fetch(OFFLINE_BASE + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 4096,
          stream: false
        })
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error('Offline chat completion failed (' + res.status + '): ' + t);
      }
      return res.json();
    } catch (_v1Err) {
      // Fallback to legacy /chat endpoint used by Ai/index.html
      const lastUser = [...(messages || [])].reverse().find((m) => m && m.role === 'user')?.content || '';
      const legacyRes = await fetch(LEGACY_BASE + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: lastUser })
      });
      if (!legacyRes.ok) {
        const t = await legacyRes.text();
        throw new Error('Offline legacy chat failed (' + legacyRes.status + '): ' + t);
      }
      const data = await legacyRes.json();
      const content = String(data?.response || '');
      return {
        id: 'offline-legacy-chat',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }
  }

  async function chatCompletionStream(model, messages, options, onDelta, shouldStop) {
    options = options || {};
    const res = await fetch(OFFLINE_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 4096,
        stream: true
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error('Offline stream failed (' + res.status + '): ' + t);
    }
    if (!res.body) throw new Error('Offline streaming not supported by browser response body.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;

    while (!done) {
      if (shouldStop && shouldStop()) {
        try { await reader.cancel(); } catch (_) {}
        break;
      }

      const chunk = await reader.read();
      done = chunk.done;
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !done });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') return;
        let parsed;
        try { parsed = JSON.parse(payload); } catch (_) { continue; }
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta && onDelta) onDelta(delta);
      }
    }
  }

  async function fetchModels() {
    try {
      const res = await fetch(OFFLINE_BASE + '/models', { method: 'GET' });
      if (!res.ok) throw new Error('Offline models fetch failed (' + res.status + ')');
      const data = await res.json();
      if (Array.isArray(data?.data)) return data.data;
      if (Array.isArray(data?.models)) return data.models;
    } catch (_e) {}

    // Legacy server fallback
    try {
      const cm = await fetch(LEGACY_BASE + '/current-model', { method: 'GET' });
      if (cm.ok) {
        const d = await cm.json();
        const running = String(d?.model_file || '').toLowerCase();
        const base = [
          { id: 'local/llama-2-7b-chat', object: 'model', owned_by: 'local' },
          { id: 'local/deepseek-llm-7b-base', object: 'model', owned_by: 'local' }
        ];
        if (running.includes('deepseek')) return [base[1], base[0]];
        return base;
      }
    } catch (_e2) {}

    return [
      { id: 'local/llama-2-7b-chat', object: 'model', owned_by: 'local' },
      { id: 'local/deepseek-llm-7b-base', object: 'model', owned_by: 'local' }
    ];
  }

  async function clearChat() {
    const res = await fetch(LEGACY_BASE + '/clear', { method: 'POST' });
    if (!res.ok) throw new Error('Offline clear failed (' + res.status + ')');
    return res.json();
  }

  async function stopServer() {
    const res = await fetch(LEGACY_BASE + '/shutdown', { method: 'POST' });
    if (!res.ok) throw new Error('Offline shutdown failed (' + res.status + ')');
    return res.json();
  }

  window.offlineApi = {
    baseUrl: OFFLINE_BASE,
    isOffline,
    switchModel,
    chatCompletion,
    chatCompletionStream,
    fetchModels,
    clearChat,
    stopServer
  };
})();
