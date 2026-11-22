# M6 跨部門：最終規格

使用者於 2026-11-21 透過 M6 規格問卷確認，送出時間 2026-11-21 01:18 UTC。範圍：W25 門市盤點缺口、P07 關係會員對等、W26 共用工具、W27 商品主檔、W28 商品主檔 Excel 匯入、W29 商品部缺貨回報、W30 診所自費藥毛利、W31 診所截圖與 PDF、W32 督導管理日誌、W33 督導語音與 AI 摘要。調查結果在 `.tmp-check/m6-research.json`，使用者答案在 `.tmp-check/m6-answers.json`（兩者皆為本機暫存，不進版控；本文件已把需要的內容全部寫入）。既有決策 D14、D17（外部服務一律 mock）不變。

凡與舊版不同的行為，parity allowlist 一律寫入 `tests/parity/allowlist.json`，並同步在 `docs/vue-workspace/parity-plan/allowlist-review/plain.json` 寫白話說明。實作使用者在本次問卷中明確選擇的差異，`approvedBy` 為 `"user (2026-11-21 M6 規格問卷)"`；其他差異 `approvedBy` 為 `null`，等使用者核可。

## 一、逐題決定

### A 盤點與關係會員

| 題號 | 項目 | 問題 | 決定 | 意思 |
|---|---|---|---|---|
| A1 | W25 | 盤點離線工具下載的 Excel 檔名，要不要跟舊版一樣帶日期？ | 帶日期，但用橫線寫法（例如 2026-11-21）（iso） | 保留舊版名稱與日期資訊，只把日期改成電腦檔名可用的寫法；「M月D日盤點結果檔」維持原樣。 |
| A2 | W25 | 第三步「產出匯入 DPOS 的檔案」時，同一個品號資料有衝突，要擋下來還是照舊版直接加總？ | 擋下來，並一次列出所有衝突的品號（block_list） | 不產出檔案，同仁改好再試；一次看到全部比一筆一筆修省時間。 |
| A3 | W25 | 預盤資料一次上傳很多檔，其中幾個檔案有問題時，要整批中止還是跳過壞檔？ | 照舊版：跳過壞檔，顯示成功與失敗清單（skip） | 同仁一眼知道哪幾檔要重傳，成功的不用再傳。 |
| A6 | P07 | 關係會員頁新版多出的功能（關鍵字搜尋、分頁、「匯入來源/時間」欄、銷售查詢最多顯示最新 5000 筆），要接受嗎？ | 接受搜尋與分頁，但姓名、電話改回分開兩欄（accept_keep_columns） | 版面回到同仁熟悉的樣子，又保有搜尋。 |
| A7 | P07 | 同一份銷售明細 Excel 不小心匯入兩次，系統要怎麼處理？ | 內容完全相同的明細自動略過，並顯示略過幾筆（skip_dup） | 同仁重傳不會出錯也不會被擋住。 |

### B 共用工具與商品主檔

| 題號 | 項目 | 問題 | 決定 | 意思 |
|---|---|---|---|---|
| B1 | W27 | 商品搜尋（缺貨回報要用）要限制誰能查嗎？ | 登入就能搜尋（同舊版）（login） | 商品資料只有編號、名稱、單位，不含價格成本，缺貨回報不會壞。 |
| B2 | W27 | 停用商品要不要加權限限制，並提供「重新啟用」？ | 只有管理權限者可停用，並新增「重新啟用」按鈕（manage_reenable） | 補上漏洞，也能挽回誤停用；列表加「顯示已停用」篩選。 |
| B3 | W27 | 商品主檔要能在畫面上直接新增、編輯單筆商品嗎？ | 新增單筆新增與編輯（編號不可改，只能改名稱、單位）（add_edit） | 日常修正方便，工作量小幅增加。 |
| B4 | W28 | 商品主檔 Excel 匯入遇到錯誤資料時怎麼處理？ | 先預覽再確認：顯示將新增、更新、略過幾筆與原因，確認後才寫入（preview） | 最安全，可看見被略過的列與會復活的停用商品。 |
| B5 | W28 | 「併購藥局商品整理」（掃描條碼、未建立商品、相機拍照）這一輪要做嗎？ | drop（不移植；使用者註記：這功能可以全部拿掉） | 併購藥局商品整理（掃描條碼、未建立商品、相機拍照）整組不移植，不是延後。 |
| B6 | W28 | （僅在做併購整理時需要）掃描照片要怎麼保存？ | 不適用（B5 已捨棄） | 不做掃描照片，不需要照片儲存方案。 |

### C 商品部缺貨回報

| 題號 | 項目 | 問題 | 決定 | 意思 |
|---|---|---|---|---|
| C1 | W29 | 商品部回覆之後，門市再回報同一商品，「預計到貨日過了多久」還算已回覆？ | 照舊：15 天算已回覆、30 天內仍顯示提醒（keep） | 與舊版完全一致，使用者不會有落差。 |
| C3 | W29 | 商品部回覆後，之前已送出的「待回覆」回報，要自動視為「已回覆」嗎？ | 不改資料，狀態與統計一律用「該商品目前有沒有有效回覆」即時算出（derive） | 顯示一致，到貨日過期後自動回到待回覆，不需改寫歷史資料。 |
| C6 | W29 | 同一門市對同一商品短期內重複回報、或數量填得離譜，要設防呆嗎？ | 近期（例如 7 天）已回報過同商品時跳出提示，讓使用者確認後仍可送出（warn） | 減少重複，不阻擋作業。 |

### D 診所自費藥毛利

| 題號 | 項目 | 問題 | 決定 | 意思 |
|---|---|---|---|---|
| D1 | W30 | 誰看得到「診所自費藥毛利計算」選單、誰可以操作？ | 以實際能用的規則為準（A） | 有專屬權限或職稱符合者才看得到選單；主檔管理與刪批次維持經理類職稱或專屬權限。看得到就一定能用。 |
| D2 | W30 | 診所檔裡只要有一個藥品在價格主檔找不到，要整批擋下還是允許匯入？ | 維持整批擋下（A） | 與舊版相同，顯示缺少的健保代碼與藥名。 |
| D3 | W30 | 診所檔內的結算期間與店長畫面選的年月不同時，以哪個為準？ | 以檔案期間為準，不一致時跳出確認提示（A） | 算法同舊版，另加「檔案是 X 月，與你選的 Y 月不同，確定嗎？」 |
| D4 | W30 | 同門市、同月、同診所重複匯入時怎麼處理？ | 跳出確認提示，確認後仍新增（A） | 偵測到已有同批次時提示，舊批次保留。 |
| D6 | W31 | 健保系統截圖要保存多久？要限制張數與大小嗎？ | 維持永久保存直到刪批次；單次最多 10 張、每張壓縮後約 5MB 內（A） | 不改保存習慣，上限只是防呆。 |

### E 督導管理日誌

| 題號 | 項目 | 問題 | 決定 | 意思 |
|---|---|---|---|---|
| E1 | W32 | 督導能看到哪些人的日誌？ | 依權限分三層（own_team_manage） | 一般督導看自己建立或被指派的；有「看團隊」權限者看自己負責區域的督導案件；有「管理」權限者（如總部主管）看全部。 |
| E2 | W32 | 別人建立的案件與紀錄，誰能修改、刪除？刪除要留痕嗎？ | 自己的可改，管理者可改全部，刪除只標記為已刪除並留時間線事件（own_edit_manager_all_softdelete） | 事後可追查。 |
| E3 | W32 | 「今日工作台（每日計畫）」這一輪要完整做嗎？ | 一併完整移植（include） | 功能與舊版對等，才能整個切換。 |
| E5 | W33 | 督導的錄音內容要送到 OpenAI 處理嗎？ | 啟用，首次使用須勾選同意並在錄音前顯示告知（enable_with_notice） | 音檔不保存，逐字稿保存在紀錄中。 |
| E6 | W33 | 逐字稿要保存多久、誰看得到？ | 保存逐字稿，但只有建立者與管理者能看（keep_manager_only） | 需要追溯 AI 有沒有腦補時可查。 |
| E7 | W33 | AI 服務失敗時怎麼辦？錄音長度上限要訂多少？ | 失敗時退回手動文字稿與本機規則，錄音上限約 10 分鐘或 10MB（fallback_and_10mb） | 畫面註明「這份草稿未經 AI 整理」，仍須人工確認才能儲存。 |

### Z 跨項目（上線順序、舊頁保留、測試資料、費用）

| 題號 | 項目 | 問題 | 決定 | 意思 |
|---|---|---|---|---|
| Z1 | M6 全部 | 這九個項目要用什麼順序上線？ | 分批：先盤點/關係會員，再商品主檔+缺貨回報，最後診所毛利與督導日誌（含語音）（staged） | 每批獨立測完才上線，風險最低。 |
| Z2 | M6 全部 | 新版某頁上線後，舊版頁面要保留多久？ | 新版上線後舊頁保留，連續穩定使用一個月、無重大問題再下架（keep_until_stable） | 可隨時退回；導覽預設指向新版。 |
| Z3 | M6 全部 | 新版各頁的「看得到選單」角色，要以現有角色權限原樣沿用嗎？ | 沿用舊版實際可用的權限，不新增也不收回，並提供一份各頁可見角色清單供您確認（mirror） | 同仁不會突然多或少功能。 |
| Z4 | M6 全部 | 驗收測試可以使用什麼資料？ | anon（使用者將提供去識別真實樣本；尚未提供） | 由您提供一組去識別的真實樣本，另搭配我們自造的測試檔。最能抓到真實檔案的欄位與格式怪狀況，只需您提供一次。 |
| Z5 | M6 全部 | AI 語音功能每月可接受的 OpenAI 費用上限？超過後怎麼辦？ | cap_fallback（金額尚未提供） | 設每月上限（請在補充欄填金額），達到後自動退回手動文字稿與本機規則，並通知管理者。費用可控，服務不中斷。 |

補充說明：

- 問卷沒有列出的工程性問題（A4、A5、A8、B7、C2、C4、C5、D5、E4、E8）已降級為下方「採用的假設」，不另外詢問。
- 「意思」欄是問卷選項原文的說明；與舊版不同、需要列白名單的項目在第二節與各批次清單內逐項標出。

## 二、各項目研究缺口（舊版對新版）

### W25 門市盤點缺口（S）

新版 `pages/Inventory.vue`、`components/InventoryOffline.vue`、`lib/inventory-files.ts` 已原生復刻，分析端 API 為包裝舊 route，只剩下列差異：

