import { cn } from "@/lib/utils.ts";
import { type ImportBucket, BUCKET_META } from "@/lib/mock/import-review.ts";

type Props = {
  bucket: ImportBucket;
  count: number;
  active: boolean;
  onClick: () => void;
};

export function BucketSummaryCard({ bucket, count, active, onClick }: Props) {
  const meta = BUCKET_META[bucket];
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-4 text-left transition-all cursor-pointer",
        active
          ? `${meta.bg} ${meta.border} ring-2 ring-offset-1 ring-current ${meta.color}`
          : "bg-card border-border hover:bg-accent/50",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("w-2 h-2 rounded-full shrink-0", meta.dot)} />
        <span className={cn("text-xs font-medium", active ? meta.color : "text-muted-foreground")}>
          {meta.labelEn}
        </span>
      </div>
      <p className={cn("text-2xl font-bold", active ? meta.color : "text-foreground")}>{count}</p>
      <p className={cn("text-xs", active ? meta.color : "text-muted-foreground")}>{meta.labelMn}</p>
    </button>
  );
}
