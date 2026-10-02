'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { AlertCircle, ArrowLeft, Loader2, Printer, RefreshCw } from 'lucide-react';
import GeneralAffairsPageHeader from '@/components/general-affairs/GeneralAffairsPageHeader';
import { GeneralAffairsListPage } from '@/components/general-affairs/GeneralAffairsPageTemplates';

type StoreOption = {
  id: string;
  store_code: string;
  store_name: string;
  short_name?: string | null;
};

type EquipmentLabelItem = {
  id: string;
  name: string;
  asset_code: string | null;
  brand: string | null;
  model: string | null;
  qr_token?: string | null;
  qr_scan_path?: string | null;
  store?: StoreOption | null;
};

type PrintableLabel = EquipmentLabelItem & {
  qr_url: string;
  qr_data_url: string;
};

async function parseResponse(response: Response, fallback: string) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    const message = String(json.error || fallback);
    if (
      message.toLowerCase().includes('ga_equipment.qr_token')
      && (message.toLowerCase().includes('does not exist') || message.toLowerCase().includes('schema cache'))
    ) {
      throw new Error('設備 QR 功能尚未完成資料庫設定，請先執行 QR 欄位修復 SQL 後再列印。');
    }
    throw new Error(message);
  }
  return json;
}

function uniqueIds(value: string | null) {
  return Array.from(new Set((value || '').split(',').map((item) => item.trim()).filter(Boolean)));
}

function equipmentQrPath(item: EquipmentLabelItem) {
  if (item.qr_scan_path) return item.qr_scan_path;
  if (item.qr_token) return `/general-affairs/assets/scan/${item.qr_token}`;
  return '';
}

function printCode(item: EquipmentLabelItem) {
  return item.asset_code || '尚未設定設備編號';
}

function hasAssetCode(item: EquipmentLabelItem) {
  return Boolean(item.asset_code?.trim());
}

