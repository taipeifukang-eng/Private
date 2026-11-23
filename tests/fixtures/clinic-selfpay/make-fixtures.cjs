'use strict';
/**
 * 診所自費藥毛利（M6 W30/W31）自造測試檔產生器。真實去識別樣本（Z4 診所價格檔、診所檔）尚未提供，所以先依舊版解析程式的規則自造：
 *   - 全部是假資料：診所「測試診所甲／乙」、假健保碼 ZT* 開頭、假品號、期間 2038 年（民國 127 年）、只對 VW／ZT 測試門市使用。
 *   - 價格檔：每月一個工作表 YYYY-MM、欄位別名（健保碼／健保代號、自費藥名稱／藥品名稱、品號／商品編號、品名／商品名稱、會員價／會員售價、成本／成本價）、
 *     同月同健保碼重複（保留最後一筆）、小寫與前後空白的健保碼、缺品號的列（略過）、金額為文字（含千分位）、品號前導零（文字）、非月份工作表（忽略）。
 *   - 診所檔：與舊版 batches/import 相同的版面（B4 結算期間民國年、B6 診所區間、B14 診所別、A 欄健保碼與藥名、數量欄優先順序 M、L、K、J、N）、
 *     6 個固定排除的健保碼、「無健保碼」、表頭與 Count 列、空白列、數量 0、數字為文字（含單位）、前導零、重複代碼（各算一列）、列內診所別行。
 * 用法：node tests/fixtures/clinic-selfpay/make-fixtures.cjs        -> 在本資料夾寫出 .xlsx / .xls
 *       const { buildAll } = require('./make-fixtures.cjs')          -> 測試直接取得 Buffer
 * 真實樣本到位後以 tests/parity/M6-W30.real-sample.spec.ts 補比對（樣本放 盤點測試檔/，不進版控）。
 */
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require(path.resolve(__dirname, '..', '..', '..', 'node_modules', 'xlsx'));

const EXCLUDED = ['A100000100', 'B200000100', 'A400000100', 'B100000100', 'B000000100', 'A900000100'];

/** 價格主檔的標準內容（2038-11）：測試與預期值共用。 */
const PRICES_2038_11 = [
  { code: 'ZTA000001', selfpay: '測試藥品甲錠', product: '00012345', name: 'DPOS 測試甲', member: 100, cost: 60 },
  { code: 'ZTA000002', selfpay: '測試藥品乙膠囊', product: '00012346', name: 'DPOS 測試乙', member: 250.5, cost: 180.25 },
  { code: 'ZTA000003', selfpay: '測試藥品丙液', product: '00012347', name: 'DPOS 測試丙', member: 59, cost: 30 },
  { code: 'ZTB000010', selfpay: '測試藥品丁粉', product: '00012348', name: 'DPOS 測試丁', member: 1250.5, cost: 900 },
];

function sheet(aoa) {
  return XLSX.utils.aoa_to_sheet(aoa);
}
function book(sheets, bookType = 'xlsx') {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) XLSX.utils.book_append_sheet(wb, sheet(aoa), name);
  return XLSX.write(wb, { type: 'buffer', bookType });
}

