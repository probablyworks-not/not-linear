do shell script "cd '/Users/yash/Downloads/notlinear' && if ! /usr/sbin/lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null 2>&1; then nohup /usr/bin/python3 notlinear_server.py --port 8765 --host 127.0.0.1 >/tmp/notlinear-server.log 2>&1 & sleep 1; fi"
open location "http://127.0.0.1:8765/notlinear.html"
