import { describe, expect, it } from 'vitest';
import { buildPrintDocument, escapeHtml, type LabelItem } from '../../../vue-workspace/src/lib/ga-labels';
import { gaFlags } from '../../../lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF } from '../../../lib/workspace/general-affairs/nav';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';

const item = (over: Partial<LabelItem> = {}): LabelItem => ({ id: '1', type: 'EQUIPMENT', name: '冰箱', code: 'IC0120260101001', storeCode: 'ZT01', storeName: '測試店', qrUrl: 'https://x.test/a', svg: '<svg></svg>', warnings: [], ...over });

describe('G10 列印文件', () => {
  it('版型是 60 x 25 mm、每張一頁', () => {
    const html = buildPrintDocument([item(), item({ id: '2' })], { watermark: false, noun: '設備' });
    expect(html).toContain('size: 60mm 25mm');
    expect(html).toContain('width: 60mm; height: 25mm');
    expect(html.match(/data-testid="print-label"/g)).toHaveLength(2);
    expect(html).toContain('page-break-after: always');
  });
  it('非正式環境加「測試」浮水印，正式環境不加', () => {
    expect(buildPrintDocument([item()], { watermark: true, noun: '設備' })).toContain('class="wm">測試');
    expect(buildPrintDocument([item()], { watermark: false, noun: '設備' })).not.toContain('class="wm"');
  });
  it('沒有編號時紅字提示並建議補編號；名稱會跳脫避免注入', () => {
    const html = buildPrintDocument([item({ code: null, name: '<img src=x onerror=alert(1)>' })], { watermark: false, noun: '設施' });
    expect(html).toContain('尚未設定編號');
    expect(html).toContain('code missing');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(escapeHtml(`a&b"c'`)).toBe('a&amp;b&quot;c&#39;');
  });
});

describe('G10 旗標與頁面登錄', () => {
  const none = () => false;
  it('標籤列印旗標只給該類查看或管理者，店長身分不行', () => {
    const has = (...codes: string[]) => codes.some((c) => c === 'general_affairs.equipment.view');
    const f = gaFlags(has, false);
    expect(f.gaEquipmentLabels).toBe(true);
    expect(f.gaFacilityLabels).toBe(false);
    const sm = gaFlags(none, true, true);
    expect(sm.gaEquipmentLabels).toBe(false);
    expect(sm.gaFacilityLabels).toBe(false);
  });
  it('設備標籤列印接到舊網址；掃描頁任何登入者可進', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/equipment/labels']).toEqual({ kind: 'ga-equipment-labels', flag: 'gaEquipmentLabels' });
    expect(WORKSPACE_PAGE_META['ga-asset-scan'].permission).toContain('monthlyRelease');
    expect(WORKSPACE_PAGE_META['ga-facility-labels'].permission).toEqual(['gaFacilityLabels']);
  });
});
