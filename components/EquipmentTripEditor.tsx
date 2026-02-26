'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Loader2, Save, X, RotateCcw, Truck } from 'lucide-react';
import { CampaignEquipmentTrip, EQUIPMENT_SET_COLORS, FIXED_LOCATIONS } from '@/types/workflow';

// ─────────────────────────────────────────────
// 型別
// ─────────────────────────────────────────────
interface StoreOption { id: string; store_name: string; store_code: string; }

interface EquipmentTripEditorProps {
  campaignId: string;
  campaignStartDate: string; // YYYY-MM-DD
  campaignEndDate:   string;
  stores: StoreOption[];
  canEdit: boolean;
}

interface TripModalState {
  open: boolean;
  mode: 'add' | 'edit';
  trip: Partial<CampaignEquipmentTrip> & { id?: string };
}

const SET_LABELS = [1, 2, 3, 4, 5] as const;
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'];

function abbrev(loc: string) {
  if (loc === '林森街倉庫') return '林森';
  if (loc === '車上')       return '車上';
  return loc.replace(/富康|藥局|百福/g, '').slice(0, 6);
}

function getCalendarDates(start: string, end: string) {
  const dates: Date[] = [];
  const s = new Date(start), e = new Date(end);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) dates.push(new Date(d));
  return dates;
}

function buildMonthGroups(dates: Date[]) {
  const map = new Map<string, Date[]>();
  dates.forEach(d => {
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(d);
  });
  return map;
}

