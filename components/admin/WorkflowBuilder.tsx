'use client';

import { useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Save } from 'lucide-react';
import type { WorkflowStep } from '@/types/workflow';

export default function WorkflowBuilder() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([]);

  // Add a new step
  const addStep = () => {
    const newStep: WorkflowStep = {
      id: crypto.randomUUID(),
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

    try {
      const { createTemplate } = await import('@/app/actions');
      
      console.log('正在儲存流程...', {
        title: title.trim(),
        description: description.trim(),
        steps_count: steps.length,
      });
      
      const result = await createTemplate({
        title: title.trim(),
        description: description.trim(),
        steps_schema: steps,
      });

      console.log('Server Action 回應:', result);

      if (result.success) {
        alert('✅ 流程儲存成功！');
        // Reset form
        setTitle('');
        setDescription('');
        setSteps([]);
        // Redirect to templates page
        window.location.href = '/admin/templates';
      } else {
        console.error('儲存失敗:', result.error);
        alert(`❌ 儲存失敗：${result.error}`);
      }
    } catch (error) {
      console.error('發生錯誤:', error);
      alert(`❌ 發生錯誤：${error instanceof Error ? error.message : '請稍後再試'}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">建立新任務</h1>

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
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className="bg-gray-50 border border-gray-200 rounded-lg p-4"
                >
                  <div className="flex items-start gap-4">
                    {/* Step Number */}
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold">
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
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="刪除"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-6 border-t border-gray-200">
          <button
            onClick={handleSaveTemplate}
            className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold"
          >
            <Save size={20} />
            儲存流程
          </button>
        </div>
      </div>
    </div>
  );
}
