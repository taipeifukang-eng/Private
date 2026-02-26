'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Edit2, Save, RotateCcw, Loader2 } from 'lucide-react';
import { CampaignStoreDetail } from '@/types/workflow';

// ─────────────────────────────────────────────
// 欄位定義
// ─────────────────────────────────────────────
const FIELD_GROUPS = [
  {
    title: '外場配置',
    color: 'bg-orange-50 border-orange-200',
    headerColor: 'bg-orange-100 text-orange-800',
    fields: [
      { key: 'outdoor_vendor', label: '外場廠商' },
      { key: 'red_bean_cake',  label: '紅豆餅/雞蛋糕' },
      { key: 'circulation',    label: '循環' },
      { key: 'quantum',        label: '量子' },
      { key: 'bone_density',   label: '骨密' },
    ],
  },
  {
    title: '門市人員',
    color: 'bg-blue-50 border-blue-200',
    headerColor: 'bg-blue-100 text-blue-800',
    fields: [
      { key: 'supervisor',    label: '督導' },
      { key: 'manager',       label: '經理' },
      { key: 'tasting',       label: '試飲' },
      { key: 'activity_team', label: '活動組' },
    ],
  },
  {
    title: '業務',
    color: 'bg-green-50 border-green-200',
    headerColor: 'bg-green-100 text-green-800',
    fields: [
      { key: 'sales1', label: '業務 1' },
      { key: 'sales2', label: '業務 2' },
      { key: 'sales3', label: '業務 3' },
      { key: 'sales4', label: '業務 4' },
      { key: 'sales5', label: '業務 5' },
      { key: 'sales6', label: '業務 6' },
    ],
  },
  {
    title: '內場工讀（時間 09~13）',
    color: 'bg-purple-50 border-purple-200',
    headerColor: 'bg-purple-100 text-purple-800',
    fields: [
      { key: 'indoor_pt1', label: '內場工讀 1' },
      { key: 'indoor_pt2', label: '內場工讀 2' },
    ],
  },
];

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────
interface CampaignStoreDetailModalProps {
  isOpen:        boolean;
  onClose:       () => void;
  campaignId:    string;
  storeId:       string;
  storeName:     string;
  activityName:  string;
  activityDate?: string;  // 顯示用，格式 YYYY-MM-DD
  canEdit:       boolean; // 有編輯權限（督導/管理員）
}

// ─────────────────────────────────────────────
// 初始空白資料
// ─────────────────────────────────────────────
type DetailForm = Omit<CampaignStoreDetail,
  'id' | 'campaign_id' | 'store_id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'
>;

