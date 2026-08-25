import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Building2, FolderOpen, Archive, Plus } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { AppLayout } from "@/components/org/AppLayout.tsx";
import { useTenant } from "@/components/providers/TenantProvider.tsx";
import { listDepartments, type Department } from "@/lib/services/departments.ts";

export default function OrgDashboard() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

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

  const active = departments.filter((d) => d.isActive);
  const archived = departments.filter((d) => !d.isActive);
  const roots = active.filter((d) => d.parentDepartmentId === null);

  const stats = [
    {
      label: t("org.activeDepartments"),
      value: active.length,
      icon: Building2,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: t("org.rootDepartments"),
      value: roots.length,
      icon: FolderOpen,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-100 dark:bg-blue-900/30",
    },
    {
      label: t("org.archivedDepartments"),
      value: archived.length,
      icon: Archive,
      color: "text-muted-foreground",
      bg: "bg-muted",
    },
  ];

  return (
    <AppLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("org.title")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{tenant.name}</p>
          </div>
          <Button onClick={() => navigate("/app/departments/new")} className="shrink-0">
            <Plus className="w-4 h-4 mr-2" />
            {t("department.createNew")}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))
            : stats.map((stat) => (
                <Card key={stat.label}>
                  <CardContent className="flex items-center gap-4 pt-6">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${stat.bg}`}>
                      <stat.icon className={`w-5 h-5 ${stat.color}`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>

        {/* Quick link to departments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("department.plural")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="secondary" onClick={() => navigate("/app/departments")}>
              <Building2 className="w-4 h-4 mr-2" />
              {t("department.tree")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
