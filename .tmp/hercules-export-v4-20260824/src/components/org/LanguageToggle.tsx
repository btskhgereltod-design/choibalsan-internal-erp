import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = i18n.language;

  const toggle = () => {
    i18n.changeLanguage(current === "mn" ? "en" : "mn");
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className="text-xs text-muted-foreground px-2 h-7"
    >
      {current === "mn" ? "EN" : "МН"}
    </Button>
  );
}
