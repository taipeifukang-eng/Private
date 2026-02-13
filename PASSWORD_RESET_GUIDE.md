# 密碼重置功能配置指南

## 功能說明

已完成密碼重置功能的開發，包含：
1. 忘記密碼頁面 (`/forgot-password`)
2. 認證回調路由 (`/auth/callback`)
3. 重置密碼頁面 (`/reset-password`)
4. 登入頁面添加忘記密碼連結

## 使用流程

1. 使用者在登入頁點擊「忘記密碼？」
2. 輸入註冊的電子郵件
3. 系統發送密碼重置郵件
4. 使用者點擊郵件中的連結
5. **系統自動檢測 URL 中的 code 參數並跳轉到認證處理**
6. 通過 `/auth/callback` 處理認證並建立 session
7. 自動跳轉到重置密碼頁面
8. 設定新密碼
9. 自動跳轉回登入頁

## 🔄 工作原理

### 認證流程說明

```
用戶點擊郵件連結
  ↓
跳轉到 /?code=xxx (Supabase 預設行為)
  ↓
AuthCodeHandler 檢測到 code 參數
  ↓
自動跳轉到 /auth/callback?code=xxx&next=/reset-password
  ↓
Callback 處理 exchangeCodeForSession
  ↓
建立用戶 session
  ↓
跳轉到 /reset-password
  ↓
用戶設定新密碼
  ↓
完成！跳轉到登入頁
```

### 為什麼會跳到首頁？

Supabase 預設的郵件模板使用 `{{ .SiteURL }}` 作為基礎 URL，所以點擊連結會先跳到首頁 `/?code=xxx`。我們的系統會自動檢測這個 code 參數並跳轉到正確的處理路由。

### 自動跳轉機制

我們在 `app/layout.tsx` 中添加了 `AuthCodeHandler` 組件：
- 檢測 URL 中是否有 `code` 參數
- 如果有，自動跳轉到 `/auth/callback`
- 這確保無論 Supabase 郵件如何配置，都能正確處理重置密碼流程

## ⚙️ Supabase 配置（重要！必須完成）

### 步驟 1：設定 Redirect URLs 白名單

**這是最關鍵的步驟！** 否則點擊郵件連結會跳轉回登入頁。

1. **登入 Supabase Dashboard**
   - 訪問：https://supabase.com/dashboard
   - 選擇您的專案

2. **進入 Authentication 設定**
   - 左側選單：**Authentication** → **URL Configuration**

3. **添加 Redirect URLs**
   在 **Redirect URLs** 欄位中添加以下 URL（每行一個）：
   
   **生產環境：**
   ```
   https://private-knos.vercel.app/auth/callback
   ```
   
   **本地開發環境：**
   ```
   http://localhost:3000/auth/callback
   ```
   
   **完整範例：**
   ```
   https://private-knos.vercel.app/auth/callback
   http://localhost:3000/auth/callback
   ```

4. **點擊 Save** 儲存設定

### 步驟 2：設定 Site URL

在同一個頁面（URL Configuration）：

1. **Site URL** 設定為：
   ```
   https://private-knos.vercel.app
   ```
   
2. 本地開發時可以設為：
   ```
   http://localhost:3000
   ```

### 步驟 3：驗證環境變數

確保 `.env.local` 和 Vercel 環境變數中有：

```env
NEXT_PUBLIC_SITE_URL=https://private-knos.vercel.app
```

## 🔧 Supabase Email 配置（必須）

為了讓密碼重置郵件能夠發送，需要在 Supabase 設定 SMTP：

### 方法一：使用 Supabase 預設 Email Service（簡單）

**優點：** 無需額外配置
**限制：** 每小時 4 封郵件上限（開發環境）

1. 進入 Supabase Dashboard
2. 選擇您的專案
3. 前往 **Authentication** → **Email Templates**
4. 找到 **Reset Password** 模板
5. 自訂郵件內容（可選）
6. 確保 `Confirm signup` 設定為 **Enabled**

### 方法二：配置自訂 SMTP（推薦用於生產環境）

**推薦的免費 SMTP 服務：**
- **Gmail**: 每天 500 封
- **SendGrid**: 每天 100 封（免費方案）
- **Mailgun**: 每月 5,000 封（免費方案）
- **Amazon SES**: 每月 62,000 封（AWS 免費方案）

#### 使用 Gmail SMTP 範例：

1. **設定 Gmail 應用程式密碼**
   - 前往 Google 帳戶安全性設定
   - 啟用「兩步驟驗證」
   - 生成「應用程式密碼」

2. **在 Supabase 配置 SMTP**
   - 進入 Supabase Dashboard
   - 前往 **Settings** → **Project Settings**
   - 選擇 **Auth** → **SMTP Settings**
   - 填入以下資訊：
     ```
     SMTP Host: smtp.gmail.com
     SMTP Port: 587
     SMTP User: your-email@gmail.com
     SMTP Password: [應用程式密碼]
     Sender Email: your-email@gmail.com
     Sender Name: 富康企業系統
     ```
   - 點擊 **Save** 並測試

