import os,uuid,subprocess,base64
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';A='/api/workspace/pharmacists/';expect.set_options(timeout=30000)
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B},timeout=60000)
 assert c.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']}).ok
 def ok(r):
  assert r.ok,(r.status,r.text());return r.json()
 assert p.request.new_context(base_url=B).post(A+'overview?year_month=2026-09').status==401
 assert c.post(A+'overview?year_month=2026-09',headers={'Origin':'http://invalid.test'}).status==403
 assert c.post(A+'overview?year_month=2026-99').status==400
 overview=ok(c.post(A+'overview?year_month=2026-09'));assert overview['summary']['total']==len(overview['rows'])
 initial=ok(c.post(A+'master?year=2020'));assert not initial['isLocked'] and not initial['data']
 code='VUEPH'+uuid.uuid4().hex[:12].upper();fee=None;locked=False
 try:
  body={'year':2020,'employee_code':code,'employee_name':'藥師流程驗證','join_date':'2020-01-01','current_position':'藥師'}
  ok(c.post(A+'annual-manual',data=body));assert c.post(A+'annual-manual',data=body).status==409
  ok(c.patch(A+'profiles',data={'employee_code':code,'school':'臺北醫學大學','education_level':'學士','is_responsible_pharmacist':True}))
  row=next(x for x in ok(c.post(A+'master?year=2020'))['data'] if x['employee_code']==code);assert row['education_level']=='學士' and row['is_responsible_pharmacist']
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=')
  path=ok(c.post(A+'proof',multipart={'employee_code':code,'file':{'name':'verification.png','mimeType':'image/png','buffer':png}}))['path']
  fee=ok(c.post(A+'fees',data={'employee_code':code,'association_city':'台北市','fee_year':2020,'payment_proof_path':path,'notes':'新增測試'}))['data']['id']
  ok(c.patch(A+'fees',data={'id':fee,'notes':'更新測試'}));records=ok(c.get(A+'fees',params={'employee_code':code}))['data'];assert records[0]['notes']=='更新測試'
  url=ok(c.get(A+'proof',params={'path':path}))['url'];assert c.get(url).ok
  ok(c.post(A+'annual-lock',data={'year':2020}));locked=True
  assert c.post(A+'annual-manual',data=body).status==400
  ok(c.delete(A+'annual-lock',data={'year':2020}));locked=False
  print('PASS real API add/edit/fee/proof/annual lock roundtrip',flush=True)
  browser=p.chromium.launch();bc=browser.new_context(base_url=B,storage_state=c.storage_state(),viewport={'width':1600,'height':1000});page=bc.new_page();page.set_default_timeout(30000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('/workspace/index.html');page.get_by_role('button',name='選單',exact=True).click();page.locator('.catalog-item[title="藥師管理"]').click();expect(page.get_by_role('heading',name='藥師管理',exact=True)).to_be_visible()
  page.get_by_label('月份',exact=True).fill('2026-09');page.get_by_role('button',name='查詢總覽',exact=True).click();expect(page.locator('.metrics')).to_contain_text('9');expect(page.get_by_role('button',name='查詢總覽',exact=True)).to_be_enabled();page.screenshot(path='.tmp-check/pharmacists-overview.png')
  page.get_by_role('button',name='藥師主檔',exact=True).click();page.get_by_label('年度',exact=True).fill('2020');page.get_by_role('button',name='查詢主檔',exact=True).click();expect(page.locator('tbody')).to_contain_text(code)
  page.get_by_role('button',name='編輯',exact=True).click();d=page.get_by_role('dialog',name='編輯藥師資料');expect(d).to_be_visible();d.locator('select').nth(1).select_option('碩士')
  page.route('**/api/workspace/pharmacists/profiles',lambda route:route.fulfill(status=503,json={'error':'模擬儲存失敗'}))
  d.get_by_role('button',name='儲存',exact=True).click();expect(d.get_by_role('alert')).to_contain_text('模擬儲存失敗');expect(d.locator('select').nth(1)).to_have_value('碩士');page.screenshot(path='.tmp-check/pharmacists-edit.png')
  page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/pharmacists-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors;browser.close()
  print('PASS native overview/master/dialog/failure retention/mobile; real annual add/profile/fee/proof/lock roundtrip and access guards',flush=True)
 finally:
  if locked:ok(c.delete(A+'annual-lock',data={'year':2020}))
  if fee:ok(c.delete(A+'fees',params={'id':fee}))
  ok(c.delete(A+'annual-manual',data={'year':2020,'employee_code':code}))
  sql=Path('.tmp-check/pharmacist-cleanup.sql');sql.write_text("DELETE FROM public.pharmacist_profiles WHERE employee_code='"+code+"';",encoding='utf-8');subprocess.run(['node','scripts/dev-cleanup-query.cjs',str(sql).replace('\\','/'),'.tmp-check/pharmacist-cleanup.json'],check=True)
  assert not ok(c.post(A+'master?year=2020'))['data'];assert not ok(c.get(A+'fees',params={'employee_code':code}))['data'];print('PASS isolated test records removed',flush=True)

