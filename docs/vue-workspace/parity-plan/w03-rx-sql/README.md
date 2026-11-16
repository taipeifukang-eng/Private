# W03 追加：處方箋 Google Sheet 匯入（正式區 SQL 草稿，尚未執行，僅供使用者審閱）

使用者 2026-11-16 問卷決定（R1~R7）：處方箋分頁可匯入 Google Sheet 下載的 xlsx（每店「一般／連續／加總」三列、每月一組「張數／金額」），先預覽再寫入，門市簡稱靠「簡稱對照表」對到門市。舊版（main 分支 `feat/prescription-gsheet-import`）先做，新版同步。
這些檔案不得由 Claude 在 DEV 以外的環境執行，由使用者在正式區 SQL Editor 自行審閱後執行。

| 檔案 | 性質 | 白話說明 |
|---|---|---|
| `01-prescription-aliases.sql` | 會寫入（新增 1 張表、1 個函式） | 新增「門市簡稱對照表」`prescription_store_aliases`（簡稱唯一，一個簡稱只對一家門市；只有後台程式能讀寫）與整批匯入函式 `import_prescription_report_batch`（存簡稱與寫處方箋月報在同一個交易，任何一步失敗整批還原）。不改任何既有資料表或資料（`monthly_prescription_reports` 完全不動）。檔案自己 `BEGIN` ... `COMMIT`，可重複執行，最後列出一列驗證結果（三個欄位都應是 true）。內容與 DEV 已測過的 `supabase/workspace-dev/20261116100000_vue_prescription_store_aliases.sql` 相同。 |
| `01-prescription-aliases-rollback.sql` | 會寫入（刪除新增的表與函式） | 撤回 `01`：刪除函式與簡稱對照表（簡稱內容會一併消失，月報資料不受影響）。撤回前請先把程式退回舊版，否則匯入功能會報錯。 |

## 套用順序與注意

1. **先執行 `01-prescription-aliases.sql`，再部署新版程式**（新程式匯入時會讀簡稱對照表並呼叫整批匯入函式；沒套用時匯入處方箋會回錯誤，其他處方箋功能不受影響）。
2. 舊版（Next.js 畫面）與新版（Vue 工作台）共用同一份資料表與函式，**只需要執行一次**。main 分支的同內容檔案是 `docs/prescription-gsheet-import-prod.sql`，兩邊擇一，不要重複（重複執行也不會出錯）。
3. 不需要在權限管理新增權限：匯入與修改對照表沿用「業績管理：編輯（`performance.edit`）」，查看沿用「業績管理：查看」。
4. DEV 已套用並測過（單元、整合、冒煙、e2e 桌機與手機）。
