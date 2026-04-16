'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AlertCircle, Loader2, Package, ScanLine } from 'lucide-react';
import StandardProductsMasterTab from '@/components/products-master/StandardProductsMasterTab';
import AcquisitionProductsTab from '@/components/products-master/AcquisitionProductsTab';

type RootTab = 'standard' | 'acquisition';

export default function ProductsMasterPage() {
  const supabase = createClient();
  const [canManage, setCanManage] = useState(false);
  const [permLoading, setPermLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<RootTab>('standard');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setPermLoading(false);
        return;
      }

      const res = await fetch('/api/permissions/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionCode: 'store.products_master.manage' }),
      });
      const data = await res.json();
      setCanManage(data.allowed || false);
      setPermLoading(false);
    })();
  }, [supabase]);

  if (permLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        <div className="text-center space-y-2">
          <AlertCircle className="w-10 h-10 mx-auto text-red-400" />
          <p className="text-lg font-medium">沒有存取此頁面的權限</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">商品主檔</h1>
            <p className="text-sm text-gray-500 mt-1">維護一般商品主檔，並整合併購藥局商品整理流程</p>
          </div>
          <div className="inline-flex rounded-2xl border border-gray-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setActiveTab('standard')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'standard' ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Package className="w-4 h-4" />
              商品主檔
            </button>
            <button
              onClick={() => setActiveTab('acquisition')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'acquisition' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <ScanLine className="w-4 h-4" />
              併購藥局商品主檔整理
            </button>
          </div>
        </div>

        {activeTab === 'standard' ? <StandardProductsMasterTab /> : <AcquisitionProductsTab />}
      </div>
    </div>
  );
}
