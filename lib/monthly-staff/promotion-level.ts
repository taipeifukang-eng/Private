export function getPromotionLevelFromNotes(notes: string | null | undefined) {
  const match = String(notes || '').match(/(?:新人等級|行政階級)[:：]([^；\n]+)/);
  return match?.[1]?.trim() || null;
}

export function formatPromotionPosition(position: string | null | undefined, notes: string | null | undefined) {
  const value = String(position || '').trim();
  if (value === '代理店長') return '代理店長（暫代職務）';
  if (!['新人', '行政'].includes(value)) return value;

  const level = getPromotionLevelFromNotes(notes);
  if (!level) return `${value}（${value === '新人' ? '階段' : '階級'}未記錄）`;

  const shortLevel = value === '新人' ? level.replace(/新人$/, '') : level.replace(/行政$/, '');
  return `${value}（${shortLevel}）`;
}

export function getMovementNotesForDisplay(notes: string | null | undefined) {
  return String(notes || '')
    .split('；')
    .map((part) => part.trim())
    .filter((part) => part && !/^(新人等級|行政階級)[:：]/.test(part))
    .join('；');
}
