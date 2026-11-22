import { describe, expect, it } from 'vitest';
import {
  EMPTY_MOVE_PREVIEW, groupMoved, isMovableRequest, legacyWorkOrderMatches, movedTimelineTitle, normalizeMovePreview, type MovedRow,
} from '../../../lib/workspace/general-affairs/asset-move';
import { groupMoved as vueGroupMoved, moveHeadline, moveResultText, moveSummary } from '../../../vue-workspace/src/lib/ga-asset-move';

// 第 4 批 G27（B6，D20、D21）：換店時哪些單跟著搬、時間軸文字、舊式工單判斷、確認視窗與結果的白話文字。
describe('isMovableRequest（D20）', () => {
  const base = { request_type: 'REPAIR', main_status: 'IN_PROGRESS' };
  it('維修類且未結案都搬（含待門市確認、待門市補資料、待受理）', () => {
    for (const st of ['PENDING_INTAKE', 'WAITING_STORE_SUPPLEMENT', 'WAITING_GA_REVIEW', 'ACCEPTED', 'IN_PROGRESS', 'WAITING_STORE_CONFIRMATION']) {
      expect(isMovableRequest({ ...base, main_status: st }), st).toBe(true);
    }
  });
  it('已完成、退回、取消不搬（舊店只保留已結案單）', () => {
    for (const st of ['COMPLETED', 'REJECTED', 'CANCELED']) expect(isMovableRequest({ ...base, main_status: st }), st).toBe(false);
  });
  it('添購等其他類型不搬', () => {
    for (const t of ['PURCHASE_SUPPLEMENT', 'ASSIGNED_RESPONSE', 'OTHER']) expect(isMovableRequest({ ...base, request_type: t }), t).toBe(false);
  });
  it('已軟刪除的不搬；門市不是轉出門市的不搬', () => {
    expect(isMovableRequest({ ...base, deleted_at: '2026-11-12T00:00:00Z' })).toBe(false);
    expect(isMovableRequest({ ...base, store_id: 'B' }, 'A')).toBe(false);
    expect(isMovableRequest({ ...base, store_id: 'A' }, 'A')).toBe(true);
    expect(isMovableRequest({ ...base }, 'A')).toBe(true);
  });
});

describe('movedTimelineTitle（D21）', () => {
  it('轉移與更正各有固定文字', () => {
    expect(movedTimelineTitle('TRANSFER', 'A 店', 'B 店')).toBe('因設備轉移，由 A 店 轉到 B 店');
    expect(movedTimelineTitle('CORRECTION', 'A 店', 'B 店')).toBe('因設備所屬門市更正，由 A 店 轉到 B 店');
  });
});

describe('legacyWorkOrderMatches（D20 舊式工單只列清單）', () => {
  const asset = { type: 'EQUIPMENT' as const, store_id: 's1', code: 'EQ-0042', name: '冷凍櫃' };
  const wo = { ga_service_request_id: null, store_id: 's1', status: 'PROCESSING', resource_type: 'equipment', title: '冷凍櫃不冷', description: '' };
  it('同門市、未完成、類型相符、標題提到名稱或編號才算', () => {
    expect(legacyWorkOrderMatches(wo, asset)).toBe(true);
    expect(legacyWorkOrderMatches({ ...wo, title: '異音', description: '編號 eq-0042 的機器' }, asset)).toBe(true);
    expect(legacyWorkOrderMatches({ ...wo, title: '店門玻璃破了' }, asset)).toBe(false);
  });
  it('已連到需求單、別家店、已完成、設施類不算', () => {
    expect(legacyWorkOrderMatches({ ...wo, ga_service_request_id: 'r1' }, asset)).toBe(false);
    expect(legacyWorkOrderMatches({ ...wo, store_id: 's2' }, asset)).toBe(false);
    expect(legacyWorkOrderMatches({ ...wo, status: 'COMPLETED' }, asset)).toBe(false);
    expect(legacyWorkOrderMatches({ ...wo, resource_type: 'facility' }, asset)).toBe(false);
    expect(legacyWorkOrderMatches({ ...wo, resource_type: null }, asset)).toBe(true);
  });
  it('名稱或編號太短不比對，避免誤列', () => {
    expect(legacyWorkOrderMatches({ ...wo, title: 'A 出問題' }, { ...asset, name: 'A', code: 'E1' })).toBe(false);
    expect(legacyWorkOrderMatches({ ...wo, title: '' }, { ...asset, name: null, code: null })).toBe(false);
  });
});

