'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, Plus, Upload, Download, Save, Trash2, AlertCircle, Calendar, ArrowRightLeft, CheckCircle, XCircle, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { POSITION_OPTIONS } from '@/types/workflow';

// 異動類型定義
const MOVEMENT_TYPES = [
  { value: 'onboarding', label: '入職' },
  { value: 'promotion', label: '升職' },
  { value: 'store_transfer', label: '調店' },
  { value: 'leave_without_pay', label: '留職停薪' },
  { value: 'return_to_work', label: '復職' },
  { value: 'pass_probation', label: '過試用期' },
  { value: 'resignation', label: '離職' }
] as const;

type MovementType = typeof MOVEMENT_TYPES[number]['value'];

interface MovementInput {
  employee_code: string;
  employee_name: string;
  store_id: string; // 任職門市
  movement_type: MovementType | '';
  position: string; // 僅升職時需要
  effective_date: string;
  notes: string;
  from_store_id: string; // 調店：原任職門市
  to_store_id: string;   // 調店：新任職門市
}

interface MovementHistory {
  id: string;
  employee_code: string;
  employee_name: string;
  store_id: string;
  movement_type: MovementType;
  movement_date: string;
  new_value: string | null;
  old_value: string | null;
  notes: string | null;
  created_at: string;
}

interface Store {
  id: string;
  name: string;
  store_code: string;
}

interface Employee {
  employee_code: string;
  employee_name: string;
  position: string;
  current_position: string | null;
  store_id: string;
}

interface StoreTransferRequest {
  id: string;
  employee_code: string;
  employee_name: string;
  from_store_id: string;
  to_store_id: string;
  status: 'pending' | 'confirmed' | 'rejected';
  notes: string | null;
  created_at: string;
  confirmed_at: string | null;
  effective_date: string | null;
  from_store: { store_name: string; store_code: string } | null;
  to_store: { store_name: string; store_code: string } | null;
  creator: { full_name: string } | null;
  confirmer: { full_name: string } | null;
}

