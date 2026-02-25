'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import SignaturePad from '@/components/SignaturePad';
import PrintInspectionReport from '@/components/PrintInspectionReport';
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
  Camera,
  X,
  PenTool,
  MapPin,
  Loader2,
  Users,
  UserPlus,
  Trash2,
  Plus,
  Shield,
  Thermometer,
  FileText,
  Eye,
} from 'lucide-react';

interface StoreType {
  id: string;
  store_name: string;
  store_code: string;
  address?: string;
}

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
  item_description: string;
  item_order: number;
  max_score: number;
  scoring_type: string;
  checklist_items: ChecklistItem[];
}

interface ItemScore {
  template_id: string;
  checked_items: string[];
  quantities: Record<string, number>;
  deduction: number;
  earned_score: number;
  improvement_notes: string;
  photos: string[];
}

interface OnDutyStaff {
  employee_code: string;
  employee_name: string;
  position: string;
  is_duty_supervisor: boolean;
  is_manually_added: boolean;
}

export default function EditInspectionPage() {
  const router = useRouter();
  const params = useParams();
  const inspectionId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stores, setStores] = useState<StoreType[]>([]);
  const [templates, setTemplates] = useState<InspectionTemplate[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [inspectionDate, setInspectionDate] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [itemScores, setItemScores] = useState<Map<string, ItemScore>>(new Map());
  const [signaturePhoto, setSignaturePhoto] = useState<string>('');
  const [supervisorSignature, setSupervisorSignature] = useState<string>('');
  const [originalStatus, setOriginalStatus] = useState<string>('');
  const [originalInspectionType, setOriginalInspectionType] = useState<string>('supervisor');

  // GPS 定位狀態
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [gpsLocation, setGpsLocation] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [gpsError, setGpsError] = useState<string>('');
  const [supervisorNotes, setSupervisorNotes] = useState('');
  const [indoorTemperature, setIndoorTemperature] = useState('');

  // 當班人員狀態
  const [onDutyStaff, setOnDutyStaff] = useState<OnDutyStaff[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [showAddStaffForm, setShowAddStaffForm] = useState(false);
  const [newStaffCode, setNewStaffCode] = useState('');
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPosition, setNewStaffPosition] = useState('');

  // 報表預覽
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [currentUserName, setCurrentUserName] = useState('');

  // 權限錯誤
  const [permissionError, setPermissionError] = useState('');

  useEffect(() => {
    loadExistingData();
  }, []);

  // 載入現有巡店資料
  const loadExistingData = async () => {
    try {
      const supabase = createClient();

      // 驗證登入
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      // 1. 載入門市列表
      const { data: storesData, error: storesError } = await supabase
        .from('stores')
        .select('id, store_name, store_code, address')
        .order('store_code');

      if (storesError) throw storesError;
      setStores(storesData || []);

      // 2. 載入檢查項目模板
      const { data: templatesData, error: templatesError } = await supabase
        .from('inspection_templates')
        .select('*')
        .eq('is_active', true)
        .order('section_order, item_order');

      if (templatesError) throw templatesError;
      setTemplates(templatesData || []);

      // 3. 載入現有巡店主記錄
      const { data: inspection, error: inspectionError } = await supabase
        .from('inspection_masters')
        .select(`
          id, store_id, inspector_id, inspection_date, status,
          total_score, max_possible_score, grade,
          supervisor_notes, indoor_temperature,
          signature_photo_url, supervisor_signature_url, gps_latitude, gps_longitude,
          inspection_type
        `)
        .eq('id', inspectionId)
        .single();

      if (inspectionError || !inspection) {
        setPermissionError('找不到此巡店記錄');
        setLoading(false);
        return;
      }

      // 4. 權限檢查：只有建立者且狀態為 draft/in_progress 才能編輯
      if (inspection.inspector_id !== user.id) {
        setPermissionError('您不是此巡店記錄的建立者，無法編輯');
        setLoading(false);
        return;
      }
      if (inspection.status !== 'draft' && inspection.status !== 'in_progress') {
        setPermissionError('此巡店記錄狀態為「' + (inspection.status === 'completed' ? '已完成' : inspection.status === 'closed' ? '已結案' : inspection.status) + '」，無法編輯');
        setLoading(false);
        return;
      }

      setOriginalStatus(inspection.status);
      setOriginalInspectionType((inspection as any).inspection_type || 'supervisor');

      // 5. 預填基本資訊
      setSelectedStoreId(inspection.store_id);
      setInspectionDate(inspection.inspection_date);
      setSupervisorNotes(inspection.supervisor_notes || '');
      setIndoorTemperature(inspection.indoor_temperature != null ? String(inspection.indoor_temperature) : '');
      setSignaturePhoto(inspection.signature_photo_url || '');
      setSupervisorSignature((inspection as any).supervisor_signature_url || '');

      if (inspection.gps_latitude && inspection.gps_longitude) {
        setGpsLocation({
          latitude: Number(inspection.gps_latitude),
          longitude: Number(inspection.gps_longitude),
        });
        setGpsStatus('success');
      }

      // 6. 載入檢查結果明細
      const { data: results, error: resultsError } = await supabase
        .from('inspection_results')
        .select('id, template_id, max_score, given_score, deduction_amount, is_improvement, notes, photo_urls, selected_items')
        .eq('inspection_id', inspectionId);

      if (resultsError) {
        console.error('❌ 載入檢查結果失敗:', resultsError);
      }

      // 7. 初始化所有項目分數（先用模板預設值，再用現有結果覆蓋）
      const initialScores = new Map<string, ItemScore>();
      templatesData?.forEach((template) => {
        initialScores.set(template.id, {
          template_id: template.id,
          checked_items: [],
          quantities: {},
          deduction: 0,
          earned_score: template.max_score,
          improvement_notes: '',
          photos: [],
        });
      });

      // 用現有結果覆蓋
      if (results) {
        results.forEach((result: any) => {
          const template = templatesData?.find((t) => t.id === result.template_id);
          if (!template) return;

          const checkedItems: string[] = result.selected_items || [];
          const photos: string[] = result.photo_urls || [];

          // 根據 checklist_items 重建 quantities
          const quantities: Record<string, number> = {};
          if (checkedItems.length > 0 && template.checklist_items) {
            // 反推每個 checked item 的數量
            // 總扣分 = sum(deduction * quantity) for each checked item
            // 如果只有一個項目被勾選且該項目需要計數，可以反推數量
            checkedItems.forEach((label) => {
              const checkItem = template.checklist_items.find((ci: ChecklistItem) => ci.label === label);
              if (checkItem?.requires_quantity) {
                // 嘗試反推數量（如果只有單一計數項目）
                const countableItems = checkedItems.filter((l) => {
                  const ci = template.checklist_items.find((c: ChecklistItem) => c.label === l);
                  return ci?.requires_quantity;
                });
                if (countableItems.length === 1 && checkItem.deduction > 0) {
                  // 只有一個計數項目，可以精確反推
                  const otherDeduction = checkedItems
                    .filter((l) => l !== label)
                    .reduce((sum, l) => {
                      const ci = template.checklist_items.find((c: ChecklistItem) => c.label === l);
                      return sum + (ci?.deduction || 0);
                    }, 0);
                  const thisDeduction = result.deduction_amount - otherDeduction;
                  quantities[label] = Math.max(1, Math.round(thisDeduction / checkItem.deduction));
                } else {
                  quantities[label] = 1; // 多個計數項目時，預設為 1
                }
              }
            });
          }

          initialScores.set(result.template_id, {
            template_id: result.template_id,
            checked_items: checkedItems,
            quantities,
            deduction: result.deduction_amount || 0,
            earned_score: result.given_score || 0,
            improvement_notes: result.notes || '',
            photos,
          });
        });
      }

      setItemScores(initialScores);

      // 8. 載入當班人員
      const { data: staffData } = await supabase
        .from('inspection_on_duty_staff')
        .select('employee_code, employee_name, position, is_duty_supervisor, is_manually_added')
        .eq('inspection_id', inspectionId)
        .order('is_duty_supervisor', { ascending: false });

      if (staffData && staffData.length > 0) {
        setOnDutyStaff(staffData.map((s: any) => ({
          employee_code: s.employee_code || '',
          employee_name: s.employee_name || '',
          position: s.position || '',
          is_duty_supervisor: s.is_duty_supervisor || false,
          is_manually_added: s.is_manually_added || false,
        })));
      }

      // 載入督導姓名（用於報表預覽）
      const { data: profileData } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();
      setCurrentUserName(profileData?.full_name || '');

      setLoading(false);
    } catch (error) {
      console.error('❌ 載入資料失敗:', error);
      alert('載入資料失敗，請重新整理頁面');
    }
  };

  // 從上個月的月報表抓取人員（重新載入）
  const fetchStaffForStore = async (storeId: string) => {
    setStaffLoading(true);
    try {
      const supabase = createClient();
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const yearMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

      const { data, error } = await supabase
        .from('monthly_staff_status')
        .select('employee_code, employee_name, position')
        .eq('store_id', storeId)
        .eq('year_month', yearMonth)
        .not('monthly_status', 'in', '(resigned,leave_of_absence,transferred_out)')
        .order('position');

      if (error) {
        console.error('❌ 載入人員失敗:', error);
        setOnDutyStaff([]);
        return;
      }

      if (data && data.length > 0) {
        const staffList: OnDutyStaff[] = data.map((s) => ({
          employee_code: s.employee_code || '',
          employee_name: s.employee_name || '',
          position: s.position || '',
          is_duty_supervisor: false,
          is_manually_added: false,
        }));
        setOnDutyStaff(staffList);
      } else {
        setOnDutyStaff([]);
      }
    } catch (err) {
      console.error('❌ 載入人員異常:', err);
      setOnDutyStaff([]);
    } finally {
      setStaffLoading(false);
    }
  };

  // 手動新增人員
  const handleAddManualStaff = () => {
    if (!newStaffName.trim()) {
      alert('請輸入姓名');
      return;
    }
    const newStaff: OnDutyStaff = {
      employee_code: newStaffCode.trim(),
      employee_name: newStaffName.trim(),
      position: newStaffPosition.trim(),
      is_duty_supervisor: false,
      is_manually_added: true,
    };
    setOnDutyStaff((prev) => [...prev, newStaff]);
    setNewStaffCode('');
    setNewStaffName('');
    setNewStaffPosition('');
    setShowAddStaffForm(false);
  };

  // 移除人員
  const handleRemoveStaff = (index: number) => {
    setOnDutyStaff((prev) => prev.filter((_, i) => i !== index));
  };

  // 切換當班主管
  const toggleDutySupervisor = (index: number) => {
    setOnDutyStaff((prev) =>
      prev.map((s, i) => (i === index ? { ...s, is_duty_supervisor: !s.is_duty_supervisor } : s))
    );
  };

  // 獲取 GPS 定位
  const requestGPSLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus('error');
      setGpsError('當前瀏覽器不支援定位功能');
      return;
    }

    setGpsStatus('loading');
    setGpsError('');
    
    const highAccuracyTimeout = setTimeout(() => {
      tryLowAccuracyLocation();
    }, 8000);
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(highAccuracyTimeout);
        setGpsLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setGpsStatus('success');
        setGpsError('');
      },
      () => {
        clearTimeout(highAccuracyTimeout);
        tryLowAccuracyLocation();
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
    );
    
    function tryLowAccuracyLocation() {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setGpsLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
          setGpsStatus('success');
          setGpsError('');
        },
        (error) => {
          setGpsStatus('error');
          switch (error.code) {
            case error.PERMISSION_DENIED:
              setGpsError('定位權限被拒絕');
              break;
            case error.POSITION_UNAVAILABLE:
              setGpsError('無法取得位置');
              break;
            case error.TIMEOUT:
              setGpsError('定位逾時，請重試');
              break;
            default:
              setGpsError('定位失敗');
          }
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
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

    const template = templates.find((t) => t.id === templateId);
    const checkItem = template?.checklist_items.find((ci) => ci.label === itemLabel);

    const isCurrentlyChecked = currentScore.checked_items.includes(itemLabel);
    const newCheckedItems = isCurrentlyChecked
      ? currentScore.checked_items.filter((label) => label !== itemLabel)
      : [...currentScore.checked_items, itemLabel];

    const newQuantities = { ...currentScore.quantities };
    if (!isCurrentlyChecked && checkItem?.requires_quantity) {
      newQuantities[itemLabel] = 1;
    } else if (isCurrentlyChecked) {
      delete newQuantities[itemLabel];
    }

    const newDeduction = newCheckedItems.reduce((sum, label) => {
      const item = template?.checklist_items.find((ci) => ci.label === label);
      if (!item) return sum;
      const quantity = newQuantities[label] || 1;
      return sum + (item.deduction * quantity);
    }, 0);

    const newEarnedScore = Math.max(0, maxScore - newDeduction);

    const newScores = new Map(itemScores);
    newScores.set(templateId, {
      ...currentScore,
      checked_items: newCheckedItems,
      quantities: newQuantities,
      deduction: newDeduction,
      earned_score: newEarnedScore,
    });
    setItemScores(newScores);
  };

  // 處理數量變更
  const handleQuantityChange = (templateId: string, itemLabel: string, quantity: number, maxScore: number) => {
    const currentScore = itemScores.get(templateId);
    if (!currentScore) return;

    const template = templates.find((t) => t.id === templateId);
    const newQuantities = { ...currentScore.quantities, [itemLabel]: Math.max(1, quantity) };

    const newDeduction = currentScore.checked_items.reduce((sum, label) => {
      const item = template?.checklist_items.find((ci) => ci.label === label);
      if (!item) return sum;
      const qty = newQuantities[label] || 1;
      return sum + (item.deduction * qty);
    }, 0);

    const newEarnedScore = Math.max(0, maxScore - newDeduction);

    const newScores = new Map(itemScores);
    newScores.set(templateId, {
      ...currentScore,
      quantities: newQuantities,
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
    newScores.set(templateId, { ...currentScore, improvement_notes: notes });
    setItemScores(newScores);
  };

  // 處理照片上傳
  const handlePhotoUpload = async (templateId: string, file: File) => {
    const currentScore = itemScores.get(templateId);
    if (!currentScore || currentScore.photos.length >= 5) return;
    try {
      const base64 = await compressImage(file, 800, 0.7);
      const newScores = new Map(itemScores);
      newScores.set(templateId, {
        ...currentScore,
        photos: [...currentScore.photos, base64],
      });
      setItemScores(newScores);
    } catch (error) {
      console.error('照片上傳失敗:', error);
      alert('照片上傳失敗，請重試');
    }
  };

  // 刪除照片
  const removePhoto = (templateId: string, photoIndex: number) => {
    const currentScore = itemScores.get(templateId);
    if (!currentScore) return;
    const newScores = new Map(itemScores);
    newScores.set(templateId, {
      ...currentScore,
      photos: currentScore.photos.filter((_, idx) => idx !== photoIndex),
    });
    setItemScores(newScores);
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

  // 計算總分和評級
  const calculateTotals = () => {
    let totalDeduction = 0;
    itemScores.forEach((score) => {
      totalDeduction += score.deduction;
    });

    const finalScore = 220 - totalDeduction;
    let grade = '0';
    if (finalScore >= 220) grade = '10';
    else if (finalScore >= 215) grade = '9';
    else if (finalScore >= 191) grade = '8';
    else if (finalScore >= 181) grade = '7';
    else if (finalScore >= 171) grade = '6';
    else if (finalScore >= 161) grade = '5';
    else if (finalScore >= 151) grade = '4';
    else if (finalScore >= 141) grade = '3';
    else if (finalScore >= 131) grade = '2';
    else if (finalScore >= 121) grade = '1';

    return { initialScore: 220, totalDeduction, finalScore, grade };
  };

  // 更新巡店記錄
  const handleSubmit = async (isDraft: boolean) => {
    if (!selectedStoreId) {
      alert('請選擇門市');
      return;
    }
    if (!indoorTemperature) {
      alert('請輸入室內溫度');
      return;
    }

    try {
      setSubmitting(true);
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('未登入');

      const totals = calculateTotals();

      console.log('📊 準備更新巡店記錄:', {
        inspectionId,
        selectedStoreId,
        inspectionDate,
        totals,
      });

      // 1. 更新主記錄
      const { error: masterError } = await supabase
        .from('inspection_masters')
        .update({
          store_id: selectedStoreId,
          inspection_date: inspectionDate,
          inspection_type: originalInspectionType,
          status: isDraft ? 'draft' : 'completed',
          max_possible_score: totals.initialScore,
          total_score: totals.finalScore,
          grade: totals.grade,
          signature_photo_url: signaturePhoto || null,
          supervisor_signature_url: supervisorSignature || null,
          supervisor_notes: supervisorNotes.trim() || null,
          indoor_temperature: indoorTemperature ? parseFloat(indoorTemperature) : null,
          gps_latitude: gpsLocation?.latitude || null,
          gps_longitude: gpsLocation?.longitude || null,
        })
        .eq('id', inspectionId);

      if (masterError) {
        console.error('❌ 主記錄更新失敗:', masterError);
        throw masterError;
      }
      console.log('✅ 主記錄更新成功');

      // 2. 刪除舊明細記錄，重新插入
      const { error: deleteResultsError } = await supabase
        .from('inspection_results')
        .delete()
        .eq('inspection_id', inspectionId);

      if (deleteResultsError) {
        console.error('⚠️ 刪除舊明細失敗:', deleteResultsError);
      }

      const resultsToInsert = Array.from(itemScores.values()).map((score) => {
        const template = templates.find((t) => t.id === score.template_id);
        return {
          inspection_id: inspectionId,
          template_id: score.template_id,
          max_score: template?.max_score || 0,
          given_score: score.earned_score,
          deduction_amount: score.deduction,
          is_improvement: score.deduction > 0,
          notes: score.improvement_notes || null,
          selected_items: score.checked_items,
          photo_urls: score.photos.length > 0 ? score.photos : null,
        };
      });

      const { error: resultsError } = await supabase
        .from('inspection_results')
        .insert(resultsToInsert);

      if (resultsError) {
        console.error('❌ 明細記錄建立失敗:', resultsError);
        throw resultsError;
      }
      console.log('✅ 明細記錄更新成功');

      // 3. 刪除舊當班人員，重新插入
      const { error: deleteStaffError } = await supabase
        .from('inspection_on_duty_staff')
        .delete()
        .eq('inspection_id', inspectionId);

      if (deleteStaffError) {
        console.error('⚠️ 刪除舊當班人員失敗:', deleteStaffError);
      }

      if (onDutyStaff.length > 0) {
        const staffToInsert = onDutyStaff.map((s) => ({
          inspection_id: inspectionId,
          employee_code: s.employee_code || null,
          employee_name: s.employee_name,
          position: s.position || null,
          is_duty_supervisor: s.is_duty_supervisor,
          is_manually_added: s.is_manually_added,
        }));

        const { error: staffError } = await supabase
          .from('inspection_on_duty_staff')
          .insert(staffToInsert);

        if (staffError) {
          console.error('⚠️ 當班人員記錄建立失敗:', staffError);
        } else {
          console.log('✅ 當班人員更新成功:', staffToInsert.length, '人');
        }
      }

      if (isDraft) {
        alert('草稿已更新！');
        // 草稿留在當頁，不跳轉
      } else {
        alert('巡店記錄已送出！');
        router.push(`/inspection/${inspectionId}`);
      }
    } catch (error: any) {
      console.error('❌ 更新失敗:', error);
      let errorMessage = '更新失敗';
      if (error?.message) errorMessage += `：${error.message}`;
      if (error?.details) errorMessage += `\n詳情：${error.details}`;
      if (error?.hint) errorMessage += `\n提示：${error.hint}`;
      alert(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // 門市變更時重新載入人員
  const handleStoreChange = (newStoreId: string) => {
    setSelectedStoreId(newStoreId);
    if (newStoreId) {
      // 如果換了門市，重新載入人員
      fetchStaffForStore(newStoreId);
    } else {
      setOnDutyStaff([]);
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

  // 載入中
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入巡店資料中...</p>
        </div>
      </div>
    );
  }

  // 權限錯誤
  if (permissionError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">無法編輯</h1>
          <p className="text-gray-600 mb-6">{permissionError}</p>
          <button
            onClick={() => router.back()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-safe">
      <div className="max-w-5xl mx-auto px-2 sm:px-4 lg:px-8 py-3 sm:py-8">
        {/* 頁面標題 */}
        <div className="mb-3 sm:mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 mb-2 sm:mb-4 active:text-gray-700 p-1 -ml-1 touch-manipulation"
          >
            <ArrowLeft className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm sm:text-base">返回</span>
          </button>
          <h1 className="text-lg sm:text-2xl lg:text-3xl font-bold text-gray-900 break-words leading-tight">
            編輯巡店記錄
          </h1>
          <p className="mt-1.5 text-xs sm:text-sm text-gray-600 leading-relaxed break-words">
            修改巡店檢查項目，系統將自動重新計算分數與評級
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
              {originalStatus === 'draft' ? '草稿' : '進行中'}
            </span>
          </p>
        </div>

        {/* 基本資訊 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 mb-3 sm:mb-6">
          <h2 className="text-sm sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">基本資訊</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6">
            <div>
              <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                <Store className="inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 flex-shrink-0" />
                <span className="break-words">選擇門市 *</span>
              </label>
              <select
                value={selectedStoreId}
                onChange={(e) => handleStoreChange(e.target.value)}
                className="w-full px-2.5 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs sm:text-base appearance-none bg-white"
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
              <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                <Calendar className="inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 flex-shrink-0" />
                <span className="break-words">巡店日期 *</span>
              </label>
              <input
                type="date"
                value={inspectionDate}
                onChange={(e) => setInspectionDate(e.target.value)}
                className="w-full px-2.5 sm:px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs sm:text-base"
                required
              />
            </div>
          </div>
          
          {/* GPS 定位狀態 */}
          <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MapPin className={`w-4 h-4 sm:w-5 sm:h-5 ${
                  gpsStatus === 'success' ? 'text-green-600' : 
                  gpsStatus === 'error' ? 'text-red-600' : 'text-gray-400'
                }`} />
                <span className="text-xs sm:text-sm font-medium text-gray-700">GPS 定位</span>
                <span className="text-[10px] text-gray-400">(選填)</span>
              </div>
              <div className="flex items-center gap-2">
                {gpsStatus === 'loading' && (
                  <>
                    <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                    <span className="text-xs sm:text-sm text-blue-600">定位中...</span>
                  </>
                )}
                {gpsStatus === 'success' && gpsLocation && (
                  <div className="flex flex-col items-end gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm text-green-600 font-medium">✓ 已定位</span>
                      <a
                        href={`https://www.google.com/maps?q=${gpsLocation.latitude},${gpsLocation.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] sm:text-xs text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        ({gpsLocation.latitude.toFixed(6)}, {gpsLocation.longitude.toFixed(6)})
                      </a>
                    </div>
                    {gpsLocation.accuracy && (
                      <span className={`text-[10px] ${gpsLocation.accuracy > 500 ? 'text-orange-500' : 'text-gray-400'}`}>
                        精度: ±{gpsLocation.accuracy.toFixed(0)}m
                      </span>
                    )}
                  </div>
                )}
                {gpsStatus === 'error' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm text-red-600">✗ {gpsError}</span>
                    <button onClick={requestGPSLocation} className="ml-2 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
                      重新定位
                    </button>
                    <button onClick={() => setGpsStatus('idle')} className="px-2 py-1 text-xs bg-gray-400 text-white rounded hover:bg-gray-500 transition-colors">
                      跳過
                    </button>
                  </div>
                )}
                {gpsStatus === 'idle' && (
                  <button onClick={requestGPSLocation} className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
                    重新定位
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 當班人員 */}
        {selectedStoreId && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 mb-3 sm:mb-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h2 className="text-sm sm:text-lg font-semibold text-gray-900 flex items-center gap-1.5">
                <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                當班人員
              </h2>
              <button
                type="button"
                onClick={() => setShowAddStaffForm(!showAddStaffForm)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs sm:text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors font-medium"
              >
                <UserPlus className="w-3.5 h-3.5" />
                手動新增
              </button>
            </div>

            {/* 手動新增表單 */}
            {showAddStaffForm && (
              <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs font-medium text-blue-800 mb-2">手動新增人員</p>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <input type="text" value={newStaffCode} onChange={(e) => setNewStaffCode(e.target.value)} placeholder="員編" className="px-2 py-1.5 border border-gray-300 rounded text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  <input type="text" value={newStaffName} onChange={(e) => setNewStaffName(e.target.value)} placeholder="姓名 *" className="px-2 py-1.5 border border-gray-300 rounded text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  <input type="text" value={newStaffPosition} onChange={(e) => setNewStaffPosition(e.target.value)} placeholder="職位" className="px-2 py-1.5 border border-gray-300 rounded text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={handleAddManualStaff} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                    <Plus className="w-3 h-3" />
                    確認新增
                  </button>
                  <button type="button" onClick={() => { setShowAddStaffForm(false); setNewStaffCode(''); setNewStaffName(''); setNewStaffPosition(''); }} className="px-3 py-1.5 text-xs bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors">
                    取消
                  </button>
                </div>
              </div>
            )}

            {staffLoading ? (
              <div className="flex items-center gap-2 py-4 justify-center text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">載入人員中...</span>
              </div>
            ) : onDutyStaff.length === 0 ? (
              <div className="text-center py-4 text-gray-400 text-xs sm:text-sm">
                尚無當班人員，請手動新增
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="text-left px-2 py-2 font-medium">員編</th>
                      <th className="text-left px-2 py-2 font-medium">姓名</th>
                      <th className="text-left px-2 py-2 font-medium">職位</th>
                      <th className="text-center px-2 py-2 font-medium">
                        <span className="flex items-center justify-center gap-1">
                          <Shield className="w-3 h-3" />
                          當班主管
                        </span>
                      </th>
                      <th className="text-center px-2 py-2 font-medium w-12">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {onDutyStaff.map((staff, idx) => (
                      <tr key={idx} className={`hover:bg-gray-50 ${staff.is_manually_added ? 'bg-blue-50/30' : ''}`}>
                        <td className="px-2 py-2 text-gray-600 font-mono">{staff.employee_code || '-'}</td>
                        <td className="px-2 py-2 font-medium text-gray-900">
                          {staff.employee_name}
                          {staff.is_manually_added && (
                            <span className="ml-1 text-[10px] text-blue-600 bg-blue-100 px-1 rounded">手動</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-gray-600">{staff.position || '-'}</td>
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => toggleDutySupervisor(idx)}
                            className={`w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors ${
                              staff.is_duty_supervisor
                                ? 'bg-orange-500 border-orange-500 text-white'
                                : 'border-gray-300 hover:border-orange-400'
                            }`}
                          >
                            {staff.is_duty_supervisor && (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button type="button" onClick={() => handleRemoveStaff(idx)} className="text-red-400 hover:text-red-600 transition-colors p-1" title="移除">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-400 mt-2">
                  共 {onDutyStaff.length} 人
                  {onDutyStaff.filter(s => s.is_duty_supervisor).length > 0 && (
                    <span>，當班主管 {onDutyStaff.filter(s => s.is_duty_supervisor).length} 人</span>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {/* 分數總覽 */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl shadow-lg p-3 sm:p-6 mb-3 sm:mb-6 text-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 text-center">
            <div>
              <p className="text-[10px] sm:text-sm opacity-90 leading-tight">初始分數</p>
              <p className="text-xl sm:text-3xl font-bold mt-0.5 sm:mt-1">{totals.initialScore}</p>
            </div>
            <div>
              <p className="text-[10px] sm:text-sm opacity-90 leading-tight">總扣分</p>
              <p className="text-xl sm:text-3xl font-bold mt-0.5 sm:mt-1 text-red-200">-{totals.totalDeduction}</p>
            </div>
            <div>
              <p className="text-[10px] sm:text-sm opacity-90 leading-tight">最終得分</p>
              <p className="text-xl sm:text-3xl font-bold mt-0.5 sm:mt-1">{totals.finalScore}</p>
            </div>
            <div>
              <p className="text-[10px] sm:text-sm opacity-90 leading-tight">得分數(滿分10分)</p>
              <p className="text-xl sm:text-3xl font-bold mt-0.5 sm:mt-1">{totals.grade}</p>
            </div>
          </div>
        </div>

        {/* 檢查項目 */}
        <div className="space-y-2 sm:space-y-4 mb-6">
          {sortedSections.map(([sectionKey, section]) => {
            const isExpanded = expandedSections.has(sectionKey);
            const sectionTotal = section.items.reduce((sum, item) => sum + item.max_score, 0);
            const sectionEarned = section.items.reduce(
              (sum, item) => sum + (itemScores.get(item.id)?.earned_score || 0), 0
            );

            return (
              <div key={sectionKey}>
                {/* 室內溫度 - 插在櫃檯區與倉庫之前 */}
                {section.section_order === 3 && (
                  <div className="bg-white rounded-xl shadow-sm border border-orange-200 p-3 sm:p-6 mb-2 sm:mb-4">
                    <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 sm:mb-3">
                      <Thermometer className="inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 text-orange-500" />
                      室內溫度 * <span className="text-[10px] text-gray-400 font-normal">（請查看店內溫度計後填入）</span>
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="relative flex-1 max-w-[200px]">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="50"
                          value={indoorTemperature}
                          onChange={(e) => setIndoorTemperature(e.target.value)}
                          placeholder="請輸入溫度"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm sm:text-base pr-10"
                          required
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">°C</span>
                      </div>
                      {indoorTemperature && (
                        <span className="text-sm text-green-600 font-medium">✓ 已填寫</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => toggleSection(sectionKey)}
                    className="w-full px-4 sm:px-6 py-4 flex items-center justify-between hover:bg-gray-50 active:bg-gray-100 transition-colors touch-manipulation"
                  >
                    <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                      <CheckSquare className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div className="text-left flex-1 min-w-0">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-900 break-words">
                          {section.section_name}
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-600 break-words leading-relaxed">
                          {section.items.length} 項檢查 · 共 {sectionTotal} 分 · 實得 {sectionEarned} 分
                        </p>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                  </button>

                  {isExpanded && (
                    <div className="px-3 sm:px-6 py-3 sm:py-4 border-t border-gray-200 space-y-4 sm:space-y-6">
                      {section.items.map((item) => {
                        const score = itemScores.get(item.id);
                        const hasIssues = score && score.checked_items.length > 0;

                        return (
                          <div
                            key={item.id}
                            className={`p-3 sm:p-4 rounded-lg border-2 ${
                              hasIssues ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-2 sm:mb-3 gap-2 sm:gap-3">
                              <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-gray-900 text-sm sm:text-base break-words leading-tight">
                                  {item.item_name}
                                  <span className="ml-1 sm:ml-2 text-xs sm:text-sm font-normal text-gray-600 whitespace-nowrap">
                                    （{item.max_score}分）
                                  </span>
                                </h4>
                                <p className="text-xs sm:text-sm text-gray-600 mt-0.5 sm:mt-1 break-words leading-relaxed">
                                  {item.item_description}
                                </p>
                              </div>
                              <div className="text-right flex-shrink-0 ml-1 sm:ml-2">
                                <p className="text-[10px] sm:text-sm text-gray-600 whitespace-nowrap">實得</p>
                                <p className={`text-lg sm:text-2xl font-bold ${hasIssues ? 'text-red-600' : 'text-green-600'}`}>
                                  {score?.earned_score || 0}
                                </p>
                              </div>
                            </div>

                            <div className="space-y-1.5 sm:space-y-2">
                              {item.checklist_items.map((checkItem, idx) => (
                                <label
                                  key={idx}
                                  className="flex items-start gap-2 sm:gap-3 p-2 rounded hover:bg-white active:bg-white cursor-pointer transition-colors"
                                >
                                  <input
                                    type="checkbox"
                                    checked={score?.checked_items.includes(checkItem.label)}
                                    onChange={() => handleCheckItem(item.id, checkItem.label, checkItem.deduction, item.max_score)}
                                    className="w-4 h-4 mt-0.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 flex-shrink-0"
                                  />
                                  <span className="flex-1 text-xs sm:text-sm text-gray-700 break-words leading-relaxed min-w-0">
                                    {checkItem.label}
                                  </span>
                                  
                                  {checkItem.requires_quantity && score?.checked_items.includes(checkItem.label) && (
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      <input
                                        type="number"
                                        min="1"
                                        value={score?.quantities[checkItem.label] || 1}
                                        onChange={(e) => handleQuantityChange(item.id, checkItem.label, parseInt(e.target.value) || 1, item.max_score)}
                                        onFocus={(e) => e.target.select()}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-14 px-2 py-0.5 text-xs sm:text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                                      />
                                      <span className="text-xs text-gray-600 whitespace-nowrap">{checkItem.unit}</span>
                                    </div>
                                  )}
                                  
                                  <span className="text-xs sm:text-sm font-medium text-red-600 whitespace-nowrap flex-shrink-0">
                                    -{checkItem.deduction}{checkItem.requires_quantity && score?.checked_items.includes(checkItem.label) ? ` × ${score?.quantities[checkItem.label] || 1}` : ''} 分
                                  </span>
                                </label>
                              ))}
                            </div>

                            {hasIssues && (
                              <div className="mt-2 sm:mt-3 space-y-2 sm:space-y-3">
                                <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">
                                  <AlertCircle className="inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 flex-shrink-0" />
                                  <span className="break-words">改善建議</span>
                                </label>
                                <textarea
                                  value={score?.improvement_notes || ''}
                                  onChange={(e) => handleNotesChange(item.id, e.target.value)}
                                  placeholder="請填寫需改善的具體事項..."
                                  className="w-full px-2.5 sm:px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-xs sm:text-base"
                                  rows={3}
                                />
                                
                                {/* 照片上傳區域 */}
                                <div>
                                  <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                                    <Camera className="inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
                                    問題照片（最多 5 張）
                                  </label>
                                  <div className="flex flex-wrap gap-3">
                                    {score?.photos?.map((photo, idx) => (
                                      <div key={idx} className="relative group">
                                        <img
                                          src={photo}
                                          alt={`照片 ${idx + 1}`}
                                          className="w-24 h-24 sm:w-20 sm:h-20 object-cover rounded-lg border-2 border-gray-300 shadow-sm"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => removePhoto(item.id, idx)}
                                          className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity active:scale-95"
                                          aria-label="刪除照片"
                                        >
                                          <X className="w-4 h-4" />
                                        </button>
                                      </div>
                                    ))}
                                    
                                    {(!score?.photos || score.photos.length < 5) && (
                                      <label className="w-24 h-24 sm:w-20 sm:h-20 border-2 border-dashed border-blue-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-blue-50 hover:border-blue-500 active:bg-blue-100 transition-all shadow-sm">
                                        <Camera className="w-8 h-8 text-blue-500 mb-1" />
                                        <span className="text-xs text-blue-600 font-medium">拍照</span>
                                        <input
                                          type="file"
                                          accept="image/*"
                                          capture="environment"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                              handlePhotoUpload(item.id, file);
                                              e.target.value = '';
                                            }
                                          }}
                                          className="hidden"
                                        />
                                      </label>
                                    )}
                                  </div>
                                  {score?.photos && score.photos.length >= 5 && (
                                    <p className="text-xs text-amber-600 mt-2 font-medium">✓ 已達上傳上限（5張）</p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 其他建議 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 mb-6">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 sm:mb-3">
            <AlertCircle className="inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
            其他建議
          </label>
          <textarea
            value={supervisorNotes}
            onChange={(e) => setSupervisorNotes(e.target.value)}
            placeholder="請輸入其他建議或備註事項..."
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
          />
          <p className="text-xs text-gray-500 mt-1">可填寫額外的建議、備註或需要特別注意的事項</p>
        </div>

        {/* 預覽報表按鈕 */}
        <div className="bg-white rounded-xl shadow-sm border border-blue-200 p-3 sm:p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm sm:text-base font-semibold text-blue-800 flex items-center gap-2">
                <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                列印報表預覽
              </h3>
              <p className="text-xs text-gray-500 mt-1">請先讓店長/當班主管確認報表內容，再進行簽名</p>
            </div>
            <button
              onClick={() => setShowReportPreview(true)}
              disabled={!selectedStoreId || !indoorTemperature}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              <Eye className="w-4 h-4" />
              預覽報表
            </button>
          </div>
        </div>

        {/* 店長/當班主管確認簽名 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 mb-6">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 sm:mb-3">
            <PenTool className="inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
            店長/當班主管確認簽名
          </label>
          <SignaturePad
            onSignatureChange={(dataUrl) => setSignaturePhoto(dataUrl)}
            initialSignature={signaturePhoto}
            width={500}
            height={180}
          />
          <p className="text-xs text-gray-500 mt-2">
            ✓ 店長或當班主管確認報表內容後簽名
          </p>
        </div>

        {/* 督導簽名 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6 mb-6">
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 sm:mb-3">
            <Shield className="inline w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1" />
            督導簽名
          </label>
          <SignaturePad
            onSignatureChange={(dataUrl) => setSupervisorSignature(dataUrl)}
            initialSignature={supervisorSignature}
            width={500}
            height={180}
          />
          <p className="text-xs text-gray-500 mt-2">
            ✓ 督導人員簽名確認
          </p>
        </div>

        {/* 驗證提示 */}
        {(!selectedStoreId || !indoorTemperature) && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5 flex items-start gap-2">
            <span className="text-amber-500 mt-0.5">⚠</span>
            <div className="text-sm text-amber-700">
              {!selectedStoreId && <p>請選擇門市</p>}
              {!indoorTemperature && <p>請填寫室內溫度</p>}
            </div>
          </div>
        )}

        {/* 操作按鈕 */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sticky bottom-0 bg-white pt-3 sm:pt-4 pb-safe">
          <button
            onClick={() => handleSubmit(true)}
            disabled={submitting || !selectedStoreId || !indoorTemperature}
            className="flex-1 flex items-center justify-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 active:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm sm:text-base shadow-sm"
          >
            <Save className="w-4 h-4 sm:w-5 sm:h-5" />
            更新草稿
          </button>
          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting || !selectedStoreId || !signaturePhoto || !supervisorSignature || !indoorTemperature}
            className="flex-1 flex items-center justify-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-lg hover:from-blue-600 hover:to-indigo-700 active:from-blue-700 active:to-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg text-sm sm:text-base"
          >
            <Send className="w-4 h-4 sm:w-5 sm:h-5" />
            {!signaturePhoto || !supervisorSignature ? '請完成兩個簽名' : '送出記錄'}
          </button>
        </div>

        {/* 報表預覽 Modal */}
        {showReportPreview && (() => {
          const totals = calculateTotals();
          const selectedStore = stores.find(s => s.id === selectedStoreId);

          // 組裝 inspection 資料
          const previewInspection = {
            id: inspectionId,
            inspection_date: inspectionDate,
            status: originalStatus,
            total_score: totals.finalScore,
            max_possible_score: totals.initialScore,
            grade: totals.grade,
            supervisor_notes: supervisorNotes,
            indoor_temperature: indoorTemperature ? parseFloat(indoorTemperature) : null,
            signature_photo_url: signaturePhoto || null,
            supervisor_signature_url: supervisorSignature || null,
            gps_latitude: gpsLocation?.latitude || null,
            gps_longitude: gpsLocation?.longitude || null,
          };

          // 組裝 groupedResults（與詳情頁相同格式）
          const allResults = Array.from(itemScores.values()).map(score => {
            const template = templates.find(t => t.id === score.template_id);
            return {
              id: score.template_id,
              template_id: score.template_id,
              max_score: template?.max_score || 0,
              given_score: score.earned_score,
              deduction_amount: score.deduction,
              is_improvement: score.deduction > 0,
              notes: score.improvement_notes || null,
              photo_urls: score.photos.length > 0 ? score.photos : null,
              template: template || null,
            };
          }).filter(r => r.template);

          const deductedResults = allResults.filter(r => r.deduction_amount > 0);
          const groupedObj = deductedResults.reduce((acc: any, result: any) => {
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
          }, {});

          const previewGroupedResults = Object.entries(groupedObj).sort(
            ([, a]: any, [, b]: any) => a.section_order - b.section_order
          );

          const previewImprovementItems = allResults.filter(r => r.is_improvement);

          return (
            <div className="fixed inset-0 z-50 bg-black bg-opacity-50 overflow-auto">
              <div className="min-h-screen py-4 px-2 sm:px-4">
                <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-2xl">
                  {/* Modal 頂部操作列 */}
                  <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 rounded-t-xl flex items-center justify-between">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      <FileText className="w-5 h-5 text-blue-600" />
                      巡店報表預覽
                    </h3>
                    <button
                      onClick={() => setShowReportPreview(false)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
                    >
                      <X className="w-4 h-4" />
                      關閉預覽
                    </button>
                  </div>
                  {/* 報表內容 */}
                  <div className="p-4 sm:p-6">
                    <PrintInspectionReport
                      inspection={previewInspection}
                      store={selectedStore || { store_name: '-', store_code: '-', address: '-' }}
                      inspector={{ full_name: currentUserName || '(未知)' }}
                      groupedResults={previewGroupedResults}
                      improvementItems={previewImprovementItems}
                      onDutyStaff={onDutyStaff}
                      previewMode={true}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
