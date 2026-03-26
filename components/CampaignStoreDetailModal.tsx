'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Edit2, Save, RotateCcw, Loader2, CheckSquare, Square, Users } from 'lucide-react';
import StaffPickerInput from './StaffPickerInput';
import { CampaignStoreDetail, CampaignType, CAMPAIGN_TYPE_LABELS, CampaignChecklistItem, CampaignChecklistCompletion } from '@/types/workflow';

// ─────────────────────────────────────────────
// 母親節/周年慶活動 欄位清單
// ─────────────────────────────────────────────
const PROMOTION_FIELD_GROUPS = [
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
// 盤點活動 欄位清單
// ─────────────────────────────────────────────
const INVENTORY_FIELD_GROUPS = [
  {
    title: '盤點配置',
    color: 'bg-teal-50 border-teal-200',
    headerColor: 'bg-teal-100 text-teal-800',
    fields: [
      { key: 'has_external_inventory_company', label: '是否有外盤公司', placeholder: '是 / 否 / 公司名稱' },
      { key: 'planned_inventory_time',         label: '預計盤點時間', placeholder: '例：18:00' },
      { key: 'inventory_staff',                label: '盤點組人員',     placeholder: '人員名單...' },
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
  campaignType?: CampaignType;  // 活動類型，預計為 'promotion'
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
  has_external_inventory_company: '',
  planned_inventory_time:         '',
  inventory_staff:                '',
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
  campaignType = 'promotion',
  activityDate,
  canEdit,
}: CampaignStoreDetailModalProps) {
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form,     setForm]     = useState<DetailForm>(EMPTY_FORM);
  const [saved,    setSaved]    = useState<DetailForm>(EMPTY_FORM);
  const [hasData,  setHasData]  = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);  // inline 錯誤訊息

  // Checklist 相關 state
  const [checklistItems, setChecklistItems] = useState<CampaignChecklistItem[]>([]);
  const [checklistCompletions, setChecklistCompletions] = useState<Map<string, CampaignChecklistCompletion>>(new Map());
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [activeTab, setActiveTab] = useState<'detail' | 'checklist'>('detail');
  const managerNoteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // 活動人力 state
  const [ownStaff, setOwnStaff] = useState<{ employee_code: string; employee_name: string; position: string }[]>([]);
  const [supervisorName, setSupervisorName] = useState<string>('');
  const [supportRequests, setSupportRequests] = useState<{
    id: string;
    supporting_store: { id: string; store_code: string; store_name: string } | null;
    requested_count: number;
    assignedStaff: { employee_code: string; employee_name: string; position: string }[];
  }[]>([]);
  const [manpowerLoading, setManpowerLoading] = useState(false);

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
          has_external_inventory_company: d.has_external_inventory_company || '',
          planned_inventory_time:         d.planned_inventory_time         || '',
          inventory_staff:                d.inventory_staff                || '',
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

  // ── 載入活動人力資訊 ──
  const loadManpowerInfo = useCallback(async () => {
    if (!campaignId || !storeId) return;
    setManpowerLoading(true);
    try {
      const [staffRes, storesRes, requestsRes, supportStaffRes] = await Promise.all([
        fetch(`/api/campaign-store-own-staff?campaign_id=${campaignId}&store_id=${storeId}`),
        fetch('/api/stores-with-supervisors'),
        fetch(`/api/campaign-support-requests?campaign_id=${campaignId}&requesting_store_id=${storeId}`),
        fetch(`/api/campaign-support-staff?campaign_id=${campaignId}`),
      ]);
      const [staffData, storesData, requestsData, supportStaffData] = await Promise.all([
        staffRes.json(), storesRes.json(), requestsRes.json(), supportStaffRes.json(),
      ]);

      // 本店人員
      setOwnStaff(staffData.success ? (staffData.data || []) : []);

      // 督導
      if (storesData.success && storesData.data) {
        const store = storesData.data.find((s: any) => s.id === storeId);
        setSupervisorName(store?.supervisor_name || store?.supervisor_code || '');
      }

      // 支援需求 + 已指派人員
      const allSupportStaff: any[] = supportStaffData.success ? (supportStaffData.data || []) : [];
      const requests = requestsData.success ? (requestsData.data || []) : [];
      const enriched = requests.map((req: any) => ({
        id: req.id,
        supporting_store: req.supporting_store ?? null,
        requested_count: req.requested_count ?? 1,
        assignedStaff: allSupportStaff
          .filter((s: any) => s.support_request_id === req.id)
          .map((s: any) => ({
            employee_code: s.employee_code,
            employee_name: s.employee_name,
            position: s.position || '',
          })),
      }));
      setSupportRequests(enriched);
    } catch (err) {
      console.error('Error loading manpower info:', err);
    } finally {
      setManpowerLoading(false);
    }
  }, [campaignId, storeId]);

  // ── 載入 Checklist ──
  const loadChecklist = useCallback(async () => {
    if (!campaignId || !storeId) return;
    setChecklistLoading(true);
    try {
      // 載入 checklist 項目
      const itemsRes = await fetch(`/api/campaign-checklist-items?campaign_id=${campaignId}`);
      const itemsData = await itemsRes.json();
      if (itemsData.success) {
        setChecklistItems(itemsData.data || []);

        // 載入此門市的完成狀態
        const completionsRes = await fetch(
          `/api/campaign-checklist-completions?campaign_id=${campaignId}&store_id=${storeId}`
        );
        const completionsData = await completionsRes.json();
        if (completionsData.success) {
          const completionsMap = new Map<string, CampaignChecklistCompletion>();
          (completionsData.data || []).forEach((c: CampaignChecklistCompletion) => {
            completionsMap.set(c.checklist_item_id, c);
          });
          setChecklistCompletions(completionsMap);
        }
      }
    } catch (error) {
      console.error('Error loading checklist:', error);
    } finally {
      setChecklistLoading(false);
    }
  }, [campaignId, storeId]);

  // ── 打勾/取消打勾 ──
  const handleToggleChecklistItem = async (itemId: string, currentlyCompleted: boolean) => {
    try {
      const res = await fetch('/api/campaign-checklist-completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checklist_item_id: itemId,
          store_id: storeId,
          is_completed: !currentlyCompleted,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // 更新本地狀態
        const newCompletions = new Map(checklistCompletions);
        newCompletions.set(itemId, data.data);
        setChecklistCompletions(newCompletions);
      } else {
        alert(`操作失敗: ${data.error}`);
      }
    } catch (error) {
      console.error('Error toggling checklist item:', error);
      alert('操作失敗');
    }
  };

  // ── 店長備註（帶 debounce）──
  const handleUpdateManagerNote = (itemId: string, note: string) => {
    const newCompletions = new Map(checklistCompletions);
    const existing = newCompletions.get(itemId);
    newCompletions.set(itemId, {
      id: existing?.id || '',
      checklist_item_id: itemId,
      store_id: storeId,
      is_completed: existing?.is_completed || false,
      completed_by: existing?.completed_by || null,
      completed_at: existing?.completed_at || null,
      manager_note: note,
      store_assigned_person: existing?.store_assigned_person || null,
      created_at: existing?.created_at || '',
      updated_at: existing?.updated_at || '',
    });
    setChecklistCompletions(newCompletions);

    if (managerNoteTimers.current[itemId]) clearTimeout(managerNoteTimers.current[itemId]);
    managerNoteTimers.current[itemId] = setTimeout(async () => {
      try {
        await fetch('/api/campaign-checklist-completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checklist_item_id: itemId, store_id: storeId, manager_note: note }),
        });
      } catch (error) {
        console.error('Error saving manager note:', error);
      }
    }, 800);
  };

  // ── 店長指派人員（帶 debounce）──
  const handleUpdateStoreAssignedPerson = (itemId: string, person: string) => {
    const newCompletions = new Map(checklistCompletions);
    const existing = newCompletions.get(itemId);
    newCompletions.set(itemId, {
      id: existing?.id || '',
      checklist_item_id: itemId,
      store_id: storeId,
      is_completed: existing?.is_completed || false,
      completed_by: existing?.completed_by || null,
      completed_at: existing?.completed_at || null,
      manager_note: existing?.manager_note || null,
      store_assigned_person: person,
      created_at: existing?.created_at || '',
      updated_at: existing?.updated_at || '',
    });
    setChecklistCompletions(newCompletions);

    if (managerNoteTimers.current[`assign_${itemId}`]) clearTimeout(managerNoteTimers.current[`assign_${itemId}`]);
    managerNoteTimers.current[`assign_${itemId}`] = setTimeout(async () => {
      try {
        await fetch('/api/campaign-checklist-completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checklist_item_id: itemId, store_id: storeId, store_assigned_person: person }),
        });
      } catch (error) {
        console.error('Error saving assigned person:', error);
      }
    }, 800);
  };

  useEffect(() => {
    if (isOpen) {
      setIsEditing(false);
      setSaveError(null);
      setActiveTab('detail');
      loadDetail();
      loadChecklist();
      loadManpowerInfo();
    }
  }, [isOpen, loadDetail]);

  // ── 儲存 ──
  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
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
        setSaveError(data.error || '儲存失敗');
      }
    } catch (err) {
      console.error('Error saving:', err);
      setSaveError('網路錯誤，請檢查連線');
    } finally {
      setSaving(false);
    }
  };

  // ── 取消編輯 ──
  const handleCancel = () => {
    setForm({ ...saved });
    setIsEditing(false);
    setSaveError(null);
  };

  if (!isOpen) return null;

  const dateLabel = activityDate
    ? new Date(activityDate).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : '';

  // 依活動類型選擇要顯示的欄位組
  const activeFieldGroups = campaignType === 'inventory' ? INVENTORY_FIELD_GROUPS : PROMOTION_FIELD_GROUPS;
  const typeLabel = campaignType ? CAMPAIGN_TYPE_LABELS[campaignType] : '';
  const typeColor = campaignType === 'inventory'
    ? 'from-teal-600 to-cyan-600'
    : 'from-purple-600 to-pink-600';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* ── Header ── */}
        <div className={`flex items-start justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r ${typeColor} text-white rounded-t-xl`}>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold">{storeName}</h2>
              {typeLabel && (
                <span className="px-2 py-0.5 bg-white bg-opacity-20 rounded-full text-xs font-medium">
                  {typeLabel}
                </span>
              )}
            </div>
            <p className="text-sm text-white text-opacity-70 mt-0.5">{activityName}{dateLabel && ` · ${dateLabel}`}</p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && !isEditing && activeTab === 'detail' && (
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

        {/* ── Tabs ── */}
        <div className="flex border-b border-gray-200 bg-gray-50 px-6">
          <button
            onClick={() => setActiveTab('detail')}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'detail'
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            活動細節
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'checklist'
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            前置 Check List
            {checklistItems.length > 0 && (
              <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-bold ${
                activeTab === 'checklist' ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-600'
              }`}>
                {Array.from(checklistCompletions.values()).filter(c => c.is_completed).length}/{checklistItems.length}
              </span>
            )}
          </button>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500">
              <Loader2 size={32} className="animate-spin mr-2" />
              載入中...
            </div>
          ) : activeTab === 'detail' ? (
            <div className="space-y-5">
              {/* ── 活動當日人力 ── */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 overflow-hidden">
                <div className="px-4 py-2 text-sm font-semibold bg-indigo-100 text-indigo-800 flex items-center gap-2">
                  <Users size={15} />
                  活動當日人力
                </div>
                {manpowerLoading ? (
                  <div className="p-4 text-center text-gray-400 text-sm">載入中...</div>
                ) : (
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* 本店人員 */}
                    <div>
                      <p className="text-xs font-semibold text-indigo-700 mb-2">🏪 本店人員（{ownStaff.length} 人）</p>
                      {ownStaff.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">尚未設定</p>
                      ) : (
                        <div className="space-y-1">
                          {ownStaff.map((s) => (
                            <div key={s.employee_code} className="flex items-center gap-1.5 bg-white rounded px-2 py-1 text-xs border border-indigo-100">
                              <span className="font-mono text-gray-400">{s.employee_code}</span>
                              <span className="font-medium text-gray-800">{s.employee_name}</span>
                              {s.position && <span className="text-gray-400">· {s.position}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* 督導 */}
                    <div>
                      <p className="text-xs font-semibold text-purple-700 mb-2">👤 督導</p>
                      {supervisorName ? (
                        <div className="bg-white rounded px-2 py-1 text-xs border border-purple-100 inline-block font-medium text-gray-800">
                          {supervisorName}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">尚未指派</p>
                      )}
                    </div>
                    {/* 支援人力 */}
                    <div>
                      <p className="text-xs font-semibold text-teal-700 mb-2">🔄 支援人力</p>
                      {supportRequests.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">無支援需求</p>
                      ) : (
                        <div className="space-y-2">
                          {supportRequests.map((req) => {
                            const storeName = req.supporting_store
                              ? `${req.supporting_store.store_code} ${req.supporting_store.store_name}`
                              : '未知門市';
                            if (req.assignedStaff.length === 0) {
                              return (
                                <div key={req.id} className="bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-xs">
                                  <p className="font-medium text-amber-800">{storeName} 應指派 {req.requested_count} 人</p>
                                  <p className="text-amber-600 mt-0.5">尚未指派，可聯繫對方店長確認</p>
                                </div>
                              );
                            }
                            return (
                              <div key={req.id} className="bg-white border border-teal-100 rounded px-2 py-1.5 text-xs">
                                <p className="font-medium text-teal-700 mb-1">{storeName} 指派 {req.assignedStaff.length} 人</p>
                                <div className="space-y-0.5">
                                  {req.assignedStaff.map((s) => (
                                    <div key={s.employee_code} className="flex items-center gap-1 text-gray-700">
                                      <span className="font-mono text-gray-400">{s.employee_code}</span>
                                      <span>|</span>
                                      <span>{s.employee_name}</span>
                                      {s.position && <><span>|</span><span className="text-gray-500">{s.position}</span></>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

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

              {(hasData || isEditing) && activeFieldGroups.map((group) => (
                <div key={group.title} className={`rounded-lg border ${group.color} overflow-hidden`}>
                  <div className={`px-4 py-2 text-sm font-semibold ${group.headerColor}`}>
                    {group.title}
                  </div>
                  <div className={`p-4 grid grid-cols-1 ${group.fields.length === 1 ? '' : 'sm:grid-cols-2 lg:grid-cols-3'} gap-3`}>
                    {group.fields.map(({ key, label, placeholder }: { key: string; label: string; placeholder?: string }) => {
                      const value = (form as any)[key] as string;
                      const isTextarea = key === 'inventory_staff';
                      return (
                        <div key={key} className={isTextarea ? 'sm:col-span-2 lg:col-span-3' : ''}>
                          <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                          {isEditing ? (
                            isTextarea ? (
                              <textarea
                                value={value}
                                onChange={(e) => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                                rows={3}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                                placeholder={placeholder || `輸入${label}`}
                              />
                            ) : (
                              <input
                                type="text"
                                value={value}
                                onChange={(e) => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                placeholder={placeholder || `輸入${label}`}
                              />
                            )
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
          ) : (
            /* ── 前置 Check List Tab ── */
            <div className="space-y-4">
              {checklistItems.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <p>此活動尚無前置 Check List 項目</p>
                  <p className="text-sm mt-1">請由活動排程管理頁面設定</p>
                </div>
              ) : checklistLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-500">
                  <Loader2 size={24} className="animate-spin mr-2" />
                  載入中...
                </div>
              ) : (
                <>
                  {/* 完成進度 */}
                  <div className="bg-white border border-purple-200 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">完成進度</span>
                      <div className="flex items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
                          <button
                            onClick={() => setHideCompleted(false)}
                            className={`px-3 py-1 transition-colors ${
                              !hideCompleted
                                ? 'bg-purple-600 text-white font-medium'
                                : 'bg-white text-gray-500 hover:bg-gray-50'
                            }`}
                          >
                            顯示全部
                          </button>
                          <button
                            onClick={() => setHideCompleted(true)}
                            className={`px-3 py-1 transition-colors border-l border-gray-200 ${
                              hideCompleted
                                ? 'bg-purple-600 text-white font-medium'
                                : 'bg-white text-gray-500 hover:bg-gray-50'
                            }`}
                          >
                            隱藏已完成
                          </button>
                        </div>
                        <span className="font-bold text-purple-700 text-lg">
                        {Array.from(checklistCompletions.values()).filter(c => c.is_completed).length}
                        <span className="text-gray-400 font-normal text-sm"> / {checklistItems.length}</span>
                        </span>
                      </div>
                    </div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                        style={{
                          width: `${(Array.from(checklistCompletions.values()).filter(c => c.is_completed).length / checklistItems.length) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* 項目列表 */}
                  <div className="space-y-3">
                    {hideCompleted && checklistItems.every(i => checklistCompletions.get(i.id)?.is_completed) && (
                      <div className="text-center py-6 text-green-600 text-sm font-medium">
                        🎉 所有項目已完成！
                      </div>
                    )}
                    {checklistItems.filter(item => !hideCompleted || !checklistCompletions.get(item.id)?.is_completed).map((item) => {
                      const index = checklistItems.indexOf(item);
                      const completion = checklistCompletions.get(item.id);
                      const isCompleted = completion?.is_completed || false;
                      const managerNote = completion?.manager_note || '';
                      const storeAssignedPerson = completion?.store_assigned_person || '';

                      return (
                        <div
                          key={item.id}
                          className={`bg-white rounded-xl border-2 p-4 transition-all ${
                            isCompleted ? 'border-green-200 bg-green-50' : 'border-gray-200 hover:border-purple-200'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {/* 打勾框 */}
                            <button
                              onClick={() => handleToggleChecklistItem(item.id, isCompleted)}
                              className="flex-shrink-0 mt-0.5"
                              title={isCompleted ? '點擊取消完成' : '點擊標記完成'}
                            >
                              {isCompleted ? (
                                <CheckSquare className="w-6 h-6 text-green-600" />
                              ) : (
                                <Square className="w-6 h-6 text-gray-400 hover:text-purple-600" />
                              )}
                            </button>

                            {/* 項目內容 */}
                            <div className="flex-1 min-w-0 space-y-3">
                              <div className="flex items-start gap-2">
                                <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  isCompleted ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                                }`}>
                                  {index + 1}
                                </span>
                                <div className="flex-1">
                                  <div className={`font-medium text-sm ${
                                    isCompleted ? 'text-gray-400 line-through' : 'text-gray-900'
                                  }`}>
                                    {item.task_name}
                                  </div>
                                  {item.notes && (
                                    <div className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{item.notes}</div>
                                  )}
                                  <div className="flex items-center gap-3 mt-1 text-xs">
                                    {item.assigned_person && (
                                      <span className="text-purple-600">👤 {item.assigned_person}</span>
                                    )}
                                    {item.deadline && (
                                      <span className="text-orange-600">⏰ {item.deadline}</span>
                                    )}
                                  </div>
                                  {isCompleted && completion?.completed_at && (
                                    <div className="text-xs text-green-600 mt-1">
                                      ✓ 完成於 {new Date(completion.completed_at).toLocaleString('zh-TW')}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* 實際指派人員 + 店長備註：完成後收合為唯讀，未完成才顯示編輯欄 */}
                              {isCompleted ? (
                                (storeAssignedPerson || managerNote) ? (
                                  <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-2">
                                    {storeAssignedPerson && (
                                      <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-100 rounded-full px-2 py-0.5">
                                        👤 {storeAssignedPerson}
                                      </span>
                                    )}
                                    {managerNote && (
                                      <span className="text-xs text-gray-500 italic">{managerNote}</span>
                                    )}
                                  </div>
                                ) : null
                              ) : (
                                <>
                                  {/* 實際指派人員（點選彈出本店人員名單） */}
                                  <div className="pt-2 border-t border-gray-100">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">👤 實際指派人員</label>
                                    <StaffPickerInput
                                      value={storeAssignedPerson}
                                      onChange={(v) => handleUpdateStoreAssignedPerson(item.id, v)}
                                      storeId={storeId}
                                      inputClassName="w-full px-3 py-2 pr-8 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white placeholder-gray-300"
                                    />
                                  </div>
                                  <div className="pt-2 border-t border-gray-100">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">📝 店長備註</label>
                                    <textarea
                                      value={managerNote}
                                      onChange={(e) => handleUpdateManagerNote(item.id, e.target.value)}
                                      rows={2}
                                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none bg-white placeholder-gray-300"
                                      placeholder="填寫準備進度、注意事項或回報..."
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {isEditing && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            {saveError && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span className="mt-0.5 shrink-0">❌</span>
                <span>儲存失敗：{saveError}</span>
              </div>
            )}
            <div className="flex justify-end gap-3">
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
        {isEditing && activeTab === 'checklist' && (
          <div className="px-6 py-3 border-t border-gray-200 flex justify-end bg-gray-50 rounded-b-xl">
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