/* ---------------- 價格檔 ---------------- */
function priceMultiMonth() {
  const std = ['健保碼', '自費藥名稱', '品號', '品名', '會員價', '成本'];
  const alias = ['健保代號', '藥品名稱', '商品編號', '商品名稱', '會員售價', '成本價'];
  const m11 = [
    std,
    ['ZTA000001', '測試藥品甲錠', '00012345', 'DPOS 測試甲', 100, 60],
    ['ZTA000002', '測試藥品乙膠囊', '00012346', 'DPOS 測試乙', '250.50', '180.25'], // 金額為文字
    [' zta000003 ', '測試藥品丙液', '00012347', 'DPOS 測試丙', 59, 30], // 小寫、前後空白
    ['ZTB000010', '測試藥品丁粉（舊價）', '00012348', 'DPOS 測試丁', 1000, 700], // 下面還有一筆同代碼，保留最後一筆
    ['ZTB000010', '測試藥品丁粉', '00012348', 'DPOS 測試丁', '1,250.5', '900'], // 千分位文字、最後一筆
    ['ZTX000099', '缺品號的藥', '', '缺品號', 10, 5], // 缺品號：略過
    ['', '缺健保碼的藥', '00099999', '缺健保碼', 10, 5], // 缺健保碼：略過
  ];
  const m10 = [
    alias,
    ['ZTA000001', '測試藥品甲錠', '00012345', 'DPOS 測試甲', 90, 55],
    ['ZTA000002', '測試藥品乙膠囊', '00012346', 'DPOS 測試乙', 240, 170],
    ['ZTB000010', '測試藥品丁粉', '00012348', 'DPOS 測試丁', 1200, 850],
  ];
  return book([['2038-10', m10], ['2038-11', m11], ['備註', [['這個工作表名稱不是 YYYY-MM，會被忽略'], ['ZTA000001', 'x', 'y', 'z', 1, 1]]]]);
}
/** 單一工作表（名稱不是月份）：月份用畫面選的年月。 */
function priceSingleSheet() {
  return book([['Sheet1', [
    ['HIS代碼', '診所自費藥名稱', 'DPOS品號', 'DPOS品名', 'member_price', 'cost_price'],
    ...PRICES_2038_11.map((p) => [p.code, p.selfpay, p.product, p.name, p.member, p.cost]),
  ]]]);
}
function priceEmpty() {
  return book([['2038-11', [['健保碼', '自費藥名稱', '品號', '品名', '會員價', '成本']]]]);
}
/** 只有 2038-10 一個月份工作表（用來驗證關帳月份略過與只匯入該月）。 */
function priceOctOnly() {
  return book([['2038-10', [
    ['健保碼', '自費藥名稱', '品號', '品名', '會員價', '成本'],
    ['ZTA000001', '測試藥品甲錠（改價）', '00012345', 'DPOS 測試甲', 95, 58],
  ]]]);
}
/** 缺 ZTA000003、ZTB000010 的價格檔（2038-11）：用來造成診所檔有「未匹配藥品」。 */
function priceMissingSome() {
  return book([['2038-11', [
    ['健保碼', '自費藥名稱', '品號', '品名', '會員價', '成本'],
    ['ZTA000001', '測試藥品甲錠', '00012345', 'DPOS 測試甲', 100, 60],
    ['ZTA000002', '測試藥品乙膠囊', '00012346', 'DPOS 測試乙', 250.5, 180.25],
  ]]]);
}

/* ---------------- 診所檔 ---------------- */
/**
 * 版面（0 起算列索引）：1 B2 報表標題、3 B4 結算期間（民國年 7 碼～7 碼）、5 B6 診所區間、13 B14 診所別、14 表頭、15 起為資料。
 * qty：{ M, L, K, J, N }（欄位索引 12、11、10、9、13）。
 */
