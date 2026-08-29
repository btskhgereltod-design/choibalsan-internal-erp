"use strict";

const { STORAGE_VERSION, createCheckpoint, describeCheckpoint, answerMemory, classifyContextIntent } = window.OvervaConversationMemory;
const { deriveLifecycle, missingFor } = window.OvervaWorkspaceLifecycle;
const { normalizeRegistry, currentCheckpoint, upsertCheckpoint, startNewWorkspace, selectWorkspace } = window.OvervaWorkspaceRegistry;
const { inferGuide, extractOrganizationProfile, shouldChooseWorkspace } = window.OvervaWorkspaceIntake;
const { normalizeRegistry:normalizeRequestDraftRegistry, upsertDraft:upsertRequestDraft, confirmRequirement, buildRequirementArtifact } = window.OvervaRequestDraftRegistry;

const guidePaths = {
  import: {
    stage:"Өгөгдлийг дүрсэлж байна", icon:"XL", product:"Ажилтны Smart Import", kicker:"ХҮНИЙ НӨӨЦИЙН ЭХНИЙ АЖИЛ",
    title:"Excel мэдээллийг шалгаад оруулах орчин",
    description:"Файлын мөрүүдийг ажилтан, хэлтэс, албан тушаал болон холбоосоор ялгаж, алдааг хүн зассаны дараа үндсэн бүртгэлд оруулна.",
    reply:"Таны ажилтнуудын Excel мэдээллийг оруулж, багануудыг таньж, давхардал болон дутуу утгыг шалгуулах ажлын орчин хэрэгтэй гэж ойлголоо.",
    confirmation:"Эхлээд файл түр шалгах хэсэгт орно. Та үр дүнг хараад баталсны дараа л ажилтны үндсэн бүртгэл үүснэ. Яг зөв үү?",
    metrics:[["01","Файл унших","Excel · CSV"],["02","Мэдээлэл ялгах","Хүн · бүтэц"],["03","Хүн батлах","Дараа нь импорт"]], workspace:"import", modules:["hr","records"]
  },
  structure: {
    stage:"Бүтцийг зурж байна", icon:"ББ", product:"Байгууллагын бүтэц", kicker:"БҮТЦИЙН ЭХНИЙ ХУВИЛБАР",
    title:"Хэн хаана ажиллахыг нэг зурагт харуулна",
    description:"Салбар, хэлтэс, албан тушаал болон удирдлагын холбоог тус тусад нь шалгаж, ажилтныг дараа нь зөв байрлалд онооно.",
    reply:"Таны салбар, хэлтэс, албан тушаал болон хэн хэндээ тайлагнах холбоог нэг ойлгомжтой бүтэц болгохыг хүсэж байна гэж ойлголоо.",
    confirmation:"Эхлээд байгууллагын нэгж, дараа нь ажлын байр, хамгийн сүүлд хүнээ онооно. Ингэж явах нь зөв үү?",
    metrics:[["01","Нэгжүүд","Салбар · хэлтэс"],["02","Ажлын байр","Албан тушаал"],["03","Холбоос","Удирдлага · хүн"]], workspace:"structure", modules:["hr","executive"]
  },
  workflow: {
    stage:"Урсгалыг бүтээж байна", icon:"АУ", product:"Ажлын урсгал", kicker:"АЖЛЫН ЭХНИЙ ХУВИЛБАР",
    title:"Хүсэлтээс дуусгалт хүртэлх зам",
    description:"Хэн хүсэлт үүсгэх, хэн гүйцэтгэх, ямар нотолгоо хавсаргах, хэн баталж хаахыг нэг дараалалд оруулна.",
    reply:"Таны одоогийн ажлыг хүсэлтээс эхлээд гүйцэтгэл, шалгалт, баталгаажуулалт хүртэл хэн юу хийхээр нь зохион байгуулахыг хүсэж байна гэж ойлголоо.",
    confirmation:"Бүх ажлыг зэрэг өөрчлөхгүй. Эхлээд нэг бодит жижиг ажлаар урсгалаа туршаад, зөв бол өргөжүүлнэ. Яг зөв үү?",
    metrics:[["01","Хүсэлт","Ажил үүснэ"],["02","Гүйцэтгэл","Хариуцагчтай"],["03","Баталгаа","Түүх үлдэнэ"]], workspace:"workflow", modules:["work-orders","assets","inventory"]
  },
  discover: {
    stage:"Асуудлыг зураглаж байна", icon:"АС", product:"Асуудлын зураглал", kicker:"ШИЙДЛЭЭС ӨМНӨХ ОЙЛГОЛТ",
    title:"Одоо юу болж байгааг эхлээд ойлгоно",
    description:"Ярилцлага, файл болон бодит нотолгооноос асуудал, шалтгаан, одоо хийх жижиг эхлэлийг ялгаж харуулна.",
    reply:"Танд шууд нэг систем сонгохоосоо өмнө байгууллагад яг ямар асуудал байгааг, хүмүүс одоо ажлаа хэрхэн хийдгийг хамт тодорхойлох хэрэгтэй гэж ойлголоо.",
    confirmation:"Бид таамгийг үнэн гэж үзэхгүй. Таны өгсөн нотолгоо бүрийг шалгаж, та засаж баталсны дараа хамгийн жижиг бодит эхлэлийг сонгоно. Зөв үү?",
    metrics:[["01","Одоогийн байдал","Юу болж байна"],["02","Саад","Яагаад гацаж байна"],["03","Эхлэл","Юуг түрүүлж хийх"]], workspace:"discover", modules:["executive","records"]
  },
  systems: {
    stage:"Системүүдийг зураглаж байна", icon:"СХ", product:"Системийн холбоосын зураг", kicker:"ОДООГИЙН ХЭРЭГСЛҮҮД",
    title:"ERP, CRM болон файлуудын холбоос",
    description:"Одоо ашиглаж буй программ, файл болон гараар хийдэг ажлыг нэг зурагт оруулж, давхардал ба холбох цэгийг ялгана.",
    reply:"Таны одоо ашигладаг ERP, CRM, Excel болон бусад хэрэгслийг ямар ажилд ашигладгийг эхлээд зураглаж, дараа нь OVERVA-тай юуг холбохыг шийдэх хэрэгтэй гэж ойлголоо.",
    confirmation:"Программ бүрийн нэрээс илүү түүгээр хэн ямар ажил хийдэг, ямар мэдээлэл орж гардагийг нэг нэгээр нь шалгана. Ингэж эхлэх нь зөв үү?",
    metrics:[["01","Систем","Юу ашигладаг"],["02","Ажил","Юунд ашигладаг"],["03","Холбоос","Юуг нэгтгэх"]], workspace:"systems", modules:["executive","records"]
  }
};

const examples = {
  import:"Ажилтнуудын Excel мэдээллийг оруулж, алдааг нь шалгуулмаар байна.",
  structure:"Салбар, хэлтэс, албан тушаал болон удирдлагын бүтцээ гаргамаар байна.",
  workflow:"Манай ажлын хүсэлтээс дуусгалт хүртэлх урсгалыг зохион байгуулмаар байна.",
  discover:"Манай байгууллага юу хийдэг, хүмүүс ажлаа яаж хийдгийг эхнээс нь тайлбарлая.",
  systems:"Манайх ERP, CRM, Excel болон хэд хэдэн программаар ажлаа хийдэг. Аль нь юутай холбоотойг зурагламаар байна."
};

const moduleNames = {
  assets:"Хөрөнгө",
  "work-orders":"Ажлын удирдлага",
  inventory:"Агуулах",
  hr:"Хүний нөөц",
  procurement:"Худалдан авалт",
  finance:"Санхүү",
  attendance:"Ирц",
  records:"Бичиг хэрэг",
  archive:"Архив",
  executive:"Удирдлагын тойм"
};

const workspaceNames = {
  import:"Ажилтны мэдээллийн туршилт",
  structure:"Байгууллагын бүтцийн туршилт",
  workflow:"Ажлын урсгалын туршилт",
  systems:"Системийн зураглалын туршилт",
  inventory:"Агуулахын шаардлагын туршилт",
  approval:"Зөвшөөрлийн урсгалын туршилт",
  service:"Үйлчилгээний дуудлагын туршилт",
  crm:"CRM шаардлагын туршилт",
  discover:"Миний туршилтын орчин"
};

const workspaceTemplates = {
  import: () => `<div class="workspace-title"><div><strong>Ажилтны файл</strong><span>Мөр бүрийг шалгаж байж импортлоно</span></div><label class="preview-file">Файл сонгох<input type="file" accept=".xlsx,.csv" data-preview-file></label></div><div class="preview-stat-row"><article><small>Нийт мөр</small><strong>58</strong></article><article><small>Бэлэн</small><strong>56</strong></article><article><small>Шалгах</small><strong>2</strong></article></div><table class="data-table"><thead><tr><th>Сонгох</th><th>Ажилтан</th><th>Хэлтэс</th><th>Албан тушаал</th><th>Төлөв</th></tr></thead><tbody><tr><td><input type="checkbox" checked></td><td>Бат-Эрдэнэ</td><td>Удирдлага</td><td>Захирал</td><td><span class="tag">Бэлэн</span></td></tr><tr><td><input type="checkbox" checked></td><td>Сувд</td><td>Удирдлага</td><td>Менежер</td><td><span class="tag">Бэлэн</span></td></tr><tr><td><input type="checkbox"></td><td>Халиун</td><td>Санхүү</td><td>Нягтлан</td><td><button class="row-action" type="button" data-preview-action="Мөрийг засахаар нээлээ">Засах</button></td></tr></tbody></table><div class="workspace-actions"><button type="button" data-preview-action="Сонгосон 2 мөрийг туршилтаар шалгалаа">Сонгосныг шалгах</button><button class="primary" type="button" data-preview-action="Preview импорт бэлэн боллоо">Preview импорт</button></div>`,
  structure: () => `<div class="workspace-title"><div><strong>Байгууллагын бүтэц</strong><span>Карт дээр дарж нэгжийг сонгоно</span></div><button class="primary" type="button" data-preview-action="Шинэ нэгжийн маягтыг нээлээ">＋ Нэгж нэмэх</button></div><div class="org-cards"><button class="org-card root" type="button" data-preview-select><strong>Удирдлага</strong><small>1 нэгж</small></button><button class="org-card" type="button" data-preview-select><strong>Санхүү</strong><small>3 албан тушаал</small></button><button class="org-card" type="button" data-preview-select><strong>Үйл ажиллагаа</strong><small>5 албан тушаал</small></button><button class="org-card" type="button" data-preview-select><strong>Борлуулалт</strong><small>4 албан тушаал</small></button></div><div class="workspace-actions"><button type="button" data-preview-action="Албан тушаалын жагсаалтыг нээлээ">Албан тушаал харах</button><button class="primary" type="button" data-preview-action="Бүтцийн preview хадгалагдлаа">Preview хадгалах</button></div>`,
  workflow: () => `<div class="workspace-title"><div><strong>Засварын хүсэлтийн урсгал</strong><span>Алхам дээр дарж төлөвийг туршина</span></div><button class="primary" type="button" data-preview-action="Шинэ туршилтын ажил үүсгэлээ">＋ Ажил үүсгэх</button></div><div class="flow-row"><button class="flow-node active" type="button" data-preview-select><strong>Хүсэлт</strong><small>Ажил үүсгэнэ</small></button><span class="flow-arrow">→</span><button class="flow-node" type="button" data-preview-select><strong>Хуваарилалт</strong><small>Хариуцагч</small></button><span class="flow-arrow">→</span><button class="flow-node" type="button" data-preview-select><strong>Гүйцэтгэл</strong><small>Нотолгоо</small></button><span class="flow-arrow">→</span><button class="flow-node" type="button" data-preview-select><strong>Баталгаа</strong><small>Хүн хаана</small></button></div><div class="workspace-actions"><button type="button" data-preview-action="Урсгалыг эхнээс нь туршиж эхэллээ">Урсгал турших</button><button class="primary" type="button" data-preview-action="Урсгалын preview хадгалагдлаа">Preview хадгалах</button></div>`,
  discover: () => `<div class="workspace-title"><div><strong>Асуудлын ажлын самбар</strong><span>Карт сонгож хамгийн эхний ажлыг туршина</span></div><button class="primary" type="button" data-preview-action="Нотолгоо нэмэх хэсгийг нээлээ">＋ Нотолгоо</button></div><div class="finding-list"><button class="finding active" type="button" data-preview-select><b>01</b><div><strong>Одоогийн ажлыг сонсох</strong><small>Хүмүүс, файл, хэрэглэж буй систем</small></div></button><button class="finding" type="button" data-preview-select><b>02</b><div><strong>Саадыг нотолгоотой ялгах</strong><small>Давхардал, гар ажиллагаа, хүлээлт</small></div></button><button class="finding" type="button" data-preview-select><b>03</b><div><strong>Жижиг бодит эхлэл сонгох</strong><small>Одоо хийх · холбох · дараа хийх</small></div></button></div><div class="workspace-actions"><button type="button" data-preview-action="Сонгосон картыг дэлгэрэнгүй нээлээ">Дэлгэрэнгүй</button><button class="primary" type="button" data-preview-action="Сонгосон ажлыг preview горимоор эхлүүллээ">Сонгосныг турших</button></div>`,
  systems: () => `<div class="workspace-title"><div><strong>Системийн зураглал</strong><span>Карт дээр дарж хэрэглээг нь шалгана</span></div><button class="primary" type="button" data-preview-action="Шинэ систем нэмэх хэсгийг нээлээ">＋ Систем нэмэх</button></div><div class="system-map"><button type="button" data-preview-select><strong>ERP</strong><small>Санхүү · агуулах</small></button><span>↔</span><button type="button" data-preview-select><strong>Excel</strong><small>Ажилтан · тайлан</small></button><span>↔</span><button type="button" data-preview-select><strong>CRM</strong><small>Харилцагч · борлуулалт</small></button><span>→</span><button class="overva-node" type="button" data-preview-select><strong>OVERVA</strong><small>Нэгдсэн ажлын орчин</small></button></div><div class="workspace-actions"><button type="button" data-preview-action="Мэдээллийн оролт, гаралтыг харууллаа">Мэдээллийн урсгал</button><button class="primary" type="button" data-preview-action="Холболтын preview хадгалагдлаа">Preview хадгалах</button></div>`
};

Object.assign(guidePaths, {
  inventory:{ ...guidePaths.discover, product:"Агуулахын бүртгэл", title:"Орлого, зарлага, үлдэгдлийг нэг бүртгэлд", workspace:"inventory", modules:["inventory","records"] },
  approval:{ ...guidePaths.workflow, product:"Дотоод хүсэлт, зөвшөөрөл", title:"Хүсэлт хаана гацсаныг ил тод харуулна", workspace:"approval", modules:["work-orders","records"] },
  service:{ ...guidePaths.workflow, product:"Засвар, үйлчилгээний дуудлага", title:"Дуудлагаас хүлээн авалт хүртэл нэг түүх", workspace:"service", modules:["work-orders","assets"] },
  crm:{ ...guidePaths.systems, product:"Харилцагч, борлуулалтын CRM", title:"Харилцагч ба борлуулалтын нэг түүх", workspace:"crm", modules:["records","executive"] }
});

