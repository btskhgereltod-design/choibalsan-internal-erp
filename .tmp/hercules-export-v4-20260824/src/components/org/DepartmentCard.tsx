import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Building2, Archive, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { Department } from "@/lib/services/departments.ts";

type DepartmentCardProps = {
  department: Department;
  subCount?: number;
  onClick?: () => void;
  compact?: boolean;
};

export function DepartmentCard({ department, subCount, onClick, compact = false }: DepartmentCardProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as "mn" | "en";
  const navigate = useNavigate();

  const handleClick = onClick ?? (() => navigate(`/app/departments/${department.id}`));
  const isArchived = !department.isActive;

  if (compact) {
    return (
      <button
        onClick={handleClick}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left hover:bg-accent transition-colors cursor-pointer",
          isArchived && "opacity-60",
        )}
      >
        <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm flex-1 truncate">{department.name[lang]}</span>
        <span className="text-xs font-mono text-muted-foreground shrink-0">{department.code}</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 space-y-3 transition-shadow hover:shadow-md cursor-pointer",
        isArchived && "opacity-70",
      )}
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
            isArchived ? "bg-muted" : "bg-primary/10",
          )}>
            {isArchived
              ? <Archive className="w-4 h-4 text-muted-foreground" />
              : <Building2 className="w-4 h-4 text-primary" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{department.name[lang]}</p>
            <p className="text-xs text-muted-foreground font-mono">{department.code}</p>
          </div>
        </div>
        <Badge variant={isArchived ? "secondary" : "default"} className="shrink-0 text-xs">
          {isArchived ? t("common.status.archived") : t("common.status.active")}
        </Badge>
      </div>

      {subCount !== undefined && (
        <p className="text-xs text-muted-foreground">
          {subCount} {t("department.subDepartments").toLowerCase()}
        </p>
      )}
    </div>
  );
}
