'use client';

import { useEffect, useState } from 'react';
import { Package, RefreshCw, X } from 'lucide-react';

export type LinkedPartDocument = { document_type: string; document_id?: string; document_no: string; quantity?: number | null; status?: string | null };
const LABEL: Record<string, string> = { STOCK_ISSUE: '出庫單', TRANSFER: '調撥單', PURCHASE: '採購單' };
const text = (value: unknown) => value === null || value === undefined || value === '' ? '-' : String(value);
const money = (value: unknown) => value === null || value === undefined || value === '' ? '-' : Number(value).toLocaleString('zh-TW');

export default function LinkedPartDocumentDrawer({ document, onClose }: { document: LinkedPartDocument; onClose: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!document.document_id) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/general-affairs/part-fulfillments/documents/${document.document_type}/${document.document_id}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => { const json = await response.json(); if (!response.ok) throw new Error(json.error || '單據載入失敗'); return json.data; })
      .then(setDetail).catch((loadError) => { if (loadError?.name !== 'AbortError') setError(loadError instanceof Error ? loadError.message : '單據載入失敗'); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [document.document_id, document.document_type]);

  const rows: Array<[string, unknown]> = document.document_type === 'TRANSFER' ? [
    ['狀態', detail?.status || document.status], ['來源位置', detail?.source_location?.name], ['目的位置', detail?.destination_location?.name], ['運送方式', detail?.shipping_method], ['原因', detail?.reason],
  ] : document.document_type === 'PURCHASE' ? [
    ['供應商', detail?.vendor?.name || detail?.vendor_name], ['核准數量', `${text(detail?.approved_quantity)} ${text(detail?.approved_unit)}`], ['預估金額', money(detail?.estimated_amount)], ['實際採購', money(detail?.final_amount)], ['預計到貨', detail?.expected_delivery_date], ['到貨方式', detail?.delivery_method],
  ] : [
    ['料件', detail?.part ? `${detail.part.part_code || ''} ${detail.part.name || ''}` : null], ['庫存位置', detail?.location?.name], ['出庫數量', detail?.quantity_input ?? document.quantity], ['庫存變化', detail ? `${text(detail.balance_before)} → ${text(detail.balance_after)}` : null], ['原因', detail?.reason],
  ];

  return <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/30" onClick={onClose}><aside className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white p-4"><div><div className="text-xs font-bold text-slate-500">{LABEL[document.document_type] || '單據'}</div><div className="mt-1 font-mono text-lg font-black text-blue-700">{document.document_no}</div></div><button type="button" onClick={onClose} aria-label="關閉單據明細" className="grid h-9 w-9 place-items-center rounded-md hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="p-5">{loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />載入單據明細...</div> : error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : <><div className="flex items-center gap-2 font-black"><Package className="h-4 w-4 text-blue-700" />單據內容</div><dl className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-4 py-3 text-sm"><dt className="text-slate-500">{label}</dt><dd className="font-semibold text-slate-900">{text(value)}</dd></div>)}</dl>{detail?.items?.length > 0 && <div className="mt-4 space-y-2">{detail.items.map((item: any) => <div key={item.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm"><div className="font-bold">{item.part?.part_code} {item.part?.name}</div><div className="mt-1 text-slate-500">{item.quantity_input} {item.part?.base_unit || ''}</div></div>)}</div>}</>}</div></aside></div>;
}
