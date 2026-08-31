"use strict";

const CACHE="overva-erp-shell-59";
const SHELL=[
  "/",
  "/index.html",
  "/style.css?v=47",
  "/workflow.css?v=3",
  "/legacy-theme.css?v=24",
  "/employee-access.css?v=26",
  "/app.js?v=37",
  "/work-history.css?v=2",
  "/notifications.css",
  "/asset-detail.css",
  "/reports.css",
  "/attachments.css",
  "/audit.css",
  "/business-modules.css?v=22",
  "/business-modules.js?v=34",
  "/organization-blueprint.css?v=2",
  "/organization-blueprint.js?v=3",
  "/structure-smart-import.css?v=1",
  "/structure-smart-import.js?v=1",
  "/map.css",
  "/map.js",
  "/gps.css",
  "/gps.js",
  "/iot.css",
  "/iot.js",
  "/finance.css",
  "/finance.js",
  "/executive.css?v=3",
  "/executive.js?v=4",
  "/integration-lab.css",
  "/integration-lab.js",
  "/connectors.css?v=2",
  "/connectors.js?v=2",
  "/automation.css",
  "/automation.js",
  "/ai-director.css",
  "/ai-director.js",
  "/mobile.css",
  "/mobile.js?v=2",
  "/developer-platform.css",
  "/developer-platform.js",
  "/attendance.css",
  "/attendance.js",
  "/safety.css",
  "/safety.js?v=2",
  "/administration.css?v=33",
  "/hr-operations.css?v=2",
  "/administration.js?v=35",
  "/industry-profile.css",
  "/industry-profile.js",
  "/builder.css",
  "/builder-ai.css",
  "/builder.js",
  "/workspace-policy.js?v=33",
  "/lighting.js?v=5",
  "/camera.js?v=2",
  "/engineering.js?v=2",
  "/employee-access.js?v=30",
  "/standard-workspace.js?v=34",
  "/standard-workspace.css?v=27",
  "/vendor/leaflet/leaflet.css",
  "/vendor/leaflet/leaflet.js",
  "/manifest.webmanifest",
  "/cop-icon.svg"
];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname.startsWith("/api/"))return;

  if(request.mode==="navigate"){
    event.respondWith(
      fetch(request)
        .then(response=>{
          if(response.ok)caches.open(CACHE).then(cache=>cache.put("/index.html",response.clone()));
          return response;
        })
        .catch(()=>caches.match("/index.html"))
    );
    return;
  }

  if(url.origin!==self.location.origin)return;
  event.respondWith(
    fetch(request)
      .then(response=>{
        if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
        return response;
      })
      .catch(()=>caches.match(request))
  );
});
