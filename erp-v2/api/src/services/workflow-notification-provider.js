"use strict";

class NotificationProviderError extends Error {
  constructor(code,message=code){super(message);this.name="NotificationProviderError";this.code=code}
}

function disabledProvider(){
  return Object.freeze({
    code:"disabled",
    enabled:false,
    supportsIdempotency:true,
    async deliver(){throw new NotificationProviderError("NOTIFICATION_PROVIDER_DISABLED")},
  });
}

function validateProvider(provider){
  if(!provider||typeof provider.deliver!=="function"||!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(String(provider.code||""))){
    throw new NotificationProviderError("INVALID_NOTIFICATION_PROVIDER");
  }
  if(provider.enabled!==false&&provider.supportsIdempotency!==true){
    throw new NotificationProviderError("NOTIFICATION_PROVIDER_IDEMPOTENCY_REQUIRED");
  }
  return provider;
}

function resolveWorkflowNotificationProvider(){
  const configured=String(process.env.WORKFLOW_NOTIFICATION_PROVIDER||"disabled").trim().toLowerCase();
  if(configured===""||configured==="disabled")return disabledProvider();
  throw new NotificationProviderError("NOTIFICATION_PROVIDER_NOT_CONFIGURED",
    `Workflow notification provider '${configured}' has no installed adapter`);
}

module.exports={NotificationProviderError,disabledProvider,validateProvider,resolveWorkflowNotificationProvider};
