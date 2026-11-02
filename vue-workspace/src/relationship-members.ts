// 關係會員頁的純函式（自 Relationships.vue 抽出，供單元測試與頁面共用）。
// 規則對應舊版 app/store/relationship-members/RelationshipMembersClient.tsx 的 filteredMembers 與 FKRS 最後一號。

export type RelationshipMemberLike = {
  member_name?: string | null;
  phone?: string | null;
  relationship?: string | null;
  member_number?: string | null;
  is_approved?: boolean | null;
  rejected_at?: string | null;
  creator?: { full_name?: string | null; email?: string | null } | null;
};

export const RELATIONSHIP_PAGE_SIZE = 50;

export const relationshipFilters = [
  { key: "all", label: "全部" },
  { key: "approved_missing_number", label: "待填寫(已核可)" },
  { key: "pending", label: "待核可" },
  { key: "rejected", label: "已駁回" },
] as const;

export function matchesRelationshipFilter(m: RelationshipMemberLike, key: string): boolean {
  if (key === "all") return true;
  if (key === "approved_missing_number") return !!m.is_approved && !m.member_number?.trim();
  if (key === "pending") return !m.is_approved && !m.rejected_at;
  return !!m.rejected_at;
}

export function filterRelationshipMembers<T extends RelationshipMemberLike>(members: T[], filter: string, search: string): T[] {
  const needle = search.trim().toLowerCase();
  return members.filter(
    (m) =>
      matchesRelationshipFilter(m, filter) &&
      [m.member_name, m.phone, m.relationship, m.member_number, m.creator?.full_name].some((v) =>
        String(v || "").toLowerCase().includes(needle),
      ),
  );
}

export function relationshipPageCount(total: number, size = RELATIONSHIP_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** 目前最後一個 FKRS 會員編號（依數字大小）；沒有時回傳「尚無 FKRS 編號」。 */
export function lastFkrsNumber(members: RelationshipMemberLike[]): string {
  return (
    members
      .map((m) => m.member_number || "")
      .filter((n) => /^FKRS\d+$/i.test(n))
      .sort((a, b) => Number(b.slice(4)) - Number(a.slice(4)))[0] || "尚無 FKRS 編號"
  );
}
