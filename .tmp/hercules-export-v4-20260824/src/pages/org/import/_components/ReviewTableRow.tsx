import { useState } from "react";
import { ChevronDown, ChevronUp, AlertCircle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { StatusBadge } from "./StatusBadge.tsx";
import { ChangeList } from "./ChangeList.tsx";
import { InlineEditor } from "./InlineEditor.tsx";
import { RECORD_TYPE_META, BUCKET_META, type ImportRow } from "@/lib/mock/import-review.ts";

type Props = {
  row: ImportRow;
  onRevalidate: (id: string, fields: Record<string, string>) => void;
  onExclude: (id: string, reason: string) => void;
};

export function ReviewTableRow({ row, onRevalidate, onExclude }: Props) {
  const [editing, setEditing] = useState(false);
  const [issueExpanded, setIssueExpanded] = useState(false);

  const typeMeta = RECORD_TYPE_META[row.type];
  const isActionable = row.bucket === "needs_review" || row.bucket === "reject";
  const bucketMeta = BUCKET_META[row.bucket];

  const rowClass = cn(
    "border-b last:border-b-0 transition-colors",
    row.excluded && "opacity-50",
    row.bucket === "needs_review" && !row.excluded && "bg-amber-50/40 dark:bg-amber-950/10",
    row.bucket === "reject" && !row.excluded && "bg-red-50/40 dark:bg-red-950/10",
  );

  return (
    <>
      <tr className={rowClass}>
        {/* Мөр */}
        <td className="px-3 py-3 text-xs text-muted-foreground font-mono w-12 shrink-0">
          {row.rowNumber}
        </td>

        {/* Төрөл */}
        <td className="px-3 py-3 w-32">
          <span className="inline-flex items-center gap-1 text-xs font-medium">
            <span>{typeMeta.icon}</span>
            <span>{typeMeta.labelMn}</span>
          </span>
        </td>

        {/* Бизнес түлхүүр */}
        <td className="px-3 py-3 w-36">
          <code className={cn(
            "text-xs font-mono rounded px-1.5 py-0.5",
            row.businessKey
              ? "bg-muted text-foreground"
              : "bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400",
          )}>
            {row.businessKey || "—"}
          </code>
        </td>

        {/* Нэр */}
        <td className="px-3 py-3 max-w-[160px]">
          <span className={cn(
            "text-sm font-medium truncate block",
            !row.name && "text-red-500 italic",
            row.excluded && "line-through text-muted-foreground",
          )}>
            {row.name || "(хоосон)"}
          </span>
          {row.excluded && (
            <span className="text-xs text-muted-foreground">
              Хасагдсан: {row.exclusionReason}
            </span>
          )}
        </td>

        {/* Харьяалах нэгж */}
        <td className="px-3 py-3 w-36">
          <code className="text-xs font-mono text-muted-foreground">
            {row.parentUnit ?? "—"}
          </code>
        </td>

        {/* Өөрчлөлт */}
        <td className="px-3 py-3 max-w-[200px]">
          <ChangeList changes={row.changes} />
        </td>

        {/* Төлөв */}
        <td className="px-3 py-3 w-40">
          <StatusBadge bucket={row.bucket} />
        </td>

        {/* Асуудал */}
        <td className="px-3 py-3 max-w-[200px]">
          {row.issue ? (
            <button
              className="flex items-start gap-1 text-left cursor-pointer"
              onClick={() => setIssueExpanded((v) => !v)}
            >
              <AlertCircle className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", bucketMeta.color)} />
              <span className={cn(
                "text-xs",
                bucketMeta.color,
                !issueExpanded && "line-clamp-2",
              )}>
                {row.issue}
              </span>
              {issueExpanded
                ? <ChevronUp className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />
                : <ChevronDown className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground" />}
            </button>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </td>

        {/* Үйлдэл */}
        <td className="px-3 py-3 w-20">
          {isActionable && !row.excluded && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing((v) => !v)}
              title="Засах"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
        </td>
      </tr>

      {/* Inline editor row */}
      {editing && isActionable && !row.excluded && (
        <tr className={cn(rowClass, "bg-muted/10")}>
          <td colSpan={9} className="px-4 pb-4">
            <InlineEditor
              row={row}
              onRevalidate={(id, fields) => {
                onRevalidate(id, fields);
                setEditing(false);
              }}
              onExclude={(id, reason) => {
                onExclude(id, reason);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}