1. 輸出檔名缺日期（舊版「外盤應複盤清單_YYYY/M/D」）。**依 A1 補回，日期改橫線寫法**。
2. 工作表名新版固定「盤點資料」，舊版 `Sheet1`。**統一回 `Sheet1`**。
3. 模組三 `finalRows` 遇到品號衝突直接報錯中止，且只顯示第一筆；舊版不驗證只累加。**依 A2 擋下並一次列出全部衝突品號**（與舊版不同，需白名單）。
4. 預盤多檔，新版任一檔錯整批中止；舊版逐檔容錯回報「成功 N/M，失敗檔案」。**依 A3 照舊版**。
5. 模組一無盤差時舊版跳「沒有需要複盤的品項」，新版無提示。**補回**。
6. 新版多了 CSV 匯出。**保留**（A4 假設），品號欄位必須防止前導零遺失。
7. 1F 商品檔欄位辨識方式不同（舊版 `header:1` 找索引，新版 `range=1` 加 includes）。**以同一份檔案做新舊等價測試**。
8. 外盤檔品號重複時舊版 alert 列出重複品號，新版只說「請先合併」；FKS0701 欄位找不到時錯誤訊息較簡略。**補回列出重複品號與完整欄位診斷訊息**。
9. 另有既有白名單項目 `inventory-view-implies-import-delete`（僅有檢視權限卻同時可匯入與刪除，`deferredTo: W25`）：第一批要查證舊版實際行為（舊 route 是否也如此）後結案，結果寫回該項目。【已被取代：2026-11-22 問卷裁定新舊一起收緊，見文末「盤點權限分開」。】
10. 缺新舊同一組 Excel 對跑的逐列一致性測試與四層測試。

### P07 關係會員對等（S）

無功能缺漏，Vue 與 workspace API（包裝舊 handler）已涵蓋全部功能。差異與待補：

1. 新版多出：關鍵字搜尋、兩分頁各自分頁、姓名與電話合欄、「匯入來源/時間」欄。**依 A6：保留搜尋與分頁，姓名、電話改回分開兩欄**。
2. 銷售查詢上限 5000 筆：已查證舊版 `app/api/relationship-sales/route.ts` 同樣是 `.limit(5000)`，**不是新差異**，不列白名單。
3. 重複匯入同一份銷售明細：已讀舊版 `app/api/relationship-sales/import/route.ts`，每次匯入都建立新批次並直接 `insert`，資料表也沒有唯一索引，**舊版不去重**。**依 A7 在 workspace 層新增去重**（見第一批清單，仍需在 DEV 實測確認）。
4. 待補測試：角色矩陣（view／edit／approve／delete 各自單獨帳號、viewer 看不到核可駁回刪除按鈕）、並行 PATCH 會員編號一成功一個 409、新舊 API 回傳 deep equal、四個分頁計數與 FKRS 最後一號與統計三數字對等。FKRS 最後編號、分頁計數、銷售日期驗證抽成可單元測試的函式。

### W26 共用工具（縮小，S 到 M）

- 沒有統一的 `lib/xlsx.ts`（各檔各自動態 import）。**做**：`readSheet`、`pickColumns`、`downloadXlsx`，並把 `inventory-files.ts` 等改接。
- 計畫原列 `FileUpload.vue`，實際已有 `UploadPicker.vue` 與 `lib/upload.ts`：**擴充既有，不新增**。
- **B5 捨棄後縮減**：即時相機元件（`getUserMedia`）原本只為併購掃描所需，**不做**；`ImageLightbox.vue` 只剩診所截圖回看（W31）會用，**延到第三批隨 W31 做**，第二批不做。
- Origin 檢查：確認 workspace API 既有共用 helper 並直接套用。

### W27 商品主檔（L）

- 整頁缺漏：`app/api/workspace/products-master/**`（搜尋、清單、停用、重新啟用、新增、編輯）、`pages/ProductsMaster.vue`、`lib/workspace/modules.ts` 註冊、導覽 kind。
- 舊版搜尋把 `q` 直接組進 `.or()` 字串，含逗號、括號會改寫條件。**新版必須跳脫**（白名單，列為修正）。
- 舊版全量清單沒有分頁。**新版加分頁**。
- 舊版沒有單筆新增／編輯與重新啟用。**依 B2、B3 新增**；被停用商品再匯入會因 `is_active:true` 重新啟用（舊版隱性行為），新版要明確處理並列入白名單。
- 權限採正式區 `has_permission` 語意，並做等價測試。匯入與停用寫操作紀錄。
- DEV 是否已有 `products_master`、`product_barcodes` 資料表需先盤點；`acquisition_*` 資料表**不盤點、不建立、不測試**（B5 捨棄）。

### W28 商品主檔 Excel 匯入（M，併購整理已捨棄）

- 只做 Excel 匯入：欄位別名沿用舊版（商品編號／編號／`product_code`、商品名稱／品名／名稱、單位／`unit`），讀第一個工作表，單次上限約 5000 筆，後端每批 500 筆分批 upsert。
- **依 B4 做預覽再確認**：顯示將新增、更新、略過幾筆與原因，確認後才寫入（與舊版不同，需白名單）。
- 併購掃描、未建立商品、相機拍照、清除某日全部掃描、掃描照片儲存：**全部不做**（B5、B6）。

### W29 商品部缺貨回報（L）

整頁缺漏：`pages/Merchandise.vue`、`app/api/workspace/stockout/**`、`lib/stockout/response.ts`（純函式，`today` 參數注入）、導覽 kind、DEV seed／cleanup、角色矩陣測試。舊版已知不一致與本輪處理：

| 編號 | 舊版問題 | 本輪決定 |
|---|---|---|
| a | 15 天有效與 30 天提醒兩套門檻 | C1 照舊（15 天算已回覆、30 天內仍提醒） |
| b | POST 回報只驗有權限，未驗門市是否在自己管轄內 | 屬漏洞修補，新版伺服端驗證門市範圍（store_managers 或 view_all／respond），列白名單 |
| c | 回覆時不回頭更新舊回報 status | C3 改為即時衍生，不改資料 |
| d | 刪最後一筆回報會連商品部回覆一起清掉但歷程保留 | 先與舊版對等，不改規則 |
| e | 月份分組用 UTC 前七碼，篩選用 +08:00 | 一律 Asia/Taipei，列白名單 |
| f | 關鍵字拼進 `ilike` 的 or 條件，逗號括號會壞 | 改為跳脫，列白名單 |
| g | 刪除商品部回覆 UI 是否真有按鈕不確定 | 移植時以舊版畫面為準逐一確認 |
| h | 需求數量沒有上限 | C6 近期重複回報提示；數量上限不設（使用者選 warn，未選 limit） |
| i | 回覆 upsert 與歷程寫入非交易 | 改為同一交易或 RPC |

### W30 診所自費藥毛利（L）

整頁缺漏：`pages/ClinicSelfpay.vue`、`app/api/workspace/clinic-selfpay/**`（permissions、stores、batches、batches/[id]、batches/import、mappings、mappings/close、mappings/history、prices/import）、解析與毛利純函式抽到 `lib/clinic-selfpay/*.ts` 供新舊共用。

- 導覽可見權限（`monthly.status.view_own`／`view_all`、`employee.movement.manage`、`store.manage`）與 API 實際權限（`store.clinic_selfpay.*` 加職稱）不一致。**依 D1：以實際能用的規則為準**，把 `resolveAccess(permissions, jobTitle)` 抽成純函式，導覽對齊。
- 批次匯入以檔案內期間推得的年月優先於畫面選的年月。**依 D3 保留以檔案為準，但不一致時跳確認**（與舊版不同）。
- 同門市同月同診所重複匯入：**依 D4 跳確認，確認後仍新增**（與舊版不同）。
- 價格檔有未匹配藥品：**依 D2 維持整批擋下**（與舊版相同）。
- 價格主檔每門市一份，非 admin 的主管若沒綁 `store_managers` 會看不到任何門市（維持）。
- 毛利與成本在計算器畫面可見，**不得出現在給診所的 PDF**。

### W31 診所截圖與 PDF（M）

- 多檔選取加 Ctrl+V 貼上、圖片壓縮（長邊 1920px、JPEG 0.85）、截圖回看 Modal（`ImageLightbox.vue`）、PDF 輸出、截圖上傳與簽名網址（60 分鐘）。
- **依 D6**：維持永久保存直到刪批次；單次最多 10 張、每張壓縮後約 5MB 內（與舊版不同，需白名單）。
- PDF 為圖片式（html2canvas 加 jsPDF），無法文字抽取比對；原計畫「以 PDF 文字抽取比對」改為同批次輸出的畫面、頁數、檔名對照。參數 980px 寬、scale 2、A4 邊界 8mm 原樣沿用。
- 確認 `vue-workspace` 是否已有 `jspdf`、`html2canvas`、`xlsx` 相依；新增相依需先取得使用者同意（D02 同類規則）。
- 刪批次先刪 storage 檔再刪資料，刪檔失敗被忽略可能留下孤兒檔；截圖路徑格式維持 JSON 陣列字串，以免新舊並行時舊頁讀不到。bucket `clinic-selfpay-screenshots` 在 DEV 是否存在需先盤點。

### W32 督導管理日誌（L）

- 整頁與整組 API 新建：`pages/SupervisorLog.vue`、`app/api/workspace/supervisor-management/**`（案件 CRUD、紀錄、追蹤、事件時間線、今日計畫、options、categories）。
- workspace API 直接重用 `lib/supervisor-management-log` 的 validation、access，不重寫商業規則；不新增第二套資料表。
- **E1** 可見範圍三層、**E2** 修改刪除規則與軟刪除留痕、**E3** 今日工作台完整移植；以上皆與舊版不同的部分列白名單。
- `view_own` 與 `view_team` 資料範圍的實作位置需在開發時逐一確認，用等價測試鎖住。權限測試以正式區 `has_permission` 語意為準。

### W33 督導語音與 AI 摘要（M）

- 新增錄音元件（麥克風、重錄、重試）、上傳音檔包裝、草稿審核畫面、workspace 語音 API。
- **E5** 啟用且首次須勾選同意、錄音前顯示告知；**E6** 逐字稿保存、僅建立者與管理者可看；**E7** AI 失敗退回手動文字稿與本機規則，上限約 10 分鐘或 10MB；**Z5** 每月 OpenAI 費用上限（金額待提供）。
- 逐字稿含門市與員工姓名，送 OpenAI 屬個資外送，需有告知與同意紀錄。
- Vercel 函式請求大小與逾時需實測（上限降為 10MB 與此相關）。

## 三、採用的假設

下列為問卷以外、調查時採用且使用者未反對的假設；若與第一節的決定衝突，以第一節為準。

**盤點與關係會員（A）**

