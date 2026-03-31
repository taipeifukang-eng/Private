'use client';

import { useEffect, useMemo, useState } from 'react';

type PharmacistDetail = {
  id: string;
  employee_code: string;
  employee_name: string;
  position: string;
  change_type: string;
  change_note: string;
  store_code: string;
  store_name: string;
};

type SupervisorStoreCard = {
  supervisorZone: string;
  stores: Array<{
    storeId: string;
    storeCode: string;
    storeName: string;
    pharmacistCount: number;
    pharmacists: PharmacistDetail[];
  }>;
};

export default function PharmacistSupervisorCards({
  cards,
}: {
  cards: SupervisorStoreCard[];
}) {
  const [activeStore, setActiveStore] = useState<{
    supervisorZone: string;
    storeCode: string;
    storeName: string;
    pharmacists: PharmacistDetail[];
  } | null>(null);
  const [showResignedModal, setShowResignedModal] = useState(false);

  useEffect(() => {
    if (!activeStore && !showResignedModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeStore) {
        setActiveStore(null);
        return;
      }
      if (showResignedModal) {
        setShowResignedModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeStore, showResignedModal]);

  const allResigned = useMemo(
    () =>
      cards
        .flatMap((card) =>
          card.stores.flatMap((store) =>
            store.pharmacists.filter((p) => p.change_type === '離職')
          )
        )
        .sort((a, b) => a.store_code.localeCompare(b.store_code)),
    [cards]
  );

  const hasData = cards.length > 0;

  return (
    <>
      {allResigned.length > 0 && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowResignedModal(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-200 text-xs font-bold text-rose-800">
              {allResigned.length}
            </span>
            只看離職
          </button>
        </div>
      )}

      {!hasData ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500 shadow-sm">
          查無資料
        </div>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <section key={card.supervisorZone} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
                <h3 className="text-base font-semibold text-gray-900">{card.supervisorZone}</h3>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>門市數：{card.stores.length}</span>
                  <span>藥師數：{card.stores.reduce((sum, s) => sum + s.pharmacistCount, 0)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {card.stores.map((store) => (
                  <button
                    key={store.storeId}
                    type="button"
                    onClick={() =>
                      setActiveStore({
                        supervisorZone: card.supervisorZone,
                        storeCode: store.storeCode,
                        storeName: store.storeName,
                        pharmacists: store.pharmacists,
                      })
                    }
                    className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm text-gray-800 hover:border-blue-300 hover:bg-blue-50"
                  >
                    <span className="font-medium">{store.storeCode} {store.storeName}</span>
                    <span className="ml-1 text-gray-600">({store.pharmacistCount})</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* 門市藥師明細跳窗 */}
      {activeStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <div className="text-sm text-gray-500">{activeStore.supervisorZone}</div>
                <h4 className="text-lg font-semibold text-gray-900">
                  {activeStore.storeCode} {activeStore.storeName}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setActiveStore(null)}
                className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >
                關閉
              </button>
            </div>

            <div className="max-h-[65vh] overflow-auto p-4">
              {activeStore.pharmacists.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
                  本門市當月無藥師資料
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100 text-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">員編</th>
                      <th className="px-3 py-2 text-left font-semibold">姓名</th>
                      <th className="px-3 py-2 text-left font-semibold">該月職級</th>
                      <th className="px-3 py-2 text-left font-semibold">變化備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeStore.pharmacists.map((p) => (
                      <tr key={p.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono">{p.employee_code}</td>
                        <td className="px-3 py-2">{p.employee_name}</td>
                        <td className="px-3 py-2">{p.position}</td>
                        <td className="px-3 py-2 text-gray-600">{p.change_note || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 只看離職跳窗 */}
      {showResignedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h4 className="text-lg font-semibold text-rose-700">
                本月離職藥師（共 {allResigned.length} 人）
              </h4>
              <button
                type="button"
                onClick={() => setShowResignedModal(false)}
                className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >
                關閉
              </button>
            </div>

            <div className="max-h-[65vh] overflow-auto p-4">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-rose-50 text-rose-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">員編</th>
                    <th className="px-3 py-2 text-left font-semibold">姓名</th>
                    <th className="px-3 py-2 text-left font-semibold">職級</th>
                    <th className="px-3 py-2 text-left font-semibold">任職門市</th>
                    <th className="px-3 py-2 text-left font-semibold">離職日期</th>
                  </tr>
                </thead>
                <tbody>
                  {allResigned.map((p) => {
                    const resignDate = p.change_note.replace('離職', '').trim() || '-';
                    return (
                      <tr key={p.id} className="border-t border-gray-100 hover:bg-rose-50/40">
                        <td className="px-3 py-2 font-mono">{p.employee_code}</td>
                        <td className="px-3 py-2">{p.employee_name}</td>
                        <td className="px-3 py-2">{p.position}</td>
                        <td className="px-3 py-2">{p.store_code} {p.store_name}</td>
                        <td className="px-3 py-2 text-rose-700 font-medium">{resignDate}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
