"use strict";

async function notifyUser(client, { organizationId, userId, type, title, message = "", entityId }) {
  if (!userId) return;
  await client.query(
    `INSERT INTO notifications(organization_id,user_id,type,title,message,entity_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [organizationId, userId, type, title, message, entityId || null]
  );
}

async function notifyManagement(client, { organizationId, excludeUserId, type, title, message = "", entityId }) {
  await client.query(
    `INSERT INTO notifications(organization_id,user_id,type,title,message,entity_id)
     SELECT organization_id,id,$2,$3,$4,$5
       FROM users
      WHERE organization_id=$1 AND active=true AND role IN ('director','chief_engineer')
        AND id<>$6`,
    [organizationId, type, title, message, entityId || null, excludeUserId]
  );
}

module.exports = { notifyUser, notifyManagement };
