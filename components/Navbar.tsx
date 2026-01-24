'use client';

import { useState, useEffect } from 'react';
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
  Store
} from 'lucide-react';
import { signOut } from '@/app/auth/actions';

interface NavbarProps {
  user: {
    email: string;
    profile: {
      full_name: string | null;
      role: 'admin' | 'manager' | 'member';
    };
  } | null;
}

export default function Navbar({ user }: NavbarProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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

  const navItems = [
    { href: '/', label: '首頁', icon: Home, roles: ['admin', 'manager', 'member'] },
    { href: '/my-tasks', label: '我的任務', icon: ClipboardList, roles: ['admin', 'manager', 'member'] },
    { href: '/monthly-status', label: '每月人員狀態', icon: CalendarCheck, roles: ['admin', 'manager', 'member'] },
    { href: '/dashboard', label: '儀表板', icon: LayoutDashboard, roles: ['admin', 'manager'] },
    { href: '/admin/templates', label: '任務管理', icon: FileText, roles: ['admin', 'manager'] },
    { href: '/admin/archived', label: '已封存任務', icon: Archive, roles: ['admin', 'manager'] },
    { href: '/admin/stores', label: '門市管理', icon: Store, roles: ['admin'] },
    { href: '/admin/users', label: '使用者管理', icon: Users, roles: ['admin'] },
  ].filter(item => item.roles.includes(role));

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <nav className="bg-white shadow-lg border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
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
                  {getRoleLabel()}
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
                    {getRoleLabel()}
                  </div>
                </div>
              </div>
            </div>

            {/* Nav Items */}
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
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
