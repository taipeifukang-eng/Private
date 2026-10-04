'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Camera, CheckCircle2, Droplets, FileUp, Loader2, Phone, Plus, Router, Trash2, X, Zap } from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import ResourceAttachmentPanel from '@/components/general-affairs/attachments/ResourceAttachmentPanel';

type Store = { id: string; store_code: string; store_name: string; short_name?: string | null };
type Bill = {
  id: string; store_id: string | null; location_name: string; expense_type: 'WATER' | 'ELECTRICITY' | 'PHONE' | 'INTERNET';
  billing_month: string; provider_name: string | null; service_label: string | null; service_identifier: string | null; account_number: string | null; equipment_serial: string | null; amount: number;
  electricity_kwh: number | null;
  due_date: string | null; paid_at: string | null; reference_no: string | null; notes: string | null; store?: Store | null;
};

const TYPE = {
  WATER: { label: '水費', icon: Droplets, tone: 'text-blue-700 bg-blue-50' },
  ELECTRICITY: { label: '電費', icon: Zap, tone: 'text-yellow-700 bg-yellow-50' },
  PHONE: { label: '電話費', icon: Phone, tone: 'text-amber-700 bg-amber-50' },
  INTERNET: { label: '網路費', icon: Router, tone: 'text-emerald-700 bg-emerald-50' },
} as const;

const currentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).format(new Date());
const EMPTY = { store_id: '', location_name: '', expense_type: 'WATER', billing_month: currentMonth, provider_name: '', service_label: '', service_identifier: '', account_number: '', equipment_serial: '', amount: '', electricity_kwh: '', due_date: '', paid_at: '', reference_no: '', notes: '' };

async function parse(response: Response) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) throw new Error(typeof json.error === 'string' ? json.error : '操作失敗');
  return json;
}

