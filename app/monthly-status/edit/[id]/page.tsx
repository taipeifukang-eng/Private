'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { 
  ChevronLeft, 
  Save, 
  AlertCircle,
  Info,
  User,
  Briefcase,
  Clock,
  Star,
  Plus
} from 'lucide-react';
import { 
  MONTHLY_STATUS_OPTIONS, 
  POSITION_OPTIONS, 
  BONUS_BLOCK_DESCRIPTIONS,
  NEWBIE_LEVEL_OPTIONS,
  ADMIN_LEVEL_OPTIONS,
  PARTIAL_MONTH_REASON_OPTIONS,
  EXTRA_TASK_OPTIONS,
  SPECIAL_ROLE_OPTIONS
} from '@/types/workflow';
import type { 
  MonthlyStaffStatus, 
  MonthlyStatusType, 
  NewbieLevel, 
  PartialMonthReason,
  ExtraTask 
} from '@/types/workflow';

export default function EditStaffStatusPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearMonth = searchParams.get('year_month');
  const storeId = searchParams.get('store_id');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staffStatus, setStaffStatus] = useState<MonthlyStaffStatus | null>(null);
  
  // 基本表單狀態
  const [position, setPosition] = useState('');
  const [employmentType, setEmploymentType] = useState<'full_time' | 'part_time'>('full_time');
  const [monthlyStatus, setMonthlyStatus] = useState<MonthlyStatusType>('full_month');
  const [workDays, setWorkDays] = useState<number>(0);
  const [workHours, setWorkHours] = useState<number>(0);
  const [isDualPosition, setIsDualPosition] = useState(false);
  const [hasManagerBonus, setHasManagerBonus] = useState(false);
  const [isSupervisorRotation, setIsSupervisorRotation] = useState(false);
  const [isPharmacist, setIsPharmacist] = useState(false);
  const [notes, setNotes] = useState('');
  const [startDate, setStartDate] = useState<string>(''); // 到職日期

  // === 新增欄位狀態 ===
  // 新人等級
  const [newbieLevel, setNewbieLevel] = useState<NewbieLevel | ''>('');
  
  // 非整月詳情
  const [partialMonthReason, setPartialMonthReason] = useState<PartialMonthReason | ''>('');
  const [partialMonthDays, setPartialMonthDays] = useState<number>(0);
  const [partialMonthNotes, setPartialMonthNotes] = useState('');
  
  // 督導卡班資訊
  const [supervisorShiftHours, setSupervisorShiftHours] = useState<number>(0);
  const [supervisorEmployeeCode, setSupervisorEmployeeCode] = useState('');
  const [supervisorName, setSupervisorName] = useState('');
  const [supervisorPosition, setSupervisorPosition] = useState('');
  
  // 額外任務
  const [extraTasks, setExtraTasks] = useState<ExtraTask[]>([]);
  
  // 獎金費用
  const [lastMonthSingleItemBonus, setLastMonthSingleItemBonus] = useState<number>(0);
  const [talentCultivationBonus, setTalentCultivationBonus] = useState<number>(0);
  const [talentCultivationTarget, setTalentCultivationTarget] = useState('');
  
  // 本月交通費用
  const [monthlyTransportExpense, setMonthlyTransportExpense] = useState<number>(0);
  const [transportExpenseNotes, setTransportExpenseNotes] = useState('');
  
  // 外務時數（長照外務/診所業務）
  const [extraTaskPlannedHours, setExtraTaskPlannedHours] = useState<number>(0);
  const [extraTaskExternalHours, setExtraTaskExternalHours] = useState<number>(0);

  // 計算出的區塊 (前端預覽)
  const [previewBlock, setPreviewBlock] = useState<number>(0);

  useEffect(() => {
    loadStaffStatus();
  }, [id]);

  // 當工作天數變更時，自動判斷是否為整月
  useEffect(() => {
    if (employmentType === 'full_time' && staffStatus?.total_days_in_month) {
      // 正職人員：根據工作天數自動判斷是否整月
      if (workDays === staffStatus.total_days_in_month) {
        // 滿天數 → 整月在職
        if (monthlyStatus !== 'full_month') {
          setMonthlyStatus('full_month');
        }
      } else if (workDays > 0 && workDays < staffStatus.total_days_in_month) {
        // 非滿天數 → 自動改為非整月（如果目前是整月的話）
        if (monthlyStatus === 'full_month') {
          setMonthlyStatus('new_hire'); // 預設為新進，用戶可自行修改
        }
      }
    }
  }, [workDays, employmentType, staffStatus?.total_days_in_month]);

  // 當表單值變更時，重新計算區塊
  useEffect(() => {
    calculateBlock();
  }, [position, monthlyStatus, isDualPosition, isSupervisorRotation, employmentType, staffStatus?.is_pharmacist, workDays]);

  // 自動計算「該店規劃實上時數」當選擇額外任務時
  useEffect(() => {
    if (extraTasks.includes('長照外務') || extraTasks.includes('診所業務')) {
      let calculatedHours = 0;
      
      // 1. 如果選擇督導(代理店長)職位，或是督導+代理店長且為雙職，使用本月上班時數
      if (position === '督導(代理店長)' || (position.includes('督導') && position.includes('代理店長') && isDualPosition)) {
        calculatedHours = workHours || 0;
      }
      // 2. 如果是正職整月任職則就算160小時
      else if (employmentType === 'full_time' && monthlyStatus === 'full_month') {
        calculatedHours = 160;
      }
      // 3. 如果有填入本月工作天數不滿(則代表有其他狀況)則要用天數計算上班時數→時數計算方式為:上班天數/5*32
      else if (employmentType === 'full_time' && monthlyStatus !== 'full_month' && workDays > 0) {
        calculatedHours = Math.round((workDays / 5 * 32) * 10) / 10; // 保留一位小數
      }
      
      setExtraTaskPlannedHours(calculatedHours);
    }
  }, [extraTasks, employmentType, monthlyStatus, workDays, workHours, position, isDualPosition]);

  const loadStaffStatus = async () => {
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      
      const { data, error } = await supabase
        .from('monthly_staff_status')
        .select(`
          *,
          store:stores(store_code, store_name)
        `)
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error loading staff status:', error);
        alert('載入失敗');
        router.back();
        return;
      }

      setStaffStatus(data);
      
      // 設置表單初始值 - 基本欄位
      setPosition(data.position || '');
      setEmploymentType(data.employment_type || 'full_time');
      setMonthlyStatus(data.monthly_status);
      setWorkDays(data.work_days || 0);
      setWorkHours(data.work_hours || 0);
      setIsDualPosition(data.is_dual_position || false);
      setHasManagerBonus(data.has_manager_bonus || false);
      setIsSupervisorRotation(data.is_supervisor_rotation || false);
      setIsPharmacist(data.is_pharmacist || false);
      setNotes(data.notes || '');
      setStartDate(data.start_date || ''); // 設置到職日期

      // 設置新增欄位
      setNewbieLevel(data.newbie_level || '');
      setPartialMonthReason(data.partial_month_reason || '');
      setPartialMonthDays(data.partial_month_days || 0);
      setPartialMonthNotes(data.partial_month_notes || '');
      setSupervisorShiftHours(data.supervisor_shift_hours || 0);
      setSupervisorEmployeeCode(data.supervisor_employee_code || '');
      setSupervisorName(data.supervisor_name || '');
      setSupervisorPosition(data.supervisor_position || '');
      setExtraTasks(data.extra_tasks || []);
      setLastMonthSingleItemBonus(data.last_month_single_item_bonus || 0);
      setTalentCultivationBonus(data.talent_cultivation_bonus || 0);
      setTalentCultivationTarget(data.talent_cultivation_target || '');
      setMonthlyTransportExpense(data.monthly_transport_expense || 0);
      setTransportExpenseNotes(data.transport_expense_notes || '');
      setExtraTaskPlannedHours(data.extra_task_planned_hours || 0);
      setExtraTaskExternalHours(data.extra_task_external_hours || 0);
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

    const empType = employmentType;
    const isPharmacist = staffStatus.is_pharmacist;

    // 區塊 2：督導卡班
    if (isSupervisorRotation) {
      setPreviewBlock(2);
      return;
    }

    // 區塊 5：兼職藥師 和 兼職專員
    if (empType === 'part_time' && (isPharmacist || position.includes('兼職專員'))) {
      setPreviewBlock(5);
      return;
    }

    // 區塊 6：兼職一般人（兼職助理等）
    if (empType === 'part_time') {
      setPreviewBlock(6);
      return;
    }

    // 區塊 4：特殊時數 (督導(代理店長)-雙 或 長照外務/診所業務)
    if ((position.includes('督導') && position.includes('代理店長') && isDualPosition) ||
        (extraTasks.length > 0 && (extraTasks.includes('長照外務') || extraTasks.includes('診所業務')))) {
      setPreviewBlock(4);
      return;
    }

    // 區塊 3：非整月正職 (包含工作天數為0的情況)
    if (empType === 'full_time' && (monthlyStatus !== 'full_month' || workDays === 0)) {
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

  const handleExtraTaskToggle = (task: ExtraTask) => {
    if (extraTasks.includes(task)) {
      setExtraTasks(extraTasks.filter(t => t !== task));
    } else {
      setExtraTasks([...extraTasks, task]);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 檢查新人階段
      if (startDate && (position === '新人' || monthlyStatus === 'new_hire')) {
        const hireDate = new Date(startDate);
        const currentYearMonth = yearMonth || '';
        const [currentYear, currentMonth] = currentYearMonth.split('-').map(Number);
        const currentDate = new Date(currentYear, currentMonth - 1, 1); // 當前月份的第一天
        
        // 計算到職後經過了幾個月
        const monthsDiff = (currentDate.getFullYear() - hireDate.getFullYear()) * 12 + 
                          (currentDate.getMonth() - hireDate.getMonth());

        let alertMessage = '';
        
        // 到職日的第二個月，應該要過一階段
        if (monthsDiff === 1 && newbieLevel !== '一階新人') {
          alertMessage = '此新人應該過一階段，是否要改成一階新人？';
        }
        // 到職日的第三個月，應該要過二階段
        else if (monthsDiff === 2 && newbieLevel !== '二階新人') {
          alertMessage = '此新人應該過二階段，是否要改成二階新人？';
        }
        // 到職日的第七個月，應該要過專員考試
        else if (monthsDiff === 6 && position === '新人') {
          alertMessage = '此新人應該要過專員考試，是否要改成專員？';
        }

        if (alertMessage) {
          const shouldUpdate = confirm(alertMessage);
          if (!shouldUpdate) {
            setSaving(false);
            return; // 使用者選擇不繼續，取消保存
          }
          // 使用者確認要更新，這裡可以自動更新狀態
          if (monthsDiff === 1) {
            setNewbieLevel('一階新人');
          } else if (monthsDiff === 2) {
            setNewbieLevel('二階新人');
          }
        }
      }

      const { updateStaffStatus } = await import('@/app/store/actions');
      
      // 判斷是否為督導(代理店長)-雙（需要填時數）
      const isSupervisorActingManagerDual = position.includes('督導') && position.includes('代理店長') && isDualPosition;
      
      const result = await updateStaffStatus(id, {
        position,
        employment_type: employmentType,
        monthly_status: monthlyStatus,
        work_days: (!isSupervisorActingManagerDual && employmentType === 'full_time') ? workDays : null,
        work_hours: (isSupervisorActingManagerDual || employmentType === 'part_time') ? workHours : null,
        is_dual_position: isDualPosition,
        has_manager_bonus: hasManagerBonus,
        is_supervisor_rotation: isSupervisorRotation,
        is_pharmacist: isPharmacist,
        notes,
        start_date: startDate || null, // 儲存到職日期
        // 新增欄位
        newbie_level: newbieLevel || null,
        partial_month_reason: partialMonthReason || null,
        partial_month_days: partialMonthDays || null,
        // 如果有外務時數，將其寫入 partial_month_notes，否則使用原本的備註
        partial_month_notes: (extraTasks.includes('長照外務') || extraTasks.includes('診所業務')) && extraTaskExternalHours > 0
          ? `外務時數: ${extraTaskExternalHours}小時${partialMonthNotes ? '; ' + partialMonthNotes : ''}`
          : partialMonthNotes || null,
        // 督導(代理店長)-雙 的工作時數同時儲存到 supervisor_shift_hours
        // 如果不是督導(代理店長)-雙，則清除此欄位（設為 null）
        supervisor_shift_hours: isSupervisorActingManagerDual ? workHours : null,
        supervisor_employee_code: supervisorEmployeeCode || null,
        supervisor_name: supervisorName || null,
        supervisor_position: supervisorPosition || null,
        extra_tasks: extraTasks.length > 0 ? extraTasks : null,
        extra_task_planned_hours: (extraTasks.includes('長照外務') || extraTasks.includes('診所業務')) ? (extraTaskPlannedHours || null) : null,
        extra_task_external_hours: (extraTasks.includes('長照外務') || extraTasks.includes('診所業務')) ? (extraTaskExternalHours || null) : null,
        last_month_single_item_bonus: lastMonthSingleItemBonus || null,
        talent_cultivation_bonus: talentCultivationBonus || null,
        talent_cultivation_target: talentCultivationTarget || null,
        monthly_transport_expense: monthlyTransportExpense || null,
        transport_expense_notes: transportExpenseNotes || null
      });

      if (result.success) {
        alert('✅ 儲存成功');
        // 跳轉回原本的年月和門市頁面
        if (yearMonth && storeId) {
          router.push(`/monthly-status?year_month=${yearMonth}&store_id=${storeId}`);
        } else {
          router.push('/monthly-status');
        }
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

  // 判斷是否需要顯示新人等級選項
  const showNewbieLevel = position === '新人' || monthlyStatus === 'new_hire';
  
  // 判斷是否需要顯示行政等級選項
  const showAdminLevel = position === '行政';

  // 判斷是否非整月（需要填寫詳細原因）
  const isPartialMonth = monthlyStatus !== 'full_month';

  // 判斷是否顯示督導卡班詳細資訊
  const showSupervisorDetails = isSupervisorRotation;

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
      <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
        <div className="w-full max-w-4xl">
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
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-4xl mx-auto">
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
            <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
              <User size={16} />
              員工基本資訊
              {staffStatus.is_manually_added && (
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">手動新增</span>
              )}
            </h3>
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
                <select
                  value={employmentType}
                  onChange={(e) => setEmploymentType(e.target.value as 'full_time' | 'part_time')}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium text-gray-900"
                >
                  <option value="full_time">正職</option>
                  <option value="part_time">兼職</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">是否藥師</label>
                <select
                  value={isPharmacist ? 'true' : 'false'}
                  onChange={(e) => setIsPharmacist(e.target.value === 'true')}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium text-gray-900"
                >
                  <option value="false">否</option>
                  <option value="true">是</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">到職日期</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* 職位選擇 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Briefcase size={16} className="inline mr-2" />
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

          {/* 新人等級 - 只在職位為新人或狀態為到職時顯示 */}
          {showNewbieLevel && (
            <div className="bg-blue-50 rounded-lg p-4">
              <label className="block text-sm font-medium text-blue-700 mb-2">
                新人等級
              </label>
              <div className="flex flex-wrap gap-3">
                {NEWBIE_LEVEL_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-colors ${
                      newbieLevel === opt.value 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-white text-gray-700 hover:bg-blue-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="newbieLevel"
                      value={opt.value}
                      checked={newbieLevel === opt.value}
                      onChange={(e) => setNewbieLevel(e.target.value as NewbieLevel)}
                      className="hidden"
                    />
                    {opt.label}
                  </label>
                ))}
                <label
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-colors ${
                    newbieLevel === '' 
                      ? 'bg-gray-600 text-white' 
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <input
                    type="radio"
                    name="newbieLevel"
                    value=""
                    checked={newbieLevel === ''}
                    onChange={() => setNewbieLevel('')}
                    className="hidden"
                  />
                  無（已過階）
                </label>
              </div>
            </div>
          )}

          {/* 行政等級 - 只在職位為行政時顯示 */}
          {showAdminLevel && (
            <div className="bg-green-50 rounded-lg p-4">
              <label className="block text-sm font-medium text-green-700 mb-2">
                行政階級
              </label>
              <div className="flex flex-wrap gap-3">
                {ADMIN_LEVEL_OPTIONS.map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-colors ${
                      newbieLevel === opt.value 
                        ? 'bg-green-600 text-white' 
                        : 'bg-white text-gray-700 hover:bg-green-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="adminLevel"
                      value={opt.value}
                      checked={newbieLevel === opt.value}
                      onChange={(e) => setNewbieLevel(e.target.value as NewbieLevel)}
                      className="hidden"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 本月狀態 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Clock size={16} className="inline mr-2" />
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

          {/* 非整月詳細資訊 */}
          {isPartialMonth && (
            <div className="bg-yellow-50 rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-semibold text-yellow-700 flex items-center gap-2">
                <AlertCircle size={16} />
                非整月在職詳細資訊
              </h3>
              
              <div>
                <label className="block text-sm font-medium text-yellow-700 mb-2">
                  非整月原因
                </label>
                <select
                  value={partialMonthReason}
                  onChange={(e) => setPartialMonthReason(e.target.value as PartialMonthReason)}
                  className="w-full px-4 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                >
                  <option value="">請選擇原因</option>
                  {PARTIAL_MONTH_REASON_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-yellow-700 mb-2">
                  實際工作天數
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max={staffStatus.total_days_in_month}
                    step="0.1"
                    value={partialMonthDays}
                    onChange={(e) => setPartialMonthDays(parseFloat(e.target.value) || 0)}
                    className="w-24 px-4 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                  />
                  <span className="text-yellow-700">/ {staffStatus.total_days_in_month} 天</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-yellow-700 mb-2">
                  說明
                </label>
                <textarea
                  value={partialMonthNotes}
                  onChange={(e) => setPartialMonthNotes(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent"
                  placeholder="如有特殊情況請說明，例如：5/15 到職"
                />
              </div>
            </div>
          )}

          {/* 天數/時數輸入 */}
          {/* 督導(代理店長)-雙 需要填寫時數 */}
          {(position.includes('督導') && position.includes('代理店長') && isDualPosition) ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                本月工作時數
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={workHours}
                  onChange={(e) => setWorkHours(parseFloat(e.target.value) || 0)}
                  className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-600">小時 (基準: 160 小時)</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                督導(代理店長)-雙 請填寫工作時數
              </p>
            </div>
          ) : employmentType === 'full_time' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                本月工作天數
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max={staffStatus.total_days_in_month}
                  step="0.1"
                  value={workDays}
                  onChange={(e) => setWorkDays(parseFloat(e.target.value) || 0)}
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
                  step="0.1"
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
              <Star size={16} className="inline mr-2" />
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

          {/* 督導卡班詳細資訊 */}
          {showSupervisorDetails && (
            <div className="bg-purple-50 rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-semibold text-purple-700 flex items-center gap-2">
                <Briefcase size={16} />
                督導卡班資訊
              </h3>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-purple-700 mb-2">
                    員編
                  </label>
                  <input
                    type="text"
                    value={supervisorEmployeeCode}
                    onChange={(e) => setSupervisorEmployeeCode(e.target.value)}
                    className="w-full px-4 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="員工編號"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-purple-700 mb-2">
                    姓名
                  </label>
                  <input
                    type="text"
                    value={supervisorName}
                    onChange={(e) => setSupervisorName(e.target.value)}
                    className="w-full px-4 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="督導姓名"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-purple-700 mb-2">
                    職位
                  </label>
                  <input
                    type="text"
                    value={supervisorPosition}
                    onChange={(e) => setSupervisorPosition(e.target.value)}
                    className="w-full px-4 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="督導職位"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-purple-700 mb-2">
                    時數
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={supervisorShiftHours}
                    onChange={(e) => setSupervisorShiftHours(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="卡班時數"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 額外任務 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              額外任務
            </label>
            <div className="flex flex-wrap gap-3">
              {EXTRA_TASK_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-colors ${
                    extraTasks.includes(opt.value)
                      ? 'bg-green-600 text-white' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={extraTasks.includes(opt.value)}
                    onChange={() => handleExtraTaskToggle(opt.value)}
                    className="hidden"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            
            {/* 當選擇長照外務或診所業務時顯示時數輸入框 */}
            {(extraTasks.includes('長照外務') || extraTasks.includes('診所業務')) && (
              <div className="mt-4 bg-green-50 rounded-lg p-4 border border-green-200">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-green-700 mb-1">
                      該店規劃實上時數（自動計算）
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={extraTaskPlannedHours}
                      readOnly
                      className="w-full px-4 py-2 border border-green-300 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed"
                      placeholder="自動計算"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-green-700 mb-1">
                      外務時數
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={extraTaskExternalHours}
                      onChange={(e) => setExtraTaskExternalHours(parseFloat(e.target.value) || 0)}
                      className="w-full px-4 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="外務時數"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 上個月個人單品獎金 */}
          <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
            <h3 className="text-base font-semibold text-purple-700 mb-4">上個月個人單品獎金</h3>
            <div>
              <label className="block text-sm font-medium text-purple-700 mb-2">
                獎金金額
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={lastMonthSingleItemBonus}
                  onChange={(e) => setLastMonthSingleItemBonus(parseInt(e.target.value) || 0)}
                  className="w-32 px-4 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="0"
                />
                <span className="text-purple-600">元</span>
              </div>
            </div>
          </div>

          {/* 本月育才獎金 */}
          <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
            <h3 className="text-base font-semibold text-indigo-700 mb-4">本月育才獎金</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-indigo-700 mb-2">
                  獎金金額
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={talentCultivationBonus}
                    onChange={(e) => setTalentCultivationBonus(parseInt(e.target.value) || 0)}
                    className="w-32 px-4 py-2 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="0"
                  />
                  <span className="text-indigo-600">元</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-indigo-700 mb-2">
                  育才對象
                </label>
                <input
                  type="text"
                  value={talentCultivationTarget}
                  onChange={(e) => setTalentCultivationTarget(e.target.value)}
                  className="w-full px-4 py-2 border border-indigo-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="請輸入育才對象姓名"
                />
              </div>
            </div>
          </div>

          {/* 本月交通費用 */}
          <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
            <h3 className="text-base font-semibold text-orange-700 mb-4">本月交通費用</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-orange-700 mb-2">
                  費用金額
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={monthlyTransportExpense}
                    onChange={(e) => setMonthlyTransportExpense(parseInt(e.target.value) || 0)}
                    className="w-32 px-4 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    placeholder="0"
                  />
                  <span className="text-orange-600">元</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-orange-700 mb-2">
                  備註
                </label>
                <textarea
                  value={transportExpenseNotes}
                  onChange={(e) => setTransportExpenseNotes(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="如有特殊交通費用說明請在此填寫..."
                />
              </div>
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
