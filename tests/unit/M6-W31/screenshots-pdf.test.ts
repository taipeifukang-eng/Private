import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JPEG_QUALITY, MAX_SIDE, compressedName, fitWithin } from '../../../lib/clinic-selfpay/image-sizing';
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_COUNT, detectImageType, screenshotExt, validateScreenshots } from '../../../lib/clinic-selfpay/screenshots';
import { PDF_FORBIDDEN, PDF_MARGIN_MM, pdfVisibleText, PDF_SCALE, PDF_WIDTH_PX, buildPageHtml, claimPdfFilename, escapeHtml, fmt, makeRowsHtml, pageContentLimitPx, pickPdfItem } from '../../../lib/clinic-selfpay/claim-pdf';
import { ZOOM_MAX, ZOOM_MIN, clampIndex, clampZoom, keyAction, swipeDirection } from '../../../lib/clinic-selfpay/lightbox';

const root = path.resolve(__dirname, '..', '..', '..');
const legacy = fs.readFileSync(path.join(root, 'app/store/clinic-selfpay-margin/page.tsx'), 'utf8');

describe('M6-W31：截圖壓縮尺寸', () => {
  it('長邊超過 1920 才等比縮小；小圖不放大；至少 1px', () => {
    expect(MAX_SIDE).toBe(1920);
    expect(JPEG_QUALITY).toBe(0.85);
    expect(fitWithin(4000, 2000)).toEqual({ width: 1920, height: 960 });
    expect(fitWithin(2000, 4000)).toEqual({ width: 960, height: 1920 });
    expect(fitWithin(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(100000, 10)).toEqual({ width: 1920, height: 1 });
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 });
  });
  it('壓縮後檔名改 .jpg；沒有副檔名也可', () => {
    expect(compressedName('clipboard_1.png')).toBe('clipboard_1.jpg');
    expect(compressedName('a.b.webp')).toBe('a.b.jpg');
    expect(compressedName('noext')).toBe('noext.jpg');
  });
  it('舊版壓縮數值相同（1920、0.85）', () => {
    expect(legacy).toMatch(/1920/);
    expect(legacy).toMatch(/0\.85/);
  });
});

describe('M6-W31：D6 張數、格式、大小檢查', () => {
  const ok = (n = 1) => Array.from({ length: n }, (_, i) => ({ name: `a${i}.jpg`, type: 'image/jpeg', size: 1000 }));
  it('至少 1 張、最多 10 張', () => {
    expect(SCREENSHOT_MAX_COUNT).toBe(10);
    expect(validateScreenshots([])).toContain('至少');
    expect(validateScreenshots([{ name: 'empty.png', type: 'image/png', size: 0 }])).toContain('至少');
    expect(validateScreenshots(ok(1))).toBeNull();
    expect(validateScreenshots(ok(10))).toBeNull();
    expect(validateScreenshots(ok(11))).toContain('最多');
  });
  it('只收 png／jpeg／webp；每張 5MB 內（剛好 5MB 可、多 1 byte 不可）', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(validateScreenshots([{ name: 'x', type, size: 10 }]), type).toBeNull();
    for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', '']) expect(validateScreenshots([{ name: 'x', type, size: 10 }]), type).toContain('png、jpeg、webp');
    expect(validateScreenshots([{ name: 'x', type: 'image/png', size: SCREENSHOT_MAX_BYTES }])).toBeNull();
    expect(validateScreenshots([{ name: 'x', type: 'image/png', size: SCREENSHOT_MAX_BYTES + 1 }])).toContain('5MB');
  });
  it('副檔名依類型', () => {
    expect(screenshotExt('image/png')).toBe('png');
    expect(screenshotExt('image/webp')).toBe('webp');
    expect(screenshotExt('image/jpeg')).toBe('jpg');
  });
});

