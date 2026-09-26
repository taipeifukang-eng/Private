'use client';

import dynamic from 'next/dynamic';

const PartFulfillmentCenterClient = dynamic(
  () => import('@/components/general-affairs/parts/PartFulfillmentCenterClient'),
  { ssr: false, loading: () => <div className="p-6 text-sm text-slate-500">載入料件處理中心...</div> },
);

export default function PartFulfillmentCenterPage() {
  return <PartFulfillmentCenterClient />;
}
