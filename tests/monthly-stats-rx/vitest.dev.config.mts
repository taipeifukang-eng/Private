import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

// DEV 整合檢查（手動）：測試內自行用 process.loadEnvFile 讀 .env.development.local 並確認是 DEV。
export default defineConfig({
  root,
    resolve: { alias: { '@': root } },
  test: { environment: 'node', include: ['tests/monthly-stats-rx/*.devtest.ts'], pool: 'forks', globals: false },
});