Object.assign(workspaceTemplates, {
  inventory:() => `<div class="workspace-title"><div><strong>Агуулахын хөдөлгөөн ба үлдэгдэл</strong><span>Нярав, нягтлан нэг эх үүсвэр ашиглана</span></div><button class="primary" type="button" data-preview-action="Шинэ барааны хөдөлгөөн нээлээ">＋ Хөдөлгөөн</button></div><div class="preview-stat-row"><article><small>Орлого</small><strong>125</strong></article><article><small>Зарлага</small><strong>87</strong></article><article><small>Зөрүү шалгах</small><strong>2</strong></article></div><div class="workspace-actions"><button type="button" data-preview-action="Үлдэгдлийн зөрүүг шалгалаа">Үлдэгдэл шалгах</button><button class="primary" type="button" data-preview-action="Сарын тайлангийн preview бэлэн боллоо">Тайлан харах</button></div>`,
  approval:() => `<div class="workspace-title"><div><strong>Дотоод хүсэлт, зөвшөөрлийн урсгал</strong><span>Шат, хариуцагч, хугацааг нэг дор хянана</span></div><button class="primary" type="button" data-preview-action="Шинэ хүсэлтийн маягт нээлээ">＋ Хүсэлт</button></div><div class="flow-row"><button class="flow-node active" type="button" data-preview-select><strong>Илгээсэн</strong><small>Ажилтан</small></button><span class="flow-arrow">→</span><button class="flow-node" type="button" data-preview-select><strong>Шалгаж буй</strong><small>Менежер</small></button><span class="flow-arrow">→</span><button class="flow-node" type="button" data-preview-select><strong>Шийдвэр</strong><small>Батлах · буцаах</small></button></div><div class="workspace-actions"><button type="button" data-preview-action="Хугацаа хэтэрсэн хүсэлтийг шүүв">Гацсан хүсэлт</button><button class="primary" type="button" data-preview-action="Зөвшөөрлийн урсгалын preview хадгалагдлаа">Preview хадгалах</button></div>`,
  service:() => `<div class="workspace-title"><div><strong>Засвар, үйлчилгээний дуудлага</strong><span>Дуудлага, хариуцагч, материал, нотолгооны түүх</span></div><button class="primary" type="button" data-preview-action="Шинэ дуудлагын маягт нээлээ">＋ Дуудлага</button></div><div class="flow-row"><button class="flow-node active" type="button" data-preview-select><strong>Дуудлага</strong><small>Дугаар авна</small></button><span class="flow-arrow">→</span><button class="flow-node" type="button" data-preview-select><strong>Хуваарилалт</strong><small>Хариуцагч</small></button><span class="flow-arrow">→</span><button class="flow-node" type="button" data-preview-select><strong>Талбайн ажил</strong><small>Зураг · материал</small></button><span class="flow-arrow">→</span><button class="flow-node" type="button" data-preview-select><strong>Хүлээн авалт</strong><small>Захиалагч</small></button></div><div class="workspace-actions"><button type="button" data-preview-action="Гүйцэтгэлийн нотолгоог нээлээ">Нотолгоо харах</button><button class="primary" type="button" data-preview-action="Үйлчилгээний preview хадгалагдлаа">Preview хадгалах</button></div>`,
  crm:() => `<div class="workspace-title"><div><strong>Харилцагч ба борлуулалтын түүх</strong><span>Уулзалт, санал, үе шат, хариуцагч нэг бүртгэлд</span></div><button class="primary" type="button" data-preview-action="Шинэ харилцагчийн маягт нээлээ">＋ Харилцагч</button></div><div class="preview-stat-row"><article><small>Шинэ харилцагч</small><strong>18</strong></article><article><small>Санал хүргүүлсэн</small><strong>7</strong></article><article><small>Хаасан борлуулалт</small><strong>3</strong></article></div><div class="workspace-actions"><button type="button" data-preview-action="Борлуулалтын үе шатыг шүүв">Үе шат харах</button><button class="primary" type="button" data-preview-action="CRM тайлангийн preview бэлэн боллоо">Тайлан харах</button></div>`
});

const intentForm = document.getElementById("intentForm");
const intentInput = document.getElementById("intentInput");
const chatStream = document.getElementById("chatStream");
const emptyPreview = document.getElementById("emptyPreview");
const productPreview = document.getElementById("productPreview");
const previewStage = document.getElementById("previewStage");
const trialDialog = document.getElementById("trialDialog");
const portfolioHome = document.getElementById("portfolioHome");
const workspaceStudio = document.getElementById("workspaceStudio");
const homeWorkspaceGrid = document.getElementById("homeWorkspaceGrid");
const homeIntentInput = document.getElementById("homeIntentInput");
const homeIntentForm = document.getElementById("homeIntentForm");
const homeIntentHelp = document.getElementById("homeIntentHelp");
const homeIntentSubmit = homeIntentForm.querySelector(".home-submit");
const requestDialog = document.getElementById("requestDialog");
const requestForm = document.getElementById("requestForm");
const requestError = document.getElementById("requestError");
const homeRequestFileInput = document.getElementById("homeRequestFileInput");
const homeRequestImageInput = document.getElementById("homeRequestImageInput");
const requestMaterialSummary = document.getElementById("requestMaterialSummary");
const requestMaterialName = document.getElementById("requestMaterialName");
const requestMaterialMeta = document.getElementById("requestMaterialMeta");
const requestMaterialIcon = document.getElementById("requestMaterialIcon");
const myRequestList = document.getElementById("myRequestList");
const requestDetailGrid = document.getElementById("requestDetailGrid");
const requestReviewButton = document.getElementById("requestReviewButton");
const requestConfirmButton = document.getElementById("requestConfirmButton");
const requestDownloadButton = document.getElementById("requestDownloadButton");
const marketAuthDialog = document.getElementById("marketAuthDialog");
const marketLoginForm = document.getElementById("marketLoginForm");
const marketRegisterForm = document.getElementById("marketRegisterForm");
const marketRecoveryDialog = document.getElementById("marketRecoveryDialog");
const marketRecoveryForm = document.getElementById("marketRecoveryForm");
const marketResetForm = document.getElementById("marketResetForm");
const marketSecurityDialog = document.getElementById("marketSecurityDialog");
const providerApplicationDialog = document.getElementById("providerApplicationDialog");
const providerGuideDialog = document.getElementById("providerGuideDialog");
const providerApplicationForm = document.getElementById("providerApplicationForm");
const providerPasswordStepUpForm = document.getElementById("providerPasswordStepUpForm");
const providerPhoneRequestForm = document.getElementById("providerPhoneRequestForm");
const providerPhoneConfirmForm = document.getElementById("providerPhoneConfirmForm");
const storefrontProfileForm = document.getElementById("storefrontProfileForm");
const storefrontManagerStatus = document.getElementById("storefrontManagerStatus");
const storefrontManagerState = document.getElementById("storefrontManagerState");
const storefrontPlanGrid = document.getElementById("storefrontPlanGrid");
const storefrontPaymentReference = document.getElementById("storefrontPaymentReference");
const marketStorefrontGrid = document.getElementById("marketStorefrontGrid");
const marketStorefrontEmpty = document.getElementById("marketStorefrontEmpty");
const MARKET_TOKEN_KEY = "overva.market.token.v1";
let marketIdentity = null;
let marketAuthCapabilities = { emailRecovery:false, google:false, phoneVerification:false, stepUp:true, facebook:false };
let providerReadiness = null;
let pendingMarketAction = "";
let pendingRequestSeed = null;
const HOME_INTENT_HELP = "Асуудлаа нэг өгүүлбэрээр бичнэ үү. Дараагийн маягт төрөл, төсөв, хугацаа болон харагдах хүрээг цэгцэлнэ.";
const LEGACY_WORKSPACE_STORAGE_KEY = "overva.public.workspace.v2";
const WORKSPACE_REGISTRY_KEY = "overva.public.workspaces.v1";
const LEGACY_REQUEST_DRAFT_STORAGE_KEY = "overva.public.request.draft.v1";
const REQUEST_DRAFT_REGISTRY_KEY = "overva.public.request.drafts.v2";
const requestTemplates = {
  inventory:{ templateKey:"inventory", guide:"inventory", type:"Шинэ систем эсвэл апп", area:"Агуулах, хөрөнгө", title:"Агуулахын орлого, зарлага, үлдэгдлийн систем", problem:"Манай агуулахын орлого, зарлага Excel дээр хөтлөгддөг. Үлдэгдэл зөрдөг бөгөөд нярав, нягтлан тусдаа мэдээлэл ашигладаг.", outcome:"Барааны хөдөлгөөн, үлдэгдэл, хариуцагч болон тайланг нэг баталгаатай мэдээллээс хянадаг болох.", acceptance:"Нярав, нягтлан хоёрын үлдэгдэл ижил гарч, сарын хөдөлгөөн ба үлдэгдлийн тайлан Excel-гүй бэлэн болно.", capabilities:["Бүртгэл, мастер өгөгдөл","Тайлан, хяналтын самбар","Файл, Excel импорт","Эрх, аудит"] },
  approval:{ templateKey:"approval", guide:"approval", type:"Шинэ систем эсвэл апп", area:"Дотоод хүсэлт, зөвшөөрөл", title:"Дотоод хүсэлт, зөвшөөрлийн урсгал", problem:"Дотоод хүсэлтүүд чат, цаас, имэйлээр тарж, хэн дээр хэдий хугацаанд гацсаныг харах боломжгүй байна.", outcome:"Хүсэлт бүрийн шат, шийдвэр, хугацаа болон хариуцагчийг нэг урсгалаар хянадаг болох.", acceptance:"Хүсэлт бүр хаана, хэний шийдвэр дээр байгааг харж, хугацаа хэтэрвэл мэдэгдэл авдаг болно.", capabilities:["Ажлын урсгал, зөвшөөрөл","Мэдэгдэл","Тайлан, хяналтын самбар","Эрх, аудит"] },
  service:{ templateKey:"service", guide:"service", type:"Шинэ систем эсвэл апп", area:"Засвар, үйлчилгээ", title:"Засвар, үйлчилгээний дуудлага удирдах", problem:"Засварын дуудлага, хариуцагч, материал болон гүйцэтгэлийн мэдээлэл өөр өөр сувгаар явдаг тул ажил орхигддог.", outcome:"Дуудлагаас баталгаатай гүйцэтгэл хүртэлх ажлыг нэг дугаартай, нотолгоотой түүх болгон хянах.", acceptance:"Дуудлагаас баталгаатай гүйцэтгэл хүртэлх алхам бүр дугаартай, хариуцагчтай, нотолгоотой түүх болон үлдэнэ.", capabilities:["Ажлын урсгал, зөвшөөрөл","Гар утас, талбайн ажил","Мэдэгдэл","Эрх, аудит"] },
  crm:{ templateKey:"crm", guide:"crm", type:"Шинэ систем эсвэл апп", area:"Харилцагч, борлуулалт", title:"Харилцагчийн бүртгэл, борлуулалтын CRM", problem:"Харилцагч, уулзалт, санал болон борлуулалтын мэдээлэл олон Excel файл, ажилтны хувийн тэмдэглэлд тархсан.", outcome:"Харилцагчийн түүх, борлуулалтын үе шат болон удирдлагын тайланг нэг бүртгэлээс харах.", acceptance:"Нэг харилцагчийн уулзалт, санал, борлуулалтын үе шат болон хариуцагчийг нэг дэлгэцээс бүрэн хардаг болно.", capabilities:["Бүртгэл, мастер өгөгдөл","Ажлын урсгал, зөвшөөрөл","Тайлан, хяналтын самбар","Файл, Excel импорт"] }
};
let activeGuide = "discover";
let conversationId = 0;
let activeSource = null;
let activeSourceUrl = "";
let pendingRequestMaterial = null;
let activeMarketView = "all";
let activeMarketCategory = "all";
let activeMarketRole = "guest";
let activeMarketArea = "products";
let activeProductCategory = "all";
let activeRequestDraftId = null;
let storefrontProfile = null;
let storefrontPlans = [];

function scrollChat() { chatStream.scrollTop = chatStream.scrollHeight; }

function createWorkspaceId() {
  return `workspace:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function createRequestDraftId() {
  return `request-draft:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function persistWorkspaceRegistry(registry) {
  try { localStorage.setItem(WORKSPACE_REGISTRY_KEY, JSON.stringify(registry)); } catch { /* Storage may be disabled. */ }
  return registry;
}

function loadWorkspaceRegistry() {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACE_REGISTRY_KEY));
    const legacy = JSON.parse(localStorage.getItem(LEGACY_WORKSPACE_STORAGE_KEY));
    const registry = normalizeRegistry(stored, legacy, {
      createId:createWorkspaceId,
      isValidCheckpoint:value => value?.version === STORAGE_VERSION && Boolean(guidePaths[value.guide]),
      fallbackName:value => guidePaths[value.guide]?.product || "Шинэ ажлын өрөө"
    });
    return persistWorkspaceRegistry(registry);
  } catch {
    return normalizeRegistry(null, null, { createId:createWorkspaceId, isValidCheckpoint:() => false, fallbackName:() => "Шинэ ажлын өрөө" });
  }
}

function loadCheckpoint() {
  return currentCheckpoint(loadWorkspaceRegistry());
}

function saveCheckpoint(update = {}) {
  let registry = loadWorkspaceRegistry();
  const previous = loadCheckpoint() || {};
  const created = createCheckpoint(previous, {
    guide:activeGuide,
    product:guidePaths[activeGuide].product,
    source:activeSource || previous.source || null
  }, update);
  registry = upsertCheckpoint(registry, created, guidePaths[created.guide]?.product || "Шинэ ажлын өрөө");
  const checkpoint = currentCheckpoint(registry);
  persistWorkspaceRegistry(registry);
  renderDeliveryLifecycle(checkpoint);
  return checkpoint;
}

function renderWorkspaceSelector(registry = loadWorkspaceRegistry()) {
  const selector = document.getElementById("workspaceSelector");
  selector.replaceChildren();
  [...registry.items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).forEach(item => {
    const option = document.createElement("option");
    option.value = item.id; option.textContent = item.name || "Шинэ ажлын өрөө";
    option.selected = item.id === registry.currentWorkspaceId;
    selector.append(option);
  });
}

function workspaceCard(item) {
  const checkpoint = item.checkpoint;
  const lifecycle = deriveLifecycle(checkpoint);
  const stageIndex = lifecycle.stages.findIndex(value => value.status === "current");
  const button = document.createElement("button");
  button.type = "button"; button.className = "workspace-card"; button.dataset.workspaceCard = item.id;
  const preview = document.createElement("div"); preview.className = "workspace-card-preview";
  const stage = document.createElement("span"); stage.textContent = checkpoint ? `${stageIndex + 1}/${lifecycle.stages.length} · ${lifecycle.current.label}` : "Эхлээгүй";
  preview.append(stage);
  const body = document.createElement("div"); body.className = "workspace-card-body";
  const name = document.createElement("strong"); name.textContent = item.name || "Шинэ ажлын өрөө";
  const description = document.createElement("p"); description.textContent = checkpoint
    ? `${guidePaths[checkpoint.guide]?.product || "Байгууллагын ажлын орчин"} · Дараагийн алхам: ${lifecycle.next?.label || "Тогтвортой ажиллуулах"}`
    : "Байгууллага, асуудал, файл эсвэл системээ тайлбарлаад эхэлнэ.";
  const localBadge = document.createElement("span"); localBadge.className = "workspace-local-badge"; localBadge.textContent = "Өмнөх туршилтын ажил · бодит төсөл биш";
  const updated = document.createElement("small"); updated.textContent = `Сүүлд шинэчилсэн: ${new Date(item.updatedAt).toLocaleString("mn-MN")}`;
  body.append(name,description,localBadge,updated); button.append(preview,body); return button;
}

function renderPortfolioHome(searchText = "", { includeCreate = true } = {}) {
  const registry = loadWorkspaceRegistry();
  const query = String(searchText || "").trim().toLocaleLowerCase("mn-MN");
  homeWorkspaceGrid.replaceChildren();
  const create = document.createElement("button"); create.type = "button"; create.className = "workspace-card new-card"; create.dataset.homeCreate = "true";
  const createPreview = document.createElement("div"); createPreview.className = "workspace-card-preview"; const plus = document.createElement("b"); plus.textContent = "+"; createPreview.append(plus);
  const createBody = document.createElement("div"); createBody.className = "workspace-card-body"; const createTitle = document.createElement("strong"); createTitle.textContent = "Шинэ хэрэгцээ тодорхойлох"; const createCopy = document.createElement("p"); createCopy.textContent = "Асуудлаа ярьж, файл эсвэл одоогийн ажлын нотолгооноос эхэлнэ."; createBody.append(createTitle,createCopy); create.append(createPreview,createBody);
  if (includeCreate && !query) homeWorkspaceGrid.append(create);
  const items = [...registry.items].filter(item => item.checkpoint).filter(item => !query || `${item.name} ${guidePaths[item.checkpoint?.guide]?.product || ""}`.toLocaleLowerCase("mn-MN").includes(query)).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  items.forEach(item => homeWorkspaceGrid.append(workspaceCard(item)));
  if (!homeWorkspaceGrid.children.length) { const empty = document.createElement("div"); empty.className = "workspace-empty"; empty.textContent = "Хайлттай тохирох ажлын өрөө олдсонгүй."; homeWorkspaceGrid.append(empty); }
}

