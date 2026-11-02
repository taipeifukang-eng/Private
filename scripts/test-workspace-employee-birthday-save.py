import json
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright
B='http://localhost:3002';fixture=json.loads(Path('.tmp-check/birthday-save-fixture.json').read_text(encoding='utf-8'));accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts']
with sync_playwright() as p:
 a=next(a for a in accounts if a['key']=='navigation');c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});assert c.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok
 text='員編,姓名,生日\n'+'\n'.join(row['employee_code']+','+row['employee_name']+',2000-02-29' for row in fixture)
 preview=c.post('/api/workspace/employee-birthdays',multipart={'file':{'name':'test.csv','mimeType':'text/csv','buffer':text.encode('utf-8')}});assert preview.ok;d=preview.json();assert d['valid'],d['errors']
 body={'requestId':str(uuid4()),'expected':d['expected'],'rows':d['rows']}
 result=c.put('/api/workspace/employee-birthdays',data=body);assert result.ok,result.status;assert result.json()['employees']==2 and result.json()['records']==2
 assert c.put('/api/workspace/employee-birthdays',data=body).json()==result.json()
 body['requestId']=str(uuid4());assert c.put('/api/workspace/employee-birthdays',data=body).status==409
 employees=c.get('/api/workspace/employees').json()['employees'];codes={r['employee_code'] for r in fixture};assert len([e for e in employees if e['employee_code'] in codes and e['birthday']=='2000-02-29'])==2
 print('PASS real birthday preview/PUT/readback, receipt retry and stale preview rejection')
