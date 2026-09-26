# 總務服務中心正式區發布

## 發布原則

- 新版總務服務中心以 `ga_*` 資料表及新版權限為主。
- 不匯入、不映射、不回填正式區「跨部門管理／總務組」既有單據。
- 維修流程雖共用 `maintenance_requests` 工作流資料表，但新版頁面只讀取 `ga_service_request_id IS NOT NULL` 的工單。
- 舊跨部門頁面維持原查詢與歷史資料，不受新版來源篩選影響。
- 正式發布只套用 schema、RLS、函式、權限代碼及必要參照資料，不搬移測試區業務資料。

## 發布順序

1. 備份正式區資料庫並記錄目前 migration 清單。
2. 對正式區執行 migration dry-run，確認只有尚未套用的 forward migrations。
3. 執行 `npm run test:general-affairs-production-isolation`。
4. 執行總務模組測試與 `npm run build`。
5. 套用正式區資料庫 migrations，重新載入 PostgREST schema cache。
6. 部署同一版應用程式到正式 Vercel 環境。
7. 以管理者、總務、店長三種身分執行驗收。

## 驗收重點

- 新增需求會產生 `ga_service_requests`，單號可正常顯示。
- 維修需求受理為派工後，產生的 `maintenance_requests.ga_service_request_id` 不為空。
- 新版工單中心看不到正式區既有跨部門總務單。
- 舊跨部門管理仍能查看原有歷史單據。
- 店長只看得到自己門市需求；總務可依權限受理及處理。
- 料件、設備、設施、庫存、調撥、採購、廠商、水電網路費與附件功能可正常使用。

## 回復方式

若正式驗收失敗，先回復前一版應用程式部署。資料庫採 forward migration 修正，不刪除正式資料、不執行破壞性 rollback。
