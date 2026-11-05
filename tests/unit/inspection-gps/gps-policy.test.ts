import { describe, expect, it } from 'vitest';
import {
  GPS_DB_ERROR_PREFIX,
  GPS_GUIDE_TABS,
  classifyGeolocationError,
  detectGpsDevice,
  evaluateGpsAccuracy,
  getDefaultGuideTab,
  getGpsDbErrorMessage,
  getGpsFailureMessage,
  getGpsFailureNote,
  isCoordinateInRange,
  isGpsDbError,
  isGpsTimestampWithinWindow,
  isLineInAppBrowser,
  validateGpsFix,
} from '@/lib/inspection/gps-policy';

const NOW = Date.parse('2026-11-05T10:00:00Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const UA_IPHONE_LINE = `${UA_IPHONE} Line/13.9.0`;
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
const UA_ANDROID_LINE = `${UA_ANDROID} Line/13.9.0/IAB`;
const UA_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
const UA_IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';

describe('classifyGeolocationError', () => {
  it('maps the three standard codes', () => {
    expect(classifyGeolocationError(1)).toBe('permission_denied');
    expect(classifyGeolocationError(2)).toBe('position_unavailable');
    expect(classifyGeolocationError(3)).toBe('timeout');
  });
  it('falls back to unknown', () => {
    expect(classifyGeolocationError(0)).toBe('unknown');
    expect(classifyGeolocationError(undefined)).toBe('unknown');
    expect(classifyGeolocationError(null)).toBe('unknown');
  });
});

describe('evaluateGpsAccuracy', () => {
  it('ok up to 500 inclusive', () => {
    expect(evaluateGpsAccuracy(0)).toBe('ok');
    expect(evaluateGpsAccuracy(35.5)).toBe('ok');
    expect(evaluateGpsAccuracy(500)).toBe('ok');
  });
  it('warns between 500 and 1000 inclusive', () => {
    expect(evaluateGpsAccuracy(500.1)).toBe('warn');
    expect(evaluateGpsAccuracy(1000)).toBe('warn');
  });
  it('rejects above 1000 and bad values', () => {
    expect(evaluateGpsAccuracy(1000.01)).toBe('reject');
    expect(evaluateGpsAccuracy(5000)).toBe('reject');
    expect(evaluateGpsAccuracy(undefined)).toBe('reject');
    expect(evaluateGpsAccuracy(null)).toBe('reject');
    expect(evaluateGpsAccuracy(Number.NaN)).toBe('reject');
    expect(evaluateGpsAccuracy(-1)).toBe('reject');
  });
});

describe('isCoordinateInRange', () => {
  it('accepts valid and boundary coordinates', () => {
    expect(isCoordinateInRange(25.04, 121.56)).toBe(true);
    expect(isCoordinateInRange(90, 180)).toBe(true);
    expect(isCoordinateInRange(-90, -180)).toBe(true);
  });
  it('rejects out-of-range and non-numeric', () => {
    expect(isCoordinateInRange(90.1, 0)).toBe(false);
    expect(isCoordinateInRange(0, 180.1)).toBe(false);
    expect(isCoordinateInRange(Number.NaN, 0)).toBe(false);
    expect(isCoordinateInRange('25', 121)).toBe(false);
    expect(isCoordinateInRange(null, null)).toBe(false);
  });
});

describe('isGpsTimestampWithinWindow', () => {
  it('accepts now, 2 hours ago and 5 minutes ahead (inclusive)', () => {
    expect(isGpsTimestampWithinWindow(iso(0), NOW)).toBe(true);
    expect(isGpsTimestampWithinWindow(iso(-2 * HOUR), NOW)).toBe(true);
    expect(isGpsTimestampWithinWindow(iso(5 * MIN), NOW)).toBe(true);
  });
  it('rejects older than 2 hours and later than 5 minutes', () => {
    expect(isGpsTimestampWithinWindow(iso(-2 * HOUR - 1), NOW)).toBe(false);
    expect(isGpsTimestampWithinWindow(iso(5 * MIN + 1), NOW)).toBe(false);
  });
  it('rejects missing or unparsable', () => {
    expect(isGpsTimestampWithinWindow(undefined, NOW)).toBe(false);
    expect(isGpsTimestampWithinWindow(null, NOW)).toBe(false);
    expect(isGpsTimestampWithinWindow('not-a-date', NOW)).toBe(false);
  });
});

describe('validateGpsFix', () => {
  const base = { latitude: 25.04, longitude: 121.56, accuracy: 20, capturedAt: iso(-MIN) };
  it('accepts a good fix without warning', () => {
    expect(validateGpsFix(base, NOW)).toEqual({ ok: true, warning: false, message: '' });
  });
  it('accepts 500-1000 with warning', () => {
    const r = validateGpsFix({ ...base, accuracy: 800 }, NOW);
    expect(r).toEqual({ ok: true, warning: true, message: '建議使用手機' });
  });
  it('rejects accuracy > 1000 with distance message', () => {
    const r = validateGpsFix({ ...base, accuracy: 1500.4 }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('accuracy_too_large');
      expect(r.message).toBe('定位誤差過大（±1500 公尺）');
    }
  });
  it('rejects null fix, missing accuracy, bad coordinates', () => {
    expect(validateGpsFix(null, NOW).ok).toBe(false);
    expect(validateGpsFix({ ...base, accuracy: undefined }, NOW)).toMatchObject({ ok: false, kind: 'invalid_fix' });
    expect(validateGpsFix({ ...base, latitude: 120 }, NOW)).toMatchObject({ ok: false, kind: 'invalid_fix' });
  });
  it('rejects timestamps outside the window', () => {
    expect(validateGpsFix({ ...base, capturedAt: iso(-3 * HOUR) }, NOW)).toMatchObject({ ok: false, kind: 'time_invalid' });
    expect(validateGpsFix({ ...base, capturedAt: iso(10 * MIN) }, NOW)).toMatchObject({ ok: false, kind: 'time_invalid' });
    expect(validateGpsFix({ ...base, capturedAt: null }, NOW)).toMatchObject({ ok: false, kind: 'time_invalid' });
  });
});

describe('db error helpers', () => {
  it('recognises and extracts trigger messages', () => {
    const err = { message: `${GPS_DB_ERROR_PREFIX}定位誤差過大（±1200 公尺），上限為 1000 公尺` };
    expect(isGpsDbError(err)).toBe(true);
    expect(getGpsDbErrorMessage(err)).toContain('±1200');
    expect(isGpsDbError({ message: 'duplicate key' })).toBe(false);
    expect(isGpsDbError(null)).toBe(false);
  });
});

describe('device and LINE detection', () => {
  it('detects LINE in-app browser by Line/', () => {
    expect(isLineInAppBrowser(UA_IPHONE_LINE)).toBe(true);
    expect(isLineInAppBrowser(UA_ANDROID_LINE)).toBe(true);
    expect(isLineInAppBrowser(UA_IPHONE)).toBe(false);
    expect(isLineInAppBrowser('')).toBe(false);
    expect(isLineInAppBrowser(undefined)).toBe(false);
  });
  it('detects device kind', () => {
    expect(detectGpsDevice(UA_IPHONE)).toBe('ios');
    expect(detectGpsDevice(UA_ANDROID)).toBe('android');
    expect(detectGpsDevice(UA_WINDOWS)).toBe('windows');
    expect(detectGpsDevice(UA_IPADOS, { maxTouchPoints: 5 })).toBe('ios');
    expect(detectGpsDevice(UA_IPADOS, { maxTouchPoints: 0 })).toBe('other');
  });
  it('chooses the default guide tab', () => {
    expect(getDefaultGuideTab(UA_IPHONE)).toBe('ios');
    expect(getDefaultGuideTab(UA_ANDROID)).toBe('android');
    expect(getDefaultGuideTab(UA_WINDOWS)).toBe('windows');
    expect(getDefaultGuideTab(UA_IPHONE_LINE)).toBe('line');
    expect(getDefaultGuideTab(UA_ANDROID_LINE)).toBe('line');
    expect(getDefaultGuideTab('')).toBe('windows');
  });
});

describe('guide content', () => {
  it('has four tabs, each ending with the re-locate step', () => {
    expect(GPS_GUIDE_TABS.map((t) => t.id)).toEqual(['ios', 'android', 'line', 'windows']);
    for (const tab of GPS_GUIDE_TABS) {
      expect(tab.steps.length).toBeGreaterThan(2);
      expect(tab.steps[tab.steps.length - 1].text).toContain('我開好了，重新定位');
    }
  });
  it('adds failure-specific notes', () => {
    expect(getGpsFailureNote('permission_denied')).toContain('權限被拒絕');
    expect(getGpsFailureNote('timeout')).toContain('窗邊或戶外');
    expect(getGpsFailureNote('position_unavailable')).toContain('窗邊或戶外');
    expect(getGpsFailureNote('accuracy_too_large')).toContain('手機');
    expect(getGpsFailureNote(null)).toBe('');
  });
  it('formats failure messages', () => {
    expect(getGpsFailureMessage('accuracy_too_large', 1234)).toBe('定位誤差過大（±1234 公尺）');
    expect(getGpsFailureMessage('permission_denied')).toBe('定位權限被拒絕');
  });
});
