'use client';

import React from 'react';
import { Printer } from 'lucide-react';
import { CampaignStoreDetail, CampaignType } from '@/types/workflow';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface StoreWithSupervisor {
  id: string;
  store_name: string;
  store_code: string;
  supervisor_id?: string;
  supervisor_name?: string;
}

interface ScheduleItem {
  id: string;
  store_id: string;
  activity_date: string;
}

interface CampaignDetailPreviewTableProps {
  campaignName: string;
  campaignType: CampaignType;
  stores: StoreWithSupervisor[];
  schedules: ScheduleItem[];
  details: CampaignStoreDetail[];  // 已載入的全部細節資料
}

// ─────────────────────────────────────────────
// 欄位定義
// ─────────────────────────────────────────────
const PROMOTION_COLUMNS = [
  { key: 'outdoor_vendor', label: '外場廠商',  group: '外場配置', groupBg: 'bg-orange-100', groupText: 'text-orange-800', cellBg: 'bg-orange-50' },
  { key: 'red_bean_cake',  label: '紅豆餅',    group: '外場配置', groupBg: 'bg-orange-100', groupText: 'text-orange-800', cellBg: 'bg-orange-50' },
  { key: 'circulation',    label: '循環',       group: '外場配置', groupBg: 'bg-orange-100', groupText: 'text-orange-800', cellBg: 'bg-orange-50' },
  { key: 'quantum',        label: '量子',       group: '外場配置', groupBg: 'bg-orange-100', groupText: 'text-orange-800', cellBg: 'bg-orange-50' },
  { key: 'bone_density',   label: '骨密',       group: '外場配置', groupBg: 'bg-orange-100', groupText: 'text-orange-800', cellBg: 'bg-orange-50' },
  { key: 'supervisor',     label: '督導',       group: '門市人員', groupBg: 'bg-blue-100',   groupText: 'text-blue-800',   cellBg: 'bg-blue-50'   },
  { key: 'manager',        label: '經理',       group: '門市人員', groupBg: 'bg-blue-100',   groupText: 'text-blue-800',   cellBg: 'bg-blue-50'   },
  { key: 'tasting',        label: '試飲',       group: '門市人員', groupBg: 'bg-blue-100',   groupText: 'text-blue-800',   cellBg: 'bg-blue-50'   },
  { key: 'activity_team',  label: '活動組',     group: '門市人員', groupBg: 'bg-blue-100',   groupText: 'text-blue-800',   cellBg: 'bg-blue-50'   },
  { key: 'sales1',         label: '業務 1',     group: '業務',     groupBg: 'bg-green-100',  groupText: 'text-green-800',  cellBg: 'bg-green-50'  },
  { key: 'sales2',         label: '業務 2',     group: '業務',     groupBg: 'bg-green-100',  groupText: 'text-green-800',  cellBg: 'bg-green-50'  },
  { key: 'sales3',         label: '業務 3',     group: '業務',     groupBg: 'bg-green-100',  groupText: 'text-green-800',  cellBg: 'bg-green-50'  },
  { key: 'sales4',         label: '業務 4',     group: '業務',     groupBg: 'bg-green-100',  groupText: 'text-green-800',  cellBg: 'bg-green-50'  },
  { key: 'sales5',         label: '業務 5',     group: '業務',     groupBg: 'bg-green-100',  groupText: 'text-green-800',  cellBg: 'bg-green-50'  },
  { key: 'sales6',         label: '業務 6',     group: '業務',     groupBg: 'bg-green-100',  groupText: 'text-green-800',  cellBg: 'bg-green-50'  },
  { key: 'indoor_pt1',     label: '內場工讀1\n(09~13)', group: '內場工讀', groupBg: 'bg-purple-100', groupText: 'text-purple-800', cellBg: 'bg-purple-50' },
  { key: 'indoor_pt2',     label: '內場工讀2\n(09~13)', group: '內場工讀', groupBg: 'bg-purple-100', groupText: 'text-purple-800', cellBg: 'bg-purple-50' },
  { key: 'notes',          label: '備註',       group: '備註',     groupBg: 'bg-gray-100',   groupText: 'text-gray-700',   cellBg: 'bg-gray-50'   },
] as const;

const INVENTORY_COLUMNS = [
  { key: 'has_external_inventory_company', label: '外盤公司', group: '盤點配置', groupBg: 'bg-teal-100', groupText: 'text-teal-800', cellBg: 'bg-teal-50' },
  { key: 'planned_inventory_time',         label: '預計盤點時間', group: '盤點配置', groupBg: 'bg-teal-100', groupText: 'text-teal-800', cellBg: 'bg-teal-50' },
  { key: 'inventory_staff',               label: '盤點組人員', group: '盤點配置', groupBg: 'bg-teal-100', groupText: 'text-teal-800', cellBg: 'bg-teal-50' },
  { key: 'notes',                         label: '備註', group: '備註', groupBg: 'bg-gray-100', groupText: 'text-gray-700', cellBg: 'bg-gray-50' },
] as const;

