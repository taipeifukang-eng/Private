-- 查看 stores 表結構
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'stores';
