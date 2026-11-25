// 總務畫面的完成提示文字（純函式，Vue 頁面與單元測試共用）。
/** 動作完成的提示：動作標題本身已以「完成」結尾（例如「確認完成」）時只加句號，避免變成「確認完成完成。」；其餘照舊「xxx完成。」（例如「受理需求完成。」）。 */
export function doneNotice(title: string): string {
  const t = String(title ?? "");
  return t.endsWith("完成") ? `${t}。` : `${t}完成。`;
}
