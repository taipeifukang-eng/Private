# 督導巡店紀錄模組設計文檔（完整版）

## 📋 模組概述

**模組名稱**：督導巡店系統（Store Inspection System）  
**主要用戶**：督導（Supervisor）  
**次要用戶**：店長（Store Manager）、管理員（Admin）  
**功能定位**：標準化門市巡檢流程，記錄問題、追蹤改善、產生列印報表

## 🎯 評分系統規格

### 總分與等級判定
- **總分**：220 分
- **等級標準**：
  - S 級：≥ 208 分（94.5%）
  - A 級：196-207 分（89.1%-94.1%）
  - B 級：188-195 分（85.5%-88.6%）
  - F 級：< 188 分（<85.5%）

### 計分方式
1. **Checklist 複選扣分**
   - 督導勾選缺失項目
   - 自動從滿分扣除對應分數
   - 最低 0 分

2. **Quantity 數量計數扣分**
   - 使用計數器 [-] [數字] [+]
   - 公式：實得分數 = 滿分 - (缺失次數 × 單位扣分)
   - 適用於：流程章缺失、單據缺失、負庫存等

### 自動判定改善項目
- 當實得分數 < 滿分時，自動設定 `is_improvement = true`
- 需拍照記錄缺失狀況

## 📊 檢查項目五大區塊（來自 Excel）

### 第一區：門市業績相關（35 分）
1. 門市業績相關（10分）- 網路處方/實體處方
2. 購物袋宣導提醒（5分）- 有會員本/無會員本兩項
3. 補給申請未確認（10分）- 門市訂單/門市訂單主管
4. 購退、陳退（10分）- 門市退貨/補助款/過期賠償/未結流程

### 第二區：區域環境相關（44.5 分）
1. 賣場（10分）- 清潔/整潔度/擺設
2. 倉庫區（10分）- 免稅/保健食品/清潔
3. 賣場營業中（5分）- 貨架整潔/擺設順序
4. 營業時間（7分）- 開店時間/關店時間
5. 店內牆面/門店（5分）- 牆面/門店清潔
6. 垃圾/儲貨倉（7分）- 垃圾區/儲貨倉整潔
7. 營業工具專用品項（10分）- 高櫃/購物籃/發票列印品質

### 第三區：櫃台三聯單（44.5 分）
1. 櫃台三聯單（10分）- 簽名/日期/金額正確
2. 三聯單/合約使用單（10分）- 張數/欄位完整
3. 三聯單管理整齊（5分）- 合約整齊/合約放置正確

### 第四區：商品庫存管理（40.5 分）
1. 短效品到期日期（10分）- 單據/標籤正確
2. 遮障證明/藥證（10分）- 證明擺放
3. 標籤/商品碼（30分）- 標籤正確/條碼正確

### 第五區：流程執行（整合現有架構）

### 資料表 1: `inspection_templates`（題庫/檢查項目範本）
```sql
CREATE TABLE inspection_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- 分類
  section VARCHAR(50) NOT NULL, -- section_1 ~ section_5
  section_name VARCHAR(100) NOT NULL, -- 門市業績相關、區域環境相關等
  section_order INT NOT NULL, -- 1-5
  
  -- 項目資訊
  item_name VARCHAR(200) NOT NULL, -- 門市業績相關、賣場等
  item_description TEXT, -- 檢查重點說明
  item_order INT NOT NULL, -- 項目排序
  
  -- 評分設定
  max_score DECIMAL(5,1) NOT NULL, -- 滿分（如 10.0, 5.5）
  scoring_type VARCHAR(20) NOT NULL, -- 'checklist' 或 'quantity'
  
  -- Checklist 類型的扣分項目（JSONB 陣列）
  checklist_items JSONB, -- [{"label": "有紙屑", "deduction": 1}, {"label": "髒汙", "deduction": 5}]
  
  -- Quantity 類型的單位扣分
  quantity_deduction DECIMAL(5,1), -- 每次缺失扣多少分（如 1.0）
  quantity_unit VARCHAR(50), -- 單位說明（如「個」、「張」）
  
  -- 狀態
  is_active BOOLEAN DEFAULT true,
  
  -- 審計欄位
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);

-- 索引
CREATE INDEX idx_inspection_templates_section ON inspection_templates(section, section_order);
CREATE INDEX idx_inspection_templates_order ON inspection_templates(section_order, item_order);
CREATE INDEX idx_inspection_templates_active ON inspection_templates(is_active);

-- 約束：確保每個 section 的總分等於目標分數
COMMENT ON TABLE inspection_templates IS '督導巡店檢查項目題庫，總分 220 分';
```

