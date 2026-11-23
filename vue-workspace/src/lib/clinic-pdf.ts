// 診所請款明細 PDF 匯出（M6 W31）：圖片式（html2canvas + jsPDF 都在按下匯出時才動態載入），參數沿用舊版。
// 版面字串與檔名來自 lib/clinic-selfpay/claim-pdf.ts（純函式）；這裡只負責量高度、分頁、轉圖、存檔。
// 給診所的 PDF 不含成本與毛利：渲染用的 HTML 只用 5 個允許欄位；實際渲染過的每頁 HTML 會留在 window.__clinicPdfLast 供測試檢查。
import {
  PDF_BASE_STYLE,
  PDF_SCALE,
  PDF_WRAPPER_STYLE,
  PDF_MARGIN_MM,
  buildPageHtml,
  claimPdfFilename,
  pageContentLimitPx,
  type PdfBatch,
  type PdfContext,
  type PdfItem,
} from "../../../lib/clinic-selfpay/claim-pdf";

export type ClaimPdfInput = { storeName: string; batch: PdfBatch; items: PdfItem[]; totalBilling: number; fallbackYearMonth?: string };
export type ClaimPdfResult = { filename: string; pages: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function exportClaimPdf(input: ClaimPdfInput): Promise<ClaimPdfResult> {
  const html2canvas = (await import("html2canvas")).default;
  const { jsPDF } = await import("jspdf");
  const ctx: PdfContext = { storeName: input.storeName, batch: input.batch, totalBilling: input.totalBilling, printDate: new Date().toLocaleDateString("zh-TW") };

  const mount = (innerHtml: string) => {
    const el = document.createElement("div");
    el.style.cssText = PDF_WRAPPER_STYLE;
    el.setAttribute("data-clinic-pdf-page", "1");
    el.innerHTML = `<div style="${PDF_BASE_STYLE}">${innerHtml}</div>`;
    document.body.appendChild(el);
    return el;
  };
  // 先量高度再渲染，確保最後一頁的簽名區不會被切掉
  const measure = async (innerHtml: string): Promise<number> => {
    const el = mount(innerHtml);
    try {
      await sleep(30);
      return el.scrollHeight;
    } finally {
      document.body.removeChild(el);
    }
  };
  const render = async (innerHtml: string): Promise<HTMLCanvasElement> => {
    const el = mount(innerHtml);
    try {
      await sleep(100);
      return await html2canvas(el, { scale: PDF_SCALE, useCORS: true, backgroundColor: "#ffffff", logging: false });
    } finally {
      document.body.removeChild(el);
    }
  };

  const pdf = new jsPDF("p", "mm", "a4");
  const imgWidthMm = pdf.internal.pageSize.getWidth() - PDF_MARGIN_MM * 2;
  const limitPx = pageContentLimitPx(pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
  const fits = async (rows: PdfItem[], isFirst: boolean, isLast: boolean) => (await measure(buildPageHtml(ctx, rows, { isFirst, isLast, pageNo: 1, totalPages: 1 }))) <= limitPx;

  // 能當最後一頁（含簽名區）就收尾，否則盡量塞滿一頁再繼續
  const remaining = [...input.items];
  const chunks: PdfItem[][] = [];
  while (remaining.length > 0) {
    const isFirst = chunks.length === 0;
    if (await fits(remaining, isFirst, true)) {
      chunks.push([...remaining]);
      remaining.length = 0;
      break;
    }
    const pageRows: PdfItem[] = [];
    while (remaining.length > 0) {
      if (!(await fits([...pageRows, remaining[0]], isFirst, false))) break;
      pageRows.push(remaining.shift()!);
    }
    if (pageRows.length === 0) pageRows.push(remaining.shift()!); // 單列過高也要前進，避免無窮迴圈
    chunks.push(pageRows);
  }
  if (!chunks.length) chunks.push([]);

  const pageHtmls: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const html = buildPageHtml(ctx, chunks[i], { isFirst: i === 0, isLast: i === chunks.length - 1, pageNo: i + 1, totalPages: chunks.length });
    pageHtmls.push(html);
    const canvas = await render(html);
    const imgH = (canvas.height * imgWidthMm) / canvas.width;
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", PDF_MARGIN_MM, PDF_MARGIN_MM, imgWidthMm, imgH);
  }

  const filename = claimPdfFilename(input.storeName, input.batch, input.fallbackYearMonth);
  (window as any).__clinicPdfLast = { filename, pages: chunks.length, pageHtmls };
  pdf.save(filename);
  return { filename, pages: chunks.length };
}
