# M7/M8 第 6 批設計（定稿，2026-11-17，使用者 V1–V10 全採建議）：G20 服務分類與區域、G21 廠商資料、G22 廠商績效與採購分析、G23 水電網費、G24 總務首頁

## 1. 舊版功能清單與缺陷

### 1.1 舊版檔案與路徑
- 廠商、分類、區域、廠商統計、採購分析五頁全在 `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`（5 個薄頁面 `app/general-affairs/vendors/page.tsx` 與 `vendors/categories`、`vendors/regions`、`vendors/stats`、`vendors/purchases` 只帶 initialView；該檔 6030 行，廠商與分類區域讀寫在第 1165–1167、1267、1298–1319 行）；沒有專屬 API，瀏覽器 supabase client 直連 `ga_vendors`／`ga_service_categories`／`ga_service_regions`，權限全靠 RLS。採購分析走 `app/api/general-affairs/purchase-reviews/cost-summary/route.ts`。列印用 `components/general-affairs/vendors/VendorInformationPrintForm.tsx`。
- 水電網費：`app/general-affairs/utility-bills`（帳單）與 `utility-bills/report`（報表）、`components/general-affairs/expenses/UtilityBills*Client.tsx`、`app/api/general-affairs/utility-bills/**`、附件共用 `/api/general-affairs/attachments`。
- 總務首頁：`components/general-affairs/dashboard/GeneralAffairsDashboardClient.tsx`、`GeneralAffairsHomeClient.tsx`；導覽 `components/general-affairs/navigation.tsx`、`hooks/useNavbarPermissions.ts`。
- 新版現況：`vue-workspace`、`app/api/workspace/general-affairs/**`、`lib/workspace/**` 對本批全是空白。僅有三處接點：第 4 批採購單讀廠商（`ga_ws_po_vendor_options`、`ga_po_check_vendor`、「去舊版新增供應商」連結）、第 5 批工單已接受 `vendor_id` 但無下拉、附件 API 已支援 `UTILITY_BILL`。`vue-workspace/src/pages/ga/GaCenter.vue` 只有 47 行入口卡片，`lib/workspace/general-affairs/nav-types.ts` 的 `GaNavItem` 沒有 badge 欄位，`lib/workspace/general-affairs/nav.ts` 的 `GA_PAGE_BY_HREF` 沒有 vendors／utility-bills。另有第四處接點：第 4 批需求單採購評估頁（`lib/workspace/general-affairs/requests.ts` 第 400–401 行）以使用者身分直接讀 `ga_vendors`（見 §3.1 收緊的連鎖點）。

### 1.2 舊版功能（新版要對等或改良）
| 功能 | 舊版行為摘要 |
|---|---|
| 廠商列表 | 全表載入無分頁；統計卡（合作中／暫停／停用／總數）；搜尋名稱、別名、聯絡人、電話、email、tags；篩選狀態、分類、區域；右側唯讀詳情；列尾「操作」鈕無事件 |
| 新增廠商五步驟 | 基本、服務（分類多選、區域樹多選含祖先、品牌、設備、服務能力、tags）、聯絡、合作與帳務、附件；「暫存」與「完成新增」其實同一個 insert；任何錯誤一律「此功能尚未在目前測試環境開放」 |
| 服務分類 | 統計卡；新增與編輯（唯一有 update）；代碼轉大寫且 UNIQUE；上層、icon、排序、常用項目；沒有刪除；預置分類來自 repo 根目錄 `supabase/migration_general_affairs_vendor_management.sql`（4 個）與 `migration_general_affairs_vendor_top_categories.sql`（頂層分類），皆不在 `supabase/migrations/`，不一定已套用 |
| 服務區域 | 區域樹；只新增不編輯；類型 country／region／city／district；狀態含 archived；縣市行政區預設資料在 `supabase/migration_general_affairs_taiwan_admin_regions.sql`（不在 migrations，DEV 未套） |
| 廠商統計（合作記錄） | 六張卡、績效排名（前 5）、分類與區域統計（各前 6），全讀 `ga_vendors` 靜態欄位 |
| 採購分析 | 讀 `ga_purchase_reviews`（PURCHASE）月份彙總，前 5 廠商與門市 |
| 廠商填寫表列印 | 空白紙本表單，含啟用分類與縣市勾選 |
| 水電帳單 | 列表（月、類型、據點篩選，預設當月，上限 500）、三張摘要、新增、標記已繳、軟刪除、附件；唯一規則 `uq_ga_utility_bills_identity` |
| 水電報表 | 月／季／年按據點加總四類費用，啟用門市沒帳單也列 0；無匯出、無列印 |
| 總務首頁 | 庫存 KPI、負庫存與低庫存提醒、我的待辦（只列等門市）、功能入口卡 |

### 1.3 舊版缺陷（新版修正）
**資料安全與維護（G20/G21）**
1. 正式區 RLS：有 `service_center.access` 者（含店長角色）可讀寫全部廠商，write 為 FOR ALL，可讀統編、帳務抬頭、付款條件並可刪除。
2. 13 個欄位（billing_title、billing_address、invoice_type、payment_terms、payment_methods、accounting_notes、cooperation_start_date、contract_end_date、contract_required、preferred_vendor、cooperation_notes、service_capability_note、attachment_names）由 `supabase/migrations/20260724092830_general_affairs_vendor_form_sections.sql` 新增、細項權限碼由 `20260824090000` 新增；若正式區尚未套用（上線前以 41 號唯讀確認，m7m8-spec 第 215 行），舊版新增會失敗、採購單的付款條件快照也無來源。
3. DEV 實查：`ga_vendors`／分類／區域的現行 policy 仍是 `current_user_has_permission('general_affairs.service_center.access')`，不是 `20260824090000` 的收緊版；m7m8-spec Q22 寫的「DEV 已有收緊版」不成立。收緊版須重新套 DEV 並以 `supabase/test_general_affairs_vendor_permissions_rls.sql` 驗證。
4. 收緊版 SELECT 仍是整列授權：只有分類、區域、合作紀錄檢視權限者也讀得到統編與帳務；RLS 無法欄位遮蔽。
5. 只能新增、無編輯與停用入口；同統編可重複（`tax_id` 無唯一規則）；`attachment_names` 只存檔名、檔案沒上傳（Client 第 5742 行）；`insert` 失敗一律 `alert(MODULE_NOT_AVAILABLE_MESSAGE)`、原因被吞（Client 第 1267–1272 行）。
6. 資料庫 `contract_required`、`preferred_vendor` 皆 `DEFAULT true`（`20260724092830` 第 17–18 行），表單預設「二聯式、月結30天」（Client 第 575–576 行）；付款條件是下拉三選一文字。
7. 資料庫沒有任何銀行欄位（與 D8「廠商銀行等資料」敘述不符；D8 的快照也沒有銀行欄位）。
8. 廠商 FK：`ga_purchase_orders.vendor_id` 無 ON DELETE，其餘 SET NULL；若允許硬刪，單據上的廠商會被靜默清空。

**統計與採購分析（G22）**
9. `work_order_count`、`total_amount`、`avg_days`、`rating`、`review_count` 全 repo 無任何更新來源，永遠 0；「已完成工單」是 `Math.round(totalWorkOrders * 0.86)` 的假數字（Client 第 881 行）；平均天數與評分只算評分大於 0 的廠商。
10. 採購分析混加預估、報價、議價、最終金額；`.limit(500)` 靜默截斷且筆數失真（`cost-summary/route.ts` 第 95 行）；月份依評估單建立日；資料來源是舊採購評估，不含第 4 批採購單。
11. 選單與頁面權限不一致：`navigation.tsx` 的 `hasRequiredPermission`（第 573–588 行）是「權限碼或 `canAccessGeneralAffairsVendors` 旗標」二擇一，任何一項廠商相關權限都能讓旗標成立；採購分析選單（第 494–508 行）含需求單 `view_all／manage`，API 用 `canReadPurchaseReviews`（`cost-summary/route.ts` 第 71 行，亦含需求單權限）；合作紀錄選單（第 519–527 行）是 7 個廠商相關權限任一即可見，資料卻靠 `ga_vendors` RLS。

