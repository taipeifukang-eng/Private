'use client';

import dynamic from 'next/dynamic';

const GeneralAffairsServiceCenterClient = dynamic(
  () => import('@/components/general-affairs/dashboard/GeneralAffairsHomeClient'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-600">
        載入總務服務中心...
      </div>
    ),
  }
);

export default function GeneralAffairsPage() {
  return <GeneralAffairsServiceCenterClient />;
}
