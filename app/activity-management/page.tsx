'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Building2, ArrowLeft, Eye } from 'lucide-react';
import Link from 'next/link';
import { Campaign } from '@/types/workflow';

export default function ActivityManagementPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [userRole, setUserRole] = useState<string>('');
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [isStoreManager, setIsStoreManager] = useState(false);

  useEffect(() => {
    loadPublishedCampaigns();
  }, []);

  const loadPublishedCampaigns = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/campaigns/published');
      const data = await res.json();

      if (data.success) {
        setCampaigns(data.data || []);
        setUserRole(data.role || '');
        setIsSupervisor(data.isSupervisor || false);
        setIsStoreManager(data.isStoreManager || false);
      } else {
        console.error('Error loading campaigns:', data.error);
      }
    } catch (error) {
      console.error('Error loading campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const getStatusBadge = (campaign: Campaign) => {
    const now = new Date();
    const start = new Date(campaign.start_date);
    const end = new Date(campaign.end_date);

    if (now < start) {
      return <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">即將開始</span>;
    } else if (now > end) {
      return <span className="px-3 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">已結束</span>;
    } else {
      return <span className="px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">進行中</span>;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/monthly-status"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            返回門市管理
          </Link>
          
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
              <Calendar className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">活動管理</h1>
              <p className="text-gray-600 mt-1">
                查看已發布的活動及排程
                {isSupervisor && isStoreManager && ' (督導與店長)'}
                {isSupervisor && !isStoreManager && ' (督導)'}
                {!isSupervisor && isStoreManager && ' (店長)'}
              </p>
            </div>
          </div>
        </div>

        {/* 活動列表 */}
        {campaigns.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">目前沒有已發布的活動</h3>
            <p className="text-gray-600">當管理員發布活動後，您將可以在此查看活動資訊</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-xl font-bold text-gray-900">{campaign.name}</h2>
                        {getStatusBadge(campaign)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">活動期間：</span>
                      <span className="font-medium text-gray-900">
                        {formatDate(campaign.start_date)} ~ {formatDate(campaign.end_date)}
                      </span>
                    </div>
                  </div>

                  {/* 發布狀態 */}
                  <div className="flex items-center gap-3 mb-4 text-sm">
                    <span className="text-gray-600">發布給：</span>
                    {campaign.published_to_supervisors && (
                      <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800">督導</span>
                    )}
                    {campaign.published_to_store_managers && (
                      <span className="px-2 py-1 text-xs rounded bg-green-100 text-green-800">店長</span>
                    )}
                    {campaign.published_at && (
                      <span className="text-gray-500 text-xs">
                        發布時間：{formatDate(campaign.published_at)}
                      </span>
                    )}
                  </div>

                  {/* 查看按鈕 */}
                  <div className="flex justify-end">
                    <Link
                      href={`/activity-view/${campaign.id}`}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                    >
                      <Eye className="w-4 h-4" />
                      查看排程
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