### 資料表 2: `inspection_masters`（巡店主記錄）
```sql
CREATE TABLE inspection_masters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- 基本資訊（整合現有 stores 和 profiles）
  store_id UUID NOT NULL REFERENCES stores(id),
  inspector_id UUID NOT NULL REFERENCES profiles(id),
  inspection_date DATE NOT NULL,
  inspection_time TIME DEFAULT CURRENT_TIME,
  
  -- GPS 位置（督導簽到位置驗證）
  gps_latitude DECIMAL(10, 8),
  gps_longitude DECIMAL(11, 8),
  gps_accuracy DECIMAL(10, 2), -- 精度（公尺）
  
  -- 評分結果
  total_score DECIMAL(6,1) DEFAULT 0, -- 實得總分
  max_possible_score DECIMAL(6,1) DEFAULT 220, -- 滿分
  grade VARCHAR(2), -- S, A, B, F
  score_percentage DECIMAL(5,2), -- 分數百分比
  
  -- 區塊得分明細
  section_1_score DECIMAL(5,1) DEFAULT 0, -- 門市業績相關
  section_2_score DECIMAL(5,1) DEFAULT 0, -- 區域環境相關
  section_3_score DECIMAL(5,1) DEFAULT 0, -- 櫃台三聯單
  section_4_score DECIMAL(5,1) DEFAULT 0, -- 商品庫存管理
  section_5_score DECIMAL(5,1) DEFAULT 0, -- 流程執行相關
  
  -- 督導建議與店長回饋
  supervisor_notes TEXT, -- 督導整體建議
  improvement_suggestions TEXT, -- 改善建議
  store_manager_response TEXT, -- 店長回應
  
  -- 結案流程
  status VARCHAR(20) DEFAULT 'draft', -- draft/in_progress/completed/closed
  signature_photo_url TEXT, -- 店長簽名單照片 URL（Supabase Storage）
  signed_at TIMESTAMPTZ, -- 店長簽名時間
  closed_at TIMESTAMPTZ, -- 結案時間
  closed_by UUID REFERENCES profiles(id),
  
  -- 審計欄位
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  
  CONSTRAINT fk_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_inspector FOREIGN KEY (inspector_id) REFERENCES profiles(id),
  CONSTRAINT valid_total_score CHECK (total_score >= 0 AND total_score <= 220),
  CONSTRAINT valid_grade CHECK (grade IN ('S', 'A', 'B', 'F'))
);

-- 索引
CREATE INDEX idx_inspection_masters_store ON inspection_masters(store_id);
CREATE INDEX idx_inspection_masters_inspector ON inspection_masters(inspector_id);
CREATE INDEX idx_inspection_masters_date ON inspection_masters(inspection_date DESC);
CREATE INDEX idx_inspection_masters_status ON inspection_masters(status);
CREATE INDEX idx_inspection_masters_grade ON inspection_masters(grade);

-- 自動更新 updated_at
CREATE TRIGGER update_inspection_masters_updated_at
  BEFORE UPDATE ON inspection_masters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### 資料表 3: `inspection_results`（各項目評分詳細記錄）
```sql
CREATE TABLE inspection_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- 關聯
  inspection_id UUID NOT NULL REFERENCES inspection_masters(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES inspection_templates(id),
  
  -- 評分結果
  max_score DECIMAL(5,1) NOT NULL, -- 該項目滿分（從 template 複製）
  given_score DECIMAL(5,1) NOT NULL DEFAULT 0, -- 實得分數
  deduction_amount DECIMAL(5,1) DEFAULT 0, -- 扣除分數
  
  -- 改善標記
  is_improvement BOOLEAN DEFAULT false, -- 是否需要改善（自動判定：given_score < max_score）
  
  -- Checklist 勾選項目（JSONB）
  selected_items JSONB, -- [{"label": "有紙屑", "deduction": 1}, {"label": "髒汙", "deduction": 5}]
  
  -- Quantity 數量記錄
  quantity_count INT DEFAULT 0, -- 缺失次數
  
  -- 備註與照片
  notes TEXT, -- 督導備註
  photo_urls JSONB, -- ["url1.webp", "url2.webp"] 多張照片
  
  -- 審計欄位
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_inspection FOREIGN KEY (inspection_id) REFERENCES inspection_masters(id) ON DELETE CASCADE,
  CONSTRAINT fk_template FOREIGN KEY (template_id) REFERENCES inspection_templates(id),
  CONSTRAINT valid_score CHECK (given_score >= 0 AND given_score <= max_score)
);

