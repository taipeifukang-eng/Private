'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  ShoppingCart, Plus, MessageSquare, Trash2, ChevronDown, ChevronUp,
  Loader2, CheckCircle, Clock, AlertCircle, X, Send, Store,
  RefreshCw, Package
} from 'lucide-react';

// ── 型別 ──────────────────────────────────────────────────────
interface StockoutReport {
  id: string;
  store_id: string;
  product_code: string;
  product_name: string;
  required_qty: number;
  reported_by: string;
  status: 'pending' | 'responded';
  created_at: string;
  store?: { id: string; store_code: string; store_name: string } | null;
  reporter?: { full_name: string | null } | null;
}

interface StockoutResponse {
  id: string;
  product_code: string;
  product_name: string;
  response_content: string;
  responded_by: string;
  responded_at: string;
  eta_date: string | null;
  responder?: { full_name: string | null } | null;
}

interface MonthBucket {
  month: string;
  count: number;
}

const getDateInTaipei = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
};

const getResponseGraceLowerBound = () => getDateInTaipei(-15);

const isResponseActive = (response: StockoutResponse | null | undefined) => {
  if (!response) return false;
  if (!response.eta_date) return true;
  // 預計到貨日在「今天往前15天」內，仍視為有效回覆
  return response.eta_date >= getResponseGraceLowerBound();
};

// 依商品編號聚合後的結構（商品部視角）
interface AggregatedProduct {
  product_code: string;
  product_name: string;
  reports: StockoutReport[];
  response: StockoutResponse | null;
}

// ── 新增回報 Modal ──────────────────────────────────────────────
interface ProductSuggestion {
  product_code: string;
  product_name: string;
  unit: string;
}

