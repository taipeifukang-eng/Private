'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Send,
  Truck,
  XCircle,
} from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';

type ApiError = { code?: string; message?: string };

type LocationOption = {
  id: string;
  code: string | null;
  name: string;
  location_type: string;
  store_id?: string | null;
  is_default?: boolean | null;
  allow_negative_stock?: boolean | null;
  store?: { store_code: string; store_name: string; short_name?: string | null } | null;
};

type PartOption = {
  id: string;
  name: string;
  part_code: string | null;
  brand: string | null;
  model: string | null;
  base_unit: string;
  purchase_unit: string | null;
  purchase_to_base_rate: number | null;
};

type LocationPartOption = {
  location_id: string;
  part_id: string;
  currentBalance?: { quantity_base: number } | null;
  part?: PartOption | null;
};

type TransferItem = {
  id: string;
  part_id: string;
  quantity_input: number;
  input_unit_type: 'BASE' | 'PURCHASE';
  notes: string | null;
  source_transaction_id: string | null;
  receipt_transaction_id: string | null;
  part?: PartOption | null;
};

type Transfer = {
  id: string;
  transfer_no: string;
  source_location_id: string;
  destination_location_id: string;
  status: string;
  reason: string;
  notes: string | null;
  shipping_method: string | null;
  source_confirmed_at: string | null;
  shipped_at: string | null;
  received_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  source_location?: LocationOption | null;
  destination_location?: LocationOption | null;
  items?: TransferItem[];
};

type FormState = {
  sourceLocationId: string;
  destinationLocationId: string;
  partId: string;
  quantity: string;
  inputUnitType: 'BASE' | 'PURCHASE';
  reason: string;
  shippingMethod: string;
  notes: string;
};

type TransferPrefill = {
  serviceRequestId?: string;
  requestNo?: string;
  partId?: string;
  quantity?: string;
  sourceLocationId?: string;
  destinationStoreId?: string;
  reason?: string;
  notes?: string;
};

type Message = { type: 'success' | 'error'; text: string } | null;
type TransferExceptionType = '少收' | '未收' | '破損' | '收錯' | '取消';

const EMPTY_FORM: FormState = {
  sourceLocationId: '',
  destinationLocationId: '',
  partId: '',
  quantity: '',
  inputUnitType: 'BASE',
  reason: '',
  shippingMethod: '',
  notes: '',
};

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: '待來源確認交出',
  SOURCE_CONFIRMED: '來源已交出',
  IN_TRANSIT: '運送中 / 待收貨',
  RECEIVED: '已收貨',
  CANCELED: '已取消',
};

const STATUS_CLASS: Record<string, string> = {
  REQUESTED: 'border-amber-200 bg-amber-50 text-amber-800',
  SOURCE_CONFIRMED: 'border-sky-200 bg-sky-50 text-sky-800',
  IN_TRANSIT: 'border-blue-200 bg-blue-50 text-blue-800',
  RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  CANCELED: 'border-slate-200 bg-slate-100 text-slate-600',
};

const STATUS_FILTER_CARDS = [
  {
    status: 'REQUESTED',
    title: '等來源交出',
    description: '先確認來源位置實際有交出料件',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
  },
  {
    status: 'SOURCE_CONFIRMED',
    title: '可安排配送',
    description: '來源已扣庫存，可標記運送或直接收貨',
    className: 'border-sky-200 bg-sky-50 text-sky-900',
  },
  {
    status: 'IN_TRANSIT',
    title: '等目的收貨',
    description: '確認目的位置收到後才正式入庫',
    className: 'border-blue-200 bg-blue-50 text-blue-900',
  },
  {
    status: 'RECEIVED',
    title: '已完成',
    description: '來源與目的庫存皆已完成異動',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  },
  {
    status: 'CANCELED',
    title: '異常 / 取消',
    description: '少收、未收、破損、收錯或取消的調撥單',
    className: 'border-red-200 bg-red-50 text-red-900',
  },
] as const;

const TRANSFER_EXCEPTION_TYPES: Array<{
  type: TransferExceptionType;
  title: string;
  description: string;
}> = [
  { type: '少收', title: '少收', description: '實際收到數量少於調撥單，先停止入庫等待總務處理。' },
  { type: '未收', title: '未收', description: '門市或目的位置尚未收到，避免誤按收貨。' },
  { type: '破損', title: '破損', description: '收到但物品破損或無法使用，需要重新判斷庫存。' },
  { type: '收錯', title: '收錯', description: '收到品項、規格或來源不符合調撥單。' },
  { type: '取消', title: '取消', description: '這張調撥不再執行，保留原因紀錄。' },
];

