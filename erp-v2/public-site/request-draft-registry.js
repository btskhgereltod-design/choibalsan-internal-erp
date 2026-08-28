(function exposeRequestDraftRegistry(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OvervaRequestDraftRegistry = api;
})(typeof window !== "undefined" ? window : globalThis, function createRequestDraftRegistryApi() {
  "use strict";

  const REGISTRY_VERSION = 3;

  function isDraft(value) {
    return Boolean(
      value &&
      typeof value.id === "string" && value.id &&
      Number.isInteger(value.revision) && value.revision > 0 &&
      typeof value.packageText === "string" && value.packageText &&
      value.published === false
    );
  }

  function normalizeRegistry(value, legacyDraft, options) {
    if ((value?.version === REGISTRY_VERSION || value?.version === 2) && Array.isArray(value.items)) {
      const items = value.items.map(item => ({
        ...item,
        reviewWorkspaceId:item.reviewWorkspaceId || item.workspaceId || null,
        workspaceId:undefined,
        status:item.status || "draft"
      })).filter(isDraft);
      const currentDraftId = items.some(item => item.id === value.currentDraftId)
        ? value.currentDraftId
        : items.at(-1)?.id || null;
      return { version:REGISTRY_VERSION, currentDraftId, items };
    }

    if (!legacyDraft || legacyDraft.published !== false || !legacyDraft.packageText) {
      return { version:REGISTRY_VERSION, currentDraftId:null, items:[] };
    }

    const id = options.createId();
    const reviewWorkspaceId = options.resolveLegacyWorkspaceId?.(legacyDraft) || null;
    const migrated = {
      ...legacyDraft,
      id,
      revision:1,
      reviewWorkspaceId,
      status:"draft",
      migratedFrom:"overva.public.request.draft.v1",
      updatedAt:legacyDraft.updatedAt || legacyDraft.createdAt || options.now || new Date().toISOString()
    };
    return { version:REGISTRY_VERSION, currentDraftId:id, items:[migrated] };
  }

  function upsertDraft(registryValue, draft) {
    if (!isDraft(draft)) throw new Error("Invalid request draft");
    const registry = {
      version:REGISTRY_VERSION,
      currentDraftId:draft.id,
      items:(registryValue?.items || []).map(item => ({ ...item }))
    };
    const index = registry.items.findIndex(item => item.id === draft.id);
    if (index >= 0) {
      const previous = registry.items[index];
      if (draft.revision <= previous.revision) throw new Error("Draft revision must increase");
      registry.items[index] = { ...draft };
    } else {
      registry.items.push({ ...draft });
    }
    return registry;
  }

  function findDraftByWorkspace(registry, workspaceId) {
    return registry?.items?.find(item => item.reviewWorkspaceId === workspaceId) || null;
  }

  return { REGISTRY_VERSION, isDraft, normalizeRegistry, upsertDraft, findDraftByWorkspace };
});
