import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * 診所自費藥毛利自造測試檔（M6 W30/W31）。真實去識別樣本尚未提供，所以以 tests/fixtures/clinic-selfpay/make-fixtures.cjs 產生。
 * 測試資料規則：只用 VW／ZT 測試門市、期間 2038；診所名稱、健保碼、品號全是假的。
 */
const dir = path.resolve(__dirname, '..', 'fixtures', 'clinic-selfpay');
const gen = createRequire(__filename)(path.join(dir, 'make-fixtures.cjs')) as {
  buildAll: () => Record<string, Buffer>;
  PRICES_2038_11: { code: string; selfpay: string; product: string; name: string; member: number; cost: number }[];
  EXCLUDED: string[];
  TINY_PNG: Buffer;
};

let cache: Record<string, Buffer> | null = null;
export const clinicFixtures = (): Record<string, Buffer> => (cache ||= gen.buildAll());
export const clinicFixture = (name: string): Buffer => {
  const buf = clinicFixtures()[name];
  if (!buf) throw new Error(`沒有這個診所測試檔：${name}`);
  return buf;
};
export const FIXTURE_DIR = dir;
export const { PRICES_2038_11, EXCLUDED, TINY_PNG } = gen;
export const fixtureOnDisk = (name: string) => path.join(dir, name);
export const fixtureFilesPresent = () => fs.readdirSync(dir).filter((f) => /\.(xlsx|xls|png)$/.test(f));

/** 診所基本檔（claim-basic）依規則算出的預期：8 筆明細、各筆數量與金額。 */
export const BASIC_EXPECTED = {
  clinicCode: 'ZT038001',
  clinicName: '測試診所甲',
  periodStart: '2038-11-01',
  periodEnd: '2038-11-30',
  items: [
    { code: 'ZTA000001', qty: 10 },
    { code: 'ZTA000002', qty: 3 },
    { code: 'ZTA000003', qty: 5 },
    { code: 'ZTB000010', qty: 2 },
    { code: 'ZTB000010', qty: 4 },
    { code: 'ZTA000001', qty: 1200 },
    { code: 'ZTA000002', qty: 3 },
    { code: 'ZTA000003', qty: 1.5 },
  ],
};
