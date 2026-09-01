"use strict";

const { withTenantTransaction } = require("../db");

function authorize(req, requiredPermissions = ["documents.manage"]) {
  if (!req?.user?.id || !req.user.organization_id) {
    const error = new Error("AUTHENTICATION_REQUIRED"); error.status=401; throw error;
  }
  const granted=new Set(req.user.permissions||[]);
  if(requiredPermissions.some(permission=>!granted.has(permission))){
    const error=new Error("DOCUMENT_LINK_FORBIDDEN");error.status=403;throw error;
  }
  return {organizationId:req.user.organization_id,actorUserId:req.user.id};
}

async function recordDocumentLink({ req, documentId, entityType, entityId,
  relationType="primary", source="api", requiredPermissions=["documents.manage"], client=null }) {
  const actor=authorize(req,requiredPermissions);
  const values=[documentId,entityType,entityId,relationType].map(value=>String(value||"").trim());
  if(values.some(value=>!value)) {const error=new Error("INVALID_DOCUMENT_LINK");error.status=400;throw error;}
  if(!["legacy","api","domain","migration"].includes(source)){const error=new Error("INVALID_DOCUMENT_LINK_SOURCE");error.status=400;throw error;}
  return withTenantTransaction(actor.organizationId,async tx=>{
    const document=await tx.query("SELECT id FROM documents WHERE organization_id=$1 AND id=$2",[actor.organizationId,values[0]]);
    if(!document.rowCount){const error=new Error("DOCUMENT_NOT_FOUND");error.status=404;throw error;}
    const inserted=await tx.query(
      `INSERT INTO document_links(
         organization_id,document_id,entity_type,entity_id,relation_type,source,recorded_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(organization_id,document_id,entity_type,entity_id,relation_type) DO NOTHING
       RETURNING *`,
      [actor.organizationId,...values,source,actor.actorUserId]
    );
    if(inserted.rowCount)return inserted.rows[0];
    return (await tx.query(
      `SELECT * FROM document_links WHERE organization_id=$1 AND document_id=$2
        AND entity_type=$3 AND entity_id=$4 AND relation_type=$5`,
      [actor.organizationId,...values]
    )).rows[0];
  },{client});
}

async function listDocumentLinks({ req, entityType, entityId,
  requiredPermissions=["documents.manage"], client=null }) {
  const actor=authorize(req,requiredPermissions);
  return withTenantTransaction(actor.organizationId,async tx=>(await tx.query(
      `SELECT * FROM document_entity_links_compat
        WHERE organization_id=$1 AND entity_type=$2 AND entity_id=$3
        ORDER BY recorded_at DESC,document_id`,
      [actor.organizationId,entityType,entityId]
    )).rows,{client});
}

module.exports={recordDocumentLink,listDocumentLinks};
