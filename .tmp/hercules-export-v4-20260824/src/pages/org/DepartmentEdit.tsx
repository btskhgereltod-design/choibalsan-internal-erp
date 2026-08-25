import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { AppLayout } from "@/components/org/AppLayout.tsx";
import { DepartmentForm, type DepartmentFormValues } from "@/components/org/DepartmentForm.tsx";
import { useTenant } from "@/components/providers/TenantProvider.tsx";
import {
  getDepartment,
  listDepartments,
  updateDepartment,
  type Department,
} from "@/lib/services/departments.ts";

export default function DepartmentEdit() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const tenant = useTenant();
  const navigate = useNavigate();

  const [dept, setDept] = useState<Department | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([getDepartment(tenant.id, id), listDepartments(tenant.id)]).then(
      ([deptResult, listResult]) => {
        if (cancelled) return;
        if (deptResult.ok) setDept(deptResult.data);
        if (listResult.ok) setDepartments(listResult.data);
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, [tenant.id, id]);

  const handleSubmit = async (values: DepartmentFormValues) => {
    if (!dept) return;
    setSubmitting(true);
    const result = await updateDepartment({
      tenantId: tenant.id,
      id: dept.id,
      entityVersion: dept.entityVersion,
      name: { mn: values.nameMn, en: values.nameEn },
      code: values.code,
      parentDepartmentId: values.parentDepartmentId,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success(t("department.updateSuccess"));
      navigate(`/app/departments/${result.data.id}`);
    } else {
      toast.error(result.error.message);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6 max-w-lg mx-auto space-y-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!dept) {
    return (
      <AppLayout>
        <div className="p-6 max-w-lg mx-auto">
          <p className="text-muted-foreground">{t("department.notFound")}</p>
          <Button variant="ghost" className="mt-4" onClick={() => navigate("/app/departments")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("common.back")}
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-lg mx-auto space-y-5">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/app/departments/${dept.id}`)}
          className="-ml-2"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t("common.back")}
        </Button>

        <h1 className="text-xl font-bold">{t("department.editTitle")}</h1>

        <div className="rounded-xl border bg-card p-5">
          <DepartmentForm
            departments={departments}
            currentId={dept.id}
            defaultValues={{
              nameMn: dept.name.mn,
              nameEn: dept.name.en,
              code: dept.code,
              parentDepartmentId: dept.parentDepartmentId,
            }}
            onSubmit={handleSubmit}
            onCancel={() => navigate(`/app/departments/${dept.id}`)}
            isSubmitting={submitting}
          />
        </div>
      </div>
    </AppLayout>
  );
}
