'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, Camera, CheckCircle2, ClipboardList, HelpCircle, MonitorCog, PackagePlus, RefreshCw, Send, Wrench } from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';

type StoreOption = {
  id: string;
  store_code?: string | null;
  store_name?: string | null;
  short_name?: string | null;
};

type ResourceOption = {
  id: string;
  name: string;
  asset_code?: string | null;
  barcode?: string | null;
  facility_code?: string | null;
  area?: string | null;
  location_detail?: string | null;
  brand?: string | null;
  model?: string | null;
};

type PartOption = {
  id: string;
  name: string;
  part_code?: string | null;
  barcode?: string | null;
  brand?: string | null;
  model?: string | null;
  specification?: string | null;
  base_unit?: string | null;
};

type MaintenanceTarget = ResourceOption & {
  kind: RepairResourceType;
};

type AssetTokenPrefill = {
  token: string;
  id: string;
  type: RepairResourceType;
  storeId: string;
  label: string;
};

type RequestType = 'REPAIR' | 'PURCHASE_SUPPLEMENT';
type RepairProblemType = 'EQUIPMENT_FAILURE' | 'FACILITY_ENVIRONMENT' | 'UNSURE';
type RepairResourceType = 'EQUIPMENT' | 'FACILITY';
type PurchaseEntryMode = 'CATALOG' | 'NEW_PURCHASE';
type PurchaseCatalogItem = { kind: 'PART'; id: string; label: string; searchText: string; name: string; unit?: string | null; part: PartOption };

type TargetCompatibilityRow = {
  part_id: string;
};

type SubmitResult = {
  id: string;
  request_no: string;
  main_status: string;
  public_progress: string;
};

type StoreScope = 'managed' | 'all';

const REPAIR_PROBLEM_OPTIONS = [
  {
    key: 'EQUIPMENT_FAILURE' as const,
    label: '設備故障',
    description: '印表機、電腦、刷卡機、冷氣、冰箱、監視器等某台東西壞了。',
    icon: MonitorCog,
  },
  {
    key: 'FACILITY_ENVIRONMENT' as const,
    label: '店內設施 / 環境問題',
    description: '漏水、門鎖、牆面、地板、蟲害、異味或店內空間狀況。',
    icon: Building2,
  },
  {
    key: 'UNSURE' as const,
    label: '我不確定，讓總務判斷',
    description: '不知道算設備還是設施也沒關係，直接描述問題。',
    icon: HelpCircle,
  },
];

const REPAIR_SITUATION_OPTIONS = [
  '漏水 / 滲水 / 積水',
  '電燈 / 插座 / 電力異常',
  '門 / 鎖 / 自動門異常',
  '牆面 / 天花板 / 地板損壞',
  '鼠患 / 蟑螂 / 蚊蟲',
  '異味 / 環境消毒',
  '櫃台 / 陳列架 / 收納設施損壞',
  '其他現場狀況',
];

const REPAIR_IMPACT_OPTIONS = [
  '影響收銀',
  '影響營業',
  '影響顧客動線',
  '有安全疑慮',
  '會影響門市作業',
  '目前仍可正常使用',
];

const PURCHASE_SITUATION_OPTIONS = [
  '陳列架不夠用',
  '掛勾 / 層板 / 配件不足',
  '包材 / 清潔用品不足',
  '設備配件遺失或損壞',
  '門市需要新增用品',
  '不知道分類，請總務判斷',
];

const REQUEST_TYPE_OPTIONS = [
  {
    key: 'REPAIR' as const,
    label: '維修 / 現場狀況回報',
    description: '東西壞了、漏水、病媒、環境或其他現場異常時建立。',
    icon: Wrench,
  },
  {
    key: 'PURCHASE_SUPPLEMENT' as const,
    label: '庶務 / 料件添購補充',
    description: '東西不夠、需要補充，或需要公司目前沒有的物品。',
    icon: PackagePlus,
  },
];

function storeLabel(store: Partial<StoreOption>) {
  return [store.store_code, store.short_name || store.store_name].filter(Boolean).join(' ');
}

function resourceLabel(resource: ResourceOption) {
  const code = resource.asset_code || resource.facility_code;
  const model = [resource.brand, resource.model].filter(Boolean).join(' ');
  const location = [resource.area, resource.location_detail].filter(Boolean).join(' / ');
  return [code, resource.name, model, location].filter(Boolean).join(' - ');
}

function targetSearchText(target: MaintenanceTarget) {
  return [
    target.kind === 'EQUIPMENT' ? '設備' : '設施',
    target.asset_code,
    target.barcode,
    target.facility_code,
    target.name,
    target.brand,
    target.model,
    target.area,
    target.location_detail,
  ].filter(Boolean).join(' ').toLowerCase();
}

function partLabel(part: PartOption) {
  const model = [part.brand, part.model].filter(Boolean).join(' ');
  return [part.part_code, part.name, model, part.specification].filter(Boolean).join(' - ');
}

function partSearchText(part: PartOption) {
  return [
    part.part_code,
    part.barcode,
    part.name,
    part.brand,
    part.model,
    part.specification,
  ].filter(Boolean).join(' ').toLowerCase();
}

function purchaseCatalogLabel(item: PurchaseCatalogItem) {
  return item.label;
}

async function parseResponse(response: Response, fallback: string) {
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.success === false) {
    throw new Error(json?.error || fallback);
  }
  return json;
}

