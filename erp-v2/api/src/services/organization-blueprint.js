"use strict";

function selectBlueprintCatalog(catalog, profile) {
  const selected = catalog.filter(item => {
    if (item.min_employees > profile.employeeCount) return false;
    const sectorMatch = item.sectors.includes("all") || item.sectors.includes(profile.sector);
    const signalMatch = item.signals.some(signal => profile.needs.includes(signal));
    if (item.category === "Суурь") return item.code !== "core-people" || profile.employeeCount >= 5 || profile.needs.includes("hr");
    if (item.category === "Салбар") return sectorMatch;
    return sectorMatch && (signalMatch || (item.code === "technology" && profile.employeeCount >= 20));
  });
  if (!selected.some(item => item.code === "core-governance")) {
    selected.unshift(catalog.find(item => item.code === "core-governance"));
  }
  return selected.filter(Boolean);
}

module.exports = { selectBlueprintCatalog };

