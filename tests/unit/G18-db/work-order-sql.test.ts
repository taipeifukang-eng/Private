import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXECUTION_PROGRESS_STAGES, MAINTENANCE_PROGRESS_STAGE_LABELS, MAINTENANCE_STATUS_LABELS } from '@/lib/maintenance/status';

// G18（資料庫層）靜態檢查：DEV SQL、rollback、套用腳本與正式區草稿（36 至 40）彼此一致；函式授權與命名規則；階段常數與程式常數對齊。
// 不連資料庫（行為由 tests/integration/G18-db.work-orders-rpc.spec.ts 實測）。
const root = process.cwd();
const dev = (n: string) => fs.readFileSync(path.join(root, 'supabase/workspace-dev', n), 'utf8').replace(/\r\n/g, '\n');
const draft = (n: string) => fs.readFileSync(path.join(root, 'docs/vue-workspace/parity-plan/m7m8-sql', n), 'utf8').replace(/\r\n/g, '\n');
const BASES = [
  '20261117100000_m7m8_b5_work_order_rules',
  '20261117105000_m7m8_b5_request_supplement_sync',
  '20261117110000_m7m8_b5_work_order_parts',
  '20261117120000_m7m8_b5_work_order_rls',
  '20261117130000_m7m8_b5_dev_storage_and_seed',
];
const stripHeader = (sql: string) => {
  const lines = sql.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].startsWith('--')) i += 1;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  return lines.slice(i).join('\n').replace(/\s+$/, '\n');
};
const fnsOf = (sql: string) => [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)/g)].map((m) => ({ name: m[1], args: m[2] }));
const rules = dev(`${BASES[0]}.sql`);
const parts = dev(`${BASES[2]}.sql`);
const sync = dev(`${BASES[1]}.sql`);
const backup = fs.readFileSync(path.join(root, 'supabase/workspace-dev/_backup/20261117_b4_req_functions_before_b5.sql'), 'utf8').replace(/\r\n/g, '\n');

describe('DEV 檔案與套用腳本', () => {
  it('每個 DEV SQL 都有對應的 rollback，且套用腳本依序列出（rollback 反向）', () => {
    for (const b of BASES) {
      expect(fs.existsSync(path.join(root, `supabase/workspace-dev/${b}.sql`)), b).toBe(true);
      expect(fs.existsSync(path.join(root, `supabase/workspace-dev/${b}.rollback.sql`)), `${b} rollback`).toBe(true);
    }
    const script = fs.readFileSync(path.join(root, 'scripts/apply-workspace-m7m8-b5-dev.cjs'), 'utf8');
    const idx = BASES.map((b) => script.indexOf(`"${b}"`));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(script).toContain('--rollback');
    expect(script).toContain('assertDevEnvironment');
    expect(script).toContain("startsWith(\"mjpd\")");
  });
  it('檔名時間序在第 4 批之後、依賴順序為 100000 → 105000 → 110000 → 120000 → 130000', () => {
    const sorted = [...BASES].sort();
    expect(sorted).toEqual(BASES);
    expect(BASES[0] > '20261116100000').toBe(true);
  });
});