**水電網費（G23）**
12. 只能新增、標記已繳、刪除；PATCH 只改 `paid_at`（`utility-bills/[id]/route.ts` 第 12–13 行），畫面固定送台北今天（`UtilityBillsClient.tsx` 第 124 行；新增表單其實有「繳費日期」欄，第 179 行，只有事後標記不能選）；改回待繳無確認且清掉原日期；刪除只有 `window.confirm`（第 129 行）、不必填原因，資料表沒有 `deletion_reason`。
13. 重複時直接丟資料庫英文錯誤；補收單、更正單被唯一規則擋住。
14. 金額只擋負數；日期欄位只 `slice(0,10)`，無格式與合理性檢查。
15. 摘要與逾期只算「目前篩選結果」（預設當月，API `.limit(500)` 見 `utility-bills/route.ts` 第 72 行；摘要在 Client 第 80–81 行），跨月逾期會漏；沒填到期日的未繳帳單永遠不逾期。
16. 觸發器 `ga_utility_bill_before_write` 要求 `auth.uid()`，service_role 直接寫入會被擋；新版伺服端寫入必須走 SECURITY DEFINER RPC 或代入使用者身分。
17. 帳單附件刪除雖已要求原因並軟刪資料列，但隨即實體刪檔（`attachments/[id]/route.ts` 第 49–57 行），與 Q3「只標記、保留檔案」衝突。
18. RLS 讓「該據點的管理店長」可直讀自己門市帳單，與「店長看不到水電網費」在資料庫層不一致。
19. 據點名稱是建立當下的文字快照；已停用門市無法在表單選取；`markPaid`、`remove` 無錯誤處理；新增後附件失敗沒有補傳入口。

**總務首頁（G24）**
20. 待辦 `pageSize=200`（`GeneralAffairsDashboardClient.tsx` 第 368 行）被 API 壓成 100（`requests/route.ts` 第 35 行），只列「等門市確認／補資料」前 5 筆（第 371–375 行）；總務看到的是全部門市等門市的單，不是自己要處理的事；負庫存只讀前 100 筆餘額（含零餘額列，第 321 行）。
21. 廠商快捷連結 `/general-affairs?section=vendors` 首頁不讀 `section`，停在首頁；沒有任何徽章（`GeneralAffairsNavBadge` 型別宣告於 `navigation.tsx` 第 42、59 行但無使用）；舊版另有一套 `renderLegacyHomeDashboard`（Client 第 2794 行）以只載入 50 筆的維修單（第 1346 行）算卡片，兩套口徑不一致。
22. 側欄對管理員直接放行（`navigation.tsx` 第 574 行），首頁卻要 `service_center.access`（`GeneralAffairsHomeClient.tsx` 第 137 行）；入口卡的 `canAccessVendors` 與側欄 `canAccessGeneralAffairsVendors` 是兩份獨立計算。

## 2. 已決定事項（引用，不再問）

| 來源 | 決定 | 本批落點 |
|---|---|---|
| Q22 | 廠商寫入走伺服端並檢查細項權限；上線前先查正式區廠商表有無異常修改再套收緊；帳務與付款欄位只給廠商查看／管理權限者；加編輯不加刪除（不合作改停用）；統編重複擋下、名稱相近只提醒；分類與區域可編輯不可刪除、停用後仍顯示名稱；移除假附件欄位（既有檔名保留）；失敗顯示明確原因 | §3.1、§3.2、§4、§5 |
| Q23 | 加編輯並留修改者與時間；刪除必填原因；重複改白話並指出已存在那一筆；金額高於近三期平均 2 倍、低於一半或為 0 時提醒但可儲存；標記已繳可選實際日期；改回待繳須確認；不新增資料表、不動正式區唯一規則；補收單請編輯原帳單 | §3.3 |
| Q24 | 績效由真實單據計算、評價先不顯示；確定與預估金額分開顯示並分頁讀完；採購分析以採購評估權限為準；首頁數字完整計算；依權限新增待受理需求單、逾期帳單、30 天內到期合約待辦；導覽「待我處理」徽章；不發 LINE；工單算給哪家廠商以 `maintenance_requests.vendor_id` 為準，綁定不完整可隱藏績效 | §3.4、§3.5 |
| C11 | 逾期未收調撥單紅標與篩選第 3 批已做；首頁待辦在本批 | §3.5 |
| D8 | 採購單只能選已建好的供應商；下訂快照名稱、統編、付款條件；帳務欄位只給廠商管理權限者；「去舊版新增供應商」連結本批改指新版廠商頁 | §3.1、§4.1 |
| 第 4 批設計 §10 | 採購單快照廠商、歷史價與請款延後項；本批採購金額只讀已有欄位 | §3.4 |
| 第 5 批設計 | 廠商下拉與廠商統計延到本批；已完成工單 `totalWorkOrders*0.86` 本批由真實單據取代；存進度「有填才更新」不清 `vendor_id` | §3.4 |
| spec 第 54 行 | 店長維持看不到水電網費；匯入不做；「本月費用」改標「篩選結果合計」；標記繳費與刪除失敗一律顯示錯誤；報表彙整方式照舊 | §3.3 |
| Q3 | 附件刪除只標記、實體檔保留；照片自動縮小、其他檔 4MB | §3.3 |
| Q25 | 工務沿用總務角色，因此看得到水電網費 | §3.3 權限 |
| 第 6 批 V1–V10（2026-11-17，全採建議，各組 assumptions 一併核可） | 見 §9 | 全批 |
| 通則 | 列表伺服端搜尋分頁、精確筆數、寫入全成功或全不變、`409 STALE`、錯誤白話、搜尋跳脫、正式區 SQL 先出草稿附還原、備份後核可才執行、舊 Next 頁與舊 API 不動；權限語意以正式區 `has_permission` 為準（不查 `roles.is_active`、DB 無 admin bypass、應用層 `profiles.role==='admin'` 保底，寫入一律由函式內 `has_permission` 判斷） | 全批 |

## 3. 新版做法

### 3.1 廠商、分類、區域（G20/G21）
**資料模型**
- 沿用 `ga_vendors`、`ga_service_categories`、`ga_service_regions`，不拆關聯表（分類與區域仍以 `service_category_ids`、`service_region_ids` uuid 陣列存放，讀寫時由 RPC 驗證 id 存在）。
- 正式區補 13 個欄位（見 §1.3-2），補欄位時 `contract_required` 與 `preferred_vendor` 預設 false（V4：既有廠商補欄位時也設否，不被誤設為需簽約；DEV 這 13 欄已存在但預設值仍是 true，DEV 的 090000 要把欄位預設改 false，並把 DEV 既有測試廠商列的 `contract_required` 也設 false）；新增 `updated_by uuid`（記最後修改者）；不新增銀行欄位（待第 4.5 批請款）。
- 統編以 RPC 檢查唯一（標準化：去空白、全形轉半角；含停用廠商），暫不建唯一索引，待正式區重複名單處理完再建部分唯一索引。
- 預設資料：縣市行政區固定資料上線時放入（m7m8-spec 第 54 行，來源 `supabase/migration_general_affairs_taiwan_admin_regions.sql`，納入 DEV 20261118090000 與正式區 42 號，需冪等）；服務分類由總務自行建立，不預置（舊版預置分類 SQL 不套）。
- 移除假附件欄位：新增表單不再有附件步驟；既有 `attachment_names` 唯讀顯示「既有檔名（未存檔）」。
- 無刪除：廠商停用用 `status`（active／paused／inactive）；分類與區域不可刪除，停用後仍顯示名稱。

**權限（碼省略前綴 `general_affairs.`）**
| 動作 | 需要 |
|---|---|
| 開廠商列表、詳情（含帳務欄位） | `vendor.view` 或 `vendor.manage` |
| 新增、編輯、停用廠商 | `vendor.manage` |
| 看分類／區域 | `service_category.view/manage`、`service_region.view/manage`（廠商表單下拉所需的分類區域清單，持 `vendor.view/manage` 者也可讀） |
| 改分類／區域 | `service_category.manage`／`service_region.manage` |
| 廠商績效頁 | `cooperation_record.view`（資料由獨立 RPC 提供，不含帳務欄位；比舊版選單嚴：舊版 7 個廠商相關權限任一即可見，只有 `vendor.view` 或分類區域權限者會失去入口，列入 41 號名單） |
| 採購分析頁 | `purchase_review.view/manage` |
- **帳務機密欄位（V1 已決定，嚴格）**：統編 `tax_id`、`billing_title`、`billing_address`、`invoice_type`、`payment_terms`、`payment_methods`、`accounting_notes`、累計金額 `total_amount`。只有 `vendor.view` 或 `vendor.manage` 者拿得到；其他人（只有分類／區域／合作紀錄／採購單權限者）只拿到：名稱、別名、狀態、分類、區域、聯絡人（姓名、電話、LINE、email）。`contract_end_date`、`contract_required`、`cooperation_notes`、`cooperation_start_date`、`preferred_vendor` **不算帳務**（V1）。遮蔽一律在資料庫函式內做（欄位根本不回傳，不是回傳後前端隱藏）；整張表 RLS 只留 `vendor.view/manage`，沒有欄位層級授權，其他人一律走 RPC。
- **廠商下拉附聯絡資料（V2）**：`ga_ws_vendor_options` 回 `id、name、alias、vendor_type、status、contact_name、contact_phone`（採購單與工單下拉顯示）；`tax_id`、`payment_terms` 仍只在呼叫者有 `vendor.view/manage` 時回（沿用第 4 批 `ga_ws_po_vendor_options` 的 `billing_visible` 行為）。第 4 批 `ga_ws_po_vendor_options` 保留不動（採購單端），新函式供工單、需求單採購評估頁使用。
- 所有讀取與寫入走 `ga_ws_vendor_*` SECURITY DEFINER RPC（`has_permission(auth.uid(), …)`）；新版不使用瀏覽器直連。RLS 收緊：`ga_vendors` 只留 `vendor.view/manage`，其他權限改走遮蔽欄位的 RPC。
- **收緊的連鎖點（必改）**：第 4 批需求單採購評估頁 `lib/workspace/general-affairs/requests.ts` 第 400–401 行用使用者身分直接讀 `ga_vendors`（且 `limit(200)`），收緊後只有廠商權限者讀得到，總務若無 `vendor.view` 下拉會變空；本批改走 `ga_ws_vendor_options`（不含帳務欄位）並重跑第 4 批需求單測試。舊版 `app/api/general-affairs/requests/[id]/purchase-review/route.ts`（第 118–126 行，另讀 phone、contact_name）依「舊頁不動」不改，收緊後對無廠商權限者會空白，列入 allowlist 與上線風險。其餘 `ga_vendors` 讀取（`requests.ts` 第 278 行、`part-fulfillments.ts` 第 164 行）用 admin client，不受影響。

