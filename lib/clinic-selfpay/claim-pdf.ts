// 診所請款明細 PDF 的版面與檔名（M6 W31）。沿用舊版參數：寬 980px、html2canvas scale 2、A4 直式、邊界 8mm、
// 簽名區與列印日期保留、檔名「<門市名稱>診所請款明細_<診所代碼>_<年月>.pdf」。
// 給診所的 PDF 絕不可含成本與毛利：這裡的資料型別只收 5 個欄位，其餘欄位不會進 HTML。純函式，前端與單元測試共用。

export const PDF_WIDTH_PX = 980;
export const PDF_SCALE = 2;
export const PDF_MARGIN_MM = 8;
export const PDF_SAFETY_MARGIN_PX = 28;
export const PDF_BASE_STYLE = `font-family:'Microsoft JhengHei','Noto Sans TC',Arial,sans-serif;color:#111827;`;
export const PDF_WRAPPER_STYLE = `position:fixed;left:-9999px;top:0;width:${PDF_WIDTH_PX}px;background:white;padding:24px 28px;box-sizing:border-box;`;

export type PdfItem = { health_insurance_code?: string | null; drug_name?: string | null; qty?: number | null; matched_member_price?: number | null; billing_amount?: number | null };
export type PdfBatch = { clinic_name?: string | null; clinic_code?: string | null; period_start?: string | null; period_end?: string | null; year_month?: string | null };
export type PdfContext = { storeName: string; batch: PdfBatch; totalBilling: number; printDate: string };

export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const fmt = (n: number | null | undefined): string => Number(n || 0).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 只挑 PDF 允許的 5 個欄位（成本、毛利、品號等一律丟掉）。 */
export const pickPdfItem = (item: PdfItem): Required<PdfItem> => ({
  health_insurance_code: item.health_insurance_code ?? null,
  drug_name: item.drug_name ?? null,
  qty: item.qty ?? null,
  matched_member_price: item.matched_member_price ?? null,
  billing_amount: item.billing_amount ?? null,
});

/** 舊版檔名：診所代碼沒有就用 clinic；年月沒有就用選的年月，再沒有 unknown。 */
export function claimPdfFilename(storeName: string, batch: PdfBatch, fallbackYearMonth?: string): string {
  const clinicCode = String(batch?.clinic_code || '-');
  const safeClinicCode = clinicCode === '-' ? 'clinic' : clinicCode;
  const ym = String(batch?.year_month || fallbackYearMonth || 'unknown');
  return `${storeName || ''}診所請款明細_${safeClinicCode}_${ym}.pdf`;
}

const TABLE_HEADER_HTML = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:left;width:110px;">健保代碼</th>
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:left;">藥品名稱</th>
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;width:56px;">數量</th>
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;width:72px;">藥費</th>
              <th style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;width:96px;">藥費總額</th>
            </tr>
          </thead>
      `;

export const makeRowsHtml = (rows: PdfItem[]): string =>
  `<tbody>${rows.map(pickPdfItem).map((item) => `
          <tr>
            <td style="border:1px solid #d1d5db;padding:7px 6px;vertical-align:top;">${escapeHtml(item.health_insurance_code || '-')}</td>
            <td style="border:1px solid #d1d5db;padding:7px 6px;vertical-align:top;">${escapeHtml(item.drug_name || '-')}</td>
            <td style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;vertical-align:top;">${fmt(Number(item.qty || 0))}</td>
            <td style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;vertical-align:top;">${item.matched_member_price == null ? '-' : fmt(item.matched_member_price)}</td>
            <td style="border:1px solid #d1d5db;padding:7px 6px;text-align:right;vertical-align:top;">${fmt(item.billing_amount)}</td>
          </tr>
        `).join('')}</tbody></table>`;

const SIGNATURE_HTML = `
        <div style="display:flex;gap:24px;margin-top:44px;padding-top:16px;border-top:2px solid #e5e7eb;">
          <div style="flex:1;border:1px solid #6b7280;border-radius:4px;padding:12px 16px;min-height:90px;">
            <div style="font-size:13px;font-weight:600;color:#374151;">分店蓋章 / 簽名處</div>
          </div>
          <div style="flex:1;border:1px solid #6b7280;border-radius:4px;padding:12px 16px;min-height:90px;">
            <div style="font-size:13px;font-weight:600;color:#374151;">診所蓋章 / 簽名處</div>
          </div>
        </div>
      `;

export function buildPageHtml(ctx: PdfContext, rows: PdfItem[], o: { isFirst: boolean; isLast: boolean; pageNo: number; totalPages: number }): string {
  const clinicName = String(ctx.batch?.clinic_name || '-');
  const clinicCode = String(ctx.batch?.clinic_code || '-');
  const periodStart = String(ctx.batch?.period_start || '-');
  const periodEnd = String(ctx.batch?.period_end || '-');
  const info = `
        <div style="border:1px solid #d1d5db;background:#f9fafb;border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:14px;line-height:1.9;">
          <div>診所：${escapeHtml(clinicName)}（${escapeHtml(clinicCode)}）</div>
          <div>期間：${escapeHtml(periodStart)} ~ ${escapeHtml(periodEnd)}</div>
          <div style="margin-top:6px;font-size:22px;font-weight:700;color:#111827;letter-spacing:0.01em;">藥費總額：${fmt(ctx.totalBilling)}</div>
        </div>
      `;
  return `
          ${o.isFirst
            ? `<h1 style="text-align:center;font-size:22px;font-weight:700;margin:0 0 12px 0;">${escapeHtml(ctx.storeName)}診所請款明細</h1>${info}`
            : `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${escapeHtml(ctx.storeName)}診所請款明細（續）</div>`}
          ${TABLE_HEADER_HTML}${makeRowsHtml(rows)}
          <div style="margin-top:8px;text-align:right;font-size:11px;color:#6b7280;">第 ${o.pageNo} 頁 / 共 ${o.totalPages} 頁</div>
          ${o.isLast ? SIGNATURE_HTML : ''}
          ${o.isLast ? `<div style="margin-top:10px;text-align:right;font-size:11px;color:#9ca3af;">列印日期：${escapeHtml(ctx.printDate)}</div>` : ''}
        `;
}

/** 每頁內容可用高度（px）：A4 297mm 扣上下邊界，換算成 980px 寬的比例，再扣安全邊界。 */
export function pageContentLimitPx(pageWidthMm = 210, pageHeightMm = 297): number {
  const imgWidthMm = pageWidthMm - PDF_MARGIN_MM * 2;
  const usableHeightMm = pageHeightMm - PDF_MARGIN_MM * 2;
  return (usableHeightMm * PDF_WIDTH_PX) / imgWidthMm - PDF_SAFETY_MARGIN_PX;
}

/** 檢查用：只取 HTML 的可見文字（去掉標籤與 style 屬性，CSS 的 margin 不算）。 */
export const pdfVisibleText = (html: string): string => String(html).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");

/** PDF 可見文字不可出現成本、毛利字樣。 */
export const PDF_FORBIDDEN = /成本|毛利|cost|margin|gross/i;
