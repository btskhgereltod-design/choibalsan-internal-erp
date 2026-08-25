"use strict";

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function buildPlan({ moduleCodes = [], profileCode = "general", answers = {}, currentEnabledModules = [] }, catalog) {
  const activeModules = new Map((catalog.modules || []).filter(item => item.active).map(item => [item.code, item]));
  const templates = new Map((catalog.templates || []).filter(item => item.active).map(item => [item.code, item]));
  const rules = (catalog.rules || []).filter(item => item.active).sort((a, b) => a.priority - b.priority);
  const template = templates.get(profileCode);
  if (!template || template.maturity === "deprecated") {
    return invalidPlan(profileCode, answers, [`Сонгосон салбарын загвар ашиглах боломжгүй: ${profileCode}`]);
  }

  const requested = unique(moduleCodes);
  const unknown = requested.filter(code => !activeModules.has(code));
  if (unknown.length) return invalidPlan(profileCode, answers, [`Каталогт байхгүй модуль: ${unknown.join(", ")}`]);

  const protectedModules = new Set(rules.filter(rule => rule.rule_type === "requires_approval" && rule.subject_type === "module").map(rule => rule.subject_code));
  const currentlyEnabled = new Set(currentEnabledModules);
  const selected = new Set([...activeModules.values()].filter(item => item.core).map(item => item.code));
  const requiresApproval = [];
  const warnings = [];
  const recommendations = [];

  for (const code of requested) {
    if (protectedModules.has(code) && !currentlyEnabled.has(code)) {
      const rule = rules.find(item => item.rule_type === "requires_approval" && item.subject_code === code);
      requiresApproval.push({ moduleCode: code, message: rule?.message || "OVERVA багийн зөвшөөрөл шаардлагатай." });
    } else selected.add(code);
  }

  // Builder cannot silently disable a sensitive integration that was approved earlier.
  for (const code of protectedModules) if (currentlyEnabled.has(code) && activeModules.has(code)) selected.add(code);

  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules.filter(item => item.rule_type === "dependency" && item.subject_type === "module")) {
      if (!selected.has(rule.subject_code)) continue;
      for (const dependency of unique(rule.effect?.requiresModules)) {
        if (!activeModules.has(dependency)) {
          warnings.push(`Шаардлагатай модуль каталогт идэвхгүй байна: ${dependency}`);
        } else if (!selected.has(dependency)) {
          selected.add(dependency);
          warnings.push(rule.message);
          changed = true;
        }
      }
    }
  }

  for (const rule of rules.filter(item => item.rule_type === "recommendation" && item.subject_type === "module")) {
    if (!selected.has(rule.subject_code)) continue;
    const missing = unique(rule.effect?.recommendsModules).filter(code => !selected.has(code));
    if (missing.length) recommendations.push({ moduleCode: rule.subject_code, recommendedModules: missing, message: rule.message });
  }
  if (template.maturity === "pilot") warnings.push("Энэ салбарын загвар pilot шатанд байна. Бодит хэрэглээний санал хүсэлтээр сайжруулна.");

  return {
    valid: true,
    errors: [],
    warnings: unique(warnings),
    recommendations,
    requiresApproval,
    configuration: {
      profileCode,
      enabledModules: [...selected].sort(),
      answers: answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {},
    },
  };
}

function invalidPlan(profileCode, answers, errors) {
  return {
    valid: false, errors, warnings: [], recommendations: [], requiresApproval: [],
    configuration: { profileCode, enabledModules: [], answers: answers || {} },
  };
}

async function applyConfiguration(client, organizationId, userId, configuration) {
  const enabled = unique(configuration.enabledModules);
  await client.query(
    `INSERT INTO organization_modules(organization_id,module_code,enabled,enabled_by)
     SELECT $1,code,true,$3 FROM module_catalog
      WHERE active=true AND (core=true OR code=ANY($2::text[]))
     ON CONFLICT(organization_id,module_code)
     DO UPDATE SET enabled=true,enabled_by=EXCLUDED.enabled_by,enabled_at=now()`,
    [organizationId, enabled, userId]
  );
  await client.query(
    `UPDATE organization_modules om SET enabled=false,enabled_by=$3,enabled_at=now()
      FROM module_catalog mc
     WHERE om.organization_id=$1 AND mc.code=om.module_code AND mc.active=true AND mc.core=false
       AND NOT (om.module_code=ANY($2::text[]))`,
    [organizationId, enabled, userId]
  );

  await client.query("UPDATE organization_industry_profiles SET primary_profile=false WHERE organization_id=$1", [organizationId]);
  await client.query(
    `INSERT INTO organization_industry_profiles(organization_id,template_code,primary_profile,applied_at)
     VALUES($1,$2,true,now())
     ON CONFLICT(organization_id,template_code)
     DO UPDATE SET primary_profile=true,applied_at=now()`,
    [organizationId, configuration.profileCode]
  );
  await client.query(
    `INSERT INTO organization_asset_categories(organization_id,code,name,description,source_template_code)
     SELECT $1,code,name,description,template_code FROM industry_template_asset_categories WHERE template_code=$2
     ON CONFLICT(organization_id,code) DO NOTHING`,
    [organizationId, configuration.profileCode]
  );
  await client.query(
    `INSERT INTO organization_work_types(organization_id,code,name,category,description,source_template_code)
     SELECT $1,code,name,category,description,template_code FROM industry_template_work_types WHERE template_code=$2
     ON CONFLICT(organization_id,code) DO NOTHING`,
    [organizationId, configuration.profileCode]
  );
}

module.exports = { buildPlan, applyConfiguration };
