import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceNavigation } from '@/lib/workspace/navigation';
import { CAMPAIGN_PAGE_CODES, CAMPAIGN_READ_CODES, type Context } from '@/lib/workspace/server';
import { isScopePermission, permissionLabel, preferredScopePermission, type ScopePermission } from '../../../vue-workspace/src/role-scope';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('CV01 workspace 引用單一規則來源（lib/campaign-access.ts）', () => {
  it('workspace 活動 API 不自行判斷身分或範圍（不查 store_managers／job_title／department）', () => {
    for (const f of [
      'app/api/workspace/campaigns/route.ts',
      'app/api/workspace/campaign-tools/route.ts',
      'app/api/workspace/campaign-schedules/route.ts',
      'app/api/workspace/monthly/tools/route.ts',
      'app/api/workspace/session/route.ts',
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/(?<!published_to_)store_managers|job_title|營業部-盤點組|isBusinessManager|isInventoryTeam|isMarketingWithAccess|isBusinessAssistant/);
    }
  });

  it('可見活動委派舊 GET /api/campaigns；入口用 canEnterCampaignView', () => {
    expect(read('app/api/workspace/campaigns/route.ts')).toMatch(/from "@\/app\/api\/campaigns\/route"/);
    expect(read('app/api/workspace/session/route.ts')).toMatch(/canEnterCampaignView\(ctx\.auth, ctx\.user\.id\)/);
    // M5 W20：月報工具與獨立活動檢視頁共用 lib/workspace/activity-view.ts，入口判斷只寫在那一處。
    const tools = read('app/api/workspace/monthly/tools/route.ts');
    const shared = read('lib/workspace/activity-view.ts');
    expect(tools).toContain('await activityListResponse(ctx)');
    expect(tools).toContain('await activityDetailResponse(ctx, url,');
    expect(shared).toContain('canEnterCampaignView(ctx.auth, ctx.user.id)');
    expect(read('app/api/workspace/activity-view/route.ts')).toContain('activityListResponse(ctx)');
    expect(tools + shared).not.toMatch(/activity.management.access/); // 入口不再看 management.access
  });

  it('campaign-tools：店長可寫的五項資源不再被「必須持 edit 權」前置閘門擋下；ownStaff／supportStaff 整批 PUT 改走舊版任命門市授權', () => {
    const src = read('app/api/workspace/campaign-tools/route.ts');
    expect(src).toMatch(/legacyScopedWrite=request\.method!=='PUT'&&\['headcount','completions','ownStaff','supportStaff','requests'\]/);
    expect(src).toMatch(/if\(!legacyScopedWrite&&!scopedBatch\)requireCapability/);
    // 整批 PUT（service role RPC）呼叫前必須先套用 authorizeCampaignStoreWrite，RLS 寫入碼為 support_assign.edit
    expect(src).toMatch(/scopedBatch=request\.method==='PUT'&&\['ownStaff','supportStaff'\]/);
    expect(src.indexOf('authorizeCampaignStoreWrite(ctx.auth')).toBeGreaterThan(0);
    expect(src.indexOf('authorizeCampaignStoreWrite(ctx.auth')).toBeLessThan(src.indexOf("rpc('workspace_campaign_replace'"));
    expect(src).toMatch(/ownStaff:\['activity\.support_assign\.edit','activity\.manage'\]/);
    expect(src).toMatch(/publish:\['activity\.campaign\.edit','activity\.manage'\]/);
    // 支援需求刪除交給舊 handler（authorizeCampaignStoreWrite），不再有 admin client 直接刪除的特例
    expect(src).not.toMatch(/from\('campaign_support_requests'\)\.delete\(\)/);
  });

  it('權限碼：API 閘門含 view_own，管理頁進入碼不含（避免全員預設角色看到管理頁）', () => {
    expect(CAMPAIGN_READ_CODES).toContain('activity.campaign.view_own');
    expect(CAMPAIGN_READ_CODES).toContain('activity.campaign.view_all');
    expect(CAMPAIGN_READ_CODES).toContain('activity.campaign.view');
    expect(CAMPAIGN_PAGE_CODES).not.toContain('activity.campaign.view_own');
    expect(CAMPAIGN_PAGE_CODES).toContain('activity.campaign.view_all');
  });
});

