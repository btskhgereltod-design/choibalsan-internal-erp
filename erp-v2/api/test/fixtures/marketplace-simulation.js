"use strict";

const crypto = require("node:crypto");

class MarketSimulationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => { throw new MarketSimulationError(code, message); };
const identifier = prefix => `${prefix}-${crypto.randomUUID()}`;

class MarketSimulation {
  constructor() {
    this.actors = new Map();
    this.requests = new Map();
    this.proposals = new Map();
    this.messages = [];
    this.reviews = [];
    this.events = [];
  }

  registerActor({ id = identifier("actor"), organizationId, kind, name }) {
    if (!organizationId || !["customer", "developer"].includes(kind) || !name) fail("INVALID_ACTOR", "Actor мэдээлэл дутуу");
    if (this.actors.has(id)) fail("DUPLICATE_ACTOR", "Actor давхардсан");
    const actor = Object.freeze({ id, organizationId, kind, name, active:true });
    this.actors.set(id, actor);
    this.record("actor.registered", actor.id, { organizationId, kind });
    return actor;
  }

  actor(id) {
    const actor = this.actors.get(id);
    if (!actor?.active) fail("ACTOR_UNAVAILABLE", "Actor олдсонгүй");
    return actor;
  }

  request(id) {
    const request = this.requests.get(id);
    if (!request) fail("REQUEST_NOT_FOUND", "Хүсэлт олдсонгүй");
    return request;
  }

  createRequest(actorId, payload) {
    const actor = this.actor(actorId);
    if (actor.kind !== "customer") fail("CUSTOMER_ONLY", "Зөвхөн захиалагч хүсэлт үүсгэнэ");
    if (!payload?.title || !payload?.problem || !payload?.desiredOutcome || !payload?.sourceWorkspaceId) fail("INVALID_REQUEST", "Хүсэлтийн батлах талбар дутуу");
    const id = identifier("request");
    const request = {
      id,
      organizationId:actor.organizationId,
      ownerActorId:actor.id,
      sourceWorkspaceId:payload.sourceWorkspaceId,
      status:"draft",
      packageVersion:1,
      privateEvidence:[...(payload.privateEvidence || [])],
      confirmedPackage:Object.freeze({
        title:payload.title,
        category:payload.category,
        problem:payload.problem,
        desiredOutcome:payload.desiredOutcome,
        capabilities:[...(payload.capabilities || [])],
        budgetContext:payload.budgetContext || "Үнийн санал авна",
        period:payload.period || "Санал сонсоно",
        acceptanceCriteria:[...(payload.acceptanceCriteria || [])]
      }),
      publicSnapshot:null,
      selectedProposalId:null,
      agreement:{ customer:false, developer:false },
      deliverySubmissions:[]
    };
    this.requests.set(id, request);
    this.record("request.created", id, { actorId, status:request.status });
    return request;
  }

  confirmRequest(actorId, requestId) {
    const request = this.ownedRequest(actorId, requestId);
    if (request.status !== "draft") fail("INVALID_TRANSITION", "Зөвхөн draft хүсэлтийг батална");
    request.status = "confirmed";
    this.record("request.confirmed", request.id, { actorId, packageVersion:request.packageVersion });
    return request;
  }

  publishRequest(actorId, requestId) {
    const request = this.ownedRequest(actorId, requestId);
    if (request.status !== "confirmed") fail("UNCONFIRMED_REQUEST", "Хүн батлаагүй хүсэлтийг нийтлэхгүй");
    request.publicSnapshot = Object.freeze({ ...request.confirmedPackage, packageVersion:request.packageVersion });
    request.status = "open";
    this.record("request.published", request.id, { actorId, packageVersion:request.packageVersion });
    return request;
  }

  viewRequest(actorId, requestId) {
    const actor = this.actor(actorId);
    const request = this.request(requestId);
    if (actor.id === request.ownerActorId) return { ...request, privateEvidence:[...request.privateEvidence] };
    if (request.status === "draft" || request.status === "confirmed") fail("PRIVATE_REQUEST", "Нийтлээгүй хүсэлт харах эрхгүй");
    return { id:request.id, status:request.status, organizationId:request.organizationId, package:request.publicSnapshot };
  }

