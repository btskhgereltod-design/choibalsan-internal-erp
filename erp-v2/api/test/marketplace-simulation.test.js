"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MarketSimulation } = require("./fixtures/marketplace-simulation");

const expectedFailure = (code, action) => assert.throws(action, error => error?.code === code);

function buildDemoMarket() {
  const market = new MarketSimulation();
  const customers = Array.from({ length:5 }, (_, index) => market.registerActor({
    id:`customer-${index + 1}`, organizationId:`customer-org-${index + 1}`, kind:"customer", name:`Demo захиалагч ${index + 1}`
  }));
  const developers = Array.from({ length:10 }, (_, index) => market.registerActor({
    id:`developer-${index + 1}`, organizationId:`developer-org-${index + 1}`, kind:"developer", name:`Demo хөгжүүлэгч ${index + 1}`
  }));
  const requestDefinitions = [
    ["Агуулахын үлдэгдлийн систем","Агуулах","Excel үлдэгдэл зөрдөг","Нэг баталгаатай үлдэгдэлтэй болох"],
    ["Дотоод зөвшөөрлийн урсгал","Урсгал","Хүсэлт хаана гацсан нь мэдэгдэхгүй","Шат ба хугацааг хянах"],
    ["Засварын дуудлагын систем","Үйлчилгээ","Дуудлага олон сувгаар тардаг","Дуудлагаас гүйцэтгэл хүртэл хянах"],
    ["Жижиг CRM","CRM","Харилцагчийн түүх олон файлд байна","Борлуулалтын нэг урсгалтай болох"],
    ["ERP ба Google Sheets холболт","Integration","Мэдээллийг давхар шивдэг","Зөвшөөрөлтэй нэг чиглэлийн sync хийх"]
  ];
  const requests = requestDefinitions.map((definition, index) => market.createRequest(customers[index].id, {
    sourceWorkspaceId:`workspace-${index + 1}`,
    title:definition[0], category:definition[1], problem:definition[2], desiredOutcome:definition[3],
    capabilities:["Бүртгэл","Тайлан"], budgetContext:"Үнийн санал авна", period:"1–3 сар",
    acceptanceCriteria:["Захиалагчийн туршилтаар батлах"], privateEvidence:[`private-evidence-${index + 1}`]
  }));
  return { market, customers, developers, requests };
}

test("five demo customers and ten developers can exercise distinct governed market journeys", () => {
  const { market, customers, developers, requests } = buildDemoMarket();
  assert.equal(market.actors.size, 15);
  assert.equal(requests.length, 5);

  requests.forEach((request, index) => {
    market.confirmRequest(customers[index].id, request.id);
    market.publishRequest(customers[index].id, request.id);
    market.sendMessage(developers[index].id, { requestId:request.id, channel:"request_public", text:"Өгөгдлийн жишээ болон хэрэглэгчийн тоог тодруулна уу." });
    market.sendMessage(customers[index].id, { requestId:request.id, channel:"request_public", text:"Нууц өгөгдөлгүй жишгийг сонгогдсон багт өгнө." });
  });

  const proposalsByRequest = requests.map((request, requestIndex) => Array.from({ length:3 }, (_, offset) => {
    const developer = developers[(requestIndex * 2 + offset) % developers.length];
    return market.submitProposal(developer.id, request.id, {
      approach:`Аргачлал ${requestIndex + 1}.${offset + 1}`,
      price:5_000_000 + requestIndex * 500_000 + offset * 250_000,
      days:20 + requestIndex * 3 + offset,
      support:`${3 + offset} сарын support`, assumptions:["Нууц өгөгдлийг сонгогдсоны дараа авна"]
    });
  }));
  assert.equal(market.proposals.size, 15);

  market.sendMessage(developers[0].id, { requestId:requests[0].id, proposalId:proposalsByRequest[0][0].id, channel:"proposal_private", text:"Migration ажлыг тусдаа milestone болгоё." });
  market.sendMessage(customers[0].id, { requestId:requests[0].id, proposalId:proposalsByRequest[0][0].id, channel:"proposal_private", text:"Тийм, acceptance criteria-д нэмнэ." });
  market.selectProposal(customers[0].id, requests[0].id, proposalsByRequest[0][0].id);
  market.acceptAgreement(customers[0].id, requests[0].id);
  market.acceptAgreement(proposalsByRequest[0][0].developerActorId, requests[0].id);
  market.sendMessage(customers[0].id, { requestId:requests[0].id, proposalId:proposalsByRequest[0][0].id, channel:"delivery_private", text:"Pilot-д 100 барааны жишиг ашиглая." });
  market.startPilot(proposalsByRequest[0][0].developerActorId, requests[0].id);
  market.submitDelivery(proposalsByRequest[0][0].developerActorId, requests[0].id, ["pilot-demo-url", "test-result-100-items"]);
  market.acceptPilot(customers[0].id, requests[0].id);
  market.deployProduction(proposalsByRequest[0][0].developerActorId, requests[0].id);
  market.closeRequest(customers[0].id, requests[0].id);
  assert.equal(requests[0].status, "closed");
  const customerReview = market.submitReview(customers[0].id, requests[0].id, { rating:5, text:"Accepted outcome" });
  const providerReview = market.submitReview(proposalsByRequest[0][0].developerActorId, requests[0].id, { rating:5, text:"Clear customer decisions" });
  assert.equal(customerReview.verified, true);
  assert.equal(providerReview.verified, true);
  assert.equal(market.reviews.length, 2);
  expectedFailure("DUPLICATE_REVIEW", () => market.submitReview(customers[0].id, requests[0].id, { rating:4, text:"Duplicate" }));
  assert.deepEqual(market.quoteGovernanceFee(10_000_000), { amount:10_000_000, totalRate:0.09, fee:900_000, settlement:9_100_000, experimental:true });

  market.selectProposal(customers[1].id, requests[1].id, proposalsByRequest[1][1].id);
  expectedFailure("COMMERCIAL_GATE", () => market.startPilot(proposalsByRequest[1][1].developerActorId, requests[1].id));
  market.acceptAgreement(customers[1].id, requests[1].id);
  market.acceptAgreement(proposalsByRequest[1][1].developerActorId, requests[1].id);
  market.startPilot(proposalsByRequest[1][1].developerActorId, requests[1].id);
  market.sendMessage(customers[1].id, { requestId:requests[1].id, proposalId:proposalsByRequest[1][1].id, channel:"delivery_private", text:"Нэмэлт шат бол шинэ scope; тусдаа change request болгоно." });
  assert.equal(requests[1].status, "pilot");

  assert.equal(requests[2].status, "open");
  assert.equal(requests[3].status, "open");
  market.selectProposal(customers[4].id, requests[4].id, proposalsByRequest[4][2].id);
  expectedFailure("UNSELECTED_DELIVERY_ACCESS", () => market.sendMessage(proposalsByRequest[4][0].developerActorId, {
    requestId:requests[4].id, proposalId:proposalsByRequest[4][0].id, channel:"delivery_private", text:"Delivery мэдээлэл харъя"
  }));
  assert.equal(requests[4].status, "selected");

  assert.equal(market.messages.filter(message => message.channel === "request_public").length, 10);
  assert.equal(market.messages.filter(message => message.channel === "proposal_private").length, 2);
  assert.equal(market.messages.filter(message => message.channel === "delivery_private").length, 2);
  assert.ok(market.events.every((event, index) => event.sequence === index + 1));
});

