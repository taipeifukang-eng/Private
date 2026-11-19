import { describe, expect, it } from 'vitest';
import {
  addDays, contractDue, describeWarning as _unused, CODE_RE, maskVendor, maskVendorOption, namesSimilar, normalizeCode, normalizeTaxId, normalizeVendorName, parseExpectedUpdatedAt, parseIdList,
  parseTreeFilters, parseVendorFilters, similarVendors, taipeiToday, taxIdChecksumOk, vendorAbilities, vendorDisplayName, VENDOR_PUBLIC_FIELDS, VENDOR_SECRET_FIELDS, wouldCreateCycle, VD,
} from '@/lib/workspace/general-affairs/vendor-rules';
import { VENDOR_CODE_MESSAGES, describeWarning, vendorErrorMessage } from '@/lib/workspace/general-affairs/vendor-messages';

// G20／G21 unit：統編標準化與檢查碼、名稱相近、帳務機密欄位遮蔽、權限能力、樹狀循環、合約到期、篩選整形、錯誤碼白話。
void _unused;
const has = (...codes: string[]) => ({ has: (c: string) => codes.includes(c) });
const U = '3f2b1c9e-8a1d-4c47-9b52-1d2e3f4a5b6c';

describe('G21.unit 統編', () => {
  it('標準化：全形轉半角、去所有空白', () => {
    expect(normalizeTaxId(' ０４５９ ５２５７ ')).toBe('04595257');
    expect(normalizeTaxId('0459　5257')).toBe('04595257');
    expect(normalizeTaxId(null)).toBe('');
  });
  it('檢查碼：有效與無效、第 7 碼為 7 的特例', () => {
    expect(taxIdChecksumOk('04595257')).toBe(true);
    expect(taxIdChecksumOk('12345678')).toBe(false);
    expect(taxIdChecksumOk('1234567')).toBe(false);
    expect(taxIdChecksumOk('abcdefgh')).toBe(false);
    // 第 7 碼是 7：總和 +1 能被 5 整除也算有效（10458574：和為 49，+1 = 50）
    expect(taxIdChecksumOk('10458574')).toBe(true);
    expect(taxIdChecksumOk('10458576')).toBe(false);
  });
});

describe('G21.unit 名稱相近', () => {
  it('正規化：全半形、大小寫、空白標點、公司字尾', () => {
    expect(normalizeVendorName('富康　科技（股）有限公司')).toBe('富康科技（股）'.normalize('NFKC').replace(/[()（）]/g, ''));
    expect(normalizeVendorName('ABC Air-Con 有限公司')).toBe('abcaircon');
    expect(normalizeVendorName('甲乙企業社')).toBe('甲乙');
    expect(normalizeVendorName('甲乙股份有限公司')).toBe('甲乙');
    expect(normalizeVendorName('')).toBe('');
  });
  it('相同、互相包含（至少 2 字）、完全不同', () => {
    expect(namesSimilar(['甲乙冷氣有限公司'], ['甲乙冷氣企業社'])).toBe(true);
    expect(namesSimilar(['甲乙冷氣'], ['甲乙冷氣工程行'])).toBe(true);
    expect(namesSimilar(['甲乙冷氣'], ['丙丁水電'])).toBe(false);
    expect(namesSimilar(['甲'], ['甲乙冷氣'])).toBe(false); // 單字不比包含
    expect(namesSimilar(['甲乙', '丙丁'], ['丙丁水電行'])).toBe(true); // 別名也比
    expect(namesSimilar([null, ''], ['甲乙'])).toBe(false);
  });
  it('similarVendors 排除自己', () => {
    const others = [{ id: 'a', name: '甲乙冷氣' }, { id: 'b', name: '丙丁水電' }];
    expect(similarVendors({ id: 'a', name: '甲乙冷氣' }, others)).toEqual([]);
    expect(similarVendors({ id: 'z', name: '甲乙冷氣有限公司' }, others).map((o) => o.id)).toEqual(['a']);
  });
});

