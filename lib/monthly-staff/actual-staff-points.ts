export const SENIOR_OR_SPECIALIST_POSITIONS = [
  '總經理',
  '副總經理',
  '經理',
  '督導',
  '店長',
  '代理店長',
  '督導(代理店長)',
  '副店長',
  '主任',
  '組長',
  '專員',
];

export const MONTHLY_STATUS_LABELS: Record<string, string> = {
  full_month: '整月在職',
  new_hire: '到職（本月新進）',
  resigned: '離職',
  leave_of_absence: '留停',
  transferred_in: '調入',
  transferred_out: '調出',
  promoted: '升職',
  support_rotation: '支援卡班',
  dual_store_manager: '擔任雙店長',
  leave_return: '留停復職',
};

export interface ActualStaffPointInput {
  position?: string | null;
  newbie_level?: string | null;
  monthly_status?: string | null;
  work_days?: number | string | null;
  total_days_in_month?: number | string | null;
  work_hours?: number | string | null;
  supervisor_shift_hours?: number | string | null;
  extra_task_planned_hours?: number | string | null;
  employment_type?: string | null;
  is_pharmacist?: boolean | null;
  is_dual_position?: boolean | null;
  is_acting_manager?: boolean | null;
  is_supervisor_rotation?: boolean | null;
}

