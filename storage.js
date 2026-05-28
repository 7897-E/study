/* ============================================================
   PRISM AI — Storage Layer
   IndexedDB for local files + Supabase Storage for cloud
   ============================================================ */

const prismStorage = (() => {
  // ---------- IndexedDB Setup ----------
  const DB_NAME = 'prism_storage';
  const DB_VERSION = 2;
  const STORE_NAME = 'files';
  
  let db = null;
  let dbReady = false;
  let dbReadyPromise = null;
  let dbReadyResolve = null;
  
  // ---------- Init IndexedDB ----------
  function initDB() {
    if (dbReady && db) return dbReadyPromise;
    
    if (dbReadyPromise) return dbReadyPromise;
    
    dbReadyPromise = new Promise((resolve, reject) => {
      dbReadyResolve = resolve;
      
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        let store;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('user_id', 'user_id', { unique: false });
          store.createIndex('upload_type', 'upload_type', { unique: false });
          store.createIndex('created_at', 'created_at', { unique: false });
        } else {
          store = event.target.transaction.objectStore(STORE_NAME);
          if (!store.indexNames.contains('user_id')) store.createIndex('user_id', 'user_id', { unique: false });
          if (!store.indexNames.contains('upload_type')) store.createIndex('upload_type', 'upload_type', { unique: false });
          if (!store.indexNames.contains('created_at')) store.createIndex('created_at', 'created_at', { unique: false });
        }
      };
      
      request.onsuccess = (event) => {
        db = event.target.result;
        dbReady = true;
        console.log('[Storage] IndexedDB initialized');
        resolve(db);
      };
      
      request.onerror = (event) => {
        console.error('[Storage] IndexedDB error:', event.target.error);
        dbReady = false;
        resolve(null);
      };
    });
    
    return dbReadyPromise;
  }
  
  // ---------- File Operations ----------
  async function addFile(userId, file, type = 'upload') {
    await initDB();
    if (!db) throw new Error('IndexedDB not ready');
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const fileData = {
          user_id: userId,
          name: file.name,
          mime_type: file.type,
          size: file.size,
          data: event.target.result,
          upload_type: type,
          created_at: new Date().toISOString(),
          uploaded: false,
          synced: false
        };
        
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(fileData);
        
        request.onsuccess = () => {
          resolve(request.result);
        };
        
        request.onerror = (event) => {
          reject(event.target.error);
        };
      };
      
      reader.onerror = (event) => {
        reject(event.target.error);
      };
      
      // Read as binary string for small files, base64 for compatibility
      if (file.size < 1024 * 1024) { // < 1MB
        reader.readAsBinaryString(file);
      } else {
        reader.readAsDataURL(file);
      }
    });
  }
  
  async function getFile(id) {
    await initDB();
    if (!db) throw new Error('IndexedDB not ready');
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      
      request.onsuccess = () => {
        resolve(request.result);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }
  
  async function getUserFiles(userId, type = null) {
    await initDB();
    if (!db) throw new Error('IndexedDB not ready');
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.index('user_id').getAll(userId);
      
      request.onsuccess = () => {
        const all = request.result || [];
        if (!type) {
          resolve(all);
          return;
        }
        resolve(all.filter(f => (f.upload_type || f.type) === type));
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }
  
  async function deleteFile(id) {
    await initDB();
    if (!db) throw new Error('IndexedDB not ready');
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }
  
  async function clearUserFiles(userId) {
    await initDB();
    if (!db) throw new Error('IndexedDB not ready');
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('user_id');
      const range = IDBKeyRange.only(userId);
      
      // Get all keys first
      const keyRequest = index.getKeys(range);
      
      keyRequest.onsuccess = () => {
        const keys = keyRequest.result;
        if (keys.length === 0) {
          resolve();
          return;
        }
        
        // Delete each file
        const deletePromises = keys.map(key => {
          return new Promise((res, rej) => {
            const delReq = store.delete(key);
            delReq.onsuccess = res;
            delReq.onerror = (event) => rej(event.target.error);
          });
        });
        
        Promise.all(deletePromises)
          .then(() => resolve())
          .catch(rej);
      };
      
      keyRequest.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }
  
  // ---------- Supabase Storage Integration ----------
  async function uploadToSupabase(file, path) {
    const supabase = prismSupabase.getClient();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await supabase.storage
      .from('user-files')
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false
      });
      
    if (error) throw error;
    return data;
  }
  
  async function downloadFromSupabase(path) {
    const supabase = prismSupabase.getClient();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { data, error } = await supabase.storage
      .from('user-files')
      .download(path);
      
    if (error) throw error;
    return data;
  }
  
  async function getPublicUrl(path) {
    const supabase = prismSupabase.getClient();
    if (!supabase) throw new Error('Supabase not initialized');
    
    const { data } = supabase.storage
      .from('user-files')
      .getPublicUrl(path);
      
    return data.publicUrl;
  }
  
  // ---------- Sync Local Files to Supabase ----------
  async function syncLocalFiles() {
    const user = await prismSupabase.getUser();
    if (!user) return;
    
    const files = await getUserFiles(user.id);
    const unsynced = files.filter(f => !f.synced);
    
    for (const file of unsynced) {
      try {
        // Convert data back to File object
        let byteArray;
        if (typeof file.data === 'string' && file.data.startsWith('data:')) {
          const byteCharacters = atob(file.data.split(',')[1]);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          byteArray = new Uint8Array(byteNumbers);
        } else {
          const binary = file.data || '';
          const byteNumbers = new Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            byteNumbers[i] = binary.charCodeAt(i) & 0xff;
          }
          byteArray = new Uint8Array(byteNumbers);
        }

        const mimeType = file.mime_type || file.type || 'application/octet-stream';
        const blob = new Blob([byteArray], { type: mimeType });
        const fileObj = new File([blob], file.name, { type: mimeType });
        
        const path = `user-${user.id}/${Date.now()}-${file.name}`;
        await uploadToSupabase(fileObj, path);
        
        // Mark as synced
        const update = { ...file, synced: true, uploaded_at: new Date().toISOString() };
        await initDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(update);
        
        console.log(`[Storage] Synced file: ${file.name}`);
      } catch (error) {
        console.error(`[Storage] Failed to sync ${file.name}:`, error);
      }
    }
  }
  
  // ---------- Public API ----------
  return {
    initDB,
    addFile,
    getFile,
    getUserFiles,
    deleteFile,
    clearUserFiles,
    uploadToSupabase,
    downloadFromSupabase,
    getPublicUrl,
    syncLocalFiles
  };
})();
