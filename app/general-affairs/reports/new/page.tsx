'use client';

import dynamic from 'next/dynamic';

const ServiceRequestCreateClient = dynamic(
  () => import('@/components/general-affairs/requests/ServiceRequestCreateClient'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-600">
        載入新增需求...
      </div>
    ),
  }
);

export default function NewGeneralAffairsReportPage() {
  return <ServiceRequestCreateClient />;
}
