'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ChevronUp, ChevronDown, Save, AlertTriangle, Lock, Search } from 'lucide-react';
import type { WorkflowStep } from '@/types/workflow';
import type { Template } from '@/types/workflow';

interface User {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  job_title: string | null;
}

interface WorkflowBuilderProps {
  template?: Template;
  isEditing?: boolean;
  hasActiveAssignments?: boolean;
  hasCompletedAssignments?: boolean;
  checkedStepIds?: number[];
}

export default function WorkflowBuilder({ 
  template, 
  isEditing = false,
  hasActiveAssignments = false,
  hasCompletedAssignments = false,
  checkedStepIds = []
}: WorkflowBuilderProps) {
  const router = useRouter();
  const [title, setTitle] = useState(template?.title || '');
  const [description, setDescription] = useState(template?.description || '');
  const [steps, setSteps] = useState<WorkflowStep[]>(template?.steps_schema || []);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setTitle(template.title);
      setDescription(template.description || '');
      setSteps(template.steps_schema || []);
    }
  }, [template]);

  // Load users for assignment (only for new templates)
  useEffect(() => {
    if (!isEditing) {
      loadUsers();
    } else {
      setIsLoadingUsers(false);
    }
  }, [isEditing]);

  const loadUsers = async () => {
    try {
      const { getAllUsers } = await import('@/app/auth/actions');
      const result = await getAllUsers();
      
      if (result.success && result.data) {
        setUsers(result.data);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const filteredUsers = users.filter(user => 
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (user.full_name && user.full_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (user.job_title && user.job_title.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId);
      } else {
        return [...prev, userId];
      }
    });
  };

  // Add a new step
  const addStep = () => {
    // Use sequential ID (1, 2, 3, ...) instead of UUID
    const nextId = steps.length > 0 
      ? Math.max(...steps.map(s => parseInt(s.id) || 0)) + 1 
      : 1;
    
    const newStep: WorkflowStep = {
      id: nextId.toString(),
      label: '',
      description: '',
      required: false,
    };
    setSteps([...steps, newStep]);
  };

  // Remove a step by index
  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  // Move step up
  const moveStepUp = (index: number) => {
    if (index === 0) return;
    const newSteps = [...steps];
    [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
    setSteps(newSteps);
  };

  // Move step down
  const moveStepDown = (index: number) => {
    if (index === steps.length - 1) return;
    const newSteps = [...steps];
    [newSteps[index], newSteps[index + 1]] = [newSteps[index + 1], newSteps[index]];
    setSteps(newSteps);
  };

  // Update step field
  const updateStep = (index: number, field: keyof WorkflowStep, value: any) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setSteps(newSteps);
  };

  // Save template
  const handleSaveTemplate = async () => {
    if (isSaving) {
      console.log('⏳ 正在儲存中，請勿重複提交');
      return;
    }

    if (hasCompletedAssignments) {
      alert('❌ 此任務已有完成的指派記錄，無法編輯');
      return;
    }

    if (!title.trim()) {
      alert('請輸入專案標題');
      return;
    }
    if (steps.length === 0) {
      alert('請至少新增一個步驟');
      return;
    }

    // Validate all steps have labels
    const hasEmptyLabels = steps.some(step => !step.label.trim());
    if (hasEmptyLabels) {
      alert('請為所有步驟填寫名稱');
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing && template) {
        const { updateTemplate } = await import('@/app/actions');
        
        console.log('正在更新任務...', {
          templateId: template.id,
          title: title.trim(),
          description: description.trim(),
          steps_count: steps.length,
        });
        
        const result = await updateTemplate(template.id, {
          title: title.trim(),
          description: description.trim(),
          steps_schema: steps,
        });

        console.log('Server Action 回應:', result);

        if (result.success) {
          alert('✅ 任務更新成功！');
          router.push('/admin/templates');
        } else {
          console.error('更新失敗:', result.error);
          alert(`❌ 更新失敗：${result.error}`);
        }
      } else {
        const { createTemplate } = await import('@/app/actions');
        
        console.log('正在儲存任務...', {
          title: title.trim(),
          description: description.trim(),
          steps_count: steps.length,
          assigned_users: selectedUserIds,
        });
        
        const result = await createTemplate({
          title: title.trim(),
          description: description.trim(),
          steps_schema: steps,
          assigned_to: selectedUserIds,
        });

        console.log('Server Action 回應:', result);

        if (result.success) {
          if (selectedUserIds.length === 0) {
            alert('✅ 任務儲存成功！任務已指派給您自己');
          } else {
            alert(`✅ 任務儲存成功！已指派給 ${selectedUserIds.length} 位使用者`);
          }
          // Reset form
          setTitle('');
          setDescription('');
          setSteps([]);
          setSelectedUserIds([]);
          // Redirect to templates page
          router.push('/admin/templates');
        } else {
          console.error('儲存失敗:', result.error);
          alert(`❌ 儲存失敗：${result.error}`);
        }
      }
    } catch (error) {
      console.error('發生錯誤:', error);
      alert(`❌ 發生錯誤：${error instanceof Error ? error.message : '請稍後再試'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full p-6 lg:p-8">
      <div className="bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          {isEditing ? '編輯任務' : '建立新任務'}
        </h1>

        {/* Warnings for editing active assignments */}
        {isEditing && hasActiveAssignments && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-900 mb-1">⚠️ 此任務有進行中的指派</h3>
                <p className="text-sm text-yellow-800">
                  此任務模板已被使用，編輯時請謹慎。已完成的步驟會標示為
                  <Lock className="inline mx-1" size={14} />
                  ，表示有員工已勾選完成。
                </p>
              </div>
            </div>
          </div>
        )}

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

        {/* Project Title */}
        <div className="mb-6">
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

        {/* Project Description */}
        <div className="mb-6">
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

        {/* User Assignment Section - Only for new templates */}
        {!isEditing && (
          <div className="mb-6 p-6 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">指派任務對象</h3>
            <p className="text-sm text-gray-600 mb-4">
              💡 選擇要指派此任務的使用者（可多選）。如果不選擇，任務會自動指派給您自己。
            </p>
            
            {selectedUserIds.length > 0 && (
              <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium">
                  已選擇 {selectedUserIds.length} 位使用者（加上您自己共 {selectedUserIds.length + 1} 人）
                </p>
              </div>
            )}

            {isLoadingUsers ? (
              <div className="text-center py-4 text-gray-500">
                載入使用者清單中...
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                目前沒有其他使用者
              </div>
            ) : (
              <>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="搜尋使用者（Email、姓名或職稱）"
                  />
                </div>

                <div className="max-h-60 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-3">
                  {filteredUsers.map(user => (
                    <label
                      key={user.id}
                      className="flex items-center gap-3 p-3 hover:bg-white rounded-lg cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(user.id)}
                        onChange={() => toggleUserSelection(user.id)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {user.job_title || user.full_name || user.email}
                        </div>
                        {user.job_title && user.full_name && (
                          <div className="text-sm text-gray-600">{user.full_name}</div>
                        )}
                        {(user.job_title || user.full_name) && (
                          <div className="text-sm text-gray-500">{user.email}</div>
                        )}
                        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800 mt-1">
                          {user.role === 'admin' ? '管理員' : user.role === 'manager' ? '主管' : '成員'}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>

                {filteredUsers.length === 0 && searchQuery && (
                  <div className="text-center py-4 text-gray-500">
                    找不到符合「{searchQuery}」的使用者
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Steps Section */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">工作流程步驟</h2>
            <button
              onClick={addStep}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={20} />
              新增步驟
            </button>
          </div>

          {steps.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
              <p className="text-gray-500">尚未新增任何步驟，點擊上方按鈕開始建立</p>
            </div>
          ) : (
            <div className="space-y-4">
              {steps.map((step, index) => {
                const stepIdNum = typeof step.id === 'string' ? parseInt(step.id) : step.id;
                const isStepChecked = checkedStepIds.includes(stepIdNum);
                
                return (
                  <div
                    key={step.id}
                    className={`border rounded-lg p-4 ${
                      isStepChecked 
                        ? 'bg-yellow-50 border-yellow-300' 
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    {isStepChecked && (
                      <div className="mb-3 flex items-center gap-2 text-sm text-yellow-800">
                        <Lock size={16} />
                        <span className="font-medium">此步驟已有員工完成記錄</span>
                      </div>
                    )}
                    
                    <div className="flex items-start gap-4">
                      {/* Step Number */}
                      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                        isStepChecked 
                          ? 'bg-yellow-600 text-white' 
                          : 'bg-blue-600 text-white'
                      }`}>
                        {index + 1}
                      </div>

                    {/* Step Content */}
                    <div className="flex-1 space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          步驟名稱 <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={step.label}
                          onChange={(e) => updateStep(index, 'label', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          placeholder="輸入步驟名稱"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          步驟描述
                        </label>
                        <input
                          type="text"
                          value={step.description || ''}
                          onChange={(e) => updateStep(index, 'description', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                          placeholder="輸入步驟描述（選填）"
                        />
                      </div>

                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id={`required-${step.id}`}
                          checked={step.required}
                          onChange={(e) => updateStep(index, 'required', e.target.checked)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <label
                          htmlFor={`required-${step.id}`}
                          className="ml-2 text-sm font-medium text-gray-700 cursor-pointer"
                        >
                          必填步驟
                        </label>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex-shrink-0 flex flex-col gap-2">
                      <button
                        onClick={() => moveStepUp(index)}
                        disabled={index === 0}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="上移"
                      >
                        <ChevronUp size={20} />
                      </button>
                      <button
                        onClick={() => moveStepDown(index)}
                        disabled={index === steps.length - 1}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="下移"
                      >
                        <ChevronDown size={20} />
                      </button>
                      <button
                        onClick={() => removeStep(index)}
                        disabled={hasCompletedAssignments}
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title={hasCompletedAssignments ? "已有完成記錄，無法刪除" : "刪除"}
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>

        {/* Save Button */}
        <div className="flex gap-4">
          <button
            onClick={handleSaveTemplate}
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
