"use strict";

const crypto = require("node:crypto");
const express = require("express");
const { z } = require("zod");
const { withTenantTransaction } = require("../db");
const { authenticate, requireModule, requireWorkspace } = require("../middleware/auth");
const { writeAudit } = require("../services/audit");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
router.use(authenticate, requireModule("camera-operations"), requireWorkspace("camera"));

const uuid = z.string().uuid();
const coordinate = z.tuple([
  z.coerce.number().min(-180).max(180),
  z.coerce.number().min(-90).max(90),
]);
const coreCount = z.coerce.number().int().refine(value => [4, 6, 8, 12, 24, 48, 96].includes(value));
const routeCreateSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9._-]+$/).max(80).optional(),
  name: z.string().trim().min(1).max(200),
  coreCount,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  note: z.string().trim().max(2000).default(""),
  coordinates: z.array(coordinate).min(2).max(5000),
});
const nodeCreateSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9._-]+$/).max(80).optional(),
  name: z.string().trim().min(1).max(200),
  nodeType: z.enum(["splice", "closure", "odf", "cross", "splitter", "other"]),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  note: z.string().trim().max(2000).default(""),
  routeIds: z.array(uuid).max(2).default([]),
});
const archiveSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3).max(2000),
});
const cameraGpsSchema = z.object({
  expectedObjectVersion: z.coerce.number().int().positive(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  note: z.string().trim().max(500).default(""),
});
const rawImportCoordinate = z.tuple([
  z.coerce.number().min(-1_000_000_000).max(1_000_000_000),
  z.coerce.number().min(-90).max(90),
]);
const routeImportSchema = z.object({
  sourceSystem: z.string().trim().min(1).max(100),
  sourceReference: z.string().trim().min(1).max(500),
  longitudeOffset: z.coerce.number().min(-1_000_000_000).max(1_000_000_000),
  candidates: z.array(z.object({
    sourceKey: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    coreCount,
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    sourceLengthM: z.coerce.number().min(0).max(10_000_000),
    rawCoordinates: z.array(rawImportCoordinate).min(2).max(5000),
  })).min(1).max(500),
});
const routeImportReviewSchema = z.object({
  decision: z.enum(["confirmed", "needs_correction", "rejected"]),
  note: z.string().trim().min(3).max(2000),
});

const hasPermission = (req, permission) => new Set(req.user.permissions || []).has(permission)
  || new Set(req.user.system_roles || []).has("owner");
const deny = (res, permission) => res.status(403).json({ error: "Insufficient permission", permission });

function routeLengthM(coordinates) {
  const radius = 6371000;
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const [previousLng, previousLat] = coordinates[index - 1];
    const [currentLng, currentLat] = coordinates[index];
    const previousPhi = previousLat * Math.PI / 180;
    const currentPhi = currentLat * Math.PI / 180;
    const phiDelta = (currentLat - previousLat) * Math.PI / 180;
    const lambdaDelta = (currentLng - previousLng) * Math.PI / 180;
    const haversine = Math.sin(phiDelta / 2) ** 2
      + Math.cos(previousPhi) * Math.cos(currentPhi) * Math.sin(lambdaDelta / 2) ** 2;
    total += 2 * radius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }
  return Math.round(total * 100) / 100;
}

const generatedCode = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

