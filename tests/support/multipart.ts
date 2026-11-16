import { M7_FILE_PREFIX } from './m7m8-fixtures';
// 檔名一律加 m7m8t- 前綴（cleanupM7M8 靠它清除工單附件與儲存檔）。
// 手動組 multipart/form-data（Playwright 的 multipart 選項不支援同名欄位送多個檔案）。
export type MpFile = { name: string; mimeType: string; buffer: Buffer };
export function multipartBody(files: MpFile[], fields: Record<string, string> = {}, fileField = 'files') {
  const boundary = `----m7m8${Math.random().toString(16).slice(2)}${Date.now()}`;
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${M7_FILE_PREFIX}${f.name}"\r\nContent-Type: ${f.mimeType}\r\n\r\n`, 'utf8'));
    chunks.push(f.buffer, Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { data: Buffer.concat(chunks), headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } as Record<string, string> };
}
