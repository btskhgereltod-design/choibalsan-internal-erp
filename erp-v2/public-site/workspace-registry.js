(function exposeWorkspaceRegistry(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OvervaWorkspaceRegistry = api;
})(typeof window !== "undefined" ? window : globalThis, function createWorkspaceRegistryApi() {
  "use strict";

  const REGISTRY_VERSION = 1;

  function emptyItem(id, now) {
    return { id, name:"Шинэ ажлын өрөө", checkpoint:null, updatedAt:now };
  }

  function normalizeRegistry(value, legacyCheckpoint, options) {
    if (value?.version === REGISTRY_VERSION && Array.isArray(value.items) && value.items.length && value.items.some(item => item.id === value.currentWorkspaceId)) return value;
    const id = options.createId();
    const now = options.now || new Date().toISOString();
    const migrated = legacyCheckpoint && options.isValidCheckpoint(legacyCheckpoint)
      ? { id, name:legacyCheckpoint.workspaceName || options.fallbackName(legacyCheckpoint), checkpoint:{ ...legacyCheckpoint, workspaceId:id }, updatedAt:legacyCheckpoint.updatedAt || now }
      : emptyItem(id, now);
    return { version:REGISTRY_VERSION, currentWorkspaceId:id, items:[migrated] };
  }

  function currentCheckpoint(registry) {
    return registry.items.find(item => item.id === registry.currentWorkspaceId)?.checkpoint || null;
  }

  function upsertCheckpoint(registryValue, checkpoint, fallbackName) {
    const registry = { ...registryValue, items:registryValue.items.map(item => ({ ...item })) };
    let item = registry.items.find(candidate => candidate.id === registry.currentWorkspaceId);
    if (!item) throw new Error("Current workspace is missing from registry");
    const stored = { ...checkpoint, workspaceId:item.id };
    item.checkpoint = stored;
    item.name = stored.workspaceName || fallbackName || item.name;
    item.updatedAt = stored.updatedAt;
    return registry;
  }

  function startNewWorkspace(registryValue, options) {
    const registry = { ...registryValue, items:registryValue.items.map(item => ({ ...item })) };
    const current = registry.items.find(item => item.id === registry.currentWorkspaceId);
    if (!current?.checkpoint) return registry;
    const id = options.createId();
    registry.currentWorkspaceId = id;
    registry.items.push(emptyItem(id, options.now || new Date().toISOString()));
    return registry;
  }

  function selectWorkspace(registryValue, workspaceId) {
    if (!registryValue.items.some(item => item.id === workspaceId)) return registryValue;
    return { ...registryValue, currentWorkspaceId:workspaceId };
  }

  return { REGISTRY_VERSION, normalizeRegistry, currentCheckpoint, upsertCheckpoint, startNewWorkspace, selectWorkspace };
});
