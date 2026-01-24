'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ChevronLeft, 
  Save, 
  User,
  Building2,
  Calendar,
  AlertCircle,
  Info
} from 'lucide-react';
import { MONTHLY_STATUS_OPTIONS, POSITION_OPTIONS, BONUS_BLOCK_DESCRIPTIONS } from '@/types/workflow';
import type { MonthlyStaffStatus, MonthlyStatusType } from '@/types/workflow';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditStaffStatusPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staffStatus, setStaffStatus] = useState<MonthlyStaffStatus | null>(null);
  
  // 表單狀態
  const [position, setPosition] = useState('');
  const [monthlyStatus, setMonthlyStatus] = useState<MonthlyStatusType>('full_month');
  const [workDays, setWorkDays] = useState<number>(0);
  const [workHours, setWorkHours] = useState<number>(0);
  const [isDualPosition, setIsDualPosition] = useState(false);
  const [hasManagerBonus, setHasManagerBonus] = useState(false);
  const [isSupervisorRotation, setIsSupervisorRotation] = useState(false);
  const [notes, setNotes] = useState('');

  // 計算出的區塊 (前端預覽)
  const [previewBlock, setPreviewBlock] = useState<number>(0);

  useEffect(() => {
    loadStaffStatus();
  }, [resolvedParams.id]);

  // 當表單值變更時，重新計算區塊
  useEffect(() => {
    calculateBlock();
  }, [position, monthlyStatus, isDualPosition, isSupervisorRotation, staffStatus?.employment_type, staffStatus?.is_pharmacist]);

  const loadStaffStatus = async () => {
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      
      const { data, error } = await supabase
        .from('monthly_staff_status')
        .select(`
          *,
          store:stores(store_code, store_name)
        `)
        .eq('id', resolvedParams.id)
        .single();

      if (error) {
        console.error('Error loading staff status:', error);
        alert('載入失敗');
        router.back();
        return;
      }

      setStaffStatus(data);
      
      // 設置表單初始值
      setPosition(data.position || '');
      setMonthlyStatus(data.monthly_status);
      setWorkDays(data.work_days || 0);
      setWorkHours(data.work_hours || 0);
      setIsDualPosition(data.is_dual_position || false);
      setHasManagerBonus(data.has_manager_bonus || false);
      setIsSupervisorRotation(data.is_supervisor_rotation || false);
      setNotes(data.notes || '');
    } catch (error) {
      console.error('Error:', error);
      alert('載入失敗');
      router.back();
    } finally {
      setLoading(false);
    }
  };

  const calculateBlock = () => {
    if (!staffStatus) return;

    const empType = staffStatus.employment_type;
    const isPharmacist = staffStatus.is_pharmacist;

    // 區塊 2：督導卡班
    if (isSupervisorRotation) {
      setPreviewBlock(2);
      return;
    }

    // 區塊 6：兼職一般人
    if (empType === 'part_time' && !isPharmacist) {
      setPreviewBlock(6);
      return;
    }

    // 區塊 5：兼職藥師
    if (empType === 'part_time' && isPharmacist) {
      setPreviewBlock(5);
      return;
    }

    // 區塊 4：特殊時數 (督導(代理店長)-雙)
    if (position.includes('督導') && position.includes('代理店長') && isDualPosition) {
      setPreviewBlock(4);
      return;
    }

    // 區塊 3：非整月正職 (但店長-雙、代理店長-雙也在這)
    if (empType === 'full_time' && monthlyStatus !== 'full_month') {
      setPreviewBlock(3);
      return;
    }

    // 區塊 3：店長-雙、代理店長-雙
    if (isDualPosition && (position.includes('店長') || position.includes('代理店長'))) {
      setPreviewBlock(3);
      return;
    }

    // 區塊 1：正職整月
    if (empType === 'full_time' && monthlyStatus === 'full_month') {
      setPreviewBlock(1);
      return;
    }

    setPreviewBlock(0);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { updateStaffStatus } = await import('@/app/store/actions');
      
      const result = await updateStaffStatus(resolvedParams.id, {
        position,
        monthly_status: monthlyStatus,
        work_days: staffStatus?.employment_type === 'full_time' ? workDays : undefined,
        work_hours: staffStatus?.employment_type === 'part_time' ? workHours : undefined,
        is_dual_position: isDualPosition,
        has_manager_bonus: hasManagerBonus,
        is_supervisor_rotation: isSupervisorRotation,
        notes
      });

      if (result.success) {
        alert('✅ 儲存成功');
        router.back();
      } else {
        alert(`❌ 儲存失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error saving:', error);
      alert('儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  if (!staffStatus) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">找不到資料</div>
      </div>
    );
  }

  // 已確認的狀態不能編輯
  if (staffStatus.status === 'confirmed') {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-yellow-600 mb-4" />
            <h2 className="text-xl font-semibold text-yellow-800 mb-2">此資料已確認</h2>
            <p className="text-yellow-700 mb-4">已確認的人員狀態無法再修改</p>
            <button
              onClick={() => router.back()}
              className="px-6 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
            >
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">編輯人員狀態</h1>
            <p className="text-gray-600">{staffStatus.year_month.replace('-', ' 年 ')} 月</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
          {/* 員工基本資訊 (唯讀) */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-500 mb-3">員工基本資訊</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-gray-500">姓名</label>
                <p className="font-medium text-gray-900">{staffStatus.employee_name}</p>
              </div>
              <div>
                <label className="text-xs text-gray-500">員工代號</label>
                <p className="font-medium text-gray-900">{staffStatus.employee_code || '-'}</p>
              </div>
              <div>
                <label className="text-xs text-gray-500">雇用類型</label>
                <p className="font-medium text-gray-900">
                  {staffStatus.employment_type === 'full_time' ? '正職' : '兼職'}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500">是否藥師</label>
                <p className="font-medium text-gray-900">
                  {staffStatus.is_pharmacist ? '是' : '否'}
                </p>
              </div>
            </div>
          </div>

          {/* 職位選擇 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              職位 *
            </label>
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">請選擇職位</option>
              {POSITION_OPTIONS.map(pos => (
                <option key={pos} value={pos}>{pos}</option>
              ))}
            </select>
          </div>

          {/* 本月狀態 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              本月狀態 *
            </label>
            <select
              value={monthlyStatus}
              onChange={(e) => setMonthlyStatus(e.target.value as MonthlyStatusType)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {MONTHLY_STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 天數/時數輸入 */}
          {staffStatus.employment_type === 'full_time' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                本月工作天數
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max={staffStatus.total_days_in_month}
                  value={workDays}
                  onChange={(e) => setWorkDays(parseInt(e.target.value) || 0)}
                  className="w-24 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-600">/ {staffStatus.total_days_in_month} 天</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {monthlyStatus === 'full_month' ? '整月在職請填滿天數' : '請填入實際工作天數'}
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                本月工作時數
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={workHours}
                  onChange={(e) => setWorkHours(parseFloat(e.target.value) || 0)}
                  className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-600">小時 (基準: 160 小時)</span>
              </div>
            </div>
          )}

          {/* 特殊標記 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              特殊標記
            </label>
            <div className="space-y-3">
              <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDualPosition}
                  onChange={(e) => setIsDualPosition(e.target.checked)}
                  className="mt-1 w-4 h-4 text-blue-600 rounded"
                />
                <div>
                  <div className="font-medium text-gray-900">是否為「雙」職務</div>
                  <div className="text-sm text-gray-500">
                    如：店長-雙、代理店長-雙、督導(代理店長)-雙
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasManagerBonus}
                  onChange={(e) => setHasManagerBonus(e.target.checked)}
                  className="mt-1 w-4 h-4 text-blue-600 rounded"
                />
                <div>
                  <div className="font-medium text-gray-900">店長/代理店長加成資格</div>
                  <div className="text-sm text-gray-500">
                    是否套用店長達標加成 (managerMultiplier)
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSupervisorRotation}
                  onChange={(e) => setIsSupervisorRotation(e.target.checked)}
                  className="mt-1 w-4 h-4 text-blue-600 rounded"
                />
                <div>
                  <div className="font-medium text-gray-900">督導卡班</div>
                  <div className="text-sm text-gray-500">
                    督導輪調/卡班（獎金 = 0）
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* 備註 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              備註
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="如有特殊情況請在此說明..."
            />
          </div>

          {/* 計算區塊預覽 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-semibold text-blue-900 mb-1">系統自動計算區塊</h4>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 text-sm font-bold rounded ${getBlockColor(previewBlock)}`}>
                    區塊 {previewBlock}
                  </span>
                  <span className="text-blue-800">
                    {BONUS_BLOCK_DESCRIPTIONS[previewBlock] || '未分類'}
                  </span>
                </div>
                <p className="text-sm text-blue-700 mt-2">
                  此區塊由系統根據您填寫的資料自動判定，用於獎金計算
                </p>
              </div>
            </div>
          </div>

          {/* 操作按鈕 */}
          <div className="flex justify-end gap-4 pt-4 border-t">
            <button
              onClick={() => router.back()}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !position}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={18} />
              {saving ? '儲存中...' : '儲存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getBlockColor(block: number): string {
  const colors: Record<number, string> = {
    0: 'bg-gray-100 text-gray-600',
    1: 'bg-green-100 text-green-800',
    2: 'bg-gray-200 text-gray-800',
    3: 'bg-blue-100 text-blue-800',
    4: 'bg-purple-100 text-purple-800',
    5: 'bg-yellow-100 text-yellow-800',
    6: 'bg-red-100 text-red-800'
  };
  return colors[block] || 'bg-gray-100 text-gray-600';
}
