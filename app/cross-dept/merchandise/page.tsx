'use client';

import { useState, useEffect, useCallback } from 'react';
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
  responder?: { full_name: string | null } | null;
}

// 依商品編號聚合後的結構（商品部視角）
interface AggregatedProduct {
  product_code: string;
  product_name: string;
  reports: StockoutReport[];
  response: StockoutResponse | null;
}

// ── 新增回報 Modal ──────────────────────────────────────────────
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">新增缺貨回報</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              商品編號 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.product_code}
              onChange={e => setForm(f => ({ ...f, product_code: e.target.value }))}
              placeholder="例：A001"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              商品名稱 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.product_name}
              onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
              placeholder="例：感冒糖漿"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              需求數量 <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={1}
              value={form.required_qty}
              onChange={e => setForm(f => ({ ...f, required_qty: Math.max(1, Number(e.target.value)) }))}
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
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            送出回報
          </button>
        </div>
      </div>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!content.trim()) {
      setError('回覆內容不得為空');
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
  const [responses, setResponses] = useState<Map<string, StockoutResponse>>(new Map());
  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<'all' | 'my-store'>('all');
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [respondTarget, setRespondTarget] = useState<AggregatedProduct | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'responded'>('pending');

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

  // 載入回報資料
  const loadData = useCallback(async () => {
    if (permLoading) return;
    setLoading(true);
    try {
      // 決定 endpoint（my-store 時並行查詢所有管轄門市）
      let fetchedReports: StockoutReport[] = [];
      if (activeTab === 'my-store' && userManagedStores.length > 0) {
        const results = await Promise.all(
          userManagedStores.map(s =>
            fetch(`/api/stockout-reports?store_id=${s.id}`).then(r => r.json())
          )
        );
        fetchedReports = results.flatMap(d => d.data ?? []);
      } else {
        const res = await fetch('/api/stockout-reports');
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        fetchedReports = data.data ?? [];
      }
      setReports(fetchedReports);

      // 批次取回覆
      const codes = Array.from(new Set(fetchedReports.map(r => r.product_code)));
      if (codes.length > 0) {
        const rRes = await fetch(`/api/stockout-responses?product_codes=${codes.join(',')}`);
        const rData = await rRes.json();
        const map = new Map<string, StockoutResponse>();
        (rData.data ?? []).forEach((r: StockoutResponse) => map.set(r.product_code, r));
        setResponses(map);
      } else {
        setResponses(new Map());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [permLoading, activeTab, userManagedStores]);

  useEffect(() => { loadData(); }, [loadData]);

  // 聚合：依商品編號 group by
  const aggregated: AggregatedProduct[] = (() => {
    const map = new Map<string, AggregatedProduct>();
    const filtered = filterStatus === 'all' ? reports
      : reports.filter(r => r.status === filterStatus);
    for (const r of filtered) {
      if (!map.has(r.product_code)) {
        map.set(r.product_code, {
          product_code: r.product_code,
          product_name: r.product_name,
          reports: [],
          response: responses.get(r.product_code) ?? null,
        });
      }
      map.get(r.product_code)!.reports.push(r);
    }
    return Array.from(map.values()).sort((a, b) => a.product_code.localeCompare(b.product_code));
  })();

  const pendingCount = reports.filter(r => r.status === 'pending').length;
  // 待回覆的不重複商品數
  const pendingProductCount = new Set(reports.filter(r => r.status === 'pending').map(r => r.product_code)).size;

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
              <h1 className="text-2xl font-bold text-gray-900">商品部 — 缺貨商品管理</h1>
              <p className="text-sm text-gray-500">各門市缺貨回報彙整 · 商品部統一回覆</p>
            </div>
          </div>
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
            <p className="text-2xl font-bold text-green-600">{responses.size}</p>
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
                      {/* 商品部回覆 */}
                      {prod.response && (
                        <div className="px-5 py-4 bg-green-50 border-b border-green-100">
                          <div className="flex items-start gap-2 mb-1">
                            <MessageSquare className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                            <p className="text-xs font-semibold text-green-700">商品部回覆</p>
                            <span className="ml-auto text-xs text-gray-400">
                              {prod.response.responder?.full_name ?? '－'} ·{' '}
                              {new Date(prod.response.responded_at).toLocaleString('zh-TW', {
                                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                              })}
                            </span>
                          </div>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap ml-6">
                            {prod.response.response_content}
                          </p>
                        </div>
                      )}

                      {/* 各門市回報明細 */}
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {showAddModal && userManagedStores.length > 0 && (
        <AddReportModal
          stores={userManagedStores}
          onClose={() => setShowAddModal(false)}
          onSaved={() => { setShowAddModal(false); loadData(); }}
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
          onSaved={() => { setRespondTarget(null); loadData(); }}
        />
      )}
    </div>
  );
}
