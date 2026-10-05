"""A small Shopify Admin API client and helpers (standard library only).

    from shopify_api import Admin
    admin = Admin()                      # settings from .env / the environment
    data = admin.graphql(query, variables)
    url = admin.upload(path, 'IMAGE')    # returns a resourceUrl for
                                         # FileSetInput.originalSource

The Admin token comes from the Dev Dashboard app's client ID and secret (the
client credentials grant). It lasts about 24 hours and lives only in memory;
key values are never printed. GraphQL errors and mutation userErrors raise
ShopifyError; throttled requests are retried.
"""

from __future__ import annotations

import json
import mimetypes
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from email.message import Message
from pathlib import Path
from typing import TYPE_CHECKING, Any

from environment import load_env

if TYPE_CHECKING:
    from collections.abc import Iterator

ADMIN_KEYS = (
    'SHOPIFY_STORE_DOMAIN',
    'SHOPIFY_API_VERSION',
    'SHOPIFY_CLIENT_ID',
    'SHOPIFY_CLIENT_SECRET',
)
REQUEST_TIMEOUT = 60  # seconds
UPLOAD_TIMEOUT = 300  # seconds
JOB_TIMEOUT = 60  # seconds
# Tries per GraphQL request when throttled, waiting 1, 2, 4... seconds.
MAX_ATTEMPTS = 6
UPLOAD_OK = (200, 201, 204)

Json = dict[str, Any]


class ShopifyError(Exception):
    """A request failed, or Shopify reported errors or userErrors."""


@dataclass
class Reply:
    """An HTTP response, or the error response for a failed status."""

    status: int
    headers: Message
    body: bytes
    # False when the server answered with an error status (4xx, 5xx).
    ok: bool


def send(request: urllib.request.Request, timeout: float) -> Reply:
    """Sends a request; an error status is returned rather than raised.

    Args:
        request: The request to send.
        timeout: Seconds to wait.

    Returns:
        The response.

    Raises:
        urllib.error.URLError: The server couldn't be reached.
    """
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return Reply(
                response.status, response.headers, response.read(), True
            )
    except urllib.error.HTTPError as error:
        return Reply(error.code, error.headers, error.read(), False)


def json_request(
    url: str, payload: object, headers: dict[str, str] | None = None
) -> urllib.request.Request:
    """Builds a POST request with a JSON body.

    Args:
        url: Where to send it.
        payload: Anything JSON-serialisable.
        headers: Extra headers.
    """
    return urllib.request.Request(
        url,
        json.dumps(payload).encode(),
        {'Content-Type': 'application/json', **(headers or {})},
    )


