import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspacePublicRedirect, WORKSPACE_PUBLIC_REDIRECTS } from '@/lib/workspace/public-routes';

const root = path.resolve(__dirname, '..', '..', '..');

describe('T03 公開頁路由策略（D14）', () => {
  it('示範路由轉址到 /workspace/index.html#/ 的 hash 路由', () => {
    expect(resolveWorkspacePublicRedirect('/public-demo/abc123')).toBe('/workspace/index.html#/public-demo/abc123');
    expect(resolveWorkspacePublicRedirect('/public-demo/abc123/')).toBe('/workspace/index.html#/public-demo/abc123');
  });

  it('不符合的路徑、缺少參數、多餘路徑段一律不轉址', () => {
    for (const p of ['/', '/logout', '/loginx', '/register/x', '/public-demo', '/public-demo/', '/public-demo/a/b', '/other/abc']) {
      expect(resolveWorkspacePublicRedirect(p), p).toBeNull();
    }
  });

  it('參數含不安全字元時不轉址（避免注入 hash）', () => {
    for (const p of ['/public-demo/a%2Fb', '/public-demo/a b', '/public-demo/<x>', '/public-demo/a#b', '/public-demo/' + 'a'.repeat(129)]) {
      expect(resolveWorkspacePublicRedirect(p), p).toBeNull();
    }
  });

  it('支援自訂登錄（模擬掃描頁永久網址）並保留 token', () => {
    const redirects = [{ legacy: '/general-affairs/assets/scan/:token', hash: '/scan/:token' }];
    expect(resolveWorkspacePublicRedirect('/general-affairs/assets/scan/AB-12_x', redirects)).toBe('/workspace/index.html#/scan/AB-12_x');
  });

  it('每個轉址登錄在 Vue 端都有對應的公開頁，且 middleware 有接上', () => {
    const pages = fs.readFileSync(path.join(root, 'vue-workspace', 'src', 'workspace-pages.ts'), 'utf8');
    for (const r of WORKSPACE_PUBLIC_REDIRECTS) expect(pages, r.hash).toContain(`path: "${r.hash}"`);
    expect(fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8')).toContain('resolveWorkspacePublicRedirect');
  });
});
