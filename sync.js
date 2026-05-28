/* ============================================================
   PRISM AI — Sync Engine
   Offline-first with conflict resolution and batched updates
   ============================================================ */

const prismSync = (() => {
  // ---------- State ----------
  const QUEUE_KEY = 'prism_sync_queue';
  const LAST_SYNC_KEY = 'prism_last_sync';
  const IS_SYNCING_KEY = 'prism_is_syncing';
  
  let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let isSyncing = false;
  let syncInterval = null;
  const SYNC_INTERVAL_MS = 30000; // 30 seconds
  const BATCH_SIZE = 10; // Max items per sync batch
  
  // ---------- Queue Management ----------
  function getQueue() {
    try {
      const queue = localStorage.getItem(QUEUE_KEY);
      return queue ? JSON.parse(queue) : [];
    } catch (e) {
      console.warn('[Sync] Could not parse queue, resetting');
      return [];
    }
  }
  
  function setQueue(queue) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error('[Sync] Could not save queue:', e);
    }
  }
  
  function enqueue(entityType, entityId, data, operation = 'upsert') {
    const queue = getQueue();
    queue.push({
      id: `${entityType}:${entityId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`,
      entityType,
      entityId,
      data,
      operation,
      timestamp: Date.now(),
      retryCount: 0
    });
    setQueue(queue);
    triggerSync();
  }
  
  function dequeue(id) {
    const queue = getQueue().filter(item => item.id !== id);
    setQueue(queue);
  }
  
  function clearQueue() {
    setQueue([]);
  }
  
  // ---------- Sync Logic ----------
  async function sync() {
    if (isSyncing || !isOnline) return;
    
    isSyncing = true;
    localStorage.setItem(IS_SYNCING_KEY, 'true');
    
    try {
      const supabase = prismSupabase.getClient();
      if (!supabase) {
        console.warn('[Sync] Supabase client not ready');
        return;
      }
      
      const queue = getQueue();
      if (queue.length === 0) {
        isSyncing = false;
        localStorage.removeItem(IS_SYNCING_KEY);
        return;
      }
      
      // Process in batches
      const batch = queue.slice(0, BATCH_SIZE);
      const remaining = queue.slice(BATCH_SIZE);
      
      console.log(`[Sync] Syncing ${batch.length} items (${remaining.length} remaining)`);
      
      // Group by entity type for efficient processing
      const grouped = {};
      batch.forEach(item => {
        if (!grouped[item.entityType]) grouped[item.entityType] = [];
        grouped[item.entityType].push(item);
      });
      
      // Process each entity type
      for (const [entityType, items] of Object.entries(grouped)) {
        try {
          await processEntityBatch(supabase, entityType, items);
        } catch (error) {
          console.error(`[Sync] Error processing ${entityType}:`, error);
          // Increment retry count for failed items
          items.forEach(item => {
            item.retryCount++;
            if (item.retryCount >= 3) {
              console.warn(`[Sync] Item ${item.id} failed 3 times, removing from queue`);
              dequeue(item.id);
            }
          });
        }
      }
      
      // Update remaining queue
      setQueue(remaining);
      
      // Update last sync time
      localStorage.setItem(LAST_SYNC_KEY, Date.now().toString());
      
      // Trigger UI update
      window.dispatchEvent(new CustomEvent('prism:sync-complete', {
        detail: { success: true, synced: batch.length }
      }));
      
    } catch (error) {
      console.error('[Sync] Sync error:', error);
      window.dispatchEvent(new CustomEvent('prism:sync-error', {
        detail: { error: error.message }
      }));
    } finally {
      isSyncing = false;
      localStorage.removeItem(IS_SYNCING_KEY);
    }
  }
  
  async function processEntityBatch(supabase, entityType, items) {
    switch (entityType) {
      case 'chat':
        await syncChats(supabase, items);
        break;
      case 'setting':
        await syncSettings(supabase, items);
        break;
      case 'profile':
        await syncProfile(supabase, items);
        break;
      case 'quiz':
        await syncQuiz(supabase, items);
        break;
      case 'file':
        await syncFileMetadata(supabase, items);
        break;
      default:
        console.warn(`[Sync] Unknown entity type: ${entityType}`);
    }
  }
  
  async function syncChats(supabase, items) {
    const user = await prismSupabase.getUser();
    const updates = items.map(item => ({
      id: item.entityId,
      user_id: user?.id || null,
      title: item.data.title || 'New Chat',
      messages: item.data.messages || [],
      model: item.data.model,
      mode: item.data.mode,
      updated_at: new Date(item.data.timestamp || Date.now()).toISOString()
    }));
    
    const { error } = await supabase
      .from('chats')
      .upsert(updates, { onConflict: 'id' });
      
    if (error) throw error;
    
    // Remove synced items from queue
    items.forEach(item => dequeue(item.id));
  }
  
  async function syncSettings(supabase, items) {
    const user = await prismSupabase.getUser();
    if (!user) return;
    
    const updates = items.map(item => ({
      user_id: user.id,
      ...item.data,
      updated_at: new Date().toISOString()
    }));
    
    const { error } = await supabase
      .from('profiles')
      .upsert(updates, { onConflict: 'user_id' });
      
    if (error) throw error;
    
    items.forEach(item => dequeue(item.id));
  }
  
  async function syncProfile(supabase, items) {
    const user = await prismSupabase.getUser();
    if (!user) return;
    
    const updates = items.map(item => ({
      user_id: user.id,
      display_name: item.data.displayName,
      updated_at: new Date().toISOString()
    }));
    
    const { error } = await supabase
      .from('profiles')
      .upsert(updates, { onConflict: 'user_id' });
      
    if (error) throw error;
    
    items.forEach(item => dequeue(item.id));
  }
  
  async function syncQuiz(supabase, items) {
    const user = await prismSupabase.getUser();
    if (!user) return;
    
    const updates = items.map(item => ({
      user_id: user.id,
      title: item.data.title,
      score: item.data.score,
      total_questions: item.data.totalQuestions,
      accuracy: item.data.accuracy,
      data: item.data,
      created_at: new Date(item.data.timestamp || Date.now()).toISOString()
    }));
    
    const { error } = await supabase
      .from('quiz_results')
      .insert(updates);
      
    if (error) throw error;
    
    items.forEach(item => dequeue(item.id));
  }
  
  async function syncFileMetadata(supabase, items) {
    const user = await prismSupabase.getUser();
    if (!user) return;
    
    const updates = items.map(item => ({
      user_id: user.id,
      file_name: item.data.name,
      file_size: item.data.size,
      file_type: item.data.type,
      uploaded_at: new Date(item.data.timestamp || Date.now()).toISOString()
    }));
    
    const { error } = await supabase
      .from('file_metadata')
      .upsert(updates, { onConflict: 'user_id,file_name' });
      
    if (error) throw error;
    
    items.forEach(item => dequeue(item.id));
  }
  
  // ---------- Connection Handling ----------
  function setOnline(status) {
    isOnline = status;
    if (isOnline) {
      triggerSync();
    }
  }
  
  function triggerSync() {
    if (isOnline && !isSyncing) {
      // Debounce sync triggers
      if (syncInterval) clearTimeout(syncInterval);
      syncInterval = setTimeout(sync, 1000); // Sync after 1 second of stability
    }
  }
  
  // ---------- Init ----------
  function init() {
    // Set initial online status
    isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    
    // Listen for online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[Sync] Online');
        setOnline(true);
      });
      window.addEventListener('offline', () => {
        console.log('[Sync] Offline');
        setOnline(false);
      });
    }
    
    // Start periodic sync
    syncInterval = setInterval(sync, SYNC_INTERVAL_MS);
    
    // Sync immediately on init if online
    if (isOnline) {
      setTimeout(sync, 1000);
    }
    
    console.log('[Sync] Initialized');
  }
  
  // ---------- Public API ----------
  return {
    init,
    enqueue,
    setOnline,
    isOnline: () => isOnline,
    isSyncing: () => isSyncing,
    getQueueSize: () => getQueue().length,
    getLastSync: () => parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10),
    forceSync: () => sync()
  };
})();
