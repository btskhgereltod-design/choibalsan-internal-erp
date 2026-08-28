(function exposeConversationMemory(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OvervaConversationMemory = api;
})(typeof window !== "undefined" ? window : globalThis, function createConversationMemoryApi() {
  "use strict";

  const STORAGE_VERSION = 2;

  function append(items, item, now, limit = 12) {
    if (!item) return Array.isArray(items) ? items : [];
    return [...(Array.isArray(items) ? items : []), { ...item, recordedAt:now }].slice(-limit);
  }

  function createCheckpoint(previousValue, context, update = {}) {
    const previous = previousValue || {};
    const previousMemory = previous.memory || {};
    const now = update.now || new Date().toISOString();
    const confirmationStatus = update.confirmationStatus ?? previous.confirmationStatus ?? "pending";
    const source = context.source ? {
      name:context.source.name,
      type:context.source.type,
      size:context.source.size,
      kind:context.source.kind,
      details:context.source.details
    } : null;
    const hypothesisId = update.newHypothesis || !previous.currentHypothesisId
      ? `hypothesis:${update.idSuffix || `${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`}`
      : previous.currentHypothesisId;
    const hypothesis = {
      id:hypothesisId,
      statement:context.product,
      status:confirmationStatus,
      basis:source ? "material_and_conversation" : "conversation",
      updatedAt:now
    };
    const hypotheses = update.newHypothesis || !previous.currentHypothesisId
      ? append(previousMemory.hypotheses, hypothesis, now)
      : (previousMemory.hypotheses || []).map(item => item.id === hypothesisId ? hypothesis : item);
    const confirmed = confirmationStatus === "confirmed" && !previousMemory.confirmed?.some(item => item.id === hypothesisId)
      ? append(previousMemory.confirmed, { id:hypothesisId, statement:hypothesis.statement, decision:"accepted" }, now)
      : (previousMemory.confirmed || []);
    const plans = update.planEntry && !previousMemory.plans?.some(item => item.statement === update.planEntry.statement)
      ? append(previousMemory.plans, update.planEntry, now)
      : (previousMemory.plans || []);

    return {
      version:STORAGE_VERSION,
      guide:context.guide,
      currentHypothesisId:hypothesisId,
      lastUserText:update.lastUserText ?? previous.lastUserText ?? "",
      confirmationStatus,
      activityStatus:update.activityStatus ?? previous.activityStatus ?? "conversation",
      lastAction:update.lastAction ?? previous.lastAction ?? "",
      previewTab:update.previewTab ?? previous.previewTab ?? "product",
      requestDraftId:update.requestDraftId ?? previous.requestDraftId ?? null,
      workspaceName:update.workspaceName ?? previous.workspaceName ?? "",
      savedLocallyAt:update.savedLocallyAt ?? previous.savedLocallyAt ?? null,
      organizationProfile:update.organizationProfile ?? previous.organizationProfile ?? null,
      delivery:{ ...(previous.delivery || {}), ...(update.delivery || {}) },
      source,
      memory:{
        evidence:append(previousMemory.evidence, update.evidenceEntry, now),
        discussion:append(previousMemory.discussion, update.discussionEntry, now),
        hypotheses,
        confirmed,
        plans,
        executionVerification:previousMemory.executionVerification || [],
        checkpoint:{
          unresolved:confirmationStatus === "confirmed" ? [] : ["OVERVA-ийн урьдчилсан ойлголтыг хүн баталгаажуулах"],
          nextAction:confirmationStatus === "confirmed" ? "Preview-г шалгаад дараагийн жижиг өөрчлөлтийг сонгох" : "Урьдчилсан ойлголтыг зөв, засах зүйлтэй, эсвэл буруу гэж шийдэх",
          canonicalDataChanged:false
        }
      },
      previewActivity:append(previous.previewActivity, update.previewEntry, now),
      updatedAt:now
    };
  }

  function describeCheckpoint(checkpoint, product) {
    const memory = checkpoint.memory || {};
    const evidenceItems = memory.evidence || [];
    const latestEvidence = evidenceItems[evidenceItems.length - 1];
    const evidence = latestEvidence?.kind === "file"
      ? `${latestEvidence.name} материалыг өгсөн. `
      : latestEvidence?.text ? `“${latestEvidence.text.slice(0, 120)}” гэж тайлбарласан. `
        : checkpoint.source ? `${checkpoint.source.name} материалыг өгсөн. `
          : checkpoint.lastUserText ? `“${checkpoint.lastUserText.slice(0, 120)}” гэж тайлбарласан. ` : "";
    const previewItems = checkpoint.previewActivity || [];
    const latestPreview = previewItems[previewItems.length - 1];
    const activity = latestPreview?.label ? ` Preview дээр ${latestPreview.label} туршсан.` : "";
    const nextAction = memory.checkpoint?.nextAction || "урьдчилсан ойлголтыг шалгах";
    if (checkpoint.confirmationStatus === "confirmed") return `${evidence}${product} гэсэн ойлголтыг баталгаажуулсан.${activity} Дараагийн алхам: ${nextAction}.`;
    return `${evidence}OVERVA үүнийг ${product} байж магадгүй гэсэн урьдчилсан санал болгосон.${activity} Энэ ойлголт баталгаажаагүй тул бодит ажил эхэлсэн, үндсэн мэдээлэл өөрчлөгдсөн гэж тооцоогүй. Дараагийн аюулгүй алхам: ${nextAction}.`;
  }

  function answerMemory(checkpoint, product, focus = "overview") {
    const memory = checkpoint.memory || {};
    if (focus === "confirmed") {
      const items = memory.confirmed || [];
      return items.length ? `Баталсан ойлголт: ${items.map(item => item.statement).join(", ")}.` : "Хэрэглэгчийн баталсан ойлголт одоогоор алга. Preview болон AI-ийн санал урьдчилсан төлөвтэй байна.";
    }
    if (focus === "plan") {
      const items = memory.plans || [];
      return items.length ? `Тохирсон төлөвлөгөө: ${items.map(item => item.statement).join("; ")}. Дараагийн алхам: ${memory.checkpoint?.nextAction}` : `Баталсан төлөвлөгөө одоогоор алга. Дараагийн аюулгүй алхам: ${memory.checkpoint?.nextAction || "урьдчилсан ойлголтыг шалгах"}.`;
    }
    if (focus === "evidence") {
      const items = memory.evidence || [];
      return items.length ? `Өгсөн нотолгоо: ${items.map(item => item.kind === "file" ? item.name : `“${item.text?.slice(0, 80)}”`).join("; ")}.` : "Энэ browser-т хадгалсан нотолгоо алга.";
    }
    if (focus === "executed") {
      const items = memory.executionVerification || [];
      const previewCount = checkpoint.previewActivity?.length || 0;
      return items.length ? `Бодитоор гүйцэтгэж шалгасан ажил: ${items.map(item => item.statement).join("; ")}.` : `Бодитоор гүйцэтгэж үндсэн мэдээлэл өөрчилсөн ажил алга.${previewCount ? ` Preview дээр ${previewCount} туршилтын үйлдэл хийсэн.` : ""}`;
    }
    return describeCheckpoint(checkpoint, product);
  }

  function classifyContextIntent(value) {
    const normalized = String(value || "").toLocaleLowerCase("mn-MN").replace(/[.!?]+$/g, "").trim();
    const greeting = /^(сайн( байна)? уу|сайнуу|sain( baina)? uu|hello|hi|hey)$/.test(normalized);
    const resume = /(сүүлд|хаана зогс|юу хийж байсан|өмнөх ажил|үргэлжлүүл|svvld|suuld|haana\s+zog|yuu?\s+hiij|yu\s+hiisen|umnuh|urgelj|vrgelj)/.test(normalized);
    const confirmed = /(юу.*батал|баталгаажуулсан|yuu?.*batal|batalgaajuulsan)/.test(normalized);
    const plan = /(юу.*хийх|төлөвлөсөн|дараагийн алхам|yuu?.*hiih|tuluvlusun|daraagiin)/.test(normalized);
    const evidence = /(юу.*өгсөн|нотолгоо|ямар файл|yuu?.*ugsun|notolgoo|yamar file)/.test(normalized);
    const executed = /(юу.*хийсэн|бодит ажил|гүйцэтгэсэн|yuu?.*hiisen|bodit ajil|guitsetgesen)/.test(normalized);
    if (!greeting && !resume && !confirmed && !plan && !evidence && !executed) return null;
    return { greeting, focus:resume ? "overview" : confirmed ? "confirmed" : plan ? "plan" : evidence ? "evidence" : executed ? "executed" : "overview" };
  }

  return { STORAGE_VERSION, createCheckpoint, describeCheckpoint, answerMemory, classifyContextIntent };
});
