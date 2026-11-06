import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// W12 單元層（M3 C.5）：首頁版面順序、問候、快捷入口位置，以及 API 路由不設頁面權限（登入即可讀）。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const view = read('vue-workspace/src/components/HomeView.vue');
const template = view.slice(view.indexOf('<template>'), view.indexOf('<style'));

describe('首頁版面（C.5）', () => {
  it('順序：調店確認 → 每月版更 → 我的獎金 → 新人入職 → 任務 → 壽星 → 年費 → 執照 → 快捷入口', () => {
    const marks = ['data-home-card="transfer-confirm"', 'data-home-card="monthly-release"', 'data-home-card="bonus"', 'data-home-card="onboarding"', 'data-home-card="tasks"', 'data-home-card="birthdays"', 'data-home-card="annual-fee"', 'data-home-card="license"', 'data-home="quick"'];
    const at = marks.map((m) => template.indexOf(m));
    expect(at.every((i) => i >= 0), `找不到：${marks.filter((_, i) => at[i] < 0)}`).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
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
