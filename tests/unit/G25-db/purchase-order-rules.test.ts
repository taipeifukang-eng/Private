import { describe, expect, it } from 'vitest';
import {
  ACTION_FROM, ACTIVE_FOR_REQUEST, approverBlock, canTransition, canViewPo, computeTotals, DEFAULT_APPROVAL_THRESHOLD, formatPoNo, isOverRequest, isPoOverdue, itemsMissingOverReason,
  lineAmount, LOCKED_AFTER_ORDER, maskVendorBilling, missingPermissions, needsApproval, nextPoNo, nextStatus, normalizePage, ORDERED_OR_BEYOND, permissionProblem, PO_ACTIONS, PO_NO_RE,
  PO_STATUSES, poAbilities, priceHistory, receivableRemaining, reasonRequired, requestRemaining, roundYuan, taipeiDay, toBaseQty, validateActionPayload, validateCreatePayload,
  validateHeader, validateItems, validateSettingsPayload, likeEscape, type PoAction, type PoStatus, type PoWho,
} from '@/lib/workspace/general-affairs/purchase-order-rules';

// G25 採購單規則（D2、D3、D6 至 D13）：伺服端、頁面與資料庫函式共用同一套語意。
const P = '33333333-3333-4333-8333-333333333333';
const R = '44444444-4444-4444-8444-444444444444';
const V = '55555555-5555-4555-8555-555555555555';
const S = '66666666-6666-4666-8666-666666666666';
const ME = '77777777-7777-4777-8777-777777777777';
const OTHER = '88888888-8888-4888-8888-888888888888';
const full: PoWho = { reviewManage: true, transactionManage: true, partView: true, approve: false, vendorView: false, userId: ME };

describe('金額與稅額：四捨五入到整數元', () => {
  it('roundYuan：.5 進位、浮點誤差不影響', () => {
    expect(roundYuan(0.5)).toBe(1);
    expect(roundYuan(1.005 * 1000)).toBe(1005);
    expect(roundYuan(2.4999)).toBe(2);
    expect(roundYuan(1049.999999)).toBe(1050);
    expect(roundYuan(NaN)).toBe(0);
  });
  it('單項金額 = 數量 × 單價 四捨五入（0.3333 × 3 = 1）', () => {
    expect(lineAmount(3, 0.3333)).toBe(1);
    expect(lineAmount(5, 1200)).toBe(6000);
    expect(lineAmount(1.5, 3)).toBe(5);
  });
  it('未稅小計是各項金額（各自四捨五入）加總；稅額與含稅總額再四捨五入', () => {
    expect(computeTotals([{ quantity: 5, unit_price: 1000 }])).toEqual({ subtotal: 5000, tax_amount: 250, total_amount: 5250 });
    // 每項各自進位：0.5 -> 1，兩項共 2（不是 1）
    expect(computeTotals([{ quantity: 1, unit_price: 0.5 }, { quantity: 1, unit_price: 0.5 }]).subtotal).toBe(2);
    // 小計 10 × 5% = 0.5 -> 稅額 1
    expect(computeTotals([{ quantity: 1, unit_price: 10 }])).toEqual({ subtotal: 10, tax_amount: 1, total_amount: 11 });
    expect(computeTotals([{ quantity: 1, unit_price: 1000 }], 0.1)).toEqual({ subtotal: 1000, tax_amount: 100, total_amount: 1100 });
    expect(computeTotals([])).toEqual({ subtotal: 0, tax_amount: 0, total_amount: 0 });
  });
});

describe('核准門檻：含稅總額大於才需核准（剛好等於免核准）', () => {
  it('預設 5000：5000 免、5001 要', () => {
    expect(DEFAULT_APPROVAL_THRESHOLD).toBe(5000);
    expect(needsApproval(5000)).toBe(false);
    expect(needsApproval(5001)).toBe(true);
    expect(needsApproval(4999)).toBe(false);
  });
  it('門檻可調、未啟用核准一律免', () => {
    expect(needsApproval(10_000, 20_000)).toBe(false);
    expect(needsApproval(20_001, 20_000)).toBe(true);
    expect(needsApproval(999_999, 5000, false)).toBe(false);
    expect(needsApproval(0, 0)).toBe(false);
    expect(needsApproval(1, 0)).toBe(true);
  });
  it('未稅 4762 元 × 5% 稅 = 含稅 5000（剛好）免核准；未稅 4763 含稅 5001 要核准', () => {
    expect(needsApproval(computeTotals([{ quantity: 1, unit_price: 4762 }]).total_amount)).toBe(false);
    expect(computeTotals([{ quantity: 1, unit_price: 4762 }]).total_amount).toBe(5000);
    expect(needsApproval(computeTotals([{ quantity: 1, unit_price: 4763 }]).total_amount)).toBe(true);
  });
});

