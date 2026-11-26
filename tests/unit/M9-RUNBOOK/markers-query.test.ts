import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// 00d 舊版 migration 內容標記檢查：只讀檔、不連資料庫。
// 測 (1) 產出的 SQL 是純查詢 (2) 32 支 00c 查不出的 migration 都有標記或「無法判斷」說明 (3) 標記和 migration 原文一致 (4) 產生器的防呆。
const nodeRequire = createRequire(import.meta.url);
const root = path.resolve(__dirname, '..', '..', '..');
type Marker = Record<string, any>;
type Row = { migration: string; label: string; meaning: string; sup: string | null; expr: string; kind: string };
const gen = nodeRequire(path.join(root, 'scripts', 'm9-coverage', 'markers.cjs')) as {
  build: (o?: Record<string, unknown>) => { sql: string; rows: Row[]; undeterminable: { migration: string; reason: string }[]; observations: { migration: string; label: string; sql: string; requires: string[] }[] };
  compile: (m: Marker) => { label: string; expr: string };
  readmeSteps: () => Map<string, number>;
  OUT_FILE: string;
};
const data = nodeRequire(path.join(root, 'scripts', 'm9-coverage', 'markers.data.cjs')) as {
  migrations: { migration: string; markers: Marker[] }[];
  undeterminable: { migration: string; reason: string }[];
  observations: { migration: string; label: string; sql: string; requires: string[] }[];
};
const coverage = nodeRequire(path.join(root, 'scripts', 'm9-coverage', 'build.cjs')) as { build: () => { unchecked: string[] } };

const sql = fs.readFileSync(gen.OUT_FILE, 'utf8').replace(/\r\n/g, '\n');
const built = gen.build();
const unchecked = coverage.build().unchecked;
const migDir = path.join(root, 'supabase', 'migrations');
const migFiles = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
const migText = new Map(migFiles.map((f) => [f.replace(/\.sql$/, ''), fs.readFileSync(path.join(migDir, f), 'utf8').replace(/\r\n/g, '\n')]));

/** 去掉 -- 註解與單引號字串內容（保留引號），只留語句骨架。 */
function skeleton(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === "'") {
      out += "''";
      i++;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") i += 2;
        else if (text[i] === "'") { i++; break; }
        else i++;
      }
    } else { out += c; i++; }
  }
  return out;
}
const body = skeleton(sql);
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|COPY|DO|EXECUTE|CALL|BEGIN|COMMIT|ROLLBACK|SET|RESET|NOTIFY|LISTEN|VACUUM|ANALYZE|REFRESH|COMMENT)\b/i;

/** 攤平 all 標記。 */
function flat(m: Marker): Marker[] { return m.kind === 'all' ? m.parts.flatMap(flat) : [m]; }
const allLeaves: { migration: string; m: Marker }[] = data.migrations.flatMap((g) => g.markers.flatMap((m) => flat(m).map((x) => ({ migration: g.migration, m: x }))));

