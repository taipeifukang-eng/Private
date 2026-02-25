'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from '@/app/auth/actions';
import { LogIn, Mail, Lock, Activity } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [storeCount, setStoreCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('stores')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .then(({ count }) => {
        if (count !== null) setStoreCount(count);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await signIn(formData);

      if (result.success) {
        // Redirect based on user role
        // The signIn action returns user data if successful
        router.push('/');
        router.refresh();
      } else {
        setError(result.error || '登入失敗');
      }
    } catch (err: any) {
      setError(err.message || '發生錯誤');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl p-8 w-full max-w-md border border-white/20">
        {/* Logo */}
        <div className="flex items-center justify-center mb-5">
          <div className="w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl flex items-center justify-center border border-amber-500/30 shadow-lg">
            <LogIn className="w-8 h-8 text-amber-400" />
          </div>
        </div>

        <h1 className="text-2xl font-black text-center text-slate-900 mb-1 tracking-wide">
          歡迎登入，富康菁英主管
        </h1>

        {/* 動態歡迎訊息 */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <Activity className="w-4 h-4 text-amber-500 animate-pulse" />
          <p className="text-sm text-slate-500">
            {storeCount !== null
              ? `正在同步 ${storeCount} 間門市的營運脈動...`
              : '正在同步門市營運脈動...'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              電子郵件
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                placeholder="your@email.com"
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              密碼
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
              <input
                type="password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all"
                placeholder="輸入您的密碼"
                disabled={isLoading}
              />
            </div>
            <div className="mt-2 text-right">
              <Link
                href="/forgot-password"
                className="text-sm text-amber-600 hover:text-amber-800 font-medium"
              >
                忘記密碼？
              </Link>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-xl hover:from-slate-700 hover:to-slate-800 disabled:from-slate-400 disabled:to-slate-400 disabled:cursor-not-allowed transition-all font-bold tracking-wider shadow-lg"
          >
            {isLoading ? '登入中...' : '登入系統'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          還沒有帳號？{' '}
          <Link href="/register" className="text-amber-600 hover:text-amber-800 font-semibold">
            立即註冊
          </Link>
        </p>

        <div className="mt-4 pt-4 border-t border-slate-200">
          <Link
            href="/"
            className="block text-center text-sm text-slate-500 hover:text-slate-800"
          >
            返回首頁
          </Link>
        </div>
      </div>
    </div>
  );
}
