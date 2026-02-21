'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function DeleteInspectionButton({ inspectionId }: { inspectionId: string }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/inspection/${inspectionId}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (!res.ok) {
        alert(`刪除失敗: ${data.error}`);
        setIsDeleting(false);
        return;
      }

      alert('巡店記錄已成功刪除');
      router.push('/inspection');
      router.refresh();
    } catch (err: any) {
      alert(`刪除失敗: ${err.message}`);
      setIsDeleting(false);
    }
  };

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-red-600 font-medium">確定刪除？</span>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {isDeleting ? '刪除中...' : '確定'}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          disabled={isDeleting}
          className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 disabled:opacity-50 transition-colors"
        >
          取消
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
    >
      <Trash2 size={18} />
      刪除
    </button>
  );
}
