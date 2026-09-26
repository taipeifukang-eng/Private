'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ClipboardList, Package, RefreshCw, Search, X } from 'lucide-react';
import LinkedPartDocumentDrawer from './LinkedPartDocumentDrawer';
import PartFulfillmentExecutionPanel from './PartFulfillmentExecutionPanel';

type DocumentRow = { id: string; document_type: 'STOCK_ISSUE' | 'TRANSFER' | 'PURCHASE'; document_id: string; document_no: string; quantity?: number | null; status?: string | null; created_at: string };
type Fulfillment = {
  id: string; fulfillment_no: string; status: string; requested_quantity?: number | null; fulfilled_quantity: number; unit?: string | null;
  current_step?: string | null; notes?: string | null; created_at: string; updated_at: string;
  request?: { id: string; request_no: string; title: string; description?: string | null; store_id?: string | null; part_id?: string | null; desired_quantity?: number | null; desired_unit?: string | null; store?: { store_code?: string; store_name?: string; short_name?: string } | null; part?: { part_code?: string; name?: string; base_unit?: string } | null } | null;
  documents?: DocumentRow[];
  events?: Array<{ id: string; event_type: string; title: string; description?: string | null; created_at: string }>;
};
type Capabilities = { manage: boolean; stockIssue: boolean; transfer: boolean; purchase: boolean; purchaseReceipt: boolean };

const STATUS: Record<string, string> = {
  PENDING_DECISION: '待決定', STOCK_ISSUE: '出庫中', TRANSFER: '調撥中', PURCHASING: '採購中',
  WAITING_ARRIVAL: '等待到貨', WAITING_STORE_CONFIRMATION: '等待門市確認', EXCEPTION: '異常', COMPLETED: '已完成', CANCELED: '已取消',
};
const DOC: Record<string, string> = { STOCK_ISSUE: '出庫單', TRANSFER: '調撥單', PURCHASE: '採購單' };
const DOC_STATUS: Record<string, string> = {
  POSTED: '已出庫', REQUESTED: '待來源確認', SOURCE_CONFIRMED: '已交出', IN_TRANSIT: '運送中',
  RECEIVED: '已收貨', PARTIALLY_RECEIVED: '部分到貨', WAITING_ARRIVAL: '等待到貨', CANCELED: '已取消',
};
const STATUS_STYLE: Record<string, string> = {
  PENDING_DECISION: 'bg-amber-100 text-amber-800',
  EXCEPTION: 'bg-red-100 text-red-700',
  WAITING_STORE_CONFIRMATION: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-slate-100 text-slate-600',
  CANCELED: 'bg-slate-100 text-slate-500',
};
const STATUS_PRIORITY: Record<string, number> = {
  EXCEPTION: 0, PENDING_DECISION: 1, WAITING_ARRIVAL: 2, STOCK_ISSUE: 3,
  TRANSFER: 3, PURCHASING: 3, WAITING_STORE_CONFIRMATION: 4, COMPLETED: 5, CANCELED: 6,
};

function nextAction(row: Fulfillment) {
  if (row.status === 'PENDING_DECISION') return '決定出庫、調撥或採購';
  if (row.status === 'STOCK_ISSUE') return quantityProgress(row).remaining > 0 ? '建立出庫單' : Number(row.fulfilled_quantity || 0) >= Number(row.requested_quantity || 0) ? '送門市確認' : '等待既有單據完成';
  if (row.status === 'TRANSFER') return (row.documents || []).some((doc) => doc.document_type === 'TRANSFER') ? '追蹤調撥進度' : '建立調撥單';
  if (row.status === 'PURCHASING') return (row.documents || []).some((doc) => doc.document_type === 'PURCHASE') ? '追蹤採購進度' : '建立採購單';
  if (row.status === 'WAITING_ARRIVAL') return '登錄採購到貨';
  if (row.status === 'WAITING_STORE_CONFIRMATION') return '等待門市確認';
  if (row.status === 'EXCEPTION') return '處理門市回報異常';
  return row.status === 'COMPLETED' ? '已結案' : '已取消';
}

function quantityProgress(row: Fulfillment) {
  const requested = Number(row.requested_quantity || 0);
  const fulfilled = Number(row.fulfilled_quantity || 0);
  const committed = (row.documents || [])
    .filter((document) => document.status !== 'CANCELED')
    .reduce((sum, document) => sum + Number(document.quantity || 0), 0);
  return {
    requested,
    fulfilled,
    committed: Math.max(committed, fulfilled),
    remaining: Math.max(0, requested - Math.max(committed, fulfilled)),
  };
}

