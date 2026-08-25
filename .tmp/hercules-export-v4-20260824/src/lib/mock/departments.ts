// Mock department data — mirrors the future OVERVA API response shape.
// Replace this file's contents with real OVERVA API calls when integrating.

export type LocalizedString = {
  mn: string;
  en: string;
};

export type Department = {
  id: string;
  tenantId: string;
  externalId: string | null; // OVERVA backend ID — null until synced
  code: string;
  name: LocalizedString;
  parentDepartmentId: string | null;
  managerId: string | null;
  isActive: boolean;
  archivedAt: string | null;
  entityVersion: number;
  createdAt: string;
  updatedAt: string;
};

const TENANT_ID = "tenant_overva_demo";

export const mockDepartments: Department[] = [
  {
    id: "dept_001",
    tenantId: TENANT_ID,
    externalId: null,
    code: "EXEC",
    name: { mn: "Гүйцэтгэх удирдлага", en: "Executive Management" },
    parentDepartmentId: null,
    managerId: null,
    isActive: true,
    archivedAt: null,
    entityVersion: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "dept_002",
    tenantId: TENANT_ID,
    externalId: null,
    code: "FIN",
    name: { mn: "Санхүүгийн хэлтэс", en: "Finance Department" },
    parentDepartmentId: "dept_001",
    managerId: null,
    isActive: true,
    archivedAt: null,
    entityVersion: 1,
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
  {
    id: "dept_003",
    tenantId: TENANT_ID,
    externalId: null,
    code: "HR",
    name: { mn: "Хүний нөөцийн хэлтэс", en: "Human Resources" },
    parentDepartmentId: "dept_001",
    managerId: null,
    isActive: true,
    archivedAt: null,
    entityVersion: 1,
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
  {
    id: "dept_004",
    tenantId: TENANT_ID,
    externalId: null,
    code: "IT",
    name: { mn: "Мэдээллийн технологийн хэлтэс", en: "Information Technology" },
    parentDepartmentId: "dept_001",
    managerId: null,
    isActive: true,
    archivedAt: null,
    entityVersion: 1,
    createdAt: "2024-01-03T00:00:00Z",
    updatedAt: "2024-01-03T00:00:00Z",
  },
  {
    id: "dept_005",
    tenantId: TENANT_ID,
    externalId: null,
    code: "IT-DEV",
    name: { mn: "Програм хангамж хөгжүүлэлт", en: "Software Development" },
    parentDepartmentId: "dept_004",
    managerId: null,
    isActive: true,
    archivedAt: null,
    entityVersion: 1,
    createdAt: "2024-01-04T00:00:00Z",
    updatedAt: "2024-01-04T00:00:00Z",
  },
  {
    id: "dept_006",
    tenantId: TENANT_ID,
    externalId: null,
    code: "IT-OPS",
    name: { mn: "Системийн дэмжлэг", en: "IT Operations" },
    parentDepartmentId: "dept_004",
    managerId: null,
    isActive: true,
    archivedAt: null,
    entityVersion: 1,
    createdAt: "2024-01-04T00:00:00Z",
    updatedAt: "2024-01-04T00:00:00Z",
  },
  {
    id: "dept_007",
    tenantId: TENANT_ID,
    externalId: null,
    code: "FIN-ACC",
    name: { mn: "Нягтлан бодох бүртгэл", en: "Accounting" },
    parentDepartmentId: "dept_002",
    managerId: null,
    isActive: true,
    archivedAt: null,
    entityVersion: 1,
    createdAt: "2024-01-05T00:00:00Z",
    updatedAt: "2024-01-05T00:00:00Z",
  },
  {
    id: "dept_008",
    tenantId: TENANT_ID,
    externalId: null,
    code: "OPS-OLD",
    name: { mn: "Хуучин үйл ажиллагааны хэлтэс", en: "Legacy Operations" },
    parentDepartmentId: null,
    managerId: null,
    isActive: false,
    archivedAt: "2024-06-01T00:00:00Z",
    entityVersion: 2,
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2024-06-01T00:00:00Z",
  },
];
