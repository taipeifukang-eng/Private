import json,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';f=json.loads(Path('.tmp-check/transfer-roles-fixture.json').read_text());expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B});u=next(u for u in f['users'] if u['key']=='confirm')
 assert c.request.post('/api/workspace/login',data={'email':u['email'],'password':u['password']}).ok
 payload={'id':f['confirmation']['id'],'effective_date':'2026-07-15'}
 r=c.request.post('/api/workspace/transfers/preview',data=payload);assert r.ok,r.text();preview=r.json();assert preview['canSubmit'],preview
 assert sorted(x['work_days'] for x in preview['changes'])==[14,17]
 stale=c.request.post('/api/workspace/transfers/confirm',data={**payload,'version':'0'*32});assert stale.status==409,(stale.status,stale.text())
 assert c.request.post('/api/workspace/transfers/confirm',data={**payload,'version':preview['version']},headers={'Origin':'https://invalid.example'}).status==403
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('調店申請');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='調店申請 新版',exact=True).click()
 panel=page.locator('[role=tabpanel]:visible');panel.get_by_label('搜尋申請',exact=True).fill(f['confirmation']['code']);panel.get_by_role('button',name='確認調店',exact=True).click();dialog=page.get_by_role('dialog');dialog.get_by_label('生效日期',exact=True).fill('2026-07-15');dialog.get_by_role('button',name='核對調店影響',exact=True).click();expect(dialog.get_by_role('button',name='確認生效',exact=True)).to_be_visible();expect(dialog).to_contain_text('14 / 31');expect(dialog).to_contain_text('17 / 31')
 dialog.get_by_label('生效日期',exact=True).fill('2026-07-16');expect(dialog.get_by_role('button',name='確認生效',exact=True)).to_have_count(0);dialog.get_by_label('生效日期',exact=True).fill('2026-07-15');dialog.get_by_role('button',name='核對調店影響',exact=True).click();expect(dialog.get_by_role('button',name='確認生效',exact=True)).to_be_visible()
 page.screenshot(path='.tmp-check/transfer-confirm-desktop.png');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/transfer-confirm-mobile.png');page.set_viewport_size({'width':1440,'height':1000});dialog.get_by_role('button',name='確認生效',exact=True).click();expect(panel.locator('.notice[role=status]')).to_contain_text('已確認');expect(dialog).to_have_count(0)
 retry=c.request.post('/api/workspace/transfers/confirm',data={**payload,'version':preview['version']});assert retry.ok,retry.text();assert retry.json()['alreadyConfirmed']
 saved=next(r for r in c.request.get('/api/workspace/transfers?status=confirmed').json()['rows'] if r['id']==payload['id']);assert saved['effective_date']==payload['effective_date'] and saved['confirmed_by']==u['id'] and saved['movement_history_id'];assert not errors,errors
 print('PASS confirmation API/UI: non-admin supervisor, preview days, stale conflict, Origin, date invalidates preview, save/readback, retry, mobile')
 original=c.request.get('/api/workspace/transfers/correct?id='+payload['id']);assert original.ok,original.text()
 correction={'id':payload['id'],'effective_date':'2026-07-20','reason':'日期誤植驗證','version':original.json()['version'],'requestId':str(uuid.uuid4())}
 assert c.request.post('/api/workspace/transfers/correct',data={**correction,'version':'0'*32}).status==409
 assert c.request.post('/api/workspace/transfers/correct',data={**correction,'effective_date':'2026-08-20'}).status==409
 denied=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});creator=next(u for u in f['users'] if u['key']=='create');assert denied.post('/api/workspace/login',data={'email':creator['email'],'password':creator['password']}).ok
 assert denied.get('/api/workspace/transfers/correct?id='+payload['id']).status==403
 assert denied.post('/api/workspace/transfers/correct',data=correction).status==403
 captured=[]
 def capture(route):
  captured.append(route.request.post_data_json);route.continue_()
 page.route('**/api/workspace/transfers/correct',capture)
 panel.get_by_label('申請狀態',exact=True).select_option('confirmed');panel.get_by_role('button',name='更正日期',exact=True).click();dialog=page.get_by_role('dialog')
 dialog.get_by_label('新生效日期',exact=True).fill('2026-07-20');dialog.get_by_label('更正原因',exact=True).fill('日期誤植驗證');dialog.get_by_role('button',name='核對更正內容',exact=True).click();expect(dialog.get_by_role('button',name='確認更正',exact=True)).to_be_visible();expect(dialog.locator('tbody')).to_contain_text('19');expect(dialog.locator('tbody')).to_contain_text('12')
 page.screenshot(path='.tmp-check/transfer-correct-desktop.png');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/transfer-correct-mobile.png');page.set_viewport_size({'width':1440,'height':1000});dialog.get_by_role('button',name='確認更正',exact=True).click();expect(panel.locator('.notice[role=status]')).to_contain_text('日期已更正');expect(dialog).to_have_count(0)
 assert len(captured)==1
 retry=c.request.post('/api/workspace/transfers/correct',data=captured[0]);assert retry.ok,retry.text();assert retry.json()['alreadyCorrected']
 assert c.request.post('/api/workspace/transfers/correct',data=captured[0],headers={'Origin':'https://invalid.example'}).status==403
 saved=next(r for r in c.request.get('/api/workspace/transfers?status=confirmed').json()['rows'] if r['id']==payload['id']);assert saved['effective_date']=='2026-07-20' and saved['corrected_by']==u['id'] and saved['correction_reason']=='日期誤植驗證';assert not errors,errors
 cross=c.request.post('/api/workspace/transfers/correct-preview',data={'id':payload['id'],'effective_date':'2026-08-20'});assert cross.ok,cross.text();plan=cross.json();assert plan['validationOnly'] and not plan['canSubmit'] and plan['requiresHumanReview']
 assert len(plan['changes'])==2 and sorted(x['patch']['work_days'] for x in plan['changes'])==[0,31]
 assert all(x['operation']=='update' for x in plan['changes'])
 assert denied.post('/api/workspace/transfers/correct-preview',data={'id':payload['id'],'effective_date':'2026-08-20'}).status==403
 assert c.request.post('/api/workspace/transfers/correct-preview',data={'id':payload['id'],'effective_date':'2026-08-20'},headers={'Origin':'https://invalid.example'}).status==403
 assert c.request.get('/api/workspace/transfers/correct?id='+payload['id']).json()['row']['effective_date']=='2026-07-20'
 print('PASS cross-month preview: 31/0 day retained rows, no uninitialized inserts, read-only result and permission/Origin denial')
 print('PASS same-month correction API/UI: permissions, stale/cross-month denial, preview 19/12 days, save, audit labels and retry')
 browser.close()
