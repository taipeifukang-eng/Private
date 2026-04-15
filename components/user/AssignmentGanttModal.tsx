'use client';

import { useMemo } from 'react';
import { CalendarRange, CheckCircle2, Clock3, Users, X } from 'lucide-react';
import type { Assignment, DepartmentSection, Log, Profile, Template, WorkflowStep } from '@/types/workflow';

interface AssignmentGanttModalProps {
  assignment: Assignment & {
    template: Pick<Template, 'title' | 'steps_schema' | 'sections'>;
    collaborators?: Profile[];
    logs?: Log[];
  };
  onClose: () => void;
}

interface GanttItem {
  id: string;
  label: string;
  weekStartIndex: number;
  weekEndIndex: number;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  status: 'completed' | 'in_progress' | 'pending';
  isSubStep: boolean;
}

interface GanttSection {
  id: string;
  department: string;
  assignedUsers: string[];
  items: GanttItem[];
}

function startOfWeek(dateInput: string) {
  const date = new Date(dateInput);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatWeekRange(date: Date) {
  const end = new Date(date);
  end.setDate(end.getDate() + 6);
  const startText = `${date.getMonth() + 1}/${date.getDate()}`;
  const endText = `${end.getMonth() + 1}/${end.getDate()}`;
  return `${startText}-${endText}`;
}

function diffWeeksInclusive(startInput: string, endInput: string) {
  const start = startOfWeek(startInput);
  const end = startOfWeek(endInput);
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function getWeekOffset(baseStart: string, targetDate: string) {
  return diffWeeksInclusive(baseStart, targetDate) - 1;
}

function flattenSteps(steps: WorkflowStep[]) {
  const items: Array<{
    id: string;
    label: string;
    isSubStep: boolean;
    plannedStartDate?: string | null;
    plannedEndDate?: string | null;
  }> = [];

  steps.forEach((step) => {
    items.push({
      id: step.id,
      label: step.label,
      isSubStep: false,
      plannedStartDate: step.planned_start_date || null,
      plannedEndDate: step.planned_end_date || null,
    });
    (step.subSteps || []).forEach((subStep) => {
      items.push({
        id: subStep.id,
        label: subStep.label,
        isSubStep: true,
        plannedStartDate: subStep.planned_start_date || null,
        plannedEndDate: subStep.planned_end_date || null,
      });
    });
  });

  return items;
}

function buildCheckedStepIds(logs: Log[]) {
  const checked = new Set<string>();
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  sortedLogs.forEach((log) => {
    if (log.step_id === null || log.step_id === undefined) return;
    const stepId = String(log.step_id);
    if (log.action === 'complete') checked.add(stepId);
    if (log.action === 'uncomplete') checked.delete(stepId);
  });

  return checked;
}

function getStatusClass(status: GanttItem['status']) {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'in_progress':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

export default function AssignmentGanttModal({ assignment, onClose }: AssignmentGanttModalProps) {
  const hasPlannedRange = Boolean(
    assignment.planned_start_date &&
    assignment.planned_end_date &&
    assignment.planned_start_date <= assignment.planned_end_date
  );

  const collaboratorMap = useMemo(() => {
    const map = new Map<string, string>();
    (assignment.collaborators || []).forEach((collaborator) => {
      map.set(collaborator.id, collaborator.full_name || collaborator.email || '未命名成員');
    });
    return map;
  }, [assignment.collaborators]);

  const stepPlannedRange = useMemo(() => {
    const rawSections: DepartmentSection[] = assignment.template.sections && assignment.template.sections.length > 0
      ? assignment.template.sections
      : [
          {
            id: 'default-section',
            department: assignment.department || '未分部門',
            assigned_users: (assignment.collaborators || []).map((collaborator) => collaborator.id),
            steps: assignment.template.steps_schema || [],
          },
        ];

    const dates = rawSections
      .flatMap((section) => flattenSteps(section.steps || []))
      .flatMap((item) => [item.plannedStartDate, item.plannedEndDate])
      .filter((value): value is string => Boolean(value));

    if (dates.length === 0) return null;

    const sorted = [...dates].sort();
    return {
      start: sorted[0],
      end: sorted[sorted.length - 1],
    };
  }, [assignment.collaborators, assignment.department, assignment.template.sections, assignment.template.steps_schema]);

  const timelineStartDate = useMemo(() => {
    if (hasPlannedRange && assignment.planned_start_date) return assignment.planned_start_date;
    if (stepPlannedRange?.start) return stepPlannedRange.start;
    return assignment.created_at;
  }, [assignment.created_at, assignment.planned_start_date, hasPlannedRange, stepPlannedRange]);

  const timelineEndDate = useMemo(() => {
    if (hasPlannedRange && assignment.planned_end_date) return assignment.planned_end_date;
    if (stepPlannedRange?.end) return stepPlannedRange.end;
    return null;
  }, [assignment.planned_end_date, hasPlannedRange, stepPlannedRange]);

  const totalWeeks = useMemo(() => {
    if (timelineStartDate && timelineEndDate && timelineStartDate <= timelineEndDate) {
      return Math.max(1, diffWeeksInclusive(timelineStartDate, timelineEndDate));
    }
    return 1;
  }, [timelineEndDate, timelineStartDate]);

  const ganttSections = useMemo(() => {
    const checkedStepIds = buildCheckedStepIds(assignment.logs || []);
    const rawSections: DepartmentSection[] = assignment.template.sections && assignment.template.sections.length > 0
      ? assignment.template.sections
      : [
          {
            id: 'default-section',
            department: assignment.department || '未分部門',
            assigned_users: (assignment.collaborators || []).map((collaborator) => collaborator.id),
            steps: assignment.template.steps_schema || [],
          },
        ];

    return rawSections
      .map((section) => {
        const flatItems = flattenSteps(section.steps || []);
        const firstPendingIndex = flatItems.findIndex((item) => !checkedStepIds.has(item.id));
        const scheduledWeeks = Math.max(1, totalWeeks);

        const items: GanttItem[] = flatItems.map((item, index) => ({
          ...item,
          weekStartIndex:
            item.plannedStartDate && timelineStartDate
              ? Math.min(
                  scheduledWeeks - 1,
                  Math.max(0, getWeekOffset(timelineStartDate, item.plannedStartDate))
                )
              : flatItems.length <= 1
                ? 0
                : Math.min(scheduledWeeks - 1, Math.floor((index * scheduledWeeks) / flatItems.length)),
          weekEndIndex:
            item.plannedStartDate && item.plannedEndDate && timelineStartDate
              ? Math.min(
                  scheduledWeeks - 1,
                  Math.max(
                    Math.max(0, getWeekOffset(timelineStartDate, item.plannedStartDate)),
                    getWeekOffset(timelineStartDate, item.plannedEndDate)
                  )
                )
              : item.plannedStartDate && timelineStartDate
                ? Math.min(
                    scheduledWeeks - 1,
                    Math.max(0, getWeekOffset(timelineStartDate, item.plannedStartDate))
                  )
                : flatItems.length <= 1
                  ? 0
                  : Math.min(scheduledWeeks - 1, Math.floor((index * scheduledWeeks) / flatItems.length)),
          status: checkedStepIds.has(item.id)
            ? 'completed'
            : firstPendingIndex === index
              ? 'in_progress'
              : 'pending',
        }));

        return {
          id: section.id,
          department: section.department || '未分部門',
          assignedUsers: (section.assigned_users || []).map((userId) => collaboratorMap.get(userId) || '未指定'),
          items,
        } satisfies GanttSection;
      })
      .filter((section) => section.items.length > 0);
  }, [assignment.collaborators, assignment.department, assignment.logs, assignment.template.sections, assignment.template.steps_schema, collaboratorMap, timelineStartDate, totalWeeks]);

  const weekHeaders = useMemo(() => {
    const firstWeek = startOfWeek(timelineStartDate);
    return Array.from({ length: totalWeeks }, (_, index) => {
      const weekStart = new Date(firstWeek);
      weekStart.setDate(weekStart.getDate() + index * 7);
      return {
        label: `第 ${index + 1} 週`,
        range: formatWeekRange(weekStart),
      };
    });
  }, [timelineStartDate, totalWeeks]);

  const totalItems = ganttSections.reduce((sum, section) => sum + section.items.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-5">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <CalendarRange className="text-blue-600" />
              任務甘特圖
            </h2>
            <p className="mt-1 text-sm text-gray-600">{assignment.template.title}．以每週為單位自動生成跨部門任務排程</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="關閉甘特圖"
          >
            <X size={22} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 border-b border-gray-200 bg-gray-50 px-6 py-4 lg:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">總部門數</div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{ganttSections.length}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">任務節點數</div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{totalItems}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-sm text-gray-500">時間軸週數</div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{totalWeeks}</div>
          </div>
        </div>

        <div className="border-b border-gray-200 bg-white px-6 py-4 text-sm text-gray-600">
          {hasPlannedRange ? (
            <span>預計時程：{assignment.planned_start_date} 至 {assignment.planned_end_date}</span>
          ) : stepPlannedRange ? (
            <span>步驟預計時程：{stepPlannedRange.start} 至 {stepPlannedRange.end}</span>
          ) : (
            <span>尚未設定預計時程，甘特圖以任務建立週為起點自動推算。</span>
          )}
        </div>

        <div className="overflow-auto px-6 py-5">
          {ganttSections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center text-gray-500">
              此任務尚無可生成甘特圖的步驟內容
            </div>
          ) : (
            <div className="min-w-[1100px] overflow-hidden rounded-2xl border border-gray-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="w-[260px] border-b border-r border-gray-200 px-4 py-3 text-left font-semibold text-gray-700">部門 / 成員</th>
                    <th className="w-[220px] border-b border-r border-gray-200 px-4 py-3 text-left font-semibold text-gray-700">任務內容</th>
                    {weekHeaders.map((week) => (
                      <th key={week.label} className="min-w-[140px] border-b border-r border-gray-200 px-3 py-3 text-center font-semibold text-gray-700 last:border-r-0">
                        <div>{week.label}</div>
                        <div className="mt-1 text-xs font-normal text-gray-500">{week.range}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ganttSections.map((section) =>
                    section.items.map((item, itemIndex) => (
                      <tr key={`${section.id}-${item.id}`} className="bg-white align-top">
                        {itemIndex === 0 && (
                          <td rowSpan={section.items.length} className="border-r border-t border-gray-200 bg-gray-50 px-4 py-4">
                            <div className="font-semibold text-gray-900">{section.department}</div>
                            <div className="mt-3 flex items-start gap-2 text-xs text-gray-600">
                              <Users size={14} className="mt-0.5 text-gray-400" />
                              <div className="flex flex-wrap gap-2">
                                {section.assignedUsers.length > 0 ? (
                                  section.assignedUsers.map((userName, idx) => (
                                    <span key={`${section.id}-user-${idx}`} className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                                      {userName}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-gray-400">未指定執行人員</span>
                                )}
                              </div>
                            </div>
                          </td>
                        )}
                        <td className="border-r border-t border-gray-200 px-4 py-3">
                          <div className={item.isSubStep ? 'pl-4' : ''}>
                            <div className="font-medium text-gray-900">{item.label}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              {item.status === 'completed' ? (
                                <CheckCircle2 size={14} className="text-green-600" />
                              ) : (
                                <Clock3 size={14} className={item.status === 'in_progress' ? 'text-blue-600' : 'text-gray-400'} />
                              )}
                              <span className={item.status === 'completed' ? 'text-green-700' : item.status === 'in_progress' ? 'text-blue-700' : 'text-gray-500'}>
                                {item.status === 'completed' ? '已完成' : item.status === 'in_progress' ? '進行中' : '待執行'}
                              </span>
                            </div>
                            {(item.plannedStartDate || item.plannedEndDate) && (
                              <div className="mt-1 text-xs text-purple-600">
                                預計：{item.plannedStartDate || '未設定'} 至 {item.plannedEndDate || '未設定'}
                              </div>
                            )}
                          </div>
                        </td>
                        {weekHeaders.map((week, weekIndex) => (
                          <td key={`${section.id}-${item.id}-${week.label}`} className="border-r border-t border-gray-200 px-2 py-2 last:border-r-0">
                            {weekIndex >= item.weekStartIndex && weekIndex <= item.weekEndIndex ? (
                              <div className={`rounded-lg border px-3 py-3 text-xs font-medium ${getStatusClass(item.status)}`}>
                                {weekIndex === item.weekStartIndex ? item.label : ''}
                              </div>
                            ) : <div className="h-11 rounded-lg bg-gray-50"></div>}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}