describe('單號 PO-YYYYMMDD-NNN（台北日期、每日流水歸零）', () => {
  it('台北日期：UTC 16:00 以後已是台北隔天', () => {
    expect(taipeiDay('2026-11-12T15:59:59Z')).toBe('20261112');
    expect(taipeiDay('2026-11-12T16:00:00Z')).toBe('20261113');
    expect(taipeiDay('2026-12-31T20:00:00Z')).toBe('20270101');
    expect(() => taipeiDay('壞掉')).toThrow('日期格式錯誤');
  });
  it('格式：三位流水，滿 999 自然擴為四位', () => {
    expect(formatPoNo('20261112', 1)).toBe('PO-20261112-001');
    expect(formatPoNo('20261112', 999)).toBe('PO-20261112-999');
    expect(formatPoNo('20261112', 1000)).toBe('PO-20261112-1000');
    expect(PO_NO_RE.test('PO-20261112-001')).toBe(true);
    expect(PO_NO_RE.test('PO-20261112-1000')).toBe(true);
    expect(PO_NO_RE.test('PO-20261112-01')).toBe(false);
    expect(() => formatPoNo('2026-11-12', 1)).toThrow('YYYYMMDD');
    expect(() => formatPoNo('20261112', 0)).toThrow('正整數');
  });
  it('下一個單號只看同一天；其他天與格式不符的忽略；每日歸零', () => {
    expect(nextPoNo('20261112', [])).toBe('PO-20261112-001');
    expect(nextPoNo('20261112', ['PO-20261112-001', 'PO-20261112-007', 'PO-20261111-050', 'GAT-20261112-00099', 'PO-20261112-abc'])).toBe('PO-20261112-008');
    expect(nextPoNo('20261113', ['PO-20261112-007'])).toBe('PO-20261113-001');
    expect(nextPoNo('20261112', ['PO-20261112-999'])).toBe('PO-20261112-1000');
  });
});