export default function EmployeeMovementManagementPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'batch' | 'history' | 'transfer_requests'>('batch');
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canCreateTransfer, setCanCreateTransfer] = useState(false);
  const [transferRequestsError, setTransferRequestsError] = useState<string | null>(null);
  // 調店申請
  const [transferRequests, setTransferRequests] = useState<StoreTransferRequest[]>([]);
  const [transferRequestsLoading, setTransferRequestsLoading] = useState(false);
  const [showCreateTransferForm, setShowCreateTransferForm] = useState(false);
  const [newTransfer, setNewTransfer] = useState({ employee_code: '', employee_name: '', from_store_id: '', to_store_id: '', notes: '' });
  const [transferSearchTerm, setTransferSearchTerm] = useState('');
  const [showTransferDropdown, setShowTransferDropdown] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmEffectiveDate, setConfirmEffectiveDate] = useState<{[key: string]: string}>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [transferStatusFilter, setTransferStatusFilter] = useState<'all' | 'pending' | 'confirmed' | 'rejected'>('pending');
  const [movements, setMovements] = useState<MovementInput[]>([
    { employee_code: '', employee_name: '', store_id: '', movement_type: '', position: '', effective_date: '', notes: '', from_store_id: '', to_store_id: '' }
  ]);
  const [movementHistory, setMovementHistory] = useState<MovementHistory[]>([]);
  const [filteredHistory, setFilteredHistory] = useState<MovementHistory[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [searchTerm, setSearchTerm] = useState<{[key: number]: string}>({});
  const [showDropdown, setShowDropdown] = useState<{[key: number]: boolean}>({});
  const [historyYearMonth, setHistoryYearMonth] = useState<string>('');
  const [historyMovementType, setHistoryMovementType] = useState<string>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    checkPermissionAndLoadData();
  }, []);

  const checkPermissionAndLoadData = async () => {
    const supabase = (await import('@/lib/supabase/client')).createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const adminRole = profile?.role === 'admin';

    // 使用 RBAC 判斷調店相關權限
    const [canCreateRes, canConfirmRes] = await Promise.all([
      supabase.rpc('has_permission', { p_user_id: user.id, p_permission_code: 'employee.store_transfer.create' }),
      supabase.rpc('has_permission', { p_user_id: user.id, p_permission_code: 'employee.store_transfer.confirm' }),
    ]);
    const canCreate = adminRole || canCreateRes.data === true;
    const canConfirm = adminRole || canConfirmRes.data === true;
    const supervisorRole = canConfirm && !canCreate; // 只有確認權、無新增權 = 督導

    // 判斷是否有批次異動/歷史記錄的存取權（沿用原批次異動權限）
    const [batchRes] = await Promise.all([
      supabase.rpc('has_permission', { p_user_id: user.id, p_permission_code: 'employee.promotion.batch' }),
    ]);
    const canBatch = adminRole || batchRes.data === true;

    if (!adminRole && !canCreate && !canConfirm) {
      alert('權限不足');
      router.push('/dashboard');
      return;
    }

    setIsSupervisor(canConfirm && !canCreate);
    setIsAdmin(adminRole);
    setCanCreateTransfer(canCreate);

    // 督導只看調店登記確認 tab
    if (supervisorRole && !adminRole) {
      setActiveTab('transfer_requests');
    }

    // 支援 URL ?tab= 參數（優先級低於督導強制邏輯）
    if (!supervisorRole || adminRole) {
      const urlTab = new URLSearchParams(window.location.search).get('tab') as 'batch' | 'history' | 'transfer_requests' | null;
      if (urlTab === 'transfer_requests' && (adminRole || canConfirm)) {
        setActiveTab('transfer_requests');
      } else if (urlTab === 'batch' && (adminRole || canBatch)) {
        setActiveTab('batch');
      } else if (urlTab === 'history' && (adminRole || canBatch)) {
        setActiveTab('history');
      }
    }

    if (canBatch) {
      loadMovementHistory();
      loadEmployees();
    }
    loadStores();
    loadTransferRequests();
    
    // 設定當前月份為預設篩選
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setHistoryYearMonth(currentYearMonth);
    
    setLoading(false);
  };

  const loadTransferRequests = async () => {
    setTransferRequestsLoading(true);
    setTransferRequestsError(null);
    try {
      const res = await fetch('/api/store-transfer-requests');
      const result = await res.json();
      if (result.success) {
        setTransferRequests(result.data);
      } else {
        setTransferRequestsError(result.error || '載入失敗');
      }
    } catch (err: any) {
      setTransferRequestsError(err.message || '網路錯誤');
      console.error('Error loading transfer requests:', err);
    } finally {
      setTransferRequestsLoading(false);
    }
  };

  const handleCreateTransferRequest = async () => {
    if (!newTransfer.employee_code || !newTransfer.employee_name || !newTransfer.from_store_id || !newTransfer.to_store_id) {
      alert('請填寫所有必填欄位');
      return;
    }
    if (newTransfer.from_store_id === newTransfer.to_store_id) {
      alert('原任職門市與新任職門市不能相同');
      return;
    }
    try {
      const res = await fetch('/api/store-transfer-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTransfer),
      });
      const result = await res.json();
      if (result.success) {
        alert('✅ 調店申請已送出，等待督導確認');
        setShowCreateTransferForm(false);
        setNewTransfer({ employee_code: '', employee_name: '', from_store_id: '', to_store_id: '', notes: '' });
        setTransferSearchTerm('');
        loadTransferRequests();
      } else {
        alert(`❌ ${result.error}`);
      }
    } catch (err: any) {
      alert(`❌ 送出失敗：${err.message}`);
    }
  };

  const handleConfirmTransfer = async (id: string) => {
    const date = confirmEffectiveDate[id];
    if (!date) {
      alert('請填入生效日期');
      return;
    }
    setConfirmingId(id);
    try {
      const res = await fetch(`/api/store-transfer-requests/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effective_date: date }),
      });
      const result = await res.json();
      if (result.success) {
        alert(result.message);
        loadTransferRequests();
      } else {
        alert(`❌ ${result.error}`);
      }
    } catch (err: any) {
      alert(`❌ 確認失敗：${err.message}`);
    } finally {
      setConfirmingId(null);
    }
  };

  const handleRejectTransfer = async (id: string, employeeName: string) => {
    if (!confirm(`確定要拒絕 ${employeeName} 的調店申請嗎？`)) return;
    setRejectingId(id);
    try {
      const res = await fetch(`/api/store-transfer-requests/${id}/reject`, { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        alert('已拒絕此調店申請');
        loadTransferRequests();
      } else {
        alert(`❌ ${result.error}`);
      }
    } catch (err: any) {
      alert(`❌ 操作失敗：${err.message}`);
    } finally {
      setRejectingId(null);
    }
  };

  const getFilteredTransferRequests = () => {
    if (transferStatusFilter === 'all') return transferRequests;
    return transferRequests.filter(r => r.status === transferStatusFilter);
  };

  const loadStores = async () => {
    const supabase = (await import('@/lib/supabase/client')).createClient();
    
    const { data } = await supabase
      .from('stores')
      .select('id, store_name, store_code')
      .eq('is_active', true)
      .order('store_code');

    if (data) {
      // 將 store_name 對應到 name 欄位以符合介面定義
      setStores(data.map(store => ({ id: store.id, name: store.store_name, store_code: store.store_code || '' })));
    }
  };

  const loadEmployees = async () => {
    const supabase = (await import('@/lib/supabase/client')).createClient();
    
    // 載入所有員工（包含離職員工）
    const { data } = await supabase
      .from('store_employees')
      .select('employee_code, employee_name, position, current_position, store_id')
      .order('employee_code');

    if (data) {
      setEmployees(data);
    }
  };

  const loadMovementHistory = async () => {
    const supabase = (await import('@/lib/supabase/client')).createClient();
    
    const { data, error } = await supabase
      .from('employee_movement_history')
      .select(`
        *,
        stores:store_id (
          store_name
        )
      `)
      .not('store_id', 'is', null)
      .order('movement_date', { ascending: true })
      .limit(500);

    if (error) {
      console.error('Error loading movement history:', error);
      return;
    }

    if (data) {
      const formattedData = data.map(item => ({
        ...item,
        store_name: item.stores?.store_name || '-'
      }));
      setMovementHistory(formattedData as any);
      setFilteredHistory(formattedData as any);
    }
  };

  // 篩選歷史記錄
  useEffect(() => {
    let filtered = [...movementHistory];
    
    // 按月份篩選
    if (historyYearMonth) {
      filtered = filtered.filter(m => m.movement_date.startsWith(historyYearMonth));
    }
    
    // 按異動類型篩選
    if (historyMovementType !== 'all') {
      filtered = filtered.filter(m => m.movement_type === historyMovementType);
    }
    
    // 依生效日期排序（舊→新，由遠到近）
    filtered.sort((a, b) => a.movement_date.localeCompare(b.movement_date));
    
    setFilteredHistory(filtered);
  }, [historyYearMonth, historyMovementType, movementHistory]);

  const handleDeleteMovement = async (record: MovementHistory) => {
    const typeLabel = MOVEMENT_TYPES.find(t => t.value === record.movement_type)?.label || record.movement_type;
    const confirmMessage = `確定要刪除此異動記錄嗎？\n\n` +
      `員工：${record.employee_name} (${record.employee_code})\n` +
      `類型：${typeLabel}\n` +
      `日期：${record.movement_date}\n\n` +
      `⚠️ 此操作無法復原！\n` +
      `⚠️ 刪除後不會自動回復員工狀態，請手動調整。`;

    if (!confirm(confirmMessage)) {
      return;
    }

    setDeletingId(record.id);
    try {
      const response = await fetch(`/api/employee-movements/${record.id}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (result.success) {
        alert(`✅ ${result.message}`);
        // 從列表中移除已刪除的記錄
        setMovementHistory(movementHistory.filter(m => m.id !== record.id));
        setFilteredHistory(filteredHistory.filter(m => m.id !== record.id));
      } else {
        alert(`❌ 刪除失敗: ${result.error}`);
      }
    } catch (error: any) {
      console.error('Error deleting movement:', error);
      alert(`❌ 刪除失敗: ${error.message || '未知錯誤'}`);
    } finally {
      setDeletingId(null);
    }
  };

  const addRow = () => {
    setMovements([...movements, { employee_code: '', employee_name: '', store_id: '', movement_type: '', position: '', effective_date: '', notes: '', from_store_id: '', to_store_id: '' }]);
  };

  const removeRow = (index: number) => {
    if (movements.length === 1) {
      alert('至少需要保留一列');
      return;
    }
    setMovements(movements.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: keyof MovementInput, value: string) => {
    const updated = [...movements];
    updated[index] = { ...updated[index], [field]: value };
    
    // 員編自動轉大寫
    if (field === 'employee_code') {
      updated[index].employee_code = value.toUpperCase();
      setSearchTerm({ ...searchTerm, [index]: value.toUpperCase() });
      setShowDropdown({ ...showDropdown, [index]: true });
    }

    // 選擇調店類型時，自動將當前任職門市帶入原任職門市，並清空任職門市
    if (field === 'movement_type' && value === 'store_transfer') {
      if (updated[index].store_id) {
        updated[index].from_store_id = updated[index].store_id;
      }
      updated[index].store_id = ''; // 調店不需要填任職門市
    }
    // 切換離開調店類型時，清空調店欄位
    if (field === 'movement_type' && value !== 'store_transfer') {
      updated[index].from_store_id = '';
      updated[index].to_store_id = '';
    }
    // 調店選擇新任職門市時，自動帶入 store_id
    if (field === 'to_store_id' && updated[index].movement_type === 'store_transfer') {
      updated[index].store_id = value;
    }
    
    setMovements(updated);
  };

  const selectEmployee = (index: number, employee: Employee) => {
    const updated = [...movements];
    updated[index].employee_code = employee.employee_code;
    updated[index].employee_name = employee.employee_name;
    updated[index].store_id = employee.store_id; // 自動帶入員工所屬門市
    // 調店時自動帶入原任職門市
    if (updated[index].movement_type === 'store_transfer') {
      updated[index].from_store_id = employee.store_id;
    }
    setMovements(updated);
    setShowDropdown({ ...showDropdown, [index]: false });
    setSearchTerm({ ...searchTerm, [index]: '' });
  };

  const getFilteredEmployees = (index: number) => {
    const term = searchTerm[index] || movements[index].employee_code;
    if (!term) return [];
    
    return employees.filter(emp => 
      emp.employee_code.toUpperCase().includes(term.toUpperCase()) ||
      emp.employee_name.includes(term)
    ).slice(0, 10);
  };

  const handleSave = async () => {
    // 驗證資料
    const emptyFields = movements.filter(m => {
      if (!m.employee_code.trim() || !m.employee_name.trim() || !m.movement_type || !m.effective_date) {
        return true;
      }
      // 調店不需要填任職門市（由原/新任職門市帶入），其他類型必填
      if (m.movement_type !== 'store_transfer' && !m.store_id) {
        return true;
      }
      // 如果是升職，必須填寫職位
      if (m.movement_type === 'promotion' && !m.position) {
        return true;
      }
      // 如果是調店，必須填寫原任職門市和新任職門市
      if (m.movement_type === 'store_transfer' && (!m.from_store_id || !m.to_store_id)) {
        return true;
      }
      return false;
    });

    if (emptyFields.length > 0) {
      alert('請填寫所有必填欄位（員編、姓名、任職門市、異動類型、生效日期，升職需填職位，調店需填原任職/新任職門市）');
      return;
    }

    if (!confirm(`確定要建立 ${movements.length} 筆異動記錄嗎？\n\n異動將自動更新員工狀態。`)) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/employee-movements/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movements })
      });

      const result = await response.json();

      if (result.success) {
        alert(`✅ 成功建立 ${result.created} 筆異動記錄！`);
        // 重置表單
        setMovements([{ employee_code: '', employee_name: '', store_id: '', movement_type: '', position: '', effective_date: '', notes: '', from_store_id: '', to_store_id: '' }]);
        // 重新載入歷史記錄
        loadMovementHistory();
      } else {
        alert(`❌ 錯誤：${result.error}`);
      }
    } catch (error: any) {
      console.error('Error saving movements:', error);
      alert(`❌ 儲存失敗：${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json<any>(sheet);

        const imported = jsonData.map((row: any) => ({
          employee_code: (row['員編'] || row['employee_code'] || '').toString().toUpperCase(),
          employee_name: (row['姓名'] || row['employee_name'] || '').toString(),
          store_id: (row['任職門市ID'] || row['store_id'] || '').toString(),
          movement_type: (row['異動類型'] || row['movement_type'] || '') as MovementType | '',
          position: (row['職位'] || row['position'] || '').toString(),
          effective_date: row['生效日期'] || row['effective_date'] || '',
          notes: (row['備註'] || row['notes'] || '').toString(),
          from_store_id: (row['原任職門市ID'] || row['from_store_id'] || '').toString(),
          to_store_id: (row['新任職門市ID'] || row['to_store_id'] || '').toString()
        }));

        setMovements(imported);
        alert(`✅ 成功匯入 ${imported.length} 筆資料`);
      } catch (error) {
        console.error('Error importing Excel:', error);
        alert('❌ 匯入失敗，請確認檔案格式正確');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleExcelExport = () => {
    const exportData = movements.map(m => {
      const movementTypeLabel = MOVEMENT_TYPES.find(t => t.value === m.movement_type)?.label || m.movement_type;
      const storeName = stores.find(s => s.id === m.store_id)?.name || '';
      const fromStoreName = stores.find(s => s.id === m.from_store_id)?.name || '';
      const toStoreName = stores.find(s => s.id === m.to_store_id)?.name || '';
      return {
        '員編': m.employee_code,
        '姓名': m.employee_name,
        '異動類型': movementTypeLabel,
        '任職門市': storeName,
        '職位': m.position,
        '原任職門市': m.movement_type === 'store_transfer' ? fromStoreName : '',
        '新任職門市': m.movement_type === 'store_transfer' ? toStoreName : '',
        '生效日期': m.effective_date,
        '備註': m.notes
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '人員異動資料');
    XLSX.writeFile(wb, `人員異動管理_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
              <TrendingUp className="text-emerald-600" size={40} />
              人員異動管理
            </h1>
            <p className="text-gray-600">批次管理員工異動，自動更新員工狀態</p>
          </div>
        </div>

        {/* TAB 切換 */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="border-b border-gray-200">
            <div className="flex">
              {(isAdmin || canCreateTransfer) && (
                <button
                  onClick={() => setActiveTab('batch')}
                  className={`px-6 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'batch'
                      ? 'border-b-2 border-emerald-600 text-emerald-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  批次輸入異動
                </button>
              )}
              {(isAdmin || canCreateTransfer) && (
                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-6 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'history'
                      ? 'border-b-2 border-emerald-600 text-emerald-600'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  查看歷史記錄
                </button>
              )}
              <button
                onClick={() => setActiveTab('transfer_requests')}
                className={`px-6 py-3 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  activeTab === 'transfer_requests'
                    ? 'border-b-2 border-cyan-600 text-cyan-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <ArrowRightLeft size={15} />
                調店登記確認
                {transferRequests.filter(r => r.status === 'pending').length > 0 && (
                  <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                    {transferRequests.filter(r => r.status === 'pending').length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 批次輸入 TAB */}
        {activeTab === 'batch' && (
          <div>
        {/* 批次輸入區 */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-900">批次輸入異動</h2>
            <div className="flex items-center gap-2">
              <label className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors cursor-pointer text-sm font-medium">
                <Upload size={16} className="inline mr-1" />
                匯入 Excel
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleExcelImport}
                  className="hidden"
                />
              </label>
              <button
                onClick={handleExcelExport}
                className="px-3 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-sm font-medium"
              >
                <Download size={16} className="inline mr-1" />
                匯出 Excel
              </button>
              <button
                onClick={addRow}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                <Plus size={16} className="inline mr-1" />
                新增列
              </button>
            </div>
          </div>

          <div className="overflow-visible">
            <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-40">
                    員編 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-28">
                    姓名 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-36">
                    異動類型 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-44">
                    任職門市 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-36">
                    職位 / 調店資訊
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700 w-36">
                    生效日期 <span className="text-red-500">*</span>
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-left text-sm font-semibold text-gray-700">
                    備註
                  </th>
                  <th className="border border-gray-300 px-3 py-2 text-center text-sm font-semibold text-gray-700 w-20">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-2 py-1 relative overflow-visible">
                      <div className="relative">
                      <input
                        type="text"
                        value={movement.employee_code}
                        onChange={(e) => updateRow(index, 'employee_code', e.target.value)}
                        onFocus={(e) => {
                          setShowDropdown({ ...showDropdown, [index]: true });
                          const rect = e.target.getBoundingClientRect();
                          (e.target as any).dropdownTop = rect.bottom + window.scrollY;
                          (e.target as any).dropdownLeft = rect.left + window.scrollX;
                        }}
                        onBlur={() => setTimeout(() => setShowDropdown({ ...showDropdown, [index]: false }), 200)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        placeholder="FK1234"
                        id={`employee-code-${index}`}
                      />
                      {showDropdown[index] && getFilteredEmployees(index).length > 0 && (() => {
                        const input = document.getElementById(`employee-code-${index}`);
                        const rect = input?.getBoundingClientRect();
                        return (
                        <div 
                          className="fixed z-[9999] min-w-[400px] bg-white border-2 border-blue-500 rounded-lg shadow-2xl max-h-72 overflow-y-auto"
                          style={{
                            top: rect ? `${rect.bottom + 4}px` : 'auto',
                            left: rect ? `${rect.left}px` : 'auto',
                          }}
                        >
                          {getFilteredEmployees(index).map((emp) => (
                            <div
                              key={emp.employee_code}
                              onMouseDown={() => selectEmployee(index, emp)}
                              className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-0 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-4">
                                <span className="font-bold text-base text-blue-600">{emp.employee_code}</span>
                                <span className="text-base text-gray-900 font-semibold">{emp.employee_name}</span>
                              </div>
                              <div className="text-sm text-gray-500 mt-1.5 flex items-center">
                                <span className="bg-gray-100 px-2 py-1 rounded text-xs font-medium">
                                  {emp.current_position || emp.position}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        );
                      })()}
                      </div>
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="text"
                        value={movement.employee_name}
                        onChange={(e) => updateRow(index, 'employee_name', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        placeholder="王小明"
                      />
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <select
                        value={movement.movement_type}
                        onChange={(e) => updateRow(index, 'movement_type', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                      >
                        <option value="">請選擇</option>
                        {MOVEMENT_TYPES.map(type => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      {movement.movement_type === 'store_transfer' ? (
                        <div className="text-gray-400 text-sm px-2 py-1 italic">由調店資訊帶入</div>
                      ) : (
                        <select
                          value={movement.store_id}
                          onChange={(e) => updateRow(index, 'store_id', e.target.value)}
                          className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        >
                          <option value="">請選擇門市</option>
                          {stores.map(store => (
                            <option key={store.id} value={store.id}>{store.store_code} {store.name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      {movement.movement_type === 'promotion' ? (
                        <select
                          value={movement.position}
                          onChange={(e) => updateRow(index, 'position', e.target.value)}
                          className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        >
                          <option value="">請選擇職位</option>
                          {POSITION_OPTIONS.map(pos => (
                            <option key={pos} value={pos}>{pos}</option>
                          ))}
                        </select>
                      ) : movement.movement_type === 'store_transfer' ? (
                        <div className="space-y-1">
                          <div>
                            <label className="text-xs text-gray-500">原任職門市 *</label>
                            <select
                              value={movement.from_store_id}
                              onChange={(e) => updateRow(index, 'from_store_id', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 rounded bg-orange-50"
                            >
                              <option value="">請選擇</option>
                              {stores.map(store => (
                                <option key={store.id} value={store.id}>{store.store_code} {store.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">新任職門市 *</label>
                            <select
                              value={movement.to_store_id}
                              onChange={(e) => updateRow(index, 'to_store_id', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 rounded bg-green-50"
                            >
                              <option value="">請選擇</option>
                              {stores.map(store => (
                                <option key={store.id} value={store.id}>{store.store_code} {store.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-400 text-sm px-2 py-1">-</div>
                      )}
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="date"
                        value={movement.effective_date}
                        onChange={(e) => updateRow(index, 'effective_date', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                      />
                    </td>
                    <td className="border border-gray-300 px-2 py-1">
                      <input
                        type="text"
                        value={movement.notes}
                        onChange={(e) => updateRow(index, 'notes', e.target.value)}
                        className="w-full px-2 py-1 text-sm border-0 focus:ring-2 focus:ring-blue-500 rounded"
                        placeholder="選填"
                      />
                    </td>
                    <td className="border border-gray-300 px-2 py-1 text-center">
                      <button
                        onClick={() => removeRow(index)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="刪除此列"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <AlertCircle size={16} />
              <span>共 {movements.length} 筆異動資料</span>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  儲存中...
                </>
              ) : (
                <>
                  <Save size={18} />
                  儲存異動記錄
                </>
              )}
            </button>
          </div>
        </div>

        {/* 說明 */}
        <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-emerald-900 mb-2">💡 使用說明</h3>
          <ul className="text-sm text-emerald-800 space-y-1">
            <li>• <strong>所有異動都需填寫任職門市</strong>，記錄員工在哪個門市發生異動</li>
            <li>• <strong>升職：</strong>需填寫新職位，系統會自動更新該員工從生效日期起的所有月份職位</li>
            <li>• <strong>調店：</strong>需選擇原任職門市和新任職門市，生效日期為新門市調入的第一天。系統會自動將員工從原門市移至新門市</li>
            <li>• <strong>留職停薪：</strong>將員工狀態設為留職停薪，不影響職位資料</li>
            <li>• <strong>復職：</strong>將留職停薪的員工狀態恢復為在職</li>
            <li>• <strong>過試用期：</strong>記錄員工通過試用期的日期</li>
            <li>• <strong>離職：</strong>將員工狀態設為已離職，並設定為不在職</li>
            <li>• 支援 Excel 匯入/匯出，方便批次處理</li>
            <li>• 員編會自動轉換為大寫</li>
          </ul>
        </div>
          </div>
        )}

        {/* 查看歷史 TAB */}
        {activeTab === 'history' && (
          <div>
            {/* 篩選條件 */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">篩選條件</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    年月
                  </label>
                  <input
                    type="month"
                    value={historyYearMonth}
                    onChange={(e) => setHistoryYearMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    異動類型
                  </label>
                  <select
                    value={historyMovementType}
                    onChange={(e) => setHistoryMovementType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  >
                    <option value="all">全部</option>
                    {MOVEMENT_TYPES.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      setHistoryYearMonth('');
                      setHistoryMovementType('all');
                    }}
                    className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    清除篩選
                  </button>
                </div>
              </div>
            </div>

            {/* 歷史記錄表格 */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  異動記錄
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    (共 {filteredHistory.length} 筆)
                  </span>
                </h2>
                <button
                  onClick={() => {
                    const exportData = filteredHistory.map(m => {
                      const movementTypeLabel = MOVEMENT_TYPES.find(t => t.value === m.movement_type)?.label || m.movement_type;
                      return {
                        '員編': m.employee_code,
                        '姓名': m.employee_name,
                        '任職門市': (m as any).store_name || '-',
                        '異動類型': movementTypeLabel,
                        '舊值': m.old_value || '-',
                        '新值': m.new_value || '-',
                        '生效日期': m.movement_date,
                        '備註': m.notes || '-'
                      };
                    });
                    const ws = XLSX.utils.json_to_sheet(exportData);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, '異動記錄');
                    XLSX.writeFile(wb, `人員異動記錄_${historyYearMonth || '全部'}_${new Date().toISOString().split('T')[0]}.xlsx`);
                  }}
                  className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-sm font-medium"
                >
                  <Download size={16} className="inline mr-1" />
                  匯出 Excel
                </button>
              </div>

              {filteredHistory.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">查無異動記錄</p>
                  <p className="text-sm text-gray-400 mt-2">請調整篩選條件</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">員編</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">姓名</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">任職門市</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">異動類型</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">舊值</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">新值</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">生效日期</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">備註</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 w-20">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredHistory.map((record) => {
                        const typeLabel = MOVEMENT_TYPES.find(t => t.value === record.movement_type)?.label || record.movement_type;
                        return (
                          <tr key={record.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{record.employee_code}</td>
                            <td className="px-4 py-3 text-sm text-gray-900">{record.employee_name}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{(record as any).store_name || '-'}</td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                record.movement_type === 'promotion' ? 'bg-emerald-100 text-emerald-700' :
                                record.movement_type === 'store_transfer' ? 'bg-cyan-100 text-cyan-700' :
                                record.movement_type === 'leave_without_pay' ? 'bg-amber-100 text-amber-700' :
                                record.movement_type === 'return_to_work' ? 'bg-blue-100 text-blue-700' :
                                record.movement_type === 'pass_probation' ? 'bg-purple-100 text-purple-700' :
                                record.movement_type === 'resignation' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {typeLabel}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{record.old_value || '-'}</td>
                            <td className="px-4 py-3 text-sm text-emerald-600 font-medium">{record.new_value || '-'}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{record.movement_date}</td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => handleDeleteMovement(record)}
                                disabled={deletingId === record.id}
                                className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="刪除此異動記錄"
                              >
                                {deletingId === record.id ? (
                                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-red-600 border-t-transparent" />
                                ) : (
                                  <Trash2 size={16} />
                                )}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">{record.notes || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 調店登記確認 TAB */}
        {activeTab === 'transfer_requests' && (
          <div className="space-y-6">
            {/* 行政主管：新增申請按鈕 */}
            {canCreateTransfer && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                      <ArrowRightLeft className="text-cyan-600" size={22} />
                      調店登記
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">登記員工調店申請，由督導確認生效日期後正式記錄</p>
                  </div>
                  <button
                    onClick={() => setShowCreateTransferForm(!showCreateTransferForm)}
                    className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors text-sm font-medium"
                  >
                    <Plus size={16} />
                    新增調店申請
                  </button>
                </div>

                {showCreateTransferForm && (
                  <div className="border border-cyan-200 rounded-lg p-5 bg-cyan-50 space-y-4">
                    <h3 className="font-medium text-cyan-800">填寫調店資訊</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* 員工搜尋 */}
                      <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-1">員編 *</label>
                        <input
                          type="text"
                          value={transferSearchTerm || newTransfer.employee_code}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase();
                            setTransferSearchTerm(val);
                            setNewTransfer(prev => ({ ...prev, employee_code: val, employee_name: '' }));
                            setShowTransferDropdown(true);
                          }}
                          placeholder="輸入員編或姓名搜尋"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500"
                        />
                        {showTransferDropdown && transferSearchTerm && (
                          <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto mt-1">
                            {employees
                              .filter(emp =>
                                emp.employee_code.includes(transferSearchTerm) ||
                                emp.employee_name.includes(transferSearchTerm)
                              )
                              .slice(0, 10)
                              .map(emp => (
                                <div
                                  key={emp.employee_code}
                                  onClick={() => {
                                    setNewTransfer(prev => ({
                                      ...prev,
                                      employee_code: emp.employee_code,
                                      employee_name: emp.employee_name,
                                      from_store_id: emp.store_id || prev.from_store_id,
                                    }));
                                    setTransferSearchTerm('');
                                    setShowTransferDropdown(false);
                                  }}
                                  className="px-3 py-2 hover:bg-cyan-50 cursor-pointer text-sm"
                                >
                                  <span className="font-medium text-cyan-700">{emp.employee_code}</span>
                                  <span className="ml-2 text-gray-700">{emp.employee_name}</span>
                                  <span className="ml-2 text-gray-400 text-xs">
                                    {stores.find(s => s.id === emp.store_id)?.name || ''}
                                  </span>
                                </div>
                              ))
                            }
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
                        <input
                          type="text"
                          value={newTransfer.employee_name}
                          onChange={(e) => setNewTransfer(prev => ({ ...prev, employee_name: e.target.value }))}
                          placeholder="員工姓名"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">原任職門市 *</label>
                        <select
                          value={newTransfer.from_store_id}
                          onChange={(e) => setNewTransfer(prev => ({ ...prev, from_store_id: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500"
                        >
                          <option value="">請選擇門市</option>
                          {stores.map(s => (
                            <option key={s.id} value={s.id}>{s.store_code} {s.name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">新任職門市 *</label>
                        <select
                          value={newTransfer.to_store_id}
                          onChange={(e) => setNewTransfer(prev => ({ ...prev, to_store_id: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500"
                        >
                          <option value="">請選擇門市</option>
                          {stores.map(s => (
                            <option key={s.id} value={s.id}>{s.store_code} {s.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
                        <input
                          type="text"
                          value={newTransfer.notes}
                          onChange={(e) => setNewTransfer(prev => ({ ...prev, notes: e.target.value }))}
                          placeholder="選填"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 justify-end pt-2">
                      <button
                        onClick={() => {
                          setShowCreateTransferForm(false);
                          setNewTransfer({ employee_code: '', employee_name: '', from_store_id: '', to_store_id: '', notes: '' });
                          setTransferSearchTerm('');
                        }}
                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleCreateTransferRequest}
                        className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 text-sm font-medium"
                      >
                        送出申請
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 申請列表 */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-semibold text-gray-900">
                  {isSupervisor && !isAdmin ? '待確認的調店申請' : '調店申請記錄'}
                </h2>
                <div className="flex gap-2">
                  {(['pending', 'confirmed', 'rejected', 'all'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setTransferStatusFilter(s)}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                        transferStatusFilter === s
                          ? s === 'pending' ? 'bg-amber-500 text-white'
                          : s === 'confirmed' ? 'bg-emerald-500 text-white'
                          : s === 'rejected' ? 'bg-red-500 text-white'
                          : 'bg-gray-700 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {s === 'pending' ? '待確認' : s === 'confirmed' ? '已確認' : s === 'rejected' ? '已拒絕' : '全部'}
                      {s === 'pending' && transferRequests.filter(r => r.status === 'pending').length > 0 && (
                        <span className="ml-1">({transferRequests.filter(r => r.status === 'pending').length})</span>
                      )}
                    </button>
                  ))}
                  <button
                    onClick={loadTransferRequests}
                    className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                  >
                    重新整理
                  </button>
                </div>
              </div>

              {transferRequestsLoading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm">載入中...</p>
                </div>
              ) : transferRequestsError ? (
                <div className="text-center py-12">
                  <AlertCircle className="w-10 h-10 mx-auto text-red-400 mb-3" />
                  <p className="text-red-500 text-sm font-medium">載入失敗：{transferRequestsError}</p>
                  <p className="text-gray-400 text-xs mt-1">請至 Supabase Dashboard → Settings → API → Reload schema cache 後重試</p>
                  <button onClick={loadTransferRequests} className="mt-3 px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200">重新整理</button>
                </div>
              ) : getFilteredTransferRequests().length === 0 ? (
                <div className="text-center py-12">
                  <ArrowRightLeft className="w-14 h-14 mx-auto text-gray-300 mb-3" />
                  <p className="text-gray-500">目前無{transferStatusFilter === 'pending' ? '待確認' : ''}調店申請</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {getFilteredTransferRequests().map((req) => (
                    <div
                      key={req.id}
                      className={`border rounded-lg p-4 ${
                        req.status === 'pending' ? 'border-amber-200 bg-amber-50' :
                        req.status === 'confirmed' ? 'border-emerald-200 bg-emerald-50' :
                        'border-red-200 bg-red-50'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center gap-3">
                        {/* 員工資訊 */}
                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <p className="text-xs text-gray-500 mb-0.5">員工</p>
                            <p className="font-semibold text-gray-900">{req.employee_name}</p>
                            <p className="text-xs text-cyan-600">{req.employee_code}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-0.5">原任職門市</p>
                            <p className="text-sm font-medium text-orange-700">
                              {req.from_store?.store_code} {req.from_store?.store_name}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-0.5">新任職門市</p>
                            <p className="text-sm font-medium text-emerald-700">
                              {req.to_store?.store_code} {req.to_store?.store_name}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-0.5">登記者</p>
                            <p className="text-sm text-gray-700">{req.creator?.full_name || '-'}</p>
                            <p className="text-xs text-gray-400">{req.created_at.slice(0, 10)}</p>
                          </div>
                        </div>

                        {/* 狀態 & 操作 */}
                        <div className="flex flex-col items-end gap-2 min-w-[180px]">
                          {req.status === 'pending' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                              <Clock size={12} /> 待確認
                            </span>
                          )}
                          {req.status === 'confirmed' && (
                            <div className="text-right">
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-medium">
                                <CheckCircle size={12} /> 已確認
                              </span>
                              <p className="text-xs text-gray-500 mt-1">生效日期：{req.effective_date}</p>
                              <p className="text-xs text-gray-400">確認者：{req.confirmer?.full_name}</p>
                            </div>
                          )}
                          {req.status === 'rejected' && (
                            <div className="text-right">
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">
                                <XCircle size={12} /> 已拒絕
                              </span>
                              <p className="text-xs text-gray-400 mt-1">拒絕者：{req.confirmer?.full_name}</p>
                            </div>
                          )}

                          {/* 督導確認操作 */}
                          {req.status === 'pending' && (isSupervisor || isAdmin) && (
                            <div className="flex flex-col gap-2 w-full">
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-gray-600 whitespace-nowrap">生效日期 *</label>
                                <input
                                  type="date"
                                  value={confirmEffectiveDate[req.id] || ''}
                                  onChange={(e) => setConfirmEffectiveDate(prev => ({ ...prev, [req.id]: e.target.value }))}
                                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-emerald-500"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleConfirmTransfer(req.id)}
                                  disabled={confirmingId === req.id || !confirmEffectiveDate[req.id]}
                                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {confirmingId === req.id ? (
                                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                                  ) : (
                                    <CheckCircle size={13} />
                                  )}
                                  確認調店
                                </button>
                                <button
                                  onClick={() => handleRejectTransfer(req.id, req.employee_name)}
                                  disabled={rejectingId === req.id}
                                  className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-xs hover:bg-red-50 disabled:opacity-50"
                                >
                                  {rejectingId === req.id ? (
                                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-red-600 border-t-transparent" />
                                  ) : (
                                    <XCircle size={13} />
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      {req.notes && (
                        <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200">備註：{req.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