function renderMyRequests() {
  const drafts = [...loadRequestDraftRegistry().items].sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  myRequestList.replaceChildren();
  if (!drafts.length) {
    const empty = document.createElement("div"); empty.className = "market-empty";
    empty.textContent = "Энэ төхөөрөмжид хадгалсан хүсэлт одоогоор алга. “Хүсэлт гаргах” товчоор эхэлнэ үү.";
    myRequestList.append(empty); return;
  }
  drafts.forEach(draft => {
    const row = document.createElement("article"); row.className = "my-request-row";
    const copy = document.createElement("div");
    const title = document.createElement("h3"); title.textContent = draft.title || "Гарчиггүй хүсэлт";
    const summary = document.createElement("p"); summary.textContent = String(draft.packageText || "").split("\n").find(line => line.startsWith("ОДООГИЙН АСУУДАЛ:"))?.replace("ОДООГИЙН АСУУДАЛ:", "").trim() || "Хүсэлтийн ажлын өрөөнд дэлгэрэнгүйг шалгана.";
    const reviewState = draft.reviewWorkspaceId ? " · Хүсэлтийн шалгалттай" : "";
    const requestState = draft.status === "requirement-confirmed" ? "Шаардлага баталсан · нийтлээгүй" : draft.published ? "Нийтэлсэн" : "Ноорог · нийтлээгүй";
    const state = document.createElement("small"); state.textContent = `${requestState}${reviewState} · ${new Date(draft.updatedAt).toLocaleString("mn-MN")}`;
    const open = document.createElement("button"); open.type = "button"; open.dataset.openRequestDetail = draft.id; open.textContent = "Хүсэлтээ нээх →";
    copy.append(title,summary,state); row.append(copy,open); myRequestList.append(row);
  });
}

function requestPackageFields(packageText = "") {
  return String(packageText).split("\n").reduce((fields, line) => {
    const separator = line.indexOf(":");
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    return fields;
  }, {});
}

