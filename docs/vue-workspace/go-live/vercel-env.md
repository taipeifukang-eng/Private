# Vercel 環境變數設定手冊（新版工作台上線用）

給：老闆（不需要會寫程式）。
這份只列變數「名稱」和「該填什麼意思」，不放任何密碼或金鑰的內容。金鑰請自己從 Supabase 後台複製貼上，不要貼到聊天或文件裡。

## 先看這 5 句話

1. 第一次把程式合併進 `main` 時，**Production 不要設任何新變數**。沒設的話，新版工作台是「關閉」的：舊版網站完全照舊，選單沒有新版按鈕，新版的 API 一律回「新版暫時關閉」。這是安全的起點。
2. 每個變數都要選**範圍**：`Production`（正式網站）或 `Preview`（測試預覽，連測試資料庫）。Supabase 的三把鑰匙**絕對不要勾「All Environments」**，一定分開設，不然預覽版可能連到正式資料庫。
3. 改完變數**不會馬上生效**，一定要**重新部署（Redeploy）**才會套用。
4. 不要設 `NODE_ENV`。Vercel 會自己處理，手動設 `production` 會讓新版畫面無法建置。
5. 有問題想緊急關掉新版：把 `WORKSPACE_ENABLED` 改成 `false`，再重新部署（做法見最後面「緊急關閉」）。

## 一、怎麼進去設定（Vercel 網頁操作）

1. 用瀏覽器登入 Vercel（vercel.com），點進這個專案。
2. 上方選單點 **Settings**。
3. 左邊選單點 **Environment Variables**。
4. 要新增：
   1. 在 **Key** 欄位填變數名稱（例如 `WORKSPACE_ENABLED`）。
   2. 在 **Value** 欄位填值。
   3. 在 **Environments** 區塊，**只勾你要的那一個**：正式網站勾 `Production`，測試預覽勾 `Preview`。其他取消勾選。
   4. 如果是金鑰類（例如 `SUPABASE_SERVICE_ROLE_KEY`），打開 **Sensitive**（敏感）開關，儲存後就看不到內容了，比較安全。
   5. 按 **Save**。
5. 要修改：找到那一列，按右邊的「…」選 **Edit**，改完 **Save**。
6. 要刪除：「…」選 **Remove**。
7. **重新部署（讓設定生效）**：
   1. 上方選單點 **Deployments**。
   2. 找到最上面那一筆狀態是 Ready 的 Production 部署。
   3. 按那一列右邊的「…」，選 **Redeploy**。
   4. 跳出視窗後按 **Redeploy** 確認，等狀態變回 **Ready**（約 1 到 2 分鐘）。
   5. 注意：Redeploy 會用「那次部署的程式碼」重做一次，只是帶上新的環境變數。這正是我們要的。
8. 同一個變數如果想在 Production 與 Preview 設不同的值，要**各新增一筆**（同名稱、不同範圍、不同值）。

## 二、Production（正式網站）要設的變數

| 變數名稱 | 要填什麼意思 | 備註 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 正式 Supabase 專案網址 | 建置時就要有，缺了網站會建置失敗。多半原本就已設好 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 正式專案的 anon 公開金鑰 | 同上，原本多半已設好 |
| `SUPABASE_SERVICE_ROLE_KEY` | 正式專案的 service_role 金鑰 | 開 Sensitive。只給伺服器用，絕不外流 |
| `EXPECTED_SUPABASE_PROJECT_REF` | 正式專案的代號（網址最前面那一段英文字母） | 必須和上面網址的代號一模一樣，不一樣新版會自動關閉（安全保護） |
| `WORKSPACE_ALLOWED_REFS` | 允許開新版的正式專案代號，多個用逗號隔開 | 只放正式專案代號。測試專案的代號不能放，放了也會被拒絕 |
| `WORKSPACE_ENABLED` | 總開關。填 `true` 才開，其他任何值或沒設都是關 | 這是緊急關閉用的開關 |
| `WORKSPACE_AUDIENCE` | 誰可以用。`admin_only` 只有管理員；`all` 全部有權限的人 | 沒設或打錯，一律當成 `admin_only`（比較保守） |
| `WORKSPACE_USE_EXISTING_SESSION` | 填 `true`，新版沿用舊版的登入 | 決定 D2：共用舊版登入 |
| `WORKSPACE_ORIGIN` | 正式網站的網址，例如 `https://你的網域`（不加最後的斜線） | 可填多個，用逗號隔開。若有綁自訂網域也要一起填 |
| `NEXT_PUBLIC_SITE_URL` | 正式網站網址 | 忘記密碼信、資產 QR 標籤的網址都靠它 |
| `OPENAI_API_KEY` | OpenAI 金鑰 | 要用語音 AI 才需要（決定 D9：開，每月上限 USD 30）。開 Sensitive |
| `OPENAI_TRANSCRIPTION_MODEL`、`OPENAI_SML_VOICE_DRAFT_MODEL` | 語音辨識與草稿用的模型名稱 | 沒設就用程式內建預設，通常不用動 |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`、`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | 門市地圖用 | 要用地圖才需要 |
| `WORKSPACE_PUBLIC_REDIRECT_ENABLED` | 不設（或填 `false`） | 設 `true` 會把舊版登入頁、活動頁、行事曆導到新版。上線時不要開 |
| `WORKSPACE_SCAN_REDIRECT` | 先不設 | 之後才決定要不要讓資產 QR 掃描改去新版 |

舊版本來就有的其他變數（Google 行事曆那幾個等）**維持原樣不要動**。

### Production 一定要「沒有」的變數

下面這四個是只給測試環境用的「模擬」開關，正式網站**不可以存在**（連填 `false` 都不要，直接沒有）：

