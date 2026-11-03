import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// P01 單元層：藥師主檔編輯旗標與舊版一致（舊 page.tsx 只用 master.edit 控制主檔與年費視窗）。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('P01 藥師主檔編輯權限對齊舊版', () => {
  it('舊版：PharmacistMasterList 的 canEdit 只看 canEditMasterTab', () => {
    expect(read('app/admin/pharmacist-management/page.tsx')).toMatch(/PharmacistMasterList[\s\S]{0,200}canEdit=\{canEditMasterTab\}/);
  });
  it('新版 capabilities.masterEdit 只看 master.edit，不再要求 management.edit', () => {
    const src = read('lib/workspace/pharmacist-overview.ts');
    expect(src).toMatch(/masterEdit:\s*canEditMasterTab,/);
    expect(src).not.toMatch(/masterEdit:\s*canEditMasterTab\s*&&/);
  });
  it('年費視窗的新增、編輯、刪除使用 caps.masterEdit', () => {
    const vue = read('vue-workspace/src/pages/Pharmacists.vue');
    const start = vue.indexOf("<template v-else-if=\"modal === 'fees'\"");
    const end = vue.indexOf('</tbody>', start);
    const block = vue.slice(start, end);
    expect(block).toMatch(/caps\.masterEdit && !feeEditing/);
    expect(block).not.toMatch(/caps\.edit\b/);
  });
});