-- 索引
CREATE INDEX idx_inspection_results_inspection ON inspection_results(inspection_id);
CREATE INDEX idx_inspection_results_template ON inspection_results(template_id);
CREATE INDEX idx_inspection_results_improvement ON inspection_results(is_improvement);

-- 自動更新 updated_at
CREATE TRIGGER update_inspection_results_updated_at
  BEFORE UPDATE ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 自動判定改善標記
CREATE OR REPLACE FUNCTION auto_set_improvement_flag()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_improvement := (NEW.given_score < NEW.max_score);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_improvement_flag
  BEFORE INSERT OR UPDATE OF given_score, max_score
  ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_improvement_flag(  resolved_by UUID REFERENCES profiles(id),
  
  -- 審計欄位
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_inspection FOREIGN KEY (inspection_id) REFERENCES store_inspections(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_inspection_issues_inspection ON inspection_issues(inspection_id);
CREATE INDEX idx_inspection_issues_assigned ON inspection_issues(assigned_to);
CREATE INDEX idx_inspection_issues_status ON inspection_issues(status);
CREATE INDEX idx_inspection_issues_due_date ON inspection_issues(due_date);
```

### 資料表 3: `inspection_checklist_templates`（檢查項目範本）
```sql
CREATE TABLE inspection_checklist_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  items JSONB NOT NULL, -- 檢查項目清單
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);
```

## � 圖片儲存方案（Supabase Storage + 前端壓縮）

### 前端圖片處理（browser-image-compression）
```typescript
// 使用 Web Worker 處理壓縮，避免 UI 卡頓
import imageCompression from 'browser-image-compression';

const compressOptions = {
  maxSizeMB: 0.3, // 300KB
  maxWidthOrHeight: 1024, // 最大解析度
  useWebWorker: true, // 使用 Web Worker
  fileType: 'image/webp', // 強制轉換為 WebP
};

const compressedFile = await imageCompression(file, compressOptions);
```

### Supabase Storage 路徑結構
```
inspection-photos/
  ├── {store_id}/
  │   ├── {inspection_id}/
  │   │   ├── {template_id}_{timestamp}_1.webp
  │   │   ├── {template_id}_{timestamp}_2.webp
  │   │   └── ...
  └── signatures/
      └── {inspection_id}_{timestamp}.webp  // 簽名單照片
```

### 上傳流程
1. 用戶拍照或選擇照片
2. Web Worker 壓縮成 WebP（<300KB）
3. 顯示縮圖預覽
4. 上傳到 Supabase Storage
5. 取得 Public URL
6. 更新 `inspection_results.photo_urls` JSONB 陣列

## 🔐 權限設計（RBAC）

### 新增權限碼
```sql
INSERT INTO permissions (code, description, module, feature, action) VALUES
  ('inspection.create', '新增巡店記錄 - 允許督導建立新的門市巡檢記錄並記錄檢查項目', '督導巡店', 'inspection', 'create'),
  ('inspection.view_own', '查看自己的巡店記錄 - 允許督導查看自己建立的巡檢記錄', '督導巡店', 'inspection', 'view'),
  ('inspection.view_store', '查看門市巡店記錄 - 允許店長查看自己門市的巡檢記錄', '督導巡店', 'inspection_store', 'view'),
  ('inspection.view_all', '查看所有巡店記錄 - 允許管理員查看所有門市的巡檢記錄', '督導巡店', 'inspection_all', 'view'),
  ('inspection.edit', '編輯巡店記錄 - 允許修改進行中的巡檢記錄和評分', '督導巡店', 'inspection', 'edit'),
  ('inspection.delete', '刪除巡店記錄 - 允許刪除草稿狀態的巡檢記錄', '督導巡店', 'inspection', 'delete'),
  ('inspection.complete', '完成巡店記錄 - 允許將巡檢記錄標記為完成並通知店長', '督導巡店', 'inspection', 'complete'),
  ('inspection.close', '結案巡店記錄 - 允許上傳簽名單照片並結案', '督導巡店', 'inspection', 'close'),
  ('inspection.upload_photo', '上傳巡店照片 - 允許拍照並上傳檢查項目的缺失照片', '督導巡店', 'inspection', 'upload'),
  ('inspection.export', '匯出巡店報表 - 允許將巡檢記錄匯出成 PDF 或列印', '督導巡店', 'inspection', 'export'),
  ('inspection.template.manage', '管理檢查範本 - 允許新增/編輯/刪除檢查項目範本', '督導巡店', 'inspection_template', 'manage');
```

### 角色權限分配
```sql
-- 督導角色（Supervisor）
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM roles WHERE code = 'supervisor_role'),
  id
