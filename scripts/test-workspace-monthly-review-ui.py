import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002'
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1600,'height':1000},accept_downloads=True)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(B+'/workspace/index.html');page.locator('.legacy-quick').get_by_role('button',name='每月人員狀態',exact=True).click()
 page.get_by_role('button',name='查詢人員',exact=True).wait_for();page.locator('input[type=month]').fill('2026-09');page.get_by_role('button',name='查詢人員',exact=True).click()
 page.get_by_text('1,025,908',exact=True).wait_for(timeout=30000)
 toolbar=page.get_by_label('每月人員作業');names=toolbar.get_by_role('button').all_text_contents();assert set(names)=={'每月人員各式獎金明細','該月業績狀況','匯出 Excel','匯入業績資料','匯入門市統計','活動檢視'},names
 for label in ['匯入業績資料','匯入門市統計']:
  toolbar.get_by_role('button',name=label,exact=True).click()
  dialog=page.get_by_role('dialog',name=label,exact=True)
  expect(dialog.locator('input[type=file]').first).to_be_enabled()
  expect(dialog.get_by_text('匯入月份：',exact=False)).to_be_visible()
  dialog.get_by_role('button',name='關閉',exact=True).click()
 assert page.get_by_role('button',name='編輯統計',exact=True).count()==0
 assert page.get_by_role('button',name='確認本月狀態',exact=True).count()==0
 assert page.get_by_role('button',name='退回草稿',exact=True).count()==0
 assert page.get_by_role('button',name='取消確認',exact=True).count()==1
 with page.expect_download() as d:toolbar.get_by_role('button',name='匯出 Excel',exact=True).click()
 d.value.save_as('.tmp-check/monthly-reviewed.xlsx')
 page.screenshot(path='.tmp-check/monthly-reviewed-tools.png',full_page=True);print('live confirmed: four read tools plus two imports, correct workflow, Excel download PASS')
 state={'value':'submitted','stats':True}
 def intercept(route):
  r=route.fetch();data=r.json()
  if '/monthly/tools?' in route.request.url and 'op=' not in route.request.url:
   data['storeStatus']=state['value']
   if not state['stats']:
    data['capabilities']['viewStats']=False;data['capabilities']['editStats']=False
    data['stats']={k:v for k,v in data['stats'].items() if k.startswith('support_')}
  elif '/monthly?' in route.request.url:
   data['storeStatus']=state['value']
   for x in data.get('records',[]):x['status']=state['value']
  route.fulfill(response=r,json=data)
 page.route('**/api/workspace/monthly?*',intercept);page.route('**/api/workspace/monthly/tools?*',intercept)
 page.get_by_role('button',name='重新整理',exact=True).click()
 expect(page.get_by_role('button',name='確認本月狀態',exact=True)).to_be_visible(timeout=30000)
 expect(toolbar.get_by_role('button')).to_have_count(6)
 assert page.get_by_role('button',name='退回草稿',exact=True).count()==1
 assert page.get_by_role('button',name='取消確認',exact=True).count()==0
 print('submitted UI state PASS')
 state.update(value='draft',stats=False);page.get_by_role('button',name='重新整理',exact=True).click()
 expect(page.get_by_role('button',name='手動新增員工',exact=True)).to_be_visible(timeout=30000)
 expect(page.get_by_text('載入門市統計與作業權限…',exact=True)).to_have_count(0,timeout=30000)
 expect(page.get_by_role('heading',name='門市每月統計資料',exact=True)).to_have_count(0)
 assert page.get_by_role('button',name='送出審核',exact=True).count()==1
 assert page.get_by_role('button',name='取消確認',exact=True).count()==0
 print('draft tools restored; no viewStats hides section PASS')
 assert not errors,errors
 page.unroute_all(behavior='wait')
 b.close()