function messageClass(type: 'success' | 'error') {
  return type === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-red-200 bg-red-50 text-red-800';
}

async function parseResponse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    const error = json.error as ApiError | string | undefined;
    if (typeof error === 'object' && error) throw new Error(`${error.code || 'ERROR'}｜${error.message || '操作失敗'}`);
    throw new Error(String(error || '操作失敗'));
  }
  return json;
}

function dateText(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function numberText(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 4 });
}

function locationLabel(location?: LocationOption | null) {
  if (!location) return '-';
  const store = location.store?.short_name || location.store?.store_name || '';
  return `${location.name}${store ? `｜${store}` : ''}`;
}

function partLabel(part?: PartOption | null) {
  if (!part) return '-';
  return [part.part_code, part.name, part.brand, part.model].filter(Boolean).join('｜');
}

function unitLabel(item: Pick<TransferItem, 'input_unit_type'>, part?: PartOption | null) {
  if (item.input_unit_type === 'PURCHASE') return part?.purchase_unit || '採購單位';
  return part?.base_unit || '基本單位';
}

function parseTransferException(cancelReason: string | null | undefined) {
  const prefix = '調撥異常：';
  if (!cancelReason?.startsWith(prefix)) return null;
  const raw = cancelReason.slice(prefix.length);
  const [typeText, ...noteParts] = raw.split('｜');
  const type = TRANSFER_EXCEPTION_TYPES.some((item) => item.type === typeText)
    ? typeText as TransferExceptionType
    : '取消';
  const note = noteParts.join('｜').trim();
  return {
    type,
    note,
    label: `異常：${type}`,
  };
}

function transferStep(transfer: Transfer) {
  const exception = parseTransferException(transfer.cancel_reason);
  if (transfer.status === 'REQUESTED') {
    return {
      title: '下一步：來源確認交出',
      description: '確認來源位置已交出料件後，系統會先扣來源可用庫存與庫存。',
      action: '確認交出',
      className: 'border-amber-200 bg-amber-50 text-amber-900',
    };
  }
  if (transfer.status === 'SOURCE_CONFIRMED') {
    return {
      title: '下一步：安排配送或直接收貨',
      description: '若料件已在運送途中可標記運送中；目的位置實際收到後再確認收貨。',
      action: '運送中 / 確認收貨',
      className: 'border-sky-200 bg-sky-50 text-sky-900',
    };
  }
  if (transfer.status === 'IN_TRANSIT') {
    return {
      title: '下一步：目的確認收貨',
      description: '收貨後目的位置才會正式增加庫存。',
      action: '確認收貨',
      className: 'border-blue-200 bg-blue-50 text-blue-900',
    };
  }
  if (transfer.status === 'RECEIVED') {
    return {
      title: '已完成收貨',
      description: '這張調撥單已完成來源扣庫存與目的入庫。',
      action: '完成',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    };
  }
  if (exception) {
    return {
      title: `異常停止：${exception.type}`,
      description: exception.note || '這張調撥單已因異常停止入庫，請總務後續追蹤。',
      action: exception.label,
      className: 'border-red-200 bg-red-50 text-red-900',
    };
  }
  return {
    title: '已取消',
    description: transfer.cancel_reason || '這張調撥單已取消。',
    action: '取消',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
  };
}

