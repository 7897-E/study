const API_BASE = 'https://openrouter.ai/api/v1';
const LOCAL_API_BASE = 'http://127.0.0.1:5000/v1';

function isOfflineMode() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function isOnlineMode() {
  return typeof navigator !== 'undefined' && navigator.onLine !== false;
}

function shouldRetryError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('500')
  );
}

/** Add random jitter (±30%) to a delay to prevent thundering-herd retries */
function addJitter(baseMs) {
  const jitterFactor = 0.7 + Math.random() * 0.6; // 0.7 to 1.3
  return Math.round(baseMs * jitterFactor);
}

/** Parse Retry-After header if present */
function parseRetryAfter(response) {
  if (!response) return null;
  const val = response.headers.get('Retry-After');
  if (!val) return null;
  const seconds = parseInt(val, 10);
  if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
  return null;
}

async function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHeaders(baseUrl) {
  const isLocal = String(baseUrl || '').startsWith(LOCAL_API_BASE);
  if (isLocal) {
    return {
      'Content-Type': 'application/json'
    };
  }

  // Online mode — same exact headers as BackUP working version
  const key = localStorage.getItem('or_api_key') || '';
  return {
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json',
    'HTTP-Referer': window.location.href,
    'X-OpenRouter-Title': 'AI Chat CLide'
  };
}

function getActiveBaseUrl() {
  // - Online / unknown  => OpenRouter web API
  // - Definitively offline => Local server
  // NOTE: navigator.onLine is unreliable in some environments.
  // If we cannot determine the online state, we default to OpenRouter.
  if (typeof navigator === 'undefined') return API_BASE;
  if (navigator.onLine === false) return LOCAL_API_BASE;
  return API_BASE;
}

function isLocalModelId(model) {
  const id = String(model || '').trim().toLowerCase();
  return id.startsWith('local/');
}

/**
 * Compute retry delay with exponential backoff + jitter.
 * - attempt is 1-based (first call doesn't retry)
 * - Each retry multiplies the base, adds jitter, and respects modelId for stagger
 */
function getRetryDelayMs(attempt, modelId) {
  // Base exponential: 1s, 2s, 4s, 8s...
  const base = 1000 * Math.pow(2, attempt - 1);
  // Add jitter to spread concurrent retries
  const jittered = addJitter(base);
  // Add per-model hash stagger so different models don't align
  const stagger = modelId ? (stringHash(modelId) % 200) : 0;
  return Math.min(jittered + stagger, 15000); // cap at 15s
}

