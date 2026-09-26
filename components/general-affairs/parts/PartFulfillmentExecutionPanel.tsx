'use client';

import { useEffect, useMemo, useState } from 'react';
import { PackageCheck, RefreshCw, ShoppingCart } from 'lucide-react';

type Props = {
  mode: 'STOCK_ISSUE' | 'PURCHASE' | 'PURCHASE_RECEIPT';
  request: { id: string; part_id?: string | null; desired_quantity?: number | null; desired_unit?: string | null; title: string };
  remainingQuantity?: number | null;
  onCompleted: () => void;
};

function newKey() { return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
async function responseJson(response: Response) { const json = await response.json(); if (!response.ok) throw new Error(typeof json.error === 'string' ? json.error : json.error?.message || '操作失敗'); return json; }

export default function PartFulfillmentExecutionPanel({ mode, request, remainingQuantity, onCompleted }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<any[]>([]);
  const [locationParts, setLocationParts] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState(String(remainingQuantity ?? request.desired_quantity ?? ''));
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [expectedDate, setExpectedDate] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const url = mode === 'PURCHASE' ? `/api/general-affairs/requests/${request.id}/purchase-review` : '/api/general-affairs/inventory/options';
    fetch(url, { cache: 'no-store' }).then(responseJson).then((json) => {
      if (!active) return;
      if (mode !== 'PURCHASE') {
        setLocations(json.data?.locations || []); setLocationParts(json.data?.locationParts || []);
      } else {
        setVendors(json.data?.vendors || []);
        const review = json.data?.review;
        if (review) { setVendorId(review.vendor_id || ''); setVendorName(review.vendor_name || ''); setEstimatedAmount(review.estimated_amount ? String(review.estimated_amount) : ''); setExpectedDate(review.expected_delivery_date || ''); }
      }
    }).catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : '載入失敗')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [mode, request.id]);

  const stockRows = useMemo(() => locationParts.filter((item) => item.part_id === request.part_id), [locationParts, request.part_id]);
  const usableLocations = useMemo(() => locations.filter((location) => stockRows.some((item) => item.location_id === location.id && Number(item.currentBalance?.quantity_base || 0) > 0)), [locations, stockRows]);
  const selectedRow = stockRows.find((item) => item.location_id === locationId);
  const exceedsRemaining = Number(remainingQuantity || 0) > 0 && Number(quantity || 0) > Number(remainingQuantity);

  async function submitStock() {
    if (!locationId || !request.part_id || !quantity) return;
    setSubmitting(true); setError('');
    try {
      await responseJson(await fetch(`/api/general-affairs/requests/${request.id}/stock-issue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId, partId: request.part_id, quantity: Number(quantity), inputUnitType: 'BASE', reason: request.title || '門市需求出庫', notes: '', idempotencyKey: newKey() }) }));
      onCompleted();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '出庫失敗'); }
    finally { setSubmitting(false); }
  }

  async function submitPurchase() {
    if (!quantity) return;
    setSubmitting(true); setError('');
    try {
      await responseJson(await fetch(`/api/general-affairs/requests/${request.id}/purchase-review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'PURCHASE', vendorId: vendorId || null, vendorName: vendorName || null, approvedQuantity: Number(quantity), approvedUnit: request.desired_unit || '個', estimatedAmount: estimatedAmount ? Number(estimatedAmount) : null, expectedDeliveryDate: expectedDate || null, deliveryMethod: '總務採購後配送', decisionNote: '料件處理中心確認進入採購。', publicNote: '總務已進入採購處理。' }) }));
      onCompleted();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '採購資料儲存失敗'); }
    finally { setSubmitting(false); }
  }

  async function submitPurchaseReceipt() {
    if (!locationId || !request.part_id || !quantity) return;
    setSubmitting(true); setError('');
    try {
      await responseJson(await fetch(`/api/general-affairs/requests/${request.id}/purchase-receipt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId, partId: request.part_id, quantity: Number(quantity), inputUnitType: 'BASE', reason: '採購到貨入庫', notes: '', requestStoreConfirmation: true, idempotencyKey: newKey() }) }));
      onCompleted();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : '採購到貨入庫失敗'); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div className="mt-3 flex items-center gap-2 rounded-md bg-white px-3 py-3 text-xs font-semibold text-blue-700"><RefreshCw className="h-4 w-4 animate-spin" />載入處理資料...</div>;
  return <div className="mt-3 rounded-md border border-blue-200 bg-white p-3">
    {error && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700">{error}</div>}
    {mode === 'STOCK_ISSUE' ? <>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-700">來源位置<select value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="">請選擇</option>{usableLocations.map((location) => <option key={location.id} value={location.id}>{location.name}｜可用 {Number(stockRows.find((item) => item.location_id === location.id)?.currentBalance?.quantity_base || 0).toLocaleString()}</option>)}</select></label><label className="text-xs font-bold text-slate-700">出庫數量<input type="number" min="0.0001" max={remainingQuantity || undefined} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" /></label></div>
      {selectedRow && <div className="mt-2 text-xs font-semibold text-slate-500">目前可用 {Number(selectedRow.currentBalance?.quantity_base || 0).toLocaleString()} {selectedRow.part?.base_unit || request.desired_unit || ''}</div>}
      {exceedsRemaining && <div className="mt-2 text-xs font-bold text-red-600">不可超過剩餘需求量 {remainingQuantity}</div>}
      <button type="button" onClick={() => void submitStock()} disabled={submitting || !locationId || !quantity || exceedsRemaining} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-700 text-sm font-bold text-white disabled:bg-slate-300">{submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}確認出庫</button>
    </> : mode === 'PURCHASE' ? <>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-700">供應商<select value={vendorId} onChange={(event) => { setVendorId(event.target.value); const vendor = vendors.find((item) => item.id === event.target.value); if (vendor) setVendorName(vendor.name); }} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="">自行填寫</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>{!vendorId && <label className="text-xs font-bold text-slate-700">供應商名稱<input value={vendorName} onChange={(event) => setVendorName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" /></label>}<label className="text-xs font-bold text-slate-700">核准數量<input type="number" min="0.01" max={remainingQuantity || undefined} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" /></label><label className="text-xs font-bold text-slate-700">預估金額<input type="number" min="0" value={estimatedAmount} onChange={(event) => setEstimatedAmount(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" /></label><label className="text-xs font-bold text-slate-700">預計到貨日<input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" /></label></div>
      {exceedsRemaining && <div className="mt-2 text-xs font-bold text-red-600">不可超過剩餘需求量 {remainingQuantity}</div>}
      <button type="button" onClick={() => void submitPurchase()} disabled={submitting || !quantity || exceedsRemaining} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-amber-600 text-sm font-bold text-white disabled:bg-slate-300">{submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}建立採購單</button>
    </> : <>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-700">入庫位置<select value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"><option value="">請選擇</option>{locations.filter((location) => stockRows.some((item) => item.location_id === location.id)).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="text-xs font-bold text-slate-700">實收數量<input type="number" min="0.0001" max={remainingQuantity || undefined} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm" /></label></div>
      <label className="mt-3 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"><input type="checkbox" checked readOnly className="h-4 w-4" />入庫後送門市確認收貨</label>
      {exceedsRemaining && <div className="mt-2 text-xs font-bold text-red-600">不可超過剩餘需求量 {remainingQuantity}</div>}
      <button type="button" onClick={() => void submitPurchaseReceipt()} disabled={submitting || !locationId || !quantity || exceedsRemaining} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-emerald-600 text-sm font-bold text-white disabled:bg-slate-300">{submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}確認到貨入庫</button>
    </>}
  </div>;
}
