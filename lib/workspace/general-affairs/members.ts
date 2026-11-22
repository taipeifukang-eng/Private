// 店長名單身分（store_managers，任何 role_type）：資料庫端資產讀取（RLS）與貼標待辦用的「門市負責人」判斷。
// 導覽旗標原本只認角色代碼 store_manager；測試與少數正式帳號的角色代碼不同但在名單內，所以設備與貼標入口另外認名單身分。
import { adminClient, type Context } from "../server";
import { GA, isStoreManagerRole } from "./access";

/** 已經因為角色或權限能進設備／貼標頁的人不需要再查名單（省一次查詢）。 */
export async function isStoreMember(ctx: Context): Promise<boolean> {
  if (isStoreManagerRole(ctx.roleCodes)) return true;
  if (ctx.has(GA.equipmentView, GA.equipmentManage, GA.facilityView, GA.facilityManage)) return false;
  const { data, error } = await (adminClient() as any).from("store_managers").select("id").eq("user_id", ctx.user.id).limit(1);
  return !error && (data || []).length > 0;
}

/** 登入者是否在門市名單（store_managers）上，任何身分都算（C12：庫存唯讀入口）。每次都查，不因角色或權限略過。 */
export async function isRosterMember(ctx: Context): Promise<boolean> {
  const { data, error } = await (adminClient() as any).from("store_managers").select("id").eq("user_id", ctx.user.id).limit(1);
  return !error && (data || []).length > 0;
}
