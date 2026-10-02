'use client';

type PrintCategory = {
  id: string;
  name: string;
  status: string;
};

type PrintRegion = {
  id: string;
  name: string;
  region_type: string;
  status: string;
};

type VendorInformationPrintFormProps = {
  categories: PrintCategory[];
  regions: PrintRegion[];
};

function Field({ label, wide = false }: { label: string; wide?: boolean }) {
  return (
    <div className={wide ? 'ga-vendor-print-field ga-vendor-print-wide' : 'ga-vendor-print-field'}>
      <span>{label}</span>
      <i />
    </div>
  );
}

function Check({ label }: { label: string }) {
  return <span className="ga-vendor-print-check">□ {label}</span>;
}

export default function VendorInformationPrintForm({ categories, regions }: VendorInformationPrintFormProps) {
  const activeCategories = categories.filter((category) => category.status === 'active');
  const activeCities = regions.filter((region) => region.status === 'active' && region.region_type === 'city');

  return (
    <div className="ga-vendor-print-sheet" aria-hidden="true">
      <style jsx global>{`
        .ga-vendor-print-sheet { display: none; }
        @page { size: A4 portrait; margin: 10mm; }
        @media print {
          body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .ga-vendor-print-sheet,
          .ga-vendor-print-sheet * { visibility: visible !important; }
          .ga-vendor-print-sheet {
            display: block !important;
            position: absolute;
            inset: 0;
            width: 100%;
            color: #111827;
            font-family: Arial, "Noto Sans TC", sans-serif;
            font-size: 10pt;
            line-height: 1.4;
          }
          .ga-vendor-print-page { min-height: 277mm; break-after: page; }
          .ga-vendor-print-page:last-child { break-after: auto; }
          .ga-vendor-print-title { border-bottom: 2px solid #111827; padding-bottom: 4mm; }
          .ga-vendor-print-title h1 { margin: 0; font-size: 18pt; letter-spacing: 0; }
          .ga-vendor-print-title p { margin: 1mm 0 0; color: #4b5563; font-size: 9pt; }
          .ga-vendor-print-section { margin-top: 5mm; break-inside: avoid; }
          .ga-vendor-print-section h2 {
            margin: 0 0 2.5mm;
            border-bottom: 1px solid #9ca3af;
            padding-bottom: 1.5mm;
            font-size: 11pt;
          }
          .ga-vendor-print-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 7mm; }
          .ga-vendor-print-field { display: grid; grid-template-columns: auto 1fr; align-items: end; gap: 2mm; min-height: 8mm; }
          .ga-vendor-print-field span { white-space: nowrap; font-weight: 700; }
          .ga-vendor-print-field i { display: block; min-width: 20mm; border-bottom: 1px solid #374151; }
          .ga-vendor-print-wide { grid-column: 1 / -1; }
          .ga-vendor-print-options { display: flex; flex-wrap: wrap; gap: 2.5mm 6mm; }
          .ga-vendor-print-check { white-space: nowrap; }
          .ga-vendor-print-lines { min-height: 18mm; background: repeating-linear-gradient(to bottom, transparent 0, transparent 7mm, #9ca3af 7mm, #9ca3af 7.2mm); }
          .ga-vendor-print-check-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2.5mm 4mm; }
          .ga-vendor-print-note { margin-top: 3mm; color: #4b5563; font-size: 8.5pt; }
          .ga-vendor-print-signature { margin-top: 8mm; display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
        }
      `}</style>

      <section className="ga-vendor-print-page">
        <header className="ga-vendor-print-title">
          <h1>合作廠商基本資料填寫表</h1>
          <p>請填寫可提供的資料；完成後交回聯絡窗口，由總務人員登錄公司系統。</p>
        </header>

        <section className="ga-vendor-print-section">
          <h2>一、公司基本資料</h2>
          <div className="ga-vendor-print-grid">
            <Field label="廠商名稱＊" />
            <div className="ga-vendor-print-options"><strong>廠商類型＊</strong><Check label="公司" /><Check label="工作室" /><Check label="個人工作室" /></div>
            <Field label="統一編號" />
            <Field label="品牌名稱／別名" />
            <Field label="成立日期" />
            <Field label="公司電話" />
            <Field label="傳真號碼" />
            <Field label="公司網站" />
            <Field label="公司地址" wide />
            <div className="ga-vendor-print-wide ga-vendor-print-options"><strong>服務地址</strong><Check label="同公司地址" /><Check label="不同，請填下方" /></div>
            <Field label="服務地址" wide />
          </div>
        </section>

        <section className="ga-vendor-print-section">
          <h2>二、主要聯絡人</h2>
          <div className="ga-vendor-print-grid">
            <Field label="姓名" />
            <Field label="手機" />
            <Field label="LINE ID" />
            <Field label="Email" />
          </div>
        </section>

        <section className="ga-vendor-print-section">
          <h2>三、發票與付款資料</h2>
          <div className="ga-vendor-print-grid">
            <Field label="發票抬頭" />
            <div className="ga-vendor-print-options"><strong>發票類型</strong><Check label="二聯式" /><Check label="三聯式" /><Check label="電子發票" /></div>
            <Field label="發票地址" wide />
            <div className="ga-vendor-print-options"><strong>付款條件</strong><Check label="月結30天" /><Check label="月結45天" /><Check label="現結" /><Check label="其他" /></div>
            <div className="ga-vendor-print-options"><strong>付款方式</strong><Check label="匯款" /><Check label="支票" /><Check label="現金" /><Check label="其他" /></div>
          </div>
          <div className="ga-vendor-print-note">帳務補充：</div>
          <div className="ga-vendor-print-lines" />
        </section>

        <section className="ga-vendor-print-section">
          <h2>四、公司簡介</h2>
          <div className="ga-vendor-print-lines" style={{ minHeight: '35mm' }} />
        </section>

        <p className="ga-vendor-print-note">＊為系統建檔必要資訊；其他欄位若不適用可留白。</p>
      </section>

      <section className="ga-vendor-print-page">
        <header className="ga-vendor-print-title">
          <h1>合作廠商服務資料</h1>
          <p>請勾選可承作項目與服務範圍，並補充熟悉品牌、設備或專業能力。</p>
        </header>

        <section className="ga-vendor-print-section">
          <h2>五、可提供的服務項目</h2>
          <div className="ga-vendor-print-check-grid">
            {activeCategories.map((category) => <Check key={category.id} label={category.name} />)}
            <Check label="其他：________________" />
          </div>
          {activeCategories.length === 0 && <div className="ga-vendor-print-lines" />}
        </section>

        <section className="ga-vendor-print-section">
          <h2>六、可服務縣市</h2>
          <div className="ga-vendor-print-check-grid">
            {activeCities.map((region) => <Check key={region.id} label={region.name} />)}
            <Check label="全台" />
            <Check label="其他：________________" />
          </div>
          <p className="ga-vendor-print-note">特定行政區或服務限制：</p>
          <div className="ga-vendor-print-lines" />
        </section>

        <section className="ga-vendor-print-section">
          <h2>七、熟悉品牌與設備類型</h2>
          <div className="ga-vendor-print-note">熟悉品牌：</div>
          <div className="ga-vendor-print-lines" />
          <div className="ga-vendor-print-note">可處理的設備／設施類型：</div>
          <div className="ga-vendor-print-lines" />
        </section>

        <section className="ga-vendor-print-section">
          <h2>八、服務能力與合作補充</h2>
          <div className="ga-vendor-print-lines" style={{ minHeight: '42mm' }} />
        </section>

        <section className="ga-vendor-print-section">
          <h2>九、隨表提供資料</h2>
          <div className="ga-vendor-print-options">
            <Check label="公司／商業登記資料" />
            <Check label="匯款帳戶資料" />
            <Check label="產品型錄" />
            <Check label="報價單" />
            <Check label="其他" />
          </div>
        </section>

        <div className="ga-vendor-print-signature">
          <Field label="填表人簽名" />
          <Field label="填表日期" />
        </div>
      </section>
    </div>
  );
}
