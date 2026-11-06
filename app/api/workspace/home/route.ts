import { context, failed, respond } from "@/lib/workspace/server";
import { loadHome } from "@/lib/workspace/home";
export const dynamic = "force-dynamic";
/** M3 W11 登入首頁聚合。登入即可讀（舊版首頁沒有頁面權限）；各卡片的可見對象在 loadHome 內判斷。 */
export async function GET() {
  try {
    const ctx = await context();
    return respond(await loadHome(ctx));
  } catch (e) {
    return failed(e);
  }
}
