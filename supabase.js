/* ============================================================
   PRISM AI — Supabase Client Module
   Bootstrap config → admin config → shared database
   ============================================================ */

const prismSupabase = (() => {
  // ---------- Bootstrap Config ----------
  // These are the initial hardcoded credentials that let the app
  // connect to Supabase for the first time. The admin replaces
  // these via the admin panel, and the app reads the admin's
  // config from the app_config table on every page load.
  const BOOTSTRAP_URL = '';
  const BOOTSTRAP_KEY = '';

  let client = null;
  let config = { url: '', key: '', bucket: 'user-files' };
  let ready = false;
  let readyPromise = null;
  let readyResolve = null;

  // ---------- Helpers ----------
  function getCachedConfig() {
    try {
      const cached = localStorage.getItem('prism_supabase_config');
      if (cached) return JSON.parse(cached);
    } catch (e) { /* ignore */ }
    return null;
  }

  function cacheConfig(cfg) {
    try {
      localStorage.setItem('prism_supabase_config', JSON.stringify(cfg));
    } catch (e) { /* ignore */ }
  }

  function createClient(url, key) {
    if (!window.supabase) {
      throw new Error('Supabase SDK not loaded. Include @supabase/supabase-js via CDN.');
    }
    return window.supabase.createClient(url, key);
  }

  // ---------- Init ----------
  async function init(bootstrapUrl, bootstrapKey) {
    if (ready && client) return client;

    // If init was already called, return the existing promise
    if (readyPromise) return readyPromise;

    readyPromise = new Promise(async (resolve, reject) => {
      readyResolve = resolve;

      try {
        // Step 1: Determine bootstrap credentials
        const bUrl = bootstrapUrl || BOOTSTRAP_URL;
        const bKey = bootstrapKey || BOOTSTRAP_KEY;

        if (!bUrl || !bKey) {
          // No bootstrap config — user must set up Supabase first
          ready = false;
          resolve(null);
          return;
        }

        // Step 2: Connect with bootstrap credentials
        client = createClient(bUrl, bKey);
        config = { url: bUrl, key: bKey, bucket: 'user-files' };

        // Step 3: Try to read admin-configured credentials from app_config
        try {
          const { data, error } = await client
            .from('app_config')
            .select('*')
            .single();

          if (!error && data && data.supabase_url && data.supabase_anon_key) {
            // Admin has configured credentials — switch to them
            config = {
              url: data.supabase_url,
              key: data.supabase_anon_key,
              bucket: data.storage_bucket || 'user-files'
            };
            client = createClient(config.url, config.key);
          }
        } catch (e) {
          // app_config table might not exist yet or no admin config — use bootstrap
          console.log('[Supabase] Using bootstrap config (no admin config found)');
        }

        // Step 4: Cache config for offline use
        cacheConfig(config);
        ready = true;

        console.log('[Supabase] Initialized:', config.url);
        resolve(client);
      } catch (err) {
        console.error('[Supabase] Init error:', err);
        ready = false;

        // Try cached config as fallback
        const cached = getCachedConfig();
        if (cached && cached.url && cached.key) {
          try {
            config = cached;
            client = createClient(config.url, config.key);
            ready = true;
            console.log('[Supabase] Using cached config');
            resolve(client);
            return;
          } catch (e) { /* ignore */ }
        }

        resolve(null);
      }
    });

    return readyPromise;
  }

  // ---------- Getters ----------
  function getClient() { return client; }
  function isReady() { return ready; }
  function getConfig() { return { ...config }; }

  // ---------- Auth Helpers ----------
  async function getSession() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session || null;
  }

  async function getUser() {
    const session = await getSession();
    return session?.user || null;
  }

  async function isAdmin() {
    const user = await getUser();
    if (!user) return false;
    try {
      const { data } = await client
        .from('profiles')
        .select('admin')
        .eq('id', user.id)
        .single();
      return data?.admin === true;
    } catch (e) { return false; }
  }

  // ---------- Config Management ----------
  async function getAppConfig() {
    if (!client) return null;
    try {
      const { data, error } = await client
        .from('app_config')
        .select('*')
        .single();
      if (error) return null;
      return data;
    } catch (e) { return null; }
  }

  async function updateAppConfig(updates) {
    if (!client) throw new Error('Supabase not initialized');
    const { data, error } = await client
      .from('app_config')
      .upsert({ id: 1, ...updates, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) throw error;

    // Update local config if URL/key changed
    if (updates.supabase_url && updates.supabase_anon_key) {
      config = {
        url: updates.supabase_url,
        key: updates.supabase_anon_key,
        bucket: updates.storage_bucket || 'user-files'
      };
      client = createClient(config.url, config.key);
      cacheConfig(config);
    }

    return data;
  }

  // ---------- Connection Test ----------
  async function testConnection(url, key) {
    try {
      const testClient = createClient(url, key);
      const { error } = await testClient.from('app_config').select('id').limit(1);
      // Even if table doesn't exist, no auth error means connection works
      if (error && error.code === '42P01') return { ok: true }; // table not found = connected
      if (error && error.message?.includes('JWT')) return { ok: false, error: 'Invalid API key' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---------- Public API ----------
  return {
    init,
    getClient,
    isReady,
    getConfig,
    getSession,
    getUser,
    isAdmin,
    getAppConfig,
    updateAppConfig,
    testConnection
  };
})();