router.get("/workspace", asyncHandler(async (req, res) => {
  if (!hasPermission(req, "network-routes.read")) return deny(res, "network-routes.read");
  const organizationId = req.user.organization_id;
  const [routes, nodes, cameraPoints, cameraCandidates, importBatches, importCandidates] = await withTenantTransaction(organizationId, client => Promise.all([
    client.query(`SELECT route.id,route.code,route.name,route.status,route.version,route.updated_at,
        revision.id revision_id,revision.version_no revision_version,revision.core_count,revision.color,
        revision.geometry,revision.length_m,revision.note,revision.created_at revision_created_at,
        creator.full_name created_by_name
      FROM network_routes route
      JOIN network_route_revisions revision ON revision.organization_id=route.organization_id
        AND revision.id=route.current_revision_id
      LEFT JOIN users creator ON creator.organization_id=revision.organization_id AND creator.id=revision.created_by
      WHERE route.organization_id=$1 AND route.network_kind='fiber'
      ORDER BY route.status='active' DESC,route.name`, [organizationId]),
    client.query(`SELECT node.id,node.code,node.name,node.node_type,node.latitude,node.longitude,node.note,
        node.status,node.version,node.updated_at,
        COALESCE(jsonb_agg(jsonb_build_object('id',route.id,'code',route.code,'name',route.name)
          ORDER BY link.link_order) FILTER(WHERE route.id IS NOT NULL),'[]'::jsonb) routes
      FROM network_nodes node
      LEFT JOIN network_node_route_links link ON link.organization_id=node.organization_id
        AND link.network_node_id=node.id
      LEFT JOIN network_routes route ON route.organization_id=link.organization_id
        AND route.id=link.network_route_id
      WHERE node.organization_id=$1
      GROUP BY node.id
      ORDER BY node.status='active' DESC,node.name`, [organizationId]),
    client.query(`SELECT 'camera_point' target_kind,point.id target_id,point.id,point.sequence_no,
        point.name point_name,point.latitude,point.longitude,
        point.location_note,object_row.id operational_object_id,object_row.code object_code,
        object_row.name object_name,object_row.location,object_row.version object_version,
        COALESCE(device_count.camera_count,0)::int camera_count
      FROM operational_objects object_row
      JOIN operational_object_specifications specification
        ON specification.organization_id=object_row.organization_id
        AND specification.id=object_row.current_specification_id AND specification.profile_kind='camera'
      JOIN operational_object_camera_points point
        ON point.organization_id=specification.organization_id AND point.specification_id=specification.id
      LEFT JOIN LATERAL(SELECT sum(device.quantity)::int camera_count
        FROM operational_object_camera_devices device
        WHERE device.organization_id=point.organization_id AND device.camera_point_id=point.id) device_count ON true
      WHERE object_row.organization_id=$1 AND object_row.domain='camera' AND object_row.status<>'retired'
      ORDER BY object_row.name,point.sequence_no`, [organizationId]),
    client.query(`SELECT 'legacy_object' target_kind,object_row.id target_id,object_row.id,
        1 sequence_no,object_row.name point_name,NULL::numeric latitude,NULL::numeric longitude,
        object_row.location location_note,object_row.id operational_object_id,object_row.code object_code,
        object_row.name object_name,object_row.location,object_row.version object_version,
        COALESCE((object_row.metadata->>'cameraCount')::int,0) camera_count
      FROM operational_objects object_row
      WHERE object_row.organization_id=$1 AND object_row.domain='camera' AND object_row.status<>'retired'
        AND object_row.current_specification_id IS NULL
        AND object_row.metadata->>'cameraCount' ~ '^[0-9]+$'
        AND (object_row.metadata->>'cameraCount')::int > 0
      ORDER BY object_row.name`, [organizationId]),
    client.query(`SELECT id,source_system,source_reference,source_fingerprint,source_record_count,
        source_vertex_count,transform,status,created_at
      FROM network_route_import_batches
      WHERE organization_id=$1
      ORDER BY created_at DESC,id DESC LIMIT 1`, [organizationId]),
    client.query(`WITH latest_batch AS (
        SELECT id FROM network_route_import_batches WHERE organization_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1
      )
      SELECT candidate.id,candidate.batch_id,candidate.source_key,candidate.proposed_code,candidate.proposed_name,
        candidate.proposed_core_count,candidate.proposed_color,candidate.source_geometry,
        candidate.normalized_geometry,candidate.source_length_m,candidate.recomputed_length_m,
        candidate.validation,candidate.created_at,
        latest_review.decision review_decision,latest_review.note review_note,
        latest_review.reviewed_at,reviewer.full_name reviewed_by_name
      FROM network_route_import_candidates candidate
      JOIN latest_batch ON latest_batch.id=candidate.batch_id
      LEFT JOIN LATERAL(
        SELECT review.decision,review.note,review.reviewed_at,review.reviewed_by
        FROM network_route_import_reviews review
        WHERE review.organization_id=candidate.organization_id AND review.candidate_id=candidate.id
        ORDER BY review.reviewed_at DESC,review.id DESC LIMIT 1
      ) latest_review ON true
      LEFT JOIN users reviewer ON reviewer.organization_id=candidate.organization_id
        AND reviewer.id=latest_review.reviewed_by
      WHERE candidate.organization_id=$1
      ORDER BY candidate.proposed_name,candidate.source_key`, [organizationId]),
  ]));
  const activeRoutes = routes.rows.filter(item => item.status === "active");
  const visibleCameraPoints = [...cameraPoints.rows, ...cameraCandidates.rows];
  const recoveryBatch = importBatches.rows[0] || null;
  res.json({
    routes: routes.rows,
    nodes: nodes.rows,
    cameraPoints: visibleCameraPoints,
    recovery: {
      batch: recoveryBatch,
      candidates: importCandidates.rows,
      summary: {
        candidates: importCandidates.rows.length,
        vertices: importCandidates.rows.reduce((sum, item) => sum
          + (Array.isArray(item.normalized_geometry?.coordinates) ? item.normalized_geometry.coordinates.length : 0), 0),
        pending: importCandidates.rows.filter(item => !item.review_decision).length,
        confirmed: importCandidates.rows.filter(item => item.review_decision === "confirmed").length,
        needsCorrection: importCandidates.rows.filter(item => item.review_decision === "needs_correction").length,
        rejected: importCandidates.rows.filter(item => item.review_decision === "rejected").length,
      },
    },
    coreOptions: [4, 6, 8, 12, 24, 48, 96],
    summary: {
      activeRoutes: activeRoutes.length,
      lengthM: activeRoutes.reduce((sum, item) => sum + Number(item.length_m || 0), 0),
      activeNodes: nodes.rows.filter(item => item.status === "active").length,
      cameraPoints: visibleCameraPoints.length,
      cameraPointsWithGps: visibleCameraPoints.filter(item => item.latitude !== null && item.longitude !== null).length,
    },
    capabilities: {
      canManage: hasPermission(req, "network-routes.manage"),
      canUpdateCameraGps: hasPermission(req, "operational-objects.update"),
    },
  });
}));