  submitProposal(actorId, requestId, terms) {
    const actor = this.actor(actorId);
    const request = this.request(requestId);
    if (actor.kind !== "developer") fail("DEVELOPER_ONLY", "Зөвхөн хөгжүүлэгч санал өгнө");
    if (actor.organizationId === request.organizationId) fail("SELF_DEALING", "Өөрийн байгууллагын хүсэлтэд санал өгөхгүй");
    if (request.status !== "open") fail("REQUEST_NOT_OPEN", "Нээлттэй хүсэлтэд л санал өгнө");
    if ([...this.proposals.values()].some(item => item.requestId === requestId && item.developerActorId === actorId)) fail("DUPLICATE_PROPOSAL", "Нэг хөгжүүлэгч нэг идэвхтэй санал өгнө");
    if (!terms?.approach || !Number.isFinite(terms?.price) || terms.price <= 0 || !Number.isInteger(terms?.days) || terms.days <= 0) fail("INVALID_PROPOSAL", "Үнэ, хугацаа, аргачлал дутуу");
    const proposal = {
      id:identifier("proposal"), requestId, developerActorId:actor.id,
      developerOrganizationId:actor.organizationId, status:"submitted",
      approach:terms.approach, price:terms.price, days:terms.days,
      support:terms.support || "Тодорхойгүй", assumptions:[...(terms.assumptions || [])]
    };
    this.proposals.set(proposal.id, proposal);
    this.record("proposal.submitted", proposal.id, { actorId, requestId });
    return proposal;
  }

  viewProposal(actorId, proposalId) {
    const actor = this.actor(actorId);
    const proposal = this.proposal(proposalId);
    const request = this.request(proposal.requestId);
    if (actor.id !== request.ownerActorId && actor.id !== proposal.developerActorId) fail("PROPOSAL_PRIVATE", "Бусдын саналын нөхцөл харах эрхгүй");
    return { ...proposal, assumptions:[...proposal.assumptions] };
  }

  sendMessage(actorId, { requestId, proposalId = null, channel, text }) {
    const actor = this.actor(actorId);
    const request = this.request(requestId);
    if (!text?.trim()) fail("EMPTY_MESSAGE", "Хоосон мессеж хадгалахгүй");
    if (channel === "request_public") {
      if (!request.publicSnapshot || !["open", "selected", "contracted", "pilot", "accepted", "production", "closed"].includes(request.status)) fail("REQUEST_NOT_VISIBLE", "Нээлттэй хүсэлтийн асуулт биш");
    } else {
      const proposal = this.proposal(proposalId);
      if (proposal.requestId !== request.id) fail("THREAD_MISMATCH", "Санал өөр хүсэлтэд хамаарна");
      const isParticipant = actor.id === request.ownerActorId || actor.id === proposal.developerActorId;
      if (!isParticipant) fail("THREAD_PRIVATE", "Хувийн хэлэлцүүлгийн оролцогч биш");
      if (channel === "delivery_private" && request.selectedProposalId !== proposal.id) fail("UNSELECTED_DELIVERY_ACCESS", "Сонгогдоогүй хөгжүүлэгч delivery thread-д орохгүй");
      if (!["proposal_private", "delivery_private"].includes(channel)) fail("INVALID_CHANNEL", "Сувгийн төрөл буруу");
    }
    const message = Object.freeze({ id:identifier("message"), requestId, proposalId, channel, actorId:actor.id, text:text.trim() });
    this.messages.push(message);
    this.record("message.sent", message.id, { actorId, requestId, proposalId, channel });
    return message;
  }

  selectProposal(actorId, requestId, proposalId) {
    const request = this.ownedRequest(actorId, requestId);
    const proposal = this.proposal(proposalId);
    if (request.status !== "open" || proposal.requestId !== request.id || proposal.status !== "submitted") fail("INVALID_SELECTION", "Санал сонгох боломжгүй");
    request.selectedProposalId = proposal.id;
    request.status = "selected";
    proposal.status = "selected";
    for (const item of this.proposals.values()) if (item.requestId === request.id && item.id !== proposal.id) item.status = "not_selected";
    this.record("proposal.selected", proposal.id, { actorId, requestId });
    return proposal;
  }

  acceptAgreement(actorId, requestId) {
    const actor = this.actor(actorId);
    const request = this.request(requestId);
    const selected = this.proposal(request.selectedProposalId);
    if (request.status !== "selected" && request.status !== "contracted") fail("NO_SELECTION", "Сонгосон саналгүй");
    if (actor.id === request.ownerActorId) request.agreement.customer = true;
    else if (actor.id === selected.developerActorId) request.agreement.developer = true;
    else fail("AGREEMENT_PARTY_ONLY", "Гэрээний тал биш");
    if (request.agreement.customer && request.agreement.developer) request.status = "contracted";
    this.record("agreement.accepted", request.id, { actorId, status:request.status });
    return request;
  }

  startPilot(actorId, requestId) {
    const request = this.request(requestId);
    const selected = this.proposal(request.selectedProposalId);
    if (actorId !== selected.developerActorId) fail("SELECTED_DEVELOPER_ONLY", "Сонгосон хөгжүүлэгч л pilot эхлүүлнэ");
    if (request.status !== "contracted") fail("COMMERCIAL_GATE", "Хоёр тал гэрээ батлаагүй");
    request.status = "pilot";
    this.record("pilot.started", request.id, { actorId });
    return request;
  }

