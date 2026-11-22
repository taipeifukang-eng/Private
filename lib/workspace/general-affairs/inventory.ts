// /api/workspace/general-affairs/inventory/** 的分派：G11 位置與料件設定、G12 餘額／流水／過帳／持有狀態、G13 調撥單。
import { NextRequest } from "next/server";
import { locationsApi } from "./inventory-locations";
import { stockApi } from "./inventory-stock";
import { transfersApi } from "./inventory-transfers";
import { GaError, type Context } from "./server";

export async function inventoryApi(ctx: Context, request: NextRequest, rest: string[]) {
  const [head, ...tail] = rest;
  if (head === "locations") return locationsApi(ctx, request, tail);
  if (head === "transfers") return transfersApi(ctx, request, tail);
  if (head === "access" || head === "options" || head === "balances" || head === "transactions" || head === "holding") return stockApi(ctx, request, head, tail);
  throw new GaError(404, "找不到這個功能");
}
