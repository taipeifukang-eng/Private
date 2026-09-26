const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function yearMonth(date) {
  return String(date || '').slice(0, 7);
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeLevel(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.includes('二階')) return '二階新人';
  if (text.includes('一階')) return '一階新人';
  if (text.includes('未過')) return '未過階新人';
  return text;
}

function extractNewbieLevel(row) {
  const valueLevel = normalizeLevel(row.new_value);
  if (valueLevel === '一階新人' || valueLevel === '二階新人') return valueLevel;
  const notes = String(row.notes || '');
  const direct = notes.match(/(?:新人等級|新人階級|階級|階段|newbie_level)\s*[:：]\s*([^；,\n]+)/i);
  const directLevel = normalizeLevel(direct?.[1]);
  if (directLevel) return directLevel;
  const anyLevel = normalizeLevel(notes);
  if (anyLevel && anyLevel !== notes.trim()) return anyLevel;
  return null;
}

function isNewbiePromotion(row) {
  const value = String(row.new_value || '').trim();
  return value === '新人' || value === '一階新人' || value === '二階新人';
}

function levelRank(value) {
  const level = normalizeLevel(value);
  if (level === '二階新人') return 2;
  if (level === '一階新人') return 1;
  if (level === '未過階新人') return 0;
  return -1;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const envFileArg = process.argv.find((arg) => arg.startsWith('--env-file='));
  const envFile = envFileArg ? envFileArg.slice('--env-file='.length) : '.env.production.local';
  loadEnvFile(path.resolve(root, envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.production.local');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const apply = process.argv.includes('--apply');
  const summaryOnly = process.argv.includes('--summary-only');
  const fromDate = '2026-01-01';
  const toDate = '2026-08-31';
  const fromMonth = '2026-01';
  const toMonth = '2026-08';

  const { data: movements, error: movementError } = await supabase
    .from('employee_movement_history')
    .select('id, employee_code, employee_name, store_id, movement_type, movement_date, new_value, old_value, notes, created_at')
    .eq('movement_type', 'promotion')
    .gte('movement_date', fromDate)
    .lte('movement_date', toDate)
    .order('movement_date', { ascending: true })
    .order('created_at', { ascending: true });

  if (movementError) throw new Error(`查詢新人升階異動失敗：${movementError.message}`);

  const normalizedMovements = (movements || [])
    .map((row) => ({
      ...row,
      employee_code: normalizeCode(row.employee_code),
      expected_level: extractNewbieLevel(row),
      effective_month: yearMonth(row.movement_date),
    }));

  const inferredNewbieCounts = new Map();
  const candidateMovements = normalizedMovements
    .filter((row) => row.employee_code && isNewbiePromotion(row))
    .map((row) => {
      if (row.expected_level === '一階新人' || row.expected_level === '二階新人') return row;
      const count = (inferredNewbieCounts.get(row.employee_code) || 0) + 1;
      inferredNewbieCounts.set(row.employee_code, count);
      return {
        ...row,
        expected_level: count >= 2 ? '二階新人' : '一階新人',
        inferred_level: true,
      };
    });

  const skipped = normalizedMovements
    .filter((row) => !isNewbiePromotion(row))
    .map((row) => ({
      employee_code: normalizeCode(row.employee_code),
      employee_name: row.employee_name,
      movement_date: row.movement_date,
      new_value: row.new_value,
      notes: row.notes,
      parsed_level: row.expected_level,
    }));

  const employeeCodes = Array.from(new Set(candidateMovements.map((row) => row.employee_code)));

  let monthlyRows = [];
  if (employeeCodes.length > 0) {
    const { data, error } = await supabase
      .from('monthly_staff_status')
      .select('id, year_month, store_id, employee_code, employee_name, position, newbie_level')
      .in('employee_code', employeeCodes)
      .gte('year_month', fromMonth)
      .lte('year_month', toMonth)
      .order('year_month', { ascending: true });
    if (error) throw new Error(`查詢每月人員狀態失敗：${error.message}`);
    monthlyRows = data || [];
  }

  const movementsByEmployee = new Map();
  for (const movement of normalizedMovements.filter((row) => row.employee_code)) {
    const list = movementsByEmployee.get(movement.employee_code) || [];
    list.push(movement);
    movementsByEmployee.set(movement.employee_code, list);
  }

  const changes = [];
  const missingMonthlyRows = [];

  for (const row of monthlyRows) {
    const code = normalizeCode(row.employee_code);
    const promos = movementsByEmployee.get(code) || [];
    const latestPromotion = promos
      .filter((promo) => promo.effective_month <= row.year_month)
      .sort((a, b) => {
        const byDate = String(b.movement_date).localeCompare(String(a.movement_date));
        if (byDate !== 0) return byDate;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      })[0];
    if (!latestPromotion || !isNewbiePromotion(latestPromotion)) continue;
    const effective = candidateMovements.find((movement) => movement.id === latestPromotion.id) || latestPromotion;
    if (levelRank(row.newbie_level) > levelRank(effective.expected_level)) continue;
    if (String(row.position || '').trim() === '新人' && String(row.newbie_level || '').trim() === effective.expected_level) continue;
    changes.push({
      monthly_staff_status_id: row.id,
      year_month: row.year_month,
      employee_code: code,
      employee_name: row.employee_name,
      old_position: row.position,
      old_newbie_level: row.newbie_level,
      new_position: '新人',
      new_newbie_level: effective.expected_level,
      movement_date: effective.movement_date,
      movement_id: effective.id,
      movement_notes: effective.notes,
      inferred_level: Boolean(effective.inferred_level),
    });
  }

  for (const movement of candidateMovements) {
    const hasEffectiveMonth = monthlyRows.some((row) =>
      normalizeCode(row.employee_code) === movement.employee_code && row.year_month === movement.effective_month
    );
    if (!hasEffectiveMonth) {
      missingMonthlyRows.push({
        employee_code: movement.employee_code,
        employee_name: movement.employee_name,
        effective_month: movement.effective_month,
        movement_date: movement.movement_date,
        expected_level: movement.expected_level,
      });
    }
  }

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    env_file: envFile,
    movement_count: movements?.length || 0,
    parsed_candidate_count: candidateMovements.length,
    change_count: changes.length,
    missing_effective_monthly_row_count: missingMonthlyRows.length,
  };

  if (summaryOnly) {
    report.changes = changes.map((change) => ({
      year_month: change.year_month,
      employee_code: change.employee_code,
      employee_name: change.employee_name,
      old_position: change.old_position,
      old_newbie_level: change.old_newbie_level,
      new_position: change.new_position,
      new_newbie_level: change.new_newbie_level,
      movement_date: change.movement_date,
      inferred_level: change.inferred_level,
    }));
  } else {
    report.skipped_without_parseable_level = skipped;
    report.missing_effective_monthly_rows = missingMonthlyRows;
    report.changes = changes;
  }

  console.log(JSON.stringify(report, null, 2));

  if (!apply || changes.length === 0) return;

  const updated = [];
  for (const change of changes) {
    const { data, error } = await supabase
      .from('monthly_staff_status')
      .update({
        position: change.new_position,
        newbie_level: change.new_newbie_level,
        updated_at: new Date().toISOString(),
      })
      .eq('id', change.monthly_staff_status_id)
      .select('id, year_month, employee_code, employee_name, position, newbie_level')
      .single();
    if (error) throw new Error(`更新 ${change.employee_code} ${change.year_month} 失敗：${error.message}`);
    updated.push(data);
  }

  console.log(JSON.stringify({ updated_count: updated.length, updated }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