function money(value: number) { return Number(value || 0).toLocaleString('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }); }
function location(row: Bill) {
  const site = row.store ? `${row.store.store_code} ${row.store.short_name || row.store.store_name}` : row.location_name;
  return row.service_label ? `${site}｜${row.service_label}` : site;
}
function identifierLabel(type: Bill['expense_type'] | string) {
  if (type === 'ELECTRICITY') return '電號';
  if (type === 'WATER') return '水號';
  if (type === 'PHONE') return '電話號碼／用戶號碼';
  return '電路編號／用戶號碼';
}

export default function UtilityBillsClient() {
  const [items, setItems] = useState<Bill[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [typeFilter, setTypeFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attachmentBill, setAttachmentBill] = useState<Bill | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (month) params.set('month', month);
      if (typeFilter) params.set('type', typeFilter);
      if (storeFilter) params.set('storeId', storeFilter);
      const json = await parse(await fetch(`/api/general-affairs/utility-bills?${params}`, { cache: 'no-store' }));
      setItems(json.data || []); setStores(json.meta?.stores || []); setCanManage(json.meta?.canManage === true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '載入失敗'); }
    finally { setLoading(false); }
  }, [month, storeFilter, typeFilter]);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    return {
      total: items.reduce((sum, row) => sum + Number(row.amount), 0),
      unpaid: items.filter((row) => !row.paid_at).reduce((sum, row) => sum + Number(row.amount), 0),
      overdue: items.filter((row) => !row.paid_at && row.due_date && row.due_date < today),
    };
  }, [items]);

  function selectStore(storeId: string) {
    const store = stores.find((item) => item.id === storeId);
    setForm((current) => ({ ...current, store_id: storeId, location_name: store ? `${store.store_code} ${store.short_name || store.store_name}` : '' }));
  }

  function addPendingFiles(files: FileList | null) {
    const incoming = Array.from(files || []);
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
    const invalid = incoming.find((file) => !allowed.has(file.type) || file.size <= 0 || file.size > 20 * 1024 * 1024);
    if (invalid) {
      setError(`${invalid.name} 格式不支援或超過 20MB。`);
      return;
    }
    setPendingFiles((current) => [...current, ...incoming].slice(0, 10));
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const result = await parse(await fetch('/api/general-affairs/utility-bills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }));
      let attachmentWarning = '';
      if (pendingFiles.length) {
        const attachments = new FormData();
        attachments.set('resource_type', 'UTILITY_BILL');
        attachments.set('resource_id', result.data.id);
        attachments.set('purpose', 'BILL_DOCUMENT');
        pendingFiles.forEach((file) => attachments.append('files', file));
        try {
          await parse(await fetch('/api/general-affairs/attachments', { method: 'POST', body: attachments }));
        } catch (uploadError) {
          attachmentWarning = uploadError instanceof Error ? `；附件尚未上傳：${uploadError.message}` : '；附件尚未上傳';
        }
      }
      setDialogOpen(false); setForm({ ...EMPTY, billing_month: month || currentMonth }); setPendingFiles([]); setAttachmentBill(result.data); setMessage(`費用紀錄已新增${attachmentWarning || '，附件已上傳'}`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '新增失敗'); }
    finally { setSaving(false); }
  }

  async function markPaid(row: Bill) {
    await parse(await fetch(`/api/general-affairs/utility-bills/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paid_at: row.paid_at ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()) }) }));
    setMessage(row.paid_at ? '已改回待繳費' : '已標記繳費'); await load();
  }

  async function remove(row: Bill) {
    if (!window.confirm(`確定刪除 ${location(row)} ${TYPE[row.expense_type].label}？`)) return;
    await parse(await fetch(`/api/general-affairs/utility-bills/${row.id}`, { method: 'DELETE' })); setMessage('費用紀錄已刪除'); await load();
  }

  return <div className="mx-auto flex max-w-7xl flex-col gap-4">
    <GeneralAffairsPageHeader eyebrow="費用管理" breadcrumbs={[{ label: '總務服務中心', href: '/general-affairs' }, { label: '水電電話網路費' }]} title="水電電話網路費" description="按月份與據點掌握帳單、繳費期限與金額" primaryAction={<div className="flex flex-wrap gap-2"><Link href="/general-affairs/utility-bills/report" className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"><BarChart3 className="h-4 w-4" />費用報表</Link>{canManage && <button type="button" onClick={() => { setPendingFiles([]); setDialogOpen(true); }} className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" />新增費用</button>}</div>} />

    {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
    {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

    <section className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border border-slate-200 bg-white p-4"><div className="text-xs font-bold text-slate-500">本月費用</div><div className="mt-2 text-2xl font-black">{money(summary.total)}</div></div>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4"><div className="text-xs font-bold text-amber-700">待繳費</div><div className="mt-2 text-2xl font-black text-amber-950">{money(summary.unpaid)}</div></div>
      <div className={`rounded-md border p-4 ${summary.overdue.length ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}><div className="text-xs font-bold text-slate-500">已逾期</div><div className="mt-2 text-2xl font-black text-red-700">{summary.overdue.length} 筆</div></div>
    </section>

    <section className="rounded-md border border-slate-200 bg-white">
      <div className="grid gap-2 border-b border-slate-200 p-4 sm:grid-cols-3">
        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 rounded-md border border-slate-300 px-3 text-sm" />
        <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 px-3 text-sm"><option value="">全部據點</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.store_code} {store.short_name || store.store_name}</option>)}</select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-10 rounded-md border border-slate-300 px-3 text-sm"><option value="">全部費用</option>{Object.entries(TYPE).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select>
      </div>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">據點</th><th className="px-4 py-3">類型</th><th className="px-4 py-3">供應商／服務識別</th><th className="px-4 py-3 text-right">金額</th><th className="px-4 py-3">繳費期限</th><th className="px-4 py-3">狀態</th>{canManage && <th className="px-4 py-3 text-right">操作</th>}</tr></thead>
      <tbody className="divide-y divide-slate-100">{loading ? <tr><td colSpan={7} className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr> : !items.length ? <tr><td colSpan={7} className="p-8 text-center text-slate-500">這個月份還沒有費用紀錄</td></tr> : items.map((row) => { const setting = TYPE[row.expense_type]; const Icon = setting.icon; const overdue = !row.paid_at && row.due_date && row.due_date < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()); return <tr key={row.id}><td className="px-4 py-3 font-semibold">{location(row)}</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-bold ${setting.tone}`}><Icon className="h-3.5 w-3.5" />{setting.label}</span>{row.expense_type === 'ELECTRICITY' && row.electricity_kwh !== null && <div className="mt-1 text-xs text-slate-500">{Number(row.electricity_kwh).toLocaleString('zh-TW')} 度</div>}</td><td className="px-4 py-3"><div>{row.provider_name || '-'}</div><div className="text-xs font-semibold text-slate-600">{identifierLabel(row.expense_type)}：{row.service_identifier || '-'}</div>{row.account_number && <div className="text-xs text-slate-500">客戶帳號：{row.account_number}</div>}{row.expense_type === 'INTERNET' && row.equipment_serial && <div className="text-xs text-slate-500">設備序號：{row.equipment_serial}</div>}</td><td className="px-4 py-3 text-right font-black">{money(row.amount)}{row.expense_type === 'ELECTRICITY' && Number(row.electricity_kwh) > 0 && <div className="text-xs font-normal text-slate-500">{money(row.amount / Number(row.electricity_kwh))} / 度</div>}</td><td className="px-4 py-3">{row.due_date || '-'}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 text-xs font-bold ${row.paid_at ? 'bg-emerald-50 text-emerald-700' : overdue ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{row.paid_at ? '已繳費' : overdue ? '已逾期' : '待繳費'}</span></td>{canManage && <td className="px-4 py-3 text-right"><button type="button" onClick={() => void markPaid(row)} className="mr-2 rounded-md border border-slate-200 px-2 py-1 text-xs font-bold">{row.paid_at ? '取消繳費' : '標記已繳'}</button><button type="button" onClick={() => void remove(row)} className="rounded-md p-1.5 text-red-600" title="刪除"><Trash2 className="h-4 w-4" /></button></td>}</tr>; })}</tbody></table></div>
    </section>

    <section className="rounded-md border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 className="font-bold text-slate-950">帳單掃描檔與照片</h2><p className="mt-1 text-sm text-slate-500">選擇費用紀錄後上傳對應憑證。</p></div>
        <select value={attachmentBill?.id || ''} onChange={(event) => setAttachmentBill(items.find((item) => item.id === event.target.value) || null)} className="h-10 min-w-64 rounded-md border border-slate-300 px-3 text-sm">
          <option value="">選擇費用紀錄</option>
          {items.map((item) => <option key={item.id} value={item.id}>{location(item)}｜{TYPE[item.expense_type].label}｜{money(item.amount)}</option>)}
        </select>
      </div>
      {attachmentBill ? <ResourceAttachmentPanel resourceType="UTILITY_BILL" resourceId={attachmentBill.id} purpose="BILL_DOCUMENT" canManage={canManage} title="本期帳單附件" uploadButtonLabel="上傳掃描檔／照片" emptyLabel="尚未上傳本期帳單" /> : <div className="rounded-md bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">請先選擇一筆費用紀錄。</div>}
    </section>

    {dialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl"><div className="flex items-center justify-between border-b px-5 py-4"><h2 className="font-bold">新增費用</h2><button type="button" onClick={() => setDialogOpen(false)} title="關閉" className="p-2"><X className="h-4 w-4" /></button></div><div className="grid gap-4 p-5 sm:grid-cols-2">
      <label className="text-sm font-semibold">據點<select value={form.store_id} onChange={(event) => selectStore(event.target.value)} className="mt-1 h-10 w-full rounded-md border px-3"><option value="">其他據點</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.store_code} {store.short_name || store.store_name}</option>)}</select></label>
      <label className="text-sm font-semibold">據點名稱<input required value={form.location_name} onChange={(event) => setForm({ ...form, location_name: event.target.value })} readOnly={Boolean(form.store_id)} className="mt-1 h-10 w-full rounded-md border px-3 read-only:bg-slate-100" /></label>
      <label className="text-sm font-semibold">費用類型<select value={form.expense_type} onChange={(event) => setForm({ ...form, expense_type: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3">{Object.entries(TYPE).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
      <label className="text-sm font-semibold">帳單月份<input required type="month" value={form.billing_month} onChange={(event) => setForm({ ...form, billing_month: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
      <label className="text-sm font-semibold">供應商<input value={form.provider_name} onChange={(event) => setForm({ ...form, provider_name: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
      {form.expense_type === 'INTERNET' && <label className="text-sm font-semibold">線路／數據機名稱<input value={form.service_label} onChange={(event) => setForm({ ...form, service_label: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" placeholder="例如：POS 主線、監視器網路" /></label>}
      <label className="text-sm font-semibold">{identifierLabel(form.expense_type)}<input required={form.expense_type !== 'INTERNET' || !form.equipment_serial} value={form.service_identifier} onChange={(event) => setForm({ ...form, service_identifier: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
      <label className="text-sm font-semibold">客戶／帳單帳號（選填）<input value={form.account_number} onChange={(event) => setForm({ ...form, account_number: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
      {form.expense_type === 'INTERNET' && <label className="text-sm font-semibold">網路設備序號<input required={!form.service_identifier} value={form.equipment_serial} onChange={(event) => setForm({ ...form, equipment_serial: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /><span className="mt-1 block text-xs font-normal text-slate-500">電路編號與設備序號至少填一項。</span></label>}
      <label className="text-sm font-semibold">金額<input required type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
      {form.expense_type === 'ELECTRICITY' && <label className="text-sm font-semibold">用電度數（kWh）<input type="number" min="0" step="0.01" value={form.electricity_kwh} onChange={(event) => setForm({ ...form, electricity_kwh: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" placeholder="例如：1250" /></label>}
      <label className="text-sm font-semibold">繳費期限<input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
      <label className="text-sm font-semibold">繳費日期<input type="date" value={form.paid_at} onChange={(event) => setForm({ ...form, paid_at: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
      <label className="text-sm font-semibold">本期帳單／銷帳編號（選填）<input value={form.reference_no} onChange={(event) => setForm({ ...form, reference_no: event.target.value })} className="mt-1 h-10 w-full rounded-md border px-3" /></label>
      <label className="text-sm font-semibold sm:col-span-2">備註<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border px-3 py-2" /></label>
      <section className="rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
        <div className="text-sm font-bold text-slate-800">帳單掃描檔或照片</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-100"><FileUp className="h-4 w-4" />選擇檔案<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={(event) => addPendingFiles(event.target.files)} className="sr-only" /></label>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-100"><Camera className="h-4 w-4" />直接拍照<input type="file" accept="image/*" capture="environment" onChange={(event) => addPendingFiles(event.target.files)} className="sr-only" /></label>
        </div>
        {pendingFiles.length > 0 && <div className="mt-3 space-y-2">{pendingFiles.map((file, index) => <div key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-xs"><span className="min-w-0 truncate font-semibold text-slate-700">{file.name}</span><button type="button" onClick={() => setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} className="ml-3 shrink-0 text-red-600">移除</button></div>)}</div>}
        <div className="mt-2 text-xs text-slate-500">{pendingFiles.length} / 10 個，支援圖片與 PDF，單檔上限 20MB。</div>
      </section>
    </div><div className="flex justify-end gap-2 border-t px-5 py-4"><button type="button" onClick={() => setDialogOpen(false)} className="h-10 rounded-md border px-4 text-sm font-bold">取消</button><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-bold text-white disabled:bg-slate-300">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}儲存</button></div></form></div>}
  </div>;
}
