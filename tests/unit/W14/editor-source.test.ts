import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// W14／W15 單元層：編輯器與相關元件的關鍵結構（不需要瀏覽器）。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const editor = read('vue-workspace/src/pages/InspectionEditor.vue');
const capture = read('vue-workspace/src/components/InspectionPhotoCapture.vue');
const signature = read('vue-workspace/src/components/SignatureInput.vue');
const route = read('app/api/workspace/inspection-form/route.ts');
const css = read('vue-workspace/src/style.css');

describe('問題照片連續拍照（使用者追加要求）', () => {
  it('input 具 accept="image/*" 與 capture="environment"，直接開後鏡頭', () => {
    expect(capture).toContain('accept="image/*"');
    expect(capture).toContain('capture="environment"');
    expect(capture).not.toContain('image/jpeg,image/png,image/webp');
  });
  it('與舊版 app/inspection/new/page.tsx 的拍照 input 屬性一致', () => {
    const legacy = read('app/inspection/new/page.tsx');
    expect(legacy).toContain('accept="image/*"');
    expect(legacy).toContain('capture="environment"');
  });
  it('拍完立即重置輸入欄位，按鈕在未滿 5 張時留在原位，滿 5 張消失並顯示上限文字', () => {
    expect(capture).toContain('input.value = ""');
    expect(capture).toContain('v-if="photos.length < MAX"');
    expect(capture).toContain('已達上傳上限（5張）');
  });
  it('背景依序處理（promise chain），按鈕不因處理中而停用', () => {
    expect(capture).toContain('chain = chain.then');
    expect(capture).not.toMatch(/:disabled="processing/);
  });
  it('縮圖有刪除鈕，手機觸控區至少 96×96', () => {
    expect(capture).toContain('class="photo-remove"');
    expect(css).toMatch(/\.photo-capture-button\{[^}]*width:96px;height:96px;min-width:96px;min-height:96px/);
  });
  it('編輯器使用連拍元件，拍照與刪除都立即寫入本機暫存', () => {
    expect(editor).toContain('<InspectionPhotoCapture');
    expect(editor).not.toContain('type="file"');
    expect(editor).toMatch(/function addPhoto[\s\S]*?void flushDraft\(\)/);
    expect(editor).toMatch(/function removePhoto[\s\S]*?void flushDraft\(\)/);
  });
});

describe('F3 提交按鈕：簽名未完成即停用', () => {
  it('兩個簽名任一缺少時「提交巡店」停用，儲存草稿不受影響', () => {
    expect(editor).toContain(':disabled="disabled || missingSignatures.length > 0"');
    expect(editor).toMatch(/<button type="button" @click="save\('draft'\)" :disabled="disabled">/);
  });
  it('旁邊文字說明缺哪個簽名', () => {
    expect(editor).toContain('"店長／當班主管簽名"');
    expect(editor).toContain('"督導簽名"');
    expect(editor).toContain('data-testid="submit-signature-hint"');
    expect(editor).toContain('"請完成店長／當班主管簽名與督導簽名"');
  });
  it('後端雙簽名檢查保留', () => {
    expect(route).toContain('completedSignatureError(body.signature, body.supervisorSignature)');
  });
});

describe('Q12 簽名', () => {
  it('簽名板沒畫筆跡前「確認簽名」為停用', () => {
    expect(signature).toContain(':disabled="!hasInk"');
    expect(signature).toContain('if (!hasInk.value) return;');
  });
  it('標籤維持「店長／當班主管」', () => {
    expect(editor).toContain('label="店長／當班主管確認簽名"');
  });
  it('正式送出前端檢查雙簽名；伺服端檢查非空白（草稿不限）', () => {
    expect(editor).toContain('status === "completed" && (!form.value.signature || !form.value.supervisorSignature)');
    expect(route).toContain('completedSignatureError(body.signature, body.supervisorSignature)');
    expect(route).toMatch(/if \(body\.status === "completed"\)/);
  });
});

describe('Q9 / Q10 範本變更與只評原有項目', () => {
  it('伺服端仍擋下範本已更新的送出', () => {
    expect(route).toContain('巡店範本已更新，請保留草稿並重新載入');
  });
  it('編輯舊單只載入舊單當時有的項目，不再補「目前啟用」項目', () => {
    expect(route).toContain('q.in("id", ids)');
    expect(route).not.toContain('is_active.eq.true,id.in.');
  });
  it('前端收到範本已更新就重新載入並保留內容、要求確認清單', () => {
    expect(editor).toContain('reloadTemplates()');
    expect(editor).toContain('data-testid="carryover-notices"');
    expect(editor).toContain('data-testid="template-disabled"');
    expect(editor).toContain('noticesAck');
  });
});

describe('Q13 當班人員', () => {
  it('換門市（同步監看）會取名單；有手動修改先跳確認', () => {
    expect(editor).toMatch(/watch\(\s*\(\) => form\.value\.store[\s\S]*?flush: "sync"/);
    expect(editor).toContain('hasManualStaffEdits(form.value.staff, autoRoster)');
    expect(editor).toContain('data-testid="staff-replace"');
  });
});

describe('Q14–Q16 離線暫存', () => {
  it('不還原需要再確認一次才刪除', () => {
    expect(editor).toContain('data-testid="restore-no"');
    expect(editor).toContain('data-testid="restore-delete"');
    expect(editor).toContain('確定刪除暫存？');
  });
  it('網路中斷顯示手動重送提示、不自動補送', () => {
    expect(editor).toContain('OFFLINE_RETRY_MESSAGE');
    expect(editor).toMatch(/e\.status === 0/);
  });
  it('伺服器儲存成功後清除暫存；已完成不能編輯的單也清除', () => {
    expect(editor).toContain('await clearDrafts(wasRecord)');
    expect(editor).toMatch(/已完成或已結案[\s\S]*?removeDraft/);
  });
  it('暫存依使用者 id 分開（key 含 userId）', () => {
    expect(editor).toContain('draftKey(userId.value');
    const idb = read('vue-workspace/src/inspection-offline.ts');
    expect(idb).toContain('draftUsable(draft, userId)');
    expect(idb).toContain('purgeExpiredDrafts');
  });
});
