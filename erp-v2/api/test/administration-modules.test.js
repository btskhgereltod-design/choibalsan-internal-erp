"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");const path=require("node:path");
const migration=fs.readFileSync(path.join(__dirname,"..","migrations","0022_hr_records_archive.sql"),"utf8");
test("HR, records and archive remain separate optional modules",()=>{for(const code of ["hr","records","archive"]){assert.match(migration,new RegExp(`\\('${code}'`))}assert.match(migration,/core=false/);assert.match(migration,/slug='choibalsan-hugjil'/)});
test("pilot HR officer receives three independent roles",()=>{assert.match(migration,/r\.code IN\('hr-officer','records-officer','archivist'\)/);assert.match(migration,/WHERE u\.role='hr'/)});
test("tenant data tables all carry organization isolation",()=>{for(const table of ["employee_events","correspondence_records","archive_records"]){const start=migration.indexOf(`CREATE TABLE ${table}`),next=migration.indexOf("CREATE TABLE",start+1),section=migration.slice(start,next<0?undefined:next);assert.ok(start>=0);assert.match(section,/organization_id UUID NOT NULL/);assert.match(section,/UNIQUE\(organization_id,id\)/)}});
