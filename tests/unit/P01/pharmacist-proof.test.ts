import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MOBILE_SAFE_MAX_UPLOAD_BYTES,
  PROOF_FIELD_HINT,
  PROOF_LIMIT_LABEL,
  PROOF_TOO_LARGE_MESSAGE,
  compressImageForMobile,
  isLicenseOverdue,
  isProofTooLarge,
  zoneTotals,
} from '../../../vue-workspace/src/pharmacist-proof';

// P01 單元層：藥師管理的繳費證明上限、執照逾期判斷、督導區合計。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('P01 繳費證明上限統一為 3.5 MB', () => {
  it('上限數值與畫面文字一致', () => {
    expect(MOBILE_SAFE_MAX_UPLOAD_BYTES).toBe(3.5 * 1024 * 1024);
    expect(PROOF_LIMIT_LABEL).toBe('3.5 MB');
    expect(PROOF_TOO_LARGE_MESSAGE).toBe('檔案過大，請壓縮至 3.5 MB 以內');
    expect(PROOF_FIELD_HINT).toContain('3.5 MB');
  });

  it('邊界：剛好 3.5 MB 可上傳，多 1 byte 就擋下（與舊版 size > 3.5MB 相同）', () => {
    expect(isProofTooLarge(0)).toBe(false);
    expect(isProofTooLarge(MOBILE_SAFE_MAX_UPLOAD_BYTES)).toBe(false);
    expect(isProofTooLarge(MOBILE_SAFE_MAX_UPLOAD_BYTES + 1)).toBe(true);
    // 舊版 API 實際上限 10 MB，介於 3.5 到 10 MB 的檔案在前端就被擋下，新舊一致。
    expect(isProofTooLarge(5 * 1024 * 1024)).toBe(true);
  });

  it('Pharmacists.vue 與 pharmacist-proof.ts 沒有殘留 10 MB 字樣，且使用共用常數', () => {
    const vue = read('vue-workspace/src/pages/Pharmacists.vue');
    const proof = read('vue-workspace/src/pharmacist-proof.ts');
    expect(vue).not.toMatch(/10\s*MB/i);
    expect(proof).not.toMatch(/10\s*MB/i);
    expect(vue).toContain('isProofTooLarge(upload.size)');
    expect(vue).toContain('PROOF_TOO_LARGE_MESSAGE');
    expect(vue).toContain('PROOF_FIELD_HINT');
    expect(vue).not.toMatch(/3\.5\s*\*\s*1024/);
  });

  it('非圖片（PDF）與小圖不壓縮，原樣回傳', async () => {
    const pdf = new File([new Uint8Array(10)], 'proof.pdf', { type: 'application/pdf' });
    expect(await compressImageForMobile(pdf)).toBe(pdf);
    const small = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' });
    expect(await compressImageForMobile(small)).toBe(small);
  });

  it('大於上限的 PDF 不會被壓縮，仍被判定過大', async () => {
    const big = new File([new Uint8Array(MOBILE_SAFE_MAX_UPLOAD_BYTES + 1)], 'proof.pdf', { type: 'application/pdf' });
    const out = await compressImageForMobile(big);
    expect(out).toBe(big);
    expect(isProofTooLarge(out.size)).toBe(true);
  });
});

describe('P01 執照更新日逾期（舊版：new Date(date) < new Date()）', () => {
  const now = new Date('2026-11-03T10:00:00+08:00');
  it('昨天逾期、今天（日期午夜早於現在）逾期、明天不逾期', () => {
    expect(isLicenseOverdue('2026-11-02', now)).toBe(true);
    expect(isLicenseOverdue('2026-11-03', now)).toBe(true);
    expect(isLicenseOverdue('2026-11-04', now)).toBe(false);
  });
  it('null、空字串、無法解析的值都不算逾期', () => {
    expect(isLicenseOverdue(null, now)).toBe(false);
    expect(isLicenseOverdue(undefined, now)).toBe(false);
    expect(isLicenseOverdue('', now)).toBe(false);
    expect(isLicenseOverdue('not-a-date', now)).toBe(false);
  });
  it('跨年與遠期日期', () => {
    expect(isLicenseOverdue('2025-12-31', now)).toBe(true);
    expect(isLicenseOverdue('2099-01-01', now)).toBe(false);
  });
  it('頁面確實使用共用判斷並標示欄名「執照更新日」', () => {
    const vue = read('vue-workspace/src/pages/Pharmacists.vue');
    expect(vue).toContain('isLicenseOverdue(r.license_renewal_date)');
    expect(vue).toContain('<th>執照更新日</th>');
    expect(vue).not.toContain('證照換照日');
  });
});

describe('P01 督導區合計（舊版卡片標頭：門市數、藥師數）', () => {
  it('加總各門市藥師數', () => {
    expect(zoneTotals({ stores: [{ pharmacistCount: 2 }, { pharmacistCount: 0 }, { pharmacistCount: 3 }] })).toEqual({ stores: 3, pharmacists: 5 });
  });
  it('空資料', () => {
    expect(zoneTotals({})).toEqual({ stores: 0, pharmacists: 0 });
    expect(zoneTotals({ stores: [] })).toEqual({ stores: 0, pharmacists: 0 });
  });
});
