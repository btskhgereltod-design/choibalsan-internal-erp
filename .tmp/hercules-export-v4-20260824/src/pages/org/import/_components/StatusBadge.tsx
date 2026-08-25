import { cn } from "@/lib/utils.ts";
import { type ImportBucket, BUCKET_META } from "@/lib/mock/import-review.ts";

export function StatusBadge({ bucket }: { bucket: ImportBucket }) {
  const meta = BUCKET_META[bucket];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border",
        meta.bg,
        meta.color,
        meta.border,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
      {meta.labelMn}
    </span>
  );
}
