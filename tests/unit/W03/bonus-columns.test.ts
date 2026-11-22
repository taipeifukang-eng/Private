import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bonusColumns } from '../../../vue-workspace/src/performance-bonus-columns';

// 匯入每月獎金的欄位定義：新版必須與舊版 page.tsx 的 BONUS_COLS 同順序、同標籤。
const page = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'app/admin/performance/page.tsx'), 'utf8');
const block = page.slice(page.indexOf('const BONUS_COLS'), page.indexOf('];', page.indexOf('const BONUS_COLS')));
const legacy = Array.from(block.matchAll(/key:\s*'([a-z_]+)',\s*label:\s*'([^']+)'/g)).map((m) => [m[1], m[2]]);

describe('匯入每月獎金欄位', () => {
  it('舊版欄位清單可解析', () => expect(legacy.length).toBeGreaterThanOrEqual(20));
  it('新版欄位 = 舊版欄位（順序、鍵、標籤）', () => expect(bonusColumns).toEqual(legacy));
  it('鍵不重複', () => expect(new Set(bonusColumns.map((c) => c[0])).size).toBe(bonusColumns.length));
});