const WEEKDAY_MAP: Record<number, string> = { 0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' };

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

function formatWeekday(dateStr: string) {
  const d = new Date(dateStr);
  return `週${WEEKDAY_MAP[d.getDay()]}`;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function CampaignDetailPreviewTable({
  campaignName,
  campaignType,
  stores,
  schedules,
  details,
}: CampaignDetailPreviewTableProps) {
  const columns = campaignType === 'inventory' ? INVENTORY_COLUMNS : PROMOTION_COLUMNS;

  // 依日期排序 → 同日再依門市代碼排序
  const rows = schedules
    .map(schedule => {
      const store = stores.find(s => s.id === schedule.store_id);
      const detail = details.find(d => d.store_id === schedule.store_id) ?? null;
      return { schedule, store, detail };
    })
    .filter(r => r.store !== undefined)
    .sort((a, b) => {
      const dateDiff = a.schedule.activity_date.localeCompare(b.schedule.activity_date);
      if (dateDiff !== 0) return dateDiff;
      return (a.store?.store_code ?? '').localeCompare(b.store?.store_code ?? '');
    });

  // 計算欄位群組的 colspan
  const groupColspans: { group: string; colspan: number; groupBg: string; groupText: string }[] = [];
  columns.forEach(col => {
    const last = groupColspans[groupColspans.length - 1];
    if (last && last.group === col.group) {
      last.colspan++;
    } else {
      groupColspans.push({ group: col.group, colspan: 1, groupBg: col.groupBg, groupText: col.groupText });
    }
  });

  const filledCount = rows.filter(r => r.detail !== null).length;

  const handlePrint = () => window.print();

  return (
    <div>
      {/* 頂部操作列 */}
      <div className="flex items-center justify-between mb-4 print:hidden">
        <div>
          <p className="text-sm text-gray-500">
            共 <span className="font-semibold text-gray-700">{rows.length}</span> 間門市，
            已填 <span className="font-semibold text-green-600">{filledCount}</span> 間，
            待填 <span className="font-semibold text-orange-500">{rows.length - filledCount}</span> 間
          </p>
        </div>
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors text-sm"
        >
          <Printer size={15} />
          列印 / 匯出 PDF
        </button>
      </div>

      {/* 預覽表 */}
      <div className="overflow-x-auto rounded-lg border border-gray-300 shadow-sm" id="campaign-preview-table">
        <table className="border-collapse text-xs min-w-max">
          {/* ── 標題列 ── */}
          <caption className="text-base font-bold text-gray-900 py-3 bg-gray-50 border-b border-gray-300 print:text-lg">
            {campaignName}　門市細節預覽表
          </caption>

          <thead>
            {/* 第一行：欄位群組 */}
            <tr>
              {/* 固定欄位群組佔頭部 */}
              <th rowSpan={2} className="border border-gray-300 px-3 py-2 bg-gray-200 text-gray-700 font-semibold whitespace-nowrap min-w-[60px]">日期</th>
              <th rowSpan={2} className="border border-gray-300 px-2 py-2 bg-gray-200 text-gray-700 font-semibold whitespace-nowrap min-w-[45px]">星期</th>
              <th rowSpan={2} className="border border-gray-300 px-3 py-2 bg-gray-200 text-gray-700 font-semibold whitespace-nowrap min-w-[130px]">門市</th>
              <th rowSpan={2} className="border border-gray-300 px-3 py-2 bg-gray-200 text-gray-700 font-semibold whitespace-nowrap min-w-[70px]">督導</th>
              {groupColspans.map(g => (
                <th
                  key={g.group}
                  colSpan={g.colspan}
                  className={`border border-gray-300 px-2 py-1.5 text-center font-semibold ${g.groupBg} ${g.groupText}`}
                >
                  {g.group}
                </th>
              ))}
            </tr>

            {/* 第二行：個別欄位名稱 */}
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`border border-gray-300 px-2 py-1.5 text-center font-medium ${col.groupBg} ${col.groupText} whitespace-pre-line min-w-[80px]`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4 + columns.length} className="py-12 text-center text-gray-400">
                  尚無已排程門市
                </td>
              </tr>
            ) : (
              rows.map(({ schedule, store, detail }, idx) => {
                const isEven = idx % 2 === 0;
                const baseBg = isEven ? 'bg-white' : 'bg-gray-50/60';
                const hasMissingData = detail === null;

                return (
                  <tr
                    key={schedule.id}
                    className={`${baseBg} hover:bg-yellow-50/40 transition-colors`}
                  >
                    {/* 固定欄位 */}
                    <td className="border border-gray-200 px-3 py-2 text-center font-medium text-gray-800 whitespace-nowrap">
                      {formatDate(schedule.activity_date)}
                    </td>
                    <td className="border border-gray-200 px-2 py-2 text-center text-gray-600 whitespace-nowrap">
                      {formatWeekday(schedule.activity_date)}
                    </td>
                    <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{store?.store_name}</div>
                      <div className="text-gray-400 text-[10px]">{store?.store_code}</div>
                    </td>
                    <td className="border border-gray-200 px-3 py-2 text-center text-gray-600 whitespace-nowrap">
                      {store?.supervisor_name || '—'}
                    </td>

                    {/* 細節欄位 */}
                    {columns.map(col => {
                      const val = detail ? (detail as any)[col.key] : null;
                      return (
                        <td
                          key={col.key}
                          className={`border border-gray-200 px-2 py-2 text-center ${col.cellBg} whitespace-pre-wrap max-w-[160px]`}
                        >
                          {val ? (
                            <span className="text-gray-800">{val}</span>
                          ) : (
                            <span className={hasMissingData ? 'text-orange-300' : 'text-gray-300'}>—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 列印樣式 */}
      <style jsx>{`
        @media print {
          body * { visibility: hidden; }
          #campaign-preview-table,
          #campaign-preview-table * { visibility: visible; }
          #campaign-preview-table {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            overflow: visible;
          }
          table { font-size: 9px; border-collapse: collapse; }
          th, td { border: 1px solid #999 !important; padding: 3px 5px !important; }
        }
      `}</style>
    </div>
  );
}
