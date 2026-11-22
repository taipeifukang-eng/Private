import { describe, expect, it } from 'vitest';
import {
  AUDIO_SECONDS_TOLERANCE,
  CHAT_PRICE_PER_M,
  CHAT_PRICE_UNKNOWN,
  crossedLevels,
  DEFAULT_MONTHLY_CAP_USD,
  DRAFT_MAX_OUTPUT_TOKENS,
  estimateDraft,
  estimateTranscribe,
  formatUsd,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MICRO,
  microToUsd,
  parseCap,
  taipeiMonthKey,
  toMicro,
  TRANSCRIBE_MICRO_PER_MINUTE,
  usageState,
  validateAudio,
  WARN_PERCENT,
} from '../../../lib/supervisor-management-log/voice-ai-rules';

describe('M6-W33 每月上限：預設 US$30、以美元存放不換匯', () => {
  it('預設 30 美元；micro-USD 與美元互換不失真', () => {
    expect(DEFAULT_MONTHLY_CAP_USD).toBe(30);
    expect(toMicro(30)).toBe(30 * MICRO);
    expect(toMicro(0.01)).toBe(10_000);
    expect(microToUsd(30_000_000)).toBe(30);
    expect(formatUsd(30_000_000)).toBe('US$ 30.00');
    expect(formatUsd(1_089)).toBe('US$ 0.0011');
  });
  it('通知門檻是 80%，100% 自動停用', () => {
    expect(WARN_PERCENT).toBe(80);
  });
});

describe('M6-W33 費用估算：偏保守、無條件進位', () => {
  it('語音轉文字：不足一分鐘算一分鐘，每分鐘 US$0.006（比 gpt-4o-mini-transcribe 的 0.003 貴一倍）', () => {
    expect(TRANSCRIBE_MICRO_PER_MINUTE).toBe(6000);
    expect(estimateTranscribe({ bytes: 1000, clientSeconds: 1 })).toMatchObject({ billedMinutes: 1, microUsd: 6000 });
    expect(estimateTranscribe({ bytes: 1000, clientSeconds: 60 })).toMatchObject({ billedMinutes: 1, microUsd: 6000 });
    expect(estimateTranscribe({ bytes: 1000, clientSeconds: 61 })).toMatchObject({ billedMinutes: 2, microUsd: 12000 });
    expect(estimateTranscribe({ bytes: 1000, clientSeconds: 600 })).toMatchObject({ billedMinutes: 10, microUsd: 60000 });
  });
  it('前端秒數不可信：取「回報秒數」與「依大小反推的最短秒數」較大者，所以謊報短秒數也不會少算', () => {
    // 3.2MB 的音檔至少 1600 秒（每秒最多 2KB，約 16kbps）
    const e = estimateTranscribe({ bytes: 3_200_000, clientSeconds: 1 });
    expect(e.audioSeconds).toBe(1600);
    expect(e.billedMinutes).toBe(27);
    expect(estimateTranscribe({ bytes: 3_200_000, clientSeconds: null }).audioSeconds).toBe(1600);
    expect(estimateTranscribe({ bytes: 0, clientSeconds: undefined }).audioSeconds).toBe(1);
    expect(estimateTranscribe({ bytes: 100, clientSeconds: 12.2 }).audioSeconds).toBe(13);
  });
  it('單次上限：10MB 的音檔最多算 88 分鐘（16kbps 最低位元率假設），費用有上界', () => {
    const e = estimateTranscribe({ bytes: MAX_AUDIO_BYTES, clientSeconds: MAX_AUDIO_SECONDS });
    expect(e.billedMinutes).toBe(88);
    expect(e.microUsd).toBe(528000);
  });
  it('草稿整理：輸入以「固定提示加每字 2 token」估、輸出以上限 1500 token 估，無條件進位', () => {
    const e = estimateDraft({ transcriptChars: 100, model: 'gpt-4o-mini' });
    expect(e.inputTokens).toBe(1200 + 200);
    expect(e.outputTokens).toBe(DRAFT_MAX_OUTPUT_TOKENS);
    // 1400 * 0.15 + 1500 * 0.6 = 210 + 900 = 1110
    expect(e.microUsd).toBe(1110);
    // 小數一律進位
    const odd = estimateDraft({ transcriptChars: 1, model: 'gpt-4o-mini' });
    expect(odd.microUsd).toBe(Math.ceil((1200 + 2) * 0.15 + 1500 * 0.6));
    expect(Number.isInteger(odd.microUsd)).toBe(true);
  });
  it('沒列在價格表的模型一律用最貴價格估（保守）；費用隨字數遞增', () => {
    const unknown = estimateDraft({ transcriptChars: 500, model: 'some-future-model' });
    const known = estimateDraft({ transcriptChars: 500, model: 'gpt-4o-mini' });
    expect(CHAT_PRICE_UNKNOWN.input).toBeGreaterThanOrEqual(Math.max(...Object.values(CHAT_PRICE_PER_M).map((p) => p.input)));
    expect(unknown.microUsd).toBeGreaterThan(known.microUsd);
    expect(estimateDraft({ transcriptChars: 6000, model: 'gpt-4o-mini' }).microUsd).toBeGreaterThan(estimateDraft({ transcriptChars: 10, model: 'gpt-4o-mini' }).microUsd);
  });
  it('一個月 US$30 大約可以做幾十次最長錄音，不會被一次呼叫吃光', () => {
    const worst = estimateTranscribe({ bytes: MAX_AUDIO_BYTES, clientSeconds: MAX_AUDIO_SECONDS }).microUsd + estimateDraft({ transcriptChars: 6000, model: 'gpt-4o-mini' }).microUsd;
    expect(worst).toBeLessThan(toMicro(30) / 50);
  });
});

