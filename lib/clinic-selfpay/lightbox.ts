// 截圖檢視器的互動規則（M6 W31）：縮放範圍、滑動判斷、鍵盤動作。純函式，元件與單元測試共用。
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.5;
export const SWIPE_MIN_PX = 50;

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
export const clampIndex = (i: number, count: number): number => (count <= 0 ? 0 : Math.min(count - 1, Math.max(0, i)));

/** 水平滑動才換張：位移夠長、而且橫向比縱向明顯（避免捲動頁面被誤判）。向左滑 = 下一張。 */
export function swipeDirection(dx: number, dy: number, min: number = SWIPE_MIN_PX): 'next' | 'prev' | null {
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'prev';
}

export type LightboxAction = 'close' | 'next' | 'prev' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'first' | 'last' | null;
export function keyAction(key: string): LightboxAction {
  switch (key) {
    case 'Escape': return 'close';
    case 'ArrowRight': return 'next';
    case 'ArrowLeft': return 'prev';
    case '+': case '=': return 'zoom-in';
    case '-': case '_': return 'zoom-out';
    case '0': return 'zoom-reset';
    case 'Home': return 'first';
    case 'End': return 'last';
    default: return null;
  }
}