function showRequestDetail(draftId) {
  const draft = loadRequestDraftRegistry().items.find(item => item.id === draftId);
  if (!draft) { showMarketView("mine"); return; }
  activeRequestDraftId = draft.id;
  activeMarketView = "request-detail";
  document.querySelectorAll("[data-market-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.marketPanel !== "request-detail"));
  document.querySelectorAll("[data-market-view]").forEach(button => button.classList.toggle("active", button.dataset.marketView === "mine"));
  document.getElementById("requestDetailTitle").textContent = draft.title || "Гарчиггүй хүсэлт";
  const requirementConfirmed = draft.status === "requirement-confirmed";
  document.getElementById("requestDetailState").textContent = `${requirementConfirmed ? "Шаардлага баталсан" : draft.published ? "Нийтэлсэн" : "Ноорог"} · нийтлээгүй · Энэ хүсэлт төсөл болоогүй`;
  const fields = requestPackageFields(draft.packageText);
  const labels = [
    ["АЖЛЫН ТӨРӨЛ","Ямар ажил хэрэгтэй вэ?"], ["ЧИГЛЭЛ","Ажлын чиглэл"],
    ["ОДООГИЙН АСУУДАЛ","Одоогийн асуудал"], ["ХҮССЭН ҮР ДҮН","Хүссэн үр дүн"],
    ["ХҮЛЭЭН АВАХ ШАЛГУУР","Ажил зөв болсныг шалгах нөхцөл"], ["ХЭРЭГТЭЙ БОЛОМЖ","Хэрэгтэй боломжууд"],
    ["ТӨСӨВ","Төсөв"], ["ХУГАЦАА","Хугацаа"], ["ХАРАГДАХ ХҮРЭЭ","Ирээдүйд нийтлэх хүрээ"],
    ["ХАВСАРГАСАН МАТЕРИАЛ","Материал"]
  ];
  requestDetailGrid.replaceChildren();
  labels.forEach(([key,label]) => {
    const card = document.createElement("article"); const small = document.createElement("small"); const value = document.createElement("p");
    small.textContent = label; value.textContent = fields[key] || "Тодорхойлоогүй"; card.append(small,value); requestDetailGrid.append(card);
  });
  requestReviewButton.textContent = draft.reviewWorkspaceId ? "Хүсэлтийн шалгалтаа нээх" : "OVERVA-аар хүсэлтээ шалгах";
  document.getElementById("requestConfirmationTitle").textContent = requirementConfirmed ? "Шаардлага баталгаажсан" : "Шаардлагаа баталгаажуулах";
  document.getElementById("requestConfirmationText").textContent = requirementConfirmed
    ? `${new Date(draft.requirementConfirmedAt).toLocaleString("mn-MN")}-д энэ хувилбарыг зөв гэж баталсан. Нийтлээгүй, гүйцэтгэгчид илгээгээгүй, төсөл үүсгээгүй.`
    : "Дээрх асуудал, хүссэн үр дүн, хэрэгтэй боломж болон хүлээн авах шалгуур зөв бол батална уу. Батлах нь хүсэлтийг нийтлэхгүй, гүйцэтгэгчид илгээхгүй, төсөл үүсгэхгүй.";
  requestConfirmButton.classList.toggle("hidden", requirementConfirmed);
  requestDownloadButton.disabled = !requirementConfirmed;
  document.querySelector(".portfolio-scroll").scrollTo({ top:0, behavior:"smooth" });
}

function downloadConfirmedRequirement(draft) {
  const content = `\uFEFF${buildRequirementArtifact(draft)}`;
  const blob = new Blob([content], { type:"text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `overva-requirement-${draft.id.replace(/[^a-z0-9-]+/gi, "-")}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filterProductMarket(searchText = "") {
  const query = String(searchText || "").trim().toLocaleLowerCase("mn-MN");
  let visibleCount = 0;
  document.querySelectorAll("[data-product-card]").forEach(card => {
    const categoryMatch = activeProductCategory === "all" || card.dataset.productCategoryRow === activeProductCategory;
    const searchMatch = !query || card.textContent.toLocaleLowerCase("mn-MN").includes(query);
    const visible = categoryMatch && searchMatch;
    card.classList.toggle("hidden", !visible);
    if (visible) visibleCount += 1;
  });
  document.getElementById("productMarketEmpty").classList.toggle("hidden", visibleCount > 0);
}

function filterForumTopics(searchText = "") {
  const query = String(searchText || "").trim().toLocaleLowerCase("mn-MN");
  let visibleCount = 0;
  document.querySelectorAll("[data-forum-topic]").forEach(topic => {
    const visible = !query || topic.textContent.toLocaleLowerCase("mn-MN").includes(query);
    topic.classList.toggle("hidden", !visible);
    if (visible) visibleCount += 1;
  });
  document.getElementById("forumSearchEmpty").classList.toggle("hidden", visibleCount > 0);
}

function showMarketArea(area = "products") {
  const allowedAreas = ["products","community","freelance"];
  activeMarketArea = allowedAreas.includes(area) ? area : "products";
  portfolioHome.classList.remove("products-area","community-area","freelance-area");
  portfolioHome.classList.add(`${activeMarketArea}-area`);
  document.querySelectorAll("[data-market-area]").forEach(button => button.classList.toggle("active", button.dataset.marketArea === activeMarketArea));
  document.querySelectorAll("[data-market-area-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.marketAreaPanel !== activeMarketArea));
  document.querySelectorAll("[data-market-area-sidebar]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.marketAreaSidebar !== activeMarketArea));
  document.getElementById("publicConnectors").classList.add("hidden");
  document.getElementById("homeConnectorsButton").classList.remove("active");
  const searchInput = document.getElementById("homeSearchInput");
  searchInput.value = "";
  if (activeMarketArea === "products") {
    searchInput.placeholder = "Бүтээгдэхүүн, нийлүүлэгч, боломж хайх…";
    filterProductMarket();
  } else if (activeMarketArea === "community") {
    searchInput.placeholder = "Сэдэв, асуулт, хариулт хайх…";
    filterForumTopics();
  } else {
    searchInput.placeholder = activeMarketRole === "provider"
      ? "Ажил, чиглэл, шаардлагатай чадвар хайх…"
      : activeMarketRole === "customer"
        ? "Хүсэлт, чиглэл, хэрэгтэй боломж хайх…"
        : "Нээлттэй ажил, чиглэл, хэрэгтэй чадвар хайх…";
    showMarketView("all");
  }
  document.querySelector(".portfolio-scroll").scrollTo({ top:0, behavior:"smooth" });
}

function filterMarketRequests(searchText = "") {
  const query = String(searchText || "").trim().toLocaleLowerCase("mn-MN");
  let visibleCount = 0;
  document.querySelectorAll("[data-market-category-row]").forEach(row => {
    const categoryMatch = activeMarketCategory === "all" || row.dataset.marketCategoryRow === activeMarketCategory;
    const searchMatch = !query || row.textContent.toLocaleLowerCase("mn-MN").includes(query);
    const visible = categoryMatch && searchMatch;
    row.classList.toggle("hidden", !visible);
    if (visible) visibleCount += 1;
  });
  document.getElementById("marketVisibleCount").textContent = String(visibleCount);
  document.getElementById("marketVisibleSummary").textContent = activeMarketRole === "provider"
    ? `${visibleCount} жишээ · Нээлттэй бодит ажил биш`
    : activeMarketRole === "customer"
      ? `${visibleCount} жишиг хүсэлт · Бодит захиалга биш`
      : `${visibleCount} нийтийн жишээ · Бодит захиалга биш`;
  document.getElementById("marketFilterEmpty").classList.toggle("hidden", visibleCount > 0);
}

function showMarketView(view = "all") {
  const allowedViews = activeMarketRole === "provider"
    ? ["all","storefront","proposals","deliveries"]
    : activeMarketRole === "customer"
      ? ["all","mine","projects","labs","rules","request-detail"]
      : ["all"];
  activeMarketView = allowedViews.includes(view) ? view : "all";
  document.querySelectorAll("[data-market-panel]").forEach(panel => panel.classList.toggle("hidden", panel.dataset.marketPanel !== activeMarketView));
  document.querySelectorAll("[data-market-view]").forEach(button => button.classList.toggle("active", button.dataset.marketView === activeMarketView));
  if (activeMarketView === "mine") renderMyRequests();
  if (activeMarketView === "labs") renderPortfolioHome(document.getElementById("homeSearchInput").value, { includeCreate:false });
  if (activeMarketView === "storefront") loadStorefrontManager();
  if (activeMarketView === "all") filterMarketRequests(document.getElementById("homeSearchInput").value);
  document.querySelector(".portfolio-scroll").scrollTo({ top:0, behavior:"smooth" });
}

function showGuestMarket() {
  activeMarketRole = "guest";
  portfolioHome.classList.remove("provider-mode");
  document.querySelector(".market-role-switch").classList.add("hidden");
  document.querySelectorAll("[data-market-role-nav],[data-market-role-guide]").forEach(element => element.classList.add("hidden"));
  document.getElementById("marketCustomerPrivacy").classList.add("hidden");
  document.getElementById("homeNewWorkButton").classList.remove("hidden");
  document.getElementById("marketHeroEyebrow").textContent = "ЗАХИАЛГАТ АЖИЛ БА ҮЙЛЧИЛГЭЭ";
  document.getElementById("marketHeroTitle").textContent = "Зах дээрх ажлуудтай танилцах";
  document.getElementById("marketHeroCopy").textContent = "Зочин нээлттэй ажлын бүтэц, ангилал болон зах хэрхэн ажиллахыг үзнэ. Захиалах эсвэл санал өгөхийн тулд бүртгүүлнэ.";
  if (activeMarketArea === "freelance") {
    document.getElementById("homeSearchInput").placeholder = "Нээлттэй ажил, чиглэл, хэрэгтэй чадвар хайх…";
  }
  showMarketView("all");
}

function showMarketRole(role = "customer") {
  const view = role === "provider" ? "provider" : "customer";
  const active = new Set(marketIdentity?.active_memberships || []);
  if (!marketIdentity || !active.has(view)) {
    showGuestMarket();
    return false;
  }
  activeMarketRole = view;
  portfolioHome.classList.toggle("provider-mode", activeMarketRole === "provider");
  const roleSwitch = document.querySelector(".market-role-switch");
  roleSwitch.classList.toggle("hidden", active.size !== 2);
  document.querySelectorAll("[data-market-role]").forEach(button => {
    button.classList.toggle("hidden", !active.has(button.dataset.marketRole));
    button.classList.toggle("active", button.dataset.marketRole === activeMarketRole);
  });
  document.querySelectorAll("[data-market-role-nav]").forEach(nav => nav.classList.toggle("hidden", nav.dataset.marketRoleNav !== activeMarketRole));
  document.querySelectorAll("[data-market-role-guide]").forEach(guide => guide.classList.toggle("hidden", guide.dataset.marketRoleGuide !== activeMarketRole));
  document.getElementById("marketCustomerPrivacy").classList.toggle("hidden", activeMarketRole !== "customer");
  document.getElementById("homeNewWorkButton").classList.toggle("hidden", activeMarketRole === "provider");
  document.getElementById("marketHeroEyebrow").textContent = activeMarketRole === "provider" ? "ГҮЙЦЭТГЭГЧИД" : "БАЙГУУЛЛАГЫН ЦАХИМ ХЭРЭГЦЭЭНИЙ ЗАХ";
  document.getElementById("marketHeroTitle").textContent = activeMarketRole === "provider" ? "Тохирох ажлаа олох" : "Хэрэгтэй ажлаа ойлгомжтой хүсэлт болгох";
  document.getElementById("marketHeroCopy").textContent = activeMarketRole === "provider"
    ? "Баталгаажсан хүсэлтийг уншиж, өөрийн туршлага болон боломжид тохирох ажилд санал өгнө."
    : "Жишиг хүсэлтээс санаа авч, хийх ажил болон хүлээн авах үр дүнгээ нэг дор бичнэ.";
  if (activeMarketArea === "freelance") document.getElementById("homeSearchInput").placeholder = activeMarketRole === "provider"
    ? "Ажил, чиглэл, шаардлагатай чадвар хайх…"
    : "Хүсэлт, чиглэл, хэрэгтэй боломж хайх…";
  showMarketView("all");
  return true;
}

function marketToken() {
  try { return sessionStorage.getItem(MARKET_TOKEN_KEY) || ""; } catch { return ""; }
}

function storeMarketToken(token = "") {
  try {
    if (token) sessionStorage.setItem(MARKET_TOKEN_KEY, token);
    else sessionStorage.removeItem(MARKET_TOKEN_KEY);
  } catch { /* Session storage may be disabled. */ }
}

function storedMarketAuthMethod() {
  try { return localStorage.getItem("overva.market.last_auth_method") || ""; }
  catch { return ""; }
}

function syncMarketLoginOptions() {
  const method = storedMarketAuthMethod();
  const reminder = document.getElementById("marketAuthReminder");
  const passwordLogin = document.getElementById("marketPasswordLogin");
  const passwordToggle = document.getElementById("marketPasswordLoginToggle");
  const preferGoogle = Boolean(marketAuthCapabilities.google && method === "google");
  reminder.textContent = preferGoogle ? "Та өмнө нь Google-ээр нэвтэрсэн. Тэр account-аараа шууд үргэлжлүүлнэ үү." : "";
  passwordLogin.classList.toggle("hidden", preferGoogle);
  passwordToggle.classList.toggle("hidden", !preferGoogle);
  passwordToggle.setAttribute("aria-expanded", String(!preferGoogle));
  document.getElementById("marketGoogleDivider").classList.toggle("hidden", !marketAuthCapabilities.google);
}

function rememberMarketAuthMethod(method) {
  try { localStorage.setItem("overva.market.last_auth_method", method); } catch { /* Optional device hint only. */ }
  syncMarketLoginOptions();
}

function restoreMarketAuthReminder() {
  syncMarketLoginOptions();
}

async function marketApi(path, options = {}) {
  const headers = { accept:"application/json", ...(options.body ? { "content-type":"application/json" } : {}), ...(options.headers || {}) };
  const token = marketToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`/api/market${path}`, { ...options, headers });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "Market request failed");
    error.code = data?.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadMarketAuthCapabilities() {
  try {
    marketAuthCapabilities = await marketApi("/auth/capabilities");
  } catch { marketAuthCapabilities = { emailRecovery:false, google:false, phoneVerification:false, stepUp:true, facebook:false }; }
  document.getElementById("marketGoogleLogin").classList.toggle("hidden", !marketAuthCapabilities.google);
  document.getElementById("marketForgotPassword").classList.toggle("hidden", !marketAuthCapabilities.emailRecovery);
  syncMarketLoginOptions();
}

async function startGoogleAuth(link = false) {
  const status = link ? document.getElementById("marketSecurityStatus") : document.getElementById("marketLoginError");
  status.textContent = "Google нэвтрэх цонх руу шилжүүлж байна…";
  try {
    const data = await marketApi(link ? "/auth/google/link/start" : "/auth/google/start", { method: link ? "POST" : "GET" });
    location.assign(data.url);
  } catch (error) { status.textContent = error.message; }
}

async function handleMarketAuthReturn(params) {
  const clean = () => history.replaceState({}, "", `${location.pathname}${location.hash || ""}`);
  const authCode = params.get("market_auth_code");
  const verifyToken = params.get("market_verify_token");
  const resetToken = params.get("market_reset_token");
  if (authCode) {
    try {
      const data = await marketApi("/auth/google/exchange", { method:"POST", body:JSON.stringify({ token:authCode }) });
      storeMarketToken(data.token);
      marketIdentity = data.identity;
      rememberMarketAuthMethod("google");
      renderMarketIdentity();
    } catch (error) {
      marketAuthDialog.showModal();
      document.getElementById("marketLoginError").textContent = error.message;
    }
    clean();
  } else if (verifyToken) {
    try {
      const data = await marketApi("/auth/email-verification/confirm", { method:"POST", body:JSON.stringify({ token:verifyToken }) });
      if (marketIdentity?.id === data.identity?.id) marketIdentity = data.identity;
    } catch (error) {
      marketAuthDialog.showModal();
      document.getElementById("marketLoginError").textContent = error.message;
    } finally { clean(); }
  } else if (resetToken) {
    marketResetForm.elements.token.value = resetToken;
    marketRecoveryForm.classList.add("hidden");
    marketResetForm.classList.remove("hidden");
    marketRecoveryDialog.showModal();
    clean();
  } else if (params.get("market_auth_error")) {
    const messages = {
      existing_email_link_required:"Энэ имэйлтэй бүртгэл байна. Эхлээд имэйл, нууц үгээрээ ороод Google account-аа холбоно уу.",
      google_already_linked:"Энэ Google account өөр Market identity-тай аль хэдийн холбоотой байна.",
      google_state_expired:"Google нэвтрэх хүсэлтийн хугацаа дууссан. Дахин оролдоно уу.",
      google_reauth_mismatch:"Сонгосон Google account энэ Market identity-тай тохирохгүй байна.",
      google_reauth_session_expired:"Market session дууссан байна. Дахин нэвтэрнэ үү.",
      identity_inactive:"Энэ Market бүртгэл идэвхгүй байна. Дэмжлэгтэй холбогдоно уу.",
    };
    marketAuthDialog.showModal();
    document.getElementById("marketLoginError").textContent = messages[params.get("market_auth_error")] || "Google нэвтрэлт амжилтгүй боллоо.";
    clean();
  } else if (params.get("market_google_linked")) {
    clean();
    await restoreMarketIdentity();
    openMarketSecurity();
  } else if (params.get("market_google_reauthenticated")) {
    clean();
    await restoreMarketIdentity();
    openProviderApplication();
  }
}

async function openMarketSecurity() {
  if (!marketIdentity) return;
  const methods = [marketIdentity.email_verified_at ? "баталгаажсан имэйл" : "баталгаажаагүй имэйл",
    ...(marketIdentity.external_auth_methods || []).map(value => value === "google" ? "Google" : value)];
  document.getElementById("marketSecuritySummary").textContent = `Нэвтрэх арга: ${methods.join(" · ")}`;
  document.getElementById("marketGoogleLink").classList.toggle("hidden", !marketAuthCapabilities.google || (marketIdentity.external_auth_methods || []).includes("google"));
  document.getElementById("marketGoogleUnlink").classList.toggle("hidden", !(marketIdentity.external_auth_methods || []).includes("google"));
  document.getElementById("marketVerifyEmail").classList.toggle("hidden", Boolean(marketIdentity.email_verified_at) || !marketAuthCapabilities.emailRecovery);
  document.getElementById("marketSecurityStatus").textContent = "";
  const sessionList = document.getElementById("marketSessionList");
  sessionList.textContent = "Идэвхтэй session-уудыг уншиж байна…";
  marketSecurityDialog.showModal();
  try {
    const sessions = await marketApi("/auth/sessions");
    sessionList.replaceChildren(...sessions.items.map(item => {
      const row = document.createElement("small");
      row.textContent = `${item.current ? "Энэ төхөөрөмж" : "Бусад төхөөрөмж"} · ${item.auth_method} · ${new Date(item.last_seen_at).toLocaleString("mn-MN")}`;
      return row;
    }));
  } catch (error) { sessionList.textContent = error.message; }
}

function formatMnt(value) {
  return `${Number(value || 0).toLocaleString("mn-MN")} ₮`;
}

function renderPublicStorefronts(items = []) {
  marketStorefrontGrid.replaceChildren();
  marketStorefrontEmpty.classList.toggle("hidden", items.length > 0);
  items.forEach(item => {
    const card = document.createElement("article");
    card.className = "market-storefront-card";
    const badge = document.createElement("span");
    badge.textContent = `${item.plan_name} · Идэвхтэй`;
    const name = document.createElement("h3");
    name.textContent = item.display_name;
    const tagline = document.createElement("strong");
    tagline.textContent = item.tagline;
    const description = document.createElement("p");
    description.textContent = item.description;
    card.append(badge, name, tagline, description);
    if (item.public_contact) {
      const contact = document.createElement("small");
      contact.textContent = `Холбоо барих: ${item.public_contact}`;
      card.append(contact);
    }
    marketStorefrontGrid.append(card);
  });
}

async function loadPublicStorefronts() {
  try {
    const data = await marketApi("/storefronts");
    renderPublicStorefronts(data.items || []);
  } catch {
    marketStorefrontGrid.replaceChildren();
    marketStorefrontEmpty.classList.remove("hidden");
    marketStorefrontEmpty.textContent = "Цахим лангууны мэдээллийг одоогоор ачаалж чадсангүй.";
  }
}

function setStorefrontManagerStatus(message = "", error = false) {
  storefrontManagerStatus.textContent = message;
  storefrontManagerStatus.classList.toggle("error", error);
}

function fillStorefrontProfile(item) {
  storefrontProfile = item || null;
  storefrontProfileForm.elements.slug.value = item?.slug || "";
  storefrontProfileForm.elements.displayName.value = item?.display_name || marketIdentity?.display_name || "";
  storefrontProfileForm.elements.tagline.value = item?.tagline || "";
  storefrontProfileForm.elements.description.value = item?.description || "";
  storefrontProfileForm.elements.publicContact.value = item?.public_contact || "";
  storefrontManagerState.textContent = item
    ? item.status === "active" ? "Идэвхтэй" : item.status === "suspended" ? "Түр зогсоосон" : item.status === "expired" ? "Хугацаа дууссан" : "Ноорог"
    : "Үүсгээгүй";
  storefrontProfileForm.querySelector("button[type=submit]").textContent = item ? "Лангуугаа шинэчлэх" : "Лангуугаа хадгалах";
}

function renderStorefrontPlans() {
  storefrontPlanGrid.replaceChildren();
  if (!storefrontPlans.length) {
    const empty = document.createElement("div");
    empty.className = "market-empty";
    empty.textContent = "Market operator үйлчилгээний plan хараахан тохируулаагүй байна.";
    storefrontPlanGrid.append(empty);
    return;
  }
  const openStatus = storefrontProfile?.subscription?.status;
  storefrontPlans.forEach(plan => {
    const card = document.createElement("article");
    card.className = "storefront-plan-card";
    const title = document.createElement("h3");
    title.textContent = plan.name;
    const description = document.createElement("p");
    description.textContent = plan.description;
    const price = document.createElement("strong");
    price.textContent = `${formatMnt(plan.price_mnt)} / ${plan.billing_period_days} хоног`;
    const grants = document.createElement("small");
    grants.textContent = Object.keys(plan.entitlement_snapshot || {}).join(" · ") || "Үйлчилгээний эрх";
    const action = document.createElement("button");
    action.type = "button";
    action.dataset.storefrontPlan = plan.id;
    action.disabled = !storefrontProfile || ["pending","active","suspended"].includes(openStatus);
    action.textContent = openStatus === "pending" ? "Operator шалгаж байна"
      : openStatus === "active" ? "Subscription идэвхтэй"
        : openStatus === "suspended" ? "Subscription түр зогссон"
          : !storefrontProfile ? "Эхлээд лангуугаа хадгална" : "Энэ plan-ыг хүсэх";
    card.append(title, description, price, grants, action);
    storefrontPlanGrid.append(card);
  });
}

async function loadStorefrontManager() {
  if (!marketIdentity || !(marketIdentity.active_memberships || []).includes("provider")) {
    showMarketView("all");
    return;
  }
  setStorefrontManagerStatus("Лангууны мэдээллийг ачаалж байна…");
  try {
    const [profileData, plansData] = await Promise.all([
      marketApi("/storefront/me"),
      marketApi("/storefront-plans")
    ]);
    storefrontPlans = plansData.items || [];
    fillStorefrontProfile(profileData.item);
    renderStorefrontPlans();
    const subscription = storefrontProfile?.subscription;
    setStorefrontManagerStatus(subscription?.status === "pending"
      ? "Subscription хүсэлтийг Market operator шалгаж байна. Батлагдсаны дараа лангуу нийтэд гарна."
      : subscription?.status === "active"
        ? `Лангуу ${new Date(subscription.expires_at).toLocaleDateString("mn-MN")} хүртэл идэвхтэй.`
        : storefrontProfile ? "Лангуу ноорог төлөвтэй. Идэвхжүүлэх plan сонгоно уу." : "Эхлээд лангууныхаа мэдээллийг хадгална уу.");
  } catch (error) {
    setStorefrontManagerStatus(error.message, true);
  }
}

function renderMarketIdentity() {
  const guest = document.getElementById("marketIdentityGuest");
  const session = document.getElementById("marketIdentitySession");
  guest.classList.toggle("hidden", Boolean(marketIdentity));
  session.classList.toggle("hidden", !marketIdentity);
  const active = new Set(marketIdentity?.active_memberships || []);
  document.querySelectorAll("[data-market-role]").forEach(button => {
    button.classList.toggle("hidden", !active.has(button.dataset.marketRole));
    button.title = "";
  });
  if (!marketIdentity) {
    document.getElementById("marketProviderApplyButton").disabled = false;
    document.getElementById("marketProviderApplyButton").textContent = "Гүйцэтгэгчээр бүртгүүлэх";
    showGuestMarket();
    return;
  }
  const providerApplication = marketIdentity.provider_application;
  const providerAwaitingReview = ["submitted","under_review"].includes(providerApplication?.status);
  document.getElementById("marketIdentityName").textContent = marketIdentity.display_name;
  const capacityLabels = [active.has("customer") ? "Захиалга үүсгэх эрхтэй" : "", active.has("provider") ? "Баталгаажсан гүйцэтгэгч" : ""].filter(Boolean);
  if (providerAwaitingReview) capacityLabels.push("Гүйцэтгэгчийн хүсэлт шалгагдаж байна");
  if (providerApplication?.status === "rejected") capacityLabels.push("Гүйцэтгэгчийн хүсэлт буцаагдсан");
  document.getElementById("marketIdentityMemberships").textContent = capacityLabels.length
    ? `${capacityLabels.join(" · ")} · operator эрхээс тусдаа`
    : "Бүртгэлтэй хэрэглэгч · оролцооны эрх хараахан үүсээгүй";
  document.querySelectorAll("[data-market-participation-action]").forEach(button => {
    const action = button.dataset.marketParticipationAction;
    button.classList.toggle("hidden", action === "customer" ? active.has("customer") : active.has("provider") || providerAwaitingReview);
  });
  const providerButton = document.getElementById("marketProviderApplyButton");
  providerButton.disabled = active.has("provider") || providerAwaitingReview;
  providerButton.textContent = active.has("provider") ? "Гүйцэтгэгчийн эрх идэвхтэй" : providerAwaitingReview ? "Хүсэлт шалгагдаж байна" : "Гүйцэтгэгчээр бүртгүүлэх";
  const preferred = active.has(marketIdentity.selected_view) ? marketIdentity.selected_view
    : active.has("customer") ? "customer" : active.has("provider") ? "provider" : "";
  if (preferred) showMarketRole(preferred);
  else showGuestMarket();
}

async function requestMarketRole(role) {
  const view = role === "provider" ? "provider" : "customer";
  if (!marketIdentity) {
    pendingMarketAction = view;
    marketAuthDialog.showModal();
    return;
  }
  if (!(marketIdentity.active_memberships || []).includes(view)) {
    document.getElementById("marketIdentityMemberships").textContent = `${view === "provider" ? "Гүйцэтгэгч" : "Захиалагч"} membership идэвхтэй байх шаардлагатай.`;
    document.querySelector(`[data-market-participation-action="${view}"]`)?.focus();
    return;
  }
  try {
    const data = await marketApi("/view", { method:"POST", body:JSON.stringify({ view }) });
    marketIdentity = data.identity;
    renderMarketIdentity();
    showMarketRole(view);
  } catch (error) {
    if (error.status === 401) { marketIdentity = null; storeMarketToken(); renderMarketIdentity(); }
  }
}

async function restoreMarketIdentity() {
  if (!marketToken()) return renderMarketIdentity();
  try {
    const data = await marketApi("/auth/me");
    marketIdentity = data.identity;
    renderMarketIdentity();
  } catch {
    marketIdentity = null;
    storeMarketToken();
    renderMarketIdentity();
  }
}

function showPortfolioHome() {
  workspaceStudio.classList.add("hidden"); portfolioHome.classList.remove("hidden");
  renderPortfolioHome(document.getElementById("homeSearchInput").value);
  showMarketView(activeMarketView);
  document.getElementById("homeSearchInput").focus();
}

function setHomeIntentState({ invalid = false } = {}) {
  const hasText = Boolean(homeIntentInput.value.trim());
  homeIntentSubmit.disabled = !hasText;
  homeIntentInput.setAttribute("aria-invalid", invalid ? "true" : "false");
  homeIntentHelp.classList.toggle("error", invalid);
  homeIntentHelp.textContent = invalid
    ? "Хүсэлтийн маягт нээхийн өмнө асуудлаа нэг өгүүлбэрээр бичнэ үү."
    : HOME_INTENT_HELP;
}

function setRequestValue(name, value = "") {
  const field = requestForm.elements[name];
  if (!field) return;
  if (field instanceof RadioNodeList) {
    [...field].forEach(input => { input.checked = input.value === value; });
  } else field.value = value;
}

function clearPendingRequestMaterial() {
  pendingRequestMaterial = null;
  requestMaterialSummary.classList.add("hidden");
  requestMaterialName.textContent = "";
  requestMaterialMeta.textContent = "";
  homeRequestFileInput.value = "";
  homeRequestImageInput.value = "";
}

function renderRequestMaterial(material) {
  pendingRequestMaterial = material ? { ...material } : null;
  if (!pendingRequestMaterial) { clearPendingRequestMaterial(); return; }
  requestMaterialIcon.textContent = pendingRequestMaterial.kind === "image" ? "▧" : "＋";
  requestMaterialName.textContent = pendingRequestMaterial.name;
  requestMaterialMeta.textContent = `${pendingRequestMaterial.type} · ${pendingRequestMaterial.size}`;
  requestMaterialSummary.classList.remove("hidden");
}

function requestMaterialFromFile(file, kind) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    homeIntentHelp.classList.add("error");
    homeIntentHelp.textContent = "10 MB хүртэлх материал сонгоно уу. Файл сервер рүү илгээгдээгүй.";
    if (kind === "image") homeRequestImageInput.value = "";
    else homeRequestFileInput.value = "";
    return;
  }
  const extension = file.name.includes(".") ? file.name.split(".").pop().toUpperCase() : "ФАЙЛ";
  const material = {
    name:file.name,
    type:file.type || extension,
    size:formatFileSize(file.size),
    bytes:file.size,
    kind
  };
  const inferredGuide = inferGuide(file.name);
  openRequestDialog({
    guide:inferredGuide !== "discover" ? inferredGuide : /^(vsdx?|svg)$/i.test(extension) ? "structure" : "discover",
    material
  });
}

function showRequestDialog(seed = {}) {
  requestForm.reset();
  requestError.textContent = "";
  renderRequestMaterial(seed.material || null);
  requestDialog.dataset.guide = seed.guide || "discover";
  requestDialog.dataset.templateKey = seed.templateKey || "";
  setRequestValue("requestType", seed.type || "Шинэ систем эсвэл апп");
  setRequestValue("businessArea", seed.area || "");
  setRequestValue("title", seed.title || "");
  setRequestValue("problem", seed.problem || "");
  setRequestValue("desiredOutcome", seed.outcome || "");
  setRequestValue("acceptanceCriteria", seed.acceptance || "");
  [...requestForm.querySelectorAll('input[name="capabilities"]')].forEach(input => { input.checked = (seed.capabilities || []).includes(input.value); });
  requestDialog.showModal();
  requestDialog.scrollTop = 0;
  window.setTimeout(() => { requestDialog.scrollTop = 0; requestDialog.querySelector(".request-dialog-head h2")?.focus?.({ preventScroll:true }); }, 0);
}

async function openRequestDialog(seed = {}) {
  if (!marketIdentity) {
    pendingMarketAction = "customer";
    pendingRequestSeed = seed;
    marketAuthDialog.showModal();
    return;
  }
  try {
    if (!(marketIdentity.active_memberships || []).includes("customer")) {
      const data = await marketApi("/memberships", { method:"POST", body:JSON.stringify({ membershipType:"customer" }) });
      marketIdentity = data.identity;
      renderMarketIdentity();
    }
    await requestMarketRole("customer");
    showRequestDialog(seed);
  } catch (error) {
    document.getElementById("marketIdentityMemberships").textContent = error.message;
  }
}

function renderProviderOnboarding() {
  const readiness = providerReadiness || {};
  const applicationStatus = readiness.providerApplication?.status;
  const review = ["submitted","under_review","approved","rejected"].includes(applicationStatus);
  const step = review ? "review" : !readiness.stepUpValid ? "account" : !readiness.phoneVerified ? "phone" : "profile";
  const order = ["account","phone","profile","review"];
  const currentIndex = order.indexOf(step);
  document.querySelectorAll("[data-provider-step]").forEach(item => {
    const index = order.indexOf(item.dataset.providerStep);
    item.classList.toggle("active", index === currentIndex);
    item.classList.toggle("done", index < currentIndex || (step === "review" && index < 3));
  });
  document.getElementById("providerStepUpPanel").classList.toggle("hidden", step !== "account");
  document.getElementById("providerPhonePanel").classList.toggle("hidden", step !== "phone");
  providerApplicationForm.classList.toggle("hidden", step !== "profile");
  document.getElementById("providerGoogleStepUp").classList.toggle("hidden",
    !(marketIdentity?.external_auth_methods || []).includes("google"));
  providerPasswordStepUpForm.classList.toggle("hidden", !marketIdentity?.has_password);
  document.getElementById("providerStepUpStatus").textContent = readiness.stepUpValid
    ? "Бүртгэл баталгаажлаа." : "Google эсвэл одоогийн нууц үгээрээ дахин баталгаажуулна уу.";
  document.getElementById("providerPhoneStatus").textContent = readiness.phoneVerified
    ? `${readiness.maskedPhone} баталгаажсан.`
    : readiness.phoneAvailable
      ? "Монголын 8 оронтой дугаар эсвэл + улсын кодтой дугаар оруулна."
      : "Утас баталгаажуулах үйлчилгээ хараахан тохируулагдаагүй байна.";
  providerPhoneRequestForm.classList.toggle("hidden", !readiness.phoneAvailable || readiness.phoneVerified);
  if (review) {
    const labels = { submitted:"Хүсэлт илгээгдсэн. Market operator хяналтаа эхлүүлэхийг хүлээж байна.",
      under_review:"Хүсэлт Market operator-ын хяналтад байна.",
      approved:"Гүйцэтгэгчийн хүсэлт зөвшөөрөгдсөн.", rejected:"Хүсэлт татгалзсан. Шалтгааныг account төлөвөөс харна уу." };
    document.getElementById("providerOnboardingStatus").textContent = labels[applicationStatus] || "";
  }
}

async function refreshProviderReadiness() {
  providerReadiness = await marketApi("/auth/provider-readiness");
  renderProviderOnboarding();
}

async function openProviderApplication() {
  if (!marketIdentity) {
    pendingMarketAction = "provider";
    marketAuthDialog.showModal();
    return;
  }
  if ((marketIdentity.active_memberships || []).includes("provider")) {
    requestMarketRole("provider");
    return;
  }
  providerApplicationForm.reset();
  providerPasswordStepUpForm.reset();
  providerPhoneRequestForm.reset();
  providerPhoneConfirmForm.reset();
  providerPhoneConfirmForm.classList.add("hidden");
  document.getElementById("providerApplicationError").textContent = "";
  document.getElementById("providerOnboardingStatus").textContent = "";
  providerApplicationDialog.showModal();
  try { await refreshProviderReadiness(); }
  catch (error) { document.getElementById("providerOnboardingStatus").textContent = error.message; }
}

function continuePendingMarketAction() {
  const action = pendingMarketAction;
  const seed = pendingRequestSeed || {};
  pendingMarketAction = "";
  pendingRequestSeed = null;
  if (action === "customer") openRequestDialog(seed);
  if (action === "provider") openProviderApplication();
}

function compileRequestPackage(formData, material = null) {
  const capabilities = formData.getAll("capabilities");
  const lines = [
    `ХҮСЭЛТИЙН ГАРЧИГ: ${formData.get("title")}`,
    `АЖЛЫН ТӨРӨЛ: ${formData.get("requestType")}`,
    `ЧИГЛЭЛ: ${formData.get("businessArea")}`,
    `ОДООГИЙН АСУУДАЛ: ${formData.get("problem")}`,
    `ХҮССЭН ҮР ДҮН: ${formData.get("desiredOutcome")}`,
    `ХҮЛЭЭН АВАХ ШАЛГУУР: ${formData.get("acceptanceCriteria")}`,
    `ХЭРЭГТЭЙ БОЛОМЖ: ${capabilities.join(", ")}`,
    `ТӨСӨВ: ${formData.get("budgetModel")}${formData.get("budgetNote") ? ` · ${formData.get("budgetNote")}` : ""}`,
    `ХУГАЦАА: ${formData.get("period")}`,
    `ХАРАГДАХ ХҮРЭЭ: ${formData.get("visibility")}`,
    `ХАВСАРГАСАН МАТЕРИАЛ: ${material ? `${material.name} · ${material.type} · ${material.size} (агуулга browser-local)` : "Байхгүй"}`,
    `OVERVA НЭМЭЛТ ШАЛГАЛТ: ${formData.get("aiReview") ? "Хүссэн" : "Хүсээгүй — зөвхөн бүтэцтэй хүсэлтийг хүн шалгана"}`
  ];
  return lines.join("\n");
}

function loadRequestDraftRegistry() {
  try {
    const stored = JSON.parse(localStorage.getItem(REQUEST_DRAFT_REGISTRY_KEY));
    const legacy = JSON.parse(localStorage.getItem(LEGACY_REQUEST_DRAFT_STORAGE_KEY));
    return normalizeRequestDraftRegistry(stored, legacy, {
      createId:createRequestDraftId,
      createWorkspaceId,
      resolveLegacyWorkspaceId:() => loadWorkspaceRegistry().currentWorkspaceId
    });
  } catch {
    return normalizeRequestDraftRegistry(null, null, { createId:createRequestDraftId, createWorkspaceId });
  }
}

function saveRequestDraft(payload) {
  try {
    const registry = upsertRequestDraft(loadRequestDraftRegistry(), payload);
    localStorage.setItem(REQUEST_DRAFT_REGISTRY_KEY, JSON.stringify(registry));
    return registry;
  } catch { return null; /* Storage may be disabled or full. */ }
}

function focusHomeNeedInput() {
  workspaceStudio.classList.add("hidden");
  portfolioHome.classList.remove("hidden");
  showPublicWorkView();
  openRequestDialog();
}

function showWorkspace(workspaceId) {
  portfolioHome.classList.add("hidden"); workspaceStudio.classList.remove("hidden");
  switchWorkspace(workspaceId || loadWorkspaceRegistry().currentWorkspaceId);
}

function beginWorkspaceFromHome(text = "", forcedKey = "", sourceKind = "", options = {}) {
  const value = String(text || "").trim();
  if (!value && !sourceKind) { focusHomeNeedInput(); return false; }
  portfolioHome.classList.add("hidden"); workspaceStudio.classList.remove("hidden");
  const workspaceId = resetWorkspace();
  if (options.materialSource) {
    activeSource = {
      ...options.materialSource,
      url:"",
      details:"Материалын агуулгыг сервер эсвэл AI руу илгээгээгүй. Хүсэлтийн ноорогт зөвхөн нэр, төрөл, хэмжээ хадгалагдсан."
    };
  }
  window.setTimeout(() => {
    if (value) runConversation(value, forcedKey || undefined, { checkpointUpdate:options.checkpointUpdate });
    else if (sourceKind === "file") document.getElementById("sourceFileInput").click();
    else if (sourceKind === "image") document.getElementById("sourceImageInput").click();
    else intentInput.focus();
  }, 0);
  return workspaceId;
}

function checkpointDescription(checkpoint) {
  const path = guidePaths[checkpoint.guide] || guidePaths.discover;
  return describeCheckpoint(checkpoint, path.product);
}

function memoryAnswer(checkpoint, focus = "overview") {
  const path = guidePaths[checkpoint.guide] || guidePaths.discover;
  return answerMemory(checkpoint, path.product, focus);
}

function renderDeliveryLifecycle(checkpoint = loadCheckpoint()) {
  const lifecycle = deriveLifecycle(checkpoint);
  const stagebar = document.getElementById("deliveryStagebar");
  if (!stagebar) return lifecycle;
  stagebar.replaceChildren();
  lifecycle.stages.forEach((stage, index) => {
    const item = document.createElement("div");
    item.className = `delivery-stage ${stage.status}`;
    item.title = stage.description;
    const number = document.createElement("span"); number.textContent = stage.status === "completed" ? "✓" : String(index + 1);
    const label = document.createElement("strong"); label.textContent = stage.label;
    item.append(number, label); stagebar.append(item);
  });
  const sidebarLifecycle = document.getElementById("sidebarLifecycle");
  sidebarLifecycle.replaceChildren();
  lifecycle.stages.forEach((stage, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `journey-step ${stage.status}`;
    button.dataset.lifecycleStage = stage.code;
    button.title = stage.description;
    const marker = document.createElement("span"); marker.textContent = stage.status === "completed" ? "✓" : stage.status === "locked" ? "🔒" : "●";
    const copy = document.createElement("span");
    const label = document.createElement("strong"); label.textContent = stage.label;
    const status = document.createElement("small"); status.textContent = stage.status === "completed" ? "Дууссан" : stage.status === "current" ? "Одоо энд" : index === lifecycle.stages.findIndex(item => item.status === "current") + 1 ? "Дараагийн шат" : "Дарааллаар нээгдэнэ";
    copy.append(label, status); button.append(marker, copy); sidebarLifecycle.append(button);
  });
  const currentIndex = lifecycle.stages.findIndex(stage => stage.status === "current");
  renderWorkspaceSelector();
  document.getElementById("sidebarStageCount").textContent = `${currentIndex + 1}/${lifecycle.stages.length} · ${lifecycle.current.label}`;
  document.getElementById("sidebarNextStage").textContent = lifecycle.next ? `${lifecycle.next.label} шатанд орох` : "Тогтвортой ажиллуулах";
  document.getElementById("sidebarNextAction").textContent = lifecycle.next
    ? lifecycle.missing[0] || lifecycle.next.description
    : "Хяналт, support болон сайжруулалтыг тасралтгүй үргэлжлүүлнэ.";
  document.getElementById("deliveryCurrentStage").textContent = lifecycle.current.label;
  document.getElementById("deliveryNextStep").textContent = lifecycle.next
    ? `Дараагийн “${lifecycle.next.label}” шатанд: ${lifecycle.missing.join(" · ")}`
    : "Production орчин хүлээн авч, үйл ажиллагааны бэлэн байдлыг баталсан.";
  const publish = document.getElementById("publishReadinessButton");
  publish.disabled = !lifecycle.canPublish;
  publish.textContent = lifecycle.canPublish ? "Production-д гаргахад бэлэн" : "Production-д гаргах түгжээтэй";
  return lifecycle;
}

function handleLifecycleStage(stageCode) {
  const checkpoint = loadCheckpoint();
  const lifecycle = deriveLifecycle(checkpoint);
  const stage = lifecycle.stages.find(item => item.code === stageCode);
  if (!stage) return;
  if (stage.status === "locked") {
    const directNext = lifecycle.next?.code === stage.code;
    const missing = missingFor(stage.code, checkpoint);
    addAssistantNotice(`${stage.label} шат одоогоор түгжээтэй`, directNext
      ? `Энэ шат нээгдэхэд: ${missing.join(" · ")}. Эдгээрийг ярилцаж, хүн баталсны дараа нээгдэнэ.`
      : `Эхлээд “${lifecycle.next?.label}” шатыг дуусгана. Дараа нь ${missing.join(" · ") || stage.description.toLocaleLowerCase("mn-MN")} шаардлагыг шалгана.`);
    return;
  }
  addAssistantNotice(`${stage.label} шат`, stage.status === "current"
    ? `Та одоо энэ шатанд байна. ${stage.description}. Дараагийн алхам: ${lifecycle.missing[0] || "энэ шатны ажлыг үргэлжлүүлэх"}.`
    : `${stage.description}. Энэ шатны баталсан түүх хадгалагдсан; одоогийн ажил “${lifecycle.current.label}” шатанд үргэлжилж байна.`);
}

function setSidebarToolActive(action) {
  document.querySelectorAll("[data-sidebar-action]").forEach(button => button.classList.toggle("active", button.dataset.sidebarAction === action));
}

function handleSidebarAction(action) {
  setSidebarToolActive(action);
  const checkpoint = loadCheckpoint();
  if (action === "chat") { intentInput.focus(); return; }
  if (action === "material") { sourceMenu.classList.remove("hidden"); intentInput.focus(); return; }
  if (action === "preview") {
    if (!checkpoint) { addAssistantNotice("Preview эхлээгүй байна", "Хийлгэх ажлаа тайлбарлах эсвэл материал өгсний дараа эхний ажилладаг хувилбар энд гарна."); return; }
    if (productPreview.classList.contains("hidden")) restoreCheckpoint(checkpoint);
    else document.getElementById("previewActionStatus").textContent = "Preview дээр товч, карт, урсгалаа шалгана уу";
    return;
  }
  if (!checkpoint) { addAssistantNotice("Хадгалсан ажлын санамж алга", "Эхлээд ажлаа тайлбарлах эсвэл материал өгч эхний checkpoint-оо үүсгэнэ үү."); return; }
  if (action === "decisions") {
    addAssistantNotice("Баталсан шийдвэр", memoryAnswer(checkpoint, "confirmed"));
    return;
  }
  if (action === "tests") {
    const activities = checkpoint.previewActivity || [];
    addAssistantNotice("Preview туршилтын түүх", activities.length
      ? `${activities.length} туршилтын үйлдэл байна: ${activities.slice(-5).map(item => item.label).join("; ")}. Эдгээр нь production гүйцэтгэл биш.`
      : "Preview дээр туршсан үйлдэл одоогоор алга. Preview шалгах хэрэгслээр орж нэг товч, карт эсвэл урсгал туршина уу.");
  }
}

function resetWorkspaceView() {
  conversationId += 1; activeGuide = "discover";
  if (activeSourceUrl) URL.revokeObjectURL(activeSourceUrl);
  activeSource = null; activeSourceUrl = "";
  chatStream.querySelectorAll(".message:not(:first-child)").forEach(message => message.remove());
  productPreview.classList.add("hidden"); emptyPreview.classList.remove("hidden"); previewStage.textContent = "Эхлэхэд бэлэн"; intentInput.value = "";
}

function resetWorkspace() {
  const registry = startNewWorkspace(loadWorkspaceRegistry(), { createId:createWorkspaceId });
  persistWorkspaceRegistry(registry);
  resetWorkspaceView(); renderDeliveryLifecycle(null); intentInput.focus();
  return registry.currentWorkspaceId;
}

function switchWorkspace(workspaceId) {
  const before = loadWorkspaceRegistry();
  const registry = selectWorkspace(before, workspaceId);
  if (registry.currentWorkspaceId === before.currentWorkspaceId && workspaceId !== before.currentWorkspaceId) return;
  persistWorkspaceRegistry(registry);
  resetWorkspaceView();
  const checkpoint = loadCheckpoint();
  renderDeliveryLifecycle(checkpoint);
  if (checkpoint) restoreCheckpoint(checkpoint);
  else intentInput.focus();
}

function addUserMessage(text) {
  const article = document.createElement("article");
  article.className = "message user-message";
  const content = document.createElement("div");
  content.className = "message-content";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  content.append(paragraph); article.append(content); chatStream.append(article); scrollChat();
}

function addTyping() {
  const article = document.createElement("article");
  article.className = "message assistant-reply";
  article.innerHTML = `<div class="avatar">OV</div><div class="message-content"><span>OVERVA</span><div class="typing"><i></i><i></i><i></i></div></div>`;
  chatStream.append(article); scrollChat(); return article;
}

function renderSourceCard() {
  if (!activeSource) return;
  const card = document.createElement("article"); card.className = "source-card";
  const head = document.createElement("div");
  const icon = document.createElement("span"); icon.textContent = activeSource.kind === "image" ? "ЗР" : "Ф";
  const copy = document.createElement("div");
  const title = document.createElement("strong"); title.textContent = activeSource.name;
  const meta = document.createElement("small"); meta.textContent = `${activeSource.type} · ${activeSource.size}`;
  copy.append(title,meta); head.append(icon,copy); card.append(head);
  if (activeSource.url) { const image = document.createElement("img"); image.src = activeSource.url; image.alt = "Сонгосон зураг, схемийн локал preview"; card.append(image); }
  if (activeSource.details) { const details = document.createElement("p"); details.textContent = activeSource.details; card.append(details); }
  const safety = document.createElement("small"); safety.textContent = "Энэ материал browser-оос гараагүй."; card.append(safety);
  document.getElementById("productWorkspace").prepend(card);
}

function renderPreviewWorkspace(tab = "product") {
  const path = guidePaths[activeGuide];
  const key = tab === "product" ? path.workspace : tab;
  const template = workspaceTemplates[key] || workspaceTemplates.discover;
  const workspace = document.getElementById("productWorkspace");
  workspace.innerHTML = template();
  const profile = loadCheckpoint()?.organizationProfile;
  if (profile) {
    const card = document.createElement("section"); card.className = "organization-understanding";
    const label = document.createElement("small"); label.textContent = "ӨГСӨН ТАЙЛБАРААС ГАРГАСАН УРЬДЧИЛСАН ОЙЛГОЛТ";
    const title = document.createElement("h3"); title.textContent = profile.name;
    const note = document.createElement("p"); note.textContent = "Доорх мэдээлэл баталгаажаагүй. Таны тайлбараас ялгасан бөгөөд засаж, баталсны дараа л суурь ойлголт болно.";
    const facts = document.createElement("div"); facts.className = "organization-facts";
    if (profile.employeeCount) { const fact = document.createElement("span"); fact.textContent = `${profile.employeeCount} ажилтан`; facts.append(fact); }
    profile.activities.forEach(activity => { const fact = document.createElement("span"); fact.textContent = activity; facts.append(fact); });
    card.append(label,title,note,facts); workspace.prepend(card);
  }
  const titles = { structure:"Байгууллагын бүтэц", workflow:"Ажлын урсгал", systems:"Системийн зураглал", product:path.product };
  document.getElementById("previewTitle").textContent = titles[tab];
  if (tab === "product") renderSourceCard();
}

function renderPreview(path) {
  emptyPreview.classList.add("hidden");
  productPreview.classList.remove("hidden");
  productPreview.classList.add("building");
  previewStage.textContent = path.stage;
  document.getElementById("productIcon").textContent = path.icon;
  document.getElementById("productTitle").textContent = path.product;
  document.getElementById("productBadge").textContent = "Бүтээж байна";
  document.getElementById("previewActionStatus").textContent = "Товчнуудыг дарж туршина уу";
  document.querySelectorAll("[data-preview-tab]").forEach(button => button.classList.toggle("active", button.dataset.previewTab === "product"));
  renderPreviewWorkspace("product");
  renderDeliveryLifecycle();
  window.setTimeout(() => {
    productPreview.classList.remove("building");
    previewStage.textContent = "Таны хяналт хүлээж байна";
    document.getElementById("productBadge").textContent = "Урьдчилсан";
  }, 550);
}

function addAssistantReply(path, token) {
  const typing = addTyping();
  window.setTimeout(() => {
    if (token !== conversationId) { typing.remove(); return; }
    typing.remove();
    const article = document.createElement("article"); article.className = "message assistant-reply";
    const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = "OV";
    const content = document.createElement("div"); content.className = "message-content";
    const label = document.createElement("span"); label.textContent = "OVERVA · ТАНЫГ ИНГЭЖ ОЙЛГОЛОО";
    const title = document.createElement("h2"); title.textContent = path.product;
    const reply = document.createElement("p");
    const confirm = document.createElement("p"); confirm.className = "confirmation";
    const actions = document.createElement("div"); actions.className = "reply-actions";
    const yes = document.createElement("button"); yes.type = "button"; yes.className = "primary"; yes.textContent = "Тийм, зөв";
    const revise = document.createElement("button"); revise.type = "button"; revise.textContent = "Засах зүйл байна";
    yes.addEventListener("click", confirmCurrentBuild);
    revise.addEventListener("click", () => { intentInput.focus(); intentInput.placeholder = "Юуг өөрчлөх хэрэгтэйг бичнэ үү…"; });
    actions.append(yes,revise); content.append(label,title,reply,confirm,actions); article.append(avatar,content); chatStream.append(article);
    renderPreview(path); scrollChat();
    const fullReply = path.reply; let position = 0;
    const timer = window.setInterval(() => {
      if (token !== conversationId) { window.clearInterval(timer); return; }
      position = Math.min(position + 4, fullReply.length); reply.textContent = fullReply.slice(0,position); scrollChat();
      if (position >= fullReply.length) { window.clearInterval(timer); confirm.textContent = path.confirmation; scrollChat(); }
    }, 14);
  }, 420);
}

function runConversation(text, forcedKey, options = {}) {
  const value = String(text || "").trim(); if (!value) return;
  if (!forcedKey && handleContextIntent(value)) { intentInput.value = ""; return; }
  const currentCheckpoint = loadCheckpoint();
  if (!options.skipConflict && shouldChooseWorkspace(value, currentCheckpoint)) {
    addUserMessage(value); intentInput.value = "";
    addWorkspaceChoicePrompt(value, forcedKey, currentCheckpoint);
    return;
  }
  const key = forcedKey || inferGuide(value); activeGuide = key; conversationId += 1;
  const profile = extractOrganizationProfile(value);
  if (!options.skipUser) addUserMessage(value);
  intentInput.value = ""; saveCheckpoint({
    confirmationStatus:"pending", activityStatus:"conversation", lastUserText:value, lastAction:"", previewTab:"product", newHypothesis:true,
    organizationProfile:profile || currentCheckpoint?.organizationProfile || null,
    workspaceName:profile?.name || currentCheckpoint?.workspaceName || "",
    evidenceEntry:{ kind:"message", text:value, source:"user" },
    discussionEntry:{ topic:guidePaths[key].product, text:value },
    ...(options.checkpointUpdate || {})
  });
  const path = profile ? {
    ...guidePaths[key],
    product:`${profile.name} · ${guidePaths[key].product}`,
    reply:`${profile.name} нэртэй${profile.employeeCount ? `, ${profile.employeeCount} ажилтантай` : ""} байгууллага гэж урьдчилсан байдлаар ойлголоо.${profile.activities.length ? ` Үндсэн ажил: ${profile.activities.join(", ")}.` : ""} Энэ нь таны өгсөн үгнээс ялгасан таамаг бөгөөд өмнөх ажлын өрөөтэй хольж хадгалаагүй.`,
    confirmation:"Байгууллагын нэр, хүний тоо болон үндсэн ажлын энэ ойлголт зөв үү? Засах зүйл байвал бичээрэй."
  } : guidePaths[key];
  addAssistantReply(path, conversationId);
}

function confirmCurrentBuild() {
  previewStage.textContent = "Ойлголт баталгаажсан";
  document.getElementById("productBadge").textContent = "Баталгаажсан";
  saveCheckpoint({
    confirmationStatus:"confirmed",
    lastAction:"Ойлголтын эхний хувилбарыг баталсан",
    planEntry:{ statement:"Preview-г шалгаад дараагийн жижиг өөрчлөлтийг сонгох", status:"planned" }
  });
  const article = document.createElement("article"); article.className = "message assistant-reply";
  article.innerHTML = `<div class="avatar">OV</div><div class="message-content"><span>OVERVA</span><h2>Ойлголт баталгаажлаа.</h2><p>Энэ эхний хувилбараас үргэлжлүүлэн жижиг загвараа туршиж болно. Загвар дээрх туршилт нь бодит гүйцэтгэл биш; хийх ажлын хүрээ, үнэ, гэрээ болон ашиглалтад оруулах хэлбэрээ тусад нь тохирно.</p><div class="reply-actions"><button class="primary" type="button" data-open-trial>Ажлын өрөөг хадгалах</button><button type="button" data-continue-chat>Нэмж ярилцах</button></div></div>`;
  article.querySelector("[data-open-trial]").addEventListener("click", openTrial);
  article.querySelector("[data-continue-chat]").addEventListener("click", () => intentInput.focus());
  chatStream.append(article); scrollChat();
}

function suggestWorkspaceName() {
  if (!activeSource?.name) return workspaceNames[activeGuide] || workspaceNames.discover;
  const name = activeSource.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return name.slice(0, 80) || workspaceNames[activeGuide] || workspaceNames.discover;
}

function renderTrialSummary(name) {
  document.getElementById("trialSummaryName").textContent = name;
  document.getElementById("trialSummarySource").textContent = activeSource
    ? `${activeSource.name} материалын нэр болон таны баталсан ажлын чиглэлээс санал болгов.`
    : "Таны баталсан яриа, ажлын зураглалыг ашиглана.";
  const capabilities = document.getElementById("trialSummaryCapabilities");
  capabilities.replaceChildren();
  const product = document.createElement("span"); product.textContent = guidePaths[activeGuide].product; capabilities.append(product);
  guidePaths[activeGuide].modules.forEach(code => {
    const chip = document.createElement("span"); chip.textContent = moduleNames[code] || code; capabilities.append(chip);
  });
}

function openTrial() {
  const checkpoint = loadCheckpoint();
  const suggestedName = checkpoint?.workspaceName || suggestWorkspaceName();
  const form = document.getElementById("trialForm");
  const nameInput = form.elements.workspaceName;
  if (!nameInput.value || nameInput.value === nameInput.dataset.suggestedName) nameInput.value = suggestedName;
  nameInput.dataset.suggestedName = suggestedName;
  renderTrialSummary(nameInput.value);
  const lifecycle = renderDeliveryLifecycle();
  document.getElementById("saveLifecycleStage").textContent = `${lifecycle.current.label} · ${lifecycle.next ? `дараагийн шат ${lifecycle.next.label}` : "ажиллуулахад бэлэн"}`;
  document.getElementById("saveLifecycleMissing").textContent = lifecycle.next
    ? `Дутуу: ${lifecycle.missing.join(" · ")}. Хадгалалт эдгээр хаалгыг автоматаар батлахгүй.`
    : "Production бэлэн байдлын бүх баталгаа бүрдсэн.";
  form.classList.remove("hidden");
  document.getElementById("trialSuccess").classList.add("hidden");
  if (!trialDialog.open) trialDialog.showModal();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function addAssistantNotice(titleText, bodyText) {
  const article = document.createElement("article"); article.className = "message assistant-reply";
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = "OV";
  const content = document.createElement("div"); content.className = "message-content";
  const label = document.createElement("span"); label.textContent = "OVERVA";
  const title = document.createElement("h2"); title.textContent = titleText;
  const body = document.createElement("p"); body.textContent = bodyText;
  content.append(label,title,body); article.append(avatar,content); chatStream.append(article); scrollChat();
}

function addWorkspaceChoicePrompt(value, forcedKey, checkpoint) {
  const article = document.createElement("article"); article.className = "message assistant-reply workspace-choice-message";
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = "OV";
  const content = document.createElement("div"); content.className = "message-content";
  const label = document.createElement("span"); label.textContent = "OVERVA · МЭДЭЭЛЛИЙГ ХОЛИХООС ӨМНӨ";
  const title = document.createElement("h2"); title.textContent = "Энэ өмнөх ажилтай холбоотой юу?";
  const body = document.createElement("p");
  body.textContent = `Одоогийн “${checkpoint.workspaceName || guidePaths[checkpoint.guide]?.product || "ажлын өрөө"}” дотор ${checkpoint.source ? checkpoint.source.name : "өмнөх тайлбар"} байна. Шинэ байгууллагын мэдээллийг зөвшөөрөлгүйгээр түүнтэй нийлүүлэхгүй.`;
  const actions = document.createElement("div"); actions.className = "reply-actions";
  const same = document.createElement("button"); same.type = "button"; same.textContent = "Энэ ажилд нэмэх";
  const separate = document.createElement("button"); separate.type = "button"; separate.className = "primary"; separate.textContent = "Шинэ ажлын өрөө болгох";
  same.addEventListener("click", () => { actions.remove(); runConversation(value, forcedKey, { skipConflict:true, skipUser:true }); });
  separate.addEventListener("click", () => { resetWorkspace(); runConversation(value, forcedKey, { skipConflict:true }); });
  actions.append(same,separate); content.append(label,title,body,actions); article.append(avatar,content); chatStream.append(article); scrollChat();
}

function addFileWorkspaceChoicePrompt(file, kind, checkpoint) {
  const article = document.createElement("article"); article.className = "message assistant-reply workspace-choice-message";
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = "OV";
  const content = document.createElement("div"); content.className = "message-content";
  const label = document.createElement("span"); label.textContent = "OVERVA · ФАЙЛЫГ ХОЛИХООС ӨМНӨ";
  const title = document.createElement("h2"); title.textContent = "Энэ файл одоогийн ажилд хамаарах уу?";
  const body = document.createElement("p");
  body.textContent = `“${file.name}” файлыг “${checkpoint.workspaceName || guidePaths[checkpoint.guide]?.product || "одоогийн ажлын өрөө"}”-д зөвшөөрөлгүйгээр нийлүүлэхгүй.`;
  const actions = document.createElement("div"); actions.className = "reply-actions";
  const same = document.createElement("button"); same.type = "button"; same.textContent = "Энэ ажилд нэмэх";
  const separate = document.createElement("button"); separate.type = "button"; separate.className = "primary"; separate.textContent = "Шинэ ажлын өрөө болгох";
  same.addEventListener("click", () => { actions.remove(); handleSourceFile(file, kind, { skipConflict:true, skipUser:true }); });
  separate.addEventListener("click", () => { resetWorkspace(); handleSourceFile(file, kind, { skipConflict:true }); });
  actions.append(same,separate); content.append(label,title,body,actions); article.append(avatar,content); chatStream.append(article); scrollChat();
}

function restoreCheckpoint(checkpoint) {
  activeGuide = checkpoint.guide;
  activeSource = checkpoint.source ? {
    ...checkpoint.source,
    url:"",
    details:"Материалын агуулга хадгалагдаагүй. Үргэлжлүүлэх бол файлаа дахин сонгоно уу."
  } : null;
  renderPreview(guidePaths[activeGuide]);
  window.setTimeout(() => {
    const tab = checkpoint.previewTab || "product";
    document.querySelectorAll("[data-preview-tab]").forEach(button => button.classList.toggle("active", button.dataset.previewTab === tab));
    renderPreviewWorkspace(tab);
    if (checkpoint.confirmationStatus === "confirmed") {
      previewStage.textContent = "Ойлголт баталгаажсан";
      document.getElementById("productBadge").textContent = "Баталгаажсан";
    } else {
      previewStage.textContent = "Урьдчилсан ойлголт · баталгаажаагүй";
      document.getElementById("productBadge").textContent = "Баталгаажаагүй";
    }
  }, 600);
  addAssistantNotice("Өмнөх ажлаа үргэлжлүүллээ", `${checkpointDescription(checkpoint)} Одоо preview-гээ шалгах эсвэл дараагийн өөрчлөлтөө бичээрэй.`);
}

function addResumePrompt(checkpoint, greeting = false, focus = "overview") {
  const article = document.createElement("article"); article.className = "message assistant-reply resume-message";
  const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.textContent = "OV";
  const content = document.createElement("div"); content.className = "message-content";
  const label = document.createElement("span"); label.textContent = "OVERVA · ӨМНӨХ ЯРИЛЦЛАГА БА АЖЛЫН САНАМЖ";
  const titles = { confirmed:"Баталсан ойлголтын төлөв", plan:"Төлөвлөгөө ба дараагийн алхам", evidence:"Өгсөн нотолгооны санамж", executed:"Бодит гүйцэтгэлийн төлөв" };
  const title = document.createElement("h2"); title.textContent = titles[focus] || (greeting
    ? checkpoint.confirmationStatus === "confirmed" ? "Сайн байна уу. Өмнөх ажил тань хадгалагдсан байна." : "Сайн байна уу. Өмнөх ярилцлагын санамж байна."
    : "Сүүлд энд зогссон байна.");
  const body = document.createElement("p"); body.textContent = memoryAnswer(checkpoint, focus);
  const memory = checkpoint.memory || {};
  const status = document.createElement("div"); status.className = "memory-layer-status";
  [
    `Нотолгоо ${memory.evidence?.length || 0}`,
    `Таамаг ${memory.hypotheses?.length || 0}`,
    `Баталсан ${memory.confirmed?.length || 0}`,
    `Бодит ажил ${memory.executionVerification?.length || 0}`
  ].forEach(text => { const chip = document.createElement("span"); chip.textContent = text; status.append(chip); });
  const time = document.createElement("small"); time.className = "checkpoint-time"; time.textContent = `Сүүлд шинэчилсэн: ${new Date(checkpoint.updatedAt).toLocaleString("mn-MN")}`;
  const actions = document.createElement("div"); actions.className = "reply-actions";
  const resume = document.createElement("button"); resume.type = "button"; resume.className = "primary"; resume.textContent = "Тэндээс үргэлжлүүлэх";
  const fresh = document.createElement("button"); fresh.type = "button"; fresh.textContent = "Шинэ ажил эхлэх";
  resume.addEventListener("click", () => restoreCheckpoint(checkpoint));
  fresh.addEventListener("click", resetWorkspace);
  actions.append(resume,fresh); content.append(label,title,body,status,time,actions); article.append(avatar,content); chatStream.append(article); scrollChat();
}

function handleContextIntent(value) {
  const intent = classifyContextIntent(value);
  if (!intent) return false;
  addUserMessage(value);
  const checkpoint = loadCheckpoint();
  if (checkpoint) addResumePrompt(checkpoint, intent.greeting, intent.focus);
  else addAssistantNotice(intent.greeting ? "Сайн байна уу." : "Өмнөх хадгалсан ажил алга байна", intent.greeting
    ? "Хийлгэх ажлаа энгийнээр тайлбарлах, файл өгөх эсвэл зураг харуулахаас эхэлж болно."
    : "Энэ browser дээр өмнөх ажлын checkpoint олдсонгүй. Шинэ ажлаа тайлбарлаад эхлээрэй.");
  return true;
}

async function handleSourceFile(file, kind, options = {}) {
  if (!file) return;
  const currentCheckpoint = loadCheckpoint();
  if (!options.skipConflict && currentCheckpoint && (currentCheckpoint.organizationProfile || currentCheckpoint.source?.name !== file.name)) {
    addUserMessage(`Материал сонголоо: ${file.name}`);
    addFileWorkspaceChoicePrompt(file, kind, currentCheckpoint);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    addUserMessage(`Материал сонголоо: ${file.name}`);
    addAssistantNotice("Файл хэт том байна", "Нийтийн demo-д 10 MB хүртэлх материал сонгоно уу. Файл сервер рүү илгээгдээгүй.");
    return;
  }
  if (activeSourceUrl) URL.revokeObjectURL(activeSourceUrl);
  activeSourceUrl = kind === "image" ? URL.createObjectURL(file) : "";
  const extension = file.name.split(".").pop().toLocaleLowerCase("mn-MN");
  let details = "Файлын агуулгыг энэ нийтийн demo сервер эсвэл AI руу илгээгээгүй.";
  if (extension === "csv" || extension === "txt") {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const columns = (lines[0] || "").split(",").filter(Boolean).length;
    details = `${Math.max(lines.length - 1, 0)} өгөгдлийн мөр · ${columns} багана локал байдлаар танигдлаа.`;
  }
  activeSource = { name:file.name, type:file.type || extension.toUpperCase(), size:formatFileSize(file.size), kind, url:activeSourceUrl, details };
  const inferredFromName = inferGuide(file.name);
  const key = inferredFromName !== "discover" ? inferredFromName : /vsdx?|svg/.test(extension) ? "structure" : "discover";
  activeGuide = key; conversationId += 1;
  if (!options.skipUser) addUserMessage(`Материал өглөө: ${file.name}`);
  saveCheckpoint({
    confirmationStatus:"pending", activityStatus:"conversation", lastUserText:`Материал өглөө: ${file.name}`, lastAction:"", previewTab:"product", newHypothesis:true,
    evidenceEntry:{ kind:"file", name:file.name, type:activeSource.type, size:activeSource.size, source:"user" },
    discussionEntry:{ topic:guidePaths[key].product, text:`${file.name} материалыг ойлгох` }
  });
  const sourcePath = {
    ...guidePaths[key],
    reply:`${file.name} материалыг сонголоо. Одоогоор файлын нэр, төрөл${details.startsWith("Файлын") ? "" : " болон локал хүснэгтийн бүтэц"}-д тулгуурлан эхний зураглалыг гаргалаа; агуулгыг бодитоор AI шинжилсэн гэж үзэхгүй.`,
    confirmation:"Энэ материалыг танай байгууллагын одоогийн бүтэц, ажил эсвэл системийг ойлгуулах эх сурвалж болгон ашиглах нь зөв үү?"
  };
  addAssistantReply(sourcePath, conversationId);
  document.getElementById("sourceMenu").classList.add("hidden");
}

document.getElementById("productWorkspace").addEventListener("click", event => {
  const selectable = event.target.closest("[data-preview-select]");
  if (selectable) {
    selectable.parentElement.querySelectorAll("[data-preview-select]").forEach(item => item.classList.remove("active"));
    selectable.classList.add("active");
    const selectedName = selectable.querySelector("strong").textContent;
    document.getElementById("previewActionStatus").textContent = `${selectedName} сонгогдлоо`;
    saveCheckpoint({ activityStatus:"previewing", lastAction:`${selectedName}-ийг сонгож`, previewEntry:{ label:`${selectedName}-ийг сонгож`, action:"select" } });
  }
  const action = event.target.closest("[data-preview-action]");
  if (action) {
    document.getElementById("previewActionStatus").textContent = action.dataset.previewAction;
    document.getElementById("productBadge").textContent = "Туршсан";
    saveCheckpoint({ activityStatus:"previewing", lastAction:action.dataset.previewAction, previewEntry:{ label:action.dataset.previewAction, action:"button" } });
  }
});

document.getElementById("productWorkspace").addEventListener("change", event => {
  if (event.target.matches("[data-preview-file]")) {
    const fileName = event.target.files[0]?.name;
    document.getElementById("previewActionStatus").textContent = fileName ? `${fileName} сонгогдлоо` : "Файл сонгоогүй";
    if (fileName) saveCheckpoint({ activityStatus:"previewing", lastAction:`${fileName} файлыг сонгож`, previewEntry:{ label:`${fileName} файлыг сонгож`, action:"file_preview" } });
  }
});

document.querySelectorAll("[data-preview-tab]").forEach(button => button.addEventListener("click", () => {
  button.parentElement.querySelectorAll("[data-preview-tab]").forEach(item => item.classList.remove("active"));
  button.classList.add("active");
  renderPreviewWorkspace(button.dataset.previewTab);
  document.getElementById("previewActionStatus").textContent = `${button.textContent} харагдац нээгдлээ`;
  saveCheckpoint({ activityStatus:"previewing", lastAction:`${button.textContent} харагдацыг`, previewTab:button.dataset.previewTab, previewEntry:{ label:`${button.textContent} харагдацыг нээж`, action:"tab" } });
}));

document.querySelectorAll("[data-intent]").forEach(button => button.addEventListener("click", () => runConversation(examples[button.dataset.intent], button.dataset.intent)));
const sourceMenu = document.getElementById("sourceMenu");
const sourceFileInput = document.getElementById("sourceFileInput");
const sourceImageInput = document.getElementById("sourceImageInput");
document.getElementById("sidebarLifecycle").addEventListener("click", event => {
  const button = event.target.closest("[data-lifecycle-stage]");
  if (button) handleLifecycleStage(button.dataset.lifecycleStage);
});
document.getElementById("workspaceSelector").addEventListener("change", event => switchWorkspace(event.target.value));
document.querySelectorAll("[data-sidebar-action]").forEach(button => button.addEventListener("click", () => handleSidebarAction(button.dataset.sidebarAction)));
function openSourceMenu(kind) {
  sourceMenu.classList.remove("hidden");
  if (kind === "file") sourceFileInput.click();
  if (kind === "image") sourceImageInput.click();
}
document.getElementById("openSourceButton").addEventListener("click", () => sourceMenu.classList.toggle("hidden"));
document.getElementById("closeSourceButton").addEventListener("click", () => sourceMenu.classList.add("hidden"));
document.querySelectorAll("[data-open-source]").forEach(button => button.addEventListener("click", () => openSourceMenu(button.dataset.openSource)));
document.querySelectorAll("[data-source-picker]").forEach(button => button.addEventListener("click", () => {
  const picker = button.dataset.sourcePicker;
  if (picker === "file") sourceFileInput.click();
  else if (picker === "image") sourceImageInput.click();
  else { sourceMenu.classList.add("hidden"); intentInput.value = examples.systems; intentInput.focus(); }
}));
sourceFileInput.addEventListener("change", () => handleSourceFile(sourceFileInput.files[0], "file"));
sourceImageInput.addEventListener("change", () => handleSourceFile(sourceImageInput.files[0], "image"));
intentForm.addEventListener("submit", event => { event.preventDefault(); runConversation(intentInput.value); });
intentInput.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); intentForm.requestSubmit(); } });
document.getElementById("openTrialSide").addEventListener("click", openTrial);
document.getElementById("newWorkButton").addEventListener("click", resetWorkspace);
document.getElementById("workspaceHomeLink").addEventListener("click", event => { event.preventDefault(); showPortfolioHome(); });
document.getElementById("workspaceHomeButton").addEventListener("click", showPortfolioHome);
document.getElementById("homeNewWorkButton").addEventListener("click", () => openRequestDialog());
document.getElementById("marketCreateRequestButton").addEventListener("click", () => openRequestDialog());
document.getElementById("marketProviderApplyButton").addEventListener("click", openProviderApplication);
document.querySelectorAll("[data-open-request]").forEach(button => button.addEventListener("click", () => openRequestDialog()));
document.querySelectorAll("[data-market-view]").forEach(button => button.addEventListener("click", () => showMarketView(button.dataset.marketView)));
document.querySelectorAll("[data-market-role]").forEach(button => button.addEventListener("click", () => requestMarketRole(button.dataset.marketRole)));
document.getElementById("marketAuthOpen").addEventListener("click", () => {
  pendingMarketAction = "";
  pendingRequestSeed = null;
  marketAuthDialog.showModal();
});
document.querySelectorAll("[data-provider-guide-open]").forEach(button => button.addEventListener("click", () => {
  providerGuideDialog.showModal();
}));
document.getElementById("marketGoogleLogin").addEventListener("click", () => startGoogleAuth(false));
document.getElementById("marketPasswordLoginToggle").addEventListener("click", () => {
  const passwordLogin = document.getElementById("marketPasswordLogin");
  const passwordToggle = document.getElementById("marketPasswordLoginToggle");
  passwordLogin.classList.remove("hidden");
  passwordToggle.classList.add("hidden");
  passwordToggle.setAttribute("aria-expanded", "true");
  marketLoginForm.elements.email.focus();
});
document.getElementById("marketForgotPassword").addEventListener("click", () => {
  marketAuthDialog.close();
  marketRecoveryForm.classList.remove("hidden");
  marketResetForm.classList.add("hidden");
  document.getElementById("marketRecoveryStatus").textContent = "";
  marketRecoveryDialog.showModal();
});
marketRecoveryForm.addEventListener("submit", async event => {
  event.preventDefault();
  const status = document.getElementById("marketRecoveryStatus");
  status.textContent = "Илгээж байна…";
  try {
    const data = await marketApi("/auth/password/forgot", {
      method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(marketRecoveryForm)))
    });
    status.textContent = data.message;
  } catch (error) { status.textContent = error.message; }
});
marketResetForm.addEventListener("submit", async event => {
  event.preventDefault();
  const status = document.getElementById("marketResetStatus");
  const values = Object.fromEntries(new FormData(marketResetForm));
  if (values.password !== values.passwordConfirm) {
    status.textContent = "Нууц үгүүд ижил байх ёстой.";
    return;
  }
  try {
    await marketApi("/auth/password/reset", { method:"POST", body:JSON.stringify({ token:values.token, password:values.password }) });
    marketIdentity = null;
    storeMarketToken();
    marketResetForm.reset();
    marketRecoveryDialog.close();
    marketAuthDialog.showModal();
    document.getElementById("marketLoginError").textContent = "Нууц үг шинэчлэгдлээ. Шинэ нууц үгээрээ нэвтэрнэ үү.";
  } catch (error) { status.textContent = error.message; }
});
document.getElementById("marketSecurityOpen").addEventListener("click", openMarketSecurity);
document.getElementById("marketGoogleLink").addEventListener("click", () => startGoogleAuth(true));
document.getElementById("marketGoogleUnlink").addEventListener("click", async() => {
  const status = document.getElementById("marketSecurityStatus");
  try {
    const data = await marketApi("/auth/google/unlink", { method:"POST" });
    marketIdentity = data.identity;
    renderMarketIdentity();
    marketSecurityDialog.close();
    openMarketSecurity();
  } catch (error) { status.textContent = error.message; }
});
document.getElementById("marketVerifyEmail").addEventListener("click", async() => {
  const status = document.getElementById("marketSecurityStatus");
  try {
    await marketApi("/auth/email-verification/request", { method:"POST" });
    status.textContent = "Баталгаажуулах холбоосыг имэйл рүү илгээлээ.";
  } catch (error) { status.textContent = error.message; }
});
document.getElementById("marketRevokeSessions").addEventListener("click", async() => {
  const status = document.getElementById("marketSecurityStatus");
  try {
    await marketApi("/auth/sessions/revoke-all", { method:"POST" });
    marketIdentity = null;
    storeMarketToken();
    marketSecurityDialog.close();
    renderMarketIdentity();
  } catch (error) { status.textContent = error.message; }
});
document.querySelectorAll("[data-market-auth-tab]").forEach(button => button.addEventListener("click", () => {
  const register = button.dataset.marketAuthTab === "register";
  document.querySelectorAll("[data-market-auth-tab]").forEach(item => item.classList.toggle("active", item === button));
  marketLoginForm.classList.toggle("hidden", register);
  marketRegisterForm.classList.toggle("hidden", !register);
  if (!register) syncMarketLoginOptions();
}));
marketLoginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const errorElement = document.getElementById("marketLoginError");
  errorElement.textContent = "";
  const values = Object.fromEntries(new FormData(marketLoginForm));
  try {
    const data = await marketApi("/auth/login", { method:"POST", body:JSON.stringify(values) });
    storeMarketToken(data.token);
    marketIdentity = data.identity;
    rememberMarketAuthMethod("password");
    renderMarketIdentity();
    marketLoginForm.reset();
    marketAuthDialog.close();
    continuePendingMarketAction();
  } catch (error) { errorElement.textContent = error.message; }
});
marketRegisterForm.addEventListener("submit", async event => {
  event.preventDefault();
  const errorElement = document.getElementById("marketRegisterError");
  errorElement.textContent = "";
  const values = Object.fromEntries(new FormData(marketRegisterForm));
  try {
    const data = await marketApi("/auth/register", { method:"POST", body:JSON.stringify(values) });
    storeMarketToken(data.token);
    marketIdentity = data.identity;
    rememberMarketAuthMethod("password");
    renderMarketIdentity();
    marketRegisterForm.reset();
    marketAuthDialog.close();
    continuePendingMarketAction();
  } catch (error) { errorElement.textContent = error.message; }
});
document.querySelectorAll("[data-market-participation-action]").forEach(button => button.addEventListener("click", () => {
  if (button.dataset.marketParticipationAction === "provider") openProviderApplication();
  else openRequestDialog();
}));
document.getElementById("providerGoogleStepUp").addEventListener("click", async() => {
  const status = document.getElementById("providerOnboardingStatus");
  status.textContent = "Google баталгаажуулалт руу шилжүүлж байна…";
  try {
    const data = await marketApi("/auth/google/reauth/start", { method:"POST" });
    location.assign(data.url);
  } catch (error) { status.textContent = error.message; }
});
providerPasswordStepUpForm.addEventListener("submit", async event => {
  event.preventDefault();
  const status = document.getElementById("providerOnboardingStatus");
  status.textContent = "Account-ыг баталгаажуулж байна…";
  try {
    await marketApi("/auth/step-up/password", {
      method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(providerPasswordStepUpForm)))
    });
    providerPasswordStepUpForm.reset();
    status.textContent = "Account баталгаажлаа.";
    await refreshProviderReadiness();
  } catch (error) { status.textContent = error.message; }
});
providerPhoneRequestForm.addEventListener("submit", async event => {
  event.preventDefault();
  const status = document.getElementById("providerOnboardingStatus");
  status.textContent = "Баталгаажуулах код илгээж байна…";
  try {
    const data = await marketApi("/auth/phone/request", {
      method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(providerPhoneRequestForm)))
    });
    providerPhoneConfirmForm.classList.remove("hidden");
    document.getElementById("providerPhoneStatus").textContent = `${data.maskedPhone} дугаарт 6 оронтой код илгээлээ.`;
    status.textContent = data.testCode ? `TEST код: ${data.testCode}` : "Код 5 минут хүчинтэй.";
    providerPhoneConfirmForm.elements.code.focus();
  } catch (error) { status.textContent = error.message; }
});
providerPhoneConfirmForm.addEventListener("submit", async event => {
  event.preventDefault();
  const status = document.getElementById("providerOnboardingStatus");
  status.textContent = "Кодыг шалгаж байна…";
  try {
    const data = await marketApi("/auth/phone/confirm", {
      method:"POST", body:JSON.stringify(Object.fromEntries(new FormData(providerPhoneConfirmForm)))
    });
    marketIdentity = data.identity;
    renderMarketIdentity();
    providerPhoneConfirmForm.reset();
    status.textContent = `${data.maskedPhone} баталгаажлаа.`;
    await refreshProviderReadiness();
  } catch (error) { status.textContent = error.message; }
});
providerApplicationForm.addEventListener("submit", async event => {
  event.preventDefault();
  const errorElement = document.getElementById("providerApplicationError");
  errorElement.textContent = "";
  const values = Object.fromEntries(new FormData(providerApplicationForm));
  const skills = [...new Set(String(values.skills || "").split(",").map(value => value.trim()).filter(Boolean))];
  try {
    const data = await marketApi("/provider-applications", {
      method:"POST",
      body:JSON.stringify({
        professionalSummary:values.professionalSummary,
        skills,
        portfolioUrl:values.portfolioUrl || undefined,
        rulesAccepted:values.rulesAccepted === "on"
      })
    });
    marketIdentity = data.identity;
    renderMarketIdentity();
    providerApplicationForm.reset();
    providerApplicationDialog.close();
  } catch (error) {
    errorElement.textContent = error.message;
    if (["MARKET_STEP_UP_REQUIRED","MARKET_PHONE_VERIFICATION_REQUIRED"].includes(error.code)) {
      refreshProviderReadiness().catch(() => {});
    }
  }
});
storefrontProfileForm.addEventListener("submit", async event => {
  event.preventDefault();
  setStorefrontManagerStatus("Лангууг хадгалж байна…");
  const values = Object.fromEntries(new FormData(storefrontProfileForm));
  try {
    const data = await marketApi("/storefront", {
      method: storefrontProfile ? "PATCH" : "POST",
      body: JSON.stringify(values)
    });
    fillStorefrontProfile(data.item);
    renderStorefrontPlans();
    setStorefrontManagerStatus("Лангууны мэдээлэл хадгалагдлаа. Plan сонгосны дараа operator идэвхжүүлнэ.");
  } catch (error) {
    setStorefrontManagerStatus(error.message, true);
  }
});
storefrontPlanGrid.addEventListener("click", async event => {
  const button = event.target.closest("[data-storefront-plan]");
  if (!button || button.disabled) return;
  const externalPaymentReference = storefrontPaymentReference.value.trim();
  if (externalPaymentReference.length < 4) {
    setStorefrontManagerStatus("Төлбөрийн лавлагааг дор хаяж 4 тэмдэгтээр оруулна уу.", true);
    storefrontPaymentReference.focus();
    return;
  }
  button.disabled = true;
  setStorefrontManagerStatus("Subscription хүсэлтийг илгээж байна…");
  try {
    const data = await marketApi("/storefront/subscriptions", {
      method:"POST",
      body:JSON.stringify({ planId:button.dataset.storefrontPlan, externalPaymentReference })
    });
    fillStorefrontProfile(data.item);
    renderStorefrontPlans();
    setStorefrontManagerStatus("Хүсэлт бүртгэгдлээ. Market operator төлбөрийн лавлагааг шалгаж идэвхжүүлнэ.");
  } catch (error) {
    setStorefrontManagerStatus(error.message, true);
    renderStorefrontPlans();
  }
});
document.getElementById("marketLogout").addEventListener("click", async() => {
  try { await marketApi("/auth/logout", { method:"POST" }); } catch { /* Local session still ends. */ }
  marketIdentity = null;
  storefrontProfile = null;
  storefrontPlans = [];
  storeMarketToken();
  renderMarketIdentity();
  showGuestMarket();
});
document.querySelectorAll("[data-market-area]").forEach(button => button.addEventListener("click", () => showMarketArea(button.dataset.marketArea)));
document.querySelectorAll("[data-product-category]").forEach(button => button.addEventListener("click", () => {
  activeProductCategory = button.dataset.productCategory;
  document.querySelectorAll("[data-product-category]").forEach(item => item.classList.toggle("active", item === button));
  filterProductMarket(document.getElementById("homeSearchInput").value);
}));
document.querySelectorAll("[data-market-category]").forEach(button => button.addEventListener("click", () => {
  activeMarketCategory = button.dataset.marketCategory;
  document.querySelectorAll("[data-market-category]").forEach(item => item.classList.toggle("active", item === button));
  filterMarketRequests(document.getElementById("homeSearchInput").value);
}));
document.getElementById("showAllWorkspacesButton").addEventListener("click", () => { document.getElementById("homeSearchInput").value = ""; renderPortfolioHome("", { includeCreate:false }); showMarketView("labs"); });
document.getElementById("homeSearchInput").addEventListener("input", event => {
  if (activeMarketArea === "products") filterProductMarket(event.target.value);
  else if (activeMarketArea === "community") filterForumTopics(event.target.value);
  else if (activeMarketView === "all") filterMarketRequests(event.target.value);
  else if (activeMarketView === "labs") renderPortfolioHome(event.target.value, { includeCreate:false });
});
homeIntentForm.addEventListener("submit", event => {
  event.preventDefault();
  if (!homeIntentInput.value.trim()) { setHomeIntentState({ invalid:true }); homeIntentInput.focus(); return; }
  openRequestDialog({ problem:homeIntentInput.value.trim() });
  homeIntentInput.value = ""; setHomeIntentState();
});
homeIntentInput.addEventListener("input", () => setHomeIntentState());
homeIntentInput.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); homeIntentForm.requestSubmit(); } });
document.querySelectorAll("[data-home-intent]").forEach(button => button.addEventListener("click", () => openRequestDialog({ problem:button.dataset.homeText || examples[button.dataset.homeIntent], guide:button.dataset.homeIntent })));
document.querySelectorAll("[data-request-template]").forEach(button => button.addEventListener("click", () => openRequestDialog(requestTemplates[button.dataset.requestTemplate])));
document.querySelectorAll("[data-home-source]").forEach(button => button.addEventListener("click", () => {
  const input = button.dataset.homeSource === "image" ? homeRequestImageInput : homeRequestFileInput;
  input.value = "";
  input.click();
}));
document.querySelectorAll("[data-request-source]").forEach(button => button.addEventListener("click", () => {
  const input = button.dataset.requestSource === "image" ? homeRequestImageInput : homeRequestFileInput;
  input.value = "";
  input.click();
}));
homeRequestFileInput.addEventListener("change", () => requestMaterialFromFile(homeRequestFileInput.files[0], "file"));
homeRequestImageInput.addEventListener("change", () => requestMaterialFromFile(homeRequestImageInput.files[0], "image"));
homeWorkspaceGrid.addEventListener("click", event => {
  const card = event.target.closest("[data-workspace-card]");
  if (card) { showWorkspace(card.dataset.workspaceCard); return; }
  if (event.target.closest("[data-home-create]")) openRequestDialog();
});
myRequestList.addEventListener("click", event => {
  const button = event.target.closest("[data-open-request-detail]");
  if (button) showRequestDetail(button.dataset.openRequestDetail);
});
document.getElementById("requestDetailBack").addEventListener("click", () => showMarketView("mine"));
requestConfirmButton.addEventListener("click", () => {
  const draft = loadRequestDraftRegistry().items.find(item => item.id === activeRequestDraftId);
  if (!draft || draft.status === "requirement-confirmed") return;
  if (!window.confirm("Дээрх мэдээлэл энэ хувилбараараа зөв гэдгийг батлах уу? Энэ үйлдэл хүсэлтийг нийтлэхгүй, төсөл үүсгэхгүй.")) return;
  const confirmed = confirmRequirement(draft, new Date().toISOString());
  saveRequestDraft(confirmed);
  showRequestDetail(confirmed.id);
});
requestDownloadButton.addEventListener("click", () => {
  const draft = loadRequestDraftRegistry().items.find(item => item.id === activeRequestDraftId);
  if (draft?.status === "requirement-confirmed") downloadConfirmedRequirement(draft);
});
requestReviewButton.addEventListener("click", () => {
  const registry = loadRequestDraftRegistry();
  const draft = registry.items.find(item => item.id === activeRequestDraftId);
  if (!draft) return;
  if (draft.reviewWorkspaceId) { showWorkspace(draft.reviewWorkspaceId); return; }
  const reviewWorkspaceId = beginWorkspaceFromHome(draft.packageText, draft.guide || "discover", "", {
    materialSource:draft.materials?.[0] || null,
    checkpointUpdate:{ requestDraftId:draft.id }
  });
  saveRequestDraft({ ...draft, revision:draft.revision + 1, updatedAt:new Date().toISOString(), reviewWorkspaceId, aiReview:true });
});

