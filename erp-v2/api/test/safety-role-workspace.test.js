"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("HSE role workspace replaces decorative labels with task-focused tabs and filters", () => {
  const shell = read("web/index.html");
  const workspace = read("web/safety-workspace.js");
  const css = read("web/safety-workspace.css");
  const dockerfile = read("web/Dockerfile");

  assert.match(shell, /safety-workspace\.css\?v=1/);
  assert.match(shell, /safety\.js\?v=3[\s\S]*safety-workspace\.js\?v=1/);
  assert.match(dockerfile, /COPY safety-workspace\.css \/usr\/share\/nginx\/html\/safety-workspace\.css/);
  assert.match(dockerfile, /COPY safety-workspace\.js \/usr\/share\/nginx\/html\/safety-workspace\.js/);
  for (const label of ["Миний хийх ажил", "Эхлэх зөвшөөрөл", "Дуусгалтын шалгалт", "Хяналтад буй ажил", "Эрсдэл ба бүртгэл"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /role="tab"/);
  assert.match(workspace, /data-safety-workspace-search/);
  assert.match(workspace, /data-safety-workspace-due/);
  assert.match(workspace, /data-safety-workspace-assignee/);
  assert.match(workspace, /data-safety-workspace-more/);
  assert.match(css, /max-height:570px/);
});

test("HSE role workspace reuses canonical governed actions and evidence history", () => {
  const workspace = read("web/safety-workspace.js");

  for (const action of ["safety_authorize_start", "safety_return_start", "safety_suspend_execution", "safety_accept_completion", "safety_return_to_execution"]) {
    assert.match(workspace, new RegExp(action));
  }
  assert.match(workspace, /data-workflow-action/);
  assert.match(workspace, /data-history-id/);
  assert.doesNotMatch(workspace, /fetch\(|\/api\//);
});