describe('狀態轉換表：允許與禁止全覆蓋', () => {
  const expectedAllowed: Record<PoAction, PoStatus[]> = {
    submit: ['DRAFT'], withdraw: ['PENDING_APPROVAL'], approve: ['PENDING_APPROVAL'], reject: ['PENDING_APPROVAL'], revoke_approval: ['APPROVED'],
    place_order: ['DRAFT', 'APPROVED'], cancel: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED'], short_close: ['PARTIALLY_RECEIVED'], close: ['RECEIVED'],
  };
  it('每個動作 × 每個狀態：只有表上的組合允許，其餘全部禁止', () => {
    for (const action of PO_ACTIONS) {
      for (const status of PO_STATUSES) {
        expect(canTransition(status, action), `${action} @ ${status}`).toBe(expectedAllowed[action].includes(status));
      }
    }
    expect(Object.keys(ACTION_FROM).sort()).toEqual([...PO_ACTIONS].sort());
  });
  it('結果狀態：駁回、撤回、撤回核准都回草稿；下訂 → 已下訂；取消 → 已取消；兩種結案 → 已結案', () => {
    expect(nextStatus('PENDING_APPROVAL', 'reject')).toBe('DRAFT');
    expect(nextStatus('PENDING_APPROVAL', 'withdraw')).toBe('DRAFT');
    expect(nextStatus('APPROVED', 'revoke_approval')).toBe('DRAFT');
    expect(nextStatus('APPROVED', 'place_order')).toBe('ORDERED');
    expect(nextStatus('DRAFT', 'place_order')).toBe('ORDERED');
    expect(nextStatus('ORDERED', 'cancel')).toBe('CANCELED');
    expect(nextStatus('RECEIVED', 'close')).toBe('CLOSED');
    expect(nextStatus('PARTIALLY_RECEIVED', 'short_close')).toBe('CLOSED');
    expect(nextStatus('CLOSED', 'cancel')).toBeNull();
    expect(nextStatus('DRAFT', 'receive')).toBeNull();
  });
  it('已有到貨（部分到貨、全部到貨）不能取消；終態什麼都不能做', () => {
    for (const s of ['PARTIALLY_RECEIVED', 'RECEIVED']) expect(canTransition(s, 'cancel')).toBe(false);
    for (const s of ['CLOSED', 'CANCELED']) for (const a of PO_ACTIONS) expect(canTransition(s, a)).toBe(false);
  });
  it('原因必填：駁回、撤回核准、短收結案一律；取消只有已下訂時', () => {
    expect(reasonRequired('reject', 'PENDING_APPROVAL')).toBe(true);
    expect(reasonRequired('revoke_approval', 'APPROVED')).toBe(true);
    expect(reasonRequired('short_close', 'PARTIALLY_RECEIVED')).toBe(true);
    expect(reasonRequired('cancel', 'ORDERED')).toBe(true);
    expect(reasonRequired('cancel', 'DRAFT')).toBe(false);
    expect(reasonRequired('cancel', 'APPROVED')).toBe(false);
    expect(reasonRequired('approve', 'PENDING_APPROVAL')).toBe(false);
    expect(reasonRequired('place_order', 'DRAFT')).toBe(false);
  });
  it('狀態分組：歷史價只算已下訂以上；占用需求量算全部未取消；下訂後鎖定', () => {
    expect([...ORDERED_OR_BEYOND]).toEqual(['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED']);
    expect(ACTIVE_FOR_REQUEST).not.toContain('CANCELED');
    expect(ACTIVE_FOR_REQUEST).toContain('DRAFT');
    expect([...LOCKED_AFTER_ORDER]).toEqual(['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED']);
  });
});

describe('數量換算、需求量加總與超量、剩餘可收量', () => {
  const part = { base_unit: '個', purchase_unit: '箱', purchase_to_base_rate: 12 };
  it('toBaseQty：基本單位原樣、採購單位乘換算率、其他單位丟錯、沒有料件原樣', () => {
    expect(toBaseQty(5, '個', part)).toBe(5);
    expect(toBaseQty(2, '箱', part)).toBe(24);
    expect(toBaseQty(0.5, '箱', part)).toBe(6);
    expect(toBaseQty(7, '本')).toBe(7);
    expect(() => toBaseQty(1, '桶', part)).toThrow('只能是料件的基本單位');
    expect(() => toBaseQty(1, '箱', { base_unit: '個' })).toThrow('只能是料件的基本單位');
  });
  it('剩餘需求量：沒有需求量不限制；扣掉其他未取消採購單；不為負', () => {
    expect(requestRemaining(null, 10)).toBeNull();
    expect(requestRemaining(10, 4)).toBe(6);
    expect(requestRemaining(10, 12)).toBe(0);
  });
  it('超量判斷（D2、D3）：加總超過才算，剛好等於不算，沒有需求量不算', () => {
    expect(isOverRequest(10, 6, 4)).toBe(false);
    expect(isOverRequest(10, 6, 5)).toBe(true);
    expect(isOverRequest(10, 0, 10.00004)).toBe(false);
    expect(isOverRequest(null, 99, 99)).toBe(false);
    // 兩張採購單（兩家供應商）加起來超過
    expect(isOverRequest(5, 3, 3)).toBe(true);
  });
  it('超量時只檢查連到該需求單的品項有沒有填原因，回傳項次', () => {
    const items = [
      { request_id: R, over_request_reason: '' },
      { request_id: null, over_request_reason: null },
      { request_id: R, over_request_reason: '  ' },
      { request_id: R, over_request_reason: '備品' },
    ];
    expect(itemsMissingOverReason(items, R)).toEqual([1, 3]);
    expect(itemsMissingOverReason(items, 'other')).toEqual([]);
  });
  it('剩餘可收量（D13）：訂購量減已驗入量，不為負，處理小數誤差', () => {
    expect(receivableRemaining(5, 3)).toBe(2);
    expect(receivableRemaining(5, 5)).toBe(0);
    expect(receivableRemaining(5, 6)).toBe(0);
    expect(receivableRemaining(0.3, 0.1)).toBe(0.2);
  });
});

