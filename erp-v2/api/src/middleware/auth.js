"use strict";

const { getPool } = require("../db");
const { verifyAccessToken } = require("../security/token");
const { loadMarketIdentity, writeMarketAudit } = require("../services/market-identity");
const { asyncHandler } = require("../utils/async-handler");

const authenticate = asyncHandler(async (req, res, next) => {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  let payload;
  try {
    payload = verifyAccessToken(authorization.slice(7));
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  if (payload.kind) return res.status(401).json({ error: "Tenant authentication required" });

  const result = await getPool().query(
    `SELECT u.id, u.organization_id, u.email, u.username, u.full_name, u.role,
            u.employee_id,u.department_id,u.position_id,u.manager_user_id,
            o.slug AS organization_slug, o.name AS organization_name,
            s.plan_code,s.status AS subscription_status,s.ends_at AS subscription_ends_at,
            ARRAY(SELECT mc.code
                    FROM module_catalog mc
                    LEFT JOIN organization_modules om
                      ON om.organization_id=u.organization_id AND om.module_code=mc.code
                   WHERE mc.active=true AND (mc.core=true OR om.enabled=true)
                   ORDER BY mc.code) AS enabled_modules,
            ARRAY(SELECT DISTINCT rp.permission_code
                    FROM user_roles ur
                    JOIN organization_role_permissions rp
                      ON rp.organization_id=ur.organization_id AND rp.role_id=ur.role_id
                   WHERE ur.organization_id=u.organization_id AND ur.user_id=u.id
                   ORDER BY rp.permission_code) AS permissions,
            ARRAY(SELECT DISTINCT r.code
                    FROM user_roles ur
                    JOIN organization_roles r
                      ON r.organization_id=ur.organization_id AND r.id=ur.role_id
                   WHERE ur.organization_id=u.organization_id AND ur.user_id=u.id AND r.active=true
                   ORDER BY r.code) AS system_roles,
            ARRAY(SELECT DISTINCT jwa.workspace_code
                    FROM employee_assignments ea
                    JOIN positions p
                      ON p.organization_id=ea.organization_id AND p.id=ea.position_id
                    JOIN job_workspace_access jwa
                      ON jwa.organization_id=p.organization_id AND jwa.job_id=p.job_id
                   WHERE ea.organization_id=u.organization_id
                     AND ea.employee_id=u.employee_id
                     AND ea.status='active'
                     AND ea.effective_from <= current_date
                     AND (ea.effective_to IS NULL OR ea.effective_to >= current_date)
                     AND p.active=true
                     AND p.job_id IS NOT NULL
                     AND jwa.active=true
                   ORDER BY jwa.workspace_code) AS workspace_codes
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       JOIN subscriptions s ON s.organization_id=o.id
      WHERE u.id = $1 AND u.active = true AND u.can_login = true AND o.status = 'active'
        AND s.status IN ('trial','active','past_due')
        AND (s.ends_at IS NULL OR s.ends_at > now() OR s.status='past_due')`,
    [payload.sub]
  );
  if (!result.rowCount) return res.status(401).json({ error: "User is inactive or unavailable" });

  req.user = result.rows[0];
  next();
});

const authenticatePlatform = asyncHandler(async (req, res, next) => {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Authentication required" });
  let payload;
  try {
    payload = verifyAccessToken(authorization.slice(7));
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  if (payload.kind !== "platform") return res.status(401).json({ error: "Platform authentication required" });
  const result = await getPool().query(
    `SELECT admin.id,admin.email,admin.full_name,
            ARRAY(SELECT DISTINCT role.code
                    FROM platform_admin_role_assignments assignment
                    JOIN platform_admin_roles role ON role.id=assignment.role_id
                   WHERE assignment.platform_admin_id=admin.id
                     AND assignment.revoked_at IS NULL AND role.active=true
                   ORDER BY role.code) AS roles,
            ARRAY(SELECT DISTINCT permission.permission_code
                    FROM platform_admin_role_assignments assignment
                    JOIN platform_admin_roles role ON role.id=assignment.role_id
                    JOIN platform_admin_role_permissions permission ON permission.role_id=role.id
                   WHERE assignment.platform_admin_id=admin.id
                     AND assignment.revoked_at IS NULL AND role.active=true
                   ORDER BY permission.permission_code) AS permissions
       FROM platform_admins admin
      WHERE admin.id=$1 AND admin.active=true`,
    [payload.sub]
  );
  if (!result.rowCount) return res.status(401).json({ error: "Platform administrator is inactive" });
  req.platformAdmin = result.rows[0];
  next();
});

const authenticateMarket = asyncHandler(async (req, res, next) => {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Market authentication required" });
  let payload;
  try {
    payload = verifyAccessToken(authorization.slice(7));
  } catch {
    return res.status(401).json({ error: "Invalid or expired Market token" });
  }
  if (payload.kind !== "market") return res.status(401).json({ error: "Market authentication required" });
  const identity = await loadMarketIdentity(payload.sub);
  if (!identity) return res.status(401).json({ error: "Market identity is inactive or unavailable" });
  req.marketIdentity = identity;
  next();
});

function requireRoles(...roles) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    if (!req.user || !allowed.has(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permission" });
    }
    next();
  };
}

function requireModule(moduleCode) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!(req.user.enabled_modules || []).includes(moduleCode)) {
      return res.status(403).json({
        error: "Энэ модуль танай байгууллагын үйлчилгээнд идэвхгүй байна.",
        code: "MODULE_DISABLED",
        module: moduleCode,
      });
    }
    next();
  };
}

