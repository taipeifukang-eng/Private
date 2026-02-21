import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function InspectionDebugPage() {
  const supabase = await createClient();

  // 獲取當前用戶
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // 測試 1: 獲取用戶資料
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // 測試 2: 不使用關聯的簡單查詢
  const { data: simpleInspections, error: simpleError } = await supabase
    .from('inspection_masters')
    .select('id, inspector_id, store_id, inspection_date, status, grade')
    .limit(5);

  // 測試 3: 只包含 store 關聯
  const { data: withStore, error: storeError } = await supabase
    .from('inspection_masters')
    .select(`
      id,
      inspection_date,
      store:stores (
        store_name,
        store_code,
        short_name
      )
    `)
    .limit(5);

  // 測試 4: 只包含 inspector 關聯
  const { data: withInspector, error: inspectorError } = await supabase
    .from('inspection_masters')
    .select(`
      id,
      inspection_date,
      inspector:profiles!inspection_masters_inspector_id_fkey (
        full_name
      )
    `)
    .limit(5);

  // 測試 5: 完整查詢（和列表頁一樣）
  const { data: fullQuery, error: fullError } = await supabase
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
        store_code,
        short_name
      ),
      inspector:profiles!inspection_masters_inspector_id_fkey (
        id,
        full_name
      )
    `)
    .limit(5);

  // 測試 6: 檢查權限
  const { data: permissions, error: permError } = await supabase
    .from('user_roles')
    .select(`
      role:roles!inner (
        name,
        code,
        role_permissions!inner (
          is_allowed,
          permission:permissions!inner (code, name)
        )
      )
    `)
    .eq('user_id', user.id)
    .eq('is_active', true);

  // 測試 7: 檢查是否為督導
  const { data: asInspector, error: inspectorRoleError } = await supabase
    .from('inspection_masters')
    .select('id, inspection_date, status')
    .eq('inspector_id', user.id)
    .limit(5);

  // 測試 8: 檢查是否為店長
  const { data: storeManager, error: smError } = await supabase
    .from('store_managers')
    .select('store_id, role_type')
    .eq('user_id', user.id);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold mb-4">巡店系統診斷報告</h1>
          <p className="text-gray-600">當前用戶: {user.email}</p>
          <p className="text-gray-600">用戶 ID: {user.id}</p>
        </div>

        <TestResult 
          title="1. 用戶資料" 
          data={profile} 
          error={profileError} 
        />

        <TestResult 
          title="2. 簡單查詢（無關聯）" 
          data={simpleInspections} 
          error={simpleError} 
        />

        <TestResult 
          title="3. 帶 Store 關聯" 
          data={withStore} 
          error={storeError} 
        />

        <TestResult 
          title="4. 帶 Inspector 關聯" 
          data={withInspector} 
          error={inspectorError} 
        />

        <TestResult 
          title="5. 完整查詢" 
          data={fullQuery} 
          error={fullError} 
        />

        <TestResult 
          title="6. 用戶權限" 
          data={permissions} 
          error={permError} 
        />

        <TestResult 
          title="7. 作為督導的記錄" 
          data={asInspector} 
          error={inspectorRoleError} 
        />

        <TestResult 
          title="8. 店長身份" 
          data={storeManager} 
          error={smError} 
        />
      </div>
    </div>
  );
}

function TestResult({ title, data, error }: { title: string; data: any; error: any }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      
      {error ? (
        <div className="bg-red-50 border border-red-200 rounded p-4">
          <p className="text-red-800 font-semibold mb-2">❌ 錯誤</p>
          <pre className="text-sm text-red-600 overflow-x-auto">
            {JSON.stringify(error, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded p-4">
          <p className="text-green-800 font-semibold mb-2">
            ✅ 成功 {data && Array.isArray(data) ? `(${data.length} 筆記錄)` : ''}
          </p>
          <pre className="text-sm text-gray-700 overflow-x-auto max-h-96">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
