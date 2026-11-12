"""Cloud requests never reach desktop filesystem, consent or shared-agent endpoints."""
import os
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
class CloudBoundaryMiddleware(BaseHTTPMiddleware):
    async def dispatch(self,request,call_next):
        if request.url.path.startswith('/__notlinear_') and request.url.path!='/__notlinear_health':
            return JSONResponse({'error':'This desktop operation is unavailable in the web app.'},status_code=404)
        origin=request.headers.get('origin')
        allowed={x.strip() for x in os.getenv('NOTLINEAR_PUBLIC_ORIGINS','').split(',') if x.strip()}
        if request.url.path.startswith('/api/') and origin and origin not in allowed:
            return JSONResponse({'error':'Origin is not allowed'},status_code=403)
        try:
            response=await call_next(request)
        except Exception:
            return JSONResponse({'error':'Cloud operation failed. Your saved data has not been cleared.'},status_code=503)
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        return response
