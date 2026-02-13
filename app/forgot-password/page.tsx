'use client';

import { useState } from 'react';
import { requestPasswordReset } from '@/app/auth/actions';
import { Mail, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ type: null, message: '' });
    setIsLoading(true);

    try {
      const result = await requestPasswordReset(email);

      if (result.success) {
        setStatus({
          type: 'success',
          message: result.message || '密碼重置郵件已發送，請檢查您的信箱',
        });
        setEmail(''); // 清空輸入框
      } else {
        setStatus({
          type: 'error',
          message: result.error || '發送失敗，請稍後再試',
        });
      }
    } catch (err: any) {
      setStatus({
        type: 'error',
        message: err.message || '發生錯誤',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 w-full max-w-md">
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
            <Mail className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-center text-gray-900 mb-2">
          忘記密碼
        </h1>
        <p className="text-center text-gray-600 mb-8">
          輸入您的電子郵件，我們將發送重置連結
        </p>

        {status.type === 'success' && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-green-800 font-medium mb-1">
                  郵件已發送！
                </p>
                <p className="text-green-700 text-sm">
                  {status.message}
                </p>
                <p className="text-green-600 text-xs mt-2">
                  請檢查您的收件匣（包括垃圾郵件資料夾），並點擊郵件中的重置連結。
                </p>
              </div>
            </div>
          </div>
        )}

        {status.type === 'error' && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-red-800 font-medium mb-1">發送失敗</p>
                <p className="text-red-700 text-sm">{status.message}</p>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              電子郵件
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="your@email.com"
                disabled={isLoading}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
          >
            {isLoading ? '發送中...' : '發送重置郵件'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            返回登入頁面
          </Link>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            如果您沒有收到郵件，請檢查：
          </p>
          <ul className="mt-2 text-xs text-gray-500 space-y-1">
            <li>• 電子郵件地址是否正確</li>
            <li>• 垃圾郵件或促銷活動資料夾</li>
            <li>• 等待幾分鐘後重試</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
