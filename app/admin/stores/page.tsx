import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Store, Plus, Users, MapPin, Phone, Edit, UserPlus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function StoresPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    redirect('/dashboard');
  }

  // 獲取所有門市
  const { data: stores } = await supabase
    .from('stores')
    .select('*')
    .order('store_code');

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
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
              <Store className="text-blue-600" size={40} />
              門市管理
            </h1>
            <p className="text-gray-600">管理所有門市及其負責人</p>
          </div>
          <Link
            href="/admin/stores/create"
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            <Plus size={20} />
            新增門市
          </Link>
        </div>

        {/* 門市列表 */}
        {!stores || stores.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <Store className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">尚未建立任何門市</h3>
            <p className="text-gray-600 mb-6">點擊上方按鈕開始新增門市</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {stores.map((store) => {
              const managers = storeManagersMap[store.id] || [];
              const employeeCount = storeEmployeeCount[store.id] || 0;
              
              return (
                <div
                  key={store.id}
                  className="bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow overflow-hidden"
                >
                  <div className="p-6">
                    {/* 門市標題 */}
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="text-sm text-blue-600 font-medium mb-1">
                          {store.store_code}
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">
                          {store.store_name}
                        </h3>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        store.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {store.is_active ? '營運中' : '已停止'}
                      </span>
                    </div>

                    {/* 門市資訊 */}
                    <div className="space-y-2 mb-4">
                      {store.address && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <MapPin size={16} className="text-gray-400" />
                          <span>{store.address}</span>
                        </div>
                      )}
                      {store.phone && (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Phone size={16} className="text-gray-400" />
                          <span>{store.phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Users size={16} className="text-gray-400" />
                        <span>{employeeCount} 位員工</span>
                      </div>
                    </div>

                    {/* 管理者列表 */}
                    <div className="border-t pt-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">門市管理者</h4>
                      {managers.length === 0 ? (
                        <p className="text-sm text-gray-500">尚未指派管理者</p>
                      ) : (
                        <div className="space-y-2">
                          {managers.map((manager) => (
                            <div key={manager.id} className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                                  <Users size={14} className="text-gray-600" />
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-gray-900">
                                    {manager.user?.full_name || manager.user?.email}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {getRoleLabel(manager.role_type)}
                                  </div>
                                </div>
                              </div>
                              {manager.is_primary && (
                                <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">
                                  主要
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 操作按鈕 */}
                    <div className="flex gap-2 mt-4 pt-4 border-t">
                      <Link
                        href={`/admin/stores/${store.id}/edit`}
                        className="flex-1 text-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                      >
                        <Edit size={16} className="inline mr-1" />
                        編輯
                      </Link>
                      <Link
                        href={`/admin/stores/${store.id}/employees`}
                        className="flex-1 text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                      >
                        <UserPlus size={16} className="inline mr-1" />
                        員工管理
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
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
