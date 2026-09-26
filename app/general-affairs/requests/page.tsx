'use client';

import dynamic from 'next/dynamic';

const ServiceRequestIntakeClient = dynamic(
  () => import('@/components/general-affairs/requests/ServiceRequestIntakeClient'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-600">
        載入總務需求工作台...
      </div>
    ),
  }
);

export default function GeneralAffairsRequestsPage() {
  return <ServiceRequestIntakeClient />;
}
