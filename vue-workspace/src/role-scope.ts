// 權限頁的「資料查看範圍」規則（對應舊版 RoleEditClient.tsx 的 isExclusiveViewScope／getBasicViewPermissionIds／
// getPermissionActionLabel）。抽成純函式方便單元測試。
import { ACTION_NAMES } from "../../types/rbac";

export interface ScopePermission {
  code: string;
  action?: string;
  description?: string;
  granted?: boolean;
}

export const SCOPE_ORDER = ["view_own_store", "view_own", "view", "view_all"];
const codeAction = (p: ScopePermission) => p.code.split(".").at(-1);

/** 是否為互斥的「資料查看範圍」。活動專案舊 view 第一階段與 view_own 並存（視同 view_own），不計入；第二階段停用後移除此特判。 */
export function isScopePermission(p: ScopePermission): boolean {
  if (p.code === "activity.campaign.view") return false;
  return ["view", "view_own", "view_own_store", "view_all"].includes(codeAction(p) || "");
}

/**
 * 快速預設與標題使用的範圍權限。活動專案要反映目前實際勾選的範圍
 * （只有 view_all 或只有舊 view 時，不能一律顯示／套用「查看自己管理門市」）。
 */
export function preferredScopePermission<T extends ScopePermission>(feature: T[]): T | undefined {
  const granted = feature.some((p) => p.code.startsWith("activity.campaign."))
    ? SCOPE_ORDER.map((a) =>
        feature.find((p) => p.granted && p.code.startsWith("activity.campaign.") && codeAction(p) === a),
      ).find(Boolean)
    : undefined;
  return granted ?? SCOPE_ORDER.map((a) => feature.find((p) => isScopePermission(p) && codeAction(p) === a)).find(Boolean);
}

/** 權限顯示名稱（只對 monthly.status.view_own 與活動專案特判，不改共用的 ACTION_NAMES）。 */
export function permissionLabel(p: ScopePermission): string {
  if (p.code === "monthly.status.view_own") return "查看管理門市";
  if (p.code === "activity.campaign.view") return "（舊）查看，將停用";
  if (p.code === "activity.campaign.view_own") return "查看自己管理門市";
  return (p.action && (ACTION_NAMES as Record<string, string>)[p.action]) || p.description || p.action || "";
}
