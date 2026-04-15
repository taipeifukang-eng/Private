'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ChevronUp, ChevronDown, Save, AlertTriangle, Lock, Search, Building, Users, ListTodo, CornerDownRight } from 'lucide-react';
import type { WorkflowStep, DepartmentSection, Template, SubStep } from '@/types/workflow';

interface User {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  job_title: string | null;
  department: string | null;
  employee_code: string | null;
}

interface WorkflowBuilderV2Props {
  template?: Template;
  isEditing?: boolean;
  hasActiveAssignments?: boolean;
  hasCompletedAssignments?: boolean;
}

export default function WorkflowBuilderV2({ 
  template, 
  isEditing = false,
  hasActiveAssignments = false,
  hasCompletedAssignments = false,
}: WorkflowBuilderV2Props) {
  const router = useRouter();
  
  // Basic info
  const [title, setTitle] = useState(template?.title || '');
  const [description, setDescription] = useState(template?.description || '');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [plannedEndDate, setPlannedEndDate] = useState('');
  
  // Department sections
  const [sections, setSections] = useState<DepartmentSection[]>(template?.sections || []);
  const [activeSectionIndex, setActiveSectionIndex] = useState(0);
  
  // Available data
  const [departments, setDepartments] = useState<string[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  
  // Loading states
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Load departments and users on mount
  useEffect(() => {
    loadInitialData();
  }, []);

  // Initialize from template if editing
  useEffect(() => {
    if (template) {
      setTitle(template.title);
      setDescription(template.description || '');
      setSections(template.sections || []);
    }
  }, [template]);

  // Load latest planned schedule dates for edit mode
  useEffect(() => {
    const loadExistingSchedule = async () => {
      if (!template?.id) return;

      try {
        const { getExistingCollaborators } = await import('@/app/actions');
        const result = await getExistingCollaborators(template.id);

        if (result.success && result.data) {
          setPlannedStartDate(result.data.planned_start_date || '');
          setPlannedEndDate(result.data.planned_end_date || '');
        }
      } catch (error) {
        console.error('Error loading existing schedule:', error);
      }
    };

    loadExistingSchedule();
  }, [template?.id]);

  const loadInitialData = async () => {
    try {
      const { getAllDepartments } = await import('@/app/actions');
      const { getAllUsers } = await import('@/app/auth/actions');
      
      const [deptResult, userResult] = await Promise.all([
        getAllDepartments(),
        getAllUsers()
      ]);
      
      if (deptResult.success) {
        setDepartments(deptResult.data || []);
      }
      
      if (userResult.success) {
        setAllUsers(userResult.data || []);
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setIsLoadingData(false);
    }
  };

  // Add new department section
  const addSection = () => {
    const newSection: DepartmentSection = {
      id: `section-${Date.now()}`,
      department: '',
      assigned_users: [],
      steps: []
    };
    setSections([...sections, newSection]);
    setActiveSectionIndex(sections.length);
  };

  // Remove a section
  const removeSection = (index: number) => {
    if (sections.length <= 1) {
      alert('至少需要保留一個部門區塊');
      return;
    }
    const newSections = sections.filter((_, i) => i !== index);
    setSections(newSections);
    if (activeSectionIndex >= newSections.length) {
      setActiveSectionIndex(Math.max(0, newSections.length - 1));
    }
  };

  // Update section department
  const updateSectionDepartment = (index: number, department: string) => {
    const newSections = [...sections];
    newSections[index] = { 
      ...newSections[index], 
      department,
      assigned_users: [] // Reset users when department changes
    };
    setSections(newSections);
  };

  // Toggle user in section
  const toggleUserInSection = (sectionIndex: number, userId: string) => {
    const newSections = [...sections];
    const section = newSections[sectionIndex];
    
    if (section.assigned_users.includes(userId)) {
      section.assigned_users = section.assigned_users.filter(id => id !== userId);
    } else {
      section.assigned_users = [...section.assigned_users, userId];
    }
    
    setSections(newSections);
  };

  // Add step to section
  const addStepToSection = (sectionIndex: number) => {
    const newSections = [...sections];
    const section = newSections[sectionIndex];
    
    // Generate unique step ID across all sections
    let maxId = 0;
    sections.forEach(s => {
      s.steps.forEach(step => {
        const id = parseInt(step.id) || 0;
        if (id > maxId) maxId = id;
      });
    });
    
    const newStep: WorkflowStep = {
      id: (maxId + 1).toString(),
      label: '',
      description: '',
      required: false
    };
    
    section.steps = [...section.steps, newStep];
    setSections(newSections);

    // Auto-scroll to the new step after a short delay
    setTimeout(() => {
      const stepElements = document.querySelectorAll('[data-step-id]');
      const lastStep = stepElements[stepElements.length - 1];
      if (lastStep) {
        lastStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Focus on the new step's label input
        const input = lastStep.querySelector('input[placeholder="步驟名稱 *"]') as HTMLInputElement;
        if (input) input.focus();
      }
    }, 100);
  };

  // Update step in section
  const updateStepInSection = (sectionIndex: number, stepIndex: number, field: keyof WorkflowStep, value: any) => {
    const newSections = [...sections];
    newSections[sectionIndex].steps[stepIndex] = {
      ...newSections[sectionIndex].steps[stepIndex],
      [field]: value
    };
    setSections(newSections);
  };

  // Remove step from section
  const removeStepFromSection = (sectionIndex: number, stepIndex: number) => {
    const newSections = [...sections];
    newSections[sectionIndex].steps = newSections[sectionIndex].steps.filter((_, i) => i !== stepIndex);
    setSections(newSections);
  };

  // Move step up in section
  const moveStepUp = (sectionIndex: number, stepIndex: number) => {
    if (stepIndex === 0) return;
    const newSections = [...sections];
    const steps = newSections[sectionIndex].steps;
    [steps[stepIndex - 1], steps[stepIndex]] = [steps[stepIndex], steps[stepIndex - 1]];
    setSections(newSections);
  };

  // Move step down in section
  const moveStepDown = (sectionIndex: number, stepIndex: number) => {
    const newSections = [...sections];
    const steps = newSections[sectionIndex].steps;
    if (stepIndex === steps.length - 1) return;
    [steps[stepIndex], steps[stepIndex + 1]] = [steps[stepIndex + 1], steps[stepIndex]];
    setSections(newSections);
  };

  // Add sub-step to a step
  const addSubStep = (sectionIndex: number, stepIndex: number) => {
    const newSections = [...sections];
    const step = newSections[sectionIndex].steps[stepIndex];
    
    // Generate unique sub-step ID
    const existingSubSteps = step.subSteps || [];
    const subStepId = `${step.id}-${existingSubSteps.length + 1}`;
    
    const newSubStep: SubStep = {
      id: subStepId,
      label: '',
      description: '',
      required: false
    };
    
    step.subSteps = [...existingSubSteps, newSubStep];
    setSections(newSections);
  };

  // Update sub-step
  const updateSubStep = (sectionIndex: number, stepIndex: number, subStepIndex: number, field: keyof SubStep, value: any) => {
    const newSections = [...sections];
    const subSteps = newSections[sectionIndex].steps[stepIndex].subSteps;
    if (subSteps) {
      subSteps[subStepIndex] = {
        ...subSteps[subStepIndex],
        [field]: value
      };
    }
    setSections(newSections);
  };

  // Remove sub-step
  const removeSubStep = (sectionIndex: number, stepIndex: number, subStepIndex: number) => {
    const newSections = [...sections];
    const step = newSections[sectionIndex].steps[stepIndex];
    if (step.subSteps) {
      step.subSteps = step.subSteps.filter((_, i) => i !== subStepIndex);
    }
    setSections(newSections);
  };

  // Get users for current section's department
  const getUsersForDepartment = (department: string) => {
    if (!department) return [];
    return allUsers.filter(u => u.department === department);
  };

  // Validate form
  const validateForm = (): string | null => {
    if (!title.trim()) return '請輸入專案標題';
    if (sections.length === 0) return '請至少新增一個部門區塊';
    
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (!section.department) return `請選擇第 ${i + 1} 個區塊的部門`;
      if (section.assigned_users.length === 0) return `請為「${section.department}」部門選擇至少一位執行人員`;
      if (section.steps.length === 0) return `請為「${section.department}」部門新增至少一個步驟`;
      
      const hasEmptyLabel = section.steps.some(step => !step.label.trim());
      if (hasEmptyLabel) return `「${section.department}」部門的步驟名稱不能為空`;

      const hasInvalidStepDateRange = section.steps.some(
        (step) =>
          step.planned_start_date &&
          step.planned_end_date &&
          step.planned_start_date > step.planned_end_date
      );
      if (hasInvalidStepDateRange) {
        return `「${section.department}」部門有步驟的預計起始日晚於預計結束日`;
      }
    }

    if (plannedStartDate && plannedEndDate && plannedStartDate > plannedEndDate) {
      return '預計起始日不可晚於預計結束日';
    }
    
    return null;
  };

  // Save template
  const handleSave = async () => {
    if (isSaving) return;
    
    const error = validateForm();
    if (error) {
      alert(error);
      return;
    }

    setIsSaving(true);
    try {
      const { createTemplateV2, updateTemplateV2 } = await import('@/app/actions');
      
      const templateData = {
        title: title.trim(),
        description: description.trim(),
        sections,
        planned_start_date: plannedStartDate || null,
        planned_end_date: plannedEndDate || null,
      };

      let result;
      if (isEditing && template) {
        result = await updateTemplateV2(template.id, templateData);
      } else {
        result = await createTemplateV2(templateData);
      }

      if (result.success) {
        const totalUsers = sections.reduce((sum, s) => sum + s.assigned_users.length, 0);
        const totalSteps = sections.reduce((sum, s) => sum + s.steps.length, 0);
        alert(`✅ ${isEditing ? '更新' : '建立'}成功！\n${sections.length} 個部門區塊，${totalUsers} 位執行人員，${totalSteps} 個步驟`);
        router.push('/admin/templates');
      } else {
        alert(`❌ ${isEditing ? '更新' : '建立'}失敗：${result.error}`);
      }
    } catch (error) {
      console.error('Save error:', error);
      alert(`❌ 發生錯誤：${error instanceof Error ? error.message : '請稍後再試'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const currentSection = sections[activeSectionIndex];
  const departmentUsers = currentSection ? getUsersForDepartment(currentSection.department) : [];
  
  // 根據搜尋關鍵字過濾人員
  const filteredDepartmentUsers = departmentUsers.filter(user => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.full_name?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query) ||
      user.employee_code?.toLowerCase().includes(query) ||
      user.job_title?.toLowerCase().includes(query)
    );
  });

  if (isLoadingData) {
    return (
      <div className="w-full p-6 lg:p-8">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-6 lg:p-8">
      <div className="bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          {isEditing ? '編輯任務' : '建立新任務'}
        </h1>

        {/* Warnings */}
        {isEditing && hasCompletedAssignments && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-3">
              <Lock className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 mb-1">🔒 無法編輯</h3>
                <p className="text-sm text-red-800">
                  此任務已有完成的指派記錄，無法再進行編輯。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Basic Info */}
        <div className="mb-8 p-6 bg-gray-50 rounded-lg">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">1</span>
            基本資訊
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                專案標題 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="輸入專案標題"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                專案描述
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                rows={3}
                placeholder="輸入專案描述（選填）"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                任務預計時程（選填）
              </label>
              <p className="text-sm text-gray-500 mb-3">
                設定後會套用到此任務的排程，甘特圖會依此區間顯示每週時間軸。
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">預計起始日</label>
                  <input
                    type="date"
                    value={plannedStartDate}
                    onChange={(e) => setPlannedStartDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">預計結束日</label>
                  <input
                    type="date"
                    value={plannedEndDate}
                    onChange={(e) => setPlannedEndDate(e.target.value)}
                    min={plannedStartDate || undefined}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2: Department Sections */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">2</span>
              部門任務區塊
            </h2>
            <button
              onClick={addSection}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <Plus size={20} />
              新增部門區塊
            </button>
          </div>

          {sections.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
              <Building size={48} className="mx-auto text-gray-400 mb-4" />
              <p className="text-gray-500 mb-4">尚未新增任何部門區塊</p>
              <button
                onClick={addSection}
                className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                <Plus size={20} />
                新增第一個部門區塊
              </button>
            </div>
          ) : (
            <>
              {/* Section Tabs */}
              <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-200 pb-4">
                {sections.map((section, index) => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSectionIndex(index)}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 ${
                      activeSectionIndex === index
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <Building size={16} />
                    {section.department || `區塊 ${index + 1}`}
                    <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${
                      activeSectionIndex === index 
                        ? 'bg-purple-500' 
                        : 'bg-gray-200 text-gray-600'
                    }`}>
                      {section.steps.length} 步驟
                    </span>
                  </button>
                ))}
              </div>

              {/* Active Section Content */}
              {currentSection && (
                <div className="border border-gray-200 rounded-lg p-6 bg-white">
                  {/* Section Header */}
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {currentSection.department || `區塊 ${activeSectionIndex + 1}`}
                    </h3>
                    <button
                      onClick={() => removeSection(activeSectionIndex)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-lg text-sm transition-colors flex items-center gap-1"
                    >
                      <Trash2 size={16} />
                      刪除此區塊
                    </button>
                  </div>

                  {/* Department Selection */}
                  <div className="mb-6 p-4 bg-blue-50 rounded-lg">
                    <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                      <Building size={16} />
                      選擇部門 <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={currentSection.department}
                      onChange={(e) => updateSectionDepartment(activeSectionIndex, e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    >
                      <option value="">請選擇部門</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                    {departments.length === 0 && (
                      <p className="mt-2 text-sm text-amber-700">
                        ⚠️ 尚無部門資料，請先在「使用者管理」中設定員工的部門
                      </p>
                    )}
                  </div>

                  {/* User Selection for Department */}
                  {currentSection.department && (
                    <div className="mb-6 p-4 bg-green-50 rounded-lg">
                      <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                        <Users size={16} />
                        指派「{currentSection.department}」的執行人員 <span className="text-red-500">*</span>
                      </label>
                      
                      {currentSection.assigned_users.length > 0 && (
                        <div className="mb-3 p-2 bg-green-100 rounded text-sm text-green-800">
                          已選擇 {currentSection.assigned_users.length} 位人員
                        </div>
                      )}

                      {departmentUsers.length === 0 ? (
                        <p className="text-amber-700 text-sm">
                          ⚠️ 此部門目前沒有成員，請先在「使用者管理」中設定員工部門
                        </p>
                      ) : (
                        <>
                          {/* 搜尋框 */}
                          <div className="mb-3">
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="搜尋姓名、Email、員工代號或職位..."
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            />
                          </div>
                          
                          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                            {filteredDepartmentUsers.length === 0 ? (
                              <div className="p-4 text-center text-gray-500 text-sm">
                                找不到符合「{searchQuery}」的人員
                              </div>
                            ) : (
                              filteredDepartmentUsers.map(user => (
                                <label
                                  key={user.id}
                                  className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"
                                >
                                  <input
                                    type="checkbox"
                                    checked={currentSection.assigned_users.includes(user.id)}
                                    onChange={() => toggleUserInSection(activeSectionIndex, user.id)}
                                    className="w-4 h-4 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                                  />
                                  <div className="flex-1">
                                    <div className="font-medium text-gray-900">
                                      {user.full_name || user.email}
                                    </div>
                                    <div className="text-sm text-gray-500">
                                      {user.employee_code && <span className="mr-2">{user.employee_code}</span>}
                                      {user.job_title && <span>{user.job_title}</span>}
                                    </div>
                                  </div>
                                </label>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Steps for this Section */}
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <ListTodo size={16} />
                        「{currentSection.department || '此區塊'}」的工作步驟
                      </label>
                      <button
                        onClick={() => addStepToSection(activeSectionIndex)}
                        className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm"
                      >
                        <Plus size={16} />
                        新增步驟
                      </button>
                    </div>

                    {currentSection.steps.length === 0 ? (
                      <div className="text-center py-8 bg-white rounded-lg border-2 border-dashed border-purple-200">
                        <p className="text-gray-500 text-sm">尚未新增步驟</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {currentSection.steps.map((step, stepIndex) => (
                          <div key={step.id} data-step-id={step.id} className="bg-white rounded-lg p-4 border border-gray-200">
                            <div className="flex items-start gap-3">
                              {/* Step Number */}
                              <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                                {stepIndex + 1}
                              </div>

                              {/* Step Content */}
                              <div className="flex-1 space-y-2">
                                <input
                                  type="text"
                                  value={step.label}
                                  onChange={(e) => updateStepInSection(activeSectionIndex, stepIndex, 'label', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none text-sm"
                                  placeholder="步驟名稱 *"
                                />
                                <input
                                  type="text"
                                  value={step.description || ''}
                                  onChange={(e) => updateStepInSection(activeSectionIndex, stepIndex, 'description', e.target.value)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none text-sm"
                                  placeholder="步驟描述（選填）"
                                />
                                <label className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={step.required}
                                    onChange={(e) => updateStepInSection(activeSectionIndex, stepIndex, 'required', e.target.checked)}
                                    className="w-4 h-4 text-purple-600 rounded"
                                  />
                                  必填步驟
                                </label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  <div>
                                    <label className="mb-1 block text-xs text-gray-600">步驟預計起始日（選填）</label>
                                    <input
                                      type="date"
                                      value={step.planned_start_date || ''}
                                      onChange={(e) => updateStepInSection(activeSectionIndex, stepIndex, 'planned_start_date', e.target.value || null)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none text-sm"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-1 block text-xs text-gray-600">步驟預計結束日（選填）</label>
                                    <input
                                      type="date"
                                      value={step.planned_end_date || ''}
                                      min={step.planned_start_date || undefined}
                                      onChange={(e) => updateStepInSection(activeSectionIndex, stepIndex, 'planned_end_date', e.target.value || null)}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none text-sm"
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Step Actions */}
                              <div className="flex flex-col gap-1">
                                <button
                                  onClick={() => moveStepUp(activeSectionIndex, stepIndex)}
                                  disabled={stepIndex === 0}
                                  className="p-1 text-gray-500 hover:text-purple-600 disabled:opacity-30"
                                >
                                  <ChevronUp size={18} />
                                </button>
                                <button
                                  onClick={() => moveStepDown(activeSectionIndex, stepIndex)}
                                  disabled={stepIndex === currentSection.steps.length - 1}
                                  className="p-1 text-gray-500 hover:text-purple-600 disabled:opacity-30"
                                >
                                  <ChevronDown size={18} />
                                </button>
                                <button
                                  onClick={() => removeStepFromSection(activeSectionIndex, stepIndex)}
                                  className="p-1 text-gray-500 hover:text-red-600"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </div>

                            {/* Sub-steps */}
                            <div className="mt-3 ml-11">
                              {step.subSteps && step.subSteps.length > 0 && (
                                <div className="space-y-2 mb-2">
                                  {step.subSteps.map((subStep, subStepIndex) => (
                                    <div key={subStep.id} className="flex items-start gap-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
                                      <CornerDownRight size={16} className="text-gray-400 mt-2 flex-shrink-0" />
                                      <div className="flex-1 space-y-2">
                                        <input
                                          type="text"
                                          value={subStep.label}
                                          onChange={(e) => updateSubStep(activeSectionIndex, stepIndex, subStepIndex, 'label', e.target.value)}
                                          className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none text-sm"
                                          placeholder="子步驟名稱"
                                        />
                                        <label className="flex items-center gap-2 text-xs text-gray-600">
                                          <input
                                            type="checkbox"
                                            checked={subStep.required}
                                            onChange={(e) => updateSubStep(activeSectionIndex, stepIndex, subStepIndex, 'required', e.target.checked)}
                                            className="w-3 h-3 text-purple-600 rounded"
                                          />
                                          必填
                                        </label>
                                      </div>
                                      <button
                                        onClick={() => removeSubStep(activeSectionIndex, stepIndex, subStepIndex)}
                                        className="p-1 text-gray-400 hover:text-red-600"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <button
                                onClick={() => addSubStep(activeSectionIndex, stepIndex)}
                                className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800"
                              >
                                <Plus size={14} />
                                新增子步驟
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Bottom Add Button - 底部新增按鈕 */}
                    {currentSection.steps.length > 0 && (
                      <div className="mt-4 text-center">
                        <button
                          onClick={() => addStepToSection(activeSectionIndex)}
                          className="inline-flex items-center gap-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 shadow-md transition-all hover:shadow-lg"
                        >
                          <Plus size={18} />
                          新增步驟
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Summary */}
        {sections.length > 0 && (
          <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
            <h3 className="font-semibold text-indigo-900 mb-2">📋 任務摘要</h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-indigo-700">部門區塊：</span>
                <span className="font-bold text-indigo-900 ml-1">{sections.length}</span>
              </div>
              <div>
                <span className="text-indigo-700">執行人員：</span>
                <span className="font-bold text-indigo-900 ml-1">
                  {sections.reduce((sum, s) => sum + s.assigned_users.length, 0)}
                </span>
              </div>
              <div>
                <span className="text-indigo-700">總步驟數：</span>
                <span className="font-bold text-indigo-900 ml-1">
                  {sections.reduce((sum, s) => sum + s.steps.length, 0)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Save Button */}
        <div className="flex gap-4">
          <button
            onClick={handleSave}
            disabled={hasCompletedAssignments || isSaving}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={20} />
            {isSaving ? '儲存中...' : (isEditing ? '更新任務' : '儲存任務')}
          </button>
          <button
            onClick={() => router.push('/admin/templates')}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
