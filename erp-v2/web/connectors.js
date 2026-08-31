"use strict";

labels.connectors="Холболтууд";
state.connectors=null;
state.connectorResources={};

const connectorRenderBefore=render;
render=function(){
  if(state.view==="connectors"){
    state.view="settings";
    state.settingsTab="integrations";
  }
  return connectorRenderBefore();
};

const connectorAdjustBefore=adjustModuleNavigation;
adjustModuleNavigation=function(){
  connectorAdjustBefore();
  $("#connectorsNav")?.classList.add("hidden");
};

function connectorMark(code){
  if(code==="google-drive")return '<span class="connector-mark drive">△</span>';
  if(code==="google-sheets")return '<span class="connector-mark sheets">▦</span>';
  return '<span class="connector-mark github">●</span>';
}

function connectorStatus(item){
  if(item.connection?.status==="connected")return '<span class="connector-status connected">Холбогдсон</span>';
  if(item.connection?.status==="attention")return '<span class="connector-status attention">Анхаарах</span>';
  if(!item.available)return '<span class="connector-status setup">OAuth тохируулга хүлээж байна</span>';
  return '<span class="connector-status ready">Холбох боломжтой</span>';
}

function resourceList(code){
  const resources=state.connectorResources[code];
  if(!resources)return "";
  if(resources.loading)return '<div class="connector-resource-panel">Мэдээллийг зөвхөн уншиж байна...</div>';
  if(resources.error)return `<div class="connector-resource-panel error">${esc(resources.error)}</div>`;
  return `<div class="connector-resource-panel"><div class="connector-resource-head"><strong>Унших боломжтой мэдээлэл</strong><small>${resources.items.length} үр дүн · OVERVA-д хуулж хадгалаагүй</small></div>${resources.items.length?resources.items.map(resource=>`<a class="connector-resource" ${resource.url?`href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer"`:""}><span><strong>${esc(resource.name)}</strong><small>${esc(resource.type||"")} · ${resource.updatedAt?dateTime(resource.updatedAt):"огноогүй"}</small></span><b>↗</b></a>`).join(""):'<small class="connector-empty">Харагдах мэдээлэл олдсонгүй.</small>'}</div>`;
}

function connectorCard(item){
  const connection=item.connection;
  const actions=connection?.status==="connected"
    ? `<button class="secondary" data-connector-test="${item.code}">Уншиж шалгах</button><button class="connector-disconnect" data-connector-disconnect="${item.code}">Салгах</button>`
    : `<button class="primary" data-connector-authorize="${item.code}" ${!item.available||!state.connectors.canManage?"disabled":""}>${connection?"Дахин холбох":"Холбох"}</button>`;
  return `<article class="connector-card">
    <div class="connector-card-main">${connectorMark(item.code)}<div class="connector-copy"><div class="connector-title"><h2>${esc(item.name)}</h2>${connectorStatus(item)}</div><p>${esc(item.description)}</p><div class="connector-meta"><span>${esc(item.category)}</span><span>Зөвхөн унших</span>${connection?.external_account_name?`<span>${esc(connection.external_account_name)}</span>`:""}</div></div><div class="connector-actions">${actions}</div></div>
    ${!item.available?'<p class="connector-note">Provider-ийн OAuth client ID, secret болон token encryption key-г серверт тохируулсны дараа холбох товч идэвхжинэ.</p>':""}
    ${connection?.status==="attention"?'<p class="connector-note warning">Provider-ийн зөвшөөрөл эсвэл token-г дахин шалгах шаардлагатай.</p>':""}
    ${resourceList(item.code)}
  </article>`;
}

