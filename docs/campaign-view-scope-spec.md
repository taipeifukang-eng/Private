# 活動專案查看權限調整：最終規格

使用者於 2026-11-03 透過問卷與追問確認。影響盤點原始資料：同目錄 `campaign-impact.json`。

## 目標

「活動管理／活動專案」的查看權限只保留兩種：

| 權限碼 | 權限頁顯示 | 說明文字 |
|---|---|---|
| `activity.campaign.view_own` | 查看自己 | 查看被任命門市的活動（督導可看全部門市的活動檢視） |
| `activity.campaign.view_all` | 查看全部 | 查看所有活動與所有門市資料 |

舊的 `activity.campaign.view`（查看）淘汰。其他模組的 `view_own` 命名**不動**。只改活動專案的 permissions 列 name、description，不改共用的 `ACTION_NAMES`。

## 可見性規則（舊版 main 與新版 Vue 一致）

1. **權限閘門**：要讀任何活動資料，必須有 `view_own` 或 `view_all`。第一階段期間，舊的 `view` 視同 `view_own`。
2. **發布閘門（publish_gate = keep_and）**：沒有 `view_all` 的人，只看得到已發布給其身分的活動（`published_to_store_managers`、`published_to_supervisors`、`published_to_inventory_team`），而且要同時有 `view_own`。
3. **身分判斷（supervisor_scope = store_managers_all）**：一律以 `store_managers` 為準，不再看 `profiles.job_title`。
   - 有任一 `role_type='supervisor'` 任命，就是督導。
   - 有 `role_type='store_manager'` 任命，就是店長；雙店長看兩間。
4. **範圍**：
   - **店長（view_own）**：活動檢視的所有分頁只看被任命門市。分頁包括活動明細、排程、門市明細、人力、自有人員、檢核完成、設備車次、支援需求。
   - **督導（view_own）**：使用者追問後確認，活動檢視內**全部分頁都看全部門市**，與目前行為相同。「督導只看管理門市」只適用活動檢視以外的功能，例如每月人員狀態，這些不在本次範圍。
   - **view_all**：全部。
5. **部門身分（dept_roles = need_view_all）**：營業主管（營業部經理／主管）、盤點組、行銷部、營業部助理，不再因部門或職稱自動看全部。要看全部必須有 `view_all`。
   - 刪除 `lib/campaign-access.ts` 中 isBusinessManager、isInventoryTeam、isMarketingWithAccess、isBusinessAssistant 自動放行的邏輯。
   - 盤點組的發布閘門（`published_to_inventory_team`）怎麼對應：持 `view_own` 的盤點組角色仍可看發布給盤點組的活動，範圍為全部門市，視同部門受眾。這點由實作者在報告中說明並列入測試。
6. **有編輯權者（editors_scope = keep_edit_all）**：持有 `activity.store_detail.edit`、`activity.checklist.edit`、`activity.equipment_trip.edit` 等編輯權，在對應資料上維持看全部，不受 `view_own` 範圍限制。
7. **活動檢視入口**：有 `view_own` 或 `view_all` 就顯示並可進入 `/activity-management`。
   - 舊版：每月人員狀態頁的「活動檢視」按鈕改為 `view_own` 或 `view_all`，不再看 `activity.management.access`。Navbar 也加入口。
   - 新版：導覽、session capabilities、monthly tools 入口同步改。
   - `activity.management.access` 若仍被其他功能使用（例如行銷部判斷），保留原用途，在報告中列出。

## 一併補上的既有缺口（gaps = now）

以下 API 目前只檢查登入，要補上權限與門市範圍檢查。**店長、督導現有的正當操作不能壞掉**：先查前端實際呼叫者與角色，再決定要求的權限。寫入規則：持對應 edit 權限者可寫全部；否則需有 `view_own` 且該門市是本人任命門市，督導依第 4 點。

- `/api/campaigns` GET：需 `view_own`、`view_all`、`activity.manage` 或 `activity.campaign.edit`。
- `/api/campaigns/publish` PATCH：需 `activity.manage` 或 `activity.campaign.edit`。
- 以下寫入：`campaign-store-headcount` POST、`campaign-store-own-staff` POST／DELETE、`campaign-checklist-completions` POST、`campaign-support-requests` 與 `campaign-support-staff` 的讀寫。
- 活動明細頁會呼叫 `campaign-department-publish` GET 與設備車次。只有 `view_own` 的人不得因此整頁報錯：開放唯讀，或前端容錯隱藏該區塊。

## 資料庫

新增 `supabase/migrations/<timestamp>_campaign_view_scope.sql`，冪等：

1. 若 `view_own` 不存在就建立，已存在就更新 name、description、is_active=true。`view_all` 的 name 改為「查看全部」。
2. **遷移（migrate_old_view = all_own）**：所有持有 `view` 的角色補上 `view_own`。已有 `view_all` 的角色不必補。
3. RLS：`campaigns`、`event_dates`、`campaign_checklist_items` 的讀取 policy 加入 `view_own`，第一階段保留 `view`。門市子表的 policy 依第 4 點檢查：督導看全部、店長依 `store_managers`。
4. 附一個唯讀的 `pre_check` SQL（另存檔，給使用者在正式區先跑），列出以下兩項，不自動授權：
   - 哪些角色持有 view、view_own、view_all。
   - 哪些使用者目前靠部門身分看活動、而角色沒有 `view_all`（改後會看不到）。
5. 附 rollback SQL。

## 上線（rollout = two_phase）

- **第一階段（本次）**：程式與 migration 上線，`view` 仍視同 `view_own`，權限頁的 `view` 標示為「（舊）查看，將停用」。
- **第二階段（另開任務，穩定後）**：`view` 設 is_active=false，從程式與 RLS 移除。

## 施作分支

- **舊版（正式區）**：在獨立 worktree，從 origin/main 開 `feature/campaign-view-scope`，不碰主工作目錄。主目錄有 M1 流程在跑。
- **新版 Vue**：M1 完成後再移植到 `feature/vue-parity`，此階段不做。

## 驗收

- DEV 套用 migration，用 DEV 測試帳號以舊版站實測，舊版站在 worktree 啟動於 3012 port。測試帳號包括：單店店長、雙店長、督導（有 supervisor 任命）、只有部門身分無 `view_all`、`view_all`、只有 edit 權、無權限。
  - 逐支 API 與頁面驗證可見性矩陣。
  - 補洞的寫入 API 驗證：該擋的擋、店長和督導的正當操作仍成功。
- `npx tsc --noEmit`、既有 `scripts/test-*` 中與活動或 RBAC 相關且不需 Production 的測試要通過。
- 不 push。主迴圈審閱後經使用者同意才部署。