describe('M6-W33 月額度狀態：80% 提醒、100% 自動停用', () => {
  const cap = 30;
  it('未達 80%：正常、AI 可用', () => {
    const s = usageState(toMicro(23.99), cap);
    expect(s).toMatchObject({ level: 'ok', aiEnabled: true });
    expect(s.percent).toBe(80);
    // 百分比顯示四捨五入，但判斷用整數：23.99 < 24 仍是 ok
  });
  it('剛好 80%（24 美元）：warn，AI 仍可用', () => {
    expect(usageState(toMicro(24), cap)).toMatchObject({ level: 'warn', aiEnabled: true, percent: 80 });
    expect(usageState(toMicro(29.999999), cap)).toMatchObject({ level: 'warn', aiEnabled: true });
  });
  it('剛好 100%（30 美元）以上：capped，AI 自動停用，剩餘 0', () => {
    expect(usageState(toMicro(30), cap)).toMatchObject({ level: 'capped', aiEnabled: false, remainingMicro: 0, percent: 100 });
    expect(usageState(toMicro(31.2), cap)).toMatchObject({ level: 'capped', aiEnabled: false, remainingMicro: 0 });
  });
  it('上限 0 代表一開始就停用 AI；調高上限後立即恢復', () => {
    expect(usageState(0, 0)).toMatchObject({ level: 'capped', aiEnabled: false, percent: 100 });
    expect(usageState(toMicro(30), 40)).toMatchObject({ level: 'ok', aiEnabled: true });
    expect(usageState(toMicro(30), 35)).toMatchObject({ level: 'warn', aiEnabled: true });
  });
  it('累計不會是負的；小數累計會被整數化', () => {
    expect(usageState(-5, cap).spentMicro).toBe(0);
    expect(usageState(10.4, cap).spentMicro).toBe(10);
  });
  it('剩餘額度與上限的關係', () => {
    const s = usageState(toMicro(10), cap);
    expect(s.remainingMicro).toBe(toMicro(20));
    expect(s.capMicro).toBe(toMicro(30));
  });
});

describe('M6-W33 通知：第一次跨過 80%／100% 才通知（只通知系統管理員）', () => {
  it('從 ok 到 warn：只有 80% 通知', () => {
    expect(crossedLevels(toMicro(10), toMicro(25), 30)).toEqual(['warn80']);
  });
  it('已在 warn 再增加：不重複通知', () => {
    expect(crossedLevels(toMicro(25), toMicro(26), 30)).toEqual([]);
  });
  it('warn 到 capped：只有 100% 通知', () => {
    expect(crossedLevels(toMicro(29), toMicro(30.01), 30)).toEqual(['cap100']);
  });
  it('一次從 ok 跳到 capped：兩個通知都有', () => {
    expect(crossedLevels(toMicro(1), toMicro(31), 30)).toEqual(['warn80', 'cap100']);
  });
  it('已 capped：沒有新通知；上限 0 時只算 100%', () => {
    expect(crossedLevels(toMicro(31), toMicro(32), 30)).toEqual([]);
    expect(crossedLevels(0, 0, 0)).toEqual([]);
  });
});