- W25 結果分析端因 workspace API 直接包裝舊 route，視為已一致，只做對等與權限測試，不改邏輯。
- 工作表名統一 `Sheet1`；原因報表維持「盤差原因」「爭議異動明細」。
- 品號補零到 8 位的規則兩版一致，不更動。
- 1F 商品資料欄位辨識（庫存或重存、主要儲位或主要庫位）沿用寬鬆比對，以同一份測試檔與舊版比對。
- Vue 的 tab 工作頁與離開前未存提醒屬版面差異，接受並列入白名單。
- 總務庫存（`ga_inventory_*`）與門市盤點完全分開，本批不處理。
- A4：保留 CSV 匯出，但品號必須以文字處理避免前導零遺失；並補回舊版提示（「沒有需要複盤的品項」、外盤檔重複品號列清單）。
- A8：銷售明細可見角色沿用舊版（view 或 edit 才看得到分頁）。
- A6 的「匯入來源/時間」欄：依 `accept_keep_columns`（接受新版多出的功能，只把姓名電話拆回兩欄）保留；使用者若要移除請提出。
- FKRS 最後編號規則維持 `/^FKRS(\d+)$/i` 取最大序號；會員編號填寫後鎖定、駁回必填理由、刪除會員保留銷售明細三條規則維持舊版。
- 測試只用 DEV 資料庫與 VW／ZT 測試門市，年度 2038，測完只刪自己建立的資料。

**共用與商品主檔（B）**

- xlsx 統一整理成 `vue-workspace/src/lib/xlsx.ts`（動態載入）。
- 商品主檔管理權限沿用 `store.products_master.manage`，導覽權限碼不變。
- 搜尋維持舊規則：編號開頭優先、再補名稱或編號包含，最多 20 筆，只含啟用商品，並跳脫特殊字元。
- 商品主檔清單加分頁（每頁 50）與搜尋，預設只顯示啟用商品。
- 匯入與停用都寫操作紀錄（誰、何時、幾筆）。
- B1 登入就能搜尋；B7 照片規則因 B5 捨棄而不需要。

**缺貨回報（C）**

- 預設分頁：只有提交權限者預設「我的門市」，有查看全部或回覆權限者預設「全部門市」。
- 權限維持 `cross_dept.stockout.submit`／`view_all`／`respond` 三個，由 workspace API 回傳 capabilities。
- 列表每頁 30（上限 100）；回覆歷程每頁 10（上限 50）；時間範圍預設近 30 天加歷史月份折疊。
- 日期一律 Asia/Taipei 計算。
- 商品搜尋沿用 `products_master`，輸入編號即時建議（80ms debounce、舊請求不覆蓋新結果），選定後帶品名與單位並聚焦數量。
- 訊息文字沿用舊版，刪除前保留 confirm「確定刪除這筆回報？」。
- C2 嚴格門市範圍屬漏洞修補，直接做；C4 刪除規則先與舊版對等；C5 不做通知。
- 導覽「商品部」新增 kind 在工作頁內開啟；舊版頁面保留不動。
- DEV 角色代碼不得與 `tests/fixtures/role-matrix.json`、`roles` 表撞名，新增前先查。
- 測試走多角色劇本：店長回報、商品部回覆、店長再回報看到提醒、刪除結案。

**診所毛利（D）**

- 價格主檔維持每門市一份、逐店匯入；批次保存匯入當下會員價與成本快照，之後匯入或關帳不回頭改動舊批次。
- 價格檔規則照舊：工作表名 `YYYY-MM` 按工作表分月；同門市同月同健保碼保留最後一筆；關帳月份略過；欄位別名全部沿用。
- 診所檔解析照舊，含數量欄優先順序（M、L、K、J、N）與 6 個固定排除健保代碼，抽成共用純函式。
- 金額單列取小數 2 位、批次合計取小數 1 位。
- 截圖僅接受 png／jpeg／webp，至少 1 張；刪批次同步刪截圖。
- PDF 不含成本與毛利，保留蓋章簽名欄與列印日期，檔名格式不變。
- 刪批次、主檔管理、關帳開帳權限規則不變；API 放 `app/api/workspace/clinic-selfpay/**`，不更動舊版 API。D5 PDF 維持圖片式。

**督導日誌（E）**

- 沿用舊版同一組資料表與權限碼，不改資料庫結構。
- AI 永遠不得略過人工確認直接寫入；`review_required` 固定 true，`observation`／`judgment`／`action_summary` 三欄缺漏禁止儲存。
- 音檔不保存，只在前端暫存供重試；不保存 OpenAI 原始回應與標頭。
- 音檔格式維持 WebM、MP3、M4A、WAV。
- 門市與員工比對候選依登入者權限縮小。
- 測試一律 mock 或 `LOCAL_RULE_FALLBACK`，不呼叫真的 OpenAI；正式環境 `OPENAI_API_KEY` 由 Vercel 管理，本次不改。
- E4 逾期僅標示；E8 AI 標籤依設計不另問。
- 多角色劇本 e2e：督導建立案件、寫紀錄、追蹤、結案，主管檢視，並含無權限者被擋下。

**跨項目（Z）**

- Z1 分批上線（見第四節）。
- Z2 舊頁保留：新版某頁上線後，舊版頁面保留，連續穩定使用一個月、無重大問題再下架；本輪所有舊 route 與舊 API 一律不改行為。
- Z3 選單可見角色沿用舊版實際可用權限，不新增也不收回；每批完成時產出各頁「可見角色清單」供使用者確認（以角色矩陣與正式區語意產生，不連正式區）。
- 本輪全部使用正式區 `has_permission` 語意：不檢查 `roles.is_active`、不使用資料庫 admin 繞過，只有應用層 `profiles.role === 'admin'` 後備。

## 四、分批上線

| 批次 | 內容 | 前置與備註 |
|---|---|---|
| 第一批 | W25 門市盤點缺口、P07 關係會員對等 | 無外部相依；本文件第六節為詳細清單 |
| 第二批 | W26 共用工具（縮小版）、W27 商品主檔、W28 商品主檔 Excel 匯入、W29 缺貨回報 | W27 先於 W29（缺貨回報要用商品搜尋）；需要使用者提供 Z4 的盤點樣本不在此批，但 W28 若有商品主檔樣本可一併提供 |
| 第三批（兩段） | 3a：W30 診所毛利加 W31 截圖與 PDF；3b：W32 督導日誌加 W33 語音 | 需要 Z4 診所價格檔與診所檔樣本；W33 需要 Z5 金額；`ImageLightbox.vue` 隨 W31 做 |

每一批皆須通過：單元、整合（API 與權限）、e2e（多角色劇本）、parity（新舊對跑）四層測試，並更新 allowlist 與 plain.json 後才算完成。

## 五、B5 捨棄的處理：併購藥局商品整理不移植

- **決定**：整組功能不移植（掃描條碼、未建立商品、相機拍照、清除某日掃描、掃描照片儲存全部不做）。
- **舊版位置**：它不是獨立路由，而是舊版 `app/cross-dept/products-master/page.tsx` 內的分頁，元件為 `components/products-master/AcquisitionProductsTab.tsx`。**本輪不修改這兩個檔案，也不刪除 `acquisition_*` 資料表與 migration**。
- **導覽檢查**：已檢查 `lib/workspace/navigation.ts`，導覽只有「商品主檔」`/cross-dept/products-master`（權限 `store.products_master.manage`，目前沒有 kind，外開舊版），**沒有任何項目指向併購整理**。
- **待辦（第二批 W27）**：給「商品主檔」加上 `kind: "products-master"` 改在工作頁內開啟；新頁面與 workspace API 不得出現併購分頁、連結或 API；`lib/workspace/modules.ts` 不註冊併購相關項目；新增一條測試斷言「新版導覽與頁面文字不含『併購』」。
- **舊頁處理**：依 Z2，舊版商品主檔頁連同其併購分頁先保留；待新版商品主檔穩定一個月下架舊頁時，併購分頁一併消失（使用者已表示可全部拿掉）。是否額外清理 `acquisition_*` 資料表另案處理，本輪不動。
- **白名單**：新增一條記錄「新版商品主檔不含併購藥局商品整理」，`approvedBy` 為 `"user (2026-11-21 M6 規格問卷)"`。

## 六、待使用者提供的項目

| 項目 | 用途 | 需要時間點 | 狀態 |
|---|---|---|---|
| Z5 每月 OpenAI 費用上限金額 | W33 達上限後自動退回手動文字稿與本機規則，並通知管理者 | 第三批 3b 開工前 | **已提供（2026-11-22 問卷）：每月 US$30** |
| Z4 盤點樣本：1F 商品檔、外盤檔、FKS0701、預盤檔（去識別的真實樣本） | W25 新舊等價測試與三個模組端到端測試 | 第一批驗收（見下方處理） | **尚未提供** |
| Z4 診所價格檔、診所檔（去識別的真實樣本） | W30、W31 解析與毛利對照 | 第三批 3a 開工前 | **尚未提供** |

Z4 的處理原則：自造測試檔與使用者提供的去識別樣本並用。使用者樣本到位前，第一批先以 `.tmp-check/_archive-20261102/` 內的 `inventory-external.xlsx`、`inventory-internal.xlsx`、`inventory-final.xlsx` 與新自造檔完成開發與測試，驗收報告註明「尚未用真實樣本驗證」；樣本到位後補跑，結果寫回本文件。樣本只放 `.tmp-check/`（已被 gitignore），不進版控。

## 七、硬性規則（本輪全部適用）

- 只連 DEV：環境變數用 `process.loadEnvFile('.env.development.local')`，任何資料庫指令前先確認 `supabase/.temp/project-ref` 以 `mjpd` 開頭；不讀 `.env.local`、`.env.production*`、`*.bak`；不連正式區（ref `odvk`）；不印出密鑰。
- 不修改 `supabase/migrations/`。DEV 資料庫變更放 `supabase/workspace-dev/<時間戳>_m6_*.sql`，附 `.rollback.sql`，並在 `docs/vue-workspace/parity-plan/m6-sql/` 放正式區草稿與 README（有資料庫變更時才建立）。
- 舊版 Next.js 頁面與舊 API 行為不變；需要改行為時放在 workspace 層或新的 workspace handler。
- 測試資料只用 VW／ZT 測試門市、年度 2038（2099 保留給每月人員狀態）；只刪自己建立的資料。
- 測試依序執行；不使用 `pkill`，以 PID 結束；Playwright 只能從本專案目錄解析。
- 多角色劇本測試必備；不 push、不 `git stash`、不 `git worktree remove`；`_preview.html` 不動。

## 八、第一批實作清單（W25 加 P07）

### W25 門市盤點缺口

**A1 檔名與工作表名**

