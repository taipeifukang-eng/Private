import os,uuid,json,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002';A='/api/workspace/pharmacists/'
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B},timeout=60000)
 assert c.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']}).ok
 def ok(r):
  assert r.ok,(r.status,r.text());return r.json()
 locks=ok(c.get(A+'month-lock'))['data'];assert not any(x['year_month']>='2099-12' for x in locks)
 store=json.loads(Path('.tmp-check/pharmacists-overview.json').read_text(encoding='utf-8'))['rows'][0]['store_id']
 code='VUEPH'+uuid.uuid4().hex[:12].upper();locked=False
 body={'year_month':'2099-12','store_id':store,'employee_code':code,'employee_name':'月度補入測試','position':'藥師'}
 try:
  ok(c.post(A+'monthly-manual',data=body));ok(c.post(A+'month-lock',data={'year_month':'2099-12'}));locked=True
  assert c.post(A+'monthly-manual',data=body).status==409
  ok(c.delete(A+'month-lock',data={'year_month':'2099-12'}));locked=False
  print('PASS monthly manual add, lock, rejects locked insert409, unlock',flush=True)
 finally:
  if locked:ok(c.delete(A+'month-lock',data={'year_month':'2099-12'}))
  sql=Path('.tmp-check/pharmacist-month-cleanup.sql');sql.write_text("DELETE FROM public.pharmacist_monthly_snapshot WHERE employee_code='"+code+"' AND year_month='2099-12';",encoding='utf-8');subprocess.run(['node','scripts/dev-cleanup-query.cjs',str(sql).replace('\\','/'),'.tmp-check/pharmacist-month-cleanup.json'],check=True)

