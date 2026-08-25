import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ChevronDown, Building2, Archive } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { Badge } from "@/components/ui/badge.tsx";
import type { Department } from "@/lib/services/departments.ts";

type DeptNode = Department & { children: DeptNode[] };

function buildTree(departments: Department[]): DeptNode[] {
  const map = new Map<string, DeptNode>();
  const roots: DeptNode[] = [];

  for (const d of departments) {
    map.set(d.id, { ...d, children: [] });
  }

  for (const node of map.values()) {
    if (node.parentDepartmentId && map.has(node.parentDepartmentId)) {
      map.get(node.parentDepartmentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function TreeNode({
  node,
  depth,
  selectedId,
  showArchived,
}: {
  node: DeptNode;
  depth: number;
  selectedId: string | undefined;
  showArchived: boolean;
}) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language as "mn" | "en";

  const visibleChildren = showArchived
    ? node.children
    : node.children.filter((c) => c.isActive);

  const [expanded, setExpanded] = useState(depth < 2);

  const hasChildren = visibleChildren.length > 0;
  const isSelected = selectedId === node.id;
  const isArchived = !node.isActive;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-1.5 px-2 rounded-md cursor-pointer select-none group transition-colors",
          isSelected ? "bg-primary/10 text-primary" : "hover:bg-accent",
          isArchived && "opacity-60",
        )}
        style={{ paddingLeft: `${8 + depth * 20}px` }}
        onClick={() => navigate(`/app/departments/${node.id}`)}
      >
        <button
          className={cn(
            "w-4 h-4 flex items-center justify-center shrink-0 rounded transition-colors",
            "text-muted-foreground hover:text-foreground",
            !hasChildren && "invisible",
          )}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((p) => !p);
          }}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>

        <Building2 className={cn("w-4 h-4 shrink-0", isArchived ? "text-muted-foreground" : "text-muted-foreground group-hover:text-foreground")} />

        <span className="text-sm truncate flex-1">{node.name[lang]}</span>

        <span className="text-xs text-muted-foreground font-mono shrink-0 mr-1">{node.code}</span>

        {isArchived && (
          <Archive className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {visibleChildren.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              showArchived={showArchived}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type DepartmentTreeProps = {
  departments: Department[];
  selectedId?: string;
  showArchived?: boolean;
};

export function DepartmentTree({ departments, selectedId, showArchived = false }: DepartmentTreeProps) {
  const { t } = useTranslation();

  const filtered = showArchived ? departments : departments.filter((d) => d.isActive);
  const tree = buildTree(filtered);

  if (tree.length === 0) {
    return (
      <p className="text-sm text-muted-foreground px-4 py-6 text-center">{t("common.noData")}</p>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          showArchived={showArchived}
        />
      ))}
    </div>
  );
}

export { buildTree };
export type { DeptNode };
