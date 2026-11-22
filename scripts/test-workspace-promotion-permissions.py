import json,sys,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002';f=json.loads(Path('.tmp-check/promotion-load-fixture.json').read_text(encoding='utf-8'));actors=json.loads(Path('.tmp-check/promotion-permissions-fixture.json').read_text(encoding='utf-8'))['actors'];url='/api/workspace/store-promotions?store='+f['store']['id'];assigned='--assigned' in sys.argv
with sync_playwright() as p:
 for a in actors:
  c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});r=c.post('/api/workspace/login',data={'email':a['email'],'password':a['password']});assert r.ok,(a['key'],r.status);allowed=a['key'] in ['assistant','manager'];r=c.get(url);assert r.status==(200 if allowed and assigned else 404 if allowed else 403),(a['key'],r.status,r.text());r=c.post(url,data={'operation':'validate','rows':[f['rows'][0]]});assert r.status==(200 if allowed and assigned else 404 if allowed else 403),(a['key'],r.status,r.text());r=c.post(url,data={'operation':'save','rows':[f['rows'][0]]});assert r.status==(400 if allowed and assigned else 404 if allowed else 403),(a['key'],r.status,r.text())
  if allowed and assigned:
   row={**f['rows'][0 if a['key']=='assistant' else 1],'effective_date':'2099-01-01','position':'經理','notes':'權限寫入驗證'}
   r=c.post(url,data={'operation':'validate','rows':[row]});assert r.ok and r.json()['valid'],(a['key'],r.text())
   r=c.post(url,data={'operation':'save','rows':[row],'expected':r.json()['expected'],'requestId':str(uuid.uuid4())});assert r.ok,(a['key'],r.status,r.text())
  c.dispose()
 print('PASS profile/RBAC/RLS boundary, assigned='+str(assigned),flush=True)
