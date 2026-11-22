import json, re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path.cwd();DATA=json.loads((ROOT/'.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'));BASE='http://localhost:3002';RESULTS=[]
def passed(s):RESULTS.append(s);print('PASS '+s,flush=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);ctx=b.new_context(viewport={'width':1440,'height':1000});a=next(a for a in DATA['accounts'] if a['key']=='navigation')
 r=ctx.request.post(BASE+'/api/workspace/login',data={'email':a['email'],'password':a['password']},headers={'Origin':BASE});assert r.status==200,r.status
 assert ctx.request.get(BASE+'/api/user/profile').status==200;passed('workspace login is recognized by original test-site session')
 session=ctx.request.get(BASE+'/api/workspace/session').json();assert session['integrated'];items=[i for g in session['navigation'] for i in g['items']];hrefs={i['href'] for i in items}
 required={'/monthly-status','/inspection','/admin/activity-management','/admin/performance','/inventory','/general-affairs','/general-affairs/inventory','/admin/users','/admin/roles','/my-tasks','/organization/calendar'}
 assert required.issubset(hrefs);passed('full Navbar domains and five priority modules present')
 page=ctx.new_page();page.on('pageerror',lambda e:print('BROWSER ERROR '+str(e),flush=True));page.goto(BASE+'/general-affairs',wait_until='domcontentloaded',timeout=60000);expect(page.get_by_role('link',name='新版工作台',exact=True)).to_be_visible(timeout=60000);passed('original General Affairs test site exposes new workspace entry')
 page.get_by_role('link',name='新版工作台',exact=True).click();expect(page.get_by_role('heading',name='開始今天的營運作業')).to_be_visible(timeout=60000);assert '/workspace/index.html' in page.url;passed('switch from existing site needs no second login')
 nav=page.get_by_role('navigation',name='全站功能選單');expect(nav.get_by_role('button',name='每月人員狀態 新版',exact=True)).to_be_visible()
 expect(nav.get_by_role('button',name=re.compile('^巡店列表'))).to_be_visible();page.screenshot(path=str(ROOT/'.tmp-check/integrated-workspace.png'),full_page=True)
 page.get_by_label('搜尋功能').fill('總務');expect(nav.get_by_role('link',name=re.compile('^服務中心首頁 '))).to_be_visible();page.screenshot(path=str(ROOT/'.tmp-check/integrated-general-affairs.png'),full_page=True)
 with page.expect_popup() as popup:nav.get_by_role('link',name=re.compile('^服務中心首頁 ')).click()
 old=popup.value;old.wait_for_load_state('domcontentloaded');assert old.url.startswith(BASE+'/general-affairs');expect(old.get_by_role('link',name='新版工作台',exact=True)).to_be_visible(timeout=30000);old.close();passed('legacy module opens original authenticated page without losing workspace')
 page.get_by_label('搜尋功能').fill('巡店列表');nav.get_by_role('button',name=re.compile('^巡店列表')).click();panel=page.locator('[role=tabpanel]:visible');expect(panel.locator('tbody tr')).not_to_have_count(0,timeout=30000);passed('Vue inspection tab queries original test environment')
 page.set_viewport_size({'width':390,'height':844});page.get_by_role('button',name='切換導覽').click();page.get_by_label('搜尋功能').fill('');assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');page.screenshot(path=str(ROOT/'.tmp-check/integrated-mobile-nav.png'),full_page=True);passed('full navigation usable on mobile')
 viewer=b.new_context();a=next(a for a in DATA['accounts'] if a['key']=='viewer');assert viewer.request.post(BASE+'/api/workspace/login',data={'email':a['email'],'password':a['password']},headers={'Origin':BASE}).status==200
 limited=viewer.request.get(BASE+'/api/workspace/session').json();limited_hrefs={i['href'] for g in limited['navigation'] for i in g['items']};assert '/admin/roles' not in limited_hrefs and '/general-affairs' not in limited_hrefs;passed('navigation is filtered by real account permissions')
 assert ctx.request.post(BASE+'/api/workspace/logout',headers={'Origin':BASE}).status==200;assert ctx.request.get(BASE+'/api/user/profile').status==401;passed('workspace logout also clears original test-site login')
 b.close()
(ROOT/'.tmp-check/workspace-integration-results.json').write_text(json.dumps({'passed':RESULTS,'navigationEntries':len(items)},ensure_ascii=False,indent=2),encoding='utf-8')
