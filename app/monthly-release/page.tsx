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
      '為提升每月人員狀態相關報表之正確性、完整性與查閱效率，系統已於本月完成當月獎金／津貼 PDF 匯出功能優化。本次調整涵蓋報表整合、欄位顯示邏輯、跨店資料判定與版面可讀性優化，協助各門市主管及管理人員於查閱與核對當月資料時，能更有效掌握內容並降低判讀落差。',
    sections: [
      {
        title: '一、本月完成之功能調整',
        items: [
          '原單一獎金匯出功能已調整為「當月獎金／津貼 PDF」整合格式。系統將依當月實際登錄資料，自動整合顯示單品獎金、誤餐費、交通費用、育才津貼及春節出勤獎金等項目。',
          '報表欄位顯示邏輯已同步優化。若該月份某項獎金或津貼無資料，系統將自動隱藏該欄位，以避免空白欄位影響閱讀與判讀。',
          '單品獎金來源資訊已進一步補強。若同仁當月單品獎金包含其他門市來源，報表中將顯示加總後金額，並保留來源門市與對應金額明細，以利後續查核與對帳。',
          '誤餐費顯示與計算方式已統一。系統將依登記資料與人員類型計算實際金額，並以較簡潔方式呈現於報表中，方便快速確認。',
          '報表版面與可讀性已進一步調整，包含表格標題與內容排列方式一致化，以提升畫面檢視與列印輸出時之整體清晰度。'
        ]
      },
      {
        title: '二、資料判定邏輯調整說明',
        style: 'highlight',
        paragraphs: [
          '本次同步修正跨店資料帶入規則。匯出指定月份、指定門市之當月獎金／津貼 PDF 時，如涉及跨店加總資料，系統僅納入該月份確實存在於該店每月人員狀態資料中的人員。',
          '此項調整可避免尚未生效之未來調店異動，提前影響既有月份之報表內容，進一步提升歷史報表資料之正確性與一致性。'
        ]
      },
      {
        title: '三、對使用者之實際影響',
        style: 'cards',
        items: [
          '門市及管理人員於匯出報表時，可一次取得更完整之當月獎金與津貼資訊。',
          '歷史月份報表之資料判定將更為準確，不再因未來異動紀錄而提前帶入不應顯示之人員。',
          '跨店獎金來源與金額明細呈現更清楚，有助於後續對帳、確認與內部溝通。',
          '各月份報表將依實際登錄資料自動調整顯示欄位，屬系統正常設計行為。'
        ]
      },
      {
        title: '四、提醒事項',
        items: [
          '若該月份未登記特定津貼或獎金資料，報表中將不顯示對應欄位。',
          '若人員未列入該月份該門市之每月人員狀態資料，即不納入該月份報表之跨店加總範圍。',
          '如發現報表內容與實際登錄資料不符，請優先確認當月人員狀態、相關獎金資料與津貼紀錄是否已完成登錄。'
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