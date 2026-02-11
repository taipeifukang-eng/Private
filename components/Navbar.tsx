'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Home, 
  Users, 
  FileText, 
  ClipboardList, 
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Shield,
  Crown,
  User as UserIcon,
  Archive,
  CalendarCheck,
  Store,
  ChevronDown,
  Send,
  Upload,
  UserCog,
  TrendingUp,
  Package
} from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { useNavbarPermissions, hasAnyTaskPermission, hasAnyStorePermission, hasAnyMonthlyStatusPermission } from '@/hooks/useNavbarPermissions';

interface NavbarProps {
  user: {
    id: string;
    email: string;
    profile: {
      full_name: string | null;
      role: 'admin' | 'manager' | 'member';
      department?: string | null;
      job_title?: string | null;
    };
  } | null;
}

export default function Navbar({ user }: NavbarProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTaskMenuOpen, setIsTaskMenuOpen] = useState(false);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const [isMonthlyStatusMenuOpen, setIsMonthlyStatusMenuOpen] = useState(false);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const storeMenuRef = useRef<HTMLDivElement>(null);
  const monthlyStatusMenuRef = useRef<HTMLDivElement>(null);

  // 🔐 使用 RBAC 權限系統
  const permissions = useNavbarPermissions(user?.id || '');

  // 點擊外部關閉下拉選單
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (taskMenuRef.current && !taskMenuRef.current.contains(event.target as Node)) {
        setIsTaskMenuOpen(false);
      }
      if (storeMenuRef.current && !storeMenuRef.current.contains(event.target as Node)) {
        setIsStoreMenuOpen(false);
      }
      if (monthlyStatusMenuRef.current && !monthlyStatusMenuRef.current.contains(event.target as Node)) {
        setIsMonthlyStatusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const role = user.profile?.role || 'member';

  const getRoleIcon = () => {
    if (role === 'admin') return <Shield className="w-4 h-4" />;
    if (role === 'manager') return <Crown className="w-4 h-4" />;
    return <UserIcon className="w-4 h-4" />;
  };

  const getRoleLabel = () => {
    if (role === 'admin') return '管理員';
    if (role === 'manager') return '主管';
    return '成員';
  };

  const getRoleBgColor = () => {
    if (role === 'admin') return 'bg-purple-100 text-purple-800';
    if (role === 'manager') return 'bg-green-100 text-green-800';
    return 'bg-gray-100 text-gray-800';
  };

  // 格式化職稱顯示
  const formatJobTitle = (jobTitle: string | null | undefined) => {
    const title = jobTitle || '使用者';
    const isHighPosition = title.includes('經理') || title.includes('督導') || title.includes('店長');
    return isHighPosition ? `親愛的${title}大人` : `親愛的${title}`;
  };

  // 派發任務相關的子選單項目（使用 RBAC 權限）
  const taskSubItems = [
    { href: '/my-tasks', label: '我的任務', icon: ClipboardList, show: permissions.canViewOwnTasks },
    { href: '/dashboard', label: '儀表板', icon: LayoutDashboard, show: permissions.canViewDashboard },
    { href: '/admin/templates', label: '任務管理', icon: FileText, show: permissions.canManageTasks },
    { href: '/admin/archived', label: '已封存任務', icon: Archive, show: permissions.canViewArchivedTasks },
  ].filter(item => item.show);

  // 門市管理相關的子選單項目（使用 RBAC 權限）
  const storeSubItems = [
    { href: '/admin/store-managers', label: '店長指派', icon: Users, show: permissions.canAssignStoreManager },
    { href: '/admin/supervisors', label: '經理/督導管理', icon: Users, show: permissions.canAssignSupervisor },
    { href: '/admin/stores', label: '門市管理', icon: Store, show: permissions.canManageStores },
    { href: '/admin/employee-management', label: '員工管理', icon: UserCog, show: permissions.canManageEmployees },
    { href: '/admin/promotion-management', label: '人員異動管理', icon: TrendingUp, show: permissions.canManageMovements },
    { href: '/admin/import-employees', label: '批次匯入員工', icon: Upload, show: permissions.canImportEmployees },
    { href: '/admin/activity-management', label: '活動管理', icon: CalendarCheck, show: permissions.canManageActivities },
    { href: '/inventory', label: '盤點管理', icon: Package, show: permissions.canManageInventory },
  ].filter(item => item.show);

  // 每月人員狀態相關的子選單項目（使用 RBAC 權限）
  const monthlyStatusSubItems = [
    { href: '/monthly-status', label: '每月人員狀態', icon: CalendarCheck, show: permissions.canViewMonthlyStatus },
    { href: '/admin/export-monthly-status', label: '資料匯出', icon: Send, show: permissions.canExportMonthlyStatus },
  ].filter(item => item.show);

  // 判斷是否在派發任務相關頁面
  const isInTaskSection = ['/my-tasks', '/dashboard', '/admin/templates', '/admin/archived', '/assignment', '/admin/assign', '/admin/template', '/admin/edit', '/admin/create'].some(
    path => pathname.startsWith(path) || pathname === path
  );

  // 判斷是否在門市管理相關頁面
  const isInStoreSection = ['/admin/store-managers', '/admin/supervisors', '/admin/stores', '/admin/employee-management', '/admin/promotion-management', '/admin/import-employees', '/admin/activity-management', '/inventory'].some(
    path => pathname.startsWith(path) || pathname === path
  );

  // 判斷是否在每月人員狀態相關頁面
  const isInMonthlyStatusSection = ['/monthly-status', '/admin/export-monthly-status'].some(
    path => pathname.startsWith(path) || pathname === path
  );

  // 其他獨立的導航項目
  const navItems = [
    { href: '/', label: '首頁', icon: Home, roles: ['admin', 'manager', 'member'] },
    { href: '/admin/users', label: '使用者管理', icon: Users, roles: ['admin'] },
    { href: '/admin/roles', label: '角色權限管理', icon: Shield, roles: ['admin'] },
  ].filter(item => item.roles.includes(role));

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <nav className="bg-white shadow-lg border-b border-gray-200 sticky top-0 z-50">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and Desktop Navigation */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-2">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                <ClipboardList className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900 hidden sm:block">
                富康內部業務管理系統
              </span>
            </Link>

            {/* Desktop Menu */}
            <div className="hidden md:flex md:ml-10 md:space-x-2">
              {/* 首頁 */}
              <Link
                href="/"
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname === '/'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Home size={18} />
                首頁
              </Link>

              {/* 派發任務下拉選單 */}
              <div className="relative" ref={taskMenuRef}>
                <button
                  onClick={() => setIsTaskMenuOpen(!isTaskMenuOpen)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isInTaskSection
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Send size={18} />
                  派發任務
                  <ChevronDown size={16} className={`transition-transform ${isTaskMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* 下拉選單內容 */}
                {isTaskMenuOpen && (
                  <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                    {taskSubItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setIsTaskMenuOpen(false)}
                          className={`flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors ${
                            isActive
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                          }`}
                        >
                          <Icon size={18} />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 門市管理下拉選單 - 使用 RBAC 權限 */}
              {hasAnyStorePermission(permissions) && (
                <div className="relative" ref={storeMenuRef}>
                  <button
                    onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isInStoreSection
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <Store size={18} />
                    門市管理
                    <ChevronDown size={16} className={`transition-transform ${isStoreMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* 下拉選單內容 */}
                  {isStoreMenuOpen && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                      {storeSubItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setIsStoreMenuOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors ${
                              isActive
                                ? 'bg-blue-50 text-blue-700'
                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                          >
                            <Icon size={18} />
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 每月人員狀態下拉選單 */}
              {monthlyStatusSubItems.length > 0 && (
                <div className="relative" ref={monthlyStatusMenuRef}>
                  <button
                    onClick={() => setIsMonthlyStatusMenuOpen(!isMonthlyStatusMenuOpen)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isInMonthlyStatusSection
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <CalendarCheck size={18} />
                    每月人員狀態
                    <ChevronDown size={16} className={`transition-transform ${isMonthlyStatusMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* 下拉選單內容 */}
                  {isMonthlyStatusMenuOpen && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                      {monthlyStatusSubItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setIsMonthlyStatusMenuOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors ${
                              isActive
                                ? 'bg-blue-50 text-blue-700'
                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                            }`}
                          >
                            <Icon size={18} />
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 其他導航項目 */}
              {navItems.filter(item => item.href !== '/').map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* User Info and Sign Out */}
          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex items-center space-x-3">
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900">
                  {user.profile?.full_name || user.email}
                </div>
                <div className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${getRoleBgColor()}`}>
                  {getRoleIcon()}
                  {formatJobTitle(user.profile?.job_title)}
                </div>
              </div>
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                {user.profile?.full_name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
              </div>
            </div>

            <button
              onClick={handleSignOut}
              className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={18} />
              登出
            </button>

            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-gray-200">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {/* User Info */}
            <div className="px-3 py-2 mb-2 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                  {user.profile?.full_name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {user.profile?.full_name || user.email}
                  </div>
                  <div className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 mt-1 ${getRoleBgColor()}`}>
                    {getRoleIcon()}
                    {formatJobTitle(user.profile?.job_title)}
                  </div>
                </div>
              </div>
            </div>

            {/* Nav Items */}
            {/* 首頁 */}
            <Link
              href="/"
              onClick={() => setIsMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-base font-medium ${
                pathname === '/'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Home size={20} />
              首頁
            </Link>

            {/* 派發任務區塊 */}
            <div className="mt-2">
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                <Send size={14} />
                派發任務
              </div>
              <div className="ml-4 space-y-1">
                {taskSubItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-base font-medium ${
                        isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      <Icon size={20} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* 門市管理區塊 - 使用 RBAC 權限 */}
            {hasAnyStorePermission(permissions) && (
              <div className="mt-2">
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Store size={14} />
                  門市管理
                </div>
                <div className="ml-4 space-y-1">
                  {storeSubItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-base font-medium ${
                          isActive
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <Icon size={20} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 每月人員狀態區塊 */}
            {monthlyStatusSubItems.length > 0 && (
              <div className="mt-2">
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <CalendarCheck size={14} />
                  每月人員狀態
                </div>
                <div className="ml-4 space-y-1">
                  {monthlyStatusSubItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-base font-medium ${
                          isActive
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        <Icon size={20} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 其他導航項目 */}
            <div className="mt-2 pt-2 border-t border-gray-200">
              {navItems.filter(item => item.href !== '/').map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-base font-medium ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <Icon size={20} />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            {/* Sign Out */}
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2 text-base font-medium text-red-600 hover:bg-red-50 rounded-lg"
            >
              <LogOut size={20} />
              登出
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
