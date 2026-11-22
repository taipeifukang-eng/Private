// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThresholdRefreshGate, notifyThresholdsSaved, onThresholdsSaved, THRESHOLDS_CHANNEL, THRESHOLDS_STORAGE_KEY } from '../../../vue-workspace/src/performance-sync';

// W03-q4：閾值儲存後通知已開啟的年度頁。以假的 BroadcastChannel 模擬同一瀏覽器內的不同分頁。

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(public name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) {
      if (c !== this && !c.closed && c.name === this.name) c.onmessage?.({ data: JSON.parse(JSON.stringify(data)) });
    }
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  FakeChannel.all = [];
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('閾值儲存通知', () => {
  it('同一頁內的訂閱者收到門市 id，且只收一次（本頁回呼加 BroadcastChannel 去重）', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const got: string[] = [];
    const off = onThresholdsSaved((id) => got.push(id));
    notifyThresholdsSaved('store-1');
    expect(got).toEqual(['store-1']);
    off();
    notifyThresholdsSaved('store-1');
    expect(got).toEqual(['store-1']);
  });

  it('另一個分頁（另一個 channel）收到，同一個 nonce 不重複處理', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const got: string[] = [];
    const off = onThresholdsSaved((id) => got.push(id));
    new FakeChannel(THRESHOLDS_CHANNEL).postMessage({ nonce: 'other-tab-1', storeId: 'store-9' });
    expect(got).toEqual(['store-9']);
    new FakeChannel(THRESHOLDS_CHANNEL).postMessage({ nonce: 'other-tab-1', storeId: 'store-9' });
    expect(got).toEqual(['store-9']);
    off();
  });

  it('同一頁兩個訂閱者（不同門市），另一個 channel 的通知兩者都收到；本頁自己送出的不重複', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const a: string[] = [];
    const b: string[] = [];
    const offA = onThresholdsSaved((id) => { if (id === 'store-A') a.push(id); });
    const offB = onThresholdsSaved((id) => { if (id === 'store-B') b.push(id); });
    new FakeChannel(THRESHOLDS_CHANNEL).postMessage({ nonce: 'multi-1', storeId: 'store-B' });
    new FakeChannel(THRESHOLDS_CHANNEL).postMessage({ nonce: 'multi-2', storeId: 'store-A' });
    expect(a).toEqual(['store-A']);
    expect(b).toEqual(['store-B']);
    const all: string[] = [];
    const offC = onThresholdsSaved((id) => all.push(id));
    notifyThresholdsSaved('store-X');
    expect(all).toEqual(['store-X']);
    offA(); offB(); offC();
  });

  it('沒有 BroadcastChannel 時由 storage 事件接手', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const got: string[] = [];
    const off = onThresholdsSaved((id) => got.push(id));
    const value = JSON.stringify({ nonce: 'n-1', storeId: 'store-2' });
    window.dispatchEvent(new StorageEvent('storage', { key: THRESHOLDS_STORAGE_KEY, newValue: value }));
    expect(got).toEqual(['store-2']);
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: value }));
    expect(got).toEqual(['store-2']);
    off();
  });

  it('格式不正確的訊息忽略；通知內容只含 nonce 與門市 id', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const got: string[] = [];
    const off = onThresholdsSaved((id) => got.push(id));
    new FakeChannel(THRESHOLDS_CHANNEL).postMessage({ storeId: 1 });
    new FakeChannel(THRESHOLDS_CHANNEL).postMessage('not json {');
    expect(got).toEqual([]);
    notifyThresholdsSaved('s-3');
    const stored = JSON.parse(localStorage.getItem(THRESHOLDS_STORAGE_KEY) || '{}');
    expect(Object.keys(stored).sort()).toEqual(['nonce', 'storeId']);
    off();
  });
});

describe('閾值通知的載入中競態', () => {
  function setup() {
    let store = 's1';
    const refresh = vi.fn(async () => {});
    const gate = createThresholdRefreshGate({ currentStore: () => store, refresh });
    return { gate, refresh, setStore: (s: string) => (store = s) };
  }
  it('載入中收到通知：不立即重載，載入結束後補重載一次', async () => {
    const { gate, refresh } = setup();
    let release!: () => void;
    const job = gate.track(() => new Promise<void>((r) => (release = r)));
    await gate.notify('s1');
    await gate.notify('s1');
    expect(refresh).not.toHaveBeenCalled();
    expect(gate.isPending()).toBe(true);
    release();
    await job;
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(gate.isPending()).toBe(false);
  });
  it('非載入中收到通知：立即重載；其他門市的通知略過', async () => {
    const { gate, refresh } = setup();
    await gate.notify('other');
    expect(refresh).not.toHaveBeenCalled();
    await gate.notify('s1');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('載入中收到通知但載入完成後門市已變：不補重載', async () => {
    const { gate, refresh, setStore } = setup();
    let release!: () => void;
    const job = gate.track(() => new Promise<void>((r) => (release = r)));
    await gate.notify('s1');
    setStore('s2');
    release();
    await job;
    expect(refresh).not.toHaveBeenCalled();
  });
});
