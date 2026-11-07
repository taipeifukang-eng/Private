import { describe, expect, it } from 'vitest';
import {
  DRAFT_TTL_DAYS,
  DRAFT_TTL_MS,
  draftKey,
  draftUsable,
  expiresAt,
  hasDraftContent,
  isExpired,
  serverMovedOn,
  type OfflineDraft,
} from '../../../lib/workspace/inspection-offline-policy';

// M4 Q14–Q16：離線暫存規則。
const mk = (over: Partial<OfflineDraft> = {}): OfflineDraft => ({
  key: draftKey('u1', 'supervisor', null),
  userId: 'u1',
  type: 'supervisor',
  recordId: null,
  savedAt: Date.now(),
  serverVersion: 0,
  templateHash: 'h',
  templates: [],
  form: {},
  ...over,
});

describe('Q16 保留 15 天', () => {
  it('保留期為 15 天', () => {
    expect(DRAFT_TTL_DAYS).toBe(15);
    expect(DRAFT_TTL_MS).toBe(15 * 24 * 3600 * 1000);
  });
  it('邊界：第 15 天整仍保留，超過 1 毫秒就過期', () => {
    const now = 1_800_000_000_000;
    expect(isExpired(now - DRAFT_TTL_MS, now)).toBe(false);
    expect(isExpired(now - DRAFT_TTL_MS - 1, now)).toBe(true);
    expect(isExpired(now - 14 * 24 * 3600 * 1000, now)).toBe(false);
    expect(isExpired(now - 16 * 24 * 3600 * 1000, now)).toBe(true);
    expect(isExpired(Number.NaN, now)).toBe(true);
    expect(expiresAt(now)).toBe(now + DRAFT_TTL_MS);
  });
});

describe('Q15 依帳號隔離', () => {
  it('key 含使用者、類型與單號（新增用 new）', () => {
    expect(draftKey('u1', 'supervisor', null)).toBe('u1|supervisor|new');
    expect(draftKey('u1', 'manager', 'r1')).toBe('u1|manager|r1');
    expect(draftKey('u1', 'supervisor', null)).not.toBe(draftKey('u2', 'supervisor', null));
  });
  it('別的帳號看不到、過期的不能用', () => {
    const d = mk();
    expect(draftUsable(d, 'u1')).toBe(true);
    expect(draftUsable(d, 'u2')).toBe(false);
    expect(draftUsable(d, '')).toBe(false);
    expect(draftUsable(null, 'u1')).toBe(false);
    expect(draftUsable(mk({ savedAt: Date.now() - DRAFT_TTL_MS - 1000 }), 'u1')).toBe(false);
    expect(draftUsable(mk({ key: 'u2|supervisor|new' }), 'u1')).toBe(false);
  });
});

describe('Q14 編輯暫存與伺服器版本', () => {
  it('編輯暫存：伺服器版本不同就提示；新增暫存不比對', () => {
    expect(serverMovedOn(mk({ recordId: 'r1', serverVersion: 3 }), 3)).toBe(false);
    expect(serverMovedOn(mk({ recordId: 'r1', serverVersion: 3 }), 4)).toBe(true);
    expect(serverMovedOn(mk({ recordId: null, serverVersion: 0 }), 9)).toBe(false);
  });
  it('只暫存有內容的表單', () => {
    expect(hasDraftContent(null)).toBe(false);
    expect(hasDraftContent({ temperature: '', notes: '', staff: [], scores: [{ checked_items: [], notes: '', photos: [] }] })).toBe(false);
    expect(hasDraftContent({ temperature: '25', scores: [] })).toBe(true);
    expect(hasDraftContent({ temperature: '', signature: 'data:x', scores: [] })).toBe(true);
    expect(hasDraftContent({ temperature: '', scores: [{ checked_items: [], notes: '', photos: ['p'] }] })).toBe(true);
    expect(hasDraftContent({ temperature: '', staff: [{ is_manually_added: true }], scores: [] })).toBe(true);
  });
});
