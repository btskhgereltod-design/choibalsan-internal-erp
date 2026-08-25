import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Building2, Users, Briefcase, Shield, ClipboardList, Settings } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { useTenant } from "@/components/providers/TenantProvider.tsx";
import { LanguageToggle } from "./LanguageToggle.tsx";

type NavItem = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  comingSoon?: boolean;
};

const navItems: NavItem[] = [
  { key: "nav.dashboard", icon: LayoutDashboard, to: "/app" },
  { key: "nav.departments", icon: Building2, to: "/app/departments" },
  { key: "nav.employees", icon: Users, to: "/app/employees", comingSoon: true },
  { key: "nav.positions", icon: Briefcase, to: "/app/positions", comingSoon: true },
  { key: "nav.roles", icon: Shield, to: "/app/roles", comingSoon: true },
  { key: "nav.audit", icon: ClipboardList, to: "/app/audit", comingSoon: true },
];

function NavItemRow({
  item,
  collapsed = false,
}: {
  item: NavItem;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocation();

  const isActive =
    item.to === "/app"
      ? location.pathname === "/app"
      : location.pathname.startsWith(item.to);

  const content = (
    <span
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        item.comingSoon && "opacity-50 pointer-events-none",
        collapsed && "justify-center px-2",
      )}
    >
      <item.icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span>{t(item.key)}</span>}
    </span>
  );

  if (item.comingSoon) return <div key={item.to}>{content}</div>;

  return (
    <NavLink to={item.to} key={item.to}>
      {content}
    </NavLink>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const tenant = useTenant();

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 flex-col border-r bg-sidebar shrink-0">
        {/* Tenant header */}
        <div className="px-4 py-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">{t("org.tenant")}</p>
              <p className="text-sm font-semibold text-sidebar-foreground truncate">{tenant.name}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavItemRow key={item.to} item={item} />
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t space-y-1">
          <NavLink to="/app/settings">
            <span className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
              <Settings className="w-4 h-4" />
              <span>{t("nav.settings")}</span>
            </span>
          </NavLink>
          <div className="px-3 py-1">
            <LanguageToggle />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 flex justify-around items-center border-t bg-background md:hidden h-14 px-2 z-50">
        {navItems.slice(0, 4).map((item) => {
          return <NavItemRow key={item.to} item={item} collapsed />;
        })}
        <NavLink to="/app/settings">
          <span className="flex items-center justify-center px-2 py-2 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors">
            <Settings className="w-4 h-4" />
          </span>
        </NavLink>
      </nav>
    </div>
  );
}