export interface ActualStaffPointResult {
  point: number;
  positionName: string;
  stage: string;
  statusLabel: string;
  scope: '整月在職' | '未整月在職';
  adoptedHours: number;
  adoptedHoursSource: string;
  adoptedWorkDays: number;
  businessDays: number;
  dayRatio: number;
  rule: string;
  needsReview: string;
}

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function capOne(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function roundPoint(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function normalizeMonthlyPosition(record: ActualStaffPointInput): string {
  let positionName = record.position || '';

  if (record.is_acting_manager) {
    if (positionName === '督導') {
      positionName = '督導(代理店長)';
    } else if (positionName === '主任' || positionName === '副店長') {
      positionName = '代理店長';
    }
  }

  if (record.is_dual_position && positionName) {
    positionName += '-雙';
  }

  return positionName;
}

export function calculateStaffStage(position: string, newbieLevel: string | null | undefined): string {
  if (SENIOR_OR_SPECIALIST_POSITIONS.includes(position)) return '三階';

  if (position === '新人') {
    if (newbieLevel === '二階新人') return '二階';
    if (newbieLevel === '一階新人') return '一階';
    return '未過一階';
  }

  if (position === '行政') {
    if (newbieLevel === '過階行政') return '行政(過階)';
    return '行政(未過階)';
  }

  if (position === '兼職專員') return '三階';
  if (position === '兼職藥師專員') return '三階';
  if (position === '兼職藥師') return newbieLevel === '三階' ? '三階' : '未過階';
  if (position === '兼職助理') return '未過階';

  return '';
}

export function resolveActualStaffPointHours(record: ActualStaffPointInput): { hours: number; source: string } {
  const supervisorShiftHours = toNumber(record.supervisor_shift_hours);
  if (record.is_supervisor_rotation && supervisorShiftHours > 0) {
    return { hours: supervisorShiftHours, source: '督導卡班時數' };
  }

  const extraTaskPlannedHours = toNumber(record.extra_task_planned_hours);
  if (extraTaskPlannedHours > 0) {
    return { hours: extraTaskPlannedHours, source: '該店規劃實上時數' };
  }

  return { hours: toNumber(record.work_hours), source: '本月工作時數' };
}

function fullMonthBasePoint(position: string, stage: string, hours: number): { point: number; rule: string; needsReview: string } {
  if (SENIOR_OR_SPECIALIST_POSITIONS.includes(position)) {
    return { point: 1, rule: '整月在職：專員以上職等 = 1', needsReview: '' };
  }

  if (position === '行政') {
    if (stage === '行政(過階)') {
      return { point: 0.5, rule: '整月在職：行政(過階) = 0.5', needsReview: '' };
    }
    return { point: 0, rule: '整月在職：行政(未過階) = 0', needsReview: '' };
  }

  if (position === '新人') {
    if (stage === '二階') return { point: 0.7, rule: '整月在職：新人(二階) = 0.7', needsReview: '' };
    if (stage === '一階') return { point: 0.5, rule: '整月在職：新人(一階) = 0.5', needsReview: '' };
    return { point: 0.5, rule: '整月在職：新人(未過一階) = 0.5', needsReview: '' };
  }

  if (position === '兼職助理') {
    return {
      point: capOne(hours / 160 / 2),
      rule: '整月在職：兼職助理(未過階) = 時數 / 160 / 2，最高 1',
      needsReview: '',
    };
  }

  if (position === '兼職專員') {
    return {
      point: capOne(hours / 160),
      rule: '整月在職：兼職專員(三階) = 時數 / 160，最高 1',
      needsReview: '',
    };
  }

  if (position === '兼職藥師' || position === '兼職藥師專員') {
    return {
      point: capOne(hours / 160),
      rule: position === '兼職藥師專員'
        ? '整月在職：兼職藥師專員歸屬兼職藥師(三階) = 時數 / 160，最高 1'
        : '整月在職：兼職藥師(三階/未過階) = 時數 / 160，最高 1',
      needsReview: '',
    };
  }

  return {
    point: 0,
    rule: '未找到對應職位規則，暫以 0 計',
    needsReview: `職位「${position || '未填'}」未在實際人力點值規則內`,
  };
}

export function calculateActualStaffPoint(
  record: ActualStaffPointInput,
  businessDays: number
): ActualStaffPointResult {
  const position = record.position || '';
  const status = record.monthly_status || '';
  const stage = calculateStaffStage(position, record.newbie_level);
  const { hours, source } = resolveActualStaffPointHours(record);
  const denominator = businessDays > 0 ? businessDays : toNumber(record.total_days_in_month) || 30;
  const workDays = toNumber(record.work_days);
  const dayRatio = capOne(workDays / denominator);
  const isFullMonth = status === 'full_month';
  const fullMonth = fullMonthBasePoint(position, stage, hours);

  let point = fullMonth.point;
  let rule = fullMonth.rule;
  const reviewNotes = [fullMonth.needsReview].filter(Boolean);

  if (!isFullMonth) {
    if (SENIOR_OR_SPECIALIST_POSITIONS.includes(position)) {
      point = dayRatio;
      rule = '未整月在職：專員以上職等 = 天數 / 當月營業天數，最高 1';
    } else if (position === '新人' && stage === '未過一階') {
      point = 0;
      rule = '未整月在職：新人(未過一階) = 0';
    } else if (position === '行政' && stage === '行政(未過階)') {
      point = 0;
      rule = '未整月在職：行政(未過階) = 0';
    } else if (position === '兼職助理' || position === '兼職專員' || position === '兼職藥師' || position === '兼職藥師專員') {
      point = fullMonth.point;
      rule = `未整月在職：兼職人員沿用實際時數規則；${fullMonth.rule.replace('整月在職：', '')}`;
      reviewNotes.push('需求未明列兼職人員未整月算法，已沿用時數制');
    } else {
      point = fullMonth.point * dayRatio;
      rule = `未整月在職：${fullMonth.rule.replace('整月在職：', '')} × 天數 / 當月營業天數，最高 1`;
      reviewNotes.push('需求未明列此職位未整月算法，已依整月基準點值按天數比例推定');
    }

    if (status && !['new_hire', 'resigned', 'leave_of_absence', 'transferred_in', 'transferred_out', 'leave_return'].includes(status)) {
      reviewNotes.push(`本月狀態「${MONTHLY_STATUS_LABELS[status] || status}」未在需求中明列，已依未整月規則計算`);
    }
  }

  return {
    point: roundPoint(capOne(point)),
    positionName: normalizeMonthlyPosition(record),
    stage,
    statusLabel: MONTHLY_STATUS_LABELS[status] || status,
    scope: isFullMonth ? '整月在職' : '未整月在職',
    adoptedHours: hours,
    adoptedHoursSource: source,
    adoptedWorkDays: workDays,
    businessDays: denominator,
    dayRatio: roundPoint(dayRatio),
    rule,
    needsReview: Array.from(new Set(reviewNotes.filter(Boolean))).join('；'),
  };
}
