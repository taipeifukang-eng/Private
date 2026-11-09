# M7、M8 總務：正式區 SQL 草稿（尚未執行，僅供使用者審閱）

對應 m7m8-spec.md 最後一節「上線前正式區要檢查或執行的 SQL」。這些檔案不得由 Claude 在 DEV 以外的環境執行，由使用者在正式區 SQL editor 自行審閱後執行。
規則：先唯讀檢查，再決定要不要補套；會寫入的 SQL 一律包含預覽、`BEGIN;`、備份與 rollback，並先在 DEV 測過。

## 第 1 批

| 檔案 | 性質 | 白話說明 |
|---|---|---|
| `00-readiness-check.sql` | 唯讀（只有 SELECT） | 一次列出總務上線準備度。P1：總務相關 migration 有沒有被記錄套用（沒有記錄不一定是缺，也可能是手動貼的 SQL，以 P2 為準）。P2：總務資料表與 RLS、設備與設施的 QR 欄位／唯一索引／空值、報廢自動作廢觸發器、關鍵函式、儲存空間（附件、工單照片，是否私有、單檔 20MB、僅圖片與 PDF）。P3：51 個總務權限碼是否都存在且啟用、各角色持有的總務權限數與人數、店長角色是否多了不該有的權限（設備、設施、料件、廠商、水電費）。只需要看 `status` 是 MISSING 或 WARN 的列。整份可直接貼上執行，不會改任何資料。 |

### 在 DEV 的檢查結果（2026-11-09）

- 51 個權限碼全部存在且啟用；總務相關資料表（分類、型號、設備、設施、料件、對象對應料件、附件、庫存、需求單、工單、廠商、水電帳單等）全部存在且啟用 RLS；`general-affairs-attachments` 儲存空間存在、私有、20MB、僅限圖片與 PDF。
- DEV 缺「報廢自動作廢 QR」觸發器：已用 `supabase/workspace-dev/20261109120000_m7m8_g01_asset_qr_auto_revoke.sql` 補齊（含 rollback 與 `scripts/apply-workspace-m7m8-g01-qr-revoke-dev.cjs`）。第 1 批用不到，第 2 批會用到。
- DEV 沒有 `maintenance-photos`（工單照片）儲存空間，也沒有建立它的 migration：第 5 批（工單）開工前要補，正式區要用本檔確認是否存在。
- 29 筆總務 migration 沒有出現在 DEV 的 migration 記錄，但對應物件實際都存在（手動套用），所以正式區也請以物件檢查為準。
- `ga_asset_code_sequences`（設備編號流水號表）設計上不開 RLS，改以撤銷 anon／authenticated 權限保護，檢查檔已視為正常。