#### 使用 SendGrid 範例：

1. **註冊 SendGrid** (https://sendgrid.com/)
2. **創建 API Key**
   - Settings → API Keys → Create API Key
   - 選擇 Full Access
3. **驗證寄件者身份**
   - Settings → Sender Authentication
   - 驗證單一郵件地址或網域
4. **在 Supabase 配置**
   ```
   SMTP Host: smtp.sendgrid.net
   SMTP Port: 587
   SMTP User: apikey
   SMTP Password: [您的 SendGrid API Key]
   Sender Email: [已驗證的郵件地址]
   Sender Name: 富康企業系統
   ```

## 🌐 環境變數配置

在您的 `.env.local` 和 Vercel 環境變數中設定：

```env
NEXT_PUBLIC_SITE_URL=https://private-knos.vercel.app
```

或本地開發：
```env
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 📧 Email 模板自訂（可選）

### 1. 進入 Supabase Dashboard
- Authentication → Email Templates → Reset Password

### 2. 自訂郵件內容
預設模板變數：
- `{{ .SiteURL }}` - 網站 URL
- `{{ .Token }}` - 重置 Token
- `{{ .TokenHash }}` - Token Hash
- `{{ .Email }}` - 使用者郵件

範例模板：
```html
<h2>重設您的密碼</h2>
<p>您好，</p>
<p>我們收到了您的密碼重設請求。請點擊下方按鈕來設定新密碼：</p>
<p><a href="{{ .SiteURL }}/reset-password?token={{ .TokenHash }}&type=recovery">重設密碼</a></p>
<p>如果您沒有提出此請求，請忽略此郵件。</p>
<p>此連結將在 24 小時後失效。</p>
<br>
<p>富康企業系統</p>
```

## 🧪 測試步驟

### 1. 本地測試
```bash
npm run dev
```

訪問 http://localhost:3000/login
點擊「忘記密碼？」

### 2. 輸入測試郵件
使用已註冊的郵件地址

### 3. 檢查郵件
- 檢查收件匣
- 檢查垃圾郵件資料夾
- 檢查 Supabase Dashboard 的 Logs

### 4. 點擊重置連結
應自動跳轉到 `/reset-password` 頁面

### 5. 設定新密碼
輸入新密碼後應自動跳轉回登入頁

## ⚠️ 常見問題

### 1. 收不到郵件
**檢查項目：**
- Supabase SMTP 是否正確配置
- 郵件地址是否正確
- 檢查垃圾郵件資料夾
- Supabase Dashboard → Logs 查看錯誤

### 2. 重置連結無效
**可能原因：**
- Token 已過期（24 小時有效期）
- URL 參數遺失
- 環境變數 `NEXT_PUBLIC_SITE_URL` 設定錯誤

**解決方案：**
- 重新請求重置郵件
- 檢查 `.env.local` 設定
- 確認 Vercel 環境變數

### 3. 使用 Gmail SMTP 時連線失敗
**可能原因：**
- 未啟用兩步驟驗證
- 使用帳戶密碼而非應用程式密碼
- Gmail 封鎖「較不安全的應用程式」

**解決方案：**
- 使用 Gmail 應用程式密碼
- 或改用 SendGrid / Mailgun

## 📊 生產環境檢查清單

部署前確認：
- [ ] Supabase SMTP 已配置
- [ ] 發送測試郵件成功
- [ ] `NEXT_PUBLIC_SITE_URL` 設定為生產網址
- [ ] Email 模板已自訂（可選）
- [ ] 測試完整密碼重置流程
- [ ] 檢查郵件在不同郵件服務商的顯示
- [ ] 設定適當的郵件發送頻率限制

## 🔐 安全性考量

1. **Token 有效期**：Supabase 預設 24 小時
2. **頻率限制**：防止惡意攻擊
3. **郵件驗證**：確保只有註冊的郵件才能重置
4. **密碼強度**：前端已添加密碼強度檢查
5. **HTTPS**：確保生產環境使用 HTTPS

## 📝 後續優化建議

1. **添加圖形驗證碼**（防止機器人攻擊）
2. **郵件發送頻率限制**（同一郵件 N 分鐘內只能發送一次）
3. **密碼歷史檢查**（防止使用舊密碼）
4. **多語言支援**（Email 模板）
5. **發送成功通知**（密碼修改成功後發送確認郵件）

## 🎯 管理員快速重置密碼方法

如果郵件配置未完成，可使用 Supabase Dashboard 直接重置：

1. 登入 Supabase Dashboard
2. Authentication → Users
3. 找到該使用者
4. 點擊 `...` → **Reset Password**
5. 輸入新密碼並儲存

或使用 SQL：
```sql
-- 注意：這個方法需要有密碼的 hash，不建議使用
-- 建議還是使用 Dashboard 的 UI 操作
```

## 📞 支援

如有問題，請聯繫系統管理員或參考 Supabase 文件：
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/auth-password-reset