// ─────────────────────────────────────────────
// 主元件
// ─────────────────────────────────────────────
export default function EquipmentTripEditor({
  campaignId, campaignStartDate, campaignEndDate, stores, canEdit,
}: EquipmentTripEditorProps) {
  const [trips,   setTrips]   = useState<CampaignEquipmentTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [dragSet, setDragSet] = useState<number | null>(null);

  const [modal, setModal] = useState<TripModalState>({
    open: false, mode: 'add',
    trip: { set_number: 1, trip_date: '', from_location: '林森街倉庫', to_location: '' },
  });
  const [modalError, setModalError] = useState<string | null>(null);

  // 所有可選地點 = 固定 2 個 + stores
  const locationOptions = [
    ...FIXED_LOCATIONS,
    ...stores.map(s => s.store_name),
  ];

  // ── 載入車次資料 ──
  const loadTrips = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaign-equipment-trips?campaign_id=${campaignId}`);
      const data = await res.json();
      if (data.success) setTrips(data.data);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { loadTrips(); }, [loadTrips]);

  // ── 套次當前位置 (最後一筆車次的 to_location) ──
  const setCurrentLocation = (setNum: number): string => {
    const setTrips = trips
      .filter(t => t.set_number === setNum)
      .sort((a, b) => a.trip_date.localeCompare(b.trip_date));
    return setTrips.length > 0 ? setTrips[setTrips.length - 1].to_location : '林森街倉庫';
  };

  // ── 開啟新增 Modal ──
  const openAdd = (date: Date, preSetNum?: number) => {
    if (!canEdit) return;
    setModalError(null);
    setModal({
      open: true, mode: 'add',
      trip: {
        set_number: (preSetNum ?? 1) as 1|2|3|4|5,
        trip_date: date.toISOString().split('T')[0],
        from_location: preSetNum ? setCurrentLocation(preSetNum) : '林森街倉庫',
        to_location: '',
        notes: '',
      },
    });
  };

  // ── 開啟編輯 Modal ──
  const openEdit = (trip: CampaignEquipmentTrip) => {
    if (!canEdit) return;
    setModalError(null);
    setModal({ open: true, mode: 'edit', trip: { ...trip } });
  };

  // ── 儲存 ──
  const handleSave = async () => {
    const { trip, mode } = modal;
    if (!trip.trip_date || !trip.from_location || !trip.to_location) {
      setModalError('請填寫日期、起點與終點'); return;
    }
    if (trip.from_location === trip.to_location) {
      setModalError('起點與終點不可相同'); return;
    }
    setSaving(true);
    setModalError(null);
    try {
      let res: Response;
      if (mode === 'add') {
        res = await fetch('/api/campaign-equipment-trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaign_id: campaignId, ...trip }),
        });
      } else {
        res = await fetch('/api/campaign-equipment-trips', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trip),
        });
      }
      const data = await res.json();
      if (data.success) {
        setModal(m => ({ ...m, open: false }));
        loadTrips();
      } else {
        setModalError(data.error || '儲存失敗');
      }
    } finally {
      setSaving(false);
    }
  };

  // ── 刪除 ──
  const handleDelete = async (id: string) => {
    if (!confirm('確定刪除此車次？')) return;
    await fetch(`/api/campaign-equipment-trips?id=${id}`, { method: 'DELETE' });
    loadTrips();
  };

  // ── 日曆計算 ──
  const calendarDates = getCalendarDates(campaignStartDate, campaignEndDate);
  const monthGroups = buildMonthGroups(calendarDates);

  const tripsForDate = (date: Date) => {
    const ds = date.toISOString().split('T')[0];
    return trips.filter(t => t.trip_date === ds).sort((a, b) => a.set_number - b.set_number);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="animate-spin mr-2" size={20} /> 載入中...
      </div>
    );
  }

  return (
    <div>
      {/* ── 套次狀態列 ── */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-1">
          <Truck size={14} /> 活動用品目前位置
          {canEdit && <span className="text-xs text-gray-400 ml-2">（可拖曳套次卡片到日期格）</span>}
        </h3>
        <div className="flex flex-wrap gap-3">
          {SET_LABELS.map(num => {
            const c = EQUIPMENT_SET_COLORS[num];
            const loc = setCurrentLocation(num);
            return (
              <div
                key={num}
                draggable={canEdit}
                onDragStart={() => setDragSet(num)}
                onDragEnd={() => setDragSet(null)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 ${c.bg} ${c.border} ${c.text} font-medium text-sm ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} select-none`}
              >
                <span className="font-bold">套{num}</span>
                <span className="text-xs opacity-80">📍{abbrev(loc)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 月曆 ── */}
      {Array.from(monthGroups.entries()).map(([monthKey, dates]) => {
        const firstDate  = dates[0];
        const blanks     = firstDate.getDay() === 0 ? 6 : firstDate.getDay() - 1;
        const rows: (Date | null)[][] = [];
        let row: (Date | null)[] = new Array(blanks).fill(null);
        dates.forEach(d => {
          if (row.length === 7) { rows.push(row); row = []; }
          row.push(d);
        });
        while (row.length < 7 && row.length > 0) row.push(null);
        if (row.length) rows.push(row);

        return (
          <div key={monthKey} className="mb-8">
            {/* 月份標題 */}
            <div className="bg-gradient-to-r from-teal-500 to-cyan-500 text-white px-4 py-2.5 rounded-t-lg flex items-center gap-2">
              <Truck size={16} />
              <span className="font-bold">{firstDate.getFullYear()}年 {firstDate.getMonth() + 1}月</span>
            </div>

            {/* 星期 header */}
            <div className="grid grid-cols-7 border-x border-gray-200 bg-gray-50">
              {['一','二','三','四','五','六','日'].map(d => (
                <div key={d} className="py-2 text-center text-xs font-semibold text-gray-600 border-r last:border-r-0 border-gray-200">
                  {d}
                </div>
              ))}
            </div>

            {/* 日期格 */}
            {rows.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 border-b border-x border-gray-200">
                {week.map((date, di) => {
                  if (!date) {
                    return <div key={di} className="min-h-[110px] bg-gray-100 border-r last:border-r-0 border-gray-200" />;
                  }
                  const dayTrips = tripsForDate(date);
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                  return (
                    <div
                      key={date.toISOString()}
                      className={`min-h-[110px] p-1.5 border-r last:border-r-0 border-gray-200 ${isWeekend ? 'bg-blue-50/40' : 'bg-white'} relative group`}
                      onDragOver={canEdit ? e => e.preventDefault() : undefined}
                      onDrop={canEdit ? e => {
                        e.preventDefault();
                        if (dragSet) openAdd(date, dragSet);
                      } : undefined}
                    >
                      {/* 日期數字 + 加號按鈕 */}
                      <div className="flex items-start justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-700">
                          {date.getDate()}
                          <span className="text-gray-400 ml-0.5 font-normal">{WEEKDAY_ZH[date.getDay()]}</span>
                        </span>
                        {canEdit && (
                          <button
                            onClick={() => openAdd(date)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded bg-teal-500 text-white hover:bg-teal-600"
                          >
                            <Plus size={11} />
                          </button>
                        )}
                      </div>

                      {/* 車次 pills */}
                      <div className="space-y-0.5">
                        {dayTrips.map(trip => {
                          const c = EQUIPMENT_SET_COLORS[trip.set_number];
                          return (
                            <div
                              key={trip.id}
                              onClick={() => canEdit && openEdit(trip)}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${c.bg} ${c.border} ${c.text} ${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'} flex items-center gap-1`}
                              title={`套${trip.set_number}: ${trip.from_location} → ${trip.to_location}${trip.notes ? ` (${trip.notes})` : ''}`}
                            >
                              <span className="font-bold shrink-0">套{trip.set_number}</span>
                              <span className="truncate">{abbrev(trip.from_location)}→{abbrev(trip.to_location)}</span>
                            </div>
                          );
                        })}
                        {dayTrips.length === 0 && canEdit && (
                          <div className="text-[10px] text-gray-300 text-center py-1 border border-dashed border-gray-200 rounded">
                            拖放套次
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}

      {/* ── 清單彙整（依套次） ── */}
      {trips.length > 0 && (
        <div className="mt-4 bg-gray-50 rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-3">車次彙整（依套次）</h3>
          <div className="space-y-3">
            {SET_LABELS.map(num => {
              const setT = trips.filter(t => t.set_number === num).sort((a, b) => a.trip_date.localeCompare(b.trip_date));
              if (setT.length === 0) return null;
              const c = EQUIPMENT_SET_COLORS[num];
              return (
                <div key={num}>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${c.bg} ${c.border} ${c.text} border mb-1`}>套{num}</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {setT.map(t => (
                      <span key={t.id} className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border ${c.bg} ${c.border} ${c.text}`}>
                        {new Date(t.trip_date).toLocaleDateString('zh-TW',{month:'2-digit',day:'2-digit'})}
                        &nbsp;{abbrev(t.from_location)}→{abbrev(t.to_location)}
                        {canEdit && (
                          <button onClick={() => handleDelete(t.id)} className="ml-1 opacity-50 hover:opacity-100 text-red-500">
                            <X size={10} />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modal ── */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Truck size={18} className="text-teal-600" />
                {modal.mode === 'add' ? '新增車次' : '編輯車次'}
              </h3>
              <button onClick={() => setModal(m => ({ ...m, open: false }))} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* 套次 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">活動用品套次</label>
                <div className="grid grid-cols-5 gap-2">
                  {SET_LABELS.map(num => {
                    const c = EQUIPMENT_SET_COLORS[num];
                    const active = modal.trip.set_number === num;
                    return (
                      <button
                        key={num}
                        onClick={() => setModal(m => ({ ...m, trip: { ...m.trip, set_number: num } }))}
                        className={`py-2 rounded-lg border-2 text-sm font-bold transition-all ${
                          active ? `${c.bg} ${c.border} ${c.text} scale-105 shadow` : 'bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300'
                        }`}
                      >
                        套{num}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 日期 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
                <input
                  type="date"
                  value={modal.trip.trip_date || ''}
                  min={campaignStartDate}
                  max={campaignEndDate}
                  onChange={e => setModal(m => ({ ...m, trip: { ...m.trip, trip_date: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>

              {/* 起點 → 終點 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">從（起點）</label>
                  <select
                    value={modal.trip.from_location || ''}
                    onChange={e => setModal(m => ({ ...m, trip: { ...m.trip, from_location: e.target.value } }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">選擇起點...</option>
                    <optgroup label="固定地點">
                      {FIXED_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                    </optgroup>
                    <optgroup label="門市">
                      {stores.map(s => <option key={s.id} value={s.store_name}>{s.store_name}（{s.store_code}）</option>)}
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">到（終點）</label>
                  <select
                    value={modal.trip.to_location || ''}
                    onChange={e => setModal(m => ({ ...m, trip: { ...m.trip, to_location: e.target.value } }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">選擇終點...</option>
                    <optgroup label="固定地點">
                      {FIXED_LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                    </optgroup>
                    <optgroup label="門市">
                      {stores.map(s => <option key={s.id} value={s.store_name}>{s.store_name}（{s.store_code}）</option>)}
                    </optgroup>
                  </select>
                </div>
              </div>

              {/* 備註 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">備註（選填）</label>
                <input
                  type="text"
                  placeholder="例：需在 09:00 前到達"
                  value={modal.trip.notes || ''}
                  onChange={e => setModal(m => ({ ...m, trip: { ...m.trip, notes: e.target.value } }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* 錯誤訊息 */}
              {modalError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span className="mt-0.5">❌</span>{modalError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex items-center justify-between gap-3">
              {/* 刪除按鈕（僅編輯模式） */}
              {modal.mode === 'edit' && modal.trip.id ? (
                <button
                  onClick={() => { handleDelete(modal.trip.id!); setModal(m => ({ ...m, open: false })); }}
                  className="flex items-center gap-1.5 px-4 py-2 text-red-600 border border-red-300 rounded-lg hover:bg-red-50 text-sm"
                >
                  <Trash2 size={14} /> 刪除
                </button>
              ) : <div />}

              <div className="flex gap-2">
                <button
                  onClick={() => setModal(m => ({ ...m, open: false }))}
                  className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm"
                >
                  <RotateCcw size={14} /> 取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-5 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:bg-gray-400 text-sm font-medium"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? '儲存中...' : '儲存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
