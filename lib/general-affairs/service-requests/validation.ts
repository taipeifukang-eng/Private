const REQUEST_TYPES = new Set(['REPAIR', 'PURCHASE_SUPPLEMENT']);
const RESOURCE_TYPES = new Set(['EQUIPMENT', 'FACILITY', 'PART', 'GENERAL_SUPPLY', 'OTHER_PURCHASE']);
const INTAKE_ACTIONS = new Set(['accept', 'reject', 'request_supplement', 'assign', 'update_progress', 'request_store_confirmation']);
const INTAKE_ROUTES = new Set(['REPAIR_DISPATCH', 'PURCHASE_REVIEW', 'STOCK_ISSUE', 'TRANSFER', 'ASSET_TASK']);
const ASSIGNEE_ROLES = new Set(['GENERAL_AFFAIRS', 'WORKS']);
const REJECTION_REASONS = new Set([
  'OUT_OF_SCOPE',
  'INSUFFICIENT_DATA_RECREATE',
  'DUPLICATE_REQUEST',
  'NOT_ELIGIBLE',
  'ALTERNATIVE_AVAILABLE',
  'OTHER',
]);
const SUPPLEMENT_TYPES = new Set([
  'PHOTO_UNCLEAR',
  'MISSING_PHOTO',
  'DESCRIPTION_INSUFFICIENT',
  'RESOURCE_SELECTION_WRONG',
  'QUANTITY_OR_SPEC_INSUFFICIENT',
  'OTHER',
]);

function cleanText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, maxLength);
}

function cleanOptionalText(value: unknown, maxLength: number) {
  const text = cleanText(value, maxLength);
  return text || null;
}

function cleanUuid(value: unknown) {
  const text = cleanText(value, 80);
  if (!text) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error('資料代碼格式錯誤');
  }
  return text;
}

function cleanQuantity(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('數量必須大於 0');
  return numeric;
}

export function validateServiceRequestPayload(body: Record<string, unknown>) {
  const storeId = cleanUuid(body.store_id);
  if (!storeId) throw new Error('請選擇門市');

  const requestType = cleanText(body.request_type, 40).toUpperCase();
  if (!REQUEST_TYPES.has(requestType)) throw new Error('需求類型錯誤');

  const resourceType = cleanText(body.resource_type, 40).toUpperCase();
  if (resourceType && !RESOURCE_TYPES.has(resourceType)) throw new Error('標的類型錯誤');

  const title = cleanText(body.title, 120);
  if (!title) throw new Error('請填寫需求標題');

  const description = cleanText(body.description, 2000);
  if (description.length < 5) throw new Error('請填寫較完整的需求說明');

  const equipmentId = cleanUuid(body.equipment_id);
  const facilityId = cleanUuid(body.facility_id);
  const partId = cleanUuid(body.part_id);

  if (requestType === 'REPAIR') {
    if (resourceType && resourceType !== 'EQUIPMENT' && resourceType !== 'FACILITY') {
      throw new Error('維修需求若選擇標的，只能選擇設備或設施');
    }
    if (equipmentId && facilityId) throw new Error('維修需求只能綁定一個設備或一個設施');
    if (resourceType === 'EQUIPMENT' && facilityId) throw new Error('維修標的類型與資料不一致');
    if (resourceType === 'FACILITY' && equipmentId) throw new Error('維修標的類型與資料不一致');
    if (!resourceType && (equipmentId || facilityId)) throw new Error('維修標的類型與資料不一致');
  }

  if (requestType === 'PURCHASE_SUPPLEMENT') {
    if (!resourceType) throw new Error('標的類型錯誤');
    const desiredQuantity = cleanQuantity(body.desired_quantity);
    if (!desiredQuantity) throw new Error('請填寫希望數量');
  }

  return {
    store_id: storeId,
    request_type: requestType,
    title,
    description,
    resource_type: resourceType || null,
    equipment_id: resourceType === 'EQUIPMENT' ? equipmentId : null,
    facility_id: resourceType === 'FACILITY' ? facilityId : null,
    part_id: resourceType === 'PART' ? partId : null,
    desired_quantity: requestType === 'PURCHASE_SUPPLEMENT' ? cleanQuantity(body.desired_quantity) : null,
    desired_unit: requestType === 'PURCHASE_SUPPLEMENT' ? cleanOptionalText(body.desired_unit, 20) : null,
    desired_spec: requestType === 'PURCHASE_SUPPLEMENT' ? cleanOptionalText(body.desired_spec, 1000) : null,
    impact_description: cleanOptionalText(body.impact_description, 1000),
    temporary_workaround: cleanOptionalText(body.temporary_workaround, 1000),
    contact_name: cleanOptionalText(body.contact_name, 80),
    contact_phone: cleanOptionalText(body.contact_phone, 40),
    main_status: 'PENDING_INTAKE',
    public_progress: '門市已送出需求，等待總務受理。',
  };
}