describe('歷史價（D9）：同料件最近 N 筆已下訂以上', () => {
  const row = (n: number, status: string, day: string, part = P, price = 100 + n) => ({ po_no: `PO-2026111${n}-001`, status, ordered_at: status === 'DRAFT' || status === 'APPROVED' || status === 'PENDING_APPROVAL' ? null : `2026-11-0${n}T02:00:00Z`, part_id: part, unit_price: price, quantity: n, vendor_name: `廠商${n}`, day });
  const rows = [
    row(1, 'CLOSED', 'a'), row(2, 'ORDERED', 'a'), row(3, 'PARTIALLY_RECEIVED', 'a'), row(4, 'RECEIVED', 'a'),
    row(5, 'DRAFT', 'a'), row(6, 'CANCELED', 'a'), row(7, 'APPROVED', 'a'), row(8, 'PENDING_APPROVAL', 'a'), row(9, 'ORDERED', 'a', 'other-part'),
  ];
  it('只算 ORDERED、PARTIALLY_RECEIVED、RECEIVED、CLOSED；新到舊；其他料件不算', () => {
    const h = priceHistory(rows, P);
    expect(h.map((r) => r.po_no)).toEqual(['PO-20261114-001', 'PO-20261113-001', 'PO-20261112-001', 'PO-20261111-001']);
    expect(h.every((r) => (ORDERED_OR_BEYOND as readonly string[]).includes(r.status))).toBe(true);
  });
  it('筆數上限預設 5、可調 1 到 20；已取消即使有下訂時間也不算', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ po_no: `PO-20261110-00${i + 1}`, status: 'ORDERED', ordered_at: `2026-11-10T0${i}:00:00Z`, part_id: P, unit_price: 1, quantity: 1 }));
    expect(priceHistory(many, P)).toHaveLength(5);
    expect(priceHistory(many, P, 3)).toHaveLength(3);
    expect(priceHistory(many, P, 99)).toHaveLength(8);
    expect(priceHistory(many, P, 0)).toHaveLength(5);
    expect(priceHistory([{ po_no: 'x', status: 'CANCELED', ordered_at: '2026-11-10T00:00:00Z', part_id: P, unit_price: 1, quantity: 1 }], P)).toEqual([]);
  });
});