describe('G21.unit 帳務機密欄位遮蔽（V1）', () => {
  const row = { id: U, name: '甲', alias: null, status: 'active', tax_id: '04595257', billing_title: 'T', billing_address: 'A', invoice_type: '二聯', payment_terms: '月結', payment_methods: ['匯款'], accounting_notes: 'n', total_amount: 5, contract_end_date: '2038-01-01', cooperation_notes: '備註' };
  it('八個機密欄位清單固定', () => {
    expect([...VENDOR_SECRET_FIELDS]).toEqual(['tax_id', 'billing_title', 'billing_address', 'invoice_type', 'payment_terms', 'payment_methods', 'accounting_notes', 'total_amount', 'bank_name', 'bank_branch', 'bank_account', 'bank_account_name']);
    expect(VENDOR_SECRET_FIELDS).toHaveLength(12);
    for (const f of VENDOR_SECRET_FIELDS) expect((VENDOR_PUBLIC_FIELDS as readonly string[]).includes(f)).toBe(false);
  });
  it('可看帳務者原樣；其他人 12 欄（含第 4.5 批銀行四欄）完全不存在（不是 null），合約到期日與合作備註不算帳務', () => {
    expect(maskVendor(row, true)).toEqual(row);
    const m = maskVendor(row, false) as Record<string, unknown>;
    for (const f of VENDOR_SECRET_FIELDS) expect(Object.prototype.hasOwnProperty.call(m, f), f).toBe(false);
    expect(m.contract_end_date).toBe('2038-01-01');
    expect(m.cooperation_notes).toBe('備註');
    expect(JSON.stringify(m)).not.toMatch(/04595257|月結|匯款/);
  });
  it('下拉項目：統編與付款條件依權限遮蔽，聯絡人與電話保留（V2）', () => {
    const opt = { id: U, name: '甲', contact_name: '王', contact_phone: '02', tax_id: '04595257', payment_terms: '月結' };
    expect(maskVendorOption(opt, true)).toEqual(opt);
    const m = maskVendorOption(opt, false) as Record<string, unknown>;
    expect('tax_id' in m).toBe(false);
    expect('payment_terms' in m).toBe(false);
    expect(m.contact_name).toBe('王');
    expect(m.contact_phone).toBe('02');
  });
});

describe('G21.unit 權限能力（與資料庫 ga_vd_can_* 一致）', () => {
  it('只有分類、區域、合作紀錄：看不到廠商；合作紀錄只開績效', () => {
    const cat = vendorAbilities(has(VD.catView, VD.regView));
    expect(cat.canView).toBe(false);
    expect(cat.canViewCategories).toBe(true);
    expect(cat.canOptions).toBe(false);
    expect(cat.billingVisible).toBe(false);
    const coop = vendorAbilities(has(VD.coopView));
    expect(coop.canViewStats).toBe(true);
    expect(coop.canView).toBe(false);
    expect(coop.canViewCategories).toBe(false);
  });
  it('廠商檢視：看得到帳務但不能寫；管理才能寫；管理隱含查看', () => {
    const v = vendorAbilities(has(VD.view));
    expect(v.canView && v.billingVisible).toBe(true);
    expect(v.canManage).toBe(false);
    expect(v.canViewCategories && v.canViewRegions).toBe(true);
    const m = vendorAbilities(has(VD.manage));
    expect(m.canView && m.canManage && m.billingVisible).toBe(true);
    expect(m.canManageCategories).toBe(false);
  });
  it('下拉：工單更新／管理、採購評估、需求單管理、採購核准可用，但看不到帳務', () => {
    for (const c of [VD.woUpdate, VD.woManage, VD.reviewView, VD.reviewManage, VD.requestManage, VD.approve]) {
      const a = vendorAbilities(has(c));
      expect(a.canOptions, c).toBe(true);
      expect(a.billingVisible, c).toBe(false);
      expect(a.canView, c).toBe(false);
    }
    expect(vendorAbilities(has()).canOptions).toBe(false);
  });
  it('分類與區域管理各自獨立', () => {
    expect(vendorAbilities(has(VD.catManage)).canManageCategories).toBe(true);
    expect(vendorAbilities(has(VD.catManage)).canManageRegions).toBe(false);
    expect(vendorAbilities(has(VD.regManage)).canManageRegions).toBe(true);
  });
});