**規則**
- 名稱相近提醒：名稱與別名正規化（去空白、全半形、去「股份有限公司／有限公司／企業社」等字尾）後完全相同或互相包含，提醒並列出疑似者，可繼續儲存（Q22 已決定；細節列假設，不再問）。
- 統編：非空時 8 碼數字，唯一（含停用）；檢查碼只提醒不擋；個人類型可留空。
- 分類與區域：代碼建立後鎖定，可改名稱、描述、排序、狀態、上層；上層禁止形成循環；區域停用／archived 後既有廠商仍顯示名稱；新增與編輯廠商時不可新勾選停用項目，已勾選者保留並標「停用」；篩選器仍可選停用項目；列印表單只印啟用項目。
- **停用廠商（V3 已決定）**：採購單與工單的新單都只能選 `status='active'`（合作中）的廠商（採購單現況已如此：`ga_po_check_vendor`，`20261112110000` 第 486–488 行，`VENDOR_INACTIVE`，沿用；工單端新增同樣檢查，錯誤碼 `VENDOR_INACTIVE`；工單「有填才更新」：沿用既有已綁停用廠商、但不可新選停用廠商）。舊單據顯示名稱加「（已停用）」（status=inactive）或「（暫停）」（status=paused）。已下訂的採購單仍可收貨結案。停用或暫停廠商時，若還有未結採購單（DRAFT／PENDING_APPROVAL／APPROVED／ORDERED／PARTIALLY_RECEIVED）或進行中工單（status≠COMPLETED），回應帶 `warnings` 與筆數，畫面提醒但不擋。
- 填寫表列印：保留（`window.print` 空白表單，啟用分類與縣市）。

### 3.2 DEV 與正式區前置
- DEV 先補齊收緊版 RLS 並跑 `supabase/test_general_affairs_vendor_permissions_rls.sql`；查明收緊版先前未套用的原因（可能被相容性 migration 覆蓋）後再收緊。
- 正式區上線前唯讀預覽：廠商表筆數、重複統編名單、最近修改時間、欄位是否已有、有廠商權限的角色與人（Q22）、目前靠 `request.view_all/manage` 看採購分析但沒有 `purchase_review` 權限的角色與人。

### 3.3 水電網費（G23）
**資料模型**：沿用 `ga_utility_bills` 與唯一索引；新增欄位 `deletion_reason text`（刪除必填，屬 Q23 預留的小 SQL，與 spec 第 215 行一致）。`updated_by`／`updated_at` 已有；標記已繳也會更新最後修改，明細顯示「最後修改：誰、何時」。
**寫入**：全走 SECURITY DEFINER RPC `ga_ws_ub_*`（繞開觸發器對 service_role 的 `AUTH_REQUIRED`，於函式內以 `auth.uid()` 與 `has_permission` 檢查，觸發器仍可保留）。
**權限**：`utility_bill.view` 看列表、報表、附件；`utility_bill.manage` 新增、編輯、標記已繳、刪除、管理附件；店長看不到（RLS 同步移除 `current_user_manages_store` 條件，正式區經核可後才套）；工務沿用總務角色。管理員保底只作導覽與唯讀。
**規則**
- 編輯（V6 已決定）：已繳與未繳帳單都可編輯全部欄位；已繳帳單在改金額、改識別欄位（據點、類型、月份、供應商、識別號碼）或刪除時，要多一道確認並顯示原值（`confirm_paid_change:true` 才寫入，否則回 `409 PAID_CHANGE_CONFIRM_REQUIRED` 與原值）；換門市時同步 `location_name`；已停用門市的舊帳單編輯時保留原門市。
- 重複：RPC 先檢查同鍵未刪除帳單，回白話「這個據點、類型、月份、供應商、識別號碼已經有一筆（金額、到期日、連到該筆）」；補收單請編輯原帳單。
- 金額異常（V7 已決定）：以同據點＋同費用類型＋同識別號碼（`COALESCE(service_identifier, equipment_serial, account_number, '')` 正規化，與唯一索引同口徑），取「帳單月份早於本筆的最近三筆未刪除帳單」（排除自己與 0 元帳單）算平均；本筆 **> 平均 2 倍、< 平均一半、或本筆為 0 元** 時提醒（恰好 2 倍或恰好一半不提醒），仍可儲存；顯示基準金額（平均）與那幾筆的月份與金額明細；歷史 0 筆不比較（只提醒 0 元）；1–2 筆照用現有筆數並標「僅 N 筆參考」。
- 標記已繳（V8 已決定）：可選日期，預設今天（台北）；不可選未來；不可早於帳單月份前 1 個月（例如 2038-03 帳單最早 2038-02-01）；憑證不強制；已繳日期可在編輯修正；改回待繳要確認並顯示原繳費日期，確認後清除日期。
- 逾期（V8）：未繳（`paid_at IS NULL`）且到期日早於台北今日（到期當天不算逾期）；待繳與逾期兩張摘要卡不受月份、類型、據點篩選影響（全部月份、完整計算、不受 500 筆上限），其他摘要照篩選；「本月費用」改標「篩選結果合計」；沒填到期日的未繳帳單永不逾期，另以提示列呈現（筆數與連結，不計入徽章）；首頁、徽章與帳單頁的逾期數字同一支函式算出，必須一致。
- 刪除（V6）：必填原因（存 `deletion_reason`）；軟刪除；另提供唯讀「顯示已刪除」檢視（誰、何時、為何刪），不提供還原；帳單刪除時附件保持原狀（不標記），因帳單不存在而不可讀。
- 附件：沿用 `ResourceAttachmentPanel`（`UTILITY_BILL`、`BILL_DOCUMENT`）；規格沿用 Q3（照片縮小、其他檔 4MB、單次最多 10 個）；刪除附件須原因且只標記、保留實體檔；編輯畫面可增刪附件；新增帳單時附件失敗保留「補傳」入口。
- 報表：照舊（月／季／年按據點加總、全部啟用門市列出、分頁讀完）；「其他據點」名稱正規化後分組。**不做 Excel／CSV 匯出與圖表**（V10），沿用卡片、表格與純 CSS 長條；據點×月份總表不做。

