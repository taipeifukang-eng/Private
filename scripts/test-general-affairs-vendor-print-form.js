const fs = require('fs');
const path = require('path');

const root = process.cwd();
const serviceCenter = fs.readFileSync(path.join(root, 'components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx'), 'utf8');
const printForm = fs.readFileSync(path.join(root, 'components/general-affairs/vendors/VendorInformationPrintForm.tsx'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(serviceCenter.includes('匯出廠商填寫表'), 'vendor list must expose the printable vendor form action');
assert(serviceCenter.includes('onClick={() => window.print()}'), 'vendor form export must open the browser print workflow');
assert(serviceCenter.includes('<VendorInformationPrintForm categories={vendorCategories} regions={vendorRegions}'), 'print form must receive current service categories and regions');
assert(!serviceCenter.includes('匯出Excel'), 'non-functional vendor Excel export must not compete with the printable form');
assert(printForm.includes('@page { size: A4 portrait;'), 'vendor form must use an A4 print layout');
assert(printForm.includes("category.status === 'active'"), 'vendor form must only print active service categories');
assert(printForm.includes("region.region_type === 'city'"), 'vendor form must print configured service cities');
assert(printForm.includes('合作廠商基本資料填寫表'), 'vendor form must include the company information page');
assert(printForm.includes('合作廠商服務資料'), 'vendor form must include the service information page');
assert(!printForm.includes('優質廠商'), 'vendor-facing form must not expose internal preferred-vendor decisions');
assert(!printForm.includes('合作狀態'), 'vendor-facing form must not ask vendors to decide internal cooperation status');

console.log('General affairs vendor print form checks passed.');
