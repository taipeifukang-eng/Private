import csv,io,json
from pathlib import Path
from playwright.sync_api import sync_playwright
B='http://localhost:3002';accounts=json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts']
with sync_playwright() as p:
 def login(key):
  a=next(a for a in accounts if a['key']==key);c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B});assert c.post('/api/workspace/login',data={'email':a['email'],'password':a['password']}).ok;return c
 admin=login('navigation');viewer=login('viewer')
 def upload(client,text,name='birthdays.csv',origin=B):return client.post('/api/workspace/employee-birthdays',headers={'Origin':origin},multipart={'file':{'name':name,'mimeType':'text/csv','buffer':text.encode('utf-8')}})
 text='員編,姓名,生日\nNO-SUCH-EMPLOYEE,驗證,2000-02-29'
 result=upload(admin,text);assert result.ok;data=result.json();assert not data['valid'] and len(data['errors'])==1 and '查無員編' in data['errors'][0]['message']
 assert upload(viewer,text).status==403
 assert upload(admin,text,origin='https://invalid.example').status==403
 assert upload(admin,text,name='birthdays.xlsx').status==400
 assert upload(admin,'員編,姓名,生日\nA,"未閉合,2000-02-29').status==400
 invalid=upload(admin,'員編,姓名,生日\nA,驗證,2023-02-29').json();assert not invalid['valid'] and invalid['errors'][0]['row']==2
 # Existing master rows are checked using their real names without printing personal data.
 before=admin.get('/api/workspace/employees');assert before.ok
 checked=0
 for employee in before.json()['employees']:
  buffer=io.StringIO();writer=csv.writer(buffer);writer.writerow(['員編','姓名','生日']);writer.writerow([employee['employee_code'],employee['employee_name'],'2000-02-29']);preview=upload(admin,buffer.getvalue()).json()
  if preview['valid']:
   assert preview['rows'][0]['birthday']=='2000-02-29';checked=1;break
 assert checked,'Need an accessible master employee to validate preview'
 after=admin.get('/api/workspace/employees');assert after.ok and after.json()['employees']==before.json()['employees']
 print('PASS real birthday preview: valid master/name, missing master, bad date/CSV/file, origin, permissions and unchanged employee readback')
