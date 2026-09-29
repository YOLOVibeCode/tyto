#!/usr/bin/env python3
"""Local test site with planted problems. Loopback only.
/login  → sets a session cookie (and a persistent one with 'remember me')
/account → needs the cookie
/shop   → fetches /api/items, which returns 500; page logs an error and shows "No items"
/click  → the Save button throws a TypeError
"""
import http.server, json, sys, time, urllib.parse
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
PAGE = "<!doctype html><html><head><meta charset=utf-8><title>{title}</title>{head}</head><body><main><h1>{title}</h1>{body}</main></body></html>"
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="text/html; charset=utf-8", headers=()):
        b = body.encode(); self.send_response(code); self.send_header("content-type", ctype); self.send_header("content-length", str(len(b)))
        for k, v in headers: self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)
    def cookie(self):
        c = self.headers.get("cookie", ""); return dict(p.strip().split("=", 1) for p in c.split(";") if "=" in p)
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/login":
            self.send(200, PAGE.format(title="Sign in", head="", body='<form method=post action=/login><label>Username <input name=user></label>'
                '<label>Password <input name=pass type=password></label><label><input type=checkbox name=remember> Remember me</label>'
                '<button type=submit>Sign in</button></form>'))
        elif path == "/account":
            c = self.cookie()
            if c.get("sid") == "ada-session" or c.get("remember") == "ada-long":
                self.send(200, PAGE.format(title="Account", head="", body="<p id=who>Welcome, Ada</p><a href=/shop>Shop</a>"))
            else:
                self.send(302, "", headers=[("location", "/login")])
        elif path == "/shop":
            js = ("<script>fetch('/api/items').then(r=>{if(!r.ok)throw new Error('items API failed: '+r.status);return r.json()})"
                  ".then(items=>{document.querySelector('#list').innerHTML=items.map(i=>'<li>'+i+'</li>').join('')})"
                  ".catch(e=>{console.error(e.message);document.querySelector('#list').innerHTML='<li>No items</li>'});</script>")
            self.send(200, PAGE.format(title="Shop", head="", body="<ul id=list><li>Loading…</li></ul>" + js))
        elif path == "/spa":
            # Content exists only after JS runs: fetched, then decoded client-side (not readable from the HTML).
            js = ("<script>fetch('/api/blob').then(r=>r.json()).then(d=>{const t=atob(d.b).split('').reverse().join('');"
                  "document.querySelector('#app').innerHTML='<h2>Today</h2><p id=price>'+t+'</p>';});</script>")
            self.send(200, PAGE.format(title="Deals", head="", body="<div id=app>Loading…</div>" + js))
        elif path == "/api/blob":
            import base64
            self.send(200, json.dumps({"b": base64.b64encode("Pro plan: $41.37 per month"[::-1].encode()).decode()}), "application/json")
        elif path == "/api/items":
            time.sleep(0.05); self.send(500, json.dumps({"error": "database timeout"}), "application/json")
        elif path == "/click":
            js = "<script>document.querySelector('#save').addEventListener('click',()=>{const draft=undefined;console.log('saving');return draft.id;});</script>"
            self.send(200, PAGE.format(title="Editor", head="", body="<textarea aria-label=Note></textarea><button id=save>Save</button>" + js))
        else:
            self.send(404, PAGE.format(title="Not found", head="", body="<p>Nothing here</p>"))
    def do_POST(self):
        n = int(self.headers.get("content-length", 0)); form = urllib.parse.parse_qs(self.rfile.read(n).decode())
        if form.get("user") == ["ada"] and form.get("pass") == ["lovelace"]:
            h = [("set-cookie", "sid=ada-session; Path=/; HttpOnly")]
            if form.get("remember"): h.append(("set-cookie", "remember=ada-long; Path=/; Max-Age=2592000; HttpOnly"))
            self.send(303, "", headers=h + [("location", "/account")])
        else:
            self.send(200, PAGE.format(title="Sign in", head="", body="<p role=alert>Wrong username or password</p><a href=/login>Try again</a>"))
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
