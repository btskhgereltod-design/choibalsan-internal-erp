import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { AppLayout } from "@/components/org/AppLayout.tsx";
import { DepartmentForm, type DepartmentFormValues } from "@/components/org/DepartmentForm.tsx";
import { useTenant } from "@/components/providers/TenantProvider.tsx";
import { listDepartments, createDepartment, type Department } from "@/lib/services/departments.ts";

export default function DepartmentNew() {
  const { t } = useTranslation();
  const tenant = useTenant();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listDepartments(tenant.id).then((result) => {
      if (result.ok) setDepartments(result.data);
    });
  }, [tenant.id]);

  const handleSubmit = async (values: DepartmentFormValues) => {
    setSubmitting(true);
    const result = await createDepartment({
      tenantId: tenant.id,
      name: { mn: values.nameMn, en: values.nameEn },
      code: values.code,
      parentDepartmentId: values.parentDepartmentId,
      managerId: null,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success(t("department.createSuccess"));
      navigate(`/app/departments/${result.data.id}`);
    } else {
      toast.error(result.error.message);
    }
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-lg mx-auto space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigate("/app/departments")} className="-ml-2">
          <ArrowLeft className="w-4 h-4 mr-1" />
          {t("common.back")}
        </Button>

        <h1 className="text-xl font-bold">{t("department.createNew")}</h1>

        <div className="rounded-xl border bg-card p-5">
          <DepartmentForm
            departments={departments}
            onSubmit={handleSubmit}
            onCancel={() => navigate("/app/departments")}
            isSubmitting={submitting}
            submitLabel={t("common.create")}
          />
        </div>
      </div>
    </AppLayout>
  );
}
