import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'];expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B});a=next(a for a in accounts if a['key']=='navigation');assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 employees=c.request.get('/api/workspace/employees').json()['employees'];assert employees
 candidate=next(e for e in employees if e['current_position']);history=c.request.get('/api/workspace/employees?history='+candidate['employee_code']).json()['history']
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('員工名冊');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='員工名冊 新版',exact=True).click();panel=page.locator('[role=tabpanel]:visible')
 expect(panel.get_by_text('符合 '+str(len(employees))+' / '+str(len(employees))+' 位員工',exact=True)).to_be_visible()
 panel.get_by_label('在職狀態',exact=True).select_option('resigned');expected=sum(not e['is_active'] for e in employees);expect(panel.get_by_text('符合 '+str(expected)+' / '+str(len(employees))+' 位員工',exact=True)).to_be_visible();panel.get_by_label('在職狀態',exact=True).select_option('all')
 panel.get_by_label('搜尋員工',exact=True).fill(candidate['employee_code']);panel.get_by_label('職位',exact=True).select_option(candidate['current_position']);row=panel.get_by_role('row').filter(has=page.get_by_role('cell',name=candidate['employee_code'],exact=True));expect(row).to_have_count(1)
 if candidate['current_status']=='full_month':expect(row.get_by_role('cell',name='整月在職',exact=True)).to_be_visible()
 page.screenshot(path='.tmp-check/employee-directory-desktop.png');row.get_by_role('button',name='異動歷程',exact=True).click();expect(panel.get_by_role('heading',name='員工異動歷程',exact=True)).to_be_visible();expect(panel.get_by_text(str(len(history))+' 筆紀錄',exact=True)).to_be_visible()
 panel.get_by_label('紀錄類型',exact=True).select_option('promotion');expect(panel.get_by_text(str(sum(h['movement_type']=='promotion' for h in history))+' 筆紀錄',exact=True)).to_be_visible()
 page.get_by_role('tab',name='員工名冊',exact=False).click();expect(panel.get_by_label('搜尋員工',exact=True)).to_have_value(candidate['employee_code']);expect(panel.get_by_label('職位',exact=True)).to_have_value(candidate['current_position'])
 page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/employee-directory-mobile.png')
 panel.get_by_label('搜尋員工',exact=True).fill('NO-MATCH-VERIFY-EMPLOYEE');expect(panel.get_by_text('沒有符合條件的員工。',exact=True)).to_be_visible()
 # Read failure clears stale rows and allows retry; no database mutation.
 page.route('**/api/workspace/employees',lambda route:route.fulfill(status=503,content_type='application/json',body='{"error":"讀取測試暫停"}'));panel.get_by_role('button',name='重新整理',exact=True).click();expect(panel.get_by_role('alert')).to_contain_text('讀取測試暫停');expect(panel.locator('table')).to_have_count(0);page.unroute('**/api/workspace/employees');panel.get_by_role('button',name='重新整理',exact=True).click();expect(panel.get_by_text('沒有符合條件的員工。',exact=True)).to_be_visible()
 assert not errors,errors;print('PASS real directory counts/filters, history count/type, independent tab state, empty/error/retry and mobile overflow');browser.close()
