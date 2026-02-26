'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, GripVertical, Save, Loader2 } from 'lucide-react';
import { CampaignChecklistItem } from '@/types/workflow';

interface ChecklistTemplateEditorProps {
  campaignId: string;
  canEdit: boolean;
}

export default function ChecklistTemplateEditor({ campaignId, canEdit }: ChecklistTemplateEditorProps) {
  const [items, setItems] = useState<CampaignChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // 載入 checklist 項目
  useEffect(() => {
    loadItems();
  }, [campaignId]);

  const loadItems = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/campaign-checklist-items?campaign_id=${campaignId}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.data || []);
      } else {
        console.error('Failed to load checklist items:', data.error);
      }
    } catch (error) {
      console.error('Error loading checklist items:', error);
    } finally {
      setLoading(false);
    }
  };

  // 新增項目
  const handleAddItem = async () => {
    if (!canEdit) return;

    const newItem: Partial<CampaignChecklistItem> = {
      campaign_id: campaignId,
      task_name: '新項目',
      notes: '',
      assigned_person: '',
      deadline: '',
      item_order: items.length,
    };

    try {
      setSaving(true);
      const res = await fetch('/api/campaign-checklist-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem),
      });
      const data = await res.json();
      if (data.success) {
        setItems([...items, data.data]);
      } else {
        alert(`新增失敗: ${data.error}`);
      }
    } catch (error) {
      console.error('Error adding item:', error);
      alert('新增失敗');
    } finally {
      setSaving(false);
    }
  };

  // 更新項目
  const handleUpdateItem = async (id: string, updates: Partial<CampaignChecklistItem>) => {
    if (!canEdit) return;

    try {
      const res = await fetch('/api/campaign-checklist-items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      });
      const data = await res.json();
      if (data.success) {
        setItems(items.map(item => (item.id === id ? data.data : item)));
      } else {
        alert(`更新失敗: ${data.error}`);
      }
    } catch (error) {
      console.error('Error updating item:', error);
      alert('更新失敗');
    }
  };

  // 刪除項目
  const handleDeleteItem = async (id: string) => {
    if (!canEdit) return;
    if (!confirm('確定要刪除此項目嗎？')) return;

    try {
      setSaving(true);
      const res = await fetch(`/api/campaign-checklist-items?id=${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setItems(items.filter(item => item.id !== id));
      } else {
        alert(`刪除失敗: ${data.error}`);
      }
    } catch (error) {
      console.error('Error deleting item:', error);
      alert('刪除失敗');
    } finally {
      setSaving(false);
    }
  };

  // 拖曳排序
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newItems = [...items];
    const draggedItem = newItems[draggedIndex];
    newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, draggedItem);

    setItems(newItems);
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    // 更新所有項目的 order
    const updatedItems = items.map((item, idx) => ({
      ...item,
      item_order: idx,
    }));

    setItems(updatedItems);
    setDraggedIndex(null);

    // 批次更新順序到後端
    try {
      await Promise.all(
        updatedItems.map(item =>
          fetch('/api/campaign-checklist-items', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, item_order: item.item_order }),
          })
        )
      );
    } catch (error) {
      console.error('Error updating order:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
        <span className="ml-2 text-gray-600">載入中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">活動前置 Check List</h3>
          <p className="text-sm text-gray-600 mt-1">
            店長在活動檢視表點選門市色塊後可查看此清單並逐項打勾確認
          </p>
        </div>
        {canEdit && (
          <button
            onClick={handleAddItem}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            新增項目
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-gray-500">尚無 check list 項目</p>
          {canEdit && (
            <p className="text-sm text-gray-400 mt-2">點擊上方「新增項目」按鈕開始建立</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div
              key={item.id}
              draggable={canEdit}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`bg-white border-2 border-gray-200 rounded-lg p-4 transition-all ${
                canEdit ? 'cursor-move hover:border-purple-300 hover:shadow-md' : ''
              } ${draggedIndex === index ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start gap-3">
                {/* 拖曳手把 */}
                {canEdit && (
                  <div className="flex-shrink-0 mt-1">
                    <GripVertical className="w-5 h-5 text-gray-400" />
                  </div>
                )}

                {/* 序號 */}
                <div className="flex-shrink-0 w-8 h-8 bg-purple-100 text-purple-800 rounded-full flex items-center justify-center font-bold text-sm mt-1">
                  {index + 1}
                </div>

                {/* 內容 */}
                <div className="flex-1 space-y-2">
                  {/* 事項名稱 */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">事項</label>
                    {canEdit ? (
                      <input
                        type="text"
                        value={item.task_name}
                        onChange={(e) =>
                          handleUpdateItem(item.id, { task_name: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        placeholder="事項名稱"
                      />
                    ) : (
                      <div className="font-medium text-gray-900">{item.task_name}</div>
                    )}
                  </div>

                  {/* 備註 */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">備註</label>
                    {canEdit ? (
                      <textarea
                        value={item.notes || ''}
                        onChange={(e) =>
                          handleUpdateItem(item.id, { notes: e.target.value })
                        }
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                        placeholder="詳細說明..."
                      />
                    ) : (
                      <div className="text-sm text-gray-600 whitespace-pre-wrap">
                        {item.notes || '-'}
                      </div>
                    )}
                  </div>

                  {/* 安排人員 & 期限 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">安排人員</label>
                      {canEdit ? (
                        <input
                          type="text"
                          value={item.assigned_person || ''}
                          onChange={(e) =>
                            handleUpdateItem(item.id, { assigned_person: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                          placeholder="如：ALL"
                        />
                      ) : (
                        <div className="text-sm text-gray-600">
                          {item.assigned_person || '-'}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">期限</label>
                      {canEdit ? (
                        <input
                          type="text"
                          value={item.deadline || ''}
                          onChange={(e) =>
                            handleUpdateItem(item.id, { deadline: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                          placeholder="如：前一週"
                        />
                      ) : (
                        <div className="text-sm text-gray-600">{item.deadline || '-'}</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 刪除按鈕 */}
                {canEdit && (
                  <div className="flex-shrink-0">
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="刪除項目"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 提示 */}
      {canEdit && items.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-800">
            💡 <strong>提示：</strong>拖曳項目可調整順序，修改內容後會自動儲存
          </p>
        </div>
      )}
    </div>
  );
}