- [ ] `vue-workspace/src/lib/inventory-files.ts` 的 `download()` 增加 `sheetName` 參數，預設 `Sheet1`（取代固定「盤點資料」）；原因報表維持「盤差原因」「爭議異動明細」。
- [ ] 抽出純函式 `buildInventoryFileName(kind, date)`，日期格式 `YYYY-MM-DD` 以台北時間計算（例：`外盤應複盤清單_2026-11-21.xlsx`，使用 ISO 橫線並補零，不含斜線，避免 Windows 把斜線改成底線）。逐一檔名：
  - [ ] `外盤應複盤清單_{日期}.xlsx`
  - [ ] `內部盤點複盤資料_{日期}.xlsx`
  - [ ] `系統有庫存但未盤點檔案_{日期}.xlsx`
  - [ ] **`M月D日盤點結果檔.xlsx` 維持舊版寫法不變**（例：`11月21日盤點結果檔.xlsx`），不加年份、不用橫線。
- [ ] 單元測試：四種檔名、跨午夜台北時間邊界、月與日個位數、Sheet1 名稱；Playwright 實際下載後檢查檔名（`download.suggestedFilename()`）與工作表名。
- [ ] allowlist：`m6-w25-a1-filename-date-dash`（斜線改橫線）、`m6-w25-sheet1`（若新舊最終一致則不需要，但需確認舊版輸出實際為 Sheet1）。

**A2 最終檔衝突擋下**

- [ ] `finalRows` 改為先蒐集**全部**衝突再一次回報，不再遇到第一筆就中止。衝突類型：
  - [ ] 同一品號同時出現在「無盤差」與「修改後複盤資料」。
  - [ ] 同一品號在不同檔案（或同檔重複列）庫存量不一致。
  - [ ] 同一品號在同一份檔案內重複出現。
- [ ] 有任何衝突時**不產出檔案**，畫面顯示完整衝突清單（品號、出現位置、各自的庫存量），可複製。
- [ ] 回傳型別 `{ ok: true, rows } | { ok: false, conflicts: Conflict[] }`，UI 不再用單一錯誤字串。
- [ ] 單元測試：無衝突輸出與舊版累加結果逐列相同；單一衝突；多重衝突（至少三種類型並存）；衝突清單排序穩定。
- [ ] allowlist：`m6-w25-a2-final-conflict-block`，`approvedBy: "user (2026-11-21 M6 規格問卷)"`；plain.json 寫白話：舊版不檢查直接加總，新版擋下並列出全部衝突品號。

**A3 預盤多檔逐檔容錯**

- [ ] 預盤檔處理改為每檔 try／catch，回傳 `{ okFiles, failedFiles: { name, reason }[] }`。
- [ ] 成功的檔案照常收下，畫面顯示「成功 N/M，失敗檔案：…」，失敗原因要含檔名與簡短原因（缺哪個欄位、無法解析等）；全部失敗時視為失敗並不進入下一步。
- [ ] 失敗檔案可單獨重傳，已成功的不需要再傳。
- [ ] 單元測試：全成功、部分失敗、全失敗、空檔、欄位缺漏、重複上傳同一檔。
- [ ] allowlist 說明新版比舊版多顯示失敗原因（若有此差異）；與舊版主流程一致的部分不列。

**A4 CSV 與提示**

- [ ] 保留 CSV 匯出，所有品號欄位以文字寫入：Excel 開啟不可吃掉前導零（例如加上 BOM 並對品號使用文字格式寫法）；單元測試驗證 `00012345` 往返不變。
- [ ] 補回舊版提示：模組一無盤差時顯示「沒有需要複盤的品項」並且不下載空檔。
- [ ] 外盤檔品號重複：列出所有重複品號並拒絕匯入，訊息文字沿用舊版（「匯入失敗：外盤公司原始檔中發現重複品號」、「請聯繫外盤公司修正檔案後重新上傳，每個品號只能出現一次」）。
- [ ] FKS0701 與 1F 商品檔欄位缺漏：補回完整訊息（缺少的欄位與實際檔案欄位清單）。
- [ ] 單元與 e2e：以上三個提示各一條案例。

**1F 商品檔欄位辨識等價**

- [ ] 把舊版（`header:1` 找欄位索引）與新版（`range=1` 加 includes）的辨識邏輯各抽成純函式，用同一組樣本對跑：必要欄位（品號、品名、條碼、庫存或重存、主要儲位或主要庫位、單位）。
- [ ] 樣本涵蓋：標題在第二列、欄位順序不同、欄位名稱含空白或全形、缺欄位、庫存與「重存」別名、儲位與庫位別名。
- [ ] 逐列輸出一致才算通過；不一致處列清單回報使用者，不自行決定。
- [ ] 新舊同一組 Excel 的三模組端到端對跑：以 `.tmp-check` 自造檔先做，使用者真實樣本（Z4）到位後補跑。

**既有白名單與權限**

- [ ] 查證 `inventory-view-implies-import-delete`：舊 `app/api/inventory/**` 權限判斷是否同樣讓 `inventory.inventory.view` 可匯入與刪除；結論寫回該項目（保留為已知差異、或改為修正），不改舊版。【已被取代：2026-11-22 盤點權限問卷裁定新舊一起收緊，僅改舊版兩個權限判斷函式，見文末「盤點權限分開」。】
- [ ] 角色劇本（多角色）：盤點組（可操作離線工具與匯入、刪除）、店長（只看自己門市）、督導、無權限帳號（被擋下，無入口）；每個角色驗證導覽可見、API 狀態碼、按鈕顯示。
- [ ] 分析端（匯入、查詢、報表視圖、差異原因、門檻、刪除批次）只做新舊對等斷言與權限測試，不改邏輯。

**測試分層**

- [ ] 單元：檔名、衝突偵測、逐檔容錯、欄位辨識、品號補零 8 位（兩版一致）、CSV 前導零。
- [ ] 整合：workspace inventory API 與舊 route 回傳 deep equal、無權限 401／403。
- [ ] e2e：四步驟離線流程（下載檔檢查檔名與內容）、結果分析流程（桌機與手機）。
- [ ] parity：同一組 Excel 新舊逐列比對；既有 `scripts/test-workspace-inventory*.py/.cjs` 與合併摘要測試維持通過。

### P07 關係會員對等

**A6 版面**

- [ ] `pages/Relationships.vue` 會員表格把「姓名／電話」合欄改回**兩個獨立欄位**（姓名、電話），欄位順序與舊版一致；搜尋框、兩分頁各自分頁、「匯入來源/時間」欄保留。
- [ ] 搜尋要涵蓋姓名、電話、會員編號；分頁大小預設與上限沿用現有。
- [ ] 手機版（390 寬）兩欄仍可讀，不得橫向捲出頁面。
- [ ] allowlist：`m6-p07-a6-search-paging`（搜尋與分頁，使用者核可）、`m6-p07-a6-import-source-column`（匯入來源/時間欄，使用者核可）；5000 筆上限舊版同樣存在，**不列**。

**A7 銷售明細重複匯入**

- [ ] **先在 DEV 實測舊版行為**：以 VW／ZT 測試門市、年度 2038 的銷售日期，用同一份 xlsx 連續匯入兩次，記錄舊 route 回傳與資料列數。已讀程式碼的結論是舊版不去重（每次建立新批次直接 `insert`、資料表無唯一索引）；**若實測發現舊版已去重（例如有資料庫唯一約束或觸發器），維持現狀，不另做，並更新本文件與 plain.json**。
- [ ] 若確認舊版不去重：在 **workspace 層**實作，不改舊 route。方式為新的 workspace 匯入 handler（`app/api/workspace/relationships/` 下的匯入路徑），沿用舊 handler 的欄位驗證與日期規則（抽成共用純函式而不是複製貼上），再加去重：
  - [ ] 去重鍵：門市代號、銷售日期時間、會員編號、品號、數量、金額（完全相同才算重複）；同一檔案內本身重複的列處理方式需先與舊版對照（同一檔內兩列完全相同是否屬正常交易）：**預設只略過「資料庫已存在」的相同明細，不略過同一檔內的相同列**，並把此規則寫進 plain.json 請使用者確認。
  - [ ] 回傳與畫面顯示「匯入 N 筆，略過重複 M 筆」；全部重複時顯示「此檔案內容皆已匯入過」且不建立空批次。
  - [ ] 去重查詢分批（每批 500）並以台北時間字串比對，避免時區造成誤判。
  - [ ] 並行匯入同一檔不得產生重複（以交易或唯一約束保證；若需要資料庫唯一索引，只放 `supabase/workspace-dev/<時間戳>_m6_*.sql` 與 rollback，以及 `m6-sql/` 的正式區草稿與 README）。
- [ ] 前端 `Relationships.vue` 改呼叫新的 workspace 匯入路徑；舊 `/api/relationship-sales/import` 行為不動，舊頁照舊。
- [ ] allowlist：`m6-p07-a7-sales-import-dedupe`，`approvedBy: "user (2026-11-21 M6 規格問卷)"`。
- [ ] 測試：首次匯入、同檔重傳（全略過）、部分重疊（新增與略過計數正確）、同檔內相同列、日期格式錯誤沿用舊訊息、權限（沒有 edit 被擋）、清理自己的資料。

**其他驗收（無新行為）**

- [ ] 角色矩陣劇本：view／edit／approve／delete 各一個單獨帳號（`VW` 前綴臨時帳號或既有矩陣帳號；新增 DEV 角色代碼前先查 `role-matrix.json` 與 `roles` 表避免撞名）。驗證：viewer 看不到核可、駁回、刪除、匯入按鈕與編輯；edit 者無法核可與刪除；approve 者可核可駁回；delete 者可刪（銷售明細保留）；無權限帳號無導覽入口、直接進網址與 API 被擋。
- [ ] 並行 PATCH 會員編號：兩個請求同時送，一個成功、一個回 409。
- [ ] 新舊 API 回傳 deep equal（會員清單、銷售查詢、統計）。
- [ ] 畫面對等：四個篩選分頁計數、待填寫分頁 FKRS 最後一號、銷售統計三數字（筆數、數量合計、金額合計）。
- [ ] 抽成純函式並單元測試：FKRS 最後編號、分頁計數、銷售日期驗證（`YYYY/MM/DD HH:MM`，含不存在日期）。
- [ ] 沿用 `scripts/test-workspace-relationships.py` 擴充；測資用 VW／ZT 測試門市，年度 2038，測完只刪自己建立的資料。

### 第一批共通收尾

- [ ] allowlist 與 `plain.json` 同步（上述各條，使用者明確選擇的 `approvedBy` 為 `"user (2026-11-21 M6 規格問卷)"`，其餘為 `null`）。
- [ ] 完整測試依序執行（`test:page`、e2e、playwright），不並行；結束的程序以 PID 結束。
- [ ] 產出「各頁可見角色清單」（Z3）：盤點、關係會員各角色看得到與操作的項目。
- [ ] 更新 README 狀態備註與 `docs/CURRENT-DEV-STATUS.md`；commit trailer 為 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- [ ] 若 Remote Control 開啟，依使用者規則以 1920×1080 截圖並上傳。