export default function PartFulfillmentCenterClient() {
  const deepLinkApplied = useRef(false);
  const [rows, setRows] = useState<Fulfillment[]>([]);
  const [selected, setSelected] = useState<Fulfillment | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DocumentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingDecision, setSavingDecision] = useState('');
  const [showException, setShowException] = useState(false);
  const [exceptionType, setExceptionType] = useState('少收');
  const [exceptionNote, setExceptionNote] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [capabilities, setCapabilities] = useState<Capabilities>({ manage: false, stockIssue: false, transfer: false, purchase: false, purchaseReceipt: false });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/general-affairs/part-fulfillments', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '載入失敗');
      const nextRows = (json.data || []) as Fulfillment[];
      setRows(nextRows);
      setSelected((current) => current ? nextRows.find((item) => item.id === current.id) || null : current);
      setCapabilities(json.capabilities || { manage: false, stockIssue: false, transfer: false, purchase: false, purchaseReceipt: false });
      if (!deepLinkApplied.current) {
        deepLinkApplied.current = true;
        const linkedId = new URLSearchParams(window.location.search).get('fulfillmentId');
        if (linkedId) setSelected(nextRows.find((item) => item.id === linkedId) || null);
      }
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : '載入失敗'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refreshOnFocus = () => void load();
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [load]);

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter((row) => row.status === 'PENDING_DECISION').length,
    active: rows.filter((row) => ['STOCK_ISSUE','TRANSFER','PURCHASING','WAITING_ARRIVAL'].includes(row.status)).length,
    confirmation: rows.filter((row) => row.status === 'WAITING_STORE_CONFIRMATION').length,
    exception: rows.filter((row) => row.status === 'EXCEPTION').length,
    completed: rows.filter((row) => ['COMPLETED','CANCELED'].includes(row.status)).length,
  }), [rows]);
  const visibleRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesFilter = filter === 'ALL'
        || (filter === 'ACTIVE' && ['STOCK_ISSUE','TRANSFER','PURCHASING','WAITING_ARRIVAL'].includes(row.status))
        || (filter === 'PENDING' && row.status === 'PENDING_DECISION')
        || (filter === 'CONFIRMATION' && row.status === 'WAITING_STORE_CONFIRMATION')
        || (filter === 'EXCEPTION' && row.status === 'EXCEPTION')
        || (filter === 'COMPLETED' && ['COMPLETED','CANCELED'].includes(row.status));
      if (!matchesFilter) return false;
      if (!keyword) return true;
      return [row.fulfillment_no, row.request?.request_no, row.request?.title, row.request?.store?.store_name, row.request?.store?.short_name, row.request?.part?.part_code, row.request?.part?.name]
        .filter(Boolean).join(' ').toLowerCase().includes(keyword);
    }).sort((a, b) => {
      const priority = (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99);
      return priority || new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    });
  }, [filter, rows, search]);
  const drawerRow = selected;
  async function chooseDecision(row: Fulfillment, decision: 'STOCK_ISSUE' | 'TRANSFER' | 'PURCHASE') {
    setSavingDecision(decision); setError('');
    try {
      const response = await fetch(`/api/general-affairs/part-fulfillments/${row.id}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '儲存處理方式失敗');
      const next = { ...row, ...json.data };
      setSelected(next);
      setRows((current) => current.map((item) => item.id === row.id ? next : item));
    } catch (decisionError) { setError(decisionError instanceof Error ? decisionError.message : '儲存處理方式失敗'); }
    finally { setSavingDecision(''); }
  }
  async function sendStoreConfirmation(row: Fulfillment) {
    setSavingDecision('STORE_CONFIRMATION'); setError('');
    try {
      const response = await fetch(`/api/general-affairs/part-fulfillments/${row.id}/store-confirmation`, { method: 'POST' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '送門市確認失敗');
      setSelected(null); await load();
    } catch (confirmationError) { setError(confirmationError instanceof Error ? confirmationError.message : '送門市確認失敗'); }
    finally { setSavingDecision(''); }
  }
  async function reportException(row: Fulfillment) {
    if (!exceptionNote.trim()) return;
    setSavingDecision('EXCEPTION'); setError('');
    try {
      const response = await fetch(`/api/general-affairs/part-fulfillments/${row.id}/exception`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: exceptionType, note: exceptionNote }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '異常登錄失敗');
      setShowException(false); setExceptionNote(''); setSelected(null); await load();
    } catch (exceptionError) { setError(exceptionError instanceof Error ? exceptionError.message : '異常登錄失敗'); }
    finally { setSavingDecision(''); }
  }
  function transferUrl(row: Fulfillment) {
    const params = new URLSearchParams({ fromRequestId: row.request?.id || '', requestNo: row.request?.request_no || '', destinationStoreId: row.request?.store_id || '', partId: row.request?.part_id || '', quantity: String(quantityProgress(row).remaining || ''), reason: `需求單 ${row.request?.request_no || ''} ${row.request?.title || ''} 調撥` });
    return `/general-affairs/inventory/transfers?${params.toString()}`;
  }
  function canExecute(decision: 'STOCK_ISSUE' | 'TRANSFER' | 'PURCHASE') {
    return decision === 'STOCK_ISSUE' ? capabilities.stockIssue : decision === 'TRANSFER' ? capabilities.transfer : capabilities.purchase;
  }

  return <div className="min-h-screen bg-slate-50">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-950">料件處理中心</h1><p className="mt-1 text-sm text-slate-500">集中處理出庫、調撥、採購與到貨。</p></div>
      <button type="button" onClick={() => void load()} aria-label="更新" className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 bg-white text-slate-600"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
    </div>
    <div className="mb-4 flex gap-2 overflow-x-auto rounded-md border border-slate-200 bg-white p-2">
      {([['ACTIVE','處理中',counts.active],['PENDING','待決定',counts.pending],['CONFIRMATION','待門市確認',counts.confirmation],['EXCEPTION','異常',counts.exception],['COMPLETED','已完成',counts.completed],['ALL','全部',counts.all]] as const).map(([value,label,count]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`min-w-max rounded-md border px-3 py-2 text-sm font-bold ${filter === value ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-transparent text-slate-600 hover:bg-slate-50'}`}>{label}<span className="ml-2 rounded bg-white px-1.5 py-0.5 text-xs">{count}</span></button>)}
    </div>
    <label className="relative mb-3 block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋處理單、需求單、門市或料件" className="h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-blue-500" /></label>
    {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      {visibleRows.map((row) => { const progress = quantityProgress(row); return <div key={row.id} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(row); setSelectedDocument(null); } }} onClick={() => { setSelected(row); setSelectedDocument(null); setShowException(false); setExceptionNote(''); }} className="grid w-full cursor-pointer gap-2 border-b border-slate-100 px-4 py-4 text-left hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 md:grid-cols-[170px_minmax(0,1fr)_150px_190px] md:items-center">
        <div><div className="font-mono text-xs font-bold text-blue-700">{row.fulfillment_no}</div><div className="mt-1 text-xs text-slate-400">{row.request?.request_no}</div></div>
        <div className="min-w-0"><div className="truncate font-bold text-slate-950">{row.request?.store?.short_name || row.request?.store?.store_name || '-'}｜{row.request?.part?.name || row.request?.title}</div><div className="mt-1 flex min-w-0 items-center gap-2"><span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[row.status] || 'bg-blue-50 text-blue-700'}`}>{STATUS[row.status] || row.status}</span><span className="truncate text-xs font-semibold text-slate-600">{nextAction(row)}</span></div></div>
        <div><div className="text-sm font-bold text-slate-800">待安排 {progress.remaining.toLocaleString()} {row.unit || ''}</div><div className="mt-1 text-[11px] text-slate-500">完成 {progress.fulfilled.toLocaleString()}／需求 {progress.requested.toLocaleString()}</div></div>
        <div className="flex flex-wrap gap-1.5">{(row.documents || []).length ? row.documents?.map((doc) => <button key={doc.id} type="button" title={`查看${DOC[doc.document_type]} ${doc.document_no}`} onClick={(event) => { event.stopPropagation(); setSelectedDocument(doc); }} className="rounded bg-blue-50 px-2 py-1 text-left text-[11px] font-bold text-blue-700 hover:bg-blue-100"><span className="font-mono hover:underline">{doc.document_no}</span>{doc.status && <span className="ml-1 font-sans text-blue-500">{DOC_STATUS[doc.status] || doc.status}</span>}</button>) : <span className="text-xs text-slate-400">尚無正式單據</span>}</div>
      </div>; })}
      {!loading && !visibleRows.length && !error && <div className="p-12 text-center text-sm text-slate-500">{rows.length ? '沒有符合條件的料件處理單' : '目前沒有料件處理單'}</div>}
    </div>

    {drawerRow && <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30" onClick={() => setSelected(null)}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4"><div><div className="font-mono text-xs font-bold text-blue-700">{drawerRow.fulfillment_no}</div><h2 className="mt-1 text-lg font-black">料件處理明細</h2></div><button type="button" onClick={() => setSelected(null)} aria-label="關閉" className="grid h-9 w-9 place-items-center rounded-md hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-5">
          <div className="rounded-md border border-slate-200 p-4"><div className="text-xs text-slate-500">來源需求</div><div className="mt-1 font-bold">{drawerRow.request?.request_no}｜{drawerRow.request?.title}</div><div className="mt-2 text-sm text-slate-600">{drawerRow.current_step || STATUS[drawerRow.status]}</div></div>
          {(() => { const progress = quantityProgress(drawerRow); return <div className="grid grid-cols-4 divide-x divide-slate-200 rounded-md border border-slate-200 bg-slate-50 py-3 text-center"><div><div className="text-[11px] text-slate-500">需求</div><div className="mt-1 text-sm font-black text-slate-900">{progress.requested.toLocaleString()}</div></div><div><div className="text-[11px] text-slate-500">已開單</div><div className="mt-1 text-sm font-black text-blue-700">{progress.committed.toLocaleString()}</div></div><div><div className="text-[11px] text-slate-500">已完成</div><div className="mt-1 text-sm font-black text-emerald-700">{progress.fulfilled.toLocaleString()}</div></div><div><div className="text-[11px] text-slate-500">待安排</div><div className="mt-1 text-sm font-black text-amber-700">{progress.remaining.toLocaleString()}</div></div></div>; })()}
          {capabilities.manage && !['WAITING_STORE_CONFIRMATION','COMPLETED','CANCELED'].includes(drawerRow.status) && <section className={`rounded-md border p-4 ${drawerRow.status === 'EXCEPTION' ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'}`}>
            <h3 className="text-sm font-black text-slate-950">{drawerRow.status === 'EXCEPTION' ? '接下來改用哪種方式處理？' : '這批料件怎麼取得？'}</h3>
            {drawerRow.status === 'EXCEPTION' && <div className="mt-1 text-xs font-semibold text-red-700">{drawerRow.current_step}{drawerRow.notes ? `｜${drawerRow.notes}` : ''}</div>}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {([['STOCK_ISSUE','出庫'],['TRANSFER','調撥'],['PURCHASE','採購']] as const).map(([value, label]) => <button key={value} type="button" title={!canExecute(value) ? `缺少${label}操作權限` : undefined} onClick={() => void chooseDecision(drawerRow, value)} disabled={Boolean(savingDecision) || !canExecute(value)} className={`min-h-10 rounded-md border px-2 text-sm font-bold ${drawerRow.status === value || (value === 'PURCHASE' && ['PURCHASING','WAITING_ARRIVAL'].includes(drawerRow.status)) ? 'border-blue-700 bg-blue-700 text-white' : 'border-blue-200 bg-white text-blue-800 hover:bg-blue-100'} disabled:cursor-not-allowed disabled:opacity-60`}>{savingDecision === value ? <RefreshCw className="mx-auto h-4 w-4 animate-spin" /> : drawerRow.status === 'EXCEPTION' ? `改用${label}` : label}</button>)}
            </div>
            {drawerRow.status === 'TRANSFER' && capabilities.transfer && quantityProgress(drawerRow).remaining > 0 && <a href={transferUrl(drawerRow)} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-3 text-sm font-bold text-white hover:bg-blue-800">建立調撥單<ArrowRight className="h-4 w-4" /></a>}
            {drawerRow.status === 'TRANSFER' && quantityProgress(drawerRow).remaining === 0 && <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">需求數量已全數開單，等待調撥進度</div>}
            {drawerRow.status === 'STOCK_ISSUE' && drawerRow.request && <>
              {capabilities.stockIssue && quantityProgress(drawerRow).remaining > 0
                ? <PartFulfillmentExecutionPanel mode="STOCK_ISSUE" request={drawerRow.request} remainingQuantity={quantityProgress(drawerRow).remaining} onCompleted={() => { setSelected(null); void load(); }} />
                : Number(drawerRow.fulfilled_quantity || 0) >= Number(drawerRow.requested_quantity || 0) ? <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">需求數量已全部出庫</div> : quantityProgress(drawerRow).remaining === 0 ? <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">需求數量已全數開單，等待後續完成</div> : <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">缺少庫存交易管理權限</div>}
              {capabilities.manage && Number(drawerRow.requested_quantity || 0) > 0 && Number(drawerRow.fulfilled_quantity || 0) >= Number(drawerRow.requested_quantity || 0) && <button type="button" onClick={() => void sendStoreConfirmation(drawerRow)} disabled={Boolean(savingDecision)} className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60">{savingDecision === 'STORE_CONFIRMATION' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}已交付，送門市確認</button>}
            </>}
            {drawerRow.status === 'PURCHASING' && drawerRow.request && (quantityProgress(drawerRow).remaining === 0 ? <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">需求數量已全數開單，等待採購進度</div> : capabilities.purchase ? <PartFulfillmentExecutionPanel mode="PURCHASE" request={drawerRow.request} remainingQuantity={quantityProgress(drawerRow).remaining} onCompleted={() => { setSelected(null); void load(); }} /> : <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">缺少採購管理權限</div>)}
            {drawerRow.status === 'WAITING_ARRIVAL' && drawerRow.request && (capabilities.purchaseReceipt ? <PartFulfillmentExecutionPanel mode="PURCHASE_RECEIPT" request={drawerRow.request} remainingQuantity={Math.max(0, Number(drawerRow.requested_quantity || 0) - Number(drawerRow.fulfilled_quantity || 0))} onCompleted={() => { setSelected(null); void load(); }} /> : <div className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">到貨入庫需要採購與庫存交易管理權限</div>)}
          </section>}
          <section><h3 className="mb-2 text-sm font-black">關聯單據</h3><div className="space-y-2">{(drawerRow.documents || []).map((doc) => <button key={doc.id} type="button" onClick={() => setSelectedDocument(doc)} className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-3 text-left hover:border-blue-300 hover:bg-blue-50"><span><span className="text-xs text-slate-500">{DOC[doc.document_type]}</span><span className="ml-2 font-mono text-sm font-bold text-blue-700">{doc.document_no}</span>{doc.status && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-600">{DOC_STATUS[doc.status] || doc.status}</span>}</span><ArrowRight className="h-4 w-4 text-slate-400" /></button>)}{!(drawerRow.documents || []).length && <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">執行出庫、調撥或採購後，單號會顯示在這裡。</div>}</div></section>
          {(drawerRow.events || []).length > 0 && <section><h3 className="mb-2 text-sm font-black">處理紀錄</h3><div className="space-y-2">{drawerRow.events?.map((event) => { const exceptional = event.event_type.includes('EXCEPTION') || event.event_type.includes('PROBLEM'); return <div key={event.id} className={`rounded-md border px-3 py-2 text-sm ${exceptional ? 'border-red-100 bg-red-50' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-center justify-between gap-3"><div className={`font-bold ${exceptional ? 'text-red-800' : 'text-slate-800'}`}>{event.title}</div><time className="shrink-0 text-[11px] text-slate-400">{new Date(event.created_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time></div>{event.description && <div className={`mt-1 text-xs ${exceptional ? 'text-red-700' : 'text-slate-600'}`}>{event.description}</div>}</div>; })}</div></section>}
          {capabilities.manage && !['COMPLETED','CANCELED'].includes(drawerRow.status) && <section className="border-t border-slate-200 pt-4">
            {!showException ? <button type="button" onClick={() => setShowException(true)} className="h-9 rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50">登錄異常</button> : <div className="rounded-md border border-red-200 bg-red-50 p-3"><div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]"><select value={exceptionType} onChange={(event) => setExceptionType(event.target.value)} className="h-10 rounded-md border border-red-200 bg-white px-3 text-sm">{['少收','未收','破損','收錯','取消'].map((item) => <option key={item}>{item}</option>)}</select><input value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} placeholder="說明實際狀況" className="h-10 rounded-md border border-red-200 bg-white px-3 text-sm" /></div><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setShowException(false)} className="h-9 px-3 text-xs font-bold text-slate-600">取消</button><button type="button" onClick={() => void reportException(drawerRow)} disabled={!exceptionNote.trim() || Boolean(savingDecision)} className="h-9 rounded-md bg-red-600 px-3 text-xs font-bold text-white disabled:bg-slate-300">{savingDecision === 'EXCEPTION' ? '儲存中' : '確認登錄'}</button></div></div>}
          </section>}
        </div>
      </aside>
    </div>}
    {selectedDocument && <LinkedPartDocumentDrawer document={selectedDocument} onClose={() => setSelectedDocument(null)} />}
  </div>;
}
