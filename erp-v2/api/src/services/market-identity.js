"use strict";

const crypto = require("node:crypto");
const { getPool } = require("../db");

const PARTICIPANT_VIEWS = Object.freeze(["customer", "provider"]);

function isParticipantView(value) {
  return PARTICIPANT_VIEWS.includes(value);
}

function activeMembershipTypes(memberships = []) {
  return memberships
    .filter(item => item.status === "active" && isParticipantView(item.membership_type))
    .map(item => item.membership_type)
    .sort();
}

function canSelectParticipantView(memberships, view) {
  return isParticipantView(view) && activeMembershipTypes(memberships).includes(view);
}

function subjectHash(value) {
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

async function writeMarketAudit({ client = getPool(), marketIdentityId = null, membershipId = null,
  operatorAssignmentId = null, providerApplicationId = null, storefrontPlanId = null, storefrontId = null,
  storefrontSubscriptionId = null, externalIdentityId = null, marketSessionId = null,
  authChallengeId = null, verificationId = null, riskSignalId = null,
  phoneContactId = null, phoneChallengeId = null,
  actorType, actorIdentityId = null, eventType, outcome,
  subject = null, detail = {}, ipAddress = null }) {
  await client.query(
    `INSERT INTO market_audit_events
       (market_identity_id,membership_id,operator_assignment_id,provider_application_id,
        storefront_plan_id,storefront_id,storefront_subscription_id,external_identity_id,
        market_session_id,auth_challenge_id,verification_id,risk_signal_id,phone_contact_id,phone_challenge_id,
        actor_type,actor_identity_id,event_type,outcome,subject_hash,detail,ip_address)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21)`,
    [marketIdentityId, membershipId, operatorAssignmentId, providerApplicationId,
      storefrontPlanId, storefrontId, storefrontSubscriptionId, externalIdentityId, marketSessionId,
      authChallengeId, verificationId, riskSignalId, phoneContactId, phoneChallengeId,
      actorType, actorIdentityId, eventType, outcome,
      subject ? subjectHash(subject) : null, JSON.stringify(detail), ipAddress]
  );
}

async function writeMarketRiskSignal({ client = getPool(), marketIdentityId = null,
  relatedIdentityId = null, signalType, severity, subject = null, detail = {} }) {
  const result = await client.query(
    `INSERT INTO market_identity_risk_signals
       (market_identity_id,related_identity_id,signal_type,severity,subject_hash,detail)
     VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
    [marketIdentityId, relatedIdentityId, signalType, severity,
      subject ? subjectHash(subject) : null, JSON.stringify(detail)]
  );
  return result.rows[0];
}

async function loadMarketIdentity(identityId, client = getPool()) {
  const result = await client.query(
    `SELECT identity.id,identity.email,identity.email_verified_at,identity.display_name,identity.selected_view,
            (identity.password_hash IS NOT NULL) AS has_password,
            identity.created_at,identity.updated_at,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'id',membership.id,
                         'membership_type',membership.membership_type,
                         'status',membership.status,
                         'issued_at',membership.issued_at,
                         'activated_at',membership.activated_at,
                         'suspended_at',membership.suspended_at
                       ) ORDER BY membership.membership_type)
                        FROM market_memberships membership
                       WHERE membership.market_identity_id=identity.id),'[]'::jsonb) AS memberships,
            COALESCE((SELECT array_agg(assignment.role_code ORDER BY assignment.role_code)
                        FROM market_operator_assignments assignment
                       WHERE assignment.market_identity_id=identity.id
                         AND assignment.revoked_at IS NULL),'{}'::text[]) AS operator_roles,
            (SELECT jsonb_build_object(
                      'id',application.id,
                      'status',application.status,
                      'professional_summary',application.professional_summary,
                      'skill_tags',application.skill_tags,
                      'portfolio_url',application.portfolio_url,
                      'submitted_at',application.submitted_at,
                      'reviewed_at',application.reviewed_at,
                      'decided_at',application.decided_at,
                      'decision_reason',application.decision_reason
                    )
               FROM market_provider_applications application
              WHERE application.market_identity_id=identity.id
              ORDER BY application.submitted_at DESC
              LIMIT 1) AS provider_application,
            COALESCE((SELECT array_agg(DISTINCT external.provider ORDER BY external.provider)
                        FROM market_external_identities external
                       WHERE external.market_identity_id=identity.id AND external.revoked_at IS NULL),'{}'::text[]) AS external_auth_methods,
            COALESCE((SELECT array_agg(DISTINCT verification.verification_type ORDER BY verification.verification_type)
                        FROM market_identity_verifications verification
                       WHERE verification.market_identity_id=identity.id
                         AND verification.status='verified' AND verification.revoked_at IS NULL),'{}'::text[]) AS verified_facts
       FROM market_identities identity
      WHERE identity.id=$1 AND identity.active=true`,
    [identityId]
  );
  if (!result.rowCount) return null;
  const identity = result.rows[0];
  identity.active_memberships = activeMembershipTypes(identity.memberships);
  identity.has_operator_authority = identity.operator_roles.includes("market-operator");
  return identity;
}

module.exports = {
  PARTICIPANT_VIEWS,
  activeMembershipTypes,
  canSelectParticipantView,
  loadMarketIdentity,
  subjectHash,
  writeMarketAudit,
  writeMarketRiskSignal,
};
