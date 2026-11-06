import { describe, expect, it } from 'vitest';
import { applyTaskChanges, markProxyActions } from '../../../lib/workspace/task-state';

// W08 單元層（M3 F2）：代做標記由伺服器依項目所屬區段決定。
const own = [{ id: 'a1', label: 'a1' }, { id: 'a2', label: 'a2', subSteps: [{ id: 'a2x', label: 'a2x' }] }];
const other = [{ id: 'b1', label: 'b1' }];

describe('markProxyActions（F2）', () => {
  it('參與者兼管理者：自己區段不標代做，他區段標代做，同一次可混合', () => {
    const { actions } = applyTaskChanges([...own, ...other], {}, [
      { stepId: 'a1', checked: true },
      { stepId: 'b1', checked: true },
    ]);
    const marked = markProxyActions(actions, ['a1', 'a2', 'a2x'], false);
    expect(marked.map((a) => [a.step_id, a.proxy])).toEqual([['a1', false], ['b1', true]]);
  });
  it('子項目跟著自己區段，不標代做', () => {
    const { actions } = applyTaskChanges(own, {}, [{ stepId: 'a2x', checked: true }]);
    expect(markProxyActions(actions, ['a1', 'a2', 'a2x'], false).every((a) => a.proxy === false)).toBe(true);
  });
  it('非參與者（純代做者）全部標代做', () => {
    const { actions } = applyTaskChanges(own, {}, [{ stepId: 'a1', checked: true }]);
    expect(markProxyActions(actions, [], true).every((a) => a.proxy)).toBe(true);
  });
  it('非管理者的參與者只拿得到自己區段的項目：他區段的變更直接被擋', () => {
    expect(() => applyTaskChanges(own, {}, [{ stepId: 'b1', checked: true }])).toThrow('項目不屬於可操作區段');
  });
});
