"use strict";

const MATERIAL_TRANSITIONS = Object.freeze({
  requested: new Set(["approved", "rejected", "cancelled"]),
  approved: new Set(["issued", "cancelled"]),
  rejected: new Set(),
  issued: new Set(["partially_consumed", "consumed"]),
  partially_consumed: new Set(["reconciled"]),
  consumed: new Set(),
  reconciled: new Set(),
  cancelled: new Set(),
});

function canTransitionMaterial(from, to) {
  return Boolean(MATERIAL_TRANSITIONS[from]?.has(to));
}

function validateMaterialQuantities({ requested, approved = 0, issued = 0, consumed = 0, returned = 0 }) {
  const values=[requested,approved,issued,consumed,returned].map(Number);
  if(values.some(value=>!Number.isFinite(value)||value<0)||values[0]<=0)return false;
  return values[1]<=values[0]&&values[2]<=values[1]&&values[3]+values[4]<=values[2];
}

module.exports={MATERIAL_TRANSITIONS,canTransitionMaterial,validateMaterialQuantities};