router.post("/imports/legacy-recovery", asyncHandler(async (req, res) => {
  if (!hasPermission(req, "network-routes.manage")) return deny(res, "network-routes.manage");
  const parsed = routeImportSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Legacy трассын сэргээх эх өгөгдөл буруу байна", issues: parsed.error.issues });
  const organizationId = req.user.organization_id;
  const value = parsed.data;
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    sourceSystem: value.sourceSystem,
    sourceReference: value.sourceReference,
    longitudeOffset: value.longitudeOffset,
    candidates: value.candidates,
  })).digest("hex");
  const normalized = value.candidates.map(candidate => {
    const coordinates = candidate.rawCoordinates.map(([longitude, latitude]) => [longitude - value.longitudeOffset, latitude]);
    const recomputedLengthM = routeLengthM(coordinates);
    const insideChoibalsan = coordinates.every(([longitude, latitude]) => latitude >= 47.5 && latitude <= 48.6
      && longitude >= 113.8 && longitude <= 115.3);
    const lengthDifferenceM = Math.round((recomputedLengthM - candidate.sourceLengthM) * 100) / 100;
    return { ...candidate, coordinates, recomputedLengthM, validation: {
      state: insideChoibalsan && Math.abs(lengthDifferenceM) <= 1 ? "valid_for_review" : "needs_correction",
      insideChoibalsan,
      lengthDifferenceM,
      transformApplied: { kind: "constant_longitude_offset", longitudeOffset: value.longitudeOffset },
      canonicalPromotion: false,
    } };
  });
  const vertexCount = normalized.reduce((sum, candidate) => sum + candidate.coordinates.length, 0);
  const outcome = await withTenantTransaction(organizationId, async client => {
    const existing = await client.query(`SELECT id,source_record_count,source_vertex_count,created_at
      FROM network_route_import_batches WHERE organization_id=$1 AND source_fingerprint=$2`, [organizationId, fingerprint]);
    if (existing.rowCount) return { created: false, batch: existing.rows[0] };
    const batch = (await client.query(`INSERT INTO network_route_import_batches(
        organization_id,source_system,source_reference,source_fingerprint,source_record_count,
        source_vertex_count,transform,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`, [organizationId,
      value.sourceSystem, value.sourceReference, fingerprint, normalized.length, vertexCount,
      JSON.stringify({ kind: "constant_longitude_offset", longitudeOffset: value.longitudeOffset,
        detectedFrom: "legacy_geojson_and_length_reconciliation" }), req.user.id])).rows[0];
    for (const candidate of normalized) {
      await client.query(`INSERT INTO network_route_import_candidates(
          organization_id,batch_id,source_key,proposed_code,proposed_name,proposed_core_count,
          proposed_color,source_geometry,normalized_geometry,source_length_m,recomputed_length_m,
          validation,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12::jsonb,$13)`, [organizationId,
        batch.id, candidate.sourceKey, `LEGACY-FIBER-${String(candidate.sourceKey).padStart(3, "0")}`,
        candidate.name, candidate.coreCount, candidate.color,
        JSON.stringify({ type: "LineString", coordinates: candidate.rawCoordinates }),
        JSON.stringify({ type: "LineString", coordinates: candidate.coordinates }),
        candidate.sourceLengthM, candidate.recomputedLengthM, JSON.stringify(candidate.validation), req.user.id]);
    }
    const detail = { batchId: batch.id, fingerprint, sourceSystem: value.sourceSystem,
      sourceReference: value.sourceReference, candidateCount: normalized.length, vertexCount,
      longitudeOffset: value.longitudeOffset, canonicalPromotion: false };
    await writeAudit(req, "network_route_import.stage", "network_route_import_batch", batch.id, detail, client);
    return { created: true, batch };
  });
  res.status(outcome.created ? 201 : 200).json(outcome);
}));