class Admin:
    """An authenticated Admin API session for one store."""

    def __init__(self, env: dict[str, str] | None = None) -> None:
        """Exchanges the app's client ID and secret for an access token.

        Args:
            env: Settings; by default load_env().

        Raises:
            SystemExit: A setting is missing or the token request failed.
        """
        env = env or load_env()
        missing = [key for key in ADMIN_KEYS if key not in env]
        if missing:
            raise SystemExit(f'Admin API: set {", ".join(missing)} in .env')
        self.domain = env['SHOPIFY_STORE_DOMAIN']
        self.version = env['SHOPIFY_API_VERSION']
        credentials = {
            'client_id': env['SHOPIFY_CLIENT_ID'],
            'client_secret': env['SHOPIFY_CLIENT_SECRET'],
            'grant_type': 'client_credentials',
        }
        reply = send(
            json_request(
                f'https://{self.domain}/admin/oauth/access_token', credentials
            ),
            REQUEST_TIMEOUT,
        )
        if reply.status != 200:
            raise SystemExit(
                f'Admin API: token request failed (HTTP {reply.status}); '
                'run scripts/check_shopify.py'
            )
        self._token = json.loads(reply.body)['access_token']

    def graphql(self, query: str, variables: Json | None = None) -> Json:
        """Runs a query or mutation, retrying while throttled.

        Args:
            query: The GraphQL document.
            variables: Its variables.

        Returns:
            The result's data.

        Raises:
            ShopifyError: An HTTP error, GraphQL errors, any non-empty
                userErrors in the result, or still throttled after
                MAX_ATTEMPTS tries.
        """
        url = f'https://{self.domain}/admin/api/{self.version}/graphql.json'
        payload = {'query': query, 'variables': variables or {}}
        headers = {'X-Shopify-Access-Token': self._token}
        for attempt in range(MAX_ATTEMPTS):
            reply = send(json_request(url, payload, headers), REQUEST_TIMEOUT)
            is_json = reply.body[:1] in (b'{', b'[')
            result = json.loads(reply.body) if is_json else {}
            errors = result.get('errors') or []
            throttled = reply.status == 429 or any(
                (error.get('extensions') or {}).get('code') == 'THROTTLED'
                for error in errors
            )
            if throttled and attempt < MAX_ATTEMPTS - 1:
                time.sleep(2**attempt)
                continue
            if reply.status != 200 or errors:
                raise ShopifyError(
                    f'HTTP {reply.status}: {error_detail(reply, errors)}'
                )
            data: Json = result['data']
            raise_user_errors(data)
            return data
        raise ShopifyError('throttled too many times')

    def pages(
        self, query: str, path: list[str], variables: Json | None = None
    ) -> Iterator[Json]:
        """Yields every node of a paginated connection.

        Args:
            query: Takes $after and selects pageInfo { hasNextPage endCursor }.
            path: Keys from the result's data down to the connection.
            variables: Other variables for the query.
        """
        after = None
        while True:
            connection = self.graphql(
                query, {**(variables or {}), 'after': after}
            )
            for key in path:
                connection = connection[key]
            yield from connection['nodes']
            if not connection['pageInfo']['hasNextPage']:
                return
            after = connection['pageInfo']['endCursor']

    def upload(self, path: Path, resource: str) -> str:
        """Uploads a local file to Shopify's staging storage.

        Args:
            path: The file.
            resource: Shopify's StagedUploadTargetGenerateUploadResource,
                e.g. 'IMAGE'.

        Returns:
            The resourceUrl to attach the file with.

        Raises:
            ShopifyError: The upload failed.
        """
        mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        content = path.read_bytes()
        target = self.graphql(
            STAGED_UPLOADS,
            {
                'input': [
                    {
                        'resource': resource,
                        'filename': path.name,
                        'mimeType': mime,
                        'httpMethod': 'POST',
                        'fileSize': str(len(content)),
                    }
                ]
            },
        )['stagedUploadsCreate']['stagedTargets'][0]
        boundary = uuid.uuid4().hex
        body = multipart_body(
            boundary, target['parameters'], (path.name, mime, content)
        )
        reply = send(
            urllib.request.Request(
                target['url'],
                body,
                {'Content-Type': f'multipart/form-data; boundary={boundary}'},
            ),
            UPLOAD_TIMEOUT,
        )
        if reply.status not in UPLOAD_OK:
            raise ShopifyError(
                f'upload of {path.name} failed: HTTP {reply.status} '
                f'{reply.body[:200]!r}'
            )
        resource_url: str = target['resourceUrl']
        return resource_url

    def wait_for_job(self, job: Json | None) -> None:
        """Polls an asynchronous Job (e.g. a collection reorder) until done.

        Args:
            job: The job from a mutation's result ({id, done}), or None.

        Raises:
            ShopifyError: Still running after JOB_TIMEOUT seconds.
        """
        deadline = time.time() + JOB_TIMEOUT
        while job and not job['done']:
            if time.time() > deadline:
                raise ShopifyError(
                    f'job {job["id"]} still running after {JOB_TIMEOUT}s'
                )
            time.sleep(1)
            job = self.graphql(JOB, {'id': job['id']})['job']


STAGED_UPLOADS = """mutation($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message } } }"""
JOB = 'query($id: ID!) { job(id: $id) { id done } }'


def error_detail(reply: Reply, errors: list[Json]) -> str:
    """Describes a failed GraphQL request for an error message.

    Args:
        reply: The response.
        errors: The result's GraphQL errors, if any.
    """
    if errors:
        return '; '.join(error.get('message', str(error)) for error in errors)
    return reply.body[:300].decode(errors='replace')


def multipart_body(
    boundary: str,
    fields: list[dict[str, str]],
    file: tuple[str, str, bytes],
) -> bytes:
    """Encodes form fields and one file as multipart/form-data.

    Args:
        boundary: The part separator.
        fields: Shopify's staged upload parameters ({name, value}).
        file: (filename, MIME type, content).
    """
    filename, mime, content = file
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; '
        f'name="{field["name"]}"\r\n\r\n{field["value"]}\r\n'.encode()
        for field in fields
    ]
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
        f'filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
        + content
        + f'\r\n--{boundary}--\r\n'.encode()
    )
    return b''.join(parts)


def raise_user_errors(data: Json | None) -> None:
    """Raises if any mutation in a result reports userErrors.

    Args:
        data: A GraphQL result's data.

    Raises:
        ShopifyError: Naming the mutation and listing its errors.
    """
    for name, value in (data or {}).items():
        if isinstance(value, dict) and value.get('userErrors'):
            details = '; '.join(
                f'{".".join(map(str, error.get("field") or []))} '
                f'{error["message"]}'.strip()
                for error in value['userErrors']
            )
            raise ShopifyError(f'{name}: {details}')


def metafields(node: Json) -> dict[str, str]:
    """Returns a node's metafields (selected as metafields { nodes }) by key.

    Args:
        node: A product or collection from a query.
    """
    return {
        field['key']: field['value'] for field in node['metafields']['nodes']
    }


def price_to_int(value: str) -> int:
    """Converts a Shopify money string ('2400.0') to whole rupees.

    Args:
        value: A price as Shopify returns it.
    """
    return round(float(value))


def headless_publications(admin: Admin) -> list[Json]:
    """Returns the store's Headless sales channel publications ({id, name}).

    Args:
        admin: The session.
    """
    data = admin.graphql('{ publications(first: 50) { nodes { id name } } }')
    nodes: list[Json] = data['publications']['nodes']
    return [node for node in nodes if 'headless' in node['name'].lower()]
