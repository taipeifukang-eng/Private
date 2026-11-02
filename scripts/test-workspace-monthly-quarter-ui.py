import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002'
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1500,'height':1000})
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 store=c.request.get('/api/workspace/monthly?month=2026-09').json()['store']
 original=c.request.get(f'/api/monthly-status/bonus-quarter-summary?store_id={store}&year_month=2026-09');assert original.ok
 r=c.request.get(f'/api/workspace/monthly/tools?op=quarterBonuses&store={store}&month=2026-09');assert r.ok
 assert r.json()==original.json();print('Quarter bonus matches legacy API PASS')
 q=c.request.get(f'/api/workspace/monthly/tools?op=quarterPerformance&store={store}&month=2026-08');assert q.ok
 d=q.json();assert d['months']==[7,8,9] and d['monthlyBonuses'][2] is None
 Path('.tmp-check/monthly-quarter-read.json').write_text(json.dumps({'bonuses':r.json(),'performance':d},ensure_ascii=False),encoding='utf-8')
 assert c.request.get('/api/workspace/monthly/tools?op=quarterBonuses&month=2026-09&store=00000000-0000-0000-0000-000000000000').status==403
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(B+'/workspace/index.html');page.locator('.legacy-quick').get_by_role('button',name='每月人員狀態',exact=True).click();page.get_by_role('button',name='查詢人員',exact=True).wait_for()
 page.locator('input[type=month]').fill('2026-09');page.get_by_role('button',name='查詢人員',exact=True).click();page.get_by_text('1,025,908',exact=True).wait_for(timeout=30000)
 page.get_by_role('button',name='每月人員各式獎金明細',exact=True).click();page.get_by_role('button',name='查看 Q3 各式獎金總額',exact=True).click()
 dialog=page.get_by_role('dialog',name='Q3 各式獎金總額',exact=True);dialog.get_by_text('總計',exact=True).wait_for(timeout=30000)
 assert dialog.locator('tfoot td').last.inner_text()==f"{r.json()['grand_total']:,.2f}".rstrip('0').rstrip('.') or dialog.locator('tfoot td').last.inner_text()==f"{r.json()['grand_total']:,}"
 page.screenshot(path='.tmp-check/monthly-quarter-bonuses.png',full_page=True)
 page.keyboard.press('Escape');expect(dialog).to_have_count(0);parent=page.get_by_role('dialog',name='每月人員各式獎金明細',exact=True);expect(parent).to_be_visible();parent.get_by_role('button',name='關閉',exact=True).click()
 page.get_by_role('button',name='該月業績狀況',exact=True).click();page.get_by_role('button',name='該季業績狀況',exact=True).click();quarter=page.get_by_role('dialog',name='該季業績狀況',exact=True)
 quarter.get_by_role('heading',name='季毛利獎金檻位目標',exact=True).wait_for(timeout=30000)
 page.screenshot(path='.tmp-check/monthly-quarter-performance.png',full_page=True)
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/monthly-quarter-mobile.png',full_page=True)
 quarter.get_by_role('button',name='返回月明細',exact=True).click();expect(page.get_by_role('dialog',name='該月業績狀況',exact=True)).to_be_visible()
 page.route('**/api/workspace/monthly/tools?*op=quarterPerformance*',lambda route:route.fulfill(status=503,content_type='application/json',body='{"error":"測試暫時無法讀取"}'))
 page.get_by_role('button',name='該季業績狀況',exact=True).click();quarter.get_by_role('alert').wait_for();quarter.get_by_role('button',name='返回月明細',exact=True).click()
 assert not errors,errors
 page.unroute_all(behavior='wait');b.close();print('Both nested dialogs, return/Escape, desktop/mobile and error recovery PASS')
