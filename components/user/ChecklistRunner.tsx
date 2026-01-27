'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, ArrowLeft, Users, Building, CornerDownRight } from 'lucide-react';
import type { Assignment, WorkflowStep, Profile } from '@/types/workflow';

interface ChecklistRunnerProps {
  assignment: Assignment & {
    template: {
      title: string;
      steps_schema: WorkflowStep[];
      userSection?: {
        id: string;
        department: string;
      };
    };
    collaborators?: Profile[];
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
  const [mounted, setMounted] = useState(false);
  const isProcessingRef = useRef(false);
  const pendingActionsRef = useRef<Array<{ stepId: string; action: 'checked' | 'unchecked' }>>([]);

  const steps = assignment.template.steps_schema;
  
  // Calculate total steps including sub-steps
  const totalSteps = steps.reduce((count, step) => {
    return count + 1 + (step.subSteps?.length || 0);
  }, 0);
  const completedSteps = checkedSteps.size;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  // Handle hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-refresh every 30 seconds to sync with other collaborators (increased interval)
  useEffect(() => {
    const refreshInterval = setInterval(async () => {
      // Skip refresh if there's an ongoing operation
      if (isLoading || isProcessingRef.current) {
        return;
      }

      try {
        const { getAssignment } = await import('@/app/actions');
        const result = await getAssignment(assignment.id);
        
        if (result.success && result.data) {
          const newCheckedSteps = new Set<string>();
          const logs = result.data.logs || [];
          
          // Sort logs by created_at to ensure correct order
          const sortedLogs = [...logs].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          
          sortedLogs.forEach((log: any) => {
            if (log.step_id !== null && log.step_id !== undefined) {
              const stepIdStr = log.step_id.toString();
              if (log.action === 'complete') {
                newCheckedSteps.add(stepIdStr);
              } else if (log.action === 'uncomplete') {
                newCheckedSteps.delete(stepIdStr);
              }
            }
          });
          
          setCheckedSteps(newCheckedSteps);
        }
      } catch (error) {
        console.error('[ChecklistRunner] Failed to refresh assignment:', error);
      }
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(refreshInterval);
  }, [assignment.id, isLoading]);

  // Update assignment status when progress changes
  useEffect(() => {
    const updateStatus = async () => {
      // Wait for any pending actions to complete
      if (isProcessingRef.current || pendingActionsRef.current.length > 0) {
        return;
      }
      
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

  // Handle complete and return - wait for all pending actions
  const handleCompleteAndReturn = async () => {
    // If there are pending actions, wait for them to complete
    if (isProcessingRef.current || pendingActionsRef.current.length > 0) {
      setIsLoading(true);
      
      // Wait for processing to complete
      let attempts = 0;
      while ((isProcessingRef.current || pendingActionsRef.current.length > 0) && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      
      // Force process any remaining actions
      if (pendingActionsRef.current.length > 0) {
        const actionsToProcess = [...pendingActionsRef.current];
        pendingActionsRef.current = [];
        
        try {
          const { logAction } = await import('@/app/actions');
          for (const { stepId: sid, action } of actionsToProcess) {
            await logAction(assignment.id, sid, action);
          }
        } catch (error) {
          console.error('[ChecklistRunner] Failed to process remaining actions:', error);
        }
      }
      
      // Update status to completed if progress is 100%
      if (progress === 100) {
        try {
          const { updateAssignmentStatus } = await import('@/app/actions');
          await updateAssignmentStatus(assignment.id, 'completed');
        } catch (error) {
          console.error('[ChecklistRunner] Failed to update status:', error);
        }
      }
      
      setIsLoading(false);
    }
    
    router.push('/my-tasks');
  };

  // Handle checkbox toggle with parent-child sync
  const handleToggle = async (stepId: string, isChecked: boolean) => {
    // Prevent rapid clicking
    if (isProcessingRef.current) {
      return;
    }
    
    // Find if this is a main step or sub-step
    let mainStep: WorkflowStep | null = null;
    let isSubStep = false;
    let parentStepId: string | null = null;
    
    for (const step of steps) {
      if (step.id === stepId) {
        mainStep = step;
        break;
      }
      if (step.subSteps?.some(sub => sub.id === stepId)) {
        mainStep = step;
        isSubStep = true;
        parentStepId = step.id;
        break;
      }
    }

    // Optimistic UI update with parent-child logic
    const newCheckedSteps = new Set(checkedSteps);
    const stepsToLog: Array<{ stepId: string; action: 'checked' | 'unchecked' }> = [];

    if (isSubStep && parentStepId && mainStep) {
      // Toggling a sub-step
      if (isChecked) {
        newCheckedSteps.add(stepId);
        stepsToLog.push({ stepId, action: 'checked' });
        
        // Check if all sub-steps are now checked
        const allSubStepsChecked = mainStep.subSteps?.every(sub => 
          sub.id === stepId || newCheckedSteps.has(sub.id)
        );
        
        if (allSubStepsChecked && !newCheckedSteps.has(parentStepId)) {
          newCheckedSteps.add(parentStepId);
          stepsToLog.push({ stepId: parentStepId, action: 'checked' });
        }
      } else {
        newCheckedSteps.delete(stepId);
        stepsToLog.push({ stepId, action: 'unchecked' });
        
        // Uncheck parent step if it was checked
        if (newCheckedSteps.has(parentStepId)) {
          newCheckedSteps.delete(parentStepId);
          stepsToLog.push({ stepId: parentStepId, action: 'unchecked' });
        }
      }
    } else if (mainStep && mainStep.subSteps && mainStep.subSteps.length > 0) {
      // Toggling a main step that has sub-steps
      if (isChecked) {
        // Check main step and all sub-steps
        newCheckedSteps.add(stepId);
        stepsToLog.push({ stepId, action: 'checked' });
        
        mainStep.subSteps.forEach(subStep => {
          if (!newCheckedSteps.has(subStep.id)) {
            newCheckedSteps.add(subStep.id);
            stepsToLog.push({ stepId: subStep.id, action: 'checked' });
          }
        });
      } else {
        // Uncheck main step and all sub-steps
        newCheckedSteps.delete(stepId);
        stepsToLog.push({ stepId, action: 'unchecked' });
        
        mainStep.subSteps.forEach(subStep => {
          if (newCheckedSteps.has(subStep.id)) {
            newCheckedSteps.delete(subStep.id);
            stepsToLog.push({ stepId: subStep.id, action: 'unchecked' });
          }
        });
      }
    } else {
      // Normal step without sub-steps
      if (isChecked) {
        newCheckedSteps.add(stepId);
      } else {
        newCheckedSteps.delete(stepId);
      }
      stepsToLog.push({ stepId, action: isChecked ? 'checked' : 'unchecked' });
    }

    // Update UI immediately
    setCheckedSteps(newCheckedSteps);

    // Queue actions for batch processing
    pendingActionsRef.current.push(...stepsToLog);
    
    // Process actions with debouncing
    if (!isProcessingRef.current) {
      isProcessingRef.current = true;
      
      // Wait a bit to collect more actions if user is clicking rapidly
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Process all pending actions
      const actionsToProcess = [...pendingActionsRef.current];
      pendingActionsRef.current = [];
      
      try {
        const { logAction } = await import('@/app/actions');
        
        // Process actions sequentially to maintain order
        for (const { stepId: sid, action } of actionsToProcess) {
          await logAction(assignment.id, sid, action);
        }
      } catch (error) {
        console.error('[ChecklistRunner] Failed to log actions:', error);
        // Revert on error
        setCheckedSteps(checkedSteps);
        alert('操作失敗，請重試');
      } finally {
        isProcessingRef.current = false;
      }
    }
  };

  return (
    <div className="w-full p-6 lg:p-8">
      <div className="bg-white rounded-lg shadow-lg p-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {assignment.template.title}
          </h1>
          <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
            <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-medium">
              {assignment.status === 'pending' && '待處理'}
              {assignment.status === 'in_progress' && '進行中'}
              {assignment.status === 'completed' && '已完成'}
            </span>
            <span>指派日期: {mounted ? new Date(assignment.created_at).toLocaleDateString('zh-TW', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            }) : '-'}</span>
            
            {/* User's Department Section */}
            {assignment.template.userSection && (
              <div className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-800 rounded-full">
                <Building size={16} />
                <span className="font-medium">
                  {assignment.template.userSection.department}
                </span>
              </div>
            )}
            
            {/* Collaborators Info */}
            {assignment.collaborators && assignment.collaborators.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1 bg-purple-100 text-purple-800 rounded-full">
                <Users size={16} />
                <span className="font-medium">
                  協作中 ({assignment.collaborators.length}人)
                </span>
              </div>
            )}
          </div>
          
          {/* Collaborators List */}
          {assignment.collaborators && assignment.collaborators.length > 1 && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-600 mb-2">協作成員：</p>
              <div className="flex flex-wrap gap-2">
                {assignment.collaborators.map((collaborator) => (
                  <span
                    key={collaborator.id}
                    className="px-2 py-1 bg-white border border-gray-300 rounded text-sm text-gray-700"
                  >
                    {collaborator.full_name || collaborator.email}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              {assignment.template.userSection ? `${assignment.template.userSection.department} 進度` : '完成進度'}
            </span>
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
                    className="flex-shrink-0 mt-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-transform hover:scale-110"
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

                    {/* Sub-steps */}
                    {step.subSteps && step.subSteps.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {step.subSteps.map((subStep) => {
                          const isSubChecked = checkedSteps.has(subStep.id);
                          return (
                            <div
                              key={subStep.id}
                              className={`
                                flex items-start gap-2 p-2 rounded-lg transition-all
                                ${isSubChecked ? 'bg-green-100' : 'bg-gray-50'}
                              `}
                            >
                              <CornerDownRight size={14} className="text-gray-400 mt-1 flex-shrink-0" />
                              <button
                                onClick={() => handleToggle(subStep.id, !isSubChecked)}
                                className="flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded transition-transform hover:scale-110"
                              >
                                {isSubChecked ? (
                                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                                ) : (
                                  <Circle className="w-5 h-5 text-gray-400" />
                                )}
                              </button>
                              <div className="flex-1 flex items-center gap-2">
                                <span
                                  className={`
                                    text-sm transition-all
                                    ${isSubChecked ? 'text-gray-500 line-through' : 'text-gray-700'}
                                  `}
                                >
                                  {subStep.label}
                                </span>
                                {subStep.required && (
                                  <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded">
                                    必填
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
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
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
              <div>
                <h3 className="text-xl font-bold text-gray-900">恭喜！所有項目已完成</h3>
                <p className="text-sm text-gray-600 mt-1">
                  您已完成所有檢查清單項目，可以返回任務列表。
                </p>
              </div>
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
              disabled={isLoading}
              className={`flex-1 px-6 py-3 text-white rounded-lg transition-colors font-semibold ${
                isLoading 
                  ? 'bg-gray-400 cursor-not-allowed' 
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {isLoading ? '儲存中...' : '確認完成並返回任務列表'}
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
