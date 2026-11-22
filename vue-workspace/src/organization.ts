export const unitTypes: Record<string, string> = { company: '公司', headquarters: '總部', department: '部門', team: '小組' };
export const managerRoles: Record<string, string> = { manager: '主管', deputy_manager: '副主管', acting_manager: '代理主管' };
export function descendants(units: any[], id: string): Set<string> {
  const result = new Set<string>([id]);
  let changed = true;
  while (changed) { changed = false; for (const unit of units) if (result.has(unit.parent_id) && !result.has(unit.id)) { result.add(unit.id); changed = true; } }
  return result;
}
export function canMoveUnit(units: any[], id: string, parent: string | null): boolean {
  const unit = units.find(u => u.id === id);
  if (!unit || unit.type === 'company') return false;
  if (parent === null) return true;
  return Boolean(units.some(u => u.id === parent && u.status === 'active') && !descendants(units, id).has(parent));
}
