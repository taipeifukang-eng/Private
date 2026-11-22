// W03-q4：獎金閾值儲存後，通知已開啟的年度頁自動重新載入。
// 同一個瀏覽器內三種管道都送：本頁面內直接回呼、BroadcastChannel（含同頁其他物件）、
// localStorage 的 storage 事件（其他分頁；不支援 BroadcastChannel 的瀏覽器的備援）。
// 以 nonce 去重，同一則通知只會處理一次。只傳門市 id，不傳金額或任何個資。

export const THRESHOLDS_CHANNEL = "workspace-performance-thresholds";
export const THRESHOLDS_STORAGE_KEY = "workspace:performance-thresholds-saved";

type Handler = (storeId: string) => void;
const local = new Set<Handler>();
// 本頁自己送出的 nonce（全域）：本頁訂閱者已由直接回呼處理，BroadcastChannel 回到同頁其他物件時要略過。
const sent: string[] = [];

function remember(list: string[], nonce: string) {
  if (list.includes(nonce)) return false;
  list.push(nonce);
  if (list.length > 50) list.shift();
  return true;
}

function parse(raw: unknown): { nonce: string; storeId: string } | null {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (v && typeof v.nonce === "string" && typeof v.storeId === "string")
      return { nonce: v.nonce, storeId: v.storeId };
  } catch {
    /* 格式不正確的訊息一律忽略 */
  }
  return null;
}

export function notifyThresholdsSaved(storeId: string) {
  const message = {
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    storeId,
  };
  remember(sent, message.nonce);
  Array.from(local).forEach((handler) => handler(storeId));
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(THRESHOLDS_CHANNEL);
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    /* 沒有 BroadcastChannel 時由 storage 事件接手 */
  }
  try {
    localStorage.setItem(THRESHOLDS_STORAGE_KEY, JSON.stringify(message));
  } catch {
    /* 私人視窗或被封鎖時略過 */
  }
}

/** 訂閱；回傳取消訂閱函式。 */
export function onThresholdsSaved(handler: Handler): () => void {
  local.add(handler);
  let channel: BroadcastChannel | null = null;
  // 去重表每個訂閱各自一份，避免同頁多個年度頁互相吃掉對方的通知。
  const seen: string[] = [];
  const receive = (raw: unknown) => {
    const m = parse(raw);
    if (!m || sent.includes(m.nonce)) return;
    if (remember(seen, m.nonce)) handler(m.storeId);
  };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(THRESHOLDS_CHANNEL);
      channel.onmessage = (e) => receive(e.data);
    }
  } catch {
    channel = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === THRESHOLDS_STORAGE_KEY && e.newValue) receive(e.newValue);
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    local.delete(handler);
    channel?.close();
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/**
 * 載入中收到閾值通知時不丟棄：記下「待重新載入」，等進行中的作業結束後再補跑一次。
 * track() 包住所有會讀取閾值的非同步載入；notify() 為收到通知時呼叫。
 */
export function createThresholdRefreshGate(opts: {
  currentStore: () => string;
  refresh: () => Promise<void>;
}) {
  let busy = 0;
  let pending: string | null = null;
  async function track<T>(job: () => Promise<T>): Promise<T> {
    busy++;
    try {
      return await job();
    } finally {
      busy--;
      if (busy === 0 && pending !== null) {
        const storeId = pending;
        pending = null;
        if (storeId === opts.currentStore()) void opts.refresh();
      }
    }
  }
  async function notify(storeId: string) {
    if (storeId !== opts.currentStore()) return;
    if (busy > 0) {
      pending = storeId;
      return;
    }
    await opts.refresh();
  }
  return { track, notify, isPending: () => pending !== null };
}
