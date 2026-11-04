import crypto from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { CAMPAIGN_FLAGS, type CampaignKey, type CvFixtures } from './cv01-fixtures';

/** CV01 讀取／寫入比對共用的端點對照（舊 API ↔ 新 workspace campaign-tools）。 */

export interface ReadPair {
  name: string;
  legacy: (cid: string) => string;
  native: (cid: string) => string;
  /** 回應中的列（id 集合比對用）。 */
  rows: (json: any) => any[];
}

const tools = (resource: string, cid: string) => `/api/workspace/campaign-tools?resource=${resource}&campaign_id=${cid}`;
const dataRows = (j: any) => (Array.isArray(j?.data) ? j.data : []);

export const READ_PAIRS: ReadPair[] = [
  { name: 'schedules', legacy: (c) => `/api/campaign-schedules?campaign_id=${c}`, native: (c) => tools('schedules', c), rows: (j) => (Array.isArray(j?.schedules) ? j.schedules : []) },
  { name: 'details', legacy: (c) => `/api/campaign-store-details?campaign_id=${c}`, native: (c) => tools('details', c), rows: dataRows },
  { name: 'headcount', legacy: (c) => `/api/campaign-store-headcount?campaign_id=${c}`, native: (c) => tools('headcount', c), rows: dataRows },
  { name: 'ownStaff', legacy: (c) => `/api/campaign-store-own-staff?campaign_id=${c}`, native: (c) => tools('ownStaff', c), rows: dataRows },
  { name: 'completions', legacy: (c) => `/api/campaign-checklist-completions?campaign_id=${c}`, native: (c) => tools('completions', c), rows: dataRows },
  { name: 'trips', legacy: (c) => `/api/campaign-equipment-trips?campaign_id=${c}`, native: (c) => tools('trips', c), rows: dataRows },
  { name: 'requests', legacy: (c) => `/api/campaign-support-requests?campaign_id=${c}`, native: (c) => tools('requests', c), rows: dataRows },
  { name: 'supportStaff', legacy: (c) => `/api/campaign-support-staff?campaign_id=${c}`, native: (c) => tools('supportStaff', c), rows: dataRows },
  { name: 'checklist', legacy: (c) => `/api/campaign-checklist-items?campaign_id=${c}`, native: (c) => tools('checklist', c), rows: dataRows },
  { name: 'departments', legacy: (c) => `/api/campaign-department-publish?campaign_id=${c}`, native: (c) => tools('departments', c), rows: (j) => (j?.data ? [j.data] : []) },
];

export async function getJson(ctx: APIRequestContext, url: string): Promise<{ status: number; json: any }> {
  const res = await ctx.get(url);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status(), json };
}

export async function sendJson(ctx: APIRequestContext, method: 'POST' | 'DELETE' | 'PUT' | 'PATCH', url: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await ctx.fetch(url, { method, data: body as object });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status(), json };
}

/** 一個寫入情境：舊 API 與新 workspace campaign-tools 送同一份內容。 */
export interface WriteCase {
  name: string;
  campaign: CampaignKey;
  store: string;
  method: 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  /** 新版使用的方法與內容（預設與舊版相同）。整批 PUT 需要先 GET 取得 version。 */
  nativeMethod?: 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  nativeBody?: (fx: CvFixtures, ctx: APIRequestContext) => Promise<Record<string, unknown>>;
  /** 只有 edit 權（editCodes）可寫，view_own 任命身分不放行（如發布）。 */
  editOnly?: boolean;
  legacyPath: string;
  resource: string;
  body: (fx: CvFixtures) => Record<string, unknown>;
  /** 每次呼叫前後把資料還原成固定狀態（讓舊／新兩次呼叫面對相同資料）。 */
  reset?: (fx: CvFixtures) => Promise<void>;
  /** 此情境依賴的門市任命檢查：寫入目標門市代碼（oracle 用）。 */
  storeCodes: string[];
  anyStore?: boolean;
  editCodes: string[];
  /** RLS 寫入 policy 要求的權限（除 activity.manage 外）。 */
  rlsCodes: string[];
}

const SUPPORT_TARGET: Record<string, string> = { VW001: 'ZT03', VW002: 'ZT03', ZT01: 'ZT03', ZT02: 'VW002', ZT03: 'VW002' };