## 第一批實作結果與判斷（2026-11-21，DEV）

實作對照第八節清單，細節與下列判斷請使用者確認：

1. **A2 衝突類型 3**：規格寫「同一品號在同一份檔案內重複出現」。內部複盤檔因多儲位本來就會有同品號多列（舊版也累加），若也算衝突會擋掉正常資料，所以實作為「同品號在**未盤點檔案**內重複」才算；內部複盤檔多列只在庫存量不一致時才衝突。
2. **A3**：已成功的預盤檔保留在畫面上、失敗的可單獨重傳、同名檔以新的取代；要整批重來請按「移除此檔」。
3. **A7**：舊版不去重已在 DEV 實測確認（同檔連續匯入兩次共 4 筆）。去重在資料庫函式內進行（同一交易、advisory lock），規則為「資料庫已有幾筆完全相同的明細，就略過檔案中的前幾筆」，同檔內相同列不因同檔重複而略過。沒有新增唯一索引（同檔允許相同列，無法用唯一約束）；正式區上線前須先套用 `m6-sql/` 的函式。
4. **並行填寫會員編號**：舊版先讀後寫，兩個請求都回 200（後寫覆蓋）；新版 workspace 編輯改為「會員編號仍為空才寫入」的單一條件更新，第二個回 409。舊 route 不動。
5. **1F 商品檔欄位辨識**：新舊對跑一致的樣本（標題在第二列、欄位順序不同、庫存別名重存、儲位別名庫位、較長欄名、含「庫存」的兩個欄位、小寫 un、標題在第一列兩版皆失敗）。**不一致且未自行決定**的三項：標題前後空白（舊版去空白，新版不）、品號空白的列（舊版保留，新版略過）、庫存非數字（舊版 NaN 仍匯入，新版拒絕）；另預盤數量非數字同樣舊版收下、新版拒絕。皆已列入白名單待核可。
6. **FKRS 最後一號**：舊版會去除前後空白並轉大寫；新版純函式原本沒有，已對齊舊版（這是補齊舊版行為，不列差異）。
7. **inventory-view-implies-import-delete**：第一批查證舊版相同；其後 2026-11-22 盤點權限問卷已裁定新舊一起收緊，見文末「盤點權限分開（2026-11-22 問卷）」。
8. 沒有真實盤點樣本：所有對跑使用 `tests/fixtures/m6/` 自造檔，**尚未用真實樣本驗證**。

## 第二批實作結果與判斷（W26 縮小版、W27、W28；2026-11-22，DEV）

範圍：共用 Excel 工具、商品主檔頁與 API、Excel 匯入（先預覽再確認）。W29 缺貨回報不在本次。併購藥局商品整理依 B5 不移植。

1. **W26**：新增 `vue-workspace/src/lib/xlsx.ts`（`loadXlsx` 動態載入、`readSheet`、`pickColumns`、`downloadXlsx`、`buildWorkbook`、`sheetToRows`）。`inventory-files.ts` 與關係會員範本下載已改接，行為不變（M6-W25 測試全過）。`UploadPicker.vue`／`lib/upload.ts` 只收圖片與 PDF，Excel 匯入用原生選檔，所以沒有擴充；不做相機元件與 `ImageLightbox.vue`（延到 W31）。`scripts/test-workspace-inventory-files.cjs` 的 vm 載入器補了 `./xlsx` 的 stub。
2. **資料表盤點**：DEV 已有 `products_master`（0 筆）與 `product_barcodes`（0 筆），RLS 只放行 `store.products_master.manage`。`acquisition_*` 不盤點、不碰。新增 `products_master_operation_logs`（`supabase/workspace-dev/20261122100000_m6_products_master_logs.sql`，附 rollback 與 `m6-sql/` 草稿）。
3. **發現：舊版搜尋對非管理者實際查不到**。舊 API 只檢查登入，但資料表 RLS 只放行管理權限者，所以沒有商品主檔權限的店長用舊搜尋會得到空結果。新版 API 層判斷登入即可（B1），改用 admin client 讀取，只回編號、名稱、單位。已列白名單 `m6-w27-search-login-only`（approvedBy null，待使用者確認）。
4. **發現：舊版匯入在 DEV 對所有測試帳號都回 403**（含 admin 與只有商品主檔管理權限的帳號）。原因是舊 route 用登入者身分去讀 `user_roles`／`role_permissions`，受資料表權限影響查不到。對等測試因此先打真的舊 API，回 403 時改用「逐字複製舊版邏輯」的等價寫入（舊版欄位別名、第一個工作表、upsert、`is_active:true`）比對最後資料表內容。正式區行為未驗證（不連正式區）。
5. **權限語意**：新 API 一律走 `context()`（正式區 `has_permission` 語意：不檢查 `roles.is_active`、無 DB admin 繞過、只有 `profiles.role==='admin'` 應用層後備）。整合測試涵蓋 `roles.is_active=false` 仍有權限、`user_roles` 失效或 `is_allowed=false` 即失去、一般帳號被設為 admin 才能繞過。管理權限碼登記在 `lib/workspace/modules.ts` 的 `moduleCodes.productsMaster`，session capability 為 `productsMaster`。
6. **API**（`app/api/workspace/products-master/[[...path]]`）：`GET search?q=`（登入即可，編號開頭優先、再補包含，最多 20，只含啟用，特殊字元跳脫）、`GET`（清單，管理權限，每頁 50、`q`、`include_inactive=1`、頁碼超出回最後一頁）、`POST`（新增）、`PATCH :id`（只能改名稱、單位）、`POST :id/deactivate`、`POST :id/reactivate`（已是目標狀態回 `changed:false`，不重複寫紀錄）、`POST import/preview`、`POST import`。寫入類都檢查 Origin。
7. **搜尋跳脫**：LIKE 的 `%`、`_`、反斜線跳脫；清單與「包含」搜尋用 `or()` 時，值整個以雙引號包起來（`orContains`），逗號、括號不會改寫條件。唯一殘留：PostgREST 把 `*` 當萬用字元別名。
8. **W28 匯入**：前端用 `readSheet` 讀第一個工作表、`pickColumns` 依舊版別名挑欄位（與舊版 normalize 逐列一致，單元測試對照），送 JSON 列給預覽與確認兩支 API（兩支都會在伺服端重新清理與重算；確認時以寫入當下的資料重新計算）。預覽顯示新增、更新（含重新啟用）、略過與原因（缺編號、缺名稱、檔內重複只採最後一列、內容相同、過長）。單次上限 5000 筆（前後端都擋），寫入每 500 筆一批；讀現有資料的 `in()` 因網址長度限制改以 100 個一批。中途失敗會回報已寫入筆數並記一筆失敗紀錄，重新匯入同一份檔案會自動略過已寫入的。
9. **白名單**（`tests/parity/allowlist.json`、`plain.json`）：使用者問卷選擇者（approvedBy `user (2026-11-21 M6 規格問卷)`）：`m6-w28-import-preview-confirm`（B4）、`m6-w27-deactivate-permission`（B2）、`m6-w27-reactivate-edit-create`（B2、B3）、`m6-w27-acquisition-dropped`（B5）、`m6-w27-nav-products-master-inpage`（B5 導覽）。approvedBy null（假設或修正，待確認）：`m6-w27-search-login-only`、`m6-w27-search-escape`、`m6-w27-list-pagination`、`m6-w28-import-count-semantics`、`m6-w28-import-duplicate-last-wins`、`m6-w28-import-limit-5000`、`m6-w27-operation-logs`。
10. **測試**：`tests/unit/M6-W27/`（28 項：規則、別名對照舊版、xlsx 工具、不含併購）、`tests/integration/M6-W27.products-master-roles.spec.ts`（角色與權限語意、搜尋、分頁、CRUD、匯入含 1100 筆分批與 5000 上限、操作紀錄）、`tests/e2e/M6-W27.products-master-journey.e2e.spec.ts`（桌機與手機：無權限角色沒有入口、管理者完成匯入預覽到重新啟用）、`tests/parity/M6-W27.products-master.spec.ts`（新舊搜尋逐筆相同、清單集合、同一份 Excel 最後資料表相同、停用、舊頁併購分頁）。測試商品編號 `ZT2038-<runId>-…`，sweeper 以 `ZT2038-T%` 作後備。
11. 順帶修正：`tests/fixtures/t03-nav-baseline.json` 加入「商品主檔」與先前 G19 已存在但漏登記的「總務組」（29 到 31），並把「服務中心首頁」過時的標題「新版已可使用」改為「待我處理0」（M7/M8 第 6 批已移除該提示）；T03 回歸測試因此恢復全綠。

## 第三輪補充：第二批 W29 商品部缺貨回報實作結果與判斷（2026-11-22，DEV）

範圍：W29 缺貨回報（頁面 `Merchandise.vue`、`app/api/workspace/stockout/**`、`lib/stockout/response.ts`、`lib/workspace/stockout.ts`、DEV 交易函式）。併購、W30 以後不在本次。

