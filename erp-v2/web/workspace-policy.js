"use strict";

(function(root,factory){
  const policy=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=policy;
  if(root)root.OvervaWorkspacePolicy=policy;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const advancedViews=new Set([
    "map","fleet","iot","integration-lab","automation","ai-director",
    "developer","industry-profile","builder"
  ]);
  const setupViews=new Set(["dashboard","employees","users","settings","billing","audit","connectors"]);
  const nestedSetupViews=new Set(["structure"]);
  const ownerOversightViews=new Set(["work-orders","lighting","camera","executive","reports"]);
  const primaryAdminOnlyViews=new Set(["settings","users","audit"]);
  const roleViews={
    director:["dashboard","work-orders","lighting","camera","executive","reports"],
    chief_engineer:["dashboard","assets","work-orders","lighting","camera","maintenance","safety","reports","mobile"],
    accountant:["dashboard","finance","inventory","procurement","reports"],
    hr:["dashboard","hr","attendance"],
    storekeeper:["dashboard","inventory","procurement","assets"],
    engineer:["dashboard","assets","work-orders","maintenance","mobile"],
    electric:["dashboard","assets","work-orders","lighting","maintenance","mobile"],
    camera_engineer:["dashboard","assets","work-orders","camera","maintenance","mobile"],
    safety:["dashboard","safety","work-orders","lighting","camera"],
    worker:["dashboard","work-orders","attendance","mobile"]
  };
  const permissionViews={
    "hr.manage":["hr","attendance"],
    "records.manage":["records"],
    "archive.manage":["archive"],
    "safety.manage":["safety"],
    "audit.read":["audit"]
  };

  function isPrimaryAdmin(systemRoles=[]){return systemRoles.includes("owner")}
  function isOrganizationAdmin(systemRoles=[]){return systemRoles.includes("administrator")}
  function allowedViews({role="worker",systemRoles=[],permissions=[],workspaceCodes=[],enabledModules=[],viewModules={}}={}){
    const primary=isPrimaryAdmin(systemRoles);
    // System access and operational duty are independent, additive concepts.
    // An owner may also be a director, accountant or worker (especially in a
    // one-person organization), so ownership must not hide that person's job
    // workspace.
    const allowed=new Set(roleViews[role]||["dashboard"]);
    if(primary){
      for(const view of setupViews)allowed.add(view);
      // The primary administrator remains responsible for organization-wide
      // oversight, including work waiting for safety or management approval.
      for(const view of ownerOversightViews)allowed.add(view);
      // The primary administrator configures and oversees the whole tenant.
      // Show every standard workspace that the organization has actually
      // enabled, while the advancedViews filter below continues to keep
      // specialist/product-development surfaces out of the normal sidebar.
      // This avoids locking a director-owner out of Finance, Inventory or
      // Maintenance merely because those are not part of the director role.
      for(const [view,moduleCode] of Object.entries(viewModules)){
        if(enabledModules.includes(moduleCode)&&!nestedSetupViews.has(view))allowed.add(view);
      }
    }
    if(isOrganizationAdmin(systemRoles))for(const view of setupViews)if(!primaryAdminOnlyViews.has(view))allowed.add(view);
    for(const permission of permissions)for(const view of permissionViews[permission]||[])allowed.add(view);
    for(const view of workspaceCodes)if(typeof view==="string"&&view)allowed.add(view);
    for(const view of [...allowed]){
      if(primaryAdminOnlyViews.has(view)&&!primary){allowed.delete(view);continue}
      if(advancedViews.has(view)){allowed.delete(view);continue}
      const moduleCode=viewModules[view];
      if(moduleCode&&!enabledModules.includes(moduleCode))allowed.delete(view);
    }
    allowed.add("dashboard");
    return [...allowed];
  }
  return {advancedViews:[...advancedViews],setupViews:[...setupViews],isPrimaryAdmin,isOrganizationAdmin,allowedViews};
});
