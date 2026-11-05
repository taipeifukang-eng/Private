import { describe, expect, it } from 'vitest';
import { applyExternalHoursPrefix, stripExternalHoursPrefix } from '../../../lib/monthly-staff/external-hours-note';

// 規格 G.3：外務時數前綴去重（伺服器端）。
describe('外務時數前綴去重', () => {
  it('無前綴：加上最新一個', () => {
    expect(applyExternalHoursPrefix('5/15 到職', 6)).toBe('外務時數: 6小時; 5/15 到職');
  });
  it('已有一個前綴：取代成最新值，不疊加', () => {
    expect(applyExternalHoursPrefix('外務時數: 5小時; 5/15 到職', 6)).toBe('外務時數: 6小時; 5/15 到職');
    expect(applyExternalHoursPrefix('外務時數: 5小時', 2.5)).toBe('外務時數: 2.5小時');
  });
  it('已有多個疊加前綴：全部移除只留一個', () => {
    expect(applyExternalHoursPrefix('外務時數: 5小時; 外務時數: 5小時; 外務時數: 3小時; 原備註', 8)).toBe('外務時數: 8小時; 原備註');
    expect(applyExternalHoursPrefix('外務時數: 5小時; 外務時數: 4小時', 8)).toBe('外務時數: 8小時');
  });
  it('時數改為 0 或空：移除前綴、保留原備註', () => {
    expect(applyExternalHoursPrefix('外務時數: 5小時; 外務時數: 5小時; 原備註', 0)).toBe('原備註');
    expect(applyExternalHoursPrefix('外務時數: 5小時; 原備註', null)).toBe('原備註');
    expect(applyExternalHoursPrefix('外務時數: 5小時', 0)).toBeNull();
  });
  it('原備註為空：只有前綴；沒有時數則為 null', () => {
    expect(applyExternalHoursPrefix('', 5)).toBe('外務時數: 5小時');
    expect(applyExternalHoursPrefix(null, 5)).toBe('外務時數: 5小時');
    expect(applyExternalHoursPrefix('', 0)).toBeNull();
    expect(applyExternalHoursPrefix(undefined, null)).toBeNull();
  });
  it('只移除開頭的前綴，備註中間出現的字樣不動', () => {
    expect(stripExternalHoursPrefix('備註 外務時數: 5小時')).toBe('備註 外務時數: 5小時');
  });
});
