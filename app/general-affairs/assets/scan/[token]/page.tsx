import Link from 'next/link';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AlertCircle, Camera, MapPin, Settings, ShieldCheck, Store, Wrench } from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: { token: string };
};

async function getAsset(token: string) {
  const headerList = headers();
  const host = headerList.get('x-forwarded-host') || headerList.get('host') || '127.0.0.1:3002';
  const protocol = headerList.get('x-forwarded-proto') || (host.includes('127.0.0.1') || host.includes('localhost') ? 'http' : 'https');
  const baseUrl = `${protocol}://${host}`;
  const response = await fetch(`${baseUrl}/api/general-affairs/assets/scan/${token}`, {
    cache: 'no-store',
    headers: {
      cookie: headerList.get('cookie') || '',
    },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.success === false) {
    return { error: json?.error || '資產掃描資料載入失敗', status: response.status, data: null };
  }
  return { error: '', status: response.status, data: json.data };
}

function formatDate(value?: string | null) {
  if (!value) return '未登錄';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-TW');
}

function statusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    ACTIVE: '使用中',
    TEMPORARILY_STOPPED: '暫停使用',
    SPARE: '備品',
    RETIRED: '退役',
    SCRAPPED: '報廢',
    PARTIALLY_DAMAGED: '部分損壞',
    OUT_OF_SERVICE: '停用中',
    UNDER_RENOVATION: '整修中',
  };
  return value ? labels[value] || value : '未登錄';
}

export default async function AssetScanPage({ params }: PageProps) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/general-affairs/assets/scan/${params.token}`)}`);
  }

  const { data, error, status } = await getAsset(params.token);

  if (error || !data) {
    return (
      <main className="mx-auto max-w-3xl p-4 md:p-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-5 w-5" />
            {status === 403 ? '沒有查看權限' : 'QR Code 無法辨識'}
          </div>
          <p className="mt-2 text-sm leading-6">{error}</p>
        </div>
      </main>
    );
  }

  const storeLabel = [data.store?.store_code, data.store?.short_name || data.store?.store_name].filter(Boolean).join(' ') || '未登錄';
  const location = [data.area, data.location_detail].filter(Boolean).join(' / ') || '未登錄';

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <GeneralAffairsPageHeader
        breadcrumbs={[
          { label: '總務服務中心', href: '/general-affairs' },
          { label: '資產 QR 掃描' },
        ]}
        title={data.name}
        description="此頁為 QR Code 穩定掃描入口，顯示現場辨識與維修回報所需資訊。"
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-500">{data.type === 'EQUIPMENT' ? '設備' : '設施'}</div>
                <h1 className="mt-1 text-2xl font-semibold text-slate-950">{data.name}</h1>
                <p className="mt-1 font-mono text-sm text-slate-500">{data.code || '尚未產生編號'}</p>
              </div>
              <span className="rounded bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700">{statusLabel(data.status)}</span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Info icon={<Store className="h-4 w-4" />} label="目前使用門市" value={storeLabel} />
              <Info icon={<MapPin className="h-4 w-4" />} label="位置" value={location} />
              <Info label="分類" value={data.category?.name || '未登錄'} />
              <Info label="品牌 / 型號" value={[data.brand, data.model].filter(Boolean).join(' / ') || '未登錄'} />
              <Info icon={<ShieldCheck className="h-4 w-4" />} label="保固狀態" value={`${data.warranty?.label || '未登錄'}${data.warranty?.end_date ? `，到期日 ${formatDate(data.warranty.end_date)}` : ''}`} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Wrench className="h-4 w-4 text-orange-600" />
              維修紀錄
            </div>
            {data.maintenance_records?.length ? (
              <div className="divide-y divide-slate-100">
                {data.maintenance_records.map((record: any) => (
                  <div key={record.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-slate-900">{record.title}</div>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{record.status || '未登錄'}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">回報日期：{formatDate(record.reported_at || record.updated_at)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">目前沒有維修紀錄</div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {data.photo?.signed_url ? (
              <img src={data.photo.signed_url} alt={data.name} className="aspect-[4/3] w-full object-cover" />
            ) : (
              <div className="grid aspect-[4/3] place-items-center bg-slate-100 text-slate-400">
                <Camera className="h-10 w-10" />
              </div>
            )}
            <div className="p-4">
              {data.repair_request_path ? (
                <Link
                  href={data.repair_request_path}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700"
                >
                  <Wrench className="h-4 w-4" />
                  維修回報
                </Link>
              ) : (
                <div>
                  <button
                    type="button"
                    disabled
                    className="inline-flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md bg-slate-200 px-4 text-sm font-semibold text-slate-500"
                  >
                    <Wrench className="h-4 w-4" />
                    維修回報
                  </button>
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                    目前帳號沒有建立維修回報的權限，請由門市主管或總務協助提出。
                  </p>
                </div>
              )}
              {data.management_path && (
                <Link
                  href={data.management_path}
                  className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Settings className="h-4 w-4" />
                  查看完整主檔
                </Link>
              )}
              <p className="mt-2 text-xs leading-5 text-slate-500">
                維修入口由系統動態導向目前有效流程；未來流程調整時不需要更換 QR Code。
              </p>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function Info({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-1 text-xs font-semibold text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
