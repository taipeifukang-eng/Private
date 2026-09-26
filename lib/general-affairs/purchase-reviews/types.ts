export const PURCHASE_REVIEW_DECISIONS = ['REJECT', 'STOCK_ISSUE', 'TRANSFER', 'PURCHASE', 'SUBSTITUTE'] as const;

export type PurchaseReviewDecision = typeof PURCHASE_REVIEW_DECISIONS[number];

export type PurchaseReviewPayload = {
  decision: PurchaseReviewDecision;
  vendorId: string | null;
  vendorName: string | null;
  approvedQuantity: number | null;
  approvedUnit: string | null;
  estimatedAmount: number | null;
  quotedAmount: number | null;
  negotiatedAmount: number | null;
  finalAmount: number | null;
  expectedDeliveryDate: string | null;
  deliveryMethod: string | null;
  receivingLocationId: string | null;
  substituteDescription: string | null;
  decisionNote: string;
  publicNote: string | null;
  quoteLeadTimeDays: number | null;
  quoteNotes: string | null;
};