document.getElementById("requestMaterialRemove").addEventListener("click", clearPendingRequestMaterial);
document.getElementById("requestDialogCloseButton").addEventListener("click", clearPendingRequestMaterial);
document.getElementById("requestCancelButton").addEventListener("click", () => { clearPendingRequestMaterial(); requestDialog.close(); });
requestDialog.addEventListener("cancel", clearPendingRequestMaterial);
requestForm.addEventListener("submit", event => {
  event.preventDefault();
  requestError.textContent = "";
  if (!requestForm.reportValidity()) return;
  const formData = new FormData(requestForm);
  if (!formData.getAll("capabilities").length) {
    requestError.textContent = "Хэрэгтэй боломжуудаас дор хаяж нэгийг сонгоно уу.";
    requestForm.querySelector('input[name="capabilities"]')?.focus();
    return;
  }
  if (formData.get("budgetModel") !== "Үнийн санал авна" && !String(formData.get("budgetNote") || "").trim()) {
    requestError.textContent = "Тогтсон төсөв эсвэл төсвийн хүрээ сонгосон бол дүн, хүрээгээ бичнэ үү.";
    requestForm.elements.budgetNote.focus();
    return;
  }
  const material = pendingRequestMaterial ? { ...pendingRequestMaterial } : null;
  const packageText = compileRequestPackage(formData, material);
  const id = createRequestDraftId();
  const guide = requestDialog.dataset.guide || "discover";
  const aiReview = formData.get("aiReview") === "on";
  requestDialog.close();
  const draft = {
    id,
    revision:1,
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    guide,
    templateKey:requestDialog.dataset.templateKey || null,
    title:String(formData.get("title") || ""),
    packageText,
    materials:material ? [material] : [],
    published:false,
    status:"draft",
    reviewWorkspaceId:null,
    aiReview
  };
  saveRequestDraft(draft);
  clearPendingRequestMaterial();
  renderMyRequests();
  if (aiReview) {
    const reviewWorkspaceId = beginWorkspaceFromHome(packageText, guide, "", {
      materialSource:material,
      checkpointUpdate:{
        requestDraftId:id,
        ...(material ? { evidenceEntry:{ kind:"file", name:material.name, type:material.type, size:material.size, source:"user" } } : {})
      }
    });
    saveRequestDraft({ ...draft, revision:2, updatedAt:new Date().toISOString(), reviewWorkspaceId });
  } else {
    showMarketView("mine");
    showRequestDetail(id);
  }
});

