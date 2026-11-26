import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  GPS_EXEMPT_FORBIDDEN_MESSAGE,
  canUseGpsExempt,
  planGpsExempt,
} from '@/lib/workspace/inspection-gps-exempt';
import { resolveAccess } from '@/lib/workspace/permission-semantics';
import { countGpsExempt, filterGpsExempt } from '@/lib/workspace/inspection-list';
import { classifyGpsDbError } from '@/lib/inspection/gps-policy';

// 新版巡店「定位例外」伺服器規則：資格一律以 ctx.has（resolveAccess）判斷，語意同正式區 has_permission。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

const exemptRole = (extra: Record<string, unknown> = {}, roleExtra: Record<string, unknown> = {}) => ({
  is_active: true,
  expires_at: null,
  role: {
    code: 'ztk_exempt_tester',
    ...roleExtra,
    role_permissions: [{ is_allowed: true, permission: { code: 'inspection.gps_exempt', is_active: true } }],
  },
  ...extra,
});
const plainRole = {
  is_active: true,
  expires_at: null,
  role: {
    code: 'store_manager_like',
    role_permissions: [{ is_allowed: true, permission: { code: 'inspection.create', is_active: true } }],
  },
};
const hasFor = (assignments: any[], profileRole: string | null = null) => resolveAccess(assignments, profileRole).has;

const farFix = { latitude: 25.03, longitude: 121.56, accuracy: 25000, capturedAt: '2038-06-01T03:00:00.000Z' };
const NOW = new Date('2038-06-01T03:30:00.000Z'); // 台北 2038-06-01 11:30

describe('定位例外資格（對齊正式區 has_permission 與 ctx.isAdmin）', () => {
  it('有 inspection.gps_exempt 權限者可用', () => {
    expect(canUseGpsExempt(hasFor([exemptRole()]))).toBe(true);
  });
  it('沒有該權限者不可用', () => {
    expect(canUseGpsExempt(hasFor([plainRole]))).toBe(false);
    expect(canUseGpsExempt(hasFor([]))).toBe(false);
  });
  it('權限被明確設為不允許（is_allowed=false）或權限本身停用，不可用', () => {
    const denied = { ...exemptRole(), role: { code: 'x', role_permissions: [{ is_allowed: false, permission: { code: 'inspection.gps_exempt', is_active: true } }] } };
    const inactivePerm = { ...exemptRole(), role: { code: 'x', role_permissions: [{ is_allowed: true, permission: { code: 'inspection.gps_exempt', is_active: false } }] } };
    expect(canUseGpsExempt(hasFor([denied]))).toBe(false);
    expect(canUseGpsExempt(hasFor([inactivePerm]))).toBe(false);
  });
  it('系統管理員（profiles.role = admin）一律可用，即使沒有任何角色權限', () => {
    expect(canUseGpsExempt(hasFor([], 'admin'))).toBe(true);
  });
  it('admin-like 角色（ctx.isAdmin）也可用，與 ctx.has 一致', () => {
    const owner = { is_active: true, expires_at: null, role: { code: 'owner', role_permissions: [] } };
    expect(canUseGpsExempt(hasFor([owner]))).toBe(true);
  });
  it('正式區語意：roles.is_active = false 的角色仍然有效（不檢查 roles.is_active）', () => {
    expect(canUseGpsExempt(hasFor([exemptRole({}, { is_active: false })]))).toBe(true);
  });
  it('但 user_roles 停用或已過期則不可用', () => {
    expect(canUseGpsExempt(hasFor([exemptRole({ is_active: false })]))).toBe(false);
    expect(canUseGpsExempt(hasFor([exemptRole({ expires_at: '2000-01-01T00:00:00Z' })]))).toBe(false);
  });
});

