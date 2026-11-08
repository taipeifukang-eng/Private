import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildSupervisorColorMap,
  campaignPhase,
  campaignSections,
  campaignTypeLabel,
  campaignVisibleInList,
  campaignVisibleInView,
  canEnterSchedule,
  CAMPAIGN_DELETE_TABLES,
  deleteNameMatches,
  deleteTotal,
  describeEvent,
  eventOverwrite,
  groupEventsByMonth,
  legacyCampaignWriteAllowed,
  manualScheduleWarnings,
  marketingUploadError,
  moveItem,
  mondayFirstBlanks,
  nativeCampaignWriteAllowed,
  overlappingDays,
  publishedAudiences,
  reorderMarketingImages,
  schedulesOutsideRange,
  SUPERVISOR_COLORS,
  supervisorColor,
  taipeiToday,
  weekdayLabel,
} from '@/lib/workspace/campaign-rules';

const root = path.join(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('Q2 列表狀態依日期（含起訖當天）', () => {
  const c = { start_date: '2099-05-10', end_date: '2099-05-20' };
  it('邊界日', () => {
    expect(campaignPhase(c, '2099-05-09')).toBe('upcoming');
    expect(campaignPhase(c, '2099-05-10')).toBe('ongoing');
    expect(campaignPhase(c, '2099-05-20')).toBe('ongoing');
    expect(campaignPhase(c, '2099-05-21')).toBe('ended');
  });
  it('單日活動', () => {
    expect(campaignPhase({ start_date: '2099-05-10', end_date: '2099-05-10' }, '2099-05-10')).toBe('ongoing');
  });
  it('台灣日期：UTC 16:00 之後已是台灣隔天', () => {
    expect(taipeiToday(new Date('2099-05-09T15:59:00Z'))).toBe('2099-05-09');
    expect(taipeiToday(new Date('2099-05-09T16:00:00Z'))).toBe('2099-05-10');
  });
});

describe('Q2 停用的可見性', () => {
  it('列表：編輯／發布權限者看得到停用，其他人看不到；啟用與空值一律可見', () => {
    expect(campaignVisibleInList({ is_active: false }, true)).toBe(true);
    expect(campaignVisibleInList({ is_active: false }, false)).toBe(false);
    expect(campaignVisibleInList({ is_active: true }, false)).toBe(true);
    expect(campaignVisibleInList({ is_active: null }, false)).toBe(true);
  });
  it('活動檢視：停用一律隱藏，不分權限', () => {
    expect(campaignVisibleInView({ is_active: false })).toBe(false);
    expect(campaignVisibleInView({ is_active: true })).toBe(true);
    expect(campaignVisibleInView({})).toBe(true);
  });
  it('伺服器端三個入口都套用同一組規則（避免有人漏掉）', () => {
    expect(read('app/api/workspace/campaigns/route.ts')).toContain('CAMPAIGN_INACTIVE_VISIBLE_CODES');
    expect(read('app/api/workspace/monthly/tools/route.ts')).toContain('campaignVisibleInView');
    expect(read('app/api/workspace/campaign-tools/route.ts')).toContain('CAMPAIGN_INACTIVE_VISIBLE_CODES');
  });
  it('舊版 route handler 沒有被改動（campaign-tools 直接 import 舊 handler，RBAC 不可更動）', () => {
    const legacy = read('app/api/campaigns/route.ts');
    expect(legacy).not.toContain('campaign-rules');
    expect(legacy).toContain("!['admin', 'manager'].includes(profile.role)");
  });
});

describe('類型文字與排程入口', () => {
  it('促銷統一「促銷（母親節／周年慶等）」', () => {
    expect(campaignTypeLabel('promotion')).toBe('促銷（母親節／周年慶等）');
    expect(campaignTypeLabel('inventory')).toBe('盤點活動');
  });
  it('持有編輯或發布權限者看得到排程入口；純檢視者不行', () => {
    expect(canEnterSchedule({ permissions: { schedules: true } })).toBe(true);
    expect(canEnterSchedule({ permissions: { details: true } })).toBe(true);
    expect(canEnterSchedule({ permissions: { trips: true } })).toBe(true);
    expect(canEnterSchedule({ permissions: { checklist: true } })).toBe(true);
    expect(canEnterSchedule({ permissions: {}, marketing: true })).toBe(true);
    expect(canEnterSchedule({ permissions: {}, merchandise: true })).toBe(true);
    expect(canEnterSchedule({ permissions: { schedules: false, details: false }, marketing: false, merchandise: false })).toBe(false);
    expect(canEnterSchedule({})).toBe(false);
  });
  it('盤點類只有排程、門市細節、預覽表三個分頁', () => {
    expect(campaignSections('inventory').map((s) => s[0])).toEqual(['schedule', 'stores', 'preview']);
    expect(campaignSections('promotion').map((s) => s[0])).toEqual(['schedule', 'stores', 'preview', 'trips', 'checklist', 'marketing', 'merchandise']);
    // 與舊版 isInventory 判斷一致：舊頁的分頁只有在促銷類才出現
    const legacy = read('app/admin/activity-management/schedule/[id]/page.tsx');
    expect(legacy).toContain("campaign.campaign_type === 'promotion'");
  });
});

describe('Q3 刪除確認', () => {
  it('必須完整輸入活動名稱（只忽略前後空白，不忽略大小寫）', () => {
    expect(deleteNameMatches('十一月促銷', '十一月促銷')).toBe(true);
    expect(deleteNameMatches('  十一月促銷 ', '十一月促銷')).toBe(true);
    expect(deleteNameMatches('十一月', '十一月促銷')).toBe(false);
    expect(deleteNameMatches('ABC', 'abc')).toBe(false);
    expect(deleteNameMatches('', '')).toBe(false);
  });
  it('筆數加總；列出的資料表涵蓋所有子表', () => {
    expect(deleteTotal([{ count: 2 }, { count: 0 }, { count: 5 }])).toBe(7);
    expect(CAMPAIGN_DELETE_TABLES.map((t) => t.table).sort()).toEqual(
      [
        'campaign_checklist_completions',
        'campaign_checklist_items',
        'campaign_department_publish',
        'campaign_equipment_trips',
        'campaign_schedules',
        'campaign_store_details',
        'campaign_store_headcount',
        'campaign_store_own_staff',
        'campaign_support_requests',
        'campaign_support_staff',
      ].sort(),
    );
  });
  it('伺服器端刪除也檢查名稱', () => {
    expect(read('app/api/workspace/campaigns/route.ts')).toContain("deleteNameMatches(p.get('confirmName')");
  });
});

describe('Q4 改期後落在期間外的排程', () => {
  const rows = [{ activity_date: '2099-05-01' }, { activity_date: '2099-05-10' }, { activity_date: '2099-05-20' }, { activity_date: '2099-05-21T00:00:00' }];
  it('只挑出期間外（起訖當天算期間內）', () => {
    expect(schedulesOutsideRange(rows, '2099-05-10', '2099-05-20').map((r) => r.activity_date)).toEqual(['2099-05-01', '2099-05-21T00:00:00']);
    expect(schedulesOutsideRange(rows, '2099-05-01', '2099-05-30')).toEqual([]);
  });
});

describe('Q5 誤操作提醒', () => {
  const events = [{ event_date: '2099-05-06', description: '國定假日', is_blocked: true }, { event_date: '2099-05-07', description: '不擋', is_blocked: false }];
  const settings = [{ store_id: 'a', forbidden_days: [3], allowed_days: [] }, { store_id: 'b', allowed_days: [6, 7], forbidden_days: [] }];
  it('(b) 排到禁止日', () => {
    const w = manualScheduleWarnings({ date: '2099-05-06', storeId: 'x', events, settings });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('禁止排程日');
    expect(manualScheduleWarnings({ date: '2099-05-07', storeId: 'x', events, settings })).toEqual([]);
  });
  it('(b) 排到門市禁止的星期、或不在允許的星期', () => {
    // 2099-05-06 是週三
    expect(weekdayLabel('2099-05-06')).toBe('週三');
    expect(manualScheduleWarnings({ date: '2099-05-06', storeId: 'a', events: [], settings }).join()).toContain('不排在週三');
    expect(manualScheduleWarnings({ date: '2099-05-06', storeId: 'b', events: [], settings }).join()).toContain('只能排在週六、日');
    expect(manualScheduleWarnings({ date: '2099-05-09', storeId: 'b', events: [], settings })).toEqual([]);
  });
  it('(b) 兩種都中時同時列出', () => {
    expect(manualScheduleWarnings({ date: '2099-05-06', storeId: 'a', events, settings })).toHaveLength(2);
  });
  it('(a) 同一天已有特殊日期：內容不同才提醒，並回傳原內容', () => {
    expect(eventOverwrite(events, { event_date: '2099-05-06', description: '國定假日', event_type: '', is_blocked: false })?.is_blocked).toBe(true);
    expect(eventOverwrite(events, { event_date: '2099-05-08', description: 'x', is_blocked: true })).toBeNull();
    const same = { event_date: '2099-05-06', description: '國定假日', event_type: 'holiday', is_blocked: true };
    expect(eventOverwrite([same], { ...same })).toBeNull();
    expect(describeEvent({ ...same })).toContain('禁止自動排程');
  });
  it('(c) 已發布給哪些對象', () => {
    expect(publishedAudiences({})).toEqual([]);
    expect(publishedAudiences({ published_to_supervisors: true, published_to_inventory_team: true })).toEqual(['督導', '盤點組人員']);
    expect(publishedAudiences({ published_to_store_managers: true })).toEqual(['店長']);
  });
});

describe('月曆、督導區顏色、特殊日期分組（舊版補回）', () => {
  it('週一為首：2099-05-01 是週五 → 前面 4 格空白；週一 0 格；週日 6 格', () => {
    expect(mondayFirstBlanks('2099-05-01')).toBe(4);
    expect(mondayFirstBlanks('2099-05-04')).toBe(0);
    expect(mondayFirstBlanks('2099-05-03')).toBe(6);
  });
  it('督導顏色：與舊版 12 色同順序、同名稱；督導 ID 排序後固定分配並循環', () => {
    const legacy = read('app/admin/activity-management/schedule/[id]/page.tsx');
    const block = legacy.slice(legacy.indexOf('const AVAILABLE_COLORS'), legacy.indexOf('const DEFAULT_COLOR'));
    const legacyColors = Array.from(block.matchAll(/bg-([a-z]+)-200[^}]*name: '([^']+)'/g)).map((m) => [m[1], m[2]]);
    expect(legacyColors).toHaveLength(12);
    expect(SUPERVISOR_COLORS.map((c) => c.name)).toEqual(legacyColors.map((c) => c[1]));
    const stores = ['s3', 's1', 's2', null].map((supervisor_id) => ({ supervisor_id }));
    const map = buildSupervisorColorMap(stores);
    expect(Object.keys(map).sort()).toEqual(['s1', 's2', 's3']);
    expect(map.s1).toBe(SUPERVISOR_COLORS[0]);
    expect(map.s2).toBe(SUPERVISOR_COLORS[1]);
    expect(map.s3).toBe(SUPERVISOR_COLORS[2]);
    const many = buildSupervisorColorMap(Array.from({ length: 13 }, (_, i) => ({ supervisor_id: 'u' + String(i).padStart(2, '0') })));
    expect(many.u12).toBe(SUPERVISOR_COLORS[0]);
    expect(supervisorColor(map, null).name).toBe('灰色');
    expect(supervisorColor(map, 'unknown').name).toBe('灰色');
  });
  it('特殊日期依月份分組、日期遞增', () => {
    const g = groupEventsByMonth([{ event_date: '2099-06-01' }, { event_date: '2099-05-20' }, { event_date: '2099-05-02' }]);
    expect(g.map((x) => [x.month, x.rows.map((r) => r.event_date)])).toEqual([['2099-05', ['2099-05-02', '2099-05-20']], ['2099-06', ['2099-06-01']]]);
    expect(groupEventsByMonth([{ event_date: '2099-06-01' }, { event_date: '2099-05-20' }], false)[0].month).toBe('2099-06');
  });
  it('允許與禁止星期重疊要擋', () => {
    expect(overlappingDays([1, 3, 6], [3, 7])).toEqual([3]);
    expect(overlappingDays([1], [2])).toEqual([]);
  });
});

