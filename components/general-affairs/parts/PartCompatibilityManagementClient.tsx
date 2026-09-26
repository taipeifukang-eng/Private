'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Layers3,
  Loader2,
  PackageSearch,
  Plus,
  Search,
  Wrench,
  X,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { GeneralAffairsListPage } from '@/components/general-affairs/GeneralAffairsPageTemplates';
import { AssetBadge } from '@/components/general-affairs/assets/AssetManagementUI';

const targetTypes = [
  {
    id: 'equipment_template',
    label: '設備型號',
    example: 'EPSON L6490、L3190',
    icon: Wrench,
  },
  {
    id: 'equipment',
    label: '單台設備例外',
    example: '印表機、冷氣、飲水機',
    icon: Wrench,
  },
  {
    id: 'facility',
    label: '單店設施例外',
    example: '某門市的中島架、層架、櫃檯',
    icon: Layers3,
  },
  { id: 'facility_template', label: '共用架型', example: 'HH01、層架A款', icon: Layers3 },
];

type TargetType = 'equipment' | 'equipment_template' | 'facility' | 'facility_template';

type EquipmentItem = {
  id: string;
  name?: string | null;
  asset_code?: string | null;
  brand?: string | null;
  model?: string | null;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
  category?: { name?: string | null } | null;
};
type EquipmentTemplateItem = { id: string; category_id: string; name: string; brand?: string | null; model?: string | null; category?: { name?: string | null } | null };

type FacilityItem = {
  id: string;
  name?: string | null;
  facility_code?: string | null;
  area?: string | null;
  location_detail?: string | null;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
  category?: { name?: string | null } | null;
};
type FacilityTemplateItem = { id: string; code: string; name: string; width_cm?: number | null; height_cm?: number | null; depth_cm?: number | null; category?: { name?: string | null } | null };

type PartItem = {
  id: string;
  name?: string | null;
  part_code?: string | null;
  brand?: string | null;
  model?: string | null;
  specification?: string | null;
  base_unit?: string | null;
  category?: { name?: string | null } | null;
};

type TargetItem = {
  id: string;
  type: TargetType;
  label: string;
  description: string;
  searchText: string;
};

type DataState = {
  loading: boolean;
  error: string;
  equipment: EquipmentItem[];
  equipmentTemplates: EquipmentTemplateItem[];
  facilities: FacilityItem[];
  facilityTemplates: FacilityTemplateItem[];
  parts: PartItem[];
};

type CompatibilityRow = {
  id: string;
  part_id: string;
  part?: PartItem | null;
};

function storeLabel(store?: EquipmentItem['store'] | FacilityItem['store']) {
  if (!store) return '';
  return [store.store_code, store.short_name || store.store_name].filter(Boolean).join(' ');
}

function equipmentLabel(item: EquipmentItem) {
  return [item.asset_code, item.name].filter(Boolean).join('｜') || '未命名設備';
}

function equipmentDescription(item: EquipmentItem) {
  return [storeLabel(item.store), item.category?.name, [item.brand, item.model].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
}

function facilityLabel(item: FacilityItem) {
  return [item.facility_code, item.name].filter(Boolean).join('｜') || '未命名設施';
}

function facilityDescription(item: FacilityItem) {
  return [storeLabel(item.store), item.category?.name, item.area, item.location_detail].filter(Boolean).join(' · ');
}

function partLabel(item: PartItem) {
  return [item.part_code, item.name].filter(Boolean).join('｜') || '未命名料件';
}

function partDescription(item: PartItem) {
  return [item.category?.name, item.brand, item.model, item.specification, item.base_unit].filter(Boolean).join(' · ');
}

async function readList<T>(url: string): Promise<T[]> {
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) throw new Error(String(body?.error || '資料讀取失敗'));
  return Array.isArray(body?.data) ? body.data : [];
}

