// /api/workspace/general-affairs/** 的分派。權限、驗證、資料規則都在各模組；這裡只負責把路徑對到處理函式。
import { NextRequest } from "next/server";
import { categoryPermissions, gaFlags, GA_CENTER_CODES, dbCan, isStoreManagerRole, type CategoryType } from "./access";
import { equipmentApi, facilitiesApi } from "./assets";
import { assetImportApi } from "./asset-import";
import { attachmentsApi } from "./attachments";
import { categoriesApi } from "./categories";
import { maintenanceApi } from "./history";
import { isStoreMember } from "./members";
import { onboardingApi } from "./onboarding";
import { partsApi } from "./parts";
import { sitesApi } from "./pickers";
import { qrApi } from "./qr";
import { scanApi } from "./scan";
import { compatApi, templatesApi, unlinkedEquipment } from "./templates";
import { transfersApi } from "./transfers";
import { GaError, respond, type Context } from "./server";

export async function dispatch(ctx: Context, request: NextRequest, segments: string[]) {
  const [head, ...rest] = segments;
  switch (head) {
    case "access": {
      // 目前登入者在總務服務中心的可見旗標（與 /api/workspace/session 的 capabilities 同一套規則）與資料庫端實際可操作旗標。
      const flags = gaFlags(ctx.has, isStoreManagerRole(ctx.roleCodes), await isStoreMember(ctx));
      const cat = (t: CategoryType) => categoryPermissions(t, ctx.permissions);
      return respond({
        flags,
        actual: {
          center: dbCan(ctx.permissions, ...GA_CENTER_CODES),
          categories: { equipment: cat("equipment"), facility: cat("facility"), part: cat("part") },
        },
      });
    }
    case "categories":
      return categoriesApi(ctx, request, rest);
    case "parts":
      return partsApi(ctx, request, rest);
    case "templates":
      return templatesApi(ctx, request, rest);
    case "unlinked-equipment":
      if (request.method !== "GET") throw new GaError(405, "不支援的操作");
      return unlinkedEquipment(ctx, new URL(request.url));
    case "compat":
      return compatApi(ctx, request);
    case "attachments":
      return attachmentsApi(ctx, request, rest);
    case "equipment":
      return equipmentApi(ctx, request, rest);
    case "facilities":
      return facilitiesApi(ctx, request, rest);
    case "asset-maintenance":
      return maintenanceApi(ctx, request, rest);
    case "onboarding":
      return onboardingApi(ctx, request, rest);
    case "asset-import":
      return assetImportApi(ctx, request, rest);
    case "transfers":
      return transfersApi(ctx, request, rest);
    case "qr":
      return qrApi(ctx, request, rest);
    case "assets":
      return scanApi(ctx, request, rest);
    case "sites":
      return sitesApi(ctx, request);
    default:
      throw new GaError(404, "找不到這個功能");
  }
}
