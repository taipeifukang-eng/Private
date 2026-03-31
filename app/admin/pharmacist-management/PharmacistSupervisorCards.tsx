'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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

type SearchCandidate = {
  employee_code: string;
  employee_name: string;
  position?: string;
  from_store_name?: string;
  source?: string;
};

export default function PharmacistSupervisorCards({
  cards,
  selectedYearMonth,
  canEdit,
}: {
  cards: SupervisorStoreCard[];
  selectedYearMonth: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [activeStore, setActiveStore] = useState<{
    supervisorZone: string;
    storeId: string;
    storeCode: string;
    storeName: string;
    pharmacists: PharmacistDetail[];
  } | null>(null);
  const [showResignedModal, setShowResignedModal] = useState(false);
  const [newEmployeeCode, setNewEmployeeCode] = useState('');
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newPosition, setNewPosition] = useState('藥師');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchCandidate[]>([]);
  const [searchError, setSearchError] = useState('');

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

  useEffect(() => {
    if (!activeStore) {
      setNewEmployeeCode('');
      setNewEmployeeName('');
      setNewPosition('藥師');
      setAddError('');
      setSearchTerm('');
      setSearchResults([]);
      setSearchError('');
    }
  }, [activeStore]);

  useEffect(() => {
    if (!activeStore) return;
    const q = searchTerm.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchError('');
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError('');
      try {
        const res = await fetch(`/api/monthly-staff-by-store/search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setSearchResults([]);
          setSearchError(json?.error || '查詢失敗');
          return;
        }
        const list = Array.isArray(json.data) ? json.data : [];
        setSearchResults(list.slice(0, 10));
      } catch {
        if (!cancelled) {
          setSearchResults([]);
          setSearchError('查詢失敗，請稍後再試');
        }
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm, activeStore]);

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
                        storeId: store.storeId,
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
              {canEdit && (
                <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
                  <div className="mb-2 text-sm font-semibold text-blue-800">手動新增該月藥師</div>
                  <div className="mb-2">
                    <input
                      type="text"
                      placeholder="先搜尋員編 / 姓名（至少 2 個字）"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    {isSearching && <div className="mt-1 text-xs text-blue-700">查詢中…</div>}
                    {searchError && <div className="mt-1 text-xs text-rose-600">{searchError}</div>}
                    {!isSearching && searchResults.length > 0 && (
                      <div className="mt-2 max-h-40 overflow-auto rounded border border-blue-200 bg-white">
                        {searchResults.map((r) => (
                          <button
                            key={`${r.employee_code}-${r.employee_name}`}
                            type="button"
                            onClick={() => {
                              setNewEmployeeCode((r.employee_code || '').toUpperCase());
                              setNewEmployeeName(r.employee_name || '');
                              setNewPosition((r.position || '').trim() || '藥師');
                              setSearchTerm(`${r.employee_code} ${r.employee_name}`.trim());
                              setSearchResults([]);
                            }}
                            className="block w-full border-b border-gray-100 px-2 py-1.5 text-left text-xs hover:bg-blue-50 last:border-b-0"
                          >
                            <div className="font-medium text-gray-800">{r.employee_code} {r.employee_name}</div>
                            <div className="text-gray-500">{r.position || '-'} {r.from_store_name ? `｜${r.from_store_name}` : ''}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                    <input
                      type="text"
                      placeholder="員編 (例 FK0171)"
                      value={newEmployeeCode}
                      onChange={(e) => setNewEmployeeCode(e.target.value.toUpperCase())}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="姓名"
                      value={newEmployeeName}
                      onChange={(e) => setNewEmployeeName(e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <input
                      type="text"
                      placeholder="職級"
                      value={newPosition}
                      onChange={(e) => setNewPosition(e.target.value)}
                      className="rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      disabled={isAdding}
                      onClick={async () => {
                        if (!activeStore) return;
                        if (!newEmployeeCode.trim() || !newEmployeeName.trim()) {
                          setAddError('員編與姓名為必填');
                          return;
                        }
                        setAddError('');
                        setIsAdding(true);
                        try {
                          const res = await fetch('/api/pharmacist-monthly-snapshot/manual-add', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              year_month: selectedYearMonth,
                              store_id: activeStore.storeId,
                              employee_code: newEmployeeCode.trim().toUpperCase(),
                              employee_name: newEmployeeName.trim(),
                              position: newPosition.trim() || '藥師',
                            }),
                          });
                          const json = await res.json();
                          if (!res.ok) {
                            setAddError(json?.error || '新增失敗');
                            return;
                          }

                          const addedCode = newEmployeeCode.trim().toUpperCase();
                          const addedName = newEmployeeName.trim();
                          const addedPosition = newPosition.trim() || '藥師';
                          const addedId = json?.data?.id || `manual-${activeStore.storeId}-${addedCode}`;

                          // 新增成功後立即更新當前彈窗列表，避免需要關閉再重開
                          setActiveStore((prev) => {
                            if (!prev) return prev;
                            const existingIdx = prev.pharmacists.findIndex((p) => p.employee_code === addedCode);
                            const next = [...prev.pharmacists];
                            const addedRow: PharmacistDetail = {
                              id: String(addedId),
                              employee_code: addedCode,
                              employee_name: addedName,
                              position: addedPosition,
                              change_type: '新增任職',
                              change_note: '手動新增',
                              store_code: prev.storeCode,
                              store_name: prev.storeName,
                            };

                            if (existingIdx >= 0) {
                              next[existingIdx] = { ...next[existingIdx], ...addedRow };
                            } else {
                              next.push(addedRow);
                            }

                            next.sort((a, b) => a.employee_code.localeCompare(b.employee_code));
                            return { ...prev, pharmacists: next };
                          });

                          setNewEmployeeCode('');
                          setNewEmployeeName('');
                          setNewPosition('藥師');
                          router.refresh();
                        } catch {
                          setAddError('新增失敗，請稍後再試');
                        } finally {
                          setIsAdding(false);
                        }
                      }}
                      className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isAdding ? '新增中…' : '新增'}
                    </button>
                  </div>
                  {addError && <div className="mt-2 text-xs text-rose-600">{addError}</div>}
                  <div className="mt-2 text-xs text-blue-700">此功能會新增到固定月藥師快照，避免每月人員狀態遺漏。</div>
                </div>
              )}

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
