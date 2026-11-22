import { describe, expect, it } from 'vitest';
import { buildExportCsv, csvTextCell } from '@/lib/workspace/general-affairs/payment-request-rules';

// 第 4.5 批審查修正：對帳 CSV 的統編與銀行帳號在試算表會掉前導 0 或變科學記號，輸出成文字格式（="…"）；其他欄位仍照公式注入規則處理。
describe('csvTextCell（統編、銀行帳號）', () => {
  it('只含數字與連字號的內容輸出成 ="…"，保留前導 0', () => {
    expect(csvTextCell('0012345678')).toBe('"=""0012345678"""');
    expect(csvTextCell('012-34-567890')).toBe('"=""012-34-567890"""');
    expect(csvTextCell('12345678901234567')).toBe('"=""12345678901234567"""');
  });
  it('空值照舊輸出空字串', () => {
    expect(csvTextCell(null)).toBe('');
    expect(csvTextCell(undefined)).toBe('');
  });
  it('含其他字元的內容回到一般規則（公式注入防護、逗號加引號）', () => {
    expect(csvTextCell('=1+1')).toBe("'=1+1");
    expect(csvTextCell('-123abc')).toBe("'-123abc");
    expect(csvTextCell('A1,B2')).toBe('"A1,B2"');
    expect(csvTextCell('123"456')).toBe('"123""456"');
  });
  it('注入字串不會被包成 ="…" 公式', () => {
    expect(csvTextCell('=cmd|calc')).not.toContain('="');
    expect(csvTextCell('0123=1')).not.toMatch(/^"=""/);
  });
});

describe('對帳 CSV 的統編與帳號欄', () => {
  const rows = [{ pr_no: 'PY-20261120-001', status: 'PAID', created_at: '2026-11-20T02:00:00Z', vendor_name: 'QA 廠商', vendor_tax_id: '00123456', bank_name: '測試銀行', bank_account: '0098765432101', claim_total: 1050 }];
  it('有廠商權限：統編與帳號是文字格式，前導 0 保留', () => {
    const csv = buildExportCsv(rows, true);
    expect(csv).toContain('"=""00123456"""');
    expect(csv).toContain('"=""0098765432101"""');
    expect(csv).toContain('測試銀行');
  });
  it('沒有廠商權限：整欄省略，也沒有帳號內容', () => {
    const csv = buildExportCsv(rows, false);
    expect(csv).not.toContain('00123456');
    expect(csv).not.toContain('0098765432101');
    expect(csv).not.toContain('廠商統編');
  });
});
