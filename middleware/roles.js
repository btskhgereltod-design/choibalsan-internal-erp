"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Central permission matrix for Чойбалсан хөгжил ERP
//
// HOW TO USE IN A ROUTE FILE:
//   const { requireRole, requirePermission } = require("../middleware/roles");
//
//   router.post("/endpoint", auth, requirePermission("finance_write"), handler);
//   router.delete("/endpoint", auth, requireRole("director"), handler);
//
// HOW TO ADD A NEW PERMISSION:
//   1. Add it to PERMISSIONS below with the allowed role list.
//   2. Use requirePermission("your_new_key") in routes.
//
// HOW TO ADD A NEW ROLE:
//   1. Add it to ROLE_META below.
//   2. Add it to every PERMISSIONS entry it should access.
// ─────────────────────────────────────────────────────────────────────────────

// Descriptive metadata — used for UI display and audit logs, not for auth logic.
const ROLE_META = {
  director:       { label: "Захирал",              level: 10 },
  chief_engineer: { label: "Ерөнхий инженер",      level: 7  },
  accountant:     { label: "Нягтлан",              level: 6  },
  hr:             { label: "Хүний нөөц",           level: 5  },
  storekeeper:    { label: "Нярав",                level: 4  },
  engineer:       { label: "Цахилгааны инженер",   level: 3  },
  electric:       { label: "Цахилгаанчин",         level: 3  },
  safety:         { label: "ХАБЭА",                level: 2  },
  camera_engineer:{ label: "Камерын инженер",      level: 2  },
  worker:         { label: "Ажилтан",              level: 1  },
  ai_readonly:    { label: "AI Стратегийн зөвлөх", level: 0  },
};

// ── Permission sets ───────────────────────────────────────────────────────────
// Each key maps to the roles that are allowed to perform that action.
// Prefer semantic names (what the permission means) over role combinations.

const PERMISSIONS = {
  // ── HR ────────────────────────────────────────────────────────
  // Ажилчдын бүртгэл, цалин, чөлөө, үнэлгээ
  hr_read:            ["director", "hr", "chief_engineer"],
  hr_write:           ["director", "hr"],

  // ── Finance ───────────────────────────────────────────────────
  // Мөнгөн журнал, өглөг, авлага, санхүүгийн тайлан
  finance_read:       ["director", "accountant", "chief_engineer"],
  finance_write:      ["director", "accountant"],

  // ── Assets / Objects ──────────────────────────────────────────
  // Объектийн бүртгэл: нэмэх, засах, устгах
  assets_write:       ["director", "chief_engineer", "storekeeper", "engineer", "electric", "camera_engineer"],
  assets_delete:      ["director", "chief_engineer"],

  // ── Streetlights / Electricity billing ───────────────────────
  // Цахилгааны тооцоо, нэхэмжлэл, байгууллагын бүртгэл
  sl_billing:         ["director", "accountant", "engineer", "electric"],
  // Гэрэлтүүлгийн техник засвар, цэгийн бүртгэл
  sl_technical:       ["director", "chief_engineer", "engineer", "electric"],
  // Гэр хорооллын гэрэлтүүлгийн талбайн бүртгэл (санхүү + цахилгаанчин)
  sl_ger_write:       ["director", "accountant", "engineer", "electric"],

  // ── Meter points ──────────────────────────────────────────────
  // Тоолуурын байршил, баталгаажуулалт, бүртгэл
  meter_write:        ["director", "accountant", "chief_engineer", "engineer"],

  // ── Lighting schedule ─────────────────────────────────────────
  // Гэрэлтүүлгийн хуваарь: асах/унтрах цаг
  lighting_edit:      ["director", "chief_engineer", "accountant", "engineer", "electric"],

  // ── LoRa ──────────────────────────────────────────────────────
  lora_manage:        ["director", "chief_engineer"],
  lora_access:        ["director", "chief_engineer", "engineer", "camera_engineer"],

  // ── Warehouse / Нярав ─────────────────────────────────────────
  // Агуулахын орлого, зарлага, үлдэгдэл
  warehouse_write:    ["director", "chief_engineer", "storekeeper", "accountant"],
  warehouse_delete:   ["director", "chief_engineer", "storekeeper"],

  // ── Payroll ───────────────────────────────────────────────────
  // Цалингийн тооцоо оруулах: HR цаг бүртгэл, нягтлан тооцоо, захирал батлах
  payroll_write:      ["director", "accountant", "hr"],

  // ── Reports ───────────────────────────────────────────────────
  reports_read:       ["director", "hr", "accountant", "chief_engineer"],
  reports_write:      ["director", "hr", "accountant"],

  // ── Operations / Work logs ────────────────────────────────────
  // Ажлын бүртгэл үүсгэх, засах, гүйцэтгэл, зураг
  operations_write:   ["director", "chief_engineer", "engineer", "camera_engineer", "electric"],
  // Ажил болон гүйцэтгэл устгах
  operations_delete:  ["director", "chief_engineer"],
  // Ажил дуусгавар батлах / буцаах
  operations_confirm: ["director", "chief_engineer"],

  // ── Vehicles ──────────────────────────────────────────────────
  vehicle_write:      ["director", "chief_engineer", "safety"],
  vehicle_repair:     ["director", "chief_engineer"],

  // ── Smart import (Excel/PDF) ──────────────────────────────────
  smart_import:       ["director", "accountant", "storekeeper", "chief_engineer"],

  // ── Safety / ХАБЭА ───────────────────────────────────────────
  // Ажлын эхлэлтийн зөвшөөрөл болон дуусгалтын эрсдэл шалгалт
  safety_confirm:     ["director", "safety"],

  // ── AI Strategic Advisor (Read-Only) ─────────────────────────────────────
  // Зөвхөн /api/ai/* GET endpoint-ууд. Write/delete эрх огт байхгүй.
  ai_read:            ["director", "ai_readonly"],

  // ── Admin / System ────────────────────────────────────────────
  // Системийн тохиргоо, хэрэглэгч удирдлага
  admin_only:         ["director"],
  // Захиргааны HR мэдэгдэл, хурал, баримт — HR болон ахлах инженер харах
  admin_hr:           ["director", "hr", "chief_engineer"],
  // Ажлын категори, шийдвэр гаргах тохиргоо
  engineering:        ["director", "chief_engineer"],
  camera:             ["director", "chief_engineer", "camera_engineer"],
};

