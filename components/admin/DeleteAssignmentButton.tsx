'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

interface DeleteAssignmentButtonProps {
  assignmentId: string;
  assignmentTitle: string;
  isCompleted: boolean;
}

export default function DeleteAssignmentButton({
  assignmentId,
  assignmentTitle,
  isCompleted,
}: DeleteAssignmentButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!isCompleted) {
      alert('只能刪除已完成的任務');
      return;
    }

    const confirmed = confirm(
      `確定要刪除任務「${assignmentTitle}」嗎？\n\n此操作無法復原，將會刪除任務相關的所有記錄。`
    );

    if (!confirmed) return;

    setIsDeleting(true);

    try {
      const { deleteAssignment } = await import('@/app/actions');
      const result = await deleteAssignment(assignmentId);

      if (result.success) {
        alert('✅ 任務已成功刪除');
        // Reload the page to refresh the data
        window.location.reload();
      } else {
        alert(`❌ 刪除失敗：${result.error}`);
      }
    } catch (error) {
      console.error('Error deleting assignment:', error);
      alert('❌ 發生錯誤，請稍後再試');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isCompleted) {
    return null; // Don't show delete button for non-completed tasks
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isDeleting}
      className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 transition-colors whitespace-nowrap"
      title="刪除已完成的任務"
    >
      <Trash2 size={16} />
      {isDeleting ? '刪除中...' : '刪除'}
    </button>
  );
}