describe('函式授權與安全規則', () => {
  const ws = [...fnsOf(rules), ...fnsOf(parts)].filter((f) => f.name.startsWith('ga_ws_wo_'));
  const internal = fnsOf(rules).filter((f) => f.name.startsWith('ga_wo_'));
  it('對外函式共 12 個（11 + 領用料件），內部輔助函式 25 個', () => {
    expect(ws.map((f) => f.name).sort()).toEqual(['ga_ws_wo_category', 'ga_ws_wo_create_legacy', 'ga_ws_wo_delete', 'ga_ws_wo_get', 'ga_ws_wo_issue_part', 'ga_ws_wo_list', 'ga_ws_wo_print',
      'ga_ws_wo_reply_supplement', 'ga_ws_wo_report_unresolved', 'ga_ws_wo_store_confirm', 'ga_ws_wo_summary', 'ga_ws_wo_transition']);
    expect(internal).toHaveLength(25);
  });
  it('全部函式都固定 search_path；對外與主要內部函式是 SECURITY DEFINER', () => {
    const all = rules + parts;
    const defs = all.split(/\n(?=CREATE OR REPLACE FUNCTION )/).filter((d) => d.startsWith('CREATE OR REPLACE FUNCTION'));
    expect(defs.length).toBe(ws.length + internal.length);
    for (const d of defs) {
      const name = /FUNCTION public\.(\w+)/.exec(d)![1];
      const head = d.slice(0, d.indexOf('AS $'));
      expect(head, name).toContain("SET search_path TO 'public', 'pg_temp'");
      if (name.startsWith('ga_ws_wo_')) expect(head, name).toContain('SECURITY DEFINER');
    }
  });
  it('對外函式：REVOKE 給 PUBLIC 與 anon、GRANT 給 authenticated；內部函式三者都撤銷', () => {
    for (const f of fnsOf(rules).filter((x) => x.name.startsWith('ga_ws_wo_'))) {
      const sig = `public.${f.name}(`;
      const grant = rules.slice(rules.indexOf('GRANT EXECUTE ON FUNCTION'));
      const revoke = rules.slice(rules.indexOf('REVOKE ALL ON FUNCTION public.ga_ws_wo_list'), rules.indexOf('GRANT EXECUTE ON FUNCTION'));
      expect(revoke, f.name).toContain(sig);
      expect(grant, f.name).toContain(sig);
      expect(revoke.split('FROM PUBLIC, anon;')[0]).not.toContain('authenticated;');
    }
    expect(parts).toContain('REVOKE ALL ON FUNCTION public.ga_ws_wo_issue_part(uuid, uuid, uuid, numeric, text, text, text, text, timestamptz) FROM PUBLIC, anon;');
    expect(parts).toContain('GRANT EXECUTE ON FUNCTION public.ga_ws_wo_issue_part(uuid, uuid, uuid, numeric, text, text, text, text, timestamptz) TO authenticated;');
    const internalRevoke = rules.slice(rules.indexOf('REVOKE ALL ON FUNCTION public.ga_wo_no'), rules.indexOf('REVOKE ALL ON FUNCTION public.ga_ws_wo_list'));
    for (const f of internal) expect(internalRevoke, f.name).toContain(`public.${f.name}(`);
    expect(internalRevoke).toContain('FROM PUBLIC, anon, authenticated;');
  });
  it('每個寫入函式都從 auth.uid() 取身分、先擋未登入（401）', () => {
    const defs = (rules + parts).split(/\n(?=CREATE OR REPLACE FUNCTION public\.ga_ws_wo_)/).filter((d) => d.startsWith('CREATE OR REPLACE FUNCTION public.ga_ws_wo_'));
    expect(defs).toHaveLength(12);
    for (const d of defs) {
      const name = /FUNCTION public\.(\w+)/.exec(d)![1];
      expect(d, name).toContain('auth.uid()');
      expect(d, name).toContain("'AUTH_REQUIRED'");
    }
  });
  it('寫入函式都要求 expected_updated_at（領用料件重送同識別除外）並回 409 STALE', () => {
    for (const n of ['ga_ws_wo_transition', 'ga_ws_wo_store_confirm', 'ga_ws_wo_report_unresolved', 'ga_ws_wo_reply_supplement', 'ga_ws_wo_delete', 'ga_ws_wo_category']) {
      const d = rules.slice(rules.indexOf(`FUNCTION public.${n}(`));
      const body = d.slice(0, d.indexOf('\n$$;'));
      expect(body, n).toContain("'EXPECTED_REQUIRED'");
      expect(body, n).toContain("'STALE'");
    }
    expect(parts).toContain("'EXPECTED_REQUIRED'");
    expect(parts).toContain("'STALE'");
  });
  it('管理員不是後備：profiles.role 只用在「沒有角色」的白話說明，不用在權限判斷', () => {
    const lines = rules.split('\n').filter((l) => !l.trim().startsWith('--') && /role\s*=\s*'admin'/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l, l).toMatch(/ADMIN_WITHOUT_ROLE|帳號沒有可修改工單的角色|FROM public\.profiles/);
    const can = rules.slice(rules.indexOf('FUNCTION public.ga_wo_can_update'), rules.indexOf('FUNCTION public.ga_wo_has_own_perm'));
    expect(can).not.toMatch(/profiles|admin/);
  });
  it('錯誤訊息一律白話中文（ga_rq_err 的第三個參數含中文）', () => {
    const msgs = [...(rules + parts + sync).matchAll(/ga_rq_err\(\s*\d+\s*,\s*'([A-Z_]+)'\s*,\s*'([^']*)'/g)];
    expect(msgs.length).toBeGreaterThan(80);
    for (const m of msgs) expect(m[2], m[1]).toMatch(/[一-鿿]/);
  });
});

describe('階段、狀態與焦點常數與程式常數對齊', () => {
  const labelSql = [...rules.slice(rules.indexOf('FUNCTION public.ga_wo_stage_label'), rules.indexOf('FUNCTION public.ga_wo_status_label')).matchAll(/WHEN '([A-Z_]+)' THEN '([^']+)'/g)].map((m) => [m[1], m[2]]);
  it('16 個階段碼與標籤和 lib/maintenance/status.ts 完全相同（含順序）', () => {
    expect(Object.fromEntries(labelSql)).toEqual(MAINTENANCE_PROGRESS_STAGE_LABELS);
    const codes = /ga_wo_stage_codes\(\) RETURNS text\[\][^$]*\$\$ SELECT ARRAY\[([^\]]+)\]/.exec(rules)![1].match(/'([A-Z_]+)'/g)!.map((x) => x.replace(/'/g, ''));
    expect(codes).toEqual(Object.keys(MAINTENANCE_PROGRESS_STAGE_LABELS));
    expect(codes).toHaveLength(16);
  });
  it('四個主狀態標籤相同', () => {
    const sql = rules.slice(rules.indexOf('FUNCTION public.ga_wo_status_label'));
    for (const [k, v] of Object.entries(MAINTENANCE_STATUS_LABELS)) expect(sql).toContain(`WHEN '${k}' THEN '${v}'`);
  });
  it('執行類階段（存進度推成處理中）與舊版 EXECUTION_PROGRESS_STAGES 相同', () => {
    const seg = rules.slice(rules.indexOf('FUNCTION public.ga_wo_is_exec_stage'), rules.indexOf('-- 焦點卡分類'));
    const codes = (/ARRAY\[([^\]]+)\]/.exec(seg)![1].match(/'([A-Z_]+)'/g) || []).map((x) => x.replace(/'/g, ''));
    expect(new Set(codes)).toEqual(new Set(EXECUTION_PROGRESS_STAGES));
  });
  it('焦點分類規則（已完成 → 門市退回 → 待門市確認 → 料件 → 廠商 → 待安排）與舊版相同', () => {
    const seg = rules.slice(rules.indexOf('FUNCTION public.ga_wo_focus'), rules.indexOf('FUNCTION public.ga_wo_try_uuid'));
    const order = [...seg.matchAll(/THEN '(\w+)'/g)].map((m) => m[1]);
    expect(order).toEqual(['completed', 'store_rejected', 'store_confirmation', 'parts', 'vendor']);
    expect(seg).toContain("ELSE 'arrange'");
    expect(seg).toContain("p_stage IN ('WAITING_PARTS', 'PARTS_IN_TRANSIT')");
    expect(seg).toContain("'SEARCHING_VENDOR', 'WAITING_VENDOR_REPLY', 'WAITING_VENDOR_QUOTE', 'QUOTE_REVIEW', 'VENDOR_ASSIGNED', 'WAITING_VENDOR_VISIT', 'VENDOR_WORKING'");
  });
  it('工單編號 = WO- 加 id 前 8 碼大寫', () => {
    expect(rules).toContain("'WO-' || upper(left(p_id::text, 8))");
  });
});

describe('105000：只多三處呼叫、其餘與第 4 批備份逐行相同；rollback 就是備份', () => {
  const norm = (s: string) => s.split('\n').map((l) => l.trimEnd());
  const defOf = (text: string, name: string) => {
    const i = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    const j = text.indexOf('\n$function$', text.indexOf('$function$', i) + 10);
    return norm(text.slice(i, j + 12).replace(/\n\n+/g, '\n'));
  };
  const headless = (lines: string[]) => lines.filter((l) => l.trim() !== '');
  it('覆蓋後的兩個函式：新增行只有 3 個內部函式呼叫與其註解與換行；被取代的只有原本內嵌的工單更新', () => {
    for (const name of ['ga_ws_req_transition', 'ga_ws_req_store_action']) {
      const before = headless(defOf(backup, name));
      const after = headless(defOf(sync, name));
      const added = after.filter((l) => !before.includes(l));
      const removed = before.filter((l) => !after.includes(l));
      expect(added.length, `${name} 新增行 ${JSON.stringify(added)}`).toBeLessThanOrEqual(9);
      expect(removed.length, `${name} 移除行 ${JSON.stringify(removed)}`).toBeLessThanOrEqual(9);
      for (const l of added) expect(l, l).toMatch(/ga_wo_apply_|IF v_|END IF;|第 5 批|PERFORM|^--/);
    }
    expect(sync).toContain("ga_wo_apply_supplement_request(v_req.maintenance_request_id, v_uid, v_why, v_rlabel, v_note, 'ga_service_request_workspace')");
    expect(sync).toContain("ga_wo_apply_completion_request(v_req.maintenance_request_id, v_uid, v_progress, 'ga_service_request_workspace')");
    expect(sync).toContain("ga_wo_apply_supplement_reply(v_req.maintenance_request_id, v_uid, v_note, v_proxy, 'ga_service_request_store_action')");
    // 取代掉的內嵌工單更新（送確認）已不在覆蓋後的 transition 內
    const tr = defOf(sync, 'ga_ws_req_transition').join('\n');
    expect(tr).not.toContain("UPDATE public.maintenance_requests SET status = 'PROCESSING', progress_stage = 'WAITING_STORE_CONFIRMATION'");
  });
  it('rollback 內容是備份的兩個函式（還原第 4 批原定義）', () => {
    const rb = dev(`${BASES[1]}.rollback.sql`);
    for (const name of ['ga_ws_req_transition', 'ga_ws_req_store_action']) expect(defOf(rb, name)).toEqual(defOf(backup, name));
    expect(rb).not.toContain('ga_wo_apply_');
  });
  it('備份檔頭記錄原 md5', () => {
    expect(backup).toContain('ga_ws_req_store_action=20a40759bb4488685c08cd885f785158');
    expect(backup).toContain('ga_ws_req_transition=a962e584ccd1679a2c246fddde688d3c');
  });
});

describe('rollback 完整性', () => {
  it('100000 的 rollback 移除全部新增函式（依簽章）', () => {
    const rb = dev(`${BASES[0]}.rollback.sql`);
    for (const f of fnsOf(rules)) {
      const argTypes = f.args.split(',').map((a) => a.trim().replace(/ DEFAULT .*$/, '').split(/\s+/).slice(1).join(' ')).filter(Boolean);
      expect(rb, f.name).toContain(`DROP FUNCTION IF EXISTS public.${f.name}(`);
      const line = rb.split('\n').find((l) => l.includes(`public.${f.name}(`))!;
      expect(line.split(',').length, `${f.name} 簽章欄位數`).toBe(Math.max(argTypes.length, 1));
    }
    expect(rb.split('\n').filter((l) => l.startsWith('DROP FUNCTION')).length).toBe(fnsOf(rules).length);
  });
  it('110000 的 rollback 移除領用料件函式；120000 的 rollback 還原三條原政策（含 view_all）', () => {
    expect(dev(`${BASES[2]}.rollback.sql`)).toContain('DROP FUNCTION IF EXISTS public.ga_ws_wo_issue_part(');
    const rb = dev(`${BASES[3]}.rollback.sql`);
    for (const p of ['p1e_maintenance_requests_update', 'p1e_maintenance_requests_delete', 'p1e_maintenance_updates_write']) expect(rb).toContain(`CREATE POLICY ${p}`);
    expect((rb.match(/view_all/g) || []).length).toBeGreaterThanOrEqual(12);
    expect(rb).toContain('OR reported_by = auth.uid()');
  });
  it('120000 收緊：三條政策都不含 view_all，刪除限未受理且未連需求單', () => {
    const sql = dev(`${BASES[3]}.sql`).split('\n').filter((l) => !l.startsWith('--')).join('\n');
    expect(sql).not.toContain('view_all');
    expect(sql).toContain("status = 'UNACCEPTED'");
    expect(sql).toContain('ga_service_request_id IS NULL');
    expect(sql).toContain('reported_by = auth.uid()');
  });
});

describe('正式區草稿 36 至 40', () => {
  const pairs: [string, string][] = [['37-b5-work-order-rules', BASES[0]], ['38-b5-request-supplement-sync', BASES[1]], ['39-b5-work-order-parts', BASES[2]], ['40-b5-work-order-rls', BASES[3]]];
  it('37 至 40 與其 rollback 都存在，包 BEGIN … COMMIT，本體與 DEV 檔相同', () => {
    for (const [no, b] of pairs) {
      const d = draft(`${no}.sql`);
      const r = draft(`${no}-rollback.sql`);
      expect(d, no).toContain('\nBEGIN;\n');
      expect(d.trimEnd().split('\n').includes('COMMIT;'), no).toBe(true);
      expect(r, `${no} rollback`).toContain('\nBEGIN;\n');
      expect(r.includes('\nCOMMIT;\n'), `${no} rollback`).toBe(true);
      const body = stripHeader(dev(`${b}.sql`)).trimEnd();
      expect(d, `${no} 本體`).toContain(body);
      const rbBody = stripHeader(dev(`${b}.rollback.sql`)).trimEnd().replace(/\n*NOTIFY pgrst, 'reload schema';$/, '');
      expect(r, `${no} rollback 本體`).toContain(rbBody);
    }
  });
  it('130000（DEV 專用）不進正式區草稿；草稿沒有 maintenance-photos bucket 與測試角色', () => {
    for (const f of fs.readdirSync(path.join(root, 'docs/vue-workspace/parity-plan/m7m8-sql'))) {
      if (!/^(3[6-9]|40)-b5/.test(f)) continue;
      const t = draft(f);
      expect(t, f).not.toContain('INSERT INTO storage.buckets');
      expect(t, f).not.toContain('vue_workspace_ga_works');
    }
    expect(fs.existsSync(path.join(root, 'docs/vue-workspace/parity-plan/m7m8-sql/41-b5-dev-storage-and-seed.sql'))).toBe(false);
  });
  it('36 預覽是唯讀（沒有寫入或結構變更語句），並列出 Q20 名單與 W9 管理員名單', () => {
    const t = draft('36-b5-preview-before-apply.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(t).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|CREATE\s+(OR\s+REPLACE\s+)?(TABLE|FUNCTION|POLICY|INDEX)|DROP\s|ALTER\s|TRUNCATE|GRANT\s|REVOKE\s)/i);
    expect(t).toContain('Q20 只能查看全部的人');
    expect(t).toContain('W9 管理員沒有更新角色');
    expect(t).toContain('maintenance-photos');
    expect(t).toContain('20a40759bb4488685c08cd885f785158');
    expect(t).toContain('a962e584ccd1679a2c246fddde688d3c');
  });
  it('README 有第 5 批章節與套用順序 36 → 37 → 38 → 39 → 40，並註明 40 要等名單確認', () => {
    const r = draft('README.md');
    expect(r).toContain('## 第 5 批');
    expect(r).toContain('`36`（唯讀）→ 沒有 MISSING → `37` → `38` → `39`');
    expect(r).toContain('→ `40`');
    expect(r).toMatch(/40[^\n]*不得套用|不得套用/);
    for (const n of ['36-b5-preview-before-apply.sql', '37-b5-work-order-rules.sql', '38-b5-request-supplement-sync.sql', '39-b5-work-order-parts.sql', '40-b5-work-order-rls.sql']) expect(r).toContain(n);
  });
});