function AddReportModal({
  stores,
  onClose,
  onSaved,
}: {
  stores: { id: string; store_code: string; store_name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ product_code: '', product_name: '', required_qty: 1 });
  const [selectedStoreId, setSelectedStoreId] = useState(stores[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingResponse, setExistingResponse] = useState<StockoutResponse | null>(null);
  const [showResponseAlertModal, setShowResponseAlertModal] = useState(false);
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState('');
  const [nameFromMaster, setNameFromMaster] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const requiredQtyInputRef = useRef<HTMLInputElement>(null);
  const searchSeqRef = useRef(0);

  // 點擊外部關閉下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounce 搜尋商品主檔（降低延遲至 80ms，結合 API 優化可感知改善）
  useEffect(() => {
    const code = form.product_code.trim();
    const seq = ++searchSeqRef.current;

    if (!code) {
      setSuggestions([]);
      setShowSuggestions(false);
      setExistingResponse(null);
      setShowResponseAlertModal(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const [masterRes, responseRes] = await Promise.all([
          fetch(`/api/products-master?q=${encodeURIComponent(code)}`),
          fetch(`/api/stockout-responses?product_codes=${encodeURIComponent(code)}`),
        ]);
        const masterData = await masterRes.json();
        const responseData = await responseRes.json();

        // 僅處理最新一次搜尋結果，避免舊請求覆蓋新輸入造成 UI 閃爍或錯位
        if (searchSeqRef.current !== seq) return;

        setSuggestions(masterData.data ?? []);
        setShowSuggestions((masterData.data ?? []).length > 0);

        const foundResponse = (responseData.data ?? [])[0] ?? null;
        setExistingResponse(foundResponse);
      } catch {
        if (searchSeqRef.current !== seq) return;
        setSuggestions([]);
        setExistingResponse(null);
      }
    }, 80);
    return () => clearTimeout(t);
  }, [form.product_code]);

  const fetchResponseByCode = async (code: string) => {
    const responseRes = await fetch(`/api/stockout-responses?product_codes=${encodeURIComponent(code)}`);
    const responseData = await responseRes.json();
    return (responseData.data ?? [])[0] ?? null;
  };

  const fetchProductSuggestionsByCode = async (code: string): Promise<ProductSuggestion[]> => {
    const masterRes = await fetch(`/api/products-master?q=${encodeURIComponent(code)}`);
    const masterData = await masterRes.json();
    return masterData.data ?? [];
  };

  const handleSelectSuggestion = (s: ProductSuggestion) => {
    setForm(f => ({ ...f, product_code: s.product_code, product_name: s.product_name }));
    setSelectedUnit(s.unit);
    setNameFromMaster(true);
    setSuggestions([]);
    setShowSuggestions(false);
    setTimeout(() => {
      requiredQtyInputRef.current?.focus();
      requiredQtyInputRef.current?.select();
    }, 0);
  };

  const handleProductCodeEnter = async () => {
    const code = form.product_code.trim();
    try {
      if (!code) return;

      // 先用當前建議清單找完整匹配；若尚未載入完成，改用即時查詢補抓
      let matchedSuggestion = suggestions.find(s => s.product_code === code);
      if (!matchedSuggestion) {
        const freshSuggestions = await fetchProductSuggestionsByCode(code);
        setSuggestions(freshSuggestions);
        matchedSuggestion = freshSuggestions.find(s => s.product_code === code);
      }

      // 無完整匹配就不帶入品名，也不彈窗
      if (!matchedSuggestion) return;

      handleSelectSuggestion(matchedSuggestion);

      // Enter 確認後，立即以該商品編號查詢回覆並決定是否彈窗
      const foundResponse = await fetchResponseByCode(matchedSuggestion.product_code);
      setExistingResponse(foundResponse);
      setShowResponseAlertModal(!!foundResponse);
    } catch {
      setShowResponseAlertModal(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.product_code.trim() || !form.product_name.trim()) {
      setError('商品編號與商品名稱為必填');
      return;
    }
    if (!selectedStoreId) {
      setError('請選擇門市');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/stockout-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: selectedStoreId, ...form }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-visible">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">新增缺貨回報</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-visible">
          {stores.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                回報門市 <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedStoreId}
                onChange={e => setSelectedStoreId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.store_code} {s.store_name}</option>
                ))}
              </select>
            </div>
          )}
          {/* 商品編號 + 搜尋下拉 */}
          <div className="relative" ref={suggestionsRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              商品編號 <span className="text-red-500">*</span>
            </label>
            <input
              type="search"
              value={form.product_code}
              onChange={e => {
                setForm(f => ({ ...f, product_code: e.target.value }));
                setSelectedUnit('');
                setNameFromMaster(false);
                setShowResponseAlertModal(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleProductCodeEnter();
                }
              }}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              placeholder="輸入編號可搜尋商品主檔"
              autoComplete="off"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute z-[200] left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                {suggestions.map(s => (
                  <li
                    key={s.product_code}
                    onMouseDown={() => handleSelectSuggestion(s)}
                    className="px-3 py-2 text-sm cursor-pointer hover:bg-orange-50 flex items-center justify-between gap-2"
                  >
                    <span>
                      <span className="font-medium text-gray-900">{s.product_code}</span>
                      <span className="text-gray-500 ml-2">{s.product_name}</span>
                    </span>
                    {s.unit && (
                      <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded shrink-0">{s.unit}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* 商品名稱 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              商品名稱 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                value={form.product_name}
                onChange={e => {
                  setForm(f => ({ ...f, product_name: e.target.value }));
                  setNameFromMaster(false);
                }}
                placeholder="例：感冒糖漿"
                readOnly={nameFromMaster}
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 ${
                  nameFromMaster ? 'bg-gray-50 border-gray-200 text-gray-700' : 'border-gray-300'
                }`}
              />
              {selectedUnit && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded pointer-events-none">
                  {selectedUnit}
                </span>
              )}
            </div>
            {nameFromMaster && (
              <p className="mt-1 text-xs text-gray-400">名稱由主檔自動帶入，如需修改請直接編輯</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              需求數量 <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1}
              ref={requiredQtyInputRef}
              value={form.required_qty}
              onChange={e => setForm(f => ({ ...f, required_qty: Math.max(1, Number(e.target.value)) }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          {existingResponse && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${isResponseActive(existingResponse)
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              <p className="font-semibold mb-1">
                此商品已有商品部回覆
                {existingResponse.eta_date ? `（預計到貨：${existingResponse.eta_date}）` : ''}
              </p>
              {!isResponseActive(existingResponse) && (
                <p className="text-xs mb-1">此回覆預計到貨日已超過15天緩衝，建議仍送出回報讓商品部更新進度。</p>
              )}
              <p className="text-xs whitespace-pre-wrap">{existingResponse.response_content}</p>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            送出回報
          </button>
        </div>
      </div>

      {showResponseAlertModal && existingResponse && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl border border-gray-200">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" />
                <h4 className="text-base font-semibold text-gray-900">商品部回覆提醒</h4>
              </div>
              <button
                type="button"
                onClick={() => setShowResponseAlertModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100"
                aria-label="關閉提醒"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-gray-800">
                此商品已有商品部回覆
                {existingResponse.eta_date ? `（預計到貨：${existingResponse.eta_date}）` : ''}
              </p>
              {!isResponseActive(existingResponse) && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                  此回覆預計到貨日已超過15天緩衝，建議仍送出回報讓商品部更新進度。
                </p>
              )}
              <p className="text-sm whitespace-pre-wrap text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                {existingResponse.response_content}
              </p>
            </div>

            <div className="px-5 py-3 border-t flex justify-end">
              <button
                type="button"
                onClick={() => setShowResponseAlertModal(false)}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 商品部回覆 Modal ─────────────────────────────────────────────
function RespondModal({
  product,
  existingResponse,
  onClose,
  onSaved,
}: {
  product: AggregatedProduct;
  existingResponse: StockoutResponse | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(existingResponse?.response_content ?? '');
  const [etaDate, setEtaDate] = useState(existingResponse?.eta_date ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!content.trim()) {
      setError('回覆內容不得為空');
      return;
    }
    if (!etaDate) {
      setError('請填寫預計到貨日');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/stockout-responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_code: product.product_code,
          product_name: product.product_name,
          response_content: content,
          eta_date: etaDate,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const totalQty = product.reports.reduce((s, r) => s + r.required_qty, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {existingResponse ? '編輯回覆' : '回覆缺貨商品'}
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              [{product.product_code}] {product.product_name}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* 門市需求彙整 */}
        <div className="px-6 pt-4">
          <p className="text-xs font-medium text-gray-500 mb-2">
            共 {product.reports.length} 間門市回報，合計需求 {totalQty} 件
            <span className="mx-1.5 text-gray-300">·</span>
            最早 {new Date(Math.min(...product.reports.map(r => new Date(r.created_at).getTime()))).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })} 回報
          </p>
          <div className="bg-orange-50 border border-orange-100 rounded-lg p-3 max-h-36 overflow-y-auto space-y-1">
            {product.reports.map(r => (
              <div key={r.id} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">
                  {r.store?.store_code} {r.store?.store_name}
                </span>
                <span className="font-medium text-orange-700">需求 {r.required_qty} 件</span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            回覆內容（缺貨原因 / 預計到貨時間 / 處理說明）
            <span className="text-red-500 ml-1">*</span>
          </label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            rows={4}
            placeholder="例：目前廠商缺貨，預計下週三可到貨，請各門市耐心等候..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              預計到貨日 <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={etaDate}
              onChange={e => setEtaDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {existingResponse ? '更新回覆' : '送出回覆'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主頁面 ──────────────────────────────────────────────────────
export default function MerchandisePage() {
  const supabase = createClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [userStoreId, setUserStoreId] = useState<string | null>(null);
  const [userManagedStores, setUserManagedStores] = useState<{ id: string; store_code: string; store_name: string }[]>([]);
  const [canViewAll, setCanViewAll] = useState(false);
  const [canRespond, setCanRespond] = useState(false);
  const [permLoading, setPermLoading] = useState(true);

  const [reports, setReports] = useState<StockoutReport[]>([]);
  const [activeResponses, setActiveResponses] = useState<Map<string, StockoutResponse>>(new Map());
  const [latestResponses, setLatestResponses] = useState<Map<string, StockoutResponse>>(new Map());
  const [responseHistoryMap, setResponseHistoryMap] = useState<Map<string, StockoutResponse[]>>(new Map());
  const [responseHistoryOpen, setResponseHistoryOpen] = useState<Set<string>>(new Set());
  const [responseHistoryLoading, setResponseHistoryLoading] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadTick, setLoadTick] = useState(0);
  const [monthBuckets, setMonthBuckets] = useState<MonthBucket[]>([]);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [activeTab, setActiveTab] = useState<'all' | 'my-store'>('all');
  const [activeToolTab, setActiveToolTab] = useState<'stockout'>('stockout');
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [respondTarget, setRespondTarget] = useState<AggregatedProduct | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'responded'>('pending');
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string>('all');
  const [useRecent30Days, setUseRecent30Days] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [isMonthCollapseOpen, setIsMonthCollapseOpen] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // 載入使用者資訊 & 權限
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setPermLoading(false); return; }
      setUserId(user.id);

      // 檢查權限
      const res = await fetch('/api/permissions/check-multiple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissionCodes: ['cross_dept.stockout.view_all', 'cross_dept.stockout.respond', 'cross_dept.stockout.submit'],
          mode: 'any',
        }),
      });
      const permData = await res.json();

      // 個別檢查
      const [viewAllRes, respondRes] = await Promise.all([
        fetch('/api/permissions/check', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionCode: 'cross_dept.stockout.view_all' }) }),
        fetch('/api/permissions/check', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionCode: 'cross_dept.stockout.respond' }) }),
      ]);
      const [vaD, rD] = await Promise.all([viewAllRes.json(), respondRes.json()]);
      const hasViewAll = vaD.allowed || false;
      const hasRespond = rD.allowed || false;
      setCanViewAll(hasViewAll);
      setCanRespond(hasRespond);

      // 取用戶所管轄門市（依 store_managers 表）
      const { data: storeManagerRows } = await supabase
        .from('store_managers')
        .select('store_id, stores(id, store_code, store_name)')
        .eq('user_id', user.id);
      const managed = (storeManagerRows ?? [])
        .map((sm: any) => sm.stores)
        .filter(Boolean)
        .map((s: any) => ({ id: s.id, store_code: s.store_code, store_name: s.store_name }))
        .sort((a: any, b: any) => a.store_code.localeCompare(b.store_code));
      setUserManagedStores(managed);
      if (managed.length > 0) setUserStoreId(managed[0].id);

      // 預設 tab
      if (!hasViewAll && !hasRespond) setActiveTab('my-store');
      setPermLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // 載入回報資料
  const loadData = useCallback(async () => {
    if (permLoading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      if (searchQuery) params.set('q', searchQuery);

      if (activeTab === 'my-store') {
        const myStoreIds = userManagedStores.map(s => s.id);
        if (selectedStoreFilter !== 'all') {
          params.set('store_id', selectedStoreFilter);
        } else if (myStoreIds.length > 0) {
          params.set('store_ids', myStoreIds.join(','));
        }
      } else if (selectedStoreFilter !== 'all') {
        params.set('store_id', selectedStoreFilter);
      }

      if (useRecent30Days) {
        params.set('date_range', 'recent_30');
      } else if (selectedMonth) {
        params.set('month', selectedMonth);
      }

      const res = await fetch(`/api/stockout-reports?${params.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '載入失敗');

      const fetchedReports: StockoutReport[] = data.data ?? [];
      setReports(fetchedReports);
      setMonthBuckets(data.monthBuckets ?? []);
      setTotal(data.pagination?.total ?? fetchedReports.length);
      setTotalPages(data.pagination?.totalPages ?? 1);

      // 批次取回覆
      const codes = Array.from(new Set(fetchedReports.map(r => r.product_code)));
      if (codes.length > 0) {
        const rRes = await fetch(`/api/stockout-responses?product_codes=${codes.join(',')}`);
        const rData = await rRes.json();
        const latestMap = new Map<string, StockoutResponse>();
        const activeMap = new Map<string, StockoutResponse>();
        (rData.data ?? []).forEach((r: StockoutResponse) => {
          latestMap.set(r.product_code, r);
          if (isResponseActive(r)) activeMap.set(r.product_code, r);
        });
        setLatestResponses(latestMap);
        setActiveResponses(activeMap);
      } else {
        setLatestResponses(new Map());
        setActiveResponses(new Map());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [
    permLoading,
    activeTab,
    userManagedStores,
    searchQuery,
    selectedStoreFilter,
    useRecent30Days,
    selectedMonth,
    page,
    pageSize,
  ]);

  useEffect(() => { loadData(); }, [loadData, loadTick]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, filterStatus, selectedStoreFilter, useRecent30Days, selectedMonth]);

  const toggleResponseHistory = useCallback(async (productCode: string) => {
    setResponseHistoryOpen(prev => {
      const next = new Set(prev);
      if (next.has(productCode)) {
        next.delete(productCode);
      } else {
        next.add(productCode);
      }
      return next;
    });

    if (responseHistoryMap.has(productCode)) return;

    setResponseHistoryLoading(prev => new Set(prev).add(productCode));
    try {
      const res = await fetch(`/api/stockout-responses?history=1&product_code=${encodeURIComponent(productCode)}&page=1&pageSize=10`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '載入回覆歷程失敗');

      setResponseHistoryMap(prev => {
        const next = new Map(prev);
        next.set(productCode, data.data ?? []);
        return next;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setResponseHistoryLoading(prev => {
        const next = new Set(prev);
        next.delete(productCode);
        return next;
      });
    }
  }, [responseHistoryMap]);

  // 聚合：依商品編號 group by（先全部聚合，再依 responses 判斷狀態過濾）
  const aggregated: AggregatedProduct[] = (() => {
    const map = new Map<string, AggregatedProduct>();
    for (const r of reports) {
      if (!map.has(r.product_code)) {
        map.set(r.product_code, {
          product_code: r.product_code,
          product_name: r.product_name,
          reports: [],
          response: activeResponses.get(r.product_code) ?? null,
        });
      }
      map.get(r.product_code)!.reports.push(r);
    }
    const all = Array.from(map.values()).sort((a, b) => a.product_code.localeCompare(b.product_code));
    if (filterStatus === 'all') return all;
    if (filterStatus === 'responded') return all.filter(p => p.response !== null);
    // pending：responses Map 中沒有此商品
    return all.filter(p => p.response === null);
  })();

  // 待回覆品項數（依 responses 判斷）
  const allProductCodes = Array.from(new Set(reports.map(r => r.product_code)));
  const pendingProductCount = allProductCodes.filter(code => !activeResponses.has(code)).length;
  const isStoreView = !canViewAll && !canRespond;

  // 店長視角：已回覆品項預設展開，方便快速閱讀商品部回覆
  useEffect(() => {
    if (!isStoreView) return;
    const respondedCodes = allProductCodes.filter(code => activeResponses.has(code));
    if (respondedCodes.length === 0) return;
    setExpandedProducts(prev => {
      const next = new Set(prev);
      respondedCodes.forEach(code => next.add(code));
      return next;
    });
  }, [isStoreView, allProductCodes, activeResponses]);

  if (permLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (!canViewAll && !canRespond && !userStoreId) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-500">
        <div className="text-center space-y-2">
          <AlertCircle className="w-10 h-10 mx-auto text-red-400" />
          <p className="text-lg font-medium">沒有存取此頁面的權限</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* ── Header ── */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-500 rounded-xl flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">商品部管理</h1>
              <p className="text-sm text-gray-500">請先選擇工具分頁，再進行跨部門管理作業</p>
            </div>
          </div>
        </div>

        {/* ── 商品部工具 Tab ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-2 mb-6">
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveToolTab('stockout')}
              className={`px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeToolTab === 'stockout'
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              缺貨商品管理
            </button>
          </div>
        </div>

        {activeToolTab === 'stockout' && (
          <>
        {/* ── 查詢篩選 ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="search"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="搜尋商品編號 / 品名"
              className="md:col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            />

            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as 'all' | 'pending' | 'responded')}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="all">全部狀態</option>
              <option value="pending">待回覆</option>
              <option value="responded">已回覆</option>
            </select>

            <select
              value={selectedStoreFilter}
              onChange={e => setSelectedStoreFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <option value="all">全部門市</option>
              {userManagedStores.map(s => (
                <option key={s.id} value={s.id}>{s.store_code} {s.store_name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setUseRecent30Days(true);
                setSelectedMonth('');
              }}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                useRecent30Days ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              近 30 天（預設）
            </button>

            <button
              onClick={() => setIsMonthCollapseOpen(v => !v)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            >
              歷史月份 {isMonthCollapseOpen ? '收合' : '展開'}
            </button>
          </div>

          {isMonthCollapseOpen && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              {monthBuckets.length === 0 ? (
                <p className="text-xs text-gray-400">目前沒有可用的歷史月份資料</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {monthBuckets.map(bucket => (
                    <button
                      key={bucket.month}
                      onClick={() => {
                        setUseRecent30Days(false);
                        setSelectedMonth(bucket.month);
                      }}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        !useRecent30Days && selectedMonth === bucket.month
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                      }`}
                    >
                      {bucket.month}（{bucket.count}）
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 統計卡片 ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">全部回報筆數</p>
            <p className="text-2xl font-bold text-gray-900">{reports.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-orange-200 p-4">
            <p className="text-xs text-orange-600 mb-1">待回覆（品項數）</p>
            <p className="text-2xl font-bold text-orange-600">{pendingProductCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-green-200 p-4">
            <p className="text-xs text-green-600 mb-1">已回覆品項</p>
            <p className="text-2xl font-bold text-green-600">{activeResponses.size}</p>
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap items-center gap-3">
          {/* Tab（僅在有 view_all 時顯示） */}
          {(canViewAll || canRespond) && (
            <div className="flex rounded-lg overflow-hidden border border-gray-200 text-sm">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-4 py-1.5 transition-colors ${activeTab === 'all' ? 'bg-orange-500 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                全部門市
              </button>
              {userStoreId && (
                <button
                  onClick={() => setActiveTab('my-store')}
                  className={`px-4 py-1.5 border-l border-gray-200 transition-colors ${activeTab === 'my-store' ? 'bg-orange-500 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  我的門市
                </button>
              )}
            </div>
          )}

          {/* 篩選狀態 */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 text-sm">
            {(['all', 'pending', 'responded'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 first:rounded-l-none last:rounded-r-none border-l first:border-l-0 border-gray-200 transition-colors ${filterStatus === s ? 'bg-orange-500 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {s === 'all' ? '全部' : s === 'pending' ? '待回覆' : '已回覆'}
              </button>
            ))}
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            重新整理
          </button>

          <div className="ml-auto">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600"
            >
              <Plus className="w-4 h-4" />
              新增缺貨回報
            </button>
          </div>
        </div>

        {/* ── 清單 ── */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            載入中...
          </div>
        ) : aggregated.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>目前沒有任何缺貨回報</p>
          </div>
        ) : (
          <div className="space-y-3">
            {aggregated.map(prod => {
              const isExpanded = expandedProducts.has(prod.product_code);
              const hasResp = prod.response !== null;
              const latestResp = latestResponses.get(prod.product_code) ?? null;
              const hasExpiredResponse = !hasResp && !!latestResp && !isResponseActive(latestResp);
              const hideStoreDetails = isStoreView && hasResp;
              const totalQty = prod.reports.reduce((s, r) => s + r.required_qty, 0);

              return (
                <div
                  key={prod.product_code}
                  className={`bg-white rounded-xl border-2 overflow-hidden transition-colors ${
                    hasResp ? 'border-green-200' : 'border-orange-200'
                  }`}
                >
                  {/* 商品標題列 */}
                  <div
                    className={`flex items-center gap-3 px-5 py-3.5 cursor-pointer ${
                      hasResp ? 'bg-green-50 hover:bg-green-100' : 'bg-orange-50 hover:bg-orange-100'
                    }`}
                    onClick={() => setExpandedProducts(prev => {
                      const n = new Set(prev);
                      n.has(prod.product_code) ? n.delete(prod.product_code) : n.add(prod.product_code);
                      return n;
                    })}
                  >
                    {hasResp
                      ? <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                      : <Clock className="w-5 h-5 text-orange-500 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-gray-600">[{prod.product_code}]</span>
                        <span className="font-semibold text-gray-900">{prod.product_name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          hasResp ? 'bg-green-200 text-green-800' : 'bg-orange-200 text-orange-800'
                        }`}>
                          {hasResp ? '已回覆' : '待回覆'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {prod.reports.length} 間門市回報 · 合計需求 {totalQty} 件
                        <span className="mx-1.5 text-gray-300">·</span>
                        最早 {new Date(Math.min(...prod.reports.map(r => new Date(r.created_at).getTime()))).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })} 回報
                      </p>
                    </div>

                    {/* 商品部回覆按鈕 */}
                    {(canViewAll || canRespond) && (
                      <button
                        onClick={e => { e.stopPropagation(); setRespondTarget(prod); }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg shrink-0 transition-colors ${
                          hasResp
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-orange-500 text-white hover:bg-orange-600'
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        {hasResp ? '編輯回覆' : '回覆'}
                      </button>
                    )}

                    {isExpanded
                      ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                      : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    }
                  </div>

                  {/* 展開內容 */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-100">
                      {hasExpiredResponse && latestResp && (
                        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100">
                          <p className="text-xs font-semibold text-amber-700 mb-1">最近一次回覆（已過預計到貨日）</p>
                          <p className="text-xs text-amber-700 mb-1">
                            預計到貨：{latestResp.eta_date ?? '未填寫'} · 回覆時間：{new Date(latestResp.responded_at).toLocaleString('zh-TW', {
                              month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                            })}
                          </p>
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{latestResp.response_content}</p>
                        </div>
                      )}

                      {/* 商品部回覆 */}
                      {prod.response && (
                        <div className="px-5 py-3 bg-white">
                          <div className="ml-8 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                            <div className="flex items-start gap-2 mb-1">
                              <MessageSquare className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                              <p className="text-xs font-semibold text-emerald-700">商品部回覆</p>
                              <span className="ml-auto text-xs text-gray-400">
                                {prod.response.responder?.full_name ?? '－'} ·{' '}
                                {new Date(prod.response.responded_at).toLocaleString('zh-TW', {
                                  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                                })}
                              </span>
                            </div>
                            {prod.response.eta_date && (
                              <p className="text-xs text-emerald-700 ml-6 mb-1">預計到貨日：{prod.response.eta_date}</p>
                            )}
                            <p className="text-sm text-gray-800 whitespace-pre-wrap ml-6">
                              {prod.response.response_content}
                            </p>

                            <div className="ml-6 mt-3">
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  toggleResponseHistory(prod.product_code);
                                }}
                                className="text-xs text-emerald-700 hover:text-emerald-800 underline"
                              >
                                {responseHistoryOpen.has(prod.product_code) ? '收合回覆歷程' : '展開回覆歷程'}
                              </button>

                              {responseHistoryOpen.has(prod.product_code) && (
                                <div className="mt-2 space-y-2">
                                  {responseHistoryLoading.has(prod.product_code) ? (
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      載入歷程中...
                                    </div>
                                  ) : (
                                    (responseHistoryMap.get(prod.product_code) ?? [])
                                      .filter(h => !(prod.response && h.responded_at === prod.response.responded_at && h.response_content === prod.response.response_content))
                                      .slice(0, 10)
                                      .map(h => (
                                        <div key={h.id} className="rounded-lg border border-emerald-200 bg-white px-3 py-2">
                                          <p className="text-[11px] text-gray-500 mb-1">
                                            {new Date(h.responded_at).toLocaleString('zh-TW', {
                                              month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                                            })}
                                            {h.eta_date ? ` · ETA ${h.eta_date}` : ''}
                                          </p>
                                          <p className="text-xs text-gray-700 whitespace-pre-wrap">{h.response_content}</p>
                                        </div>
                                      ))
                                  )}

                                  {!responseHistoryLoading.has(prod.product_code) &&
                                    ((responseHistoryMap.get(prod.product_code) ?? []).filter(h => !(prod.response && h.responded_at === prod.response.responded_at && h.response_content === prod.response.response_content)).length === 0) && (
                                    <p className="text-xs text-gray-500">目前沒有更早的回覆歷程</p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 各門市回報明細 */}
                      {!hideStoreDetails && (
                        <div className="px-5 py-3">
                          <p className="text-xs font-medium text-gray-500 mb-2">門市回報明細</p>
                          <div className="space-y-2">
                            {prod.reports.map(r => (
                              <div key={r.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                                <Store className="w-4 h-4 text-gray-400 shrink-0" />
                                <span className="text-gray-600 font-mono text-xs">{r.store?.store_code}</span>
                                <span className="text-gray-800 font-medium flex-1">{r.store?.store_name}</span>
                                <span className="text-orange-600 font-semibold shrink-0">×{r.required_qty}</span>
                                <span className="text-xs text-gray-400 shrink-0">
                                  {new Date(r.created_at).toLocaleString('zh-TW', {
                                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                                  })}
                                </span>
                                {/* 本人可刪除自己的 */}
                                {r.reported_by === userId && (
                                  <button
                                    onClick={async () => {
                                      if (!confirm('確定刪除這筆回報？')) return;
                                      await fetch(`/api/stockout-reports?id=${r.id}`, { method: 'DELETE' });
                                      loadData();
                                    }}
                                    className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors shrink-0"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── 分頁 ── */}
        <div className="mt-4 bg-white rounded-xl border border-gray-200 p-3 flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            共 {total} 筆 · 第 {page} / {totalPages} 頁
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              上一頁
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              下一頁
            </button>
          </div>
        </div>
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {showAddModal && userManagedStores.length > 0 && (
        <AddReportModal
          stores={userManagedStores}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            // 若有「我的門市」tab，切換過去確保能看到剛新增的回報
            if (userStoreId) setActiveTab('my-store');
            setFilterStatus('all');
            setLoadTick(t => t + 1);
          }}
        />
      )}
      {showAddModal && userManagedStores.length === 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-sm text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-orange-400 mx-auto" />
            <p className="text-sm text-gray-700">您尚未被指派管理任何門市，無法提交缺貨回報</p>
            <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">關閉</button>
          </div>
        </div>
      )}
      {respondTarget && (
        <RespondModal
          product={respondTarget}
          existingResponse={respondTarget.response}
          onClose={() => setRespondTarget(null)}
          onSaved={() => {
            setRespondTarget(null);
            // 切換到「已回覆」篩選，讓使用者立即看到回覆結果
            setFilterStatus('responded');
            setLoadTick(t => t + 1);
          }}
        />
      )}
    </div>
  );
}
