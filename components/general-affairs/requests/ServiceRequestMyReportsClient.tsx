'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  Image,
  MessageSquare,
  PackagePlus,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Timer,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';

type ServiceRequest = {
  id: string;
  request_no: string;
  request_type: string;
  title: string;
  description: string;
  resource_type?: string | null;
  desired_quantity?: number | null;
  desired_unit?: string | null;
  desired_spec?: string | null;
  impact_description?: string | null;
  main_status: string;
  intake_route?: string | null;
  assignee_role?: string | null;
  assignee_name?: string | null;
  maintenance_request_id?: string | null;
  public_progress?: string | null;
  rejection_reason?: string | null;
  rejection_note?: string | null;
  supplement_note?: string | null;
  created_at: string;
  updated_at: string;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
  equipment?: { name?: string | null; asset_code?: string | null; area?: string | null; location_detail?: string | null } | null;
  facility?: { name?: string | null; facility_code?: string | null; area?: string | null; location_detail?: string | null } | null;
  part?: { name?: string | null; part_code?: string | null } | null;
};

type RequestAttachment = {
  id: string;
  file_name: string;
  content_type?: string | null;
  size_bytes?: number | null;
  purpose?: string | null;
  signed_url?: string | null;
  uploaded_at?: string | null;
};

type StoreAction = 'submit_supplement' | 'confirm_complete' | 'report_problem';

type StoreActionResult = {
  tone: 'emerald' | 'blue' | 'orange';
  title: string;
  body: string;
  actionLabel: string;
  statusValue: string;
};

type EquipmentOnboardingTask = {
  id: string;
  task_type: 'EQUIPMENT_PHOTO' | 'LABEL_POSITION_PHOTO';
  title: string;
  action_label: string;
  updated_at: string;
  store?: { store_code?: string | null; store_name?: string | null; short_name?: string | null } | null;
  equipment: {
    id: string;
    name?: string | null;
    asset_code?: string | null;
    area?: string | null;
    location_detail?: string | null;
    onboarding_status?: string | null;
    onboarding_requires_primary_photo?: boolean | null;
    onboarding_requires_label_photo?: boolean | null;
    onboarding_review_note?: string | null;
    image?: {
      file_name?: string | null;
      content_type?: string | null;
      signed_url?: string | null;
    } | null;
  };
};

type TrackingItem =
  | { kind: 'request'; id: string; status: string; searchable: string; updated_at: string; request: ServiceRequest }
  | { kind: 'asset_task'; id: string; status: 'WAITING_STORE_SUPPLEMENT'; searchable: string; updated_at: string; task: EquipmentOnboardingTask };

type RequestEvent = {
  id: string;
  event_type: string;
  old_status?: string | null;
  new_status?: string | null;
  visibility?: string | null;
  title: string;
  description?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
};

type RequestComment = {
  id: string;
  visibility?: string | null;
  body: string;
  attachments?: RequestAttachment[];
  created_by_name?: string | null;
  edited_at?: string | null;
  created_at?: string | null;
  read_by_name?: string | null;
  read_at?: string | null;
  can_edit?: boolean;
  can_delete?: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_INTAKE: '待受理',
  WAITING_STORE_SUPPLEMENT: '待我處理',
  WAITING_GA_REVIEW: '待總務複核',
  ACCEPTED: '已受理',
  IN_PROGRESS: '總務準備中',
  WAITING_STORE_CONFIRMATION: '待門市確認',
  COMPLETED: '已完成',
  REJECTED: '已駁回',
  CANCELED: '已取消',
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  REPAIR: '維修',
  PURCHASE_SUPPLEMENT: '添購/補充',
  ASSIGNED_RESPONSE: '總務要求回覆',
};

const STATUS_FILTERS = [
  { value: 'WAITING_STORE_CONFIRMATION', label: '待我確認' },
  { value: 'WAITING_STORE_SUPPLEMENT', label: '待我處理' },
  { value: 'PENDING_INTAKE', label: '待受理' },
  { value: 'WAITING_GA_REVIEW', label: '待總務複核' },
  { value: 'ACCEPTED', label: '已受理' },
  { value: 'IN_PROGRESS', label: '總務準備中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REJECTED', label: '已駁回' },
  { value: '', label: '全部' },
];

const PROGRESS_STEPS = [
  { key: 'PENDING_INTAKE', label: '送出' },
  { key: 'ACCEPTED', label: '總務接手' },
  { key: 'IN_PROGRESS', label: '準備中' },
  { key: 'WAITING_STORE_CONFIRMATION', label: '門市確認' },
  { key: 'COMPLETED', label: '完成' },
];

const PROGRESS_INDEX: Record<string, number> = {
  PENDING_INTAKE: 0,
  WAITING_STORE_SUPPLEMENT: 0,
  WAITING_GA_REVIEW: 0,
  ACCEPTED: 1,
  IN_PROGRESS: 2,
  WAITING_STORE_CONFIRMATION: 3,
  COMPLETED: 4,
};

const ASSET_TASK_PROGRESS: Record<EquipmentOnboardingTask['task_type'], number> = {
  EQUIPMENT_PHOTO: 15,
  LABEL_POSITION_PHOTO: 45,
};

const ASSET_TASK_STEPS = [
  { key: 'EQUIPMENT_PHOTO', label: '設備照片' },
  { key: 'LABEL_POSITION_PHOTO', label: '貼標照片' },
  { key: 'PENDING_GA_REVIEW', label: '總務複核' },
  { key: 'COMPLETED', label: '完成' },
];

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function storeLabel(request: ServiceRequest) {
  const store = request.store;
  return [store?.store_code, store?.short_name || store?.store_name].filter(Boolean).join(' ') || '-';
}

function taskStoreLabel(task: EquipmentOnboardingTask) {
  const store = task.store;
  return [store?.store_code, store?.short_name || store?.store_name].filter(Boolean).join(' ') || '-';
}

function taskLocationLabel(task: EquipmentOnboardingTask) {
  return [task.equipment.area, task.equipment.location_detail].filter(Boolean).join(' / ') || '-';
}

function resourceLabel(request: ServiceRequest) {
  if (request.resource_type === 'EQUIPMENT') {
    return [request.equipment?.asset_code, request.equipment?.name, request.equipment?.area, request.equipment?.location_detail].filter(Boolean).join(' / ') || '設備';
  }
  if (request.resource_type === 'FACILITY') {
    return [request.facility?.facility_code, request.facility?.name, request.facility?.area, request.facility?.location_detail].filter(Boolean).join(' / ') || '設施';
  }
  if (request.resource_type === 'PART') {
    return [request.part?.part_code, request.part?.name].filter(Boolean).join(' / ') || '料件';
  }
  if (request.resource_type === 'GENERAL_SUPPLY') return '庶務用品';
  if (request.resource_type === 'OTHER_PURCHASE') return '未建主檔物品';
  return '-';
}

function resourceKindLabel(request: ServiceRequest) {
  if (request.resource_type === 'EQUIPMENT') return '設備';
  if (request.resource_type === 'FACILITY') return '設施';
  if (request.resource_type === 'PART') return '料件';
  if (request.resource_type === 'GENERAL_SUPPLY') return '庶務用品';
  if (request.resource_type === 'OTHER_PURCHASE') return '未建物品';
  return REQUEST_TYPE_LABELS[request.request_type] || '需求';
}

function requestItemTitle(request: ServiceRequest) {
  if (request.resource_type === 'EQUIPMENT') return request.equipment?.name || request.title;
  if (request.resource_type === 'FACILITY') return request.facility?.name || request.title;
  if (request.resource_type === 'PART') return request.part?.name || request.title;
  return request.title;
}

const SCENE_DESCRIPTION_LABELS = ['現場描述', '現場狀況', '需求描述', '問題描述', '描述', '說明'];
const DUPLICATE_SCENE_LABELS = [
  '問題類型',
  '環境問題',
  '狀況類型',
  '需求類型',
  '問題分類',
  '分類',
  '門市',
  '發生位置',
  '暫時處理方式',
];

