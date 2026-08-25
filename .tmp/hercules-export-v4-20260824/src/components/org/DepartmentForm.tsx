import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { Department, LocalizedString } from "@/lib/services/departments.ts";

const formSchema = z.object({
  nameMn: z.string().min(1, "errors.nameRequired"),
  nameEn: z.string().min(1, "errors.nameRequired"),
  code: z
    .string()
    .min(1, "errors.codeRequired")
    .regex(/^[A-Za-z0-9-]+$/, "errors.codeFormat"),
  parentDepartmentId: z.string().nullable(),
});

export type DepartmentFormValues = z.infer<typeof formSchema>;

type DepartmentFormProps = {
  defaultValues?: Partial<DepartmentFormValues>;
  departments: Department[]; // For parent selector
  currentId?: string; // Exclude self from parent options
  onSubmit: (values: DepartmentFormValues) => void | Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
};

export function DepartmentForm({
  defaultValues,
  departments,
  currentId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: DepartmentFormProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as "mn" | "en";

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nameMn: "",
      nameEn: "",
      code: "",
      parentDepartmentId: null,
      ...defaultValues,
    },
  });

  // Reset when defaultValues change (edit scenario)
  useEffect(() => {
    if (defaultValues) form.reset({ nameMn: "", nameEn: "", code: "", parentDepartmentId: null, ...defaultValues });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValues?.nameMn, defaultValues?.nameEn, defaultValues?.code, defaultValues?.parentDepartmentId]);

  const parentOptions = departments.filter(
    (d) => d.isActive && d.id !== currentId,
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="nameMn"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("department.nameMn")}</FormLabel>
              <FormControl>
                <Input placeholder="Санхүүгийн хэлтэс" {...field} />
              </FormControl>
              <FormMessage>{form.formState.errors.nameMn && t(form.formState.errors.nameMn.message ?? "")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="nameEn"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("department.nameEn")}</FormLabel>
              <FormControl>
                <Input placeholder="Finance Department" {...field} />
              </FormControl>
              <FormMessage>{form.formState.errors.nameEn && t(form.formState.errors.nameEn.message ?? "")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("department.code")}</FormLabel>
              <FormControl>
                <Input placeholder="FIN" className="font-mono uppercase" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} />
              </FormControl>
              <FormMessage>{form.formState.errors.code && t(form.formState.errors.code.message ?? "")}</FormMessage>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="parentDepartmentId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("department.parent")}</FormLabel>
              <Select
                value={field.value ?? "none"}
                onValueChange={(v) => field.onChange(v === "none" ? null : v)}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={t("department.parentNone")} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="none">{t("department.parentNone")}</SelectItem>
                  {parentOptions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name[lang]} ({d.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />

        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={isSubmitting} className="flex-1">
            {isSubmitting ? t("common.loading") : (submitLabel ?? t("common.save"))}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
