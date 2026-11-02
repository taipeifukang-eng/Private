import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright

B='http://localhost:3002'
f=json.loads(Path('.tmp-check/transfer-roles-fixture.json').read_text())
async def main():
 async with async_playwright() as p:
  clients={}
  for key in ['confirm','both']:
   user=next(u for u in f['users'] if u['key']==key)
   c=await p.request.new_context(base_url=B,extra_http_headers={'Origin':B})
   response=await c.post('/api/workspace/login',data={'email':user['email'],'password':user['password']})
   assert response.ok,await response.text()
   clients[key]=c
  for race in f['races']:
   preview=await clients['confirm'].post('/api/workspace/transfers/preview',data={'id':race['id'],'effective_date':'2026-07-15'})
   assert preview.ok,await preview.text()
   data=await preview.json();assert data['canSubmit'],data
   payload={'id':race['id'],'effective_date':'2026-07-15','version':data['version']}
   a=clients['confirm'].post('/api/workspace/transfers/confirm',data=payload)
   if race['kind']=='confirm-reject':
    b=clients['both'].post('/api/workspace/transfers',data={'operation':'reject','id':race['id']})
   else:
    b=clients['confirm' if race['kind']=='same-actor' else 'both'].post('/api/workspace/transfers/confirm',data=payload)
   results=await asyncio.gather(a,b)
   expected=[200,200] if race['kind']=='same-actor' else [200,409]
   assert sorted(r.status for r in results)==expected,[(r.status,await r.text()) for r in results]
   response=await clients['confirm'].get('/api/workspace/transfers?status=all')
   saved=next(r for r in (await response.json())['rows'] if r['id']==race['id'])
   assert saved['status'] in ['confirmed','rejected']
   if race['kind']!='confirm-reject':assert saved['status']=='confirmed'
   if race['kind']=='same-actor':
    bodies=[await r.json() for r in results]
    assert sum(bool(body.get('alreadyConfirmed')) for body in bodies)==1
   print('PASS simultaneous '+race['kind']+': '+str([r.status for r in results])+'; final='+saved['status'])
  for c in clients.values():await c.dispose()
asyncio.run(main())
