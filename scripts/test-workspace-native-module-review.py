import json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
B='http://localhost:3002';D=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'));F=json.loads(Path('.tmp-check/five-module-fixtures.json').read_text());results=[]
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(base_url=B,viewport={'width':1440,'height':1000},extra_http_headers={'Origin':B});a=next(a for a in D['accounts'] if a['key']=='navigation');assert c.request.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 session=c.request.get('/api/workspace/session').json();page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('/workspace/index.html');page.get_by_label('新頁預設門市').select_option(F['store'])
 for group in session['navigation']:
  for item in group['items']:
   if not item.get('kind'):continue
   page.locator('.sidebar').hover();page.locator('.nav-search input').fill(item['label']);page.locator('.module-trigger').filter(has_text=group['label']).hover();page.get_by_role('navigation').get_by_role('button',name=item['label']+' 新版',exact=True).click()
   panel=page.locator('[role=tabpanel]:visible');expect(panel.locator('h1')).to_be_visible(timeout=30000);page.wait_for_load_state('networkidle');expect(panel.get_by_role('status').filter(has_text=re.compile('載入|讀取'))).to_have_count(0,timeout=30000)
   alerts=panel.get_by_role('alert').all_text_contents();results.append({'module':item['label'],'kind':item['kind'],'headings':panel.locator('h1,h2').all_text_contents(),'alerts':alerts});print(item['kind'],'alerts',len(alerts),flush=True)
   page.screenshot(path='.tmp-check/review-'+item['kind']+'.png')
 assert not errors,errors
 Path('.tmp-check/native-modules-review.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');b.close()
