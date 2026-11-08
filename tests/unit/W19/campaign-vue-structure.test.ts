import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// W19 / P05 畫面結構檢查：不啟動瀏覽器，確認 M5 規格要求的元素都在原始碼裡（e2e 另外驗證實際行為）。
const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../../vue-workspace/src', p), 'utf8');

describe('活動列表 Campaigns.vue', () => {
  const s = read('pages/Campaigns.vue');
  it('狀態依日期、停用與未發布標籤', () => {
    expect(s).toContain('campaignPhase');
    expect(s).toContain('>停用<');
    expect(s).toContain('>未發布<');
    expect(s).toContain('campaignTypeLabel(row.campaign_type)');
  });
  it('排程入口依權限、純檢視者改走活動檢視', () => {
    expect(s).toContain('canEnterSchedule');
    expect(s).toContain('href="/activity-management"');
  });
  it('刪除：輸入名稱、筆數、名稱不符時按鈕停用', () => {
    expect(s).toContain('preview=delete');
    expect(s).toContain('deleteNameMatches(deleteName,deleting.name)');
    expect(s).toContain('confirmName');
  });
});

describe('活動編輯 CampaignEdit.vue', () => {
  const s = read('pages/CampaignEdit.vue');
  it('改期列出期間外門市、確認後 moveOutside；已發布提示立即生效', () => {
    expect(s).toContain('preview: "outside"');
    expect(s).toContain('moveOutside: true');
    expect(s).toContain('儲存後立即生效');
  });
});

describe('活動排程 CampaignSchedule.vue', () => {
  const s = read('pages/CampaignSchedule.vue');
  it('盤點類分頁、週一為首、督導顏色、手動排程提醒、已發布提示、沒有可用日期提示', () => {
    expect(s).toContain('campaignSections(campaign.value?.campaign_type)');
    expect(s).toContain('MONDAY_FIRST_HEADERS');
    expect(s).toContain('mondayFirstBlanks');
    expect(s).toContain('buildSupervisorColorMap');
    expect(s).toContain('manualScheduleWarnings');
    expect(s).toContain('儲存後立即生效');
    expect(s).toContain('runAutoSchedule');
  });
});

describe('特殊日期 CampaignConfiguration.vue 與行銷部 CampaignDepartment.vue', () => {
  it('依月份分組、星期、覆蓋提醒、重疊擋下', () => {
    const s = read('components/CampaignConfiguration.vue');
    expect(s).toContain('groupEventsByMonth');
    expect(s).toContain('weekdayLabel');
    expect(s).toContain('eventOverwrite');
    expect(s).toContain('overlappingDays');
  });
  it('圖片拖曳排序（含前移後移）與 8 張上限', () => {
    const s = read('components/CampaignDepartment.vue');
    expect(s).toContain(':draggable="canEdit"');
    expect(s).toContain('reorderMarketingImages');
    expect(s).toContain('MAX_MARKETING_IMAGES');
  });
});
