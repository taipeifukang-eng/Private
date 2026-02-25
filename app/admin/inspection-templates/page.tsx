'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  GripVertical,
  AlertCircle,
  CheckSquare,
  Settings,
  Loader2,
} from 'lucide-react';

interface ChecklistItem {
  label: string;
  deduction: number;
  requires_quantity?: boolean;
  unit?: string;
}

interface InspectionTemplate {
  id: string;
  section: string;
  section_name: string;
  section_order: number;
  item_name: string;
  item_description: string | null;
  item_order: number;
  max_score: number;
  scoring_type: string;
  checklist_items: ChecklistItem[];
  is_active: boolean;
}

interface GradeMapping {
  grade: number;
  min_score: number;
}

type TabType = 'templates' | 'grading' | 'bonus';

interface BonusConfig {
  id: string;
  day_from: number;
  day_to: number;
  bonus_score: number;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export default function InspectionTemplatesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('templates');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  
  // 編輯狀態
  const [editingTemplate, setEditingTemplate] = useState<InspectionTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  
  // 評分對照
  const [gradeMappings, setGradeMappings] = useState<GradeMapping[]>([]);
  const [gradeMappingDirty, setGradeMappingDirty] = useState(false);

  // 加分規則
  const [bonusConfigs, setBonusConfigs] = useState<BonusConfig[]>([]);
  const [editingBonus, setEditingBonus] = useState<BonusConfig | null>(null);
  const [isCreatingBonus, setIsCreatingBonus] = useState(false);
  const [bonusForm, setBonusForm] = useState({ day_from: 0, day_to: 3, bonus_score: 5, description: '' });

