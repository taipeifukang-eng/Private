'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Camera,
  X,
  Upload,
  Clock,
  Gift,
  Store,
  Calendar,
  User,
  ChevronLeft,
  ChevronRight,
  Loader2,
  ImageIcon,
} from 'lucide-react';

interface ImprovementDetail {
  id: string;
  inspection_id: string;
  store_id: string;
  template_id: string;
  section_name: string;
  item_name: string;
  deduction_amount: number;
  issue_description: string | null;
  issue_photo_urls: string[];
  selected_items: string[];
  status: 'pending' | 'improved' | 'overdue';
  deadline: string;
  improvement_description: string | null;
  improvement_photo_urls: string[];
  improved_by: string | null;
  improved_at: string | null;
  days_taken: number | null;
  bonus_score: number;
  created_at: string;
  // joined
  store_name: string;
  inspection_date: string;
  inspector_name: string;
}

interface BonusConfig {
  day_from: number;
  day_to: number;
  bonus_score: number;
  description: string | null;
}

export default function ImprovementDetailPage() {
  const router = useRouter();
  const { id } = useParams();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [improvement, setImprovement] = useState<ImprovementDetail | null>(null);
  const [bonusConfig, setBonusConfig] = useState<BonusConfig[]>([]);
  const [canSubmit, setCanSubmit] = useState(false);

  // 改善表單
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  // Lightbox
  const [lightboxPhotos, setLightboxPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      // 查詢改善紀錄
      const { data, error } = await supabase
        .from('inspection_improvements')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        console.error('查詢失敗:', error);
        alert('找不到此改善項目');
        router.push('/inspection/improvements');
        return;
      }

      // 取得關聯資料
      const [storeResult, inspectionResult, bonusResult, submitPermResult] = await Promise.all([
        supabase
          .from('stores')
          .select('store_name')
          .eq('id', data.store_id)
          .single(),
        supabase
          .from('inspection_masters')
          .select('inspection_date, inspector_id')
          .eq('id', data.inspection_id)
          .single(),
        supabase
          .from('inspection_bonus_config')
          .select('day_from, day_to, bonus_score, description')
          .eq('is_active', true)
          .order('sort_order'),
        supabase.rpc('has_permission', {
          p_user_id: user.id,
          p_permission_code: 'inspection.improvement.submit',
        }),
      ]);

      // 另外查詢督導名稱
      let inspectorName = '未知';
      if (inspectionResult.data?.inspector_id) {
        const { data: inspectorProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', inspectionResult.data.inspector_id)
          .single();
        inspectorName = inspectorProfile?.full_name || '未知';
      }

      const detail: ImprovementDetail = {
        ...data,
        store_name: storeResult.data?.store_name || '未知門市',
        inspection_date: inspectionResult.data?.inspection_date || '',
        inspector_name: inspectorName,
      };

      // 也檢查: 是不是自己門市的（有 store_managers）或是 admin
      let hasSubmitAccess = submitPermResult.data === true;
      if (!hasSubmitAccess) {
        // 檢查 store_managers
        const { data: sm } = await supabase
          .from('store_managers')
          .select('id')
          .eq('store_id', data.store_id)
          .eq('user_id', user.id)
          .limit(1);
        if (sm && sm.length > 0) hasSubmitAccess = true;
      }
      if (!hasSubmitAccess) {
        // admin 兜底
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        if (profile?.role === 'admin') hasSubmitAccess = true;
      }

      setImprovement(detail);
      setBonusConfig(bonusResult.data || []);
      setCanSubmit(hasSubmitAccess && detail.status === 'pending');

      // 如果已經有改善資料，載入
      if (detail.improvement_description) {
        setDescription(detail.improvement_description);
      }
      if (detail.improvement_photo_urls && detail.improvement_photo_urls.length > 0) {
        setPhotos(detail.improvement_photo_urls);
      }
    } catch (error) {
      console.error('載入失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // 計算天數
  const getDaysInfo = () => {
    if (!improvement) return { daysRemaining: 0, daysSince: 0 };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadline = new Date(improvement.deadline);
    deadline.setHours(0, 0, 0, 0);
    const inspDate = new Date(improvement.inspection_date);
    inspDate.setHours(0, 0, 0, 0);
    return {
      daysRemaining: Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
      daysSince: Math.ceil((today.getTime() - inspDate.getTime()) / (1000 * 60 * 60 * 24)),
    };
  };

  // 預估加分
  const getEstimatedBonus = (daysSince: number) => {
    const config = bonusConfig.find(
      (c) => daysSince >= c.day_from && daysSince <= c.day_to
    );
    return config?.bonus_score || 0;
  };

  // 壓縮圖片
  const compressImage = (file: File, maxWidth: number, quality: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.createElement('img');
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // 上傳照片
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const remaining = 5 - photos.length;
    const toProcess = Array.from(files).slice(0, remaining);

    for (const file of toProcess) {
      try {
        const base64 = await compressImage(file, 800, 0.7);
        setPhotos((prev) => [...prev, base64]);
      } catch (error) {
        console.error('照片壓縮失敗:', error);
      }
    }
    // Reset input
    e.target.value = '';
  };

  // 移除照片
  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // 提交改善
  const handleSubmit = async () => {
    if (!improvement) return;
    if (!description.trim()) {
      alert('請填寫改善說明');
      return;
    }
    if (photos.length === 0) {
      alert('請至少上傳一張改善照片');
      return;
    }

    try {
      setSubmitting(true);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');

      const { error } = await supabase
        .from('inspection_improvements')
        .update({
          improvement_description: description.trim(),
          improvement_photo_urls: photos,
          improved_by: user.id,
          improved_at: new Date().toISOString(),
          status: 'improved',
          updated_at: new Date().toISOString(),
        })
        .eq('id', improvement.id);

      if (error) {
        console.error('提交失敗:', error);
        alert('提交失敗：' + error.message);
        return;
      }

      alert('改善內容已送出！');
      // 重新載入以取得 trigger 計算的 bonus_score
      fetchDetail();
    } catch (error: any) {
      console.error('提交失敗:', error);
      alert('提交失敗：' + (error?.message || '未知錯誤'));
    } finally {
      setSubmitting(false);
    }
  };

  // Lightbox 操作
  const openLightbox = (photoArray: string[], index: number) => {
    setLightboxPhotos(photoArray);
    setLightboxIndex(index);
    setShowLightbox(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!improvement) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-gray-600">找不到此項目</p>
          <Link href="/inspection/improvements" className="text-blue-600 mt-2 inline-block">
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  const { daysRemaining, daysSince } = getDaysInfo();
  const estimatedBonus = getEstimatedBonus(daysSince);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導覽 */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/inspection/improvements"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-gray-800">改善事項詳情</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* 狀態卡片 */}
        <div
          className={`rounded-lg p-4 ${
            improvement.status === 'improved'
              ? 'bg-green-50 border border-green-200'
              : improvement.status === 'overdue'
              ? 'bg-red-50 border border-red-200'
              : 'bg-amber-50 border border-amber-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {improvement.status === 'pending' && (
                <>
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <span className="font-semibold text-amber-700">待改善</span>
                </>
              )}
              {improvement.status === 'improved' && (
                <>
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="font-semibold text-green-700">已改善</span>
                </>
              )}
              {improvement.status === 'overdue' && (
                <>
                  <XCircle className="w-5 h-5 text-red-500" />
                  <span className="font-semibold text-red-700">已逾期</span>
                </>
              )}
            </div>

            {improvement.status === 'pending' && (
              <span
                className={`text-sm font-medium ${
                  daysRemaining <= 2 ? 'text-red-600' : 'text-amber-600'
                }`}
              >
                {daysRemaining > 0
                  ? `剩餘 ${daysRemaining} 天`
                  : daysRemaining === 0
                  ? '今天到期'
                  : `已逾期 ${Math.abs(daysRemaining)} 天`}
              </span>
            )}
            {improvement.status === 'improved' && improvement.bonus_score > 0 && (
              <div className="flex items-center gap-1.5 bg-green-100 px-3 py-1 rounded-full">
                <Gift className="w-4 h-4 text-green-600" />
                <span className="text-green-700 font-bold">+{improvement.bonus_score}分</span>
              </div>
            )}
          </div>

          {/* 基本資訊 */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-1.5 text-gray-600">
              <Store className="w-3.5 h-3.5" />
              <span>{improvement.store_name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600">
              <User className="w-3.5 h-3.5" />
              <span>督導: {improvement.inspector_name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600">
              <Calendar className="w-3.5 h-3.5" />
              <span>巡店: {improvement.inspection_date}</span>
            </div>
            <div className="flex items-center gap-1.5 text-gray-600">
              <Clock className="w-3.5 h-3.5" />
              <span>期限: {improvement.deadline}</span>
            </div>
          </div>
        </div>

        {/* 問題描述 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-100">
            <h2 className="font-semibold text-red-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              問題描述
            </h2>
          </div>
          <div className="p-4 space-y-3">
            {/* 區塊 + 項目 */}
            <div>
              <div className="text-xs text-gray-500 mb-1">檢查區塊</div>
              <div className="text-sm text-gray-800">
                <span className="text-gray-500">{improvement.section_name}</span>
                <span className="mx-1 text-gray-300">›</span>
                <span className="font-medium">{improvement.item_name}</span>
              </div>
            </div>

            {/* 扣分 */}
            <div>
              <div className="text-xs text-gray-500 mb-1">扣分</div>
              <span className="text-red-600 font-bold text-lg">-{improvement.deduction_amount} 分</span>
            </div>

            {/* 缺失項目 */}
            {improvement.selected_items && improvement.selected_items.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1">缺失項目</div>
                <div className="flex flex-wrap gap-1.5">
                  {improvement.selected_items.map((item, idx) => (
                    <span
                      key={idx}
                      className="bg-red-50 text-red-700 text-sm px-2.5 py-1 rounded-md border border-red-100"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 督導備註 */}
            {improvement.issue_description && (
              <div>
                <div className="text-xs text-gray-500 mb-1">督導備註</div>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 border">
                  {improvement.issue_description}
                </p>
              </div>
            )}

            {/* 問題照片 */}
            {improvement.issue_photo_urls && improvement.issue_photo_urls.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1">
                  問題照片 ({improvement.issue_photo_urls.length}張)
                </div>
                <div className="flex gap-2 flex-wrap">
                  {improvement.issue_photo_urls.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => openLightbox(improvement.issue_photo_urls, idx)}
                      className="w-20 h-20 rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors"
                    >
                      <img
                        src={url}
                        alt={`問題照片 ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 已改善結果 */}
        {improvement.status === 'improved' && (
          <div className="bg-white rounded-lg shadow-sm border border-green-200 overflow-hidden">
            <div className="px-4 py-3 bg-green-50 border-b border-green-100">
              <h2 className="font-semibold text-green-800 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                改善結果
              </h2>
            </div>
            <div className="p-4 space-y-3">
              {/* 改善時間 + 加分 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-green-600 mb-1">改善天數</div>
                  <div className="text-lg font-bold text-green-700">
                    {improvement.days_taken ?? '-'} 天
                  </div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-xs text-green-600 mb-1">獲得加分</div>
                  <div className="text-lg font-bold text-green-700">
                    +{improvement.bonus_score} 分
                  </div>
                </div>
              </div>

              {improvement.improved_at && (
                <div className="text-xs text-gray-500">
                  改善時間: {new Date(improvement.improved_at).toLocaleString('zh-TW')}
                </div>
              )}

              {/* 改善說明 */}
              {improvement.improvement_description && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">改善說明</div>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 border">
                    {improvement.improvement_description}
                  </p>
                </div>
              )}

              {/* 改善照片 */}
              {improvement.improvement_photo_urls &&
                improvement.improvement_photo_urls.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">
                      改善照片 ({improvement.improvement_photo_urls.length}張)
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {improvement.improvement_photo_urls.map((url, idx) => (
                        <button
                          key={idx}
                          onClick={() => openLightbox(improvement.improvement_photo_urls, idx)}
                          className="w-20 h-20 rounded-lg overflow-hidden border border-gray-200 hover:border-green-400 transition-colors"
                        >
                          <img
                            src={url}
                            alt={`改善照片 ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          </div>
        )}

        {/* 改善上傳表單（僅 pending 狀態且有權限） */}
        {(improvement.status === 'pending' || improvement.status === 'overdue') && canSubmit && (
          <div className="bg-white rounded-lg shadow-sm border border-blue-200 overflow-hidden">
            <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
              <h2 className="font-semibold text-blue-800 flex items-center gap-2">
                <Upload className="w-4 h-4" />
                上傳改善內容
              </h2>
            </div>
            <div className="p-4 space-y-4">
              {/* 加分規則提示 */}
              {bonusConfig.length > 0 && improvement.status === 'pending' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="text-xs font-medium text-amber-700 mb-2 flex items-center gap-1">
                    <Gift className="w-3.5 h-3.5" />
                    早日改善可獲得加分：
                  </div>
                  <div className="space-y-1">
                    {bonusConfig.map((config, idx) => (
                      <div
                        key={idx}
                        className={`text-xs flex items-center justify-between px-2 py-1 rounded ${
                          daysSince >= config.day_from && daysSince <= config.day_to
                            ? 'bg-amber-200 text-amber-800 font-bold'
                            : 'text-amber-600'
                        }`}
                      >
                        <span>
                          {config.day_from === 0 ? '當天' : `第${config.day_from}天`} ~{' '}
                          第{config.day_to}天
                        </span>
                        <span>+{config.bonus_score} 分</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-xs text-amber-700 border-t border-amber-200 pt-2">
                    目前已第 <span className="font-bold">{daysSince}</span> 天，
                    {estimatedBonus > 0 ? (
                      <span>
                        現在上傳可加 <span className="font-bold text-green-700">+{estimatedBonus}分</span>
                      </span>
                    ) : (
                      <span className="text-red-600">已超過加分期限</span>
                    )}
                  </div>
                </div>
              )}

              {/* 改善說明 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  改善說明 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="請描述改善的內容，例如：已重新清潔地板並安排每日三次巡檢..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                    focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>

              {/* 照片上傳 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  改善照片 <span className="text-red-500">*</span>
                  <span className="text-gray-400 font-normal ml-1">({photos.length}/5)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {photos.map((photo, idx) => (
                    <div key={idx} className="relative w-20 h-20">
                      <button
                        onClick={() => openLightbox(photos, idx)}
                        className="w-full h-full rounded-lg overflow-hidden border border-gray-200"
                      >
                        <img
                          src={photo}
                          alt={`改善照片 ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                      <button
                        onClick={() => removePhoto(idx)}
                        className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5
                          flex items-center justify-center hover:bg-red-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {photos.length < 5 && (
                    <label className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg
                      flex flex-col items-center justify-center cursor-pointer
                      hover:border-blue-400 hover:bg-blue-50 transition-colors">
                      <Camera className="w-5 h-5 text-gray-400" />
                      <span className="text-xs text-gray-400 mt-1">上傳</span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handlePhotoUpload}
                        className="hidden"
                        multiple
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* 送出按鈕 */}
              <button
                onClick={handleSubmit}
                disabled={submitting || !description.trim() || photos.length === 0}
                className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium
                  hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed
                  transition-colors flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    提交中...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    送出改善內容
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* 無權限提交提示 */}
        {improvement.status === 'pending' && !canSubmit && !loading && (
          <div className="bg-gray-100 rounded-lg p-4 text-center text-sm text-gray-500">
            <p>您沒有提交改善的權限</p>
            <p className="text-xs mt-1">僅該門市的店長可以上傳改善內容</p>
          </div>
        )}

        {/* 連結到巡店記錄 */}
        <div className="text-center pb-4">
          <Link
            href={`/inspection/${improvement.inspection_id}`}
            className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            查看完整巡店記錄 →
          </Link>
        </div>
      </div>

      {/* Lightbox */}
      {showLightbox && lightboxPhotos.length > 0 && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
          onClick={() => setShowLightbox(false)}
        >
          {/* 關閉 */}
          <button
            onClick={() => setShowLightbox(false)}
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
          >
            <X className="w-8 h-8" />
          </button>

          {/* 計數器 */}
          <div className="absolute top-4 left-4 text-white/80 text-sm">
            {lightboxIndex + 1} / {lightboxPhotos.length}
          </div>

          {/* 上一張 */}
          {lightboxPhotos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(
                  (prev) => (prev - 1 + lightboxPhotos.length) % lightboxPhotos.length
                );
              }}
              className="absolute left-3 p-2 bg-black/50 rounded-full text-white/80 hover:text-white"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* 圖片 */}
          <img
            src={lightboxPhotos[lightboxIndex]}
            alt="照片"
            className="max-w-[90vw] max-h-[85vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* 下一張 */}
          {lightboxPhotos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex((prev) => (prev + 1) % lightboxPhotos.length);
              }}
              className="absolute right-3 p-2 bg-black/50 rounded-full text-white/80 hover:text-white"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
