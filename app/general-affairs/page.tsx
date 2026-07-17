'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Box,
  Building2,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock3,
  CalendarDays,
  FileText,
  Filter,
  ImagePlus,
  Loader2,
  Package,
  Phone,
  Search,
  Send,
  Settings,
  Trash2,
  User,
  Warehouse,
  Wrench,
  XCircle,
} from 'lucide-react';

type MaintenanceStatus = 'pending' | 'in_progress' | 'completed' | 'closed';
type ResourceType = 'equipment' | 'facility' | 'material';
type ServiceSection = 'maintenance' | 'work-orders' | 'equipment' | 'facilities' | 'parts';
type MaintenanceView = 'new' | 'mine';

type StoreOption = {
  id: string;
  store_code: string;
  store_name: string;
};

type MaintenanceRequest = {
  id: string;
  store_id: string;
  title: string;
  description: string | null;
  reporter_name: string;
  status: MaintenanceStatus;
  priority: string | null;
  resource_type?: ResourceType | null;
  issue_type?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  reported_at: string;
  store?: StoreOption | null;
};

type MaintenanceUpdate = {
  id: string;
  request_id: string;
  status: MaintenanceStatus;
  notes: string;
  progress_date: string;
  updated_by_name: string;
  created_at: string;
};

const serviceNavItems: Array<{ key: ServiceSection; label: string; icon: any }> = [
  { key: 'maintenance', label: '維修回報', icon: Wrench },
  { key: 'work-orders', label: '工單中心', icon: ClipboardList },
  { key: 'equipment', label: '設備管理', icon: Settings },
  { key: 'facilities', label: '設施管理', icon: Building2 },
  { key: 'parts', label: '料件中心', icon: Warehouse },
];

const resourceTypes: Array<{
  key: ResourceType;
  label: string;
  hint: string;
  icon: any;
  issueTypes: string[];
}> = [
  {
    key: 'equipment',
    label: '設備',
    hint: '有型號、序號或維修紀錄',
    icon: Wrench,
    issueTypes: ['不冷 / 冷度不足', '無法開機', '異音 / 異味', '漏水 / 滲水', '畫面異常', '其他設備問題'],
  },
  {
    key: 'facility',
    label: '設施',
    hint: '建築、固定設施與空間',
    icon: Building2,
    issueTypes: ['門窗異常', '照明異常', '水電異常', '牆面 / 地板損壞', '招牌異常', '其他設施問題'],
  },
  {
    key: 'material',
    label: '料件 / 耗材',
    hint: '零件、耗材與維修物品申請',
    icon: Box,
    issueTypes: ['耗材不足', '零件更換', '規格確認', '補件申請', '其他料件需求'],
  },
];

