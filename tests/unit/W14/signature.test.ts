import { describe, expect, it } from 'vitest';
import { completedSignatureError, isSignedImage, MIN_INK_PIXELS, pngInkPixels } from '../../../lib/workspace/inspection-signature';
import { BLANK_TRANSPARENT, BLANK_WHITE, makePng, pngDataUrl, SIGNED } from '../../support/png';

// M4 Q12：空白簽名不能確認；後端檢查非空白與雙簽名（草稿不限）。
describe('簽名圖片非空白檢查', () => {
  it('全白圖片、全透明圖片都不算已簽名', () => {
    expect(pngInkPixels(makePng())).toBe(0);
    expect(isSignedImage(BLANK_WHITE())).toBe(false);
    expect(isSignedImage(BLANK_TRANSPARENT())).toBe(false);
  });
  it('有筆跡的圖片算已簽名，邊界為 MIN_INK_PIXELS', () => {
    expect(isSignedImage(SIGNED())).toBe(true);
    expect(isSignedImage(pngDataUrl(makePng({ inkPixels: MIN_INK_PIXELS })))).toBe(true);
    expect(isSignedImage(pngDataUrl(makePng({ inkPixels: MIN_INK_PIXELS - 1 })))).toBe(false);
  });
  it('空值、非 PNG、壞掉的 PNG、非 https 網址都不算', () => {
    for (const v of [null, undefined, '', 'data:image/jpeg;base64,AAAA', 'data:image/png;base64,AAAA', 'http://x/y.png', 'javascript:alert(1)'])
      expect(isSignedImage(v as any), String(v)).toBe(false);
  });
  it('先前已存的 https 簽名視為有效', () => {
    expect(isSignedImage('https://storage.example/signature.png')).toBe(true);
  });
});

describe('正式送出雙簽名檢查', () => {
  it('缺任一個簽名都擋下', () => {
    expect(completedSignatureError('', SIGNED())).toMatch(/兩個簽名/);
    expect(completedSignatureError(SIGNED(), '')).toMatch(/兩個簽名/);
    expect(completedSignatureError(null, null)).toMatch(/兩個簽名/);
  });
  it('任一個空白都擋下', () => {
    expect(completedSignatureError(BLANK_WHITE(), SIGNED())).toMatch(/空白/);
    expect(completedSignatureError(SIGNED(), BLANK_TRANSPARENT())).toMatch(/空白/);
  });
  it('兩個都有筆跡才通過', () => {
    expect(completedSignatureError(SIGNED(), SIGNED())).toBeNull();
  });
});
