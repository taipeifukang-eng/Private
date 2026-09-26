'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Menu } from 'lucide-react';
import { useNavbarPermissions } from '@/hooks/useNavbarPermissions';
import GeneralAffairsSidebar from './GeneralAffairsSidebar';

const STORAGE_KEY = 'general-affairs-sidebar-collapsed';

type GeneralAffairsShellProps = {
  userId?: string | null;
  children: ReactNode;
};

export default function GeneralAffairsShell({ userId, children }: GeneralAffairsShellProps) {
  const permissionFlags = useNavbarPermissions(userId || '');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      setCollapsed(false);
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Local storage is a non-critical UI preference.
      }
      return next;
    });
  };

  const shellClass = useMemo(
    () => `min-h-[calc(100vh-3.5rem)] bg-slate-50 lg:min-h-[calc(100vh-4rem)] ${collapsed ? 'lg:pl-16' : 'lg:pl-72'}`,
    [collapsed],
  );

  if (!userId) {
    return <>{children}</>;
  }

  return (
    <div className={shellClass}>
      <div className="fixed left-0 top-14 z-40 hidden h-[calc(100vh-3.5rem)] lg:top-16 lg:block lg:h-[calc(100vh-4rem)]">
        <GeneralAffairsSidebar
          permissionFlags={permissionFlags}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/40"
            aria-label="關閉總務導覽"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0">
            <GeneralAffairsSidebar
              permissionFlags={permissionFlags}
              collapsed={false}
              mobile
              onClose={() => setMobileOpen(false)}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="sticky top-14 z-30 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm"
        >
          <Menu className="h-4 w-4 text-orange-600" />
          總務服務中心
        </button>
      </div>

      <main className="min-w-0 px-4 py-4 lg:px-6 lg:py-6">
        {children}
      </main>
    </div>
  );
}