describe('abilities：三個權限缺哪個講清楚、核准人限制', () => {
  it('缺權限訊息逐個列出', () => {
    expect(missingPermissions(full)).toEqual([]);
    expect(missingPermissions({ ...full, reviewManage: false })).toEqual(['採購評估管理']);
    expect(missingPermissions({ ...full, transactionManage: false, partView: false })).toEqual(['庫存交易管理', '料件查看']);
    expect(permissionProblem(full)).toBe('');
    expect(permissionProblem({ ...full, partView: false })).toBe('採購單需要「採購評估管理」、「庫存交易管理」與「料件查看」三個權限，您缺少：料件查看');
  });
  it('三個權限都有：草稿可編輯、送核准、下訂、取消；不能核准', () => {
    const a = poAbilities(full, { status: 'DRAFT', created_by: ME });
    expect(a).toMatchObject({ edit: true, submit: true, place_order: true, cancel: true, approve: false, reject: false, close: false, problem: '' });
  });
  it('缺任一權限：全部寫入按鈕關閉並說明原因', () => {
    for (const miss of ['reviewManage', 'transactionManage', 'partView'] as const) {
      const a = poAbilities({ ...full, [miss]: false }, { status: 'DRAFT', created_by: ME });
      expect(a).toMatchObject({ edit: false, submit: false, place_order: false, cancel: false });
      expect(a.problem).toContain('缺少');
    }
  });
  it('核准人（只有核准權限）：看得到、可核准別人的單、不需要三個採購權限，但不能開單或下訂', () => {
    const who: PoWho = { ...full, reviewManage: false, transactionManage: false, partView: false, approve: true };
    const a = poAbilities(who, { status: 'PENDING_APPROVAL', created_by: OTHER, submitted_by: OTHER });
    expect(a).toMatchObject({ approve: true, reject: true, edit: false, place_order: false, showAmounts: true });
    expect(canViewPo(who)).toBe(true);
  });
  it('頂端缺權限提示：核准人與只有檢視者不提示；有部分採購權限但缺其他才提示', () => {
    const none = { ...full, reviewManage: false, transactionManage: false, partView: false };
    // 只有採購核准：能核准別人的單、也看已下訂的單，都不提示（但 problem 仍保留給 API 預檢）
    const approverOnly: PoWho = { ...none, approve: true };
    expect(poAbilities(approverOnly, { status: 'PENDING_APPROVAL', created_by: OTHER, submitted_by: OTHER }).problemNotice).toBe('');
    const viewing = poAbilities(approverOnly, { status: 'ORDERED', created_by: OTHER });
    expect(viewing.problemNotice).toBe('');
    expect(viewing.problem).toContain('缺少');
    // 僅檢視（採購評估檢視）：不提示
    expect(poAbilities({ ...none, reviewView: true }, { status: 'DRAFT', created_by: OTHER }).problemNotice).toBe('');
    // 三個權限都有：不提示
    expect(poAbilities(full, { status: 'DRAFT', created_by: ME }).problemNotice).toBe('');
    // 有部分採購權限但缺其他：提示缺哪個
    expect(poAbilities({ ...full, partView: false }, { status: 'DRAFT', created_by: ME }).problemNotice).toContain('料件查看');
    expect(poAbilities({ ...none, reviewManage: true }, { status: 'DRAFT', created_by: ME }).problemNotice).toContain('庫存交易管理、料件查看');
    // 部分採購權限同時是能核准這張單的核准人：不提示；核准人但是開單人（核准被擋）且有部分權限：提示
    expect(poAbilities({ ...none, reviewManage: true, approve: true }, { status: 'PENDING_APPROVAL', created_by: OTHER, submitted_by: OTHER }).problemNotice).toBe('');
    expect(poAbilities({ ...none, reviewManage: true, approve: true }, { status: 'PENDING_APPROVAL', created_by: ME, submitted_by: ME }).problemNotice).toContain('缺少');
  });
  it('核准人不可是開單人、也不可是最後送核准的人；管理員不繞過（abilities 沒有 admin 旗標）', () => {
    const who: PoWho = { ...full, approve: true };
    const own = poAbilities(who, { status: 'PENDING_APPROVAL', created_by: ME, submitted_by: OTHER });
    expect(own).toMatchObject({ approve: false, reject: false });
    expect(own.approveBlocked).toContain('開單人');
    const sub = poAbilities(who, { status: 'PENDING_APPROVAL', created_by: OTHER, submitted_by: ME });
    expect(sub).toMatchObject({ approve: false, reject: false });
    expect(sub.approveBlocked).toContain('最後一次送核准');
    expect(approverBlock({ userId: ME }, { created_by: OTHER, submitted_by: OTHER })).toBe('');
    expect(approverBlock({ userId: ME }, { created_by: null, submitted_by: null })).toBe('');
  });
  it('持三權限但沒有核准權限不能核准（反之亦然）', () => {
    expect(poAbilities(full, { status: 'PENDING_APPROVAL', created_by: OTHER, submitted_by: OTHER }).approve).toBe(false);
    expect(poAbilities({ ...full, approve: true }, { status: 'DRAFT', created_by: OTHER }).approve).toBe(false);
  });
  it('已下訂：只能改備註與預計到貨日；已有到貨不能取消只能短收結案；全部到貨才能結案', () => {
    expect(poAbilities(full, { status: 'ORDERED' })).toMatchObject({ edit: false, editNotesOnly: true, cancel: true, short_close: false, close: false });
    expect(poAbilities(full, { status: 'ORDERED', received_qty_total: 2 }).cancel).toBe(false);
    expect(poAbilities(full, { status: 'PARTIALLY_RECEIVED', received_qty_total: 2 })).toMatchObject({ cancel: false, short_close: true, close: false });
    expect(poAbilities(full, { status: 'RECEIVED', received_qty_total: 5 })).toMatchObject({ cancel: false, short_close: false, close: true });
    expect(poAbilities(full, { status: 'CLOSED' })).toMatchObject({ edit: false, editNotesOnly: false, cancel: false, close: false });
    expect(poAbilities(full, { status: 'APPROVED' })).toMatchObject({ revoke_approval: true, place_order: true, edit: false });
    expect(poAbilities(full, { status: 'PENDING_APPROVAL' })).toMatchObject({ withdraw: true, edit: false, place_order: false });
  });
  it('廠商帳務欄位旗標跟著廠商權限', () => {
    expect(poAbilities(full, { status: 'DRAFT' }).showVendorBilling).toBe(false);
    expect(poAbilities({ ...full, vendorView: true }, { status: 'DRAFT' }).showVendorBilling).toBe(true);
  });
});

