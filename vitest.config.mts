import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Vite 在 mode=test 也會讀 .env.local（Production 候選），所以 envDir 指向一個只有 .gitkeep 的空目錄，
  // 並把 envPrefix 改成不會撞到任何現有變數的值。
  envDir: path.join(root, 'tests', 'support', 'empty-env-dir'),
  envPrefix: 'VITEST_NEVER_EXPOSE_',
  resolve: {
    alias: { '@': root },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // 需要 DOM 的測試在檔案開頭加 `// @vitest-environment happy-dom`
    globals: false,
    pool: 'forks',
    testTimeout: 15_000,
  },
});