describe('M6-W31：PDF 檔名與參數（沿用舊版）', () => {
  it('檔名：<門市名稱>診所請款明細_<診所代碼>_<年月>.pdf；沒診所代碼用 clinic；沒年月用選的月份再用 unknown', () => {
    expect(claimPdfFilename('測試門市甲', { clinic_code: 'ZT038001', year_month: '2038-11' })).toBe('測試門市甲診所請款明細_ZT038001_2038-11.pdf');
    expect(claimPdfFilename('測試門市甲', { clinic_code: null, year_month: '2038-11' })).toBe('測試門市甲診所請款明細_clinic_2038-11.pdf');
    expect(claimPdfFilename('測試門市甲', { clinic_code: '-', year_month: '' }, '2038-12')).toBe('測試門市甲診所請款明細_clinic_2038-12.pdf');
    expect(claimPdfFilename('測試門市甲', {})).toBe('測試門市甲診所請款明細_clinic_unknown.pdf');
    expect(claimPdfFilename('', { clinic_code: 'A', year_month: '2038-01' })).toBe('診所請款明細_A_2038-01.pdf');
  });
  it('舊版原始碼確認同樣的檔名樣式與 PDF 參數：980px、scale 2、A4 直式、邊界 8mm、簽名區、列印日期', () => {
    expect(legacy).toContain('${storeName}診所請款明細_${safeClinicCode}_${ym}.pdf');
    expect(legacy).toContain("safeClinicCode = clinicCode === '-' ? 'clinic' : clinicCode");
    expect(legacy).toContain("String(report.batch?.year_month || yearMonth || 'unknown')");
    expect(legacy).toContain('width:980px');
    expect(legacy).toContain('scale: 2');
    expect(legacy).toContain("new jsPDF('p', 'mm', 'a4')");
    expect(legacy).toContain('getWidth() - 16');
    expect(legacy).toContain('SAFETY_MARGIN_PX = 28');
    expect(legacy).toContain('pdf.addImage(imgData, \'PNG\', 8, 8, pdfImgWidth, imgH)');
    expect(PDF_WIDTH_PX).toBe(980);
    expect(PDF_SCALE).toBe(2);
    expect(PDF_MARGIN_MM).toBe(8);
    // A4：(297-16) * 980 / (210-16) - 28
    expect(pageContentLimitPx()).toBeCloseTo((281 * 980) / 194 - 28, 6);
  });
  it('頁面文字沿用舊版：標題、欄位、簽名區、列印日期、頁碼字樣都在舊版原始碼裡', () => {
    const html = buildPageHtml(
      { storeName: '測試門市甲', batch: { clinic_name: '測試診所甲', clinic_code: 'ZT038001', period_start: '2038-11-01', period_end: '2038-11-30' }, totalBilling: 1234.5, printDate: '2038/11/30' },
      [{ health_insurance_code: 'ZTA000001', drug_name: '測試藥甲', qty: 10, matched_member_price: 100, billing_amount: 1000 }],
      { isFirst: true, isLast: true, pageNo: 1, totalPages: 1 },
    );
    for (const piece of ['診所請款明細', '健保代碼', '藥品名稱', '數量', '藥費', '藥費總額', '分店蓋章 / 簽名處', '診所蓋章 / 簽名處', '列印日期：', '診所：', '期間：']) {
      expect(legacy, `舊版應有 ${piece}`).toContain(piece);
      expect(html, `新版應有 ${piece}`).toContain(piece);
    }
    expect(html).toContain('藥費總額：1,234.5');
    expect(html).toContain('第 1 頁 / 共 1 頁');
    expect(html).toContain('列印日期：2038/11/30');
    // 非最後一頁沒有簽名區與列印日期；非首頁是「（續）」
    const mid = buildPageHtml({ storeName: 'S', batch: {}, totalBilling: 0, printDate: 'x' }, [], { isFirst: false, isLast: false, pageNo: 2, totalPages: 3 });
    expect(mid).toContain('診所請款明細（續）');
    expect(mid).not.toContain('簽名處');
    expect(mid).not.toContain('列印日期');
    expect(mid).toContain('第 2 頁 / 共 3 頁');
  });
  it('金額格式與跳脫與舊版相同', () => {
    expect(fmt(1234.567)).toBe('1,234.57');
    expect(fmt(null)).toBe('0');
    expect(escapeHtml(`<a href="x">'&</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;');
  });
});

describe('M6-W31：PDF 絕不含成本與毛利', () => {
  const rows: any[] = [
    { id: 'i1', health_insurance_code: 'ZTA000001', drug_name: '測試藥甲', qty: 10, matched_product_code: 'ZTP0001', matched_member_price: 100, matched_cost_price: 7777.77, billing_amount: 1000, gross_profit_amount: 8888.88, match_status: 'matched' },
    { id: 'i2', health_insurance_code: 'ZTA000002', drug_name: '<b>惡意</b>藥乙', qty: 3, matched_member_price: null, matched_cost_price: 5555.55, billing_amount: 0, gross_profit_amount: -9999.99, margin: 0.4, cost: 1, gross: 2 },
  ];
  it('pickPdfItem 只留 5 個欄位', () => {
    expect(Object.keys(pickPdfItem(rows[0])).sort()).toEqual(['billing_amount', 'drug_name', 'health_insurance_code', 'matched_member_price', 'qty']);
  });
  it('即使把成本毛利欄位塞進明細，輸出的 HTML 也沒有金額、沒有成本毛利字樣', () => {
    const ctx = { storeName: '測試門市甲', batch: { clinic_name: '測試診所甲', clinic_code: 'ZT038001', year_month: '2038-11' }, totalBilling: 1000, printDate: '2038/11/30' };
    const pages = [
      buildPageHtml(ctx, rows, { isFirst: true, isLast: false, pageNo: 1, totalPages: 2 }),
      buildPageHtml(ctx, rows, { isFirst: false, isLast: true, pageNo: 2, totalPages: 2 }),
      makeRowsHtml(rows),
    ];
    for (const html of pages) {
      for (const secret of ['7777.77', '7,777.77', '8888.88', '8,888.88', '5555.55', '5,555.55', '9999.99', '9,999.99', 'ZTP0001']) expect(html, secret).not.toContain(secret);
      expect(PDF_FORBIDDEN.test(pdfVisibleText(html)), '不可出現成本、毛利、cost、margin 字樣').toBe(false);
      expect(html).not.toContain('<b>惡意</b>'); // 藥名要跳脫
    }
  });
  it('頁面表頭只有 健保代碼／藥品名稱／數量／藥費／藥費總額 五欄', () => {
    const html = buildPageHtml({ storeName: 'S', batch: {}, totalBilling: 0, printDate: 'x' }, [], { isFirst: true, isLast: true, pageNo: 1, totalPages: 1 });
    expect((html.match(/<th /g) || []).length).toBe(5);
  });
});

describe('M6-W31：檢視器互動規則', () => {
  it('縮放限制在 1 到 4 倍；索引不會超出', () => {
    expect([clampZoom(0.2), clampZoom(9), clampZoom(1.5)]).toEqual([ZOOM_MIN, ZOOM_MAX, 1.5]);
    expect([clampIndex(-1, 3), clampIndex(5, 3), clampIndex(1, 3), clampIndex(2, 0)]).toEqual([0, 2, 1, 0]);
  });
  it('滑動：向左下一張、向右上一張；太短或偏縱向不算', () => {
    expect(swipeDirection(-120, 10)).toBe('next');
    expect(swipeDirection(120, -10)).toBe('prev');
    expect(swipeDirection(-30, 0)).toBeNull();
    expect(swipeDirection(-100, 90)).toBeNull();
  });
  it('鍵盤對應', () => {
    expect(keyAction('Escape')).toBe('close');
    expect(keyAction('ArrowRight')).toBe('next');
    expect(keyAction('ArrowLeft')).toBe('prev');
    expect(keyAction('+')).toBe('zoom-in');
    expect(keyAction('-')).toBe('zoom-out');
    expect(keyAction('0')).toBe('zoom-reset');
    expect(keyAction('a')).toBeNull();
  });
});

it('detectImageType：只認 PNG／JPEG／WebP 真實檔頭，不信任自報類型', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  expect(detectImageType(png)).toBe('image/png');
  expect(detectImageType(jpg)).toBe('image/jpeg');
  expect(detectImageType(webp)).toBe('image/webp');
  expect(detectImageType(new TextEncoder().encode('<svg></svg>'))).toBeNull();
  expect(detectImageType(new TextEncoder().encode('GIF89a......'))).toBeNull();
  expect(detectImageType(new Uint8Array())).toBeNull();
});