export default function InventoryTransfersClient({ prefill }: { prefill?: TransferPrefill }) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationParts, setLocationParts] = useState<LocationPartOption[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState('');
  const [exceptionDraft, setExceptionDraft] = useState<{
    transferId: string;
    type: TransferExceptionType;
    note: string;
  }>({ transferId: '', type: '少收', note: '' });
  const [message, setMessage] = useState<Message>(null);
  const [error, setError] = useState('');
  const [prefillApplied, setPrefillApplied] = useState(false);

  const loadOptions = useCallback(async () => {
    const json = await parseResponse(await fetch('/api/general-affairs/inventory/options', { cache: 'no-store' }));
    setLocations(json.data.locations || []);
    setLocationParts(json.data.locationParts || []);
  }, []);

  const loadTransfers = useCallback(async () => {
    const params = new URLSearchParams({ pageSize: '50' });
    if (statusFilter) params.set('status', statusFilter);
    if (search.trim()) params.set('search', search.trim());
    const json = await parseResponse(await fetch(`/api/general-affairs/inventory/transfers?${params.toString()}`, { cache: 'no-store' }));
    setTransfers(json.data || []);
  }, [search, statusFilter]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadOptions(), loadTransfers()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '調撥資料載入失敗');
    } finally {
      setLoading(false);
    }
  }, [loadOptions, loadTransfers]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (prefillApplied || loading || !locations.length) return;

    const requestNo = prefill?.requestNo?.trim() || '';
    const partId = prefill?.partId?.trim() || '';
    const quantity = prefill?.quantity?.trim() || '';
    const sourceLocationId = prefill?.sourceLocationId?.trim() || '';
    const destinationStoreId = prefill?.destinationStoreId?.trim() || '';
    const reason = prefill?.reason?.trim() || '';
    const notes = prefill?.notes?.trim() || '';

    if (!requestNo && !partId && !quantity && !sourceLocationId && !destinationStoreId && !reason && !notes) {
      setPrefillApplied(true);
      return;
    }

    const destinationLocation = destinationStoreId
      ? locations
        .filter((location) => location.store_id === destinationStoreId)
        .sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)))[0] || null
      : null;

    const sourceLocationExists = sourceLocationId && locations.some((location) => location.id === sourceLocationId);
    const fallbackSource = partId
      ? locationParts
        .filter((item) => item.part_id === partId && item.location_id !== destinationLocation?.id)
        .sort((a, b) => Number(b.currentBalance?.quantity_base || 0) - Number(a.currentBalance?.quantity_base || 0))[0] || null
      : null;
    const nextSourceLocationId = sourceLocationExists ? sourceLocationId : fallbackSource?.location_id || '';
    const sourceHasPart = partId && nextSourceLocationId
      ? locationParts.some((item) => item.location_id === nextSourceLocationId && item.part_id === partId)
      : false;

    setForm((current) => ({
      ...current,
      sourceLocationId: nextSourceLocationId || current.sourceLocationId,
      destinationLocationId: destinationLocation?.id || current.destinationLocationId,
      partId: sourceHasPart ? partId : current.partId,
      quantity: quantity || current.quantity,
      reason: reason || current.reason,
      notes: notes || current.notes,
    }));
    setPrefillApplied(true);
    if (requestNo) setMessage({ type: 'success', text: `已帶入需求單 ${requestNo} 的調撥資料，請確認來源與目的位置後建立。` });
  }, [loading, locationParts, locations, prefill, prefillApplied]);

  const sourceParts = useMemo(() => {
    return locationParts
      .filter((item) => item.location_id === form.sourceLocationId && item.part)
      .map((item) => item.part!)
      .sort((a, b) => partLabel(a).localeCompare(partLabel(b), 'zh-TW'));
  }, [form.sourceLocationId, locationParts]);

  const selectedSourcePart = locationParts.find((item) => (
    item.location_id === form.sourceLocationId && item.part_id === form.partId
  ));
  const destinationHasPart = locationParts.some((item) => (
    item.location_id === form.destinationLocationId && item.part_id === form.partId
  ));
  const selectedPart = sourceParts.find((part) => part.id === form.partId) || null;
  const canUsePurchaseUnit = Boolean(selectedPart?.purchase_unit && selectedPart.purchase_to_base_rate);
  const transferSummary = useMemo(() => {
    return transfers.reduce<Record<string, number>>((summary, transfer) => {
      summary[transfer.status] = (summary[transfer.status] || 0) + 1;
      summary.ALL = (summary.ALL || 0) + 1;
      return summary;
    }, { ALL: 0 });
  }, [transfers]);

  async function submitTransfer(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      if (form.partId && form.destinationLocationId && !destinationHasPart) {
        throw new Error('目的位置尚未啟用此料件設定，請先到庫存位置設定。');
      }
      await parseResponse(await fetch('/api/general-affairs/inventory/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceRequestId: prefill?.serviceRequestId || null,
          sourceLocationId: form.sourceLocationId,
          destinationLocationId: form.destinationLocationId,
          reason: form.reason,
          notes: form.notes,
          shippingMethod: form.shippingMethod,
          items: [{
            partId: form.partId,
            quantity: Number(form.quantity),
            inputUnitType: form.inputUnitType,
          }],
        }),
      }));
      setForm(EMPTY_FORM);
      setMessage({ type: 'success', text: '調撥單已建立，等待來源確認交出。' });
      await loadTransfers();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '調撥單建立失敗' });
    } finally {
      setSaving(false);
    }
  }

  async function runAction(transfer: Transfer, action: 'CONFIRM_SOURCE' | 'MARK_IN_TRANSIT' | 'RECEIVE' | 'CANCEL', overrideCancelReason?: string) {
    const cancelReason = action === 'CANCEL' ? overrideCancelReason || window.prompt('請輸入取消原因') : null;
    if (action === 'CANCEL' && !cancelReason?.trim()) return;
    const receiveWarning = action === 'RECEIVE' ? window.confirm('確認目的位置已實際收貨？收貨後會正式增加目的位置庫存。') : true;
    if (!receiveWarning) return;

    setActingId(`${transfer.id}:${action}`);
    setMessage(null);
    try {
      await parseResponse(await fetch(`/api/general-affairs/inventory/transfers/${transfer.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          shippingMethod: transfer.shipping_method || form.shippingMethod || null,
          cancelReason,
          idempotencyKey: crypto.randomUUID(),
        }),
      }));
      const text = action === 'CONFIRM_SOURCE'
        ? '來源已確認交出，來源庫存已扣除。'
        : action === 'MARK_IN_TRANSIT'
          ? '調撥單已標記為運送中。'
          : action === 'RECEIVE'
            ? '目的位置已收貨，庫存已正式入庫。'
            : overrideCancelReason
              ? '調撥異常已記錄，這張調撥單已停止入庫。'
              : '調撥單已取消。';
      setMessage({ type: 'success', text });
      if (action === 'CANCEL') setExceptionDraft({ transferId: '', type: '少收', note: '' });
      await Promise.all([loadTransfers(), loadOptions()]);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '調撥動作失敗' });
    } finally {
      setActingId('');
    }
  }

  async function submitTransferException(transfer: Transfer) {
    if (exceptionDraft.transferId !== transfer.id) return;
    const note = exceptionDraft.note.trim();
    if (!note) {
      setMessage({ type: 'error', text: '請填寫異常說明，方便總務後續追蹤。' });
      return;
    }
    const reason = `調撥異常：${exceptionDraft.type}｜${note}`;
    await runAction(transfer, 'CANCEL', reason);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <GeneralAffairsPageHeader
        breadcrumbs={[
          { label: '總務服務中心', href: '/general-affairs' },
          { label: '庫存管理', href: '/general-affairs/inventory' },
          { label: '調撥與收貨' },
        ]}
        title="調撥與收貨"
        description="追蹤物品從來源位置交出、運送中到目的位置收貨入庫，避免尚未收貨就增加目的庫存。"
        primaryAction={
          <Link key="inventory" href="/general-affairs/inventory" className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Package className="h-4 w-4" />庫存總覽
          </Link>
        }
        secondaryActions={[
          <Link key="locations" href="/general-affairs/inventory/locations" className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            位置與料件設定
          </Link>,
        ]}
      />

      <main className="mx-auto grid max-w-7xl gap-6 px-4 pb-10 lg:grid-cols-[380px_1fr]">
        <form onSubmit={submitTransfer} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-base font-black text-slate-950">建立調撥單</h2>
            <p className="mt-1 text-sm text-slate-500">建立後先等待來源確認交出，收貨前目的庫存不會增加。</p>
          </div>

          {message && <div className={`rounded-md border px-3 py-2 text-sm ${messageClass(message.type)}`}>{message.text}</div>}

          <label className="block text-sm font-semibold text-slate-700">
            來源位置 *
            <select value={form.sourceLocationId} onChange={(event) => setForm({ ...form, sourceLocationId: event.target.value, partId: '' })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal">
              <option value="">選擇來源位置</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            目的位置 *
            <select value={form.destinationLocationId} onChange={(event) => setForm({ ...form, destinationLocationId: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal">
              <option value="">選擇目的位置</option>
              {locations.filter((location) => location.id !== form.sourceLocationId).map((location) => <option key={location.id} value={location.id}>{locationLabel(location)}</option>)}
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            調撥料件 *
            <select value={form.partId} onChange={(event) => setForm({ ...form, partId: event.target.value, inputUnitType: 'BASE' })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal">
              <option value="">先選來源位置，再選料件</option>
              {sourceParts.map((part) => <option key={part.id} value={part.id}>{partLabel(part)}</option>)}
            </select>
          </label>

          {selectedSourcePart && (
            <div className="rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              來源目前庫存：{numberText(selectedSourcePart.currentBalance?.quantity_base || 0)} {selectedPart?.base_unit}
            </div>
          )}

          {form.partId && form.destinationLocationId && !destinationHasPart && (
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              目的位置尚未啟用此料件設定，請先到庫存位置設定。
            </div>
          )}

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="block text-sm font-semibold text-slate-700">
              數量 *
              <input type="number" min="0" step="0.0001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              單位
              <select value={form.inputUnitType} onChange={(event) => setForm({ ...form, inputUnitType: event.target.value as 'BASE' | 'PURCHASE' })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal">
                <option value="BASE">{selectedPart?.base_unit || '基本單位'}</option>
                <option value="PURCHASE" disabled={!canUsePurchaseUnit}>{selectedPart?.purchase_unit || '採購單位'}</option>
              </select>
            </label>
          </div>

          <label className="block text-sm font-semibold text-slate-700">
            調撥原因 *
            <input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" placeholder="例：支援南港店耗材不足" />
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            運送方式
            <select value={form.shippingMethod} onChange={(event) => setForm({ ...form, shippingMethod: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal">
              <option value="">未定</option>
              <option value="總務配送">總務配送</option>
              <option value="門市人員帶回">門市人員帶回</option>
              <option value="物流寄送">物流寄送</option>
              <option value="廠商直送">廠商直送</option>
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            備註
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" />
          </label>

          <button disabled={saving} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            建立調撥單
          </button>
        </form>

        <section className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-black text-slate-950">今天要追哪些調撥</h2>
                <p className="mt-1 text-sm text-slate-500">來源確認時扣庫存，目的收貨時入庫。</p>
              </div>
              <button onClick={loadAll} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <RefreshCw className="h-4 w-4" />重新整理
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-5">
              {STATUS_FILTER_CARDS.map((card) => {
                const active = statusFilter === card.status;
                return (
                  <button
                    key={card.status}
                    type="button"
                    onClick={() => setStatusFilter(active ? '' : card.status)}
                    className={`rounded-lg border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${active ? `${card.className} ring-2 ring-orange-300` : 'border-slate-200 bg-slate-50 text-slate-700'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">{card.title}</span>
                      <span className="text-lg font-black">{transferSummary[card.status] || 0}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 opacity-80">{card.description}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr]">
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                <option value="">全部狀態</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm" placeholder="搜尋調撥單號、原因或備註" />
              </div>
            </div>
          </div>

          {loading && <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />載入調撥與收貨資料...</div>}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

          {!loading && !error && transfers.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">目前沒有調撥單</div>
          )}

          {!loading && !error && transfers.map((transfer) => {
            const step = transferStep(transfer);
            const exception = parseTransferException(transfer.cancel_reason);

            return (
            <article key={transfer.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-mono text-sm font-black text-slate-950">{transfer.transfer_no}</h3>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${exception ? 'border-red-200 bg-red-50 text-red-800' : STATUS_CLASS[transfer.status] || STATUS_CLASS.REQUESTED}`}>
                      {STATUS_LABELS[transfer.status] || transfer.status}
                    </span>
                    {exception && (
                      <span className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-black text-red-700">
                        {exception.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-700">{transfer.reason}</p>
                  <p className="mt-1 text-sm text-slate-500">{locationLabel(transfer.source_location)} → {locationLabel(transfer.destination_location)}</p>
                  <p className="mt-1 text-xs text-slate-400">建立：{dateText(transfer.created_at)} / 交出：{dateText(transfer.source_confirmed_at)} / 收貨：{dateText(transfer.received_at)}</p>
                  {exception && (
                    <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-800">
                      異常說明：{exception.note || transfer.cancel_reason}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {transfer.status === 'REQUESTED' && (
                    <button disabled={actingId === `${transfer.id}:CONFIRM_SOURCE`} onClick={() => runAction(transfer, 'CONFIRM_SOURCE')} className="inline-flex h-9 items-center gap-2 rounded-md bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
                      <Truck className="h-4 w-4" />確認交出
                    </button>
                  )}
                  {transfer.status === 'SOURCE_CONFIRMED' && (
                    <button disabled={actingId === `${transfer.id}:MARK_IN_TRANSIT`} onClick={() => runAction(transfer, 'MARK_IN_TRANSIT')} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                      運送中
                    </button>
                  )}
                  {['SOURCE_CONFIRMED', 'IN_TRANSIT'].includes(transfer.status) && (
                    <button disabled={actingId === `${transfer.id}:RECEIVE`} onClick={() => runAction(transfer, 'RECEIVE')} className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                      <CheckCircle2 className="h-4 w-4" />確認收貨
                    </button>
                  )}
                  {!['RECEIVED', 'CANCELED'].includes(transfer.status) && (
                    <button
                      type="button"
                      onClick={() => setExceptionDraft((current) => current.transferId === transfer.id
                        ? { transferId: '', type: '少收', note: '' }
                        : { transferId: transfer.id, type: '少收', note: '' })}
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                    >
                      <AlertCircle className="h-4 w-4" />
                      回報異常
                    </button>
                  )}
                </div>
              </div>

                <div className={`rounded-lg border px-4 py-3 ${step.className}`}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-black">
                        <ClipboardCheck className="h-4 w-4" />
                        {step.title}
                      </div>
                      <p className="mt-1 text-xs leading-5 opacity-80">{step.description}</p>
                    </div>
                    <div className="inline-flex w-fit items-center gap-2 rounded-full bg-white/75 px-3 py-1 text-xs font-bold">
                      <span>{locationLabel(transfer.source_location)}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span>{locationLabel(transfer.destination_location)}</span>
                    </div>
                  </div>
                </div>
                {exceptionDraft.transferId === transfer.id && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-black">
                          <XCircle className="h-4 w-4" />
                          調撥異常處理
                        </div>
                        <p className="mt-1 text-xs leading-5 text-red-800">
                          少收、未收、破損、收錯或取消時，請先不要確認收貨。送出後會停止這張調撥單入庫，並保留異常原因。
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExceptionDraft({ transferId: '', type: '少收', note: '' })}
                        className="inline-flex h-8 w-fit items-center rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-100"
                      >
                        收合
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-5">
                      {TRANSFER_EXCEPTION_TYPES.map((item) => {
                        const active = exceptionDraft.type === item.type;
                        return (
                          <button
                            key={item.type}
                            type="button"
                            onClick={() => setExceptionDraft((current) => ({ ...current, type: item.type }))}
                            className={`rounded-md border px-3 py-2 text-left text-xs transition ${
                              active ? 'border-red-500 bg-white text-red-900 ring-2 ring-red-100' : 'border-red-100 bg-white/70 text-red-700 hover:bg-white'
                            }`}
                          >
                            <div className="font-black">{item.title}</div>
                            <div className="mt-1 line-clamp-2 leading-4 opacity-80">{item.description}</div>
                          </button>
                        );
                      })}
                    </div>

                    <label className="mt-3 block text-sm font-semibold text-red-900">
                      異常說明 *
                      <textarea
                        value={exceptionDraft.note}
                        onChange={(event) => setExceptionDraft((current) => ({ ...current, note: event.target.value }))}
                        rows={3}
                        placeholder="例如：調撥 10 個，實際只收到 8 個；外箱破損，請總務確認是否補寄。"
                        className="mt-1 w-full rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={actingId === `${transfer.id}:CANCEL`}
                      onClick={() => void submitTransferException(transfer)}
                      className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {actingId === `${transfer.id}:CANCEL` ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      送出異常並停止入庫
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                    <tr>
                      <th className="px-3 py-2">料件</th>
                      <th className="px-3 py-2 text-right">數量</th>
                      <th className="px-3 py-2">來源扣庫存</th>
                      <th className="px-3 py-2">目的收貨入庫</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(transfer.items || []).map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 font-semibold text-slate-800">{partLabel(item.part)}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{numberText(item.quantity_input)} {unitLabel(item, item.part)}</td>
                        <td className="px-3 py-2 text-slate-600">{item.source_transaction_id ? '已扣庫存' : '待交出'}</td>
                        <td className="px-3 py-2 text-slate-600">{item.receipt_transaction_id ? '已入庫' : '待收貨'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
