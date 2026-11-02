import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadAllowlist, loadMap } from '../../support/parity';

// W01b 白名單與 parity map：每個與舊版不同的行為都有 approvedBy:null 且有 match 的條目，並對得上 map entry。
const root = path.resolve(__dirname, '..', '..', '..');

describe('W01b 白名單條目', () => {
  const entries = loadAllowlist().filter((e) => e.page === 'monthly-edit');
  const map = loadMap('monthly-edit');
  const entryIds = new Set(map.entries.map((e) => e.id));

  it('全部尚未核可（approvedBy 為 null），且都有 match，match.entry 對應 parity map', () => {
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const e of entries) {
      expect(e.approvedBy, e.id).toBeNull();
      expect(e.match, e.id).toBeTruthy();
      expect(entryIds.has(e.match!.entry!), `${e.id} 的 match.entry`).toBe(true);
    }
  });

  it('使用者拍板的三項差異都有登記：W01b-q1 區塊預覽、W01b-q2 新人提醒、W01b-q3 不滿月不自動改', () => {
    const ids = entries.map((e) => e.id);
    for (const id of ['w01b-block-preview-follows-db', 'w01b-newbie-reminder-not-blocking', 'w01b-newbie-promote-via-movement', 'w01b-partial-month-no-auto-status']) expect(ids).toContain(id);
  });

  it('parity map 的每個 entry 都有被 parity 測試引用', () => {
    const spec = fs.readFileSync(path.join(root, 'tests', 'parity', 'W01b.monthly-edit.spec.ts'), 'utf8');
    for (const e of map.entries) expect(spec, e.id).toContain(`'${e.id}'`);
  });
});

describe('W01b 檔案與 DEV SQL', () => {
  it('DEV SQL 只放在 supabase/workspace-dev，內容是最新版 calculate_bonus_block（9 個參數）並標明僅限 DEV', () => {
    const sql = fs.readFileSync(path.join(root, 'supabase', 'workspace-dev', '20261103010000_vue_monthly_bonus_block.sql'), 'utf8');
    expect(sql).toContain('p_is_acting_manager');
    expect(sql).toContain('DEV 專用');
    expect(sql).toContain('不得套用到 Production');
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|FUNCTION)\b/i);
  });
  it('共用模組是純檔案：不 import 套件或伺服器模組', () => {
    for (const f of ['block', 'hours', 'newbie']) {
      const text = fs.readFileSync(path.join(root, 'lib', 'monthly-staff', `${f}.ts`), 'utf8');
      const imports = Array.from(text.matchAll(/^import .* from ['"](.+)['"];?$/gm)).map((m) => m[1]);
      for (const spec of imports) expect(spec, `${f}: ${spec}`).toMatch(/^\.\/[a-z-]+$/);
    }
  });
});
