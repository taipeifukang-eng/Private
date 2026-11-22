import json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';root=Path('.tmp-check/prod-q3-copy');data=json.loads((root/'prepared-data.json').read_text(encoding='utf-8'));accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'];results=[];expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B});a=next(a for a in accounts if a['key']=='navigation');assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 def get(path):
  r=c.request.get('/api/workspace/'+path);assert r.ok,r.text();return r.json()
 session=get('session');assert all(any(v['id']==s['id'] for v in session['stores']) for s in data['stores'])
 for store in data['stores']:
  sid=store['id'];r=get('performance?year=2026&store_id='+sid);assert len(r['records'])==3
  for month in ['2026-07','2026-08','2026-09']:
   actual=get('monthly?month='+month+'&store='+sid)['records'];assert len(actual)==sum(1 for row in data['monthly_staff_status'] if row['store_id']==sid and row['year_month']==month)
  results.append({'store':store['store_code'],'annualPerformanceRows':3,'monthlyStaffCountsMatch':True});print('PASS store '+store['store_code']+' Vue APIs',flush=True)
 master=data['inspection_masters'][0];detail=get('inspection-detail?id='+master['id']);assert detail;print('PASS copied inspection detail API',flush=True)
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');south=next(s for s in data['stores'] if s['store_code']=='0002');page.get_by_label('新頁預設門市').select_option(south['id'])
 def open_module(label):
  page.locator('.sidebar').hover();page.locator('.nav-search input').fill(label);page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name=label+' 新版',exact=True).click();return page.locator('[role=tabpanel]:visible')
 panel=open_module('業績管理');expect(panel.locator('.performance-detail-table tbody tr')).to_have_count(12);panel.locator('.performance-quarter-list > details').nth(2).locator('summary').click();panel.locator('.performance-quarter-list > details').nth(2).scroll_into_view_if_needed();page.screenshot(path=str(root/'preview-performance.png'))
 panel=open_module('每月人員狀態');panel.locator('input[type=month]').fill('2026-07');panel.get_by_role('button',name='查詢人員',exact=True).click();expected=sum(1 for r in data['monthly_staff_status'] if r['store_id']==south['id'] and r['year_month']=='2026-07');expect(panel.locator('tbody tr')).to_have_count(expected);page.screenshot(path=str(root/'preview-monthly.png'));assert not errors,errors
 print('PASS native performance quarter and July staff screens',flush=True);browser.close()
(root/'ui-verification.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