const statusMeta: Record<MaintenanceStatus, { label: string; tone: string; dot: string; icon: any }> = {
  pending: { label: '等待處理', tone: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400', icon: Clock3 },
  in_progress: { label: '處理中', tone: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', icon: Settings },
  completed: { label: '已完成', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2 },
  closed: { label: '已結案', tone: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400', icon: XCircle },
};

const progressSteps: Array<{ status: MaintenanceStatus; label: string }> = [
  { status: 'pending', label: '提出回報' },
  { status: 'in_progress', label: '總務處理' },
  { status: 'completed', label: '完成結果' },
  { status: 'closed', label: '完成結案' },
];

const reportStatusFilters: Array<{
  key: 'all' | MaintenanceStatus;
  label: string;
  helper: string;
  icon: any;
  iconTone: string;
  badgeTone: string;
}> = [
  {
    key: 'all',
    label: '全部工單',
    helper: '查看全部',
    icon: Wrench,
    iconTone: 'bg-blue-50 text-blue-600 ring-blue-100',
    badgeTone: 'bg-blue-50 text-blue-700',
  },
  {
    key: 'in_progress',
    label: '處理中',
    helper: '總務處理中',
    icon: Settings,
    iconTone: 'bg-orange-50 text-orange-600 ring-orange-100',
    badgeTone: 'bg-orange-50 text-orange-700',
  },
  {
    key: 'pending',
    label: '等待處理',
    helper: '已受理待處理',
    icon: Clock3,
    iconTone: 'bg-amber-50 text-amber-600 ring-amber-100',
    badgeTone: 'bg-amber-50 text-amber-700',
  },
  {
    key: 'completed',
    label: '已完成',
    helper: '查看歷史',
    icon: CheckCircle2,
    iconTone: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    badgeTone: 'bg-emerald-50 text-emerald-700',
  },
  {
    key: 'closed',
    label: '已結案',
    helper: '已結案工單',
    icon: XCircle,
    iconTone: 'bg-slate-100 text-slate-500 ring-slate-200',
    badgeTone: 'bg-slate-100 text-slate-600',
  },
];

const getDateTimeLabel = (value: string | null | undefined) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const getDateInTaipei = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

const getDefaultReportStartDate = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 2);
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
};

export default function GeneralAffairsServiceCenterPage() {
  const supabase = createClient();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState<ServiceSection>('maintenance');
  const [maintenanceExpanded, setMaintenanceExpanded] = useState(true);
  const [maintenanceView, setMaintenanceView] = useState<MaintenanceView>('new');
  const [reportStep, setReportStep] = useState(1);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingReports, setLoadingReports] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [canAccessService, setCanAccessService] = useState(false);
  const [canSubmit, setCanSubmit] = useState(false);
  const [canViewAll, setCanViewAll] = useState(false);
  const [canUpdateWorkOrders, setCanUpdateWorkOrders] = useState(false);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [reportStoreId, setReportStoreId] = useState('');
  const [profileName, setProfileName] = useState('');
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [updatesByRequestId, setUpdatesByRequestId] = useState<Map<string, MaintenanceUpdate[]>>(new Map());
  const [statusFilter, setStatusFilter] = useState<'all' | MaintenanceStatus>('all');
  const [reportStartDate, setReportStartDate] = useState(getDefaultReportStartDate);
  const [reportEndDate, setReportEndDate] = useState(getDateInTaipei);
  const [searchText, setSearchText] = useState('');
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [savingWorkOrderUpdate, setSavingWorkOrderUpdate] = useState(false);
  const [workOrderUpdateForm, setWorkOrderUpdateForm] = useState({
    status: 'in_progress' as MaintenanceStatus,
    progressDate: getDateInTaipei(),
    notes: '',
  });
  const [form, setForm] = useState({
    resourceType: 'equipment' as ResourceType,
    itemName: '',
    issueType: resourceTypes[0].issueTypes[0],
    description: '',
    contactName: '',
    contactPhone: '',
    note: '',
  });
  const [photos, setPhotos] = useState<Array<{ file: File; preview: string }>>([]);

  const activeResource = resourceTypes.find((item) => item.key === form.resourceType) || resourceTypes[0];
  const selectedStore = stores.find((store) => store.id === reportStoreId) || null;

  const updateReportStartDate = (value: string) => {
    setReportStartDate(value);
    if (value && reportEndDate && value > reportEndDate) {
      setReportEndDate(value);
    }
  };

  const updateReportEndDate = (value: string) => {
    setReportEndDate(value);
    if (value && reportStartDate && value < reportStartDate) {
      setReportStartDate(value);
    }
  };

  const statusCounts = useMemo(() => {
    return requests.reduce((acc, row) => {
      acc.all += 1;
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, { all: 0, pending: 0, in_progress: 0, completed: 0, closed: 0 } as Record<'all' | MaintenanceStatus, number>);
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return requests.filter((request) => {
      if (statusFilter !== 'all' && request.status !== statusFilter) return false;
      if (!keyword) return true;
      return [
        request.title,
        request.description,
        request.issue_type,
        request.contact_name,
        request.store?.store_code,
        request.store?.store_name,
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [requests, searchText, statusFilter]);

  const checkPermission = async (permissionCode: string) => {
    const res = await fetch('/api/permissions/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionCode }),
    });
    const json = await res.json();
    return Boolean(json.allowed);
  };

  const checkServiceAccess = async () => {
    const res = await fetch('/api/general-affairs/access', { cache: 'no-store' });
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json.allowed);
  };

  const loadReports = useCallback(async () => {
    if (!selectedStoreId && !canViewAll) return;
    setLoadingReports(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50' });
      if (selectedStoreId) params.set('store_id', selectedStoreId);
      if (reportStartDate) params.set('start_date', reportStartDate);
      if (reportEndDate) params.set('end_date', reportEndDate);
      const res = await fetch(`/api/maintenance-requests?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '載入維修回報失敗');
      }
      const rows = (json.data || []) as MaintenanceRequest[];
      setRequests(rows);

      const updatePairs = await Promise.all(rows.slice(0, 30).map(async (request) => {
        const updateRes = await fetch(`/api/maintenance-updates?request_id=${request.id}`);
        const updateJson = await updateRes.json();
        return [request.id, updateJson.success ? updateJson.data || [] : []] as const;
      }));
      setUpdatesByRequestId(new Map(updatePairs));
    } catch (error: any) {
      alert(`載入維修回報失敗：${error.message || error}`);
      setRequests([]);
      setUpdatesByRequestId(new Map());
    } finally {
      setLoadingReports(false);
    }
  }, [canViewAll, reportEndDate, reportStartDate, selectedStoreId]);

  useEffect(() => {
    (async () => {
      setLoadingInitial(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [accessAllowed, submitAllowed, viewAllAllowed, updateAllowed, profileRes] = await Promise.all([
          checkServiceAccess(),
          checkPermission('cross_dept.maintenance.submit'),
          checkPermission('cross_dept.maintenance.view_all'),
          checkPermission('cross_dept.maintenance.update'),
          supabase.from('profiles').select('full_name').eq('id', user.id).single(),
        ]);

        const name = profileRes.data?.full_name || user.email || '';
        setProfileName(name);
        setForm((current) => ({ ...current, contactName: current.contactName || name }));
        setCanAccessService(accessAllowed);
        setCanSubmit(submitAllowed || viewAllAllowed);
        setCanViewAll(viewAllAllowed);
        setCanUpdateWorkOrders(updateAllowed || viewAllAllowed);

        if (viewAllAllowed) {
          const { data } = await supabase
            .from('stores')
            .select('id, store_code, store_name')
            .eq('is_active', true)
            .order('store_code');
          const allStores = (data || []) as StoreOption[];
          setStores(allStores);
          setSelectedStoreId('');
          setReportStoreId(allStores[0]?.id || '');
        } else {
          const res = await fetch('/api/user/managed-stores');
          const json = await res.json();
          const managedStores = (json.stores || []) as StoreOption[];
          setStores(managedStores);
          setSelectedStoreId(managedStores[0]?.id || '');
          setReportStoreId(managedStores[0]?.id || '');
        }
      } finally {
        setLoadingInitial(false);
      }
    })();

    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loadingInitial && (maintenanceView === 'mine' || activeSection === 'work-orders')) {
      loadReports();
    }
  }, [activeSection, loadingInitial, maintenanceView, loadReports]);

  const setResourceType = (resourceType: ResourceType) => {
    const nextResource = resourceTypes.find((item) => item.key === resourceType) || resourceTypes[0];
    setForm((current) => ({
      ...current,
      resourceType,
      issueType: nextResource.issueTypes[0],
    }));
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    setPhotos((current) => {
      const next = [...current];
      Array.from(files).forEach((file) => {
        if (next.length >= 5) return;
        next.push({ file, preview: URL.createObjectURL(file) });
      });
      return next;
    });
  };

  const removePhoto = (index: number) => {
    setPhotos((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((_, idx) => idx !== index);
    });
  };

  const canGoNext = () => {
    if (reportStep === 1) {
      return Boolean(reportStoreId && form.resourceType && form.itemName.trim() && form.issueType && form.contactName.trim() && form.contactPhone.trim());
    }
    if (reportStep === 2) return Boolean(form.description.trim());
    return true;
  };

  const resetForm = () => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setPhotos([]);
    setReportStep(1);
    setForm({
      resourceType: 'equipment',
      itemName: '',
      issueType: resourceTypes[0].issueTypes[0],
      description: '',
      contactName: profileName,
      contactPhone: '',
      note: '',
    });
  };

  const submitWorkOrderUpdate = async (requestId: string) => {
    if (!canUpdateWorkOrders) {
      alert('沒有更新工單進度權限');
      return;
    }
    if (!workOrderUpdateForm.notes.trim()) {
      alert('請填寫處理內容');
      return;
    }

    setSavingWorkOrderUpdate(true);
    try {
      const res = await fetch('/api/maintenance-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          status: workOrderUpdateForm.status,
          notes: workOrderUpdateForm.notes.trim(),
          progress_date: workOrderUpdateForm.progressDate,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '更新工單進度失敗');
      }
      setWorkOrderUpdateForm({
        status: workOrderUpdateForm.status === 'closed' ? 'closed' : 'in_progress',
        progressDate: getDateInTaipei(),
        notes: '',
      });
      await loadReports();
      alert('工單進度已更新');
    } catch (error: any) {
      alert(`更新失敗：${error.message || error}`);
    } finally {
      setSavingWorkOrderUpdate(false);
    }
  };

  const submitReport = async () => {
    if (!canSubmit) {
      alert('沒有新增維修回報權限');
      return;
    }
    if (!reportStoreId || !form.itemName.trim() || !form.description.trim() || !form.contactName.trim() || !form.contactPhone.trim()) {
      alert('請完成必要欄位');
      return;
    }

    setSubmitting(true);
    try {
      const description = [
        form.description.trim(),
        form.note.trim() ? `補充資料：${form.note.trim()}` : '',
      ].filter(Boolean).join('\n\n');

      const res = await fetch('/api/maintenance-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: reportStoreId,
          title: form.itemName.trim(),
          description,
          resource_type: form.resourceType,
          issue_type: form.issueType,
          contact_name: form.contactName.trim(),
          contact_phone: form.contactPhone.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || '送出維修回報失敗');
      }

      if (photos.length > 0 && json.data?.id) {
        const formData = new FormData();
        formData.append('request_id', json.data.id);
        formData.append('photo_type', 'before');
        photos.forEach((photo) => formData.append('files', photo.file));
        const photoRes = await fetch('/api/maintenance-photos', { method: 'POST', body: formData });
        const photoJson = await photoRes.json();
        if (!photoJson.success) {
          alert(`回報已建立，但照片上傳失敗：${photoJson.error || '未知錯誤'}`);
        }
      }

      alert('維修回報已送出');
      resetForm();
      setMaintenanceView('mine');
      await loadReports();
    } catch (error: any) {
      alert(`送出失敗：${error.message || error}`);
    } finally {
      setSubmitting(false);
    }
  };

  const renderProgress = (request: MaintenanceRequest) => {
    const currentIndex = progressSteps.findIndex((step) => step.status === request.status);
    const updates = updatesByRequestId.get(request.id) || [];
    const latest = updates[0];
    return (
      <div className="space-y-2">
        <div className="flex min-w-[180px] items-center gap-1.5">
          {progressSteps.map((step, index) => {
            const complete = index <= Math.max(currentIndex, 0);
            return (
              <div key={step.status} className="flex items-center">
                <div className={`grid h-6 w-6 place-items-center rounded-full border text-[10px] font-bold ${
                  complete ? 'border-orange-500 bg-orange-500 text-white' : 'border-slate-300 bg-white text-slate-400'
                }`}>
                  {index + 1}
                </div>
                {index < progressSteps.length - 1 && (
                  <div className={`h-0.5 w-6 ${index < currentIndex ? 'bg-orange-400' : 'bg-slate-200'}`} />
                )}
              </div>
            );
          })}
        </div>
        <div className="text-xs text-slate-500">
          {latest ? `${latest.notes}｜${getDateTimeLabel(latest.progress_date)}` : statusMeta[request.status].label}
        </div>
      </div>
    );
  };

  const renderReportDateFilter = () => (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-100 bg-orange-50 px-3 py-2">
      <CalendarDays size={16} className="text-orange-500" />
      <span className="text-sm font-semibold text-slate-700">回報日期</span>
      <input
        type="date"
        value={reportStartDate}
        max={reportEndDate || undefined}
        onChange={(event) => updateReportStartDate(event.target.value)}
        className="rounded-md border border-orange-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
      />
      <span className="text-xs font-semibold text-orange-400">至</span>
      <input
        type="date"
        value={reportEndDate}
        min={reportStartDate || undefined}
        onChange={(event) => updateReportEndDate(event.target.value)}
        className="rounded-md border border-orange-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
      />
    </div>
  );

  const renderNewReport = () => (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-slate-500">維修回報 / 新增回報</div>
              <h1 className="mt-1 text-2xl font-bold text-slate-950">新增維修回報</h1>
              <p className="mt-1 text-sm text-slate-500">請詳填以下資訊，以利總務人員派工處理</p>
            </div>
            <button
              type="button"
              onClick={() => setMaintenanceView('mine')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={16} />
              回我的回報
            </button>
          </div>
        </div>

        <div className="px-5 py-5">
          <div className="mb-6 grid grid-cols-4 gap-3">
            {['基本資訊', '問題描述', '補充資料', '確認送出'].map((label, index) => {
              const step = index + 1;
              const active = reportStep === step;
              const done = reportStep > step;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setReportStep(step)}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-left"
                >
                  <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${
                    active ? 'bg-orange-500 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {done ? <CheckCircle2 size={16} /> : step}
                  </span>
                  <span className={`hidden text-sm font-semibold sm:block ${active ? 'text-slate-950' : 'text-slate-500'}`}>{label}</span>
                </button>
              );
            })}
          </div>

          {reportStep === 1 && (
            <div className="grid gap-5 lg:grid-cols-2">
              <label className="space-y-2 text-sm font-semibold text-slate-700">
                發生門市 *
                <select
                  value={reportStoreId}
                  onChange={(event) => setReportStoreId(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {!reportStoreId && <option value="">請選擇門市</option>}
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>{store.store_code} - {store.store_name}</option>
                  ))}
                </select>
              </label>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-700">資源類型 *</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {resourceTypes.map((resource) => {
                    const Icon = resource.icon;
                    const active = form.resourceType === resource.key;
                    return (
                      <button
                        key={resource.key}
                        type="button"
                        onClick={() => setResourceType(resource.key)}
                        className={`rounded-lg border p-3 text-left transition-colors ${
                          active ? 'border-orange-400 bg-orange-50 text-orange-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Icon size={22} className={active ? 'text-orange-600' : 'text-slate-400'} />
                        <div className="mt-2 text-sm font-bold">{resource.label}</div>
                        <div className="mt-1 text-xs leading-5">{resource.hint}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="space-y-2 text-sm font-semibold text-slate-700">
                設備 / 項目名稱 *
                <input
                  value={form.itemName}
                  onChange={(event) => setForm({ ...form, itemName: event.target.value })}
                  placeholder="例如：冷氣A、電動門、POS主機1"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </label>

              <label className="space-y-2 text-sm font-semibold text-slate-700">
                問題類型 *
                <select
                  value={form.issueType}
                  onChange={(event) => setForm({ ...form, issueType: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                >
                  {activeResource.issueTypes.map((issue) => <option key={issue}>{issue}</option>)}
                </select>
              </label>

              <label className="space-y-2 text-sm font-semibold text-slate-700">
                聯絡人 *
                <div className="relative">
                  <User size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    value={form.contactName}
                    onChange={(event) => setForm({ ...form, contactName: event.target.value })}
                    placeholder="預設店長，可改由同仁負責"
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </label>

              <label className="space-y-2 text-sm font-semibold text-slate-700">
                聯絡電話 *
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-3 text-slate-400" />
                  <input
                    value={form.contactPhone}
                    onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
                    placeholder="請填可聯繫電話"
                    className="w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                  />
                </div>
              </label>
            </div>
          )}

          {reportStep === 2 && (
            <div className="space-y-4">
              <label className="space-y-2 text-sm font-semibold text-slate-700">
                問題描述 *
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  rows={9}
                  placeholder="請描述發生位置、異常狀況、是否影響營運、已嘗試處理方式..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </label>
            </div>
          )}

          {reportStep === 3 && (
            <div className="space-y-5">
              <label className="space-y-2 text-sm font-semibold text-slate-700">
                備註
                <textarea
                  value={form.note}
                  onChange={(event) => setForm({ ...form, note: event.target.value })}
                  rows={4}
                  placeholder="其他補充說明..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-3 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                />
              </label>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-700">照片（最多 5 張）</div>
                <div className="grid gap-3 sm:grid-cols-5">
                  {photos.map((photo, index) => (
                    <div key={photo.preview} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                      <img src={photo.preview} alt={`維修照片 ${index + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white text-slate-600 shadow"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {photos.length < 5 && (
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-orange-300 bg-orange-50 text-sm font-semibold text-orange-700"
                    >
                      <ImagePlus size={24} />
                      <span className="mt-2">新增照片</span>
                    </button>
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addPhotos(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
              </div>
            </div>
          )}

          {reportStep === 4 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div><div className="text-xs text-slate-500">門市</div><div className="font-semibold text-slate-900">{selectedStore ? `${selectedStore.store_code} ${selectedStore.store_name}` : '-'}</div></div>
                <div><div className="text-xs text-slate-500">資源類型</div><div className="font-semibold text-slate-900">{activeResource.label}</div></div>
                <div><div className="text-xs text-slate-500">設備 / 項目</div><div className="font-semibold text-slate-900">{form.itemName || '-'}</div></div>
                <div><div className="text-xs text-slate-500">問題類型</div><div className="font-semibold text-slate-900">{form.issueType || '-'}</div></div>
                <div><div className="text-xs text-slate-500">聯絡人</div><div className="font-semibold text-slate-900">{form.contactName || '-'}</div></div>
                <div><div className="text-xs text-slate-500">聯絡電話</div><div className="font-semibold text-slate-900">{form.contactPhone || '-'}</div></div>
              </div>
              <div className="mt-4">
                <div className="text-xs text-slate-500">問題描述</div>
                <div className="mt-1 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-slate-700">{form.description || '-'}</div>
              </div>
              <div className="mt-4 text-sm text-slate-500">照片：{photos.length} 張</div>
            </div>
          )}

          <div className="mt-6 flex justify-between border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setReportStep((step) => Math.max(1, step - 1))}
              disabled={reportStep === 1}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ArrowLeft size={16} />
              上一步
            </button>
            {reportStep < 4 ? (
              <button
                type="button"
                onClick={() => canGoNext() ? setReportStep((step) => Math.min(4, step + 1)) : alert('請先完成本步驟必要欄位')}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
              >
                下一步
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submitReport}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                送出回報
              </button>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="font-bold text-slate-900">如何選擇資源類型？</h3>
          <div className="mt-4 space-y-3">
            {resourceTypes.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.key} className="flex gap-3">
                  <Icon size={22} className="mt-0.5 text-orange-500" />
                  <div>
                    <div className="text-sm font-bold text-slate-800">{item.label}</div>
                    <div className="text-xs leading-5 text-slate-500">{item.hint}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="font-bold text-slate-900">回報流程</h3>
          <div className="mt-4 space-y-4">
            {progressSteps.map((step, index) => (
              <div key={step.status} className="flex gap-3">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-orange-50 text-sm font-bold text-orange-600">{index + 1}</div>
                <div>
                  <div className="text-sm font-bold text-slate-800">{step.label}</div>
                  <div className="text-xs text-slate-500">{index === 0 ? '填寫問題並送出' : index === 1 ? '總務建立安排處理' : index === 2 ? '完成維修或處理結果' : '完成驗收與結案'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );

  const renderMyReports = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">維修回報 / 我的回報</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">我的回報</h1>
          <p className="mt-1 text-sm text-slate-500">查看您發起或所屬門市的維修工單與處理進度</p>
        </div>
        {renderReportDateFilter()}
      </div>

      <div className="overflow-x-auto border-b border-slate-200">
        <div className="flex min-w-max items-center gap-7 px-1">
          {reportStatusFilters.map((filter) => {
            const Icon = filter.icon;
            const isActive = statusFilter === filter.key;

            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-1 py-3 text-sm font-bold transition-colors ${
                  isActive
                    ? 'border-orange-500 text-orange-600'
                    : 'border-transparent text-slate-500 hover:border-orange-200 hover:text-slate-800'
                }`}
              >
                <Icon size={16} strokeWidth={2.4} />
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {reportStatusFilters.map((filter) => {
          const Icon = filter.icon;
          const isActive = statusFilter === filter.key;

          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => setStatusFilter(filter.key)}
              className={`rounded-lg border bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-sm ${
                isActive ? 'border-orange-200 ring-2 ring-orange-200' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ${filter.iconTone}`}>
                  <Icon size={20} strokeWidth={2.4} />
                </span>
                <div className="min-w-0">
                  <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold ${filter.badgeTone}`}>
                    {filter.label}
                  </div>
                  <div className="mt-2 text-2xl font-bold leading-none text-slate-950">{statusCounts[filter.key]}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{filter.helper}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            回報門市
            <select
              value={selectedStoreId}
              onChange={(event) => setSelectedStoreId(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            >
              {canViewAll && <option value="">全部門市</option>}
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.store_code} {store.store_name}</option>
              ))}
            </select>
          </label>
          <label className="relative min-w-[260px] flex-1">
            <Search size={16} className="absolute left-3 top-3 text-slate-400" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜尋工單、設備名稱、問題描述"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <button
            type="button"
            onClick={loadReports}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
          >
            <Filter size={16} />
            查詢
          </button>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1020px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
              <tr>
                <th className="px-4 py-3">工單編號</th>
                <th className="px-4 py-3">設備 / 項目</th>
                <th className="px-4 py-3">問題描述</th>
                <th className="px-4 py-3">目前狀態</th>
                <th className="px-4 py-3">處理進度</th>
                <th className="px-4 py-3">建立時間</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingReports ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" />載入中</td></tr>
              ) : filteredRequests.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">目前沒有符合條件的回報</td></tr>
              ) : filteredRequests.map((request) => {
                const meta = statusMeta[request.status] || statusMeta.pending;
                const StatusIcon = meta.icon;
                const expanded = expandedReportId === request.id;
                const updates = updatesByRequestId.get(request.id) || [];
                return (
                  <Fragment key={request.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">WO-{request.id.slice(0, 8).toUpperCase()}</td>
                      <td className="px-4 py-4">
                        <div className="font-bold text-slate-900">{request.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{request.issue_type || resourceTypes.find((r) => r.key === request.resource_type)?.label || '維修回報'}</div>
                      </td>
                      <td className="max-w-[260px] px-4 py-4">
                        <div className="line-clamp-2 text-slate-700">{request.description || '-'}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-bold ${meta.tone}`}>
                          <StatusIcon size={13} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-4">{renderProgress(request)}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-slate-600">{getDateTimeLabel(request.reported_at)}</td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          onClick={() => setExpandedReportId(expanded ? null : request.id)}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          查看詳情
                          <ChevronRight size={14} className={expanded ? 'rotate-90' : ''} />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={7} className="bg-slate-50 px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                            <div className="rounded-lg border border-slate-200 bg-white p-4">
                              <div className="text-sm font-bold text-slate-900">工單處理紀錄</div>
                              <div className="mt-4 space-y-3">
                                {updates.length === 0 ? (
                                  <div className="text-sm text-slate-500">尚無總務更新紀錄</div>
                                ) : updates.map((update) => {
                                  const updateMeta = statusMeta[update.status] || statusMeta.pending;
                                  return (
                                    <div key={update.id} className="border-l-2 border-orange-300 pl-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${updateMeta.tone}`}>{updateMeta.label}</span>
                                        <span className="text-xs text-slate-500">{getDateTimeLabel(update.progress_date)}｜{update.updated_by_name}</span>
                                      </div>
                                      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{update.notes}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
                              <div className="font-bold text-slate-900">聯絡與門市資訊</div>
                              <div className="mt-3 space-y-2 text-slate-600">
                                <div>門市：{request.store ? `${request.store.store_code} ${request.store.store_name}` : '-'}</div>
                                <div>聯絡人：{request.contact_name || request.reporter_name || '-'}</div>
                                <div>電話：{request.contact_phone || '-'}</div>
                                <div>回報者：{request.reporter_name}</div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderWorkOrderCenter = () => {
    const selectedWorkOrder = requests.find((request) => request.id === selectedWorkOrderId) || filteredRequests[0] || null;
    const selectedUpdates = selectedWorkOrder ? updatesByRequestId.get(selectedWorkOrder.id) || [] : [];

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-slate-500">總務服務中心 / 工單中心</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">工單中心</h1>
            <p className="mt-1 text-sm text-slate-500">總務可在此編輯處理進度；門市「我的回報」會同步顯示這些紀錄。</p>
          </div>
          <button
            type="button"
            onClick={loadReports}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
          >
            <Filter size={16} />
            重新整理
          </button>
        </div>

        {!canUpdateWorkOrders && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            目前帳號可以查看總務服務中心，但沒有工單進度更新權限。
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              門市
              <select
                value={selectedStoreId}
                onChange={(event) => {
                  setSelectedStoreId(event.target.value);
                  setSelectedWorkOrderId(null);
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              >
                {canViewAll && <option value="">全部門市</option>}
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>{store.store_code} {store.store_name}</option>
                ))}
              </select>
            </label>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | MaintenanceStatus)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
            >
              <option value="all">全部狀態</option>
              {progressSteps.map((step) => <option key={step.status} value={step.status}>{statusMeta[step.status].label}</option>)}
            </select>
            <label className="relative min-w-[260px] flex-1">
              <Search size={16} className="absolute left-3 top-3 text-slate-400" />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="搜尋工單、設備名稱、問題描述"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              />
            </label>
          </div>

          <div className="grid min-h-[560px] lg:grid-cols-[minmax(0,1fr)_390px]">
            <div className="overflow-auto border-r border-slate-200">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">工單</th>
                    <th className="px-4 py-3">門市</th>
                    <th className="px-4 py-3">問題</th>
                    <th className="px-4 py-3">狀態</th>
                    <th className="px-4 py-3">最近進度</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingReports ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500"><Loader2 className="mx-auto mb-2 animate-spin" />載入中</td></tr>
                  ) : filteredRequests.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">目前沒有工單</td></tr>
                  ) : filteredRequests.map((request) => {
                    const meta = statusMeta[request.status] || statusMeta.pending;
                    const latest = (updatesByRequestId.get(request.id) || [])[0];
                    const active = selectedWorkOrder?.id === request.id;
                    return (
                      <tr
                        key={request.id}
                        onClick={() => setSelectedWorkOrderId(request.id)}
                        className={`cursor-pointer hover:bg-slate-50 ${active ? 'bg-orange-50/70' : ''}`}
                      >
                        <td className="px-4 py-4">
                          <div className="font-mono text-xs text-slate-500">WO-{request.id.slice(0, 8).toUpperCase()}</div>
                          <div className="mt-1 font-bold text-slate-950">{request.title}</div>
                        </td>
                        <td className="px-4 py-4 text-slate-600">{request.store ? `${request.store.store_code} ${request.store.store_name}` : '-'}</td>
                        <td className="max-w-[220px] px-4 py-4">
                          <div className="font-semibold text-slate-800">{request.issue_type || '-'}</div>
                          <div className="mt-1 line-clamp-1 text-xs text-slate-500">{request.description || '-'}</div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${meta.tone}`}>{meta.label}</span>
                        </td>
                        <td className="px-4 py-4 text-xs text-slate-500">
                          {latest ? (
                            <>
                              <div className="line-clamp-1 text-slate-700">{latest.notes}</div>
                              <div className="mt-1">{getDateTimeLabel(latest.progress_date)}</div>
                            </>
                          ) : '尚無處理紀錄'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <aside className="bg-slate-50 p-4">
              {selectedWorkOrder ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="text-xs font-bold text-slate-500">目前選取</div>
                    <div className="mt-1 text-lg font-bold text-slate-950">{selectedWorkOrder.title}</div>
                    <div className="mt-2 text-sm text-slate-600">{selectedWorkOrder.store ? `${selectedWorkOrder.store.store_code} ${selectedWorkOrder.store.store_name}` : '-'}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <div>聯絡人：<span className="font-semibold text-slate-700">{selectedWorkOrder.contact_name || selectedWorkOrder.reporter_name || '-'}</span></div>
                      <div>電話：<span className="font-semibold text-slate-700">{selectedWorkOrder.contact_phone || '-'}</span></div>
                    </div>
                    <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{selectedWorkOrder.description || '-'}</div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="font-bold text-slate-950">新增處理進度</div>
                    <div className="mt-3 space-y-3">
                      <label className="block text-sm font-semibold text-slate-700">
                        工單狀態
                        <select
                          value={workOrderUpdateForm.status}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, status: event.target.value as MaintenanceStatus })}
                          disabled={!canUpdateWorkOrders}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        >
                          {progressSteps.map((step) => <option key={step.status} value={step.status}>{statusMeta[step.status].label}</option>)}
                        </select>
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        紀錄日期
                        <input
                          type="date"
                          value={workOrderUpdateForm.progressDate}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, progressDate: event.target.value })}
                          disabled={!canUpdateWorkOrders}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        />
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        處理內容
                        <textarea
                          value={workOrderUpdateForm.notes}
                          onChange={(event) => setWorkOrderUpdateForm({ ...workOrderUpdateForm, notes: event.target.value })}
                          disabled={!canUpdateWorkOrders}
                          rows={5}
                          placeholder="例如：已聯繫廠商、預計到店處理、已完成更換..."
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-slate-100"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => submitWorkOrderUpdate(selectedWorkOrder.id)}
                        disabled={!canUpdateWorkOrders || savingWorkOrderUpdate}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                      >
                        {savingWorkOrderUpdate ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        儲存處理進度
                      </button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="font-bold text-slate-950">處理紀錄</div>
                    <div className="mt-3 space-y-3">
                      {selectedUpdates.length === 0 ? (
                        <div className="text-sm text-slate-500">尚無處理紀錄</div>
                      ) : selectedUpdates.map((update) => {
                        const meta = statusMeta[update.status] || statusMeta.pending;
                        return (
                          <div key={update.id} className="border-l-2 border-orange-300 pl-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${meta.tone}`}>{meta.label}</span>
                              <span className="text-xs text-slate-500">{getDateTimeLabel(update.progress_date)}｜{update.updated_by_name}</span>
                            </div>
                            <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{update.notes}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid h-full min-h-[360px] place-items-center rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                  請先選擇左側工單
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    );
  };

  const renderPlaceholder = (title: string, description: string, Icon: any) => (
    <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
      <Icon className="mx-auto h-12 w-12 text-orange-400" />
      <h1 className="mt-4 text-2xl font-bold text-slate-950">{title}</h1>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">{description}</p>
    </div>
  );

  const renderMainContent = () => {
    if (loadingInitial) {
      return (
        <div className="grid min-h-[360px] place-items-center rounded-lg border border-slate-200 bg-white">
          <div className="text-center text-slate-500">
            <Loader2 className="mx-auto mb-3 animate-spin text-orange-500" />
            載入總務服務中心
          </div>
        </div>
      );
    }

    if (!canAccessService) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <AlertCircle className="mb-3" />
          目前帳號沒有總務服務中心權限。
        </div>
      );
    }

    if (!canSubmit && !canViewAll && !canUpdateWorkOrders) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          <AlertCircle className="mb-3" />
          目前帳號已開啟總務服務中心入口，但尚未設定回報、查看或處理工單權限。
        </div>
      );
    }

    if (activeSection === 'maintenance') {
      if (maintenanceView === 'new' && !canSubmit) {
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
            <AlertCircle className="mb-3" />
            目前帳號沒有新增維修回報權限。
          </div>
        );
      }
      return maintenanceView === 'new' ? renderNewReport() : renderMyReports();
    }
    if (activeSection === 'work-orders') return renderWorkOrderCenter();
    if (activeSection === 'equipment') return renderPlaceholder('設備管理', '後續可建立設備主檔、序號、保固與維修履歷。', Settings);
    if (activeSection === 'facilities') return renderPlaceholder('設施管理', '後續可管理門市固定設施、區域位置與巡檢紀錄。', Building2);
    return renderPlaceholder('料件中心', '後續可管理料件庫存、申請、領用與補貨紀錄。', Package);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="flex">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 border-r border-slate-200 bg-white p-4 lg:block">
          <div className="mb-4 px-2">
            <div className="text-xs font-bold uppercase tracking-wider text-orange-500">General Affairs</div>
            <div className="mt-1 text-lg font-black text-slate-950">總務服務中心</div>
          </div>
          <nav className="space-y-1">
            {serviceNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.key;
              if (item.key === 'maintenance') {
                return (
                  <div key={item.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSection('maintenance');
                        setMaintenanceExpanded((value) => !value);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold ${
                        active ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2"><Icon size={18} />{item.label}</span>
                      <ChevronDown size={16} className={maintenanceExpanded ? 'rotate-180' : ''} />
                    </button>
                    {maintenanceExpanded && (
                      <div className="ml-6 mt-1 space-y-1">
                        {canSubmit && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSection('maintenance');
                              setMaintenanceView('new');
                            }}
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${maintenanceView === 'new' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}
                          >
                            新增回報
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSection('maintenance');
                            setMaintenanceView('mine');
                          }}
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${maintenanceView === 'mine' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-50'}`}
                        >
                          我的回報
                        </button>
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-bold ${
                    active ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
            {serviceNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${
                    activeSection === item.key ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <Icon size={16} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {activeSection === 'maintenance' && (
            <div className="mb-4 flex gap-2 lg:hidden">
              {canSubmit && (
                <button
                  type="button"
                  onClick={() => setMaintenanceView('new')}
                  className={`rounded-lg px-3 py-2 text-sm font-bold ${maintenanceView === 'new' ? 'bg-orange-500 text-white' : 'bg-white text-slate-600'}`}
                >
                  新增回報
                </button>
              )}
              <button
                type="button"
                onClick={() => setMaintenanceView('mine')}
                className={`rounded-lg px-3 py-2 text-sm font-bold ${maintenanceView === 'mine' ? 'bg-orange-500 text-white' : 'bg-white text-slate-600'}`}
              >
                我的回報
              </button>
            </div>
          )}

          {renderMainContent()}
        </main>
      </div>
    </div>
  );
}