describe('帳務欄位遮蔽（D8）', () => {
  const po = { id: 'x', vendor_name: '甲廠商', vendor_tax_id: '12345678', vendor_payment_terms: '月結30天', vendor_tax_id_snapshot: '12345678', vendor_payment_terms_snapshot: '月結30天', total_amount: 5250 };
  it('沒有廠商權限：統編與付款條件（含快照）拿掉，名稱與金額保留', () => {
    const m = maskVendorBilling(po, false);
    expect(m).toMatchObject({ vendor_name: '甲廠商', total_amount: 5250, vendor_tax_id: null, vendor_payment_terms: null, vendor_tax_id_snapshot: null, vendor_payment_terms_snapshot: null, vendor_billing_visible: false });
    expect(JSON.stringify(m)).not.toContain('12345678');
    expect(JSON.stringify(m)).not.toContain('月結');
  });
  it('有廠商權限：原樣', () => {
    expect(maskVendorBilling(po, true)).toBe(po);
  });
});

describe('輸入驗證：品項', () => {
  const item = { part_id: P, quantity: 5, unit_price: 1200 };
  it('合法：預設 STOCK、單價預設 0、文字去空白', () => {
    const [i] = validateItems([{ ...item, item_name: ' 印表機 ', notes: ' ' }]);
    expect(i).toMatchObject({ part_id: P, item_name: '印表機', quantity: 5, unit_price: 1200, fulfil_mode: 'STOCK', notes: null, target_store_id: null });
    expect(validateItems([{ part_id: P, quantity: '2' }])[0].unit_price).toBe(0);
  });
  it('自由品名：預設 NO_STOCK；要入庫必須有料件', () => {
    expect(validateItems([{ item_name: '辦公桌', quantity: 1, unit_price: 3000 }])[0]).toMatchObject({ part_id: null, fulfil_mode: 'NO_STOCK' });
    expect(() => validateItems([{ item_name: '辦公桌', quantity: 1, fulfil_mode: 'STOCK' }])).toThrow('必須選擇料件');
  });
  it('直接建設備：要門市；自由品名數量要整數；型號只在直接建設備保留', () => {
    expect(() => validateItems([{ part_id: P, quantity: 1, fulfil_mode: 'DIRECT_ASSET' }])).toThrow('送往的門市');
    expect(() => validateItems([{ item_name: '電視', quantity: 1.5, fulfil_mode: 'DIRECT_ASSET', target_store_id: S }])).toThrow('必須是整數');
    const [d] = validateItems([{ item_name: '電視', quantity: 2, fulfil_mode: 'DIRECT_ASSET', target_store_id: S, equipment_template_id: V }]);
    expect(d).toMatchObject({ target_store_id: S, equipment_template_id: V });
    const [s] = validateItems([{ ...item, target_store_id: S, equipment_template_id: V }]);
    expect(s).toMatchObject({ target_store_id: null, equipment_template_id: null });
  });
  it('錯誤：空清單、太多品項、格式、沒有料件也沒有品名、數量與單價、白名單外欄位', () => {
    expect(() => validateItems(null)).toThrow('品項必須是清單');
    expect(() => validateItems([])).toThrow('至少加入一個品項');
    expect(() => validateItems(Array.from({ length: 51 }, () => item))).toThrow('最多 50');
    expect(() => validateItems(['x'])).toThrow('第 1 項格式錯誤');
    expect(() => validateItems([{ quantity: 1 }])).toThrow('請選擇料件或填寫品名');
    expect(() => validateItems([{ part_id: 'x', quantity: 1 }])).toThrow('料件格式錯誤');
    expect(() => validateItems([{ part_id: P, quantity: 0 }])).toThrow('數量');
    expect(() => validateItems([{ part_id: P, quantity: '1.23456' }])).toThrow('數量');
    expect(() => validateItems([{ part_id: P, quantity: 1, unit_price: -1 }])).toThrow('單價');
    expect(() => validateItems([{ part_id: P, quantity: 1, unit_price: 'abc' }])).toThrow('單價');
    expect(() => validateItems([{ part_id: P, quantity: 1, fulfil_mode: 'MAGIC' }])).toThrow('處理方式錯誤');
    expect(() => validateItems([{ part_id: P, quantity: 1, request_id: 'x' }])).toThrow('需求單格式錯誤');
    expect(() => validateItems([{ part_id: P, quantity: 1, status: 'ORDERED' }])).toThrow('不支援的欄位');
    expect(() => validateItems([{ part_id: P, quantity: 1, item_name: 'x'.repeat(201) }])).toThrow('200 字');
    expect(() => validateItems([{ part_id: P, quantity: 1, over_request_reason: 'x'.repeat(201) }])).toThrow('200 字');
    expect(() => validateItems([{ part_id: P, quantity: 1, notes: 'x'.repeat(501) }])).toThrow('500 字');
  });
});

