'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileText, Calendar, CheckCircle, Clock, AlertCircle, Trash2, MoreVertical } from 'lucide-react';
import type { Template } from '@/types/workflow';

interface TemplateCardWithStatsProps {
  template: Template;
  totalAssignments: number;
  completedAssignments: number;
  inProgressAssignments: number;
  pendingAssignments: number;
}

export default function TemplateCardWithStats({
  template,
  totalAssignments,
  completedAssignments,
  inProgressAssignments,
  pendingAssignments,
}: TemplateCardWithStatsProps) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const stepCount = template.steps_schema?.length || 0;
  const createdDate = new Date(template.created_at).toLocaleDateString('zh-TW');
  const completionRate = totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0;

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

  return (
    <div className="bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow overflow-hidden relative">
      {/* Delete Menu Button */}
      {completedAssignments > 0 && (
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
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-20">
                <button
                  onClick={handleDeleteCompleted}
                  disabled={isDeleting}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  {isDeleting ? '刪除中...' : `刪除 ${completedAssignments} 個已完成任務`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

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
              <span className="text-sm font-medium text-gray-700">任務完成率</span>
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
