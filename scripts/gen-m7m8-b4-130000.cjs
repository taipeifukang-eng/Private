// 產生 DEV SQL 20261112130000_m7m8_b4_asset_transfer_follow（搬單）與其 rollback。
// 兩個第 2 批函式（ga_ws_transfer_confirm_receive、ga_ws_correct_asset_store）以 DEV 當下 pg_get_functiondef 為底，只插入「搬單」呼叫；rollback 還原成原版。
// 用法：node scripts/gen-m7m8-b4-130000.cjs <含原版函式定義的目錄>（目錄內有 ga_ws_transfer_confirm_receive.sql、ga_ws_correct_asset_store.sql）
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const dir = process.argv[2];
const orig = (n) => fs.readFileSync(path.join(dir, n + ".sql"), "utf8").trimEnd();
function rep(src, a, b) { if (!src.includes(a)) throw Error("pattern not found: " + a.slice(0, 60)); if (src.split(a).length !== 2) throw Error("pattern not unique: " + a.slice(0, 60)); return src.replace(a, b); }

let recv = orig("ga_ws_transfer_confirm_receive");
const recvOrig = recv;
recv = rep(recv, "  v_counts jsonb;\nBEGIN", "  v_counts jsonb;\n  v_event uuid;\n  v_moved jsonb;\nBEGIN");
recv = rep(recv, "(v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid));\n  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', t.id, 'status', 'COMPLETED', 'to_store_id', t.to_store_id));",
  "(v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid))\n  RETURNING id INTO v_event;\n  -- 第 4 批 G27（D20、D21）：同一交易內把這項資產的「維修類未結案需求單及其工單」一起轉到新門市（其他類型不搬、舊式工單只列清單）。\n  v_moved := ga_ws_asset_move_open_requests(t.asset_type, t.asset_id, t.from_store_id, t.to_store_id, t.id, v_event, v_uid, 'TRANSFER');\n  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', t.id, 'status', 'COMPLETED', 'to_store_id', t.to_store_id,\n    'moved_request_count', (v_moved->>'moved_request_count')::integer, 'unlinked_work_order_count', (v_moved->>'unlinked_work_order_count')::integer));");
let corr = orig("ga_ws_correct_asset_store");
const corrOrig = corr;
corr = rep(corr, "  v_updated timestamptz;\nBEGIN", "  v_updated timestamptz;\n  v_event uuid;\n  v_moved jsonb;\nBEGIN");
corr = rep(corr, "(v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid));\n  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(\n    'from_store_id', v_from, 'to_store_id', p_to_store_id, 'open_count', (v_counts->>'open_count')::integer, 'updated_at', v_updated));",
  "(v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid))\n  RETURNING id INTO v_event;\n  -- 第 4 批 G27（D21）：更正所屬門市也帶走進行中的維修單。\n  v_moved := ga_ws_asset_move_open_requests(p_type, p_id, v_from, p_to_store_id, NULL, v_event, v_uid, 'CORRECTION');\n  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(\n    'from_store_id', v_from, 'to_store_id', p_to_store_id, 'open_count', (v_counts->>'open_count')::integer, 'updated_at', v_updated,\n    'moved_request_count', (v_moved->>'moved_request_count')::integer, 'unlinked_work_order_count', (v_moved->>'unlinked_work_order_count')::integer));");

const head = fs.readFileSync(path.join(__dirname, "m7m8-b4-130000-body.sql"), "utf8");
const grants = `
REVOKE ALL ON FUNCTION public.ga_ws_asset_unlinked_work_orders(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_asset_move_open_requests(text, uuid, uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_asset_move_preview(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_asset_moved_list(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_asset_move_preview(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_asset_moved_list(uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_transfer_confirm_receive(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_correct_asset_store(text, uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_transfer_confirm_receive(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_correct_asset_store(text, uuid, uuid, text, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
`;
const out = path.join(root, "supabase/workspace-dev");
fs.writeFileSync(path.join(out, "20261112130000_m7m8_b4_asset_transfer_follow.sql"), head + "\n" + recv + ";\n\n" + corr + ";\n" + grants);

const rb = `-- 還原 20261112130000_m7m8_b4_asset_transfer_follow.sql：把「轉移確認收到」與「更正所屬門市」兩個函式還原成第 2 批原版（備份自 套用前的 pg_get_functiondef），並移除搬單新增的函式與資料表。
-- 會刪除：ga_asset_transfer_moved_requests（搬走的單與舊式工單清單紀錄）。已經被搬到新門市的需求單與工單「不會」搬回去（資料本身留在新門市）；需要的話請另行人工處理。
-- 還原前請先備份：CREATE TABLE public.zz_bak_b4_35_moved AS SELECT * FROM public.ga_asset_transfer_moved_requests;
${recvOrig};

${corrOrig};

REVOKE ALL ON FUNCTION public.ga_ws_transfer_confirm_receive(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_correct_asset_store(text, uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_transfer_confirm_receive(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_correct_asset_store(text, uuid, uuid, text, timestamptz) TO authenticated;
DROP FUNCTION IF EXISTS public.ga_ws_asset_moved_list(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_asset_move_preview(text, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_asset_move_open_requests(text, uuid, uuid, uuid, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_asset_unlinked_work_orders(text, uuid, uuid);
DROP TABLE IF EXISTS public.ga_asset_transfer_moved_requests;

NOTIFY pgrst, 'reload schema';
`;
fs.writeFileSync(path.join(out, "20261112130000_m7m8_b4_asset_transfer_follow.rollback.sql"), rb);
console.log("ok");
