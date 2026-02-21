import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import PrintInspectionReport from '@/components/PrintInspectionReport';
import {
  ArrowLeft,
  Calendar,
  Store,
  User,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Edit,
  Printer,
  FileCheck,
  Camera,
  Image as ImageIcon,
  PenTool,
  MapPin,
} from 'lucide-react';

// 強制動態渲染，禁用快取
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 評級顏色配置 (0-10 分數系統)
const getGradeBadgeStyle = (grade: string) => {
  const score = parseInt(grade);
  if (score >= 8) {
    return 'bg-purple-100 text-purple-800 border-purple-300'; // 8-10: 優秀
  } else if (score >= 6) {
    return 'bg-green-100 text-green-800 border-green-300'; // 6-7: 良好
  } else if (score >= 4) {
    return 'bg-yellow-100 text-yellow-800 border-yellow-300'; // 4-5: 尚可
  } else {
    return 'bg-red-100 text-red-800 border-red-300'; // 0-3: 需改善
  }
};

// 狀態顯示配置
const getStatusBadgeStyle = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-green-50 text-green-700 border-green-200';
    case 'in_progress':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'draft':
      return 'bg-gray-50 text-gray-700 border-gray-200';
    case 'closed':
      return 'bg-purple-50 text-purple-700 border-purple-200';
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200';
  }
};

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    draft: '草稿',
    in_progress: '進行中',
    completed: '已完成',
    closed: '已結案',
  };
  return labels[status] || status;
};

