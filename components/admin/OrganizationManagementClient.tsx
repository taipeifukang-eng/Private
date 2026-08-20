'use client';

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { Building2, ChevronRight, Edit2, Eye, EyeOff, Loader2, Plus, Save, Search, Users, X } from 'lucide-react';

type OrganizationUnit = {
  id: string;
  code: string;
  name: string;
  short_name: string | null;
  type: 'company' | 'headquarters' | 'department' | 'team';
  parent_id: string | null;
  status: 'active' | 'inactive';
  description: string | null;
  sort_order: number;
  members: OrganizationMembership[];
  managers: OrganizationManagerAssignment[];
};

type OrganizationUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  employee_code: string | null;
  department: string | null;
  job_title: string | null;
};

type OrganizationMembership = {
  id: string;
  user_id: string;
  is_primary: boolean;
  user: OrganizationUser | null;
};

type OrganizationManagerAssignment = {
  id: string;
  user_id: string;
  manager_role: 'manager' | 'deputy_manager' | 'acting_manager';
  is_primary: boolean;
  user: OrganizationUser | null;
};

type Mode = 'overview' | 'departments';

type Props = {
  mode: Mode;
  canCreateDepartment?: boolean;
  canEditDepartment?: boolean;
  canManageMembers?: boolean;
  canManageManagers?: boolean;
};

const UNIT_TYPE_LABEL: Record<OrganizationUnit['type'], string> = {
  company: '公司',
  headquarters: '總部',
  department: '部門',
  team: '團隊',
};

const MANAGER_ROLE_LABEL: Record<OrganizationManagerAssignment['manager_role'], string> = {
  manager: '主管',
  deputy_manager: '副主管',
  acting_manager: '代理主管',
};

function userLabel(user: OrganizationUser | null | undefined) {
  if (!user) return '未指定';
  const name = user.full_name || user.email || '未命名';
  return user.employee_code ? `${user.employee_code} ${name}` : name;
}

function buildUnitPath(unit: OrganizationUnit, unitById: Map<string, OrganizationUnit>) {
  const names: string[] = [];
  let current: OrganizationUnit | undefined = unit;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parent_id ? unitById.get(current.parent_id) : undefined;
  }
  return names.join(' / ');
}

function isDescendantOf(unit: OrganizationUnit, ancestorId: string, unitById: Map<string, OrganizationUnit>) {
  let currentParentId = unit.parent_id;
  const visited = new Set<string>();
  while (currentParentId && !visited.has(currentParentId)) {
    if (currentParentId === ancestorId) return true;
    visited.add(currentParentId);
    currentParentId = unitById.get(currentParentId)?.parent_id || null;
  }
  return false;
}