### 3.4 廠商績效與採購分析（G22）
- **績效頁**（V5 已決定：績效一律顯示，不因工單綁定不完整而隱藏；需 `cooperation_record.view`，RPC `ga_ws_vendor_perf`，不新增快取表）：預設近 12 個月，可選月份區間；工單以 `reported_at` 落在區間、依 `maintenance_requests.vendor_id` 歸屬；完成數只算 `status='COMPLETED'` 且 `completion_method='STORE_CONFIRMED'`（`STORE_CONFIRMED` 是完成方式不是狀態），`ADMIN_FORCE_CLOSED` 另計且不入平均天數，`completion_method` 為 NULL 的舊資料列另列「已完成（未記方式）」、不入平均天數；平均處理天數＝`accepted_at` 到 `completed_at`；工單沒綁廠商者另列「未指定」（歷史不回補）；評價欄不顯示；每列顯示：工單數、完成數（STORE_CONFIRMED）、強制結案數、未記完成方式數、受理到完成平均天數、採購單確定金額；金額＝該廠商採購單確定金額（見下）；資料不足時顯示「資料累積中」而不是 0，並註明只統計有選廠商的工單；歷史工單不回補。頁面有「更新時間」與手動重新整理。
- **採購分析**（需 `purchase_review.view/manage`，RPC `ga_ws_purchase_analysis`）：以 `ga_purchase_orders` 為主，確定金額＝狀態 `ORDERED／PARTIALLY_RECEIVED／RECEIVED／CLOSED` 的含稅額（與 D9 歷史價同一組狀態），月份依下訂日（台北）；預估＝尚未下訂的評估與草稿，並單獨列舊採購評估的預估／報價；已到貨實收另列；上線前舊評估單只列預估，不回推為確定；伺服端彙總、分頁讀完、排名可展開全部；廠商以快照名稱為準。
- **工單廠商下拉**（V5 已決定：僅總務可選＝持 `work_order.update` 或 `work_order.manage` 者；第 5 批設計第 5 行已明列延到本批；`maintenance_requests.vendor_id` 為 `ON DELETE SET NULL`）：第 5 批工單進度表單（僅總務端）補廠商下拉（`status=active`，沿用 `PoPicker` 抽成廠商下拉）；進度 RPC 已「有填才更新」，不必改規則，只改畫面與一支唯讀廠商選項 API；需重跑第 5 批 G18 畫面回歸。

### 3.5 總務首頁與導覽（G24）
- 一支輕量 RPC `ga_ws_home_summary`（`auth.uid()` ＋ `has_permission`，只回呼叫者有權看的項目）：回各項目計數與前 5 筆。
- 「待我處理」項目（V9 已決定，共 9 項，最終定義見 §3.6）：待受理需求單、逾期帳單、30 天內到期與已過期合約（`status=active` 且 `contract_required=true` 且有 `contract_end_date`，續約即改到期日）、逾期未收調撥單（C11）、待核准採購單、逾期未到貨採購單、門市退回的工單、貼標待複核，加原有店長的待確認／待補資料（只算自己門市）。負庫存與低庫存是狀態提醒，留在首頁庫存摘要區，不計入徽章。
- 需求單與採購單沒有指派個人欄位，採「同權限者共同待辦」；總務另以「等門市回覆」唯讀計數呈現，不計入徽章。
- 庫存區：負庫存與低庫存由伺服端完整計數、顯示前 5 筆並依位置權限；點卡片進庫存頁帶篩選；允許負庫存的位置（`allow_negative_stock`）屬預期不算異常，不允許卻為負者標紅列入異常提醒。
- 導覽：`GaNavItem` 加 `badge?: number`；各選單項目顯示自己的待辦數（需求工作台＝待受理、採購單＝待核准、水電網費＝逾期、廠商＝合約到期、調撥＝逾期未收），首頁顯示合計，上限 99+；進入總務區與切換頁面時重抓，另每 5 分鐘輕量更新；點進頁面列表自動帶「待我處理」篩選，確保徽章數字等於筆數。
- 入口：廠商資料卡改指向使用者可進入的第一個廠商頁；選單、頁面、API 共用同一組權限常數（消除看得到打不開）。舊版第二套首頁邏輯不移植。
- 不發 LINE、不建快取表。

### 3.6 權限與徽章總表（V9 定稿；碼省略前綴 `general_affairs.`；管理員 `profiles.role==='admin'` 只作導覽與唯讀保底，寫入與資料一律由函式內 `has_permission` 判斷）
**頁面與 API**
| 頁面（API） | 進入條件（任一） | 寫入條件 |
|---|---|---|
| 首頁 `/`（`home/summary`、`home/badges`） | `service_center.access`；各區塊與徽章只回呼叫者有權看的項目 | 無 |
| `/vendors`（`vendors`、`vendors/:id`） | `vendor.view`／`vendor.manage`（含帳務機密欄位） | `vendor.manage` |
| `/vendors/categories`（`service-categories`） | `service_category.view`／`manage` | `service_category.manage` |
| `/vendors/regions`（`service-regions`） | `service_region.view`／`manage` | `service_region.manage` |
| `/vendors/stats`（`vendor-stats`） | `cooperation_record.view`（不含任何帳務機密欄位；只回廠商名稱與統計） | 無 |
| `/vendors/purchases`（`purchase-analysis`） | `purchase_review.view`／`manage`（不再因需求單權限放行） | 無 |
| `/utility-bills`、`/utility-bills/report`（`utility-bills*`） | `utility_bill.view`／`manage` | `utility_bill.manage` |
| `vendor-options`（工單、需求單採購評估頁下拉） | 任一：`vendor.view/manage`、`work_order.update/manage`、`purchase_review.view/manage`、`request.manage`、採購單查看（`ga_po_can_view`） | 無 |
| 分類／區域下拉（廠商表單用） | 持 `vendor.view/manage` 者也可讀啟用分類與區域清單（唯讀） | 無 |
- 店長（只有 `service_center.access` 與報修／自己門市權限）：看不到廠商、分類、區域、績效、採購分析、水電網費；首頁只出現自己門市的待確認／待補資料。
- 只有分類／區域／合作紀錄權限者：看不到統編與任何帳務機密欄位（V1）；廠商列表與詳情頁對其回 403。

**徽章與「待我處理」（V9：同權限者共同看；店長只算自己門市；每個選單顯示自己的數字、首頁顯示合計、最多顯示 99+、每 5 分鐘更新；進入總務區與切換頁面時也重抓）**
| # | 項目 | 計數條件 | 看得到的權限 | 顯示在 | 點進去的列表篩選（筆數必須等於徽章） |
|---|---|---|---|---|---|
| 1 | 待受理需求單 | `ga_service_requests.main_status='PENDING_INTAKE'` 且未刪除 | `request.manage` | 需求工作台 | `/requests?attention=1` |
| 2 | 逾期帳單 | 未刪除、`paid_at IS NULL`、`due_date < 台北今日` | `utility_bill.view/manage` | 水電網費 | `/utility-bills?overdue=1` |
| 3 | 30 天內到期合約 | `status='active'` 且 `contract_required` 且 `contract_end_date <= 台北今日+30`（已過期也列） | `vendor.view/manage` | 廠商資料 | `/vendors?contract_due=1` |
| 4 | 逾期未收調撥單（C11） | 狀態屬 AWAITING_RECEIPT 且 `source_confirmed_at` 早於「現在 − 逾期天數」（與 `isOverdue` 同一判斷、同一設定） | `inventory_transfer.view/manage`（範圍沿用調撥列表可見範圍） | 庫存調撥 | `/inventory/transfers?overdue=1`（既有） |
| 5 | 門市待確認／待補資料 | 需求單 `main_status` 為 `WAITING_STORE_CONFIRMATION` 或 `WAITING_STORE_SUPPLEMENT`，且屬呼叫者所屬門市 | `request.confirm_own_store`／`comment_own_store` 且為該店成員 | 我的追蹤 | `/requests/mine?attention=1` |
| 6 | 待核准採購單 | `status='PENDING_APPROVAL'` | `purchase_order.approve` | 採購單 | `/purchase-orders?attention=1`（待核准與逾期的聯集，依呼叫者有的權限各自成立） |
| 7 | 逾期未到貨採購單 | `status IN ('ORDERED','PARTIALLY_RECEIVED')` 且 `expected_delivery_date < 台北今日` | 採購單查看（`ga_po_can_view`） | 採購單 | 同上 |
| 8 | 門市退回工單 | `maintenance_requests.status='PROCESSING'` 且 `progress_stage='REOPENED'`（門市回報仍有問題） | `work_order.update/manage` | 工單中心 | `/work-orders?attention=store_rejected`（新增篩選） |
| 9 | 貼標待複核 | 設備與設施 `onboarding_status='PENDING_GA_REVIEW'` 且未刪除，兩者合計 | `equipment.manage`／`facility.manage`（各算各的） | 資產建檔 | `/onboarding?statuses=PENDING_GA_REVIEW`（既有） |
- 首頁合計＝呼叫者看得到的各項加總；**每項的計數與列表篩選共用同一個資料庫述詞**（同一支函式或視圖），測試斷言「徽章數字＝點進去列表總筆數」。
- **不計入徽章**：負庫存、低庫存（留在首頁庫存區）；總務的「等門市回覆」唯讀計數；沒填到期日的未繳帳單提示；需求單「待總務複核」（`WAITING_GA_REVIEW`，V9 清單沒有列，本批不計入，列待使用者確認，見 §9 備註）。

## 4. 頁面與 API

