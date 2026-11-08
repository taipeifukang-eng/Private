import {
  ACTIVITY_PDF_FORMAT,
  ACTIVITY_PDF_ORIENTATION,
  activityPdfFilename,
  activityPdfPlacement,
} from "../../lib/workspace/activity-view-rules";

/**
 * Export the currently scoped calendar only. Clone preserves Vue scoped styles and Chinese text.
 * M5 W20：版面與檔名照舊版——A4 橫式、每月一頁、檔名「活動名稱_活動排程.pdf」；內容太高時等比縮小並置中。
 * subtitle：活動期間與門市數（舊版標題下方那一行）。
 */
export async function exportActivityCalendar(source: HTMLElement, name: string, subtitle = "") {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const pdf = new jsPDF({ orientation: ACTIVITY_PDF_ORIENTATION, unit: "mm", format: ACTIVITY_PDF_FORMAT });
  const months = Array.from(source.querySelectorAll<HTMLElement>(".calendar-month"));
  if (!months.length) throw Error("No calendar");
  const stage = document.createElement("div");
  Object.assign(stage.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: "1150px",
    padding: "24px",
    background: "#fff",
    color: "#17211a",
    fontFamily: 'Arial,"Microsoft JhengHei",sans-serif',
    boxSizing: "border-box",
  });
  document.body.appendChild(stage);
  try {
    await document.fonts.ready;
    for (let i = 0; i < months.length; i++) {
      stage.replaceChildren();
      const title = document.createElement("h2");
      title.textContent = name;
      title.style.fontSize = "20px";
      title.style.textAlign = "center";
      stage.append(title);
      if (subtitle) {
        const sub = document.createElement("p");
        sub.textContent = subtitle;
        sub.style.cssText = "text-align:center;font-size:13px;color:#6b7280;margin:4px 0 12px";
        stage.append(sub);
      }
      const legend = source.querySelector(".legend");
      if (legend) stage.append(legend.cloneNode(true));
      const month = months[i].cloneNode(true) as HTMLElement;
      stage.append(month);
      const scroll = month.querySelector<HTMLElement>(".calendar-scroll");
      if (scroll) scroll.style.overflow = "visible";
      const canvas = await html2canvas(stage, { backgroundColor: "#ffffff", scale: 2, logging: false, windowWidth: 1500 });
      if (i) pdf.addPage();
      const place = activityPdfPlacement(canvas.width, canvas.height);
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", place.x, place.y, place.w, place.h);
    }
    pdf.save(activityPdfFilename(name));
  } finally {
    stage.remove();
  }
}