/** Simple string hash for stagger distribution */
function stringHash(str) {
  let hash = 0;
  if (!str) return 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function debugApiLog(msg) {
  try {
    console.log('[AiChatCLide-API]', msg);
    const el = document.getElementById('debugConsole');
    if (!el) return;
    const row = document.createElement('div');
    row.className = 'debug-line';
    row.textContent = `[${new Date().toLocaleTimeString()}] [API] ${msg}`;
    el.appendChild(row);
    while (el.children.length > 200) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  } catch (_) {}
}

async function chatCompletion(model, messages, options) {
  options = options || {};
  const temperature = options.temperature || 0.7;
  const maxTokens = options.max_tokens || 4096;
  const retries = Math.max(1, Number(options.retries || 1));
  const baseUrl = isLocalModelId(model) ? LOCAL_API_BASE : getActiveBaseUrl();

  debugApiLog(`chatCompletion: ${model} | baseUrl=${baseUrl} | retries=${retries} | temperature=${temperature} | maxTokens=${maxTokens} | messages.length=${messages.length}`);

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      debugApiLog(`chatCompletion: ${model} attempt ${attempt}/${retries} — POST ${baseUrl}/chat/completions`);
      const response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: getHeaders(baseUrl),
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: temperature,
          max_tokens: maxTokens
        })
      });

      debugApiLog(`chatCompletion: ${model} attempt ${attempt} — response status=${response.status} ${response.statusText}`);
      if (!response.ok) {
        const errorText = await response.text();
        debugApiLog(`chatCompletion: ${model} attempt ${attempt} — ERROR body: ${errorText.slice(0, 300)}`);
        // Check for Retry-After header (especially for 429)
        const retryAfter = parseRetryAfter(response);
        if (retryAfter && attempt < retries) {
          debugApiLog(`chatCompletion: ${model} got Retry-After=${retryAfter}ms, will retry after wait`);
          lastError = new Error('API Error (' + response.status + '): ' + errorText);
          await waitMs(retryAfter);
          continue;
        }
        throw new Error('API Error (' + response.status + '): ' + errorText);
      }

      const json = await response.json();
      const contentLen = json?.choices?.[0]?.message?.content?.length || 0;
      const usage = json?.usage || {};
      debugApiLog(`chatCompletion: ✅ ${model} attempt ${attempt} SUCCESS | contentLength=${contentLen} | usage: in=${usage.prompt_tokens || '?'} out=${usage.completion_tokens || '?'}`);
      return json;
    } catch (err) {
      debugApiLog(`chatCompletion: ❌ ${model} attempt ${attempt} ERROR: ${err?.message || err}`);
      lastError = err;
      const canRetry = attempt < retries && shouldRetryError(err);
      if (!canRetry) {
        debugApiLog(`chatCompletion: ${model} no more retries, throwing error`);
        throw err;
      }
      const delay = getRetryDelayMs(attempt, model);
      debugApiLog(`chatCompletion: ${model} retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await waitMs(delay);
    }
  }

  debugApiLog(`chatCompletion: ${model} exhausted all retries`);
  // Fallback: if online route failed, attempt local offline API once.
  if (baseUrl === API_BASE) {
    try {
      debugApiLog(`chatCompletion: ${model} attempting LOCAL fallback -> ${LOCAL_API_BASE}/chat/completions`);
      const localRes = await fetch(LOCAL_API_BASE + '/chat/completions', {
        method: 'POST',
        headers: getHeaders(LOCAL_API_BASE),
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: temperature,
          max_tokens: maxTokens
        })
      });
      if (localRes.ok) {
        const localJson = await localRes.json();
        debugApiLog(`chatCompletion: ✅ ${model} LOCAL fallback success`);
        return localJson;
      }
      const localErr = await localRes.text();
      debugApiLog(`chatCompletion: LOCAL fallback failed (${localRes.status}): ${localErr.slice(0, 240)}`);
    } catch (fallbackErr) {
      debugApiLog(`chatCompletion: LOCAL fallback error: ${fallbackErr?.message || fallbackErr}`);
    }
  }
  // If we exhausted all retries and are offline, give an offline-specific message
  if (isOfflineMode()) {
    throw new Error('Offline mode detected and local AI server is unavailable. Run offline-launcher.bat in AiChatCLide. Last error: ' + (lastError?.message || lastError || 'Unknown error'));
  }
  throw lastError || new Error('Unknown API error');
}

async function chatCompletionStream(model, messages, options, onDelta, shouldStop) {
  options = options || {};
  const temperature = options.temperature || 0.7;
  const maxTokens = options.max_tokens || 4096;
  const retries = Math.max(1, Number(options.retries || 1));
  const baseUrl = isLocalModelId(model) ? LOCAL_API_BASE : getActiveBaseUrl();

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: getHeaders(baseUrl),
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: temperature,
          max_tokens: maxTokens,
          stream: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        // Check for Retry-After header (especially for 429)
        const retryAfter = parseRetryAfter(response);
        if (retryAfter && attempt < retries) {
          lastError = new Error('API Error (' + response.status + '): ' + errorText);
          await waitMs(retryAfter);
          continue;
        }
        throw new Error('API Error (' + response.status + '): ' + errorText);
      }

      if (!response.body) throw new Error('Streaming not supported by browser response body.');

      const reader = response.body.getReader();
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

      return;
    } catch (err) {
      lastError = err;
      const canRetry = attempt < retries && shouldRetryError(err) && !(shouldStop && shouldStop());
      if (!canRetry) throw err;
      const delay = getRetryDelayMs(attempt, model);
      await waitMs(delay);
    }
  }

  // Fallback: if online stream route failed, attempt local offline stream once.
  if (baseUrl === API_BASE) {
    try {
      debugApiLog(`chatCompletionStream: ${model} attempting LOCAL fallback -> ${LOCAL_API_BASE}/chat/completions`);
      const localRes = await fetch(LOCAL_API_BASE + '/chat/completions', {
        method: 'POST',
        headers: getHeaders(LOCAL_API_BASE),
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: temperature,
          max_tokens: maxTokens,
          stream: true
        })
      });
      if (localRes.ok && localRes.body) {
        const reader = localRes.body.getReader();
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
        debugApiLog(`chatCompletionStream: ✅ ${model} LOCAL fallback stream success`);
        return;
      }
      const localErr = await localRes.text();
      debugApiLog(`chatCompletionStream: LOCAL fallback failed (${localRes.status}): ${localErr.slice(0, 240)}`);
    } catch (fallbackErr) {
      debugApiLog(`chatCompletionStream: LOCAL fallback error: ${fallbackErr?.message || fallbackErr}`);
    }
  }

  if (isOfflineMode()) {
    throw new Error('Offline mode detected and local AI server is unavailable. Run offline-launcher.bat in AiChatCLide. Last error: ' + (lastError?.message || lastError || 'Unknown error'));
  }
  throw lastError || new Error('Unknown streaming API error');
}

async function fetchModels() {
  const baseUrl = getActiveBaseUrl();
  debugApiLog(`fetchModels: GET ${baseUrl}/models (navigator.onLine=${typeof navigator !== 'undefined' ? navigator.onLine : 'undefined'})`);
  try {
    const response = await fetch(baseUrl + '/models', {
      headers: getHeaders(baseUrl)
    });

    debugApiLog(`fetchModels: response status=${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      debugApiLog(`fetchModels: ERROR: ${errorText.slice(0, 300)}`);
      throw new Error('Failed to fetch models (' + response.status + '): ' + errorText);
    }

    const data = await response.json();
    const count = data?.data?.length || 0;
    debugApiLog(`fetchModels: ✅ success — ${count} models loaded`);
    return data.data || [];
  } catch (err) {
    if (baseUrl === API_BASE) {
      debugApiLog(`fetchModels: trying LOCAL fallback ${LOCAL_API_BASE}/models due to: ${err?.message || err}`);
      const localRes = await fetch(LOCAL_API_BASE + '/models', { headers: getHeaders(LOCAL_API_BASE) });
      if (!localRes.ok) {
        const t = await localRes.text();
        throw new Error('Failed to fetch models from online and local APIs. Local error (' + localRes.status + '): ' + t);
      }
      const localData = await localRes.json();
      const localCount = localData?.data?.length || 0;
      debugApiLog(`fetchModels: ✅ LOCAL fallback success — ${localCount} models loaded`);
      return localData.data || [];
    }
    throw err;
  }
}
