'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { AlertTriangle, Building2, ChevronDown, ChevronRight, Edit2, Eye, EyeOff, GripVertical, Home, Loader2, Maximize2, Navigation, Plus, Save, Search, SlidersHorizontal, UserCog, Users, X, ZoomIn, ZoomOut } from 'lucide-react';

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
type DrawerMode = 'summary' | 'edit';
type EditorTab = 'basic' | 'managers' | 'members';

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

const EDITOR_TAB_LABEL: Record<EditorTab, string> = {
  basic: '基本資料',
  managers: '主管設定',
  members: '組織成員',
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

function sortUnits(units: OrganizationUnit[]) {
  return [...units].sort((a, b) => {
    const sortDiff = (a.sort_order || 0) - (b.sort_order || 0);
    if (sortDiff !== 0) return sortDiff;
    return a.code.localeCompare(b.code);
  });
}

function buildChildrenByParent(units: OrganizationUnit[]) {
  const childrenByParent = new Map<string | null, OrganizationUnit[]>();
  units.forEach(unit => {
    const parentKey = unit.parent_id || null;
    const list = childrenByParent.get(parentKey) || [];
    list.push(unit);
    childrenByParent.set(parentKey, list);
  });
  childrenByParent.forEach((children, parentKey) => {
    childrenByParent.set(parentKey, sortUnits(children));
  });
  return childrenByParent;
}

function orgChartNodeClass(unit: OrganizationUnit, depth: number) {
  if (unit.status === 'inactive') return 'bg-gray-100 text-gray-500 border-gray-300 opacity-70';
  if (unit.type === 'company') return 'bg-slate-900 text-white border-slate-950';
  if (depth === 1) return 'bg-blue-900 text-white border-blue-950';
  if (unit.type === 'team') return 'bg-white text-blue-800 border-blue-300';
  return 'bg-indigo-700 text-white border-indigo-800';
}

function countDescendantMembers(unit: OrganizationUnit, childrenByParent: Map<string | null, OrganizationUnit[]>) {
  const counted = new Set<string>();
  const walk = (current: OrganizationUnit) => {
    current.members.forEach(member => counted.add(member.user_id));
    (childrenByParent.get(current.id) || []).forEach(walk);
  };
  walk(unit);
  return counted.size;
}

function directChildrenCount(unit: OrganizationUnit, childrenByParent: Map<string | null, OrganizationUnit[]>) {
  return (childrenByParent.get(unit.id) || []).length;
}

function isLegalParentFor(unit: OrganizationUnit, parent: OrganizationUnit | null, unitById: Map<string, OrganizationUnit>) {
  if (unit.type === 'company') return parent === null;
  if (!parent) return true;
  if (parent.id === unit.id) return false;
  if (parent.status === 'inactive') return false;
  return !isDescendantOf(parent, unit.id, unitById);
}

function expandAncestors(unit: OrganizationUnit, unitById: Map<string, OrganizationUnit>) {
  const ids = new Set<string>();
  let current = unit.parent_id ? unitById.get(unit.parent_id) : undefined;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    ids.add(current.id);
    current = current.parent_id ? unitById.get(current.parent_id) : undefined;
  }
  ids.add(unit.id);
  return ids;
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
  const [hierarchyDraftUnits, setHierarchyDraftUnits] = useState<OrganizationUnit[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [editingUnit, setEditingUnit] = useState<OrganizationUnit | null>(null);
  const [memberUnit, setMemberUnit] = useState<OrganizationUnit | null>(null);
  const [managerUnit, setManagerUnit] = useState<OrganizationUnit | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [organizationSearch, setOrganizationSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | OrganizationUnit['type']>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [drawerUnitId, setDrawerUnitId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>('basic');
  const [adjustMode, setAdjustMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const workingUnits = hierarchyDraftUnits || units;
  const hasHierarchyChanges = Boolean(hierarchyDraftUnits);
  const unitById = useMemo(() => new Map(workingUnits.map(unit => [unit.id, unit])), [workingUnits]);
  const persistedUnitById = useMemo(() => new Map(units.map(unit => [unit.id, unit])), [units]);
  const childrenByParent = useMemo(() => buildChildrenByParent(workingUnits), [workingUnits]);
  const companyUnits = useMemo(() => sortUnits(workingUnits.filter(unit => unit.type === 'company')), [workingUnits]);
  const rootUnits = useMemo(() => sortUnits(workingUnits.filter(unit => !unit.parent_id)), [workingUnits]);
  const organizationRoots = useMemo(() => companyUnits.length ? companyUnits : rootUnits, [companyUnits, rootUnits]);
  const unassignedUnits = useMemo(() => sortUnits(workingUnits.filter(unit => !unit.parent_id && unit.type !== 'company')), [workingUnits]);
  const organizationUnits = useMemo(() => sortUnits(workingUnits), [workingUnits]);
  const selectedUnit = useMemo(() => {
    if (selectedUnitId) return unitById.get(selectedUnitId) || null;
    return organizationRoots[0] || rootUnits[0] || null;
  }, [organizationRoots, rootUnits, selectedUnitId, unitById]);
  const drawerUnit = useMemo(() => drawerUnitId ? unitById.get(drawerUnitId) || null : null, [drawerUnitId, unitById]);
  const hierarchyChangeCount = useMemo(() => {
    if (!hierarchyDraftUnits) return 0;
    return hierarchyDraftUnits.filter(unit => {
      const original = persistedUnitById.get(unit.id);
      return original && ((original.parent_id || null) !== (unit.parent_id || null) || (original.sort_order || 0) !== (unit.sort_order || 0));
    }).length;
  }, [hierarchyDraftUnits, persistedUnitById]);
  const filteredOrganizationUnits = useMemo(() => {
    const term = organizationSearch.trim().toLowerCase();
    return organizationUnits.filter(unit => {
      const typeMatches = typeFilter === 'all' || unit.type === typeFilter;
      if (!typeMatches) return false;
      if (!term) return true;
      return [
        unit.name,
        unit.code,
        UNIT_TYPE_LABEL[unit.type],
        buildUnitPath(unit, unitById),
      ].some(value => value.toLowerCase().includes(term));
    });
  }, [organizationSearch, organizationUnits, typeFilter, unitById]);

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

  useEffect(() => {
    setExpandedIds(previous => {
      const next = new Set(previous);
      organizationRoots.forEach(unit => next.add(unit.id));
      return next;
    });
  }, [organizationRoots]);

  async function loadData() {
    setLoading(true);
    try {
      const response = await fetch(`/api/organization/units?showInactive=${showInactive}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '載入組織資料失敗');
      setUnits(result.units || []);
      setHierarchyDraftUnits(null);
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
      setDrawerMode(null);
      setDrawerUnitId(null);
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

  function createDepartment(parentId?: string | null) {
    const fallbackParent = selectedUnit?.id || organizationRoots[0]?.id || null;
    setEditingUnit({
      id: '',
      code: '',
      name: '',
      short_name: '',
      type: 'department',
      parent_id: parentId !== undefined ? parentId : fallbackParent,
      status: 'active',
      description: '',
      sort_order: 0,
      members: [],
      managers: [],
    });
    setDrawerMode('edit');
    setDrawerUnitId(null);
    setEditorTab('basic');
  }

  function openSummary(unitId: string) {
    const unit = unitById.get(unitId);
    if (!unit) return;
    setSelectedUnitId(unitId);
    setDrawerUnitId(unitId);
    setDrawerMode('summary');
    setExpandedIds(previous => new Set([...Array.from(previous), ...Array.from(expandAncestors(unit, unitById))]));
  }

  function openEditor(unit: OrganizationUnit, tab: EditorTab = 'basic') {
    setEditingUnit(unit);
    setDrawerUnitId(unit.id);
    setDrawerMode('edit');
    setEditorTab(tab);
  }

  function locateUnit(unitId: string) {
    const unit = unitById.get(unitId);
    if (!unit) return;
    setSelectedUnitId(unitId);
    setExpandedIds(previous => new Set([...Array.from(previous), ...Array.from(expandAncestors(unit, unitById))]));
    setDrawerUnitId(unitId);
    setDrawerMode('summary');
    setNavigatorOpen(false);
  }

  function expandAll() {
    setExpandedIds(new Set(organizationUnits.map(unit => unit.id)));
  }

  function collapseToSecondLevel() {
    const next = new Set<string>();
    organizationRoots.forEach(root => {
      next.add(root.id);
      (childrenByParent.get(root.id) || []).forEach(child => next.add(child.id));
    });
    setExpandedIds(next);
  }

  function resetViewport() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function enterAdjustMode() {
    setAdjustMode(true);
    setDrawerMode(null);
    setNavigatorOpen(false);
  }

  function toggleExpanded(unitId: string) {
    setExpandedIds(previous => {
      const next = new Set(previous);
      next.has(unitId) ? next.delete(unitId) : next.add(unitId);
      return next;
    });
  }

  function canDropOn(draggedUnit: OrganizationUnit, parentId: string | null) {
    if (!parentId) return draggedUnit.type !== 'company';
    if (draggedUnit.id === parentId) return false;
    const parentUnit = unitById.get(parentId);
    if (!parentUnit) return false;
    if (parentUnit.status === 'inactive') return false;
    return !isDescendantOf(parentUnit, draggedUnit.id, unitById);
  }

  function moveUnit(unitId: string, parentId: string | null) {
    const draggedUnit = unitById.get(unitId);
    if (!draggedUnit || !canDropOn(draggedUnit, parentId)) return;
    if (draggedUnit.parent_id === parentId) return;

    const siblingCount = workingUnits.filter(unit => (unit.parent_id || null) === parentId && unit.id !== unitId).length;
    const nextSortOrder = (siblingCount + 1) * 10;

    setHierarchyDraftUnits(previous => {
      const source = previous || units;
      return source.map(unit => (
        unit.id === unitId
          ? { ...unit, parent_id: parentId, sort_order: nextSortOrder }
          : unit
      ));
    });
    if (parentId) setExpandedIds(previous => new Set(previous).add(parentId));
    setSelectedUnitId(unitId);
    setDraggingUnitId(null);
    setDropTargetId(null);
  }

  const saveHierarchyChanges = useCallback(async () => {
    if (!hierarchyDraftUnits) return true;

    const updates = hierarchyDraftUnits
      .map(unit => {
        const original = persistedUnitById.get(unit.id);
        if (!original) return null;
        const parentChanged = (original.parent_id || null) !== (unit.parent_id || null);
        const sortChanged = (original.sort_order || 0) !== (unit.sort_order || 0);
        if (!parentChanged && !sortChanged) return null;
        return {
          id: unit.id,
          parent_id: unit.parent_id || '',
          sort_order: unit.sort_order || 0,
        };
      })
      .filter(Boolean);

    if (updates.length === 0) {
      setHierarchyDraftUnits(null);
      return true;
    }

    const summary = hierarchyDraftUnits
      .map(unit => {
        const original = persistedUnitById.get(unit.id);
        if (!original || (original.parent_id || null) === (unit.parent_id || null)) return null;
        const from = original.parent_id ? persistedUnitById.get(original.parent_id)?.name || '未設定上層' : '未設定上層';
        const to = unit.parent_id ? (hierarchyDraftUnits.find(item => item.id === unit.parent_id)?.name || '未設定上層') : '未設定上層';
        return `${unit.name}\n${from} → ${to}`;
      })
      .filter(Boolean)
      .join('\n\n');

    const confirmed = confirm(`即將儲存以下組織調整：\n\n${summary || `共 ${updates.length} 項排序調整`}\n\n組織調整可能影響主管的資料查看範圍、任務派發範圍及後續工作交接範圍。`);
    if (!confirmed) return false;

    setSaving(true);
    try {
      const response = await fetch('/api/organization/units', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_hierarchy', updates }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '儲存組織調整失敗');
      setHierarchyDraftUnits(null);
      await loadData();
      return true;
    } catch (error) {
      alert(error instanceof Error ? error.message : '儲存組織調整失敗');
      return false;
    } finally {
      setSaving(false);
    }
  }, [hierarchyDraftUnits, persistedUnitById]);

  function discardHierarchyChanges() {
    if (!hasHierarchyChanges) return;
    if (!confirm('確定要放棄尚未儲存的組織調整嗎？')) return;
    setHierarchyDraftUnits(null);
    setDropTargetId(null);
    setDraggingUnitId(null);
  }

  useEffect(() => {
    if (!hasHierarchyChanges) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasHierarchyChanges]);

  useEffect(() => {
    if (!hasHierarchyChanges) return;

    const handleDocumentClick = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      if (!anchor.href || anchor.href === window.location.href) return;
      if (new URL(anchor.href).origin !== window.location.origin) return;

      event.preventDefault();
      event.stopPropagation();

      const shouldSave = confirm('公司組織有尚未儲存的拖曳調整。按「確定」儲存後離開，按「取消」留在此頁。');
      if (!shouldSave) return;

      const saved = await saveHierarchyChanges();
      if (saved) window.location.href = anchor.href;
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [hasHierarchyChanges, saveHierarchyChanges]);

  function renderCompactTree(nodes: OrganizationUnit[], depth = 0) {
    return nodes.map(unit => {
      const children = childrenByParent.get(unit.id) || [];
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
          {children.length > 0 && renderCompactTree(children, depth + 1)}
        </div>
      );
    });
  }

  function renderDraggableNode(unit: OrganizationUnit, depth = 0) {
    const children = childrenByParent.get(unit.id) || [];
    const active = selectedUnit?.id === unit.id;
    const expanded = expandedIds.has(unit.id);
    const canDragUnit = adjustMode && canEditDepartment && unit.type !== 'company';
    const draggedUnit = draggingUnitId ? unitById.get(draggingUnitId) : null;
    const canDrop = draggedUnit ? canDropOn(draggedUnit, unit.id) : false;

    return (
      <div key={unit.id} className="relative">
        <div
          draggable={canDragUnit}
          onDragStart={(event) => {
            if (!canDragUnit) return;
            event.dataTransfer.setData('text/plain', unit.id);
            event.dataTransfer.effectAllowed = 'move';
            setDraggingUnitId(unit.id);
          }}
          onDragEnd={() => {
            setDraggingUnitId(null);
            setDropTargetId(null);
          }}
          onDragOver={(event) => {
            if (!canDrop) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropTargetId(unit.id);
          }}
          onDragLeave={() => setDropTargetId(current => current === unit.id ? null : current)}
          onDrop={(event) => {
            event.preventDefault();
            const draggedId = event.dataTransfer.getData('text/plain') || draggingUnitId;
            if (draggedId) moveUnit(draggedId, unit.id);
          }}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
            active ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'
          } ${dropTargetId === unit.id ? 'ring-2 ring-blue-400' : ''}`}
          style={{ marginLeft: `${depth * 24}px` }}
        >
          <button type="button" onClick={() => toggleExpanded(unit.id)} className="p-1 text-gray-500 hover:bg-gray-100 rounded">
            {children.length ? (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <ChevronRight size={16} className="text-transparent" />}
          </button>
          {canDragUnit ? <GripVertical size={16} className="text-gray-400 cursor-grab" /> : <Building2 size={16} className="text-gray-400" />}
          <button type="button" onClick={() => setSelectedUnitId(unit.id)} className="min-w-0 flex-1 text-left">
            <span className="block truncate font-semibold">{unit.name}</span>
            <span className="block text-xs text-gray-500">{unit.code} · {UNIT_TYPE_LABEL[unit.type]}</span>
          </button>
          {unit.status === 'inactive' && <StatusBadge status={unit.status} />}
          {canEditDepartment && (
            <button type="button" onClick={() => setEditingUnit(unit)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded">
              <Edit2 size={16} />
            </button>
          )}
        </div>
        {expanded && children.length > 0 && (
          <div className="mt-2 space-y-2">
            {children.map(child => renderDraggableNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  function renderChartNode(unit: OrganizationUnit, depth = 0) {
    const children = childrenByParent.get(unit.id) || [];
    const active = selectedUnit?.id === unit.id;
    const canDragUnit = canEditDepartment && unit.type !== 'company';
    const draggedUnit = draggingUnitId ? unitById.get(draggingUnitId) : null;
    const canDrop = draggedUnit ? canDropOn(draggedUnit, unit.id) : false;
    const hasChildren = children.length > 0;

    return (
      <div key={unit.id} className="flex flex-col items-center">
        <div
          draggable={canDragUnit}
          onDragStart={(event) => {
            if (!canDragUnit) return;
            event.dataTransfer.setData('text/plain', unit.id);
            event.dataTransfer.effectAllowed = 'move';
            setDraggingUnitId(unit.id);
          }}
          onDragEnd={() => {
            setDraggingUnitId(null);
            setDropTargetId(null);
          }}
          onDragOver={(event) => {
            if (!canDrop) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropTargetId(unit.id);
          }}
          onDragLeave={() => setDropTargetId(current => current === unit.id ? null : current)}
          onDrop={(event) => {
            event.preventDefault();
            const draggedId = event.dataTransfer.getData('text/plain') || draggingUnitId;
            if (draggedId) moveUnit(draggedId, unit.id);
          }}
          className={`group relative h-20 w-44 border px-3 py-2 text-center shadow-sm transition-all ${orgChartNodeClass(unit, depth)} ${
            canDragUnit ? 'cursor-grab active:cursor-grabbing' : ''
          } ${active ? 'ring-4 ring-blue-200' : ''} ${dropTargetId === unit.id ? 'ring-4 ring-amber-300 scale-105' : ''}`}
        >
          {unit.managers.length === 0 && (
            <span title="尚未設定主管" className="absolute right-1.5 top-1.5 text-amber-300">
              <AlertTriangle size={14} />
            </span>
          )}
          {unit.status === 'inactive' && (
            <span className="absolute left-1.5 top-1.5 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">停用</span>
          )}
          <button type="button" onClick={() => openSummary(unit.id)} title={unit.name} className="block w-full min-w-0 text-center">
            <span className="block truncate text-sm font-semibold leading-tight">{unit.name}</span>
            <span className="block truncate text-[11px] opacity-85">{unit.code}</span>
            <span className="mt-1 block truncate text-[11px] opacity-85">
              {directChildrenCount(unit, childrenByParent)} 個下層 | {countDescendantMembers(unit, childrenByParent)} 人
            </span>
          </button>
          <div className="mt-1 flex items-center justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {canDragUnit && <GripVertical size={14} />}
            {canEditDepartment && (
              <button type="button" onClick={() => openEditor(unit)} className="rounded bg-white/15 p-1 hover:bg-white/25">
                <Edit2 size={13} />
              </button>
            )}
          </div>
        </div>

        {hasChildren && (
          <button
            type="button"
            onClick={() => toggleExpanded(unit.id)}
            className="mt-1 rounded-full border border-blue-200 bg-white px-2 py-0.5 text-xs text-blue-700 shadow-sm hover:bg-blue-50"
          >
            {expandedIds.has(unit.id) ? '-' : `+${children.length}`}
          </button>
        )}
        {hasChildren && expandedIds.has(unit.id) && <div className="h-5 border-l border-blue-400" />}
        {hasChildren && expandedIds.has(unit.id) && (
          <div className="relative flex items-start gap-5 pt-6">
            <div className="absolute left-0 right-0 top-0 border-t border-blue-400" />
            {children.map(child => (
              <div key={child.id} className="relative flex flex-col items-center">
                <div className="absolute -top-6 h-6 border-l border-blue-400" />
                {renderChartNode(child, depth + 1)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderUnassignedBlock() {
    return (
      <section
        onDragOver={(event) => {
          const draggedUnit = draggingUnitId ? unitById.get(draggingUnitId) : null;
          if (!draggedUnit || !canDropOn(draggedUnit, null)) return;
          event.preventDefault();
          setDropTargetId('unassigned');
        }}
        onDragLeave={() => setDropTargetId(current => current === 'unassigned' ? null : current)}
        onDrop={(event) => {
          event.preventDefault();
          const draggedId = event.dataTransfer.getData('text/plain') || draggingUnitId;
          if (draggedId) moveUnit(draggedId, null);
        }}
        className={`bg-white rounded-lg shadow-lg p-4 border ${dropTargetId === 'unassigned' ? 'border-blue-400 ring-2 ring-blue-200' : 'border-transparent'}`}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">未編輯上下層</h2>
          {canCreateDepartment && (
            <button type="button" onClick={() => createDepartment(null)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Plus size={16} />新增
            </button>
          )}
        </div>
        <div className="space-y-2">
          {unassignedUnits.length === 0 && <p className="text-sm text-gray-500 py-4">沒有未整理的組織單位</p>}
          {unassignedUnits.map(unit => renderDraggableNode(unit))}
        </div>
      </section>
    );
  }

  function renderManagementRow(unit: OrganizationUnit, depth = 0) {
    const children = childrenByParent.get(unit.id) || [];
    const expanded = expandedIds.has(unit.id);
    const managers = unit.managers.filter(manager => manager.manager_role === 'manager');

    return (
      <div key={unit.id}>
        <div className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-gray-50 transition-colors border-b border-gray-100">
          <div className="col-span-4 min-w-0 flex items-center gap-2" style={{ paddingLeft: `${depth * 24}px` }}>
            <button type="button" onClick={() => toggleExpanded(unit.id)} className="p-1 text-gray-500 hover:bg-gray-100 rounded">
              {children.length ? (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <ChevronRight size={16} className="text-transparent" />}
            </button>
            <div className="min-w-0">
              <div className="font-semibold text-gray-900 truncate">{unit.name}</div>
              <div className="text-xs text-gray-500 font-mono">{unit.code}</div>
            </div>
          </div>
          <div className="col-span-1 text-sm text-gray-600">{UNIT_TYPE_LABEL[unit.type]}</div>
          <div className="col-span-2 text-sm text-gray-600 truncate">{unit.parent_id ? unitById.get(unit.parent_id)?.name || '-' : '-'}</div>
          <div className="col-span-1 text-sm text-gray-700 truncate">{managers.map(manager => userLabel(manager.user)).join('、') || '-'}</div>
          <div className="col-span-1 text-right text-sm text-gray-700">{unit.members.length}</div>
          <div className="col-span-1"><StatusBadge status={unit.status} /></div>
          <div className="col-span-2 flex gap-1 justify-center flex-wrap">
            {canEditDepartment && (
              <button type="button" onClick={() => setEditingUnit(unit)} className="px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-xs font-medium">
                <Edit2 size={12} className="inline mr-1" />編輯
              </button>
            )}
            {canManageMembers && (
              <button type="button" onClick={() => setMemberUnit(unit)} className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs font-medium">
                <Users size={12} className="inline mr-1" />人員
              </button>
            )}
            {canManageManagers && (
              <button type="button" onClick={() => setManagerUnit(unit)} className="px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors text-xs font-medium">
                <UserCog size={12} className="inline mr-1" />主管
              </button>
            )}
            {canEditDepartment && (
              <button type="button" onClick={() => updateStatus(unit, unit.status === 'active' ? 'inactive' : 'active')} className="px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-xs font-medium">
                {unit.status === 'active' ? '停用' : '啟用'}
              </button>
            )}
          </div>
        </div>
        {expanded && children.map(child => renderManagementRow(child, depth + 1))}
      </div>
    );
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
          {unassignedUnits.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span>有 {unassignedUnits.length} 個組織單位尚未設定上層組織</span>
              <button type="button" onClick={() => setNavigatorOpen(true)} className="font-semibold text-amber-900 underline">查看並處理</button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
                <Building2 className="text-blue-600" size={40} />
                公司組織
              </h1>
              <p className="text-gray-600">查看及維護公司的部門、營業區、門市與上下層組織關係</p>
            </div>
            <div className="flex items-center gap-3">
              {canCreateDepartment && (
                <button
                  type="button"
                  onClick={() => createDepartment(selectedUnit?.id || organizationRoots[0]?.id || null)}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                >
                  <Plus size={20} />
                  新增組織單位
                </button>
              )}
            </div>
          </div>

          <section className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="border-b border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setNavigatorOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  <Navigation size={16} />組織導覽
                </button>
                <div className="relative min-w-64 flex-1">
                  <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                  <input value={organizationSearch} onChange={(event) => setOrganizationSearch(event.target.value)} className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm" placeholder="搜尋組織單位..." />
                </div>
                <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700">
                  <option value="all">全部類型</option>
                  {Object.entries(UNIT_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <ShowInactiveToggle showInactive={showInactive} onToggle={() => setShowInactive(value => !value)} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={expandAll} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">展開全部</button>
                  <button type="button" onClick={collapseToSecondLevel} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">收合至第二層</button>
                  <button type="button" onClick={resetViewport} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Maximize2 size={16} />適應畫面</button>
                  <button type="button" onClick={() => { setSelectedUnitId(organizationRoots[0]?.id || null); resetViewport(); }} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"><Home size={16} />回到公司</button>
                  <button type="button" onClick={() => setZoom(value => Math.min(1.8, value + 0.1))} className="rounded-lg border border-gray-300 p-2 text-gray-700 hover:bg-gray-50"><ZoomIn size={16} /></button>
                  <button type="button" onClick={() => setZoom(value => Math.max(0.5, value - 0.1))} className="rounded-lg border border-gray-300 p-2 text-gray-700 hover:bg-gray-50"><ZoomOut size={16} /></button>
                </div>
                {canEditDepartment && (
                  <button type="button" onClick={adjustMode ? () => setAdjustMode(false) : enterAdjustMode} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${adjustMode ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                    <SlidersHorizontal size={16} />{adjustMode ? '結束調整模式' : '組織調整'}
                  </button>
                )}
              </div>
              {adjustMode && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">組織調整模式</div>
                      <div>拖曳組織單位至新的上層，所有變更尚未儲存。已變更 {hierarchyChangeCount} 項</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasHierarchyChanges && <button type="button" onClick={discardHierarchyChanges} disabled={saving} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900 hover:bg-amber-100">放棄變更</button>}
                      <button type="button" onClick={saveHierarchyChanges} disabled={!hasHierarchyChanges || saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                        <Save size={16} />{saving ? '儲存中...' : '儲存組織調整'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div
              className={`h-[calc(100vh-260px)] min-h-[520px] overflow-auto bg-slate-50 ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
              onMouseDown={(event) => {
                if ((event.target as HTMLElement).closest('button,[draggable="true"],input,select')) return;
                setIsPanning(true);
                panStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
              }}
              onMouseMove={(event) => {
                if (!isPanning || !panStartRef.current) return;
                setPan({ x: panStartRef.current.panX + event.clientX - panStartRef.current.x, y: panStartRef.current.panY + event.clientY - panStartRef.current.y });
              }}
              onMouseUp={() => setIsPanning(false)}
              onMouseLeave={() => setIsPanning(false)}
              onWheel={(event) => {
                if (event.ctrlKey) {
                  event.preventDefault();
                  setZoom(value => Math.max(0.5, Math.min(1.8, value - event.deltaY * 0.001)));
                  return;
                }
                if (event.shiftKey) setPan(value => ({ ...value, x: value.x - event.deltaY }));
              }}
            >
              {organizationRoots.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-gray-500">
                  <div>
                    <div className="text-xl font-semibold text-gray-900">尚未建立公司組織</div>
                    <p className="mt-2">請先建立公司，再新增部門、營業區及門市。</p>
                    {canCreateDepartment && <button type="button" onClick={() => createDepartment(null)} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">建立公司</button>}
                  </div>
                </div>
              ) : filteredOrganizationUnits.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-gray-500">
                  <div>
                    <div className="text-xl font-semibold text-gray-900">找不到符合條件的組織單位</div>
                    <p className="mt-2">請調整名稱、代碼或類型條件。</p>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-full min-w-max items-start justify-center gap-10 p-10" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'top center' }}>
                  {organizationRoots.map(unit => renderChartNode(unit))}
                </div>
              )}
            </div>
          </section>
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
                  onClick={() => createDepartment(selectedUnit?.id || organizationRoots[0]?.id || null)}
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
              <div className="col-span-4">組織單位</div>
              <div className="col-span-1">類型</div>
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
              {organizationRoots.map(unit => renderManagementRow(unit))}
              {companyUnits.length > 0 && unassignedUnits.length > 0 && (
                <div className="bg-amber-50">
                  <div className="px-6 py-3 text-sm font-semibold text-amber-900 border-b border-amber-100">未編輯上下層</div>
                  {unassignedUnits.map(unit => renderManagementRow(unit))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {mode === 'departments' && editingUnit && (
        <UnitDialog
          unit={editingUnit}
          saving={saving}
          onClose={() => setEditingUnit(null)}
          onSave={saveUnit}
        />
      )}
      {mode === 'overview' && drawerMode === 'summary' && drawerUnit && (
        <OrganizationSummaryDrawer
          unit={drawerUnit}
          parent={drawerUnit.parent_id ? unitById.get(drawerUnit.parent_id) || null : null}
          children={childrenByParent.get(drawerUnit.id) || []}
          totalMembers={countDescendantMembers(drawerUnit, childrenByParent)}
          canEdit={canEditDepartment}
          onClose={() => setDrawerMode(null)}
          onEdit={() => openEditor(drawerUnit)}
        />
      )}
      {mode === 'overview' && drawerMode === 'edit' && editingUnit && (
        <OrganizationEditorDrawer
          unit={editingUnit}
          units={organizationUnits}
          unitById={unitById}
          users={filteredUsers}
          userSearch={userSearch}
          activeTab={editorTab}
          saving={saving}
          canManageMembers={canManageMembers}
          canManageManagers={canManageManagers}
          onTabChange={setEditorTab}
          onSearch={setUserSearch}
          onClose={() => {
            setEditingUnit(null);
            setDrawerMode(drawerUnitId ? 'summary' : null);
          }}
          onSaveBasic={saveUnit}
          onSaveMembers={saveMembers}
          onSaveManagers={saveManagers}
        />
      )}
      {navigatorOpen && (
        <OrganizationNavigatorDrawer
          units={filteredOrganizationUnits}
          unitById={unitById}
          selectedUnitId={selectedUnit?.id || null}
          showInactive={showInactive}
          search={organizationSearch}
          typeFilter={typeFilter}
          onSearch={setOrganizationSearch}
          onTypeFilter={setTypeFilter}
          onShowInactive={setShowInactive}
          onClose={() => setNavigatorOpen(false)}
          onSelect={locateUnit}
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

function DrawerShell({ title, widthClass = 'max-w-xl', children, onClose }: {
  title: string;
  widthClass?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <aside className={`h-full w-full ${widthClass} overflow-y-auto bg-white shadow-2xl`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="rounded p-2 text-gray-500 hover:bg-gray-100"><X size={20} /></button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function OrganizationNavigatorDrawer({ units, unitById, selectedUnitId, showInactive, search, typeFilter, onSearch, onTypeFilter, onShowInactive, onClose, onSelect }: {
  units: OrganizationUnit[];
  unitById: Map<string, OrganizationUnit>;
  selectedUnitId: string | null;
  showInactive: boolean;
  search: string;
  typeFilter: 'all' | OrganizationUnit['type'];
  onSearch: (value: string) => void;
  onTypeFilter: (value: 'all' | OrganizationUnit['type']) => void;
  onShowInactive: (value: boolean) => void;
  onClose: () => void;
  onSelect: (unitId: string) => void;
}) {
  return (
    <DrawerShell title="組織導覽" widthClass="max-w-md" onClose={onClose}>
      <div className="space-y-4 p-6">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
          <input value={search} onChange={(event) => onSearch(event.target.value)} className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3" placeholder="搜尋名稱、代碼或路徑" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select value={typeFilter} onChange={(event) => onTypeFilter(event.target.value as 'all' | OrganizationUnit['type'])} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="all">全部類型</option>
            {Object.entries(UNIT_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input type="checkbox" checked={showInactive} onChange={(event) => onShowInactive(event.target.checked)} />
            顯示停用
          </label>
        </div>
        <div className="space-y-2">
          {units.length === 0 && <div className="rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-500">找不到符合條件的組織單位</div>}
          {units.map(unit => (
            <button
              key={unit.id}
              type="button"
              onClick={() => onSelect(unit.id)}
              className={`w-full rounded-lg border p-3 text-left hover:bg-blue-50 ${selectedUnitId === unit.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}`}
            >
              <div className="font-semibold text-gray-900">{unit.name}</div>
              <div className="mt-1 text-xs text-gray-500">{unit.code} | {UNIT_TYPE_LABEL[unit.type]}</div>
              <div className="mt-1 text-xs text-gray-500">{buildUnitPath(unit, unitById).replaceAll(' / ', ' > ')}</div>
            </button>
          ))}
        </div>
      </div>
    </DrawerShell>
  );
}

function OrganizationSummaryDrawer({ unit, parent, children, totalMembers, canEdit, onClose, onEdit }: {
  unit: OrganizationUnit;
  parent: OrganizationUnit | null;
  children: OrganizationUnit[];
  totalMembers: number;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const mainManagers = unit.managers.filter(manager => manager.manager_role === 'manager');
  return (
    <DrawerShell title="組織單位摘要" widthClass="max-w-lg" onClose={onClose}>
      <div className="space-y-6 p-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{unit.name}</h2>
          <p className="mt-1 text-sm text-gray-500">{unit.code} | {UNIT_TYPE_LABEL[unit.type]}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InfoCard label="狀態" value={unit.status === 'active' ? '啟用' : '停用'} />
          <InfoCard label="上層組織" value={parent?.name || '未設定'} />
          <InfoCard label="直屬成員" value={`${unit.members.length} 人`} />
          <InfoCard label="合計人數" value={`${totalMembers} 人`} />
          <InfoCard label="下層組織" value={`${children.length} 個`} />
          <InfoCard label="主管數" value={`${unit.managers.length} 人`} />
        </div>
        <section className="rounded-lg border border-gray-200 p-4">
          <h4 className="mb-3 font-semibold text-gray-900">主管</h4>
          {mainManagers.length === 0 ? <p className="text-sm text-amber-700">尚未設定主管</p> : mainManagers.map(manager => <p key={manager.id} className="text-sm text-gray-700">{userLabel(manager.user)}</p>)}
        </section>
        <section className="rounded-lg border border-gray-200 p-4">
          <h4 className="mb-3 font-semibold text-gray-900">下層組織</h4>
          {children.length === 0 ? <p className="text-sm text-gray-500">無</p> : children.map(child => <p key={child.id} className="text-sm text-gray-700">{child.name}</p>)}
        </section>
        {canEdit && <button type="button" onClick={onEdit} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700">編輯組織單位</button>}
      </div>
    </DrawerShell>
  );
}

function OrganizationEditorDrawer({ unit, units, unitById, users, userSearch, activeTab, saving, canManageMembers, canManageManagers, onTabChange, onSearch, onClose, onSaveBasic, onSaveMembers, onSaveManagers }: {
  unit: OrganizationUnit;
  units: OrganizationUnit[];
  unitById: Map<string, OrganizationUnit>;
  users: OrganizationUser[];
  userSearch: string;
  activeTab: EditorTab;
  saving: boolean;
  canManageMembers: boolean;
  canManageManagers: boolean;
  onTabChange: (tab: EditorTab) => void;
  onSearch: (value: string) => void;
  onClose: () => void;
  onSaveBasic: (formData: FormData) => void;
  onSaveMembers: (unit: OrganizationUnit, selectedUserIds: string[]) => void;
  onSaveManagers: (unit: OrganizationUnit, assignments: Array<{ user_id: string; manager_role: string; is_primary: boolean }>) => void;
}) {
  const [selectedMembers, setSelectedMembers] = useState(() => new Set(unit.members.map(member => member.user_id)));
  const [selectedManagers, setSelectedManagers] = useState(() => new Map(unit.managers.map(manager => [manager.user_id, manager.manager_role])));
  const parentOptions = units.filter(candidate => candidate.id !== unit.id && isLegalParentFor(unit, candidate, unitById));

  return (
    <DrawerShell title={unit.id ? '編輯組織單位' : '新增組織單位'} widthClass="max-w-4xl" onClose={onClose}>
      <div className="border-b border-gray-200 px-6 pt-4">
        <div className="flex gap-2">
          {(Object.keys(EDITOR_TAB_LABEL) as EditorTab[]).map(tab => (
            <button key={tab} type="button" onClick={() => onTabChange(tab)} className={`border-b-2 px-4 py-3 text-sm font-semibold ${activeTab === tab ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
              {EDITOR_TAB_LABEL[tab]}
            </button>
          ))}
        </div>
      </div>
      <div className="p-6">
        {activeTab === 'basic' && (
          <form action={onSaveBasic} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <input type="hidden" name="id" value={unit.id} />
            <input type="hidden" name="type" value={unit.type || 'department'} />
            <input type="hidden" name="sort_order" value={unit.sort_order || 0} />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">組織名稱</span>
              <input name="name" defaultValue={unit.name} required className="w-full rounded-lg border border-gray-300 px-4 py-2" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">組織代碼</span>
              <input name="code" defaultValue={unit.code} required pattern="[A-Za-z0-9_-]{2,30}" className="w-full rounded-lg border border-gray-300 px-4 py-2 uppercase" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">組織類型</span>
              <input value={UNIT_TYPE_LABEL[unit.type]} readOnly className="w-full rounded-lg border border-gray-300 bg-gray-100 px-4 py-2" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">上層組織</span>
              <select name="parent_id" defaultValue={unit.parent_id || ''} className="w-full rounded-lg border border-gray-300 px-4 py-2">
                <option value="">未設定</option>
                {parentOptions.map(parent => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">啟用狀態</span>
              <select name="status" defaultValue={unit.status || 'active'} className="w-full rounded-lg border border-gray-300 px-4 py-2">
                <option value="active">啟用</option>
                <option value="inactive">停用</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="mb-2 block text-sm font-medium text-gray-700">組織說明</span>
              <textarea name="description" defaultValue={unit.description || ''} rows={4} className="w-full rounded-lg border border-gray-300 px-4 py-2" />
            </label>
            <div className="md:col-span-2 flex justify-end gap-3 border-t border-gray-200 pt-4">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-6 py-2 text-gray-700 hover:bg-gray-50">取消</button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"><Save size={18} />{saving ? '儲存中...' : '儲存'}</button>
            </div>
          </form>
        )}
        {activeTab === 'managers' && (
          <PickerPanel
            users={users}
            userSearch={userSearch}
            saving={saving}
            selected={selectedManagers}
            mode="managers"
            disabled={!canManageManagers}
            onSearch={onSearch}
            onManagerChange={setSelectedManagers}
            onSave={() => onSaveManagers(unit, Array.from(selectedManagers.entries()).map(([user_id, manager_role], index) => ({ user_id, manager_role, is_primary: index === 0 })))}
          />
        )}
        {activeTab === 'members' && (
          <PickerPanel
            users={users}
            userSearch={userSearch}
            saving={saving}
            selected={selectedMembers}
            mode="members"
            disabled={!canManageMembers}
            onSearch={onSearch}
            onMemberChange={setSelectedMembers}
            onSave={() => onSaveMembers(unit, Array.from(selectedMembers))}
          />
        )}
      </div>
    </DrawerShell>
  );
}

function PickerPanel({ users, userSearch, saving, selected, mode, disabled, onSearch, onMemberChange, onManagerChange, onSave }: {
  users: OrganizationUser[];
  userSearch: string;
  saving: boolean;
  selected: Set<string> | Map<string, OrganizationManagerAssignment['manager_role']>;
  mode: 'members' | 'managers';
  disabled: boolean;
  onSearch: (value: string) => void;
  onMemberChange?: (value: Set<string>) => void;
  onManagerChange?: (value: Map<string, OrganizationManagerAssignment['manager_role']>) => void;
  onSave: () => void;
}) {
  const isManagers = mode === 'managers';

  return (
    <div className="space-y-4">
      {disabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          目前帳號沒有{isManagers ? '主管設定' : '成員設定'}權限，僅能檢視。
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
        <input
          value={userSearch}
          onChange={(event) => onSearch(event.target.value)}
          className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4"
          placeholder="搜尋姓名、員編、Email、部門或職稱"
        />
      </div>
      <div className="max-h-[56vh] overflow-auto rounded-lg border border-gray-200">
        <div className={`grid ${isManagers ? 'grid-cols-[minmax(220px,1.5fr)_150px_150px_120px]' : 'grid-cols-[minmax(220px,1.5fr)_150px_180px_90px]'} gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-600`}>
          <span>人員</span>
          <span>員工編號</span>
          <span>{isManagers ? '主管角色' : '目前所屬組織'}</span>
          <span className="text-right">選取</span>
        </div>
        {users.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">沒有符合條件的人員</div>
        ) : users.map(user => {
          const checked = isManagers ? selected instanceof Map && selected.has(user.id) : selected instanceof Set && selected.has(user.id);
          return (
            <div key={user.id} className="grid grid-cols-1 gap-3 border-b border-gray-100 px-4 py-3 text-sm last:border-b-0 md:grid-cols-[minmax(220px,1.5fr)_150px_180px_90px]">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{userLabel(user)}</p>
                <p className="truncate text-xs text-gray-500">{user.email || user.job_title || '-'}</p>
              </div>
              <div className="text-gray-600">{user.employee_code || '-'}</div>
              {isManagers ? (
                <select
                  disabled={disabled || !checked}
                  value={selected instanceof Map ? selected.get(user.id) || 'manager' : 'manager'}
                  onChange={(event) => {
                    if (!(selected instanceof Map) || !onManagerChange) return;
                    const next = new Map(selected);
                    next.set(user.id, event.target.value as OrganizationManagerAssignment['manager_role']);
                    onManagerChange(next);
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
                >
                  <option value="manager">主管</option>
                  <option value="deputy_manager">副主管</option>
                  <option value="acting_manager">代理主管</option>
                </select>
              ) : (
                <div className="text-gray-600">{user.department || '-'}</div>
              )}
              <label className="flex justify-end">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={checked}
                  onChange={(event) => {
                    if (isManagers) {
                      if (!(selected instanceof Map) || !onManagerChange) return;
                      const next = new Map(selected);
                      event.target.checked ? next.set(user.id, 'manager') : next.delete(user.id);
                      onManagerChange(next);
                    } else {
                      if (!(selected instanceof Set) || !onMemberChange) return;
                      const next = new Set(selected);
                      event.target.checked ? next.add(user.id) : next.delete(user.id);
                      onMemberChange(next);
                    }
                  }}
                  className="h-5 w-5 rounded border-gray-300"
                />
              </label>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
        <button type="button" onClick={onSave} disabled={saving || disabled} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
          <Save size={18} />{saving ? '儲存中...' : '儲存'}
        </button>
      </div>
    </div>
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

function UnitDialog({ unit, saving, onClose, onSave }: {
  unit: OrganizationUnit;
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
          <input type="hidden" name="parent_id" value={unit.parent_id || ''} />
          <input type="hidden" name="sort_order" value={unit.sort_order || 0} />
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
