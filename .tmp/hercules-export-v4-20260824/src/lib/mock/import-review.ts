// Fictional in-memory fixture data for Import Review & Validation prototype.
// No real personal data. No production backend or database writes.

export type ImportBucket = "create" | "update" | "skip" | "needs_review" | "reject";
export type RecordType = "department" | "position";

export type FieldChange = {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
};

export type ImportRow = {
  id: string;
  rowNumber: number;
  type: RecordType;
  businessKey: string;
  name: string;
  parentUnit: string | null;
  bucket: ImportBucket;
  issue: string | null;
  changes: FieldChange[];
  // for inline editing
  editableFields?: Record<string, string>;
  excluded?: boolean;
  exclusionReason?: string;
};

export const INITIAL_ROWS: ImportRow[] = [
  // ── CREATE ──
  {
    id: "r1",
    rowNumber: 2,
    type: "department",
    businessKey: "DEPT-FIN-01",
    name: "Санхүүгийн газар",
    parentUnit: "DEPT-ROOT-01",
    bucket: "create",
    issue: null,
    changes: [],
  },
  {
    id: "r2",
    rowNumber: 3,
    type: "department",
    businessKey: "DEPT-HR-01",
    name: "Хүний нөөцийн газар",
    parentUnit: "DEPT-ROOT-01",
    bucket: "create",
    issue: null,
    changes: [],
  },
  {
    id: "r3",
    rowNumber: 7,
    type: "position",
    businessKey: "POS-FIN-MGR",
    name: "Санхүүгийн менежер",
    parentUnit: "DEPT-FIN-01",
    bucket: "create",
    issue: null,
    changes: [],
  },
  {
    id: "r4",
    rowNumber: 8,
    type: "position",
    businessKey: "POS-HR-SPEC",
    name: "Хүний нөөцийн мэргэжилтэн",
    parentUnit: "DEPT-HR-01",
    bucket: "create",
    issue: null,
    changes: [],
  },
  // ── UPDATE ──
  {
    id: "r5",
    rowNumber: 4,
    type: "department",
    businessKey: "DEPT-IT-01",
    name: "Мэдээллийн технологийн газар",
    parentUnit: "DEPT-ROOT-01",
    bucket: "update",
    issue: null,
    changes: [
      {
        field: "department_name",
        label: "Нэр",
        oldValue: "МТ-ийн газар",
        newValue: "Мэдээллийн технологийн газар",
      },
      {
        field: "parent_department_code",
        label: "Харьяалах нэгж",
        oldValue: "DEPT-ADMIN-01",
        newValue: "DEPT-ROOT-01",
      },
    ],
  },
  {
    id: "r6",
    rowNumber: 9,
    type: "position",
    businessKey: "POS-IT-LEAD",
    name: "МТ-ийн ахлах мэргэжилтэн",
    parentUnit: "DEPT-IT-01",
    bucket: "update",
    issue: null,
    changes: [
      {
        field: "position_title",
        label: "Албан тушаал",
        oldValue: "МТ-ийн мэргэжилтэн",
        newValue: "МТ-ийн ахлах мэргэжилтэн",
      },
    ],
  },
  // ── SKIP ──
  {
    id: "r7",
    rowNumber: 5,
    type: "department",
    businessKey: "DEPT-LEGAL-01",
    name: "Хууль эрх зүйн хэлтэс",
    parentUnit: "DEPT-ROOT-01",
    bucket: "skip",
    issue: "Мэдээлэл өөрчлөгдөөгүй. Системд таарч байна.",
    changes: [],
  },
  {
    id: "r8",
    rowNumber: 10,
    type: "position",
    businessKey: "POS-LEGAL-ADV",
    name: "Хуулийн зөвлөх",
    parentUnit: "DEPT-LEGAL-01",
    bucket: "skip",
    issue: "Системтэй яг таарч байгаа тул алгасана.",
    changes: [],
  },
  // ── NEEDS REVIEW ──
  {
    id: "r9",
    rowNumber: 6,
    type: "department",
    businessKey: "DEPT-AUDIT-02",
    name: "Дотоод аудитын хэлтэс",
    parentUnit: "DEPT-ROOT-01",
    bucket: "needs_review",
    issue:
      'Системд "DEPT-AUDIT-01" кодтой, нэр адилхан нэгж байна. Давхардал эсвэл шинэ бүртгэл мөн эсэхийг шалгана уу.',
    changes: [],
    editableFields: {
      department_code: "DEPT-AUDIT-02",
      department_name: "Дотоод аудитын хэлтэс",
      parent_department_code: "DEPT-ROOT-01",
    },
  },
  {
    id: "r10",
    rowNumber: 11,
    type: "position",
    businessKey: "POS-AUDIT-SR",
    name: "Ахлах аудитор",
    parentUnit: "DEPT-AUDIT-02",
    bucket: "needs_review",
    issue:
      '"DEPT-AUDIT-02" нэгж шинэ бүртгэл эсэхийг тодруулаагүй байна. Нэгжийн код баталгаажсаны дараа энэ мөрийг шийдвэрлэнэ.',
    changes: [],
    editableFields: {
      position_code: "POS-AUDIT-SR",
      position_title: "Ахлах аудитор",
      department_code: "DEPT-AUDIT-02",
    },
  },
  // ── REJECT ──
  {
    id: "r11",
    rowNumber: 12,
    type: "department",
    businessKey: "",
    name: "Стратегийн төлөвлөлтийн нэгж",
    parentUnit: "DEPT-ROOT-99",
    bucket: "reject",
    issue:
      'department_code талбар хоосон байна. parent_department_code "DEPT-ROOT-99" систем болон файлд олдсонгүй.',
    changes: [],
    editableFields: {
      department_code: "",
      department_name: "Стратегийн төлөвлөлтийн нэгж",
      parent_department_code: "DEPT-ROOT-99",
    },
  },
  {
    id: "r12",
    rowNumber: 13,
    type: "position",
    businessKey: "POS-STRAT-01",
    name: "",
    parentUnit: "DEPT-ROOT-99",
    bucket: "reject",
    issue:
      'position_title талбар хоосон байна. parent_department_code "DEPT-ROOT-99" олдсонгүй.',
    changes: [],
    editableFields: {
      position_code: "POS-STRAT-01",
      position_title: "",
      department_code: "DEPT-ROOT-99",
    },
  },
];

export const BUCKET_META: Record<
  ImportBucket,
  { labelMn: string; labelEn: string; color: string; bg: string; border: string; dot: string }
> = {
  create: {
    labelMn: "Үүсгэх",
    labelEn: "Create",
    color: "text-emerald-700 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
    dot: "bg-emerald-500",
  },
  update: {
    labelMn: "Шинэчлэх",
    labelEn: "Update",
    color: "text-blue-700 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    dot: "bg-blue-500",
  },
  skip: {
    labelMn: "Алгасах",
    labelEn: "Skip",
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-900/30",
    border: "border-slate-200 dark:border-slate-700",
    dot: "bg-slate-400",
  },
  needs_review: {
    labelMn: "Хянах шаардлагатай",
    labelEn: "Needs Review",
    color: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    dot: "bg-amber-500",
  },
  reject: {
    labelMn: "Татгалзсан",
    labelEn: "Reject",
    color: "text-red-700 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
    dot: "bg-red-500",
  },
};

export const RECORD_TYPE_META: Record<RecordType, { labelMn: string; icon: string }> = {
  department: { labelMn: "Нэгж", icon: "🏢" },
  position: { labelMn: "Албан тушаал", icon: "💼" },
};
