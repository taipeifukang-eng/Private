import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as X from 'xlsx';
import { integrate, normalize, rowsFromBuffer, finalRows } from '../../../vue-workspace/src/lib/inventory-files';
import { firstSheet, legacyModule1, legacyModule2, legacyModule3, legacyParseBase, legacyParseExternal, legacyParseFks, legacyParseModified } from '../../support/m6-legacy-inventory';

/**
 * 真實檔案新舊對跑（檔案不在版控內）：M6_REAL_DIR 指向放有四個真實檔的資料夾，沒設定就整個略過。
 * M6_REAL_OUT 可指定輸出摘要資料夾（只寫計數與差異，不寫店名）。
 * 需要檔名：1F當日商品資料.xlsx、FKS0701盤點紀錄.xlsx、外盤公司原始檔.xlsx、外盤公司盤點Stock明細檔.xlsx
 */
const DIR = process.env.M6_REAL_DIR;
const OUT = process.env.M6_REAL_OUT;
const F = { base: '1F當日商品資料.xlsx', fks: 'FKS0701盤點紀錄.xlsx', ext: '外盤公司原始檔.xlsx', mod: '外盤公司盤點Stock明細檔.xlsx' };
const bytes = (n: string) => new Uint8Array(fs.readFileSync(path.join(DIR!, n)));
const sheet = (n: string) => firstSheet(bytes(n));
const log: any = {};
const save = () => { if (OUT) fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(log, null, 2)); };
const cmp = (a: any[], b: any[], name: string) => {
  const d: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) d.push(`${name}[${i}] ${JSON.stringify(a[i])} | ${JSON.stringify(b[i])}`);
  return d;
};

describe.skipIf(!DIR)('M6-W25 真實檔案新舊對跑', () => {
  it('三模組逐列相等', async () => {
    const lb = legacyParseBase(sheet(F.base));
    log.legacyBaseOk = lb.ok;
    if (!lb.ok) { log.legacyBaseMsg = lb.message; save(); }
    expect(lb.ok).toBe(true);
    if (!lb.ok) return;
    let nb: any[] = [];
    try { nb = normalize(await rowsFromBuffer(bytes(F.base), true), 'base'); } catch (e) { log.newBaseError = (e as Error).message.split('\n')[0]; save(); throw e; }
    log.base = { legacy: lb.value.length, new: nb.length };
    const pick = (r: any) => ({ 品號: r.品號, 品名: String(r.品名 ?? ''), UN: String(r.UN ?? ''), 條碼: String(r.條碼 ?? ''), 庫存: Number(r.庫存), 主要儲位: String(r.主要儲位 ?? '') });
    const lbn = lb.value;
    const diffBase = cmp(lbn, nb.map(pick), 'base');
    log.baseDiffCount = diffBase.length;
    log.baseDiffSample = diffBase.slice(0, 5);
    log.baseNaNStock = lbn.filter((r) => Number.isNaN(r.庫存)).length;
    log.baseBlankCode = lbn.filter((r) => r.品號 === '').length;
    log.baseCodeLens = [...new Set(lbn.map((r) => r.品號.length))];
    log.baseNon8DigitNumeric = lbn.filter((r) => /^\d+$/.test(r.品號) && r.品號.length !== 8).length;
    log.baseDupCodes = lbn.length - new Set(lbn.map((r) => r.品號)).size;

    const lExt = legacyParseExternal(sheet(F.ext));
    const lFks = legacyParseFks(sheet(F.fks));
    const lMod = legacyParseModified(sheet(F.mod));
    if (!lExt.ok || !lFks.ok || !lMod.ok) { log.inputOk = [lExt.ok, lFks.ok, lMod.ok]; save(); throw new Error('舊版讀檔失敗 ' + JSON.stringify(log.inputOk)); }
    const ext = normalize(await rowsFromBuffer(bytes(F.ext)), 'external');
    const fks = normalize(await rowsFromBuffer(bytes(F.fks)), 'fks');
    const mod = normalize(await rowsFromBuffer(bytes(F.mod)), 'modified');
    log.inputs = { ext: [lExt.value.length, ext.length], fks: [lFks.value.length, fks.length], mod: [lMod.value.length, mod.length] };
    log.inputCodeCheck = {
      extNon8: ext.filter((r) => /^\d+$/.test(r.品號) && r.品號.length !== 8).length,
      fksNon8: fks.filter((r) => /^\d+$/.test(r.品號) && r.品號.length !== 8).length,
      modNon8: mod.filter((r) => /^\d+$/.test(r.品號) && r.品號.length !== 8).length,
    };

    const l1 = legacyModule1(lbn, lExt.value, lFks.value);
    const x1 = integrate(nb, [...ext, ...fks]);
    const codes1 = new Set(x1.diff.map((r: any) => r.品號));
    const n1 = ext.filter((r) => codes1.has(r.品號)).map((r) => ({ 品號: r.品號 }));
    log.m1 = { legacy: l1.length, new: n1.length, equal: JSON.stringify(l1) === JSON.stringify(n1), sample: l1.slice(0, 3) };

    const l2 = legacyModule2(lbn, [], lFks.value, lMod.value);
    const n2 = integrate(nb, [...fks, ...mod]);
    log.m2 = { diff: [l2.diff.length, n2.diff.length], zero: [l2.zero.length, n2.zero.length], missing: [l2.missing.length, n2.missing.length] };
    const d2 = [...cmp(l2.diff, n2.diff, 'diff'), ...cmp(l2.zero, n2.zero, 'zero'), ...cmp(l2.missing, n2.missing, 'missing')];
    log.m2DiffCount = d2.length;
    log.m2DiffSample = d2.slice(0, 6);
    const byCode = (a: any, b: any) => a.品號.localeCompare(b.品號);
    log.m2ZeroSetEqual = JSON.stringify([...l2.zero].sort(byCode)) === JSON.stringify([...n2.zero].sort(byCode));

    const asJson = (rows: any[]) => X.utils.sheet_to_json(X.utils.json_to_sheet(rows)) as any[];
    const l3 = legacyModule3(l2.zero, asJson(l2.diff), asJson(l2.missing));
    const roundTrip = async (rows: any[], kind: string) => {
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), 'Sheet1');
      return normalize(await rowsFromBuffer(new Uint8Array(X.write(wb, { type: 'array', bookType: 'xlsx' })), false), kind);
    };
    const r = finalRows(n2.zero, await roundTrip(n2.diff, 'internal'), await roundTrip(n2.missing, 'missing'));
    log.m3 = { legacy: l3.length, new: r.ok ? r.rows.length : 'BLOCKED', blocked: !r.ok };
    if (!r.ok) log.m3ConflictSample = r.conflicts.slice(0, 5).map((c) => ({ code: c.code, kind: c.kind, detail: c.detail }));
    if (r.ok) {
      const np = r.rows.map((x) => ({ 品號: x.品號, 庫存量: x.庫存量, 實際量: x.實際量, 盤差量: x.盤差量 }));
      const d3 = cmp(l3, np, 'm3');
      log.m3DiffCount = d3.length; log.m3DiffSample = d3.slice(0, 6);
      log.m3SetEqual = JSON.stringify([...l3].sort(byCode)) === JSON.stringify([...np].sort(byCode));
      log.m3NonZeroDiff = np.filter((x) => x.盤差量 !== 0).length;
    }
    save();
    expect(n1).toEqual(l1);
  });
});
