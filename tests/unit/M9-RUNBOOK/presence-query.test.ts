import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 00b 正式區物件存在性檢查：只讀檔、不連資料庫。確認它是純查詢（只有 SELECT／WITH），且輸出格式與檢查範圍齊全。
const root = path.resolve(__dirname, '..', '..', '..');
const file = path.join(root, 'docs', 'vue-workspace', 'parity-plan', 'm9-sql', '00b_prod_object_presence.readonly.sql');
const sql = fs.readFileSync(file, 'utf8');

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
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const body = skeleton(sql);
// 去掉整行註解、保留字串內容（用來檢查物件名稱與輸出欄位）
const code = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('00b_prod_object_presence.readonly.sql', () => {
  it('只有一個語句，且以 WITH 開頭', () => {
    const stmts = body.split(';').map((s) => s.trim()).filter(Boolean);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/^WITH\b/i);
    expect(stmts[0]).toMatch(/\bSELECT\b/i);
  });

  it('沒有任何會寫入或建立東西的關鍵字，也沒有 DO 區塊', () => {
    const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|COPY|DO|EXECUTE|CALL|BEGIN|COMMIT|ROLLBACK|SET|RESET|NOTIFY|LISTEN|VACUUM|ANALYZE|REFRESH|COMMENT)\b/i;
    expect(body).not.toMatch(forbidden);
    expect(body).not.toMatch(/\$\$/);
    // 不呼叫會產生副作用的函式
    expect(body).not.toMatch(/\b(pg_advisory|set_config|nextval|setval|dblink|pg_terminate|pg_cancel|lo_)\w*\s*\(/i);
  });

  it('只讀允許的目錄與函式來源', () => {
    const allowed = ['information_schema.columns', 'pg_trigger', 'pg_proc', 'pg_extension', 'storage.buckets'];
    const froms = [...body.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.]+)/gi)].map((m) => m[1].toLowerCase());
    for (const f of froms) {
      if (f === 'items') continue;
      expect(allowed).toContain(f);
    }
  });

  it('輸出欄位包含 generated_at、missing、present_count、total_checked，且只列不存在的', () => {
    for (const k of ['generated_at', 'missing', 'present_count', 'total_checked']) expect(code).toContain(`'${k}'`);
    expect(code).toMatch(/FILTER \(WHERE NOT ok\)/);
    for (const k of ['type', 'name', 'needed_by']) expect(code).toContain(`'${k}'`);
  });

  it('涵蓋資料表、欄位、函式、觸發器、儲存空間、擴充六類，且數量與檔頭宣告一致', () => {
    const rows = [...code.matchAll(/^\s*\('(table|column|function|trigger|bucket|extension)'/gm)].map((m) => m[1]);
    const count = (t: string) => rows.filter((r) => r === t).length;
    for (const t of ['table', 'column', 'function', 'trigger', 'bucket', 'extension']) expect(count(t)).toBeGreaterThan(0);
    expect(rows.length).toBe(239);
    expect(sql).toContain(`共 ${rows.length} 項`);
    expect(sql).toContain(`資料表 ${count('table')}`);
    expect(sql).toContain(`欄位 ${count('column')}`);
    expect(sql).toContain(`函式 ${count('function')}`);
  });

  it('函式檢查都帶參數簽章', () => {
    const fns = [...sql.matchAll(/to_regprocedure\('([^']+)'\)/g)].map((m) => m[1]);
    expect(fns.length).toBeGreaterThan(20);
    for (const f of fns) expect(f).toMatch(/^public\.[a-z_0-9]+\(.*\)$/);
  });

  it('包含新版最關鍵的前置物件（has_permission、督導日誌函式、盤點版本欄位、pg_cron）', () => {
    expect(sql).toContain("public.has_permission(uuid,character varying)");
    expect(sql).toContain('supervisor_management_soft_delete_daily_plan');
    expect(sql).toContain('public.inventory_result_batches.report_round');
    expect(sql).toContain("extname='pg_cron'");
    expect(sql).toContain('general-affairs-attachments');
  });

  it('檔頭有繁體中文用法說明', () => {
    const head = sql.split('\n').slice(0, 12).join('\n');
    expect(head).toMatch(/SQL Editor/);
    expect(head).toMatch(/貼回/);
  });
});