### 4.1 頁面（`vue-workspace/src/pages/ga/`）
| 頁面 | 說明 |
|---|---|
| `Vendors.vue` | 列表（伺服端搜尋分頁、統計卡、篩選）、詳情、新增與編輯（四步驟，無附件步驟）、停用／啟用、填寫表列印；帳務欄位依權限顯示 |
| `VendorCategories.vue`、`VendorRegions.vue` | 樹狀與列表、新增編輯、停用；代碼鎖定 |
| `VendorStats.vue` | 廠商績效（§3.4） |
| `PurchaseAnalysis.vue` | 採購分析（§3.4） |
| `UtilityBills.vue`、`UtilityBillsReport.vue` | 帳單列表、新增編輯、標記已繳、刪除、附件；報表 |
| `GaCenter.vue` | 改為首頁：待辦、KPI、庫存提醒、入口 |
| 修改 | `PurchaseOrderEdit.vue`（第 40、183 行 `legacy-vendor-link`）供應商連結改新版廠商頁（有 `vendor.manage` 才顯示，其餘顯示「請洽總務新增」）；工單進度表單加廠商下拉；`vue-workspace/src/components/ga/GaShell.vue` 顯示徽章；`lib/workspace/general-affairs/requests.ts` 廠商下拉改走 RPC |
- 導覽：`lib/workspace/general-affairs/nav.ts` 的 `GA_PAGE_BY_HREF` 新增 `/vendors`、`/vendors/categories`、`/vendors/regions`、`/vendors/stats`、`/vendors/purchases`、`/utility-bills`、`/utility-bills/report` 與對應 kind（`page-kinds.ts`）；沿用 `canAccessGeneralAffairsVendors` 與 `canAccessGeneralAffairsUtilities`；同目錄 `nav-types.ts` 加 badge；`lib/workspace/navigation.ts` 第 227–232 行已含 `vendor.*`、`utility_bill.*` 入口權限，確認與新常數一致。
- 圖表：不新增圖表套件，沿用卡片、表格與純 CSS 長條（V10 已決定）。確認 Modal 以 `Modal.vue` 自組。

### 4.2 API（`/api/workspace/general-affairs/**`，`lib/workspace/general-affairs/router.ts` 加 `vendors`、`service-categories`、`service-regions`、`vendor-stats`、`purchase-analysis`、`utility-bills`、`home`；共通規則同第 5 批：非 GET 檢查 Origin、使用者身分、`GaError`、`pageSize ≤ 100` 回 `{data,total}`、寫入帶 `expected_updated_at` 回 `409 STALE`、伺服端欄位遮蔽）
| 路徑 | 動作 |
|---|---|
| `vendors` GET／POST、`vendors/:id` GET／PATCH、`vendors/:id/status` | 列表、新增、編輯、停用；回應含 `warnings`（名稱相近）；統編重複回 `409 TAX_ID_DUPLICATE` 並指出既有廠商 |
| `vendor-options` | 工單、需求單採購評估頁用的 active 廠商下拉（含聯絡人與電話；統編與付款條件依 `vendor.view/manage` 遮蔽）；採購單端沿用第 4 批 `po-vendor-options` |
| `service-categories`、`service-regions`（GET／POST／PATCH） | 無 DELETE |
| `vendor-stats?from=&to=` | 績效 |
| `purchase-analysis?yearMonth=` | 採購分析 |
| `utility-bills` GET／POST、`:id` GET／PATCH、`:id/pay`、`:id/unpay`、`:id/delete`、`report`、`anomaly-check` | `anomaly-check` 回基準與明細；`unpay` 需 `confirm:true`；`delete` 需 `reason` |
| `home/summary`、`home/badges` | 首頁與徽章（`badges` 只回數字，單一 RPC；每 5 分鐘輕量更新） |
| 既有列表加 `attention` 篩選 | `requests`、`requests/mine`、`purchase-orders`、`work-orders`、`vendors`、`utility-bills`（`overdue=1`）；調撥 `overdue`、貼標 `statuses` 已有 |
- 資料庫函式皆 SECURITY DEFINER，回 `{ok,status,data,error,code}`，錯誤碼白話對照表放 `lib/workspace/general-affairs/vendor-messages.ts`、`utility-bill-messages.ts`。

## 5. SQL 計畫

### 5.1 DEV（`supabase/workspace-dev/`，各附 `.rollback.sql`；套用腳本 `scripts/apply-workspace-m7m8-b6-dev.cjs [--rollback]`，比照第 5 批，用 `tests/support/env-guard.cjs` 只連 DEV，先確認 `supabase/.temp/project-ref` 以 mjpd 開頭）
接續現有最大號 `20261117130000`。
| 檔名 | 內容 |
|---|---|
| `20261118090000_m7m8_b6_vendor_columns_rls.sql` | 補齊 13 欄位（DEV 已存在，用 `IF NOT EXISTS`；欄位預設 `contract_required`／`preferred_vendor` 改 false、DEV 既有廠商列設 false）、`updated_by`；分類、區域與廠商收緊版 RLS（只留 `vendor.view/manage` 讀、`vendor.manage` 寫）；**套用前把現有 policy 定義存備份**；縣市行政區固定資料 |
| `20261118100000_m7m8_b6_vendor_rpc.sql` | `ga_ws_vendor_list/get/save/set_status`、`ga_ws_vendor_options`、`ga_ws_svc_category_*`、`ga_ws_svc_region_*`；統編檢查、相近名稱、欄位遮蔽 |
| `20261118110000_m7m8_b6_utility_bills.sql` | `ga_utility_bills.deletion_reason`；`ga_ws_ub_list/get/save/pay/unpay/delete/anomaly/report`；店長 RLS 條件移除 |
| `20261118120000_m7m8_b6_stats_home.sql` | `ga_ws_vendor_perf`、`ga_ws_purchase_analysis`、`ga_ws_home_summary`（含 9 項共用述詞函式）、`ga_ws_wo_list` 補 `attention=store_rejected` 篩選、需求單與採購單列表 `attention` 述詞；索引 `maintenance_requests(vendor_id, reported_at)`、`ga_purchase_orders(vendor_id, ordered_at)`、`ga_utility_bills(due_date) WHERE paid_at IS NULL AND deleted_at IS NULL` |
| `20261118130000_m7m8_b6_dev_seed.sql` | DEV 專用：測試角色，代碼統一 `vue_workspace_ga6_` 開頭（實測 roles 表與 role-matrix 沒有此前綴，不會撞名；既有 `vue_workspace_ga_vendor_view／manager／edit`、`vue_workspace_ga_staff`、`vue_workspace_ga_works` 等一律不動）：`_vendor_mgr`（vendor.view+manage）、`_cat_only`（分類與區域 view）、`_coop_only`（cooperation_record.view）、`_util_mgr`（utility_bill.view+manage）、`_util_view`（utility_bill.view）、`_ga_all`（總務全套：廠商管理、採購、工單管理、水電管理、需求單管理、調撥、設備設施管理）、`QA-GA6-` 前綴測試資料、擴充 `cleanupM7M8`；角色代碼套用前先查 role-matrix 與 `roles` 表避免撞名 |
套用順序 090000 → 100000 → 110000 → 120000 → 130000；rollback 反向。DEV 目前廠商、分類、區域各 1 筆，水電、採購單、工單為 0 筆，測試以 seed 建立。

### 5.2 正式區草稿（`docs/vue-workspace/parity-plan/m7m8-sql/`，接續現有最大號 **40**，均附 rollback；README 新增「第 6 批」章節與套用順序）
| 檔案 | 內容 |
|---|---|
| `41-b6-preview-before-apply.sql` | 唯讀預覽：廠商表筆數、重複統編名單、最近修改時間、欄位與權限碼是否已有、現行 policy 原文、有廠商權限的角色與人、只靠需求單權限看採購分析的名單、水電 migration 是否已套（含 `20260926093000`）、有 `vendor_id` 的工單比例與 `completion_method` 分佈（含 NULL） |
| `42-b6-vendor-columns.sql`／`-rollback.sql` | 補欄位（`contract_required`、`preferred_vendor` 預設 false）、權限碼、縣市行政區固定資料 |
| `43-b6-vendor-rls.sql`／`-rollback.sql` | 廠商、分類、區域 RLS 收緊；**名單與異常修改查核未確認前不得套用** |
| `44-b6-vendor-rpc.sql`／`-rollback.sql` | 廠商、分類、區域函式 |
| `45-b6-utility-bills.sql`／`-rollback.sql` | `deletion_reason`、帳單函式、店長 RLS 條件移除（需確認沒有功能依賴店長讀取） |
| `46-b6-stats-home.sql`／`-rollback.sql` | 績效、採購分析、首頁函式與索引 |
套用順序：41（唯讀）→ 42 → 44 → 45 → 46 → 43（名單確認後最後收緊）。依賴：44 需要第 4 批 32 與 42；46 需要第 4、5 批與第 3 批調撥設定。**一律先備份，經使用者核可才執行；不在本批連正式區。**

