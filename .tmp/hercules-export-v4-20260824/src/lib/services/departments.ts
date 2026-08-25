// Department service interface.
// This is the single swap point: replace the mock implementations below
// with calls to the OVERVA Command/Query API when integrating.
//
// Contract:
// - Every write carries tenantId, requestId (idempotency), and entityVersion (optimistic concurrency).
// - No destructive deletes — use archive semantics only.
// - This layer does NOT write to Convex. Convex is not authoritative for org data.

import { v4 as uuidv4 } from "uuid";
import { mockDepartments, type Department, type LocalizedString } from "../mock/departments.ts";

// --- Types ---

export type { Department, LocalizedString };

export type DepartmentCreateInput = {
  tenantId: string;
  name: LocalizedString;
  code: string;
  parentDepartmentId: string | null;
  managerId: string | null;
};

export type DepartmentUpdateInput = {
  tenantId: string;
  id: string;
  entityVersion: number; // Optimistic concurrency — must match current version
  name?: LocalizedString;
  code?: string;
  parentDepartmentId?: string | null;
  managerId?: string | null;
};

export type DepartmentArchiveInput = {
  tenantId: string;
  id: string;
  entityVersion: number;
};

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ServiceError };

export type ServiceError = {
  code: "NOT_FOUND" | "CONFLICT" | "PERMISSION" | "VALIDATION" | "UNAVAILABLE" | "UNKNOWN";
  message: string;
  field?: string; // For validation errors
};

// In-memory store for mock writes (resets on page reload — intentional for prototype)
let store: Department[] = [...mockDepartments];

function generateRequestId(): string {
  return uuidv4();
}

// --- Query operations (will call OVERVA read API) ---

export async function listDepartments(tenantId: string): Promise<ServiceResult<Department[]>> {
  // OVERVA integration point: GET /api/v1/tenants/:tenantId/departments
  await simulateDelay();
  const departments = store.filter((d) => d.tenantId === tenantId);
  return { ok: true, data: departments };
}

export async function getDepartment(
  tenantId: string,
  id: string,
): Promise<ServiceResult<Department>> {
  // OVERVA integration point: GET /api/v1/tenants/:tenantId/departments/:id
  await simulateDelay();
  const dept = store.find((d) => d.id === id && d.tenantId === tenantId);
  if (!dept) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Department not found" } };
  }
  return { ok: true, data: dept };
}

export async function getChildDepartments(
  tenantId: string,
  parentId: string,
): Promise<ServiceResult<Department[]>> {
  // OVERVA integration point: GET /api/v1/tenants/:tenantId/departments?parentId=:parentId
  await simulateDelay();
  const children = store.filter(
    (d) => d.tenantId === tenantId && d.parentDepartmentId === parentId,
  );
  return { ok: true, data: children };
}

// --- Command operations (will call OVERVA command API) ---

export async function createDepartment(
  input: DepartmentCreateInput,
): Promise<ServiceResult<Department>> {
  // OVERVA integration point: POST /api/v1/tenants/:tenantId/departments
  // Real flow: send requestId + payload → OVERVA validates + commits → return created entity
  const requestId = generateRequestId();
  void requestId; // Will be sent as header/body field in real integration

  await simulateDelay();

  const codeConflict = store.find(
    (d) => d.tenantId === input.tenantId && d.code === input.code && d.isActive,
  );
  if (codeConflict) {
    return {
      ok: false,
      error: { code: "CONFLICT", message: "A department with this code already exists", field: "code" },
    };
  }

  const now = new Date().toISOString();
  const newDept: Department = {
    id: `dept_${Date.now()}`,
    tenantId: input.tenantId,
    externalId: null,
    code: input.code,
    name: input.name,
    parentDepartmentId: input.parentDepartmentId,
    managerId: input.managerId,
    isActive: true,
    archivedAt: null,
    entityVersion: 1,
    createdAt: now,
    updatedAt: now,
  };

  store = [...store, newDept];
  return { ok: true, data: newDept };
}

export async function updateDepartment(
  input: DepartmentUpdateInput,
): Promise<ServiceResult<Department>> {
  // OVERVA integration point: PATCH /api/v1/tenants/:tenantId/departments/:id
  // Real flow: send requestId + entityVersion + payload → OVERVA checks concurrency + commits
  const requestId = generateRequestId();
  void requestId;

  await simulateDelay();

  const idx = store.findIndex((d) => d.id === input.id && d.tenantId === input.tenantId);
  if (idx === -1) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Department not found" } };
  }

  const current = store[idx];
  if (current.entityVersion !== input.entityVersion) {
    return {
      ok: false,
      error: { code: "CONFLICT", message: "Department was modified by another user. Please refresh and retry." },
    };
  }

  if (input.code && input.code !== current.code) {
    const codeConflict = store.find(
      (d) => d.tenantId === input.tenantId && d.code === input.code && d.isActive && d.id !== input.id,
    );
    if (codeConflict) {
      return {
        ok: false,
        error: { code: "CONFLICT", message: "A department with this code already exists", field: "code" },
      };
    }
  }

  const updated: Department = {
    ...current,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.code !== undefined && { code: input.code }),
    ...(input.parentDepartmentId !== undefined && { parentDepartmentId: input.parentDepartmentId }),
    ...(input.managerId !== undefined && { managerId: input.managerId }),
    entityVersion: current.entityVersion + 1,
    updatedAt: new Date().toISOString(),
  };

  store = store.map((d) => (d.id === input.id ? updated : d));
  return { ok: true, data: updated };
}

export async function archiveDepartment(
  input: DepartmentArchiveInput,
): Promise<ServiceResult<Department>> {
  // OVERVA integration point: POST /api/v1/tenants/:tenantId/departments/:id/archive
  // Archive — never destructive delete.
  const requestId = generateRequestId();
  void requestId;

  await simulateDelay();

  const idx = store.findIndex((d) => d.id === input.id && d.tenantId === input.tenantId);
  if (idx === -1) {
    return { ok: false, error: { code: "NOT_FOUND", message: "Department not found" } };
  }

  const current = store[idx];
  if (current.entityVersion !== input.entityVersion) {
    return {
      ok: false,
      error: { code: "CONFLICT", message: "Department was modified by another user. Please refresh and retry." },
    };
  }

  const archived: Department = {
    ...current,
    isActive: false,
    archivedAt: new Date().toISOString(),
    entityVersion: current.entityVersion + 1,
    updatedAt: new Date().toISOString(),
  };

  store = store.map((d) => (d.id === input.id ? archived : d));
  return { ok: true, data: archived };
}

// --- Utility ---

// Simulates realistic async latency for mock mode.
// Remove in real integration — actual network latency will be real.
async function simulateDelay(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}
