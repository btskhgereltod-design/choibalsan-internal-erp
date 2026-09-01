"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const apiRoot=path.join(__dirname,"..");
const repositoryRoot=path.join(apiRoot,"..");
const json=file=>JSON.parse(fs.readFileSync(path.join(apiRoot,file),"utf8"));
const read=(root,file)=>fs.readFileSync(path.join(root,file),"utf8");

test("legacy SQLite dependencies are isolated from the request-serving API",()=>{
  const apiPackage=json("package.json");
  const apiLock=json("package-lock.json");
  const importerPackage=json("legacy-importer/package.json");
  const importerLock=json("legacy-importer/package-lock.json");

  assert.equal(apiPackage.dependencies.sqlite3,undefined);
  for(const dependency of ["sqlite3","node-gyp","tar","make-fetch-happen","cacache"]){
    assert.equal(apiLock.packages[`node_modules/${dependency}`],undefined,`${dependency} must not leak into the API lock`);
  }
  assert.equal(importerPackage.dependencies.sqlite3,"6.0.1");
  assert.equal(importerLock.packages["node_modules/sqlite3"].version,"6.0.1");
  const tarVersion=importerLock.packages["node_modules/tar"].version.split(".").map(Number);
  assert.ok(tarVersion[0]>7||tarVersion[0]===7&&(tarVersion[1]>5||tarVersion[1]===5&&tarVersion[2]>=21),"importer tar must include the security fixes in 7.5.21+");
});

test("dedicated importer is opt-in, non-root, no-port and snapshot-read-only",()=>{
  const dockerfile=read(apiRoot,"Dockerfile.legacy-canonical-importer");
  const compose=read(repositoryRoot,"docker-compose.yml");
  const service=compose.match(/  legacy-canonical-importer:\r?\n([\s\S]*?)\r?\n  web:/)?.[0]||"";

  assert.match(dockerfile,/npm ci --omit=dev --omit=optional/);
  assert.match(dockerfile,/COPY --from=dependencies \/build\/node_modules/);
  assert.match(dockerfile,/USER importer/);
  assert.match(dockerfile,/ENTRYPOINT \["node", "scripts\/legacy-canonical-import\.js"\]/);
  assert.match(service,/profiles: \["legacy-import"\]/);
  assert.match(service,/restart: "no"/);
  assert.match(service,/20260901T101143Z:\/legacy-snapshot:ro/);
  assert.match(service,/LEGACY_DB_PATH: \/legacy-snapshot\/app\.db/);
  assert.match(service,/LEGACY_UPLOAD_ROOT: \/legacy-snapshot\/uploads/);
  assert.doesNotMatch(service,/\n\s+ports:/);
  assert.doesNotMatch(service,/ALLOW_LEGACY_CANONICAL_IMPORT/);
});