1. **規則（`lib/stockout/response.ts`，純函式、today 由呼叫端注入、日期一律 Asia/Taipei）**：C1 15 天算已回覆、30 天內仍提醒（與舊版逐日一致）；C3 狀態由目前有效回覆衍生；C6 同門市同商品 7 天內重複回報要確認；月份分組、月份篩選、近 30 天、重複判斷都用台北時間；清單每頁 30（上限 100）、歷程每頁 10（上限 50）；預設分頁依權限（只有提交 -> 我的門市，有查看全部或回覆 -> 全部門市）。
2. **API**（`app/api/workspace/stockout/[[...path]]`，權限碼沿用 `cross_dept.stockout.submit／view_all／respond`，capabilities 隨清單與 session 回傳）：`GET /` 清單（`tab`、`store_id`、`q`、`status`、`month`、`date_range`、`page`、`pageSize`；回傳 items、responses、monthBuckets、stats、stores、capabilities、defaultTab）、`POST /` 新增回報、`DELETE /:id`、`GET /responses`、`POST /respond`、`DELETE /responses/:code`、`GET /history`。寫入類都檢查 Origin。錯誤訊息與刪除確認文字「確定刪除這筆回報？」沿用舊版。
3. **b 門市範圍**：POST 回報伺服端檢查——商品部（查看全部／回覆）不限，只有提交權限者只能替自己管轄（`store_managers`）的門市回報，否則 403；店長沒有任何管轄門市時一律 403。**讀取面也同樣限制**（舊版任何有提交權限者可指定任一門市查看；新版 403），列為白名單。
4. **C3 與資料庫觸發器**：DEV（與正式區舊 migration）有舊版的觸發器 `sync_stockout_report_status`，回覆寫入時會把同商品 pending 的回報改成 responded。新版 API 不寫、不讀回報的 `status` 欄位來判斷畫面狀態（回報時仍依舊版寫入一個初始值以保持舊頁相容）；統計與篩選一律由目前有效回覆算出，到貨日過期後自動回到待回覆。篩選與統計因此在伺服端對整個查詢範圍計算（舊版只算目前這一頁），已列白名單。
5. **i 交易**：商品部回覆的「更新或新增目前回覆」與「寫歷程」在 `workspace_stockout_respond` 內同一交易；刪除回報與「最後一筆清回覆」在 `workspace_stockout_delete_report` 內同一交易並以商品編號加鎖。DEV 檔 `supabase/workspace-dev/20261122110000_m6_stockout_rpc.sql`（附 rollback，已套用 DEV，`scripts/apply-workspace-m6-dev.cjs` 一併套用），正式區草稿在 `m6-sql/`。
6. **g 刪除商品部回覆**：舊版畫面**沒有**這個按鈕（舊頁唯一的 DELETE 是刪除回報，且有 confirm）；新版畫面同樣沒有，但 API 提供與舊版相同規則的 `DELETE /responses/:code`（respond 或 view_all）。單元測試鎖住這兩件事。
7. **d 刪除規則**：與舊版對等——商品部可刪任意，其他只能刪自己的；刪到該商品最後一筆回報時同時清掉目前回覆，歷程保留。
8. **畫面**：`vue-workspace/src/pages/Merchandise.vue`，導覽「商品部」新增 kind `merchandise`（`modules.ts` 的 `moduleCodes.stockout`、session capability `stockout`、`page-kinds.ts`、`workspace-page-meta.ts`、`workspace-pages.ts`）。商品搜尋重用 `products-master/search`：80ms debounce、較舊的請求結果不覆蓋新結果、選定後帶名稱（唯讀）與單位並聚焦需求數量；商品部回覆提醒視窗、近 30 天與歷史月份、回覆歷程、已回覆在店長視角預設展開。版面小差異列在白名單 `m6-w29-ui-layout`。
9. **白名單**（`page: merchandise`）：使用者問卷選擇（approvedBy `user (2026-11-21 M6 規格問卷)`）：`m6-w29-status-derived`（C3）、`m6-w29-duplicate-warning`（C6）。approvedBy null（假設、修正、取捨，待使用者確認；已加入 T02 的 STILL_PENDING）：`m6-w29-post-store-scope`、`m6-w29-list-store-scope`、`m6-w29-taipei-dates`、`m6-w29-search-escape`、`m6-w29-reply-transaction`、`m6-w29-server-side-status`、`m6-w29-qty-integer`、`m6-w29-nav-merchandise-inpage`、`m6-w29-ui-layout`，以及新舊對跑發現的三條：`m6-w29-store-name-visible`、`m6-w29-history-visible-submit`、`m6-w29-viewall-reply`（見下一點）。
10. **測試**：`tests/unit/M6-W29/`（規則、與舊版 15／30 天逐日一致、台北時間邊界、C6、權限判斷；導覽與頁面不含「併購」、g 兩項、搜尋延遲與序號）、`tests/integration/M6-W29.stockout-roles.spec.ts`（臨時角色：店長 A／B、沒有管轄門市的提交者、只有回覆、只有查看全部、無權限，加 admin；權限矩陣、正式區 has_permission 語意、門市範圍、C3 衍生、分頁與跳脫、台北時間、C6、交易失敗不留半套、並行回覆、歷程分頁、刪除規則）、`tests/e2e/M6-W29.merchandise-journey.e2e.spec.ts`（桌機與手機：無權限者沒有入口 -> 店長搜尋與送出 -> 重複提示 -> 商品部回覆與編輯 -> 店長看到已回覆並再回報看到提醒 -> 刪除結案）、`tests/parity/M6-W29.stockout.spec.ts`（新舊 API 對跑）。測試資料 `ZT2038-<runId>-…`，門市只用 VW001／VW002，sweeper 以 `ZT2038-T%` 作後備。
10-1. **對跑發現（舊版資料表權限與 API 判斷不一致，DEV 實測）**：資料表 RLS（`p1h_stockout_*`，正式區 migration 同樣有）只允許 respond 寫入回覆、只允許 view_all／respond 讀歷程。結果：(1) 只有 view_all 的帳號在舊版有回覆按鈕、API 放行，但儲存回 500，新版（admin client、照舊版 API 判斷）放行並寫入——**是否收緊為只有 respond 才能回覆，請使用者決定**；(2) 只有 submit 的店長在舊版展開回覆歷程永遠是空的，新版看得到；(3) 商品部帳號在舊版清單讀不到門市資料（門市欄空白），新版都顯示。另：刪除回報在舊版沒有缺貨權限閘門（只看本人或商品部），新版照舊，不另加閘門。
11. **待使用者確認**：上述 null 白名單；正式區上線前須先建立兩個交易函式並確認 `stockout_product_responses.product_code` 唯一；舊版畫面不顯示回報人與回覆人姓名（舊 API 不回傳），新版維持；沒有用真實缺貨資料驗證。

## 第二批最終驗證（2026-11-22，DEV）

- vue-tsc 與根目錄 tsc 無錯誤。依序跑 M6-W27（單元 28、其餘 14 項皆過）、M6-W29（單元 25、30 項皆過）、M6-W25（單元 62 過 1 略過、25 項過）、M6-P07（單元 37、24 項過）、M0 回歸（單元 10、319 項過），全部單元 2428 過 1 略過。略過的一項是 W25 真實盤點樣本對照（沒有真實樣本）。
- 驗證時發現 T02 的「待核可清單」漏登 `m6-w28-import-template-format`、`m6-w27-ui-and-list-permission`、`m6-w29-input-validation` 三條（approvedBy 為 null 的假設與修正），已補進 `tests/unit/T02/parity-framework.test.ts`，沒有改任何功能。
- 驗證後 DEV 測試殘留：商品、缺貨回報、回覆、歷程、操作紀錄、臨時帳號與角色皆為 0。

## 盤點權限分開（2026-11-22 問卷）

老闆在「盤點權限問卷」（docId `inv-perm-ai-cap`）的四項裁定，已於新版與舊版一起實作（DEV）：

1. **P1 匯入、刪除各自權限**：只有 `inventory.result_analysis.import` 能匯入盤點結果、只有 `inventory.result_analysis.delete` 能刪除。`inventory.inventory.view`、`inventory.inventory.access`、`inventory.result_analysis.view_own`（舊版所謂任一檢視權限）只能檢視；店長、代理店長、盤點檢視（inventory_view）、導覽唯讀（navigation）都變成只能看。
2. **P2 新舊一起收緊**：新版 workspace 與舊版 `app/api/inventory/result-analysis/route.ts` 同步。舊版只改 `canImportInventoryResultAnalysis`／`canDeleteInventoryResultAnalysis` 兩個權限判斷與舊頁面（`app/inventory/page.tsx`）的按鈕顯示旗標，其他舊版行為不動；`hasAnyInventoryLegacyViewPermission` 仍用於檢視範圍判斷，沒有更動。
3. **P3 inventory.manage 不隱含**：只有 `inventory.manage` 的帳號匯入、刪除都是 403（仍可調整盤差原因門檻與檢視）。匯入、刪除以外只有專屬權限本身，加上應用層 `profiles.role = 'admin'` 後備（`hasPermission` 內的管理員判斷，語意與正式區 has_permission 相同：不檢查 `roles.is_active`，也沒有資料庫端管理員放行）。
4. **P4 沒權限就看不到按鈕**：新版 Vue 頁（`Inventory.vue` 的 `canImport`／`canDelete`，原本就是 `v-if`）與舊頁都是隱藏而非反灰；伺服端同時回 403。

### 修改位置

- `app/api/inventory/result-analysis/route.ts`：匯入只認 `inventory.result_analysis.import`、刪除只認 `.delete`。
- `app/api/workspace/session/route.ts`：capabilities 的 `importInventory`、`deleteInventory` 改為只認各自的專屬權限。`/api/workspace/inventory` 轉發舊 route，所以兩邊判斷同一份。
- `app/inventory/page.tsx`：舊頁匯入、刪除按鈕旗標。
- Vue 頁：`vue-workspace/src/pages/Inventory.vue` 原本就以 capabilities 做 `v-if`，旗標改了之後不需要改頁面（沒有重新打包）。
- 白名單 `inventory-view-implies-import-delete`：approvedBy `user (2026-11-22 盤點權限問卷)`，說明改為已收緊；因驗證規則要求 `decision: fix` 必須維持 `approvedBy: null`，已執行完畢的決定不再帶 `decision` 欄位（`plain.json` 文字同步）。
- `tests/fixtures/role-matrix.json`：navigation、store_manager、acting_manager、inventory_view、ga_store_manager_b 的 `importInventory`／`deleteInventory` 改為 false；inventory_edit 只有匯入、inventory_delete 只有刪除；admin、inventory_team 兩者皆 true。

### 資料表 RLS 與 RPC 查證（只讀 migration，無需 DEV 修補）

- `inventory_result_batches`、`inventory_result_items`、`inventory_result_settings` 都啟用 RLS，`authenticated` 角色有 DML 授權但受政策限制（`20260724025452_production_legacy_inventory_inspection_monthly_compatibility.sql`）。
- 寫入政策（batches 的 write、items 的 update、settings 的 write）要求 `inventory.result_analysis.import` 或 `.delete`（settings 只有 import）；**只有檢視權限的使用者（含店長、`inventory.manage`）無法直接寫入這三張表**。`items` 沒有 INSERT／DELETE 政策，直接寫入一律被拒絕。沒有任何 RPC 可讓檢視者寫這三張表。
- 殘餘缺口（不是這次裁定的範圍，也未修補）：`inventory_result_batches` 的寫入政策是「import 或 delete」且涵蓋所有指令，所以只有匯入權限者理論上能以自己的 JWT 直接刪批次、只有刪除權限者能直接新增批次，繞過 API 檢查。API 一律走 service role，畫面與 API 不會觸發；若要補，需把政策拆成 INSERT（import）、DELETE（delete）、UPDATE（兩者），屬正式區 migration 調整，請老闆決定。
- 另外：差異原因門檻 API 用 `inventory.manage`，但 `inventory_result_settings` 的寫入政策是 import，兩者不同（此為舊有行為，未更動）。

### 上線前檢查

`docs/vue-workspace/parity-plan/m6-sql/inventory-perm-check.sql`：**唯讀**（只有 SELECT）的正式區查詢，列出角色與各盤點權限的持有人數，並列出上線後會失去匯入或刪除的人。請老闆或 DBA 上線前手動執行，本批沒有對正式區執行。

