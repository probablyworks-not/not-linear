"""Loopback-only SDK process bridge. Standard library only; no credentials in HTTP."""
import atexit
import json
import os
import secrets
import signal
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

PREFIX = '/__notlinear_agents/'
TOKEN = secrets.token_urlsafe(32)
WORKER = Path(__file__).parent / 'agent_runtime/worker.py'
LOCK = threading.RLock()
JOBS = {}
MAX_PAYLOAD = 40 * 1024 * 1024
MAX_EVENTS_BYTES = 8 * 1024 * 1024


def interpreter():
    return Path(os.environ.get('NOTLINEAR_AGENT_PYTHON', str(
        Path.home() / 'Library/Application Support/Notlinear/agents/venv/bin/python')))


def valid_origin(headers):
    host = headers.get('Host', '')
    if urlparse('http://' + host).hostname not in ('localhost', '127.0.0.1', '::1'):
        return False
    origin = headers.get('Origin')
    return (not origin or origin == 'http://' + host) and headers.get('X-Notlinear-Agent') == '1'


def stop(job):
    proc = job['process']
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


@atexit.register
def shutdown():
    for job in list(JOBS.values()):
        stop(job)


def start(payload):
    if not interpreter().is_file():
        raise ValueError('Install the subscription companion: python3 backend/agent_runtime/setup.py')
    with LOCK:
        now = time.monotonic()
        for key, job in list(JOBS.items()):
            if job['finished'] and now - job['created'] > 600:
                del JOBS[key]
        if sum(not j['finished'] for j in JOBS.values()) >= 8:
            raise ValueError('Too many active subscription operations. Stop one and retry.')
        if payload['action'] in ('connect', 'disconnect'):
            if any(not j['finished'] and j['provider'] == payload.get('provider') for j in JOBS.values()):
                raise ValueError('Stop active requests for this provider before changing its connection.')
        env = os.environ.copy()
        env['PATH'] = env.get('PATH', '') + ':/opt/homebrew/bin:/usr/local/bin'
        proc = subprocess.Popen([str(interpreter()), str(WORKER)], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, start_new_session=True, env=env)
        job_id = secrets.token_urlsafe(24)
        job = {'process': proc, 'provider': payload.get('provider'), 'action': payload['action'], 'events': [],
               'finished': False, 'created': now, 'last_poll': now, 'bytes': 0}
        JOBS[job_id] = job

    def collect():
        try:
            proc.stdin.write(json.dumps(payload) + '\n'); proc.stdin.close()
            for line in proc.stdout:
                event = json.loads(line)
                with LOCK:
                    job['bytes'] += len(line)
                    if job['bytes'] > MAX_EVENTS_BYTES:
                        job['events'].append({'type': 'error', 'message': 'Response exceeded the local buffer limit. Partial output is retained.'})
                        break
                    job['events'].append(event)
            stop(job)
            with LOCK:
                if not job['events'] or job['events'][-1]['type'] not in ('done', 'error', 'result', 'cancelled'):
                    job['events'].append({'type': 'error', 'message': 'Subscription runtime stopped before completion.'})
        except Exception:
            with LOCK:
                job['events'].append({'type': 'error', 'message': 'Subscription runtime failed. Check setup and reconnect.'})
            stop(job)
        finally:
            with LOCK:
                job['finished'] = True
            proc.stdout.close()

    def watchdog():
        while not job['finished']:
            time.sleep(2)
            now = time.monotonic()
            if now - job['created'] > (960 if job['action'] == 'connect' else 600) or (job['action'] != 'connect' and now - job['last_poll'] > 60):
                stop(job)
                break

    threading.Thread(target=collect, daemon=True).start()
    threading.Thread(target=watchdog, daemon=True).start()
    return job_id


def respond(handler, code, data):
    body = json.dumps(data).encode()
    handler.send_response(code)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()
    handler.wfile.write(body)


def handle(handler):
    path = handler.path.split('?', 1)[0]
    if not path.startswith(PREFIX):
        return False
    try:
        if not valid_origin(handler.headers):
            respond(handler, 403, {'error': 'Subscription access is restricted to this local app.'})
            return True
        if path == PREFIX + 'session':
            respond(handler, 200, {'token': TOKEN, 'installed': interpreter().is_file()})
            return True
        if not secrets.compare_digest(handler.headers.get('X-Notlinear-Session', ''), TOKEN):
            respond(handler, 403, {'error': 'Local session expired. Reload Notlinear.'})
            return True
        length = int(handler.headers.get('Content-Length', '0'))
        if length <= 0 or length > MAX_PAYLOAD:
            raise ValueError('Request is empty or too large.')
        payload = json.loads(handler.rfile.read(length))
        if path == PREFIX + 'start':
            if payload.get('action') not in ('status', 'connect', 'disconnect', 'models', 'run'):
                raise ValueError('Unknown operation.')
            if payload['action'] != 'status' and payload.get('provider') not in ('claude', 'chatgpt'):
                raise ValueError('Unknown provider.')
            if payload['action'] == 'run':
                if not isinstance(payload.get('model'), str) or not payload['model'] or len(payload['model']) > 200:
                    raise ValueError('Choose an available subscription model.')
                if not isinstance(payload.get('messages'), list) or not payload['messages']:
                    raise ValueError('No conversation was supplied.')
            respond(handler, 200, {'id': start(payload)})
        elif path in (PREFIX + 'poll', PREFIX + 'cancel'):
            with LOCK:
                job = JOBS.get(payload.get('id'))
                if job is None:
                    raise ValueError('This run is no longer available. It may have been interrupted by a restart.')
                job['last_poll'] = time.monotonic()
            if path.endswith('cancel'):
                stop(job)
                respond(handler, 200, {'cancelled': True})
            else:
                cursor = payload.get('cursor', 0)
                if not isinstance(cursor, int) or cursor < 0:
                    raise ValueError('Invalid event cursor.')
                with LOCK:
                    respond(handler, 200, {'events': job['events'][cursor:], 'cursor': len(job['events']), 'finished': job['finished']})
        else:
            respond(handler, 404, {'error': 'Unknown subscription endpoint.'})
    except (ValueError, TypeError) as exc:
        respond(handler, 400, {'error': str(exc)})
    return True