router.post("/imports/:batchId/candidates/:candidateId/reviews", asyncHandler(async (req, res) => {
  if (!hasPermission(req, "network-routes.manage")) return deny(res, "network-routes.manage");
  const batchId = uuid.safeParse(req.params.batchId);
  const candidateId = uuid.safeParse(req.params.candidateId);
  const parsed = routeImportReviewSchema.safeParse(req.body);
  if (!batchId.success || !candidateId.success || !parsed.success) {
    return res.status(400).json({ error: "Сэргээх трассын хяналтын мэдээлэл буруу байна" });
  }
  const organizationId = req.user.organization_id;
  const result = await withTenantTransaction(organizationId, async client => {
    const candidate = await client.query(`SELECT id FROM network_route_import_candidates
      WHERE organization_id=$1 AND batch_id=$2 AND id=$3`, [organizationId, batchId.data, candidateId.data]);
    if (!candidate.rowCount) return null;
    const review = (await client.query(`INSERT INTO network_route_import_reviews(
        organization_id,candidate_id,decision,note,reviewed_by)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [organizationId, candidateId.data,
      parsed.data.decision, parsed.data.note, req.user.id])).rows[0];
    await writeAudit(req, "network_route_import.review", "network_route_import_candidate", candidateId.data,
      { batchId: batchId.data, decision: parsed.data.decision, note: parsed.data.note,
        canonicalPromotion: false }, client);
    return review;
  });
  if (!result) return res.status(404).json({ error: "Сэргээх трассын нэр дэвшигч олдсонгүй" });
  res.status(201).json({ item: result });
}));

router.post("/routes", asyncHandler(async (req, res) => {
  if (!hasPermission(req, "network-routes.manage")) return deny(res, "network-routes.manage");
  const parsed = routeCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Шилэн кабелийн трассын мэдээлэл буруу байна", issues: parsed.error.issues });
  const organizationId = req.user.organization_id;
  const value = parsed.data;
  const lengthM = routeLengthM(value.coordinates);
  const result = await withTenantTransaction(organizationId, async client => {
    const route = (await client.query(`INSERT INTO network_routes(
        organization_id,code,name,network_kind,status,created_by)
      VALUES($1,$2,$3,'fiber','active',$4) RETURNING *`,
    [organizationId, value.code || generatedCode("FO"), value.name, req.user.id])).rows[0];
    const revision = (await client.query(`INSERT INTO network_route_revisions(
        organization_id,network_route_id,version_no,core_count,color,geometry,length_m,note,created_by)
      VALUES($1,$2,1,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
    [organizationId, route.id, value.coreCount, value.color,
      JSON.stringify({ type: "LineString", coordinates: value.coordinates }), lengthM, value.note, req.user.id])).rows[0];
    const updated = (await client.query(`UPDATE network_routes SET current_revision_id=$3,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`, [organizationId, route.id, revision.id])).rows[0];
    const detail = { revisionId: revision.id, revisionVersion: 1, coreCount: value.coreCount, lengthM };
    await client.query(`INSERT INTO network_route_events(
        organization_id,network_route_id,actor_user_id,event_type,route_version,detail)
      VALUES($1,$2,$3,'created',1,$4::jsonb)`, [organizationId, route.id, req.user.id, JSON.stringify(detail)]);
    await writeAudit(req, "network_route.create", "network_route", route.id, detail, client);
    return { ...updated, revision };
  });
  res.status(201).json({ item: result });
}));

router.post("/nodes", asyncHandler(async (req, res) => {
  if (!hasPermission(req, "network-routes.manage")) return deny(res, "network-routes.manage");
  const parsed = nodeCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Шилэн кабелийн цэгийн мэдээлэл буруу байна", issues: parsed.error.issues });
  const organizationId = req.user.organization_id;
  const value = { ...parsed.data, routeIds: [...new Set(parsed.data.routeIds)] };
  const result = await withTenantTransaction(organizationId, async client => {
    if (value.routeIds.length) {
      const routes = await client.query(`SELECT id FROM network_routes
        WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[])`, [organizationId, value.routeIds]);
      if (routes.rowCount !== value.routeIds.length) return { status: 409, error: "Сонгосон трасс олдсонгүй эсвэл идэвхгүй байна" };
    }
    const node = (await client.query(`INSERT INTO network_nodes(
        organization_id,code,name,node_type,latitude,longitude,note,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [organizationId,
      value.code || generatedCode("FN"), value.name, value.nodeType, value.latitude, value.longitude, value.note, req.user.id])).rows[0];
    for (const [index, routeId] of value.routeIds.entries()) {
      await client.query(`INSERT INTO network_node_route_links(
          organization_id,network_node_id,network_route_id,link_order,created_by)
        VALUES($1,$2,$3,$4,$5)`, [organizationId, node.id, routeId, index + 1, req.user.id]);
    }
    const detail = { nodeType: value.nodeType, latitude: value.latitude, longitude: value.longitude, routeIds: value.routeIds };
    await client.query(`INSERT INTO network_node_events(
        organization_id,network_node_id,actor_user_id,event_type,node_version,detail)
      VALUES($1,$2,$3,'created',1,$4::jsonb)`, [organizationId, node.id, req.user.id, JSON.stringify(detail)]);
    await writeAudit(req, "network_node.create", "network_node", node.id, detail, client);
    return { status: 201, item: node };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.status(result.status).json({ item: result.item });
}));

router.post("/routes/:id/archive", asyncHandler(async (req, res) => {
  if (!hasPermission(req, "network-routes.manage")) return deny(res, "network-routes.manage");
  const id = uuid.safeParse(req.params.id);
  const parsed = archiveSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Трасс архивлах хүсэлт буруу байна" });
  const organizationId = req.user.organization_id;
  const outcome = await withTenantTransaction(organizationId, async client => {
    const current = (await client.query(`SELECT * FROM network_routes
      WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [organizationId, id.data])).rows[0];
    if (!current) return { status: 404, body: { error: "Трасс олдсонгүй" } };
    if (current.status === "inactive") return { status: 200, body: { item: current, replayed: true } };
    if (Number(current.version) !== parsed.data.expectedVersion) return { status: 409, body: { error: "Трасс өөр хэрэглэгчээр шинэчлэгдсэн байна", code: "VERSION_CONFLICT" } };
    const item = (await client.query(`UPDATE network_routes SET status='inactive',version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`, [organizationId, id.data])).rows[0];
    const detail = { reason: parsed.data.reason, previousStatus: current.status };
    await client.query(`INSERT INTO network_route_events(
        organization_id,network_route_id,actor_user_id,event_type,route_version,detail)
      VALUES($1,$2,$3,'archived',$4,$5::jsonb)`, [organizationId, id.data, req.user.id, item.version, JSON.stringify(detail)]);
    await writeAudit(req, "network_route.archive", "network_route", id.data, detail, client);
    return { status: 200, body: { item, replayed: false } };
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/nodes/:id/archive", asyncHandler(async (req, res) => {
  if (!hasPermission(req, "network-routes.manage")) return deny(res, "network-routes.manage");
  const id = uuid.safeParse(req.params.id);
  const parsed = archiveSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return res.status(400).json({ error: "Цэг архивлах хүсэлт буруу байна" });
  const organizationId = req.user.organization_id;
  const outcome = await withTenantTransaction(organizationId, async client => {
    const current = (await client.query(`SELECT * FROM network_nodes
      WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [organizationId, id.data])).rows[0];
    if (!current) return { status: 404, body: { error: "Цэг олдсонгүй" } };
    if (current.status === "inactive") return { status: 200, body: { item: current, replayed: true } };
    if (Number(current.version) !== parsed.data.expectedVersion) return { status: 409, body: { error: "Цэг өөр хэрэглэгчээр шинэчлэгдсэн байна", code: "VERSION_CONFLICT" } };
    const item = (await client.query(`UPDATE network_nodes SET status='inactive',version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`, [organizationId, id.data])).rows[0];
    const detail = { reason: parsed.data.reason, previousStatus: current.status };
    await client.query(`INSERT INTO network_node_events(
        organization_id,network_node_id,actor_user_id,event_type,node_version,detail)
      VALUES($1,$2,$3,'archived',$4,$5::jsonb)`, [organizationId, id.data, req.user.id, item.version, JSON.stringify(detail)]);
    await writeAudit(req, "network_node.archive", "network_node", id.data, detail, client);
    return { status: 200, body: { item, replayed: false } };
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/camera-objects/:id/initial-location", asyncHandler(async (req, res) => {
  if (!hasPermission(req, "operational-objects.update")) return deny(res, "operational-objects.update");
  const objectId = uuid.safeParse(req.params.id);
  const parsed = cameraGpsSchema.safeParse(req.body);
  if (!objectId.success || !parsed.success) return res.status(400).json({ error: "Камерын GPS мэдээлэл буруу байна", issues: parsed.error?.issues });
  const organizationId = req.user.organization_id;
  const value = parsed.data;
  const outcome = await withTenantTransaction(organizationId, async client => {
    const object = (await client.query(`SELECT * FROM operational_objects
      WHERE organization_id=$1 AND id=$2 AND domain='camera' FOR UPDATE`, [organizationId, objectId.data])).rows[0];
    if (!object) return { status: 404, body: { error: "Камерын объект олдсонгүй" } };
    if (object.status === "retired") return { status: 409, body: { error: "Архивласан камерын GPS-ийг засахгүй" } };
    if (object.current_specification_id) return { status: 409, body: { error: "Камерын объект аль хэдийн canonical profile-той болсон. Дахин ачаална уу.", code: "PROFILE_ALREADY_EXISTS" } };
    if (Number(object.version) !== value.expectedObjectVersion) return { status: 409, body: { error: "Камерын объект өөр хэрэглэгчээр шинэчлэгдсэн байна", code: "VERSION_CONFLICT", currentVersion: Number(object.version) } };
    const cameraCount = /^\d+$/.test(String(object.metadata?.cameraCount || "")) ? Number(object.metadata.cameraCount) : 0;
    if (cameraCount < 1) return { status: 409, body: { error: "Эх өгөгдөлд камерын тоо байхгүй тул анхны profile үүсгэх боломжгүй", code: "CAMERA_COUNT_REVIEW_REQUIRED" } };
    const specification = (await client.query(`INSERT INTO operational_object_specifications(
        organization_id,operational_object_id,version_no,pole_count,note,created_by,profile_kind)
      VALUES($1,$2,1,1,$3,$4,'camera') RETURNING *`, [organizationId, object.id,
      value.note || "Камерын GPS-ийг инженер хянаж анхны profile үүсгэв", req.user.id])).rows[0];
    const point = (await client.query(`INSERT INTO operational_object_camera_points(
        organization_id,specification_id,sequence_no,name,pole_reference,latitude,longitude,location_note)
      VALUES($1,$2,1,$3,'',$4,$5,$6) RETURNING *`, [organizationId, specification.id,
      object.name, value.latitude, value.longitude, value.note || object.location || ""])).rows[0];
    await client.query(`INSERT INTO operational_object_camera_devices(
        organization_id,specification_id,camera_point_id,sequence_no,device_type,quantity,note)
      VALUES($1,$2,$3,1,'Төрөл тодорхойгүй',$4,'Legacy aggregate тоо; техникийн үзүүлэлтийг хянаж баталгаажуулна')`,
    [organizationId, specification.id, point.id, cameraCount]);
    const updatedObject = (await client.query(`UPDATE operational_objects
      SET current_specification_id=$3,version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`, [organizationId, object.id, specification.id])).rows[0];
    const detail = { specificationId: specification.id, specificationVersion: 1, pointId: point.id,
      sourcePrecision: "legacy_object_aggregate", reviewSurface: "camera_fiber_network_gps",
      cameraCount, latitude: value.latitude, longitude: value.longitude,
      previousObjectVersion: Number(object.version), objectVersion: Number(updatedObject.version) };
    await client.query(`INSERT INTO operational_object_events(
        organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'camera_profile_created_from_reviewed_gps',$4,$5::jsonb)`, [organizationId,
      object.id, req.user.id, value.note || "Камерын GPS-ийг хянаж анхны profile үүсгэв", JSON.stringify(detail)]);
    await writeAudit(req, "operational_object.camera_profile.create_from_reviewed_gps", "operational_object", object.id, detail, client);
    return { status: 201, body: { item: point, objectVersion: Number(updatedObject.version), specificationVersion: 1 } };
  });
  res.status(outcome.status).json(outcome.body);
}));

router.post("/camera-points/:id/location", asyncHandler(async (req, res) => {
  if (!hasPermission(req, "operational-objects.update")) return deny(res, "operational-objects.update");
  const pointId = uuid.safeParse(req.params.id);
  const parsed = cameraGpsSchema.safeParse(req.body);
  if (!pointId.success || !parsed.success) return res.status(400).json({ error: "Камерын GPS мэдээлэл буруу байна", issues: parsed.error?.issues });
  const organizationId = req.user.organization_id;
  const value = parsed.data;
  const outcome = await withTenantTransaction(organizationId, async client => {
    const target = (await client.query(`SELECT object_row.*,specification.version_no specification_version,
        specification.id specification_id,point.sequence_no target_sequence
      FROM operational_objects object_row
      JOIN operational_object_specifications specification
        ON specification.organization_id=object_row.organization_id AND specification.id=object_row.current_specification_id
        AND specification.profile_kind='camera'
      JOIN operational_object_camera_points point
        ON point.organization_id=specification.organization_id AND point.specification_id=specification.id
      WHERE object_row.organization_id=$1 AND object_row.domain='camera' AND point.id=$2 FOR UPDATE OF object_row`,
    [organizationId, pointId.data])).rows[0];
    if (!target) return { status: 404, body: { error: "Камерын цэг олдсонгүй" } };
    if (target.status === "retired") return { status: 409, body: { error: "Архивласан камерын GPS-ийг засахгүй" } };
    if (Number(target.version) !== value.expectedObjectVersion) return { status: 409, body: { error: "Камерын объект өөр хэрэглэгчээр шинэчлэгдсэн байна", code: "VERSION_CONFLICT", currentVersion: Number(target.version) } };
    const [points, devices] = await Promise.all([
      client.query(`SELECT * FROM operational_object_camera_points
        WHERE organization_id=$1 AND specification_id=$2 ORDER BY sequence_no`, [organizationId, target.specification_id]),
      client.query(`SELECT * FROM operational_object_camera_devices
        WHERE organization_id=$1 AND specification_id=$2 ORDER BY camera_point_id,sequence_no`, [organizationId, target.specification_id]),
    ]);
    const specification = (await client.query(`INSERT INTO operational_object_specifications(
        organization_id,operational_object_id,version_no,pole_count,note,created_by,profile_kind)
      VALUES($1,$2,$3,$4,$5,$6,'camera') RETURNING *`, [organizationId, target.id,
      Number(target.specification_version) + 1, points.rowCount, value.note || "Камерын GPS байршил шинэчлэв", req.user.id])).rows[0];
    const pointIdMap = new Map();
    let updatedPoint;
    for (const point of points.rows) {
      const isTarget = point.id === pointId.data;
      const inserted = (await client.query(`INSERT INTO operational_object_camera_points(
          organization_id,specification_id,sequence_no,name,pole_reference,latitude,longitude,location_note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [organizationId, specification.id,
        point.sequence_no, point.name, point.pole_reference, isTarget ? value.latitude : point.latitude,
        isTarget ? value.longitude : point.longitude, isTarget && value.note ? value.note : point.location_note])).rows[0];
      pointIdMap.set(point.id, inserted.id);
      if (isTarget) updatedPoint = inserted;
    }
    for (const device of devices.rows) {
      await client.query(`INSERT INTO operational_object_camera_devices(
          organization_id,specification_id,camera_point_id,sequence_no,device_type,manufacturer,model,quantity,
          resolution_mp,lens_mm,supports_ptz,night_vision,connectivity,power_source,note,attributes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [organizationId,
        specification.id, pointIdMap.get(device.camera_point_id), device.sequence_no, device.device_type,
        device.manufacturer, device.model, device.quantity, device.resolution_mp, device.lens_mm,
        device.supports_ptz, device.night_vision, device.connectivity, device.power_source, device.note, device.attributes]);
    }
    const updatedObject = (await client.query(`UPDATE operational_objects
      SET current_specification_id=$3,version=version+1,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`, [organizationId, target.id, specification.id])).rows[0];
    const detail = { previousSpecificationId: target.specification_id, specificationId: specification.id,
      specificationVersion: specification.version_no, pointSequence: target.target_sequence,
      latitude: value.latitude, longitude: value.longitude, previousObjectVersion: Number(target.version),
      objectVersion: Number(updatedObject.version) };
    await client.query(`INSERT INTO operational_object_events(
        organization_id,operational_object_id,actor_user_id,event_type,note,detail)
      VALUES($1,$2,$3,'camera_point_location_changed',$4,$5::jsonb)`, [organizationId, target.id,
      req.user.id, value.note || "Камерын GPS байршил шинэчлэв", JSON.stringify(detail)]);
    await writeAudit(req, "operational_object.camera_point_location.create_revision", "operational_object", target.id, detail, client);
    return { status: 200, body: { item: updatedPoint, objectVersion: Number(updatedObject.version), specificationVersion: Number(specification.version_no) } };
  });
  res.status(outcome.status).json(outcome.body);
}));

module.exports = router;
