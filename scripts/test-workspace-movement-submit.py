"""Real DEV validation (rolled back by RPC), mocked commit UI; never stores test people."""
import json,os,uuid
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002'
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1500,'height':1000});c.set_default_timeout(60000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 assert c.request.post('/api/workspace/movement-submit',data={},headers={'Origin':'https://invalid.example'}).status==403
 assert c.request.post('/api/workspace/movement-submit',data={},headers={'Origin':B}).status==400
 stores=c.request.get('/api/workspace/movement-validation').json()['stores'];sid=stores[0]['id']
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html')
 page.locator('.module-trigger[title="組織與門市"]').hover();page.locator('.nav-item[title="人員異動管理"]').click()
 batch=page.get_by_role('region',name='批次輸入異動',exact=True)
 code='UI'+uuid.uuid4().hex[:12].upper()
 batch.get_by_label('員編',exact=True).fill(code);batch.get_by_label('姓名',exact=True).fill('提交介面驗證')
 batch.get_by_label('任職門市／組織',exact=True).select_option(sid)
 batch.get_by_label('生效日期',exact=True).fill('2026-10-29');batch.get_by_label('生日',exact=True).fill('1990-01-01')
 batch.get_by_role('button',name='驗證 1 筆異動',exact=True).click()
 expect(batch.get_by_role('button',name='核對並儲存 1 筆',exact=True)).to_be_visible()
 # Editing invalidates a validated payload; verify the user cannot commit a different draft.
 batch.get_by_label('姓名',exact=True).fill('提交介面驗證二')
 expect(batch.get_by_role('button',name='核對並儲存 1 筆',exact=True)).to_have_count(0)
 batch.get_by_role('button',name='驗證 1 筆異動',exact=True).click()
 batch.get_by_role('button',name='核對並儲存 1 筆',exact=True).click()
 dialog=page.get_by_role('dialog',name='確認儲存批次異動',exact=True);expect(dialog).to_contain_text(code)
 attempts=[]
 def commit(route):
  body=route.request.post_data_json;attempts.append(body)
  if len(attempts)==1:route.fulfill(status=503,json={'error':'尚無法確認儲存結果，請保留目前內容並重試。'})
  else:route.fulfill(status=200,json={'created':1,'requestId':body['requestId'],'records':[]})
 page.route('**/api/workspace/movement-submit',commit)
 dialog.get_by_role('button',name='確認儲存 1 筆',exact=True).click();expect(dialog.get_by_role('alert')).to_be_visible()
 page.screenshot(path='.tmp-check/movement-submit-desktop.png')
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/movement-submit-mobile.png')
 assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
 dialog.get_by_role('button',name='重試儲存',exact=True).click()
 expect(dialog).to_have_count(0);expect(batch.get_by_text('已儲存 1 筆異動',exact=False)).to_be_visible()
 assert len(attempts)==2 and attempts[0]==attempts[1]
 expect(batch.get_by_label('姓名',exact=True)).to_be_disabled()
 expect(page.get_by_role('navigation',name='人員異動功能')).not_to_contain_text('未儲存')
 batch.get_by_role('button',name='開始下一批異動',exact=True).click();expect(batch.get_by_label('員編',exact=True)).to_have_value('')
 expect(page.get_by_role('navigation',name='人員異動功能')).not_to_contain_text('未儲存')
 assert not errors,errors
 page.unroute_all(behavior='wait');browser.close()
 print('PASS real preview, origin guard, invalid submission, edits invalidate validation, modal, retry same payload/id, success receipt/clean draft, next batch, desktop/mobile; commit mocked, no stored test rows')
