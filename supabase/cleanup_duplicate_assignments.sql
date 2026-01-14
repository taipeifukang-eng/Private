-- 清理重複任務記錄的 SQL 腳本
-- 執行前請先備份數據！

-- 1. 查看重複的任務（相同的 template_id 和相同的協作人員）
WITH duplicate_assignments AS (
  SELECT 
    a.template_id,
    a.status,
    array_agg(ac.user_id ORDER BY ac.user_id) as collaborators,
    array_agg(a.id ORDER BY a.created_at) as assignment_ids,
    COUNT(*) as count
  FROM assignments a
  LEFT JOIN assignment_collaborators ac ON a.id = ac.assignment_id
  GROUP BY a.template_id, a.status, a.id
  HAVING COUNT(*) > 1
)
SELECT * FROM duplicate_assignments;

-- 2. 查找完全重複的任務（相同模板、相同狀態、相同協作人員）
WITH ranked_assignments AS (
  SELECT 
    a.*,
    array_agg(ac.user_id ORDER BY ac.user_id) as collaborators,
    ROW_NUMBER() OVER (
      PARTITION BY a.template_id, a.status, array_agg(ac.user_id ORDER BY ac.user_id)
      ORDER BY a.created_at ASC
    ) as rn
  FROM assignments a
  LEFT JOIN assignment_collaborators ac ON a.id = ac.assignment_id
  GROUP BY a.id, a.template_id, a.assigned_to, a.status, a.created_at
)
SELECT * FROM ranked_assignments
WHERE rn > 1;

-- 3. 刪除重複的任務（保留最早創建的）
-- ⚠️ 注意：執行此步驟將永久刪除數據！請先確認上面的查詢結果！
-- 取消註釋以下代碼來執行刪除：

/*
WITH ranked_assignments AS (
  SELECT 
    a.id,
    a.template_id,
    a.status,
    array_agg(ac.user_id ORDER BY ac.user_id) as collaborators,
    ROW_NUMBER() OVER (
      PARTITION BY a.template_id, a.status
      ORDER BY a.created_at ASC
    ) as rn
  FROM assignments a
  LEFT JOIN assignment_collaborators ac ON a.id = ac.assignment_id
  GROUP BY a.id, a.template_id, a.assigned_to, a.status, a.created_at
)
DELETE FROM assignments
WHERE id IN (
  SELECT id FROM ranked_assignments WHERE rn > 1
);
*/

-- 4. 驗證清理結果
SELECT 
  t.title as template_name,
  COUNT(a.id) as assignment_count,
  COUNT(DISTINCT a.status) as status_types,
  string_agg(DISTINCT a.status, ', ') as statuses
FROM templates t
LEFT JOIN assignments a ON t.id = a.template_id
GROUP BY t.id, t.title
ORDER BY t.title;

-- 5. 查看所有任務及其協作人員
SELECT 
  t.title as template_name,
  a.id as assignment_id,
  a.status,
  a.created_at,
  array_agg(DISTINCT p.email) as collaborator_emails
FROM assignments a
JOIN templates t ON a.template_id = t.id
LEFT JOIN assignment_collaborators ac ON a.id = ac.assignment_id
LEFT JOIN profiles p ON ac.user_id = p.id
GROUP BY t.title, a.id, a.status, a.created_at
ORDER BY t.title, a.created_at DESC;
