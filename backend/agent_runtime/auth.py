"""Official ChatGPT public-client OAuth. Never returns credentials to the browser."""
import base64
import hashlib
import json
import os
import secrets
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(os.environ.get('NOTLINEAR_AGENT_HOME', str(Path.home() / 'Library/Application Support/Notlinear/agents')))
AUTH = 'https://auth.openai.com'
RESOURCE = 'https://api.openai.com/v1'
REQUIRED_SCOPES = {'chatgpt.tokens.use.direct', 'resource.invoke'}


def load(name):
    try:
        return json.loads((ROOT / name).read_text())
    except FileNotFoundError:
        return {}


def save(name, data):
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = ROOT / (name + '.' + secrets.token_hex(8))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f)
    os.replace(tmp, ROOT / name)


def request_json(url, data=None, token=None):
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if data is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
        data = urlencode(data).encode()
    with urlopen(Request(url, data=data, headers=headers), timeout=30) as response:
        return json.load(response)


def validate_tokens(tokens, client_id, nonce):
    import jwt
    key = jwt.PyJWKClient(AUTH + '/.well-known/jwks.json').get_signing_key_from_jwt(tokens['id_token'])
    claims = jwt.decode(tokens['id_token'], key.key, algorithms=['RS256'],
                        audience=client_id, issuer=AUTH,
                        options={'require': ['exp', 'sub', 'iss', 'aud', 'nonce']})
    if not secrets.compare_digest(str(claims['nonce']), nonce):
        raise ValueError('Sign-in nonce mismatch. Please reconnect.')
    scopes = set(tokens.get('scope', '').split())
    if not REQUIRED_SCOPES.issubset(scopes):
        raise ValueError('ChatGPT plan usage was not authorized. Please reconnect and grant plan access.')
    return claims


def login():
    host = load('host.json')
    if not host:
        host = {'id': 'urn:uuid:' + str(uuid.uuid4())}
        save('host.json', host)
    previous = load('chatgpt.json')
    client_id = previous.get('client_id', 'dynamic_agent_client')
    state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    result = {}

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # callback query contains a one-time authorization code

        def do_GET(self):
            query = parse_qs(urlparse(self.path).query)
            valid = (urlparse(self.path).path == '/auth/callback' and
                     secrets.compare_digest(query.get('state', [''])[0], state))
            self.send_response(200 if valid else 400)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(b'Return to Notlinear to check your connection.' if valid else b'Invalid sign-in callback.')
            if valid:
                result.update({k: v[0] for k, v in query.items()})

    with HTTPServer(('127.0.0.1', 0), Callback) as server:
        server.timeout = 1
        redirect = f'http://127.0.0.1:{server.server_port}/auth/callback'
        params = dict(client_id=client_id, ext_agent_host_id=host['id'], response_type='code',
                      redirect_uri=redirect, scope='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
                      resource=RESOURCE, state=state, nonce=nonce,
                      code_challenge_method='S256', code_challenge=challenge)
        if client_id == 'dynamic_agent_client':
            params['agent_name_hint'] = 'Notlinear'
        elif previous.get('id_token'):
            params['id_token_hint'] = previous['id_token']
        if not webbrowser.open(AUTH + '/api/accounts/authorize?' + urlencode(params)):
            raise ValueError('Could not open the browser. Set your default browser and reconnect.')
        deadline = time.monotonic() + 900
        while not result and time.monotonic() < deadline:
            server.handle_request()
    if not result or result.get('error'):
        raise ValueError('Sign-in cancelled or timed out. Reconnect to try again.')
    issued = result.get('client_id', client_id)
    if issued == 'dynamic_agent_client' or (client_id != 'dynamic_agent_client' and issued != client_id):
        raise ValueError('Invalid client registration. Reconnect to try again.')
    tokens = request_json(AUTH + '/api/accounts/oauth/token', dict(
        grant_type='authorization_code', client_id=issued, code=result['code'],
        code_verifier=verifier, redirect_uri=redirect, resource=RESOURCE))
    claims = validate_tokens(tokens, issued, nonce)
    if previous and claims['sub'] != previous.get('subject'):
        raise ValueError('Account changed. Disconnect before connecting a different account.')
    save('chatgpt.json', dict(tokens, client_id=issued, subject=claims['sub'],
                             expires_at=time.time() + tokens.get('expires_in', 3600)))


def access_token():
    # Separate workers serialize refresh-token rotation using a local advisory lock.
    import fcntl
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(ROOT / 'refresh.lock', os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        saved = load('chatgpt.json')
        if not saved:
            raise ValueError('Connect ChatGPT in Settings first.')
        if saved.get('expires_at', 0) < time.time() + 60:
            tokens = request_json(AUTH + '/api/accounts/oauth/token', dict(
                grant_type='refresh_token', client_id=saved['client_id'],
                refresh_token=saved['refresh_token'], resource=RESOURCE))
            if 'scope' in tokens and not REQUIRED_SCOPES.issubset(set(tokens['scope'].split())):
                raise ValueError('ChatGPT plan authorization changed. Please reconnect.')
            saved.update(tokens)
            saved['expires_at'] = time.time() + tokens.get('expires_in', 3600)
            save('chatgpt.json', saved)
        return saved['access_token']