describe('normalizeMovePreview', () => {
  it('缺欄位補空，張數以清單長度為準', () => {
    expect(normalizeMovePreview(null)).toEqual(EMPTY_MOVE_PREVIEW);
    const p = normalizeMovePreview({ moving: [{ request_id: '1' }, { request_id: '2' }], moving_count: 99, staying: [{ request_id: '3' }], unlinked_work_orders: [] });
    expect(p).toMatchObject({ moving_count: 2, staying_count: 1, unlinked_count: 0 });
  });
});

const rows: MovedRow[] = [
  { id: '1', kind: 'REQUEST', moved: true, request_id: 'r1', work_order_id: null, doc_no: 'GR-1', doc_title: '冷凍櫃壞了', doc_status: 'IN_PROGRESS', from_store_id: 'a', to_store_id: 'b', created_at: '2026-11-12T01:00:00Z' },
  { id: '2', kind: 'WORK_ORDER', moved: true, request_id: 'r1', work_order_id: 'w1', doc_no: 'GR-1', doc_title: '工單一', doc_status: 'PROCESSING', from_store_id: 'a', to_store_id: 'b', created_at: '2026-11-12T01:00:00Z' },
  { id: '3', kind: 'REQUEST', moved: true, request_id: 'r2', work_order_id: null, doc_no: 'GR-2', doc_title: '另一張', doc_status: 'ACCEPTED', from_store_id: 'a', to_store_id: 'b', created_at: '2026-11-12T01:00:00Z' },
  { id: '4', kind: 'UNLINKED_WORK_ORDER', moved: false, request_id: null, work_order_id: 'w9', doc_no: null, doc_title: '舊工單', doc_status: 'PROCESSING', from_store_id: 'a', to_store_id: 'b', created_at: '2026-11-12T01:00:00Z' },
];
describe('groupMoved（伺服端與畫面兩份一致）', () => {
  it('需求單帶出自己的工單，舊式工單另列', () => {
    for (const g of [groupMoved(rows), vueGroupMoved(rows)] as any[]) {
      expect(g.requests.map((r: any) => r.doc_no)).toEqual(['GR-1', 'GR-2']);
      expect(g.requests[0].work_order?.doc_title).toBe('工單一');
      expect(g.requests[1].work_order).toBeNull();
      expect(g.unlinked.map((u: any) => u.doc_title)).toEqual(['舊工單']);
    }
    expect(groupMoved(rows)).toMatchObject({ movedCount: 2, unlinkedCount: 1 });
    expect(groupMoved([])).toMatchObject({ movedCount: 0, unlinkedCount: 0 });
  });
});

describe('確認視窗與結果文字（D21）', () => {
  it('固定告知「進行中的單會一起轉到新門市」', () => {
    expect(moveHeadline('VW001 台北店')).toContain('進行中的單會一起轉到新門市（VW001 台北店）');
    expect(moveHeadline()).toBe('進行中的單會一起轉到新門市，由新門市店長接手。');
  });
  it('受影響張數：有搬、有留、有舊式工單各一句；沒有單也明講', () => {
    expect(moveSummary(null)).toEqual([]);
    expect(moveSummary({ moving_count: 0, staying_count: 0, unlinked_count: 0 })).toEqual(['目前沒有進行中的維修單需要一起轉走。']);
    expect(moveSummary({ moving_count: 2, staying_count: 1, unlinked_count: 3 })).toEqual([
      '會一起轉走 2 張進行中的維修單（含它們的工單）。', '另有 1 張添購等其他類型的單留在原門市。', '有 3 張沒連到需求單的舊式工單不會自動轉，轉移後請人工處理。',
    ]);
  });
  it('結果訊息：0 張不多話', () => {
    expect(moveResultText({ moved_request_count: 0, unlinked_work_order_count: 0 })).toBe('');
    expect(moveResultText(undefined)).toBe('');
    expect(moveResultText({ moved_request_count: 2, unlinked_work_order_count: 1 })).toBe('，2 張進行中的維修單已一起轉到新門市，另有 1 張舊式工單需人工處理');
  });
});
