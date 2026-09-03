"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("fiber route stays a tenant-scoped network object with immutable geometry revisions", () => {
  const migration = read("migrations", "0104_camera_fiber_network_workspace.sql");
  assert.match(migration, /CREATE TABLE network_routes/);
  assert.match(migration, /CREATE TABLE network_route_revisions/);
  assert.match(migration, /network_kind TEXT NOT NULL DEFAULT 'fiber'/);
  assert.match(migration, /geometry JSONB NOT NULL/);
  assert.match(migration, /geometry->>'type'='LineString'/);
  assert.match(migration, /network_route_revisions_append_only/);
  assert.match(migration, /network_routes_tenant_policy/);
  assert.match(migration, /network_route_revisions_tenant_policy/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /INSERT INTO assets/);
  assert.doesNotMatch(migration, /operational_object_camera_devices[\s\S]*fiber/i);
});

test("fiber mutations require explicit permissions, validate coordinates and leave audit", () => {
  const route = read("src", "routes", "camera-network.js");
  assert.match(route, /network-routes\.read/);
  assert.match(route, /network-routes\.manage/);
  assert.match(route, /withTenantTransaction\(organizationId/);
  assert.match(route, /coordinates: z\.array\(coordinate\)\.min\(2\)\.max\(5000\)/);
  assert.match(route, /network_route\.create/);
  assert.match(route, /network_node\.create/);
  assert.match(route, /network_route\.archive/);
  assert.match(route, /VERSION_CONFLICT/);
  assert.doesNotMatch(route, /DELETE FROM network_/);
});

test("camera GPS correction creates a new camera specification instead of rewriting history", () => {
  const route = read("src", "routes", "camera-network.js");
  const handler = route.slice(route.indexOf('router.post("/camera-points/:id/location"'));
  assert.match(handler, /operational-objects\.update/);
  assert.match(handler, /INSERT INTO operational_object_specifications/);
  assert.match(handler, /INSERT INTO operational_object_camera_points/);
  assert.match(handler, /INSERT INTO operational_object_camera_devices/);
  assert.match(handler, /camera_point_location_changed/);
  assert.match(handler, /create_revision/);
  assert.doesNotMatch(handler, /UPDATE operational_object_camera_points/);
  assert.match(route, /router\.post\("\/camera-objects\/:id\/initial-location"/);
  assert.match(route, /sourcePrecision: "legacy_object_aggregate"/);
  assert.match(route, /camera_profile\.create_from_reviewed_gps/);
});

test("camera workspace exposes the familiar GIS controls without merging domain grains", () => {
  const camera = read("..", "web", "camera.js");
  const network = read("..", "web", "camera-network.js");
  assert.match(camera, /\["network", "Шилэн кабель"\]/);
  for (const text of ["Томруулах", "Трасс зурах", "Хадгалах", "Цуцлах", "Муфт / цэг", "Камер: ", "GPS хадгалах", "Давхарга"]) {
    assert.match(network, new RegExp(text));
  }
  assert.match(network, /\/api\/camera\/network\/routes/);
  assert.match(network, /\/api\/camera\/network\/nodes/);
  assert.match(network, /camera-points\/\$\{targetId\}\/location/);
  assert.match(network, /camera-objects\/\$\{targetId\}\/initial-location/);
  assert.match(network, /кабелийг камерын төхөөрөмж болгон давхар бүртгэхгүй/);
});

test("legacy fiber recovery stays in tenant-scoped append-only review staging", () => {
  const migration = read("migrations", "0105_legacy_fiber_route_recovery_review.sql");
  const route = read("src", "routes", "camera-network.js");
  for (const table of ["network_route_import_batches", "network_route_import_candidates", "network_route_import_reviews"]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
    assert.match(migration, new RegExp(`${table}_tenant_policy`));
    assert.match(migration, new RegExp(`${table}_append_only`));
  }
  assert.match(route, /router\.post\("\/imports\/legacy-recovery"/);
  assert.match(route, /constant_longitude_offset/);
  assert.match(route, /canonicalPromotion: false/);
  assert.match(route, /network_route_import\.stage/);
  assert.match(route, /network_route_import\.review/);
  assert.doesNotMatch(route.slice(route.indexOf('router.post("/imports/legacy-recovery"'), route.indexOf('router.post("/routes"')), /INSERT INTO network_routes/);
});

test("legacy recovery preview is visually separate from canonical fiber routes", () => {
  const network = read("..", "web", "camera-network.js");
  const extractor = read("scripts", "extract-legacy-fiber-preview.js");
  const smoke = read("scripts", "camera-network-demo-smoke.js");
  const stager = read("scripts", "stage-camera-network-demo.js");
  assert.match(network, /Legacy сэргээх preview/);
  assert.match(network, /Canonical болоогүй трассын preview/);
  assert.match(network, /Энэ бол master бүртгэл биш/);
  assert.match(network, /data-network-review/);
  assert.match(network, /dashArray: "10 7"/);
  assert.match(extractor, /sqlite3\.OPEN_READONLY/);
  assert.match(extractor, /longitudeOffset: 5726520/);
  assert.match(smoke, /CAMERA_DEMO_USERNAME is required/);
  assert.match(stager, /CAMERA_DEMO_USERNAME is required/);
  assert.doesNotMatch(`${smoke}\n${stager}`, /CAMERA_DEMO_USERNAME\s*\|\|\s*["']\d+/);
});

test("fiber GIS is a map-first CAD-style workspace with resilient satellite zoom", () => {
  const network = read("..", "web", "camera-network.js");
  const styles = read("..", "web", "camera-network.css");
  assert.match(network, /camera-network-cad-toolbar/);
  assert.match(network, /data-network-tool="route"/);
  assert.match(network, /data-network-undo/);
  assert.match(network, /data-network-refresh/);
  assert.match(network, /data-network-fit/);
  assert.match(network, /camera-network-statusbar/);
  assert.match(network, /street[\s\S]*maxNativeZoom: 19/);
  assert.match(network, /satellite[\s\S]*maxNativeZoom: 17/);
  assert.match(network, /ResizeObserver/);
  assert.match(network, /invalidateSize/);
  assert.match(styles, /min-height: 680px/);
  assert.match(styles, /\.camera-network-shell\.is-full/);
  assert.match(styles, /width: 100vw/);
  assert.match(styles, /height: 100vh/);
});