function requireWorkspace(workspaceCode) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    const workspaces = new Set(req.user.workspace_codes || []);
    const systemRoles = new Set(req.user.system_roles || []);
    if (!workspaces.has(workspaceCode) && !systemRoles.has("owner")) {
      return res.status(403).json({
        error: "Workspace access required",
        code: "WORKSPACE_ACCESS_REQUIRED",
        workspace: workspaceCode,
      });
    }
    next();
  };
}

function requirePermissions(...permissions) {
  const required = new Set(permissions);
  return (req, res, next) => {
    const granted = new Set(req.user?.permissions || []);
    if (!req.user || ![...required].every(code => granted.has(code))) {
      return res.status(403).json({ error: "Insufficient permission" });
    }
    next();
  };
}

function requireSystemRoles(...roles) {
  const required = new Set(roles);
  return (req, res, next) => {
    const granted = new Set(req.user?.system_roles || []);
    if (!req.user || ![...required].every(code => granted.has(code))) {
      return res.status(403).json({ error: "Insufficient system permission" });
    }
    next();
  };
}

function requirePlatformPermissions(...permissions) {
  const required = new Set(permissions);
  return (req, res, next) => {
    const granted = new Set(req.platformAdmin?.permissions || []);
    if (!req.platformAdmin || ![...required].every(code => granted.has(code))) {
      return res.status(403).json({
        error: "Insufficient Platform permission",
        code: "PLATFORM_PERMISSION_REQUIRED",
        permissions:[...required]
      });
    }
    next();
  };
}

const requireMarketOperator = asyncHandler(async(req, res, next) => {
  if (!req.marketIdentity?.operator_roles?.includes("market-operator")) {
    await writeMarketAudit({
      marketIdentityId: req.marketIdentity?.id || null,
      actorType: req.marketIdentity ? "market_identity" : "anonymous",
      actorIdentityId: req.marketIdentity?.id || null,
      eventType: "market.operator.access",
      outcome: "denied",
      detail: { method: req.method, path: req.originalUrl },
      ipAddress: req.ip || null,
    });
    return res.status(403).json({
      error: "Market operator assignment required",
      code: "MARKET_OPERATOR_REQUIRED",
    });
  }
  next();
});

module.exports = { authenticate, authenticatePlatform, authenticateMarket, requireRoles, requireModule, requireWorkspace, requirePermissions, requireSystemRoles, requirePlatformPermissions, requireMarketOperator };
