"use strict";

const bcrypt = require("bcryptjs");

async function provisionTenant(client, input) {
  const passwordHash = await bcrypt.hash(input.adminPassword, 12);
  const org = await client.query(
    "INSERT INTO organizations(slug,name) VALUES ($1,$2) RETURNING id,slug,name,status,created_at",
    [input.slug, input.name]
  );
  const organization = org.rows[0];

  await client.query(
    "INSERT INTO organization_settings(organization_id,short_name,email) VALUES($1,$2,$3)",
    [organization.id, input.name, input.adminEmail]
  );
  await client.query(
    `INSERT INTO organization_industry_profiles(organization_id,template_code,primary_profile)
     VALUES($1,'general',true)`,
    [organization.id]
  );
  const employee = await client.query(
    `INSERT INTO employees(organization_id,full_name,job_role) VALUES($1,$2,'director') RETURNING id`,
    [organization.id,input.adminName]
  );
  const owner = await client.query(
    `INSERT INTO users(organization_id,email,username,password_hash,full_name,role,employee_id)
     VALUES ($1,$2,$3,$4,$5,'director',$6) RETURNING id,email,username,full_name,employee_id`,
    [organization.id, input.adminEmail, input.adminUsername, passwordHash, input.adminName, employee.rows[0].id]
  );
  const subscription = await client.query(
    `INSERT INTO subscriptions(organization_id,plan_code,status,ends_at)
     VALUES ($1,$2,'trial',now()+($3::text || ' days')::interval)
     RETURNING plan_code,status,starts_at,ends_at`,
    [organization.id, input.planCode || "pilot", input.trialDays]
  );

  const enabledModules = [...new Set(input.enabledModules || [])];
  await client.query(
    `INSERT INTO organization_modules(organization_id,module_code,enabled)
     SELECT $1,code,true FROM module_catalog
      WHERE active=true AND (core=true OR code=ANY($2::text[]))
     ON CONFLICT DO NOTHING`,
    [organization.id, enabledModules]
  );
  await client.query(
    `INSERT INTO organization_roles(organization_id,code,name,system)
     VALUES ($1,'owner','Эзэмшигч',true),($1,'administrator','Администратор',true),
            ($1,'manager','Менежер',true),($1,'member','Ажилтан',true),
            ($1,'hr-officer','Хүний нөөцийн ажилтан',true),
            ($1,'records-officer','Бичиг хэргийн ажилтан',true),
            ($1,'archivist','Архивын ажилтан',true),
            ($1,'safety-officer','ХАБЭА хариуцагч',true),
            ($1,'industry-manager','Салбарын тохиргоо хариуцагч',true)
     ON CONFLICT DO NOTHING`,
    [organization.id]
  );
  await client.query(
    `UPDATE organization_roles
        SET name=CASE code
          WHEN 'owner' THEN 'Байгууллагын үндсэн админ'
          WHEN 'administrator' THEN 'Байгууллагын админ'
          ELSE name END
      WHERE organization_id=$1 AND code IN ('owner','administrator')`,
    [organization.id]
  );
  await client.query(
    `INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
     SELECT r.organization_id,r.id,p.code FROM organization_roles r CROSS JOIN permission_catalog p
      WHERE r.organization_id=$1 AND (
        r.code IN ('owner','administrator')
        OR (r.code='hr-officer' AND p.code='hr.manage')
        OR (r.code='records-officer' AND p.code='records.manage')
        OR (r.code='archivist' AND p.code='archive.manage')
        OR (r.code='safety-officer' AND p.code IN('safety.manage','safety.investigate'))
        OR (r.code='industry-manager' AND p.code IN('industry.manage','builder.manage'))
      )
     ON CONFLICT DO NOTHING`,
    [organization.id]
  );
  await client.query(
    `INSERT INTO user_roles(organization_id,user_id,role_id)
     SELECT $1,$2,id FROM organization_roles WHERE organization_id=$1 AND code='owner'
     ON CONFLICT DO NOTHING`,
    [organization.id, owner.rows[0].id]
  );

  return {
    organization,
    owner: owner.rows[0],
    subscription: subscription.rows[0],
  };
}

module.exports = { provisionTenant };
