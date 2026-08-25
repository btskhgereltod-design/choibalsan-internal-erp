"use strict";

const { z } = require("zod");

const code = z.string().trim().regex(/^[a-z0-9-]{2,80}$/);
const permissionCode = z.string().trim().regex(/^[a-z0-9][a-z0-9_.-]{1,119}$/);
const routePrefix = z.string().trim().regex(/^\/[a-z0-9/_-]*[a-z0-9_-]$/);

const moduleManifestSchema = z.object({
  moduleCode: code,
  version: z.number().int().positive(),
  routePrefix,
  permissions: z.array(permissionCode).max(100),
  entities: z.array(code).max(100),
  auditEvents: z.array(z.string().trim().regex(/^[a-z0-9_.-]{3,120}$/)).max(100),
  navigation: z.array(z.object({
    code,
    label: z.string().trim().min(1).max(120),
    path: routePrefix,
    permission: permissionCode.nullable().optional(),
  })).max(50),
  dependencies: z.array(code).max(50),
}).strict();

function normalizeRoutePrefix(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\/{2,}/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function routesOverlap(left, right) {
  const a = normalizeRoutePrefix(left), b = normalizeRoutePrefix(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function validateModuleManifest(candidate, registeredRoutes = []) {
  const parsed = moduleManifestSchema.safeParse(candidate);
  if (!parsed.success) return { valid:false, errors:parsed.error.issues.map(issue => ({ path:issue.path.join("."), message:issue.message })) };
  const manifest = { ...parsed.data, routePrefix:normalizeRoutePrefix(parsed.data.routePrefix) };
  const expectedPrefix = `/api/modules/${manifest.moduleCode}`;
  const errors = [];
  if (!routesOverlap(manifest.routePrefix, expectedPrefix)) {
    errors.push({ path:"routePrefix", message:`Module API must be inside ${expectedPrefix}` });
  }
  for (const route of registeredRoutes) {
    if (route.active !== false && routesOverlap(manifest.routePrefix, route.route_prefix || route.routePrefix)) {
      errors.push({ path:"routePrefix", message:`Route overlaps ${route.route_prefix || route.routePrefix} owned by ${route.owner_code || route.ownerCode}` });
    }
  }
  return { valid:errors.length === 0, manifest, errors };
}

module.exports = { moduleManifestSchema, normalizeRoutePrefix, routesOverlap, validateModuleManifest };
