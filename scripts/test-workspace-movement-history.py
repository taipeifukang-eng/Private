import json,os
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'];expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000});a=next(a for a in accounts if a['key']=='navigation');assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']},headers={'Origin':B}).ok
 response=c.request.get('/api/workspace/employee-movements');assert response.ok,response.text();data=response.json();assert data['total']>=len(data['rows']);assert len(data['rows'])<=100
 if os.environ.get('MOVEMENT_HISTORY_FIXTURE_CODE'):
  assert data['total']>=105
  allrows=[]
  for n in range(1,(data['total']+49)//50+1):allrows.extend(c.request.get('/api/workspace/employee-movements?size=50&page='+str(n)).json()['rows'])
  fixture=[r for r in allrows if r['employee_code']==os.environ['MOVEMENT_HISTORY_FIXTURE_CODE']];assert len(fixture)==105 and len({r['id'] for r in fixture})==105
  assert all(r['new_label']=='主任' and r['type_label']=='升職' for r in fixture)
  august=c.request.get('/api/workspace/employee-movements?month=2026-08&type=promotion').json();assert august['total']>=105 and all(r['movement_date'].startswith('2026-08') for r in august['rows'])
 for query in ['month=2026-13','month=2026-01-01','type=unknown','page=0','size=1000']:
  assert c.request.get('/api/workspace/employee-movements?'+query).status==400
 viewer=p.request.new_context(base_url=B);a=next(a for a in accounts if a['key']=='viewer');assert viewer.post('/api/workspace/login',data={'email':a['email'],'password':a['password']},headers={'Origin':B}).ok;assert viewer.get('/api/workspace/employee-movements').status==403
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('人員異動紀錄');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='人員異動紀錄 新版',exact=True).click();panel=page.locator('[role=tabpanel]:visible');expect(panel.get_by_role('button',name='全部月份',exact=True)).to_be_enabled();panel.get_by_role('button',name='全部月份',exact=True).click();expect(panel.get_by_text('全部月份 · 全部類型 · 共 '+str(data['total'])+' 筆',exact=True)).to_be_visible()
 if data['rows']:expect(panel.locator('tbody tr')).to_have_count(len(data['rows']))
 panel.get_by_label('每頁筆數',exact=True).select_option('50');expect(panel.get_by_text('條件已變更，請查詢紀錄以更新結果。',exact=True)).to_be_visible();expect(panel.get_by_role('button',name='匯出本頁 Excel',exact=True)).to_be_disabled();panel.get_by_role('button',name='查詢紀錄',exact=True).click();expect(panel.get_by_role('button',name='查詢紀錄',exact=True)).to_be_enabled();expect(panel.locator('tbody tr')).to_have_count(min(data['total'],50) if data['total'] else 1)
 if data['total']>50:
  panel.get_by_role('button',name='下一頁',exact=True).click();expect(panel.get_by_text('第 2 / ',exact=False)).to_be_visible()
 if data['total']:
  current_page=2 if data['total']>50 else 1
  expected=c.request.get('/api/workspace/employee-movements?size=50&page='+str(current_page)).json()['rows']
  with page.expect_download() as info:panel.get_by_role('button',name='匯出本頁 Excel',exact=True).click()
  d=info.value;assert '第'+str(current_page)+'頁' in d.suggested_filename
  ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
  with ZipFile(d.path()) as z:
   root=ET.fromstring(z.read('xl/worksheets/sheet1.xml'));sheet=[]
   for row in root.findall('s:sheetData/s:row',ns):
    cells=row.findall('s:c',ns);assert all(c.find('s:f',ns) is None and c.get('t') in ('str','inlineStr') for c in cells)
    sheet.append([c.findtext('s:v',None,ns) if c.get('t')=='str' else ''.join(c.find('s:is',ns).itertext()) for c in cells])
  d.delete();assert sheet[0]==['員編','姓名','任職門市','異動類型','是否藥師(入職)','舊值','新值','生效日期','備註']
  assert sheet[1:]==[[r['employee_code'],r['employee_name'],(r['store'] or {}).get('store_name') or '未指定門市',r['type_label'],('未記錄' if r['onboarding_is_pharmacist'] is None else '是' if r['onboarding_is_pharmacist'] else '否') if r['movement_type']=='onboarding' else '—',r['old_value'] or '—',r['new_label'] or '—',r['movement_date'],r['display_notes'] or '—'] for r in expected]
 panel.get_by_label('異動類型',exact=True).select_option('promotion');panel.get_by_role('button',name='查詢紀錄',exact=True).click();promotion=c.request.get('/api/workspace/employee-movements?type=promotion&size=50').json();expect(panel.get_by_text('全部月份 · 升職 · 共 '+str(promotion['total'])+' 筆',exact=True)).to_be_visible();page.screenshot(path='.tmp-check/movement-history-desktop.png');page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/movement-history-mobile.png')
 panel.get_by_label('生效月份',exact=True).fill('1900-01');panel.get_by_role('button',name='查詢紀錄',exact=True).click();expect(panel.get_by_text('沒有符合條件的異動紀錄。',exact=True)).to_be_visible();expect(panel.get_by_role('button',name='匯出本頁 Excel',exact=True)).to_be_disabled()
 page.route('**/api/workspace/employee-movements?*',lambda route:route.fulfill(status=503,json={'error':'讀取中斷測試'}));panel.get_by_role('button',name='重新整理',exact=True).click();expect(panel.get_by_role('alert')).to_contain_text('讀取中斷測試');expect(panel.locator('table')).to_have_count(0);page.unroute('**/api/workspace/employee-movements?*');panel.get_by_role('button',name='重新整理',exact=True).click();expect(panel.get_by_text('沒有符合條件的異動紀錄。',exact=True)).to_be_visible();assert not errors,errors
 print('PASS real movement history API/UI: permission, parameters, counts, paging, nine-column current-page Excel, disabled export, filters, empty/error/retry and mobile');browser.close()
