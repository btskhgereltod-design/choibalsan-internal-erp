import { ArrowRight } from "lucide-react";
import type { FieldChange } from "@/lib/mock/import-review.ts";

export function ChangeList({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="space-y-1">
      {changes.map((c) => (
        <div key={c.field} className="flex items-center gap-1 text-xs flex-wrap">
          <span className="text-muted-foreground shrink-0">{c.label}:</span>
          <span className="line-through text-muted-foreground/70 max-w-[100px] truncate" title={c.oldValue}>
            {c.oldValue}
          </span>
          <ArrowRight className="w-3 h-3 text-blue-500 shrink-0" />
          <span className="font-medium text-blue-700 dark:text-blue-300 max-w-[100px] truncate" title={c.newValue}>
            {c.newValue}
          </span>
        </div>
      ))}
    </div>
  );
}
