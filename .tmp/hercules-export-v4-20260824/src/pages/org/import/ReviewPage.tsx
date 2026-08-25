import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Download,
  ChevronRight,
  FileCheck2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { AppLayout } from "@/components/org/AppLayout.tsx";
import { cn } from "@/lib/utils.ts";
import {
  INITIAL_ROWS,
  BUCKET_META,
  type ImportBucket,
  type ImportRow,
} from "@/lib/mock/import-review.ts";
import { BucketSummaryCard } from "./_components/BucketSummaryCard.tsx";
import { ReviewTableRow } from "./_components/ReviewTableRow.tsx";
import { toast } from "sonner";

const ALL_BUCKETS: ImportBucket[] = ["create", "update", "skip", "needs_review", "reject"];

// Simulate a single-row revalidation: if required fields are now filled, promote to create/update;
// otherwise keep as reject. This is purely cosmetic UX logic, no real backend.
function revalidateRow(
  row: ImportRow,
  fields: Record<string, string>,
): ImportRow {
  const updated = { ...row, editableFields: { ...fields } };
  const hasRequiredKeys =
    row.type === "department"
      ? fields["department_code"]?.trim() && fields["department_name"]?.trim()
      : fields["position_code"]?.trim() &&
        fields["position_title"]?.trim() &&
        fields["department_code"]?.trim();

  if (!hasRequiredKeys) {
    return {
      ...updated,
      bucket: "reject",
      issue: "Заавал шаардлагатай талбарууд дутуу байна. Утгуудыг шалгана уу.",
    };
  }

  const newBusinessKey =
    row.type === "department"
      ? fields["department_code"]?.trim() ?? row.businessKey
      : fields["position_code"]?.trim() ?? row.businessKey;

  return {
    ...updated,
    businessKey: newBusinessKey,
    name:
      row.type === "department"
        ? fields["department_name"]?.trim() ?? row.name
        : fields["position_title"]?.trim() ?? row.name,
    parentUnit:
      row.type === "department"
        ? fields["parent_department_code"]?.trim() ?? row.parentUnit
        : fields["department_code"]?.trim() ?? row.parentUnit,
    bucket: "create",
    issue: null,
  };
}

