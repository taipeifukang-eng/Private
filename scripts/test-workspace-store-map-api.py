import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002';f=json.loads(Path('.tmp-check/store-map-fixture.json').read_text(encoding='utf-8'));accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts']
with sync_playwright() as p:
 def login(a):
  c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});assert c.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok;return c
 admin=login(next(a for a in accounts if a['key']=='navigation'));r=admin.get('/api/workspace/store-map?inactive=true');assert r.ok;fixture={s['id'] for s in f['stores']};print('Returned',len(r.json()['stores']),'fixture',len(fixture & {s['id'] for s in r.json()['stores']}),flush=True);assert len(fixture & {s['id'] for s in r.json()['stores']})==1005;r=admin.get('/api/workspace/store-map');assert len(fixture & {s['id'] for s in r.json()['stores']})==1004
 c=login(f['actors'][0]);r=c.get('/api/workspace/store-map?inactive=true');assert r.ok,r.status;d=r.json();allow='--inactive' in sys.argv;assert d['canInactive']==allow;assert {s['id'] for s in f['stores'][:2 if allow else 1]}=={s['id'] for s in d['stores']};session=c.get('/api/workspace/session');assert session.ok and session.json()['capabilities']['storeMap']
 viewer=login(next(a for a in accounts if a['key']=='viewer'));assert viewer.get('/api/workspace/store-map?inactive=true').status==403;print('PASS 1005 stores fully paginated, inactive permission enforced, view-only actor restricted to assigned active store, viewer denied',flush=True)