FROM permissions
WHERE code IN (
  'inspection.create',
  'inspection.view_own',
  'inspection.view_all',  -- 督導可看所有門市
  'inspection.edit',
  'inspection.delete',
  'inspection.complete',
  'inspection.close',
  'inspection.upload_photo',
  'inspection.export'
);

-- 店長角色（Store Manager）
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM roles WHERE code = 'store_manager_role'),
  id
FROM permissions
WHERE code IN (
  'inspection.view_store',  -- 只能看自己門市
  'inspection.export'
);

-- 管理員角色（Admin）
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  (SELECT id FROM roles WHERE code = 'admin_role'),
  id
FROM permissions
WHERE code LIKE 'inspection.%';
```

## 🛡️ Row Level Security (RLS) 策略

### inspection_masters 表的 RLS
```sql
-- 啟用 RLS
ALTER TABLE inspection_masters ENABLE ROW LEVEL SECURITY;

-- 策略 1：督導可以建立記錄
CREATE POLICY "督導可以建立巡店記錄"
ON inspection_masters
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
    AND p.code = 'inspection.create'
  )
);

-- 策略 2：督導可以查看自己建立的記錄
CREATE POLICY "督導可以查看自己的巡店記錄"
ON inspection_masters
FOR SELECT
TO authenticated
USING (
  inspector_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
    AND p.code IN ('inspection.view_all', 'admin.full_access')
  )
);

-- 策略 3：店長可以查看自己門市的記錄
CREATE POLICY "店長可以查看自己門市的巡店記錄"
ON inspection_masters
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM store_managers sm
    WHERE sm.store_id = inspection_masters.store_id
    AND sm.employee_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid()
    )
  )
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
    AND p.code = 'inspection.view_store'
  )
);

-- 策略 4：督導可以更新自己建立的進行中記錄
CREATE POLICY "督導可以更新自己的巡店記錄"
ON inspection_masters
FOR UPDATE
TO authenticated
USING (
  inspector_id = auth.uid()
  AND status IN ('draft', 'in_progress')
)
WITH CHECK (
  inspector_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
    AND p.code = 'inspection.edit'
  )
);

-- 策略 5：督導可以刪除自己的草稿記錄
CREATE POLICY "督導可以刪除草稿巡店記錄"
ON inspection_masters
FOR DELETE
TO authenticated
USING (
  inspector_id = auth.uid()
  AND status = 'draft'
  AND EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
    AND p.code = 'inspection.delete'
  )
);
```

### inspection_results 表的 RLS
```sql
ALTER TABLE inspection_results ENABLE ROW LEVEL SECURITY;

-- 策略 1：可以查看巡店記錄的人可以查看結果明細
CREATE POLICY "可以查看巡店記錄的用戶可以查看結果明細"
ON inspection_results
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    -- 重用 inspection_masters 的查看權限
    AND (
      im.inspector_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM store_managers sm
        WHERE sm.store_id = im.store_id
        AND sm.employee_id IN (
          SELECT id FROM profiles WHERE user_id = auth.uid()
        )
      )
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = auth.uid()
        AND p.code IN ('inspection.view_all', 'admin.full_access')
      )
    )
  )
);

-- 策略 2：督導可以新增/更新/刪除自己巡店記錄的結果明細
CREATE POLICY "督導可以管理自己巡店記錄的結果明細"
ON inspection_results
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
    AND im.status IN ('draft', 'in_progress')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
    AND im.status IN ('draft', 'in_progress')
  )
);
```

### inspection_templates 表的 RLS
```sql
ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;

-- 策略 1：所有已驗證用戶都可以讀取活動的範本
CREATE POLICY "所有用戶可以讀取活動的檢查範本"
ON inspection_templates
FOR SELECT
TO authenticated
USING (is_active = true);

-- 策略 2：只有管理員可以管理範本
CREATE POLICY "只有管理員可以管理檢查範本"
ON inspection_templates
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
    AND p.code IN ('inspection.template.manage', 'admin.full_access')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid()
    AND p.code IN ('inspection.template.manage', 'admin.full_access')
  )
);
```

### Supabase Storage 的 RLS
```sql
-- 在 Supabase Dashboard 的 Storage 設定

