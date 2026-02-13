'use client';

import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

export default function InspectionListDebugPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [inspections, setInspections] = useState<any[]>([]);
  const [error, setError] = useState<string>('');
  const [queryLog, setQueryLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    console.log(msg);
    setQueryLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const supabase = createClient();
    
    try {
      addLog('🔍 開始查詢...');

      // 1. 獲取用戶
      const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!currentUser) {
        addLog('❌ 未登入');
        router.push('/login');
        return;
      }
      
      addLog(`✅ 用戶 ID: ${currentUser.id}`);
      setUser(currentUser);

      // 2. 計算日期範圍
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      addLog(`📅 日期範圍: ${sixMonthsAgo.toISOString()} 到現在`);

      // 3. 嘗試最簡單的查詢（無 JOIN）
      addLog('🔎 測試查詢 1: 無 JOIN，無日期限制');
      const { data: test1, error: error1 } = await supabase
        .from('inspection_masters')
        .select('id, inspector_id, inspection_date, status, created_at')
        .eq('inspector_id', currentUser.id);
      
      if (error1) {
        addLog(`❌ 測試 1 失敗: ${JSON.stringify(error1)}`);
      } else {
        addLog(`✅ 測試 1 成功: ${test1?.length || 0} 筆記錄`);
      }

      // 4. 嘗試帶日期範圍的查詢
      addLog('🔎 測試查詢 2: 無 JOIN，有日期限制');
      const { data: test2, error: error2 } = await supabase
        .from('inspection_masters')
        .select('id, inspector_id, inspection_date, status, created_at')
        .eq('inspector_id', currentUser.id)
        .gte('inspection_date', sixMonthsAgo.toISOString());
      
      if (error2) {
        addLog(`❌ 測試 2 失敗: ${JSON.stringify(error2)}`);
      } else {
        addLog(`✅ 測試 2 成功: ${test2?.length || 0} 筆記錄`);
      }

      // 5. 完整查詢（原列表頁的查詢）
      addLog('🔎 測試查詢 3: 完整查詢（JOIN stores + profiles）');
      const { data: inspectionsData, error: inspectionsError } = await supabase
        .from('inspection_masters')
        .select(`
          id,
          store_id,
          inspector_id,
          inspection_date,
          status,
          total_score,
          max_possible_score,
          grade,
          score_percentage,
          created_at,
          store:stores (
            id,
            store_name,
            store_code
          ),
          inspector:profiles!inspection_masters_inspector_id_fkey (
            id,
            full_name
          )
        `)
        .gte('inspection_date', sixMonthsAgo.toISOString())
        .order('inspection_date', { ascending: false });

      if (inspectionsError) {
        addLog(`❌ 測試 3 失敗: ${JSON.stringify(inspectionsError)}`);
        setError(JSON.stringify(inspectionsError));
      } else {
        addLog(`✅ 測試 3 成功: ${inspectionsData?.length || 0} 筆記錄`);
        setInspections(inspectionsData || []);
      }

    } catch (err: any) {
      addLog(`❌ 錯誤: ${err.message}`);
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
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">巡店列表除錯模式</h1>
          <div className="flex gap-4">
            <button
              onClick={loadData}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              重新載入
            </button>
            <a
              href="/inspection"
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              返回正式列表
            </a>
            <a
              href="/inspection/new"
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
            >
              <Plus size={20} />
              新增巡店
            </a>
          </div>
        </div>

        {/* 查詢日誌 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">📋 查詢日誌</h2>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm max-h-96 overflow-y-auto">
            {queryLog.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>

        {/* 用戶資訊 */}
        {user && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">👤 用戶資訊</h2>
            <div className="bg-gray-50 p-4 rounded font-mono text-sm">
              <div><strong>用戶 ID:</strong> {user.id}</div>
              <div><strong>Email:</strong> {user.email}</div>
            </div>
          </div>
        )}

        {/* 錯誤訊息 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold text-red-800 mb-4">❌ 錯誤</h2>
            <pre className="text-sm text-red-700 overflow-x-auto">{error}</pre>
          </div>
        )}

        {/* 查詢結果 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">
            📊 查詢結果：{inspections.length} 筆記錄
          </h2>
          
          {inspections.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg mb-2">沒有找到任何巡店記錄</p>
              <p className="text-sm">請檢查上方的查詢日誌以診斷問題</p>
            </div>
          ) : (
            <div className="space-y-4">
              {inspections.map((inspection: any) => {
                const store = Array.isArray(inspection.store) ? inspection.store[0] : inspection.store;
                const inspector = Array.isArray(inspection.inspector) ? inspection.inspector[0] : inspection.inspector;
                
                return (
                  <div key={inspection.id} className="border rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-lg">
                            {store?.store_name || '(無門市資料)'}
                          </h3>
                          <span className={`px-2 py-1 rounded text-xs ${
                            inspection.status === 'completed' ? 'bg-green-100 text-green-800' :
                            inspection.status === 'draft' ? 'bg-gray-100 text-gray-800' :
                            'bg-blue-100 text-blue-800'
                          }`}>
                            {inspection.status}
                          </span>
                          {inspection.grade && (
                            <span className="px-2 py-1 rounded text-xs bg-purple-100 text-purple-800">
                              評級: {inspection.grade}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <div>📅 巡店日期: {new Date(inspection.inspection_date).toLocaleDateString('zh-TW')}</div>
                          <div>👤 督導: {inspector?.full_name || '(無督導資料)'}</div>
                          <div>🎯 分數: {inspection.total_score || 0} / {inspection.max_possible_score || 0}</div>
                          <div>🕒 建立時間: {new Date(inspection.created_at).toLocaleString('zh-TW')}</div>
                        </div>
                      </div>
                      <a
                        href={`/inspection/${inspection.id}`}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        查看詳情
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 原始數據 */}
        {inspections.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mt-6">
            <h2 className="text-xl font-semibold mb-4">🔍 原始數據</h2>
            <pre className="bg-gray-900 text-green-400 p-4 rounded text-xs overflow-x-auto">
              {JSON.stringify(inspections, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
