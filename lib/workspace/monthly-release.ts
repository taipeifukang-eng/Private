// W04：每月版更說明頁的內容資料（無相依，Vue 工作台、Vitest 與 Next 端都可直接引用）。
// 新增一期：把新的 MonthlyRelease 放在陣列「最前面」（最新在前）；頁面會自動把第一筆標為最新並預設展開。
// 目前只有 2026 年 3 月這一期，文字原文照搬舊版 app/monthly-release/page.tsx（W04-q1）。

export type ReleaseSection = {
  title: string;
  /** highlight：段落底色強調；cards：條列改為卡片；省略或 default：一般條列。 */
  style?: 'highlight' | 'cards' | 'default';
  paragraphs?: string[];
  items?: string[];
};

export type MonthlyRelease = {
  /** 期別代號，格式 YYYY-MM，同時作為頁面錨點 id。 */
  slug: string;
  eyebrow: string;
  monthLabel: string;
  title: string;
  summary: string;
  sections: ReleaseSection[];
};

export const MONTHLY_RELEASES: readonly MonthlyRelease[] = [
  {
    slug: '2026-03',
    eyebrow: '2026年3月更新摘要',
    monthLabel: '2026年3月',
    title: '2026年3月 系統版更公告',
    summary:
      '本月更新聚焦兩個方向：一是每月人員狀態之獎金／津貼匯出精準化，二是活動發布與商品部缺貨流程穩定化。整體目標為提升查閱效率、降低誤判並強化跨部門協作。',
    sections: [
      {
        title: '一、本月重點更新（精簡）',
        items: [
          '1.每月人員狀態匯出已升級為「當月獎金／津貼 PDF」整合版，含單品獎金、誤餐費、交通費用、育才津貼與春節出勤獎金。',
          '2.獎金／津貼欄位改為動態顯示：該月無資料即隱藏欄位，報表更精簡。',
          '3.跨店加總改為僅納入「當月該店有資料」的人員，避免未生效調店影響舊月份報表。',
          '4.活動檢視頁改為行銷部／商品部分區閱讀，店長端新增發布結果導流，查閱路徑更清楚。',
          '5.行銷圖檔流程改為 Storage 上傳，並支援拖曳排序；商品部上傳支援移除與重傳。',
          '6.缺貨管理新增分頁與篩選，並優化 Enter 搜尋與提醒彈窗觸發時機。',
        ],
      },
      {
        title: '二、對使用者的主要影響',
        style: 'highlight',
        paragraphs: [
          '報表判定更精準、畫面更易讀，門市在查核獎金與津貼時可更快完成對帳；同時，活動與缺貨相關流程的查閱與回覆操作更直覺，整體作業效率與穩定性均有提升。',
        ],
      },
      {
        title: '三、提醒事項',
        style: 'cards',
        items: [
          '各月份報表欄位可能不同，屬系統依當月實際資料動態顯示的正常行為。',
          '若資料與預期不符，請先確認當月人員狀態、獎金津貼資料與缺貨回覆是否已完成儲存。',
          '活動與商品部內容呈現路徑已調整，如與舊版畫面不同屬本次更新範圍。',
        ],
      },
    ],
  },
];

/** 期別資料檢查：slug 格式與唯一、最新在前（slug 遞減）、必要欄位非空。回傳錯誤訊息清單，空陣列代表通過。 */
export function validateReleases(releases: readonly MonthlyRelease[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  releases.forEach((r, i) => {
    const tag = `releases[${i}](${r.slug})`;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.slug)) errors.push(`${tag} slug 格式必須是 YYYY-MM`);
    if (seen.has(r.slug)) errors.push(`${tag} slug 重複`);
    seen.add(r.slug);
    if (i > 0 && releases[i - 1].slug <= r.slug) errors.push(`${tag} 必須比前一期更舊（最新在前）`);
    for (const key of ['eyebrow', 'monthLabel', 'title', 'summary'] as const) {
      if (!r[key]?.trim()) errors.push(`${tag} 缺少 ${key}`);
    }
    if (!r.sections.length) errors.push(`${tag} 至少要有一個段落`);
    r.sections.forEach((s, j) => {
      if (!s.title.trim()) errors.push(`${tag} sections[${j}] 缺少 title`);
      if (!s.paragraphs?.length && !s.items?.length) errors.push(`${tag} sections[${j}] 沒有內容`);
    });
  });
  return errors;
}