export default function OrganizationManagementClient({
  mode,
  canCreateDepartment = false,
  canEditDepartment = false,
  canManageMembers = false,
  canManageManagers = false,
}: Props) {
  const [units, setUnits] = useState<OrganizationUnit[]>([]);
  const [users, setUsers] = useState<OrganizationUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [editingUnit, setEditingUnit] = useState<OrganizationUnit | null>(null);
  const [memberUnit, setMemberUnit] = useState<OrganizationUnit | null>(null);
  const [managerUnit, setManagerUnit] = useState<OrganizationUnit | null>(null);
  const [userSearch, setUserSearch] = useState('');

  const unitById = useMemo(() => new Map(units.map(unit => [unit.id, unit])), [units]);
  const rootUnits = useMemo(() => units.filter(unit => !unit.parent_id), [units]);
  const organizationUnits = useMemo(() => units, [units]);
  const selectableParents = useMemo(() => (
    units.filter(unit => (
      !editingUnit?.id ||
      (unit.id !== editingUnit.id && !isDescendantOf(unit, editingUnit.id, unitById))
    ))
  ), [units, editingUnit, unitById]);
  const selectedUnit = useMemo(() => {
    if (selectedUnitId) return unitById.get(selectedUnitId) || null;
    return rootUnits[0] || null;
  }, [rootUnits, selectedUnitId, unitById]);

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    if (!term) return users;
    return users.filter(user => [
      user.full_name,
      user.email,
      user.employee_code,
      user.department,
      user.job_title,
    ].some(value => String(value || '').toLowerCase().includes(term)));
  }, [userSearch, users]);

  useEffect(() => {
    loadData();
  }, [showInactive]);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const response = await fetch(`/api/organization/units?showInactive=${showInactive}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '載入組織資料失敗');
      setUnits(result.units || []);
      if (!selectedUnitId && result.units?.[0]) setSelectedUnitId(result.units[0].id);
    } catch (error) {
      alert(error instanceof Error ? error.message : '載入組織資料失敗');
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      const response = await fetch('/api/organization/users', { cache: 'no-store' });
      const result = await response.json();
      if (response.ok) setUsers(result.users || []);
    } catch (error) {
      console.error('載入人員失敗:', error);
    }
  }

  async function saveUnit(formData: FormData) {
    setSaving(true);
    try {
      const payload = {
        id: String(formData.get('id') || editingUnit?.id || ''),
        code: String(formData.get('code') || ''),
        name: String(formData.get('name') || ''),
        short_name: String(formData.get('short_name') || ''),
        type: String(formData.get('type') || 'department'),
        parent_id: String(formData.get('parent_id') || ''),
        status: String(formData.get('status') || 'active'),
        sort_order: Number(formData.get('sort_order') || 0),
        description: String(formData.get('description') || ''),
      };
      const response = await fetch('/api/organization/units', {
        method: editingUnit?.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '儲存失敗');
      setEditingUnit(null);
      await loadData();
    } catch (error) {
      alert(error instanceof Error ? error.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(unit: OrganizationUnit, status: OrganizationUnit['status']) {
    if (!confirm(`確定要${status === 'active' ? '啟用' : '停用'}「${unit.name}」嗎？`)) return;
    setSaving(true);
    try {
      const response = await fetch('/api/organization/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: unit.id,
          name: unit.name,
          short_name: unit.short_name || '',
          parent_id: unit.parent_id || '',
          status,
          sort_order: unit.sort_order || 0,
          description: unit.description || '',
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '更新狀態失敗');
      await loadData();
    } catch (error) {
      alert(error instanceof Error ? error.message : '更新狀態失敗');
    } finally {
      setSaving(false);
    }
  }

  async function saveMembers(unit: OrganizationUnit, selectedUserIds: string[]) {
    setSaving(true);
    try {
      const response = await fetch('/api/organization/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_members', organization_unit_id: unit.id, user_ids: selectedUserIds }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '儲存成員失敗');
      setMemberUnit(null);
      await loadData();
    } catch (error) {
      alert(error instanceof Error ? error.message : '儲存成員失敗');
    } finally {
      setSaving(false);
    }
  }

  async function saveManagers(unit: OrganizationUnit, assignments: Array<{ user_id: string; manager_role: string; is_primary: boolean }>) {
    setSaving(true);
    try {
      const response = await fetch('/api/organization/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_managers', organization_unit_id: unit.id, assignments }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '儲存主管失敗');
      setManagerUnit(null);
      await loadData();
    } catch (error) {
      alert(error instanceof Error ? error.message : '儲存主管失敗');
    } finally {
      setSaving(false);
    }
  }

  function renderTree(nodes: OrganizationUnit[], depth = 0) {
    return nodes.map(unit => {
      const children = units.filter(child => child.parent_id === unit.id);
      const active = selectedUnit?.id === unit.id;
      return (
        <div key={unit.id}>
          <button
            type="button"
            onClick={() => setSelectedUnitId(unit.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
              active ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
            }`}
            style={{ paddingLeft: `${12 + depth * 20}px` }}
          >
            <ChevronRight size={16} className={children.length ? 'text-gray-400' : 'text-transparent'} />
            <Building2 size={16} />
            <span className="font-medium truncate">{unit.name}</span>
            {unit.status === 'inactive' && <span className="ml-auto text-xs text-gray-500">停用</span>}
          </button>
          {children.length > 0 && renderTree(children, depth + 1)}
        </div>
      );
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 lg:p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      {mode === 'overview' ? (
        <div className="w-full">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
                <Building2 className="text-blue-600" size={40} />
                公司組織
              </h1>
              <p className="text-gray-600">查看公司、總部與部門組織架構</p>
            </div>
            <ShowInactiveToggle showInactive={showInactive} onToggle={() => setShowInactive(value => !value)} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <section className="xl:col-span-4 bg-white rounded-lg shadow-lg p-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">組織樹</h2>
              <div className="space-y-1">{renderTree(rootUnits)}</div>
            </section>

            <section className="xl:col-span-8 bg-white rounded-lg shadow-lg p-6">
              {selectedUnit ? (
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-5 mb-5">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">{selectedUnit.name}</h2>
                      <p className="text-sm text-gray-500 mt-1">{buildUnitPath(selectedUnit, unitById)}</p>
                    </div>
                    <StatusBadge status={selectedUnit.status} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <InfoCard label="代碼" value={selectedUnit.code} />
                    <InfoCard label="類型" value={UNIT_TYPE_LABEL[selectedUnit.type]} />
                    <InfoCard label="上層組織" value={selectedUnit.parent_id ? unitById.get(selectedUnit.parent_id)?.name || '-' : '-'} />
                    <InfoCard label="部門人數" value={String(selectedUnit.members.length)} />
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 mb-3">主管</h3>
                      <div className="space-y-2">
                        {selectedUnit.managers.length === 0 && <p className="text-sm text-gray-500">尚未設定主管</p>}
                        {selectedUnit.managers.map(manager => (
                          <div key={manager.id} className="flex items-center justify-between text-sm border border-gray-100 rounded p-2">
                            <span className="font-medium text-gray-900">{userLabel(manager.user)}</span>
                            <span className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1">
                              {MANAGER_ROLE_LABEL[manager.manager_role]}{manager.is_primary ? ' / 主要' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border border-gray-200 rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 mb-3">部門成員</h3>
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {selectedUnit.members.length === 0 && <p className="text-sm text-gray-500">尚未設定成員</p>}
                        {selectedUnit.members.map(member => (
                          <div key={member.id} className="grid grid-cols-2 gap-3 text-sm border border-gray-100 rounded p-2">
                            <span className="font-medium text-gray-900">{userLabel(member.user)}</span>
                            <span className="text-gray-600">{member.user?.job_title || '-'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-16">尚未建立組織資料</div>
              )}
            </section>
          </div>
        </div>
      ) : (
        <div className="w-full">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
                <Users className="text-blue-600" size={40} />
                組織單位管理
              </h1>
              <p className="text-gray-600">管理公司、總部、部門、主管及組織成員</p>
            </div>
            <div className="flex items-center gap-3">
              <ShowInactiveToggle showInactive={showInactive} onToggle={() => setShowInactive(value => !value)} />
              {canCreateDepartment && (
                <button
                  type="button"
                  onClick={() => setEditingUnit({ id: '', code: '', name: '', short_name: '', type: 'department', parent_id: units.find(unit => unit.type === 'headquarters')?.id || null, status: 'active', description: '', sort_order: 0, members: [], managers: [] })}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                >
                  <Plus size={20} />
                  新增部門
                </button>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 text-sm font-semibold text-gray-700 bg-gray-50 border-b border-gray-200">
              <div className="col-span-1">代碼</div>
              <div className="col-span-2">名稱</div>
              <div className="col-span-1">類型</div>
              <div className="col-span-1">簡稱</div>
              <div className="col-span-2">上層組織</div>
              <div className="col-span-1">主管</div>
              <div className="col-span-1 text-right">人員</div>
              <div className="col-span-1">狀態</div>
              <div className="col-span-2 text-center">操作</div>
            </div>
            <div className="divide-y divide-gray-200">
              {organizationUnits.length === 0 && (
                <div className="px-6 py-12 text-center text-gray-500">尚未建立組織單位</div>
              )}
              {organizationUnits.map(department => {
                const managers = department.managers.filter(manager => manager.manager_role === 'manager');
                return (
                  <div key={department.id} className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-gray-50 transition-colors">
                    <div className="col-span-1 font-mono text-blue-600 font-medium">{department.code}</div>
                    <div className="col-span-2 font-semibold text-gray-900">{department.name}</div>
                    <div className="col-span-1 text-sm text-gray-600">{UNIT_TYPE_LABEL[department.type]}</div>
                    <div className="col-span-1 text-sm text-gray-600">{department.short_name || '-'}</div>
                    <div className="col-span-2 text-sm text-gray-600">{department.parent_id ? unitById.get(department.parent_id)?.name || '-' : '-'}</div>
                    <div className="col-span-1 text-sm text-gray-700 truncate">{managers.map(manager => userLabel(manager.user)).join('、') || '-'}</div>
                    <div className="col-span-1 text-right text-sm text-gray-700">{department.members.length}</div>
                    <div className="col-span-1"><StatusBadge status={department.status} /></div>
                    <div className="col-span-2 flex gap-1 justify-center flex-wrap">
                      {canEditDepartment && (
                        <button type="button" onClick={() => setEditingUnit(department)} className="px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-xs font-medium">
                          <Edit2 size={12} className="inline mr-1" />編輯
                        </button>
                      )}
                      {canManageMembers && (
                        <button type="button" onClick={() => setMemberUnit(department)} className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs font-medium">
                          <Users size={12} className="inline mr-1" />人員
                        </button>
                      )}
                      {canManageManagers && (
                        <button type="button" onClick={() => setManagerUnit(department)} className="px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors text-xs font-medium">
                          <Users size={12} className="inline mr-1" />主管
                        </button>
                      )}
                      {canEditDepartment && (
                        <button type="button" onClick={() => updateStatus(department, department.status === 'active' ? 'inactive' : 'active')} className="px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-xs font-medium">
                          {department.status === 'active' ? '停用' : '啟用'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {editingUnit && (
        <UnitDialog
          unit={editingUnit}
          parents={selectableParents}
          saving={saving}
          onClose={() => setEditingUnit(null)}
          onSave={saveUnit}
        />
      )}
      {memberUnit && (
        <MembersDialog
          unit={memberUnit}
          users={filteredUsers}
          userSearch={userSearch}
          saving={saving}
          onSearch={setUserSearch}
          onClose={() => setMemberUnit(null)}
          onSave={saveMembers}
        />
      )}
      {managerUnit && (
        <ManagersDialog
          unit={managerUnit}
          users={filteredUsers}
          userSearch={userSearch}
          saving={saving}
          onSearch={setUserSearch}
          onClose={() => setManagerUnit(null)}
          onSave={saveManagers}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: OrganizationUnit['status'] }) {
  return (
    <span className={`inline-flex px-2 py-1 text-xs rounded-full ${status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
      {status === 'active' ? '啟用' : '停用'}
    </span>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <dt className="text-sm text-gray-500 mb-1">{label}</dt>
      <dd className="font-semibold text-gray-900">{value || '-'}</dd>
    </div>
  );
}

function ShowInactiveToggle({ showInactive, onToggle }: { showInactive: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg transition-colors text-sm font-medium ${showInactive ? 'bg-gray-200 text-gray-700 hover:bg-gray-300' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
    >
      {showInactive ? <EyeOff size={18} /> : <Eye size={18} />}
      {showInactive ? '隱藏已停用' : '顯示已停用'}
    </button>
  );
}

function UnitDialog({ unit, parents, saving, onClose, onSave }: {
  unit: OrganizationUnit;
  parents: OrganizationUnit[];
  saving: boolean;
  onClose: () => void;
  onSave: (formData: FormData) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <form action={onSave} className="bg-white rounded-lg shadow-xl w-full max-w-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{unit.id ? '編輯組織單位' : '新增部門'}</h3>
          <button type="button" onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <input type="hidden" name="id" value={unit.id} />
          <input type="hidden" name="type" value={unit.type || 'department'} />
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-2">代碼</span>
            <input
              name="code"
              defaultValue={unit.code}
              required
              pattern="[A-Za-z0-9_-]{2,30}"
              title="代碼只能包含英文、數字、底線或連字號，長度 2-30"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg uppercase"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-2">名稱</span>
            <input name="name" defaultValue={unit.name} required className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-2">類型</span>
            <input value={UNIT_TYPE_LABEL[unit.type]} readOnly className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-2">簡稱</span>
            <input name="short_name" defaultValue={unit.short_name || ''} className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-2">上層組織</span>
            <select name="parent_id" defaultValue={unit.parent_id || ''} className="w-full px-4 py-2 border border-gray-300 rounded-lg">
              <option value="">無</option>
              {parents.map(parent => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-2">排序</span>
            <input name="sort_order" type="number" defaultValue={unit.sort_order || 0} className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-2">狀態</span>
            <select name="status" defaultValue={unit.status || 'active'} className="w-full px-4 py-2 border border-gray-300 rounded-lg">
              <option value="active">啟用</option>
              <option value="inactive">停用</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="block text-sm font-medium text-gray-700 mb-2">說明</span>
            <textarea name="description" defaultValue={unit.description || ''} rows={3} className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </label>
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">取消</button>
          <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            <Save size={18} />{saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </form>
    </div>
  );
}

function MembersDialog({ unit, users, userSearch, saving, onSearch, onClose, onSave }: {
  unit: OrganizationUnit;
  users: OrganizationUser[];
  userSearch: string;
  saving: boolean;
  onSearch: (value: string) => void;
  onClose: () => void;
  onSave: (unit: OrganizationUnit, selectedUserIds: string[]) => void;
}) {
  const [selected, setSelected] = useState(() => new Set(unit.members.map(member => member.user_id)));
  return (
    <PickerDialog title={`${unit.name} 人員`} userSearch={userSearch} saving={saving} onSearch={onSearch} onClose={onClose} onSave={() => onSave(unit, Array.from(selected))}>
      {users.map(user => (
        <label key={user.id} className="flex items-center gap-3 border border-gray-100 rounded p-2 text-sm">
          <input type="checkbox" checked={selected.has(user.id)} onChange={(event) => {
            const next = new Set(selected);
            event.target.checked ? next.add(user.id) : next.delete(user.id);
            setSelected(next);
          }} />
          <span className="font-medium text-gray-900">{userLabel(user)}</span>
          <span className="text-gray-500">{user.job_title || user.department || ''}</span>
        </label>
      ))}
    </PickerDialog>
  );
}

function ManagersDialog({ unit, users, userSearch, saving, onSearch, onClose, onSave }: {
  unit: OrganizationUnit;
  users: OrganizationUser[];
  userSearch: string;
  saving: boolean;
  onSearch: (value: string) => void;
  onClose: () => void;
  onSave: (unit: OrganizationUnit, assignments: Array<{ user_id: string; manager_role: string; is_primary: boolean }>) => void;
}) {
  const [selected, setSelected] = useState(() => new Map(unit.managers.map(manager => [manager.user_id, manager.manager_role])));
  return (
    <PickerDialog title={`${unit.name} 主管`} userSearch={userSearch} saving={saving} onSearch={onSearch} onClose={onClose} onSave={() => onSave(unit, Array.from(selected.entries()).map(([user_id, manager_role], index) => ({ user_id, manager_role, is_primary: index === 0 })))}>
      {users.map(user => {
        const checked = selected.has(user.id);
        return (
          <div key={user.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 border border-gray-100 rounded p-2 text-sm">
            <label className="md:col-span-2 flex items-center gap-3">
              <input type="checkbox" checked={checked} onChange={(event) => {
                const next = new Map(selected);
                event.target.checked ? next.set(user.id, 'manager') : next.delete(user.id);
                setSelected(next);
              }} />
              <span className="font-medium text-gray-900">{userLabel(user)}</span>
            </label>
            <select disabled={!checked} value={selected.get(user.id) || 'manager'} onChange={(event) => {
              const next = new Map(selected);
              next.set(user.id, event.target.value as OrganizationManagerAssignment['manager_role']);
              setSelected(next);
            }} className="px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100">
              <option value="manager">主管</option>
              <option value="deputy_manager">副主管</option>
              <option value="acting_manager">代理主管</option>
            </select>
          </div>
        );
      })}
    </PickerDialog>
  );
}

function PickerDialog({ title, userSearch, saving, children, onSearch, onClose, onSave }: {
  title: string;
  userSearch: string;
  saving: boolean;
  children: React.ReactNode;
  onSearch: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="p-2 text-gray-500 hover:bg-gray-100 rounded"><X size={20} /></button>
        </div>
        <div className="p-6 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
            <input value={userSearch} onChange={(event) => onSearch(event.target.value)} className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-full" placeholder="搜尋姓名、員編、Email、部門或職稱" />
          </div>
        </div>
        <div className="p-6 overflow-y-auto space-y-2">{children}</div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">取消</button>
          <button type="button" onClick={onSave} disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            <Save size={18} />{saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  );
}
