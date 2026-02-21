# 管理員重置用戶密碼功能配置指南

## 功能說明

管理員現在可以在「使用者管理」頁面直接重置任何用戶的密碼，無需通過郵件。

## 🔧 必要配置

### 1. 取得 Supabase Service Role Key

1. **登入 Supabase Dashboard**
   - 訪問：https://supabase.com/dashboard
   - 選擇您的專案

2. **取得 Service Role Key**
   - 左側選單：**Settings** → **API**
   - 找到 **Project API keys** 區塊
   - 複製 **service_role** key（⚠️ 這是機密金鑰，請妥善保管）

### 2. 設定環境變數

在專案根目錄創建或編輯 `.env.local` 檔案：

```env
# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# 🔑 管理員功能必需（重置密碼）
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# 網站 URL
NEXT_PUBLIC_SITE_URL=https://private-knos.vercel.app
```

### 3. 在 Vercel 設定環境變數

1. **進入 Vercel 專案設定**
   - 訪問：https://vercel.com/dashboard
   - 選擇 private-knos 專案
   - Settings → Environment Variables

2. **添加環境變數**
   ```
   Name: SUPABASE_SERVICE_ROLE_KEY
   Value: [貼上您的 service_role key]
   Environment: Production, Preview, Development (全選)
   ```

3. **重新部署**
   - 添加環境變數後需要重新部署才會生效
   - Settings → Deployments → 最新部署 → Redeploy

## 📋 使用方式

### 管理員操作流程

1. **登入系統**
   - 使用管理員帳號登入

2. **進入使用者管理**
   - 導航至：`/admin/users`

3. **重置用戶密碼**
   - 在用戶列表中找到目標用戶
   - 點擊 🔑 重置密碼按鈕（橘色鑰匙圖示）
   - 系統自動生成隨機密碼（10 位，包含字母、數字、符號）
   - 可以手動修改密碼
   - 點擊「複製」按鈕複製密碼
   - 點擊「確認重置」執行重置

4. **告知用戶**
   - 將新密碼告知用戶
   - 建議用戶登入後立即修改密碼

### 密碼要求

- 最少 6 個字元
- 建議 8-12 個字元
- 推薦包含大小寫字母、數字和特殊符號

## 🔐 安全性說明

### Service Role Key 的重要性

⚠️ **Service Role Key 是超級管理員金鑰**，具有以下權限：
- 繞過所有 RLS (Row Level Security) 策略
- 直接修改任何用戶的數據
- 執行管理員操作（如更新密碼）

### 安全最佳實踐

1. **絕不提交到 Git**
   - `.env.local` 已加入 `.gitignore`
   - 確保不會意外推送到版本控制

2. **只在服務端使用**
   - Service Role Key 只能在 API 路由或 Server Actions 中使用
   - 絕不暴露給客戶端

3. **限制存取**
   - 只有管理員可以呼叫重置密碼 API
   - API 會驗證當前用戶角色

4. **定期輪換**
   - 建議定期重新生成 Service Role Key
   - 在 Supabase Dashboard 可以重新生成

5. **監控使用**
   - 在 Supabase Dashboard 查看 API 使用記錄
   - 注意異常的密碼重置操作

## ⚡ 功能特色

### 優點

✅ **無需郵件配置** - 不依賴 SMTP 設定
✅ **即時生效** - 密碼立即更新
✅ **管理員控制** - 完全由管理員管理
✅ **自動生成密碼** - 確保密碼強度
✅ **複製功能** - 方便分享給用戶
✅ **操作記錄** - Supabase 自動記錄

### 使用場景

- 🆕 新員工入職，快速設定初始密碼
- 🔒 用戶忘記密碼，無法收到郵件
- 🚨 緊急情況需要立即重置密碼
- 📧 郵件系統故障時的備用方案
- 👑 管理員批量管理用戶帳號

## 🧪 測試步驟

### 本地測試

1. **確認環境變數**
   ```bash
   # 檢查 .env.local
   cat .env.local | grep SUPABASE_SERVICE_ROLE_KEY
   ```

2. **啟動開發服務器**
   ```bash
   npm run dev
   ```

3. **訪問使用者管理**
   - http://localhost:3000/admin/users

4. **測試重置密碼**
   - 點擊任一用戶的重置密碼按鈕
   - 修改密碼或使用自動生成的密碼
   - 確認重置
   - 使用新密碼登入測試

### 生產環境測試

1. **確認 Vercel 環境變數**
   - 檢查 SUPABASE_SERVICE_ROLE_KEY 是否已設定

2. **重新部署**
   - 確保最新代碼已部署

3. **執行重置測試**
   - 訪問：https://private-knos.vercel.app/admin/users
   - 重置測試用戶密碼
   - 嘗試用新密碼登入

## 🐛 疑難排解

### 問題 1：權限不足錯誤

**錯誤訊息：** "權限不足，只有管理員可以重置密碼"

**解決方案：**
- 確認當前用戶的 role 為 `admin`
- 檢查 profiles 表中的 role 欄位

### 問題 2：SUPABASE_SERVICE_ROLE_KEY not found

**錯誤訊息：** "SUPABASE_SERVICE_ROLE_KEY not found"

**解決方案：**
1. 檢查 `.env.local` (本地) 或 Vercel 環境變數 (生產)
2. 確認變數名稱正確
3. 重新啟動開發服務器或重新部署

### 問題 3：Failed to update user

**錯誤訊息：** "Failed to update user" 或其他 Supabase 錯誤

**解決方案：**
1. 檢查 Service Role Key 是否正確
2. 確認 Supabase 專案 URL 正確
3. 查看 Supabase Dashboard → Logs 了解詳細錯誤
4. 確認用戶 ID 存在且有效

### 問題 4：密碼太短

**錯誤訊息：** "密碼長度至少需要 6 個字元"

**解決方案：**
- 輸入至少 6 個字元的密碼
- 使用自動生成的密碼（10 位）

## 📊 API 端點

### POST /api/admin/reset-password

**請求格式：**
```json
{
  "userId": "uuid",
  "newPassword": "string"
}
```

**回應格式：**
```json
{
  "success": true,
  "message": "密碼已成功重置",
  "data": {
    "userId": "uuid",
    "email": "user@example.com"
  }
}
```

**錯誤回應：**
```json
{
  "success": false,
  "error": "錯誤訊息"
}
```

## 🔄 與郵件重置的比較

| 功能 | 管理員重置 | 郵件重置 |
|------|-----------|---------|
| 需要 SMTP 配置 | ❌ 不需要 | ✅ 需要 |
| 需要 Service Role Key | ✅ 需要 | ❌ 不需要 |
| 執行時間 | ⚡ 即時 | 📧 需等待郵件 |
| 適用場景 | 管理員操作 | 用戶自助 |
| 安全性考量 | 需保護 Service Key | 驗證郵件連結 |

## 📝 後續優化建議

1. **操作日誌** - 記錄誰在何時重置了誰的密碼
2. **批量重置** - 同時重置多個用戶密碼
3. **密碼策略** - 設定更嚴格的密碼規則
4. **通知用戶** - 密碼被重置時自動發送通知郵件
5. **臨時密碼** - 強制用戶首次登入時修改密碼

## 📞 支援

如有問題，請檢查：
- Supabase Dashboard → Logs
- 瀏覽器 Console (F12)
- Vercel Deployment Logs

相關文件：
- [Supabase Admin API](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)
- [Next.js API Routes](https://nextjs.org/docs/api-routes/introduction)
