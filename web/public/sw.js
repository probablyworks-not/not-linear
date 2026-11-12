// Online-first: never cache authenticated responses, documents or provider tokens.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
