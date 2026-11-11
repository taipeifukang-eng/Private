// 總務側欄的資料型別（無相依，Vue 端可直接引用；實際計算在 nav.ts，只在伺服端執行）。
import type { WorkTabKind } from "../page-kinds";

export type GaNavItem = {
  id: string;
  label: string;
  /** 舊版網址（尚未移植的頁面以舊頁另開）。 */
  href?: string;
  /** 已移植到新版的頁面 kind。 */
  kind?: WorkTabKind;
  /** 同一個頁面 kind 的不同檢視（例如庫存總覽與庫存流水共用 ga-inventory，以 payload.view 區分）。 */
  payload?: Record<string, string>;
  /** 尚未開放的項目（舊版顯示為「規劃中」），不可點。 */
  disabled?: string;
  children?: GaNavItem[];
};
export type GaNavGroup = { id: string; label?: string; items: GaNavItem[] };