test("market simulation blocks tenant-memory leaks, proposal spying and unsafe lifecycle skips", () => {
  const { market, customers, developers, requests } = buildDemoMarket();
  expectedFailure("PRIVATE_REQUEST", () => market.viewRequest(developers[0].id, requests[0].id));
  expectedFailure("REQUEST_NOT_OPEN", () => market.submitProposal(developers[0].id, requests[0].id, { approach:"Эрт санал", price:1, days:1 }));
  expectedFailure("REQUEST_OWNER_ONLY", () => market.confirmRequest(customers[1].id, requests[0].id));

  market.confirmRequest(customers[0].id, requests[0].id);
  market.publishRequest(customers[0].id, requests[0].id);
  const publicView = market.viewRequest(developers[0].id, requests[0].id);
  assert.equal(Object.hasOwn(publicView, "privateEvidence"), false);
  assert.equal(JSON.stringify(publicView).includes("private-evidence-1"), false);
  const proposalA = market.submitProposal(developers[0].id, requests[0].id, { approach:"A", price:4_000_000, days:30 });
  const proposalB = market.submitProposal(developers[1].id, requests[0].id, { approach:"B", price:5_000_000, days:25 });
  expectedFailure("PROPOSAL_PRIVATE", () => market.viewProposal(developers[1].id, proposalA.id));
  expectedFailure("DUPLICATE_PROPOSAL", () => market.submitProposal(developers[0].id, requests[0].id, { approach:"A2", price:3_000_000, days:20 }));
  expectedFailure("REQUEST_OWNER_ONLY", () => market.selectProposal(developers[0].id, requests[0].id, proposalA.id));
  market.selectProposal(customers[0].id, requests[0].id, proposalA.id);
  expectedFailure("THREAD_PRIVATE", () => market.sendMessage(developers[2].id, { requestId:requests[0].id, proposalId:proposalA.id, channel:"proposal_private", text:"Бусдын санал харъя" }));
  expectedFailure("UNSELECTED_DELIVERY_ACCESS", () => market.sendMessage(developers[1].id, { requestId:requests[0].id, proposalId:proposalB.id, channel:"delivery_private", text:"Delivery-д оръё" }));
  expectedFailure("COMMERCIAL_GATE", () => market.startPilot(developers[0].id, requests[0].id));
  market.acceptAgreement(customers[0].id, requests[0].id);
  market.acceptAgreement(developers[0].id, requests[0].id);
  market.startPilot(developers[0].id, requests[0].id);
  expectedFailure("DELIVERY_EVIDENCE_REQUIRED", () => market.acceptPilot(customers[0].id, requests[0].id));
  expectedFailure("CLOSED_OUTCOME_REQUIRED", () => market.submitReview(customers[0].id, requests[0].id, { rating:5, text:"Too early" }));
  expectedFailure("ACCEPTANCE_GATE", () => market.deployProduction(developers[0].id, requests[0].id));
});
