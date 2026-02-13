'use client';

import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';

export default function DiagnosticPage() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [inspections, setInspections] = useState<any[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [testResults, setTestResults] = useState<Record<string, any>>({});

  useEffect(() => {
    runDiagnostics();
  }, []);

  const runDiagnostics = async () => {
    const supabase = createClient();
    const results: Record<string, any> = {};

    try {
      // 測試 1: 獲取當前用戶
      const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();
      results.test1 = { success: !!currentUser, data: currentUser, error: userError };
      setUser(currentUser);

      if (!currentUser) {
        setError('未登入');
        setLoading(false);
        return;
      }

      // 測試 2: 獲取 profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();
      results.test2 = { success: !!profileData, data: profileData, error: profileError };
      setProfile(profileData);

      // 測試 3: 最簡單的查詢（無 JOIN）
      const { data: simpleData, error: simpleError } = await supabase
        .from('inspection_masters')
        .select('id, inspector_id, inspection_date, status, created_at')
        .eq('inspector_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(5);
      results.test3 = { 
        success: !simpleError, 
        count: simpleData?.length || 0,
        data: simpleData, 
        error: simpleError 
      };

      // 測試 4: JOIN stores（LEFT JOIN）
      const { data: withStoresData, error: withStoresError } = await supabase
        .from('inspection_masters')
        .select(`
          id,
          inspector_id,
          inspection_date,
          status,
          created_at,
          store:stores (
            id,
            store_name,
            store_code
          )
        `)
        .eq('inspector_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(5);
      results.test4 = { 
        success: !withStoresError, 
        count: withStoresData?.length || 0,
        data: withStoresData, 
        error: withStoresError 
      };

      // 測試 5: 完整查詢（包含 profiles JOIN）
      const { data: fullData, error: fullError } = await supabase
        .from('inspection_masters')
        .select(`
          id,
          inspector_id,
          inspection_date,
          status,
          grade,
          created_at,
          store:stores (
            id,
            store_name,
            store_code
          ),
          inspector:profiles (
            id,
            full_name
          )
        `)
        .eq('inspector_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(5);
      results.test5 = { 
        success: !fullError, 
        count: fullData?.length || 0,
        data: fullData, 
        error: fullError 
      };

      setInspections(fullData || []);
      setTestResults(results);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">執行診斷中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">巡店系統診斷報告</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-6">
            錯誤: {error}
          </div>
        )}

        {/* 測試 1: 用戶資訊 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            {testResults.test1?.success ? '✅' : '❌'} 測試 1: 用戶登入狀態
          </h2>
          <div className="bg-gray-50 p-4 rounded font-mono text-sm">
            <div><strong>用戶 ID:</strong> {user?.id || 'N/A'}</div>
            <div><strong>Email:</strong> {user?.email || 'N/A'}</div>
          </div>
        </div>

        {/* 測試 2: Profile */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            {testResults.test2?.success ? '✅' : '❌'} 測試 2: Profile 資料
          </h2>
          <div className="bg-gray-50 p-4 rounded font-mono text-sm">
            {profile ? (
              <>
                <div><strong>姓名:</strong> {profile.full_name || 'N/A'}</div>
                <div><strong>角色:</strong> {profile.role || 'N/A'}</div>
                <div><strong>員工編號:</strong> {profile.employee_code || 'N/A'}</div>
              </>
            ) : (
              <div className="text-red-600">無 Profile 資料</div>
            )}
          </div>
          {testResults.test2?.error && (
            <div className="mt-2 text-red-600 text-sm">
              錯誤: {JSON.stringify(testResults.test2.error)}
            </div>
          )}
        </div>

        {/* 測試 3: 簡單查詢 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            {testResults.test3?.success ? '✅' : '❌'} 測試 3: 簡單查詢（無 JOIN）
          </h2>
          <div className="bg-gray-50 p-4 rounded">
            <div className="font-semibold mb-2">找到 {testResults.test3?.count || 0} 筆記錄</div>
            {testResults.test3?.data && testResults.test3.data.length > 0 ? (
              <pre className="text-xs overflow-x-auto">
                {JSON.stringify(testResults.test3.data, null, 2)}
              </pre>
            ) : (
              <div className="text-gray-500">無記錄</div>
            )}
          </div>
          {testResults.test3?.error && (
            <div className="mt-2 text-red-600 text-sm">
              錯誤: {JSON.stringify(testResults.test3.error)}
            </div>
          )}
        </div>

        {/* 測試 4: JOIN stores */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            {testResults.test4?.success ? '✅' : '❌'} 測試 4: JOIN stores
          </h2>
          <div className="bg-gray-50 p-4 rounded">
            <div className="font-semibold mb-2">找到 {testResults.test4?.count || 0} 筆記錄</div>
            {testResults.test4?.data && testResults.test4.data.length > 0 ? (
              <pre className="text-xs overflow-x-auto">
                {JSON.stringify(testResults.test4.data, null, 2)}
              </pre>
            ) : (
              <div className="text-gray-500">無記錄</div>
            )}
          </div>
          {testResults.test4?.error && (
            <div className="mt-2 text-red-600 text-sm">
              錯誤: {JSON.stringify(testResults.test4.error)}
            </div>
          )}
        </div>

        {/* 測試 5: 完整查詢 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            {testResults.test5?.success ? '✅' : '❌'} 測試 5: 完整查詢（JOIN stores + profiles）
          </h2>
          <div className="bg-gray-50 p-4 rounded">
            <div className="font-semibold mb-2">找到 {testResults.test5?.count || 0} 筆記錄</div>
            {testResults.test5?.data && testResults.test5.data.length > 0 ? (
              <pre className="text-xs overflow-x-auto">
                {JSON.stringify(testResults.test5.data, null, 2)}
              </pre>
            ) : (
              <div className="text-gray-500">無記錄</div>
            )}
          </div>
          {testResults.test5?.error && (
            <div className="mt-2 text-red-600 text-sm">
              錯誤: {JSON.stringify(testResults.test5.error)}
            </div>
          )}
        </div>

        {/* 診斷結論 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">🔍 診斷結論</h2>
          <ul className="space-y-2 text-sm">
            <li>
              {testResults.test3?.count > 0 ? (
                <span className="text-green-600">✅ 基本查詢成功：RLS 策略允許查詢</span>
              ) : (
                <span className="text-red-600">❌ 基本查詢失敗：RLS 策略可能有問題</span>
              )}
            </li>
            <li>
              {testResults.test4?.count > 0 ? (
                <span className="text-green-600">✅ stores JOIN 成功</span>
              ) : testResults.test4?.count === 0 && testResults.test3?.count > 0 ? (
                <span className="text-orange-600">⚠️ stores JOIN 失敗：門市資料可能有問題</span>
              ) : (
                <span className="text-gray-600">⏭️ 跳過（基本查詢已失敗）</span>
              )}
            </li>
            <li>
              {testResults.test5?.count > 0 ? (
                <span className="text-green-600">✅ 完整查詢成功：所有 JOIN 正常</span>
              ) : testResults.test5?.count === 0 && testResults.test4?.count > 0 ? (
                <span className="text-orange-600">⚠️ profiles JOIN 失敗：督導資料可能有問題</span>
              ) : (
                <span className="text-gray-600">⏭️ 跳過（前面查詢已失敗）</span>
              )}
            </li>
          </ul>
        </div>

        <div className="mt-6 flex gap-4">
          <button
            onClick={runDiagnostics}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            重新執行診斷
          </button>
          <a
            href="/inspection"
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            返回列表頁
          </a>
        </div>
      </div>
    </div>
  );
}
