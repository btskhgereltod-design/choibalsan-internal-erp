(function exposeWorkspaceLifecycle(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OvervaWorkspaceLifecycle = api;
})(typeof window !== "undefined" ? window : globalThis, function createWorkspaceLifecycleApi() {
  "use strict";

  const STAGES = [
    { code:"discovery", label:"Ойлгох", description:"Хэрэгцээ, нотолгоог цуглуулна" },
    { code:"builder", label:"Бүтээх", description:"Ажилладаг эхний хувилбар гаргана" },
    { code:"team_preview", label:"Багаар турших", description:"Хүмүүс бодит жишээгээр шалгана" },
    { code:"scope", label:"Хамрах хүрээ", description:"Юу хүлээлгэн өгөхийг батална" },
    { code:"commercial", label:"Нөхцөл тохирох", description:"Үнэ, гэрээ, хариуцлагыг тохирно" },
    { code:"deployment", label:"Байршуулах", description:"Орчин, өгөгдөл, аюулгүй байдлыг бэлдэнэ" },
    { code:"live", label:"Ажиллуулах", description:"Хүлээн авч, тогтвортой ажиллуулна" }
  ];

  const REQUIREMENTS = {
    discovery:[],
    builder:["Хэрэгцээ эсвэл нотолгооноос эхний таамаг гаргах"],
    team_preview:["OVERVA-ийн ойлголтыг хүн батлах", "Preview дээр дор хаяж нэг үйлдэл турших"],
    scope:["Зорилгыг батлах", "Ажлын урсгалыг батлах", "Өгөгдлийн хүрээг батлах", "Оролцогч ба эрхийг батлах", "Хүлээн авах шалгуурыг батлах"],
    commercial:["Хамрах хүрээг царцаах", "Үнийн саналыг зөвшөөрөх", "Гэрээг эрх бүхий хүн зөвшөөрөх"],
    deployment:["Байршуулах хэлбэрийг сонгох", "Аюулгүй байдлын бэлэн байдлыг шалгах", "Өгөгдөл шилжүүлэх бэлэн байдлыг шалгах"],
    live:["Байршуулалтыг техникийн хувьд баталгаажуулах", "Хэрэглэгч хүлээн авах", "Үйл ажиллагааны хариуцагч томилох", "Нөөцлөлт, сэргээх бэлэн байдлыг шалгах"]
  };

  function flags(checkpointValue) {
    const checkpoint = checkpointValue || {};
    const memory = checkpoint.memory || {};
    const delivery = checkpoint.delivery || {};
    return {
      builder:Boolean((memory.hypotheses || []).length || (memory.evidence || []).length),
      understandingConfirmed:checkpoint.confirmationStatus === "confirmed" || Boolean((memory.confirmed || []).length),
      previewTested:Boolean((checkpoint.previewActivity || []).length),
      objectiveConfirmed:Boolean(delivery.objectiveConfirmed),
      workflowConfirmed:Boolean(delivery.workflowConfirmed),
      dataScopeConfirmed:Boolean(delivery.dataScopeConfirmed),
      rolesConfirmed:Boolean(delivery.rolesConfirmed),
      acceptanceCriteriaConfirmed:Boolean(delivery.acceptanceCriteriaConfirmed),
      scopeFrozen:Boolean(delivery.scopeFrozen),
      offerAccepted:Boolean(delivery.offerAccepted),
      agreementAccepted:Boolean(delivery.agreementAccepted),
      deploymentChoice:Boolean(delivery.deploymentChoice),
      securityReady:Boolean(delivery.securityReady),
      dataReady:Boolean(delivery.dataReady),
      deploymentVerified:Boolean(delivery.deploymentVerified),
      acceptanceApproved:Boolean(delivery.acceptanceApproved),
      operationsOwner:Boolean(delivery.operationsOwner),
      backupReady:Boolean(delivery.backupReady)
    };
  }

  function completedGates(checkpoint) {
    const state = flags(checkpoint);
    return {
      discovery:true,
      builder:state.builder,
      team_preview:state.understandingConfirmed && state.previewTested,
      scope:state.objectiveConfirmed && state.workflowConfirmed && state.dataScopeConfirmed && state.rolesConfirmed && state.acceptanceCriteriaConfirmed,
      commercial:state.scopeFrozen && state.offerAccepted && state.agreementAccepted,
      deployment:Boolean(state.deploymentChoice) && state.securityReady && state.dataReady,
      live:state.deploymentVerified && state.acceptanceApproved && state.operationsOwner && state.backupReady
    };
  }

  function missingFor(code, checkpoint) {
    const state = flags(checkpoint);
    const checks = {
      builder:[state.builder],
      team_preview:[state.understandingConfirmed, state.previewTested],
      scope:[state.objectiveConfirmed, state.workflowConfirmed, state.dataScopeConfirmed, state.rolesConfirmed, state.acceptanceCriteriaConfirmed],
      commercial:[state.scopeFrozen, state.offerAccepted, state.agreementAccepted],
      deployment:[Boolean(state.deploymentChoice), state.securityReady, state.dataReady],
      live:[state.deploymentVerified, state.acceptanceApproved, state.operationsOwner, state.backupReady]
    };
    return (REQUIREMENTS[code] || []).filter((_, index) => !checks[code]?.[index]);
  }

  function deriveLifecycle(checkpoint) {
    const gates = completedGates(checkpoint);
    let currentIndex = 0;
    for (let index = 1; index < STAGES.length; index += 1) {
      if (!gates[STAGES[index].code]) break;
      currentIndex = index;
    }
    const current = STAGES[currentIndex];
    const next = STAGES[currentIndex + 1] || null;
    return {
      stages:STAGES.map((stage, index) => ({ ...stage, status:index < currentIndex ? "completed" : index === currentIndex ? "current" : "locked" })),
      current,
      next,
      missing:next ? missingFor(next.code, checkpoint) : [],
      canPublish:current.code === "live",
      gates
    };
  }

  return { STAGES, REQUIREMENTS, completedGates, missingFor, deriveLifecycle };
});