export default function ImportReviewPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ImportRow[]>(INITIAL_ROWS);
  const [activeFilter, setActiveFilter] = useState<ImportBucket | "all">("all");
  const [revalidating, setRevalidating] = useState(false);

  const counts = useMemo(() => {
    const c: Record<ImportBucket, number> = {
      create: 0,
      update: 0,
      skip: 0,
      needs_review: 0,
      reject: 0,
    };
    for (const r of rows) {
      if (!r.excluded) c[r.bucket]++;
    }
    return c;
  }, [rows]);

  const unresolvedNeedsReview = useMemo(
    () => rows.filter((r) => r.bucket === "needs_review" && !r.excluded).length,
    [rows],
  );

  const filteredRows = useMemo(() => {
    if (activeFilter === "all") return rows;
    return rows.filter((r) => r.bucket === activeFilter);
  }, [rows, activeFilter]);

  const hasIssues =
    counts.needs_review > 0 || counts.reject > 0;

  const handleRevalidate = (id: string, fields: Record<string, string>) => {
    setRevalidating(true);
    // Simulate async revalidation delay
    setTimeout(() => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? revalidateRow(r, fields) : r)),
      );
      setRevalidating(false);
      toast.success("Мөр дахин шалгагдлаа.");
    }, 600);
  };

  const handleExclude = (id: string, reason: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, excluded: true, exclusionReason: reason } : r,
      ),
    );
    toast.info("Мөр хасагдлаа.");
  };

  const handleBulkRevalidate = () => {
    setRevalidating(true);
    setTimeout(() => {
      setRevalidating(false);
      toast.success("Бүх мөр дахин шалгагдлаа. Өөрчлөлт илрэгдсэнгүй.");
    }, 1200);
  };

  const handleDownloadReport = () => {
    const issueRows = rows.filter(
      (r) => r.bucket === "needs_review" || r.bucket === "reject",
    );
    const header = "row_number,record_type,field,error_message,raw_value,bucket";
    const csvLines = issueRows.flatMap((r) => {
      if (!r.issue) return [];
      const bucket = BUCKET_META[r.bucket].labelEn;
      const escaped = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [
        [r.rowNumber, r.type, "—", escaped(r.issue), escaped(r.businessKey || r.name), bucket].join(","),
      ];
    });
    const csv = [header, ...csvLines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import_issue_report.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Тайлан татагдлаа.");
  };

  const handleContinue = () => {
    toast.info("Батлах шат — удахгүй нэмэгдэнэ (Milestone 5).");
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">

        {/* ── Page header ── */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <FileCheck2 className="w-4 h-4" />
            <span>Импорт</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-foreground font-medium">Шалгалт</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Импортын шалгалт</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Байгууллагын бүтэц үүсгэхийн өмнө өгөгдлөө шалгаж баталгаажуулна.
          </p>
        </div>

        {/* ── File info banner ── */}
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          <Info className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">org_structure_2024.xlsx</span>
            </span>
            <span>{rows.length} мөр илрүүлэгдлээ</span>
            <span>Баганын тохиргоо: v1.0</span>
            <span>Шалгалтын дүрмийн хувилбар: v2.3</span>
          </div>
        </div>

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {ALL_BUCKETS.map((b) => (
            <BucketSummaryCard
              key={b}
              bucket={b}
              count={counts[b]}
              active={activeFilter === b}
              onClick={() => setActiveFilter((prev) => (prev === b ? "all" : b))}
            />
          ))}
        </div>

        {/* ── Unresolved needs-review warning ── */}
        {unresolvedNeedsReview > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>{unresolvedNeedsReview} мөр</strong> шийдвэрлэгдэлгүй байна.{" "}
              Батлах шат руу үргэлжлүүлэхийн тулд бүгдийг засах эсвэл хасах шаардлагатай.
            </span>
          </div>
        )}

        {/* ── Action bar ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate("/app/import/mapping")}
              className="gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Баганын тохиргоо руу буцах
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleBulkRevalidate}
              disabled={revalidating}
              className="gap-1.5"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", revalidating && "animate-spin")} />
              Өөрчлөлтийг дахин шалгах
            </Button>

            {hasIssues && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownloadReport}
                className="gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Асуудлын тайлан татах
              </Button>
            )}
          </div>

          {/* Continue */}
          <Button
            size="sm"
            disabled={unresolvedNeedsReview > 0}
            onClick={handleContinue}
            className="gap-1.5 shrink-0"
            title={
              unresolvedNeedsReview > 0
                ? `${unresolvedNeedsReview} мөр шийдвэрлэгдэлгүй байна`
                : undefined
            }
          >
            Батлах шат руу үргэлжлүүлэх
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* ── Filter tabs ── */}
        <div className="flex flex-wrap gap-1 border-b pb-1">
          <button
            onClick={() => setActiveFilter("all")}
            className={cn(
              "px-3 py-1.5 text-sm rounded-t-md font-medium transition-colors cursor-pointer",
              activeFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            Бүгд ({rows.length})
          </button>
          {ALL_BUCKETS.map((b) => {
            const meta = BUCKET_META[b];
            const cnt = activeFilter === b
              ? rows.filter((r) => r.bucket === b).length
              : counts[b];
            return (
              <button
                key={b}
                onClick={() => setActiveFilter((prev) => (prev === b ? "all" : b))}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-t-md font-medium transition-colors cursor-pointer flex items-center gap-1.5",
                  activeFilter === b
                    ? `${meta.bg} ${meta.color} ${meta.border} border`
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
                {meta.labelMn}
                <span className={cn(
                  "text-xs rounded-full px-1.5 font-semibold",
                  activeFilter === b ? meta.bg : "bg-muted",
                )}>
                  {cnt}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Review table ── */}
        <div className="rounded-xl border bg-card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {[
                  { label: "Мөр", w: "w-12" },
                  { label: "Төрөл", w: "w-32" },
                  { label: "Бизнес түлхүүр", w: "w-36" },
                  { label: "Нэр", w: "" },
                  { label: "Харьяалах нэгж", w: "w-36" },
                  { label: "Өөрчлөлт", w: "w-48" },
                  { label: "Төлөв", w: "w-40" },
                  { label: "Асуудал", w: "w-52" },
                  { label: "Үйлдэл", w: "w-20" },
                ].map((col) => (
                  <th
                    key={col.label}
                    className={cn(
                      "px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide",
                      col.w,
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground text-sm">
                    Энэ төлөвт мөр байхгүй байна.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <ReviewTableRow
                    key={row.id}
                    row={row}
                    onRevalidate={handleRevalidate}
                    onExclude={handleExclude}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Footer counts ── */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground pb-4">
          {ALL_BUCKETS.map((b) => (
            <span key={b} className="flex items-center gap-1.5">
              <span className={cn("w-1.5 h-1.5 rounded-full", BUCKET_META[b].dot)} />
              {BUCKET_META[b].labelMn}: {counts[b]}
            </span>
          ))}
          <span>
            Нийт: {rows.filter((r) => !r.excluded).length} мөр
          </span>
        </div>
      </div>
    </AppLayout>
  );
}
