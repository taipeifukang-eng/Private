// 由第 4 批備份（pg_get_functiondef）產生 20261117105000_m7m8_b5_request_supplement_sync.sql 與正式區草稿 38：
// 只改三處（W1 補資料兩邊同步；送門市確認改呼叫與工單端共用的內部函式），其餘逐字不動。每個取代都斷言恰好命中一次。
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const backup = fs.readFileSync(path.join(root, "supabase/workspace-dev/_backup/20261117_b4_req_functions_before_b5.sql"), "utf8");
const parts = backup.split(/\n(?=CREATE OR REPLACE FUNCTION )/).filter((p) => p.startsWith("CREATE OR REPLACE FUNCTION "));
const find = (name) => {
  const p = parts.find((x) => x.startsWith(`CREATE OR REPLACE FUNCTION public.${name}(`));
  if (!p) throw Error(`備份找不到 ${name}`);
  return p.replace(/\r\n/g, "\n").replace(/\nNOTIFY pgrst[^\n]*\n?$/, "").trimEnd();
};
function replaceOnce(text, from, to, what) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw Error(`${what}：預期命中 1 次，實際 ${n} 次`);
  return text.replace(from, () => to);
}
let tr = find("ga_ws_req_transition");
const lines = tr.split("\n");
const s = lines.findIndex((l) => l === "      IF v_req.maintenance_request_id IS NOT NULL THEN");
if (s < 0 || !lines[s + 1].includes("SELECT * INTO v_wo FROM public.maintenance_requests")) throw Error("找不到送確認的工單區塊");
let e = s;
while (!(lines[e] === "      END IF;" && lines[e - 1] === "        END IF;")) e += 1;
lines.splice(s, e - s + 1,
  "      IF v_req.maintenance_request_id IS NOT NULL THEN",
  "        -- 第 5 批：與工單端「送門市確認」共用同一個內部函式（單一邏輯）。",
  "        PERFORM public.ga_wo_apply_completion_request(v_req.maintenance_request_id, v_uid, v_progress, 'ga_service_request_workspace');",
  "      END IF;");
tr = lines.join("\n");
tr = replaceOnce(tr,
  "supplement_note = v_note, public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;\n    ELSIF v_a = 'update_progress' THEN",
  "supplement_note = v_note, public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;\n" +
  "      -- 第 5 批（W1）：連結的維修工單同步進「等待門市補充資料」（公開），門市回覆後兩邊一起往下。\n" +
  "      IF v_req.maintenance_request_id IS NOT NULL THEN\n" +
  "        PERFORM public.ga_wo_apply_supplement_request(v_req.maintenance_request_id, v_uid, v_why, v_rlabel, v_note, 'ga_service_request_workspace');\n" +
  "      END IF;\n    ELSIF v_a = 'update_progress' THEN",
  "transition request_supplement");
let sa = find("ga_ws_req_store_action");
sa = replaceOnce(sa, "    -- 同步料件處理單。\n",
  "    -- 第 5 批（W1）：補資料回覆 → 連結的維修工單回到「初步評估」（處理中），需求單已在上面進「待總務複核」。\n" +
  "    IF v_a = 'submit_supplement' AND v_req.maintenance_request_id IS NOT NULL THEN\n" +
  "      PERFORM public.ga_wo_apply_supplement_reply(v_req.maintenance_request_id, v_uid, v_note, v_proxy, 'ga_service_request_store_action');\n" +
  "    END IF;\n    -- 同步料件處理單。\n", "store_action");
const header = (n) => `-- M7/M8 第 5 批 B（W1 補資料兩邊同步）：覆蓋第 4 批 ga_ws_req_transition（request_supplement 與 request_store_confirmation 分支）與 ga_ws_req_store_action（submit_supplement 分支）。
-- 只多三處呼叫第 5 批內部函式（其餘逐字不動，與第 4 批備份逐行比對）：
--   1. request_supplement：需求單進「待門市補資料」時，連結的維修工單同交易進「等待門市補充資料」（ga_wo_apply_supplement_request）。
--   2. request_store_confirmation：送門市確認改呼叫與工單端共用的 ga_wo_apply_completion_request（取代原本內嵌的工單更新，單一邏輯）。
--   3. submit_supplement：門市回覆補資料時，連結的維修工單回到「初步評估」（ga_wo_apply_supplement_reply）；需求單照原本進「待總務複核」。
-- 先決：20261117100000_m7m8_b5_work_order_rules。還原：${n}（內容是套用前的第 4 批原定義；備份在 supabase/workspace-dev/_backup/）。可重複執行。

DO $$
BEGIN
  IF to_regprocedure('public.ga_wo_apply_completion_request(uuid,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用 20261117100000_m7m8_b5_work_order_rules';
  END IF;
END $$;

`;
const footer = "\n\nNOTIFY pgrst, 'reload schema';\n";
const out = (name) => header(name) + tr + ";\n\n" + sa + ";" + footer;
fs.writeFileSync(path.join(root, "supabase/workspace-dev/20261117105000_m7m8_b5_request_supplement_sync.sql"), out("20261117105000_m7m8_b5_request_supplement_sync.rollback.sql"));
const rb = `-- 還原 20261117105000_m7m8_b5_request_supplement_sync.sql：把 ga_ws_req_transition、ga_ws_req_store_action 還原成第 4 批原定義（套用前的 pg_get_functiondef 備份）。
-- 還原後補資料不再同步工單、送門市確認又回到內嵌的工單更新（行為與第 4 批相同）。
` + backup.replace(/^--[^\n]*\n--[^\n]*\n\n/, "");
fs.writeFileSync(path.join(root, "supabase/workspace-dev/20261117105000_m7m8_b5_request_supplement_sync.rollback.sql"), rb);
console.log("ok", tr.length, sa.length);
