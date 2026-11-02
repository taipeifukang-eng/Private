import json
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002';accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts']
with sync_playwright() as p:
 anon=p.request.new_context(base_url=B);assert anon.get('/api/workspace/department-work').status==401
 clients={}
 for key in ['navigation','viewer']:
  actor=next(a for a in accounts if a['key']==key);c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});assert c.post('/api/workspace/login',data={'email':actor['email'],'password':actor['password']}).ok;clients[key]=c
 admin=clients['navigation'];viewer=clients['viewer']
 r=admin.get('/api/workspace/department-work');assert r.ok and isinstance(r.json()['departments'],list) and r.json()['canManage']
 assert admin.get('/api/workspace/department-work?people=true').ok
 assert admin.get('/api/workspace/department-work?department=invalid').status==400
 assert admin.get('/api/workspace/department-work?department=00000000-0000-4000-8000-000000000000').status==404
 assert admin.post('/api/workspace/department-work',data={}).status==400
 assert admin.post('/api/workspace/department-work',data={},headers={'Origin':'https://invalid.example'}).status==403
 assert viewer.get('/api/workspace/department-work').status==403
 assert viewer.get('/api/workspace/department-work?people=true').status==403
 assert viewer.post('/api/workspace/department-work',data={}).status==403
 print('PASS department work API authentication, read/list/people, invalid IDs/payload, origin and unauthorized access; no business writes')
