"use strict";

async function ensureLightingIncidentConfiguration(client,organizationId){
  await client.query(`INSERT INTO organization_operational_incident_types(
      organization_id,domain,code,name,quantity_unit,sort_order)
    SELECT $1,'lighting',item.code,item.name,item.quantity_unit,item.sort_order
    FROM (VALUES
      ('lamp_out','Гэрэл асахгүй','толгой',10),
      ('fixture_damage','Гэрлийн толгой гэмтсэн','толгой',20),
      ('pole_damage','Шон гэмтсэн','шон',30),
      ('cable_fault','Кабелийн гэмтэл','тохиолдол',40),
      ('feed_fault','Тэжээлийн гэмтэл','тохиолдол',50),
      ('panel_fault','Шит, самбарын гэмтэл','тохиолдол',60),
      ('traffic_signal_fault','Гэрлэн дохионы гэмтэл','тохиолдол',70),
      ('inspection_finding','Үзлэгийн зөрчил','тохиолдол',80)
    ) item(code,name,quantity_unit,sort_order)
    WHERE EXISTS(SELECT 1 FROM organization_modules
      WHERE organization_id=$1 AND module_code='lighting-operations' AND enabled=true)
    ON CONFLICT(organization_id,domain,code) DO NOTHING`,[organizationId]);
  await client.query(`INSERT INTO organization_roles(organization_id,code,name,system)
    SELECT $1,role.code,role.name,true
    FROM (VALUES
      ('lighting-incident-reporter','Гэрэлтүүлгийн гэмтэл мэдээлэгч'),
      ('lighting-incident-supervisor','Гэрэлтүүлгийн гэмтлийн хянагч')
    ) role(code,name)
    WHERE EXISTS(SELECT 1 FROM organization_modules
      WHERE organization_id=$1 AND module_code='lighting-operations' AND enabled=true)
    ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true`,[organizationId]);
  await client.query(`INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
    SELECT role.organization_id,role.id,grant_row.permission_code
    FROM organization_roles role
    JOIN LATERAL (VALUES
      ('lighting-incident-reporter','operational-incidents.report'),
      ('lighting-incident-supervisor','operational-incidents.report'),
      ('lighting-incident-supervisor','operational-incidents.correct'),
      ('lighting-incident-supervisor','operational-incidents.cancel'),
      ('work-order-manager','operational-objects.read'),
      ('work-order-manager','operational-objects.components.manage'),
      ('work-order-manager','operational-objects.notes.create'),
      ('work-order-manager','operational-objects.update'),
      ('work-order-manager','operational-objects.media.manage')
    ) grant_row(role_code,permission_code) ON grant_row.role_code=role.code
    WHERE role.organization_id=$1
    ON CONFLICT DO NOTHING`,[organizationId]);
}

async function ensureCameraIncidentConfiguration(client,organizationId){
  await client.query(`INSERT INTO organization_operational_incident_types(
      organization_id,domain,code,name,quantity_unit,sort_order)
    SELECT $1,'camera',item.code,item.name,item.quantity_unit,item.sort_order
    FROM (VALUES
      ('device_unavailable','Камер ажиллахгүй','камер',10),
      ('image_quality','Дүрс муу, тасалдсан','камер',20),
      ('physical_damage','Камерын төхөөрөмж гэмтсэн','камер',30),
      ('power_fault','Тэжээлийн гэмтэл','тохиолдол',40),
      ('network_fault','Сүлжээ, дамжуулалтын гэмтэл','тохиолдол',50),
      ('inspection_finding','Үзлэгийн зөрчил','тохиолдол',60)
    ) item(code,name,quantity_unit,sort_order)
    WHERE EXISTS(SELECT 1 FROM organization_modules
      WHERE organization_id=$1 AND module_code='camera-operations' AND enabled=true)
    ON CONFLICT(organization_id,domain,code) DO UPDATE SET
      name=EXCLUDED.name,quantity_unit=EXCLUDED.quantity_unit,sort_order=EXCLUDED.sort_order`,[organizationId]);
  await client.query(`INSERT INTO organization_roles(organization_id,code,name,system)
    SELECT $1,role.code,role.name,true
    FROM (VALUES
      ('camera-incident-reporter','Камерын гэмтэл мэдээлэгч'),
      ('camera-incident-supervisor','Камерын гэмтлийн хянагч')
    ) role(code,name)
    WHERE EXISTS(SELECT 1 FROM organization_modules
      WHERE organization_id=$1 AND module_code='camera-operations' AND enabled=true)
    ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true`,[organizationId]);
  await client.query(`INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
    SELECT role.organization_id,role.id,grant_row.permission_code
    FROM organization_roles role
    JOIN LATERAL (VALUES
      ('camera-incident-reporter','operational-incidents.report'),
      ('camera-incident-supervisor','operational-incidents.report'),
      ('camera-incident-supervisor','operational-incidents.correct'),
      ('camera-incident-supervisor','operational-incidents.cancel')
    ) grant_row(role_code,permission_code) ON grant_row.role_code=role.code
    WHERE role.organization_id=$1
    ON CONFLICT DO NOTHING`,[organizationId]);
}

module.exports={ensureLightingIncidentConfiguration,ensureCameraIncidentConfiguration};
