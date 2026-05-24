var modelsCache = [];
var modelsLoaded = false;

async function loadModels() {
  if (modelsLoaded && modelsCache.length > 0) {
    return modelsCache;
  }
  try {
    var models = await fetchModels();
    modelsCache = models;
    modelsLoaded = true;
    return models;
  } catch (err) {
    console.error('Failed to load models:', err);
    return [];
  }
}

function searchModels(query) {
  if (!query) return modelsCache;
  var lower = query.toLowerCase();
  return modelsCache.filter(function(m) {
    return m.id.toLowerCase().includes(lower);
  });
}

function getModelById(modelId) {
  return modelsCache.find(function(m) { return m.id === modelId; });
}

function getFreeModels() {
  return modelsCache.filter(function(m) {
    var id = m.id.toLowerCase();
    return id.includes('free') || id.includes(':free');
  });
}

function modelExists(modelId) {
  return modelsCache.some(function(m) { return m.id === modelId; });
}
