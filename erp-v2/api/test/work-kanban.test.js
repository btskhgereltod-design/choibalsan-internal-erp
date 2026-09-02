"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const web = path.join(__dirname, "..", "..", "web");
const app = fs.readFileSync(path.join(web, "app.js"), "utf8");
const workflow = fs.readFileSync(path.join(web, "workflow.css"), "utf8");
const mobile = fs.readFileSync(path.join(web, "mobile.js"), "utf8");
const lighting = fs.readFileSync(path.join(web, "lighting.js"), "utf8");
const camera = fs.readFileSync(path.join(web, "camera.js"), "utf8");
const engineering = fs.readFileSync(path.join(web, "engineering.js"), "utf8");
const safety = fs.readFileSync(path.join(web, "safety.js"), "utf8");

test("work orders render as bounded Kanban lanes instead of a long table or Gantt", () => {
  for (const title of ["Шинэ ба хуваарилах", "ХАБЭА эхлэх зөвшөөрөл", "Гүйцэтгэж буй", "ХАБЭА дуусгалтын шалгалт", "Ерөнхий инженерийн баталгаа", "Хаагдсан"]) {
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
  assert.match(app, /safety-review/);
  assert.match(app, /management-review/);
});

test("field app returns only work assigned to the signed-in person", () => {
  assert.match(mobile, /filter\(x=>x\.assigned_to===state\.user\.id\)/);
  assert.doesNotMatch(mobile, /director.*chief_engineer/);
});

test("specialist workspaces are scoped views of the one canonical work board", () => {
  assert.match(lighting, /Гэрэлтүүлгийн ажлууд/);
  assert.match(camera, /Камерын ажлууд/);
  assert.match(engineering, /Ерөнхий инженерийн удирдлагын хяналт/);
  assert.match(safety, /Ажил эхлүүлэх болон хаах зөвшөөрлийг нэгдсэн Ажлын самбараас шийднэ/);
  for (const source of [lighting, camera, engineering, safety]) {
    assert.match(source, /data-go="work-orders"/);
  }
});
