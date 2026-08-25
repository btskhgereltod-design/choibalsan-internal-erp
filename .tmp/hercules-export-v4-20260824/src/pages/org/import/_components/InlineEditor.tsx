import { useState } from "react";
import { CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import type { ImportRow } from "@/lib/mock/import-review.ts";

type Props = {
  row: ImportRow;
  onRevalidate: (id: string, fields: Record<string, string>) => void;
  onExclude: (id: string, reason: string) => void;
  onCancel: () => void;
};

const FIELD_LABELS: Record<string, string> = {
  department_code: "Нэгжийн код",
  department_name: "Нэгжийн нэр",
  parent_department_code: "Харьяалах нэгжийн код",
  position_code: "Албан тушаалын код",
  position_title: "Албан тушаалын нэр",
};

export function InlineEditor({ row, onRevalidate, onExclude, onCancel }: Props) {
  const [fields, setFields] = useState<Record<string, string>>(row.editableFields ?? {});
  const [exclusionReason, setExclusionReason] = useState(row.exclusionReason ?? "");
  const [showExclude, setShowExclude] = useState(false);
  const [reasonError, setReasonError] = useState(false);

  const handleExclude = () => {
    if (row.bucket === "needs_review" && !exclusionReason.trim()) {
      setReasonError(true);
      return;
    }
    onExclude(row.id, exclusionReason.trim());
  };

  return (
    <div className="mt-3 rounded-lg border border-dashed bg-muted/30 p-4 space-y-4">
      {/* Editable fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(fields).map(([key, val]) => (
          <div key={key} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{FIELD_LABELS[key] ?? key}</Label>
            <Input
              value={val}
              onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>
        ))}
      </div>

      {/* Exclude section */}
      {showExclude && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Хасах шалтгаан{row.bucket === "needs_review" ? " *" : ""}
          </Label>
          <Textarea
            value={exclusionReason}
            onChange={(e) => {
              setExclusionReason(e.target.value);
              setReasonError(false);
            }}
            placeholder="Энэ мөрийг яагаад хасаж байгааг бичнэ үү..."
            rows={2}
            className={`text-sm resize-none ${reasonError ? "border-red-500" : ""}`}
          />
          {reasonError && (
            <p className="text-xs text-red-600">Хасах шалтгааныг заавал бичнэ үү.</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={() => onRevalidate(row.id, fields)}
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          Дахин шалгах
        </Button>

        {!showExclude ? (
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
            onClick={() => setShowExclude(true)}
          >
            <XCircle className="w-3 h-3 mr-1" />
            Хасах
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-7 text-xs bg-red-600 hover:bg-red-700 text-white"
            onClick={handleExclude}
          >
            <XCircle className="w-3 h-3 mr-1" />
            Хасахыг баталгаажуулах
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground"
          onClick={onCancel}
        >
          Болих
        </Button>
      </div>
    </div>
  );
}