## 6. 測試計畫
測試 ID：**G20**（服務分類與區域）、**G21**（廠商資料）、**G22**（統計分析：績效與採購分析）、**G23**（水電網費）、**G24**（總務首頁與徽章）；檔名比照 `G18-api`／`G18-db`／`G18-e2e` 的分層（例 `G21-db.vendor-rpc`、`G21-api.vendors-api`、`G21-e2e.journey-vendor-chain`）。必修回歸：第 4 批 **G16、G17**（需求單採購評估頁改走 `ga_ws_vendor_options`）、第 5 批 **G18**（工單進度表單加廠商下拉）、第 4 批採購單廠商相關測試。
- **smoke**（`G20–G24.smoke`）：各頁桌機 1440、手機 390 無橫向捲動、無 console 錯誤；導覽 href 與 `GA_PAGE_BY_HREF`；無權限入口不可見，API 回 403／401；徽章元件在各選單位置出現。
- **unit**：統編標準化（去空白、全形轉半角）與 8 碼格式、檢查碼只提醒；名稱相近判斷（字尾去除、互相包含）；帳務機密欄位遮蔽清單（8 欄）對照；分類區域循環防止；異常基準計算（歷史 0／1／2／3／4 筆、雙月、排除自己與 0 元、恰好 2 倍與一半不提醒、本筆 0 元提醒）；標記已繳日期範圍（今天可、明天不可、帳單月份前 1 個月可、再早不可）；逾期定義（到期當天不逾期、無到期日不逾期、已繳不逾期）；合約到期（30 天邊界、已過期、不需簽約、非合作中不列）；績效完成數定義（COMPLETED＋STORE_CONFIRMED；強制結案與未記方式另計）；徽章 9 項與權限對照、99+ 上限；選單、頁面、API 權限常數一致；縣市行政區資料筆數與冪等。
- **integration**（資料庫函式與 API；每支寫入驗權限矩陣、Origin、400、409 STALE、冪等，用 service role 回讀 DB；RPC 有 `BEGIN…ROLLBACK` SQL 測試）：統編重複擋下並指出既有廠商、名稱相近只提醒；廠商編輯、停用（含未結單據提醒）；分類區域編輯不可刪、代碼鎖定、停用後仍顯示；非廠商權限者的回應完全沒有 8 個帳務欄位；`vendor-options` 帶聯絡資料、無廠商權限者沒有統編與付款條件；工單指定停用廠商被擋；採購單選停用廠商被擋（第 4 批既有）；帳單新增、編輯留修改者、重複白話訊息指出既有那一筆、異常提醒、已繳改金額需確認、標記已繳日期範圍、改回待繳需確認、刪除必填原因、已刪除檢視；績效完成數與天數對照種子單據；採購分析確定與預估分開、超過 500 筆分頁讀完；首頁與徽章 9 項計數對照種子；**徽章數字＝列表總筆數**（9 項逐一）；超過 100 筆種子仍正確。
- **RLS 實測**（`G21-e2e.rls`、`G23-e2e.rls`）：用真實角色（店長、總務、廠商管理、廠商檢視、只有分類區域、只有合作紀錄、水電管理、水電檢視、管理員）直查資料表與呼叫函式：店長讀不到廠商、帳單；只有分類區域權限者直查 `ga_vendors` 讀不到、函式讀不到統編與帳務；寫入不靜默失敗；`test_general_affairs_vendor_permissions_rls.sql` 在 DEV 跑通。
- **parity**（`G21.parity`、`G23.parity`、`G22.parity`）：同帳號呼叫舊 `/api/general-affairs/utility-bills*`、`purchase-reviews/cost-summary` 與新 API，正規化後比對列表、報表加總；廠商以資料表直查比對；差異登記 allowlist。
- **e2e 角色接力劇本（循序）**：
  1. **`G21.journey-vendor-chain.e2e.spec.ts`**：總務新增廠商（統編重複被擋並指出既有廠商；名稱相近只提醒可儲存）→ 採購單選廠商（下拉只列合作中，暫停與停用的選不到）並下訂（快照名稱）→ 工單進度表單指定該廠商（僅總務有下拉）→ 店長確認完成 → 績效頁出現該廠商的工單數、完成數（STORE_CONFIRMED）、採購確定金額；廠商停用後舊採購單與舊工單顯示「（已停用）」、新單不能選；已下訂採購單仍可收貨結案。
  2. **`G23.journey-utility-bill.e2e.spec.ts`**：總務登錄水電帳單 → 金額異常提醒（多打一個零，顯示基準金額與明細，仍可儲存）→ 更正（編輯留修改者）→ 到期日已過未繳，首頁逾期待辦與水電網費徽章出現 → 標記已繳（選日期；未來日與過早日被擋）→ 首頁與徽章減少 → 改回待繳需確認並顯示原日期 → 已繳帳單改金額需二次確認 → 刪除必填原因 → 「顯示已刪除」檢視看得到誰、何時、為何刪；重複帳單訊息指出既有那一筆。
  3. **`G24.journey-store-blocked.e2e.spec.ts`**：店長登入看不到廠商、水電網費、績效、採購分析選單，直接開網址與呼叫 API 皆被擋；直查資料表也讀不到；首頁只有自己門市的待確認／待補資料；**只有分類區域權限者**開分類與區域頁正常，開廠商頁被擋，且任何回應都看不到統編。
  4. **`G24.journey-home.e2e.spec.ts`**：總務首頁待辦與各選單徽章數字等於點進去列表的筆數（9 項逐一點進去比對）；總務辦完一項後徽章即時減少；超過 100 筆種子資料時數字仍正確；99+ 顯示。
- **回歸**：G16、G17、G18 全套與第 4 批採購單測試重跑；`test:page` 與 e2e 一律循序；run-all 結束碼 1 若只因 sweeper 基準孤兒或 fetch failed 視為通過並說明。
- 版面檢查比照 `G10.layout.e2e`（`G20–G24.layout.e2e`）；廠商填寫表做 A4 列印預覽檢查；測試資料只用 VW／ZT 測試門市與保留年份 2038，結束只清自己的（`cleanupM7M8` 擴充，標記 `QA-GA6-`）。

## 7. 與舊版差異（登記 `tests/parity/allowlist.json`，id 前綴 `m7m8-b6-`）
`approvedBy`：問卷 V1–V10 與 m7m8-spec 已核可者設 `"user (2026-11-17 batch 6 spec survey)"`；新發現者設 `null`（decision 為 fix 的條目依驗證器規則維持 `null`）。
1. 廠商、分類、區域改走伺服端與細項權限；店長不可讀寫 [Q22、V1，已核可]。
2. 帳務機密 8 欄只給廠商查看／管理權限者（伺服端遮蔽）；只有分類區域／合作紀錄者看不到 [V1，已核可]。
3. 廠商可編輯與停用、無刪除；分類區域可編輯不可刪除、代碼鎖定、停用後仍顯示 [Q22，已核可]。
4. 統編重複擋下、名稱相近只提醒 [Q22，已核可]；失敗顯示明確原因 [Q22，已核可]。
5. 移除假附件欄位、既有檔名唯讀保留 [Q22，已核可]。
6. 廠商下拉附聯絡人與電話 [V2，已核可]。
7. 新單只能選合作中廠商、舊單標示「（已停用）」「（暫停）」、停用時有未結單據只提醒 [V3，已核可]。
8. 「需簽合約」預設改為否（含既有廠商補欄位）；合約到期提醒（30 天內與已過期）[V4，已核可]；付款條件結構化提示 [新發現，`null`]。
9. 績效由真實單據計算、評價不顯示、已完成工單不再乘 0.86、未指定另列、資料不足顯示「資料累積中」[Q24、V5，已核可]；工單進度表單新增廠商下拉（僅總務）[V5，已核可]。
10. 採購分析改以採購單為主、確定與預估分開、月份依下訂日、分頁讀完、權限以採購評估為準 [Q24，已核可]。
11. 帳單可編輯（已繳與未繳都可，已繳改關鍵欄位多一道確認）並留修改者；刪除必填原因、軟刪除、「顯示已刪除」唯讀檢視、不還原；重複白話訊息 [Q23、V6，已核可]。
12. 金額異常提醒（近三筆平均、2 倍／一半／0 元）[Q23、V7，已核可]。
13. 標記已繳可選日期（預設今天、不可未來、不早於帳單月份前 1 個月）、改回待繳需確認 [Q23、V8，已核可]；逾期與待繳摘要不受月份篩選、「本月費用」改標「篩選結果合計」、無到期日未繳另列提示 [V8、spec 第 54 行，已核可]。
14. 帳單附件刪除只標記不刪檔 [Q3，已核可]；店長不可直讀水電帳單（資料庫層）[spec 第 54 行，已核可]。
15. 首頁「待我處理」與導覽徽章（9 項）、廠商入口導向正確頁 [Q24、C11、V9，已核可]。
16. 負庫存完整計算、允許負庫存位置不算異常 [Q24 延伸，新發現，`null`]。
17. 選單、頁面、API 共用同一組權限；管理員只作導覽與唯讀保底 [通則，已核可]。
18. 採購單「去舊版新增供應商」連結改指新版廠商頁；無廠商管理權限顯示「請洽總務新增」[D8，已核可]。
19. 水電報表「其他據點」名稱正規化分組 [缺陷修正，新發現，`null`]。
20. 不做 Excel／CSV 匯出與圖表 [V10，已核可]。
21. 舊版需求單採購評估 API（`purchase-reviews`）直讀 `ga_vendors`，收緊後對無廠商權限者空白；舊頁不動 [新發現，`null`]。

