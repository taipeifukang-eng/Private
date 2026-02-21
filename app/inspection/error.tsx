'use client';

import Link from 'next/link';

export default function InspectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full">
        <div className="text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">⚠️</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">巡店頁面載入異常</h1>
          <p className="text-gray-600 mb-4">系統遇到問題，請稍後再試</p>
          {error?.message && (
            <pre className="bg-gray-100 p-4 rounded text-sm text-left overflow-auto max-h-48 mb-6 text-red-600">
              {error.message}
            </pre>
          )}
          {error?.digest && (
            <p className="text-xs text-gray-400 mb-4">Digest: {error.digest}</p>
          )}
          <div className="flex gap-4 justify-center">
            <Link
              href="/dashboard"
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              返回首頁
            </Link>
            <button
              onClick={() => reset()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              重新載入
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
