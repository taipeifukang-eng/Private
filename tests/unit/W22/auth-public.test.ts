import { describe, expect, it } from 'vitest';
import {
  FORGOT_PASSWORD_NOTICE,
  MIN_PASSWORD_LENGTH,
  friendlyAuthError,
  isPendingAccount,
  isValidEmail,
  mailMockActive,
  passwordStrength,
  resetRedirectUrl,
  safeInternalPath,
  safeRedirectPath,
  validateNewPassword,
  validateRegister,
} from '@/lib/workspace/auth-public';
import { resolveAccess } from '@/lib/workspace/permission-semantics';

// 舊版登入頁的回原頁判斷（app/login/page.tsx 逐字）
const legacySafeRedirect = (redirectPath: string | null) =>
  redirectPath?.startsWith('/') && !redirectPath.startsWith('//') ? redirectPath : '/';

describe('W22 登入後回原頁：只允許站內路徑', () => {
  const accept = ['/activity-view/abc', '/general-affairs/assets/scan/AB-12_x', '/admin/users?tab=1', '/x#y', '/workspace/index.html#/open/activity-view/1'];
  const reject = [
    '', ' ', 'https://evil.example', 'http://evil.example/x', '//evil.example', '///evil.example', '/\\evil.example', '\\\\evil.example',
    'javascript:alert(1)', 'evil.example', '/%2F%2Fevil.example', '/%5Cevil.example', '/a\nb', '/a\u0000b', '/' + 'a'.repeat(600), '/login', '/login?redirect=/x', '/register', '/forgot-password', '/reset-password', '/auth/callback',
  ];
  for (const v of accept) it(`接受 ${JSON.stringify(v)}`, () => expect(safeRedirectPath(v)).toBe(v));
  for (const v of reject) it(`拒絕 ${JSON.stringify(v.slice(0, 40))}`, () => expect(safeRedirectPath(v)).toBeNull());
  it('非字串一律拒絕', () => {
    for (const v of [null, undefined, 1, {}, ['/a']]) expect(safeRedirectPath(v)).toBeNull();
  });
  it('新版放行的，舊版一定也放行（只有更嚴格，沒有更寬鬆）', () => {
    for (const v of [...accept, ...reject]) {
      const native = safeRedirectPath(v);
      if (native) expect(legacySafeRedirect(v), v).toBe(native);
    }
  });
  it('safeInternalPath 不含迴圈判斷（給 /auth/callback 的 next 用）', () => {
    expect(safeInternalPath('/reset-password')).toBe('/reset-password');
    expect(safeInternalPath('//evil.example')).toBeNull();
    expect(safeInternalPath('https://evil.example')).toBeNull();
  });
});

describe('W22 Q16 密碼規則：最短 6 字元，照舊', () => {
  it('常數為 6', () => expect(MIN_PASSWORD_LENGTH).toBe(6));
  it('邊界：5 字元拒絕、6 字元接受', () => {
    expect(validateNewPassword('12345', '12345')).not.toBeNull();
    expect(validateNewPassword('123456', '123456')).toBeNull();
    expect(validateRegister({ fullName: 'A', email: 'a@b.co', password: '12345', confirmPassword: '12345' })).toBe('密碼至少需要 6 個字元');
    expect(validateRegister({ fullName: 'A', email: 'a@b.co', password: '123456', confirmPassword: '123456' })).toBeNull();
  });
  it('提示文字沿用舊版各頁原句', () => {
    expect(validateNewPassword('123', '123', 'register')).toBe('密碼至少需要 6 個字元');
    expect(validateNewPassword('123', '123', 'reset')).toBe('密碼長度至少需要 6 個字元');
    expect(validateNewPassword('123456', '1234567', 'register')).toBe('密碼不一致');
    expect(validateNewPassword('123456', '1234567', 'reset')).toBe('兩次輸入的密碼不一致');
  });
  it('過長、非字串', () => {
    expect(validateNewPassword('a'.repeat(73), 'a'.repeat(73))).toMatch(/最多/);
    expect(validateNewPassword(undefined)).not.toBeNull();
    expect(validateNewPassword(123456 as unknown)).not.toBeNull();
  });
  it('不比對確認欄時（confirm 省略）只檢查長度', () => expect(validateNewPassword('abcdef')).toBeNull());
});

describe('W22 註冊欄位驗證', () => {
  const ok = { fullName: '王小明', email: 'user@example.com', password: 'abcdef', confirmPassword: 'abcdef' };
  it('合法輸入', () => expect(validateRegister(ok)).toBeNull());
  it('姓名必填（空白也算沒填）、過長', () => {
    expect(validateRegister({ ...ok, fullName: '' })).toBe('請輸入姓名');
    expect(validateRegister({ ...ok, fullName: '   ' })).toBe('請輸入姓名');
    expect(validateRegister({ ...ok, fullName: 'x'.repeat(101) })).toMatch(/姓名最多/);
  });
  it('信箱格式', () => {
    for (const e of ['', 'abc', 'a@b', 'a@@b.co', 'a b@c.co', '<x>@b.co', 'a@b.c']) expect(validateRegister({ ...ok, email: e }), e).toBe('請輸入有效的電子郵件');
    for (const e of ['a@b.co', 'first.last+tag@sub.example.com', 'm5p-test-x@example.test']) expect(isValidEmail(e), e).toBe(true);
    expect(isValidEmail('a'.repeat(250) + '@b.co')).toBe(false);
  });
  it('兩次密碼不一致', () => expect(validateRegister({ ...ok, confirmPassword: 'abcdeg' })).toBe('密碼不一致'));
});