-- Bucket: inspection-photos
-- 設定為 Private

-- 策略 1：督導可以上傳照片到自己的巡店記錄
CREATE POLICY "督導可以上傳巡店照片"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'inspection-photos'
  AND (storage.foldername(name))[1] IN (
    SELECT store_id::text FROM inspection_masters
    WHERE inspector_id = auth.uid()
  )
  AND (storage.foldername(name))[2] IN (
    SELECT id::text FROM inspection_masters
    WHERE inspector_id = auth.uid()
  )
);

-- 策略 2：可以查看巡店記錄的人可以查看照片
CREATE POLICY "有權限的用戶可以查看巡店照片"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'inspection-photos'
  AND (
    -- 督導可以看自己的照片
    (storage.foldername(name))[2] IN (
      SELECT id::text FROM inspection_masters
      WHERE inspector_id = auth.uid()
    )
    -- 店長可以看自己門市的照片
    OR (storage.foldername(name))[1] IN (
      SELECT sm.store_id::text FROM store_managers sm
      WHERE sm.employee_id IN (
        SELECT id FROM profiles WHERE user_id = auth.uid()
      )
    )
    -- 管理員可以看所有照片
    OR EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON ur.role_id = rp.role_id
      JOIN permissions p ON rp.permission_id = p.id
      WHERE ur.user_id = auth.uid()
      AND p.code IN ('inspection.view_all', 'admin.full_access')
    )
  )
);
```

## 🎨 前端頁面結構

```
app/
  inspection/                           # 督導巡店模組（暫不部署）
    page.tsx                            # 巡店記錄列表（督導查看歷史記錄）
    layout.tsx                          # 模組 Layout
    
    create/
      page.tsx                          # 【主要功能】新增巡店記錄
                                        # - 選擇門市
                                        # - GPS 定位簽到
                                        # - 開始巡檢
    
    [id]/
      page.tsx                          # 【核心頁面】進行中的巡店記錄
                                        # - Mobile-First 設計
                                        # - Sticky Header（門市/分數/等級/進度）
                                        # - 五大區塊手風琴
                                        # - Checklist 扣分選項
                                        # - Quantity 計數器
                                        # - 相機拍照功能
                                        # - 即時計算總分與等級
      
      edit/
        page.tsx                        # 編輯模式（與上面共用元件）
      
      close/
        page.tsx                        # 結案頁面
                                        # - 督導建議輸入
                                        # - 上傳簽名單照片
                                        # - 確認結案
    
    reports/
      page.tsx                          # 報表統計
                                        # - 年/月曆表
                                        # - 門市巡店歷史
                                        # - 等級統計圖表
    
    print/
      [id]/
        page.tsx                        # 列印頁面（@media print 優化）
                                        # - A4 格式
                                        # - 待改善項目彙整
                                        # - 照片展示
                                        # - 簽名區

components/
  inspection/
    # 核心元件
    InspectionHeader.tsx                # Sticky Header（門市/分數/等級/進度條）
    InspectionForm.tsx                  # 主表單容器
    SectionAccordion.tsx                # 五大區塊手風琴元件
    
    # 評分元件
    ChecklistScoring.tsx                # Checklist 複選扣分元件
                                        # - 顯示扣分項目
                                        # - 多選框
                                        # - 自動計算扣分
    
    QuantityScoring.tsx                 # Quantity 數量計數器元件
               /templates
  GET     - 取得檢查項目範本列表（五大區塊）

/api/inspection/masters
  GET     - 取得巡店記錄列表（分頁、篩選）
            Query: ?store_id=xxx&inspector_id=xxx&date_from=xxx&date_to=xxx&grade=S/A/B/F
  POST    - 新增巡店記錄（建立草稿）
            Body: { store_id, inspector_id, gps_latitude, gps_longitude }

/api/inspection/masters/[id]
  GET     - 取得單筆巡店記錄（含所有項目評分）
  PATCH   - 更新巡店記錄（總分、等級、狀態）
  DELETE  - 刪除巡店記錄（僅限草稿狀態）

/api/inspection/masters/[id]/results
  GET     - 取得該巡店的所有項目評分
  POST    - 批次更新多個項目評分
            Body: [{ template_id, given_score, selected_items, quantity_count, notes }]

/api/inspection/masters/[id]/results/[resultId]
  PATCH   - 更新單個項目評分
  POST    - 上傳該項目的照片