describe('M6-W33 每月 1 日（台北時間）歸零：以台北月份鍵分開累計', () => {
  it('台北時間的月份鍵（UTC 與台北差 8 小時）', () => {
    expect(taipeiMonthKey(new Date('2038-01-15T04:00:00Z'))).toBe('2038-01');
    // 2038-01-31 16:00 UTC = 台北 2038-02-01 00:00：新的一個月
    expect(taipeiMonthKey(new Date('2038-01-31T15:59:59Z'))).toBe('2038-01');
    expect(taipeiMonthKey(new Date('2038-01-31T16:00:00Z'))).toBe('2038-02');
    expect(taipeiMonthKey(new Date('2038-02-28T16:00:00Z'))).toBe('2038-03');
  });
  it('跨年：12 月底台北已進入隔年 1 月', () => {
    expect(taipeiMonthKey(new Date('2037-12-31T15:59:59Z'))).toBe('2037-12');
    expect(taipeiMonthKey(new Date('2037-12-31T16:00:00Z'))).toBe('2038-01');
  });
  it('1 日零點一到，上個月的累計不再算進本月（用月份鍵分組模擬帳本）', () => {
    const ledger = [
      { month: taipeiMonthKey(new Date('2038-01-20T00:00:00Z')), micro: toMicro(29) },
      { month: taipeiMonthKey(new Date('2038-01-31T15:00:00Z')), micro: toMicro(0.5) },
    ];
    const spentIn = (now: Date) => ledger.filter((r) => r.month === taipeiMonthKey(now)).reduce((s, r) => s + r.micro, 0);
    const before = spentIn(new Date('2038-01-31T15:59:00Z'));
    expect(usageState(before, 30).level).toBe('warn');
    const after = spentIn(new Date('2038-01-31T16:00:00Z'));
    expect(after).toBe(0);
    expect(usageState(after, 30)).toMatchObject({ level: 'ok', aiEnabled: true, spentMicro: 0 });
  });
  it('2 月、閏年、30 天的月份都能正確換月', () => {
    expect(taipeiMonthKey(new Date('2040-02-29T15:59:59Z'))).toBe('2040-02');
    expect(taipeiMonthKey(new Date('2040-02-29T16:00:00Z'))).toBe('2040-03');
    expect(taipeiMonthKey(new Date('2038-04-30T16:00:00Z'))).toBe('2038-05');
  });
});

describe('M6-W33 系統管理員調整上限：0 到 10000 美元、小數最多 2 位', () => {
  it('接受數字與數字字串', () => {
    expect(parseCap(30)).toBe(30);
    expect(parseCap('45.5')).toBe(45.5);
    expect(parseCap(0)).toBe(0);
    expect(parseCap('0.01')).toBe(0.01);
    expect(parseCap(10000)).toBe(10000);
  });
  it('拒絕空白、非數字、負數、超過上限、超過兩位小數', () => {
    for (const bad of [undefined, null, '', '   ', 'abc', NaN, Infinity, -1, '-0.5', 10000.01, 3.456, '1.234']) expect(() => parseCap(bad), String(bad)).toThrow();
  });
});

describe('M6-W33 E7 音檔限制：約 10 分鐘或 10MB、格式 WebM／MP3／M4A／WAV', () => {
  const ok = { size: 1000, type: 'audio/webm', durationSeconds: 30 };
  it('正常音檔通過；codecs 參數不影響格式判斷', () => {
    expect(validateAudio(ok)).toBeNull();
    expect(validateAudio({ ...ok, type: 'audio/webm;codecs=opus' })).toBeNull();
    for (const type of ['audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/m4a', 'audio/x-m4a']) expect(validateAudio({ ...ok, type }), type).toBeNull();
    expect(validateAudio({ ...ok, type: '' })).toBeNull();
  });
  it('空檔、超過 10MB 被拒；剛好 10MB 通過', () => {
    expect(validateAudio({ ...ok, size: 0 })).toContain('不可為空');
    expect(validateAudio({ ...ok, size: MAX_AUDIO_BYTES })).toBeNull();
    expect(validateAudio({ ...ok, size: MAX_AUDIO_BYTES + 1 })).toContain('10MB');
  });
  it('超過 10 分鐘被拒；容許幾秒計時誤差', () => {
    expect(validateAudio({ ...ok, durationSeconds: MAX_AUDIO_SECONDS })).toBeNull();
    expect(validateAudio({ ...ok, durationSeconds: MAX_AUDIO_SECONDS + AUDIO_SECONDS_TOLERANCE })).toBeNull();
    expect(validateAudio({ ...ok, durationSeconds: MAX_AUDIO_SECONDS + AUDIO_SECONDS_TOLERANCE + 1 })).toContain('10 分鐘');
    expect(validateAudio({ ...ok, durationSeconds: null })).toBeNull();
    expect(validateAudio({ ...ok, durationSeconds: undefined })).toBeNull();
  });
  it('不支援的格式被拒', () => {
    for (const type of ['audio/ogg', 'video/mp4', 'application/octet-stream', 'text/plain']) expect(validateAudio({ ...ok, type }), type).toContain('不支援');
  });
});