### 測試與結果（DEV）

- `tests/integration/M6-W25.inventory-roles.spec.ts`：新舊 API 與 session 旗標對 12 個帳號一致，並對照 role-matrix；真實匯入、刪除（舊 API 與 workspace API 各一組）：admin、inventory_team 可匯入與刪除；inventory_edit 可匯入、刪除 403；inventory_delete 可刪除、匯入 403；inventory_view、navigation、store_manager、acting_manager、只有 `inventory.manage` 的臨時角色（`m6_test_inv_manage_only`，已查證不與 role-matrix 或 roles 表撞名）匯入與刪除皆 403，仍可檢視（GET 200）；被拒絕後批次仍在。
- `tests/e2e/M6-W25.inventory-perm-journey.e2e.spec.ts`（桌機與手機）：盤點組匯入 2038-03 的 VW001 批次 -> 店長（VW001、ZT01）看得到資料、沒有匯入與刪除按鈕 -> 只有刪除權限者看不到匯入、可刪除。冒煙測試中檢視者與店長的匯入按鈕預期改為不存在。
- 測試資料：檔名 `m6w25perm-<runId>-…`、年月 2038-03、門市 VW001，只刪自己的（sweeper 登記 `inventory_result_batches.source_file_name`）。
- 結果：`node tests/run-all.cjs --layers all --page M6-W25 --no-sweep` 全綠（Playwright 29 項通過；單元層含 T02 白名單與導覽測試一併通過），根目錄 tsc 無錯誤。

## 第三批 3b 實作結果與判斷（總覽，2026-11-22 至 11-23，DEV）

3b 含 W32 督導管理日誌與 W33 語音；兩段的詳細判斷見下面兩節，各角色可見範圍清單（Z3）見 `m6-batch3b-roles.md`。Z5 已由 2026-11-22 問卷決定為每月 US$30。最終驗證（2026-11-23）：vue-tsc 與根目錄 tsc 無錯誤（修正 `lib/workspace/supervisor-log.ts` 一處 Set 展開的 tsc 錯誤）；依序跑 M6-W32、M6-W33、M6-W29、M6-W27、M6-W25、M6-P07、M0 與完整單元層，結果記在 `docs/CURRENT-DEV-STATUS.md`。

## 第三批 3b：W32 督導管理日誌實作結果與判斷（2026-11-22，DEV）

範圍：W32（頁面 `SupervisorLog.vue`、`app/api/workspace/supervisor-management/**`、`lib/workspace/supervisor-log.ts`、`lib/supervisor-management-log/workspace-rules.ts`、DEV 軟刪除函式）。W33 語音錄音與 AI 摘要不在本次，頁面沒有錄音入口；舊版頁面與 `app/api/supervisor-management-log/**`、`lib/supervisor-management-log/{access,validation,voice}.ts` 一行未改。

1. **沿用舊版同一組資料表與權限碼，不建新表**：`supervisor_management_cases／records／followups／case_events／daily_plans／categories`，六個 `supervisor.management_log.*` 權限碼（導覽、session `capabilities.supervisorLog` 都用這六個任一）。欄位驗證直接 import 舊版 `validation.ts`（三欄必填、門市目標必選門市、系統欄位不可由前端指定、列舉與 UUID、日期格式），不重寫。
2. **E1 三層可見範圍**：舊版資料庫政策本來就是三層（管理看全部；看團隊看自己管轄門市 `store_managers`（store_manager／supervisor／area_manager）；一般看自己建立或指派給自己的；update_own 看自己建立的；follow_up 看被指派與管轄門市的），新版把同一組規則寫成純函式 `caseVisible`／`caseScopeFilter`（查詢條件）／`planVisible`，以 admin client 讀取加應用層範圍過濾。單元測試用 64 種權限組合與 3 種管轄門市逐列證明「查詢條件」與「可見判斷」一致；整合測試用真實資料逐角色比對。看不到的案件一律 404。
3. **權限語意（本輪統一）**：讀取走正式區 `has_permission` 語意（不檢查 `roles.is_active`、沒有資料庫端管理員角色代碼放行，只有 `profiles.role==='admin'` 應用層後備）。**寫入另受舊版資料表觸發器與 RLS 檢查**（新版以登入者身分的 client 寫入，`created_by`／`updated_by` 才正確），而舊版輔助函式 `supervisor_management_current_user_has_permission` 會檢查 `roles.is_active`，所以「角色停用」的帳號在新版可讀、不能寫（回 403 與說明，不是 500）。已列白名單 `m6-w32-e1-three-tier-visibility`。
4. **E2 修改與刪除**：案件可修改＝管理者全部；update_own 的建立者且未結案；follow_up 的被指派者／管轄門市且未結案（同舊版）。**刪除（新）**：管理者全部；其他人只能刪自己建立、未結案的案件（需 update_own）；紀錄與追蹤只能刪自己建立的（案件仍可修改），規劃只能刪自己未完成的。刪除一律軟刪除，記錄刪除者、時間、原因，並寫時間線事件（`SOFT_DELETE`、`RECORD_SOFT_DELETE`、`FOLLOWUP_SOFT_DELETE`）。新增「修改紀錄」（本人或管理者，寫 `RECORD_EDIT`）。管理者可用 `GET cases/:id?deleted=1` 事後追查已刪除案件。
5. **資料庫**：新增 `workspace_supervisor_soft_delete(kind, id, reason)`（`supabase/workspace-dev/20261122130000_m6_supervisor_log_rpc.sql`，附 rollback，已套用 DEV，`scripts/apply-workspace-m6-dev.cjs` 一併套用；正式區草稿 `m6-sql/`）：以呼叫者身分執行，**先軟刪紀錄與追蹤、最後才軟刪案件**同一交易，並寫事件。**發現舊版缺陷**：舊版 `supervisor_management_soft_delete_case` 先軟刪案件，之後紀錄的驗證觸發器因案件已刪除而拒絕，所以含有紀錄的案件在舊版刪不掉（500，DEV 實測）。每日計畫的軟刪除沿用舊版函式。
6. **結案欄位（舊版缺陷）**：資料表要求 `RESOLVED／CLOSED` 必須有 `resolved_at`、`CLOSED` 必須有 `closed_at`，舊版 API 沒處理，所以舊版把案件改成已改善或已結案會失敗（500）；新版 `statusFields` 依新舊狀態寫入、離開時清空，並寫 `STATUS_CHANGE` 事件；結案後只有管理者能再改（可重新開啟）。
7. **E3 今日工作台完整移植**：`GET today`（規劃、追蹤佇列逾期／今天／七天內分桶、今日紀錄、摘要；E4 逾期只標示）、`daily-plans` 清單／詳情／建立／修改／軟刪除、狀態流轉（開始處理帶入新增紀錄表單、完成、取消）、關聯案件（必須在可見範圍）。日期預設台北今天（舊版後端用 UTC 日期）。
8. **API**（皆需登入，寫入類檢查 Origin）：`cases`（GET 清單、POST）、`cases/:id`（GET、PATCH、DELETE）、`cases/:id/records`（GET、POST）、`cases/:id/records/:rid`（PATCH、DELETE）、`cases/:id/followups`（GET、POST）、`cases/:id/followups/:fid`（DELETE）、`cases/:id/timeline`、`today`、`daily-plans`、`daily-plans/:id`、`options`、`categories`。紀錄的對象欄位缺漏時由案件帶入、需追蹤時負責人預設為指派人或建立者；AI 產生的紀錄 `ai_confirmed_by` 一律記為送出者（AI 不可略過人工確認）；刪除都要原因；搜尋關鍵字跳脫（含逗號括號）；頁碼超出回最後一頁；每頁上限 100。
9. **追蹤需要 follow_up 權限**：舊版資料表政策要求新增追蹤者同時持有 `follow_up`（只有 `manage` 不夠，DEV 實測舊版回 500）。新版判斷與舊版一致，只是狀態碼改成 403／404 並附說明；**請使用者確認是否讓管理者也能新增追蹤**（需改正式區資料表政策，本輪不動 migrations）。
10. **選項**：門市候選管理者全部、其他人只有自己管轄的門市；員工只在指定門市或搜尋時回傳（舊版固定前 300 筆）。DEV 的 `stores` 政策是 DEV 專用，與正式區是否相同未驗證。
11. **畫面**：兩個分頁（今日工作台、管理案件）；案件詳情、新增編輯、紀錄、追蹤、規劃、刪除原因都在工作頁內視窗；沒有權限的按鈕不出現（伺服端回 `can_edit`／`can_delete`／`permissions`）；時間線在詳情最下方。導覽 `kind supervisor-log`，`T03` 基準新增「督導管理日誌」（32 到 33）。
12. **白名單**（`page: supervisor-log`）：問卷選擇（approvedBy `user (2026-11-21 M6 規格問卷)`）：`m6-w32-e1-three-tier-visibility`、`m6-w32-e2-own-delete-case`、`m6-w32-e2-own-delete-plan`、`m6-w32-e2-soft-delete-with-records`、`m6-w32-e2-own-edit-delete-records`、`m6-w32-e3-daily-plan-full`。approvedBy null（待使用者確認，已加入 T02 的 STILL_PENDING）共 16 項：結案欄位、今日預設台北日期、員工選項、門市選項範圍、詳情門市與建立者名稱、搜尋跳脫、分頁超出、AI 確認人、看不到的案件寫入回 404（改、新增紀錄、新增追蹤三條）、驗證狀態碼、時間線、已刪除查詢、版面、導覽。
13. **測試**（page id `M6-W32`）：`tests/unit/M6-W32/`（規則 23 項、頁面與 API 契約 9 項）、`tests/integration/M6-W32.supervisor-log-roles.spec.ts`（8 個臨時角色加 admin，權限矩陣、三層可見範圍與純函式逐列一致、E2 修改刪除、結案欄位、紀錄與追蹤、軟刪除與事件、今日工作台分桶、每日計畫、選項、正式區語意）、`tests/e2e/M6-W32.supervisor-journey.e2e.spec.ts`（桌機 1440 與手機 390：無權限者無入口 -> 督導建立案件、紀錄、追蹤、規劃、結案 -> 團隊檢視者唯讀 -> 管理者看全部、重新開啟、刪除紀錄與案件並留事件）、`tests/parity/M6-W32.supervisor-log.spec.ts`（12 項：清單、詳情、今日、計畫、選項、四種寫入資料列、各操作各角色狀態碼、結案、含紀錄刪除、搜尋、分頁、AI 確認人、權限語意）。測試資料標題 `ZT2038 M6W32 <runId> …`，門市只用 VW001／VW002，只刪自己的（以標記與測試帳號擁有找出，依 FK 順序硬刪事件、追蹤、紀錄、規劃、案件）。
14. **尚未驗證／待決定**：沒有真實督導日誌樣本；舊版資料表政策與觸發器在正式區是否與 DEV 完全相同未連線核對（只讀 migration）；管理者新增追蹤見第 9 點；W33 語音（含每月 USD 30 上限、80%／100% 通知、同意紀錄）下一步另做。

