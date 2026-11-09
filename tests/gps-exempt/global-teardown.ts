import { deleteRegistered, leftoverCount, roleLeftoverCount, teardownTestRole } from './support';

// 結束後：只依 id 刪除本次建立的巡店，移除測試角色，並印出殘留數（應全為 0）。
export default async function globalTeardown() {
  await deleteRegistered();
  await teardownTestRole();
  const left = await leftoverCount();
  const roles = await roleLeftoverCount();
  console.log(`[gps-exempt] DEV 殘留檢查：巡店 byId=${left.byId} byMarker=${left.byMarker}，測試角色=${roles}`);
  if (left.byId || left.byMarker || roles) throw new Error('DEV 仍有測試資料殘留');
}