describe('G20.unit 樹狀循環防止與代碼', () => {
  const nodes = [{ id: 'a', parent_id: null }, { id: 'b', parent_id: 'a' }, { id: 'c', parent_id: 'b' }, { id: 'd', parent_id: null }];
  it('自己、子孫為上層會循環；其他不會', () => {
    expect(wouldCreateCycle(nodes, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(nodes, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(nodes, 'b', 'c')).toBe(true);
    expect(wouldCreateCycle(nodes, 'c', 'a')).toBe(false);
    expect(wouldCreateCycle(nodes, 'a', 'd')).toBe(false);
    expect(wouldCreateCycle(nodes, 'a', null)).toBe(false);
  });
  it('資料本身已有環也不會無窮迴圈', () => {
    expect(wouldCreateCycle([{ id: 'x', parent_id: 'y' }, { id: 'y', parent_id: 'x' }], 'z', 'x')).toBe(false);
  });
  it('代碼：轉大寫、格式', () => {
    expect(normalizeCode(' ac-01 ')).toBe('AC-01');
    expect(CODE_RE.test('TW-N')).toBe(true);
    expect(CODE_RE.test('TPE-01')).toBe(true);
    expect(CODE_RE.test('a b')).toBe(false);
    expect(CODE_RE.test('-X')).toBe(false);
    expect(CODE_RE.test('X'.repeat(31))).toBe(false);
  });
});

describe('G21.unit 合約到期（V4）與顯示名稱（V3）', () => {
  const today = '2038-06-15';
  const base = { status: 'active', contract_required: true, contract_end_date: '2038-07-15' as string | null };
  it('30 天邊界：第 30 天列、第 31 天不列；已過期列', () => {
    expect(addDays(today, 30)).toBe('2038-07-15');
    expect(contractDue({ ...base }, today)).toBe(true);
    expect(contractDue({ ...base, contract_end_date: '2038-07-16' }, today)).toBe(false);
    expect(contractDue({ ...base, contract_end_date: '2038-01-01' }, today)).toBe(true);
  });
  it('不需簽約、無到期日、非合作中都不列', () => {
    expect(contractDue({ ...base, contract_required: false }, today)).toBe(false);
    expect(contractDue({ ...base, contract_end_date: null }, today)).toBe(false);
    expect(contractDue({ ...base, status: 'paused' }, today)).toBe(false);
    expect(contractDue({ ...base, status: 'inactive' }, today)).toBe(false);
  });
  it('台北今日格式', () => {
    expect(taipeiToday(new Date('2038-06-15T20:00:00Z'))).toBe('2038-06-16');
    expect(taipeiToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('停用加（已停用）、暫停加（暫停）、合作中原樣', () => {
    expect(vendorDisplayName('甲', 'inactive')).toBe('甲（已停用）');
    expect(vendorDisplayName('甲', 'paused')).toBe('甲（暫停）');
    expect(vendorDisplayName('甲', 'active')).toBe('甲');
    expect(vendorDisplayName('甲', null)).toBe('甲');
  });
});

describe('G20／G21.unit 篩選與版本整形', () => {
  it('廠商篩選：搜尋截斷、狀態與類型白名單、uuid、contract_due', () => {
    const f = parseVendorFilters(new URLSearchParams({ search: ` ${'x'.repeat(150)} `, status: 'paused', vendorType: 'studio', categoryId: U, contract_due: '1' }));
    expect((f.search as string).length).toBe(100);
    expect(f).toMatchObject({ status: 'paused', vendor_type: 'studio', category_id: U, contract_due: true });
    expect(() => parseVendorFilters(new URLSearchParams({ status: 'x' }))).toThrow('狀態');
    expect(() => parseVendorFilters(new URLSearchParams({ vendorType: 'x' }))).toThrow('類型');
    expect(() => parseVendorFilters(new URLSearchParams({ regionId: 'nope' }))).toThrow('格式');
    expect(parseVendorFilters(new URLSearchParams())).toEqual({});
  });
  it('分類與區域篩選：狀態各自白名單（區域多 archived）、options', () => {
    expect(parseTreeFilters(new URLSearchParams({ status: 'archived' }), 'region').status).toBe('archived');
    expect(() => parseTreeFilters(new URLSearchParams({ status: 'archived' }), 'category')).toThrow('狀態');
    expect(parseTreeFilters(new URLSearchParams({ options: '1', regionType: 'city' }), 'region')).toMatchObject({ options: true, region_type: 'city' });
    expect(() => parseTreeFilters(new URLSearchParams({ parentId: 'x' }), 'category')).toThrow('parentId');
  });
  it('expected_updated_at 必填且為日期', () => {
    expect(parseExpectedUpdatedAt('2038-01-01T00:00:00Z')).toBe('2038-01-01T00:00:00Z');
    expect(() => parseExpectedUpdatedAt('')).toThrow('缺少版本');
    expect(() => parseExpectedUpdatedAt('abc')).toThrow('格式錯誤');
  });
  it('includeIds：去重、上限、uuid 檢查', () => {
    expect(parseIdList(`${U},${U}`)).toEqual([U]);
    expect(parseIdList(null)).toEqual([]);
    expect(() => parseIdList('x')).toThrow('格式');
    expect(() => parseIdList(Array.from({ length: 101 }, (_, i) => `3f2b1c9e-8a1d-4c47-9b52-1d2e3f4a5b${String(i).padStart(2, '0')}`).join(','))).toThrow('最多');
  });
});

describe('G21.unit 錯誤碼白話', () => {
  it('每個代碼都有白話；沒有代碼用後備', () => {
    for (const [code, msg] of Object.entries(VENDOR_CODE_MESSAGES)) {
      expect(msg, code).toMatch(/[㐀-鿿]/);
      expect(vendorErrorMessage(code)).toBe(msg);
    }
    expect(vendorErrorMessage('NOPE', '後備')).toBe('後備');
    expect(vendorErrorMessage(null)).toMatch(/失敗/);
  });
  it('提醒文字', () => {
    expect(describeWarning({ code: 'OPEN_DOCS', message: '', open_purchase_orders: 2, open_work_orders: 1 })).toContain('2 張未結採購單');
    expect(describeWarning({ code: 'NAME_SIMILAR', message: '', vendors: [{ id: 'a', name: '甲', status: 'active' }] })).toContain('甲');
    expect(describeWarning({ code: 'TAX_CHECKSUM', message: '' })).toContain('檢查碼');
    expect(describeWarning({ code: 'TAX_CHECKSUM', message: '資料庫訊息' })).toBe('資料庫訊息');
  });
});