## 8. 風險
- **正式區資料未知**：廠商筆數、重複統編、最近是否被店長角色改過、工單 `vendor_id` 完整度都要上線前唯讀預覽（41 號）；補欄位預設值若沿用舊 migration 會把既有廠商全標成需簽約。
- **DEV RLS 與 spec 不符**：收緊版需重新套用與測試，否則 RLS 測試與角色矩陣會誤判。
- **收緊的連鎖影響**：只靠需求單權限看採購分析、只有分類或區域權限看廠商欄位的人會失去入口，必須先出名單補授權；`ga_purchase_orders.vendor_id` 無 ON DELETE，故不開放硬刪。
- **收緊讀取連鎖**：第 4 批需求單採購評估頁與舊版 purchase-review API 直接讀 `ga_vendors`，收緊後對無廠商權限者空白；新版改走 RPC，舊版列 allowlist。
- **觸發器擋 service_role**：帳單寫入若誤用 service_role 全失敗，整批走 RPC。
- **異常提醒誤報**：新據點、雙月水費、補收單；以「同識別號碼最近三筆」降低誤報。
- **績效資料稀薄**：歷史工單無廠商，績效頁初期多為「資料累積中」，需向使用者說明。
- **徽章負載**：每頁重抓計數，需保證單一 RPC 輕量並有索引。
- **範圍膨脹**：匯出、圖表、銀行資料、合約表、真附件上傳皆不在本批。
- **回歸**：改第 5 批工單進度表單與第 4 批採購單連結，需重跑 G18、G16、G17。

## 9. 已決定（2026-11-17，使用者 V1–V10 全採建議 A，各組 assumptions 一併核可）
| 題號 | 決定（最終行為） | 落點 |
|---|---|---|
| V1 帳務機密 | 嚴格：統編、帳務抬頭與地址、發票類型、付款條件與方式、帳務備註、累計金額只給廠商查看／管理權限者；其他人只看名稱、別名、狀態、分類、區域、聯絡人。合約到期日與合作備註不算帳務。伺服端（資料庫函式）遮蔽，不靠前端隱藏 | §3.1、§3.6 |
| V2 下拉聯絡資料 | 採購單與工單的廠商下拉附聯絡人與電話；統編與付款條件仍依權限遮蔽 | §3.1、§4.2 |
| V3 停用廠商 | 舊單顯示名稱加「（已停用）」或「（暫停）」；採購單與工單新單都只能選合作中；已下訂的採購單仍可收貨結案；停用時還有未結單據只提醒不擋 | §3.1 |
| V4 合約到期 | 只用現有欄位：合作中＋需簽合約＋有到期日，30 天內到期與已過期都列；續約就是改到期日；「需簽合約」預設改為否（既有廠商補欄位時也設否）；有廠商查看或管理權限者看得到此待辦 | §3.1、§3.6 #3 |
| V5 績效與工單廠商下拉 | 工單補廠商下拉（第 5 批延後項；僅總務可選；需重跑 G18）；績效一律顯示：預設近 12 個月、可選區間；工單數、完成數（`status=COMPLETED` 且 `completion_method=STORE_CONFIRMED`；強制結案與未記完成方式另計）、受理到完成平均天數、採購單確定金額；沒選廠商的工單列「未指定」、歷史不回補；資料不足顯示「資料累積中」；評價不顯示 | §3.4 |
| V6 帳單編輯與刪除 | 已繳與未繳都可編輯全部欄位；已繳帳單改金額、改識別欄位或刪除時多一道確認並顯示原值；刪除原因存新欄位 `deletion_reason`（軟刪除）；唯讀「顯示已刪除」檢視（誰、何時、為何刪），不做還原 | §3.3 |
| V7 金額異常 | 同據點＋同費用類型＋同識別號碼，取早於本筆的最近三筆（排除自己與 0 元）平均；>2 倍、<一半或 0 元提醒但可存；歷史 0 筆不比較（只提醒 0 元）；1–2 筆用現有筆數並標「僅 N 筆參考」；顯示基準金額與明細 | §3.3 |
| V8 標記已繳與逾期 | 預設今天、不可選未來、不可早於帳單月份前 1 個月；改回待繳清除日期並顯示原日期確認；憑證不強制。逾期＝未繳且到期日早於今天；待繳與逾期摘要不受月份篩選；沒填到期日的未繳另列提示；首頁與帳單頁數字一致 | §3.3 |
| V9 待我處理與徽章 | 9 項（待受理需求單、逾期帳單、30 天內到期合約、逾期未收調撥單、門市待確認／待補資料、待核准採購單、逾期未到貨採購單、門市退回工單、貼標待複核）；負庫存與低庫存留在首頁庫存區不計入；同權限者共同看；店長只算自己門市；每個選單顯示自己的數字、首頁顯示合計，最多 99+，每 5 分鐘更新；點進去列表筆數必須等於徽章數字（列表帶同一篩選） | §3.5、§3.6 |
| V10 匯出與圖表 | 不做 Excel／CSV 匯出與圖表，沿用卡片、表格與純 CSS 長條 | §3.3、§4.1 |

另沿用 m7m8-spec Q22–Q24、C11、第 4 批 D8（採購單快照；連結改指新版廠商頁，有廠商管理權限才顯示，其餘顯示「請洽總務新增」）。必修連鎖：第 4 批需求單採購評估頁 `requests.ts` 改走伺服端廠商選項函式，改後重跑 G16、G17；縣市行政區固定資料放入（來源 `supabase/migration_general_affairs_taiwan_admin_regions.sql`）。

**設計備註（待使用者確認，`approvedBy` 為 null）**：(a) 需求單「待總務複核」（`WAITING_GA_REVIEW`）V9 清單沒列，本批不計入徽章；(b) 工單徽章定義為「門市退回（`REOPENED`）」；(c) 採購單選單徽章為待核准與逾期的聯集。

## 10. 建議實作分組（五個開發階段，詳見回報 stages）
1. **G20–G21 資料庫與 API**：DEV 090000／100000／130000（角色與清除）、套用腳本、`lib/workspace/general-affairs/vendors.ts` 等、遮蔽與統編規則、單元／整合／RLS 測試；補縣市行政區。
2. **G20–G21 畫面與連鎖修改**：廠商、分類、區域頁、填寫表列印、需求單採購評估頁改走 RPC、採購單廠商連結、工單進度表單廠商下拉；重跑 G16、G17、G18。
3. **G23 水電網費**：110000、帳單 API 與頁面、報表、異常提醒、標記已繳、刪除與已刪除檢視、附件；單元／整合／RLS／劇本。
4. **G22 + G24 績效、採購分析、首頁與徽章**：120000、績效頁、採購分析頁、首頁、導覽徽章、各列表 `attention` 篩選；單元／整合／兩支 G24 劇本。
5. **驗收與正式區草稿**：41–46 與 README 第 6 批、parity、allowlist、全部劇本循序重跑、版面與列印、驗收紀錄 §11.5。

## 11. 實作紀錄