export function buildWriteCases(): WriteCase[] {
  const out: WriteCase[] = [];
  for (const campaign of ['SM', 'SUP', 'DRAFT'] as CampaignKey[]) {
    for (const store of ['VW001', 'VW002', 'ZT01']) {
      out.push({
        name: `headcount POST ${store} [${campaign}]`,
        campaign,
        store,
        method: 'POST',
        legacyPath: '/api/campaign-store-headcount',
        resource: 'headcount',
        body: (fx) => ({ campaign_id: fx.campaigns[campaign].id, store_id: fx.stores[store].id, extra_support_count: 1, supervisor_count: 0, notes: 'cvp' }),
        storeCodes: [store],
        editCodes: ['activity.store_detail.edit'],
        rlsCodes: ['activity.store_detail.edit'],
      });
      out.push({
        name: `ownStaff POST ${store} [${campaign}]`,
        campaign,
        store,
        method: 'POST',
        legacyPath: '/api/campaign-store-own-staff',
        resource: 'ownStaff',
        body: (fx) => ({ campaign_id: fx.campaigns[campaign].id, store_id: fx.stores[store].id, staff: [{ employee_code: 'CVP001', employee_name: 'cvp' }], replace: true }),
        storeCodes: [store],
        editCodes: [],
        rlsCodes: ['activity.support_assign.edit'],
      });
      out.push({
        name: `ownStaff DELETE ${store} [${campaign}]`,
        campaign,
        store,
        method: 'DELETE',
        legacyPath: '/api/campaign-store-own-staff',
        resource: 'ownStaff',
        body: (fx) => ({ campaign_id: fx.campaigns[campaign].id, store_id: fx.stores[store].id, employee_code: 'CVP001' }),
        reset: async (fx) => {
          const { error } = await fx.db.from('campaign_store_own_staff').upsert(
            { campaign_id: fx.campaigns[campaign].id, store_id: fx.stores[store].id, employee_code: 'CVP001', employee_name: 'cvp', sort_order: 0 },
            { onConflict: 'campaign_id,store_id,employee_code', ignoreDuplicates: true },
          );
          if (error) {
            const { data } = await fx.db.from('campaign_store_own_staff').select('id').eq('campaign_id', fx.campaigns[campaign].id).eq('store_id', fx.stores[store].id).eq('employee_code', 'CVP001');
            if (!data?.length) await fx.db.from('campaign_store_own_staff').insert({ campaign_id: fx.campaigns[campaign].id, store_id: fx.stores[store].id, employee_code: 'CVP001', employee_name: 'cvp', sort_order: 0 });
          }
        },
        storeCodes: [store],
        editCodes: [],
        rlsCodes: ['activity.support_assign.edit'],
      });
      out.push({
        name: `completions POST ${store} [${campaign}]`,
        campaign,
        store,
        method: 'POST',
        legacyPath: '/api/campaign-checklist-completions',
        resource: 'completions',
        body: (fx) => ({ checklist_item_id: fx.items[campaign], store_id: fx.stores[store].id, is_completed: false, manager_note: 'cvp' }),
        storeCodes: [store],
        editCodes: ['activity.checklist.edit'],
        rlsCodes: [],
      });
      out.push({
        name: `requests POST ${store} [${campaign}]`,
        campaign,
        store,
        method: 'POST',
        legacyPath: '/api/campaign-support-requests',
        resource: 'requests',
        body: (fx) => ({ campaign_id: fx.campaigns[campaign].id, requesting_store_id: fx.stores[store].id, supporting_store_id: fx.stores[SUPPORT_TARGET[store]].id, requested_count: 1, notes: 'cvp-write' }),
        reset: async (fx) => {
          await fx.db.from('campaign_support_requests').delete().eq('campaign_id', fx.campaigns[campaign].id).eq('notes', 'cvp-write');
        },
        storeCodes: [store],
        editCodes: [],
        rlsCodes: ['activity.support_request.edit'],
      });
    }
    // 支援人員：R1 = VW001→ZT02、R3 = ZT03→VW002（支援門市與請求門市任一被任命即可）
    for (const rk of ['R1', 'R2', 'R3'] as const) {
      out.push({
        name: `supportStaff POST ${rk} [${campaign}]`,
        campaign,
        store: rk === 'R1' ? 'VW001' : rk === 'R2' ? 'ZT03' : 'VW002',
        method: 'POST',
        legacyPath: '/api/campaign-support-staff',
        resource: 'supportStaff',
        body: (fx) => {
          const r = fx.requests[campaign][rk];
          return {
            support_request_id: r.id,
            campaign_id: fx.campaigns[campaign].id,
            supporting_store_id: fx.stores[r.sup].id,
            requesting_store_id: fx.stores[r.req].id,
            staff: [{ employee_code: 'CVPF', employee_name: 'cvp' }],
            replace: true,
          };
        },
        storeCodes: rk === 'R1' ? ['ZT02', 'VW001'] : rk === 'R2' ? ['ZT03', 'ZT02'] : ['VW002', 'ZT03'],
        anyStore: true,
        editCodes: [],
        rlsCodes: ['activity.support_assign.edit'],
      });
      // 新版整批儲存（PUT，Vue 實際使用的路徑）必須與舊版 POST 的授權與任命門市範圍相同
      out.push({
        name: `supportStaff PUT ${rk} [${campaign}]`,
        campaign,
        store: rk === 'R1' ? 'VW001' : rk === 'R2' ? 'ZT03' : 'VW002',
        method: 'POST',
        nativeMethod: 'PUT',
        legacyPath: '/api/campaign-support-staff',
        resource: 'supportStaff',
        body: (fx) => {
          const r = fx.requests[campaign][rk];
          return {
            support_request_id: r.id,
            campaign_id: fx.campaigns[campaign].id,
            supporting_store_id: fx.stores[r.sup].id,
            requesting_store_id: fx.stores[r.req].id,
            staff: [{ employee_code: 'CVPF', employee_name: 'cvp' }],
            replace: true,
          };
        },
        nativeBody: async (fx, ctx) => {
          const r = fx.requests[campaign][rk];
          const cid = fx.campaigns[campaign].id;
          const got = await getJson(ctx, `/api/workspace/campaign-tools?resource=supportStaff&campaign_id=${cid}&support_request_id=${r.id}`);
          return { campaign_id: cid, scope: r.id, rows: [{ employee_code: 'CVPF', employee_name: 'cvp' }], version: got.json?.version ?? null, requestId: crypto.randomUUID() };
        },
        storeCodes: rk === 'R1' ? ['ZT02', 'VW001'] : rk === 'R2' ? ['ZT03', 'ZT02'] : ['VW002', 'ZT03'],
        anyStore: true,
        editCodes: [],
        rlsCodes: ['activity.support_assign.edit'],
      });
    }
  }
  // 自有人員整批儲存（PUT）：舊版 POST replace 的授權為 support_assign.edit＋任命門市
  for (const campaign of ['SM', 'SUP', 'DRAFT'] as CampaignKey[]) {
    for (const store of ['VW001', 'VW002', 'ZT01']) {
      out.push({
        name: `ownStaff PUT ${store} [${campaign}]`,
        campaign,
        store,
        method: 'POST',
        nativeMethod: 'PUT',
        legacyPath: '/api/campaign-store-own-staff',
        resource: 'ownStaff',
        body: (fx) => ({ campaign_id: fx.campaigns[campaign].id, store_id: fx.stores[store].id, staff: [{ employee_code: 'CVP001', employee_name: 'cvp' }], replace: true }),
        nativeBody: async (fx, ctx) => {
          const cid = fx.campaigns[campaign].id;
          const got = await getJson(ctx, `/api/workspace/campaign-tools?resource=ownStaff&campaign_id=${cid}&store_id=${fx.stores[store].id}`);
          return { campaign_id: cid, scope: fx.stores[store].id, rows: [{ employee_code: 'CVP001', employee_name: 'cvp' }], version: got.json?.version ?? null, requestId: crypto.randomUUID() };
        },
        storeCodes: [store],
        editCodes: [],
        rlsCodes: ['activity.support_assign.edit'],
      });
    }
  }
  // 發布 PATCH：activity.manage 或 activity.campaign.edit（維持原狀態，不改資料）
  for (const campaign of ['SM', 'SUP', 'INV', 'DRAFT'] as CampaignKey[]) {
    out.push({
      name: `publish PATCH [${campaign}]`,
      campaign,
      store: '',
      method: 'PATCH',
      legacyPath: '/api/campaigns/publish',
      resource: 'publish',
      body: (fx) => ({ campaignId: fx.campaigns[campaign].id, publishType: 'supervisors', status: CAMPAIGN_FLAGS[campaign].pubSup }),
      storeCodes: [],
      editOnly: true,
      editCodes: ['activity.manage', 'activity.campaign.edit'],
      rlsCodes: [],
    });
  }
  return out;
}

/** 有限並行（保留順序）。 */
export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** 寫入情境的並行分組：同一組的資料列會互相影響，需依序執行；不同組可並行。 */
export function writeGroupKey(c: WriteCase): string {
  // 整批 PUT 的 version 含 campaigns 列本身，發布 PATCH 會改動它：這三類同一活動必須依序執行，避免並行造成 stale
  if (['ownStaff', 'supportStaff', 'publish'].includes(c.resource)) return `campaign-state|${c.campaign}`;
  return `${c.resource}|${c.campaign}|${c.resource === 'requests' ? '' : c.store}`;
}

/** 「被拒絕」的等價類：舊 API 對看不到的活動回 404（RLS 讓活動不可見）或 403，新版前置閘門回 403，皆為拒絕。 */
export function statusClass(status: number): string {
  return [401, 403, 404].includes(status) ? 'denied' : String(status);
}