/api/inspection/masters/[id]/complete
  POST    - 完成巡店記錄（狀態改為 completed）

/api/inspection/masters/[id]/close
  POST    - 結案巡店記錄（上傳簽名單照片）
            Body: { signature_photo_url, supervisor_notes, improvement_suggestions }

/api/inspection/upload
  POST    - 上傳照片到 Supabase Storage
            Body: FormData { file, store_id, inspection_id, template_id }
            Response: { url, path }

/api/inspection/reports/stats
  GET     - 統計報表資料
            Query: ?store_id=xxx&date_from=xxx&date_to=xxx
            Response: { total_inspections, grade_distribution, avg_score, ... }

/api/inspection/reports/export
  POST    - 匯出 PDF（用於列印）
            Body: { inspection_id }
            Response: PDF Blob 或 PDF URL
```

## 📱 Navbar 整合

### 在 Navbar.tsx 添加選單項目
```typescript
// components/Navbar.tsx
const inspectionSubItems = [
  {
    name: '新增巡店記錄',
    href: '/inspection/create',
    icon: PlusCircleIcon,
    show: hasPermission('inspection.create'),
  },
  {
    name: '我的巡店記錄',
    href: '/inspection',
    icon: ClipboardDocumentListIcon,
    show: hasPermission('inspection.view_own'),
  },
  {
    name: '所有巡店記錄',
    href: '/inspection/all',
    icon: FolderOpenIcon,
    show: hasPermission('inspection.view_all'),
  },
  {
    name: '門市巡店歷史',
    href: '/inspection/store',
    icon: BuildingStorefrontIcon,
    show: hasPermission('inspection.view_store'),
  },
  {
    name: '巡店報表統計',
    href: '/inspection/reports',
    icon: ChartBarIcon,
    show: hasPermission('inspection.export'),
  },
];

// 主選單項目
{
  name: '督導巡店',
  icon: ClipboardDocumentCheckIcon,
  href: '/inspection',
  show: hasAnyPermission([
    'inspection.create',
    'inspection.view_own',
    'inspection.view_store',
    'inspection.view_all',
  ]),
  subItems: inspectionSubItems,
}
```

## 📝 開發優先順序與時程

### Phase 1: 資料庫與權限基礎（1 天）
**目標**：建立完整資料結構與權限系統

- [x] 建立 `inspection_templates` 表
- [x] 建立 `inspection_masters` 表
- [x] 建立 `inspection_results` 表
- [x] 設定 RLS 策略
- [x] 新增 RBAC 權限
- [x] 匯入 220 分題庫（從 Excel）
- [x] 建立 Supabase Storage Bucket
- [ ] 測試資料庫 Trigger 與 Function

**SQL 檔案**：
- `supabase/migration_add_inspection_system.sql`（主要 Migration）
- `supabase/migration_add_inspection_permissions.sql`（權限設定）
- `supabase/seed_inspection_templates.sql`（題庫匯入）

### Phase 2: 核心評分功能（2-3 天）
**目標**：實現 Mobile-First 巡店表單與評分邏輯

**前端開發**：
- [ ] 建立基本頁面結構（layout, create, [id]）
- [ ] Sticky Header 元件（門市/分數/等級/進度）
- [ ] 手風琴摺疊元件（五大區塊）
- [ ] Checklist 複選扣分元件
- [ ] Quantity 計數器元件
- [ ] 即時評分計算邏輯
- [ ] 等級判定與顏色變化

**API 開發**：
- [ ] GET /api/inspection/templates（取得題庫）
- [ ] POST /api/inspection/masters（建立巡店記錄）
- [ ] GET /api/inspection/masters/[id]（取得記錄）
- [ ] POST /api/inspection/masters/[id]/results（批次更新評分）
- [ ] PATCH /api/inspection/masters/[id]（更新總分與等級）

**測試重點**：
- 評分計算正確性（220 分總分）
- 等級判定邏輯（S/A/B/F）
- 自動標記改善項目（given_score < max_score）

### Phase 3: 圖片上傳與壓縮（1-2 天）
**目標**：實現相機拍照、Web Worker 壓縮、上傳功能

**功能開發**：
- [ ] 安裝 `browser-image-compression` 套件
- [ ] Web Worker 圖片壓縮（300KB WebP）
- [ ] 相機調用元件（Mobile 優先）
- [ ] 照片上傳元件（進度條）
- [ ] 照片瀏覽元件（縮圖網格）
- [ ] Supabase Storage 上傳邏輯
- [ ] JSONB 陣列更新（photo_urls）

**API 開發**：
- [ ] POST /api/inspection/upload（上傳照片）
- [ ] DELETE /api/inspection/upload（刪除照片）

**測試重點**：
- 壓縮後檔案 < 300KB
- WebP 格式轉換成功
- Web Worker 不阻塞 UI
- 多張照片上傳與管理

### Phase 4: GPS 定位與結案流程（1 天）
**目標**：實現 GPS 簽到與簽名單上傳結案

**功能開發**：
- [ ] GPS 定位工具（getCurrentPosition）
- [ ] 門市距離驗證邏輯
- [ ] 結案頁面（督導建議輸入）
- [ ] 簽名單照片上傳
- [ ] 狀態流程管理（draft → in_progress → completed → closed）

**API 開發**：
- [ ] POST /api/inspection/masters/[id]/complete
- [ ] POST /api/inspection/masters/[id]/close

### Phase 5: 列印報表與統計（1-2 天）
**目標**：實現 A4 列印格式與後台統計報表

**功能開發**：
- [ ] 列印頁面佈局（@media print CSS）
- [ ] 待改善項目彙整區塊
- [ ] 照片展示（多張排版）
- [ ] 簽名區預留空間
- [ ] 報表統計頁面（年/月曆表）
- [ ] 門市巡店歷史查詢
- [ ] 等級分布圖表（Chart.js 或 Recharts）

**API 開發**：
- [ ] GET /api/inspection/reports/stats
- [ ] POST /api/inspection/reports/export（PDF 生成，可選）

### Phase 6: 測試與優化（1 天）
**目標**：全面測試與效能優化

**測試項目**：
- [ ] 不同角色權限測試（督導/店長/管理員）
- [ ] RLS 策略驗證
- [ ] Mobile 裝置實測（拍照、壓縮、上傳）
- [ ] 列印格式測試（A4 紙張）
- [ ] 評分邏輯壓力測試
- [ ] 照片上傳效能測試

**優化重點**：
- Web Worker 壓縮效能
- 圖片載入優化（lazy loading）
- API 回應時間優化
- 列印樣式微調

## 🚀 部署策略（暫不部署 Vercel）

### 方案 1：使用 Feature Branch（推薦）
```bash
# 建立功能分支
git checkout -b feature/inspection-system

