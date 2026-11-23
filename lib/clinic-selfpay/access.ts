// 診所自費藥毛利：誰能用什麼（D1：選單可見性 = 實際能用的規則，看得到就一定能用）。
// 規則逐字沿用舊版 app/api/clinic-selfpay/_lib.ts：專屬權限碼，或職稱符合。純函式，不碰資料庫。

export type ClinicSelfpayAccess = {
  canUseCalculator: boolean;
  canManageMapping: boolean;
  canDeleteBatch: boolean;
};

export const CLINIC_PERM = {
  margin: 'store.clinic_selfpay.margin',
  calculator: 'store.clinic_selfpay.calculator.use',
  mapping: 'store.clinic_selfpay.mapping.manage',
  batchDelete: 'store.clinic_selfpay.batch.delete',
} as const;

export function isStoreScopedJobTitle(jobTitle: string | null | undefined) {
  const title = String(jobTitle || '').trim();
  return ['店長', '代理店長', '督導', '督導(代理店長)'].includes(title);
}

export function isManagerJobTitle(jobTitle: string | null | undefined) {
  const title = String(jobTitle || '').trim();
  return ['經理', '副理', '區經理', '營業經理', '區域經理', '門市經理'].some((k) => title.includes(k));
}

export type PermissionInput = Iterable<string> | ((...codes: string[]) => boolean);

/**
 * permissions 可以是權限碼集合，或「任一碼成立」的判斷函式（例如工作台 context 的 ctx.has，已含管理員後備）。
 * 傳集合時不做管理員後備（呼叫端自行處理）。
 */
export function resolveAccess(permissions: PermissionInput, jobTitle: string | null | undefined): ClinicSelfpayAccess {
  let any: (...codes: string[]) => boolean;
  if (typeof permissions === 'function') {
    any = permissions;
  } else {
    const set = new Set(permissions);
    any = (...codes) => codes.some((c) => set.has(c));
  }
  const isStoreTitle = isStoreScopedJobTitle(jobTitle);
  const isManagerTitle = isManagerJobTitle(jobTitle);
  return {
    canUseCalculator: any(CLINIC_PERM.margin, CLINIC_PERM.calculator) || isStoreTitle || isManagerTitle,
    canManageMapping: any(CLINIC_PERM.margin, CLINIC_PERM.mapping) || isManagerTitle,
    canDeleteBatch: any(CLINIC_PERM.batchDelete) || isManagerTitle,
  };
}

/** D1：選單可見 = 能用計算器，或能管理主檔（看得到就一定能用其中一個分頁）。 */
export function canSeeClinicSelfpayMenu(access: ClinicSelfpayAccess): boolean {
  return access.canUseCalculator || access.canManageMapping;
}

/** 舊版 getAuthorizedStores 的分流：profiles.role==='admin' 且職稱不是門市型 -> 全部啟用門市；其餘看 store_managers。 */
export function seesAllStores(profileRole: string | null | undefined, jobTitle: string | null | undefined): boolean {
  return profileRole === 'admin' && !isStoreScopedJobTitle(jobTitle);
}
