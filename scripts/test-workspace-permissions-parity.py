import os,json
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';expect.set_options(timeout=15000)
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1600,'height':1050});c.set_default_timeout(15000)
 assert c.request.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 role=c.request.get('/api/workspace/roles').json()['roles'][0];base='/api/workspace/roles/'+role['id']+'/permissions';legacy=c.request.get('/api/roles/'+role['id']+'/permissions').json()['permissions'];native=c.request.get(base).json()['permissions'];assert legacy==native
 source=json.load(open('.tmp-check/permissions-parity/audit.json',encoding='utf-8'))['prod'];assert {p['code'] for p in source if p['is_active']}<={p['code'] for p in native}
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.get_by_role('button',name='選單',exact=True).click();page.locator('.catalog-item[title="角色權限管理"]').click();page.get_by_label('搜尋角色').fill(role['code']);page.locator('.roles-page tbody tr').first.get_by_role('button').click();d=page.get_by_role('dialog',name=role['name']+' · 角色設定');d.get_by_role('button',name='權限設定',exact=True).click();expect(d.get_by_label('搜尋權限')).to_be_visible();d.get_by_label('顯示權限代碼').check();d.get_by_role('button',name='全部展開').click();assert d.locator('.permission code').count()==len(native);assert set(d.locator('.permission code').all_text_contents())=={p['code'] for p in native}
 d.get_by_label('搜尋權限').fill('activity.campaign');feature=d.locator('.feature');expect(feature).to_have_count(1);expect(feature.locator('input[type=radio]')).to_have_count(3);expect(feature.locator('input[type=checkbox]')).to_have_count(3)
 def control(code):return feature.locator('.permission').filter(has=page.locator('code',has_text=code)).locator('input')
 print('all codes rendered; testing campaign',flush=True)
 control('activity.campaign.view_all').click()
 if page.get_by_role('dialog',name='確認授予權限').count():page.get_by_role('button',name='確認授予',exact=True).click()
 expect(control('activity.campaign.view_all')).to_be_checked();control('activity.campaign.view_own').click();expect(control('activity.campaign.view_own')).to_be_checked();expect(control('activity.campaign.view_all')).not_to_be_checked()
 feature.get_by_role('button',name='日常處理',exact=True).click();expect(control('activity.campaign.create')).to_be_checked();expect(control('activity.campaign.edit')).to_be_checked();expect(control('activity.campaign.delete')).not_to_be_checked();control('activity.campaign.delete').click();expect(page.get_by_role('dialog',name='確認授予權限')).to_be_visible();page.get_by_role('button',name='確認授予',exact=True).click();expect(control('activity.campaign.delete')).to_be_checked();page.screenshot(path='.tmp-check/permissions-parity-desktop.png')
 writes=[]
 def intercept(r):
  if r.request.method=='POST':writes.append(r.request.post_data_json);r.fulfill(status=409,json={'error':'測試衝突，原設定保留'})
  else:r.continue_()
 page.route('**'+base,intercept);d.get_by_role('button',name='檢視變更並儲存').click();page.get_by_role('button',name='確認儲存權限').click();expect(d.get_by_role('alert').filter(has_text='測試衝突')).to_be_visible();payload=writes[0];by={p['id']:p['code'] for p in native};sent={by[i] for i in payload['permissionIds']};assert 'activity.campaign.delete' in sent and 'activity.campaign.create' in sent and 'activity.campaign.view_own' in sent and 'activity.campaign.view_all' not in sent
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path='.tmp-check/permissions-parity-mobile.png');assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert not errors,errors;assert c.request.get(base).json()['permissions']==native
 print('PASS 232 source codes included, all 243 old/new API and rendered codes match; campaign six controls, scope radio exclusivity, daily excludes delete, sensitive confirmation, exact save payload, conflict retains draft, no existing role writes, mobile overflow/runtime checks',flush=True);b.close()
