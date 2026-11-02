import os
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';expect.set_options(timeout=60000)
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1600,'height':1000});c.set_default_timeout(60000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 groups=c.request.get('/api/workspace/session').json()['navigation'];page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html')
 toggle=page.get_by_role('button',name='選單',exact=True);expect(toggle).to_be_visible();expect(page.locator('#workspace-menu')).to_have_count(0)
 toggle.hover();expect(page.locator('#workspace-menu')).to_have_count(0);toggle.click();menu=page.locator('#workspace-menu');expect(menu).to_be_visible();assert menu.locator('.catalog-group').count()==len(groups)
 assert menu.locator('.catalog-item').count()==sum(len(g['items']) for g in groups)
 expect(menu.get_by_label('搜尋功能')).to_be_focused();page.screenshot(path='.tmp-check/menu-catalog-desktop.png')
 menu.get_by_label('搜尋功能').fill('角色權限');expect(menu.locator('.catalog-item')).to_have_count(1);menu.get_by_role('button',name='角色權限管理',exact=True).click();expect(menu).to_have_count(0);expect(page.get_by_role('heading',name='角色權限管理',exact=True)).to_be_visible();expect(toggle).to_be_focused()
 toggle.click();expect(menu.get_by_label('搜尋功能')).to_have_value('');page.keyboard.press('Escape');expect(menu).to_have_count(0);expect(toggle).to_be_focused()
 toggle.click();toggle.click();expect(menu).to_have_count(0)
 toggle.click();page.locator('.catalog-backdrop').click(position={'x':1550,'y':930},force=True);expect(menu).to_have_count(0)
 toggle.click();menu.get_by_label('搜尋功能').fill('不存在的功能xxxx');expect(menu.get_by_role('status')).to_contain_text('沒有符合');page.keyboard.press('Escape')
 page.set_viewport_size({'width':390,'height':844});toggle.click();expect(menu).to_be_visible();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path='.tmp-check/menu-catalog-mobile.png');menu.get_by_label('搜尋功能').fill('使用者管理');menu.get_by_role('button',name='使用者管理',exact=True).click();expect(menu).to_have_count(0);expect(page.get_by_role('heading',name='使用者管理',exact=True)).to_be_visible();assert page.get_by_role('tab',name='角色權限管理',exact=True).count()==1
 assert not errors,errors;print('PASS click-only catalog, all authorized groups/items, search/empty, native opening auto-close, reset search, Escape/toggle/backdrop, focus return, existing tabs retained, desktop/mobile width',flush=True);b.close()
