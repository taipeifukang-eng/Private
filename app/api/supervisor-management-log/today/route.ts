import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canViewSupervisorManagementLog } from '@/lib/supervisor-management-log/access';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '今日管理工作台資料載入失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

function isDateString(value: string | null) {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function bucketFollowUp(date: string | null, today: string) {
  if (!date) return 'upcoming';
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return 'upcoming';
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canViewSupervisorManagementLog(user.id)) return jsonError('沒有督導管理日誌查看權限', 403);

    const { searchParams } = new URL(request.url);
    const requestedDate = searchParams.get('date');
    const today = isDateString(requestedDate)
      ? requestedDate!
      : new Date().toISOString().slice(0, 10);
    const upcomingEndDate = addDays(today, 7);

    const [plansResult, recordsResult, casesResult] = await Promise.all([
      supabase
        .from('supervisor_management_daily_plans')
        .select(`
          id,
          plan_date,
          owner_user_id,
          target_type,
          store_id,
          employee_id,
          target_name_snapshot,
          category_id,
          title,
          status,
          started_at,
          completed_at,
          linked_case_id,
          linked_record_id,
          notes,
          created_at,
          updated_at,
          category:supervisor_management_categories(id, code, name),
          store:stores(id, store_code, store_name, short_name),
          employee:store_employees(id, employee_code, employee_name, current_position, position)
        `)
        .eq('plan_date', today)
        .is('deleted_at', null)
        .order('status', { ascending: true })
        .order('updated_at', { ascending: false }),
      supabase
        .from('supervisor_management_records')
        .select(`
          id,
          case_id,
          record_type,
          record_date,
          store_id,
          employee_id,
          category_id,
          target_name_snapshot,
          observation,
          judgment,
          action_summary,
          action_options,
          requires_follow_up,
          follow_up_date,
          expected_result,
          follow_up_method,
          created_at,
          updated_at,
          case:supervisor_management_cases(id, case_no, title, status, priority, next_follow_up_at)
        `)
        .eq('record_date', today)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('supervisor_management_cases')
        .select(`
          id,
          case_no,
          title,
          target_type,
          store_id,
          employee_id,
          target_name_snapshot,
          status,
          priority,
          next_follow_up_at,
          summary,
          updated_at,
          store:stores(id, store_code, store_name, short_name),
          employee:store_employees(id, employee_code, employee_name, current_position, position)
        `)
        .is('deleted_at', null)
        .not('next_follow_up_at', 'is', null)
        .lte('next_follow_up_at', upcomingEndDate)
        .not('status', 'in', '(CLOSED,CANCELLED)')
        .order('next_follow_up_at', { ascending: true }),
    ]);

    if (plansResult.error) throw plansResult.error;
    if (recordsResult.error) throw recordsResult.error;
    if (casesResult.error) throw casesResult.error;

    const plans = plansResult.data || [];
    const todayRecords = recordsResult.data || [];
    const followUpCases = casesResult.data || [];
    const caseIds = followUpCases.map((item) => item.id);

    let latestRecordsByCase = new Map<string, unknown>();
    if (caseIds.length > 0) {
      const { data: latestRecords, error: latestRecordsError } = await supabase
        .from('supervisor_management_records')
        .select('id, case_id, record_date, observation, judgment, action_summary, follow_up_date, expected_result, created_at')
        .in('case_id', caseIds)
        .is('deleted_at', null)
        .order('record_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (latestRecordsError) throw latestRecordsError;

      latestRecordsByCase = new Map(
        (latestRecords || [])
          .filter((record, index, records) => records.findIndex((candidate) => candidate.case_id === record.case_id) === index)
          .map((record) => [record.case_id, record]),
      );
    }

    const followUpQueue = followUpCases.map((item) => ({
      ...item,
      bucket: bucketFollowUp(item.next_follow_up_at, today),
      latest_record: latestRecordsByCase.get(item.id) || null,
    }));

    const planSummary = plans.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});

    const followUpSummary = followUpQueue.reduce<Record<string, number>>((acc, item) => {
      acc[item.bucket] = (acc[item.bucket] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({
      success: true,
      data: {
        date: today,
        plans,
        followUpQueue,
        todayRecords,
        summary: {
          plans: {
            total: plans.length,
            planned: planSummary.PLANNED || 0,
            inProgress: planSummary.IN_PROGRESS || 0,
            done: planSummary.DONE || 0,
            cancelled: planSummary.CANCELLED || 0,
          },
          followUps: {
            total: followUpQueue.length,
            overdue: followUpSummary.overdue || 0,
            today: followUpSummary.today || 0,
            upcoming: followUpSummary.upcoming || 0,
          },
          records: {
            total: todayRecords.length,
          },
        },
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