const form = document.getElementById("trialForm");
const errorBox = document.getElementById("trialError");
form.elements.workspaceName.addEventListener("input", event => { document.getElementById("trialSummaryName").textContent = event.target.value || "Миний туршилтын орчин"; });
document.getElementById("continueGuestButton").addEventListener("click", () => {
  trialDialog.close();
  intentInput.focus();
});
document.getElementById("returnToPreviewButton").addEventListener("click", () => { trialDialog.close(); intentInput.focus(); });

form.addEventListener("submit", event => {
  event.preventDefault(); errorBox.textContent = ""; if (!form.reportValidity()) return;
  const workspaceName = form.elements.workspaceName.value.trim();
  saveCheckpoint({ workspaceName, savedLocallyAt:new Date().toISOString(), activityStatus:"previewing", lastAction:"Ажлын өрөөг энэ төхөөрөмжид хадгалсан" });
  document.getElementById("successName").textContent = `${workspaceName} хадгалагдлаа`;
  document.getElementById("successOwner").textContent = "Ярилцлага, нотолгооны санамж, баталгаа болон preview туршилтын checkpoint шинэчлэгдсэн.";
  form.classList.add("hidden"); document.getElementById("trialSuccess").classList.remove("hidden");
});

const storedCheckpoint = loadCheckpoint();
function showPublicWorkView() {
  document.getElementById("publicConnectors").classList.add("hidden");
  document.getElementById("homeConnectorsButton").classList.remove("active");
  showMarketArea(activeMarketArea);
}

