import os,re
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';expect.set_options(timeout=30000)
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1500,'height':1000});c.set_default_timeout(30000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 session=c.request.get('/api/workspace/session').json();store=session['stores'][0];group=next(g for g in session['navigation'] if any(i.get('kind')=='performance' for i in g['items']));item=next(i for i in group['items'] if i.get('kind')=='performance')
 def route(r):
  path=urlparse(r.request.url).path;q=parse_qs(urlparse(r.request.url).query)
  if r.request.method!='GET':r.fulfill(status=500,json={'error':'測試不寫入資料庫'});return
  if path.endswith('/performance'):data={'stores':[store],'store':store['id'],'records':[],'canEdit':True,'canViewBonus':True,'canImportBonus':True}
  elif path.endswith('/thresholds'):data={'monthly':[{'label':'第一檻','baseAmount':3000}],'quarterly':[{'label':'第一檻','baseAmount':9000}]}
  elif path.endswith('/prescription'):data={'records':[{'store_id':store['id'],'store_code':store['store_code'],'store_name':store['store_name'],'year_month':q.get('year_month',['2026-01'])[0],'regular_prescription_count':10,'regular_prescription_point_value':1,'chronic_prescription_count':20,'chronic_prescription_point_value':2}]}
  elif path.endswith('/bonus-stores'):data={'data':[store]}
  elif path.endswith('/bonus-averages'):data={'start_year_month':'2026-01','as_of_year_month':'2026-09','employee_count':0,'person_month_count':0,'imported_month_count':0}
  else:data={'records':[{'store_id':store['id'],'store':store,'employee_code':'TEST-A','employee_name':'甲','group_bonus':1000,'single_item_bonus':200,'inventory_diff_penalty':-50},{'store_id':store['id'],'store':store,'employee_code':'TEST-B','employee_name':'乙','group_bonus':3000,'single_item_bonus':400}]}
  r.fulfill(json=data)
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('**/api/workspace/performance**',route)
 page.goto('/workspace/index.html');page.locator(f'.module-trigger[title="{group["label"]}"]').hover();page.locator(f'.nav-item[title="{item["label"]}"]').click()
 nav=page.get_by_role('navigation',name='業績子功能');expect(nav.get_by_role('button',name='匯入每月獎金',exact=True)).to_be_visible();expect(page.locator('.tab-strip [role=tab]')).to_have_count(1)
 query=page.get_by_role('button',name='查詢業績',exact=True);upload=page.get_by_role('button',name='匯入 Excel',exact=True);assert upload.bounding_box()['x']>query.bounding_box()['x'];page.screenshot(path='.tmp-check/performance-integrated-desktop.png')
 nav.get_by_role('button',name='處方箋',exact=True).click();expect(page.locator('.annual-prescription')).to_be_visible();page.get_by_role('button',name='1 月',exact=True).click();field=page.get_by_label(store['store_code']+' 一般箋張數',exact=True);expect(field).to_be_visible();field.fill('123')
 nav.get_by_role('button',name='團體獎金',exact=True).click();expect(query).to_be_visible();nav.get_by_role('button',name='匯入每月獎金',exact=True).click();expect(page.get_by_role('button',name='查詢獎金',exact=True)).to_be_visible();total=page.get_by_role('status',name='獎金合計');expect(total).to_contain_text('4,550');page.get_by_label('獎金項目',exact=True).select_option('group_bonus');expect(total).to_contain_text('4,000');page.get_by_label('員工代號／姓名').fill('TEST-A');expect(total).to_contain_text('1,000');page.get_by_label('獎金項目',exact=True).select_option('');expect(total).to_contain_text('1,150');page.get_by_label('員工代號／姓名').fill('查無此人');expect(total).to_contain_text('0 元');page.get_by_label('員工代號／姓名').fill('保留查詢')
 top_filters=page.get_by_role('button',name='查詢獎金',exact=True).locator('xpath=ancestor::form');expect(top_filters.get_by_label('員工代號／姓名')).to_be_visible();expect(top_filters.get_by_label('獎金項目',exact=True)).to_be_visible()
 with page.expect_request(lambda r:'bonus-averages?' in r.url and 'average_mode=person_month' in r.url):top_filters.get_by_role('button',name='人月平均',exact=True).click()
 expect(top_filters.get_by_role('button',name='人月平均',exact=True)).to_have_attribute('aria-pressed','true');expect(top_filters.get_by_role('button',name='查詢獎金',exact=True)).to_be_enabled()
 with page.expect_request(lambda r:'bonus-averages?' in r.url and 'average_mode=continuous_employee' in r.url):top_filters.get_by_role('button',name='每月皆存在員工',exact=True).click()
 expect(top_filters.get_by_role('button',name='查詢獎金',exact=True)).to_be_enabled();page.screenshot(path='.tmp-check/bonus-top-filters-desktop.png')

 nav.get_by_role('button',name='處方箋',exact=True).click();expect(field).to_have_value('123');nav.get_by_role('button',name='匯入每月獎金',exact=True).click();expect(page.get_by_label('員工代號／姓名')).to_have_value('保留查詢');expect(page.locator('.tab-strip [role=tab]')).to_have_count(1)
 page.get_by_role('button',name=re.compile('^關閉 業績管理')).click();expect(page.get_by_role('dialog',name='關閉工作頁前確認')).to_be_visible();page.get_by_role('button',name='繼續編輯',exact=True).click()
 nav.get_by_role('button',name='團體獎金',exact=True).click();page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/performance-integrated-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors
 print('PASS single work tab, three sections, retained prescription draft and bonus query, parent close guard, import to right of query, desktop/mobile; mocked performance APIs, no writes');b.close()
