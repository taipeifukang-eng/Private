import json
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002';f=json.loads(Path('.tmp-check/store-personnel-fixture.json').read_text(encoding='utf-8'));accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts']
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});a=next(a for a in accounts if a['key']=='navigation');assert c.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 url='/api/workspace/store-promotions?store='+f['store']['id'];r=c.get(url);assert r.ok,r.text();assert '代理店長' in r.json()['positions'];r=c.get(url+'&template=true');assert r.ok and 'spreadsheetml' in r.headers['content-type'];Path('.tmp-check/promotion-template.xlsx').write_bytes(r.body())
 before=c.get('/api/workspace/store-personnel?store='+f['store']['id']+'&employee='+f['employees'][0]['id']).json()['history']
 row={'employee_code':f['employees'][0]['employee_code'],'employee_name':'歷程測試員工1','position':'店長','newbie_level':'','effective_date':'2026/10/01','notes':'預覽不寫入'}
 r=c.post(url,data={'operation':'validate','rows':[row]});assert r.ok,r.text();assert r.json()['valid'];assert r.json()['rows'][0]['effective_date']=='2026-10-01'
 r=c.post(url,data={'operation':'validate','rows':[{**row,'employee_name':'錯誤姓名'}]});assert r.ok and not r.json()['valid'];assert any('姓名與門市' in e['message'] for e in r.json()['errors'])
 r=c.post(url,data={'operation':'validate','rows':[{**row,'employee_code':'NOT-IN-STORE'}]});assert r.ok and not r.json()['valid']
 r=c.post(url,multipart={'file':{'name':'valid.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':Path('.tmp-check/promotion-valid.xlsx').read_bytes()}});assert r.ok,r.text();assert r.json()['valid'];assert r.json()['sourceRows']==[2]
 assert c.post(url,data={'operation':'save','rows':[row]}).status==400
 assert c.post(url,multipart={'file':{'name':'template.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':Path('.tmp-check/promotion-template.xlsx').read_bytes()}}).status==400
 assert c.post(url,multipart={'file':{'name':'bad.txt','mimeType':'text/plain','buffer':b'abc'}}).status==400
 assert c.post(url,data={'operation':'validate','rows':[row]},headers={'Origin':'https://invalid.example'}).status==403
 v=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});a=next(a for a in accounts if a['key']=='viewer');assert v.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok;assert v.get(url).status==403;assert v.post(url,data={'operation':'validate','rows':[row]}).status==403
 after=c.get('/api/workspace/store-personnel?store='+f['store']['id']+'&employee='+f['employees'][0]['id']).json()['history'];assert before==after
 print('PASS DEV preview API: settings/template, normalization, employee/name validation, invalid operations/files, Origin, viewer permissions, no history writes',flush=True)