async function showPublicConnectors() {
  workspaceStudio.classList.add("hidden");
  portfolioHome.classList.remove("hidden");
  document.querySelectorAll("[data-portfolio-work-view]").forEach(element => element.classList.add("hidden"));
  document.querySelectorAll("[data-market-area-panel]").forEach(element => element.classList.add("hidden"));
  const view = document.getElementById("publicConnectors");
  const grid = document.getElementById("publicConnectorGrid");
  view.classList.remove("hidden");
  document.getElementById("homeConnectorsButton").classList.add("active");
  grid.replaceChildren();
  const loading = document.createElement("p"); loading.textContent = "Холболтын каталогийг ачаалж байна..."; grid.append(loading);
  try {
    const response = await fetch("/api/public/connectors", { headers:{ accept:"application/json" } });
    if (!response.ok) throw new Error("Каталог ачаалагдсангүй");
    const result = await response.json(); grid.replaceChildren();
    result.items.forEach(item => {
      const card = document.createElement("article"); card.className = "public-connector-card";
      const icon = document.createElement("span"); icon.className = "public-connector-icon"; icon.textContent = item.code === "github" ? "GH" : item.code === "google-sheets" ? "▦" : "△";
      const copy = document.createElement("div"); copy.className = "public-connector-copy";
      const name = document.createElement("strong"); name.textContent = item.name;
      const description = document.createElement("small"); description.textContent = item.description;
      const status = document.createElement("span"); status.className = `public-connector-state${item.available ? "" : " waiting"}`; status.textContent = item.available ? "Зөвхөн унших · Бэлэн" : "OAuth тохиргоо хүлээж байна";
      copy.append(name,description,status);
      const action = document.createElement("a"); action.className = "public-connector-action"; action.href = "https://app.overva.com/?view=connectors"; action.textContent = "Нэвтэрч холбох";
      card.append(icon,copy,action); grid.append(card);
    });
  } catch (error) {
    grid.replaceChildren(); const message = document.createElement("p"); message.textContent = error.message; grid.append(message);
  }
}

document.getElementById("homeConnectorsButton").addEventListener("click", showPublicConnectors);
document.getElementById("workspaceConnectorsButton").addEventListener("click", showPublicConnectors);
document.getElementById("closePublicConnectors").addEventListener("click", showPublicWorkView);
setHomeIntentState();

renderPortfolioHome();
renderDeliveryLifecycle(storedCheckpoint);
const initialParams = new URLSearchParams(location.search);
if (initialParams.get("view") === "connectors") showPublicConnectors();
else showMarketArea(initialParams.get("area") || (initialParams.get("role") === "provider" ? "freelance" : "products"));
loadPublicStorefronts();
restoreMarketAuthReminder();
loadMarketAuthCapabilities().then(() => handleMarketAuthReturn(initialParams)).then(() => restoreMarketIdentity());
