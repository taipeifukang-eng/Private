'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  Edit3,
  Filter,
  FileAudio,
  Loader2,
  Mic,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Store,
  Trash2,
  X,
  UserRound,
} from 'lucide-react';

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  meta?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  error?: string;
};

type StoreOption = {
  id: string;
  store_code?: string | null;
  store_name?: string | null;
  short_name?: string | null;
};

type EmployeeOption = {
  id: string;
  store_id?: string | null;
  employee_code?: string | null;
  employee_name?: string | null;
  current_position?: string | null;
  position?: string | null;
};

type CategoryOption = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
};

type SupervisorCase = {
  id: string;
  case_no?: string | null;
  title: string;
  category_id?: string | null;
  owner_user_id: string;
  assigned_user_id?: string | null;
  target_type: string;
  store_id?: string | null;
  employee_id?: string | null;
  target_name_snapshot: string;
  status: string;
  priority: string;
  summary?: string | null;
  opened_at: string;
  next_follow_up_at?: string | null;
  updated_at: string;
  category?: CategoryOption | null;
  store?: StoreOption | null;
  employee?: EmployeeOption | null;
};

type SupervisorRecord = {
  id: string;
  record_type: string;
  record_date: string;
  store_id?: string | null;
  employee_id?: string | null;
  target_name_snapshot?: string | null;
  observation: string;
  judgment: string;
  action_summary: string;
  action_options?: string[] | null;
  requires_follow_up: boolean;
  follow_up_date?: string | null;
  expected_result?: string | null;
  follow_up_method?: string | null;
  ai_generated?: boolean | null;
  created_at: string;
  updated_at: string;
};

type SupervisorFollowup = {
  id: string;
  source_record_id?: string | null;
  follow_up_date: string;
  result_status: string;
  result_notes: string;
  next_follow_up_date?: string | null;
  created_at: string;
  updated_at: string;
};

type SupervisorEvent = {
  id: string;
  record_id?: string | null;
  followup_id?: string | null;
  event_type: string;
  event_at: string;
  title: string;
  body?: string | null;
  actor_user_id?: string | null;
};

type SupervisorCaseDetail = SupervisorCase & {
  records?: SupervisorRecord[];
  followups?: SupervisorFollowup[];
  events?: SupervisorEvent[];
};

type SupervisorDailyPlan = {
  id: string;
  plan_date: string;
  target_type: string;
  store_id?: string | null;
  employee_id?: string | null;
  target_name_snapshot: string;
  category_id?: string | null;
  title: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  linked_case_id?: string | null;
  linked_record_id?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  category?: CategoryOption | null;
  store?: StoreOption | null;
  employee?: EmployeeOption | null;
  linked_case?: Pick<SupervisorCase, 'id' | 'case_no' | 'title' | 'status' | 'priority' | 'next_follow_up_at'> | null;
};

type TodayFollowUpCase = SupervisorCase & {
  bucket: 'overdue' | 'today' | 'upcoming';
  latest_record?: {
    id: string;
    record_date: string;
    observation?: string | null;
    judgment?: string | null;
    action_summary?: string | null;
    follow_up_date?: string | null;
    expected_result?: string | null;
    created_at?: string | null;
  } | null;
};

type TodayWorkspacePayload = {
  date: string;
  plans: SupervisorDailyPlan[];
  followUpQueue: TodayFollowUpCase[];
  todayRecords: Array<SupervisorRecord & {
    case?: Pick<SupervisorCase, 'id' | 'case_no' | 'title' | 'status' | 'priority' | 'next_follow_up_at'> | null;
  }>;
  summary: {
    plans: { total: number; planned: number; inProgress: number; done: number; cancelled: number };
    followUps: { total: number; overdue: number; today: number; upcoming: number };
    records: { total: number };
  };
};

type OptionsPayload = {
  categories: CategoryOption[];
  stores: StoreOption[];
  employees: EmployeeOption[];
};

type VoiceEntityMatch = {
  type: 'STORE' | 'EMPLOYEE';
  mention: string;
  status: 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND';
  confidence: number;
  candidates: Array<{
    id: string;
    label: string;
    code?: string | null;
    store_label?: string | null;
    score: number;
  }>;
};

type VoiceDraftPayload = {
  draft: {
    mode: 'RECORD_DRAFT' | 'FOLLOWUP_DRAFT';
    record_type: string;
    record_date: string;
    target_name_snapshot: string;
    observation: string;
    judgment: string;
    action_summary: string;
    action_options: string[];
    requires_follow_up: boolean;
    follow_up_date: string | null;
    follow_up_method: string | null;
    expected_result: string | null;
    confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    notes: string | null;
  };
  entity_matches: VoiceEntityMatch[];
  review_required: boolean;
  blocking_fields: string[];
  confirmation_questions: string[];
  warnings: string[];
  ai_provider: 'OPENAI' | 'LOCAL_RULE_FALLBACK';
};