export default function PartCompatibilityManagementClient() {
  const [activeType, setActiveType] = useState<TargetType>('facility_template');
  const [targetSearch, setTargetSearch] = useState('');
  const [partSearch, setPartSearch] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [loadingCompatibilities, setLoadingCompatibilities] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [data, setData] = useState<DataState>({
    loading: true,
    error: '',
    equipment: [],
    equipmentTemplates: [],
    facilities: [],
    facilityTemplates: [],
    parts: [],
  });

  useEffect(() => {
    let alive = true;
    async function loadData() {
      setData((current) => ({ ...current, loading: true, error: '' }));
      try {
        const [equipment, equipmentTemplates, facilities, facilityTemplates, parts] = await Promise.all([
          readList<EquipmentItem>('/api/general-affairs/equipment?pageSize=100&sortBy=updated_at'),
          readList<EquipmentTemplateItem>('/api/general-affairs/equipment/templates?pageSize=100&active=true&sortBy=name&sortDir=asc'),
          readList<FacilityItem>('/api/general-affairs/facilities?pageSize=100&sortBy=updated_at'),
          readList<FacilityTemplateItem>('/api/general-affairs/facility-templates'),
          readList<PartItem>('/api/general-affairs/parts?pageSize=100&isActive=true&sortBy=updated_at'),
        ]);
        if (!alive) return;
        setData({ loading: false, error: '', equipment, equipmentTemplates, facilities, facilityTemplates, parts });
      } catch (error) {
        if (!alive) return;
        setData((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : '資料讀取失敗',
        }));
      }
    }
    loadData();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadCompatibilities() {
      if (!selectedTargetId) {
        setSelectedPartIds([]);
        return;
      }
      setLoadingCompatibilities(true);
      setMessage(null);
      try {
        const rows = await readList<CompatibilityRow>(
          `/api/general-affairs/parts/target-compatibilities?targetType=${activeType.toUpperCase()}&targetId=${encodeURIComponent(selectedTargetId)}&includeInherited=false`
        );
        if (!alive) return;
        setSelectedPartIds(rows.map((row) => row.part_id));
      } catch (error) {
        if (!alive) return;
        setMessage({ type: 'error', text: error instanceof Error ? error.message : '相容關係讀取失敗' });
      } finally {
        if (alive) setLoadingCompatibilities(false);
      }
    }
    loadCompatibilities();
    return () => {
      alive = false;
    };
  }, [activeType, selectedTargetId]);

  const targets = useMemo<TargetItem[]>(() => {
    const equipmentTargets = data.equipment.map((item) => {
      const label = equipmentLabel(item);
      const description = equipmentDescription(item);
      return {
        id: item.id,
        type: 'equipment' as const,
        label,
        description,
        searchText: [label, description].join(' ').toLowerCase(),
      };
    });
    const equipmentTemplateTargets = data.equipmentTemplates.map((item) => {
      const label = [item.brand, item.model || item.name].filter(Boolean).join('｜') || item.name;
      const description = [item.category?.name, item.name].filter(Boolean).join(' · ');
      return { id: item.id, type: 'equipment_template' as const, label, description, searchText: [label, description].join(' ').toLowerCase() };
    });
    const facilityTargets = data.facilities.map((item) => {
      const label = facilityLabel(item);
      const description = facilityDescription(item);
      return {
        id: item.id,
        type: 'facility' as const,
        label,
        description,
        searchText: [label, description].join(' ').toLowerCase(),
      };
    });
    const templateTargets = data.facilityTemplates.map((item) => ({ id: item.id, type: 'facility_template' as const, label: `${item.code}｜${item.name}`, description: [item.category?.name, item.width_cm && `寬${item.width_cm}`, item.height_cm && `高${item.height_cm}`, item.depth_cm && `深${item.depth_cm}`].filter(Boolean).join(' · '), searchText: `${item.code} ${item.name}`.toLowerCase() }));
    return activeType === 'equipment' ? equipmentTargets : activeType === 'equipment_template' ? equipmentTemplateTargets : activeType === 'facility' ? facilityTargets : templateTargets;
  }, [activeType, data.equipment, data.equipmentTemplates, data.facilities, data.facilityTemplates]);

  const filteredTargets = useMemo(() => {
    const keyword = targetSearch.trim().toLowerCase();
    if (!keyword) return targets.slice(0, 20);
    return targets.filter((item) => item.searchText.includes(keyword)).slice(0, 20);
  }, [targetSearch, targets]);

  const selectedTarget = useMemo(
    () => targets.find((item) => item.id === selectedTargetId) || null,
    [selectedTargetId, targets]
  );

  const filteredParts = useMemo(() => {
    const keyword = partSearch.trim().toLowerCase();
    const list = data.parts.map((item) => ({
      item,
      label: partLabel(item),
      description: partDescription(item),
    }));
    const filtered = keyword
      ? list.filter((entry) => [entry.label, entry.description].join(' ').toLowerCase().includes(keyword))
      : list;
    return filtered.slice(0, 20);
  }, [data.parts, partSearch]);

  const selectedParts = useMemo(
    () => selectedPartIds
      .map((id) => data.parts.find((item) => item.id === id))
      .filter((item): item is PartItem => Boolean(item)),
    [data.parts, selectedPartIds]
  );

  function selectTargetType(type: TargetType) {
    setActiveType(type);
    setSelectedTargetId('');
    setSelectedPartIds([]);
    setTargetSearch('');
  }

  function togglePart(partId: string) {
    setSelectedPartIds((current) => (
      current.includes(partId)
        ? current.filter((id) => id !== partId)
        : [...current, partId]
    ));
  }

  async function saveCompatibilities() {
    if (!selectedTarget) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/general-affairs/parts/target-compatibilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: activeType.toUpperCase(),
          targetId: selectedTarget.id,
          partIds: selectedPartIds,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.success === false) throw new Error(String(body?.error || '相容關係儲存失敗'));
      setMessage({ type: 'success', text: `已儲存 ${selectedPartIds.length} 筆相容料件` });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '相容關係儲存失敗' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <GeneralAffairsListPage
      header={(
        <GeneralAffairsPageHeader
          breadcrumbs={[
            { label: '首頁', href: '/' },
            { label: '總務服務中心', href: '/general-affairs' },
            { label: '資產與庫存' },
            { label: '適用料件設定' },
          ]}
          title="適用料件設定"
          description="將料件設定在設備型號或設施架型，同款門市資產會自動沿用。"
          statusBadge={<AssetBadge tone="blue">共用設定</AssetBadge>}
          secondaryActions={[
            <Link key="parts" href="/general-affairs/parts" className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Boxes className="h-4 w-4" />
              回料件列表
            </Link>,
          ]}
        />
      )}
    >
      <div className="space-y-4">
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {targetTypes.filter((item) => item.id === 'equipment_template' || item.id === 'facility_template').map((item) => {
              const Icon = item.icon;
              const active = item.id === activeType;
              return (
                <button key={item.id} type="button" onClick={() => selectTargetType(item.id as TargetType)} className={`rounded-lg border p-4 text-left ${active ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}>
                  <span className="flex items-center gap-2 font-bold text-slate-950"><Icon className="h-4 w-4 text-orange-600" />{item.label}</span>
                  <span className="mt-1 block text-xs text-slate-500">{item.example}</span>
                </button>
              );
            })}
          </div>
          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
              設備或單店有不同需求
            </summary>
            <div className="grid gap-2 border-t border-slate-200 p-3 sm:grid-cols-3">
              {targetTypes.filter((item) => item.id === 'equipment' || item.id === 'facility').map((item) => {
                const Icon = item.icon;
                const active = item.id === activeType;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTargetType(item.id as TargetType)}
                    className={`rounded-md border p-3 text-left transition ${active ? 'border-orange-300 bg-orange-50 text-orange-900' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200 hover:bg-orange-50'}`}
                  >
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <Icon className="h-4 w-4 text-orange-600" />
                      {item.label}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{item.example}</div>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => selectTargetType('facility_template')}
                className="rounded-md border border-slate-200 bg-white p-3 text-left font-semibold text-slate-700 hover:border-orange-200 hover:bg-orange-50"
              >
                返回共用架型
              </button>
            </div>
          </details>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">
                  {activeType === 'facility_template' ? '設施架型與適用料件' : activeType === 'equipment_template' ? '設備型號與適用料件' : activeType === 'facility' ? '單店設施例外' : '單台設備例外'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    value={targetSearch}
                    onChange={(event) => setTargetSearch(event.target.value)}
                    className="h-10 w-56 rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                    placeholder={activeType === 'facility_template' ? '搜尋架型' : activeType === 'equipment_template' ? '搜尋設備型號' : activeType === 'facility' ? '搜尋門市設施' : '搜尋設備'}
                  />
                </label>
                <label className="relative">
                  <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <input
                    value={partSearch}
                    onChange={(event) => setPartSearch(event.target.value)}
                    className="h-10 w-56 rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100"
                    placeholder="搜尋料件"
                  />
                </label>
              </div>
            </div>

            {data.loading ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在載入資料
              </div>
            ) : data.error ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {data.error}
              </div>
            ) : (
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-lg border border-slate-200">
                  <div className="border-b border-slate-200 px-3 py-2 text-xs font-bold text-slate-500">
                    {activeType === 'equipment' ? '單台設備' : activeType === 'equipment_template' ? '設備型號' : activeType === 'facility' ? '門市設施' : '設施架型'}（{filteredTargets.length}）
                  </div>
                  <div className="max-h-[420px] overflow-auto p-2">
                    {filteredTargets.map((item) => {
                      const active = item.id === selectedTargetId;
                      return (
                        <button
                          key={`${item.type}-${item.id}`}
                          type="button"
                          onClick={() => setSelectedTargetId(item.id)}
                          className={`mb-2 w-full rounded-lg border p-3 text-left transition last:mb-0 ${active ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-200'}`}
                        >
                          <div className="font-bold text-slate-950">{item.label}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.description || '未補充位置或分類'}</div>
                        </button>
                      );
                    })}
                    {filteredTargets.length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                        找不到符合的管理對象
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200">
                  <div className="border-b border-slate-200 px-3 py-2 text-xs font-bold text-slate-500">
                    適用料件（{filteredParts.length}）
                  </div>
                  <div className="max-h-[420px] overflow-auto p-2">
                    {filteredParts.map(({ item, label, description }) => {
                      const selected = selectedPartIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => togglePart(item.id)}
                          className={`mb-2 w-full rounded-lg border p-3 text-left transition last:mb-0 ${selected ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-200'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-bold text-slate-950">{label}</div>
                              <div className="mt-1 text-xs text-slate-500">{description || '未補充品牌型號'}</div>
                            </div>
                            {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                          </div>
                        </button>
                      );
                    })}
                    {filteredParts.length === 0 && (
                      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                        找不到符合的料件
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-blue-950">
                <PackageSearch className="h-4 w-4" />
                本次設定
              </div>
              <div className="mt-2 text-sm text-blue-900">
                {selectedTarget ? selectedTarget.label : activeType === 'facility_template' ? '請先選擇共用架型' : '請先選擇管理對象'}
                {loadingCompatibilities && <span className="ml-2 text-xs font-semibold text-blue-700">讀取既有關係中...</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedParts.map((part) => (
                  <button
                    key={part.id}
                    type="button"
                    onClick={() => togglePart(part.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-800"
                  >
                    {partLabel(part)}
                    <X className="h-3 w-3" />
                  </button>
                ))}
                {selectedParts.length === 0 && (
                  <span className="text-sm text-blue-700">尚未加入料件</span>
                )}
              </div>
              <button
                type="button"
                onClick={saveCompatibilities}
                disabled={!selectedTarget || saving || loadingCompatibilities}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                儲存適用料件
              </button>
              {message && (
                <div className={`mt-3 rounded-md px-3 py-2 text-sm font-semibold ${message.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {message.text}
                </div>
              )}
            </div>
          </div>
        </section>

      </div>
    </GeneralAffairsListPage>
  );
}