  submitDelivery(actorId, requestId, evidence) {
    const request = this.request(requestId);
    const selected = this.proposal(request.selectedProposalId);
    if (actorId !== selected.developerActorId) fail("SELECTED_DEVELOPER_ONLY", "Only the selected provider can submit delivery evidence");
    if (request.status !== "pilot") fail("PILOT_REQUIRED", "Delivery evidence belongs to an active pilot");
    if (!Array.isArray(evidence) || !evidence.length || evidence.some(item => !String(item || "").trim())) fail("DELIVERY_EVIDENCE_REQUIRED", "At least one attributable delivery evidence item is required");
    const submission = Object.freeze({ id:identifier("delivery"), actorId, evidence:Object.freeze(evidence.map(item => String(item).trim())) });
    request.deliverySubmissions.push(submission);
    this.record("delivery.submitted", request.id, { actorId, submissionId:submission.id });
    return submission;
  }

  acceptPilot(actorId, requestId) {
    const request = this.ownedRequest(actorId, requestId);
    if (request.status !== "pilot") fail("PILOT_REQUIRED", "Pilot үр дүн гараагүй");
    if (!request.deliverySubmissions.length) fail("DELIVERY_EVIDENCE_REQUIRED", "Provider delivery evidence is required before acceptance");
    request.status = "accepted";
    this.record("pilot.accepted", request.id, { actorId });
    return request;
  }

  deployProduction(actorId, requestId) {
    const request = this.request(requestId);
    const selected = this.proposal(request.selectedProposalId);
    if (actorId !== selected.developerActorId) fail("SELECTED_DEVELOPER_ONLY", "Сонгосон хөгжүүлэгч л deployment тэмдэглэнэ");
    if (request.status !== "accepted") fail("ACCEPTANCE_GATE", "Захиалагч pilot-ыг хүлээн аваагүй");
    request.status = "production";
    this.record("production.deployed", request.id, { actorId });
    return request;
  }

  closeRequest(actorId, requestId) {
    const request = this.ownedRequest(actorId, requestId);
    if (request.status !== "production") fail("PRODUCTION_REQUIRED", "Production үр дүнгүй ажлыг хаахгүй");
    request.status = "closed";
    this.record("request.closed", request.id, { actorId });
    return request;
  }

  submitReview(actorId, requestId, { rating, text }) {
    const actor = this.actor(actorId);
    const request = this.request(requestId);
    const selected = this.proposal(request.selectedProposalId);
    if (request.status !== "closed") fail("CLOSED_OUTCOME_REQUIRED", "Only a closed accepted outcome can be reviewed");
    if (![request.ownerActorId, selected.developerActorId].includes(actor.id)) fail("REVIEW_PARTY_ONLY", "Only engagement parties can review");
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !String(text || "").trim()) fail("INVALID_REVIEW", "Rating and review text are required");
    if (this.reviews.some(review => review.requestId === requestId && review.actorId === actor.id)) fail("DUPLICATE_REVIEW", "Each party can submit one verified review");
    const review = Object.freeze({ id:identifier("review"), requestId, actorId:actor.id, side:actor.id === request.ownerActorId ? "customer" : "provider", rating, text:String(text).trim(), verified:true });
    this.reviews.push(review);
    this.record("review.submitted", review.id, { actorId, requestId, side:review.side });
    return review;
  }

  quoteGovernanceFee(amount, totalRate = 0.09) {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(totalRate) || totalRate < 0 || totalRate > 0.25) fail("INVALID_FEE_QUOTE", "Fee quote inputs are outside the pilot boundary");
    return Object.freeze({ amount, totalRate, fee:Math.round(amount * totalRate), settlement:Math.round(amount * (1 - totalRate)), experimental:true });
  }

  ownedRequest(actorId, requestId) {
    const actor = this.actor(actorId);
    const request = this.request(requestId);
    if (actor.id !== request.ownerActorId) fail("REQUEST_OWNER_ONLY", "Зөвхөн хүсэлтийн эзэмшигч энэ үйлдлийг хийнэ");
    return request;
  }

  proposal(id) {
    const proposal = this.proposals.get(id);
    if (!proposal) fail("PROPOSAL_NOT_FOUND", "Санал олдсонгүй");
    return proposal;
  }

  record(type, entityId, detail) {
    this.events.push(Object.freeze({ sequence:this.events.length + 1, type, entityId, detail:Object.freeze({ ...detail }) }));
  }
}

module.exports = { MarketSimulation, MarketSimulationError };