const CASE_STATUS = {
  OPEN: { label: '待處理', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  FOLLOW_UP: { label: '待追蹤', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  IMPROVING: { label: '改善中', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  RESOLVED: { label: '已改善', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CLOSED: { label: '已結案', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  CANCELLED: { label: '已取消', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
} as const;

const PRIORITY = {
  LOW: '低',
  NORMAL: '一般',
  HIGH: '高',
  URGENT: '緊急',
} as const;

const TARGET_TYPE = {
  STORE: '門市',
  EMPLOYEE: '人員',
  AREA: '區域',
  CROSS_DEPARTMENT: '跨部門',
  OTHER: '其他',
} as const;

const WORKSPACE_TABS = [
  { key: 'today', label: '今日工作台', icon: CalendarClock },
  { key: 'cases', label: '管理案件', icon: ClipboardList },
] as const;

const RECORD_TYPE = {
  MANAGEMENT: '管理紀錄',
  FOLLOW_UP: '追蹤安排',
  RESULT: '結果紀錄',
  NOTE: '備註',
} as const;

const FOLLOW_UP_METHOD = {
  ONSITE: '現場訪查',
  PHONE: '電話追蹤',
  MESSAGE: 'LINE / 訊息',
  MEETING: '會議追蹤',
  SYSTEM: '系統紀錄',
  OTHER: '其他',
} as const;

const FOLLOWUP_STATUS = {
  IMPROVED: '已改善',
  IMPROVING: '改善中',
  NOT_IMPROVED: '未改善',
  POSTPONED: '延後追蹤',
  CLOSED: '結案',
} as const;

const DAILY_PLAN_STATUS = {
  PLANNED: { label: '尚未開始', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  IN_PROGRESS: { label: '處理中', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  DONE: { label: '已完成', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  CANCELLED: { label: '已取消', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
} as const;

const ACTION_OPTIONS = [
  '現場說明',
  '主管約談',
  '教育訓練',
  '限期改善',
  '跨部門協調',
  '文件補正',
  '持續追蹤',
];

const emptyCaseForm = {
  title: '',
  target_type: 'STORE',
  store_id: '',
  employee_id: '',
  category_id: '',
  target_name_snapshot: '',
  priority: 'NORMAL',
  next_follow_up_at: '',
  summary: '',
};

const emptyRecordForm = {
  record_type: 'MANAGEMENT',
  record_date: '',
  observation: '',
  judgment: '',
  action_summary: '',
  action_options: [] as string[],
  requires_follow_up: false,
  follow_up_date: '',
  expected_result: '',
  follow_up_method: '',
};

const emptyFollowupForm = {
  source_record_id: '',
  follow_up_date: '',
  result_status: 'IMPROVING',
  result_notes: '',
  next_follow_up_date: '',
};

const emptyEditForm = {
  title: '',
  category_id: '',
  status: 'OPEN',
  priority: 'NORMAL',
  next_follow_up_at: '',
  summary: '',
};

const emptyDailyPlanForm = {
  plan_date: '',
  target_type: 'STORE',
  store_id: '',
  employee_id: '',
  target_name_snapshot: '',
  category_id: '',
  title: '',
  notes: '',
  linked_case_id: '',
};

function statusMeta(status: string) {
  return CASE_STATUS[status as keyof typeof CASE_STATUS] || { label: status, tone: 'bg-slate-100 text-slate-700 border-slate-200' };
}

function dailyPlanStatusMeta(status: string) {
  return DAILY_PLAN_STATUS[status as keyof typeof DAILY_PLAN_STATUS] || { label: status, tone: 'bg-slate-100 text-slate-700 border-slate-200' };
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function storeLabel(store?: StoreOption | null) {
  if (!store) return '-';
  return `${store.store_code || ''} ${store.short_name || store.store_name || ''}`.trim() || '-';
}

function followupStatusLabel(value: string) {
  return FOLLOWUP_STATUS[value as keyof typeof FOLLOWUP_STATUS] || value;
}

function recordTypeLabel(value: string) {
  return RECORD_TYPE[value as keyof typeof RECORD_TYPE] || value;
}

function followUpMethodLabel(value?: string | null) {
  if (!value) return null;
  return FOLLOW_UP_METHOD[value as keyof typeof FOLLOW_UP_METHOD] || value;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json?.error || `${res.status} ${res.statusText}`);
  }
  return json;
}

export default function SupervisorManagementLogPage() {
  const [cases, setCases] = useState<SupervisorCase[]>([]);
  const [options, setOptions] = useState<OptionsPayload>({ categories: [], stores: [], employees: [] });
  const [selectedCase, setSelectedCase] = useState<SupervisorCaseDetail | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof WORKSPACE_TABS)[number]['key']>('today');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filters, setFilters] = useState({ status: '', targetType: '', search: '' });
  const [caseForm, setCaseForm] = useState(emptyCaseForm);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editingCase, setEditingCase] = useState(false);
  const [recordForm, setRecordForm] = useState(emptyRecordForm);
  const [followupForm, setFollowupForm] = useState(emptyFollowupForm);
  const [todayWorkspace, setTodayWorkspace] = useState<TodayWorkspacePayload | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);
  const [dailyPlanForm, setDailyPlanForm] = useState(emptyDailyPlanForm);
  const [editingDailyPlan, setEditingDailyPlan] = useState<SupervisorDailyPlan | null>(null);
  const [showDailyPlanForm, setShowDailyPlanForm] = useState(false);
  const [quickFollowUpCase, setQuickFollowUpCase] = useState<TodayFollowUpCase | null>(null);
  const [quickRecordOpen, setQuickRecordOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceMode, setVoiceMode] = useState<'RECORD_DRAFT' | 'FOLLOWUP_DRAFT'>('RECORD_DRAFT');
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraftPayload | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [voiceTranscribing, setVoiceTranscribing] = useState(false);
  const [voiceDrafting, setVoiceDrafting] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const [showCaseForm, setShowCaseForm] = useState(false);
  const [meta, setMeta] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 });

  const today = useMemo(() => new Date(), []);
  const todayLabel = useMemo(() => new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(today), [today]);

  const todayKey = useMemo(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(today), [today]);

  const employeesForStore = useMemo(
    () => options.employees.filter((employee) => !caseForm.store_id || employee.store_id === caseForm.store_id),
    [caseForm.store_id, options.employees]
  );

  const dailyPlanEmployeesForStore = useMemo(
    () => options.employees.filter((employee) => !dailyPlanForm.store_id || employee.store_id === dailyPlanForm.store_id),
    [dailyPlanForm.store_id, options.employees]
  );

  async function loadData(nextFilters = filters, page = meta.page) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(meta.pageSize),
        sortBy: 'updated_at',
        sortOrder: 'desc',
      });
      if (nextFilters.status) params.set('status', nextFilters.status);
      if (nextFilters.targetType) params.set('targetType', nextFilters.targetType);
      if (nextFilters.search.trim()) params.set('search', nextFilters.search.trim());

      const [casesJson, optionsJson] = await Promise.all([
        fetchJson<SupervisorCase[]>(`/api/supervisor-management-log/cases?${params.toString()}`),
        fetchJson<OptionsPayload>('/api/supervisor-management-log/options'),
      ]);

      setCases(casesJson.data || []);
      setMeta(casesJson.meta || { page, pageSize: meta.pageSize, total: casesJson.data?.length || 0, totalPages: 1 });
      setOptions(optionsJson.data || { categories: [], stores: [], employees: [] });
      setSelectedCase((current) => {
        if (!current) return null;
        const refreshed = (casesJson.data || []).find((item) => item.id === current.id);
        return refreshed ? { ...current, ...refreshed } : current;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入督導管理日誌失敗');
    } finally {
      setLoading(false);
    }
  }

  async function loadTodayWorkspace() {
    setTodayLoading(true);
    setError(null);
    try {
      const json = await fetchJson<TodayWorkspacePayload>(`/api/supervisor-management-log/today?date=${todayKey}`);
      setTodayWorkspace(json.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入今日管理工作台失敗');
    } finally {
      setTodayLoading(false);
    }
  }

  async function loadCaseDetail(caseId: string) {
    setDetailLoading(true);
    setError(null);
    try {
      const json = await fetchJson<SupervisorCaseDetail>(`/api/supervisor-management-log/cases/${caseId}`);
      const detail = json.data || null;
      setSelectedCase(detail);
      if (detail) {
        setEditForm({
          title: detail.title || '',
          category_id: detail.category_id || '',
          status: detail.status || 'OPEN',
          priority: detail.priority || 'NORMAL',
          next_follow_up_at: detail.next_follow_up_at ? detail.next_follow_up_at.slice(0, 10) : '',
          summary: detail.summary || '',
        });
      }
      setEditingCase(false);
      return detail;
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入案件詳情失敗');
      return null;
    } finally {
      setDetailLoading(false);
    }
  }

  async function openQuickFollowup(item: TodayFollowUpCase) {
    const detail = await loadCaseDetail(item.id);
    if (!detail) return;
    const latestRecordId = item.latest_record?.id || detail.records?.[0]?.id || '';
    setFollowupForm({
      ...emptyFollowupForm,
      source_record_id: latestRecordId,
      follow_up_date: todayKey,
    });
    setQuickFollowUpCase(item);
  }

  useEffect(() => {
    void loadData(filters, 1);
    void loadTodayWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateDailyPlanForm(field: keyof typeof emptyDailyPlanForm, value: string) {
    setDailyPlanForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'store_id') {
        next.employee_id = '';
        const store = options.stores.find((item) => item.id === value);
        if (next.target_type === 'STORE' && store) next.target_name_snapshot = storeLabel(store);
      }
      if (field === 'employee_id') {
        const employee = options.employees.find((item) => item.id === value);
        if (employee) {
          next.target_name_snapshot = `${employee.employee_code || ''} ${employee.employee_name || ''}`.trim();
          if (employee.store_id) next.store_id = employee.store_id;
        }
      }
      if (field === 'target_type') {
        next.store_id = '';
        next.employee_id = '';
        next.target_name_snapshot = '';
      }
      return next;
    });
  }

  function openDailyPlanForm(plan?: SupervisorDailyPlan) {
    if (plan) {
      setEditingDailyPlan(plan);
      setDailyPlanForm({
        plan_date: plan.plan_date || todayKey,
        target_type: plan.target_type || 'STORE',
        store_id: plan.store_id || '',
        employee_id: plan.employee_id || '',
        target_name_snapshot: plan.target_name_snapshot || '',
        category_id: plan.category_id || '',
        title: plan.title || '',
        notes: plan.notes || '',
        linked_case_id: plan.linked_case_id || '',
      });
    } else {
      setEditingDailyPlan(null);
      setDailyPlanForm({ ...emptyDailyPlanForm, plan_date: todayKey });
    }
    setShowDailyPlanForm(true);
  }

  async function submitDailyPlan(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        ...dailyPlanForm,
        plan_date: dailyPlanForm.plan_date || todayKey,
        store_id: dailyPlanForm.store_id || null,
        employee_id: dailyPlanForm.employee_id || null,
        category_id: dailyPlanForm.category_id || null,
        linked_case_id: dailyPlanForm.linked_case_id || null,
        notes: dailyPlanForm.notes || null,
      };
      await fetchJson(
        editingDailyPlan
          ? `/api/supervisor-management-log/daily-plans/${editingDailyPlan.id}`
          : '/api/supervisor-management-log/daily-plans',
        {
          method: editingDailyPlan ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      setNotice(editingDailyPlan ? '今日管理規劃已更新' : '今日管理規劃已建立');
      setShowDailyPlanForm(false);
      setEditingDailyPlan(null);
      setDailyPlanForm(emptyDailyPlanForm);
      await loadTodayWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存今日管理規劃失敗');
    } finally {
      setSaving(false);
    }
  }

  async function updateDailyPlanStatus(plan: SupervisorDailyPlan, status: keyof typeof DAILY_PLAN_STATUS) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const now = new Date().toISOString();
      await fetchJson(`/api/supervisor-management-log/daily-plans/${plan.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          started_at: status === 'IN_PROGRESS' && !plan.started_at ? now : plan.started_at || null,
          completed_at: status === 'DONE' ? now : plan.completed_at || null,
        }),
      });
      setNotice(status === 'DONE' ? '今日管理事項已完成' : '今日管理事項狀態已更新');
      await loadTodayWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新今日管理狀態失敗');
    } finally {
      setSaving(false);
    }
  }

  async function startPlanWork(plan: SupervisorDailyPlan) {
    if (plan.status === 'PLANNED') {
      await updateDailyPlanStatus(plan, 'IN_PROGRESS');
    }
    if (plan.linked_case_id) {
      const detail = await loadCaseDetail(plan.linked_case_id);
      if (detail) {
        setRecordForm({
          ...emptyRecordForm,
          record_date: todayKey,
          observation: plan.title,
          action_summary: plan.notes || '',
        });
        setQuickRecordOpen(true);
      }
      return;
    }
    setNotice('此規劃尚未關聯管理案件；請先編輯規劃並選擇關聯案件，或到管理案件建立後再新增管理結果。');
  }

  function openVoiceSheet(mode: 'RECORD_DRAFT' | 'FOLLOWUP_DRAFT' = 'RECORD_DRAFT') {
    setVoiceMode(mode);
    setVoiceOpen(true);
    setVoiceError(null);
    setVoiceNotice(null);
  }

  async function transcribeVoiceAudio(audio: Blob, fileName = 'voice.webm') {
    setVoiceTranscribing(true);
    setVoiceError(null);
    setVoiceNotice(null);
    try {
      const formData = new FormData();
      formData.append('audio', audio, fileName);
      formData.append('mode', voiceMode);
      const json = await fetchJson<{ transcript: string; warnings?: string[] }>('/api/supervisor-management-log/voice/transcribe', {
        method: 'POST',
        headers: {},
        body: formData,
      });
      setVoiceTranscript(json.data?.transcript || '');
      setVoiceNotice('口述已轉成文字，請確認文字稿後產生草稿。');
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : '口述轉文字失敗；可改用手動文字稿。');
    } finally {
      setVoiceTranscribing(false);
    }
  }

  async function startVoiceRecording() {
    setVoiceError(null);
    setVoiceNotice(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setVoiceError('此瀏覽器不支援麥克風錄音，請改用手動文字稿或上傳音檔。');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      voiceChunksRef.current = [];
      voiceRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) void transcribeVoiceAudio(blob, 'supervisor-voice.webm');
      };
      recorder.start();
      setVoiceRecording(true);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : '瀏覽器未允許麥克風，請改用手動文字稿。');
    }
  }

  function stopVoiceRecording() {
    const recorder = voiceRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    setVoiceRecording(false);
  }

  async function handleVoiceAudioFile(file: File | null) {
    if (!file) return;
    await transcribeVoiceAudio(file, file.name);
  }

  async function generateVoiceDraft() {
    setVoiceDrafting(true);
    setVoiceError(null);
    setVoiceNotice(null);
    try {
      const json = await fetchJson<VoiceDraftPayload>('/api/supervisor-management-log/voice/draft', {
        method: 'POST',
        body: JSON.stringify({
          mode: voiceMode,
          transcript: voiceTranscript,
          case_id: selectedCase?.id || null,
        }),
      });
      setVoiceDraft(json.data || null);
      setVoiceNotice('已產生待確認草稿；系統不會自動儲存，請人工確認後套用。');
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : '口述草稿產生失敗');
    } finally {
      setVoiceDrafting(false);
    }
  }

  function bestVoiceTargetLabel() {
    const matched = voiceDraft?.entity_matches.find((match) => match.status === 'MATCHED' && match.candidates[0]);
    return matched?.candidates[0]?.label || voiceDraft?.draft.target_name_snapshot || selectedCase?.target_name_snapshot || '';
  }

  function applyVoiceDraftToRecordForm() {
    if (!voiceDraft) return;
    const draft = voiceDraft.draft;
    setRecordForm({
      ...emptyRecordForm,
      record_type: draft.record_type || 'MANAGEMENT',
      record_date: draft.record_date || todayKey,
      observation: draft.observation || '',
      judgment: draft.judgment || '',
      action_summary: draft.action_summary || '',
      action_options: Array.isArray(draft.action_options) ? draft.action_options : [],
      requires_follow_up: draft.requires_follow_up === true,
      follow_up_date: draft.follow_up_date || '',
      expected_result: draft.expected_result || '',
      follow_up_method: draft.follow_up_method || '',
    });
    setQuickRecordOpen(true);
    setVoiceOpen(false);
    setNotice(selectedCase
      ? '口述草稿已套用到新增管理紀錄，請最後確認後儲存。'
      : '口述草稿已套用；請先選擇關聯管理案件後再儲存。');
  }

  async function deleteDailyPlan(plan: SupervisorDailyPlan) {
    const reason = window.prompt('請輸入刪除今日管理規劃的原因');
    if (!reason || !reason.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/supervisor-management-log/daily-plans/${plan.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ deletion_reason: reason.trim() }),
      });
      setNotice('今日管理規劃已刪除');
      await loadTodayWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除今日管理規劃失敗');
    } finally {
      setSaving(false);
    }
  }

  function updateCaseForm(field: keyof typeof emptyCaseForm, value: string) {
    setCaseForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'store_id') {
        next.employee_id = '';
        const store = options.stores.find((item) => item.id === value);
        if (next.target_type === 'STORE' && store) next.target_name_snapshot = storeLabel(store);
      }
      if (field === 'employee_id') {
        const employee = options.employees.find((item) => item.id === value);
        if (employee) {
          next.target_name_snapshot = `${employee.employee_code || ''} ${employee.employee_name || ''}`.trim();
          if (employee.store_id) next.store_id = employee.store_id;
        }
      }
      if (field === 'target_type') {
        next.store_id = '';
        next.employee_id = '';
        next.target_name_snapshot = '';
      }
      return next;
    });
  }

  async function submitCase(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson<SupervisorCase>('/api/supervisor-management-log/cases', {
        method: 'POST',
        body: JSON.stringify({
          ...caseForm,
          store_id: caseForm.store_id || null,
          employee_id: caseForm.employee_id || null,
          category_id: caseForm.category_id || null,
          next_follow_up_at: caseForm.next_follow_up_at || null,
          summary: caseForm.summary || null,
        }),
      });
      setCaseForm(emptyCaseForm);
      setShowCaseForm(false);
      setNotice('督導管理案件已建立');
      await loadData(filters, 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立案件失敗');
    } finally {
      setSaving(false);
    }
  }

  async function submitRecord(event: FormEvent) {
    event.preventDefault();
    if (!selectedCase) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/supervisor-management-log/cases/${selectedCase.id}/records`, {
        method: 'POST',
        body: JSON.stringify({
          ...recordForm,
          store_id: selectedCase.store_id || null,
          employee_id: selectedCase.employee_id || null,
          category_id: selectedCase.category_id || null,
          target_name_snapshot: selectedCase.target_name_snapshot,
          follow_up_owner_id: recordForm.requires_follow_up ? selectedCase.assigned_user_id || selectedCase.owner_user_id : null,
          follow_up_date: recordForm.requires_follow_up ? recordForm.follow_up_date : null,
          expected_result: recordForm.requires_follow_up ? recordForm.expected_result : null,
          follow_up_method: recordForm.requires_follow_up ? recordForm.follow_up_method || null : null,
        }),
      });
      setRecordForm(emptyRecordForm);
      setQuickRecordOpen(false);
      setNotice('管理紀錄已新增');
      await loadData(filters, meta.page);
      await loadTodayWorkspace();
      await loadCaseDetail(selectedCase.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增管理紀錄失敗');
    } finally {
      setSaving(false);
    }
  }

  async function submitFollowup(event: FormEvent) {
    event.preventDefault();
    if (!selectedCase) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/supervisor-management-log/cases/${selectedCase.id}/followups`, {
        method: 'POST',
        body: JSON.stringify({
          ...followupForm,
          source_record_id: followupForm.source_record_id || null,
          follow_up_date: followupForm.follow_up_date || new Date().toISOString().slice(0, 10),
          next_follow_up_date: followupForm.next_follow_up_date || null,
        }),
      });
      setFollowupForm(emptyFollowupForm);
      setQuickFollowUpCase(null);
      setNotice('追蹤結果已新增');
      await loadData(filters, meta.page);
      await loadTodayWorkspace();
      await loadCaseDetail(selectedCase.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增追蹤結果失敗');
    } finally {
      setSaving(false);
    }
  }

  async function submitCaseUpdate(event: FormEvent) {
    event.preventDefault();
    if (!selectedCase) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/supervisor-management-log/cases/${selectedCase.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editForm.title,
          category_id: editForm.category_id || null,
          status: editForm.status,
          priority: editForm.priority,
          next_follow_up_at: editForm.next_follow_up_at || null,
          summary: editForm.summary || null,
        }),
      });
      setNotice('案件已更新');
      setEditingCase(false);
      await loadData(filters, meta.page);
      await loadCaseDetail(selectedCase.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新案件失敗');
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedCase() {
    if (!selectedCase) return;
    const reason = window.prompt('請輸入刪除督導管理案件的原因');
    if (!reason || !reason.trim()) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson(`/api/supervisor-management-log/cases/${selectedCase.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ deletion_reason: reason.trim() }),
      });
      setSelectedCase(null);
      setEditingCase(false);
      setNotice('案件已刪除');
      await loadData(filters, 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '刪除案件失敗');
    } finally {
      setSaving(false);
    }
  }

  function applyStatus(status: string) {
    const next = { ...filters, status };
    setFilters(next);
    void loadData(next, 1);
  }

  function toggleActionOption(option: string) {
    setRecordForm((prev) => {
      const exists = prev.action_options.includes(option);
      return {
        ...prev,
        action_options: exists
          ? prev.action_options.filter((item) => item !== option)
          : [...prev.action_options, option],
      };
    });
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-2 text-sm font-semibold text-slate-500">
          <span>首頁</span>
          <ArrowRight size={14} />
          <span className="text-emerald-700">督導管理日誌</span>
        </nav>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                <NotebookPen size={14} />
                督導日常管理
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">督導管理日誌</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                記錄督導發現的管理問題、判斷、管理動作與後續追蹤結果。資料範圍依登入者權限與門市管理範圍顯示。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadData(filters, meta.page)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={16} />
              重新整理
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{notice}</div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {WORKSPACE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-black transition ${active ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </section>

        {voiceOpen && (
          <section className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-black text-emerald-700">AI 口述紀錄草稿</div>
                <h2 className="mt-1 text-xl font-black text-slate-950">快速口述</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                  可錄音、上傳音檔或直接輸入文字稿；系統只會產生待確認草稿，不會自動建立案件、結案或寫入正式紀錄。
                </p>
              </div>
              <button type="button" onClick={() => setVoiceOpen(false)} className="self-start rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={voiceRecording ? stopVoiceRecording : startVoiceRecording}
                      disabled={voiceTranscribing}
                      className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-black ${voiceRecording ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white hover:bg-emerald-700'} disabled:opacity-60`}
                    >
                      <Mic size={16} />
                      {voiceRecording ? '停止錄音' : '開始錄音'}
                    </button>
                    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50">
                      <FileAudio size={16} />
                      上傳音檔
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(event) => void handleVoiceAudioFile(event.target.files?.[0] || null)}
                      />
                    </label>
                    {voiceTranscribing && (
                      <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700">
                        <Loader2 size={16} className="animate-spin" />
                        轉文字中
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-bold text-slate-500">
                    若尚未設定 OpenAI key，錄音轉文字會被安全阻擋；仍可在下方手動輸入文字稿產生本機規則草稿。
                  </p>
                </div>

                <label className="block text-sm font-black text-slate-900">
                  口述文字稿
                  <textarea
                    value={voiceTranscript}
                    onChange={(event) => setVoiceTranscript(event.target.value)}
                    rows={7}
                    placeholder="例如：今天到 FK001，看保健品成交落後，店長說新人還不熟銷售話術。我已要求店長這週每天陪同演練，週五再追蹤。"
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-700"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={generateVoiceDraft}
                    disabled={voiceDrafting || !voiceTranscript.trim()}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-black text-white disabled:opacity-60"
                  >
                    {voiceDrafting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    產生待確認草稿
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setVoiceTranscript('');
                      setVoiceDraft(null);
                      setVoiceError(null);
                      setVoiceNotice(null);
                    }}
                    className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-black text-slate-600 hover:bg-slate-50"
                  >
                    清除
                  </button>
                </div>

                {voiceError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{voiceError}</div>}
                {voiceNotice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{voiceNotice}</div>}
              </div>

              <aside className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-black text-slate-900">草稿審核</h3>
                  {voiceDraft && (
                    <span className={`rounded-full px-2 py-1 text-xs font-black ${voiceDraft.ai_provider === 'OPENAI' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {voiceDraft.ai_provider === 'OPENAI' ? 'AI 草稿' : '本機規則草稿'}
                    </span>
                  )}
                </div>

                {!voiceDraft ? (
                  <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm font-bold text-slate-500">
                    產生草稿後，這裡會顯示管理紀錄欄位、主檔比對結果與需要人工確認的項目。
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    {voiceDraft.warnings.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
                        {voiceDraft.warnings.map((warning) => <div key={warning}>{warning}</div>)}
                      </div>
                    )}
                    <div className="space-y-2 rounded-lg bg-white p-3 text-sm">
                      <div><span className="font-black text-slate-500">管理對象：</span>{bestVoiceTargetLabel() || '需人工選擇'}</div>
                      <div><span className="font-black text-slate-500">發現：</span>{voiceDraft.draft.observation}</div>
                      <div><span className="font-black text-slate-500">判斷：</span>{voiceDraft.draft.judgment}</div>
                      <div><span className="font-black text-slate-500">動作：</span>{voiceDraft.draft.action_summary}</div>
                      <div><span className="font-black text-slate-500">追蹤：</span>{voiceDraft.draft.requires_follow_up ? `需要${voiceDraft.draft.follow_up_date ? `｜${voiceDraft.draft.follow_up_date}` : ''}` : '不需要'}</div>
                    </div>

                    <div>
                      <div className="text-xs font-black text-slate-500">正式主檔 Entity Matching</div>
                      <div className="mt-2 space-y-2">
                        {voiceDraft.entity_matches.length === 0 ? (
                          <div className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-500">未偵測到可比對的門市或員工代碼，請人工確認。</div>
                        ) : voiceDraft.entity_matches.map((match) => (
                          <div key={`${match.type}-${match.mention}`} className="rounded-lg bg-white px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-black text-slate-800">{match.type === 'STORE' ? '門市' : '人員'}：{match.mention}</span>
                              <span className={`rounded-full px-2 py-0.5 font-black ${match.status === 'MATCHED' ? 'bg-emerald-50 text-emerald-700' : match.status === 'AMBIGUOUS' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                                {match.status === 'MATCHED' ? '已比對' : match.status === 'AMBIGUOUS' ? '需選擇' : '找不到'}
                              </span>
                            </div>
                            {match.candidates.length > 0 && (
                              <div className="mt-1 space-y-1 text-slate-500">
                                {match.candidates.map((candidate) => (
                                  <div key={candidate.id}>{candidate.label}{candidate.store_label ? `｜${candidate.store_label}` : ''}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {voiceDraft.blocking_fields.length > 0 && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                        需補齊：{voiceDraft.blocking_fields.join('、')}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={applyVoiceDraftToRecordForm}
                      className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700"
                    >
                      套用到新增管理紀錄
                    </button>
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}

        {activeTab === 'today' && (
          <>
            <section className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-black text-emerald-700">我的今日管理</div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{todayLabel}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    今天還有：
                    <span className="mx-1 font-black text-slate-900">{todayLoading ? '-' : todayWorkspace?.summary.plans.planned ?? 0}</span>
                    件規劃，
                    <span className="mx-1 font-black text-slate-900">{todayLoading ? '-' : (todayWorkspace?.summary.followUps.today || 0) + (todayWorkspace?.summary.followUps.overdue || 0)}</span>
                    件待追蹤。
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-slate-600">
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">今日進度</span>
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">規劃 {todayLoading ? '-' : todayWorkspace?.summary.plans.total ?? 0}</span>
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">完成 {todayLoading ? '-' : todayWorkspace?.summary.plans.done ?? 0}</span>
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200">待追 {(todayLoading ? '-' : todayWorkspace?.summary.followUps.today ?? 0)}</span>
                    <span className="rounded-full bg-white px-3 py-1 ring-1 ring-rose-200 text-rose-700">逾期 {todayLoading ? '-' : todayWorkspace?.summary.followUps.overdue ?? 0}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => openVoiceSheet('RECORD_DRAFT')}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 text-sm font-black text-emerald-700 hover:bg-emerald-50"
                  >
                    <Mic size={17} />
                    快速口述
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickRecordOpen(true)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 text-sm font-black text-emerald-700 hover:bg-emerald-50"
                  >
                    <NotebookPen size={17} />
                    新增紀錄
                  </button>
                  <button
                    type="button"
                    onClick={() => openDailyPlanForm()}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
                  >
                    <Plus size={17} />
                    新增今日規劃
                  </button>
                </div>
              </div>
            </section>

            {showDailyPlanForm && (
              <section className="rounded-xl border border-emerald-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">{editingDailyPlan ? '編輯今日管理規劃' : '新增今日管理規劃'}</h2>
                    <p className="mt-1 text-sm text-slate-500">先安排今日要處理的門市、人員或其他管理事項。</p>
                  </div>
                  <button type="button" onClick={() => setShowDailyPlanForm(false)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={submitDailyPlan} className="mt-4 grid gap-3 lg:grid-cols-2">
                  <input type="date" value={dailyPlanForm.plan_date} onChange={(event) => updateDailyPlanForm('plan_date', event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
                  <select value={dailyPlanForm.target_type} onChange={(event) => updateDailyPlanForm('target_type', event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                    {Object.entries(TARGET_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  {(dailyPlanForm.target_type === 'STORE' || dailyPlanForm.target_type === 'EMPLOYEE') && (
                    <select value={dailyPlanForm.store_id} onChange={(event) => updateDailyPlanForm('store_id', event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                      <option value="">選擇門市</option>
                      {options.stores.map((item) => <option key={item.id} value={item.id}>{storeLabel(item)}</option>)}
                    </select>
                  )}
                  {dailyPlanForm.target_type === 'EMPLOYEE' && (
                    <select value={dailyPlanForm.employee_id} onChange={(event) => updateDailyPlanForm('employee_id', event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                      <option value="">選擇人員</option>
                      {dailyPlanEmployeesForStore.map((item) => (
                        <option key={item.id} value={item.id}>{item.employee_code} {item.employee_name} {item.current_position || item.position || ''}</option>
                      ))}
                    </select>
                  )}
                  {!['STORE', 'EMPLOYEE'].includes(dailyPlanForm.target_type) && (
                    <input value={dailyPlanForm.target_name_snapshot} onChange={(event) => updateDailyPlanForm('target_name_snapshot', event.target.value)} placeholder="管理對象名稱" className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
                  )}
                  {dailyPlanForm.target_type === 'STORE' && (
                    <input value={dailyPlanForm.target_name_snapshot} onChange={(event) => updateDailyPlanForm('target_name_snapshot', event.target.value)} placeholder="管理對象名稱會由門市帶入，也可補充" className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
                  )}
                  <input value={dailyPlanForm.title} onChange={(event) => updateDailyPlanForm('title', event.target.value)} placeholder="今日管理事項" className="h-10 rounded-lg border border-slate-200 px-3 text-sm lg:col-span-2" />
                  <select value={dailyPlanForm.category_id} onChange={(event) => updateDailyPlanForm('category_id', event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                    <option value="">未分類</option>
                    {options.categories.map((item) => <option key={item.id} value={item.id}>{item.code} {item.name}</option>)}
                  </select>
                  <select value={dailyPlanForm.linked_case_id} onChange={(event) => updateDailyPlanForm('linked_case_id', event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                    <option value="">不關聯案件</option>
                    {cases.map((item) => <option key={item.id} value={item.id}>{item.case_no || '-'} {item.title}</option>)}
                  </select>
                  <textarea value={dailyPlanForm.notes} onChange={(event) => updateDailyPlanForm('notes', event.target.value)} placeholder="備註" rows={3} className="rounded-lg border border-slate-200 px-3 py-2 text-sm lg:col-span-2" />
                  <button disabled={saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60 lg:col-span-2">
                    <Send size={16} />
                    {saving ? '儲存中' : editingDailyPlan ? '儲存規劃' : '建立規劃'}
                  </button>
                </form>
              </section>
            )}

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">今日管理規劃</h2>
                    <p className="mt-1 text-sm text-slate-500">只顯示目前登入者可見的今日規劃。</p>
                  </div>
                  <button type="button" onClick={() => void loadTodayWorkspace()} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 hover:bg-slate-50">
                    <RefreshCw size={14} />
                    重新整理
                  </button>
                </div>
                {todayLoading ? (
                  <div className="flex min-h-[260px] items-center justify-center gap-2 text-sm font-bold text-slate-500">
                    <Loader2 size={18} className="animate-spin" />
                    載入今日管理規劃
                  </div>
                ) : !todayWorkspace?.plans.length ? (
                  <div className="grid min-h-[260px] place-items-center px-5 text-center">
                    <div>
                      <NotebookPen className="mx-auto text-slate-300" size={42} />
                      <h3 className="mt-3 font-black text-slate-800">尚未建立今日管理規劃</h3>
                      <p className="mt-1 text-sm text-slate-500">可先新增今日規劃，或從管理案件建立後續追蹤。</p>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {todayWorkspace.plans.map((plan) => {
                      const metaItem = dailyPlanStatusMeta(plan.status);
                      return (
                        <article key={plan.id} className="px-5 py-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${metaItem.tone}`}>{metaItem.label}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{TARGET_TYPE[plan.target_type as keyof typeof TARGET_TYPE] || plan.target_type}</span>
                              </div>
                              <h3 className="mt-2 text-base font-black text-slate-950">{plan.title}</h3>
                              <p className="mt-1 text-sm font-semibold text-slate-600">{plan.target_name_snapshot}</p>
                              {plan.notes && <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{plan.notes}</p>}
                              <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
                                <span>更新：{formatDateTime(plan.updated_at)}</span>
                                {plan.linked_case && <span>關聯：{plan.linked_case.case_no || '-'} {plan.linked_case.title}</span>}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 lg:justify-end">
                              {plan.status !== 'DONE' && plan.status !== 'CANCELLED' && (
                                <button type="button" disabled={saving} onClick={() => void startPlanWork(plan)} className="h-9 rounded-lg border border-blue-200 px-3 text-xs font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50">開始處理</button>
                              )}
                              {plan.status !== 'DONE' && plan.status !== 'CANCELLED' && (
                                <button type="button" disabled={saving} onClick={() => void startPlanWork(plan)} className="h-9 rounded-lg border border-emerald-200 px-3 text-xs font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">新增管理結果</button>
                              )}
                              {plan.status !== 'DONE' && plan.status !== 'CANCELLED' && (
                                <button type="button" disabled={saving} onClick={() => void updateDailyPlanStatus(plan, 'DONE')} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">標記完成</button>
                              )}
                              <button type="button" onClick={() => openDailyPlanForm(plan)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 hover:bg-slate-50">編輯</button>
                              <button type="button" disabled={saving} onClick={() => void deleteDailyPlan(plan)} className="h-9 rounded-lg border border-rose-200 px-3 text-xs font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50">刪除</button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-5">
                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h2 className="text-lg font-black text-slate-950">今日待追蹤</h2>
                    <p className="mt-1 text-sm text-slate-500">依追蹤日期分為逾期、今日與 7 日內即將到期。</p>
                  </div>
                  {todayLoading ? (
                    <div className="flex min-h-[220px] items-center justify-center gap-2 text-sm font-bold text-slate-500">
                      <Loader2 size={18} className="animate-spin" />
                      載入待追蹤
                    </div>
                  ) : !todayWorkspace?.followUpQueue.length ? (
                    <div className="grid min-h-[220px] place-items-center px-5 text-center">
                      <div>
                        <CalendarClock className="mx-auto text-slate-300" size={40} />
                        <h3 className="mt-3 font-black text-slate-800">目前沒有 7 日內待追蹤案件</h3>
                        <p className="mt-1 text-sm text-slate-500">可從案件設定下次追蹤日期。</p>
                      </div>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {todayWorkspace.followUpQueue.map((item) => (
                        <article key={item.id} className="px-5 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-slate-950">{item.title}</div>
                              <div className="mt-1 text-sm text-slate-500">{item.target_name_snapshot}</div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-black ${item.bucket === 'overdue' ? 'bg-rose-50 text-rose-700' : item.bucket === 'today' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                              {item.bucket === 'overdue' ? '逾期' : item.bucket === 'today' ? '今日' : '即將到期'}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.latest_record?.expected_result || item.summary || '尚未填寫摘要'}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" onClick={() => void openQuickFollowup(item)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700">立即追蹤</button>
                            <button type="button" onClick={() => { setActiveTab('cases'); void loadCaseDetail(item.id); }} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50">查看案件</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <h2 className="text-lg font-black text-slate-950">快速新增管理紀錄</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">管理紀錄需關聯到案件；請先選取案件，再於案件後續紀錄新增。</p>
                  <button type="button" onClick={() => setActiveTab('cases')} className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700 hover:bg-emerald-100">
                    <NotebookPen size={16} />
                    前往管理案件
                  </button>
                </div>
              </div>
            </section>

            {quickRecordOpen && (
              <section className="rounded-xl border border-emerald-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">新增管理結果</h2>
                    <p className="mt-1 text-sm text-slate-500">把剛剛看到、判斷與處理的事情留下來；若需要後續確認，可直接建立追蹤。</p>
                  </div>
                  <button type="button" onClick={() => setQuickRecordOpen(false)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={submitRecord} className="mt-4 space-y-4">
                  <div className="grid gap-3 lg:grid-cols-3">
                    <label className="text-xs font-black text-slate-500 lg:col-span-2">
                      關聯管理案件
                      <select
                        value={selectedCase?.id || ''}
                        onChange={(event) => {
                          if (event.target.value) void loadCaseDetail(event.target.value);
                        }}
                        className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800"
                      >
                        <option value="">選擇案件後才能新增管理結果</option>
                        {cases.map((item) => (
                          <option key={item.id} value={item.id}>{item.case_no || '-'} {item.target_name_snapshot}｜{item.title}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-black text-slate-500">
                      紀錄日期
                      <input
                        type="date"
                        value={recordForm.record_date}
                        onChange={(event) => setRecordForm((prev) => ({ ...prev, record_date: event.target.value }))}
                        className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800"
                      />
                    </label>
                  </div>
                  <label className="block text-sm font-black text-slate-900">
                    今天看到什麼？
                    <textarea value={recordForm.observation} onChange={(event) => setRecordForm((prev) => ({ ...prev, observation: event.target.value }))} placeholder="例如：保健品業績落後約 8%，來客數正常。" rows={2} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700" />
                  </label>
                  <label className="block text-sm font-black text-slate-900">
                    你認為主要原因？
                    <textarea value={recordForm.judgment} onChange={(event) => setRecordForm((prev) => ({ ...prev, judgment: event.target.value }))} placeholder="例如：主要是三位專員成交下降，不是客流問題。" rows={2} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700" />
                  </label>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="text-sm font-black text-slate-900">你做了什麼？</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ACTION_OPTIONS.map((option) => {
                        const checked = recordForm.action_options.includes(option);
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => toggleActionOption(option)}
                            className={`rounded-full border px-3 py-1.5 text-xs font-black ${checked ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                    <textarea value={recordForm.action_summary} onChange={(event) => setRecordForm((prev) => ({ ...prev, action_summary: event.target.value }))} placeholder="補充管理動作，例如：要求店長每日追蹤三位專員成交狀況。" rows={2} className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700" />
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <div className="text-sm font-black text-slate-900">還要再看嗎？</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setRecordForm((prev) => ({ ...prev, requires_follow_up: false, follow_up_date: '', expected_result: '', follow_up_method: '' }))} className={`rounded-full border px-3 py-1.5 text-xs font-black ${!recordForm.requires_follow_up ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}>不用</button>
                      <button type="button" onClick={() => setRecordForm((prev) => ({ ...prev, requires_follow_up: true }))} className={`rounded-full border px-3 py-1.5 text-xs font-black ${recordForm.requires_follow_up ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600'}`}>需要追蹤</button>
                    </div>
                    {recordForm.requires_follow_up && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <input type="date" value={recordForm.follow_up_date} onChange={(event) => setRecordForm((prev) => ({ ...prev, follow_up_date: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
                        <select value={recordForm.follow_up_method} onChange={(event) => setRecordForm((prev) => ({ ...prev, follow_up_method: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                          <option value="">選擇追蹤方式</option>
                          {Object.entries(FOLLOW_UP_METHOD).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <input value={recordForm.expected_result} onChange={(event) => setRecordForm((prev) => ({ ...prev, expected_result: event.target.value }))} placeholder="下次要確認什麼？" className="h-10 rounded-lg border border-slate-200 px-3 text-sm sm:col-span-2" />
                      </div>
                    )}
                  </div>
                  <button disabled={saving || !selectedCase} className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-slate-900 text-sm font-black text-white disabled:opacity-60">
                    儲存管理結果
                  </button>
                </form>
              </section>
            )}

            {quickFollowUpCase && selectedCase && (
              <section className="rounded-xl border border-emerald-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">追蹤結果回填</h2>
                    <p className="mt-1 text-sm text-slate-500">{quickFollowUpCase.case_no || '-'} {quickFollowUpCase.title}</p>
                  </div>
                  <button type="button" onClick={() => setQuickFollowUpCase(null)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                    <X size={16} />
                  </button>
                </div>
                <form onSubmit={submitFollowup} className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="lg:col-span-2">
                    <div className="text-sm font-black text-slate-900">結果如何？</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      {[
                        ['IMPROVED', '已改善'],
                        ['IMPROVING', '有進步，繼續追'],
                        ['NOT_IMPROVED', '沒有改善'],
                        ['POSTPONED', '尚無法判斷'],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setFollowupForm((prev) => ({ ...prev, result_status: value }))}
                          className={`rounded-lg border px-3 py-2 text-xs font-black ${followupForm.result_status === value ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <select value={followupForm.source_record_id} onChange={(event) => setFollowupForm((prev) => ({ ...prev, source_record_id: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                    <option value="">不指定來源管理紀錄</option>
                    {(selectedCase.records || []).map((record) => (
                      <option key={record.id} value={record.id}>{formatDate(record.record_date)} {recordTypeLabel(record.record_type)} - {record.observation.slice(0, 24)}</option>
                    ))}
                  </select>
                  <input type="date" value={followupForm.follow_up_date} onChange={(event) => setFollowupForm((prev) => ({ ...prev, follow_up_date: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
                  <div className="lg:col-span-2">
                    <div className="text-sm font-black text-slate-900">下次什麼時候看？</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        ['明天', 1],
                        ['3天後', 3],
                        ['下週', 7],
                      ].map(([label, days]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => {
                            const nextDate = new Date(`${todayKey}T00:00:00`);
                            nextDate.setDate(nextDate.getDate() + Number(days));
                            setFollowupForm((prev) => ({ ...prev, next_follow_up_date: nextDate.toISOString().slice(0, 10) }));
                          }}
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-50"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input type="date" value={followupForm.next_follow_up_date} onChange={(event) => setFollowupForm((prev) => ({ ...prev, next_follow_up_date: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-3 text-sm lg:col-span-2" />
                  <textarea value={followupForm.result_notes} onChange={(event) => setFollowupForm((prev) => ({ ...prev, result_notes: event.target.value }))} placeholder="說明一下結果，例如：兩個有改善，小王還是不穩定。" rows={3} className="rounded-lg border border-slate-200 px-3 py-2 text-sm lg:col-span-2" />
                  <button disabled={saving} className="inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60 lg:col-span-2">儲存追蹤結果</button>
                </form>
              </section>
            )}

            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-lg font-black text-slate-950">今日管理紀錄</h2>
                <p className="mt-1 text-sm text-slate-500">顯示今天已新增的管理紀錄，不使用假資料或跨權限推算。</p>
              </div>
              {todayLoading ? (
                <div className="flex min-h-[220px] items-center justify-center gap-2 text-sm font-bold text-slate-500">
                  <Loader2 size={18} className="animate-spin" />
                  載入今日管理紀錄
                </div>
              ) : !todayWorkspace?.todayRecords.length ? (
                <div className="grid min-h-[220px] place-items-center px-5 text-center">
                  <div>
                    <NotebookPen className="mx-auto text-slate-300" size={40} />
                    <h3 className="mt-3 font-black text-slate-800">今天尚無管理紀錄</h3>
                    <p className="mt-1 text-sm text-slate-500">可從管理案件新增紀錄，完成後會同步回到此區。</p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {todayWorkspace.todayRecords.map((record) => (
                    <article key={record.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-500">
                        <span>{formatDate(record.record_date)} / {recordTypeLabel(record.record_type)}</span>
                        {record.case && <span className={`rounded-full border px-2 py-0.5 ${statusMeta(record.case.status).tone}`}>{statusMeta(record.case.status).label}</span>}
                      </div>
                      <p className="mt-2 text-sm font-black text-slate-900">{record.target_name_snapshot || record.case?.title || '未命名對象'}</p>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{record.observation}</p>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">{record.action_summary}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === 'cases' && (
          <>
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap gap-2">
            {[
              ['', '全部'],
              ['OPEN', '待處理'],
              ['FOLLOW_UP', '待追蹤'],
              ['IMPROVING', '改善中'],
              ['RESOLVED', '已改善'],
              ['CLOSED', '已結案'],
            ].map(([value, label]) => (
              <button
                key={value || 'all'}
                type="button"
                onClick={() => applyStatus(value)}
                className={`rounded-full px-4 py-2 text-sm font-black ${filters.status === value ? 'bg-emerald-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 lg:grid-cols-[160px_160px_minmax(0,1fr)_auto_auto]">
            <label className="text-xs font-black text-slate-500">
              狀態
              <select
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800"
              >
                <option value="">全部</option>
                {Object.entries(CASE_STATUS).map(([value, metaItem]) => (
                  <option key={value} value={value}>{metaItem.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-black text-slate-500">
              目標類型
              <select
                value={filters.targetType}
                onChange={(event) => setFilters((prev) => ({ ...prev, targetType: event.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800"
              >
                <option value="">全部</option>
                {Object.entries(TARGET_TYPE).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-black text-slate-500">
              關鍵字
              <div className="mt-1 flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3">
                <Search size={16} className="text-slate-400" />
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                  placeholder="案件標題、對象、摘要"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>
            <button
              type="button"
              onClick={() => void loadData(filters, 1)}
              className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-lg bg-emerald-600 px-4 text-sm font-black text-white hover:bg-emerald-700"
            >
              <Filter size={16} />
              查詢
            </button>
            <button
              type="button"
              onClick={() => {
                const next = { status: '', targetType: '', search: '' };
                setFilters(next);
                void loadData(next, 1);
              }}
              className="h-10 self-end rounded-lg border border-slate-200 px-4 text-sm font-black text-slate-700 hover:bg-slate-50"
            >
              清除
            </button>
          </div>
        </section>

        <section className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">管理案件</h2>
                <p className="mt-1 text-sm text-slate-500">共 {meta.total} 筆，依目前登入者權限與門市範圍顯示。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCaseForm(true)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white hover:bg-emerald-700"
              >
                <Plus size={16} />
                建立管理案件
              </button>
            </div>

            {loading ? (
              <div className="flex min-h-[260px] items-center justify-center gap-2 text-sm font-bold text-slate-500">
                <Loader2 size={18} className="animate-spin" />
                載入中
              </div>
            ) : cases.length === 0 ? (
              <div className="grid min-h-[260px] place-items-center px-4 text-center">
                <div>
                  <ClipboardList className="mx-auto text-slate-300" size={42} />
                  <h3 className="mt-3 font-black text-slate-800">目前沒有符合條件的案件</h3>
                  <p className="mt-1 text-sm text-slate-500">可建立第一筆督導管理案件，或調整篩選條件。</p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {cases.map((item) => {
                  const metaItem = statusMeta(item.status);
                  const active = selectedCase?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void loadCaseDetail(item.id)}
                      className={`grid w-full gap-3 px-5 py-4 text-left hover:bg-slate-50 lg:grid-cols-[minmax(0,1fr)_120px_110px] ${active ? 'bg-emerald-50/60' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-slate-950">{item.title}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${metaItem.tone}`}>{metaItem.label}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                            {TARGET_TYPE[item.target_type as keyof typeof TARGET_TYPE] || item.target_type}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.summary || item.target_name_snapshot}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                          <span className="inline-flex items-center gap-1"><Store size={13} />{storeLabel(item.store)}</span>
                          <span className="inline-flex items-center gap-1"><UserRound size={13} />{item.target_name_snapshot}</span>
                        </div>
                      </div>
                      <div className="text-sm font-bold text-slate-700">
                        {PRIORITY[item.priority as keyof typeof PRIORITY] || item.priority}
                      </div>
                      <div className="text-sm text-slate-500">
                        <div className="font-bold text-slate-700">{formatDate(item.opened_at)}</div>
                        <div className="mt-1 text-xs">追蹤 {formatDate(item.next_follow_up_at)}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
              <span>第 {meta.page} / {meta.totalPages} 頁</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={meta.page <= 1 || loading}
                  onClick={() => void loadData(filters, meta.page - 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  上一頁
                </button>
                <button
                  type="button"
                  disabled={meta.page >= meta.totalPages || loading}
                  onClick={() => void loadData(filters, meta.page + 1)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  下一頁
                </button>
              </div>
            </div>
          </div>

          {showCaseForm && (
          <div className="space-y-5">
            <form onSubmit={submitCase} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-lg font-black text-slate-950">
                  <Plus size={18} />
                  建立管理案件
                </div>
                <button type="button" onClick={() => setShowCaseForm(false)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                  <X size={16} />
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <input
                  value={caseForm.title}
                  onChange={(event) => updateCaseForm('title', event.target.value)}
                  placeholder="案件標題，例如：門市交接紀律需追蹤"
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <select value={caseForm.target_type} onChange={(event) => updateCaseForm('target_type', event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                    {Object.entries(TARGET_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <select value={caseForm.priority} onChange={(event) => updateCaseForm('priority', event.target.value)} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                    {Object.entries(PRIORITY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <select value={caseForm.category_id} onChange={(event) => updateCaseForm('category_id', event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                  <option value="">未分類</option>
                  {options.categories.map((item) => <option key={item.id} value={item.id}>{item.code} {item.name}</option>)}
                </select>
                {(caseForm.target_type === 'STORE' || caseForm.target_type === 'EMPLOYEE') && (
                  <select value={caseForm.store_id} onChange={(event) => updateCaseForm('store_id', event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                    <option value="">選擇門市</option>
                    {options.stores.map((item) => <option key={item.id} value={item.id}>{storeLabel(item)}</option>)}
                  </select>
                )}
                {caseForm.target_type === 'EMPLOYEE' && (
                  <select value={caseForm.employee_id} onChange={(event) => updateCaseForm('employee_id', event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                    <option value="">選擇人員</option>
                    {employeesForStore.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.employee_code} {item.employee_name} {item.current_position || item.position || ''}
                      </option>
                    ))}
                  </select>
                )}
                {!['STORE', 'EMPLOYEE'].includes(caseForm.target_type) && (
                  <input value={caseForm.target_name_snapshot} onChange={(event) => updateCaseForm('target_name_snapshot', event.target.value)} placeholder="管理對象名稱" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                )}
                {caseForm.target_type === 'STORE' && (
                  <input value={caseForm.target_name_snapshot} onChange={(event) => updateCaseForm('target_name_snapshot', event.target.value)} placeholder="管理對象名稱會由門市帶入，也可補充" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                )}
                <input type="date" value={caseForm.next_follow_up_at} onChange={(event) => updateCaseForm('next_follow_up_at', event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                <textarea value={caseForm.summary} onChange={(event) => updateCaseForm('summary', event.target.value)} placeholder="案件摘要" rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <button disabled={saving} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60">
                <Send size={16} />
                {saving ? '儲存中' : '建立案件'}
              </button>
            </form>
          </div>
          )}

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-black text-slate-950">案件時間線</h2>
                {selectedCase && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingCase((value) => !value)}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 hover:bg-slate-50"
                    >
                      {editingCase ? <X size={14} /> : <Edit3 size={14} />}
                      {editingCase ? '取消' : '編輯'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSelectedCase()}
                      disabled={saving}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                      刪除
                    </button>
                  </div>
                )}
              </div>
              {selectedCase ? (
                <>
                  <div className="mt-3 rounded-lg bg-slate-50 p-3">
                    <div className="font-black text-slate-900">{selectedCase.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{selectedCase.target_name_snapshot}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
                      <span className={`rounded-full border px-2 py-0.5 ${statusMeta(selectedCase.status).tone}`}>
                        {statusMeta(selectedCase.status).label}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-slate-600">
                        {TARGET_TYPE[selectedCase.target_type as keyof typeof TARGET_TYPE] || selectedCase.target_type}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-slate-600">
                        優先 {PRIORITY[selectedCase.priority as keyof typeof PRIORITY] || selectedCase.priority}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-500 sm:grid-cols-2">
                      <div>門市：{storeLabel(selectedCase.store)}</div>
                      <div>開案：{formatDate(selectedCase.opened_at)}</div>
                      <div>下次追蹤：{formatDate(selectedCase.next_follow_up_at)}</div>
                      <div>更新：{formatDateTime(selectedCase.updated_at)}</div>
                    </div>
                  </div>
                  {editingCase && (
                    <form onSubmit={submitCaseUpdate} className="mt-4 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                      <div className="text-sm font-black text-emerald-800">編輯案件</div>
                      <input
                        value={editForm.title}
                        onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
                        placeholder="案件標題"
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <select
                          value={editForm.status}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, status: event.target.value }))}
                          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        >
                          {Object.entries(CASE_STATUS).map(([value, metaItem]) => (
                            <option key={value} value={value}>{metaItem.label}</option>
                          ))}
                        </select>
                        <select
                          value={editForm.priority}
                          onChange={(event) => setEditForm((prev) => ({ ...prev, priority: event.target.value }))}
                          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                        >
                          {Object.entries(PRIORITY).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <select
                        value={editForm.category_id}
                        onChange={(event) => setEditForm((prev) => ({ ...prev, category_id: event.target.value }))}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                      >
                        <option value="">未分類</option>
                        {options.categories.map((item) => (
                          <option key={item.id} value={item.id}>{item.code} {item.name}</option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={editForm.next_follow_up_at}
                        onChange={(event) => setEditForm((prev) => ({ ...prev, next_follow_up_at: event.target.value }))}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                      />
                      <textarea
                        value={editForm.summary}
                        onChange={(event) => setEditForm((prev) => ({ ...prev, summary: event.target.value }))}
                        placeholder="案件摘要"
                        rows={3}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                      <button
                        disabled={saving}
                        className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        儲存案件變更
                      </button>
                    </form>
                  )}
                  {detailLoading ? (
                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-500">
                      <Loader2 size={16} className="animate-spin" />
                      載入案件詳情
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-lg border border-slate-200">
                        <div className="border-b border-slate-100 px-3 py-2 text-sm font-black text-slate-800">發現、判斷與管理動作</div>
                        {(selectedCase.records || []).length === 0 ? (
                          <p className="px-3 py-3 text-sm font-semibold text-slate-500">尚無管理紀錄。</p>
                        ) : (
                          <div className="divide-y divide-slate-100">
                            {(selectedCase.records || []).map((record) => (
                              <article key={record.id} className="px-3 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
                                  <span>{formatDate(record.record_date)} / {recordTypeLabel(record.record_type)}</span>
                                  {record.requires_follow_up && (
                                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">需追蹤 {formatDate(record.follow_up_date)}</span>
                                  )}
                                </div>
                                <div className="mt-2 space-y-1 text-sm leading-6 text-slate-700">
                                  <p><span className="font-black text-slate-900">觀察：</span>{record.observation}</p>
                                  <p><span className="font-black text-slate-900">判斷：</span>{record.judgment}</p>
                                  <p><span className="font-black text-slate-900">動作：</span>{record.action_summary}</p>
                                  {record.action_options && record.action_options.length > 0 && (
                                    <p><span className="font-black text-slate-900">動作項目：</span>{record.action_options.join('、')}</p>
                                  )}
                                  {record.follow_up_method && (
                                    <p><span className="font-black text-slate-900">追蹤方式：</span>{followUpMethodLabel(record.follow_up_method)}</p>
                                  )}
                                  {record.expected_result && <p><span className="font-black text-slate-900">預期：</span>{record.expected_result}</p>}
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-slate-200">
                        <div className="border-b border-slate-100 px-3 py-2 text-sm font-black text-slate-800">追蹤與改善結果</div>
                        {(selectedCase.followups || []).length === 0 ? (
                          <p className="px-3 py-3 text-sm font-semibold text-slate-500">尚無追蹤結果。</p>
                        ) : (
                          <div className="divide-y divide-slate-100">
                            {(selectedCase.followups || []).map((followup) => {
                              const sourceRecord = (selectedCase.records || []).find((record) => record.id === followup.source_record_id);
                              return (
                                <article key={followup.id} className="px-3 py-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500">
                                    <span>{formatDate(followup.follow_up_date)}</span>
                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{followupStatusLabel(followup.result_status)}</span>
                                  </div>
                                  {followup.source_record_id && (
                                    <p className="mt-1 text-xs font-bold text-slate-500">
                                      關聯紀錄：{sourceRecord ? `${formatDate(sourceRecord.record_date)} ${recordTypeLabel(sourceRecord.record_type)} - ${sourceRecord.observation.slice(0, 24)}` : followup.source_record_id.slice(0, 8)}
                                    </p>
                                  )}
                                  <p className="mt-2 text-sm leading-6 text-slate-700">{followup.result_notes}</p>
                                  {followup.next_follow_up_date && (
                                    <p className="mt-1 text-xs font-bold text-slate-500">下次追蹤：{formatDate(followup.next_follow_up_date)}</p>
                                  )}
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-slate-200">
                        <div className="border-b border-slate-100 px-3 py-2 text-sm font-black text-slate-800">系統紀錄</div>
                        {(selectedCase.events || []).length === 0 ? (
                          <p className="px-3 py-3 text-sm font-semibold text-slate-500">尚無事件紀錄。</p>
                        ) : (
                          <div className="space-y-3 px-3 py-3">
                            {(selectedCase.events || []).map((event) => (
                              <article key={event.id} className="border-l-2 border-emerald-200 pl-3">
                                <div className="text-xs font-bold text-slate-500">{formatDateTime(event.event_at)} / {event.event_type}</div>
                                <div className="mt-1 text-sm font-black text-slate-900">{event.title}</div>
                                {event.body && <p className="mt-1 text-sm leading-6 text-slate-600">{event.body}</p>}
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <form onSubmit={submitRecord} className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-black text-slate-500">
                        紀錄類型
                        <select
                          value={recordForm.record_type}
                          onChange={(event) => setRecordForm((prev) => ({ ...prev, record_type: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800"
                        >
                          {Object.entries(RECORD_TYPE).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-black text-slate-500">
                        紀錄日期
                        <input
                          type="date"
                          value={recordForm.record_date}
                          onChange={(event) => setRecordForm((prev) => ({ ...prev, record_date: event.target.value }))}
                          className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-800"
                        />
                      </label>
                    </div>
                    <textarea value={recordForm.observation} onChange={(event) => setRecordForm((prev) => ({ ...prev, observation: event.target.value }))} placeholder="發現 / 觀察" rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <textarea value={recordForm.judgment} onChange={(event) => setRecordForm((prev) => ({ ...prev, judgment: event.target.value }))} placeholder="管理判斷" rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <textarea value={recordForm.action_summary} onChange={(event) => setRecordForm((prev) => ({ ...prev, action_summary: event.target.value }))} placeholder="管理動作" rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="text-xs font-black text-slate-500">管理動作項目</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {ACTION_OPTIONS.map((option) => {
                          const checked = recordForm.action_options.includes(option);
                          return (
                            <button
                              key={option}
                              type="button"
                              onClick={() => toggleActionOption(option)}
                              className={`rounded-full border px-3 py-1 text-xs font-black ${checked ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                      <input type="checkbox" checked={recordForm.requires_follow_up} onChange={(event) => setRecordForm((prev) => ({ ...prev, requires_follow_up: event.target.checked }))} />
                      需要追蹤
                    </label>
                    {recordForm.requires_follow_up && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input type="date" value={recordForm.follow_up_date} onChange={(event) => setRecordForm((prev) => ({ ...prev, follow_up_date: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-3 text-sm" />
                        <select value={recordForm.follow_up_method} onChange={(event) => setRecordForm((prev) => ({ ...prev, follow_up_method: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-3 text-sm">
                          <option value="">選擇追蹤方式</option>
                          {Object.entries(FOLLOW_UP_METHOD).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                        <input value={recordForm.expected_result} onChange={(event) => setRecordForm((prev) => ({ ...prev, expected_result: event.target.value }))} placeholder="預期改善結果" className="h-10 rounded-lg border border-slate-200 px-3 text-sm sm:col-span-2" />
                      </div>
                    )}
                    <button disabled={saving} className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-slate-900 text-sm font-black text-white disabled:opacity-60">
                      新增管理紀錄
                    </button>
                  </form>
                  <form onSubmit={submitFollowup} className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                    <select value={followupForm.source_record_id} onChange={(event) => setFollowupForm((prev) => ({ ...prev, source_record_id: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                      <option value="">不指定來源管理紀錄</option>
                      {(selectedCase.records || []).map((record) => (
                        <option key={record.id} value={record.id}>
                          {formatDate(record.record_date)} {recordTypeLabel(record.record_type)} - {record.observation.slice(0, 24)}
                        </option>
                      ))}
                    </select>
                    <input type="date" value={followupForm.follow_up_date} onChange={(event) => setFollowupForm((prev) => ({ ...prev, follow_up_date: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                    <select value={followupForm.result_status} onChange={(event) => setFollowupForm((prev) => ({ ...prev, result_status: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                      {Object.entries(FOLLOWUP_STATUS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <textarea value={followupForm.result_notes} onChange={(event) => setFollowupForm((prev) => ({ ...prev, result_notes: event.target.value }))} placeholder="追蹤結果說明" rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                    <input type="date" value={followupForm.next_follow_up_date} onChange={(event) => setFollowupForm((prev) => ({ ...prev, next_follow_up_date: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
                    <button disabled={saving} className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-black text-emerald-700 disabled:opacity-60">
                      新增追蹤結果
                    </button>
                  </form>
                </>
              ) : (
                <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-500">請先從左側列表選擇案件。</p>
              )}
            </section>
        </section>
          </>
        )}

      </div>
    </main>
  );
}
