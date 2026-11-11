# Security

## Posture

notlinear is a local app. The server binds to `127.0.0.1`, has no authentication, and every `/__notlinear_*`
POST must carry an `X-Notlinear-Local` header so a page on another origin cannot drive it. Provider API keys are
stored in your browser's localStorage and sent only to the provider you choose.

Do not expose the server to a network. It can read folders you link to a project and fetch URLs on your behalf.

## Reporting a vulnerability

Please report privately rather than in a public issue: use GitHub's "Report a vulnerability" on the repository's
Security tab. [SECURITY CONTACT — TO BE SET BEFORE PUBLISHING]

Include what you found, how to reproduce it, and the impact. Expect an acknowledgement within a week.
