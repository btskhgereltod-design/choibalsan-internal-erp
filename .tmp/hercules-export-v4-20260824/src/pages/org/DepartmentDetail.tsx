import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Archive, Building2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { AppLayout } from "@/components/org/AppLayout.tsx";
import { DepartmentCard } from "@/components/org/DepartmentCard.tsx";
import { ArchiveDialog } from "@/components/org/ArchiveDialog.tsx";
import { useTenant } from "@/components/providers/TenantProvider.tsx";
import {
  getDepartment,
  listDepartments,
  archiveDepartment,
  type Department,
} from "@/lib/services/departments.ts";

export default function DepartmentDetail() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as "mn" | "en";
  const { id } = useParams<{ id: string }>();
  const tenant = useTenant();
  const navigate = useNavigate();

  const [dept, setDept] = useState<Department | null>(null);
  const [allDepts, setAllDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([getDepartment(tenant.id, id), listDepartments(tenant.id)]).then(
      ([deptResult, listResult]) => {
        if (cancelled) return;
        if (deptResult.ok) setDept(deptResult.data);
        if (listResult.ok) setAllDepts(listResult.data);
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, [tenant.id, id]);

  const parentDept = dept?.parentDepartmentId
    ? allDepts.find((d) => d.id === dept.parentDepartmentId)
    : null;

  const children = allDepts.filter((d) => d.parentDepartmentId === id && d.isActive);

  const handleArchive = async () => {
    if (!dept) return;
    setArchiving(true);
    const result = await archiveDepartment({
      tenantId: tenant.id,
      id: dept.id,
      entityVersion: dept.entityVersion,
    });
    setArchiving(false);
    if (result.ok) {
      toast.success(t("department.archiveSuccess"));
      setDept(result.data);
      setArchiveOpen(false);
    } else {
      toast.error(result.error.message);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6 max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!dept) {
    return (
      <AppLayout>
        <div className="p-6 max-w-2xl mx-auto">
          <p className="text-muted-foreground">{t("department.notFound")}</p>
          <Button variant="ghost" className="mt-4" onClick={() => navigate("/app/departments")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("common.back")}
          </Button>
        </div>
      </AppLayout>
    );
  }

  const isArchived = !dept.isActive;

  return (
    <AppLayout>
      <div className="p-6 max-w-2xl mx-auto space-y-5">
        {/* Back */}
        <Button variant="ghost" size="sm" onClick={() => navigate("/app/departments")} className="-ml-2">
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t("common.back")}
        </Button>

        {/* Header card */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isArchived ? "bg-muted" : "bg-primary/10"}`}>
                {isArchived
                  ? <Archive className="w-5 h-5 text-muted-foreground" />
                  : <Building2 className="w-5 h-5 text-primary" />}
              </div>
              <div>
                <h1 className="text-lg font-bold">{dept.name[lang]}</h1>
                <p className="text-xs font-mono text-muted-foreground">{dept.code}</p>
              </div>
            </div>
            <Badge variant={isArchived ? "secondary" : "default"}>
              {isArchived ? t("common.status.archived") : t("common.status.active")}
            </Badge>
          </div>

          {/* Both language names */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">MN</p>
              <p>{dept.name.mn}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">EN</p>
              <p>{dept.name.en}</p>
            </div>
          </div>

          {/* Parent breadcrumb */}
          {parentDept && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <span
                className="hover:underline cursor-pointer"
                onClick={() => navigate(`/app/departments/${parentDept.id}`)}
              >
                {parentDept.name[lang]}
              </span>
              <ChevronRight className="w-3 h-3" />
              <span className="text-foreground font-medium">{dept.name[lang]}</span>
            </div>
          )}

          {/* Actions */}
          {!isArchived && (
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/app/departments/${dept.id}/edit`)}
              >
                <Pencil className="w-3 h-3 mr-1.5" />
                {t("common.edit")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setArchiveOpen(true)}
                className="text-destructive hover:text-destructive"
              >
                <Archive className="w-3 h-3 mr-1.5" />
                {t("common.archive")}
              </Button>
            </div>
          )}
        </div>

        {/* Sub-departments */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t("department.subDepartments")} ({children.length})
          </h2>
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1">{t("department.noSubDepartments")}</p>
          ) : (
            <div className="space-y-2">
              {children.map((child) => (
                <DepartmentCard key={child.id} department={child} compact />
              ))}
            </div>
          )}
        </div>
      </div>

      <ArchiveDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        onConfirm={handleArchive}
        isSubmitting={archiving}
        entityName={dept.name[lang]}
      />
    </AppLayout>
  );
}
