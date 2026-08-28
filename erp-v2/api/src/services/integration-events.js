"use strict";

const crypto=require("node:crypto");
const {z}=require("zod");

const identifier=z.string().trim().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/).min(3).max(160);
const eventEnvelopeSchema=z.object({
  specVersion:z.literal("1.0"),
  eventId:z.string().uuid(),
  eventType:identifier,
  schemaVersion:z.coerce.number().int().min(1).max(10000),
  occurredAt:z.iso.datetime(),
  source:z.object({
    system:identifier,
    reference:z.string().trim().min(1).max(300)
  }),
  subject:z.object({
    type:identifier,
    id:z.string().trim().min(1).max(300)
  }),
  correlationId:z.string().trim().min(8).max(200),
  causationId:z.string().trim().min(8).max(200).optional(),
  data:z.record(z.string(),z.unknown())
}).strict();

function stableValue(value){
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==="object")return Object.keys(value).sort().reduce((out,key)=>{
    out[key]=stableValue(value[key]);
    return out;
  },{});
  return value;
}

function validateIntegrationEvent(input){
  const parsed=eventEnvelopeSchema.safeParse(input);
  if(!parsed.success)return {success:false,issues:parsed.error.issues};
  const canonical=stableValue(parsed.data);
  const fingerprint=crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return {success:true,event:canonical,fingerprint};
}

module.exports={eventEnvelopeSchema,validateIntegrationEvent};
