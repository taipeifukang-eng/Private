'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';

type StoreItem = {
  id: string;
  store_name: string;
  store_code: string;
  short_name?: string | null;
};

type Props = {
  inspectedStores: StoreItem[];
  notInspectedStores: StoreItem[];
};

export default function InspectionStoreStatus({ inspectedStores, notInspectedStores }: Props) {
  const [inspectedOpen, setInspectedOpen] = useState(false);
  const [notInspectedOpen, setNotInspectedOpen] = useState(true);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      {/* 已巡店門市 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setInspectedOpen(!inspectedOpen)}
          className="w-full px-6 py-4 border-b border-gray-200 bg-green-50 flex items-center justify-between hover:bg-green-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-semibold text-green-800">
              本月已巡店（{inspectedStores.length}）
            </h3>
          </div>
          {inspectedOpen ? (
            <ChevronUp className="w-5 h-5 text-green-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-green-600" />
          )}
        </button>
        {inspectedOpen && (
          <div className="p-4">
            {inspectedStores.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">本月尚無已巡店門市</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {inspectedStores.map((store) => (
                  <span
                    key={store.id}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium bg-green-100 text-green-800 border border-green-200"
                  >
                    {store.short_name || store.store_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 尚未巡店門市 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={() => setNotInspectedOpen(!notInspectedOpen)}
          className="w-full px-6 py-4 border-b border-gray-200 bg-red-50 flex items-center justify-between hover:bg-red-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-600" />
            <h3 className="text-lg font-semibold text-red-800">
              本月尚未巡店（{notInspectedStores.length}）
            </h3>
          </div>
          {notInspectedOpen ? (
            <ChevronUp className="w-5 h-5 text-red-600" />
          ) : (
            <ChevronDown className="w-5 h-5 text-red-600" />
          )}
        </button>
        {notInspectedOpen && (
          <div className="p-4">
            {notInspectedStores.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">本月所有門市皆已巡店 &#127881;</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {notInspectedStores.map((store) => (
                  <span
                    key={store.id}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-800 border border-red-200"
                  >
                    {store.short_name || store.store_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
