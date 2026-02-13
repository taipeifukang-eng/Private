'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { resetPassword } from '@/app/auth/actions';
import { createClient } from '@/lib/supabase/client';
import { Lock, CheckCircle, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import Link from 'next/link';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [passwords, setPasswords] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);
  const [status, setStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });
  const [passwordStrength, setPasswordStrength] = useState({
    score: 0,
    feedback: '',
  });

  // 驗證重置 token
  useEffect(() => {
    const verifyToken = async () => {
      try {
        const supabase = createClient();
        
        // 檢查是否有 token 或 code 參數
        const token = searchParams.get('token');
        const code = searchParams.get('code');
        const type = searchParams.get('type');

        console.log('Token verification:', { token, code, type });

        // 如果有 code，交換為 session
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error('Exchange code error:', error);
            setStatus({
              type: 'error',
              message: '重置連結無效或已過期，請重新申請',
            });
            setIsValidToken(false);
          } else {
            setIsValidToken(true);
          }
        } 
        // 如果是 recovery type，檢查 session
        else if (type === 'recovery') {
          const { data: { session }, error } = await supabase.auth.getSession();
          if (error || !session) {
            console.error('Session error:', error);
            setStatus({
              type: 'error',
              message: '重置連結無效或已過期，請重新申請',
            });
            setIsValidToken(false);
          } else {
            setIsValidToken(true);
          }
        }
        // 沒有參數，檢查是否已登入
        else {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            setIsValidToken(true);
          } else {
            setStatus({
              type: 'error',
              message: '請先從郵件中點擊重置連結',
            });
            setIsValidToken(false);
          }
        }
      } catch (error) {
        console.error('Token verification error:', error);
        setStatus({
          type: 'error',
          message: '驗證失敗，請重新申請重置連結',
        });
        setIsValidToken(false);
      } finally {
        setIsVerifying(false);
      }
    };

    verifyToken();
  }, [searchParams]);

  // 檢查密碼強度
  useEffect(() => {
    const password = passwords.newPassword;
    if (!password) {
      setPasswordStrength({ score: 0, feedback: '' });
      return;
    }

    let score = 0;
    let feedback = '';

    // 長度
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;

    // 包含數字
    if (/\d/.test(password)) score += 1;

    // 包含小寫字母
    if (/[a-z]/.test(password)) score += 1;

    // 包含大寫字母
    if (/[A-Z]/.test(password)) score += 1;

    // 包含特殊字符
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;

    // 評級
    if (score <= 2) {
      feedback = '弱';
    } else if (score <= 4) {
      feedback = '中等';
    } else {
      feedback = '強';
    }

    setPasswordStrength({ score, feedback });
  }, [passwords.newPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ type: null, message: '' });

    // 驗證密碼
    if (passwords.newPassword.length < 6) {
      setStatus({
        type: 'error',
        message: '密碼長度至少需要 6 個字元',
      });
      return;
    }

    if (passwords.newPassword !== passwords.confirmPassword) {
      setStatus({
        type: 'error',
        message: '兩次輸入的密碼不一致',
      });
      return;
    }

    setIsLoading(true);

    try {
      const result = await resetPassword(passwords.newPassword);

      if (result.success) {
        setStatus({
          type: 'success',
          message: result.message || '密碼已成功重置',
        });
        
        // 3 秒後跳轉到登入頁
        setTimeout(() => {
          router.push('/login');
        }, 3000);
      } else {
        setStatus({
          type: 'error',
          message: result.error || '重置失敗，請稍後再試',
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

  // 密碼強度顏色
  const getStrengthColor = () => {
    if (passwordStrength.score <= 2) return 'bg-red-500';
    if (passwordStrength.score <= 4) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getStrengthTextColor = () => {
    if (passwordStrength.score <= 2) return 'text-red-600';
    if (passwordStrength.score <= 4) return 'text-yellow-600';
    return 'text-green-600';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="bg-white rounded-lg shadow-2xl p-8 w-full max-w-md">
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
            <Lock className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-center text-gray-900 mb-2">
          設定新密碼
        </h1>
        <p className="text-center text-gray-600 mb-8">
          請輸入您的新密碼
        </p>

        {/* 驗證中狀態 */}
        {isVerifying && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <p className="text-blue-800">正在驗證重置連結...</p>
            </div>
          </div>
        )}

        {/* 驗證失敗 */}
        {!isVerifying && !isValidToken && (
          <div className="space-y-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-red-800 font-medium mb-1">連結無效或已過期</p>
                  <p className="text-red-700 text-sm">{status.message}</p>
                  <p className="text-red-600 text-xs mt-2">
                    請返回忘記密碼頁面重新申請重置連結
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <Link
                href="/forgot-password"
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors text-center font-medium"
              >
                重新申請
              </Link>
              <Link
                href="/login"
                className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300 transition-colors text-center font-medium"
              >
                返回登入
              </Link>
            </div>
          </div>
        )}

        {/* 驗證成功，顯示表單 */}
        {!isVerifying && isValidToken && (
          <>
            {status.type === 'success' && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-green-800 font-medium mb-1">
                      密碼重置成功！
                    </p>
                    <p className="text-green-700 text-sm">
                      {status.message}
                    </p>
                    <p className="text-green-600 text-xs mt-2">
                      即將跳轉至登入頁面...
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
                    <p className="text-red-800 font-medium mb-1">重置失敗</p>
                    <p className="text-red-700 text-sm">{status.message}</p>
                  </div>
                </div>
              </div>
            )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              新密碼
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={passwords.newPassword}
                onChange={(e) =>
                  setPasswords({ ...passwords, newPassword: e.target.value })
                }
                className="w-full pl-10 pr-12 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="至少 6 個字元"
                disabled={isLoading || status.type === 'success'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            
            {/* 密碼強度指示器 */}
            {passwords.newPassword && (
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${getStrengthColor()}`}
                      style={{
                        width: `${(passwordStrength.score / 6) * 100}%`,
                      }}
                    />
                  </div>
                  <span
                    className={`text-xs font-medium ${getStrengthTextColor()}`}
                  >
                    {passwordStrength.feedback}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  建議：至少 8 個字元，包含大小寫字母、數字和特殊符號
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              確認新密碼
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                required
                value={passwords.confirmPassword}
                onChange={(e) =>
                  setPasswords({
                    ...passwords,
                    confirmPassword: e.target.value,
                  })
                }
                className="w-full pl-10 pr-12 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="再次輸入新密碼"
                disabled={isLoading || status.type === 'success'}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
              >
                {showConfirmPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            
            {/* 密碼一致性提示 */}
            {passwords.confirmPassword && (
              <p
                className={`mt-1 text-xs ${
                  passwords.newPassword === passwords.confirmPassword
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}
              >
                {passwords.newPassword === passwords.confirmPassword
                  ? '✓ 密碼一致'
                  : '✗ 密碼不一致'}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || status.type === 'success'}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
          >
            {isLoading ? '重置中...' : '重置密碼'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            返回登入頁面
          </Link>
        </div>
        </>
      )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
          <div className="bg-white rounded-lg shadow-2xl p-8 w-full max-w-md">
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <Lock className="w-8 h-8 text-blue-600" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-center text-gray-900 mb-2">
              設定新密碼
            </h1>
            <div className="flex items-center justify-center gap-3 mt-8">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <p className="text-gray-600">載入中...</p>
            </div>
          </div>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