export default function EquipmentQrLabelsClient() {
  const searchParams = useSearchParams();
  const [labels, setLabels] = useState<PrintableLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const sourceDescription = useMemo(() => {
    const ids = uniqueIds(searchParams.get('ids'));
    if (ids.length === 1) return '單台設備標籤';
    if (ids.length > 1) return `${ids.length} 台指定設備標籤`;
    return '目前設備列表篩選結果';
  }, [searchParams]);

  const missingAssetCodeCount = useMemo(
    () => labels.filter((item) => !hasAssetCode(item)).length,
    [labels],
  );

  const loadLabels = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const ids = uniqueIds(searchParams.get('ids'));
      const origin = window.location.origin;
      let records: EquipmentLabelItem[] = [];

      if (ids.length > 0) {
        const results = await Promise.all(
          ids.map(async (id) => {
            const json = await parseResponse(await fetch(`/api/general-affairs/equipment/${encodeURIComponent(id)}`), '設備資料載入失敗');
            return json.data as EquipmentLabelItem;
          }),
        );
        records = results;
      } else {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('ids');
        params.set('pageSize', '100');
        params.set('sortBy', params.get('sortBy') || 'updated_at');
        params.set('sortDir', params.get('sortDir') || 'desc');
        params.set('page', '1');
        const firstPage = await parseResponse(await fetch(`/api/general-affairs/equipment?${params.toString()}`), '設備資料載入失敗');
        records = (firstPage.data || []) as EquipmentLabelItem[];

        const totalPages = Math.max(1, Number(firstPage.meta?.totalPages || 1));
        if (totalPages > 1) {
          const rest = await Promise.all(
            Array.from({ length: totalPages - 1 }, async (_, index) => {
              const nextParams = new URLSearchParams(params.toString());
              nextParams.set('page', String(index + 2));
              const json = await parseResponse(await fetch(`/api/general-affairs/equipment?${nextParams.toString()}`), '設備資料載入失敗');
              return (json.data || []) as EquipmentLabelItem[];
            }),
          );
          records = [...records, ...rest.flat()];
        }
      }

      const printable = await Promise.all(
        records
          .filter((item) => equipmentQrPath(item))
          .map(async (item) => {
            const qrUrl = new URL(equipmentQrPath(item), origin).toString();
            const qrDataUrl = await QRCode.toDataURL(qrUrl, {
              errorCorrectionLevel: 'M',
              margin: 1,
              width: 360,
              color: {
                dark: '#0f172a',
                light: '#ffffff',
              },
            });
            return {
              ...item,
              qr_url: qrUrl,
              qr_data_url: qrDataUrl,
            };
          }),
      );

      setLabels(printable);
      if (records.length > 0 && printable.length === 0) {
        setError('設備 QR 功能尚未完成資料庫設定，請先執行 QR 欄位修復 SQL 後再列印。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QR 標籤載入失敗');
      setLabels([]);
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    loadLabels();
  }, [loadLabels]);

  const header = (
    <GeneralAffairsPageHeader
      breadcrumbs={[
        { label: '總務服務中心', href: '/general-affairs' },
        { label: '設備管理', href: '/general-affairs/equipment' },
        { label: 'QR 標籤列印' },
      ]}
      title="設備 QR 標籤列印"
      description="列印既有設備的穩定 QR 掃描入口；紙本標籤不印門市與位置，設備移轉時不需要重印。"
      primaryAction={
        <button
          type="button"
          onClick={() => window.print()}
          disabled={loading || labels.length === 0}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-300"
        >
          <Printer className="h-4 w-4" />
          列印
        </button>
      }
      secondaryActions={[
        <Link
          key="back"
          href="/general-affairs/equipment"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          回設備列表
        </Link>,
        <button
          key="reload"
          type="button"
          onClick={loadLabels}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          重新整理
        </button>,
      ]}
    />
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 md:px-8">
      <GeneralAffairsListPage header={header}>
        <style jsx global>{`
          @page {
            size: 60mm 25mm;
            margin: 0;
          }

          @media print {
            body {
              background: #ffffff !important;
            }

            body * {
              visibility: hidden;
            }

            .ga-label-print-area,
            .ga-label-print-area * {
              visibility: visible;
            }

            .ga-label-print-area {
              position: static;
              width: 60mm;
              background: #ffffff;
              padding: 0;
            }

            .ga-print-hidden {
              display: none !important;
            }

            .ga-label-grid {
              display: block !important;
            }

            .ga-label-card {
              width: 60mm !important;
              height: 25mm !important;
              margin: 0 !important;
              padding: 2mm !important;
              border: 0 !important;
              border-radius: 0 !important;
              break-inside: avoid;
              page-break-inside: avoid;
              page-break-after: always;
              box-shadow: none !important;
              overflow: hidden !important;
            }

            .ga-label-card:last-child {
              page-break-after: auto;
            }

            .ga-label-layout {
              gap: 2mm !important;
            }

            .ga-label-qr {
              width: 19mm !important;
              height: 19mm !important;
              padding: 0 !important;
            }

            .ga-label-code {
              font-size: 10pt !important;
              line-height: 1.1 !important;
            }

            .ga-label-name {
              font-size: 7pt !important;
              line-height: 1.2 !important;
              margin-top: 1mm !important;
            }

            .ga-label-meta {
              display: none !important;
            }

            .ga-label-note {
              border-top: 0 !important;
              padding-top: 0.8mm !important;
              margin-top: 0.8mm !important;
              font-size: 5.5pt !important;
              line-height: 1.15 !important;
            }
          }
        `}</style>

        <section className="ga-print-hidden mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">
          目前來源：{sourceDescription}。列印尺寸固定為 60 x 25 mm；300dpi 對應約 709 x 295 px。建議耗材：霧面白色 PET、強黏膠、黑色全樹脂抗刮碳帶。紙本只固定設備身份與 QR 入口，門市、位置、維修入口與保固狀態會由掃描頁即時讀取系統資料。
        </section>

        {!loading && missingAssetCodeCount > 0 && (
          <section className="ga-print-hidden mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            目前有 {missingAssetCodeCount} 台設備尚未設定正式設備編號；QR 仍可掃描，但建議補完設備編號後再貼標。
          </section>
        )}

        {loading && (
          <div className="flex h-64 items-center justify-center rounded-lg border border-slate-200 bg-white">
            <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
          </div>
        )}

        {!loading && error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && labels.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-500">
            目前沒有可列印的設備 QR 標籤。
          </div>
        )}

        {!loading && labels.length > 0 && (
          <section className="ga-label-print-area rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="ga-label-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {labels.map((item) => (
                <article key={item.id} className="ga-label-card h-[25mm] w-[60mm] overflow-hidden rounded-md border border-slate-300 bg-white p-[2mm]">
                  <div className="ga-label-layout flex gap-[2mm]">
                    <div className="ga-label-qr h-[19mm] w-[19mm] shrink-0 rounded bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.qr_data_url} alt={`${item.name} QR Code`} className="h-full w-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-slate-500">設備編號</div>
                      <div className={`ga-label-code break-words text-[13px] font-black leading-tight tracking-normal ${hasAssetCode(item) ? 'text-slate-950' : 'text-red-600'}`}>
                        {printCode(item)}
                      </div>
                      <div className="ga-label-name mt-1 line-clamp-2 text-[10px] font-bold leading-tight text-slate-900">{item.name}</div>
                      <div className="ga-label-meta mt-1 line-clamp-1 text-[9px] leading-tight text-slate-500">
                        {[item.brand, item.model].filter(Boolean).join(' / ') || '掃描查看設備資訊'}
                      </div>
                    </div>
                  </div>
                  <div className="ga-label-note mt-[1mm] border-t border-slate-200 pt-[1mm] text-[8px] font-medium leading-tight text-slate-500">
                    {hasAssetCode(item)
                      ? '掃描查看門市、位置、照片、維修入口與保固狀態'
                      : '此標籤可掃描，但建議先回設備主檔補上正式設備編號再貼標'}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </GeneralAffairsListPage>
    </main>
  );
}
