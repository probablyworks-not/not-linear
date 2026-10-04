-- Locate the repo root from this script's own location, walking up until
-- backend/server.py appears, instead of hardcoding a path. `path to me` is a
-- file when run as a script and a bundle when saved as an app, so the trailing
-- slash is stripped before taking the dirname.
set mePosix to POSIX path of (path to me)
set repoRoot to do shell script "p=" & quoted form of mePosix & "; p=\"${p%/}\"; d=\"$(dirname \"$p\")\"; while [ ! -f \"$d/backend/server.py\" ] && [ \"$d\" != \"/\" ]; do d=\"$(dirname \"$d\")\"; done; printf %s \"$d\""

if repoRoot is "/" then
	display dialog "notlinear: could not find backend/server.py above " & mePosix buttons {"OK"} default button 1
	return
end if

do shell script "cd " & quoted form of repoRoot & " && if ! /usr/sbin/lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then nohup /usr/bin/python3 backend/server.py --port 8765 --host 127.0.0.1 >/tmp/notlinear-server.log 2>&1 & sleep 1; fi"
open location "http://127.0.0.1:8765/frontend/index.html"