export default function ServiceRequestCreateClient() {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeScope, setStoreScope] = useState<StoreScope>('managed');
  const [equipment, setEquipment] = useState<ResourceOption[]>([]);
  const [facilities, setFacilities] = useState<ResourceOption[]>([]);
  const [parts, setParts] = useState<PartOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [requestType, setRequestType] = useState<RequestType>('REPAIR');
  const [repairResourceType, setRepairResourceType] = useState<RepairResourceType>('EQUIPMENT');
  const [resourceId, setResourceId] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const [partId, setPartId] = useState('');
  const [purchaseTargetType, setPurchaseTargetType] = useState<RepairResourceType | ''>('');
  const [purchaseTargetId, setPurchaseTargetId] = useState('');
  const [purchaseTargetSearch, setPurchaseTargetSearch] = useState('');
  const [partSearch, setPartSearch] = useState('');
  const [repairProblemType, setRepairProblemType] = useState<RepairProblemType | ''>('');
  const [repairSituation, setRepairSituation] = useState('');
  const [repairLocationDetail, setRepairLocationDetail] = useState('');
  const [purchaseEntryMode, setPurchaseEntryMode] = useState<PurchaseEntryMode>('CATALOG');
  const [purchaseSituation, setPurchaseSituation] = useState('');
  const [purchaseUsageLocation, setPurchaseUsageLocation] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [repairImpactOptions, setRepairImpactOptions] = useState<string[]>([]);
  const [impactDescription, setImpactDescription] = useState('');
  const [temporaryWorkaround, setTemporaryWorkaround] = useState('');
  const [desiredQuantity, setDesiredQuantity] = useState('1');
  const [desiredUnit, setDesiredUnit] = useState('');
  const [desiredSpec, setDesiredSpec] = useState('');
  const [contactName, setContactName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [assetTokenPrefill, setAssetTokenPrefill] = useState<AssetTokenPrefill | null>(null);
  const [assetPrefillNotice, setAssetPrefillNotice] = useState('');
  const [loadingStores, setLoadingStores] = useState(true);
  const [loadingResources, setLoadingResources] = useState(false);
  const [loadingParts, setLoadingParts] = useState(false);
  const [loadingCompatibleParts, setLoadingCompatibleParts] = useState(false);
  const [compatiblePartIds, setCompatiblePartIds] = useState<string[]>([]);
  const [showRepairTargetPicker, setShowRepairTargetPicker] = useState(false);
  const [showRepairDetails, setShowRepairDetails] = useState(false);
  const [showPurchaseDetails, setShowPurchaseDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SubmitResult | null>(null);

  const activeResourceType = requestType === 'REPAIR'
    ? (resourceId ? repairResourceType : null)
    : (purchaseEntryMode === 'CATALOG'
      ? (partId ? 'PART' : 'OTHER_PURCHASE')
      : 'OTHER_PURCHASE');
  const shouldLockStoreSelector = storeScope === 'managed' && stores.length <= 1;
  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) || null,
    [selectedStoreId, stores]
  );
  const maintenanceTargets = useMemo<MaintenanceTarget[]>(() => [
    ...equipment.map((item) => ({ ...item, kind: 'EQUIPMENT' as const })),
    ...facilities.map((item) => ({ ...item, kind: 'FACILITY' as const })),
  ], [equipment, facilities]);
  const filteredMaintenanceTargets = useMemo(() => {
    const keyword = targetSearch.trim().toLowerCase();
    if (!keyword) return maintenanceTargets.slice(0, 20);
    return maintenanceTargets
      .filter((target) => targetSearchText(target).includes(keyword))
      .slice(0, 30);
  }, [maintenanceTargets, targetSearch]);
  const filteredPurchaseTargets = useMemo(() => {
    const keyword = purchaseTargetSearch.trim().toLowerCase();
    if (!keyword) return maintenanceTargets.slice(0, 8);
    return maintenanceTargets
      .filter((target) => targetSearchText(target).includes(keyword))
      .slice(0, 12);
  }, [maintenanceTargets, purchaseTargetSearch]);
  const selectedMaintenanceTarget = useMemo(
    () => {
      const matched = maintenanceTargets.find((target) => target.id === resourceId && target.kind === repairResourceType);
      if (matched) return matched;
      if (assetTokenPrefill && resourceId === assetTokenPrefill.id && repairResourceType === assetTokenPrefill.type) {
        return {
          id: assetTokenPrefill.id,
          name: assetTokenPrefill.label,
          kind: assetTokenPrefill.type,
        };
      }
      return null;
    },
    [assetTokenPrefill, maintenanceTargets, repairResourceType, resourceId]
  );
  const filteredParts = useMemo(() => {
    const keyword = partSearch.trim().toLowerCase();
    if (!keyword) return parts.slice(0, 20);
    return parts
      .filter((part) => partSearchText(part).includes(keyword))
      .slice(0, 30);
  }, [partSearch, parts]);
  const selectedPart = useMemo(
    () => parts.find((part) => part.id === partId) || null,
    [partId, parts]
  );
  const purchaseCatalogItems = useMemo<PurchaseCatalogItem[]>(() => [
    ...parts.map((part) => ({
      kind: 'PART' as const,
      id: part.id,
      label: partLabel(part),
      searchText: ['料件', partSearchText(part)].join(' ').toLowerCase(),
      name: part.name,
      unit: part.base_unit,
      part,
    })),
  ], [parts]);
  const compatiblePartIdSet = useMemo(() => new Set(compatiblePartIds), [compatiblePartIds]);
  const filteredPurchaseCatalogItems = useMemo(() => {
    const keyword = partSearch.trim().toLowerCase();
    const filtered = keyword
      ? purchaseCatalogItems.filter((item) => item.searchText.includes(keyword))
      : purchaseCatalogItems;
    return filtered
      .slice()
      .sort((a, b) => {
        const aRecommended = a.kind === 'PART' && compatiblePartIdSet.has(a.id);
        const bRecommended = b.kind === 'PART' && compatiblePartIdSet.has(b.id);
        if (aRecommended === bRecommended) return 0;
        return aRecommended ? -1 : 1;
      })
      .slice(0, 30);
  }, [compatiblePartIdSet, partSearch, purchaseCatalogItems]);
  const selectedPurchaseCatalogItem = useMemo(
    () => purchaseCatalogItems.find((item) => item.id === partId) || null,
    [partId, purchaseCatalogItems]
  );
  const selectedPurchaseTarget = useMemo(
    () => maintenanceTargets.find((target) => target.id === purchaseTargetId && target.kind === purchaseTargetType) || null,
    [maintenanceTargets, purchaseTargetId, purchaseTargetType]
  );
  const selectedRepairProblem = useMemo(
    () => REPAIR_PROBLEM_OPTIONS.find((option) => option.key === repairProblemType) || null,
    [repairProblemType]
  );
  const repairImpactSummary = useMemo(
    () => [
      repairImpactOptions.length > 0 ? `影響項目：${repairImpactOptions.join('、')}` : '',
      impactDescription.trim() ? `補充影響：${impactDescription.trim()}` : '',
    ].filter(Boolean).join('\n'),
    [impactDescription, repairImpactOptions]
  );

  const canSubmit = useMemo(() => {
    if (!selectedStoreId || files.length === 0) return false;
    if (requestType === 'REPAIR' && !repairProblemType) return false;
    if (requestType === 'REPAIR' && repairProblemType === 'FACILITY_ENVIRONMENT' && !repairSituation) return false;
    if (requestType === 'REPAIR' && description.trim().length < 5) return false;
    if (requestType === 'PURCHASE_SUPPLEMENT' && (!desiredQuantity || Number(desiredQuantity) <= 0)) return false;
    if (requestType === 'PURCHASE_SUPPLEMENT' && purchaseEntryMode === 'CATALOG' && !selectedPurchaseCatalogItem) return false;
    if (requestType === 'PURCHASE_SUPPLEMENT' && purchaseEntryMode === 'NEW_PURCHASE' && (!purchaseSituation || !title.trim() || description.trim().length < 5)) return false;
    return true;
  }, [description, desiredQuantity, files.length, purchaseEntryMode, purchaseSituation, repairProblemType, repairSituation, requestType, selectedPurchaseCatalogItem, selectedStoreId, title]);
  const missingItems = useMemo(() => {
    const items = [];
    if (!selectedStoreId) items.push('確認門市');
    if (requestType === 'REPAIR' && !repairProblemType) items.push('選擇是哪一種問題');
    if (requestType === 'REPAIR' && repairProblemType === 'FACILITY_ENVIRONMENT' && !repairSituation) items.push('選擇現場狀況');
    if (requestType === 'PURCHASE_SUPPLEMENT' && purchaseEntryMode === 'CATALOG' && !selectedPurchaseCatalogItem) items.push('選擇公司品項');
    if (requestType === 'PURCHASE_SUPPLEMENT' && purchaseEntryMode === 'NEW_PURCHASE' && !purchaseSituation) items.push('選擇缺東西的情境');
    if (requestType === 'PURCHASE_SUPPLEMENT' && purchaseEntryMode === 'NEW_PURCHASE' && !title.trim()) items.push('填寫想建議採購什麼');
    if (requestType === 'PURCHASE_SUPPLEMENT' && (!desiredQuantity || Number(desiredQuantity) <= 0)) items.push('填寫希望數量');
    if (requestType === 'REPAIR' && description.trim().length < 5) items.push('描述現場狀況');
    if (requestType === 'PURCHASE_SUPPLEMENT' && purchaseEntryMode === 'NEW_PURCHASE' && description.trim().length < 5) items.push('描述補充原因');
    if (files.length === 0) items.push('上傳照片或參考圖');
    return items;
  }, [description, desiredQuantity, files.length, purchaseEntryMode, purchaseSituation, repairProblemType, repairSituation, requestType, selectedPurchaseCatalogItem, selectedStoreId, title]);
  useEffect(() => {
    let mounted = true;

    async function loadStores() {
      setLoadingStores(true);
      setError('');
      try {
        const json = await parseResponse(await fetch('/api/user/managed-stores'), '門市資料載入失敗');
        const nextStores = (json.stores || []) as StoreOption[];
        if (!mounted) return;
        setStores(nextStores);
        setStoreScope(json.scope === 'all' ? 'all' : 'managed');
        setSelectedStoreId((current) => (
          nextStores.some((store) => store.id === current) ? current : nextStores[0]?.id || ''
        ));
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : '門市資料載入失敗');
      } finally {
        if (mounted) setLoadingStores(false);
      }
    }

    loadStores();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function applyAssetTokenPrefill() {
      const token = new URLSearchParams(window.location.search).get('assetToken')?.trim();
      if (!token) return;

      setRequestType('REPAIR');
      setError('');
      setAssetPrefillNotice('正在讀取 QR Code 維修標的...');
      try {
        const json = await parseResponse(
          await fetch(`/api/general-affairs/assets/scan/${encodeURIComponent(token)}`),
          'QR Code 維修標的載入失敗',
        );
        if (!mounted) return;

        const data = json.data || {};
        if (data.type !== 'EQUIPMENT' && data.type !== 'FACILITY') {
          throw new Error('QR Code 對應的標的不是設備或設施');
        }
        if (!data.id || !data.store?.id) {
          throw new Error('QR Code 標的缺少門市或資產資料，請回設備主檔確認');
        }

        const prefill = {
          token,
          id: data.id as string,
          type: data.type as RepairResourceType,
          storeId: data.store.id as string,
          label: [
            data.code,
            data.name,
            [data.brand, data.model].filter(Boolean).join(' '),
            [data.area, data.location_detail].filter(Boolean).join(' / '),
          ].filter(Boolean).join(' - '),
        };

        setAssetTokenPrefill(prefill);
        setSelectedStoreId(prefill.storeId);
        setRequestType('REPAIR');
        setRepairProblemType('EQUIPMENT_FAILURE');
        setRepairResourceType(prefill.type);
        setResourceId(prefill.id);
        setTargetSearch(prefill.label);
        setShowRepairTargetPicker(true);
        setTitle((current) => current || `${data.name || '設備/設施'} 維修回報`);
        setAssetPrefillNotice('已由 QR Code 帶入維修標的。');
      } catch (loadError) {
        if (!mounted) return;
        setAssetTokenPrefill(null);
        setAssetPrefillNotice('');
        setError(loadError instanceof Error ? loadError.message : 'QR Code 維修標的載入失敗');
      }
    }

    applyAssetTokenPrefill();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedStoreId) return;
    let mounted = true;
    setPurchaseTargetId('');
    setPurchaseTargetType('');
    setPurchaseTargetSearch('');
    setCompatiblePartIds([]);

    async function loadResources() {
      setLoadingResources(true);
      try {
        const json = await parseResponse(
          await fetch(`/api/general-affairs/request-targets?storeId=${selectedStoreId}`),
          '設備/設施資料載入失敗',
        );
        if (!mounted) return;
        setEquipment((json.equipment || []) as ResourceOption[]);
        setFacilities((json.facilities || []) as ResourceOption[]);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : '設備/設施資料載入失敗');
      } finally {
        if (mounted) setLoadingResources(false);
      }
    }

    loadResources();
    return () => {
      mounted = false;
    };
  }, [selectedStoreId]);

  useEffect(() => {
    let mounted = true;

    async function loadParts() {
      setLoadingParts(true);
      try {
        const json = await parseResponse(
          await fetch('/api/general-affairs/parts?isActive=true&pageSize=100'),
          '料件資料載入失敗',
        );
        if (!mounted) return;
        setParts((json.data || []) as PartOption[]);
      } catch {
        if (mounted) setParts([]);
      } finally {
        if (mounted) setLoadingParts(false);
      }
    }

    loadParts();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (assetTokenPrefill && requestType === 'REPAIR' && selectedStoreId === assetTokenPrefill.storeId) {
      setRepairResourceType(assetTokenPrefill.type);
      setResourceId(assetTokenPrefill.id);
      setTargetSearch(assetTokenPrefill.label);
      return;
    }
    setResourceId('');
    setTargetSearch('');
  }, [assetTokenPrefill, requestType, selectedStoreId]);

  useEffect(() => {
    if (!assetTokenPrefill || requestType !== 'REPAIR' || selectedStoreId !== assetTokenPrefill.storeId) return;
    const exists = maintenanceTargets.some((target) => target.id === assetTokenPrefill.id && target.kind === assetTokenPrefill.type);
    if (!exists) return;
    setRepairResourceType(assetTokenPrefill.type);
    setResourceId(assetTokenPrefill.id);
    setTargetSearch(assetTokenPrefill.label);
  }, [assetTokenPrefill, maintenanceTargets, requestType, selectedStoreId]);

  useEffect(() => {
    let alive = true;
    async function loadCompatibleParts() {
      if (!purchaseTargetId || !purchaseTargetType || requestType !== 'PURCHASE_SUPPLEMENT' || purchaseEntryMode !== 'CATALOG') {
        setCompatiblePartIds([]);
        setLoadingCompatibleParts(false);
        return;
      }
      setLoadingCompatibleParts(true);
      try {
        const json = await parseResponse(await fetch(
          `/api/general-affairs/parts/target-compatibilities?targetType=${purchaseTargetType}&targetId=${encodeURIComponent(purchaseTargetId)}`
        ), '相容料件讀取失敗');
        if (!alive) return;
        const rows = (json.data || []) as TargetCompatibilityRow[];
        setCompatiblePartIds(rows.map((row) => row.part_id));
      } catch {
        if (!alive) return;
        setCompatiblePartIds([]);
      } finally {
        if (alive) setLoadingCompatibleParts(false);
      }
    }
    loadCompatibleParts();
    return () => {
      alive = false;
    };
  }, [purchaseEntryMode, purchaseTargetId, purchaseTargetType, requestType]);

  function selectMaintenanceTarget(target: MaintenanceTarget) {
    setAssetTokenPrefill(null);
    setAssetPrefillNotice('');
    setRepairProblemType(target.kind === 'EQUIPMENT' ? 'EQUIPMENT_FAILURE' : 'FACILITY_ENVIRONMENT');
    setRepairResourceType(target.kind);
    setResourceId(target.id);
    setTargetSearch(resourceLabel(target));
  }

  function selectRepairProblemType(problemType: RepairProblemType) {
    setRepairProblemType(problemType);
    setAssetTokenPrefill(null);
    setAssetPrefillNotice('');
    if (problemType !== 'FACILITY_ENVIRONMENT') {
      setRepairSituation('');
    }
    if (problemType === 'EQUIPMENT_FAILURE') {
      setRepairResourceType('EQUIPMENT');
      setShowRepairTargetPicker(true);
    } else {
      setResourceId('');
      setTargetSearch('');
      setShowRepairTargetPicker(false);
    }
  }

  function toggleRepairImpact(option: string) {
    setRepairImpactOptions((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option]
    );
  }

  function selectPart(part: PartOption) {
    setPartId(part.id);
    setPartSearch(partLabel(part));
    setTitle(part.name);
    setDesiredUnit((current) => current || part.base_unit || '');
  }

  function selectPurchaseCatalogItem(item: PurchaseCatalogItem) {
    setPartSearch(purchaseCatalogLabel(item));
    setTitle(item.name);
    setPartId(item.id);
    setDesiredUnit((current) => current || item.unit || '');
  }

  function selectPurchaseTarget(target: MaintenanceTarget) {
    setPurchaseTargetType(target.kind);
    setPurchaseTargetId(target.id);
    setPurchaseTargetSearch(resourceLabel(target));
  }

  function autoRepairTitle() {
    return [
      storeLabel(selectedStore || {}),
      selectedRepairProblem?.label || repairSituation || '現場狀況回報',
      repairSituation,
      repairLocationDetail.trim(),
    ].filter(Boolean).join('｜').slice(0, 120);
  }

  function autoPurchaseTitle() {
    return [
      storeLabel(selectedStore || {}),
      purchaseEntryMode === 'CATALOG' ? '補公司既有品項' : (purchaseSituation || '建議採購新品'),
      selectedPurchaseCatalogItem?.name || title.trim(),
    ].filter(Boolean).join('｜').slice(0, 120);
  }

  function onFilesChange(next: FileList | null) {
    setFiles(Array.from(next || []));
  }

  async function uploadAttachments(requestId: string) {
    const formData = new FormData();
    formData.set('resource_type', 'SERVICE_REQUEST');
    formData.set('resource_id', requestId);
    formData.set('purpose', requestType === 'REPAIR' ? 'ISSUE_PHOTO' : 'REFERENCE_IMAGE');
    files.forEach((file) => formData.append('files', file));

    await parseResponse(await fetch('/api/general-affairs/attachments', {
      method: 'POST',
      body: formData,
    }), '照片/參考圖上傳失敗');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setError('');
    setResult(null);

    try {
      const submitTitle = requestType === 'REPAIR'
        ? autoRepairTitle()
        : autoPurchaseTitle();
      const repairContext = requestType === 'REPAIR'
        ? [
          selectedRepairProblem ? `問題類型：${selectedRepairProblem.label}` : null,
          repairSituation ? `狀況類型：${repairSituation}` : null,
          repairLocationDetail.trim()
            ? `發生位置：${repairLocationDetail.trim()}`
            : null,
          `現場描述：${description.trim()}`,
        ].filter(Boolean).join('\n')
        : purchaseEntryMode === 'CATALOG'
          ? [
            selectedPurchaseCatalogItem ? `公司品項：${purchaseCatalogLabel(selectedPurchaseCatalogItem)}` : null,
            selectedPurchaseTarget ? `使用對象：${resourceLabel(selectedPurchaseTarget)}` : null,
            purchaseUsageLocation ? `使用位置：${purchaseUsageLocation}` : null,
            `需求說明：補充公司既有品項`,
          ].filter(Boolean).join('\n')
          : [
            purchaseSituation ? `需求情境：${purchaseSituation}` : null,
            title.trim() ? `建議採購：${title.trim()}` : null,
            purchaseUsageLocation ? `使用位置：${purchaseUsageLocation}` : null,
            desiredSpec ? `希望規格：${desiredSpec.trim()}` : null,
            `需求說明：${description.trim()}`,
          ].filter(Boolean).join('\n');
      const repairResourceTypeForSubmit = requestType === 'REPAIR' && resourceId ? repairResourceType : null;
      const payload = {
        store_id: selectedStoreId,
        request_type: requestType,
        title: submitTitle,
        description: repairContext,
        resource_type: activeResourceType,
        equipment_id: repairResourceTypeForSubmit === 'EQUIPMENT' ? resourceId : null,
        facility_id: repairResourceTypeForSubmit === 'FACILITY' ? resourceId : null,
        part_id: requestType === 'PURCHASE_SUPPLEMENT' && activeResourceType === 'PART' ? partId || null : null,
        desired_quantity: requestType === 'PURCHASE_SUPPLEMENT' ? desiredQuantity : null,
        desired_unit: requestType === 'PURCHASE_SUPPLEMENT' ? desiredUnit : null,
        desired_spec: requestType === 'PURCHASE_SUPPLEMENT' ? desiredSpec : null,
        impact_description: requestType === 'REPAIR' ? repairImpactSummary : impactDescription,
        temporary_workaround: temporaryWorkaround,
        contact_name: contactName,
      };

      const json = await parseResponse(await fetch('/api/general-affairs/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }), '需求單建立失敗');

      const created = json.data as SubmitResult;
      await uploadAttachments(created.id);
      setResult(created);
      setRepairSituation('');
      setRepairProblemType('');
      setRepairLocationDetail('');
      setPurchaseSituation('');
      setPurchaseEntryMode('CATALOG');
      setPurchaseUsageLocation('');
      setPartId('');
      setPartSearch('');
      setTitle('');
      setDescription('');
      setRepairImpactOptions([]);
      setImpactDescription('');
      setTemporaryWorkaround('');
      setDesiredQuantity('1');
      setDesiredUnit('');
      setDesiredSpec('');
      setContactName('');
      setFiles([]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '需求單建立失敗');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <GeneralAffairsPageHeader
        breadcrumbs={[
          { label: '總務服務中心', href: '/general-affairs' },
          { label: '新增需求' },
        ]}
        title="跟總務說你需要什麼協助"
        description="先說發生什麼事或缺什麼東西，總務受理後會判斷後續要維修、出庫、調撥或採購。"
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-white p-6 text-emerald-950 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </span>
              <div>
                <div className="text-xl font-black">需求已送出完成</div>
                <p className="mt-2 text-sm font-semibold leading-6 text-emerald-900">
                  單號 <span className="font-mono font-black">{result.request_no}</span> 已建立。這筆需求已送到總務，不需要再重複送出。
                </p>
                <p className="mt-2 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-800">
                  目前進度：{result.public_progress || '等待總務接手。'}
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 md:min-w-80 md:grid-cols-1">
              <a
                href="/general-affairs/reports/mine"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
              >
                <ClipboardList className="h-4 w-4" />
                查看我的追蹤
              </a>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setError('');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-white px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-50"
              >
                再新增一筆需求
              </button>
            </div>
          </div>
          <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-600">
            後續若總務需要補資料、請你確認收貨或確認完成，都會出現在「我的追蹤」。
          </div>
        </div>
      )}

      {!result && (
      <form onSubmit={handleSubmit} className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">選需求類型</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {REQUEST_TYPE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const selected = requestType === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      if (option.key !== 'REPAIR') {
                        setAssetTokenPrefill(null);
                        setAssetPrefillNotice('');
                      }
                      setRequestType(option.key);
                      setShowRepairTargetPicker(false);
                      setShowRepairDetails(false);
                      setShowPurchaseDetails(false);
                    }}
                    className={`flex min-h-14 items-center gap-3 rounded-md border p-3 text-left transition ${selected ? 'border-orange-500 bg-orange-50 text-orange-950' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'}`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${selected ? 'text-orange-600' : 'text-slate-400'}`} />
                    <span>
                      <span className="block font-semibold">{option.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">先確認門市</h2>
            <div className="mt-3 grid gap-4">
              <label className="block text-sm font-medium text-slate-700">
                門市
                <select
                  value={selectedStoreId}
                  onChange={(event) => {
                    setAssetTokenPrefill(null);
                    setAssetPrefillNotice('');
                    setSelectedStoreId(event.target.value);
                  }}
                  disabled={loadingStores || submitting || shouldLockStoreSelector}
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                >
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{storeLabel(store)}</option>
                  ))}
                </select>
              </label>
            </div>

          </div>

          {requestType === 'REPAIR' ? (
            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">選問題類型</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {REPAIR_PROBLEM_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const selected = repairProblemType === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => selectRepairProblemType(option.key)}
                      className={`flex min-h-14 items-center gap-3 rounded-md border p-3 text-left transition ${selected ? 'border-orange-500 bg-orange-50 text-orange-950' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'}`}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${selected ? 'text-orange-600' : 'text-slate-400'}`} />
                      <span>
                        <span className="block text-sm font-semibold">{option.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {repairProblemType === 'FACILITY_ENVIRONMENT' && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <h3 className="text-sm font-semibold text-slate-900">店內發生哪一種狀況？</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {REPAIR_SITUATION_OPTIONS.map((option) => {
                      const selected = repairSituation === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setRepairSituation(option)}
                          className={`min-h-10 rounded-md border px-3 py-2 text-left text-sm font-medium transition ${selected ? 'border-orange-500 bg-orange-50 text-orange-950' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'}`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <label className="block text-sm font-medium text-slate-700">
                  發生位置
                  <input
                    value={repairLocationDetail}
                    onChange={(event) => setRepairLocationDetail(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    placeholder="例：櫃台上方、收銀機旁、後門上方"
                    maxLength={120}
                  />
                </label>
              </div>

              <label className="mt-4 block text-sm font-medium text-slate-700">
                請描述現場狀況
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="mt-1 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  placeholder="例：櫃台上方會滴水，今天早上開始，水會滴到收銀區。"
                  maxLength={2000}
                />
              </label>

              {repairProblemType === 'EQUIPMENT_FAILURE' && (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setShowRepairTargetPicker((current) => !current)}
                  className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-semibold text-slate-800"
                >
                  <span>搜尋公司設備</span>
                  <span className="text-xs font-medium text-slate-500">{showRepairTargetPicker ? '收合' : '找不到可直接描述'}</span>
                </button>
                {selectedMaintenanceTarget && !showRepairTargetPicker && (
                  <div className="border-t border-slate-200 px-3 py-2 text-sm text-emerald-800">
                    已選擇：設備｜{resourceLabel(selectedMaintenanceTarget)}
                  </div>
                )}
                {showRepairTargetPicker && (
                  <div className="border-t border-slate-200 bg-white p-3">
                    {assetPrefillNotice && (
                      <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
                        {assetPrefillNotice}
                      </div>
                    )}
                    <label className="block text-sm font-medium text-slate-700">
                      設備編號、名稱或位置
                      <input
                        value={targetSearch}
                        onChange={(event) => {
                          setAssetTokenPrefill(null);
                          setAssetPrefillNotice('');
                          setTargetSearch(event.target.value);
                          setResourceId('');
                        }}
                        disabled={loadingResources}
                        className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        placeholder={loadingResources ? '載入設備中...' : '例：IC0220260821001、TP805、冷氣；不知道可留空'}
                      />
                    </label>
                    {selectedMaintenanceTarget ? (
                      <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        已選擇：設備｜{resourceLabel(selectedMaintenanceTarget)}
                      </div>
                    ) : (
                      <div className="mt-3 max-h-56 overflow-auto rounded-md border border-slate-200">
                        {filteredMaintenanceTargets.filter((target) => target.kind === 'EQUIPMENT').map((target) => (
                          <button
                            key={`${target.kind}-${target.id}`}
                            type="button"
                            onClick={() => selectMaintenanceTarget(target)}
                            className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-orange-50"
                          >
                            <span className="mt-0.5 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                              設備
                            </span>
                            <span>
                              <span className="block font-medium text-slate-900">{resourceLabel(target)}</span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {[target.asset_code, target.barcode, target.area, target.location_detail].filter(Boolean).join(' / ') || '未設定位置補充'}
                              </span>
                            </span>
                          </button>
                        ))}
                        {!loadingResources && filteredMaintenanceTargets.filter((target) => target.kind === 'EQUIPMENT').length === 0 && (
                          <div className="px-3 py-3 text-sm text-slate-500">找不到符合的設備，可直接描述現場問題後送出。</div>
                        )}
                      </div>
                    )}
                    {!loadingResources && maintenanceTargets.length === 0 && (
                      <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        這間門市目前沒有可選的設備主檔，仍可先送出狀況回報。
                      </p>
                    )}
                  </div>
                )}
              </div>
              )}

              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setShowRepairDetails((current) => !current)}
                  className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-semibold text-slate-800"
                >
                  <span>補充影響或已先處理的方式</span>
                  <span className="text-xs font-medium text-slate-500">{showRepairDetails ? '收合' : '選填'}</span>
                </button>
                {showRepairDetails && (
                  <div className="grid gap-4 border-t border-slate-200 bg-white p-3 md:grid-cols-2">
                    <div>
                      <div className="text-sm font-medium text-slate-700">對營運的影響</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {REPAIR_IMPACT_OPTIONS.map((option) => {
                          const selected = repairImpactOptions.includes(option);
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => toggleRepairImpact(option)}
                              className={`rounded-md border px-3 py-2 text-left text-sm font-medium transition ${selected ? 'border-orange-500 bg-orange-50 text-orange-950' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'}`}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                      <textarea
                        value={impactDescription}
                        onChange={(event) => setImpactDescription(event.target.value)}
                        className="mt-3 min-h-16 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                        placeholder="還有其他影響可以補充在這裡。"
                        maxLength={1000}
                      />
                    </div>
                    <label className="block text-sm font-medium text-slate-700">
                      暫時處理方式
                      <textarea
                        value={temporaryWorkaround}
                        onChange={(event) => setTemporaryWorkaround(event.target.value)}
                        className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                        placeholder="例：先用水桶接水、先改走另一個入口。"
                        maxLength={1000}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-950">要補什麼？</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setPurchaseEntryMode('CATALOG');
                    setPurchaseSituation('');
                    setDescription('');
                    setShowPurchaseDetails(false);
                  }}
                  className={`min-h-12 rounded-md border px-3 py-2 text-left text-sm font-semibold transition ${purchaseEntryMode === 'CATALOG' ? 'border-orange-500 bg-orange-50 text-orange-950' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'}`}
                >
                  補公司既有品項
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPurchaseEntryMode('NEW_PURCHASE');
                    setPartId('');
                    setPartSearch('');
                    setTitle('');
                    setDesiredUnit('');
                  }}
                  className={`min-h-12 rounded-md border px-3 py-2 text-left text-sm font-semibold transition ${purchaseEntryMode === 'NEW_PURCHASE' ? 'border-orange-500 bg-orange-50 text-orange-950' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'}`}
                >
                  建議採購新品
                </button>
              </div>

              {purchaseEntryMode === 'CATALOG' ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-sm font-medium text-slate-700">
                      使用在哪裡（選填）
                      <input
                        value={purchaseTargetSearch}
                        onChange={(event) => {
                          setPurchaseTargetSearch(event.target.value);
                          setPurchaseTargetId('');
                          setPurchaseTargetType('');
                        }}
                        disabled={loadingResources}
                        className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                        placeholder={loadingResources ? '載入設備與設施中...' : '例：中島架、印表機、櫃台'}
                      />
                    </label>
                    {selectedPurchaseTarget ? (
                      <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                        <span>已依 {resourceLabel(selectedPurchaseTarget)} 推薦適用料件</span>
                        {loadingCompatibleParts && <span className="text-xs font-semibold">讀取中...</span>}
                      </div>
                    ) : (
                      <div className="mt-2 max-h-40 overflow-auto rounded-md border border-slate-200 bg-white">
                        {filteredPurchaseTargets.map((target) => (
                          <button
                            key={`${target.kind}-${target.id}`}
                            type="button"
                            onClick={() => selectPurchaseTarget(target)}
                            className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-orange-50"
                          >
                            <span className="mt-0.5 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                              {target.kind === 'EQUIPMENT' ? '設備' : '設施'}
                            </span>
                            <span>
                              <span className="block font-medium text-slate-900">{resourceLabel(target)}</span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {[target.asset_code, target.facility_code, target.area, target.location_detail].filter(Boolean).join(' / ') || '未設定位置補充'}
                              </span>
                            </span>
                          </button>
                        ))}
                        {!loadingResources && filteredPurchaseTargets.length === 0 && (
                          <div className="px-3 py-3 text-sm text-slate-500">找不到符合的設備或設施，也可以直接搜尋品項。</div>
                        )}
                      </div>
                    )}
                    {selectedPurchaseTarget && compatiblePartIds.length === 0 && !loadingCompatibleParts && (
                      <div className="mt-2 text-xs text-slate-500">目前沒有已設定的相容料件，仍可搜尋全部公司品項。</div>
                    )}
                  </div>

                  <label className="block text-sm font-medium text-slate-700">
                    搜尋品項
                    <input
                      value={partSearch}
                      onChange={(event) => {
                        setPartSearch(event.target.value);
                        setPartId('');
                        setTitle('');
                      }}
                      disabled={loadingParts || loadingResources}
                      className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                      placeholder={loadingParts || loadingResources ? '載入料件中...' : '例：掛勾、層板、熱感紙、碳粉'}
                    />
                  </label>
                  {selectedPurchaseCatalogItem ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      已選擇：{purchaseCatalogLabel(selectedPurchaseCatalogItem)}
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
                      {filteredPurchaseCatalogItems.map((item) => (
                        <button
                          key={`${item.kind}-${item.id}`}
                          type="button"
                          onClick={() => selectPurchaseCatalogItem(item)}
                          className="flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-orange-50"
                        >
                          <span className="mt-0.5 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                            料件
                          </span>
                          <span>
                            <span className="block font-medium text-slate-900">
                              {purchaseCatalogLabel(item)}
                              {compatiblePartIdSet.has(item.id) && (
                                <span className="ml-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                  適用
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {[item.part.part_code, item.part.barcode, item.part.base_unit].filter(Boolean).join(' / ') || '未設定料號或單位'}
                            </span>
                          </span>
                        </button>
                      ))}
                      {!loadingParts && !loadingResources && filteredPurchaseCatalogItems.length === 0 && (
                        <div className="px-3 py-3 text-sm text-slate-500">找不到符合的品項，請改用「建議採購新品」。</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {PURCHASE_SITUATION_OPTIONS.map((option) => {
                      const selected = purchaseSituation === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setPurchaseSituation(option)}
                          className={`min-h-10 rounded-md border px-3 py-2 text-left text-sm font-medium transition ${selected ? 'border-orange-500 bg-orange-50 text-orange-950' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'}`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                  <label className="block text-sm font-medium text-slate-700">
                    想建議採購什麼
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                      placeholder="例：中島架掛勾、層板、熱感紙、清潔用品"
                      maxLength={120}
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    為什麼需要
                    <textarea
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                      placeholder="例：目前中島架少掛勾，商品無法完整陳列。"
                      maxLength={2000}
                    />
                  </label>
                </div>
              )}

              <div className="mt-4 grid gap-4 md:grid-cols-[1fr_160px_160px]">
                <label className="block text-sm font-medium text-slate-700">
                  使用位置
                  <input
                    value={purchaseUsageLocation}
                    onChange={(event) => setPurchaseUsageLocation(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    placeholder="例：櫃台內、中島架、倉庫"
                    maxLength={120}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  希望數量
                  <input
                    value={desiredQuantity}
                    onChange={(event) => setDesiredQuantity(event.target.value)}
                    type="number"
                    min="0.01"
                    step="0.01"
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  單位
                  <input
                    value={desiredUnit}
                    onChange={(event) => setDesiredUnit(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    placeholder="個、箱、組"
                    maxLength={20}
                  />
                </label>
              </div>

              {purchaseEntryMode === 'NEW_PURCHASE' && (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setShowPurchaseDetails((current) => !current)}
                    className="flex w-full items-center justify-between px-3 py-3 text-left text-sm font-semibold text-slate-800"
                  >
                    <span>補充規格、尺寸或品牌</span>
                    <span className="text-xs font-medium text-slate-500">{showPurchaseDetails ? '收合' : '選填'}</span>
                  </button>
                  {showPurchaseDetails && (
                    <div className="border-t border-slate-200 bg-white p-3">
                      <label className="block text-sm font-medium text-slate-700">
                        希望規格
                        <textarea
                          value={desiredSpec}
                          onChange={(event) => setDesiredSpec(event.target.value)}
                          className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                          placeholder="可描述尺寸、品牌、參考用途；最終規格由總務決定。"
                          maxLength={1000}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Camera className="h-4 w-4 text-orange-600" />
              現場照片
            </h2>
            <label className="mt-3 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500 hover:border-orange-300 hover:bg-orange-50">
              <Camera className="mb-2 h-5 w-5 text-slate-400" />
              拍照 / 選照片
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                onChange={(event) => onFilesChange(event.target.files)}
                className="sr-only"
              />
            </label>
            {files.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {files.map((file) => (
                  <li key={`${file.name}-${file.size}`} className="truncate rounded bg-slate-50 px-2 py-1">{file.name}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs font-medium text-red-600">請至少上傳 1 張照片。</p>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="sticky bottom-3 z-10 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white shadow-lg transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300 lg:hidden"
          >
            {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? '送出中' : '送出需求'}
          </button>
        </section>

        <aside className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <ClipboardList className="h-4 w-4 text-orange-600" />
              送出前檢查
            </h2>
            <div className={`mt-3 rounded-md border p-3 ${canSubmit ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-orange-200 bg-orange-50 text-orange-900'}`}>
              <div className="flex items-center gap-2 text-sm font-black">
                {canSubmit ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {canSubmit ? '可以送出' : '還差這些'}
              </div>
            </div>
            {missingItems.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {missingItems.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                資料已足夠。
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit || submitting}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? '送出中' : '送出需求'}
          </button>
        </aside>
      </form>
      )}
    </div>
  );
}
