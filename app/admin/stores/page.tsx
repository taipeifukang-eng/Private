import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Store, Plus, Users, MapPin, Phone, Edit, UserPlus, Building2, Hash, User, Copy, Eye, EyeOff } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function StoresPage({
  searchParams,
}: {
  searchParams: { showInactive?: string };
}) {
  const showInactive = searchParams.showInactive === 'true';
  
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, department, job_title')
    .eq('id', user.id)
    .single();

  // 檢查權限：admin、營業部主管（manager）或營業部助理（member）
  const isBusinessAssistant = profile?.department?.startsWith('營業') && profile?.role === 'member';
  const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager';
  
  if (!profile || (profile.role !== 'admin' && !isBusinessAssistant && !isBusinessSupervisor)) {
    redirect('/dashboard');
  }

  // 獲取所有門市（根據參數決定是否包含已停止的）
  const storesQuery = supabase
    .from('stores')
    .select('*')
    .order('store_code');
  
  // 如果不顯示已停止的，則只取營運中的門市
  if (!showInactive) {
    storesQuery.eq('is_active', true);
  }
  
  const { data: stores } = await storesQuery;
  
  // 計算已停止的門市數量
  const { count: inactiveCount } = await supabase
    .from('stores')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', false);

  // 獲取門市管理者資訊
  const { data: storeManagers } = await supabase
    .from('store_managers')
    .select(`
      *,
      user:profiles(id, email, full_name)
    `);

  // 獲取門市員工數量
  const { data: employeeCounts } = await supabase
    .from('store_employees')
    .select('store_id')
    .eq('is_active', true);

  // 計算每間門市的員工數
  const storeEmployeeCount: Record<string, number> = {};
  employeeCounts?.forEach(emp => {
    storeEmployeeCount[emp.store_id] = (storeEmployeeCount[emp.store_id] || 0) + 1;
  });

  // 組合門市管理者
  const storeManagersMap: Record<string, any[]> = {};
  storeManagers?.forEach(sm => {
    if (!storeManagersMap[sm.store_id]) {
      storeManagersMap[sm.store_id] = [];
    }
    storeManagersMap[sm.store_id].push(sm);
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
              <Store className="text-blue-600" size={40} />
              門市管理
            </h1>
            <p className="text-gray-600">管理所有門市及其負責人</p>
          </div>
          <div className="flex items-center gap-3">
            {/* 顯示/隱藏已停止門市按鈕 */}
            {(inactiveCount ?? 0) > 0 && (
              <Link
                href={showInactive ? '/admin/stores' : '/admin/stores?showInactive=true'}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-colors text-sm font-medium ${
                  showInactive 
                    ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {showInactive ? (
                  <>
                    <EyeOff size={18} />
                    隱藏已停止 ({inactiveCount})
                  </>
                ) : (
                  <>
                    <Eye size={18} />
                    顯示已停止 ({inactiveCount})
                  </>
                )}
              </Link>
            )}
            {/* 只有 admin 和營業部主管可以新增門市 */}
            {(profile?.role === 'admin' || isBusinessSupervisor) && (
              <Link
                href="/admin/stores/create"
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
              >
                <Plus size={20} />
                新增門市
              </Link>
            )}
          </div>
        </div>

        {/* 門市列表 */}
        {!stores || stores.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <Store className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">尚未建立任何門市</h3>
            <p className="text-gray-600 mb-6">點擊上方按鈕開始新增門市</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            {/* 表頭 */}
            <div className="bg-gray-50 border-b border-gray-200">
              <div className="grid grid-cols-12 gap-4 px-6 py-3 text-sm font-semibold text-gray-700">
                <div className="col-span-1">代碼</div>
                <div className="col-span-2">門市名稱</div>
                <div className="col-span-1">簡稱</div>
                <div className="col-span-1">負責人</div>
                <div className="col-span-2">地址</div>
                <div className="col-span-1">電話</div>
                <div className="col-span-1">員工</div>
                <div className="col-span-1">狀態</div>
                <div className="col-span-2 text-center">操作</div>
              </div>
            </div>
            
            {/* 表內容 */}
            <div className="divide-y divide-gray-200">
              {stores.map((store) => {
                const managers = storeManagersMap[store.id] || [];
                const employeeCount = storeEmployeeCount[store.id] || 0;
                
                return (
                  <div
                    key={store.id}
                    className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-gray-50 transition-colors"
                  >
                    {/* 代碼 */}
                    <div className="col-span-1">
                      <span className="font-mono text-blue-600 font-medium">{store.store_code}</span>
                    </div>
                    
                    {/* 門市名稱 */}
                    <div className="col-span-2">
                      <div className="font-semibold text-gray-900">{store.store_name}</div>
                      {managers.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          {managers.map(m => m.user?.full_name || m.user?.email).join(', ')}
                        </div>
                      )}
                    </div>
                    
                    {/* 簡稱 */}
                    <div className="col-span-1 text-sm text-gray-600">
                      {store.short_name || '-'}
                    </div>
                    
                    {/* 負責人 */}
                    <div className="col-span-1 text-sm text-gray-700 font-medium">
                      {store.manager_name || '-'}
                    </div>
                    
                    {/* 地址 */}
                    <div className="col-span-2 text-sm text-gray-600 truncate" title={store.address || ''}>
                      {store.address || '-'}
                    </div>
                    
                    {/* 電話 */}
                    <div className="col-span-1 text-sm text-gray-600">
                      {store.phone || '-'}
                    </div>
                    
                    {/* 員工數 */}
                    <div className="col-span-1">
                      <span className="inline-flex items-center gap-1 text-sm text-gray-600">
                        <Users size={14} className="text-gray-400" />
                        {employeeCount}
                      </span>
                    </div>
                    
                    {/* 狀態 */}
                    <div className="col-span-1">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        store.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {store.is_active ? '營運中' : '已停止'}
                      </span>
                    </div>
                    
                    {/* 操作按鈕 */}
                    <div className="col-span-2 flex gap-1 justify-center flex-wrap">
                      {/* admin 和營業部主管可以編輯門市 */}
                      {(profile?.role === 'admin' || isBusinessSupervisor) && (
                        <Link
                          href={`/admin/stores/${store.id}/edit`}
                          className="px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-xs font-medium"
                          title="編輯門市"
                        >
                          <Edit size={12} className="inline mr-1" />
                          編輯
                        </Link>
                      )}
                      <Link
                        href={`/admin/stores/${store.id}/employees`}
                        className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs font-medium"
                        title="管理員工"
                      >
                        <UserPlus size={12} className="inline mr-1" />
                        員工
                      </Link>
                      {/* admin 和營業部主管可以搬遷門市 */}
                      {store.is_active && (profile?.role === 'admin' || isBusinessSupervisor) && (
                        <Link
                          href={`/admin/stores/${store.id}/clone`}
                          className="px-2 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors text-xs font-medium"
                          title="複製/搬遷門市"
                        >
                          <Copy size={12} className="inline mr-1" />
                          搬遷
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            {/* 表尾統計 */}
            <div className="bg-gray-50 border-t border-gray-200 px-6 py-3">
              <div className="text-sm text-gray-600 flex items-center gap-4">
                <span>
                  共 <span className="font-semibold text-gray-900">{stores.length}</span> 間門市
                  {showInactive && (inactiveCount ?? 0) > 0 && (
                    <span className="text-gray-500 ml-2">
                      （含 <span className="text-orange-600">{inactiveCount}</span> 間已停止）
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getRoleLabel(roleType: string): string {
  const labels: Record<string, string> = {
    'store_manager': '店長',
    'supervisor': '督導',
    'area_manager': '區經理'
  };
  return labels[roleType] || roleType;
}
