"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const web = path.join(__dirname, "..", "..", "web");
const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
const workflow = fs.readFileSync(path.join(web, "workflow.css"), "utf8");
const mobile = fs.readFileSync(path.join(web, "mobile.js"), "utf8");

test("work orders render as bounded Kanban lanes instead of a long table or Gantt", () => {
  for (const title of ["Шинэ ба хуваарилах", "Эхлэх зөвшөөрөл", "Гүйцэтгэж буй", "Хяналт ба хаалт", "Хаагдсан"]) {
    assert.match(app, new RegExp(title));
  }
  assert.match(app, /class="work-kanban"/);
  assert.match(workflow, /max-height:calc\(100vh - 315px\)/);
  assert.doesNotMatch(app, /function workOrders\(\).*<table class="data-table"/);
  assert.doesNotMatch(app, /gantt/i);
});

test("Kanban preserves governed actions instead of drag bypass", () => {
  assert.match(app, /statusControl\(item\)/);
  assert.match(app, /assignmentControl\(item\)/);
  assert.match(app, /Батлах шаттай ажлыг чирж алгасахгүй/);
  assert.match(app, /data-workflow-action/);
});

test("field app returns only work assigned to the signed-in person", () => {
  assert.match(mobile, /filter\(x=>x\.assigned_to===state\.user\.id\)/);
  assert.doesNotMatch(mobile, /director.*chief_engineer/);
});
