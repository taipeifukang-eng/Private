import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse, NodeTypes } from '@vue/compiler-dom';

// W12 單元層（M3 C.5）：首頁版面順序、問候、快捷入口位置，以及 API 路由不設頁面權限（登入即可讀）。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const view = read('vue-workspace/src/components/HomeView.vue');
const template = view.slice(view.indexOf('<template>'), view.indexOf('<style'));

describe('首頁版面（C.5）', () => {
  it('順序：調店確認 → 每月版更 → 我的獎金 → 新人入職 → 任務 → 壽星 → 年費 → 執照 → 快捷入口', () => {
    // 用模板 AST 判斷：註解裡的屬性不算；被 v-if="false" / v-show="false" 擋住的卡片不算。
    const found: { key: string; hidden: boolean }[] = [];
    const walk = (node: any, hidden: boolean) => {
      let h = hidden;
      if (node.type === NodeTypes.ELEMENT) {
        const hide = node.props.some((p: any) => p.type === NodeTypes.DIRECTIVE && ['if', 'show'].includes(p.name) && p.exp?.content?.trim() === 'false');
        h = hidden || hide;
        const attr = node.props.find((p: any) => p.type === NodeTypes.ATTRIBUTE && ((p.name === 'data-home-card' || (p.name === 'data-home' && p.value?.content === 'quick'))));
        if (attr) found.push({ key: `${attr.name}=${attr.value?.content}`, hidden: h });
      }
      for (const c of node.children || []) if (typeof c === 'object') walk(c, h);
    };
    walk(parse(template), false);
    const expected = ['data-home-card=transfer-confirm', 'data-home-card=monthly-release', 'data-home-card=bonus', 'data-home-card=onboarding', 'data-home-card=tasks', 'data-home-card=birthdays', 'data-home-card=annual-fee', 'data-home-card=license', 'data-home=quick'];
    expect(found.filter((f) => f.hidden), '不得有被 v-if/v-show="false" 隱藏的卡片').toEqual([]);
    expect(found.map((f) => f.key)).toEqual(expected);
  });
  it('問候只有「歡迎回來，姓名」，沒有依角色的一句話', () => {
    expect(template).toContain('歡迎回來，{{ name }}');
    for (const sentence of ['您是系統管理員', '您是專案經理', '查看並執行指派給您的任務']) expect(template).not.toContain(sentence);
  });
  it('快捷入口有巡店、活動、版更，且放在所有提醒卡片之後', () => {
    const quick = template.slice(template.indexOf('data-home="quick"'));
    for (const text of ['查詢巡店紀錄', '管理活動檔期', '每月版更內容']) expect(quick).toContain(text);
  });
  it('獎金月份未確認時標註「尚未確認，金額可能調整」（Q12）', () => {
    expect(template).toContain('尚未確認，金額可能調整');
    expect(template).toContain('v-if="!m.confirmed"');
  });
  it('「新舊功能共用測試環境」說明仍在（正式切換時才移除）', () => {
    expect(template).toContain('新舊功能共用測試環境');
  });
  it('App.vue 首頁使用 HomeView，不再自帶舊的歡迎區塊', () => {
    const app = read('vue-workspace/src/App.vue');
    expect(app).toContain('<HomeView />');
    expect(app).not.toContain('開始今天的營運作業');
  });
});

describe('首頁 API', () => {
  it('路由只要求登入（沒有頁面權限碼），資料由 loadHome 依身分決定', () => {
    const route = read('app/api/workspace/home/route.ts');
    expect(route).not.toContain('requireCapability');
    expect(route).toContain('loadHome(ctx)');
  });
  it('提醒名單與壽星用 service role 讀取並分頁（不被 1000 列上限截斷）', () => {
    const src = read('lib/workspace/home.ts');
    expect(src).toContain('range(from, from + PAGE - 1)');
    expect(src).toContain('ctx.admin');
  });
});

describe('首頁版面寬度', () => {
  const css = view.slice(view.indexOf('<style'));
  it('內容寬度在寬螢幕可延展（>= 1400px），不再鎖在 1100px', () => {
    const m = css.match(/\.home\s*\{[^}]*max-width:\s*(\d+)px/);
    expect(m, '.home 要有 max-width').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1400);
    expect(css).toMatch(/\.home\s*\{[^}]*min-width:\s*0/);
  });
  it('快捷入口不再被全域 760px 限制，與上方卡片同寬', () => {
    expect(css).toMatch(/\.home-quick \.work-options\s*\{[^}]*max-width:\s*none/);
  });
});