describe('W22 錯誤訊息中文化', () => {
  const table: [string, 'register' | 'reset', RegExp][] = [
    ['User already registered', 'register', /已經註冊/],
    ['A user with this email address has already been registered', 'register', /已經註冊/],
    ['Signups not allowed for this instance', 'register', /未開放註冊/],
    ['Password should be at least 6 characters', 'register', /至少需要 6/],
    ['Unable to validate email address: invalid format', 'register', /有效的電子郵件/],
    ['email rate limit exceeded', 'register', /太頻繁/],
    ['For security purposes, you can only request this after 33 seconds.', 'reset', /太頻繁/],
    ['New password should be different from the old password.', 'reset', /不能與目前/],
    ['Auth session missing!', 'reset', /已失效/],
    ['Token has expired or is invalid', 'reset', /已失效/],
    ['something totally unknown 123', 'register', /註冊失敗/],
    ['something totally unknown 123', 'reset', /重設密碼失敗/],
  ];
  for (const [m, kind, re] of table) it(`${kind}: ${m}`, () => expect(friendlyAuthError(m, kind)).toMatch(re));
  it('輸出一律不含英文原文', () => {
    for (const [m, kind] of table) expect(friendlyAuthError(m, kind)).not.toMatch(/[A-Za-z]{4,}/);
  });
});

describe('W22 忘記密碼提示與重設連結網址', () => {
  it('提示固定、不提到帳號是否存在', () => {
    expect(FORGOT_PASSWORD_NOTICE).toContain('若此信箱已註冊');
    expect(FORGOT_PASSWORD_NOTICE).not.toMatch(/找不到|不存在|未註冊/);
  });
  it('重設連結：網址去尾斜線後接 /auth/callback?next=/reset-password', () => {
    expect(resetRedirectUrl('https://app.example.com')).toBe('https://app.example.com/auth/callback?next=/reset-password');
    expect(resetRedirectUrl('https://app.example.com///')).toBe('https://app.example.com/auth/callback?next=/reset-password');
    expect(resetRedirectUrl(' http://localhost:3000 ')).toBe('http://localhost:3000/auth/callback?next=/reset-password');
  });
  it('缺設定或格式不對直接報錯（舊版會退回 localhost:3000）', () => {
    for (const v of [undefined, null, '', '   ', 'app.example.com', 'ftp://x.com', 'https://', 'https://a.com/path']) expect(() => resetRedirectUrl(v as string), String(v)).toThrow('SITE_URL_MISSING');
  });
});

describe('W22 信件 mock（D17）', () => {
  it('旗標與保留網域兩個條件都成立才 mock', () => {
    expect(mailMockActive('true', 'm5p-test-a@example.test')).toBe(true);
    expect(mailMockActive('true', ' M5P-Test-A@EXAMPLE.TEST ')).toBe(true);
    expect(mailMockActive(undefined, 'a@example.test')).toBe(false);
    expect(mailMockActive('false', 'a@example.test')).toBe(false);
    expect(mailMockActive('true', 'a@example.com')).toBe(false);
    expect(mailMockActive('true', 'a@example.test.evil.com')).toBe(false);
    expect(mailMockActive('true', 'a@evil-example.test.com')).toBe(false);
  });
});

describe('W22 Q15 待開通判定', () => {
  const role = (code: string, perms: string[] = []) => ({ is_active: true, expires_at: null as string | null, role: { code, is_active: true, role_permissions: perms.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } });
  it('沒有任何指派且 profiles.role 不是 admin = 待開通', () => {
    expect(isPendingAccount(resolveAccess([], 'member'))).toBe(true);
    expect(isPendingAccount(resolveAccess(null, null))).toBe(true);
  });
  it('有生效角色（即使沒有任何權限碼）不是待開通', () => {
    expect(isPendingAccount(resolveAccess([role('some_role')], 'member'))).toBe(false);
  });
  it('指派已停用或已過期等於沒有角色', () => {
    expect(isPendingAccount(resolveAccess([{ ...role('r'), is_active: false }], 'member'))).toBe(true);
    expect(isPendingAccount(resolveAccess([{ ...role('r'), expires_at: '2000-01-01T00:00:00Z' }], 'member'))).toBe(true);
    expect(isPendingAccount(resolveAccess([{ ...role('r'), expires_at: '2999-01-01T00:00:00Z' }], 'member'))).toBe(false);
  });
  it('不看 roles.is_active（與正式區 has_permission 一致）', () => {
    const r = role('inactive_role');
    r.role.is_active = false;
    expect(isPendingAccount(resolveAccess([r], 'member'))).toBe(false);
  });
  it('舊式身分是管理員者不是待開通（與使用者管理待開通標籤相同）', () => {
    expect(isPendingAccount(resolveAccess([], 'admin'))).toBe(false);
  });
});

describe('W22 密碼強度（照舊版公式，只提示）', () => {
  const table: [string, string][] = [['', ''], ['abc', '弱'], ['abcdefgh', '弱'], ['abcdefg1', '中等'], ['Abcdefg1', '中等'], ['Abcdefg1!', '強'], ['Abcdefghijk1!', '強']];
  for (const [pw, label] of table) it(`${JSON.stringify(pw)} -> ${label || '(空)'}`, () => expect(passwordStrength(pw).label).toBe(label));
});