# 在此分支開發所有功能
git add .
git commit -m "feat: 實作督導巡店系統"

# 定期推送到遠端（不合併到 main）
git push origin feature/inspection-system

# Vercel 只部署 main 分支，feature 分支不會自動部署
```

### 方案 2：使用 .gitignore（不推薦）
```gitignore
# .gitignore
app/inspection/
components/inspection/
lib/inspection/
supabase/migration_add_inspection_*.sql
supabase/seed_inspection_*.sql
```
**缺點**：程式碼不會被版本控制，容易遺失

### 準備上線時
1. **合併 Feature Branch**：
   ```bash
   git checkout main
   git merge feature/inspection-system
   git push origin main
   ```

2. **執行資料庫 Migration**：
   - 在 Supabase SQL Editor 執行所有 migration SQL
   - 確認 RLS 策略正確啟用
   - 測試權限分配

3. **更新 Navbar**：
   - 確認權限檢查邏輯
   - 測試選單顯示

4. **Vercel 自動部署**：
   - Push 到 main 後自動觸發
   - 檢查部署狀態
   - 測試線上功能

## 🛠️ 技術棧與套件

### 前端套件
```json
{
  "dependencies": {
    "browser-image-compression": "^2.0.2",  // 圖片壓縮
    "react-webcam": "^7.2.0",                // 相機調用（可選）
    "recharts": "^2.10.3",                   // 圖表統計（報表用）
    "@heroicons/react": "^2.1.1"             // 圖示（已有）
  }
}
```

### Supabase 功能
- ✅ PostgreSQL Database（資料庫）
- ✅ Row Level Security（RLS 安全策略）
- ✅ Storage（照片儲存）
- ✅ Realtime（可選，多人協作時使用）

### 開發工具
- TypeScript（型別安全）
- Tailwind CSS（樣式，Mobile-First）
- Next.js 14 App Router（路由）
- Supabase Client（資料庫連線）

---

## ✅ 下一步行動

### 立即執行
1. **確認需求**：
   - 檢查 Excel 檢查表的五大區塊分數是否正確
   - 確認評分方式（Checklist vs Quantity）
   - 確認等級標準（S/A/B/F）

2. **建立 Feature Branch**：
   ```bash
   git checkout -b feature/inspection-system
   ```

3. **執行 Phase 1**：
   - 建立資料庫 Migration SQL
   - 建立權限設定 SQL
   - 匯入題庫 SQL（220 分）

### 等待確認
- [ ] Excel 檢查表的詳細項目與扣分標準（我已從圖片分析，待確認）
- [ ] GPS 定位驗證是否需要（距離門市多遠算合格？）
- [ ] 是否需要通知功能（Email 或系統內通知）
- [ ] 是否需要改善期限追蹤（店長回應改善狀況）
- [ ] PDF 匯出是否必要（或只需列印功能即可）

**文檔版本**：v2.0  
**建立日期**：2026-02-13  
**更新日期**：2026-02-13  
**狀態**：設計完成，等待確認後開始開發
  /* 待改善項目區塊強化 */
  .improvement-section {
    border: 2px solid #ef4444;
    padding: 12px;
    margin: 16px 0;
    page-break-inside: avoid;
  }
  
  /* 照片尺寸 */
  .inspection-photo {
    max-width: 45%;
    height: auto;
    page-break-inside: avoid;
  }
  
  /* 簽名區 */
  .signature-area {
    min-height: 80px;
    border-bottom: 1px solid #000;
    margin-top: 40px;
  }
}
```