/** 某函式在所有 migration 的定義文字（依檔名順序）。 */
function fnDefs(fn: string): { file: string; text: string }[] {
  const name = fn.replace(/^public\./, '').split('(')[0];
  const re = new RegExp('CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.)?' + name + '\\s*\\(', 'gi');
  const out: { file: string; text: string }[] = [];
  for (const [file, text] of migText) {
    const hits = [...text.matchAll(re)];
    for (const h of hits) {
      const start = h.index!;
      const next = text.slice(start + 10).search(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
      out.push({ file, text: next < 0 ? text.slice(start) : text.slice(start, start + 10 + next) });
    }
  }
  return out;
}
/** 最後一支提到某物件名稱的 migration。 */
function lastMention(name: string): { file: string; text: string } | null {
  const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  let hit: { file: string; text: string } | null = null;
  for (const [file, text] of migText) if (re.test(text)) hit = { file, text };
  return hit;
}

describe('00d_prod_legacy_content_markers.readonly.sql（產出的 SQL）', () => {
  it('只有一個語句，且以 WITH 開頭', () => {
    const stmts = body.split(';').map((s) => s.trim()).filter(Boolean);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^WITH\b/i);
    expect(stmts[0]).toMatch(/\bSELECT\b/i);
  });

  it('沒有任何會寫入或建立東西的關鍵字，也沒有 DO 區塊或 $$', () => {
    expect(body).not.toMatch(FORBIDDEN);
    expect(body).not.toMatch(/\$\$/);
    expect(body).not.toMatch(/\b(pg_advisory|set_config|nextval|setval|dblink|pg_terminate|pg_cancel|lo_)\w*\s*\(/i);
  });

  it('只讀允許的目錄與資料表', () => {
    const allowed = ['pg_attribute', 'pg_attrdef', 'pg_constraint', 'pg_indexes', 'pg_policies', 'pg_trigger', 'public.permissions', 'public.roles', 'public.role_permissions', 'items'];
    const froms = [...body.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.0-9]+)/gi)].map((m) => m[1].toLowerCase());
    expect(froms.length).toBeGreaterThan(30);
    for (const f of froms) expect(allowed, f).toContain(f);
  });

  it('query_to_xml 只執行寫死的 SELECT／WITH 字串，且都有表或欄位存在的守衛', () => {
    const calls = [...sql.matchAll(/query_to_xml\(('(?:[^']|'')*')/g)].map((m) => m[1].slice(1, -1).replace(/''/g, "'"));
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) {
      expect(c.trim()).toMatch(/^(SELECT|WITH)\b/i);
      expect(skeleton(c)).not.toMatch(FORBIDDEN);
    }
    // 每個 query_to_xml 前面都在 CASE WHEN 條件裡，條件不成立時不會執行
    const n = (sql.match(/query_to_xml\(/g) || []).length;
    const guarded = (sql.match(/CASE WHEN [^\n]*?THEN \(\(xpath\('\/row\/c\/text\(\)', query_to_xml\(/g) || []).length;
    expect(guarded).toBe(n);
  });

  it('輸出 JSON 欄位齊全', () => {
    for (const k of ['generated_at', 'total_checked', 'present_count', 'missing', 'undeterminable', 'observations']) expect(sql).toContain(`'${k}'`);
    for (const k of ['migration', 'marker', 'meaning', 'superseded_by']) expect(sql).toContain(`'${k}'`);
    expect(sql).toContain("'pending_rows'");
  });

  it('與目前的 README、標記資料、supabase/migrations 同步（產生器重跑結果一致）', () => {
    expect(built.sql).toBe(sql);
  });

  it('檔頭宣告的標記數與實際列數一致，且有繁體中文白話用法說明', () => {
    const rows = [...sql.matchAll(/^  \('(\d{14}_[a-z0-9_]+)', '/gm)];
    expect(rows.length).toBe(built.rows.length);
    expect(sql).toContain(`共 ${rows.length} 個標記`);
    const head = sql.split('\n').slice(0, 14).join('\n');
    expect(head).toMatch(/SQL Editor/);
    expect(head).toMatch(/貼回/);
    expect(head).toMatch(/怎麼看結果/);
  });

  it('不存在的物件一律當作不成立，不會讓整份報錯：每個標記運算式都被 COALESCE、EXISTS、IS NULL 或 CASE 保護', () => {
    for (const r of built.rows) {
      expect(r.expr, r.label).toMatch(/COALESCE\(|EXISTS \(|IS NULL|IS NOT NULL|\) = \d+/);
    }
    // 不直接引用可能不存在的業務表（只讀 permissions、roles、role_permissions 與系統目錄）
    expect(body).not.toMatch(/FROM\s+public\.(ga_|store_|employee_|monthly_|maintenance_)/i);
  });
});

describe('覆蓋範圍：00c 查不出的 32 支 migration 逐支處理', () => {
  it('00c 的 unchecked_migrations 剛好 32 支，每支都有標記或「無法判斷」說明，沒有多也沒有少', () => {
    expect(unchecked.length).toBe(32);
    const covered = [...data.migrations.map((m) => m.migration), ...data.undeterminable.map((u) => u.migration)];
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual([...unchecked].sort());
  });

  it('每支 migration 有 1～3 個標記（all 組合算 1 個）、每個標記都有白話 meaning', () => {
    for (const g of data.migrations) {
      expect(g.markers.length, g.migration).toBeGreaterThanOrEqual(1);
      expect(g.markers.length, g.migration).toBeLessThanOrEqual(3);
      for (const m of g.markers) {
        expect(typeof m.meaning, g.migration).toBe('string');
        expect(m.meaning.length, g.migration).toBeGreaterThan(8);
      }
    }
  });

  it('產出的每一列對應一個標記，migration 名稱都真的存在於 supabase/migrations', () => {
    expect(built.rows.length).toBe(data.migrations.reduce((a, g) => a + g.markers.length, 0));
    for (const r of built.rows) expect(migText.has(r.migration), r.migration).toBe(true);
    // 標記說明不重複，才看得出是哪一項缺
    const labels = built.rows.map((r) => r.migration + '|' + r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('無法判斷的資料修補：寫明風險、後續是否被 m9 步驟取代，並提供還會改幾筆的輔助數字', () => {
    expect(data.undeterminable.map((u) => u.migration)).toEqual(['20261005120000_repair_newbie_promotion_timeline']);
    const u = built.undeterminable[0];
    expect(u.reason).toMatch(/無法用唯讀查詢判斷/);
    expect(u.reason).toMatch(/風險/);
    expect(u.reason).toMatch(/取代/);
    expect(u.reason).toMatch(/步驟 \d+/);
    expect(u.reason).not.toMatch(/\{\{/);
    expect(built.observations.length).toBe(2);
    for (const o of built.observations) {
      expect(o.migration).toBe(u.migration);
      expect(o.sql.trim()).toMatch(/^(SELECT|WITH)\b/i);
      expect(skeleton(o.sql)).not.toMatch(FORBIDDEN);
      expect(o.sql).toMatch(/count\(\*\) AS c/);
    }
  });
});

describe('標記和 migration 原文一致（以舊版全部套用後的最終狀態為準）', () => {
  it('函式內容標記：needle 在「最後一支定義該函式」的 migration 裡成立（含／不含），而且標記能分辨新舊版', () => {
    const leaves = allLeaves.filter((x) => x.m.kind === 'fn_has' || x.m.kind === 'fn_lacks');
    expect(leaves.length).toBeGreaterThanOrEqual(10);
    for (const { m } of leaves) {
      const defs = fnDefs(m.fn);
      expect(defs.length, m.fn).toBeGreaterThan(0);
      const last = defs[defs.length - 1];
      // 用 DO 區塊讀出現行函式定義再字串替換的補丁（例如 20260722094917）：最後一版是補丁替換後的結果
      const name = m.fn.replace(/^public\./, '').split('(')[0];
      const patch = [...migText.entries()].find(([f, t]) => f > last.file && t.includes('pg_get_functiondef') && t.includes(name));
      if (patch) {
        if (m.kind === 'fn_has') expect(patch[1].includes(m.needle), `${m.fn} 補丁 ${patch[0]} 要含：${m.needle}`).toBe(true);
        else {
          expect(defs.some((d) => d.text.includes(m.needle)), `${m.fn} 原版要含 ${m.needle}`).toBe(true);
          expect(patch[1]).toMatch(/replace\(/i);
          // 補丁用字串拼接寫被替換的片段（避免自己被替換），確認片段都在
          expect(patch[1]).toContain("'ON CONFLICT (' || 'location_id, part_id' || ') DO NOTHING;'");
        }
        continue;
      }
      if (m.kind === 'fn_has') {
        expect(last.text.includes(m.needle), `${m.fn} 最後一版（${last.file}）要含：${m.needle}`).toBe(true);
        // 有更早的版本時，至少有一版不含（否則標記分不出有沒有套用）
        if (defs.length > 1) expect(defs.slice(0, -1).some((d) => !d.text.includes(m.needle)), `${m.fn} 舊版也含 ${m.needle}，標記無法分辨新舊`).toBe(true);
      } else {
        expect(last.text.includes(m.needle), `${m.fn} 最後一版（${last.file}）不可含：${m.needle}`).toBe(false);
        expect(defs.slice(0, -1).some((d) => d.text.includes(m.needle)), `${m.fn} 舊版沒有 ${m.needle}，標記無法分辨新舊`).toBe(true);
      }
    }
  });

  it('函式簽章：fn_exec／fn_exists／fn_absent 的函式名稱都能在 migration 找到，且參數個數與最後一版定義相符', () => {
    const leaves = allLeaves.filter((x) => ['fn_exec', 'fn_exists', 'fn_absent'].includes(x.m.kind));
    for (const { m } of leaves) {
      const name = m.fn.replace(/^public\./, '').split('(')[0];
      const defs = fnDefs(m.fn);
      const mentioned = [...migText.values()].some((t) => t.includes(name));
      expect(mentioned, m.fn).toBe(true);
      if (m.kind === 'fn_exec' || m.kind === 'fn_exists') {
        // 有 CREATE 定義的函式：簽章逗號數要和最後一版一致（員工購買彙總等少數函式沒有可比對的 CREATE 就略過）
        if (defs.length) {
          const last = defs[defs.length - 1].text;
          const argText = last.slice(last.indexOf('(') + 1, last.search(/\)\s*(RETURNS|LANGUAGE|\n)/i));
          const n = argText.trim() ? argText.split(',').length : 0;
          const want = m.fn.slice(m.fn.indexOf('(') + 1, -1);
          expect(want ? want.split(',').length : 0, `${m.fn} vs ${defs[defs.length - 1].file}`).toBe(n);
        }
      }
    }
  });

  it('約束、索引、政策標記：needle 在最後一支提到該物件的 migration 裡成立', () => {
    const leaves = allLeaves.filter((x) => ['constraint_has', 'constraint_comment_has', 'index_has', 'policy_has', 'policy_lacks'].includes(x.m.kind));
    expect(leaves.length).toBeGreaterThanOrEqual(10);
    for (const { m } of leaves) {
      const name = m.name || m.index;
      const last = lastMention(name);
      expect(last, name).not.toBeNull();
      const has = last!.text.includes(m.needle);
      if (m.kind === 'policy_lacks') expect(has, `${name} 最後一版（${last!.file}）不可含 ${m.needle}`).toBe(false);
      else expect(has, `${name} 最後一版（${last!.file}）要含 ${m.needle}`).toBe(true);
    }
    // 政策收窄：更早的版本含 request.manage，這支才分得出新舊
    const early = migText.get('20260918143000_general_affairs_part_fulfillments')!;
    expect(early).toContain('general_affairs.request.manage');
    expect(migText.get('20260918153000_restrict_part_fulfillment_permissions')).not.toContain('general_affairs.request.manage');
  });

  it('欄位標記：型別、預設值、註解的字串都在某支 migration 出現；型別對得上 ALTER COLUMN', () => {
    const all = [...migText.values()].join('\n');
    for (const { m } of allLeaves.filter((x) => ['col_default_has', 'col_comment_has'].includes(x.m.kind))) {
      expect(all.includes(m.needle), m.needle).toBe(true);
    }
    for (const { m } of allLeaves.filter((x) => x.m.kind === 'col_type')) {
      const re = new RegExp('ALTER\\s+COLUMN\\s+' + m.column + '\\s+TYPE\\s+' + m.type.replace('(', '\\s*\\(\\s*').replace(',', '\\s*,\\s*').replace(')', '\\s*\\)'), 'i');
      const ok = [...migText.values()].some((t) => re.test(t)) || [...migText.values()].some((t) => new RegExp(m.column + '\\s+' + m.type.replace('(', '\\s*\\(\\s*').replace(',', '\\s*,\\s*').replace(')', '\\s*\\)'), 'i').test(t));
      expect(ok, `${m.table}.${m.column} ${m.type}`).toBe(true);
    }
  });

  it('權限碼與種子資料標記：每個 code 都出現在對應的 migration 裡', () => {
    for (const g of data.migrations) {
      for (const m of g.markers.flatMap(flat)) {
        if (!['perm_active', 'role_perms_all', 'seed_codes'].includes(m.kind)) continue;
        const text = migText.get(g.migration)!;
        for (const c of m.codes) expect(text.includes(`'${c}'`), `${g.migration} ${c}`).toBe(true);
      }
    }
  });

  it('授權標記：fn_exec 的授權方向和 migration 的 GRANT／REVOKE 一致', () => {
    const t = (n: string) => migText.get(n)!;
    // 序號與取號函式：收回
    expect(t('20260722091526_revoke_inventory_transaction_sequence_grants')).toMatch(/REVOKE ALL ON SEQUENCE public\.ga_inventory_transaction_no_seq FROM authenticated/);
    expect(t('20260722092849_restrict_inventory_transaction_function_execute_grants')).toMatch(/REVOKE ALL ON FUNCTION public\.ga_next_inventory_transaction_no\(\) FROM authenticated/);
    expect(t('20260722092849_restrict_inventory_transaction_function_execute_grants')).toMatch(/GRANT EXECUTE ON FUNCTION public\.ga_post_inventory_transaction\([^)]*\) TO authenticated/);
    // 4 參數版只給 service_role
    expect(t('20260926163000_role_permission_optimistic_lock')).toMatch(/GRANT EXECUTE ON FUNCTION public\.replace_role_permissions\(uuid, uuid\[\], uuid\[\], uuid\) TO service_role/);
    expect(t('20260926163000_role_permission_optimistic_lock')).toMatch(/DROP FUNCTION IF EXISTS public\.replace_role_permissions\(uuid, uuid\[\], uuid\)/);
    for (const { m } of allLeaves.filter((x) => x.m.kind === 'fn_exec')) {
      for (const [role, allowed] of Object.entries(m.grants as Record<string, boolean>)) expect(typeof allowed, `${m.fn} ${role}`).toBe('boolean');
    }
  });
});

describe('README 總表與 superseded_by', () => {
  const steps = gen.readmeSteps();

  it('00d 在 README 總表步驟 17、緊接 00c（步驟 16）之後，性質是唯讀', () => {
    expect(steps.get('m9-sql/00c_prod_legacy_migration_coverage.readonly.sql')).toBe(16);
    expect(steps.get('m9-sql/00d_prod_legacy_content_markers.readonly.sql')).toBe(17);
    expect(steps.get('m9-sql/06_missing_permission_codes.sql')).toBe(18);
    const readme = fs.readFileSync(gen.OUT_FILE.replace(/00d_.*$/, 'README.md'), 'utf8');
    expect(readme).toMatch(/^\| 17 \| `m9-sql\/00d_prod_legacy_content_markers\.readonly\.sql` \|.*\| 唯讀 \| 否 \|/m);
    expect(readme).toContain('| `00d_prod_legacy_content_markers.readonly.sql` |');
    expect(readme).toContain(`（${built.rows.length} 個標記，標記清單`);
  });

  it('superseded_by 的檔案都在總表裡，輸出的步驟號和總表一致，且沒有留未解析的 {{}}', () => {
    const withSup = built.rows.filter((r) => r.sup);
    expect(withSup.length).toBeGreaterThanOrEqual(10);
    for (const r of withSup) {
      expect(r.sup, r.label).not.toMatch(/\{\{/);
      const m = /^步驟 (\d+)（([^）]+)）：/.exec(r.sup!);
      if (m) expect(steps.get(m[2]), r.sup!).toBe(Number(m[1]));
    }
    // 督導日誌 3＋3 個標記由 07 蓋掉；異動類型約束由 80 蓋掉；料件處理單政策沒有任何後續步驟改寫（所以不標 superseded_by）
    const fileOf = (mig: string) => built.rows.filter((r) => r.migration.startsWith(mig) && r.sup).map((r) => /（([^）]+)）/.exec(r.sup!)?.[1]);
    expect(fileOf('20260812153524')).toEqual(Array(3).fill('m9-sql/07_legacy_supervisor_management.sql'));
    expect(fileOf('20260812155612')).toEqual(Array(3).fill('m9-sql/07_legacy_supervisor_management.sql'));
    expect(fileOf('20261007120000')).toEqual(['m9-sql/80_movement_batch_monthly_roster.sql']);
    expect(fileOf('20260918153000')).toEqual([]);
  });

  it('被後續步驟蓋掉的說法屬實：07 含相同的授權與驗證函式、80 含 acting_manager 約束；沒有後續草稿改寫料件處理單政策', () => {
    const plan = path.join(root, 'docs', 'vue-workspace', 'parity-plan');
    const f07 = fs.readFileSync(path.join(plan, 'm9-sql', '07_legacy_supervisor_management.sql'), 'utf8');
    expect(f07).toMatch(/GRANT EXECUTE ON FUNCTION public\.supervisor_management_case_is_visible\(uuid\) TO authenticated/);
    expect(f07).toMatch(/GRANT EXECUTE ON FUNCTION public\.supervisor_management_case_is_manageable\(uuid\) TO authenticated/);
    expect(f07).toMatch(/GRANT EXECUTE ON FUNCTION public\.supervisor_management_current_user_manages_store\(uuid\) TO authenticated/);
    expect(f07).toContain('SUPERVISOR_CASE_OWNER_MISMATCH');
    expect(f07).toContain('owner_user_id = auth.uid()');
    const f80 = fs.readFileSync(path.join(plan, 'm9-sql', '80_movement_batch_monthly_roster.sql'), 'utf8');
    expect(f80).toMatch(/ADD CONSTRAINT valid_movement_type CHECK\(movement_type IN\([^)]*'acting_manager'/);
    // 沒有任何 m7m8／m9 草稿重建這三張表的 RLS 政策（有的話 0918153000 的收窄就會被蓋掉，要補 superseded_by）
    const drafts = ['m6-sql', 'm7m8-sql', 'm9-sql', 'w03-rx-sql'].flatMap((d) => fs.readdirSync(path.join(plan, d)).filter((f) => f.endsWith('.sql') && !/rollback|check|preview|verify|backup/.test(f)).map((f) => fs.readFileSync(path.join(plan, d, f), 'utf8')));
    for (const t of drafts) expect(t).not.toMatch(/CREATE POLICY ga_part_fulfillment(s|_documents|_events)_(read|manage)/);
  });
});

describe('產生器防呆', () => {
  const good = { kind: 'fn_has', fn: 'public.f(uuid)', needle: 'x' };

  it('各種標記都能編譯成唯讀的布林運算式', () => {
    const samples: Marker[] = [
      good, { ...good, kind: 'fn_lacks' }, { kind: 'fn_exists', fn: 'public.f()' }, { kind: 'fn_absent', fn: 'public.f(uuid,text)' },
      { kind: 'fn_exec', fn: 'public.f(uuid)', grants: { anon: false, authenticated: true } },
      { kind: 'seq_priv', seq: 'public.s_seq', grants: { anon: false } },
      { kind: 'col_exists', table: 'public.t', column: 'c' }, { kind: 'col_type', table: 't', column: 'c', type: 'numeric(4,1)' },
      { kind: 'col_default_has', table: 't', column: 'c', needle: 'x' }, { kind: 'col_comment_has', table: 't', column: 'c', needle: 'x' },
      { kind: 'constraint_has', table: 't', name: 'ck', needle: 'x' }, { kind: 'constraint_exists', table: 't', name: 'ck' },
      { kind: 'constraint_absent', table: 't', name: 'ck' }, { kind: 'constraint_comment_has', table: 't', name: 'ck', needle: 'x' },
      { kind: 'index_has', index: 'ix', needle: 'x' }, { kind: 'index_exists', index: 'ix' },
      { kind: 'policy_has', table: 't', name: 'p', needle: 'x', part: 'qual' }, { kind: 'policy_lacks', table: 't', name: 'p', needle: 'x', part: 'any' },
      { kind: 'trigger_exists', table: 't', name: 'g' }, { kind: 'trigger_absent', table: 't', name: 'g' },
      { kind: 'perm_active', codes: ['a.b.c'] }, { kind: 'role_perms_all', role: 'admin', codes: ['a.b.c', 'a.b.d'] },
      { kind: 'seed_codes', table: 'stages', codes: ['A', 'B'] }, { kind: 'no_null', table: 'ga_equipment', column: 'qr_token' },
      { kind: 'all', parts: [{ kind: 'col_exists', table: 't', column: 'a' }, { kind: 'col_exists', table: 't', column: 'b' }] },
    ];
    for (const m of samples) {
      const c = gen.compile(m);
      expect(c.label.length).toBeGreaterThan(3);
      expect(skeleton(c.expr), m.kind).not.toMatch(FORBIDDEN);
      expect(c.expr, m.kind).not.toMatch(/;/);
    }
  });

  it('不合法的識別字、函式簽章、角色、多行 needle、未知種類一律拒絕（防注入）', () => {
    expect(() => gen.compile({ ...good, fn: "public.f(uuid); DROP TABLE x" })).toThrow();
    expect(() => gen.compile({ ...good, fn: 'other.f(uuid)' })).toThrow();
    expect(() => gen.compile({ kind: 'col_exists', table: "t'; --", column: 'c' })).toThrow();
    expect(() => gen.compile({ kind: 'col_exists', table: 't', column: 'c d' })).toThrow();
    expect(() => gen.compile({ kind: 'fn_exec', fn: 'public.f()', grants: { "anon'": true } })).toThrow();
    expect(() => gen.compile({ ...good, needle: 'a\nb' })).toThrow();
    expect(() => gen.compile({ ...good, needle: '' })).toThrow();
    expect(() => gen.compile({ kind: 'policy_has', table: 't', name: 'p', needle: 'x', part: 'oops' })).toThrow();
    expect(() => gen.compile({ kind: 'perm_active', codes: ["a'b"] })).toThrow();
    expect(() => gen.compile({ kind: 'seed_codes', table: 'x; y', codes: ['A'] })).toThrow();
    expect(() => gen.compile({ kind: 'no_null', table: 'ga_equipment', column: 'q; z' })).toThrow();
    expect(() => gen.compile({ kind: 'drop_everything' })).toThrow(/未知/);
  });

  it('needle 裡的單引號會被加倍，不會跳出字串', () => {
    const c = gen.compile({ kind: 'fn_has', fn: 'public.f(uuid)', needle: "it's" });
    expect(c.expr).toContain("'it''s'");
  });

  it('資料漏掉一支 migration、多一支不在 00c 清單的 migration、或同一支重複，產生器都要失敗', () => {
    expect(() => gen.build({ dataOverride: { ...data, migrations: data.migrations.slice(1) } })).toThrow(/還沒寫標記/);
    expect(() => gen.build({ dataOverride: { ...data, migrations: [...data.migrations, { migration: '20990101000000_nope', markers: [good] }] } })).toThrow(/不在 00c/);
    expect(() => gen.build({ dataOverride: { ...data, migrations: [...data.migrations, data.migrations[0]] } })).toThrow(/重複/);
    expect(() => gen.build({ dataOverride: { ...data, migrations: [{ ...data.migrations[0], markers: [] }, ...data.migrations.slice(1)] } })).toThrow(/沒有標記/);
  });

  it('superseded_by 指到不在 README 總表的檔案時失敗', () => {
    const bad = { ...data, migrations: data.migrations.map((g, i) => (i === 0 ? { ...g, markers: [{ ...g.markers[0], superseded_by: { file: 'm9-sql/nope.sql', note: 'x' } }] } : g)) };
    expect(() => gen.build({ dataOverride: bad })).toThrow(/不在 README/);
  });
});
