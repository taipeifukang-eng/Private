import json
from pathlib import Path
from uuid import uuid4
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:3002'
accounts = json.loads(Path('.tmp-check/workspace-accounts.json').read_text(encoding='utf-8'))['accounts']
with sync_playwright() as p:
    anonymous = p.request.new_context(base_url=BASE)
    assert anonymous.get('/api/workspace/organization').status == 401
    def login(key):
        account = next(a for a in accounts if a['key'] == key)
        client = p.request.new_context(base_url=BASE, extra_http_headers={'Origin': BASE})
        assert client.post('/api/workspace/login', data={'email': account['email'], 'password': account['password']}).ok
        return client
    admin = login('navigation')
    response = admin.get('/api/workspace/organization')
    assert response.ok, response.status
    catalog = response.json()
    assert isinstance(catalog['units'], list) and len(catalog['version']) == 32
    assert all(catalog['capabilities'].values())
    assert admin.get('/api/workspace/organization-people?q=not-a-real-person-search-27438').json()['people'] == []
    viewer = login('viewer')
    assert viewer.get('/api/workspace/organization').status == 403
    assert viewer.get('/api/workspace/organization-people').status == 403
    body = {'requestId': str(uuid4()), 'expected': catalog['version'], 'operation': 'hierarchy', 'data': {'updates': []}}
    assert viewer.post('/api/workspace/organization', data=body).status == 403
    assert admin.post('/api/workspace/organization', data=body).status == 400
    assert admin.post('/api/workspace/organization', data=body, headers={'Origin': 'https://invalid.example'}).status == 403
    body['operation'] = '__proto__'
    assert admin.post('/api/workspace/organization', data=body).status == 400
    assert admin.get('/api/workspace/organization').json()['version'] == catalog['version']
    print('PASS organization catalog, people search, authentication, authorization, origin and invalid-operation rejection; no writes')
