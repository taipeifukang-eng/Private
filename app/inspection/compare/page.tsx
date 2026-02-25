'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  GitCompare,
  Store,
  Calendar,
  User,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Camera,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface InspectionRecord {
  id: string;
  store_id: string;
  inspector_id: string;
  inspection_date: string;
  status: string;
  total_score: number;
  max_possible_score: number;
  grade: string;
  inspection_type: string;
  inspector_name?: string;
  store_name?: string;
  store_code?: string;
}

interface CompareResult {
  template_id: string;
  section: string;
  section_name: string;
  section_order: number;
  item_name: string;
  item_description: string;
  item_order: number;
  max_score: number;
  supervisor_deduction: number;
  supervisor_score: number;
  supervisor_notes: string;
  supervisor_photos: string[];
  manager_deduction: number;
  manager_score: number;
  manager_notes: string;
  manager_photos: string[];
  status: 'same' | 'supervisor_only' | 'manager_only' | 'both_different';
}

export default function InspectionComparePageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    }>
      <InspectionComparePage />
    </Suspense>
  );
}

function InspectionComparePage() {
  const searchParams = useSearchParams();
  const initialStoreId = searchParams.get('store_id') || '';
  const initialManagerId = searchParams.get('manager_id') || '';

  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [stores, setStores] = useState<any[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState(initialStoreId);
  const [noPermission, setNoPermission] = useState(false);
  
  // 督導巡店記錄列表 & 經理巡店記錄列表（同一門市）
  const [supervisorRecords, setSupervisorRecords] = useState<InspectionRecord[]>([]);
  const [managerRecords, setManagerRecords] = useState<InspectionRecord[]>([]);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState('');
  const [selectedManagerId, setSelectedManagerId] = useState(initialManagerId);
  
  // 對比結果
  const [compareResults, setCompareResults] = useState<CompareResult[]>([]);
  const [hasCompared, setHasCompared] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // 督導/經理的其他建議事項
  const [supervisorOverallNotes, setSupervisorOverallNotes] = useState('');
  const [managerOverallNotes, setManagerOverallNotes] = useState('');

  // 照片燈箱
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);

  // 載入門市列表 & 權限檢查
  useEffect(() => {
    const loadStores = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 權限檢查
      const { data: hasPerm } = await supabase.rpc('has_permission', {
        p_user_id: user.id,
        p_permission_code: 'inspection.compare',
      });
      if (!hasPerm) {
        setNoPermission(true);
        setLoading(false);
        return;
      }

      const { data: storesData } = await supabase
        .from('stores')
        .select('id, store_name, store_code, short_name')
        .eq('is_active', true)
        .order('store_code');

      setStores(storesData || []);
      setLoading(false);
    };
    loadStores();
  }, []);

  // 門市變更時載入該門市的督導 & 經理巡店記錄
  useEffect(() => {
    if (!selectedStoreId) {
      setSupervisorRecords([]);
      setManagerRecords([]);
      setSelectedSupervisorId('');
      if (!initialManagerId) setSelectedManagerId('');
      setHasCompared(false);
      return;
    }

    const loadRecords = async () => {
      const supabase = createClient();

      // 查督導巡店（completed）
      const { data: supData } = await supabase
        .from('inspection_masters')
        .select('id, store_id, inspector_id, inspection_date, status, total_score, max_possible_score, grade, inspection_type')
        .eq('store_id', selectedStoreId)
        .eq('status', 'completed')
        .or('inspection_type.eq.supervisor,inspection_type.is.null')
        .order('inspection_date', { ascending: false })
        .limit(20);

      // 查經理巡店（completed）
      const { data: mgrData } = await supabase
        .from('inspection_masters')
        .select('id, store_id, inspector_id, inspection_date, status, total_score, max_possible_score, grade, inspection_type')
        .eq('store_id', selectedStoreId)
        .eq('status', 'completed')
        .eq('inspection_type', 'manager')
        .order('inspection_date', { ascending: false })
        .limit(20);

      // 批量取得巡店人員姓名
      const allInspectorIds = Array.from(new Set([
        ...(supData || []).map(r => r.inspector_id),
        ...(mgrData || []).map(r => r.inspector_id),
      ]));

      let inspectorMap = new Map<string, string>();
      if (allInspectorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', allInspectorIds);
        (profiles || []).forEach(p => inspectorMap.set(p.id, p.full_name));
      }

      const supRecords = (supData || []).map(r => ({
        ...r,
        inspector_name: inspectorMap.get(r.inspector_id) || '未知',
      }));
      const mgrRecords = (mgrData || []).map(r => ({
        ...r,
        inspector_name: inspectorMap.get(r.inspector_id) || '未知',
      }));

      setSupervisorRecords(supRecords);
      setManagerRecords(mgrRecords);

      // 自動選第一筆
      if (supRecords.length > 0 && !selectedSupervisorId) {
        setSelectedSupervisorId(supRecords[0].id);
      }
      if (mgrRecords.length > 0 && !selectedManagerId) {
        setSelectedManagerId(mgrRecords[0].id);
      }
    };

    loadRecords();
  }, [selectedStoreId]);

  // 自動帶入 initialManagerId 時自動載入
  useEffect(() => {
    if (initialManagerId && initialStoreId && selectedSupervisorId) {
      handleCompare();
    }
  }, [selectedSupervisorId]);

  // 執行對比
  const handleCompare = async () => {
    if (!selectedSupervisorId || !selectedManagerId) {
      alert('請選擇要對比的督導巡店和經理巡店記錄');
      return;
    }

    setComparing(true);
    try {
      const supabase = createClient();

      // 取得兩份巡店主記錄的建議事項
      const [supMaster, mgrMaster] = await Promise.all([
        supabase.from('inspection_masters').select('supervisor_notes').eq('id', selectedSupervisorId).single(),
        supabase.from('inspection_masters').select('supervisor_notes').eq('id', selectedManagerId).single(),
      ]);
      setSupervisorOverallNotes(supMaster.data?.supervisor_notes || '');
      setManagerOverallNotes(mgrMaster.data?.supervisor_notes || '');

      // 取得兩份巡店的結果明細
      const [supResults, mgrResults, templatesRes] = await Promise.all([
        supabase
          .from('inspection_results')
          .select('template_id, max_score, given_score, deduction_amount, is_improvement, notes, photo_urls')
          .eq('inspection_id', selectedSupervisorId),
        supabase
          .from('inspection_results')
          .select('template_id, max_score, given_score, deduction_amount, is_improvement, notes, photo_urls')
          .eq('inspection_id', selectedManagerId),
        supabase
          .from('inspection_templates')
          .select('id, section, section_name, section_order, item_name, item_description, item_order, max_score')
          .eq('is_active', true)
          .order('section_order, item_order'),
      ]);

      const supMap = new Map<string, any>();
      (supResults.data || []).forEach(r => supMap.set(r.template_id, r));

      const mgrMap = new Map<string, any>();
      (mgrResults.data || []).forEach(r => mgrMap.set(r.template_id, r));

      // 遍歷所有模板，組成對比結果
      const results: CompareResult[] = (templatesRes.data || []).map((template: any) => {
        const sup = supMap.get(template.id);
        const mgr = mgrMap.get(template.id);

        const supDeduction = sup?.deduction_amount || 0;
        const mgrDeduction = mgr?.deduction_amount || 0;
        const supScore = sup?.given_score ?? template.max_score;
        const mgrScore = mgr?.given_score ?? template.max_score;

        let status: CompareResult['status'] = 'same';
        if (supDeduction > 0 && mgrDeduction > 0) {
          status = supDeduction === mgrDeduction ? 'same' : 'both_different';
        } else if (supDeduction > 0 && mgrDeduction === 0) {
          status = 'supervisor_only';
        } else if (supDeduction === 0 && mgrDeduction > 0) {
          status = 'manager_only';
        }
        // 兩邊都沒扣分就是 same

        return {
          template_id: template.id,
          section: template.section,
          section_name: template.section_name,
          section_order: template.section_order,
          item_name: template.item_name,
          item_description: template.item_description,
          item_order: template.item_order,
          max_score: template.max_score,
          supervisor_deduction: supDeduction,
          supervisor_score: supScore,
          supervisor_notes: sup?.notes || '',
          supervisor_photos: Array.isArray(sup?.photo_urls) ? sup.photo_urls : [],
          manager_deduction: mgrDeduction,
          manager_score: mgrScore,
          manager_notes: mgr?.notes || '',
          manager_photos: Array.isArray(mgr?.photo_urls) ? mgr.photo_urls : [],
          status,
        };
      });

      setCompareResults(results);
      setHasCompared(true);

      // 預設展開有差異的區塊
      const sectionsWithDiff = new Set<string>();
      results.forEach(r => {
        if (r.status !== 'same') {
          sectionsWithDiff.add(r.section);
        }
      });
      setExpandedSections(sectionsWithDiff);
    } catch (error: any) {
      console.error('對比失敗:', error);
      alert('對比分析失敗：' + (error?.message || '未知錯誤'));
    } finally {
      setComparing(false);
    }
  };

  const toggleSection = (section: string) => {
    const next = new Set(expandedSections);
    if (next.has(section)) next.delete(section);
    else next.add(section);
    setExpandedSections(next);
  };

  // 開啟照片燈箱
  const openLightbox = (photos: string[], index: number) => {
    setLightboxPhotos(photos);
    setLightboxIndex(index);
    setShowLightbox(true);
  };

  // 統計
  const onlyInSupervisor = compareResults.filter(r => r.status === 'supervisor_only');
  const onlyInManager = compareResults.filter(r => r.status === 'manager_only');
  const bothDifferent = compareResults.filter(r => r.status === 'both_different');
  const bothSameDeduction = compareResults.filter(r => r.status === 'same' && r.supervisor_deduction > 0);
  const allIssues = compareResults.filter(r => r.supervisor_deduction > 0 || r.manager_deduction > 0);

  const selectedSupervisor = supervisorRecords.find(r => r.id === selectedSupervisorId);
  const selectedManager = managerRecords.find(r => r.id === selectedManagerId);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (noPermission) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">權限不足</h2>
          <p className="text-sm text-gray-600 mb-6">您沒有查看「對比分析」的權限，請聯繫管理員開通。</p>
          <Link
            href="/inspection"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            返回巡店列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 頁面標題 */}
        <div className="mb-6">
          <Link
            href="/inspection?tab=manager"
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft size={20} />
            返回經理巡店列表
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center">
              <GitCompare className="w-6 h-6 text-white" />
            </div>
            督導 vs 經理 巡店對比分析
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            選擇同一門市的督導巡店與經理巡店記錄，比較待改善項目的差異
          </p>
        </div>

        {/* 選擇條件 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">選擇對比記錄</h2>
          
          {/* 門市選擇 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Store className="inline w-4 h-4 mr-1" />
              選擇門市
            </label>
            <select
              value={selectedStoreId}
              onChange={(e) => {
                setSelectedStoreId(e.target.value);
                setSelectedSupervisorId('');
                setSelectedManagerId('');
                setHasCompared(false);
              }}
              className="w-full sm:w-96 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            >
              <option value="">-- 請選擇門市 --</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.store_code} - {s.short_name || s.store_name}
                </option>
              ))}
            </select>
          </div>

          {selectedStoreId && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 督導巡店選擇 */}
              <div>
                <label className="block text-sm font-medium text-blue-700 mb-1">
                  督導巡店記錄
                </label>
                {supervisorRecords.length === 0 ? (
                  <p className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">此門市尚無已完成的督導巡店記錄</p>
                ) : (
                  <select
                    value={selectedSupervisorId}
                    onChange={(e) => { setSelectedSupervisorId(e.target.value); setHasCompared(false); }}
                    className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">-- 選擇督導巡店 --</option>
                    {supervisorRecords.map((r) => (
                      <option key={r.id} value={r.id}>
                        {new Date(r.inspection_date).toLocaleDateString('zh-TW')} | {r.inspector_name} | 評級:{r.grade} ({r.total_score}/{r.max_possible_score})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* 經理巡店選擇 */}
              <div>
                <label className="block text-sm font-medium text-emerald-700 mb-1">
                  經理巡店記錄
                </label>
                {managerRecords.length === 0 ? (
                  <p className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">此門市尚無已完成的經理巡店記錄</p>
                ) : (
                  <select
                    value={selectedManagerId}
                    onChange={(e) => { setSelectedManagerId(e.target.value); setHasCompared(false); }}
                    className="w-full px-3 py-2 border border-emerald-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  >
                    <option value="">-- 選擇經理巡店 --</option>
                    {managerRecords.map((r) => (
                      <option key={r.id} value={r.id}>
                        {new Date(r.inspection_date).toLocaleDateString('zh-TW')} | {r.inspector_name} | 評級:{r.grade} ({r.total_score}/{r.max_possible_score})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {selectedStoreId && (
            <div className="mt-6">
              <button
                onClick={handleCompare}
                disabled={comparing || !selectedSupervisorId || !selectedManagerId}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-medium rounded-lg hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg text-sm"
              >
                {comparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />}
                {comparing ? '分析中...' : '開始對比分析'}
              </button>
            </div>
          )}
        </div>

        {/* 對比結果 */}
        {hasCompared && (
          <>
            {/* 分數概覽 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-blue-800 mb-1">督導巡店</h3>
                <p className="text-xs text-blue-600 mb-3">
                  {selectedSupervisor && `${new Date(selectedSupervisor.inspection_date).toLocaleDateString('zh-TW')} | ${selectedSupervisor.inspector_name}`}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-blue-700">{selectedSupervisor?.total_score || 0}</span>
                  <span className="text-sm text-blue-500">/ {selectedSupervisor?.max_possible_score || 220}</span>
                  <span className="ml-auto text-2xl font-bold text-blue-800">評級 {selectedSupervisor?.grade}</span>
                </div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6">
                <h3 className="text-sm font-semibold text-emerald-800 mb-1">經理巡店</h3>
                <p className="text-xs text-emerald-600 mb-3">
                  {selectedManager && `${new Date(selectedManager.inspection_date).toLocaleDateString('zh-TW')} | ${selectedManager.inspector_name}`}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-emerald-700">{selectedManager?.total_score || 0}</span>
                  <span className="text-sm text-emerald-500">/ {selectedManager?.max_possible_score || 220}</span>
                  <span className="ml-auto text-2xl font-bold text-emerald-800">評級 {selectedManager?.grade}</span>
                </div>
              </div>
            </div>

            {/* 差異統計 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
                <p className="text-xs text-gray-500 mb-1">共同待改善</p>
                <p className="text-2xl font-bold text-purple-600">{bothSameDeduction.length + bothDifferent.length}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-blue-200 p-4 text-center">
                <p className="text-xs text-blue-600 mb-1">僅督導扣分</p>
                <p className="text-2xl font-bold text-blue-700">{onlyInSupervisor.length}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-emerald-200 p-4 text-center">
                <p className="text-xs text-emerald-600 mb-1">僅經理扣分</p>
                <p className="text-2xl font-bold text-emerald-700">{onlyInManager.length}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-4 text-center">
                <p className="text-xs text-amber-600 mb-1">扣分不同</p>
                <p className="text-2xl font-bold text-amber-700">{bothDifferent.length}</p>
              </div>
            </div>

            {/* 其他建議事項 */}
            {(supervisorOverallNotes || managerOverallNotes) && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <h2 className="text-lg font-semibold text-gray-900">其他建議事項</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-200">
                  <div className="p-5">
                    <p className="text-xs font-medium text-blue-700 mb-2">督導建議</p>
                    {supervisorOverallNotes ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{supervisorOverallNotes}</p>
                    ) : (
                      <p className="text-sm text-gray-400 italic">未填寫</p>
                    )}
                  </div>
                  <div className="p-5">
                    <p className="text-xs font-medium text-emerald-700 mb-2">經理建議</p>
                    {managerOverallNotes ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{managerOverallNotes}</p>
                    ) : (
                      <p className="text-sm text-gray-400 italic">未填寫</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 待改善項目詳細對比 */}
            {allIssues.length > 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                <div className="px-6 py-4 border-b border-gray-200 bg-red-50">
                  <h2 className="text-lg font-bold text-red-800 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    待改善項目對比（共 {allIssues.length} 項）
                  </h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {allIssues.map((item) => (
                    <div key={item.template_id} className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        {/* 狀態標記 */}
                        <div className="flex-shrink-0 mt-0.5">
                          {item.status === 'same' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">共同</span>
                          )}
                          {item.status === 'supervisor_only' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">僅督導</span>
                          )}
                          {item.status === 'manager_only' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">僅經理</span>
                          )}
                          {item.status === 'both_different' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">不同</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-gray-900">
                            {item.section_name} — {item.item_name}
                          </h4>
                          <p className="text-xs text-gray-500 mt-0.5">{item.item_description}</p>
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* 督導結果 */}
                            <div className={`p-3 rounded-lg text-sm ${item.supervisor_deduction > 0 ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'}`}>
                              <p className="text-xs font-medium text-blue-700 mb-1">督導</p>
                              {item.supervisor_deduction > 0 ? (
                                <>
                                  <p className="font-bold text-red-600">扣 {item.supervisor_deduction} 分</p>
                                  {item.supervisor_notes && <p className="text-xs text-gray-600 mt-1">{item.supervisor_notes}</p>}
                                  {/* 督導照片縮圖 */}
                                  {item.supervisor_photos.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {item.supervisor_photos.map((photo, idx) => (
                                        <button
                                          key={idx}
                                          onClick={() => openLightbox(item.supervisor_photos, idx)}
                                          className="relative w-16 h-16 rounded-lg overflow-hidden border-2 border-blue-300 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group"
                                        >
                                          <img
                                            src={photo}
                                            alt={`督導拍照 ${idx + 1}`}
                                            className="w-full h-full object-cover"
                                          />
                                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                            <Camera className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <p className="text-green-600 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> 未扣分</p>
                              )}
                            </div>
                            {/* 經理結果 */}
                            <div className={`p-3 rounded-lg text-sm ${item.manager_deduction > 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50 border border-gray-200'}`}>
                              <p className="text-xs font-medium text-emerald-700 mb-1">經理</p>
                              {item.manager_deduction > 0 ? (
                                <>
                                  <p className="font-bold text-red-600">扣 {item.manager_deduction} 分</p>
                                  {item.manager_notes && <p className="text-xs text-gray-600 mt-1">{item.manager_notes}</p>}
                                  {/* 經理照片縮圖 */}
                                  {item.manager_photos.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {item.manager_photos.map((photo, idx) => (
                                        <button
                                          key={idx}
                                          onClick={() => openLightbox(item.manager_photos, idx)}
                                          className="relative w-16 h-16 rounded-lg overflow-hidden border-2 border-emerald-300 hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer group"
                                        >
                                          <img
                                            src={photo}
                                            alt={`經理拍照 ${idx + 1}`}
                                            className="w-full h-full object-cover"
                                          />
                                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                            <Camera className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <p className="text-green-600 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> 未扣分</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center mb-6">
                <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <p className="text-lg font-semibold text-gray-700">兩份巡店記錄完全一致</p>
                <p className="text-sm text-gray-500 mt-1">沒有待改善項目差異</p>
              </div>
            )}
          </>
        )}

        {/* 照片燈箱 */}
        {showLightbox && lightboxPhotos.length > 0 && (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
            onClick={() => setShowLightbox(false)}
          >
            {/* 關閉按鈕 */}
            <button
              onClick={() => setShowLightbox(false)}
              className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            {/* 照片計數 */}
            {lightboxPhotos.length > 1 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1 bg-black/50 rounded-full text-white text-sm">
                {lightboxIndex + 1} / {lightboxPhotos.length}
              </div>
            )}

            {/* 上一張 */}
            {lightboxPhotos.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev - 1 + lightboxPhotos.length) % lightboxPhotos.length);
                }}
                className="absolute left-4 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}

            {/* 照片主體 */}
            <div
              className="max-w-[90vw] max-h-[85vh] flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={lightboxPhotos[lightboxIndex]}
                alt={`照片 ${lightboxIndex + 1}`}
                className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              />
            </div>

            {/* 下一張 */}
            {lightboxPhotos.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => (prev + 1) % lightboxPhotos.length);
                }}
                className="absolute right-4 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
