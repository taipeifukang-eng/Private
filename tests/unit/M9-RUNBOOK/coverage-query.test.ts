import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// 00c 舊版 migration 覆蓋率檢查：只讀檔、不連資料庫。測產生器的解析規則，以及產出的 SQL 是純查詢。
const nodeRequire = createRequire(import.meta.url);
const root = path.resolve(__dirname, '..', '..', '..');
type Item = { type: string; schema: string; parent: string | null; name: string; mig: number };
const builder = nodeRequire(path.join(root, 'scripts', 'm9-coverage', 'build.cjs')) as {
  build: (dir?: string) => { sql: string; items: Item[]; unchecked: string[]; files: string[]; warnings: string[] };
  parseArgTypes: (s: string) => string[];
  OUT_FILE: string;
};

const sql = fs.readFileSync(builder.OUT_FILE, 'utf8').replace(/\r\n/g, '\n');

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

/** 用一組假的 migration 跑產生器。 */
function run(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
  try {
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, `${name}.sql`), text);
    return builder.build(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const names = (r: ReturnType<typeof run>, type: string) =>
  r.items.filter((i) => i.type === type).map((i) => (i.parent ? `${i.parent}.${i.name}` : i.name)).sort();

describe('00c_prod_legacy_migration_coverage.readonly.sql（產出的 SQL）', () => {
  it('只有一個語句，且以 WITH 開頭', () => {
    const stmts = body.split(';').map((s) => s.trim()).filter(Boolean);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^WITH\b/i);
  });

  it('沒有任何會寫入或建立東西的關鍵字', () => {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|COPY|DO|EXECUTE|CALL|BEGIN|COMMIT|ROLLBACK|SET|RESET|NOTIFY|LISTEN|VACUUM|ANALYZE|REFRESH|COMMENT)\b/i;
    expect(body).not.toMatch(forbidden);
    expect(body).not.toMatch(/\$\$/);
    expect(body).not.toMatch(/\b(pg_advisory|set_config|nextval|setval|dblink|pg_terminate|pg_cancel|lo_)\w*\s*\(/i);
  });

  it('只讀允許的目錄與資料表', () => {
    const allowed = ['pg_class', 'pg_namespace', 'information_schema.columns', 'pg_trigger', 'pg_policies', 'pg_indexes', 'storage.buckets', 'public.permissions', 'pg_type', 'pg_extension', 'migs', 'items', 'chk', 'by_mig'];
    const froms = [...body.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.0-9]+)/gi)].map((m) => m[1].toLowerCase());
    expect(froms.length).toBeGreaterThan(10);
    for (const f of froms) expect(allowed).toContain(f);
  });

  it('輸出 JSON 欄位齊全', () => {
    for (const k of ['generated_at', 'total_checked', 'present_count', 'missing', 'missing_by_migration', 'migrations_all_missing', 'migrations_partial', 'unchecked_migrations']) {
      expect(sql).toContain(`'${k}'`);
    }
    for (const k of ['type', 'name', 'migration', 'missing_count', 'total', 'status']) expect(sql).toContain(`'${k}'`);
    expect(sql).toContain("'all_missing'");
    expect(sql).toContain("'partial'");
  });

  it('與目前的 supabase/migrations 同步（產生器重跑結果一致）', () => {
    expect(builder.build().sql).toBe(sql);
  });

  it('檔頭宣告的總數與實際列數一致，且有繁體中文用法說明', () => {
    const rows = [...sql.matchAll(/^\s*\('(table|column|function|trigger|policy|index|bucket|permission|sequence|type|extension)', '/gm)];
    expect(sql).toContain(`共 ${rows.length} 項`);
    const head = sql.split('\n').slice(0, 12).join('\n');
    expect(head).toMatch(/SQL Editor/);
    expect(head).toMatch(/貼回/);
  });

  it('涵蓋 00b 發現缺的舊版物件（督導管理表與函式、QR 作廢觸發器）', () => {
    for (const t of ['supervisor_management_cases', 'supervisor_management_case_events', 'supervisor_management_followups', 'supervisor_management_records']) {
      expect(sql).toContain(`('table', 'public', NULL, '${t}'`);
    }
    expect(sql).toContain("'supervisor_management_case_is_manageable(uuid)'");
    expect(sql).toContain("'supervisor_management_current_user_has_permission(text)'");
    expect(sql).toContain("'supervisor_management_soft_delete_daily_plan(uuid,text)'");
    // QR 作廢觸發器：函式本身與設備、設施兩個觸發器都要查
    expect(sql).toContain("'ga_revoke_asset_qr_on_terminal_status()'");
    expect(sql).toContain("'ga_equipment', 'trg_ga_equipment_qr_auto_revoke'");
    expect(sql).toContain("'ga_facilities', 'trg_ga_facilities_qr_auto_revoke'");
  });

  it('每個函式項目都帶括號簽章，且每個權限碼是 a.b.c 形式', () => {
    const fns = [...sql.matchAll(/\('function', '([^']+)', NULL, '([^']+)'/g)];
    expect(fns.length).toBeGreaterThan(50);
    for (const f of fns) expect(f[2]).toMatch(/^[a-z_0-9"]+\(.*\)$/);
    const perms = [...sql.matchAll(/\('permission', 'public', NULL, '([^']+)'/g)].map((m) => m[1]);
    expect(perms.length).toBeGreaterThan(50);
    for (const p of perms) expect(p).toMatch(/^[a-z_]+(\.[a-z_0-9]+)+$/);
  });

  it('實際 migration 解析沒有解析失敗的警告', () => {
    const { warnings } = builder.build();
    expect(warnings.filter((w) => !/動態 SQL 略過/.test(w))).toEqual([]);
  });
});

describe('產生器解析規則（假 migration）', () => {
  it('表、欄位、索引、政策、觸發器、函式、權限碼、儲存空間都會登記，並記下建立它的 migration', () => {
    const r = run({
      '20260101000000_a': `
        CREATE TABLE IF NOT EXISTS public.t1 (id uuid PRIMARY KEY, "Name" text NOT NULL, n numeric(10,2) DEFAULT 1, CONSTRAINT c1 UNIQUE (n));
        ALTER TABLE public.t1 ADD COLUMN IF NOT EXISTS extra int, ADD COLUMN other text;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_t1_n ON public.t1 (n);
        ALTER TABLE public.t1 ENABLE ROW LEVEL SECURITY;
        CREATE POLICY p_read ON public.t1 FOR SELECT USING (true);
        CREATE TRIGGER trg_t1 BEFORE INSERT ON public.t1 FOR EACH ROW EXECUTE FUNCTION public.f1();
        CREATE OR REPLACE FUNCTION public.f1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN CREATE TABLE ghost (x int); RETURN NEW; END; $$;
        INSERT INTO public.permissions (module, feature, code, action) VALUES ('m','f','m.f.view','view'), ('m','f','m.f.edit','edit') ON CONFLICT (code) DO NOTHING;
        INSERT INTO storage.buckets (id, name, public) VALUES ('bk-1','bk-1',false) ON CONFLICT DO NOTHING;
      `,
    });
    expect(names(r, 'table')).toEqual(['t1']);
    expect(names(r, 'column')).toEqual(['t1.Name', 't1.extra', 't1.id', 't1.n', 't1.other']);
    expect(names(r, 'index')).toEqual(['t1.idx_t1_n']);
    expect(names(r, 'policy')).toEqual(['t1.p_read']);
    expect(names(r, 'trigger')).toEqual(['t1.trg_t1']);
    expect(names(r, 'function')).toEqual(['f1()']);
    expect(names(r, 'permission')).toEqual(['m.f.edit', 'm.f.view']);
    expect(names(r, 'bucket')).toEqual(['bk-1']);
    expect(r.items.every((i) => i.mig === 0)).toBe(true);
    // 函式本文裡的 CREATE TABLE 不算
    expect(r.items.find((i) => i.name === 'ghost')).toBeUndefined();
  });

  it('後來被刪除的物件排除（表連同欄位、政策、觸發器、索引一起）', () => {
    const r = run({
      '20260101000000_a': `
        CREATE TABLE public.old_t (id int, v text);
        CREATE INDEX idx_old ON public.old_t (v);
        CREATE POLICY p_old ON public.old_t USING (true);
        CREATE TABLE public.keep_t (id int, gone text);
        CREATE FUNCTION public.old_fn(a int) RETURNS int LANGUAGE sql AS 'select 1';
        CREATE FUNCTION public.keep_fn(a int) RETURNS int LANGUAGE sql AS 'select 1';
        CREATE INDEX idx_gone ON public.keep_t (gone);
        CREATE POLICY p_gone ON public.keep_t USING (true);
        CREATE TRIGGER trg_gone AFTER INSERT ON public.keep_t FOR EACH ROW EXECUTE FUNCTION public.keep_fn_t();
      `,
      '20260102000000_b': `
        DROP TABLE IF EXISTS public.old_t CASCADE;
        ALTER TABLE public.keep_t DROP COLUMN IF EXISTS gone;
        DROP FUNCTION IF EXISTS public.old_fn(int);
        DROP INDEX IF EXISTS public.idx_gone;
        DROP POLICY IF EXISTS p_gone ON public.keep_t;
        DROP TRIGGER IF EXISTS trg_gone ON public.keep_t;
      `,
    });
    expect(names(r, 'table')).toEqual(['keep_t']);
    expect(names(r, 'column')).toEqual(['keep_t.id']);
    expect(names(r, 'function')).toEqual(['keep_fn(int)']);
    expect(names(r, 'index')).toEqual([]);
    expect(names(r, 'policy')).toEqual([]);
    expect(names(r, 'trigger')).toEqual([]);
  });

  it('改名以新名稱為準，算在改名那支 migration', () => {
    const r = run({
      '20260101000000_a': 'CREATE TABLE public.t_old (id int, c_old text); CREATE POLICY p ON public.t_old USING (true);',
      '20260102000000_b': 'ALTER TABLE public.t_old RENAME TO t_new; ALTER TABLE public.t_new RENAME COLUMN c_old TO c_new;',
    });
    expect(names(r, 'table')).toEqual(['t_new']);
    expect(names(r, 'column')).toEqual(['t_new.c_new', 't_new.id']);
    expect(names(r, 'policy')).toEqual(['t_new.p']);
    expect(r.items.find((i) => i.name === 't_new')!.mig).toBe(1);
    expect(r.items.find((i) => i.name === 'c_new')!.mig).toBe(1);
    expect(r.items.find((i) => i.name === 'id')!.mig).toBe(0);
  });

  it('同一支內先砍再建仍算最初建立者；跨支砍了再建則算重建那支', () => {
    const r = run({
      '20260101000000_a': 'CREATE TABLE public.t (id int); CREATE POLICY p1 ON public.t USING (true); CREATE POLICY p2 ON public.t USING (true);',
      '20260102000000_b': 'DROP POLICY IF EXISTS p1 ON public.t; CREATE POLICY p1 ON public.t USING (false);',
      '20260103000000_c': 'DROP POLICY p2 ON public.t;',
      '20260104000000_d': 'CREATE POLICY p2 ON public.t USING (true);',
    });
    const mig = (n: string) => r.items.find((i) => i.name === n)!.mig;
    expect(mig('p1')).toBe(0);
    expect(mig('p2')).toBe(3);
  });

  it('函式簽章：去掉參數名、預設值、長度，保留多字型別與陣列，OUT 參數不算', () => {
    const f = builder.parseArgTypes;
    expect(f('p_id uuid, p_name text DEFAULT NULL, p_n numeric(10,2) = 1')).toEqual(['uuid', 'text', 'numeric']);
    expect(f('"p_a" "uuid", "p_b" "text"[]')).toEqual(['uuid', 'text[]']);
    expect(f('p_t timestamp with time zone, character varying, p_d double precision')).toEqual(['timestamp with time zone', 'character varying', 'double precision']);
    expect(f('IN a int, OUT b text, INOUT c uuid, VARIADIC d text[]')).toEqual(['int', 'uuid', 'text[]']);
    expect(f('')).toEqual([]);
    expect(f('p public.ga_category_kind, q "public"."ga_category_kind"')).toEqual(['public.ga_category_kind', 'public.ga_category_kind']);
  });

  it('函式重載（不同參數）視為不同物件；覆寫同簽章只算一個', () => {
    const r = run({
      '20260101000000_a': "CREATE FUNCTION public.f(a int) RETURNS int LANGUAGE sql AS 'select 1'; CREATE OR REPLACE FUNCTION public.f(a int) RETURNS int LANGUAGE sql AS 'select 2'; CREATE FUNCTION public.f(a int, b text) RETURNS int LANGUAGE sql AS 'select 3';",
    });
    expect(names(r, 'function')).toEqual(['f(int)', 'f(int,text)']);
  });

  it('DO 區塊裡的 CREATE／EXECUTE 會處理；RAISE 訊息與 IF 條件不誤判', () => {
    const r = run({
      '20260101000000_a': `
        DO $$ BEGIN
          IF to_regclass('public.zz') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite: create table zz'; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'dp') THEN
            CREATE POLICY dp ON public.t USING (true);
          END IF;
          EXECUTE $x$ CREATE INDEX idx_do ON public.t (id) $x$;
        END $$;
      `,
    });
    expect(names(r, 'policy')).toEqual(['t.dp']);
    expect(names(r, 'index')).toEqual(['t.idx_do']);
    expect(r.items).toHaveLength(2);
  });

  it('沒有可檢查物件的 migration 會列在 unchecked', () => {
    const r = run({
      '20260101000000_a': 'CREATE TABLE public.t (id int);',
      '20260102000000_b': 'UPDATE public.t SET id = 1; GRANT SELECT ON public.t TO anon;',
    });
    expect(r.unchecked).toEqual(['20260102000000_b']);
    expect(r.sql).toContain('20260102000000_b');
  });

  it('註解與字串內的假語句不會被當成真的', () => {
    const r = run({
      '20260101000000_a': `
        -- CREATE TABLE public.in_comment (id int);
        /* CREATE TABLE public.in_block (id int); */
        INSERT INTO public.logs (msg) VALUES ('CREATE TABLE public.in_string (id int); DROP TABLE public.real_t');
        CREATE TABLE public.real_t (id int);
      `,
    });
    expect(names(r, 'table')).toEqual(['real_t']);
  });
});
