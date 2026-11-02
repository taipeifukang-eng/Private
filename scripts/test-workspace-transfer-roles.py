import json
from pathlib import Path
from playwright.sync_api import sync_playwright

B='http://localhost:3002'
f=json.loads(Path('.tmp-check/transfer-roles-fixture.json').read_text())
with sync_playwright() as p:
    clients={}
    for user in f['users']:
        c=p.request.new_context(base_url=B,extra_http_headers={'Origin':B})
        assert c.post('/api/workspace/login',data={'email':user['email'],'password':user['password']}).ok
        clients[user['key']]=c
        result=c.get('/api/workspace/transfers?status=all')
        assert result.ok,result.text()
        rows={r['id']:r for r in result.json()['rows'] if r['id'] in f['requests']}
        expected=f['requests'] if user['key'] in ['create','both'] else (f['requests'][:2] if user['key']=='confirm' else [])
        assert set(rows)==set(expected),(user['key'],rows.keys())
        for id,row in rows.items():
            assert row['canReject']==(user['key'] in ['confirm','both'] and id in f['requests'][:2])
    def reject(key,index):
        return clients[key].post('/api/workspace/transfers',data={'operation':'reject','id':f['requests'][index]})
    preview={'id':f['requests'][0],'effective_date':'2028-02-29'}
    r=clients['confirm'].post('/api/workspace/transfers/preview',data=preview)
    assert r.ok,r.text()
    result=r.json();assert result['validationOnly'] is False and result['canSubmit'] is False
    assert result['changes']==[] and len(result['conflicts'])>=1
    assert clients['create'].post('/api/workspace/transfers/preview',data=preview).status==403
    assert clients['confirm'].post('/api/workspace/transfers/preview',data={**preview,'id':f['requests'][2]}).status==404
    assert clients['confirm'].post('/api/workspace/transfers/preview',data={**preview,'effective_date':'2026-02-29'}).status==400
    assert clients['confirm'].post('/api/workspace/transfers/preview',data=preview,headers={'Origin':'https://invalid.example'}).status==403
    assert reject('create',0).status==403
    assert reject('confirm',2).status==404
    assert reject('both',2).status==403
    assert reject('unmanaged',0).status==404
    assert reject('confirm',0).ok
    assert reject('both',1).ok
    assert reject('both',0).status==409
    assert reject('confirm',0).json()['alreadyRejected'] is True
    assert clients['confirm'].post('/api/workspace/transfers/preview',data=preview).status==409
    print('PASS read-only transfer preview: leap date, empty month plan, no submit, create-only/scope/origin denial and handled-state conflict')
    print('PASS isolated transfer roles: create/confirm/both/unmanaged; source/destination scope; rejection and cross-actor conflict')
