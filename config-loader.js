/*
  Loads public Supabase client config in this order:
  1) Existing window.PRISM_SUPABASE_CONFIG (if already set)
  2) /api/supabase-config (Vercel env-backed)
*/
(function () {
  let loadPromise = null;

  async function loadConfig() {
    if (window.PRISM_SUPABASE_CONFIG?.url && window.PRISM_SUPABASE_CONFIG?.publishableKey) {
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
      console.warn('[Prism] Supabase config loader warning:', err?.message || err);
      return window.PRISM_SUPABASE_CONFIG || null;
    }
  }

  window.prismLoadSupabaseConfig = function prismLoadSupabaseConfig() {
    if (!loadPromise) loadPromise = loadConfig();
    return loadPromise;
  };
})();
