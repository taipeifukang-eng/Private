import { checked, checkOrigin, context, failed, requireCapability, respond, uuid, WorkspaceError } from '@/lib/workspace/server';
import { ORGANIZATION_NAV_PERMISSION_CODES } from '@/lib/admin/organization-management';

export const dynamic = 'force-dynamic';
const permissions = {
  create: 'organization.department.create', update: 'organization.department.edit',
  hierarchy: 'organization.department.edit', members: 'organization.member.manage', managers: 'organization.manager.manage',
} as const;
type Operation = keyof typeof permissions;
const invalid = () => new WorkspaceError(400, '組織資料格式不正確，請檢查必填欄位及人員選擇');
function object(value: any) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); return value; }
function id(value: any) { if (!uuid(value)) throw invalid(); return value as string; }
function parent(value: any) { return value === null || value === '' ? null : id(value); }
function order(value: any) { if (!Number.isInteger(value) || value < 0 || value > 1000000) throw invalid(); return value; }
function text(value: any, max: number, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw invalid();
  return value.trim();
}
function list(value: any) { if (!Array.isArray(value) || value.length > 1000) throw invalid(); return value; }
function unique(values: string[]) { if (new Set(values).size !== values.length) throw invalid(); return values; }
function normalize(operation: Operation, raw: any) {
  const data = object(raw);
  if (operation === 'hierarchy') {
    const updates = list(data.updates).map(row => ({ id: id(object(row).id), parent_id: parent(row.parent_id), sort_order: order(row.sort_order) }));
    if (!updates.length) throw invalid(); unique(updates.map(row => row.id)); return { updates };
  }
  if (operation === 'members') return { id: id(data.id), user_ids: unique(list(data.user_ids).map(id)).sort() };
  if (operation === 'managers') {
    const assignments = list(data.assignments).map(row => {
      object(row);
      if (!['manager', 'deputy_manager', 'acting_manager'].includes(row.manager_role) || typeof row.is_primary !== 'boolean') throw invalid();
      return { user_id: id(row.user_id), manager_role: row.manager_role as string, is_primary: row.is_primary as boolean };
    });
    unique(assignments.map(row => row.user_id));
    if (assignments.length && assignments.filter(row => row.is_primary).length !== 1) throw new WorkspaceError(400, '請指定一位主要主管');
    return { id: id(data.id), assignments: assignments.sort((a, b) => a.user_id.localeCompare(b.user_id)) };
  }
  const code = text(data.code, 30, true).toUpperCase();
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !['active', 'inactive'].includes(data.status)) throw invalid();
  if (operation === 'create' && !['company', 'headquarters', 'department', 'team'].includes(data.type)) throw invalid();
  return { ...(operation === 'update' ? { id: id(data.id) } : { type: data.type }), code,
    name: text(data.name, 200, true), short_name: text(data.short_name ?? '', 100), description: text(data.description ?? '', 5000),
    parent_id: parent(data.parent_id), status: data.status, sort_order: order(data.sort_order) };
}

export async function GET() { try {
  const ctx = await context(); requireCapability(ctx, [...ORGANIZATION_NAV_PERMISSION_CODES]);
  const catalog = checked(await ctx.admin.rpc('workspace_organization_catalog'));
  return respond({ ...catalog, capabilities: Object.fromEntries(Object.entries(permissions).map(([key, code]) => [key, ctx.has(code)])) });
} catch (e) { return failed(e); } }

export async function POST(request: Request) { try {
  checkOrigin(request); const ctx = await context();
  let body: any; try { body = object(await request.json()); } catch { throw invalid(); }
  if (typeof body.operation !== 'string' || !Object.prototype.hasOwnProperty.call(permissions, body.operation)) throw invalid();
  const operation = body.operation as Operation; requireCapability(ctx, [permissions[operation]]);
  if (!uuid(body.requestId) || typeof body.expected !== 'string' || !/^[a-f0-9]{32}$/.test(body.expected)) throw invalid();
  const result = await ctx.admin.rpc('workspace_organization_save', {
    p_actor: ctx.user.id, p_request: body.requestId, p_operation: operation, p_data: normalize(operation, body.data), p_expected: body.expected,
  });
  if (result.error) {
    const message = result.error.message;
    const errors: [string, number, string][] = [
      ['WORKSPACE_CONFLICT', 409, '組織資料已被其他操作更新，請保留草稿並重新載入核對'],
      ['WORKSPACE_REQUEST_REUSED', 409, '此次儲存識別已用於其他內容，請重新確認後儲存'],
      ['WORKSPACE_NOT_FOUND', 404, '此組織單位已不存在'],
      ['WORKSPACE_COMPANY_ROOT', 400, '公司不可設定上層單位'],
      ['WORKSPACE_PARENT', 400, '上層單位不存在或已停用'],
      ['WORKSPACE_PRIMARY_CONFLICT', 409, '所選人員已有其他主要組織，請先核對原組織的成員指派'],
      ['WORKSPACE_PRIMARY_MANAGER', 400, '請指定一位主要主管'],
      // M5 Q10：停用單位仍可調整成員與主管，資料庫不再回 WORKSPACE_INACTIVE。
      ['WORKSPACE_USER', 400, '所選人員已不存在或主管角色不正確'],
      ['cycle', 400, '組織層級不可指向自己或形成循環'],
      ['own parent', 400, '組織單位不可指定自己為上層'],
      ['WORKSPACE_INVALID', 400, '組織資料格式不正確'],
    ];
    for (const [key, status, detail] of errors) if (message.includes(key)) throw new WorkspaceError(status, detail);
    if (result.error.code === '23505') throw new WorkspaceError(409, '單位代碼或人員指派重複，請重新核對');
    throw new WorkspaceError(503, '組織儲存未完成，請稍後重試；此次操作未部分套用');
  }
  return respond(result.data);
} catch (e) { return failed(e); } }
