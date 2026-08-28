"use strict";

const express = require("express");
const crypto = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const { loadConfig } = require("../config");
const { getPool } = require("../db");
const { authenticate, requirePermissions } = require("../middleware/auth");
const { writeAudit, writeSecurityAudit } = require("../services/audit");
const {
  provider, publicCatalog, encryptToken, decryptToken, authorizationUrl,
  exchangeAuthorizationCode, externalIdentity, grantedScopes, tokenExpiry, listResources,
} = require("../services/connectors");
const { asyncHandler } = require("../utils/async-handler");

const router = express.Router();
const config = () => loadConfig();
const sha256 = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const providerParam = z.string().regex(/^[a-z0-9-]{2,60}$/);
const returnPathSchema = z.string().regex(/^\/[A-Za-z0-9?&=_#%./-]*$/).max(300).default("/?view=connectors");

function safeReturnUrl(result, code) {
  const appUrl = config().connectors.appUrl;
  if (!appUrl) return null;
  const url = new URL(result?.return_path || "/?view=connectors", `${appUrl}/`);
  if (url.origin !== new URL(appUrl).origin) return `${appUrl}/?view=connectors&connector_error=invalid_return`;
  url.searchParams.set(code ? "connector_error" : "connector", code || "connected");
  return url.toString();
}

router.get("/catalog", (_req, res) => res.json({ items: publicCatalog(config()) }));

router.get("/oauth/:provider/callback", rateLimit({ windowMs: 60_000, limit: 60 }), asyncHandler(async (req, res) => {
  const item = providerParam.safeParse(req.params.provider).success ? provider(req.params.provider) : null;
  const state = String(req.query.state || "");
  const code = String(req.query.code || "");
  const stateResult = state ? await getPool().query(
    `SELECT s.*,u.active AS user_active,o.status AS organization_status
       FROM connector_oauth_states s
       JOIN users u ON u.organization_id=s.organization_id AND u.id=s.user_id
       JOIN organizations o ON o.id=s.organization_id
      WHERE s.state_sha256=$1 AND s.provider_code=$2`,
    [sha256(state), item?.code || "invalid"]
  ) : { rows: [] };
  const oauthState = stateResult.rows[0];
  const returnUrl = safeReturnUrl(oauthState, null);
  if (!item || !oauthState || oauthState.consumed_at || new Date(oauthState.expires_at) <= new Date()
      || !oauthState.user_active || oauthState.organization_status !== "active") {
    if (returnUrl) return res.redirect(303, safeReturnUrl(oauthState, "invalid_state"));
    return res.status(400).json({ error: "OAuth state хүчингүй эсвэл хугацаа дууссан байна" });
  }
  if (req.query.error || !code) {
    await writeSecurityAudit({
      organizationId: oauthState.organization_id, actorType: "tenant_user", actorId: oauthState.user_id,
      action: "connector.oauth_callback", outcome: "denied", subjectHash: sha256(item.code),
      detail: { provider: item.code, reason: String(req.query.error || "missing_code").slice(0,100) }, ipAddress: req.ip || null,
    });
    if (returnUrl) return res.redirect(303, safeReturnUrl(oauthState, "authorization_denied"));
    return res.status(400).json({ error: "Холболтын зөвшөөрөл олгогдсонгүй" });
  }

  let token;
  let identity;
  try {
    token = await exchangeAuthorizationCode(item, config(), code);
    if (!token.access_token) throw new Error("Provider did not return an access token");
    identity = await externalIdentity(item, token);
  } catch (error) {
    await writeSecurityAudit({
      organizationId: oauthState.organization_id, actorType: "tenant_user", actorId: oauthState.user_id,
      action: "connector.oauth_callback", outcome: "failure", subjectHash: sha256(item.code),
      detail: { provider: item.code, code: error.code || "PROVIDER_ERROR" }, ipAddress: req.ip || null,
    });
    if (returnUrl) return res.redirect(303, safeReturnUrl(oauthState, "provider_error"));
    throw error;
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM connector_oauth_states
        WHERE id=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`, [oauthState.id]
    );
    if (!locked.rowCount) {
      await client.query("ROLLBACK");
      if (returnUrl) return res.redirect(303, safeReturnUrl(oauthState, "state_used"));
      return res.status(409).json({ error: "OAuth state аль хэдийн ашиглагдсан байна" });
    }
    const existing = await client.query(
      `SELECT id,token_ciphertext FROM connector_connections
        WHERE organization_id=$1 AND provider_code=$2 FOR UPDATE`,
      [oauthState.organization_id, item.code]
    );
    if (!token.refresh_token && existing.rows[0]?.token_ciphertext) {
      const previous = decryptToken(existing.rows[0].token_ciphertext, config().connectors.encryptionKey);
      if (previous.refresh_token) token.refresh_token = previous.refresh_token;
    }
    const encrypted = encryptToken(token, config().connectors.encryptionKey);
    const scopes = grantedScopes(item, token);
    const expiresAt = tokenExpiry(token);
    const saved = await client.query(
      `INSERT INTO connector_connections
        (organization_id,provider_code,status,external_account_id,external_account_name,granted_scopes,
         token_ciphertext,token_expires_at,last_checked_at,created_by,updated_by)
       VALUES($1,$2,'connected',$3,$4,$5,$6,$7,now(),$8,$8)
       ON CONFLICT(organization_id,provider_code) DO UPDATE SET
         status='connected',external_account_id=EXCLUDED.external_account_id,
         external_account_name=EXCLUDED.external_account_name,granted_scopes=EXCLUDED.granted_scopes,
         token_ciphertext=EXCLUDED.token_ciphertext,token_expires_at=EXCLUDED.token_expires_at,
         last_checked_at=now(),last_error_code='',updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING id`,
      [oauthState.organization_id,item.code,identity.id,identity.name,scopes,encrypted,expiresAt,oauthState.user_id]
    );
    const action = existing.rowCount ? "reconnected" : "connected";
    await client.query(
      `INSERT INTO connector_connection_events(organization_id,connection_id,action,actor_user_id,detail)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [oauthState.organization_id,saved.rows[0].id,action,oauthState.user_id,JSON.stringify({ provider: item.code, scopes })]
    );
    await client.query(
      `INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail,ip_address)
       VALUES($1,$2,$3,'connector_connection',$4,$5::jsonb,$6)`,
      [oauthState.organization_id,oauthState.user_id,`connector.${action}`,saved.rows[0].id,
        JSON.stringify({ provider: item.code, externalAccount: identity.name, scopes }),req.ip || null]
    );
    await client.query("UPDATE connector_oauth_states SET consumed_at=now() WHERE id=$1", [oauthState.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (returnUrl) return res.redirect(303, returnUrl);
  res.json({ ok: true, provider: item.code });
}));

router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => {
  const connections = await getPool().query(
    `SELECT id,provider_code,status,external_account_name,granted_scopes,token_expires_at,
            last_checked_at,last_error_code,created_at,updated_at
       FROM connector_connections WHERE organization_id=$1 ORDER BY provider_code`,
    [req.user.organization_id]
  );
  const byProvider = new Map(connections.rows.map(row => [row.provider_code, row]));
  res.json({
    canManage: (req.user.permissions || []).includes("connectors.manage"),
    items: publicCatalog(config()).map(item => ({ ...item, connection: byProvider.get(item.code) || null })),
  });
}));

router.post("/:provider/authorize", requirePermissions("connectors.manage"), rateLimit({ windowMs: 60_000, limit: 20 }), asyncHandler(async (req, res) => {
  const parsedProvider = providerParam.safeParse(req.params.provider);
  const parsedReturn = returnPathSchema.safeParse(req.body?.returnPath);
  const item = parsedProvider.success ? provider(parsedProvider.data) : null;
  if (!item || !parsedReturn.success) return res.status(400).json({ error: "Холболтын хүсэлт буруу байна" });
  const state = crypto.randomBytes(32).toString("base64url");
  let url;
  try {
    url = authorizationUrl(item, config(), state);
  } catch (error) {
    return res.status(409).json({ error: error.message });
  }
  await getPool().query(
    `INSERT INTO connector_oauth_states(organization_id,user_id,provider_code,state_sha256,return_path,expires_at)
     VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
    [req.user.organization_id,req.user.id,item.code,sha256(state),parsedReturn.data]
  );
  await writeAudit(req,"connector.authorization_started","connector_provider",item.code,{ provider: item.code });
  res.status(201).json({ authorizationUrl: url, expiresInSeconds: 600 });
}));

router.get("/:provider/resources", requirePermissions("connectors.manage"), asyncHandler(async (req, res) => {
  const item = provider(req.params.provider);
  if (!item) return res.status(404).json({ error: "Холболт олдсонгүй" });
  const result = await getPool().query(
    `SELECT id,token_ciphertext FROM connector_connections
      WHERE organization_id=$1 AND provider_code=$2 AND status='connected'`,
    [req.user.organization_id,item.code]
  );
  if (!result.rowCount) return res.status(409).json({ error: "Энэ provider холбогдоогүй байна" });
  const token = decryptToken(result.rows[0].token_ciphertext, config().connectors.encryptionKey);
  try {
    const items = await listResources(item, token);
    await getPool().query(
      `UPDATE connector_connections SET last_checked_at=now(),last_error_code='',updated_at=now()
        WHERE organization_id=$1 AND id=$2`, [req.user.organization_id,result.rows[0].id]
    );
    res.json({ items, readOnly: true });
  } catch (error) {
    await getPool().query(
      `UPDATE connector_connections SET status='attention',last_error_code=$3,last_checked_at=now(),updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [req.user.organization_id,result.rows[0].id,String(error.code || "PROVIDER_ERROR").slice(0,100)]
    );
    throw error;
  }
}));

router.delete("/:provider", requirePermissions("connectors.manage"), asyncHandler(async (req, res) => {
  const item = provider(req.params.provider);
  if (!item) return res.status(404).json({ error: "Холболт олдсонгүй" });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE connector_connections SET status='disconnected',token_ciphertext='',token_expires_at=NULL,
         updated_by=$3,updated_at=now()
       WHERE organization_id=$1 AND provider_code=$2 AND status<>'disconnected' RETURNING id`,
      [req.user.organization_id,item.code,req.user.id]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Идэвхтэй холболт олдсонгүй" });
    }
    await client.query(
      `INSERT INTO connector_connection_events(organization_id,connection_id,action,actor_user_id,detail)
       VALUES($1,$2,'disconnected',$3,$4::jsonb)`,
      [req.user.organization_id,result.rows[0].id,req.user.id,JSON.stringify({ provider: item.code })]
    );
    await writeAudit(req,"connector.disconnected","connector_connection",result.rows[0].id,{ provider: item.code },client);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}));

module.exports = router;
