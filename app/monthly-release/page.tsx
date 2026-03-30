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
      '本月更新聚焦兩個方向：一是每月人員狀態之獎金／津貼匯出精準化，二是活動發布與商品部缺貨流程穩定化。整體目標為提升查閱效率、降低誤判並強化跨部門協作。',
    sections: [
      {
        title: '一、本月重點更新（精簡）',
        items: [
          '每月人員狀態匯出已升級為「當月獎金／津貼 PDF」整合版，含單品獎金、誤餐費、交通費用、育才津貼與春節出勤獎金。',
          '獎金／津貼欄位改為動態顯示：該月無資料即隱藏欄位，報表更精簡。',
          '跨店加總改為僅納入「當月該店 monthly_staff_status 有資料」的人員，避免未生效調店影響舊月份報表。',
          '活動檢視頁改為行銷部／商品部分區閱讀，店長端新增發布結果導流，查閱路徑更清楚。',
          '行銷圖檔流程改為 Storage 上傳，並支援拖曳排序；商品部上傳支援移除與重傳。',
          '缺貨管理新增分頁與篩選，並優化 Enter 搜尋與提醒彈窗觸發時機。'
        ]
      },
      {
        title: '二、對使用者的主要影響',
        style: 'highlight',
        paragraphs: [
          '報表判定更精準、畫面更易讀，門市在查核獎金與津貼時可更快完成對帳；同時，活動與缺貨相關流程的查閱與回覆操作更直覺，整體作業效率與穩定性均有提升。'
        ]
      },
      {
        title: '三、提醒事項',
        style: 'cards',
        items: [
          '各月份報表欄位可能不同，屬系統依當月實際資料動態顯示的正常行為。',
          '若資料與預期不符，請先確認當月人員狀態、獎金津貼資料與缺貨回覆是否已完成儲存。',
          '活動與商品部內容呈現路徑已調整，如與舊版畫面不同屬本次更新範圍。'
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