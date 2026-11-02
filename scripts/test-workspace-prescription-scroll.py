import os,re
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';expect.set_options(timeout=30000)
with sync_playwright() as p:
 b=p.chromium.launch(ignore_default_args=["--hide-scrollbars"]);c=b.new_context(base_url=B,viewport={'width':1500,'height':1000});c.set_default_timeout(30000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 session=c.request.get('/api/workspace/session').json();store=session['stores'][0];group=next(g for g in session['navigation'] if any(i.get('kind')=='performance' for i in g['items']));item=next(i for i in group['items'] if i.get('kind')=='performance')
 def route(r):
  path=urlparse(r.request.url).path;q=parse_qs(urlparse(r.request.url).query)
  if r.request.method!='GET':r.fulfill(status=500,json={'error':'測試不寫入資料庫'});return
  if path.endswith('/performance'):data={'stores':[store],'store':store['id'],'records':[],'canEdit':True,'canViewBonus':True,'canImportBonus':True}
  elif path.endswith('/thresholds'):data={'monthly':[{'label':'第一檻','baseAmount':3000}],'quarterly':[{'label':'第一檻','baseAmount':9000}]}
  elif path.endswith('/prescription'):data={'records':[{'store_id':store['id'] if i==0 else 'scroll-fixture-'+str(i),'store_code':store['store_code'] if i==0 else str(9000+i),'store_name':'長表格測試門市'+str(i),'year_month':q.get('year_month',['2026-01'])[0],'regular_prescription_count':10,'regular_prescription_point_value':1,'chronic_prescription_count':20,'chronic_prescription_point_value':2} for i in range(59)]}
  elif path.endswith('/bonus-stores'):data={'data':[store]}
  elif path.endswith('/bonus-averages'):data={'start_year_month':'2026-01','as_of_year_month':'2026-09','employee_count':0,'person_month_count':0,'imported_month_count':0}
  else:data={'records':[]}
  r.fulfill(json=data)
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/api/workspace/performance**',route)
 page.goto('/workspace/index.html');page.locator(f'.module-trigger[title="{group["label"]}"]').hover();page.locator(f'.nav-item[title="{item["label"]}"]').click()
 nav=page.get_by_role('navigation',name='業績子功能');expect(nav.get_by_role('button',name='匯入每月獎金',exact=True)).to_be_visible();expect(page.locator('.tab-strip [role=tab]')).to_have_count(1)
 query=page.get_by_role('button',name='查詢業績',exact=True);upload=page.get_by_role('button',name='匯入 Excel',exact=True);assert upload.bounding_box()['x']>query.bounding_box()['x'];page.screenshot(path='.tmp-check/performance-integrated-desktop.png')
 nav.get_by_role('button',name='處方箋',exact=True).click();expect(page.locator('.annual-prescription')).to_be_visible()
 top=page.get_by_role('region',name='處方箋表格上方橫向捲軸');table=page.locator('.table-viewport:visible');expect(top).to_be_visible();expect(page.locator('.annual-prescription tbody tr')).to_have_count(59)
 top.evaluate('(e)=>e.scrollLeft=900');None
 page.wait_for_function("Math.abs(document.querySelector('.scroll-track').scrollLeft-document.querySelector('.table-viewport').scrollLeft)<2 && document.querySelector('.table-viewport').scrollLeft>800")
 table.evaluate('(e)=>e.scrollLeft=100');page.wait_for_function("Math.abs(document.querySelector('.scroll-track').scrollLeft-100)<2")
 page.locator('.work-page:visible').evaluate('(e)=>e.scrollTop=1800');page.wait_for_function("document.querySelector('.work-page').scrollTop>1000")
 bounds=top.bounding_box();workbounds=page.locator('.work-page:visible').bounding_box();assert bounds['y']>=workbounds['y'] and bounds['y']<workbounds['y']+100,(bounds,workbounds)
 page.screenshot(path='.tmp-check/prescription-top-scroll-59-stores.png')
 top.evaluate('(e)=>e.scrollLeft=0');page.wait_for_function("document.querySelector('.table-viewport').scrollLeft===0");page.locator('.work-page:visible').evaluate('(e)=>e.scrollTop=0')
 page.get_by_role('button',name='1 月',exact=True).click();field=page.get_by_label(store['store_code']+' 一般箋張數',exact=True);expect(field).to_be_visible();field.fill('123')
 nav.get_by_role('button',name='團體獎金',exact=True).click();expect(query).to_be_visible();nav.get_by_role('button',name='匯入每月獎金',exact=True).click();expect(page.get_by_role('button',name='查詢獎金',exact=True)).to_be_visible();page.get_by_label('員工代號／姓名').fill('保留查詢')
 nav.get_by_role('button',name='處方箋',exact=True).click();expect(field).to_have_value('123');nav.get_by_role('button',name='匯入每月獎金',exact=True).click();expect(page.get_by_label('員工代號／姓名')).to_have_value('保留查詢');expect(page.locator('.tab-strip [role=tab]')).to_have_count(1)
 page.get_by_role('button',name=re.compile('^關閉 業績管理')).click();expect(page.get_by_role('dialog',name='關閉工作頁前確認')).to_be_visible();page.get_by_role('button',name='繼續編輯',exact=True).click()
 nav.get_by_role('button',name='團體獎金',exact=True).click();page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/performance-integrated-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors
 print('PASS 59-store table, top-to-table and table-to-top scrolling, sticky scrollbar mid-table, single work tab draft retention and mobile; mocked APIs, no writes');b.close()
