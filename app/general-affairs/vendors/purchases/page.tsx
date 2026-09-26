'use client';

import dynamic from 'next/dynamic';

const GeneralAffairsServiceCenterClient = dynamic(
  () => import('@/components/general-affairs/service-center/GeneralAffairsServiceCenterClient'),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-600">
        載入採購分析...
      </div>
    ),
  },
);

export default function GeneralAffairsVendorPurchasesPage() {
  return (
    <GeneralAffairsServiceCenterClient
      initialView={{ section: 'vendors', vendorView: 'purchases' }}
    />
  );
}
