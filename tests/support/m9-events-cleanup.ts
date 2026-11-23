import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 稽核表 workspace_page_fallback_events 在資料庫層只授予 service_role 讀取與新增（不可刪），
 * 所以測試要清掉自己新增的稽核列，只能用 supabase CLI（資料庫擁有者）。只刪指定 kind、且在 sinceIso 之後新增的列。
 * 只對 DEV 執行（supabase/.temp/project-ref 必須以 mjpd 開頭），失敗只回傳錯誤訊息、不丟例外。
 */
export function deleteOwnFallbackEvents(kind: string, sinceIso: string): string | null {
  const root = path.resolve(__dirname, '..', '..');
  try {
    const ref = fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim();
    if (!ref.startsWith('mjpd')) return '不是 DEV 專案，略過稽核列清除';
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(kind) || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(sinceIso)) return '參數格式不符，略過稽核列清除';
    const file = path.join(os.tmpdir(), `m9-events-cleanup-${process.pid}.sql`);
    fs.writeFileSync(file, `DELETE FROM public.workspace_page_fallback_events WHERE kind = '${kind}' AND created_at >= '${sinceIso}';\n`);
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `supabase db query --linked --file "${file}"`], { cwd: root, encoding: 'utf8' });
    try { fs.unlinkSync(file); } catch {}
    return r.status ? `清除稽核列失敗：${(r.stderr || r.stdout || '').slice(0, 200)}` : null;
  } catch (e) {
    return `清除稽核列失敗：${String((e as Error).message).slice(0, 200)}`;
  }
}
