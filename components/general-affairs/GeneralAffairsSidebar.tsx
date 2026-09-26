'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  getActiveGeneralAffairsNavItemId,
  getGeneralAffairsItemAvailability,
  getVisibleGeneralAffairsNavGroups,
  type GeneralAffairsNavGroup,
  type GeneralAffairsNavItem,
} from './navigation';
import type { NavbarPermissions } from '@/hooks/useNavbarPermissions';

type GeneralAffairsSidebarProps = {
  permissionFlags: Partial<NavbarPermissions>;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  mobile?: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
};

function normalizePathWithQuery(pathname: string, searchParams: URLSearchParams) {
  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function SidebarItem({
  item,
  collapsed,
  depth = 0,
  activeItemId,
  onNavigate,
  expanded,
  onToggleExpanded,
}: {
  item: GeneralAffairsNavItem;
  collapsed: boolean;
  depth?: number;
  activeItemId: string | null;
  onNavigate?: () => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const Icon = item.icon;
  const active = item.id === activeItemId;
  const availability = getGeneralAffairsItemAvailability(item);
  const unavailableLabel = availability && availability.status !== 'available' ? availability.label : null;
  const unavailableText = availability?.status === 'planned' ? '規劃中' : availability?.status === 'temporarily_unavailable' ? '未開放' : null;
  const classes = [
    'group flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
    depth > 0 ? 'ml-5' : '',
    active ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950',
    collapsed ? 'justify-center px-2' : '',
  ].filter(Boolean).join(' ');

  const hasChildren = Boolean(item.children?.length);

  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <span className={['min-w-0 truncate', hasChildren ? '' : 'flex-1'].filter(Boolean).join(' ')}>
          {item.label}
          {unavailableLabel && <span className="sr-only">（未開放：{unavailableLabel}）</span>}
        </span>
      )}
      {!collapsed && unavailableText && !hasChildren && (
        <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
          {unavailableText}
        </span>
      )}
      {!collapsed && hasChildren && (
        expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />
      )}
    </>
  );

  if (!item.href) {
    if (hasChildren && onToggleExpanded) {
      return (
        <button
          type="button"
          onClick={onToggleExpanded}
          className={classes}
          title={collapsed ? item.label : undefined}
          aria-expanded={expanded}
        >
          {content}
        </button>
      );
    }
    return (
      <div className={classes} title={collapsed ? item.label : undefined}>
        {content}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={classes}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
    >
      {content}
    </Link>
  );
}

function SidebarGroups({
  groups,
  collapsed,
  activeItemId,
  onNavigate,
}: {
  groups: GeneralAffairsNavGroup[];
  collapsed: boolean;
  activeItemId: string | null;
  onNavigate?: () => void;
}) {
  const activeParentIds = useMemo(() => {
    const ids = new Set<string>();
    groups.forEach((group) => {
      group.items.forEach((item) => {
        if (item.children?.some((child) => child.id === activeItemId)) ids.add(item.id);
      });
    });
    return ids;
  }, [activeItemId, groups]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(activeParentIds);


  const activeParentKey = Array.from(activeParentIds).sort().join('|');

  useEffect(() => {
    if (activeParentIds.size === 0) return;
    setExpandedGroups((current) => {
      const next = new Set(current);
      activeParentIds.forEach((id) => next.add(id));
      return next;
    });
  }, [activeParentKey]);

  function handleNavigate() {
    setExpandedGroups(new Set());
    onNavigate?.();
  }

  return (
    <nav className="space-y-4" aria-label="總務服務中心導覽">
      {groups.map((group) => (
        <section key={group.id} className="space-y-1">
          {group.label && !collapsed && (
            <div className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {group.label}
            </div>
          )}
          {group.items.map((item) => (
            <div key={item.id}>
              <SidebarItem
                item={item}
                collapsed={collapsed}
                activeItemId={activeItemId}
                onNavigate={handleNavigate}
                expanded={expandedGroups.has(item.id)}
                onToggleExpanded={item.children?.length ? () => {
                  setExpandedGroups((current) => {
                    if (current.has(item.id)) return new Set();
                    return new Set([item.id]);
                  });
                } : undefined}
              />
              {!collapsed && expandedGroups.has(item.id) && item.children?.map((child) => (
                <SidebarItem
                  key={child.id}
                  item={child}
                  collapsed={collapsed}
                  depth={1}
                  activeItemId={activeItemId}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          ))}
        </section>
      ))}
    </nav>
  );
}

export default function GeneralAffairsSidebar({
  permissionFlags,
  collapsed,
  onToggleCollapsed,
  mobile = false,
  onNavigate,
  onClose,
}: GeneralAffairsSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPath = normalizePathWithQuery(pathname, searchParams);
  const groups = getVisibleGeneralAffairsNavGroups({ permissionFlags });
  const activeItemId = getActiveGeneralAffairsNavItemId(pathname, currentPath, groups);

  return (
    <aside
      className={[
        'flex h-full flex-col border-r border-slate-200 bg-white',
        mobile ? 'w-80 max-w-[86vw]' : collapsed ? 'w-16' : 'w-72',
      ].join(' ')}
    >
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-3">
        <div className={collapsed && !mobile ? 'sr-only' : 'min-w-0'}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-orange-600">General Affairs</div>
          <div className="truncate text-base font-black text-slate-950">總務服務中心</div>
        </div>
        {collapsed && !mobile && (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-sm font-black text-orange-700">
            GA
          </div>
        )}
        {mobile ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="關閉總務導覽"
          >
            <X className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label={collapsed ? '展開總務導覽' : '收合總務導覽'}
            title={collapsed ? '展開總務導覽' : '收合總務導覽'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        {groups.length > 0 ? (
          <SidebarGroups
            groups={groups}
            collapsed={collapsed && !mobile}
            activeItemId={activeItemId}
            onNavigate={onNavigate}
          />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
            目前帳號沒有可顯示的總務功能。
          </div>
        )}
      </div>
    </aside>
  );
}
