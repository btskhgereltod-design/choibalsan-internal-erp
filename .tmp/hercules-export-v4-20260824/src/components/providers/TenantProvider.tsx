import React, { createContext, useContext } from "react";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  locale: "mn" | "en";
};

// Mock tenant — replace with real tenant resolution (from auth token or OVERVA API) when integrating.
const MOCK_TENANT: Tenant = {
  id: "tenant_overva_demo",
  name: "OVERVA Demo",
  slug: "overva-demo",
  locale: "mn",
};

const TenantContext = createContext<Tenant | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  return <TenantContext.Provider value={MOCK_TENANT}>{children}</TenantContext.Provider>;
}

export function useTenant(): Tenant {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within TenantProvider");
  return ctx;
}