const PERMISSION_MODULES = {
  hr_read:            ["admin_hub"],
  hr_write:           ["admin_hub"],
  finance_read:       ["nyagtlan"],
  finance_write:      ["nyagtlan"],
  assets_write:       ["assets", "camera"],
  assets_delete:      ["assets", "camera"],
  camera:             ["camera"],
  sl_billing:         ["streetlights"],
  sl_technical:       ["streetlights"],
  sl_ger_write:       ["streetlights"],
  meter_write:        ["streetlights"],
  lighting_edit:      ["streetlights"],
  lora_manage:        ["lora"],
  lora_access:        ["lora"],
  warehouse_write:    ["warehouse"],
  warehouse_delete:   ["warehouse"],
  payroll_write:      ["nyagtlan"],
  reports_read:       ["reports"],
  reports_write:      ["reports"],
  operations_write:   ["operations"],
  operations_delete:  ["operations"],
  operations_confirm: ["operations"],
  safety_confirm:     ["operations", "habea"],
  vehicle_write:      ["habea"],
  smart_import:       ["nyagtlan", "warehouse", "assets"],
  admin_only:         ["settings"],
  admin_hr:           ["admin_hub"],
  engineering:        ["settings", "assets"],
};

function hasCustomPermission(user, permission) {
  const modules = PERMISSION_MODULES[permission] || [];
  if (!modules.length || !user?.permissions) return false;
  try {
    const perms = typeof user.permissions === "string" ? JSON.parse(user.permissions || "{}") : user.permissions;
    return modules.some(moduleKey => perms?.[moduleKey]?.edit);
  } catch {
    return false;
  }
}

// ── Middleware factories ──────────────────────────────────────────────────────

/**
 * requireRole("director", "hr")
 * Allow if req.user.role is one of the listed roles.
 * Use for simple one-off checks; prefer requirePermission for shared sets.
 */
function requireRole(...roles) {
  return function roleMiddleware(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: "Эрх хүрэхгүй" });
  };
}

/**
 * requirePermission("finance_write")
 * Allow if req.user.role is in PERMISSIONS[permission].
 * Fails loudly at startup if the permission key doesn't exist — prevents typos
 * silently granting open access.
 */
function requirePermission(permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) {
    // Crash at startup, not at runtime — catches typos during development.
    throw new Error(`[roles] Unknown permission: "${permission}". Add it to middleware/roles.js`);
  }
  return function permissionMiddleware(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
    if (allowed.includes(req.user.role) || hasCustomPermission(req.user, permission)) return next();
    return res.status(403).json({ error: "Эрх хүрэхгүй" });
  };
}

/**
 * canAccessOwn(idParam)
 * Allow if the authenticated user's ID matches req.params[idParam],
 * OR if the user has one of the elevated roles (director, hr).
 * Use for profile / self-service endpoints.
 */
function canAccessOwn(idParam = "id", elevatedRoles = ["director", "hr"]) {
  return function ownMiddleware(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Нэвтрэх шаардлагатай" });
    const targetId = parseInt(req.params[idParam], 10);
    if (req.user.id === targetId || elevatedRoles.includes(req.user.role)) return next();
    return res.status(403).json({ error: "Зөвхөн өөрийн мэдээлэлд хандах боломжтой" });
  };
}

module.exports = { PERMISSIONS, ROLE_META, requireRole, requirePermission, canAccessOwn };
