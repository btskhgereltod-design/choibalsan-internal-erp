"use strict";

require("dotenv").config();
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { getPool, closePool } = require("../src/db");
const { provisionTenant } = require("../src/services/tenant-provisioning");

const baseUrl = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:4100";
const suffix = Date.now().toString(36);
const tenantB = {
  slug: `tenant-test-${suffix}`,
  name: `Tenant Test ${suffix}`,
  email: `admin-${suffix}@tenant.test`,
  username: `admin-${suffix}`,
  password: `Tenant-${suffix}-Strong-Pass!`,
};
const platformTenant = {
  slug: `platform-test-${suffix}`,
  name: `Platform Test ${suffix}`,
  email: `director-${suffix}@platform.test`,
  username: `director-${suffix}`,
  password: `Platform-Tenant-${suffix}-Pass!`,
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function login(organization, identifier, password) {
  const { response, body } = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ organization, identifier, password }),
  });
  assert.equal(response.status, 200, `login failed: ${JSON.stringify(body)}`);
  return body.token;
}

async function integrationTest() {
  const pool = getPool();
  let tenantBId;
  let platformTenantId;
  const createdAssetIds = [];
  const createdWorkOrderIds = [];
  const createdUserIds = [];
  const createdAttachmentIds = [];
  try {
    const databaseName = (await pool.query("SELECT current_database() AS name")).rows[0].name;
    if (!/^overva_(test|rehearsal)_[a-z0-9_]+$/i.test(databaseName)) {
      throw new Error("Integration test requires a disposable overva_test_* or overva_rehearsal_* database because append-only evidence cannot be hard-deleted");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const provisioned = await provisionTenant(client, {
        slug: tenantB.slug,
        name: tenantB.name,
        adminName: "Tenant B Admin",
        adminEmail: tenantB.email,
        adminUsername: tenantB.username,
        adminPassword: tenantB.password,
        planCode: "integration-test",
        trialDays: 30,
        enabledModules: ["assets", "work-orders"],
      });
      tenantBId = provisioned.organization.id;
      // This legacy broad harness exercises asset and work-order HTTP routes.
      // Enable only those capabilities in its disposable fixture instead of
      // relying on whichever modules happen to be active in a developer DB.
      await client.query(
        `INSERT INTO organization_modules(organization_id,module_code,enabled)
         SELECT organization.id,module.code,true
           FROM organizations organization CROSS JOIN module_catalog module
          WHERE organization.slug=$1 AND module.code=ANY($2::text[])
         ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true`,
        [process.env.BOOTSTRAP_ORG_SLUG,["assets","work-orders"]]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const tokenA = await login(
      process.env.BOOTSTRAP_ORG_SLUG,
      process.env.BOOTSTRAP_ADMIN_EMAIL,
      process.env.BOOTSTRAP_ADMIN_PASSWORD
    );
    const tokenB = await login(tenantB.slug, tenantB.email, tenantB.password);

    const platformLogin = await request("/api/platform/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: process.env.BOOTSTRAP_PLATFORM_ADMIN_EMAIL,
        password: process.env.BOOTSTRAP_PLATFORM_ADMIN_PASSWORD,
      }),
    });
    assert.equal(platformLogin.response.status, 200, JSON.stringify(platformLogin.body));
    const platformToken = platformLogin.body.token;
    const systemStatus = await request("/api/platform/system/status", {
      headers: { authorization: `Bearer ${platformToken}` },
    });
    assert.equal(systemStatus.response.status, 200, JSON.stringify(systemStatus.body));
    assert.equal(systemStatus.body.status, "healthy");
    assert(Number(systemStatus.body.database_bytes) > 0);
    assert(Number(systemStatus.body.schema_version) >= 7);
    const tenantTokenForbidden = await request("/api/platform/organizations", {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(tenantTokenForbidden.response.status, 401);
    const platformCreate = await request("/api/platform/organizations", {
      method: "POST",
      headers: { authorization: `Bearer ${platformToken}` },
      body: JSON.stringify({
        name: platformTenant.name,
        slug: platformTenant.slug,
        adminName: "Platform Tenant Director",
        adminEmail: platformTenant.email,
        adminUsername: platformTenant.username,
        adminPassword: platformTenant.password,
        planCode: "starter",
        trialDays: 14,
      }),
    });
    assert.equal(platformCreate.response.status, 201, JSON.stringify(platformCreate.body));
    platformTenantId = platformCreate.body.item.id;
    const platformUpdate = await request(`/api/platform/organizations/${platformTenantId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${platformToken}` },
      body: JSON.stringify({ organizationStatus: "active", subscriptionStatus: "active", planCode: "business" }),
    });
    assert.equal(platformUpdate.response.status, 200, JSON.stringify(platformUpdate.body));
    assert.equal(platformUpdate.body.item.subscription_status, "active");
    assert.equal(platformUpdate.body.item.plan_code, "business");
    const platformTenantToken = await login(platformTenant.slug, platformTenant.username, platformTenant.password);
    assert(platformTenantToken);

    const managedPassword = `Managed-${suffix}-Strong-Pass!`;
    const managedUser = await request("/api/users", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        email: `managed-${suffix}@tenant-a.test`,
        username: `managed-${suffix}`,
        fullName: "Managed Test User",
        role: "engineer",
        password: managedPassword,
      }),
    });
    assert.equal(managedUser.response.status, 201, JSON.stringify(managedUser.body));
    createdUserIds.push(managedUser.body.item.id);
    let managedToken = await login(process.env.BOOTSTRAP_ORG_SLUG, `managed-${suffix}`, managedPassword);
    const nextManagedPassword = `Managed-${suffix}-Changed-Pass!`;
    const passwordChange = await request("/api/auth/change-password", {
      method: "POST",
      headers: { authorization: `Bearer ${managedToken}` },
      body: JSON.stringify({ currentPassword: managedPassword, newPassword: nextManagedPassword }),
    });
    assert.equal(passwordChange.response.status, 200, JSON.stringify(passwordChange.body));
    managedToken = await login(process.env.BOOTSTRAP_ORG_SLUG, `managed-${suffix}`, nextManagedPassword);
    assert(managedToken);
    const forbiddenUsers = await request("/api/users", { headers: { authorization: `Bearer ${managedToken}` } });
    assert.equal(forbiddenUsers.response.status, 403);

    const currentAdmin = await request("/api/auth/me", { headers: { authorization: `Bearer ${tokenA}` } });
    const selfLockout = await request(`/api/users/${currentAdmin.body.user.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ active: false }),
    });
    assert.equal(selfLockout.response.status, 409);

    const [usersA, usersB] = await Promise.all([
      request("/api/users", { headers: { authorization: `Bearer ${tokenA}` } }),
      request("/api/users", { headers: { authorization: `Bearer ${tokenB}` } }),
    ]);
    assert(usersA.body.items.some(item => item.id === managedUser.body.item.id));
    assert(!usersB.body.items.some(item => item.id === managedUser.body.item.id));

    const createA = await request("/api/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ code: `TEST-A-${suffix}`, name: "Tenant A Test Asset", category: "test",
        serialNumber: `SERIAL-${suffix}`, location: "Integration location", responsibleUserId: managedUser.body.item.id,
        acquiredAt: "2026-01-15", notes: "Integration asset" }),
    });
    assert.equal(createA.response.status, 201, JSON.stringify(createA.body));
    createdAssetIds.push(createA.body.item.id);
    const updateAsset = await request(`/api/assets/${createA.body.item.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ status: "repair", location: "Repair workshop" }),
    });
    assert.equal(updateAsset.response.status, 200, JSON.stringify(updateAsset.body));
    assert.equal(updateAsset.body.item.status, "repair");

    const createB = await request("/api/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ code: `TEST-B-${suffix}`, name: "Tenant B Test Asset", category: "test" }),
    });
    assert.equal(createB.response.status, 201, JSON.stringify(createB.body));
    createdAssetIds.push(createB.body.item.id);

    const workA = await request("/api/work-orders", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        assetId: createA.body.item.id,
        assignedTo: managedUser.body.item.id,
        title: `Tenant A Work ${suffix}`,
        category: "test",
        priority: "normal",
      }),
    });
    assert.equal(workA.response.status, 201, JSON.stringify(workA.body));
    createdWorkOrderIds.push(workA.body.item.id);

    const assignedStart = await request(`/api/work-orders/${workA.body.item.id}/status`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${managedToken}` },
      body: JSON.stringify({ status: "in_progress" }),
    });
    assert.equal(assignedStart.response.status, 200, JSON.stringify(assignedStart.body));
    const workNote = await request(`/api/work-orders/${workA.body.item.id}/notes`, {
      method: "POST",
      headers: { authorization: `Bearer ${managedToken}` },
      body: JSON.stringify({ note: "Integration гүйцэтгэлийн тэмдэглэл" }),
    });
    assert.equal(workNote.response.status, 201, JSON.stringify(workNote.body));

    for (const status of ["pending_review", "completed"]) {
      const transition = await request(`/api/work-orders/${workA.body.item.id}/status`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ status }),
      });
      assert.equal(transition.response.status, 200, `status ${status}: ${JSON.stringify(transition.body)}`);
      assert.equal(transition.body.item.status, status);
    }
    const workHistory = await request(`/api/work-orders/${workA.body.item.id}/history`, {
      headers: { authorization: `Bearer ${managedToken}` },
    });
    assert.equal(workHistory.response.status, 200, JSON.stringify(workHistory.body));
    assert(workHistory.body.events.some(event => event.event_type === "created"));
    assert(workHistory.body.events.some(event => event.event_type === "note"));
    assert(workHistory.body.events.filter(event => event.event_type === "status_changed").length >= 3);
    const attachmentForm = new FormData();
    attachmentForm.append("file", new Blob(["ERP v2 integration attachment"], { type: "text/plain" }), `integration-${suffix}.txt`);
    const attachmentUpload = await fetch(`${baseUrl}/api/attachments/entity/work-orders/${workA.body.item.id}`, {
      method: "POST", headers: { authorization: `Bearer ${managedToken}` }, body: attachmentForm,
    });
    const attachmentBody = await attachmentUpload.json();
    assert.equal(attachmentUpload.status, 201, JSON.stringify(attachmentBody));
    createdAttachmentIds.push(attachmentBody.item.id);
    const attachmentList = await request(`/api/attachments/entity/work-orders/${workA.body.item.id}`, {
      headers: { authorization: `Bearer ${managedToken}` },
    });
    assert.equal(attachmentList.response.status, 200, JSON.stringify(attachmentList.body));
    assert(attachmentList.body.items.some(item => item.id === attachmentBody.item.id));
    const attachmentDownload = await fetch(`${baseUrl}/api/attachments/file/${attachmentBody.item.id}`, {
      headers: { authorization: `Bearer ${managedToken}` },
    });
    assert.equal(attachmentDownload.status, 200);
    assert.equal(await attachmentDownload.text(), "ERP v2 integration attachment");
    const crossTenantAttachment = await request(`/api/attachments/entity/work-orders/${workA.body.item.id}`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(crossTenantAttachment.response.status, 404);
    const forbiddenFile = new FormData();
    forbiddenFile.append("file", new Blob(["bad"], { type: "application/x-msdownload" }), "bad.exe");
    const forbiddenUpload = await fetch(`${baseUrl}/api/attachments/entity/work-orders/${workA.body.item.id}`, {
      method: "POST", headers: { authorization: `Bearer ${managedToken}` }, body: forbiddenFile,
    });
    assert.equal(forbiddenUpload.status, 400);
    const attachmentDelete = await request(`/api/attachments/file/${attachmentBody.item.id}`, {
      method: "DELETE", headers: { authorization: `Bearer ${managedToken}` },
    });
    assert.equal(attachmentDelete.response.status, 200, JSON.stringify(attachmentDelete.body));
    const assetDetail = await request(`/api/assets/${createA.body.item.id}`, {
      headers: { authorization: `Bearer ${managedToken}` },
    });
    assert.equal(assetDetail.response.status, 200, JSON.stringify(assetDetail.body));
    assert.equal(assetDetail.body.item.responsible_user_id, managedUser.body.item.id);
    assert(assetDetail.body.events.some(event => event.event_type === "created"));
    assert(assetDetail.body.events.some(event => event.event_type === "updated"));
    assert(assetDetail.body.workOrders.some(item => item.id === workA.body.item.id));
    const managedNotifications = await request("/api/notifications", {
      headers: { authorization: `Bearer ${managedToken}` },
    });
    assert.equal(managedNotifications.response.status, 200, JSON.stringify(managedNotifications.body));
    assert(managedNotifications.body.items.some(item => item.type === "work_assigned" && item.entity_id === workA.body.item.id));
    assert(managedNotifications.body.items.some(item => item.type === "work_completed" && item.entity_id === workA.body.item.id));
    assert(managedNotifications.body.unread >= 2);
    const readNotifications = await request("/api/notifications/read-all", {
      method: "PATCH",
      headers: { authorization: `Bearer ${managedToken}` },
      body: "{}",
    });
    assert.equal(readNotifications.response.status, 200, JSON.stringify(readNotifications.body));
    const notificationsAfterRead = await request("/api/notifications", {
      headers: { authorization: `Bearer ${managedToken}` },
    });
    assert.equal(notificationsAfterRead.body.unread, 0);
    const reportDay = new Date().toISOString().slice(0, 10);
    const overview = await request(`/api/reports/overview?from=${reportDay}&to=${reportDay}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(overview.response.status, 200, JSON.stringify(overview.body));
    assert(overview.body.work.created >= 1);
    assert(overview.body.people.participants.some(item => item.user_id === managedUser.body.item.id && item.assigned >= 1));
    const forbiddenReport = await request(`/api/reports/overview?from=${reportDay}&to=${reportDay}`, {
      headers: { authorization: `Bearer ${managedToken}` },
    });
    assert.equal(forbiddenReport.response.status, 403);
    const csvResponse = await fetch(`${baseUrl}/api/reports/work-orders.csv?from=${reportDay}&to=${reportDay}`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get("content-type"), /text\/csv/);
    const csvBody = await csvResponse.text();
    assert(csvBody.includes(`Tenant A Work ${suffix}`));
    const tenantBCsv = await fetch(`${baseUrl}/api/reports/work-orders.csv?from=${reportDay}&to=${reportDay}`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(tenantBCsv.status, 200);
    assert(!(await tenantBCsv.text()).includes(`Tenant A Work ${suffix}`));

    const auditResult = await request(`/api/audit?from=${reportDay}&to=${reportDay}&action=work_order.note`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(auditResult.response.status, 200, JSON.stringify(auditResult.body));
    assert(auditResult.body.items.some(item => item.entity_id === workA.body.item.id && item.action === "work_order.note"));
    const forbiddenAudit = await request("/api/audit", { headers: { authorization: `Bearer ${managedToken}` } });
    assert.equal(forbiddenAudit.response.status, 403);
    const tenantBAudit = await request(`/api/audit?from=${reportDay}&to=${reportDay}`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    assert.equal(tenantBAudit.response.status, 200, JSON.stringify(tenantBAudit.body));
    assert(!tenantBAudit.body.items.some(item => item.entity_id === workA.body.item.id));

    const [assetsA, assetsB, workOrdersB] = await Promise.all([
      request("/api/assets", { headers: { authorization: `Bearer ${tokenA}` } }),
      request("/api/assets", { headers: { authorization: `Bearer ${tokenB}` } }),
      request("/api/work-orders", { headers: { authorization: `Bearer ${tokenB}` } }),
    ]);
    assert(assetsA.body.items.some(item => item.id === createA.body.item.id));
    assert(!assetsA.body.items.some(item => item.id === createB.body.item.id));
    assert(assetsB.body.items.some(item => item.id === createB.body.item.id));
    assert(!assetsB.body.items.some(item => item.id === createA.body.item.id));
    assert(!workOrdersB.body.items.some(item => item.id === workA.body.item.id));

    const crossTenantReference = await request("/api/work-orders", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ assetId: createA.body.item.id, title: "Forbidden cross-tenant reference", category: "test" }),
    });
    assert.equal(crossTenantReference.response.status, 400);

    const crossTenantAssignee = await request("/api/work-orders", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ assignedTo: managedUser.body.item.id, title: "Forbidden assignee", category: "test" }),
    });
    assert.equal(crossTenantAssignee.response.status, 400);

    const crossTenantAssetResponsible = await request("/api/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ code: `FORBIDDEN-${suffix}`, name: "Forbidden responsible", category: "test",
        responsibleUserId: managedUser.body.item.id }),
    });
    assert.equal(crossTenantAssetResponsible.response.status, 400);

    console.log("Integration passed: system status, audit, attachments, and tenant isolation.");
  } finally {
    if (createdAttachmentIds.length) {
      await Promise.all(createdAttachmentIds.map(async id => {
        const item = (await pool.query("SELECT stored_name FROM attachments WHERE id=$1", [id])).rows[0];
        if (item) await fs.unlink(path.join(process.env.UPLOAD_DIR || "/app/uploads", item.stored_name)).catch(() => {});
      }));
    }
    console.log("Integration evidence retained in the disposable database; drop the database after verification.");
    await closePool();
  }
}

if (process.env.RUN_INTEGRATION === "1") {
  integrationTest().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { integrationTest };
