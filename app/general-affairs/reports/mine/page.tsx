'use client';

import dynamic from 'next/dynamic';

const ServiceRequestMyReportsClient = dynamic(
  () => import('@/components/general-affairs/requests/ServiceRequestMyReportsClient'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-600">
        載入我的追蹤...
      </div>
    ),
  }
);

export default function MyGeneralAffairsReportsPage() {
  return <ServiceRequestMyReportsClient />;
}
