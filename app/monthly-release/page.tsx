import Link from 'next/link';
import { ArrowLeft, FileText, Sparkles } from 'lucide-react';

type ReleaseSection = {
  title: string;
  style?: 'highlight' | 'cards' | 'default';
  paragraphs?: string[];
  items?: string[];
};

type MonthlyRelease = {
  slug: string;
  eyebrow: string;
  monthLabel: string;
  title: string;
  summary: string;
  sections: ReleaseSection[];
};

const monthlyReleases: MonthlyRelease[] = [
  {
    slug: '2026-03',
    eyebrow: '2026年3月更新摘要',
    monthLabel: '2026年3月',
    title: '2026年3月 系統版更公告',
    summary:
      '為提升每月人員狀態相關報表的正確性與查閱便利性，本月已完成獎金／津貼 PDF 匯出功能優化。本次調整主要針對報表整合、欄位顯示方式、跨店資料判定與內容可讀性進行改善，讓門市主管與相關管理人員在查閱當月資料時，能更快速掌握重點並降低核對誤差。',
    sections: [
      {
        title: '一、本月完成之功能調整',
        items: [
          '當月匯出功能已由原本單一獎金報表，調整為「當月獎金／津貼 PDF」整合格式。系統會依當月實際資料，自動整合顯示單品獎金、誤餐費、交通費用、育才津貼及春節出勤獎金等項目。',
          '報表欄位顯示方式已優化。若該月份某項獎金或津貼沒有資料，系統將自動隱藏整個欄位，避免報表中出現無內容的空白欄位，讓整體版面更精簡清楚。',
          '單品獎金來源資訊已補強。若同仁當月單品獎金包含其他門市來源，報表中將顯示加總後金額，並保留來源門市與對應金額資訊，以利後續查核與對帳。',
          '誤餐費顯示與計算方式已統一。系統會依登記資料與人員類型計算實際金額，並於報表中顯示簡潔資訊，讓使用者可快速確認金額與筆數。',
          '報表版面與閱讀性已進一步調整。表格標題與內容目前已統一為較一致的排列方式，以提升畫面檢視與列印輸出時的可讀性。'
        ]
      },
      {
        title: '二、資料判定邏輯調整說明',
        style: 'highlight',
        paragraphs: [
          '本次同步修正跨店資料帶入規則。匯出指定月份、指定門市之當月獎金／津貼 PDF 時，若涉及跨店加總資料，系統現在僅會納入該月份確實存在於該店每月人員狀態資料中的人員。',
          '此項調整可避免因未來才生效之調店異動，提前影響先前月份報表內容，進一步提升歷史報表的正確性與一致性。'
        ]
      },
      {
        title: '三、對使用者之實際影響',
        style: 'cards',
        items: [
          '門市與管理人員在匯出報表時，可一次取得更完整的當月獎金與津貼資訊。',
          '舊月份報表的資料判定將更準確，不會因未來異動紀錄而誤帶人員。',
          '跨店獎金來源與金額明細更清楚，有助於後續對帳與確認。',
          '各月份報表將依實際資料自動顯示不同欄位，屬正常設計行為。'
        ]
      },
      {
        title: '四、提醒事項',
        items: [
          '若該月份沒有登記特定津貼或獎金，該欄位將不顯示。',
          '若人員未列入該月份該門市之每月人員狀態資料，即不會被納入該月報表的跨店加總範圍。',
          '若發現報表內容與實際登記資料不符，建議先確認當月人員狀態、相關獎金資料與津貼紀錄是否已完成登錄。'
        ]
      }
    ]
  }
];

export default function MonthlyReleasePage() {
  const latestRelease = monthlyReleases[0];

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-4 sm:px-4 sm:py-6 lg:p-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <p className="mb-2 text-sm font-semibold tracking-[0.2em] text-amber-600">MONTHLY RELEASE</p>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl lg:text-4xl">每月版更內容</h1>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-amber-300 hover:text-amber-700"
          >
            <ArrowLeft className="h-4 w-4" />
            返回首頁
          </Link>
        </div>

        <section className="mb-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900 sm:text-xl">月份清單</h2>
                <p className="mt-1 text-sm text-gray-600">之後只要新增月份資料，即可持續累積每月公告內容。</p>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                共 {monthlyReleases.length} 期
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {monthlyReleases.map((release, index) => (
                <a
                  key={release.slug}
                  href={`#${release.slug}`}
                  className="group rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:border-amber-300 hover:bg-amber-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{release.monthLabel}</div>
                      <p className="mt-1 text-xs leading-6 text-gray-600">{release.title}</p>
                    </div>
                    {index === 0 && (
                      <span className="rounded-full bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white">
                        最新
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
        </section>

        {monthlyReleases.map((release) => {
            const isLatest = release.slug === latestRelease.slug;

            return (
              <details
                key={release.slug}
                id={release.slug}
                open={isLatest}
                className="group mb-6 overflow-hidden rounded-3xl border border-amber-100 bg-white shadow-xl shadow-amber-100/40 last:mb-0"
              >
                <summary className="cursor-pointer list-none">
                  <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 px-6 py-8 text-white sm:px-8 sm:py-10">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-medium backdrop-blur-sm">
                        <Sparkles className="h-4 w-4" />
                        {release.eyebrow}
                      </div>
                      <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm">
                        {isLatest ? '最新公告' : '點擊展開'}
                      </span>
                    </div>

                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h2 className="text-2xl font-bold leading-tight sm:text-3xl">{release.title}</h2>
                        <p className="mt-4 max-w-3xl text-sm leading-7 text-orange-50 sm:text-base">{release.summary}</p>
                      </div>
                      <div className="flex items-center gap-3 text-sm font-medium text-white/90">
                        <span>{release.monthLabel}</span>
                        <span className="transition-transform group-open:rotate-180">⌄</span>
                      </div>
                    </div>
                  </div>
                </summary>

                <div className="space-y-8 px-6 py-8 sm:px-8 sm:py-10">
                  {release.sections.map((section) => (
                    <section
                      key={section.title}
                      className={section.style === 'highlight' ? 'rounded-2xl border border-orange-100 bg-orange-50/60 p-5 sm:p-6' : ''}
                    >
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                          <FileText className="h-5 w-5" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900">{section.title}</h3>
                      </div>

                      {section.paragraphs?.map((paragraph) => (
                        <p key={paragraph} className="mt-3 text-sm leading-7 text-gray-700 first:mt-0 sm:text-base">
                          {paragraph}
                        </p>
                      ))}

                      {section.items && section.style === 'cards' && (
                        <ol className="grid gap-3 sm:grid-cols-2">
                          {section.items.map((item) => (
                            <li
                              key={item}
                              className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm leading-7 text-gray-700 sm:text-base"
                            >
                              {item}
                            </li>
                          ))}
                        </ol>
                      )}

                      {section.items && section.style !== 'cards' && (
                        <ol className="space-y-4 pl-6 text-sm leading-7 text-gray-700 sm:text-base">
                          {section.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ol>
                      )}
                    </section>
                  ))}
                </div>
              </details>
            );
          })}
      </div>
    </div>
  );
}