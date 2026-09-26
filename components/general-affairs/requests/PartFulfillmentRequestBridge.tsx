'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ClipboardList, RefreshCw } from 'lucide-react';
import LinkedPartDocumentDrawer from '@/components/general-affairs/parts/LinkedPartDocumentDrawer';

type LinkedDocument = { id: string; document_type: string; document_id: string; document_no: string; quantity?: number | null; status?: string | null; created_at: string };
type Fulfillment = { id: string; fulfillment_no: string; status: string; current_step?: string | null; requested_quantity?: number | null; fulfilled_quantity?: number | null; unit?: string | null; documents?: LinkedDocument[] };
const DOCUMENT_LABEL: Record<string, string> = { STOCK_ISSUE: '出庫單', TRANSFER: '調撥單', PURCHASE: '採購單' };

export default function PartFulfillmentRequestBridge({ requestId }: { requestId: string }) {
  const [fulfillment, setFulfillment] = useState<Fulfillment | null>(null);
  const [document, setDocument] = useState<LinkedDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/general-affairs/part-fulfillments?requestId=${encodeURIComponent(requestId)}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '載入料件處理進度失敗');
      setFulfillment(json.data?.[0] || null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : '載入失敗'); }
    finally { setLoading(false); }
  }, [requestId]);
  useEffect(() => { void load(); }, [load]);

  async function createFulfillment() {
    setSubmitting(true); setError('');
    try {
      const response = await fetch('/api/general-affairs/part-fulfillments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '建立料件處理單失敗');
      await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '建立失敗'); }
    finally { setSubmitting(false); }
  }

  return <>
    <div className="rounded-md border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="flex items-center gap-2 font-black text-slate-950"><ClipboardList className="h-4 w-4 text-blue-700" />料件後續處理</div>{fulfillment && <div className="mt-1 font-mono text-xs font-bold text-blue-700">{fulfillment.fulfillment_no}</div>}</div>
        <button type="button" onClick={() => void load()} aria-label="更新料件進度" className="grid h-9 w-9 place-items-center rounded-md border border-blue-200 bg-white text-blue-700"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700">{error}</div>}
      {!loading && !fulfillment && <button type="button" onClick={() => void createFulfillment()} disabled={submitting} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-bold text-white disabled:bg-slate-300">{submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}交給料件處理中心</button>}
      {fulfillment && <div className="mt-3">
        <div className="rounded-md bg-white px-3 py-2 text-sm font-bold text-slate-800">{fulfillment.current_step || '等待處理'}</div>
        <div className="mt-2 flex flex-wrap gap-2">{(fulfillment.documents || []).map((item) => <button key={item.id} type="button" onClick={() => setDocument(item)} className="rounded-md border border-blue-200 bg-white px-3 py-2 font-mono text-xs font-bold text-blue-700 hover:bg-blue-100">{DOCUMENT_LABEL[item.document_type] || '單據'} {item.document_no}</button>)}{!(fulfillment.documents || []).length && <span className="text-xs font-semibold text-blue-700">尚未建立執行單據</span>}</div>
        <a href={`/general-affairs/part-fulfillments?fulfillmentId=${encodeURIComponent(fulfillment.id)}`} className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-100">前往料件處理中心<ArrowRight className="h-3.5 w-3.5" /></a>
      </div>}
    </div>
    {document && <LinkedPartDocumentDrawer document={document} onClose={() => setDocument(null)} />}
  </>;
}
