"""Layout-only mocked history; API correctness has separate DEV fixture tests."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts'];expect.set_options(timeout=30000)
with sync_playwright() as p:
 browser=p.chromium.launch();c=browser.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B});u=next(x for x in accounts if x['key']=='navigation');assert c.request.post('/api/workspace/login',data={'email':u['email'],'password':u['password']}).ok
 row={'id':'11111111-1111-4111-8111-111111111111','employee_code':'LAYOUT','employee_name':'更正紀錄版面測試','status':'confirmed','corrected_at':'2026-10-29T01:00:00Z','from_store':{'store_name':'測試來源門市'},'to_store':{'store_name':'測試目標門市'}}
 page=c.new_page();page.route('**/api/workspace/transfers?*',lambda route:route.fulfill(json={'rows':[row],'canCreate':False}))
 records=[{'request_id':str(i),'old_date':'2026-07-15','new_date':'2026-07-20','reason':'日期誤植\n第二行原因','actor_name':'測試督導','created_at':'2026-10-29T01:00:00Z'} for i in range(20)]
 page.route('**/api/workspace/transfers/history?*',lambda route:route.fulfill(json={'rows':records,'legacy':None,'total':25,'page':1,'pageSize':20}))
 page.goto('/workspace/index.html');page.locator('.sidebar').hover();page.locator('.nav-search input').fill('調店申請');page.locator('.module-trigger').first.hover();page.get_by_role('navigation').get_by_role('button',name='調店申請 新版',exact=True).click();page.locator('[role=tabpanel]:visible').get_by_role('button',name='更正紀錄',exact=True).click();dialog=page.get_by_role('dialog');expect(dialog).to_contain_text('已保存 25 次更正');page.set_viewport_size({'width':390,'height':844})
 close=dialog.get_by_role('button',name='關閉',exact=True);box=close.bounding_box();modal=dialog.bounding_box();assert box['y']+box['height']<=modal['y']+modal['height'] and box['y']+box['height']<=844
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/transfer-history-mobile-layout.png');close.click();expect(dialog).to_have_count(0)
 print('PASS mobile history layout: full close button visible without outer-dialog scrolling; no page overflow');browser.close()
