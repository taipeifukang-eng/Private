// QR 標籤列印文件（60 x 25 mm，一張一頁，沿用舊版版型）。獨立列印視窗，不受工作台版面（捲動容器、頁籤）影響。
export type LabelItem = { id: string; type: "EQUIPMENT" | "FACILITY"; name: string; code: string | null; storeCode: string | null; storeName: string | null; qrUrl: string; svg: string; warnings: string[] };

export const EXCLUDE_TEXT: Record<string, string> = {
  SCRAPPED: "已報廢，QR 已作廢", RETIRED: "已退役，QR 已作廢", DELETED: "已刪除，QR 已作廢", REVOKED: "QR 已作廢", NO_TOKEN: "沒有 QR 代碼", NOT_FOUND: "找不到這筆資料",
};

export const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function buildPrintDocument(items: LabelItem[], opts: { watermark: boolean; noun: string }) {
  const cards = items
    .map((item) => {
      const hasCode = !!item.code;
      const note = hasCode ? "掃描查看門市、位置、照片、維修入口與保固狀態" : `此標籤可掃描，但建議先補上正式${opts.noun}編號再貼標`;
      return `<article class="label" data-testid="print-label"><div class="row"><div class="qr">${item.svg}</div><div class="txt"><div class="cap">${escapeHtml(opts.noun)}編號</div><div class="code${hasCode ? "" : " missing"}">${escapeHtml(item.code || "尚未設定編號")}</div><div class="nm">${escapeHtml(item.name)}</div></div></div><div class="note">${escapeHtml(note)}</div>${opts.watermark ? '<span class="wm">測試</span>' : ""}</article>`;
    })
    .join("");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escapeHtml(opts.noun)} QR 標籤列印</title><style>
@page { size: 60mm 25mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; font-family: "Noto Sans TC", "Microsoft JhengHei", sans-serif; color: #111; }
.label { position: relative; width: 60mm; height: 25mm; padding: 2mm; overflow: hidden; page-break-after: always; break-after: page; page-break-inside: avoid; }
.label:last-child { page-break-after: auto; break-after: auto; }
.row { display: flex; gap: 2mm; }
.qr { width: 19mm; height: 19mm; flex: none; }
.qr svg { width: 100%; height: 100%; display: block; }
.txt { min-width: 0; flex: 1; }
.cap { font-size: 6pt; color: #555; }
.code { font-size: 10pt; font-weight: 800; line-height: 1.1; overflow-wrap: anywhere; }
.code.missing { color: #c00; }
.nm { margin-top: 1mm; font-size: 7pt; font-weight: 700; line-height: 1.2; max-height: 2.4em; overflow: hidden; }
.note { margin-top: 0.8mm; font-size: 5.5pt; line-height: 1.15; color: #555; }
.wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 26pt; font-weight: 900; color: rgba(210, 0, 0, 0.3); transform: rotate(-18deg); letter-spacing: 3pt; }
@media screen { body { padding: 8px; background: #eee; } .label { background: #fff; margin: 0 0 8px; border: 1px solid #ccc; } }
</style></head><body>${cards}</body></html>`;
}
