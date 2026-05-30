/*
  Loads public Supabase client config in this order:
  1) Existing window.PRISM_SUPABASE_CONFIG (if already set)
  2) /api/supabase-config (Vercel env-backed)
*/
(function () {
  let loadPromise = null;

  function hasValidConfig() {
    return !!(window.PRISM_SUPABASE_CONFIG?.url && window.PRISM_SUPABASE_CONFIG?.publishableKey);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-prism-config-src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        if (hasValidConfig()) resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.prismConfigSrc = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function loadConfig() {
    if (hasValidConfig()) {
      return window.PRISM_SUPABASE_CONFIG;
    }

    try {
      const res = await fetch('/api/supabase-config', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load /api/supabase-config');
      const data = await res.json();
      if (data?.url && data?.publishableKey) {
        window.PRISM_SUPABASE_CONFIG = {
          url: data.url,
          publishableKey: data.publishableKey
        };
        return window.PRISM_SUPABASE_CONFIG;
      }
      throw new Error('Invalid Supabase config payload');
    } catch (err) {
      console.warn('[Prism] Supabase config API unavailable, trying local fallback:', err?.message || err);
    }

    try {
      await loadScript('supabase.config.local.js');
      if (hasValidConfig()) return window.PRISM_SUPABASE_CONFIG;
      throw new Error('supabase.config.local.js loaded but PRISM_SUPABASE_CONFIG is missing/invalid');
    } catch (fallbackErr) {
      console.warn('[Prism] Supabase local fallback unavailable:', fallbackErr?.message || fallbackErr);
      return window.PRISM_SUPABASE_CONFIG || null;
    }
  }

  window.prismLoadSupabaseConfig = function prismLoadSupabaseConfig() {
    if (!loadPromise) loadPromise = loadConfig();
    return loadPromise;
  };
})();
