import { devEnv, setupTestRole } from './support';

// 啟動前：確認是 DEV，建立暫時測試角色（含 inspection.gps_exempt）並指派給 allowed 帳號。
export default async function globalSetup() {
  devEnv();
  await setupTestRole();
}