describe('行銷部圖片（最多 8 張、5MB、拖曳排序）', () => {
  const form = { marketing_image_names: ['a', 'b', 'c'], marketing_image_paths: ['pa', 'pb', 'pc'], marketing_image_urls: ['ua', 'ub', 'uc'], other: 1 };
  it('三個對齊的陣列一起移動，其他欄位不變', () => {
    const r = reorderMarketingImages(form, 0, 2);
    expect(r.marketing_image_names).toEqual(['b', 'c', 'a']);
    expect(r.marketing_image_paths).toEqual(['pb', 'pc', 'pa']);
    expect(r.marketing_image_urls).toEqual(['ub', 'uc', 'ua']);
    expect(r.other).toBe(1);
    expect(form.marketing_image_names).toEqual(['a', 'b', 'c']);
  });
  it('超出範圍或原地不動：不變', () => {
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], -1, 1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 0, 3)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });
  it('上限與檔案規則', () => {
    const png = { size: 1000, type: 'image/png' };
    expect(marketingUploadError(0, [])).toBeNull();
    expect(marketingUploadError(7, [png])).toBeNull();
    expect(marketingUploadError(8, [png])).toContain('最多 8 張');
    expect(marketingUploadError(5, [png, png, png, png])).toContain('最多 8 張');
    expect(marketingUploadError(0, [{ size: 5 * 1024 * 1024 + 1, type: 'image/png' }])).toContain('5MB');
    expect(marketingUploadError(0, [{ size: 5 * 1024 * 1024, type: 'image/png' }])).toBeNull();
    expect(marketingUploadError(0, [{ size: 10, type: 'image/gif' }])).toContain('PNG');
  });
  it('與舊版 MAX_MARKETING_IMAGE_COUNT 相同', () => {
    expect(read('app/admin/activity-management/schedule/[id]/page.tsx')).toContain('MAX_MARKETING_IMAGE_COUNT = 8');
  });
});

describe('Q1 寫入權限語意', () => {
  it('舊版只看 profiles.role（admin／manager）；新版只看角色權限', () => {
    expect(legacyCampaignWriteAllowed('admin')).toBe(true);
    expect(legacyCampaignWriteAllowed('manager')).toBe(true);
    expect(legacyCampaignWriteAllowed('member')).toBe(false);
    expect(legacyCampaignWriteAllowed(null)).toBe(false);
    const has = (...codes: string[]) => codes.some((c) => ['activity.campaign.edit'].includes(c));
    expect(nativeCampaignWriteAllowed(has)).toBe(true);
    expect(nativeCampaignWriteAllowed(() => false)).toBe(false);
  });
  it('新版寫入入口沒有 profiles.role 前置條件', () => {
    const route = read('app/api/workspace/campaigns/route.ts');
    expect(route).not.toContain("'manager'");
    expect(route).toContain('requireCapability(ctx, CAMPAIGN_EDIT_CODES)');
  });
});
