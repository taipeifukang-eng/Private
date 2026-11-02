import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { isFixEnforced, parseEnforceFix } from '../../support/parity';

const runAll = createRequire(import.meta.url)('../../run-all.cjs');

describe('PARITY_ENFORCE_FIX 與 run-all', () => {
  it('parseEnforceFix / isFixEnforced', () => {
    expect(parseEnforceFix(undefined).ids.size).toBe(0);
    expect(isFixEnforced('W07', '')).toBe(false);
    expect(isFixEnforced('W07', 'W07')).toBe(true);
    expect(isFixEnforced('W07', ' W25 , W07 ')).toBe(true);
    expect(isFixEnforced('W07', 'W07x')).toBe(false);
    expect(isFixEnforced('W07', 'all')).toBe(true);
    expect(isFixEnforced(undefined, 'W07')).toBe(false);
  });

  it('run-all：--enforce-fix 解析；test:page 帶工作項 ID 時自動帶入該 ID', () => {
    expect(runAll.parseArgs(['--enforce-fix', 'all']).enforceFix).toBe('all');
    expect(runAll.parseArgs(['--enforce-fix', 'W07,W25']).enforceFix).toBe('W07,W25');
    expect(() => runAll.parseArgs(['--enforce-fix', 'a b'])).toThrow();
    expect(runAll.resolveEnforceFix(runAll.parseArgs(['--page', 'W07']), '')).toBe('W07');
    expect(runAll.resolveEnforceFix(runAll.parseArgs(['W07']), 'W25')).toBe('W07');
    expect(runAll.resolveEnforceFix(runAll.parseArgs(['W07', '--enforce-fix', 'all']), '')).toBe('all');
    expect(runAll.resolveEnforceFix(runAll.parseArgs([]), '')).toBe('');
    expect(runAll.resolveEnforceFix(runAll.parseArgs([]), 'W25')).toBe('W25');
  });
});