### 列印報表結構
```
第1頁：
├── 標題與基本資訊
│   ├── 門市名稱、地址
│   ├── 巡店日期、督導姓名
│   ├── 總分、等級（大字體突出）
│
├── 五大區塊得分概覽
│   └── 各區塊得分 / 滿分
│
└── 詳細評分項目（正常項目簡列）

第2頁：（如需要）
├── 【重點】待改善項目彙整
│   ├── 項目 1
│   │   ├── 缺失描述
│   │   ├── 扣除分數
│   │   ├── 督導備註
│   │   └── 缺失照片（2-4張）
│   ├── 項目 2
│   │   └── ...
│   └── 項目 N
│
├── 督導整體建議
│   └── 大空格文字區域
│
└── 簽名區
    ├── 店長/店主管簽名：_____________ 日期：_____
    └── 督導簽名：_____________ 日期：_____
```

## 🔄 API 路由設計

```
/api/inspections
  GET     - 取得巡店記錄列表（分頁、篩選）
  POST    - 新增巡店記錄

/api/inspections/[id]
  GET     - 取得單筆巡店記錄
  PATCH   - 更新巡店記錄
  DELETE  - 刪除巡店記錄

/api/inspections/[id]/submit
  POST    - 提交巡店記錄

/api/inspections/[id]/issues
  GET     - 取得該巡店的問題列表
  POST    - 新增問題

/api/inspections/issues/[issueId]
  PATCH   - 更新問題狀態
  DELETE  - 刪除問題

/api/inspections/reports
  GET     - 取得統計報表資料

/api/inspections/export
  POST    - 匯出 Excel
```

## 📝 開發優先順序

### Phase 1: 基礎功能（2-3天）
1. 建立資料庫結構
2. 新增權限設定
3. 建立基本 CRUD API
4. 建立巡店記錄表單
5. 建立巡店記錄列表

### Phase 2: 進階功能（2-3天）
1. 問題追蹤功能
2. 照片上傳功能
3. 評分計算邏輯
4. 狀態流程管理

### Phase 3: 報表與通知（1-2天）
1. 統計報表頁面
2. Excel 匯出功能
3. 通知機制（可選）

## 🚀 部署策略

### 開發期間（暫不部署 Vercel）
```json
// .gitignore 添加
app/inspection/
components/inspection/
```

或使用 feature branch:
```bash
git checkout -b feature/store-inspection
# 在此分支開發，不合併到 main
```

### 準備上線時
1. 執行資料庫 migration
2. 更新 Navbar 權限檢查
3. 測試所有功能
4. 合併到 main 並部署

## ❓ 需要確認的問題

1. **檢查項目**：是否需要自訂檢查項目範本？
2. **評分標準**：1-5分？或是 優/良/可/差？
3. **照片上傳**：使用 Supabase Storage 還是其他服務？
4. **通知方式**：Email？系統內通知？
5. **改善期限**：是否需要自動計算（例如：一般問題 7 天，嚴重問題 3 天）？
6. **歷史記錄**：是否需要保留巡店記錄的修改歷史？

---

**文檔版本**：v1.0  
**建立日期**：2026-02-13  
**狀態**：設計階段
