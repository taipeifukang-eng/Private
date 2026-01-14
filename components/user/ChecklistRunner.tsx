'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, ArrowLeft } from 'lucide-react';
import type { Assignment, WorkflowStep } from '@/types/workflow';

interface ChecklistRunnerProps {
  assignment: Assignment & {
    template: {
      title: string;
      steps_schema: WorkflowStep[];
    };
  };
  initialCheckedSteps?: Set<string>;
}

export default function ChecklistRunner({
  assignment,
  initialCheckedSteps = new Set(),
}: ChecklistRunnerProps) {
  const router = useRouter();
  const [checkedSteps, setCheckedSteps] = useState<Set<string>>(initialCheckedSteps);
  const [isLoading, setIsLoading] = useState(false);

  const steps = assignment.template.steps_schema;
  const totalSteps = steps.length;
  const completedSteps = checkedSteps.size;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  // Update assignment status when progress changes
  useEffect(() => {
    const updateStatus = async () => {
      const { updateAssignmentStatus } = await import('@/app/actions');
      
      if (progress === 100 && assignment.status !== 'completed') {
        // All steps completed
        await updateAssignmentStatus(assignment.id, 'completed');
      } else if (progress > 0 && progress < 100 && assignment.status === 'pending') {
        // Started but not completed
        await updateAssignmentStatus(assignment.id, 'in_progress');
      }
    };

    updateStatus();
  }, [progress, assignment.id, assignment.status]);

  // Handle complete and return
  const handleCompleteAndReturn = () => {
    router.push('/my-tasks');
  };

  // Handle checkbox toggle
  const handleToggle = async (stepId: string, isChecked: boolean) => {
    // Optimistic UI update
    const newCheckedSteps = new Set(checkedSteps);
    if (isChecked) {
      newCheckedSteps.add(stepId);
    } else {
      newCheckedSteps.delete(stepId);
    }
    setCheckedSteps(newCheckedSteps);

    // Call Server Action
    try {
      setIsLoading(true);
      const { logAction } = await import('@/app/actions');
      const result = await logAction(
        assignment.id,
        stepId,
        isChecked ? 'checked' : 'unchecked'
      );

      if (!result.success) {
        throw new Error(result.error);
      }
    } catch (error) {
      // Rollback on error
      console.error('Failed to log action:', error);
      setCheckedSteps(checkedSteps);
      alert('操作失敗，請重試');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {assignment.template.title}
          </h1>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-medium">
              {assignment.status === 'pending' && '待處理'}
              {assignment.status === 'in_progress' && '進行中'}
              {assignment.status === 'completed' && '已完成'}
            </span>
            <span>指派日期: {new Date(assignment.created_at).toLocaleDateString('zh-TW')}</span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">完成進度</span>
            <span className="text-sm font-semibold text-blue-600">
              {completedSteps} / {totalSteps} ({Math.round(progress)}%)
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Checklist */}
        <div className="space-y-3">
          {steps.map((step, index) => {
            const isChecked = checkedSteps.has(step.id);
            
            return (
              <div
                key={step.id}
                className={`
                  relative flex items-start gap-4 p-4 rounded-lg border-2 transition-all duration-200
                  ${isChecked 
                    ? 'bg-green-50 border-green-200' 
                    : 'bg-white border-gray-200 hover:border-blue-300'
                  }
                `}
              >
                {/* Step Number Badge */}
                <div
                  className={`
                    flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                    ${isChecked 
                      ? 'bg-green-500 text-white' 
                      : 'bg-gray-200 text-gray-700'
                    }
                  `}
                >
                  {index + 1}
                </div>

                {/* Checkbox and Content */}
                <div className="flex-1 flex items-start gap-3">
                  <button
                    onClick={() => handleToggle(step.id, !isChecked)}
                    disabled={isLoading}
                    className="flex-shrink-0 mt-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-transform hover:scale-110 disabled:opacity-50"
                  >
                    {isChecked ? (
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                    ) : (
                      <Circle className="w-6 h-6 text-gray-400" />
                    )}
                  </button>

                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3
                        className={`
                          text-lg font-medium transition-all
                          ${isChecked 
                            ? 'text-gray-500 line-through' 
                            : 'text-gray-900'
                          }
                        `}
                      >
                        {step.label}
                      </h3>
                      {step.required && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded">
                          必填
                        </span>
                      )}
                    </div>
                    
                    {step.description && (
                      <p
                        className={`
                          mt-1 text-sm transition-all
                          ${isChecked 
                            ? 'text-gray-400 line-through' 
                            : 'text-gray-600'
                          }
                        `}
                      >
                        {step.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Checked Indicator */}
                {isChecked && (
                  <div className="absolute top-2 right-2">
                    <span className="inline-flex items-center px-2 py-1 bg-green-600 text-white text-xs font-semibold rounded">
                      ✓ 已完成
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Summary */}
        {progress === 100 && (
          <div className="mt-8 p-6 bg-gradient-to-r from-green-50 to-blue-50 border-2 border-green-300 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
                <div>
                  <h3 className="text-xl font-bold text-gray-900">恭喜！所有項目已完成</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    您已完成所有檢查清單項目，可以返回任務列表。
                  </p>
                </div>
              </div>
              <button
                onClick={handleCompleteAndReturn}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold whitespace-nowrap"
              >
                完成並返回
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-8 pt-6 border-t border-gray-200 flex gap-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
          >
            <ArrowLeft size={20} />
            返回
          </button>
          
          {progress === 100 && (
            <button
              onClick={handleCompleteAndReturn}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              確認完成並返回任務列表
            </button>
          )}
          
          {progress < 100 && (
            <div className="flex-1 text-center py-3 text-gray-500">
              完成所有步驟後即可提交
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