function stripSceneDescription(value?: string | null) {
  const rawValue = value?.trim();
  if (!rawValue) return '';

  const parts = rawValue
    .replace(/\r\n/g, '\n')
    .replace(/[|｜]/g, '\n')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);

  const sceneLabelPattern = new RegExp(`^(${SCENE_DESCRIPTION_LABELS.join('|')})\\s*[:：]\\s*`);
  const duplicateLabelPattern = new RegExp(`^(${DUPLICATE_SCENE_LABELS.join('|')})(\\s*[:：].*)?$`);
  const duplicatePrefixPattern = new RegExp(`^(${DUPLICATE_SCENE_LABELS.join('|')})\\s*[:：]`);

  const labeledScene = parts.find((part) => sceneLabelPattern.test(part));
  if (labeledScene) return labeledScene.replace(sceneLabelPattern, '').trim();

  return parts
    .map((part) => part.replace(sceneLabelPattern, '').trim())
    .filter((part) => part && !duplicateLabelPattern.test(part) && !duplicatePrefixPattern.test(part))
    .join(' / ')
    .trim();
}

function requestListSceneDescription(request: ServiceRequest) {
  return stripSceneDescription(request.description) || stripSceneDescription(request.impact_description) || '未填現場描述';
}

function formatFileSize(value?: number | null) {
  if (!value || value <= 0) return '';
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function getProgressInfo(status: string) {
  const isTerminalProblem = status === 'REJECTED' || status === 'CANCELED';
  const activeIndex = PROGRESS_INDEX[status] ?? 0;
  const percent = isTerminalProblem ? 100 : Math.round((activeIndex / (PROGRESS_STEPS.length - 1)) * 100);
  return { activeIndex, percent, isTerminalProblem };
}

function isImageAttachment(attachment: RequestAttachment) {
  const fileName = attachment.file_name?.toLowerCase() || '';
  const looksLikeImage = /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(fileName);
  return Boolean((attachment.content_type?.startsWith('image/') || looksLikeImage) && attachment.signed_url);
}

function assetTaskActionTitle(task: EquipmentOnboardingTask) {
  return task.task_type === 'EQUIPMENT_PHOTO'
    ? '請上傳這台設備的照片'
    : '請上傳這台設備的貼標照片';
}

function assetTaskActionDescription(task: EquipmentOnboardingTask) {
  return task.task_type === 'EQUIPMENT_PHOTO'
    ? '請拍設備本體，讓總務確認主檔和現場設備是否一致。'
    : '請拍到 QR 標籤貼在設備哪裡，讓之後維修人員能快速找到。';
}

function requestActionTitle(request: ServiceRequest) {
  if (request.main_status === 'WAITING_STORE_SUPPLEMENT') return '總務需要你補充資料';
  if (request.main_status === 'WAITING_STORE_CONFIRMATION') return '請確認這件事是否已完成';
  if (request.main_status === 'WAITING_GA_REVIEW') return '已送出補充資料，等待總務複核';
  if (request.main_status === 'PENDING_INTAKE') return '已送出，等待總務接手';
  if (request.main_status === 'ACCEPTED') return '總務已接手';
  if (request.main_status === 'IN_PROGRESS') return '正在準備物品或安排處理';
  if (request.main_status === 'COMPLETED') return '這件事已完成';
  if (request.main_status === 'REJECTED') return '這件事已被駁回';
  return STATUS_LABELS[request.main_status] || request.main_status;
}

function requestActionDescription(request: ServiceRequest) {
  if (request.main_status === 'WAITING_STORE_SUPPLEMENT') {
    return request.supplement_note || '請依總務要求補充說明或照片，送出後會回到總務複核。';
  }
  if (request.main_status === 'WAITING_STORE_CONFIRMATION') return '如果結果符合現場需求，請按確認完成；若不符合，請回報問題原因。';
  if (request.main_status === 'WAITING_GA_REVIEW') return '你已完成門市端回覆，目前不需要再操作。';
  if (request.main_status === 'PENDING_INTAKE') return '總務尚未接手，接手後會自動更新進度。';
  if (request.main_status === 'ACCEPTED') return '總務已接手處理，目前門市不用操作。';
  if (request.main_status === 'IN_PROGRESS') return '總務正在準備物品或安排處理，目前門市不用操作。';
  if (request.main_status === 'COMPLETED') return '此追蹤事項已完成，可在下方查看處理紀錄與附件。';
  if (request.main_status === 'REJECTED') return request.rejection_note || request.rejection_reason || '請查看下方駁回原因。';
  return storeFacingProgressText(request);
}

function hasInternalProgressTerms(value?: string | null) {
  if (!value) return false;
  return ['承辦角色', '後續處理方式', '維修工單', '工單中心', '派工與處理進度'].some((term) => value.includes(term));
}

function storeFacingProgressText(request: ServiceRequest) {
  const progress = request.public_progress?.trim();
  if (progress && !hasInternalProgressTerms(progress)) return progress;
  if (request.main_status === 'PENDING_INTAKE') return '已送出，等待總務接手。';
  if (request.main_status === 'WAITING_STORE_SUPPLEMENT') return request.supplement_note || '總務需要你補充資料，補完後會再繼續處理。';
  if (request.main_status === 'WAITING_GA_REVIEW') return '你已送出補充資料，等待總務確認。';
  if (request.main_status === 'ACCEPTED') return '總務已接手，正在安排後續處理。';
  if (request.main_status === 'IN_PROGRESS') return '總務正在準備物品或安排處理，有新進度會更新在這裡。';
  if (request.main_status === 'WAITING_STORE_CONFIRMATION') return '總務已送出，請門市確認收貨或現場結果。';
  if (request.main_status === 'COMPLETED') return '門市已確認完成。';
  if (request.main_status === 'REJECTED') return request.rejection_note || request.rejection_reason || '總務已駁回這件需求。';
  if (request.main_status === 'CANCELED') return '這件需求已取消。';
  return progress || '有新進度會更新在這裡。';
}

function storeFacingStatusLabel(status: string) {
  if (status === 'ACCEPTED') return '總務已接手';
  if (status === 'IN_PROGRESS') return '正在準備物品';
  if (status === 'PENDING_INTAKE') return '等待總務接手';
  if (status === 'WAITING_STORE_CONFIRMATION') return '待你確認';
  return STATUS_LABELS[status] || status;
}

function storeResponsibilitySummary(request: ServiceRequest) {
  if (request.main_status === 'WAITING_STORE_SUPPLEMENT') {
    return {
      label: '現在等你',
      title: '請補充資料',
      description: request.supplement_note || '總務需要你補上說明或照片，送出後會回到總務複核。',
      tone: 'border-orange-200 bg-orange-50 text-orange-900',
    };
  }
  if (request.main_status === 'WAITING_STORE_CONFIRMATION') {
    return {
      label: '現在等你',
      title: '請確認現場結果',
      description: '如果現場已完成就確認完成；如果還有問題，請回報原因或補照片。',
      tone: 'border-orange-200 bg-orange-50 text-orange-900',
    };
  }
  if (request.main_status === 'WAITING_GA_REVIEW') {
    return {
      label: '現在等總務',
      title: '等待總務複核',
      description: '你已送出補充資料，目前不用再操作。',
      tone: 'border-blue-200 bg-blue-50 text-blue-900',
    };
  }
  if (['PENDING_INTAKE', 'ACCEPTED', 'IN_PROGRESS'].includes(request.main_status)) {
    return {
      label: '現在等總務',
      title: request.main_status === 'PENDING_INTAKE' ? '等待總務接手' : '正在準備物品或安排處理',
      description: '目前門市不用操作，有新進度會更新在這裡。',
      tone: 'border-blue-200 bg-blue-50 text-blue-900',
    };
  }
  if (request.main_status === 'COMPLETED') {
    return {
      label: '已完成',
      title: '這件事已完成',
      description: '可在下方查看處理紀錄與附件。',
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    };
  }
  if (request.main_status === 'REJECTED') {
    return {
      label: '已駁回',
      title: '請查看駁回原因',
      description: request.rejection_note || request.rejection_reason || '總務已駁回這件需求。',
      tone: 'border-red-200 bg-red-50 text-red-900',
    };
  }
  return {
    label: '目前狀態',
    title: storeFacingStatusLabel(request.main_status),
    description: storeFacingProgressText(request),
    tone: 'border-slate-200 bg-slate-50 text-slate-800',
  };
}

function intakeRouteLabel(value?: string | null) {
  if (value === 'REPAIR_DISPATCH') return '維修派工';
  if (value === 'PURCHASE_REVIEW') return '採購評估';
  if (value === 'STOCK_ISSUE') return '庫存出庫';
  if (value === 'TRANSFER') return '調撥處理';
  if (value === 'ASSET_TASK') return '資產建檔或異動';
  return '總務評估中';
}

function assigneeRoleLabel(value?: string | null) {
  if (value === 'GENERAL_AFFAIRS') return '總務';
  if (value === 'WORKS') return '工務';
  return '總務';
}

function assigneeDisplay(request: ServiceRequest) {
  return [assigneeRoleLabel(request.assignee_role), request.assignee_name].filter(Boolean).join(' / ');
}

function visibilityLabel(value?: string | null) {
  return value === 'INTERNAL' ? '內部' : '公開';
}

function statusHint(status: string) {
  if (status === 'WAITING_STORE_SUPPLEMENT') return '需要門市補資料後，總務才會繼續複核。';
  if (status === 'WAITING_GA_REVIEW') return '門市已補資料，等待總務複核。';
  if (status === 'ACCEPTED') return '總務已接手，後續安排會自動更新到這裡。';
  if (status === 'IN_PROGRESS') return '總務正在準備物品或安排處理，有需要門市配合時會顯示在待我處理。';
  if (status === 'WAITING_STORE_CONFIRMATION') return '總務已處理到等待門市確認的階段。';
  if (status === 'REJECTED') return '此需求已被駁回，請查看駁回原因。';
  if (status === 'CANCELED') return '此需求已取消。';
  return '';
}

function RequestProgressBar({ status }: { status: string }) {
  const progress = getProgressInfo(status);
  const hint = statusHint(status);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-slate-500">目前進度</div>
        <div className={`text-xs font-semibold ${progress.isTerminalProblem ? 'text-red-600' : 'text-orange-700'}`}>
          {STATUS_LABELS[status] || status}
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${progress.isTerminalProblem ? 'bg-red-500' : 'bg-orange-500'}`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1">
        {PROGRESS_STEPS.map((step, index) => {
          const reached = !progress.isTerminalProblem && index <= progress.activeIndex;
          return (
            <div key={step.key} className="min-w-0 text-center">
              <div className={`mx-auto h-3 w-3 rounded-full border ${reached ? 'border-orange-500 bg-orange-500' : 'border-slate-300 bg-white'}`} />
              <div className={`mt-1 truncate text-[11px] font-medium ${reached ? 'text-orange-700' : 'text-slate-400'}`}>{step.label}</div>
            </div>
          );
        })}
      </div>
      {hint && <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{hint}</p>}
    </div>
  );
}

function AssetTaskProgressBar({ task }: { task: EquipmentOnboardingTask }) {
  const currentIndex = task.task_type === 'EQUIPMENT_PHOTO' ? 0 : 1;
  const percent = ASSET_TASK_PROGRESS[task.task_type] || 25;
  const currentAction = task.task_type === 'EQUIPMENT_PHOTO' ? '先補設備照片' : '補貼標位置照片';

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-500">建檔 / 貼標進度</div>
          <div className="mt-1 text-sm font-black text-slate-900">{currentAction}</div>
        </div>
        <div className="rounded-full bg-blue-100 px-2 py-1 text-xs font-black text-blue-700">
          {task.task_type === 'EQUIPMENT_PHOTO' ? '待設備照片' : '待貼標照片'}
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1">
        {ASSET_TASK_STEPS.map((step, index) => {
          const completed = index < currentIndex;
          const isCurrent = index === currentIndex;
          return (
            <div key={step.key} className="min-w-0 text-center">
              <div
                className={`mx-auto h-3 w-3 rounded-full border ${
                  completed
                    ? 'border-blue-500 bg-blue-500'
                    : isCurrent
                      ? 'border-blue-500 bg-white ring-4 ring-blue-100'
                      : 'border-slate-300 bg-white'
                }`}
              />
              <div className={`mt-1 truncate text-[11px] font-medium ${completed || isCurrent ? 'text-blue-700' : 'text-slate-400'}`}>{step.label}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs font-semibold leading-5 text-blue-800">
        完成上傳後，總務會接著確認照片。
      </p>
    </div>
  );
}

async function parseResponse(response: Response, fallback: string) {
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.success === false) {
    throw new Error(json?.error || fallback);
  }
  return json;
}

export default function ServiceRequestMyReportsClient() {
  const searchParams = useSearchParams();
  const statusFromUrl = searchParams.get('status') || '';
  const requestIdFromUrl = searchParams.get('requestId') || '';
  const hasStatusFromUrl = STATUS_FILTERS.some((filter) => filter.value === statusFromUrl && statusFromUrl !== '');
  const initialStatus = hasStatusFromUrl ? statusFromUrl : 'WAITING_STORE_CONFIRMATION';
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [assetTasks, setAssetTasks] = useState<EquipmentOnboardingTask[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedKind, setSelectedKind] = useState<'request' | 'asset_task'>('request');
  const [status, setStatus] = useState(initialStatus);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingAssetTasks, setLoadingAssetTasks] = useState(true);
  const [attachments, setAttachments] = useState<RequestAttachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<RequestAttachment | null>(null);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [comments, setComments] = useState<RequestComment[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState('');
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [commentMutatingId, setCommentMutatingId] = useState('');
  const [showCommentComposer, setShowCommentComposer] = useState(false);
  const [showFullTimeline, setShowFullTimeline] = useState(false);
  const [storeActionNote, setStoreActionNote] = useState('');
  const [storeActionFiles, setStoreActionFiles] = useState<File[]>([]);
  const [storeSubmitting, setStoreSubmitting] = useState(false);
  const storeActionNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const [assetTaskFile, setAssetTaskFile] = useState<File | null>(null);
  const [assetTaskUploading, setAssetTaskUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [deepLinkNotice, setDeepLinkNotice] = useState('');
  const [deepLinkResolvedNotice, setDeepLinkResolvedNotice] = useState('');
  const [storeActionResult, setStoreActionResult] = useState<StoreActionResult | null>(null);
  const autoSelectedActionStatusRef = useRef(hasStatusFromUrl);
  const detailPanelRef = useRef<HTMLElement | null>(null);

  const clearDeepLinkNotices = () => {
    setDeepLinkNotice('');
    setDeepLinkResolvedNotice('');
  };

  const setTrackingStatus = (nextStatus: string) => {
    clearDeepLinkNotices();
    setStatus(nextStatus);
  };

  const openTrackingItem = (kind: 'request' | 'asset_task', id: string, options?: { scrollToDetail?: boolean; keepDeepLinkNotice?: boolean }) => {
    if (!options?.keepDeepLinkNotice) clearDeepLinkNotices();
    setSelectedKind(kind);
    setSelectedId(id);
    setShowCommentComposer(false);
    setCommentBody('');
    setCommentFiles([]);
    if (options?.scrollToDetail) {
      requestAnimationFrame(() => detailPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const trackingItems = useMemo<TrackingItem[]>(() => {
    const requestItems: TrackingItem[] = requests.map((request) => ({
      kind: 'request',
      id: request.id,
      status: request.main_status,
      updated_at: request.updated_at || request.created_at,
      searchable: [
        request.request_no,
        request.title,
        request.description,
        request.public_progress,
        storeLabel(request),
        resourceLabel(request),
      ].filter(Boolean).join(' ').toLowerCase(),
      request,
    }));

    const taskItems: TrackingItem[] = assetTasks.map((task) => ({
      kind: 'asset_task',
      id: task.id,
      status: 'WAITING_STORE_SUPPLEMENT',
      updated_at: task.updated_at,
      searchable: [
        task.title,
        task.equipment.name,
        task.equipment.asset_code,
        taskStoreLabel(task),
        taskLocationLabel(task),
      ].filter(Boolean).join(' ').toLowerCase(),
      task,
    }));

    return [...requestItems, ...taskItems]
      .filter((item) => {
        if (!status) return true;
        if (status === 'PROCESSING_GROUP') return ['PENDING_INTAKE', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_GA_REVIEW'].includes(item.status);
        return item.status === status;
      })
      .filter((item) => !search.trim() || item.searchable.includes(search.trim().toLowerCase()))
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [assetTasks, requests, search, status]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { '': requests.length + assetTasks.length };
    requests.forEach((request) => {
      counts[request.main_status] = (counts[request.main_status] || 0) + 1;
    });
    counts.WAITING_STORE_SUPPLEMENT = (counts.WAITING_STORE_SUPPLEMENT || 0) + assetTasks.length;
    return counts;
  }, [assetTasks.length, requests]);
  const storeSummary = useMemo(() => ({
    actionRequired: (statusCounts.WAITING_STORE_SUPPLEMENT || 0) + (statusCounts.WAITING_STORE_CONFIRMATION || 0),
    supplement: statusCounts.WAITING_STORE_SUPPLEMENT || 0,
    confirmation: statusCounts.WAITING_STORE_CONFIRMATION || 0,
    processing: (statusCounts.PENDING_INTAKE || 0) + (statusCounts.ACCEPTED || 0) + (statusCounts.IN_PROGRESS || 0) + (statusCounts.WAITING_GA_REVIEW || 0),
    total: statusCounts[''] || 0,
  }), [statusCounts]);
  const currentTrackingListTitle = status === 'PROCESSING_GROUP'
    ? '等總務處理'
    : STATUS_FILTERS.find((filter) => filter.value === status)?.label || '全部追蹤';
  const trackingEmptyMessage = search.trim()
    ? '找不到符合搜尋的追蹤事項'
    : `目前沒有${currentTrackingListTitle}的事項`;
  const selectedRequest = useMemo(
    () => selectedKind === 'request' ? requests.find((request) => request.id === selectedId) || null : null,
    [requests, selectedId, selectedKind],
  );
  const selectedAssetTask = useMemo(
    () => selectedKind === 'asset_task' ? assetTasks.find((task) => task.id === selectedId) || null : null,
    [assetTasks, selectedId, selectedKind],
  );

  useEffect(() => {
    if (!hasStatusFromUrl) return;
    autoSelectedActionStatusRef.current = true;
    setStatus(statusFromUrl);
  }, [hasStatusFromUrl, statusFromUrl]);

  useEffect(() => {
    if (!requestIdFromUrl || loading || loadingAssetTasks) return;
    const linkedRequest = requests.find((request) => request.id === requestIdFromUrl);
    if (!linkedRequest) {
      setDeepLinkNotice('原本點選的總務事項目前看不到，可能已完成、已改狀態，或你目前沒有權限查看；系統已改顯示目前可處理的追蹤事項。');
      setDeepLinkResolvedNotice('');
      return;
    }
    setDeepLinkNotice('');
    setDeepLinkResolvedNotice(`已開啟你從首頁點選的待辦：${linkedRequest.request_no}｜${linkedRequest.title}`);
    autoSelectedActionStatusRef.current = true;
    setStatus(hasStatusFromUrl ? statusFromUrl : linkedRequest.main_status);
    openTrackingItem('request', linkedRequest.id, { scrollToDetail: true, keepDeepLinkNotice: true });
  }, [hasStatusFromUrl, loading, loadingAssetTasks, requestIdFromUrl, requests, statusFromUrl]);

  useEffect(() => {
    if (loading || loadingAssetTasks || autoSelectedActionStatusRef.current) return;
    autoSelectedActionStatusRef.current = true;
    if (storeSummary.confirmation > 0) {
      setStatus('WAITING_STORE_CONFIRMATION');
      return;
    }
    if (storeSummary.supplement > 0) {
      setStatus('WAITING_STORE_SUPPLEMENT');
      return;
    }
    if (storeSummary.processing > 0) {
      setStatus('PROCESSING_GROUP');
      return;
    }
    setStatus('');
  }, [loading, loadingAssetTasks, storeSummary.confirmation, storeSummary.processing, storeSummary.supplement]);
  const publicTimelineItems = useMemo(() => {
    const eventItems = events
      .filter((event) => event.visibility !== 'INTERNAL')
      .map((event) => ({
        kind: 'event' as const,
        id: event.id,
        title: event.title,
        body: event.description || '',
        actor: event.created_by_name,
        created_at: event.created_at,
        visibility: event.visibility,
      }));
    const commentItems = comments
      .filter((comment) => comment.visibility !== 'INTERNAL')
      .map((comment) => ({
        kind: 'comment' as const,
        id: comment.id,
        title: '留言',
        body: comment.body,
        actor: comment.created_by_name,
        created_at: comment.created_at,
        visibility: comment.visibility,
      }));

    return [...eventItems, ...commentItems].sort((a, b) => (
      new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime()
    ));
  }, [comments, events]);
  const latestTimelineItems = publicTimelineItems.slice(0, 1);

  async function loadRequests() {
    setError('');
    setNotice('');
    try {
      const params = new URLSearchParams({ pageSize: '200', sort: 'updated_at', sortOrder: 'desc' });
      const json = await parseResponse(await fetch(`/api/general-affairs/requests?${params.toString()}`), '我的追蹤載入失敗');
      const next = (json.data || []) as ServiceRequest[];
      setRequests(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '我的追蹤載入失敗');
    }
  }

  async function loadAssetTasks() {
    setError('');
    try {
      const json = await parseResponse(
        await fetch('/api/general-affairs/equipment/store-onboarding-tasks'),
        '設備待辦載入失敗',
      );
      setAssetTasks((json.data || []) as EquipmentOnboardingTask[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '設備待辦載入失敗');
    }
  }

  async function refreshTracking() {
    setLoading(true);
    setLoadingAssetTasks(true);
    await Promise.all([
      loadRequests().finally(() => setLoading(false)),
      loadAssetTasks().finally(() => setLoadingAssetTasks(false)),
    ]);
  }

  async function loadAttachmentsForRequest(requestId: string) {
    setLoadingAttachments(true);
    try {
      const params = new URLSearchParams({
        resourceType: 'SERVICE_REQUEST',
        resourceId: requestId,
      });
      const json = await parseResponse(
        await fetch(`/api/general-affairs/attachments?${params.toString()}`),
        '附件載入失敗',
      );
      setAttachments((json.data || []) as RequestAttachment[]);
    } catch (loadError) {
      setAttachments([]);
      setError(loadError instanceof Error ? loadError.message : '附件載入失敗');
    } finally {
      setLoadingAttachments(false);
    }
  }

  async function loadTimelineForRequest(requestId: string) {
    setLoadingTimeline(true);
    try {
      const json = await parseResponse(
        await fetch(`/api/general-affairs/requests/${requestId}`),
        '需求紀錄載入失敗',
      );
      setEvents((json.events || []) as RequestEvent[]);
      setComments((json.comments || []) as RequestComment[]);
    } catch (loadError) {
      setEvents([]);
      setComments([]);
      setError(loadError instanceof Error ? loadError.message : '需求紀錄載入失敗');
    } finally {
      setLoadingTimeline(false);
    }
  }

  async function submitComment() {
    if (!selectedRequest || commentSubmitting || !commentBody.trim()) return;
    setCommentSubmitting(true);
    setError('');
    setNotice('');
    try {
      const json = await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: commentBody,
            visibility: 'PUBLIC',
            source_context: 'STORE_TRACKING',
          }),
        }),
        '留言新增失敗',
      );
      const commentId = json.data?.id;
      if (commentId && commentFiles.length > 0) {
        const formData = new FormData();
        formData.set('resource_type', 'SERVICE_REQUEST_COMMENT');
        formData.set('resource_id', commentId);
        formData.set('purpose', 'PUBLIC_COMMENT');
        commentFiles.forEach((file) => formData.append('files', file));
        await parseResponse(
          await fetch('/api/general-affairs/attachments', {
            method: 'POST',
            body: formData,
          }),
          '留言附件上傳失敗',
        );
      }
      setNotice('留言已送出');
      setCommentBody('');
      setCommentFiles([]);
      setShowCommentComposer(false);
      await loadTimelineForRequest(selectedRequest.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '留言新增失敗');
    } finally {
      setCommentSubmitting(false);
    }
  }

  function startEditComment(comment: RequestComment) {
    setEditingCommentId(comment.id);
    setEditingCommentBody(comment.body);
    setError('');
    setNotice('');
  }

  async function updateComment(commentId: string) {
    if (!selectedRequest || commentMutatingId || !editingCommentBody.trim()) return;
    setCommentMutatingId(commentId);
    setError('');
    setNotice('');
    try {
      await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/comments/${commentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: editingCommentBody }),
        }),
        '留言編輯失敗',
      );
      setEditingCommentId('');
      setEditingCommentBody('');
      setNotice('留言已更新');
      await loadTimelineForRequest(selectedRequest.id);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '留言編輯失敗');
    } finally {
      setCommentMutatingId('');
    }
  }

  async function deleteComment(commentId: string) {
    if (!selectedRequest || commentMutatingId) return;
    if (!window.confirm('確定要刪除此留言？')) return;
    setCommentMutatingId(commentId);
    setError('');
    setNotice('');
    try {
      await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/comments/${commentId}`, {
          method: 'DELETE',
        }),
        '留言刪除失敗',
      );
      if (editingCommentId === commentId) {
        setEditingCommentId('');
        setEditingCommentBody('');
      }
      setNotice('留言已刪除');
      await loadTimelineForRequest(selectedRequest.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '留言刪除失敗');
    } finally {
      setCommentMutatingId('');
    }
  }

  async function uploadStoreActionAttachments(requestId: string, purpose: string) {
    if (storeActionFiles.length === 0) return;

    const formData = new FormData();
    formData.set('resource_type', 'SERVICE_REQUEST');
    formData.set('resource_id', requestId);
    formData.set('purpose', purpose);
    storeActionFiles.forEach((file) => formData.append('files', file));

    await parseResponse(
      await fetch('/api/general-affairs/attachments', {
        method: 'POST',
        body: formData,
      }),
      '附件上傳失敗',
    );
  }

  async function submitStoreAction(action: StoreAction) {
    if (!selectedRequest) return;
    const note = storeActionNote.trim();
    if ((action === 'submit_supplement' || action === 'report_problem') && !note) {
      const message = action === 'submit_supplement'
        ? '請先填寫補充資料說明'
        : '請先填寫哪裡還沒完成或哪裡不符合預期';
      alert(message);
      setError(message);
      requestAnimationFrame(() => {
        storeActionNoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        storeActionNoteRef.current?.focus();
      });
      return;
    }

    setStoreSubmitting(true);
    setError('');
    setNotice('');
    setStoreActionResult(null);
    try {
      const json = await parseResponse(
        await fetch(`/api/general-affairs/requests/${selectedRequest.id}/store-actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, note }),
        }),
        '門市回覆失敗',
      );

      const purpose = action === 'submit_supplement'
        ? 'STORE_SUPPLEMENT'
        : action === 'confirm_complete'
          ? 'COMPLETION_CONFIRMATION'
          : 'COMPLETION_PROBLEM';
      await uploadStoreActionAttachments(selectedRequest.id, purpose);

      setRequests((current) => current.map((item) => (
        item.id === selectedRequest.id ? { ...item, ...(json.data || {}) } : item
      )));
      setStoreActionNote('');
      setStoreActionFiles([]);
      const result: StoreActionResult = action === 'confirm_complete'
        ? {
          tone: 'emerald',
          title: '已確認完成',
          body: '這件總務事項已完成，會移到已完成紀錄，不會再出現在待我確認。',
          actionLabel: '查看已完成',
          statusValue: 'COMPLETED',
        }
        : action === 'report_problem'
          ? {
            tone: 'orange',
            title: '已回報問題',
            body: '這件事已退回總務重新處理，後續進度會回到我的追蹤更新。',
            actionLabel: '查看等總務處理',
            statusValue: 'PROCESSING_GROUP',
          }
          : {
            tone: 'blue',
            title: '已送出補充資料',
            body: '補充內容已交給總務確認，目前門市不用再操作。',
            actionLabel: '查看等待總務複核',
            statusValue: 'WAITING_GA_REVIEW',
          };
      setNotice(result.title);
      setStoreActionResult(result);
      setStatus(result.statusValue);
      await loadAttachmentsForRequest(selectedRequest.id);
      await loadTimelineForRequest(selectedRequest.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '門市回覆失敗');
    } finally {
      setStoreSubmitting(false);
    }
  }

  async function submitAssetTaskPhoto(task: EquipmentOnboardingTask) {
    if (!assetTaskFile) {
      setError('請先選擇要上傳的照片');
      return;
    }

    setAssetTaskUploading(true);
    setError('');
    setNotice('');
    try {
      const formData = new FormData();
      formData.set('equipment_id', task.equipment.id);
      formData.set('purpose', task.task_type === 'EQUIPMENT_PHOTO' ? 'PRIMARY_IMAGE' : 'LABEL_POSITION_IMAGE');
      formData.set('file', assetTaskFile);
      const json = await parseResponse(
        await fetch('/api/general-affairs/equipment/store-onboarding-tasks', {
          method: 'POST',
          body: formData,
        }),
        '照片上傳失敗',
      );
      setAssetTasks((json.data || []) as EquipmentOnboardingTask[]);
      setAssetTaskFile(null);
      setNotice('照片已上傳，系統已更新下一步待辦。');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '照片上傳失敗');
    } finally {
      setAssetTaskUploading(false);
    }
  }

  useEffect(() => {
    void refreshTracking();
  }, []);

  useEffect(() => {
    if (requestIdFromUrl && requests.some((request) => request.id === requestIdFromUrl)) return;
    if (selectedId && trackingItems.some((item) => item.kind === selectedKind && item.id === selectedId)) return;
    const first = trackingItems[0];
    setSelectedKind(first?.kind || 'request');
    setSelectedId(first?.id || '');
  }, [requestIdFromUrl, requests, selectedId, selectedKind, trackingItems]);

  useEffect(() => {
    if (!selectedRequest?.id) {
      setAttachments([]);
      setPreviewAttachment(null);
      setEvents([]);
      setComments([]);
      setEditingCommentId('');
      setEditingCommentBody('');
      return;
    }

    setStoreActionNote('');
    setStoreActionFiles([]);
    setAssetTaskFile(null);
    setCommentBody('');
    setCommentFiles([]);
    setEditingCommentId('');
    setEditingCommentBody('');
    setShowFullTimeline(false);
    setNotice('');
    void loadAttachmentsForRequest(selectedRequest.id);
    void loadTimelineForRequest(selectedRequest.id);
  }, [selectedRequest?.id]);

  useEffect(() => {
    if (!previewAttachment) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPreviewAttachment(null);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewAttachment]);

  return (
    <div className="mx-auto max-w-7xl">
      <GeneralAffairsPageHeader
        breadcrumbs={[
          { label: '總務服務中心', href: '/general-affairs' },
          { label: '我的追蹤' },
        ]}
        title="我的追蹤"
        description="查看總務進度與門市待辦。"
        primaryAction={(
          <a
            href="/general-affairs/reports/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-orange-700"
          >
            <ClipboardList className="h-4 w-4" />
            新增需求
          </a>
        )}
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {deepLinkNotice && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{deepLinkNotice}</span>
        </div>
      )}
      {deepLinkResolvedNotice && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{deepLinkResolvedNotice}</span>
        </div>
      )}
      {storeActionResult && (
        <div className={`mb-4 rounded-md border p-4 shadow-sm ${
          storeActionResult.tone === 'emerald'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : storeActionResult.tone === 'orange'
              ? 'border-orange-200 bg-orange-50 text-orange-900'
              : 'border-blue-200 bg-blue-50 text-blue-900'
        }`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <div className="text-base font-black">{storeActionResult.title}</div>
                <p className="mt-1 text-sm font-semibold leading-6 opacity-85">{storeActionResult.body}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTrackingStatus(storeActionResult.statusValue)}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-white px-3 text-xs font-black shadow-sm ring-1 ring-current/15 hover:bg-white/80"
            >
              {storeActionResult.actionLabel}
            </button>
          </div>
        </div>
      )}

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            statusValue: 'WAITING_STORE_CONFIRMATION',
            title: '待我確認',
            value: storeSummary.confirmation,
            icon: CheckCircle2,
            tone: 'emerald',
          },
          {
            statusValue: 'WAITING_STORE_SUPPLEMENT',
            title: '待我補資料',
            value: storeSummary.supplement,
            icon: MessageSquare,
            tone: 'orange',
          },
          {
            statusValue: 'PROCESSING_GROUP',
            title: '等總務處理',
            value: storeSummary.processing,
            icon: Timer,
            tone: 'blue',
          },
          {
            statusValue: '',
            title: '全部追蹤',
            value: storeSummary.total,
            icon: ClipboardList,
            tone: 'slate',
          },
        ].map((item) => {
          const Icon = item.icon;
          const active = status === item.statusValue;
          const toneClass = item.tone === 'orange'
            ? active ? 'border-orange-400 bg-orange-50 text-orange-900' : 'border-orange-100 bg-orange-50/50 text-orange-900 hover:bg-orange-50'
            : item.tone === 'emerald'
              ? active ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : 'border-emerald-100 bg-emerald-50/50 text-emerald-900 hover:bg-emerald-50'
              : item.tone === 'blue'
                ? active ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-blue-100 bg-blue-50/50 text-blue-900 hover:bg-blue-50'
                : active ? 'border-slate-400 bg-slate-50 text-slate-900' : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100';
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => setTrackingStatus(item.statusValue)}
              className={`min-h-20 rounded-md border p-3 text-left transition ${toneClass}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black">{item.title}</div>
                  <div className="mt-1 text-2xl font-black leading-none">{item.value}</div>
                </div>
                <span className="rounded-md bg-white/80 p-1.5 shadow-sm">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer list-none text-sm font-black text-slate-800">
              更多篩選
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {STATUS_FILTERS
                .filter((filter) => filter.value !== 'WAITING_STORE_CONFIRMATION' && filter.value !== 'WAITING_STORE_SUPPLEMENT')
                .map((filter) => {
                  const isSelected = status === filter.value;
                  return (
                    <button
                      key={filter.value || 'all'}
                      type="button"
                      onClick={() => setTrackingStatus(filter.value)}
                      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${isSelected ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      <span>{filter.label}</span>
                      <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] ${isSelected ? 'bg-orange-200 text-orange-800' : 'bg-slate-100 text-slate-500'}`}>
                        {statusCounts[filter.value] || 0}
                      </span>
                    </button>
                  );
                })}
            </div>
          </details>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(event) => {
                clearDeepLinkNotices();
                setSearch(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  clearDeepLinkNotices();
                  void refreshTracking();
                }
              }}
              className="h-9 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 lg:w-64"
              placeholder="搜尋單號、設備、門市"
            />
            <button
              type="button"
              aria-label="查詢追蹤事項"
              onClick={() => {
                clearDeepLinkNotices();
                void refreshTracking();
              }}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-800"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="text-sm font-black text-slate-800">{currentTrackingListTitle}</div>
            <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">
              {trackingItems.length} 件
            </div>
          </div>
          {loading || loadingAssetTasks ? (
            <div className="flex h-44 items-center justify-center gap-2 text-sm text-slate-500">
              <RefreshCw className="h-4 w-4 animate-spin" />
              載入中
            </div>
          ) : trackingItems.length === 0 ? (
            <div className="flex h-44 items-center justify-center text-sm text-slate-500">{trackingEmptyMessage}</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {trackingItems.map((item) => {
                if (item.kind === 'asset_task') {
                  const task = item.task;
                  const selected = selectedKind === 'asset_task' && selectedId === task.id;
                  const progress = ASSET_TASK_PROGRESS[task.task_type] || 25;
                  return (
                    <button
                      key={`asset-${task.id}`}
                      type="button"
                      onClick={() => openTrackingItem('asset_task', task.id, { scrollToDetail: true })}
                      className={`grid w-full gap-3 px-4 py-3 text-left hover:bg-orange-50 md:grid-cols-[76px_1fr_96px] ${selected ? 'bg-orange-50' : 'bg-white'}`}
                    >
                      <div className="relative h-16 w-16 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        {task.equipment.image?.signed_url ? (
                          <img
                            src={task.equipment.image.signed_url}
                            alt={task.equipment.image.file_name || task.equipment.name || '設備照片'}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full w-full place-items-center text-blue-600">
                            <Upload className="h-7 w-7" />
                          </div>
                        )}
                        <span className="absolute bottom-1 left-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-black text-blue-700 shadow-sm">設備</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                            <Upload className="h-3 w-3" />
                            設備建檔
                          </span>
                          <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">待我處理</span>
                          <span className="font-mono text-xs font-semibold text-slate-400">{task.equipment.asset_code || '尚未編號'}</span>
                        </div>
                        <div className="mt-1 truncate text-sm font-black text-slate-950">
                          {taskStoreLabel(task)} / {task.equipment.name || '未命名設備'}
                        </div>
                        <div className="mt-1 truncate text-xs font-semibold leading-5 text-slate-500">{taskLocationLabel(task)}</div>
                        {task.equipment.onboarding_review_note && (
                          <div className="mt-2 line-clamp-2 rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs leading-5 text-red-700">
                            總務退回原因：{task.equipment.onboarding_review_note}
                          </div>
                        )}
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                      <div className="text-xs font-black text-blue-700 md:text-right">{assetTaskActionTitle(task)}</div>
                    </button>
                  );
                }

                const request = item.request;
                const selected = selectedKind === 'request' && selectedRequest?.id === request.id;
                const itemTitle = `${storeLabel(request)} / ${requestItemTitle(request)}`;
                const sceneDescription = requestListSceneDescription(request);
                return (
                  <button
                    key={`request-${request.id}`}
                    type="button"
                    onClick={() => openTrackingItem('request', request.id, { scrollToDetail: true })}
                    className={`w-full px-4 py-3 text-left hover:bg-orange-50 ${selected ? 'bg-orange-50' : 'bg-white'}`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                          {storeFacingStatusLabel(request.main_status)}
                        </span>
                        <span className="shrink-0 font-mono text-xs font-semibold text-slate-400">{request.request_no}｜{formatDateTime(request.created_at)}</span>
                      </div>
                      <div className="mt-1 truncate text-sm font-black text-slate-950">{itemTitle}</div>
                      <div className="mt-1 truncate text-xs font-semibold leading-5 text-slate-500">
                        {sceneDescription}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside ref={detailPanelRef} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          {!selectedRequest && !selectedAssetTask ? (
            <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
              <div>
                <ClipboardList className="mx-auto h-8 w-8 text-slate-400" />
                <div className="mt-3 text-base font-black text-slate-800">從左側選一張單</div>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
                  選取後會看到現在要做什麼、最新回覆與照片附件。
                </p>
              </div>
            </div>
          ) : selectedAssetTask ? (
            <div>
              <div className="font-mono text-xs font-semibold text-slate-500">{selectedAssetTask.equipment.asset_code || '尚未編號'}</div>
              <h2 className="mt-1 text-lg font-black text-slate-950">{taskStoreLabel(selectedAssetTask)}</h2>
              <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-slate-600">
                {selectedAssetTask.equipment.name || '未命名設備'} / {taskLocationLabel(selectedAssetTask)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">待我處理</span>
                <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">設備建檔</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{assetTaskActionTitle(selectedAssetTask)}</span>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
                  <div className="flex items-start gap-3">
                    <Upload className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-black text-orange-700">現在要做</div>
                      <div className="text-base font-semibold text-orange-950">{assetTaskActionTitle(selectedAssetTask)}</div>
                      <p className="mt-1 text-sm leading-6 text-orange-800">{assetTaskActionDescription(selectedAssetTask)}</p>
                    </div>
                  </div>
                  {selectedAssetTask.equipment.onboarding_review_note && (
                    <div className="mt-3 rounded-md border border-red-200 bg-white px-3 py-2 text-sm leading-6 text-red-700">
                      <div className="text-xs font-semibold">總務退回原因</div>
                      <div className="mt-1 whitespace-pre-wrap">{selectedAssetTask.equipment.onboarding_review_note}</div>
                    </div>
                  )}
                  <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-orange-300 bg-white px-3 py-4 text-sm font-semibold text-orange-700 hover:bg-orange-50">
                    <Upload className="h-4 w-4" />
                    拍照 / 選照片
                    <input
                      key={`${selectedAssetTask.id}-${assetTaskFile?.name || 'empty'}`}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      className="hidden"
                      onChange={(event) => setAssetTaskFile(event.target.files?.[0] || null)}
                    />
                  </label>
                  {assetTaskFile && (
                    <div className="mt-2 rounded-md bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                      準備上傳：{assetTaskFile.name}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void submitAssetTaskPhoto(selectedAssetTask)}
                    disabled={assetTaskUploading || !assetTaskFile}
                    className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {assetTaskUploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {assetTaskUploading ? '上傳中' : '送給總務確認'}
                  </button>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="grid gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-500">設備</div>
                      <div className="mt-1 font-semibold text-slate-900">{selectedAssetTask.equipment.name || '未命名設備'}</div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-500">門市</div>
                        <div className="mt-1 text-slate-700">{taskStoreLabel(selectedAssetTask)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500">位置</div>
                        <div className="mt-1 text-slate-700">{taskLocationLabel(selectedAssetTask)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <AssetTaskProgressBar task={selectedAssetTask} />

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-slate-500">目前照片</div>
                    <div className={`rounded-full px-2 py-1 text-[11px] font-black ${selectedAssetTask.equipment.image?.signed_url ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {selectedAssetTask.equipment.image?.signed_url ? '已留存照片' : '還沒有照片'}
                    </div>
                  </div>
                  <div className="mt-2 flex min-h-40 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                    {selectedAssetTask.equipment.image?.signed_url ? (
                      <img
                        src={selectedAssetTask.equipment.image.signed_url}
                        alt={selectedAssetTask.equipment.image.file_name || selectedAssetTask.equipment.name || '設備照片'}
                        className="max-h-64 w-full object-contain"
                      />
                    ) : (
                      <div className="text-xs font-semibold text-slate-500">請先拍照或選照片</div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          ) : selectedRequest ? (
            <div>
              <div className="font-mono text-xs font-semibold text-slate-500">{selectedRequest.request_no}</div>
              <h2 className="mt-1 text-lg font-black text-slate-950">{storeLabel(selectedRequest)}</h2>
              <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-slate-600">
                {requestListSceneDescription(selectedRequest)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                  {storeFacingStatusLabel(selectedRequest.main_status)}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  {REQUEST_TYPE_LABELS[selectedRequest.request_type] || selectedRequest.request_type}
                </span>
                <span className="max-w-full truncate rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  {resourceLabel(selectedRequest)}
                </span>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                {(() => {
                  const responsibility = storeResponsibilitySummary(selectedRequest);
                  const ActionIcon = selectedRequest.main_status === 'COMPLETED'
                    ? CheckCircle2
                    : selectedRequest.main_status === 'REJECTED'
                      ? AlertCircle
                      : selectedRequest.main_status === 'WAITING_STORE_SUPPLEMENT' || selectedRequest.main_status === 'WAITING_STORE_CONFIRMATION'
                        ? MessageSquare
                        : Timer;
                  return (
                    <div className={`rounded-md border p-3 ${responsibility.tone}`}>
                      <div className="flex items-start gap-3">
                        <ActionIcon className="mt-0.5 h-5 w-5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-black opacity-75">{responsibility.label}</div>
                          <div className="mt-1 text-base font-black">{responsibility.title}</div>
                          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs font-semibold leading-5 opacity-80">{responsibility.description}</p>
                        </div>
                        {(selectedRequest.main_status === 'WAITING_STORE_SUPPLEMENT' || selectedRequest.main_status === 'WAITING_STORE_CONFIRMATION') && (
                          <button
                            type="button"
                            onClick={() => storeActionNoteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-white px-3 text-xs font-black text-orange-700 shadow-sm ring-1 ring-orange-100 hover:bg-orange-50"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            前往處理
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {selectedRequest.main_status === 'WAITING_STORE_CONFIRMATION' && (
                  <div className="rounded-md border border-orange-300 bg-orange-50 p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-black text-orange-950">確認結果</div>
                        <div className="mt-2 rounded-md border border-orange-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                          <div className="text-xs font-black text-orange-700">總務說</div>
                          <div className="mt-1 whitespace-pre-wrap">{storeFacingProgressText(selectedRequest)}</div>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => void submitStoreAction('confirm_complete')}
                            disabled={storeSubmitting}
                            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            完成
                          </button>
                          <button
                            type="button"
                            onClick={() => void submitStoreAction('report_problem')}
                            disabled={storeSubmitting}
                            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-red-600 px-3 text-sm font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            <AlertCircle className="h-4 w-4" />
                            有問題
                          </button>
                        </div>

                        <textarea
                          ref={storeActionNoteRef}
                          value={storeActionNote}
                          onChange={(event) => setStoreActionNote(event.target.value)}
                          rows={4}
                          className="mt-3 w-full rounded-md border border-orange-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                          placeholder="有問題才需要填原因；完成可不填"
                        />
                        <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-orange-300 bg-white px-3 py-3 text-sm font-semibold text-orange-700 hover:bg-orange-50">
                          <Paperclip className="h-4 w-4" />
                          上傳照片
                          <input
                            key={`${selectedRequest.id}-${storeActionFiles.length}`}
                            type="file"
                            multiple
                            accept="image/*,.pdf"
                            className="hidden"
                            onChange={(event) => setStoreActionFiles(Array.from(event.target.files || []))}
                          />
                        </label>
                        {storeActionFiles.length > 0 && (
                          <div className="mt-2 rounded-md bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                            已選擇 {storeActionFiles.length} 個附件：{storeActionFiles.map((file) => file.name).join('、')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <details className="rounded-md border border-slate-200 bg-white p-3">
                  <summary className="cursor-pointer list-none text-sm font-bold text-slate-900">
                    更多資訊
                  </summary>
                  <div className="mt-3 space-y-3">
                    <RequestProgressBar status={selectedRequest.main_status} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md bg-slate-50 p-3">
                        <div className="text-xs font-semibold text-slate-500">負責單位</div>
                        <div className="mt-1 font-semibold text-slate-950">{assigneeDisplay(selectedRequest)}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3">
                        <div className="text-xs font-semibold text-slate-500">建立時間</div>
                        <div className="mt-1 font-semibold text-slate-950">{formatDateTime(selectedRequest.created_at)}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-3 sm:col-span-2">
                        <div className="text-xs font-semibold text-slate-500">門市 / 標的</div>
                        <div className="mt-1 leading-5 text-slate-700">{storeLabel(selectedRequest)} / {resourceLabel(selectedRequest)}</div>
                      </div>
                    </div>
                    {selectedRequest.maintenance_request_id && (
                      <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                        總務已建立後續處理紀錄。
                      </div>
                    )}
                  </div>
                </details>
                {selectedRequest.main_status === 'WAITING_STORE_SUPPLEMENT' && (
                  <div className="rounded-md border border-orange-300 bg-orange-50 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-base font-black text-orange-950">
                        <MessageSquare className="h-4 w-4" />
                        補資料
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[11px] font-black text-orange-700">必填</span>
                    </div>
                    <textarea
                      ref={storeActionNoteRef}
                      value={storeActionNote}
                      onChange={(event) => setStoreActionNote(event.target.value)}
                      rows={4}
                      className="mt-2 w-full rounded-md border border-orange-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                      placeholder="直接寫總務要知道的補充內容"
                    />
                    <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-orange-300 bg-white px-3 py-3 text-sm font-semibold text-orange-700 hover:bg-orange-50">
                      <Paperclip className="h-4 w-4" />
                      加照片 / 附件
                      <input
                        key={`${selectedRequest.id}-${storeActionFiles.length}`}
                        type="file"
                        multiple
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(event) => setStoreActionFiles(Array.from(event.target.files || []))}
                      />
                    </label>
                    {storeActionFiles.length > 0 && (
                      <div className="mt-2 rounded-md bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                        已選擇 {storeActionFiles.length} 個附件：{storeActionFiles.map((file) => file.name).join('、')}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void submitStoreAction('submit_supplement')}
                      disabled={storeSubmitting}
                      className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Send className="h-4 w-4" />
                      送給總務
                    </button>
                  </div>
                )}
                {(loadingAttachments || attachments.length > 0) && (
                  <details className="rounded-md border border-slate-200 bg-white p-3">
                    <summary className="cursor-pointer list-none text-sm font-bold text-slate-900">
                      照片附件
                      <span className="ml-2 text-xs font-semibold text-slate-500">
                        {attachments.length} 個
                      </span>
                    </summary>
                    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                        {loadingAttachments ? (
                          <div className="flex h-20 items-center justify-center gap-2 text-xs text-slate-500">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            載入附件中
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {attachments.map((attachment) => {
                              const isImage = isImageAttachment(attachment);
                              const imageUrl = attachment.signed_url || '';
                              const body = (
                                <>
                                  <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-100">
                                    {isImage ? (
                                      <img src={imageUrl} alt={attachment.file_name} className="h-full w-full object-cover" />
                                    ) : attachment.content_type === 'application/pdf' ? (
                                      <FileText className="h-6 w-6 text-red-500" />
                                    ) : (
                                      <Image className="h-6 w-6 text-slate-400" />
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium text-slate-800">{attachment.file_name}</span>
                                    <span className="mt-1 block text-xs text-slate-500">
                                      {[attachment.purpose, formatFileSize(attachment.size_bytes), formatDateTime(attachment.uploaded_at)].filter(Boolean).join(' / ')}
                                    </span>
                                  </span>
                                  {attachment.signed_url && <ExternalLink className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-orange-600" />}
                                </>
                              );

                              if (isImage) {
                                return (
                                  <button
                                    key={attachment.id}
                                    type="button"
                                    onClick={() => setPreviewAttachment(attachment)}
                                    className="group flex w-full items-center gap-3 rounded-md border border-slate-200 bg-white p-2 text-left text-sm hover:border-orange-200 hover:bg-orange-50"
                                  >
                                    {body}
                                  </button>
                                );
                              }

                              return (
                                <a
                                  key={attachment.id}
                                  href={attachment.signed_url || '#'}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="group flex items-center gap-3 rounded-md border border-slate-200 bg-white p-2 text-sm hover:border-orange-200 hover:bg-orange-50"
                                >
                                  {body}
                                </a>
                              );
                            })}
                          </div>
                        )}
                    </div>
                  </details>
                )}
                {(loadingTimeline || publicTimelineItems.length > 0) && (
                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <Timer className="h-3.5 w-3.5" />
                        最新回覆
                      </div>
                      {publicTimelineItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setShowFullTimeline((current) => !current)}
                          className="text-xs font-semibold text-orange-700 hover:text-orange-800"
                        >
                          {showFullTimeline ? '收合完整紀錄' : `查看完整紀錄 ${publicTimelineItems.length} 筆`}
                        </button>
                      )}
                    </div>
                    <div className="mt-2 rounded-md bg-slate-50 p-2">
                      {loadingTimeline ? (
                        <div className="flex h-16 items-center justify-center gap-2 text-xs text-slate-500">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          載入回覆中
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {latestTimelineItems.map((item) => (
                            <div key={`${item.kind}-${item.id}`} className="rounded-md border border-slate-200 bg-white p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                                <div className="shrink-0 text-[11px] text-slate-400">{formatDateTime(item.created_at)}</div>
                              </div>
                              {item.body && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{item.body}</p>}
                              {item.actor && <div className="mt-2 text-[11px] text-slate-400">{item.actor}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {showFullTimeline && (
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <Timer className="h-3.5 w-3.5" />
                    完整處理紀錄
                  </div>
                  <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                    {loadingTimeline ? (
                      <div className="flex h-20 items-center justify-center gap-2 text-xs text-slate-500">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        載入紀錄中
                      </div>
                    ) : events.length === 0 && comments.length === 0 ? (
                      <div className="flex h-20 items-center justify-center text-xs text-slate-500">尚無處理紀錄</div>
                    ) : (
                      <div className="space-y-2">
                        {events.map((event) => (
                          <div key={`event-${event.id}`} className="rounded-md border border-slate-200 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-800">{event.title}</div>
                              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${event.visibility === 'INTERNAL' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                                {visibilityLabel(event.visibility)}
                              </span>
                            </div>
                            {event.description && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{event.description}</p>}
                            <div className="mt-2 text-[11px] text-slate-400">
                              {[event.created_by_name, formatDateTime(event.created_at)].filter(Boolean).join(' / ')}
                            </div>
                          </div>
                        ))}
                        {comments.map((comment) => (
                          <div key={`comment-${comment.id}`} className="rounded-md border border-orange-100 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800">
                                <MessageSquare className="h-3.5 w-3.5 text-orange-500" />
                                留言
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {(comment.can_edit || comment.can_delete) && editingCommentId !== comment.id && (
                                  <>
                                    {comment.can_edit && (
                                      <button
                                        type="button"
                                        onClick={() => startEditComment(comment)}
                                        className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                        編輯
                                      </button>
                                    )}
                                    {comment.can_delete && (
                                      <button
                                        type="button"
                                        onClick={() => void deleteComment(comment.id)}
                                        disabled={commentMutatingId === comment.id}
                                        className="inline-flex h-7 items-center gap-1 rounded border border-red-200 px-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        刪除
                                      </button>
                                    )}
                                  </>
                                )}
                                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${comment.visibility === 'INTERNAL' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {visibilityLabel(comment.visibility)}
                                </span>
                              </div>
                            </div>
                            {editingCommentId === comment.id ? (
                              <div className="mt-2">
                                <textarea
                                  value={editingCommentBody}
                                  onChange={(event) => setEditingCommentBody(event.target.value)}
                                  rows={3}
                                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                                />
                                <div className="mt-2 flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void updateComment(comment.id)}
                                    disabled={commentMutatingId === comment.id || !editingCommentBody.trim()}
                                    className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                                  >
                                    {commentMutatingId === comment.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                                    儲存
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCommentId('');
                                      setEditingCommentBody('');
                                    }}
                                    className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">{comment.body}</p>
                            )}
                            {comment.attachments && comment.attachments.length > 0 && (
                              <div className="mt-2 grid gap-1">
                                {comment.attachments.map((attachment) => {
                                  const isImage = isImageAttachment(attachment);
                                  if (isImage) {
                                    return (
                                      <button
                                        key={attachment.id}
                                        type="button"
                                        onClick={() => setPreviewAttachment(attachment)}
                                        className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 p-1.5 text-left text-xs text-slate-600 hover:border-orange-200 hover:bg-orange-50"
                                      >
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white">
                                          <img src={attachment.signed_url || ''} alt={attachment.file_name} className="h-full w-full object-cover" />
                                        </span>
                                        <span className="truncate">{attachment.file_name}</span>
                                      </button>
                                    );
                                  }
                                  return (
                                    <a
                                      key={attachment.id}
                                      href={attachment.signed_url || '#'}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 hover:border-orange-200 hover:bg-orange-50"
                                    >
                                      <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                                      <span className="truncate">{attachment.file_name}</span>
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                            <div className="mt-2 text-[11px] text-slate-400">
                              {[comment.created_by_name, formatDateTime(comment.created_at), comment.edited_at ? '已編輯' : null].filter(Boolean).join(' / ')}
                            </div>
                            {comment.read_at && (
                              <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" />
                                總務已閱讀：{comment.read_by_name || '總務人員'} / {formatDateTime(comment.read_at)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                )}
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <button
                    type="button"
                    onClick={() => setShowCommentComposer((current) => !current)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
                      <MessageSquare className="h-4 w-4 text-orange-500" />
                      我要補充
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {showCommentComposer ? '收合' : '有新狀況或照片再使用'}
                    </span>
                  </button>
                  {showCommentComposer && (
                    <div className="mt-3">
                      <textarea
                        value={commentBody}
                        onChange={(event) => setCommentBody(event.target.value)}
                        rows={3}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-6 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                        placeholder="直接寫要補充給總務的現場狀況"
                      />
                      <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                        <Paperclip className="h-4 w-4" />
                        加照片 / 附件
                        <input
                          key={`${selectedRequest.id}-store-comment-${commentFiles.length}`}
                          type="file"
                          multiple
                          accept="image/*,.pdf"
                          className="hidden"
                          onChange={(event) => setCommentFiles(Array.from(event.target.files || []))}
                        />
                      </label>
                      {commentFiles.length > 0 && (
                        <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                          已選擇 {commentFiles.length} 個附件：{commentFiles.map((file) => file.name).join('、')}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void submitComment()}
                        disabled={commentSubmitting || !commentBody.trim()}
                        className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {commentSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {commentSubmitting ? '送出中' : '送出補充'}
                      </button>
                    </div>
                  )}
                </div>
                {selectedRequest.rejection_note && selectedRequest.main_status !== 'REJECTED' && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <AlertCircle className="h-3.5 w-3.5" />
                      駁回原因
                    </div>
                    <p className="mt-1 whitespace-pre-wrap leading-6">{selectedRequest.rejection_note}</p>
                  </div>
                )}
                {selectedRequest.supplement_note && selectedRequest.main_status !== 'WAITING_STORE_SUPPLEMENT' && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
                    <div className="text-xs font-semibold">待補資料</div>
                    <p className="mt-1 whitespace-pre-wrap leading-6">{selectedRequest.supplement_note}</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </aside>
      </div>
      {previewAttachment?.signed_url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="附件照片預覽"
          onClick={() => setPreviewAttachment(null)}
        >
          <div className="relative max-h-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewAttachment(null)}
              className="absolute right-2 top-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow hover:bg-white"
              aria-label="關閉照片預覽"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={previewAttachment.signed_url}
              alt={previewAttachment.file_name}
              className="max-h-[88vh] max-w-[92vw] rounded-md bg-white object-contain shadow-2xl"
            />
            <div className="mt-2 rounded-md bg-white/95 px-3 py-2 text-sm text-slate-700 shadow">
              {previewAttachment.file_name}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