- `WORKSPACE_DEV_ENABLED`
- `WORKSPACE_CALENDAR_MOCK`
- `WORKSPACE_AUTH_MAIL_MOCK`
- `WORKSPACE_OPENAI_MOCK`

設定完請回 Environment Variables 頁面，用上方搜尋框各搜一次，確認 Production 底下沒有它們。

## 三、Preview（測試預覽，連測試資料庫）要設的變數

Preview 只能連**測試資料庫**，程式也會擋掉連到別的資料庫的情況。

| 變數名稱 | 要填什麼意思 | 備註 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 測試 Supabase 專案網址 | 建置時就要有 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 測試專案 anon 金鑰 | 建置時就要有 |
| `SUPABASE_SERVICE_ROLE_KEY` | 測試專案 service_role 金鑰 | 開 Sensitive |
| `EXPECTED_SUPABASE_PROJECT_REF` | 測試專案代號 | 要和上面網址代號相同 |
| `WORKSPACE_ENABLED` | `true` | 預覽才看得到新版 |
| `WORKSPACE_AUDIENCE` | `all` | 預覽時讓各角色都能走流程測試 |
| `WORKSPACE_USE_EXISTING_SESSION` | `true` | 和正式一致 |
| `NEXT_PUBLIC_SITE_URL` | 預覽網址（沒有固定的話可先不設） | 只影響信件與 QR 網址 |
| `WORKSPACE_ORIGIN` | 可不設 | 預覽網址系統會自己辨識 |
| `WORKSPACE_DEV_ENABLED`、`WORKSPACE_CALENDAR_MOCK`、`WORKSPACE_AUTH_MAIL_MOCK`、`WORKSPACE_OPENAI_MOCK` | 只有要跑自動化測試（不寄真信、不真的呼叫 OpenAI）時才設 `true` | 只能設在 Preview，而且只在連測試資料庫時才會生效 |

Preview **不需要** `WORKSPACE_ALLOWED_REFS`。

## 四、為什麼要分範圍、為什麼要重新部署

- 預覽網站如果誤拿到正式資料庫的鑰匙，測試時就會動到真實資料。所以程式設計成：預覽只接受測試資料庫、正式只接受白名單內的正式資料庫，兩邊都對不上就自動關閉。但這是最後一道保險，第一道還是你設定時分開勾選。
- Vercel 的環境變數是在「部署時」才帶進去的。改完不重新部署，網站還是用舊的設定。
- `NEXT_PUBLIC_` 開頭的變數是在**建置時**就寫進網頁裡的，所以更要重新部署。

## 五、建置相關提醒

- 每次部署會先建置新版工作台畫面（Vue），再建置主網站（Next.js）。多出約 30 秒，整體約 1 到 2 分鐘。
- Vercel 專案的 Node 版本請設成 **20.x**（Settings 的 **General**，找到 **Node.js Version**）。程式裡也寫了 20.x。
- 不要設 `NODE_ENV=production`（見最上面第 4 點）。
- Production 與 Preview 兩邊建置時都一定要有 `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，沒有的話建置會失敗（這是舊版就有的行為）。

## 六、上線各階段要做什麼

| 階段 | 動作 | 結果 |
|---|---|---|
| 0. 合併當天 | Production 不設任何新變數，直接合併到 `main` | 新版關閉，舊版照舊 |
| 1. 準備 | 依第二節把 Production 變數設好，但 `WORKSPACE_ENABLED` 先不設，`WORKSPACE_AUDIENCE` 設 `admin_only` | 仍是關閉 |
| 2. 管理員試用 | `WORKSPACE_ENABLED` 設 `true`，Redeploy | 只有管理員看得到新版選單，其他人點進去看到「新版尚未開放」 |
| 3. 全面開放 | `WORKSPACE_AUDIENCE` 改成 `all`，Redeploy | 有權限的人都能用新版 |
| 緊急關閉 | `WORKSPACE_ENABLED` 改成 `false`，Redeploy | 舊版選單只剩舊版連結，新版 API 回 503 |

每次 Redeploy 完，都請工程這邊跑一次唯讀冒煙檢查（只讀不寫）：

`node scripts/workspace-prod-smoke.cjs --base-url https://你的網域`

登入 Cookie 用環境變數 `WORKSPACE_SMOKE_COOKIE` 傳進去，不要寫在指令裡。

## 七、緊急關閉的兩種做法

1. **改開關再重新部署**（約 1 到 2 分鐘）：Settings > Environment Variables，找 `WORKSPACE_ENABLED`，改成 `false`，Save，再到 Deployments 按 Redeploy。
2. **Vercel 即時回復（比較快）**：Deployments 找到上一個正常的部署，按「…」選 **Promote to Production**（或 Instant Rollback）。這樣是直接換回舊的部署，不用重建。

## 八、設定完自我檢查清單

- [ ] Production 的 `WORKSPACE_ALLOWED_REFS` 只有正式專案代號
- [ ] Production 的 `EXPECTED_SUPABASE_PROJECT_REF` 和 `NEXT_PUBLIC_SUPABASE_URL` 的代號相同
- [ ] Production 沒有 `WORKSPACE_DEV_ENABLED`、`WORKSPACE_CALENDAR_MOCK`、`WORKSPACE_AUTH_MAIL_MOCK`、`WORKSPACE_OPENAI_MOCK`
- [ ] Supabase 三把鑰匙沒有勾 All Environments
- [ ] 每個變數都選對範圍（Production 或 Preview）
- [ ] 沒有設 `NODE_ENV`
- [ ] 改完變數已經 Redeploy，狀態是 Ready
- [ ] Node.js Version 是 20.x
