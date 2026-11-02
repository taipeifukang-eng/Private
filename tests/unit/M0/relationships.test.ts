import { describe, expect, it } from 'vitest';
import {
  filterRelationshipMembers,
  lastFkrsNumber,
  matchesRelationshipFilter,
  relationshipPageCount,
  type RelationshipMemberLike,
} from '../../../vue-workspace/src/relationship-members';
import { isPageAllowed, pageTitle, type Capabilities } from '../../../vue-workspace/src/workspace-page-meta';

// 舊版規則來源：app/store/relationship-members/RelationshipMembersClient.tsx（filteredMembers / FKRS 最後一號）。
const approvedNoNumber: RelationshipMemberLike = { member_name: '甲', phone: '0911', relationship: '配偶', member_number: '  ', is_approved: true, rejected_at: null, creator: { full_name: '王小明' } };
const approvedWithNumber: RelationshipMemberLike = { member_name: '乙', phone: '0922', relationship: '父母', member_number: 'FKRS0010', is_approved: true, rejected_at: null };
const pending: RelationshipMemberLike = { member_name: '丙', phone: '0933', relationship: '朋友', member_number: null, is_approved: false, rejected_at: null };
const rejected: RelationshipMemberLike = { member_name: '丁', phone: '0944', relationship: '同事', member_number: null, is_approved: false, rejected_at: '2026-01-01T00:00:00Z' };
const all = [approvedNoNumber, approvedWithNumber, pending, rejected];

describe('M0 關係會員：分頁篩選規則（與舊版 filteredMembers 一致）', () => {
  it.each([
    ['all', [true, true, true, true]],
    ['approved_missing_number', [true, false, false, false]],
    ['pending', [false, false, true, false]],
    ['rejected', [false, false, false, true]],
  ])('篩選 %s', (key, expected) => {
    expect(all.map((m) => matchesRelationshipFilter(m, key))).toEqual(expected);
  });

  it('搜尋比對姓名、電話、關係、會員編號、填表人，且不分大小寫與前後空白', () => {
    expect(filterRelationshipMembers(all, 'all', ' 0922 ')).toEqual([approvedWithNumber]);
    expect(filterRelationshipMembers(all, 'all', 'fkrs0010')).toEqual([approvedWithNumber]);
    expect(filterRelationshipMembers(all, 'all', '王小明')).toEqual([approvedNoNumber]);
    expect(filterRelationshipMembers(all, 'all', '同事')).toEqual([rejected]);
    expect(filterRelationshipMembers(all, 'all', '')).toHaveLength(4);
    expect(filterRelationshipMembers(all, 'all', '查無此人')).toEqual([]);
  });

  it('篩選與搜尋同時生效', () => {
    expect(filterRelationshipMembers(all, 'pending', '丙')).toEqual([pending]);
    expect(filterRelationshipMembers(all, 'pending', '乙')).toEqual([]);
  });
});

describe('M0 關係會員：FKRS 最後一號與分頁', () => {
  it('依數字大小取最大，不是字串排序', () => {
    const list = ['FKRS0009', 'FKRS0100', 'fkrs0020', 'M00001', null, ''].map((n) => ({ member_number: n }));
    expect(lastFkrsNumber(list)).toBe('FKRS0100');
  });
  it('沒有 FKRS 編號時顯示預設文字', () => {
    expect(lastFkrsNumber([{ member_number: 'M0001' }, { member_number: null }])).toBe('尚無 FKRS 編號');
    expect(lastFkrsNumber([])).toBe('尚無 FKRS 編號');
  });
  it('每頁 50 筆，至少 1 頁', () => {
    expect(relationshipPageCount(0)).toBe(1);
    expect(relationshipPageCount(50)).toBe(1);
    expect(relationshipPageCount(51)).toBe(2);
    expect(relationshipPageCount(101)).toBe(3);
  });
});

describe('M0 關係會員：頁面登錄與權限開關', () => {
  const caps = (relationships: boolean) => ({ relationships }) as unknown as Capabilities;
  it('標題與權限開關', () => {
    expect(pageTitle('relationships')).toBe('關係會員');
    expect(isPageAllowed('relationships', caps(true))).toBe(true);
    expect(isPageAllowed('relationships', caps(false))).toBe(false);
  });
});