export function validateServiceRequestActionPayload(body: Record<string, unknown>) {
  const action = cleanText(body.action, 40);
  if (!INTAKE_ACTIONS.has(action)) throw new Error('需求單處理動作錯誤');

  if (action === 'accept') {
    const intakeRoute = cleanText(body.intake_route, 40).toUpperCase();
    const assigneeRole = cleanText(body.assignee_role, 40).toUpperCase();
    if (!INTAKE_ROUTES.has(intakeRoute)) throw new Error('受理時必須選擇後續處理方式');
    if (!ASSIGNEE_ROLES.has(assigneeRole)) throw new Error('受理時必須選擇總務或工務角色');

    return {
      action,
      intake_route: intakeRoute,
      assignee_role: assigneeRole,
      assignee_user_id: cleanUuid(body.assignee_user_id),
      assignee_name: cleanOptionalText(body.assignee_name, 80),
      internal_note: cleanOptionalText(body.internal_note, 1000),
    };
  }

  if (action === 'reject') {
    const rejectionReason = cleanText(body.rejection_reason, 60).toUpperCase();
    const rejectionNote = cleanText(body.rejection_note, 1000);
    if (!REJECTION_REASONS.has(rejectionReason)) throw new Error('駁回原因類型錯誤');
    if (!rejectionNote) throw new Error('駁回時必須填寫原因說明');

    return {
      action,
      rejection_reason: rejectionReason,
      rejection_note: rejectionNote,
      internal_note: cleanOptionalText(body.internal_note, 1000),
    };
  }

  if (action === 'request_supplement') {
    const supplementType = cleanText(body.supplement_type, 60).toUpperCase();
    const supplementNote = cleanText(body.supplement_note, 1000);
    if (!SUPPLEMENT_TYPES.has(supplementType)) throw new Error('補資料類型錯誤');
    if (!supplementNote) throw new Error('要求補資料時必須填寫說明');

    return {
      action,
      supplement_type: supplementType,
      supplement_note: supplementNote,
      internal_note: cleanOptionalText(body.internal_note, 1000),
    };
  }

  if (action === 'update_progress') {
    return {
      action,
      internal_note: cleanOptionalText(body.internal_note, 1000),
    };
  }

  if (action === 'request_store_confirmation') {
    return {
      action,
      internal_note: cleanOptionalText(body.internal_note, 1000),
    };
  }

  const assigneeRole = cleanText(body.assignee_role, 40).toUpperCase();
  if (!ASSIGNEE_ROLES.has(assigneeRole)) throw new Error('轉派時必須選擇總務或工務角色');

  return {
    action,
    assignee_role: assigneeRole,
    assignee_user_id: cleanUuid(body.assignee_user_id),
    assignee_name: cleanOptionalText(body.assignee_name, 80),
    internal_note: cleanOptionalText(body.internal_note, 1000),
  };
}
