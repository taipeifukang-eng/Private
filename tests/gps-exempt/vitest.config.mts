import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

// 單元測試只含純函式，不讀任何 .env。
export default defineConfig({
  root,
  envDir: path.join(here, 'empty-env-dir'),
  envPrefix: 'VITEST_NEVER_EXPOSE_',
  resolve: { alias: { '@': root } },
  test: { environment: 'node', include: ['tests/gps-exempt/unit/**/*.test.ts'], pool: 'forks', globals: false },
});