describe('輸入驗證：表頭、建單、動作、設定', () => {
  it('表頭只收出現的鍵；空白代表清空；日期必須有效；白名單外欄位拒絕', () => {
    expect(validateHeader(undefined)).toEqual({});
    expect(validateHeader({ vendor_id: V, notes: ' 備註 ', expected_delivery_date: '2026-12-01' })).toEqual({ vendor_id: V, notes: '備註', expected_delivery_date: '2026-12-01' });
    expect(validateHeader({ vendor_id: '', expected_delivery_date: '' })).toEqual({ vendor_id: null, expected_delivery_date: null });
    expect(() => validateHeader({ expected_delivery_date: '2026-02-30' })).toThrow('不是有效的日期');
    expect(() => validateHeader({ expected_delivery_date: '12/01' })).toThrow('不是有效的日期');
    expect(() => validateHeader({ vendor_id: 'x' })).toThrow('供應商格式錯誤');
    expect(() => validateHeader({ notes: 'x'.repeat(1001) })).toThrow('1000 字');
    expect(() => validateHeader({ status: 'ORDERED' })).toThrow('不支援的欄位');
    expect(() => validateHeader([])).toThrow('格式錯誤');
  });
  it('建單：識別碼必填、白名單欄位、品項必填', () => {
    const body = { header: { vendor_id: V }, items: [{ part_id: P, quantity: 1 }], idempotency_key: 'k1' };
    expect(validateCreatePayload(body).idempotency_key).toBe('k1');
    expect(() => validateCreatePayload({ ...body, idempotency_key: '' })).toThrow('防重複識別碼');
    expect(() => validateCreatePayload({ ...body, idempotency_key: 'k'.repeat(61) })).toThrow('過長');
    expect(() => validateCreatePayload({ ...body, po_no: 'PO-1' })).toThrow('不支援的欄位');
    expect(() => validateCreatePayload({ ...body, items: [] })).toThrow('至少加入一個品項');
    expect(() => validateCreatePayload(null)).toThrow('格式錯誤');
  });
  it('動作：版本必填、白名單、原因依動作與狀態必填', () => {
    const base = { action: 'approve', expected_updated_at: '2026-11-12T03:04:05.123456+00:00' };
    expect(validateActionPayload(base)).toMatchObject({ action: 'approve', note: null });
    expect(() => validateActionPayload({ ...base, expected_updated_at: '' })).toThrow('缺少版本資訊');
    expect(() => validateActionPayload({ ...base, expected_updated_at: 'abc' })).toThrow('版本資訊格式錯誤');
    expect(() => validateActionPayload({ ...base, action: 'receive' })).toThrow('不支援的動作');
    expect(() => validateActionPayload({ ...base, extra: 1 })).toThrow('不支援的欄位');
    expect(() => validateActionPayload({ ...base, action: 'reject' }, 'PENDING_APPROVAL')).toThrow('駁回必須填寫原因');
    expect(validateActionPayload({ ...base, action: 'reject', note: ' 價格太高 ' }, 'PENDING_APPROVAL').note).toBe('價格太高');
    expect(() => validateActionPayload({ ...base, action: 'cancel' }, 'ORDERED')).toThrow('取消必須填寫原因');
    expect(validateActionPayload({ ...base, action: 'cancel' }, 'DRAFT').note).toBeNull();
    expect(() => validateActionPayload({ ...base, action: 'short_close' }, 'PARTIALLY_RECEIVED')).toThrow('短收結案必須填寫原因');
    expect(() => validateActionPayload({ ...base, note: 'x'.repeat(501) })).toThrow('500 字');
  });
  it('設定：門檻 0 到 99,999,999、稅率 0 到 0.3、歷史價 1 到 20 整數、至少一項、版本必填', () => {
    const v = '2026-11-12T03:04:05.123456+00:00';
    expect(validateSettingsPayload({ approval_threshold: 8000, tax_rate: 0.05, price_history_limit: 7, approval_enabled: false, expected_updated_at: v }).values)
      .toEqual({ approval_threshold: 8000, tax_rate: 0.05, price_history_limit: 7, approval_enabled: false });
    expect(() => validateSettingsPayload({ approval_threshold: -1, expected_updated_at: v })).toThrow('核准門檻');
    expect(() => validateSettingsPayload({ approval_threshold: 100_000_000, expected_updated_at: v })).toThrow('99,999,999');
    expect(() => validateSettingsPayload({ tax_rate: 0.31, expected_updated_at: v })).toThrow('0.3');
    expect(() => validateSettingsPayload({ price_history_limit: 21, expected_updated_at: v })).toThrow('1 到 20');
    expect(() => validateSettingsPayload({ price_history_limit: 2.5, expected_updated_at: v })).toThrow('歷史價筆數');
    expect(() => validateSettingsPayload({ approval_enabled: 'yes', expected_updated_at: v })).toThrow('是或否');
    expect(() => validateSettingsPayload({ expected_updated_at: v })).toThrow('沒有要調整');
    expect(() => validateSettingsPayload({ approval_threshold: 1 })).toThrow('缺少版本資訊');
    expect(() => validateSettingsPayload({ approval_threshold: 1, expected_updated_at: v, other: 1 })).toThrow('不支援的設定');
  });
});

