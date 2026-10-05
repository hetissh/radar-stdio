"""Small Shopify Admin API client for the tools (standard library only). Never prints key values.

    from shopify_api import Admin
    admin = Admin()                      # reads .env / the environment via build_config.load_env()
    data = admin.graphql(query, variables)
    url = admin.upload(path, 'IMAGE')    # staged upload; returns a resourceUrl for FileSetInput.originalSource

The Admin token comes from the Dev Dashboard app's client ID and secret (client credentials grant). It lasts about
24 hours and lives only in memory. GraphQL errors and mutation userErrors raise ShopifyError; throttling is retried.
"""
from build_config import load_env
import json
import mimetypes
import time
import urllib.error
import urllib.request
import uuid


class ShopifyError(Exception):
    pass


def _request(url, body, headers, timeout=60):
    request = urllib.request.Request(url, body, headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


class Admin:
    def __init__(self, env=None):
        env = env or load_env()
        missing = [k for k in ('SHOPIFY_STORE_DOMAIN', 'SHOPIFY_API_VERSION', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET') if k not in env]
        if missing:
            raise SystemExit('Admin API: set ' + ', '.join(missing) + ' in .env')
        self.domain, self.version = env['SHOPIFY_STORE_DOMAIN'], env['SHOPIFY_API_VERSION']
        status, body = _request(f'https://{self.domain}/admin/oauth/access_token',
                                json.dumps({'client_id': env['SHOPIFY_CLIENT_ID'], 'client_secret': env['SHOPIFY_CLIENT_SECRET'],
                                            'grant_type': 'client_credentials'}).encode(),
                                {'Content-Type': 'application/json'})
        if status != 200:
            raise SystemExit(f'Admin API: token request failed (HTTP {status}); run scripts/check_shopify.py')
        self._token = json.loads(body)['access_token']

    def graphql(self, query, variables=None, attempts=6):
        """Run a query or mutation. Raises on errors and on any non-empty userErrors in the result."""
        payload = json.dumps({'query': query, 'variables': variables or {}}).encode()
        for attempt in range(attempts):
            status, body = _request(f'https://{self.domain}/admin/api/{self.version}/graphql.json', payload,
                                    {'Content-Type': 'application/json', 'X-Shopify-Access-Token': self._token})
            result = json.loads(body) if body[:1] in (b'{', b'[') else {}
            errors = result.get('errors') or []
            throttled = status == 429 or any((e.get('extensions') or {}).get('code') == 'THROTTLED' for e in errors)
            if throttled and attempt < attempts - 1:
                time.sleep(2 ** attempt)
                continue
            if status != 200 or errors:
                detail = '; '.join(e.get('message', str(e)) for e in errors) if errors else body[:300].decode(errors='replace')
                raise ShopifyError(f'HTTP {status}: {detail}')
            _raise_user_errors(result['data'])
            return result['data']
        raise ShopifyError('throttled too many times')

    def pages(self, query, path, variables=None):
        """Yield every node of a connection. The query takes $after and selects pageInfo { hasNextPage endCursor }."""
        after = None
        while True:
            data = self.graphql(query, {**(variables or {}), 'after': after})
            for key in path:
                data = data[key]
            yield from data['nodes']
            if not data['pageInfo']['hasNextPage']:
                return
            after = data['pageInfo']['endCursor']

    def upload(self, path, resource):
        """Upload a local file to Shopify's staging storage; return the resourceUrl to attach it with."""
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        content = path.read_bytes()
        target = self.graphql('''mutation($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }''',
            {'input': [{'resource': resource, 'filename': path.name, 'mimeType': mime, 'httpMethod': 'POST',
                        'fileSize': str(len(content))}]})['stagedUploadsCreate']['stagedTargets'][0]
        boundary = uuid.uuid4().hex
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{p["name"]}"\r\n\r\n{p["value"]}\r\n'.encode()
                 for p in target['parameters']]
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
                     f'Content-Type: {mime}\r\n\r\n'.encode() + content + f'\r\n--{boundary}--\r\n'.encode())
        status, body = _request(target['url'], b''.join(parts), {'Content-Type': f'multipart/form-data; boundary={boundary}'}, timeout=300)
        if status not in (200, 201, 204):
            raise ShopifyError(f'upload of {path.name} failed: HTTP {status} {body[:200]!r}')
        return target['resourceUrl']

    def wait_for_job(self, job, timeout=60):
        """Poll an asynchronous Job until done (e.g. collectionReorderProducts)."""
        deadline = time.time() + timeout
        while job and not job['done']:
            if time.time() > deadline:
                raise ShopifyError(f'job {job["id"]} still running after {timeout}s')
            time.sleep(1)
            job = self.graphql('query($id: ID!) { job(id: $id) { id done } }', {'id': job['id']})['job']


def _raise_user_errors(data):
    for name, value in (data or {}).items():
        if isinstance(value, dict) and value.get('userErrors'):
            raise ShopifyError(name + ': ' + '; '.join(f'{".".join(map(str, e.get("field") or []))} {e["message"]}'.strip()
                                                     for e in value['userErrors']))