const EMPTY_FORM: DetailForm = {
  outdoor_vendor: '',
  red_bean_cake:  '',
  circulation:    '',
  quantum:        '',
  bone_density:   '',
  supervisor:     '',
  manager:        '',
  tasting:        '',
  activity_team:  '',
  sales1:         '',
  sales2:         '',
  sales3:         '',
  sales4:         '',
  sales5:         '',
  sales6:         '',
  indoor_pt1:     '',
  indoor_pt2:     '',
  notes:          '',
};

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function CampaignStoreDetailModal({
  isOpen,
  onClose,
  campaignId,
  storeId,
  storeName,
  activityName,
  activityDate,
  canEdit,
}: CampaignStoreDetailModalProps) {
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form,     setForm]     = useState<DetailForm>(EMPTY_FORM);
  const [saved,    setSaved]    = useState<DetailForm>(EMPTY_FORM);
  const [hasData,  setHasData]  = useState(false);

  // ── 讀取 ──
  const loadDetail = useCallback(async () => {
    if (!campaignId || !storeId) return;
    setLoading(true);
    try {
      const res  = await fetch(`/api/campaign-store-details?campaign_id=${campaignId}&store_id=${storeId}`);
      const data = await res.json();
      if (data.success && data.data?.length > 0) {
        const d = data.data[0] as CampaignStoreDetail;
        const formData: DetailForm = {
          outdoor_vendor: d.outdoor_vendor || '',
          red_bean_cake:  d.red_bean_cake  || '',
          circulation:    d.circulation    || '',
          quantum:        d.quantum        || '',
          bone_density:   d.bone_density   || '',
          supervisor:     d.supervisor     || '',
          manager:        d.manager        || '',
          tasting:        d.tasting        || '',
          activity_team:  d.activity_team  || '',
          sales1:         d.sales1         || '',
          sales2:         d.sales2         || '',
          sales3:         d.sales3         || '',
          sales4:         d.sales4         || '',
          sales5:         d.sales5         || '',
          sales6:         d.sales6         || '',
          indoor_pt1:     d.indoor_pt1     || '',
          indoor_pt2:     d.indoor_pt2     || '',
          notes:          d.notes          || '',
        };
        setForm(formData);
        setSaved(formData);
        setHasData(true);
      } else {
        setForm(EMPTY_FORM);
        setSaved(EMPTY_FORM);
        setHasData(false);
      }
    } catch (err) {
      console.error('Error loading store detail:', err);
    } finally {
      setLoading(false);
    }
  }, [campaignId, storeId]);

  useEffect(() => {
    if (isOpen) {
      setIsEditing(false);
      loadDetail();
    }
  }, [isOpen, loadDetail]);

  // ── 儲存 ──
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/campaign-store-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, store_id: storeId, ...form }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved({ ...form });
        setHasData(true);
        setIsEditing(false);
      } else {
        alert('❌ 儲存失敗：' + data.error);
      }
    } catch (err) {
      console.error('Error saving:', err);
      alert('❌ 儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  // ── 取消編輯 ──
  const handleCancel = () => {
    setForm({ ...saved });
    setIsEditing(false);
  };

  if (!isOpen) return null;

  const dateLabel = activityDate
    ? new Date(activityDate).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : '';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-t-xl">
          <div>
            <h2 className="text-xl font-bold">{storeName}</h2>
            <p className="text-sm text-purple-200 mt-0.5">{activityName}{dateLabel && ` · ${dateLabel}`}</p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white bg-opacity-20 hover:bg-opacity-30 text-white rounded-lg text-sm transition-colors"
              >
                <Edit2 size={15} />
                編輯
              </button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500">
              <Loader2 size={32} className="animate-spin mr-2" />
              載入中...
            </div>
          ) : (
            <div className="space-y-5">
              {!hasData && !isEditing && (
                <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                  <p className="text-base">尚無活動細節資料</p>
                  {canEdit && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="mt-3 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition-colors"
                    >
                      + 新增細節
                    </button>
                  )}
                </div>
              )}

              {(hasData || isEditing) && FIELD_GROUPS.map((group) => (
                <div key={group.title} className={`rounded-lg border ${group.color} overflow-hidden`}>
                  <div className={`px-4 py-2 text-sm font-semibold ${group.headerColor}`}>
                    {group.title}
                  </div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.fields.map(({ key, label }) => {
                      const value = (form as any)[key] as string;
                      return (
                        <div key={key}>
                          <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                          {isEditing ? (
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              placeholder={`輸入${label}`}
                            />
                          ) : (
                            <div className={`px-3 py-2 rounded-lg text-sm ${value ? 'text-gray-900 bg-white border border-gray-200' : 'text-gray-400 italic'}`}>
                              {value || '—'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* 備註 */}
              {(hasData || isEditing) && (
                <div className="rounded-lg border bg-gray-50 border-gray-200 overflow-hidden">
                  <div className="px-4 py-2 text-sm font-semibold bg-gray-100 text-gray-700">備註</div>
                  <div className="p-4">
                    {isEditing ? (
                      <textarea
                        value={form.notes || ''}
                        onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                        placeholder="輸入備註..."
                      />
                    ) : (
                      <div className={`text-sm px-3 py-2 rounded-lg ${form.notes ? 'text-gray-900 bg-white border border-gray-200' : 'text-gray-400 italic'}`}>
                        {form.notes || '—'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {isEditing && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50 rounded-b-xl">
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors text-sm"
            >
              <RotateCcw size={15} />
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
        )}
        {!isEditing && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end bg-gray-50 rounded-b-xl">
            <button
              onClick={onClose}
              className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors text-sm"
            >
              關閉
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