describe('清單輔助：分頁上限、搜尋跳脫、逾期', () => {
  it('分頁：頁碼最小 1、每頁最多 100、預設 20', () => {
    expect(normalizePage(undefined, undefined)).toEqual({ page: 1, pageSize: 20 });
    expect(normalizePage('0', '500')).toEqual({ page: 1, pageSize: 100 });
    expect(normalizePage('3', '50')).toEqual({ page: 3, pageSize: 50 });
    expect(normalizePage('x', '-4')).toEqual({ page: 1, pageSize: 20 });
  });
  it('LIKE 跳脫：反斜線、百分比、底線都不能當萬用字元', () => {
    expect(likeEscape('100%_a\\b')).toBe('100\\%\\_a\\\\b');
    expect(likeEscape('正常')).toBe('正常');
  });
  it('逾期未到貨：只有已下訂與部分到貨、預計到貨日早於今天（當天不算）', () => {
    const today = '2026-11-12';
    expect(isPoOverdue({ status: 'ORDERED', expected_delivery_date: '2026-11-11' }, today)).toBe(true);
    expect(isPoOverdue({ status: 'PARTIALLY_RECEIVED', expected_delivery_date: '2026-11-01' }, today)).toBe(true);
    expect(isPoOverdue({ status: 'ORDERED', expected_delivery_date: '2026-11-12' }, today)).toBe(false);
    expect(isPoOverdue({ status: 'RECEIVED', expected_delivery_date: '2026-11-01' }, today)).toBe(false);
    expect(isPoOverdue({ status: 'DRAFT', expected_delivery_date: '2026-11-01' }, today)).toBe(false);
    expect(isPoOverdue({ status: 'ORDERED', expected_delivery_date: null }, today)).toBe(false);
  });
});
