import json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path.cwd();D=json.loads((ROOT/'.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'));F=json.loads((ROOT/'.tmp-check/five-module-fixtures.json').read_text());BASE='http://localhost:3002';R=[]
def passed(s):R.append(s);print('PASS '+s,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);c=b.new_context(viewport={'width':1366,'height':900});a=next(x for x in D['accounts'] if x['key']=='navigation');assert c.request.post(BASE+'/api/workspace/login',data={'email':a['email'],'password':a['password']},headers={'Origin':BASE}).ok
 page=c.new_page();page.goto(BASE+'/workspace/index.html',wait_until='networkidle');page.get_by_label('新頁預設門市').select_option(F['store']);page.get_by_label('搜尋功能').fill('每月人員狀態');nav=page.get_by_role('navigation');nav.get_by_role('button',name='每月人員狀態 新版',exact=True).click();first=page.locator('[role=tabpanel]').first;expect(first.get_by_text('Vue 人員測試',exact=True)).to_be_visible(timeout=30000)
 second_store=next(s['id'] for s in c.request.get(BASE+'/api/workspace/session').json()['stores'] if s['store_code']=='VW002');page.get_by_label('新頁預設門市').select_option(second_store);expect(first.get_by_label('門市',exact=True)).to_have_value(F['store']);nav.get_by_role('button',name='每月人員狀態 新版',exact=True).click();second=page.locator('[role=tabpanel]').nth(1);expect(second.get_by_label('門市',exact=True)).to_have_value(second_store,timeout=30000);page.get_by_role('tab').first.click();expect(first.get_by_label('門市',exact=True)).to_have_value(F['store']);passed('global store only seeds new tabs and monthly instances remain independent')
 first.get_by_label('月份',exact=True).fill('2026-09');expect(first.get_by_role('button',name='編輯出勤')).to_be_disabled();first.get_by_label('月份',exact=True).fill('2026-10');first.get_by_role('button',name='編輯出勤').click();edit=page.locator('[role=tabpanel]:visible');expect(edit.get_by_role('button',name='儲存出勤資料')).to_be_visible(timeout=30000);passed('changed filters cannot edit stale row context')
 edit.get_by_label('備註',exact=True).fill('失敗時須保留的 Vue 草稿')
 def fail(route):
  if route.request.method=='POST':route.fulfill(status=503,content_type='application/json',body=json.dumps({'error':'測試：暫時無法儲存'}))
  else:route.continue_()
 page.route('**/api/workspace/monthly',fail);edit.get_by_role('button',name='儲存出勤資料').click();expect(page.get_by_role('dialog',name='儲存未完成')).to_be_visible();page.get_by_role('button',name='返回編輯').click();expect(edit.get_by_label('備註',exact=True)).to_have_value('失敗時須保留的 Vue 草稿');page.get_by_role('button',name='關閉 人員 · Vue 人員測試',exact=True).click();expect(page.get_by_role('dialog',name='關閉工作頁前確認')).to_be_visible();page.get_by_role('button',name='繼續編輯').click();passed('failed save presents modal and preserves dirty tab and draft')
 page.get_by_role('button',name='切換深色模式').click();page.screenshot(path=str(ROOT/'.tmp-check/five-monthly-edit-dark.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');page.screenshot(path=str(ROOT/'.tmp-check/five-edit-mobile.png'),full_page=True);passed('extended staff form supports dark theme and narrow screens')
 b.close()
(ROOT/'.tmp-check/five-recovery-results.json').write_text(json.dumps(R,ensure_ascii=False,indent=2),encoding='utf-8')
