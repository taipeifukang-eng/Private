'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileText, Calendar, CheckCircle, Clock, AlertCircle, Trash2, MoreVertical, Edit, Archive, Copy } from 'lucide-react';
import type { Template } from '@/types/workflow';

interface TemplateCardWithStatsProps {
  template: Template;
  assignments: any[];
}

export default function TemplateCardWithStats({
  template,
  assignments,
}: TemplateCardWithStatsProps) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const stepCount = template.steps_schema?.length || 0;
  const createdDate = new Date(template.created_at).toLocaleDateString('zh-TW');
  
  // Calculate statistics
  const totalAssignments = assignments.length;
  const completedAssignments = assignments.filter(a => a.status === 'completed').length;
  const inProgressAssignments = assignments.filter(a => a.status === 'in_progress').length;
  const pendingAssignments = assignments.filter(a => a.status === 'pending').length;
  
  // Calculate average step completion progress across all assignments
  const calculateProgress = () => {
    if (totalAssignments === 0) return 0;
    
    const totalProgress = assignments.reduce((sum, assignment) => {
      const steps = template.steps_schema || [];
      const totalSteps = steps.reduce((count, step) => count + 1 + (step.subSteps?.length || 0), 0);
      
      if (totalSteps === 0) return sum;
      
      const logs = assignment.logs || [];
      const checkedSteps = new Set<string>();
      
      logs.forEach((log: any) => {
        if (log.step_id !== null && log.step_id !== undefined) {
          const stepIdStr = log.step_id.toString();
          if (log.action === 'complete') {
            checkedSteps.add(stepIdStr);
          } else if (log.action === 'uncomplete') {
            checkedSteps.delete(stepIdStr);
          }
        }
      });
      
      const progress = (checkedSteps.size / totalSteps) * 100;
      return sum + progress;
    }, 0);
    
    return Math.round(totalProgress / totalAssignments);
  };
  
  const completionRate = calculateProgress();

  const handleDeleteCompleted = async () => {
    console.log('[TemplateCardWithStats] handleDeleteCompleted called');
    console.log('[TemplateCardWithStats] completedAssignments:', completedAssignments);
    
    if (completedAssignments === 0) {
      alert('沒有已完成的任務可以刪除');
      return;
    }

    const confirmed = confirm(
      `確定要刪除「${template.title}」的所有已完成任務嗎？\n\n將刪除 ${completedAssignments} 個已完成任務，此操作無法復原。`
    );

    if (!confirmed) {
      console.log('[TemplateCardWithStats] Delete cancelled by user');
      return;
    }

    setIsDeleting(true);
    setShowMenu(false);
    console.log('[TemplateCardWithStats] Starting delete process...');

    try {
      const { getAssignments, deleteAssignment } = await import('@/app/actions');
      console.log('[TemplateCardWithStats] Actions imported successfully');
      
      const result = await getAssignments();
      console.log('[TemplateCardWithStats] getAssignments result:', result);
      
      if (result.success) {
        const assignments = result.data.filter(
          (a: any) => a.template_id === template.id && a.status === 'completed'
        );
        console.log('[TemplateCardWithStats] Found completed assignments:', assignments.length);

        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        for (const assignment of assignments) {
          console.log('[TemplateCardWithStats] Deleting assignment:', assignment.id);
          const deleteResult = await deleteAssignment(assignment.id);
          console.log('[TemplateCardWithStats] Delete result:', deleteResult);
          
          if (deleteResult.success) {
            successCount++;
          } else {
            failCount++;
            errors.push(`${assignment.id}: ${deleteResult.error}`);
          }
        }

        console.log('[TemplateCardWithStats] Delete complete:', { successCount, failCount });

        if (failCount === 0) {
          alert(`✅ 成功刪除 ${successCount} 個已完成任務`);
          // Use router.refresh() to revalidate the page data
          router.refresh();
        } else {
          console.error('[TemplateCardWithStats] Delete errors:', errors);
          alert(`⚠️ 成功刪除 ${successCount} 個任務，${failCount} 個失敗\n\n錯誤詳情：\n${errors.join('\n')}`);
          // Still refresh to show any successful deletions
          router.refresh();
        }
      } else {
        console.error('[TemplateCardWithStats] Failed to get assignments:', result.error);
        alert(`❌ 無法獲取任務列表: ${result.error}`);
      }
    } catch (error) {
      console.error('[TemplateCardWithStats] Error deleting assignments:', error);
      alert(`❌ 刪除失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    } finally {
      setIsDeleting(false);
      console.log('[TemplateCardWithStats] Delete process ended');
    }
  };

  const handleDeleteTemplate = async () => {
    console.log('[TemplateCardWithStats] handleDeleteTemplate called');
    
    const confirmed = confirm(
      `⚠️ 確定要刪除流程模板「${template.title}」嗎？\n\n` +
      `這將永久刪除：\n` +
      `• 此流程模板\n` +
      `• 所有相關的任務（包括進行中和已完成的任務）\n` +
      `• 所有任務記錄\n\n` +
      `此操作無法復原！`
    );

    if (!confirmed) {
      console.log('[TemplateCardWithStats] Delete template cancelled by user');
      return;
    }

    setIsDeleting(true);
    setShowMenu(false);
    console.log('[TemplateCardWithStats] Deleting template:', template.id);

    try {
      const { deleteTemplate } = await import('@/app/actions');
      console.log('[TemplateCardWithStats] Action imported successfully');
      
      const result = await deleteTemplate(template.id);
      console.log('[TemplateCardWithStats] Delete template result:', result);
      
      if (result.success) {
        alert('✅ 流程模板已成功刪除');
        router.refresh();
      } else {
        console.error('[TemplateCardWithStats] Delete template failed:', result.error);
        alert(`❌ 刪除失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('[TemplateCardWithStats] Error deleting template:', error);
      alert(`❌ 刪除失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    } finally {
      setIsDeleting(false);
      console.log('[TemplateCardWithStats] Delete template process ended');
    }
  };

  const handleArchiveCompleted = async () => {
    console.log('[TemplateCardWithStats] handleArchiveCompleted called');
    
    if (totalAssignments === 0) {
      alert('沒有任務可以封存');
      return;
    }
    
    if (completionRate < 100) {
      alert('只有當所有任務步驟都完成（進度100%）時才能封存');
      return;
    }

    const confirmed = confirm(
      `確定要封存「${template.title}」的所有任務嗎？\n\n` +
      `將封存 ${completedAssignments} 個已完成任務。\n` +
      `封存後將自動刪除此流程模板。\n` +
      `封存的任務可以在歷史記錄中查看。`
    );

    if (!confirmed) {
      console.log('[TemplateCardWithStats] Archive cancelled by user');
      return;
    }

    setIsDeleting(true);
    setShowMenu(false);
    console.log('[TemplateCardWithStats] Starting archive process...');

    try {
      const { getAssignments, archiveAssignment, deleteTemplate } = await import('@/app/actions');
      console.log('[TemplateCardWithStats] Actions imported successfully');
      
      const result = await getAssignments();
      console.log('[TemplateCardWithStats] getAssignments result:', result);
      
      if (result.success) {
        const assignments = result.data.filter(
          (a: any) => a.template_id === template.id && a.status === 'completed' && !a.archived
        );
        console.log('[TemplateCardWithStats] Found completed assignments to archive:', assignments.length);

        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        for (const assignment of assignments) {
          console.log('[TemplateCardWithStats] Archiving assignment:', assignment.id);
          const archiveResult = await archiveAssignment(assignment.id);
          console.log('[TemplateCardWithStats] Archive result:', archiveResult);
          
          if (archiveResult.success) {
            successCount++;
          } else {
            failCount++;
            errors.push(`${assignment.id}: ${archiveResult.error}`);
          }
        }

        console.log('[TemplateCardWithStats] Archive complete:', { successCount, failCount });

        if (failCount === 0) {
          // All assignments archived successfully
          // Template is NOT deleted - archived assignments will be hidden from task management
          // but visible in archived tasks page
          console.log('[TemplateCardWithStats] All assignments archived successfully');
          alert(`✅ 成功封存 ${successCount} 個已完成任務`);
          router.refresh();
        } else {
          console.error('[TemplateCardWithStats] Archive errors:', errors);
          alert(`⚠️ 成功封存 ${successCount} 個任務，${failCount} 個失敗\n\n錯誤詳情：\n${errors.join('\n')}`);
          router.refresh();
        }
      } else {
        console.error('[TemplateCardWithStats] Failed to get assignments:', result.error);
        alert(`❌ 無法獲取任務列表: ${result.error}`);
      }
    } catch (error) {
      console.error('[TemplateCardWithStats] Error archiving assignments:', error);
      alert(`❌ 封存失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    } finally {
      setIsDeleting(false);
      console.log('[TemplateCardWithStats] Archive process ended');
    }
  };

  const handleDuplicate = async () => {
    console.log('[TemplateCardWithStats] handleDuplicate called');
    
    const newTitle = prompt(
      `複製流程模板「${template.title}」\n\n請輸入新的標題（留空將自動命名為「${template.title} (副本)」）：`,
      ''
    );

    // 用戶取消
    if (newTitle === null) {
      console.log('[TemplateCardWithStats] Duplicate cancelled by user');
      return;
    }

    setIsDeleting(true);
    setShowMenu(false);
    console.log('[TemplateCardWithStats] Duplicating template:', template.id);

    try {
      const { duplicateTemplate } = await import('@/app/actions');
      console.log('[TemplateCardWithStats] Action imported successfully');
      
      const result = await duplicateTemplate(template.id, newTitle.trim() || undefined);
      console.log('[TemplateCardWithStats] Duplicate result:', result);
      
      if (result.success) {
        alert(`✅ 成功複製流程模板：${result.data?.title}`);
        router.refresh();
      } else {
        console.error('[TemplateCardWithStats] Duplicate failed:', result.error);
        alert(`❌ 複製失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('[TemplateCardWithStats] Error duplicating template:', error);
      alert(`❌ 複製失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    } finally {
      setIsDeleting(false);
      console.log('[TemplateCardWithStats] Duplicate process ended');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow overflow-hidden relative">
      {/* Menu Button - Always visible */}
      <div className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          title="更多選項"
        >
          <MoreVertical size={20} className="text-gray-600" />
        </button>
        
        {showMenu && (
          <>
            <div
              className="fixed inset-0"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-20">
              <Link
                href={`/admin/edit/${template.id}`}
                className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2"
              >
                <Edit size={16} />
                編輯任務
              </Link>
              <div className="border-t border-gray-200 my-1"></div>
              <button
                onClick={handleDuplicate}
                disabled={isDeleting}
                className="w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-green-50 flex items-center gap-2 disabled:opacity-50"
              >
                <Copy size={16} />
                {isDeleting ? '複製中...' : '複製流程模板'}
              </button>
              {totalAssignments > 0 && completionRate === 100 && (
                <>
                  <div className="border-t border-gray-200 my-1"></div>
                  <button
                    onClick={handleArchiveCompleted}
                    disabled={isDeleting}
                    className="w-full text-left px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 flex items-center gap-2 disabled:opacity-50"
                  >
                    <Archive size={16} />
                    {isDeleting ? '封存中...' : `完成並封存 (${totalAssignments} 個任務)`}
                  </button>
                </>
              )}
              {completionRate === 100 && totalAssignments > 0 && (
                <>
                  <div className="border-t border-gray-200 my-1"></div>
                  <button
                    onClick={handleDeleteCompleted}
                    disabled={isDeleting}
                    className="w-full text-left px-4 py-2 text-sm text-orange-600 hover:bg-orange-50 flex items-center gap-2 disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                    {isDeleting ? '刪除中...' : `刪除 ${totalAssignments} 個已完成任務`}
                  </button>
                </>
              )}
              <div className="border-t border-gray-200 my-1"></div>
              <button
                onClick={handleDeleteTemplate}
                disabled={isDeleting}
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-50 font-medium"
              >
                <Trash2 size={16} />
                {isDeleting ? '刪除中...' : '刪除整個流程模板'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4 pr-8">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-2 line-clamp-2">
              {template.title}
            </h3>
            {template.description && (
              <p className="text-sm text-gray-600 line-clamp-2">
                {template.description}
              </p>
            )}
          </div>
        </div>

        {/* Template Stats */}
        <div className="flex items-center gap-4 mb-4 text-sm text-gray-600">
          <div className="flex items-center gap-1">
            <FileText size={16} />
            <span>{stepCount} 個步驟</span>
          </div>
          <div className="flex items-center gap-1">
            <Calendar size={16} />
            <span>{createdDate}</span>
          </div>
        </div>

        {/* Assignment Statistics */}
        {totalAssignments > 0 && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">完成進度</span>
              <span className="text-sm font-bold text-blue-600">{completionRate}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{ width: `${completionRate}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="flex items-center gap-1 text-gray-600">
                <AlertCircle size={14} />
                <span>{pendingAssignments} 待處理</span>
              </div>
              <div className="flex items-center gap-1 text-blue-600">
                <Clock size={14} />
                <span>{inProgressAssignments} 進行中</span>
              </div>
              <div className="flex items-center gap-1 text-green-600">
                <CheckCircle size={14} />
                <span>{completedAssignments} 已完成</span>
              </div>
            </div>
          </div>
        )}

        {totalAssignments === 0 && (
          <div className="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
            <p className="text-sm text-yellow-800">尚未指派任何任務</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t border-gray-200">
          <Link
            href={`/admin/assign/${template.id}`}
            className="flex-1 text-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium text-sm"
          >
            指派任務
          </Link>
          <Link
            href={`/admin/template/${template.id}`}
            className="flex-1 text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
          >
            查看詳情
          </Link>
        </div>
      </div>
    </div>
  );
}
