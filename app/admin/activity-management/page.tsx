'use client';

import { useEffect, useState } from 'react';
import { Calendar, Plus, Edit2, Trash2, Settings, Clock } from 'lucide-react';
import Link from 'next/link';
import { Campaign } from '@/types/workflow';

export default function ActivityManagementPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  
  // 表單欄位
  const [formData, setFormData] = useState({
    name: '',
    start_date: '',
    end_date: ''
  });

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      if (data.success) {
        setCampaigns(data.campaigns || []);
      }
    } catch (error) {
      console.error('Error loading campaigns:', error);
      alert('載入活動失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.start_date || !formData.end_date) {
      alert('請填寫所有必要欄位');
      return;
    }

    try {
      const url = '/api/campaigns';
      const method = editingCampaign ? 'PUT' : 'POST';
      const body = editingCampaign 
        ? { ...formData, id: editingCampaign.id }
        : formData;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      
      if (data.success) {
        alert(editingCampaign ? '更新成功' : '建立成功');
        setShowCreateModal(false);
        setEditingCampaign(null);
        setFormData({ name: '', start_date: '', end_date: '' });
        loadCampaigns();
      } else {
        alert(data.error || '操作失敗');
      }
    } catch (error) {
      console.error('Error saving campaign:', error);
      alert('操作失敗');
    }
  };

  const handleEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setFormData({
      name: campaign.name,
      start_date: campaign.start_date.split('T')[0],
      end_date: campaign.end_date.split('T')[0]
    });
    setShowCreateModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此活動檔期嗎？所有相關排程也會被刪除。')) {
      return;
    }

    try {
      const res = await fetch(`/api/campaigns?id=${id}`, {
        method: 'DELETE'
      });

      const data = await res.json();
      
      if (data.success) {
        alert('刪除成功');
        loadCampaigns();
      } else {
        alert(data.error || '刪除失敗');
      }
    } catch (error) {
      console.error('Error deleting campaign:', error);
      alert('刪除失敗');
    }
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingCampaign(null);
    setFormData({ name: '', start_date: '', end_date: '' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* 頁面標題 */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">活動管理</h1>
                <p className="text-gray-600 mt-1">管理母親節、週年慶等門市活動排程</p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <Link
                href="/admin/activity-management/settings"
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                門市設定
              </Link>
              <Link
                href="/admin/activity-management/events"
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2"
              >
                <Clock className="w-4 h-4" />
                特殊日期
              </Link>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                新增活動檔期
              </button>
            </div>
          </div>
        </div>

        {/* 活動列表 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {campaigns.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">尚無活動檔期</p>
              <p className="text-gray-400 text-sm mt-2">點擊「新增活動檔期」開始建立</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {campaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="p-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-semibold text-gray-900">
                          {campaign.name}
                        </h3>
                        {campaign.is_active && (
                          <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                            進行中
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                        <span>
                          開始：{new Date(campaign.start_date).toLocaleDateString('zh-TW')}
                        </span>
                        <span>→</span>
                        <span>
                          結束：{new Date(campaign.end_date).toLocaleDateString('zh-TW')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/activity-management/schedule/${campaign.id}`}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        排程管理
                      </Link>
                      <button
                        onClick={() => handleEdit(campaign)}
                        className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                        title="編輯"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDelete(campaign.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="刪除"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 建立/編輯 Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              {editingCampaign ? '編輯活動檔期' : '新增活動檔期'}
            </h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  活動名稱 *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例：2026 母親節活動"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  開始日期 *
                </label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  結束日期 *
                </label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingCampaign ? '更新' : '建立'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
