"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");const path=require("node:path");
const migration=fs.readFileSync(path.join(__dirname,"..","migrations","0023_industry_profiles.sql"),"utf8");
const business=fs.readFileSync(path.join(__dirname,"..","src","routes","business-modules.js"),"utf8");
test("municipal infrastructure is a profile, not an OVERVA core module",()=>{assert.match(migration,/municipal-infrastructure/);assert.match(migration,/organization_industry_profiles/);assert.doesNotMatch(migration,/INSERT INTO module_catalog[\s\S]*municipal-infrastructure/)});
test("pilot tenant receives profile-specific examples only",()=>{assert.match(migration,/slug='choibalsan-hugjil'/);for(const code of ["street-lighting","surveillance","traffic-signal","lighting-repair","camera-repair","traffic-signal-repair"])assert.match(migration,new RegExp(code))});
test("positions, skills and work types stay organization configurable",()=>{for(const table of ["organization_work_types","organization_skills","position_skill_requirements","user_skills","work_type_skill_requirements"])assert.match(migration,new RegExp(`CREATE TABLE ${table}`));assert.match(business,/COALESCE\(p\.rank_level,500\)/);assert.doesNotMatch(business,/camera_engineer.*engineer.*electric/)});
