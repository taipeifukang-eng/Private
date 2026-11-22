# 差異確認頁工具

把白名單（`tests/parity/allowlist.json`）裡「待確認」的新舊差異，做成一頁白話問卷讓老闆決定，再把答案寫回白名單。每一批照下面流程走。

名詞：待確認 = `approvedBy` 為 `null` 且沒有 `decision`；已排定要修 = `decision` 為 `fix`（頁面只顯示，不用回答）。

## 每批流程

1. **extract**：看這批有哪些待確認、哪些還沒有白話稿。

   ```
   node scripts/allowlist-review/extract.cjs
   ```

   輸出 JSON，`missingPlain` 就是還沒寫白話稿的條目（含原文 description、reason）。

2. **補寫 plain.json**：把 `missingPlain` 的每一項用白話補進 `docs/vue-workspace/parity-plan/allowlist-review/plain.json`。格式：

   ```json
   {
     "topics": [{ "key": "inventory", "title": "盤點" }],
     "items": {
       "<白名單 id>": { "topic": "inventory", "title": "白話標題", "legacy": "舊版怎樣", "now": "新版怎樣", "impact": "對使用者的影響", "why": "為什麼會不一樣" }
     }
   }
   ```

   沒寫白話稿的項目仍會出現在頁面（歸在「其他」組、標題用原文前 40 字），但請盡量補齊。

3. **build**：產生單檔 HTML。

   ```
   node scripts/allowlist-review/build.cjs <輸出.html> [--doc <docId>]
   ```

   `docId` 預設 `review-<今天日期>`。頁面只放待確認與要修的項目，已核可的不放。

4. **發布**：用 Artifact 發布該 HTML，頁面要宣告 `db` 能力（見 `artifact-capabilities`），把連結給老闆。老闆可按「暫存」分次填、按「送出」完成。本機直接開檔只能預覽，不能存。

5. **讀回答案存檔**：老闆說填好後，用 ArtifactData 讀 collection `allowlist-review`、doc `<docId>`，把結果存成 `answers.json`（外層有 `{id,data}` 包裝也可以）。

6. **apply --dry-run**：先看會改什麼，不寫任何檔。

   ```
   node scripts/allowlist-review/apply.cjs answers.json --date YYYY-MM-DD --dry-run
   ```

7. **apply**：正式寫入。

   ```
   node scripts/allowlist-review/apply.cjs answers.json --date YYYY-MM-DD
   ```

   - 同意（approve）：`approvedBy` 設為 `user (<日期> 差異確認頁)`。
   - 要改回（revert）、要再討論（discuss）、未選：不動白名單，只記進 `decisions-<日期>.md`。
   - 已核可或 `decision: fix` 的條目一律跳過並警告。
   - 寫入前後都會用與 `validateAllowlist` 等價的檢查驗證，不合法就不寫入。

8. **跑 parity 測試**：`npm run test:parity`（本工具的單元測試：`npx vitest run tests/unit/allowlist-review.test.ts`）。

   `decisions-<日期>.md` 裡「要改回」的項目，之後要排進修正工作並把白名單條目改成 `decision: fix` + `fixIn`；「要再討論」的留到下一批。

## 參數

| 腳本 | 參數 |
| --- | --- |
| extract | `--allowlist <path>` `--plain <path>` |
| build | `<輸出.html>` `--doc <docId>` `--allowlist <path>` `--plain <path>` |
| apply | `<answers.json>` `--date` `--dry-run` `--allowlist <path>` `--plain <path>` `--out-dir <dir>` |

`--allowlist`、`--plain`、`--out-dir` 主要給測試用，平常不用帶。