const ctxWith = (codes: string[]): Context => ({ has: (...c: string[]) => c.some((x) => codes.includes(x)), roleCodes: new Set<string>() }) as unknown as Context;
const navItems = (codes: string[], campaignView: boolean) => workspaceNavigation(ctxWith(codes), { campaignView }).flatMap((g) => g.items);

describe('CV01 導覽：活動檢視入口 = canEnterCampaignView', () => {
  it('入口只看 campaignView（canEnterCampaignView 的結果），不看 management.access', () => {
    const shown = (codes: string[], view: boolean) => navItems(codes, view).some((i) => i.href === '/activity-management');
    expect(shown([], true)).toBe(true);
    expect(shown(['activity.campaign.view_own'], false)).toBe(false);
    expect(shown(['activity.management.access'], false)).toBe(false);
  });

  it('活動管理頁入口不因 view_own 出現；view_all／編輯權仍可進入', () => {
    const manage = (codes: string[]) => navItems(codes, false).some((i) => i.href === '/admin/activity-management');
    expect(manage(['activity.campaign.view_own'])).toBe(false);
    expect(manage(['activity.campaign.view_all'])).toBe(true);
    expect(manage(['activity.campaign.edit'])).toBe(true);
  });
});

const perm = (code: string, granted = false, action?: string): ScopePermission => ({ code, granted, action: action || code.split('.').at(-1) });
const activity = (granted: string[]) =>
  ['activity.campaign.view', 'activity.campaign.view_own', 'activity.campaign.view_all', 'activity.campaign.edit'].map((c) => perm(c, granted.includes(c)));

describe('CV01 權限頁（Roles.vue 共用規則）', () => {
  it('顯示名稱：view_own 查看自己管理門市、view_all 查看全部、舊 view 標示將停用，其他功能不受影響', () => {
    expect(permissionLabel(perm('activity.campaign.view_own'))).toBe('查看自己管理門市');
    expect(permissionLabel(perm('activity.campaign.view_all'))).toBe('查看全部');
    expect(permissionLabel(perm('activity.campaign.view'))).toBe('（舊）查看，將停用');
    expect(permissionLabel(perm('monthly.status.view_own'))).toBe('查看管理門市');
    expect(permissionLabel(perm('inspection.view_own'))).not.toBe('查看自己管理門市');
  });

  it('舊 view 不計入互斥範圍，與 view_own 並存不算重複', () => {
    expect(isScopePermission(perm('activity.campaign.view'))).toBe(false);
    expect(isScopePermission(perm('activity.campaign.view_own'))).toBe(true);
    expect(isScopePermission(perm('activity.campaign.view_all'))).toBe(true);
    expect(isScopePermission(perm('employee.employee.view'))).toBe(true); // 其他功能的 view 仍是範圍
  });

  it('快速預設反映實際勾選範圍', () => {
    expect(preferredScopePermission(activity([]))?.code).toBe('activity.campaign.view_own'); // 沒勾選：預設 view_own，不選舊 view
    expect(preferredScopePermission(activity(['activity.campaign.view_all']))?.code).toBe('activity.campaign.view_all');
    expect(preferredScopePermission(activity(['activity.campaign.view']))?.code).toBe('activity.campaign.view');
    expect(preferredScopePermission(activity(['activity.campaign.view', 'activity.campaign.view_own']))?.code).toBe('activity.campaign.view_own');
  });

  it('非活動功能的快速預設維持原順序', () => {
    const f = [perm('x.y.view_all', true), perm('x.y.view_own', false)];
    expect(preferredScopePermission(f)?.code).toBe('x.y.view_own');
  });
});
