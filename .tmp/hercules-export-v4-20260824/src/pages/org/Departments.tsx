import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { AppLayout } from "@/components/org/AppLayout.tsx";
import { DepartmentTree } from "@/components/org/DepartmentTree.tsx";
import { useTenant } from "@/components/providers/TenantProvider.tsx";
import { listDepartments, type Department } from "@/lib/services/departments.ts";

export default function Departments() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDepartments(tenant.id).then((result) => {
      if (cancelled) return;
      if (result.ok) setDepartments(result.data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [tenant.id]);

  return (
    <AppLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold tracking-tight">{t("department.tree")}</h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="show-archived"
                checked={showArchived}
                onCheckedChange={setShowArchived}
              />
              <Label htmlFor="show-archived" className="text-sm text-muted-foreground cursor-pointer">
                {t("common.status.archived")}
              </Label>
            </div>
            <Button onClick={() => navigate("/app/departments/new")} size="sm">
              <Plus className="w-4 h-4 mr-1" />
              {t("common.create")}
            </Button>
          </div>
        </div>

        {/* Tree */}
        <div className="rounded-xl border bg-card p-3">
          {loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full rounded-md" style={{ marginLeft: `${(i % 3) * 20}px` }} />
              ))}
            </div>
          ) : (
            <DepartmentTree
              departments={departments}
              showArchived={showArchived}
            />
          )}
        </div>
      </div>
    </AppLayout>
  );
}
