import InventoryTransfersClient from '@/components/general-affairs/inventory/InventoryTransfersClient';

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function stringParam(searchParams: PageProps['searchParams'], key: string) {
  const value = searchParams?.[key];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export default function GeneralAffairsInventoryTransfersPage({ searchParams }: PageProps) {
  return (
    <InventoryTransfersClient
      prefill={{
        serviceRequestId: stringParam(searchParams, 'fromRequestId'),
        requestNo: stringParam(searchParams, 'requestNo'),
        partId: stringParam(searchParams, 'partId'),
        quantity: stringParam(searchParams, 'quantity'),
        sourceLocationId: stringParam(searchParams, 'sourceLocationId'),
        destinationStoreId: stringParam(searchParams, 'destinationStoreId'),
        reason: stringParam(searchParams, 'reason'),
        notes: stringParam(searchParams, 'notes'),
      }}
    />
  );
}
