"""Extra real DEV endpoints, scoped to one owned temporary campaign/event."""
import os,uuid,base64,subprocess,json
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002';cid=None;event=None
with sync_playwright() as p:
 c=p.request.new_context(base_url=B,timeout=60000);assert c.post('/api/workspace/login',data={'email':'administrator','password':os.environ['WORKSPACE_TEST_PASSWORD']},headers={'Origin':B}).ok
 def get(resource,**query):
  r=c.get('/api/workspace/campaign-tools',params={'resource':resource,'campaign_id':cid,**query});assert r.ok,(resource,r.status);return r.json()
 def write(resource,body,method='POST',**query):
  r=c.fetch('/api/workspace/campaign-tools',method=method,params={'resource':resource,**query},data=body,headers={'Origin':B});assert r.ok,(resource,r.status,r.json().get('error'));return r.json()
 r=c.post('/api/workspace/campaigns',data={'name':'DEV附件驗證-'+uuid.uuid4().hex[:8],'start_date':'2026-11-01','end_date':'2026-11-30','campaign_type':'inventory','is_active':True,'requestId':str(uuid.uuid4())},headers={'Origin':B});assert r.ok;cid=r.json()['record']['id']
 try:
  assert c.post('/api/workspace/campaign-tools?resource=details',data={},headers={'Origin':'https://invalid.example'}).status==403
  anonymous=p.request.new_context(base_url=B);assert anonymous.get('/api/workspace/campaign-tools?resource=permissions').status==401;anonymous.dispose()
  stores=get('stores')['data'];a,b=stores[:2]
  for text in ['外盤廠商','']:
   write('details',{'campaign_id':cid,'store_id':a['id'],'has_external_inventory_company':text,'planned_inventory_time':'18:00','inventory_staff':'驗證人員'})
   assert (get('details',store_id=a['id'])['data'][0]['has_external_inventory_company'] or '')==text
  first=write('checklist',{'campaign_id':cid,'task_name':'前置 A'})['data'];second=write('checklist',{'campaign_id':cid,'task_name':'前置 B'})['data']
  write('checklist-order',{'campaign_id':cid,'ids':[second['id'],first['id']]},'PUT');assert get('checklist')['data'][0]['id']==second['id']
  write('checklist',{'id':first['id'],'task_name':'前置 A 修正','deadline':None},'PUT');write('checklist',None,'DELETE',id=first['id'])
  request=write('requests',{'campaign_id':cid,'requesting_store_id':a['id'],'supporting_store_id':b['id'],'requested_count':2})['data']
  own=get('employees',store_id=b['id'])['data'];assert own
  row={k:own[0][k] for k in ['employee_code','employee_name','position']}
  state=get('supportStaff',support_request_id=request['id']);payload={'campaign_id':cid,'scope':request['id'],'rows':[row],'version':state['version'],'requestId':str(uuid.uuid4())}
  write('supportStaff',payload,'PUT');write('supportStaff',payload,'PUT');assert len(get('supportStaff',support_request_id=request['id'])['data'])==1
  write('requests',{'id':request['id']},'DELETE');assert not get('supportStaff')['data']
  trip=write('trips',{'campaign_id':cid,'set_number':1,'trip_date':'2026-11-04','from_location':'車上','to_location':a['store_name']})['data'];write('trips',{**trip,'set_number':2},'PUT');assert get('trips')['data'][0]['set_number']==2;write('trips',None,'DELETE',id=trip['id'])
  dates={r['event_date'] for r in get('events')['events']};date=next('2098-12-'+str(d).zfill(2) for d in range(1,29) if '2098-12-'+str(d).zfill(2) not in dates)
  event=write('events',{'event_date':date,'description':'DEV日期驗證','event_type':'other','is_blocked':True})['event'];assert event['is_blocked'];write('events',None,'DELETE',id=event['id']);event=None
  pixel=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=')
  r=c.post('/api/workspace/campaign-tools?resource=assets',headers={'Origin':B},multipart={'campaign_id':cid,'department':'marketing','files':{'name':'fixture.png','mimeType':'image/png','buffer':pixel}});assert r.ok,(r.status,r.json().get('error'));asset=r.json()['data']
  write('departments',{'campaign_id':cid,'department':'marketing','marketing_content':'圖檔驗證','marketing_image_paths':asset['paths'],'marketing_image_names':asset['names']})
  dept=get('departments')['data'];assert dept['marketing_image_names']==['fixture.png'];r=c.get(dept['marketing_image_urls'][0]);assert r.ok and r.body()==pixel
  image='data:image/png;base64,'+base64.b64encode(pixel).decode();file='data:application/vnd.ms-excel;base64,'+base64.b64encode(b'fixture').decode()
  write('departments',{'campaign_id':cid,'department':'merchandise','merchandise_gift_rules_name':'fixture.png','merchandise_gift_rules_data':image,'merchandise_allocation_file_name':'fixture.xls','merchandise_allocation_file_data':file})
  dept=get('departments')['data'];assert dept['merchandise_gift_rules_data']==image and dept['merchandise_allocation_file_data']==file
  write('departments',{'campaign_id':cid,'department':'merchandise','merchandise_gift_rules_data':None,'merchandise_allocation_file_data':None});assert get('departments')['data']['merchandise_gift_rules_data'] is None
  print('PASS DEV authentication/origin, inventory field clearing, checklist reorder/edit/delete, support assignment retry/delete cascade, trip edit/delete, special date add/delete, real private image upload/signed download, merchandise attachments/remove')
 finally:
  if event:write('events',None,'DELETE',id=event['id'])
  if cid:
   subprocess.run(['node','scripts/test-workspace-campaign-assets-clean.cjs',cid],check=True)
   latest=c.get('/api/workspace/campaigns',params={'id':cid}).json()['records'][0];assert latest['name'].startswith('DEV附件驗證-')
   assert c.delete('/api/workspace/campaigns',params={'id':cid,'version':latest['workspace_version']},headers={'Origin':B}).ok
   uuid.UUID(cid);Path('.tmp-check/campaign-api-clean.sql').write_text("DELETE FROM workspace_campaign_requests WHERE payload->>'campaign'='"+cid+"'; SELECT count(*) leftovers FROM campaigns WHERE id='"+cid+"';",encoding='utf-8')
   subprocess.run(['node','scripts/dev-cleanup-query.cjs','.tmp-check/campaign-api-clean.sql','.tmp-check/campaign-api-clean.json'],check=True)
