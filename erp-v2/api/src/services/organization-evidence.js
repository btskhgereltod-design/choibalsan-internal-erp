"use strict";

const SIGNAL_TERMS = {
  finance:["санхүү","орлого","зарлага","төсөв","төлбөр"],
  accounting:["нягтлан","данс","тайлан","гүйлгээ"],
  hr:["хүний нөөц","ажилтан","ажилч","гэрээ","цалин"],
  attendance:["ирц","цаг бүртгэл","ээлж"],
  sales:["борлуул","захиалга","касс"],
  customers:["харилцагч","үйлчлүүлэгч","иргэн"],
  service:["үйлчилгээ","дуудлага","хүсэлт"],
  inventory:["бараа","үлдэгдэл","нөөц","материал"],
  warehouse:["агуулах","нярав"],
  procurement:["худалдан ав","тендер","ханган нийлүүл"],
  operations:["үйл ажиллагаа","гүйцэтгэл","өдөр тутмын ажил"],
  field:["талбай","объект","байршил"],
  maintenance:["засвар","арчилгаа","үзлэг","гэмтэл"],
  delivery:["хүргэлт","түгээлт","маршрут"],
  safety:["хабэа","аюулгүй","осол","эрсдэл"],
  quality:["чанар","шалгалт","стандарт"],
  compliance:["нийцэл","журам","зөвшөөрөл","хяналт"],
  it:["мэдээллийн технологи","программ","систем","сүлжээ"],
  devices:["төхөөрөмж","камер","мэдрэгч"],
  digital:["цахим","дижитал","автоматжуул"]
};
const SYSTEM_TERMS=["excel","word","google sheet","программ","систем","software","erp","crm"];
const PAIN_TERMS=["гараар","давхар","алдаа","удаан","хоцордог","тасалд","хүндрэл","асуудал"];

function normalized(value){return String(value||"").toLocaleLowerCase("mn");}
function sentences(content){return String(content).split(/(?<=[.!?\n])\s+/u).map(item=>item.trim()).filter(Boolean);}
function firstEvidence(parts,terms){return parts.find(part=>terms.some(term=>normalized(part).includes(term)))||parts[0]||"";}

function analyzeOrganizationEvidence({content,catalog,activeModules=[]}) {
  const parts=sentences(content),whole=normalized(content),active=new Set(activeModules);
  const results=[];
  for(const capability of catalog){
    const terms=[...new Set((capability.signals||[]).flatMap(signal=>SIGNAL_TERMS[signal]||[signal]))];
    if(!terms.length)continue;
    const matches=terms.filter(term=>whole.includes(normalized(term)));
    if(!matches.length)continue;
    const excerpt=firstEvidence(parts,matches).slice(0,1200),excerptNormalized=normalized(excerpt);
    const currentSystem=SYSTEM_TERMS.some(term=>excerptNormalized.includes(term));
    const painPoint=PAIN_TERMS.some(term=>excerptNormalized.includes(term));
    const modules=capability.recommended_modules||[];
    const nativeAvailable=modules.length>0&&modules.some(code=>active.has(code));
    const disposition=currentSystem?"integrate":nativeAvailable?"native":"later";
    const confidence=Math.min(.92,.62+Math.min(matches.length,3)*.07+((currentSystem||painPoint)?.04:0));
    results.push({
      findingKind:currentSystem?"current_system":painPoint?"pain_point":"activity",
      statement:`${capability.name} чиглэлийн одоогийн хэрэгцээ илэрсэн.`,
      evidenceExcerpt:excerpt,
      capabilityCode:capability.code,
      capabilityName:capability.name,
      proposedDisposition:disposition,
      rationale:currentSystem?"Одоо ашиглаж буй гадаад хэрэгсэл/системийн шинж илэрсэн тул интеграцийн хувилбарыг эхэлж шалгана.":nativeAvailable?"Тохирох OVERVA модуль catalog-т идэвхтэй байгаа тул native хувилбарыг санал болгов.":"Тохирох native capability баталгаажаагүй тул дараагийн шатанд судална.",
      confidence:Number(confidence.toFixed(3))
    });
  }
  return results.sort((a,b)=>b.confidence-a.confidence||a.capabilityCode.localeCompare(b.capabilityCode));
}

module.exports={analyzeOrganizationEvidence};
