# Download page for notlinear.lol

Static files for `/download/` on the existing Vercel website. Copy `download/`
into that project's static/public directory and link the existing homepage's
Download button to `/download/`. No framework, build step, account or analytics.

This directory is not a replacement homepage and must not overwrite the existing
Vercel site. Its source repository/deployment project has not yet been identified.

The page discovers the latest published GitHub release through the public REST
API and chooses the arm64 DMG asset. Drafts and prereleases do not appear as
`latest`. Before publication it shows an honest "being prepared" state and links
to Releases. Failed/rate-limited checks retain a working Releases link.

Update checks in the native app read `latest.json` attached to the same published
release. No separate hosted feed is required on the website for this free beta.
