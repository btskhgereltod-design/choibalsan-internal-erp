(function exposeWorkspaceIntake(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OvervaWorkspaceIntake = api;
})(typeof window !== "undefined" ? window : globalThis, function createWorkspaceIntakeApi() {
  "use strict";

  function inferGuide(value) {
    const text = String(value || "").toLocaleLowerCase("mn-MN");
    const mentionsPeople = /ажилтан|ажилтны|хүний нөөц|employee|staff|personnel|ajiltan|hunii nuuts/.test(text);
    const mentionsPeopleData = /excel|csv|file|import|файл|импорт|мэдээлэл|бүртгэл|data|medeelel|burtgel/.test(text);
    if (mentionsPeople && mentionsPeopleData) return "import";
    if (/erp|crm|программ|систем|software/.test(text)) return "systems";
    if (/бүтэц|хэлтэс|салбар|албан тушаал|удирдлага|butets|heltes|salbar|alban tushaal|udirdlaga/.test(text)) return "structure";
    if (/урсгал|хүсэлт|гүйцэтгэл|засвар|workflow|ursgal|huselt|guitsetgel|zasvar|camera|camer|gerel/.test(text)) return "workflow";
    return "discover";
  }

  function titleCaseWords(value) {
    return String(value || "").trim().replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase("mn-MN"));
  }

  function extractOrganizationProfile(value) {
    const text = String(value || "").trim();
    const lower = text.toLocaleLowerCase("mn-MN");
    const mongolianName = text.match(/манай\s+(?:байгууллага|компани)\s+(.{2,45}?)(?:\s+гэдэг|\s+нь|,|\.|$)/i);
    const latinName = text.match(/manai\s+(?:baiguul(?:laga|ga)?|kompani|company)\s+(.{2,45}?)(?:\s+gedeg|\s+ni|,|\.|$)/i);
    const employeeMatch = lower.match(/(\d{1,6})\s*(?:ажилтан|ajiltan)/i);
    const activities = [];
    if (/гэрэл|гэрэлтүүл|gerel|lighting/.test(lower)) activities.push("Гэрэлтүүлгийн ажил");
    if (/камер|camera|camer/.test(lower)) activities.push("Камер хяналтын ажил");
    if (/засвар|zasvar|repair/.test(lower)) activities.push("Засвар үйлчилгээ");
    if (/захиргаа|zahirgaa/.test(lower)) activities.push("Захиргаа");
    if (/аж ахуй|aj\s*ah/.test(lower)) activities.push("Аж ахуй");
    const rawName = mongolianName?.[1] || latinName?.[1] || "";
    if (!rawName && !employeeMatch && !activities.length) return null;
    return {
      name:rawName ? titleCaseWords(rawName) : "Нэрийг баталгаажуулах байгууллага",
      employeeCount:employeeMatch ? Number(employeeMatch[1]) : null,
      activities:[...new Set(activities)],
      status:"hypothesis"
    };
  }

  function looksLikeOrganizationDescription(value) {
    return /(манай\s+(байгууллага|компани)|байгууллагын нэр|manai\s+(baiguul|kompani|company)|baiguullaga.*gedeg)/i.test(String(value || ""));
  }

  function shouldChooseWorkspace(value, checkpoint) {
    if (!checkpoint || !looksLikeOrganizationDescription(value)) return false;
    const incoming = extractOrganizationProfile(value);
    const existingName = checkpoint.organizationProfile?.name;
    if (checkpoint.source && !existingName) return true;
    return Boolean(incoming?.name && existingName && incoming.name.toLocaleLowerCase("mn-MN") !== existingName.toLocaleLowerCase("mn-MN"));
  }

  return { inferGuide, extractOrganizationProfile, looksLikeOrganizationDescription, shouldChooseWorkspace };
});