function claimRows({ period = '1271101~1271130', rangeCode = 'ZT038001', clinic = '測試診所甲', clinicLine, body }) {
  const rows = Array.from({ length: 15 }, () => []);
  rows[0][0] = '診所自費藥使用量（測試檔，假資料）';
  rows[1][1] = '測試藥局 ZT 報表';
  if (period) rows[3][1] = `結算期間：${period}`;
  if (rangeCode) rows[5][1] = `診所區間：${rangeCode}`;
  rows[13][1] = clinicLine === undefined ? `診所別：${rangeCode || 'ZT038001'}　${clinic}` : clinicLine;
  rows[14][0] = '健保代號';
  rows[14][1] = '藥品名稱';
  return rows.concat(body);
}
function line(a, name, qty = {}) {
  const r = [];
  r[0] = a;
  if (name !== undefined && name !== null) r[1] = name;
  const cols = { M: 12, L: 11, K: 10, J: 9, N: 13 };
  for (const [k, v] of Object.entries(qty)) r[cols[k]] = v;
  return r;
}
function claimBody() {
  return [
    line('ZTA000001', '測試藥品甲錠', { M: 10 }), //                  1 M 欄
    line('ZTA000002 測試藥品乙膠囊', null, { M: 0, L: 3 }), //      2 A 欄含藥名、M=0 退回 L
    line('ZTA000003', '測試藥品丙液', { K: 5 }), //                    3 只有 K
    line('ZTB000010', '測試藥品丁粉', { J: 2 }), //                    4 只有 J
    line('ZTB000010', '測試藥品丁粉', { N: 4 }), //                    5 同代碼第二列（各算一列）
    line('ZTA000001', '測試藥品甲錠', { M: '1,200' }), //              6 數量為文字（千分位）
    line('ZTA000002', '測試藥品乙膠囊', { M: '3顆' }), //              7 數量含單位
    line("'zta000003", '測試藥品丙液', { M: 1.5 }), //                 8 小寫＋引號的代碼、小數
    line('A100000100', '診察費（固定排除）', { M: 5 }), //             排除
    line('B200000100', '藥事服務費（固定排除）', { M: 5 }), //         排除
    line('A400000100', '固定排除三', { M: 5 }),
    line('B100000100', '固定排除四', { M: 5 }),
    line('B000000100', '固定排除五', { M: 5 }),
    line('A900000100', '固定排除六', { M: 5 }),
    line('無健保碼', '自費品項（無健保碼）', { M: 7 }), //             略過
    line('ZTA000001', '數量為 0 的列', { M: 0 }), //                   略過（數量 0）
    line('AB', '代碼太短', { M: 3 }), //                               略過（不像代碼）
    line('', '', {}), //                                               空白列
    line('Count: 8', '', {}), //                                       Count 列
  ];
}
function claimBasic(bookType = 'xlsx') {
  return book([['Sheet1', claimRows({ body: claimBody() })]], bookType);
}
/** 基本檔但結算期間是 2038-10（與畫面選 2038-11 不同）。 */
function claimOctober() {
  const b = claimBody();
  return book([['Sheet1', claimRows({ period: '1271001~1271031', body: [b[0], b[1], b[3]] })]]); // ZTA000001、ZTA000002、ZTB000010（十月價格都有）
}
/** 沒有結算期間：以畫面選的年月為準。 */
function claimNoPeriod() {
  return book([['Sheet1', claimRows({ period: '', body: claimBody().slice(0, 3) })]]);
}
/** 含價格主檔找不到的藥品（ZTU000001、ZTU000002）。 */
function claimUnmatched() {
  return book([['Sheet1', claimRows({ body: [
    line('ZTA000001', '測試藥品甲錠', { M: 2 }),
    line('ZTU000001', '測試未匹配藥甲', { M: 1 }),
    line('ZTU000002 測試未匹配藥乙', null, { M: 4 }),
    line('ZTU000001', '測試未匹配藥甲', { M: 9 }), // 同代碼同藥名只列一次
  ] })]]);
}
/** 沒有任何可用藥品：整份都是排除代碼與空列。 */
function claimEmpty() {
  return book([['Sheet1', claimRows({ body: [line('A100000100', '診察費', { M: 5 }), line('', '', {}), line('Count: 0', '', {})] })]]);
}
/** 診所乙：同月不同診所，用來驗證「同診所才算重複」。 */
function claimClinicB() {
  return book([['Sheet1', claimRows({ rangeCode: 'ZT038002', clinic: '測試診所乙', body: claimBody().slice(0, 3) })]]);
}
/** 沒有診所代碼（B6、B14 都沒有）：診所代碼為空。 */
function claimNoClinic() {
  return book([['Sheet1', claimRows({ rangeCode: '', clinicLine: '', body: claimBody().slice(0, 2) })]]);
}
/** 列內出現診所別行（最後一個診所別為準）。 */
function claimClinicInBody() {
  return book([['Sheet1', claimRows({ body: [
    line('ZTA000001', '測試藥品甲錠', { M: 1 }),
    ['', '診所別：ZT038009　測試診所丙'],
    line('ZTA000002', '測試藥品乙膠囊', { M: 1 }),
  ] })]]);
}
/** 單張 1x1 PNG（截圖用，假圖）。 */
/* ---------------- W31：多頁 PDF 用的大檔（60 個品項） ---------------- */
const MANY_CODES = Array.from({ length: 60 }, (_, i) => 'ZTM' + String(i + 1).padStart(6, '0'));
function priceMany() {
  return book([['2038-11', [
    ['健保碼', '自費藥名稱', '品號', '品名', '會員價', '成本'],
    ...MANY_CODES.map((c, i) => [c, '測試多頁藥' + (i + 1), '0009' + String(i + 1).padStart(4, '0'), 'DPOS 多頁' + (i + 1), 10 + i, 5 + i]),
  ]]]);
}
function claimMany() {
  return book([['Sheet1', claimRows({ rangeCode: 'ZT038009', clinic: '測試診所多頁', body: MANY_CODES.map((c, i) => line(c, '測試多頁藥' + (i + 1), { M: i + 1 })) })]]);
}

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function buildAll() {
  return {
    'price-multi-month.xlsx': priceMultiMonth(),
    'price-single-sheet.xlsx': priceSingleSheet(),
    'price-empty.xlsx': priceEmpty(),
    'price-oct-only.xlsx': priceOctOnly(),
    'price-missing-some.xlsx': priceMissingSome(),
    'claim-basic.xlsx': claimBasic('xlsx'),
    'claim-basic.xls': claimBasic('biff8'),
    'claim-october.xlsx': claimOctober(),
    'claim-no-period.xlsx': claimNoPeriod(),
    'claim-unmatched.xlsx': claimUnmatched(),
    'claim-empty.xlsx': claimEmpty(),
    'claim-clinic-b.xlsx': claimClinicB(),
    'claim-no-clinic.xlsx': claimNoClinic(),
    'claim-clinic-in-body.xlsx': claimClinicInBody(),
    'price-many.xlsx': priceMany(),
    'claim-many.xlsx': claimMany(),
    'screenshot-1.png': TINY_PNG,
  };
}

module.exports = { buildAll, MANY_CODES, EXCLUDED, PRICES_2038_11, TINY_PNG };

if (require.main === module) {
  const files = buildAll();
  for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(__dirname, name), buf);
  console.log(`已產生 ${Object.keys(files).length} 個測試檔到 ${__dirname}`);
}
