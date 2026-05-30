/* ============================================================
   PRISM AI — Authentication Module
   Supabase Auth + localStorage fallback
   ============================================================ */

const prismAuth = (() => {
  // ---------- State ----------
  let isInitialized = false;
  let authListener = null;
  const ADMIN_CACHE_KEY = 'prism_admin_status_cache';
  let disabledGuardInProgress = false;
  let blockedNoticeShown = false;

  function showBlockedNoticeOnce() {
    if (blockedNoticeShown) return;
    blockedNoticeShown = true;
    if (window.app?.showToast) {
      window.app.showToast('Account disabled. Contact an admin.', 'error');
    }
  }

  async function assertUserNotDisabled(user) {
    const supabase = prismSupabase.getClient();
    if (!supabase || !user?.id) return true;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('set_disabled')
        .eq('id', user.id)
        .single();

      if (error) {
        // If profile is missing or unreadable, do not hard-block auth.
        // Access control should still be enforced by RLS.
        return true;
      }

      if (data?.set_disabled === true) {
        await supabase.auth.signOut();
        throw new Error('This account has been disabled. Please contact an admin.');
      }

      return true;
    } catch (e) {
      if (String(e?.message || '').toLowerCase().includes('disabled')) {
        throw e;
      }
      return true;
    }
  }

  // ---------- Init ----------
  async function init() {
    if (isInitialized) return;
    
    const supabase = prismSupabase.getClient();
    if (!supabase) {
      console.warn('[Auth] Supabase client not ready');
      return false;
    }

    // Set up auth state listener
    authListener = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[Auth] Auth state changed:', event);

      if (!disabledGuardInProgress && session?.user && event !== 'SIGNED_OUT') {
        disabledGuardInProgress = true;
        assertUserNotDisabled(session.user)
          .catch((err) => {
            console.warn('[Auth] Disabled-account guard:', err?.message || err);
            showBlockedNoticeOnce();
          })
          .finally(() => {
            disabledGuardInProgress = false;
          });
      }
      
      // Update app state with user info
      if (window.app && typeof window.app.updateUserState === 'function') {
        window.app.updateUserState(session?.user || null);
      }
      
      // Trigger custom event for other modules
      window.dispatchEvent(new CustomEvent('prism:auth-change', {
        detail: { event, session }
      }));
    });

    isInitialized = true;
    console.log('[Auth] Initialized');
    return true;
  }

  // ---------- Auth Methods ----------
  async function ensureProfile(user, fallbackDisplayName = '') {
    const supabase = prismSupabase.getClient();
    if (!supabase || !user?.id) return;

    const displayName =
      fallbackDisplayName ||
      user.user_metadata?.display_name ||
      user.email?.split('@')?.[0] ||
      'User';

    // Best-effort upsert so auth succeeds even if profile policy blocks write
    try {
      await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          display_name: displayName,
          admin: false,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });
    } catch (e) {
      console.warn('[Auth] ensureProfile failed:', e?.message || e);
    }
  }

  async function signUp(email, password, displayName) {
    const supabase = prismSupabase.getClient();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split('@')[0] }
      }
    });
    
    if (error) throw error;
    if (data?.user) {
      await ensureProfile(data.user, displayName);
    }
    return data;
  }

  async function signIn(email, password) {
    const supabase = prismSupabase.getClient();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) throw error;
    if (data?.user) {
      await ensureProfile(data.user);
      await assertUserNotDisabled(data.user);
    }
    blockedNoticeShown = false;
    return data;
  }

  async function signOut() {
    const supabase = prismSupabase.getClient();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    
    // Clear local auth-related storage
    localStorage.removeItem('prism_auth_token');
    localStorage.removeItem('prism_user_profile');
    
    return { success: true };
  }

  async function resetPassword(email) {
    const supabase = prismSupabase.getClient();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password.html`
    });
    
    if (error) throw error;
    return { success: true };
  }

  async function updatePassword(newPassword) {
    const supabase = prismSupabase.getClient();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });
    
    if (error) throw error;
    return { success: true };
  }

  async function updateEmail(newEmail) {
    const supabase = prismSupabase.getClient();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { error } = await supabase.auth.updateUser({
      email: newEmail
    });
    
    if (error) throw error;
    return { success: true };
  }

  async function getSession() {
    return prismSupabase.getSession();
  }

  async function getUser() {
    return prismSupabase.getUser();
  }

  async function isAdmin() {
    const user = await getUser();
    if (!user?.id) return false;

    try {
      const supabase = prismSupabase.getClient();
      if (!supabase) return false;
      const { data, error } = await supabase
        .from('profiles')
        .select('admin')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      const isAdminUser = data?.admin === true;
      localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify({ id: user.id, admin: isAdminUser }));
      return isAdminUser;
    } catch (e) {
      console.warn('[Auth] isAdmin query failed, using cache fallback:', e?.message || e);
      try {
        const cached = JSON.parse(localStorage.getItem(ADMIN_CACHE_KEY) || 'null');
        if (cached && cached.id === user.id) return cached.admin === true;
      } catch (_) { /* ignore */ }
      return false;
    }
  }

  // ---------- Profile Management ----------
  async function getProfile(userId) {
    const supabase = prismSupabase.getClient();
    if (!supabase || !userId) return null;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn('[Auth] Could not fetch profile:', e);
      return null;
    }
  }

  async function updateProfile(userId, updates) {
    const supabase = prismSupabase.getClient();
    if (!supabase || !userId) throw new Error('Invalid parameters');
    
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    return data;
  }

  async function uploadAvatar(userId, file) {
    const supabase = prismSupabase.getClient();
    if (!supabase || !userId || !file) throw new Error('Invalid parameters');
    
    const fileExt = file.name.split('.').pop();
    const fileName = `avatars/${userId}/${Date.now()}.${fileExt}`;
    
    const { data, error } = await supabase.storage
      .from('user-files')
      .upload(fileName, file);
    
    if (error) throw error;
    
    const { data: urlData } = supabase.storage
      .from('user-files')
      .getPublicUrl(fileName);
    
    return urlData.publicUrl;
  }

  // ---------- Public API ----------
  return {
    init,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    updateEmail,
    getSession,
    getUser,
    isAdmin,
    getProfile,
    updateProfile,
    uploadAvatar
  };
})();