## 第三批 3b：W33 督導語音與 AI 摘要實作結果與判斷（2026-11-22，DEV）

範圍：W33（語音錄音元件、上傳包裝、草稿審核畫面、workspace 語音 API、同意 E5、逐字稿可見範圍 E6、退回與限制 E7、每月 US$30 上限與通知）。頁面仍是 `SupervisorLog.vue`（案件詳情的「語音口述」入口；系統管理員多一個「AI 用量」頁籤）。舊版頁面與 `app/api/supervisor-management-log/**` 行為不變；舊版 `lib/supervisor-management-log/voice.ts` 只加了不影響原行為的選項參數（可換 fetch、限制輸出 token）與可傳入候選名單的比對函式。

**老闆 2026-11-22 問卷決定（取代 Z5「金額待提供」）**：每月 OpenAI 費用上限 30 美元（以美元存放、不換匯、可設定）；估算費用達 80% 通知系統管理員、達 100% 自動停用 AI 並退回手動文字稿與本機規則、再通知系統管理員；只通知系統管理員（首頁提醒）；每月 1 日（台北時間）歸零；費用每次呼叫事前保守估算、無條件進位、不查 OpenAI 帳單 API。

1. **費用估算（純函式 `lib/supervisor-management-log/voice-ai-rules.ts`）**：語音轉文字每分鐘 US$0.006（取 whisper-1 價，比 gpt-4o-mini-transcribe 的 0.003 貴一倍）、不足一分鐘算一分鐘；後端看不到真實音檔長度（音檔不解析、不保存），所以取「前端回報秒數」與「依大小反推的最短秒數（每秒最多 16KB）」較大者。草稿整理以「固定提示 1200 token 加每字 2 token」估輸入、以請求的 max_tokens 上限 1500 估輸出；沒列價格的模型一律用 gpt-4o 價格。價格換成整數 micro-USD 再算，避免浮點誤差。單次最壞約 US$0.07，一個月 30 美元約可做數百次最長錄音。
2. **帳本與月份歸零**：DEV 新增五張表（`workspace_ai_settings`、`workspace_ai_usage_ledger`、`workspace_ai_alerts`、`workspace_ai_consents`、`workspace_supervisor_voice_transcripts`，皆啟用 RLS 且沒有任何登入者政策，只有 service_role）與兩個函式（`workspace_ai_reserve`、`workspace_ai_month_spent`）。月份鍵是台北時間的 YYYY-MM，累計只算當月，所以 1 日零點自動歸零、不需要排程。`workspace_ai_reserve` 在同一交易內對月份加鎖、檢查累計、寫入估算費用，並記錄第一次達 80%／100% 的通知；累計已達上限就拒絕。拒絕條件是「已達上限」，所以累計最多只會比上限多一次呼叫的費用（約 0.07 美元）；並行 14 個呼叫的實測只成功 9 個（上限剩 5 分錢、每次 0.6 分）。
3. **失敗也算錢（保守）**：預約在呼叫 OpenAI 之前，所以 AI 失敗、逾時的呼叫仍計入估算；被驗證擋下的請求（空檔、過大、過長、格式錯、沒同意）不計。
4. **AI 自動停用**：轉文字與草稿都先查可用性（沒同意、沒設定、額度用完）。額度用完時轉文字回 200 與 `fallback:true`（原因 CAP_REACHED），草稿退回本機規則並標示「這份草稿未經 AI 整理」；管理員調高上限或下個月 1 日立即恢復。上限 0 代表一開始就停用。
5. **E5 同意**：錄音前一定先顯示告知（版本號 `NOTICE_VERSION`，內容在規則檔），勾選同意後才出現錄音；同意記在 `workspace_ai_consents`（誰、哪一版、何時）；沒同意時轉文字回 403（`CONSENT_REQUIRED`），草稿只用本機規則、不送 OpenAI。告知改版就換版本、需重新同意。
6. **E6 逐字稿**：儲存紀錄時另存在 `workspace_supervisor_voice_transcripts`（不放在紀錄 metadata，metadata 只記來源 source、ai_provider）；只有建立者與管理者（含系統管理員）讀得到；其他看得到案件的人（例如團隊檢視者）看得到紀錄，但 API 回 403、案件詳情的 `has_transcript` 也是 false，不洩漏有無；看不到案件者 404。登入者直接查資料表一列都讀不到（測試用督導本人的登入身分直接查，結果為空或被拒）。
7. **E7 限制與退回**：錄音上限 10 分鐘或 10MB（容許 3 秒計時誤差），超過回 400 且不花費用；格式 WebM、MP3、M4A、WAV（另接受 audio/mp4 與 audio/x-m4a 標示）。錄音元件以 32kbps 錄製（10 分鐘約 2.4MB，也在 Vercel 函式請求大小限制內）、滿 10 分鐘自動停止；錄音只暫存在瀏覽器記憶體（可試聽、重新錄音、上傳失敗重試），轉成文字或離開畫面就丟掉；伺服端不存音檔、不存 OpenAI 原始回應與標頭，錯誤只丟固定文字。
8. **AI 永遠不直接寫入**：草稿 API 只讀不寫業務資料表，`review_required` 固定 true，回傳三欄缺漏清單；草稿畫面的「套用」只把內容帶進「新增管理紀錄」表單，還沒有儲存，要人工按儲存，伺服端仍用舊版 `validateRecordPayload` 擋下發現、判斷、動作任一欄缺漏。儲存時 `ai_generated` 只有 OpenAI 路徑才為 true（本機規則或手動不標）、`ai_confirmed_by` 固定是送出者，前端不能指定。
9. **比對候選依權限縮小**：管理者比對全部在職門市與員工，其他人只比對自己管轄門市與其在職員工；比對邏輯沿用舊版同一支（拆出 `matchEntitiesFromCandidates`）。
10. **通知只給系統管理員**：首頁卡片（`data-home-card="ai-usage"`，排在調店確認之後）只有系統管理員會收到，80% 與 100% 各一種文案，點擊開啟督導管理日誌；督導與一般管理者看不到金額。用量與上限 API（`GET ai-usage`、`PATCH ai-settings`）也只有系統管理員，上限 0 到 10000 美元、最多 2 位小數。通知紀錄每月每個層級只記第一次。「系統管理員」＝應用層 `ctx.isAdmin`（profiles.role 為 admin 或管理員類角色，與其他頁一致）。
11. **測試站用假的 OpenAI**：`tests/support/start-test-server.cjs` 設 `WORKSPACE_OPENAI_MOCK=true` 並清掉 `OPENAI_API_KEY`；`lib/workspace/ai-openai.ts` 在 mock 模式用內建假 fetch（音檔內容以 MOCK-TRANSCRIPT: 開頭就回冒號後的文字、MOCK-FAIL 回 500；文字稿含 MOCK-AI-FAIL 草稿回 500）。每個語音測試開始前先確認 `voice/status.ai_mode` 是 mock，否則中止。沒有動 Vercel 的 `OPENAI_API_KEY` 處理。
12. **白名單**（page `supervisor-log`，共 13 條）：問卷選擇（approvedBy `user (2026-11-21 M6 規格問卷)`）：`m6-w33-e5-consent-notice`、`m6-w33-e6-transcript-stored`、`m6-w33-e7-fallback-warnings`、`m6-w33-e7-fallback-fields`、`m6-w33-e7-audio-limit-and-failure`；2026-11-22 問卷（approvedBy `user (2026-11-22 盤點權限問卷)`）：`m6-w33-z5-monthly-cap-usd30`、`m6-w33-cap-notify-admins`、`m6-w33-cap-admin-setting`；approvedBy null（待使用者確認，已加入 T02 的 STILL_PENDING）共 5 項：`m6-w33-record-ai-flag`、`m6-w33-record-voice-meta`、`m6-w33-entity-scope`、`m6-w33-ui-voice-flow`、`m6-w33-draft-too-long-status`（舊版文字稿過長回 500，新版 400）。
13. **測試**（page id `M6-W33`）：`tests/unit/M6-W33/`（費用估算、80%／100% 狀態與通知、台北月份歸零與跨年閏年、上限驗證、音檔驗證 29 項；假 OpenAI 與「mock 模式絕不碰真實網路」；靜態契約：不存檔、AI 不直接寫入、同意與逐字稿、資料庫與舊版不動）、`tests/integration/M6-W33.voice-ai.spec.ts`（15 項：權限矩陣、同意、轉文字與費用帳本、音檔限制、AI 與退回草稿、儲存與逐字稿、E6 可見範圍、上限 API、80% 通知、100% 自動停用與恢復、上限 0、月份歸零、並行不超過上限、舊路由不受影響）、`tests/e2e/M6-W33.voice-journey.e2e.spec.ts`（桌機與手機各 3 個劇本：督導先同意再錄音／重錄／失敗重試／AI 草稿審核／人工儲存／逐字稿、AI 失敗退回手動並標示未經 AI 整理；額度 80%／100%、首頁只有系統管理員看到提醒、管理員在「AI 用量」調整後恢復；團隊檢視者與管理者與無權限者的逐字稿與入口）、`tests/parity/M6-W33.voice.spec.ts`（本機規則草稿逐欄新舊相同、比對結果、各角色權限狀態碼、輸入檢查、儲存後資料列）。月額度情境直接在 `workspace_ai_*` 塞帶標記（model = M6W33-seed）的估算費用列，測完還原每月上限並刪除測試期間新增的列、通知與同意。
14. **尚未驗證／待決定**：(a) Vercel 函式請求大小（Hobby／Pro 預設約 4.5MB）與逾時未實測；錄音以 32kbps 讓 10 分鐘約 2.4MB 以符合，但使用者自己上傳大檔（目前畫面沒有上傳入口，只有錄音）若超過此限制要改直傳。(b) 價格表是寫死的估算值，OpenAI 調價後要更新（`CHAT_PRICE_PER_M`、`TRANSCRIBE_MICRO_PER_MINUTE`）；估算偏保守所以帳面會比實際 OpenAI 帳單高。(c) 沒有真實錄音與真實 OpenAI 驗證（規則禁止）；真實模型輸出品質與提示不在本次範圍。(d) 正式區要先建立 W33 的五張表與兩個函式（`m6-sql/20261122133000_m6_voice_ai.sql`）才能上線。(e) 管理員調低上限到目前累計以下時，不會補寫通知紀錄（首頁提醒是即時算的，會顯示）。(f) 同意只記「同意」，沒有「撤回」功能。