export default async function InspectionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  // 驗證登入（必須在 try/catch 外部，redirect 會拋出特殊錯誤）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  try {
    // 2. 獲取巡店記錄（不使用關聯）
    const { data: inspection, error: inspectionError } = await supabase
      .from('inspection_masters')
      .select(`
        id,
        store_id,
        inspector_id,
        inspection_date,
        status,
        total_score,
        max_possible_score,
        grade,
        score_percentage,
        supervisor_notes,
        signature_photo_url,
        gps_latitude,
        gps_longitude,
        created_at,
        updated_at
      `)
      .eq('id', params.id)
      .single();

    if (inspectionError || !inspection) {
      console.error('❌ 獲取巡店記錄失敗:', inspectionError);
      notFound();
    }

    // 3. 獲取門市資料
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('id, store_name, store_code, short_name, address')
      .eq('id', inspection.store_id)
      .single();

    if (storeError || !store) {
      console.error('❌ 無法載入門市資料:', storeError);
      notFound();
    }

    // 4. 獲取督導資料
    const { data: inspector } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', inspection.inspector_id)
      .single();

    const safeInspector = inspector || { 
      id: inspection.inspector_id, 
      full_name: '(資料載入中)' 
    };

    // 5. 獲取檢查結果明細（使用 Admin Client 繞過 RLS）
    const adminClient = createAdminClient();
    
    const { data: rawResults, error: resultsError } = await adminClient
      .from('inspection_results')
      .select(`
        id,
        template_id,
        max_score,
        given_score,
        deduction_amount,
        is_improvement,
        notes,
        photo_urls
      `)
      .eq('inspection_id', params.id);

    if (resultsError) {
      console.error('❌ 獲取檢查結果失敗:', resultsError);
    }

    // 6. 獲取所有相關的檢查範本（使用 Admin Client 繞過 RLS）
    const templateIds = Array.from(new Set(rawResults?.map(r => r.template_id).filter(Boolean) || []));
    let templates: any[] = [];
    if (templateIds.length > 0) {
      const { data: templateData, error: templateError } = await adminClient
        .from('inspection_templates')
        .select(`
          id,
          section,
          section_name,
          section_order,
          item_name,
          item_description,
          item_order,
          max_score,
          scoring_type
        `)
        .in('id', templateIds);
      templates = templateData || [];
      if (templateError) {
        console.error('❌ 獲取檢查範本失敗:', templateError);
      }
    }

    // 7. 組合資料
    const templateMap = new Map(templates.map(t => [t.id, t]));
    const results = (rawResults || []).map((result: any) => ({
      ...result,
      template: templateMap.get(result.template_id) || null,
    })).filter(r => r.template); // 只保留有模板的結果

    // 8. 按區塊分組結果
    const groupedResults = results.reduce((acc, result: any) => {
      if (!result.template) return acc;
      
      const section = result.template.section;
      if (!acc[section]) {
        acc[section] = {
          section_name: result.template.section_name,
          section_order: result.template.section_order,
          items: [],
          total_max: 0,
          total_earned: 0,
        };
      }
      acc[section].items.push(result);
      acc[section].total_max += result.max_score;
      acc[section].total_earned += result.given_score;
      return acc;
    }, {} as Record<string, any>);

    const sortedSections = Object.entries(groupedResults).sort(
      ([, a], [, b]) => (a as any).section_order - (b as any).section_order
    );

    // 9. 需改善項目
    const improvementItems = results.filter((r: any) => r.is_improvement);

    // 10. 檢查是否可編輯
    const canEdit =
      inspection.inspector_id === user.id &&
      (inspection.status === 'draft' || inspection.status === 'in_progress');

    console.log('✅ 所有資料載入完成，開始渲染頁面');

    return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 頁面標題 */}
        <div className="mb-6">
          <Link
            href="/inspection"
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft size={20} />
            返回列表
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">巡店記錄詳情</h1>
              <p className="mt-2 text-sm text-gray-600">
                建立於 {new Date(inspection.created_at).toLocaleString('zh-TW')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {canEdit && (
                <Link
                  href={`/inspection/${params.id}/edit`}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit size={18} />
                  編輯
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* 基本資訊卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Store className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">巡店門市</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">
                  {store.short_name || store.store_name}
                </p>
                <p className="text-xs text-gray-500">{store.store_code}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">巡店日期</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">
                  {new Date(inspection.inspection_date).toLocaleDateString('zh-TW')}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">督導人員</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">
                  {safeInspector.full_name}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <FileCheck className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">狀態</p>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border mt-1 ${getStatusBadgeStyle(
                    inspection.status
                  )}`}
                >
                  {getStatusLabel(inspection.status)}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <MapPin className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">GPS定位</p>
                {inspection.gps_latitude && inspection.gps_longitude ? (
                  <div className="mt-0.5">
                    <a
                      href={`https://www.google.com/maps?q=${inspection.gps_latitude},${inspection.gps_longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-teal-600 hover:text-teal-700 hover:underline"
                    >
                      {Number(inspection.gps_latitude).toFixed(6)}, {Number(inspection.gps_longitude).toFixed(6)}
                    </a>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 mt-0.5">未記錄</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 分數總覽 */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl shadow-lg p-6 mb-6 text-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-sm opacity-90">初始分數</p>
              <p className="text-3xl font-bold mt-1">{inspection.max_possible_score}</p>
            </div>
            <div>
              <p className="text-sm opacity-90">總扣分</p>
              <div className="mt-1">
                <span className="text-2xl font-bold text-red-200">
                  -{inspection.max_possible_score - inspection.total_score}
                </span>
              </div>
            </div>
            <div>
              <p className="text-sm opacity-90">最終得分</p>
              <p className="text-3xl font-bold mt-1">{inspection.total_score}</p>
            </div>
            <div>
              <p className="text-sm opacity-90">得分數(滿分10分)</p>
              <div className="mt-1">
                <span
                  className={`inline-flex items-center px-4 py-2 rounded-full text-2xl font-bold border-2 ${getGradeBadgeStyle(
                    inspection.grade
                  )}`}
                >
                  {inspection.grade}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 需改善項目 */}
        {improvementItems.length > 0 && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-red-600" />
              <h2 className="text-xl font-bold text-red-900">
                需改善項目 ({improvementItems.length} 項)
              </h2>
            </div>
            <div className="space-y-3">
              {improvementItems.map((item: any, index) => (
                <div
                  key={item.id}
                  className="bg-white border border-red-200 rounded-lg p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-red-600">
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">
                        {item.template.item_name}
                        <span className="ml-2 text-sm font-normal text-red-600">
                          扣 {item.deduction_amount} 分
                        </span>
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {item.template.item_description}
                      </p>
                      {item.notes && (
                        <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <p className="text-sm text-gray-700">
                            <strong>改善建議：</strong>
                            {item.notes}
                          </p>
                        </div>
                      )}
                      
                      {/* 問題照片 */}
                      {item.photo_urls && item.photo_urls.length > 0 && (
                        <div className="mt-3">
                          <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
                            <Camera className="w-4 h-4" />
                            問題照片 ({item.photo_urls.length})
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {item.photo_urls.map((photoUrl: string, idx: number) => (
                              <a
                                key={idx}
                                href={photoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group relative block"
                              >
                                <img
                                  src={photoUrl}
                                  alt={`問題照片 ${idx + 1}`}
                                  className="w-24 h-24 object-cover rounded-lg border-2 border-gray-300 hover:border-blue-500 transition-colors cursor-pointer"
                                />
                                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 rounded-lg transition-opacity flex items-center justify-center">
                                  <ImageIcon className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 檢查項目詳情 */}
        <div className="space-y-4 mb-6">
          <h2 className="text-xl font-bold text-gray-900">檢查項目詳情</h2>
          {sortedSections.length === 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
              <p className="text-gray-500">此次巡店無檢查明細資料</p>
            </div>
          )}
          {sortedSections.map(([sectionKey, section]) => {
            const sectionData = section as any;
            return (
            <div
              key={sectionKey}
              className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
            >
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {sectionData.section_name}
                  </h3>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-gray-900">
                      {sectionData.total_earned}
                    </span>
                    <span className="text-gray-500"> / {sectionData.total_max}</span>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-gray-200">
                {sectionData.items.map((result: any) => (
                  <div
                    key={result.id}
                    className={`px-6 py-4 ${
                      result.needs_improvement ? 'bg-red-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {result.is_improvement ? (
                            <AlertCircle className="w-5 h-5 text-red-500" />
                          ) : (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          )}
                          <h4 className="font-semibold text-gray-900">
                            {result.template.item_name}
                          </h4>
                        </div>
                        <p className="text-sm text-gray-600 mt-1 ml-7">
                          {result.template.item_description}
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="text-sm text-gray-600">得分</p>
                        <p
                          className={`text-xl font-bold ${
                            result.is_improvement
                              ? 'text-red-600'
                              : 'text-green-600'
                          }`}
                        >
                          {result.given_score}
                          <span className="text-sm text-gray-500">
                            /{result.max_score}
                          </span>
                        </p>
                        {result.deduction_amount > 0 && (
                          <p className="text-xs text-red-600">扣 {result.deduction_amount} 分</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            );
          })}
        </div>

        {/* 督導簽名 */}
        {inspection.signature_photo_url && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <PenTool className="w-5 h-5" />
              督導簽名
            </h2>
            <div className="border border-gray-300 rounded-lg p-4 inline-block bg-gray-50">
              <img
                src={inspection.signature_photo_url}
                alt="督導簽名"
                className="max-h-32"
              />
            </div>
          </div>
        )}

        {/* 備註 */}
        {inspection.supervisor_notes && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">備註說明</h2>
            <p className="text-gray-700 whitespace-pre-wrap">{inspection.supervisor_notes}</p>
          </div>
        )}

        {/* 列印報表按鈕與組件 */}
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">列印報表</h2>
              <p className="text-sm text-gray-600 mt-1">產生完整的 A4 格式巡店報告，包含待改善項目彙整與簽名欄位</p>
            </div>
          </div>
          <PrintInspectionReport
            inspection={inspection}
            store={store}
            inspector={safeInspector}
            groupedResults={sortedSections}
            improvementItems={improvementItems}
          />
        </div>
      </div>
    </div>
  );
  } catch (error: any) {
    // 重要：必須重新拋出 redirect、notFound 等特殊錯誤
    if (error?.digest) throw error;
    
    console.error('❌ 巡店詳情頁發生錯誤:', error);
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">❌</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">載入巡店詳情時發生錯誤</h1>
            <p className="text-gray-600 mb-6">{error?.message || '未知錯誤'}</p>
            <div className="mt-6 flex gap-4 justify-center">
              <Link
                href="/inspection"
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                返回列表
              </Link>
              <a
                href={`/inspection/${params.id}`}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                重新載入
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
