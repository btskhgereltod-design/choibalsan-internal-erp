"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("canonical document links are additive, tenant scoped and immutable",()=>{
  const sql=read("migrations/0083_canonical_document_links.sql");
  assert.match(sql,/CREATE TABLE document_links/);
  assert.match(sql,/FOREIGN KEY\(organization_id,document_id\)/);
  assert.match(sql,/document_links_append_only/);
  assert.match(sql,/document_links_tenant_policy/);
  assert.match(sql,/ON CONFLICT\(organization_id,document_id,entity_type,entity_id,relation_type\) DO NOTHING/);
  assert.doesNotMatch(sql,/DROP (TABLE|COLUMN)|DELETE FROM documents|UPDATE documents/i);
});

test("legacy references remain readable while new writes dual-record links",()=>{
  const sql=read("migrations/0083_canonical_document_links.sql");
  const documents=read("src/routes/documents.js");
  const hr=read("src/routes/hr.js");
  assert.match(sql,/CREATE VIEW document_entity_links_compat/);
  assert.match(sql,/d\.linked_entity_type/);
  assert.match(sql,/ADD COLUMN canonical_document_id UUID/g);
  assert.match(documents,/recordDocumentLink/);
  assert.match(documents,/linked_entity_type,linked_entity_id/);
  assert.match(hr,/recordDocumentLink/);
  assert.match(hr,/'employee',\$7/);
});

test("compatibility view fails closed across canonical and legacy branches",()=>{
  const activation=read("migrations/0085_foundation_rls_activation.sql");
  assert.match(activation,/WITH \(security_invoker=true\)/);
  assert.match(activation,/FROM document_links\s+WHERE organization_id=overva_current_organization_id\(\)/);
  assert.match(activation,/FROM documents d\s+WHERE d\.organization_id=overva_current_organization_id\(\)/);
});