### 11.1 開工前 DEV 唯讀實測（2026-11-17，專案 mjpd…，僅 SELECT／系統目錄，未寫入；project-ref 已確認以 mjpd 開頭）
| 項目 | 結果 | 對設計的影響 |
|---|---|---|
| 資料筆數 | `ga_vendors` 1、`ga_service_categories` 1、`ga_service_regions` 1（代碼都是 TEST）；`ga_utility_bills`、`ga_purchase_orders`、`maintenance_requests`、`ga_inventory_transfers` 全 0；`stores` 10（含 VW001 等測試門市） | 水電、採購、工單、調撥、徽章資料全部由測試自建（2038 年、VW／ZT 門市、`QA-GA6-` 標記）；沒有歷史資料可做 parity，績效與徽章靠 seed |
| 廠商表 RLS | RLS 啟用；SELECT 與 ALL 兩條都是 `p1e_ga_vendors_read／write`，條件只有 `current_user_has_permission('general_affairs.service_center.access')`；分類、區域表同樣兩條 p1e 政策 | 與 §1.3-3 一致：**含店長的任何有入口權限者可讀寫全部廠商**；m7m8-spec Q22 的「DEV 已有收緊版」不成立 |
| 收緊版未套的原因 | migration 紀錄：`20260724011554`（相容性，建立 p1e 政策）與 `20260724092830`（廠商表單欄位）已套；**`20260824090000`（細項權限收緊）沒有紀錄**；`20260926093000`（水電）也沒有紀錄，但資料表存在（DEV 以其他方式建立） | 090000 自己寫收緊版（只留 `vendor.view/manage`），並以 `supabase/test_general_affairs_vendor_permissions_rls.sql` 驗；不依賴 migration 紀錄判斷正式區狀態，正式區以 41 號預覽為準 |
| 廠商欄位 | 13 個擴充欄位 DEV 都已存在；`contract_required`、`preferred_vendor` 預設仍是 true；沒有 `updated_by`；沒有銀行欄位；`tax_id` 無唯一規則；只有 name、status 索引；`status` 為 active／paused／inactive；`vendor_type` 為 company／studio／personal；累計欄位（rating、total_amount、work_order_count…）預設 0 | 090000 補 `updated_by`、預設改 false、DEV 既有廠商（1 筆，統編有填、需簽約為 true）設 false；統編唯一暫由函式檢查（§3.1） |
| 分類與區域 | 分類狀態只有 active／inactive；區域類型 country／region／city／district、狀態 active／inactive／archived；父子 FK `ON DELETE SET NULL`；縣市行政區資料 DEV 沒有（city／district 只有 1 筆 TEST）；固定資料來源檔有 3 條 INSERT | 縣市行政區固定資料納入 090000，需冪等；循環防止由函式處理（資料庫沒有） |
| 水電帳單表 | 欄位含 `electricity_kwh`、`service_identifier`、`equipment_serial`、`service_label`；**沒有 `deletion_reason`**；CHECK：類型 WATER／ELECTRICITY／PHONE／INTERNET、月份必為每月 1 日、金額 ≥ 0、度數僅電費可填；FK `store_id` RESTRICT；唯一索引 `uq_ga_utility_bills_identity`（未刪除、據點＋名稱＋類型＋月份＋供應商＋識別號碼）；觸發器 `trg_ga_utility_bills_before_write`；索引只有 (月份, 類型) 與 (門市, 月份) | 110000 加 `deletion_reason`；異常基準與重複檢查的識別號碼口徑直接採唯一索引的 `COALESCE(service_identifier, equipment_serial, account_number)`；逾期查詢另建 `due_date` 部分索引 |
| 帳單 RLS | SELECT：未刪除且（`utility_bill.view` 或 `manage` 或「該據點的管理店長」`current_user_manages_store`）；INSERT／UPDATE 需 `manage`；沒有 DELETE 政策（刪除是 UPDATE 軟刪） | 與 §1.3-18 一致；110000 移除店長條件；店長 RLS 測試用真實店長角色 |
| 權限碼 | 存在：`vendor.view／manage`、`service_category.view／manage`、`service_region.view／manage`、`cooperation_record.view`（**沒有 manage**）、`utility_bill.view／manage`、`purchase_review.view／manage`、`purchase_order.approve`、`service_center.access／force_close`、`request.view_all／manage`、`maintenance_request.view_all／update`、`work_order.view_all／update／manage`、`inventory_transfer.view／manage`、`inventory_transaction.view／manage` | 本批不新增權限碼；§3.6 的碼全部已存在（`equipment.manage`、`facility.manage` 為第 2 批既有） |
| 角色持有（DEV，成員數） | **廠商 view＋manage**：`admin`(2)、`vue_workspace_admin`(1)、`vue_workspace_ga_vendor_manager`(1)、`vue_workspace_ga_vendor_edit`(1)；**只有 vendor.view**：`vue_workspace_navigation`(1)、`vue_workspace_ga_vendor_view`(1)、`vue_workspace_ga_purchaser`(1)；**cooperation_record.view**：`admin`、`vue_workspace_admin`、`vue_workspace_navigation`、`vue_workspace_ga_vendor_manager`；**utility_bill.view＋manage**：`admin`、`vue_workspace_admin`、`vue_workspace_ga_staff`(1)、`vue_workspace_ga_works`(1)，`navigation` 只有 view；**purchase_review**：`vue_workspace_ga_po_approver`(view)、`ga_staff`、`ga_works`、`ga_purchaser`、`ga_po_review_only`(manage)、`ga_po_no_partview`(manage)；店長類（`store_manager`、`manager`、`vue_workspace_store_manager`、`acting_manager`、`ga_store_manager_b`）只有 `service_center.access` | 既有總務、工務測試角色（`ga_staff`、`ga_works`）**沒有任何廠商與合作紀錄權限**；收緊後它們的需求單採購評估下拉會變空（連鎖點確認）。新角色用 `vue_workspace_ga6_` 前綴（roles 表查無 `ga6`，不撞名），不動既有角色 |
| `has_permission` 在 DEV | 實測函式本體：**有檢查 `roles.is_active`**，且 `admin` 角色代碼有 bypass（正式區語意不同：不檢查 `roles.is_active`、無 admin bypass） | 新函式只用 `has_permission(auth.uid(), 碼)`；測試以「角色明確帶權限碼」建構，不依賴 admin bypass；DEV 的 `admin` 角色本身有齊全權限碼，兩種語意結果相同 |
| `profiles.role` 分佈 | admin 2、supervisor 1、manager 1、store_manager 3、member 87 | 管理員 2 人皆帶 `admin` 角色；無「只能唯讀的管理員」 |
| 既有函式 | 第 4 批 `ga_ws_po_vendor_options` 已存在（`billing_visible` 以 `vendor.view/manage` 判斷，只列 active 廠商）；`ga_po_check_vendor` 已擋非 active；`ga_ws_category_usage`、`ga_ws_delete_category` 等第 2 批已使用 category 命名 | 本批新函式前綴：`ga_ws_vendor_*`、`ga_ws_svc_category_*`、`ga_ws_svc_region_*`（避免與第 2 批撞名）、`ga_ws_ub_*`、`ga_ws_home_*` |
| 待辦來源與狀態值 | 需求單 `main_status`：PENDING_INTAKE、WAITING_STORE_SUPPLEMENT、WAITING_GA_REVIEW、ACCEPTED、IN_PROGRESS、WAITING_STORE_CONFIRMATION、COMPLETED、REJECTED、CANCELED（有 `deleted_at`）；採購單 status：DRAFT、PENDING_APPROVAL、APPROVED、ORDERED、PARTIALLY_RECEIVED、RECEIVED、CLOSED、CANCELED，有 `expected_delivery_date`、`ordered_at`、`total_amount`；調撥單 status：REQUESTED、SOURCE_CONFIRMED、IN_TRANSIT、RECEIVED、CANCELED，逾期天數存 `ga_inventory_transfer_settings.overdue_days`（預設 3），逾期判斷在程式（`inventory-transfer-rules.ts` 的 `isOverdue`：交出時間起算、超過 N 天）；工單 status：UNACCEPTED、ACCEPTED、PROCESSING、COMPLETED，`completion_method`：STORE_CONFIRMED、ADMIN_FORCE_CLOSED（可為 NULL），門市退回＝`progress_stage='REOPENED'`＋`status='PROCESSING'`，有 `vendor_id`、`accepted_at`、`completed_at`、`reported_at`；貼標：設備與設施 `onboarding_status`：NEEDS_EQUIPMENT_PHOTO、NEEDS_LABEL_PHOTO、PENDING_GA_REVIEW、COMPLETED | §3.6 的 9 項述詞直接採用這些值；調撥逾期判斷原本在程式，徽章函式要在資料庫內重做同一規則（`source_confirmed_at < now() - overdue_days`），以單元與整合測試對照 `isOverdue` 確保一致 |
| 索引 | `maintenance_requests(vendor_id, reported_at)`、`ga_purchase_orders(vendor_id, ordered_at)` 目前沒有索引；需求單已有 `waiting_confirm_since` 部分索引 | 120000 補索引（§5.1） |

### 11.2 實作進度
（尚未開工；各階段完成後在此記錄）