function renderConnectors(){
  if(!state.connectors){
    $("#pageContent").innerHTML=header("OVERVA CONNECT","Холболтууд","Байгууллагын ашигладаг үйлчилгээг зөвшөөрөлтэй, tenant-аар тусгаарласан, хяналттай сувгаар холбоно.");
    queueMicrotask(loadConnectors);
    return;
  }
  $("#pageContent").innerHTML=`${header("OVERVA CONNECT","Холболтууд","Эхний хувилбар зөвхөн уншина. Бичих, илгээх, төлбөр хийх үйлдэл одоогоор нээгдээгүй.")}
    <section class="connector-summary"><div><b>${state.connectors.items.filter(x=>x.connection?.status==="connected").length}</b><span>Холбогдсон</span></div><div><b>${state.connectors.items.filter(x=>x.available).length}</b><span>OAuth бэлэн</span></div><div><b>0</b><span>Бичих эрх</span></div></section>
    <div class="connector-grid">${state.connectors.items.map(connectorCard).join("")}</div>`;
}

function connectorsSettingsContent(){
  if(!state.connectors){queueMicrotask(loadConnectors);return '<section class="connector-card"><strong>Холболтын мэдээллийг ачаалж байна...</strong></section>'}
  return `<section class="connector-summary"><div><b>${state.connectors.items.filter(x=>x.connection?.status==="connected").length}</b><span>Холбогдсон</span></div><div><b>${state.connectors.items.filter(x=>x.available).length}</b><span>OAuth бэлэн</span></div><div><b>0</b><span>Бичих эрх</span></div></section><div class="connector-grid">${state.connectors.items.map(connectorCard).join("")}</div>`;
}

async function loadConnectors(){
  try{state.connectors=await api("/api/connectors");if(state.view==="settings"&&state.settingsTab==="integrations")render()}catch(error){toast(error.message,true)}
}

async function authorizeConnector(code,button){
  button.disabled=true;
  try{
    const result=await api(`/api/connectors/${encodeURIComponent(code)}/authorize`,{method:"POST",body:JSON.stringify({returnPath:"/?view=settings&settings_tab=integrations"})});
    location.assign(result.authorizationUrl);
  }catch(error){button.disabled=false;toast(error.message,true)}
}

async function disconnectConnector(code,button){
  if(!confirm("Энэ холболтын хадгалсан token-г устгаж, салгах уу?"))return;
  button.disabled=true;
  try{await api(`/api/connectors/${encodeURIComponent(code)}`,{method:"DELETE"});state.connectors=null;delete state.connectorResources[code];await loadConnectors();toast("Холболтыг салгалаа")}catch(error){button.disabled=false;toast(error.message,true)}
}

async function testConnector(code,button){
  button.disabled=true;
  state.connectorResources[code]={loading:true};render();
  try{const result=await api(`/api/connectors/${encodeURIComponent(code)}/resources`);state.connectorResources[code]={items:result.items||[]};render()}catch(error){state.connectorResources[code]={error:error.message,items:[]};render()}finally{button.disabled=false}
}

document.addEventListener("click",event=>{
  const authorize=event.target.closest("[data-connector-authorize]");
  const disconnect=event.target.closest("[data-connector-disconnect]");
  const test=event.target.closest("[data-connector-test]");
  if(authorize)authorizeConnector(authorize.dataset.connectorAuthorize,authorize);
  if(disconnect)disconnectConnector(disconnect.dataset.connectorDisconnect,disconnect);
  if(test)testConnector(test.dataset.connectorTest,test);
});

window.addEventListener("load",()=>{
  const query=new URLSearchParams(location.search);
  if(query.get("view")!=="connectors"&&query.get("settings_tab")!=="integrations")return;
  let attempts=0;
  const timer=setInterval(()=>{
    attempts+=1;
    if(state.user&&(state.permissions||[]).includes("connectors.manage")){
      clearInterval(timer);
      state.settingsTab="integrations";
      setView("settings");
      if(query.get("connector")==="connected")toast("Холболт амжилттай үүслээ");
      if(query.get("connector_error"))toast("Холболтыг дуусгаж чадсангүй. Дахин оролдоно уу.",true);
      query.delete("connector");query.delete("connector_error");query.delete("settings_tab");
      history.replaceState({},"",`${location.pathname}?${query.toString()}`);
    }else if(attempts>50)clearInterval(timer);
  },100);
});