  // 權限檢查
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  const checkAuthAndLoad = async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      // 使用 RBAC 權限檢查
      const res = await fetch('/api/permissions/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionCode: 'inspection.template.manage' }),
      });
      const permResult = await res.json();
      if (!permResult.allowed) {
        router.push('/dashboard');
        return;
      }

      setAuthorized(true);
      await loadTemplates();
      await loadGradeMappings();
      await loadBonusConfigs();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadBonusConfigs = async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('inspection_bonus_config')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');
    if (!error && data) setBonusConfigs(data);
  };

  const handleSaveBonus = async () => {
    try {
      setSaving(true);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (editingBonus) {
        // 更新
        const { error } = await supabase
          .from('inspection_bonus_config')
          .update({
            day_from: bonusForm.day_from,
            day_to: bonusForm.day_to,
            bonus_score: bonusForm.bonus_score,
            description: bonusForm.description || null,
            updated_at: new Date().toISOString(),
            updated_by: user?.id,
          })
          .eq('id', editingBonus.id);
        if (error) throw error;
      } else {
        // 新增
        const nextOrder = bonusConfigs.length > 0 ? Math.max(...bonusConfigs.map(c => c.sort_order)) + 1 : 1;
        const { error } = await supabase
          .from('inspection_bonus_config')
          .insert({
            day_from: bonusForm.day_from,
            day_to: bonusForm.day_to,
            bonus_score: bonusForm.bonus_score,
            description: bonusForm.description || null,
            sort_order: nextOrder,
            updated_by: user?.id,
          });
        if (error) throw error;
      }

      await loadBonusConfigs();
      setEditingBonus(null);
      setIsCreatingBonus(false);
      setBonusForm({ day_from: 0, day_to: 3, bonus_score: 5, description: '' });
    } catch (e: any) {
      alert('儲存失敗：' + (e?.message || '未知錯誤'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBonus = async (configId: string) => {
    if (!confirm('確定要刪除此加分規則？')) return;
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('inspection_bonus_config')
        .update({ is_active: false })
        .eq('id', configId);
      if (error) throw error;
      await loadBonusConfigs();
    } catch (e: any) {
      alert('刪除失敗：' + (e?.message || '未知錯誤'));
    }
  };

  const loadTemplates = async () => {
    const res = await fetch('/api/inspection-templates');
    const data = await res.json();
    if (data.templates) {
      setTemplates(data.templates);
    }
  };

  const loadGradeMappings = async () => {
    const res = await fetch('/api/inspection-grade-mapping');
    const data = await res.json();
    if (data.mappings) {
      setGradeMappings(data.mappings.sort((a: GradeMapping, b: GradeMapping) => b.grade - a.grade));
    }
  };

  // 按區塊分組
  const getSectionGroups = () => {
    const groups = new Map<string, { section_name: string; section_order: number; items: InspectionTemplate[] }>();
    
    templates
      .filter(t => t.is_active)
      .forEach(t => {
        if (!groups.has(t.section)) {
          groups.set(t.section, {
            section_name: t.section_name,
            section_order: t.section_order,
            items: [],
          });
        }
        groups.get(t.section)!.items.push(t);
      });

    // 排序 items
    groups.forEach(g => g.items.sort((a, b) => a.item_order - b.item_order));

    return Array.from(groups.entries()).sort((a, b) => a[1].section_order - b[1].section_order);
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section); else next.add(section);
      return next;
    });
  };

  // 計算總滿分
  const totalMaxScore = templates.filter(t => t.is_active).reduce((sum, t) => sum + t.max_score, 0);

  // 保存模板（新增或修改）
  const handleSaveTemplate = async (template: InspectionTemplate, isNew: boolean) => {
    setSaving(true);
    try {
      const url = isNew ? '/api/inspection-templates' : `/api/inspection-templates/${template.id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: template.section,
          section_name: template.section_name,
          section_order: template.section_order,
          item_name: template.item_name,
          item_description: template.item_description,
          item_order: template.item_order,
          max_score: template.max_score,
          scoring_type: template.scoring_type,
          checklist_items: template.checklist_items,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`保存失敗：${err.error}`);
        return;
      }

      await loadTemplates();
      setEditingTemplate(null);
      setIsCreating(false);
    } catch (e: any) {
      alert(`保存失敗：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 刪除模板
  const handleDeleteTemplate = async (id: string, name: string) => {
    if (!confirm(`確定要刪除「${name}」嗎？此操作會將項目設為停用。`)) return;

    try {
      const res = await fetch(`/api/inspection-templates/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        alert(`刪除失敗：${err.error}`);
        return;
      }
      await loadTemplates();
    } catch (e: any) {
      alert(`刪除失敗：${e.message}`);
    }
  };

  // 保存評分對照表
  const handleSaveGradeMappings = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/inspection-grade-mapping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings: gradeMappings }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`保存失敗：${err.error}`);
        return;
      }

      setGradeMappingDirty(false);
      alert('評分對照表已保存');
    } catch (e: any) {
      alert(`保存失敗：${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 開始新增項目
  const startCreate = (section?: string, sectionName?: string, sectionOrder?: number) => {
    const groups = getSectionGroups();
    const existingSection = section ? groups.find(([s]) => s === section) : null;
    const maxOrder = existingSection 
      ? Math.max(...existingSection[1].items.map(i => i.item_order), 0) + 1 
      : 1;

    setEditingTemplate({
      id: '',
      section: section || `section_${groups.length + 1}`,
      section_name: sectionName || '',
      section_order: sectionOrder || groups.length + 1,
      item_name: '',
      item_description: null,
      item_order: maxOrder,
      max_score: 10,
      scoring_type: 'checklist',
      checklist_items: [],
      is_active: true,
    });
    setIsCreating(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 頁面標題 */}
        <div className="mb-8">
          <Link href="/inspection" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" /> 返回巡店列表
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
                  <Settings className="w-6 h-6 text-white" />
                </div>
                巡店檢查項目管理
              </h1>
              <p className="mt-2 text-sm text-gray-600">
                管理巡店檢查項目模板與評分對照表
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-500">目前總滿分</div>
              <div className="text-3xl font-bold text-indigo-600">{totalMaxScore}</div>
            </div>
          </div>
        </div>

        {/* Tab 切換 */}
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setActiveTab('templates')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'templates'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <CheckSquare className="w-4 h-4 inline mr-2" />
            檢查項目
          </button>
          <button
            onClick={() => setActiveTab('grading')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'grading'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Settings className="w-4 h-4 inline mr-2" />
            評分對照表
          </button>
          <button
            onClick={() => setActiveTab('bonus')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'bonus'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Settings className="w-4 h-4 inline mr-2" />
            改善加分規則
          </button>
        </div>

        {/* 檢查項目管理 */}
        {activeTab === 'templates' && (
          <div>
            {/* 新增按鈕 */}
            <div className="mb-4 flex justify-end">
              <button
                onClick={() => startCreate()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" /> 新增檢查項目
              </button>
            </div>

            {/* 區塊列表 */}
            {getSectionGroups().map(([section, group]) => {
              const sectionMaxScore = group.items.reduce((sum, i) => sum + i.max_score, 0);
              const isExpanded = expandedSections.has(section);

              return (
                <div key={section} className="bg-white rounded-xl shadow-sm border border-gray-200 mb-4 overflow-hidden">
                  {/* 區塊標題 */}
                  <button
                    onClick={() => toggleSection(section)}
                    className="w-full px-6 py-4 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-100 px-2 py-1 rounded">
                        {section.replace('section_', '區塊 ')}
                      </span>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {group.section_name}
                      </h3>
                      <span className="text-sm text-gray-500">
                        {group.items.length} 項 / 滿分 {sectionMaxScore}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startCreate(section, group.section_name, group.section_order);
                        }}
                        className="text-indigo-600 hover:text-indigo-800 p-1"
                        title="新增項目到此區塊"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                      {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
                    </div>
                  </button>

                  {/* 項目列表 */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-100">
                      {group.items.map((template) => (
                        <div key={template.id} className="px-6 py-4 hover:bg-gray-50 transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-1">
                                <span className="text-xs text-gray-400 font-mono">
                                  {template.section.replace('section_', '')}-{template.item_order}
                                </span>
                                <h4 className="font-medium text-gray-900">{template.item_name}</h4>
                                <span className="text-sm font-bold text-indigo-600">
                                  {template.max_score} 分
                                </span>
                              </div>
                              {template.item_description && (
                                <p className="text-sm text-gray-500 mb-2">{template.item_description}</p>
                              )}
                              {/* 檢查子項目 */}
                              <div className="flex flex-wrap gap-2 mt-2">
                                {template.checklist_items.map((item, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 border border-gray-200"
                                  >
                                    {item.label}
                                    <span className="ml-1 text-red-500 font-medium">-{item.deduction}</span>
                                    {item.requires_quantity && (
                                      <span className="ml-1 text-blue-500">×{item.unit || '個'}</span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              <button
                                onClick={() => { setEditingTemplate({ ...template }); setIsCreating(false); }}
                                className="p-2 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                                title="編輯"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteTemplate(template.id, template.item_name)}
                                className="p-2 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                                title="刪除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 評分對照表管理 */}
        {activeTab === 'grading' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-orange-50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">得分數對照表</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    設定最終得分（滿分 {totalMaxScore}）對應到得分數（滿分 10 分）的門檻
                  </p>
                </div>
                {gradeMappingDirty && (
                  <button
                    onClick={handleSaveGradeMappings}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors text-sm font-medium"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    保存對照表
                  </button>
                )}
              </div>
            </div>

            <div className="p-6">
              <div className="max-w-xl mx-auto">
                <div className="grid grid-cols-3 gap-3 mb-4 text-sm font-medium text-gray-500">
                  <div>得分數</div>
                  <div>最低分數門檻</div>
                  <div>百分比（以 {totalMaxScore} 分計）</div>
                </div>
                {gradeMappings.map((mapping, idx) => (
                  <div key={mapping.grade} className="grid grid-cols-3 gap-3 mb-3 items-center">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-lg font-bold ${
                        mapping.grade >= 8 ? 'bg-purple-100 text-purple-700' :
                        mapping.grade >= 6 ? 'bg-green-100 text-green-700' :
                        mapping.grade >= 4 ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {mapping.grade}
                      </span>
                    </div>
                    <div>
                      <input
                        type="number"
                        min={0}
                        max={totalMaxScore}
                        value={mapping.min_score}
                        onChange={(e) => {
                          const newMappings = [...gradeMappings];
                          newMappings[idx] = { ...mapping, min_score: Number(e.target.value) };
                          setGradeMappings(newMappings);
                          setGradeMappingDirty(true);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        disabled={mapping.grade === 0}
                      />
                    </div>
                    <div className="text-sm text-gray-500">
                      ≥ {totalMaxScore > 0 ? ((mapping.min_score / totalMaxScore) * 100).toFixed(1) : 0}%
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                  <div className="text-sm text-amber-800">
                    <p className="font-medium mb-1">注意事項</p>
                    <ul className="list-disc list-inside space-y-1 text-amber-700">
                      <li>得分數 0 固定為最低分數 0，不可修改</li>
                      <li>每個門檻分數應大於下一級的門檻分數</li>
                      <li>修改評分對照表後，僅影響之後新建的巡店記錄</li>
                      <li>修改後需同步更新新增巡店頁面的前端計算邏輯（需重新部署）</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 改善加分規則 */}
        {activeTab === 'bonus' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-green-50 to-emerald-50">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">改善加分規則</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    設定店長在幾天內上傳改善內容可以獲得的加分。越早改善加分越多。
                  </p>
                </div>
                {!isCreatingBonus && !editingBonus && (
                  <button
                    onClick={() => {
                      setIsCreatingBonus(true);
                      setEditingBonus(null);
                      const maxDay = bonusConfigs.length > 0 ? Math.max(...bonusConfigs.map(c => c.day_to)) + 1 : 0;
                      setBonusForm({ day_from: maxDay, day_to: maxDay + 2, bonus_score: 1, description: '' });
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    新增規則
                  </button>
                )}
              </div>
            </div>

            <div className="p-6">
              {/* 規則列表 */}
              {bonusConfigs.length === 0 && !isCreatingBonus && (
                <div className="text-center py-8 text-gray-500">
                  <Settings className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p>尚未設定加分規則</p>
                  <p className="text-sm mt-1">點擊「新增規則」開始設定</p>
                </div>
              )}

              {bonusConfigs.length > 0 && (
                <div className="max-w-2xl mx-auto">
                  <div className="grid grid-cols-12 gap-3 mb-3 text-sm font-medium text-gray-500 px-4">
                    <div className="col-span-4">改善天數</div>
                    <div className="col-span-2 text-center">加分</div>
                    <div className="col-span-4">說明</div>
                    <div className="col-span-2 text-right">操作</div>
                  </div>
                  {bonusConfigs.map((config) => (
                    <div
                      key={config.id}
                      className={`grid grid-cols-12 gap-3 items-center px-4 py-3 rounded-lg mb-2 ${
                        editingBonus?.id === config.id ? 'bg-green-50 border border-green-300' : 'bg-gray-50 hover:bg-gray-100'
                      } transition-colors`}
                    >
                      <div className="col-span-4">
                        <span className="text-sm text-gray-800">
                          {config.day_from === 0 ? '當天' : `第 ${config.day_from} 天`} ~ 第 {config.day_to} 天
                        </span>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-2.5 py-1 rounded-full text-sm font-bold">
                          +{config.bonus_score}分
                        </span>
                      </div>
                      <div className="col-span-4">
                        <span className="text-sm text-gray-500">{config.description || '-'}</span>
                      </div>
                      <div className="col-span-2 flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditingBonus(config);
                            setIsCreatingBonus(false);
                            setBonusForm({
                              day_from: config.day_from,
                              day_to: config.day_to,
                              bonus_score: config.bonus_score,
                              description: config.description || '',
                            });
                          }}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteBonus(config.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 新增/編輯表單 */}
              {(isCreatingBonus || editingBonus) && (
                <div className="max-w-2xl mx-auto mt-4 bg-green-50 border border-green-200 rounded-xl p-5">
                  <h4 className="text-sm font-semibold text-green-800 mb-4">
                    {editingBonus ? '編輯加分規則' : '新增加分規則'}
                  </h4>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        起始天數（含）
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={bonusForm.day_from}
                        onChange={(e) => setBonusForm({ ...bonusForm, day_from: Number(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        結束天數（含）
                      </label>
                      <input
                        type="number"
                        min={bonusForm.day_from}
                        value={bonusForm.day_to}
                        onChange={(e) => setBonusForm({ ...bonusForm, day_to: Number(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        加分分數
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={bonusForm.bonus_score}
                        onChange={(e) => setBonusForm({ ...bonusForm, bonus_score: Number(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        說明（選填）
                      </label>
                      <input
                        type="text"
                        value={bonusForm.description}
                        onChange={(e) => setBonusForm({ ...bonusForm, description: e.target.value })}
                        placeholder="例如：3天內改善 +5分"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setEditingBonus(null);
                        setIsCreatingBonus(false);
                        setBonusForm({ day_from: 0, day_to: 3, bonus_score: 5, description: '' });
                      }}
                      className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveBonus}
                      disabled={saving || bonusForm.day_to < bonusForm.day_from || bonusForm.bonus_score < 0}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {editingBonus ? '保存' : '新增'}
                    </button>
                  </div>
                </div>
              )}

              {/* 說明 */}
              <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div className="text-sm text-green-800">
                    <p className="font-medium mb-1">加分機制說明</p>
                    <ul className="list-disc list-inside space-y-1 text-green-700">
                      <li>督導巡店完成後，系統會自動為扣分項目建立「待改善事項」</li>
                      <li>店長登入後可看到待改善清單，並上傳改善說明與照片</li>
                      <li>系統根據改善天數（提交日 - 巡店日）自動計算加分</li>
                      <li>加分會加到該次巡店的總分上（改善加分欄位）</li>
                      <li>改善期限 = 巡店日 + 最大天數設定（取所有規則最大的結束天數）</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 編輯/新增 Modal */}
        {editingTemplate && (
          <TemplateEditModal
            template={editingTemplate}
            isNew={isCreating}
            saving={saving}
            existingSections={getSectionGroups().map(([s, g]) => ({ section: s, section_name: g.section_name, section_order: g.section_order }))}
            onSave={(t) => handleSaveTemplate(t, isCreating)}
            onCancel={() => { setEditingTemplate(null); setIsCreating(false); }}
          />
        )}
      </div>
    </div>
  );
}

// ===== 模板編輯 Modal =====
interface TemplateEditModalProps {
  template: InspectionTemplate;
  isNew: boolean;
  saving: boolean;
  existingSections: { section: string; section_name: string; section_order: number }[];
  onSave: (template: InspectionTemplate) => void;
  onCancel: () => void;
}

function TemplateEditModal({ template, isNew, saving, existingSections, onSave, onCancel }: TemplateEditModalProps) {
  const [form, setForm] = useState<InspectionTemplate>({ ...template });
  const [useNewSection, setUseNewSection] = useState(isNew && !template.section_name);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([...template.checklist_items]);

  const updateField = (field: keyof InspectionTemplate, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSelectSection = (section: string) => {
    const existing = existingSections.find(s => s.section === section);
    if (existing) {
      setForm(prev => ({
        ...prev,
        section: existing.section,
        section_name: existing.section_name,
        section_order: existing.section_order,
      }));
      setUseNewSection(false);
    }
  };

  // 檢查子項目操作
  const addChecklistItem = () => {
    setChecklistItems(prev => [...prev, { label: '', deduction: 1 }]);
  };

  const updateChecklistItem = (idx: number, field: keyof ChecklistItem, value: any) => {
    setChecklistItems(prev => {
      const items = [...prev];
      items[idx] = { ...items[idx], [field]: value };
      return items;
    });
  };

  const removeChecklistItem = (idx: number) => {
    setChecklistItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    if (!form.item_name.trim()) {
      alert('請輸入項目名稱');
      return;
    }
    if (!form.section_name.trim()) {
      alert('請輸入區塊名稱');
      return;
    }
    if (form.max_score <= 0) {
      alert('滿分必須大於 0');
      return;
    }

    // 過濾空標籤的子項目
    const validItems = checklistItems.filter(item => item.label.trim());

    onSave({
      ...form,
      checklist_items: validItems,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Modal 標題 */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="text-xl font-bold text-gray-900">
            {isNew ? '新增檢查項目' : '編輯檢查項目'}
          </h2>
          <button onClick={onCancel} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 區塊選擇 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">所屬區塊</label>
            {existingSections.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {existingSections.map(s => (
                  <button
                    key={s.section}
                    onClick={() => handleSelectSection(s.section)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      form.section === s.section && !useNewSection
                        ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                        : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    {s.section_name}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setUseNewSection(true);
                    setForm(prev => ({
                      ...prev,
                      section: `section_${existingSections.length + 1}`,
                      section_name: '',
                      section_order: existingSections.length + 1,
                    }));
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    useNewSection
                      ? 'bg-green-100 text-green-700 border-green-300'
                      : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                  }`}
                >
                  <Plus className="w-4 h-4 inline mr-1" /> 新區塊
                </button>
              </div>
            )}
            {(useNewSection || existingSections.length === 0) && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">區塊代號</label>
                  <input
                    type="text"
                    value={form.section}
                    onChange={(e) => updateField('section', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="例: section_6"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">區塊名稱</label>
                  <input
                    type="text"
                    value={form.section_name}
                    onChange={(e) => updateField('section_name', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="例: 新增檢查區塊 (30分)"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 項目基本資訊 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">項目名稱 *</label>
              <input
                type="text"
                value={form.item_name}
                onChange={(e) => updateField('item_name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                placeholder="例: 門口外圍地板"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">滿分 *</label>
                <input
                  type="number"
                  min={1}
                  value={form.max_score}
                  onChange={(e) => updateField('max_score', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">項目順序</label>
                <input
                  type="number"
                  min={1}
                  value={form.item_order}
                  onChange={(e) => updateField('item_order', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">說明（選填）</label>
            <input
              type="text"
              value={form.item_description || ''}
              onChange={(e) => updateField('item_description', e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              placeholder="例: 減少錯誤與主管機關稽核時的罰鍰，按項檢查，每項未達標-2"
            />
          </div>

          {/* 檢查子項目 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">檢查子項目（扣分項）</label>
              <button
                onClick={addChecklistItem}
                className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
              >
                <Plus className="w-4 h-4" /> 新增子項目
              </button>
            </div>

            {checklistItems.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
                尚無子項目，點擊上方按鈕新增
              </div>
            ) : (
              <div className="space-y-2">
                {checklistItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
                    <input
                      type="text"
                      value={item.label}
                      onChange={(e) => updateChecklistItem(idx, 'label', e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm"
                      placeholder="缺失項描述"
                    />
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-sm text-gray-500">扣</span>
                      <input
                        type="number"
                        min={0}
                        value={item.deduction}
                        onChange={(e) => updateChecklistItem(idx, 'deduction', Number(e.target.value))}
                        className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm text-center"
                      />
                      <span className="text-sm text-gray-500">分</span>
                    </div>
                    <label className="flex items-center gap-1 flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={!!item.requires_quantity}
                        onChange={(e) => updateChecklistItem(idx, 'requires_quantity', e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-xs text-gray-500">可計次</span>
                    </label>
                    {item.requires_quantity && (
                      <input
                        type="text"
                        value={item.unit || ''}
                        onChange={(e) => updateChecklistItem(idx, 'unit', e.target.value)}
                        className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm"
                        placeholder="單位"
                      />
                    )}
                    <button
                      onClick={() => removeChecklistItem(idx)}
                      className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部按鈕 */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3 sticky bottom-0 bg-white rounded-b-2xl">
          <button
            onClick={onCancel}
            className="px-5 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isNew ? '新增' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
