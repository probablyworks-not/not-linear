"""Loopback-only access to the optional subscription runtime."""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import subscriptions

router = APIRouter()

@router.post('/__notlinear_agents/{operation}')
async def agent_operation(operation: str, request: Request):
    if not subscriptions.valid_origin(request.headers):
        return JSONResponse({'error':'Subscription access is restricted to this local app.'}, status_code=403)
    if operation == 'session':
        return {'token': subscriptions.TOKEN, 'installed': subscriptions.interpreter().is_file()}
    import secrets
    if not secrets.compare_digest(request.headers.get('X-Notlinear-Session', ''), subscriptions.TOKEN):
        return JSONResponse({'error':'Local session expired. Reload Notlinear.'}, status_code=403)
    try:
        data = await request.json()
        if operation == 'start':
            if data.get('action') not in ('status', 'connect', 'disconnect', 'models', 'run'):
                raise ValueError('Unknown operation.')
            if data['action'] != 'status' and data.get('provider') not in ('claude', 'chatgpt'):
                raise ValueError('Unknown provider.')
            return {'id': subscriptions.start(data)}
        if operation not in ('poll', 'cancel'):
            return JSONResponse({'error':'Unknown operation.'}, status_code=404)
        import time
        with subscriptions.LOCK:
            job = subscriptions.JOBS.get(data.get('id'))
            if job is None:
                raise ValueError('This run is no longer available.')
            job['last_poll'] = time.monotonic()
            if operation == 'poll':
                cursor = data.get('cursor', 0)
                if not isinstance(cursor, int) or cursor < 0:
                    raise ValueError('Invalid event cursor.')
                return {'events':job['events'][cursor:], 'cursor':len(job['events']), 'finished':job['finished']}
        subscriptions.stop(job)
        return {'cancelled':True}
    except ValueError as exc:
        return JSONResponse({'error':str(exc)}, status_code=400)