describe('planGpsExempt：新增時的例外判斷', () => {
  const allowed = hasFor([exemptRole()]);
  const denied = hasFor([plainRole]);

  it('沒帶 gps_exempt 或不是 true：不走例外（交給一般定位驗證，誤差仍會被擋）', () => {
    expect(planGpsExempt({ gps: farFix }, allowed, NOW)).toEqual({ exempt: false });
    expect(planGpsExempt({ gps_exempt: false, gps: farFix }, allowed, NOW)).toEqual({ exempt: false });
    expect(planGpsExempt({ gps_exempt: 'true', gps: farFix }, allowed, NOW)).toEqual({ exempt: false });
    expect(planGpsExempt({ gps_exempt: 1, gps: farFix }, allowed, NOW)).toEqual({ exempt: false });
  });
  it('沒有資格卻帶 gps_exempt=true：403 與中文訊息，且訊息會被前端與 classifyGpsDbError 辨識為權限問題', () => {
    const r = planGpsExempt({ gps_exempt: true, gps: farFix }, denied, NOW);
    expect(r).toEqual({ error: { status: 403, message: GPS_EXEMPT_FORBIDDEN_MESSAGE } });
    expect(GPS_EXEMPT_FORBIDDEN_MESSAGE).toBe('【巡店定位】你沒有「巡店定位例外」權限');
    expect(GPS_EXEMPT_FORBIDDEN_MESSAGE).toMatch(/定位/);
    expect(classifyGpsDbError(GPS_EXEMPT_FORBIDDEN_MESSAGE)).toBe('exempt_forbidden');
  });
  it('不信任 client 傳來的任何資格欄位', () => {
    const r = planGpsExempt({ gps_exempt: true, gps: farFix, canUseGpsExempt: true, isAdmin: true, gpsExemptAllowed: true } as any, denied, NOW);
    expect('error' in r && r.error.status).toBe(403);
  });
  it('有權限、誤差 25000：照存座標與誤差，日期用伺服器端台北今天', () => {
    const r = planGpsExempt({ gps_exempt: true, gps: farFix, date: '2020-01-01' } as any, allowed, NOW);
    expect(r).toEqual({
      exempt: true,
      gps: { gps_latitude: 25.03, gps_longitude: 121.56, gps_accuracy: 25000, gps_timestamp: '2038-06-01T03:00:00.000Z' },
      date: '2038-06-01',
    });
  });
  it('管理員也能走例外', () => {
    const r = planGpsExempt({ gps_exempt: true, gps: farFix }, hasFor([], 'admin'), NOW);
    expect('exempt' in r && r.exempt).toBe(true);
  });
  it('台北跨日：UTC 還在前一天但台北已是隔天', () => {
    const r = planGpsExempt({ gps_exempt: true, gps: null }, allowed, new Date('2038-06-01T17:00:00.000Z'));
    expect('exempt' in r && r.exempt && r.date).toBe('2038-06-02');
  });
  it('沒有定位（null／缺欄位）：四個 gps 欄位全 null', () => {
    const nulls = { gps_latitude: null, gps_longitude: null, gps_accuracy: null, gps_timestamp: null };
    for (const gps of [null, undefined, {}, { latitude: null, longitude: null }]) {
      const r = planGpsExempt({ gps_exempt: true, gps }, allowed, NOW);
      expect(r).toMatchObject({ exempt: true, gps: nulls });
    }
  });
  it('座標超出範圍或只給一半：400，不存', () => {
    for (const gps of [{ latitude: 91, longitude: 121 }, { latitude: 25, longitude: 181 }, { latitude: 25 }, { latitude: 'x', longitude: 1 }]) {
      const r = planGpsExempt({ gps_exempt: true, gps }, allowed, NOW);
      expect('error' in r && r.error.status).toBe(400);
    }
  });
  it('誤差缺值或為負：誤差存 null、座標照存；時間無效存 null', () => {
    const r = planGpsExempt({ gps_exempt: true, gps: { latitude: 25, longitude: 121, accuracy: -5, capturedAt: 'not-a-date' } }, allowed, NOW);
    expect(r).toMatchObject({ exempt: true, gps: { gps_latitude: 25, gps_longitude: 121, gps_accuracy: null, gps_timestamp: null } });
  });
});

describe('列表：只看定位例外的篩選與計數', () => {
  const rows = [{ id: 1, gps_exempt: true }, { id: 2, gps_exempt: false }, { id: 3 }, { id: 4, gps_exempt: true }];
  it('計數只算 gps_exempt = true，不受篩選影響', () => {
    expect(countGpsExempt(rows)).toBe(2);
  });
  it('篩選開啟只留例外；關閉回傳原陣列', () => {
    expect(filterGpsExempt(rows, true).map((r) => r.id)).toEqual([1, 4]);
    expect(filterGpsExempt(rows, false)).toBe(rows);
  });
});

describe('API 與畫面接線（原始碼斷言）', () => {
  const route = read('app/api/workspace/inspection-form/route.ts');
  const editor = read('vue-workspace/src/pages/InspectionEditor.vue');
  const guide = read('vue-workspace/src/components/GpsGuideDialog.vue');
  it('POST：例外只在新增時評估，編輯時忽略 body.gps_exempt；資格由 ctx.has 判斷', () => {
    expect(route).toContain('record');
    expect(route).toMatch(/record\s*\?\s*\{ exempt: false \}\s*:\s*planGpsExempt\(body, ctx\.has\)/);
  });
  it('GET：回傳伺服器算出的 gpsExemptAllowed', () => {
    expect(route).toContain('gpsExemptAllowed: canUseGpsExempt(ctx.has)');
  });
  it('列表與詳情 API 都 select gps_exempt', () => {
    expect(read('app/api/workspace/inspections/route.ts')).toContain('improvement_bonus,gps_exempt');
    expect(read('app/api/workspace/inspection-detail/route.ts')).toContain('gps_exempt');
  });
  it('編輯器：按鈕、狀態與送出 payload 沿用舊版 data-testid 與文案', () => {
    for (const s of ['gps-exempt-button', 'gps-exempt-status', 'gps-exempt-fix', 'useGpsExempt', '⚠ 已使用', '改回重新定位', '未取得定位，將不記錄座標', '將一併記錄這次定位結果', 'gps_exempt: true']) expect(editor).toContain(s);
    expect(editor).toContain('權限：定位失敗時可改用定位例外送出。');
  });
  it('教學視窗：有資格才出現「使用定位例外送出」，並把誤差傳給提示', () => {
    expect(guide).toContain('gps-guide-exempt');
    expect(guide).toContain('props.failureAccuracy');
  });
});
