export const movementErrors:Record<string,string>={
   WORKSPACE_STALE:'資料已在查核後變更，請返回重新查核。',WORKSPACE_DUPLICATE:'已有相同異動紀錄，請返回核對。',WORKSPACE_REQUEST_REUSED:'提交識別碼與內容不符，請重新查核。',
   WORKSPACE_EMPLOYEE_CHANGED:'員工姓名或任職門市已不符，請核對主檔。',WORKSPACE_EMPLOYEE:'找不到唯一的任職主檔，請核對員編與門市。',WORKSPACE_OTHER_STORE:'員工仍在其他門市任職，請使用調店異動。',
   WORKSPACE_STORE_CHANGED:'任職門市已停用或不存在。',WORKSPACE_ORGANIZATION:'請重新選擇有效的總部最下層組織。',WORKSPACE_ORG_PROFILE:'總部入職需要同員編的使用者帳號，請先建立或核對使用者。',
   WORKSPACE_LATER_MOVEMENT:'此調店日期之後已有異動，請先核對歷程。',WORKSPACE_MONTH_LOCKED:'受影響的月資料已送審或確認，請先依權限解除鎖定。',WORKSPACE_MONTH_DUPLICATE:'受影響月份有重複員工資料，請先核對。',WORKSPACE_INVALID:'異動欄位不正確，請重新查核。',WORKSPACE_CONFLICT:'資料已變更，請重新查核。',
  };
