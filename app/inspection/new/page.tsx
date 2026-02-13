'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  ChevronDown,
  ChevronUp,
  Save,
  Send,
  ArrowLeft,
  Store,
  Calendar,
  CheckSquare,
  AlertCircle,
} from 'lucide-react';

interface Store {
  id: string;
  store_name: string;
  store_code: string;
}

interface ChecklistItem {
  label: string;
  deduction: number;
}

interface InspectionTemplate {
  id: string;
  section: string;
  section_name: string;
  section_order: number;
  item_name: string;
  item_description: string;
  item_order: number;
  max_score: number;
  scoring_type: string;
  checklist_items: ChecklistItem[];
}

interface ItemScore {
  template_id: string;
  checked_items: string[]; // 勾選的缺失項目標籤
  deduction: number;
  earned_score: number;
  improvement_notes: string;
}

export default function NewInspectionPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stores, setStores] = useState<Store[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [inspectionDate, setInspectionDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [itemScores, setItemScores] = useState<Map<string, ItemScore>>(new Map());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const supabase = createClient();

      // 載入門市列表
      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('id, store_name, store_code')
        .order('store_code');

      if (storesError) throw storesError;

      // 載入檢查項目模板
      const { data: templatesData, error: templatesError } = await supabase
        .from('inspection_templates')
        .select('*')
        .eq('is_active', true)
        .order('section_order, item_order');

      if (templatesError) throw templatesError;

      setStores(storesData || []);
      setTemplates(templatesData || []);

      // 初始化所有項目分數
      const initialScores = new Map<string, ItemScore>();
      templatesData?.forEach((template) => {
        initialScores.set(template.id, {
          template_id: template.id,
          checked_items: [],
          deduction: 0,
          earned_score: template.max_score,
          improvement_notes: '',
        });
      });
      setItemScores(initialScores);

      setLoading(false);
    } catch (error) {
      console.error('❌ 載入資料失敗:', error);
      alert('載入資料失敗，請重新整理頁面');
    }
  };

  // 切換區塊展開/收合
  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  // 處理勾選項目
  const handleCheckItem = (templateId: string, itemLabel: string, deduction: number, maxScore: number) => {
    const currentScore = itemScores.get(templateId);
    if (!currentScore) return;

    const newCheckedItems = currentScore.checked_items.includes(itemLabel)
      ? currentScore.checked_items.filter((label) => label !== itemLabel)
      : [...currentScore.checked_items, itemLabel];

    // 計算新的扣分
    const template = templates.find((t) => t.id === templateId);
    const newDeduction = newCheckedItems.reduce((sum, label) => {
      const item = template?.checklist_items.find((ci) => ci.label === label);
      return sum + (item?.deduction || 0);
    }, 0);

    // 計算實得分數（不能低於0）
    const newEarnedScore = Math.max(0, maxScore - newDeduction);

    const newScores = new Map(itemScores);
    newScores.set(templateId, {
      ...currentScore,
      checked_items: newCheckedItems,
      deduction: newDeduction,
      earned_score: newEarnedScore,
    });
    setItemScores(newScores);
  };

  // 更新改善建議
  const handleNotesChange = (templateId: string, notes: string) => {
    const currentScore = itemScores.get(templateId);
    if (!currentScore) return;

    const newScores = new Map(itemScores);
    newScores.set(templateId, {
      ...currentScore,
      improvement_notes: notes,
    });
    setItemScores(newScores);
  };

  // 計算總分和評級
  const calculateTotals = () => {
    let totalDeduction = 0;
    let totalEarned = 0;

    itemScores.forEach((score) => {
      totalDeduction += score.deduction;
      totalEarned += score.earned_score;
    });

    const finalScore = 220 - totalDeduction;
    let grade = 'F';
    if (finalScore >= 200) grade = 'S';
    else if (finalScore >= 180) grade = 'A';
    else if (finalScore >= 150) grade = 'B';

    return {
      initialScore: 220,
      totalDeduction,
      finalScore,
      grade,
    };
  };

  // 保存巡店記錄
  const handleSubmit = async (isDraft: boolean) => {
    if (!selectedStoreId) {
      alert('請選擇門市');
      return;
    }

    try {
      setSubmitting(true);
      const supabase = createClient();

      // 獲取當前使用者
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');

      const totals = calculateTotals();

      // 1. 建立主記錄
      const { data: masterData, error: masterError } = await supabase
        .from('inspection_masters')
        .insert({
          store_id: selectedStoreId,
          inspector_id: user.id,
          inspection_date: inspectionDate,
          status: isDraft ? 'draft' : 'completed',
          initial_score: totals.initialScore,
          total_deduction: totals.totalDeduction,
          final_score: totals.finalScore,
          grade: totals.grade,
        })
        .select()
        .single();

      if (masterError) throw masterError;

      // 2. 建立明細記錄
      const resultsToInsert = Array.from(itemScores.values()).map((score) => ({
        inspection_id: masterData.id,
        template_id: score.template_id,
        deduction: score.deduction,
        earned_score: score.earned_score,
        needs_improvement: score.deduction > 0,
        improvement_notes: score.improvement_notes || null,
      }));

      const { error: resultsError } = await supabase
        .from('inspection_results')
        .insert(resultsToInsert);

      if (resultsError) throw resultsError;

      alert(isDraft ? '草稿已儲存！' : '巡店記錄已送出！');
      router.push(`/inspection/${masterData.id}`);
    } catch (error) {
      console.error('❌ 儲存失敗:', error);
      alert('儲存失敗，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  };

  // 按區塊分組模板
  const groupedTemplates = templates.reduce((acc, template) => {
    if (!acc[template.section]) {
      acc[template.section] = {
        section_name: template.section_name,
        section_order: template.section_order,
        items: [],
      };
    }
    acc[template.section].items.push(template);
    return acc;
  }, {} as Record<string, { section_name: string; section_order: number; items: InspectionTemplate[] }>);

  const sortedSections = Object.entries(groupedTemplates).sort(
    ([, a], [, b]) => a.section_order - b.section_order
  );

  const totals = calculateTotals();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 頁面標題 */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft size={20} />
            返回
          </button>
          <h1 className="text-3xl font-bold text-gray-900">新增巡店記錄</h1>
          <p className="mt-2 text-sm text-gray-600">
            填寫門市巡店檢查項目，系統將自動計算分數與評級
          </p>
        </div>

        {/* 基本資訊 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">基本資訊</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Store className="inline w-4 h-4 mr-1" />
                選擇門市 *
              </label>
              <select
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">請選擇門市</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.store_code} - {store.store_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                巡店日期 *
              </label>
              <input
                type="date"
                value={inspectionDate}
                onChange={(e) => setInspectionDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>
        </div>

        {/* 分數總覽 */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl shadow-lg p-6 mb-6 text-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-sm opacity-90">初始分數</p>
              <p className="text-3xl font-bold mt-1">{totals.initialScore}</p>
            </div>
            <div>
              <p className="text-sm opacity-90">總扣分</p>
              <p className="text-3xl font-bold mt-1 text-red-200">-{totals.totalDeduction}</p>
            </div>
            <div>
              <p className="text-sm opacity-90">最終得分</p>
              <p className="text-3xl font-bold mt-1">{totals.finalScore}</p>
            </div>
            <div>
              <p className="text-sm opacity-90">評級</p>
              <p className="text-3xl font-bold mt-1">{totals.grade}</p>
            </div>
          </div>
        </div>

        {/* 檢查項目 */}
        <div className="space-y-4 mb-6">
          {sortedSections.map(([sectionKey, section]) => {
            const isExpanded = expandedSections.has(sectionKey);
            const sectionTotal = section.items.reduce(
              (sum, item) => sum + item.max_score,
              0
            );
            const sectionEarned = section.items.reduce(
              (sum, item) => sum + (itemScores.get(item.id)?.earned_score || 0),
              0
            );

            return (
              <div
                key={sectionKey}
                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
              >
                <button
                  onClick={() => toggleSection(sectionKey)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <CheckSquare className="w-5 h-5 text-blue-600" />
                    <div className="text-left">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {section.section_name}
                      </h3>
                      <p className="text-sm text-gray-600">
                        {section.items.length} 項檢查 · 共 {sectionTotal} 分 · 實得{' '}
                        {sectionEarned} 分
                      </p>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </button>

                {isExpanded && (
                  <div className="px-6 py-4 border-t border-gray-200 space-y-6">
                    {section.items.map((item) => {
                      const score = itemScores.get(item.id);
                      const hasIssues = score && score.checked_items.length > 0;

                      return (
                        <div
                          key={item.id}
                          className={`p-4 rounded-lg border-2 ${
                            hasIssues
                              ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <h4 className="font-semibold text-gray-900">
                                {item.item_name}
                                <span className="ml-2 text-sm font-normal text-gray-600">
                                  （{item.max_score} 分）
                                </span>
                              </h4>
                              <p className="text-sm text-gray-600 mt-1">
                                {item.item_description}
                              </p>
                            </div>
                            <div className="text-right ml-4">
                              <p className="text-sm text-gray-600">實得分數</p>
                              <p
                                className={`text-2xl font-bold ${
                                  hasIssues ? 'text-red-600' : 'text-green-600'
                                }`}
                              >
                                {score?.earned_score || 0}
                              </p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            {item.checklist_items.map((checkItem, idx) => (
                              <label
                                key={idx}
                                className="flex items-center gap-3 p-2 rounded hover:bg-white cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={score?.checked_items.includes(checkItem.label)}
                                  onChange={() =>
                                    handleCheckItem(
                                      item.id,
                                      checkItem.label,
                                      checkItem.deduction,
                                      item.max_score
                                    )
                                  }
                                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <span className="flex-1 text-sm text-gray-700">
                                  {checkItem.label}
                                </span>
                                <span className="text-sm font-medium text-red-600">
                                  -{checkItem.deduction} 分
                                </span>
                              </label>
                            ))}
                          </div>

                          {hasIssues && (
                            <div className="mt-3">
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                <AlertCircle className="inline w-4 h-4 mr-1" />
                                改善建議
                              </label>
                              <textarea
                                value={score?.improvement_notes || ''}
                                onChange={(e) =>
                                  handleNotesChange(item.id, e.target.value)
                                }
                                placeholder="請填寫需改善的具體事項..."
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                rows={2}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 操作按鈕 */}
        <div className="flex flex-col sm:flex-row gap-4 sticky bottom-4">
          <button
            onClick={() => handleSubmit(true)}
            disabled={submitting || !selectedStoreId}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save size={20} />
            儲存草稿
          </button>
          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting || !selectedStoreId}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-lg hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
          >
            <Send size={20} />
            送出記錄
          </button>
        </div>
      </div>
    </div>
  );
}
