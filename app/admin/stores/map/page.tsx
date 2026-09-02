import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, MapPinned } from 'lucide-react';
import StoreGoogleMapClient from '@/components/admin/StoreGoogleMapClient';
import { hasAnyPermission } from '@/lib/permissions/check';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function StoreGoogleMapPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const canViewStores = await hasAnyPermission(user.id, ['store.store.view', 'store.store.view_inactive', 'store.manage']);
  if (!canViewStores) {
    redirect('/dashboard');
  }

  const { data: stores } = await supabase
    .from('stores')
    .select('id, store_code, store_name, short_name, address, phone, is_active, gps_latitude, gps_longitude')
    .order('store_code');

  const googleMapsApiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    '';

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/stores"
              className="rounded-lg p-2 transition-colors hover:bg-gray-200"
              title="返回門市管理"
            >
              <ChevronLeft size={24} />
            </Link>
            <div>
              <h1 className="flex items-center gap-3 text-3xl font-bold text-gray-900">
                <MapPinned className="text-blue-600" size={34} />
                Google 地圖
              </h1>
              <p className="mt-1 text-gray-600">查看已設定 GPS 的門市位置標示</p>
            </div>
          </div>
          <Link
            href="/admin/stores"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            返回門市管理
          </Link>
        </div>

        <StoreGoogleMapClient
          stores={(stores || []) as any}
          googleMapsApiKey={googleMapsApiKey}
        />
      </div>
    </div>
  );
}
