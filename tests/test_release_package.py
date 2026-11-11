"""Audit the built desktop payload, not the developer source or a Vite server."""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

APP = Path(os.environ.get('NOTLINEAR_TEST_APP', '/nonexistent'))

@unittest.skipUnless(APP.is_dir(), 'Set NOTLINEAR_TEST_APP to a built .app')
class ReleasePackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = APP.resolve()/'Contents/Resources/app'
        cls.runtime = APP.resolve()/'Contents/Resources/python/bin/python3'
        cls.temp = tempfile.TemporaryDirectory(prefix='notlinear-package-test-')
        cls.log = open(Path(cls.temp.name)/'server.log','w+')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); cls.port=sock.getsockname()[1]
        env=os.environ.copy()
        env.update(NOTLINEAR_DATA_DIR=cls.temp.name,NOTLINEAR_DEV_PROXY='0',NOTLINEAR_FAKE_NATIVE='1',
                   NOTLINEAR_AGENT_PYTHON=str(cls.runtime),NOTLINEAR_AGENT_HOME=cls.temp.name)
        cls.proc=subprocess.Popen([str(cls.runtime),'-I','-B',str(cls.payload/'backend/server.py'),
                                   '--port',str(cls.port)],env=env,stdout=cls.log,stderr=cls.log)
        cls.base=f'http://127.0.0.1:{cls.port}'
        for _ in range(100):
            try:
                cls.health=json.loads(cls.get('/__notlinear_health')); return
            except Exception:
                if cls.proc.poll() is not None:break
                time.sleep(.1)
        cls.proc.terminate();cls.proc.wait();cls.log.seek(0)
        raise RuntimeError('Packaged server did not start: '+cls.log.read()[-1200:])

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate();cls.proc.wait(timeout=10);cls.log.close();cls.temp.cleanup()

    @classmethod
    def get(cls,path):
        with urlopen(cls.base+path,timeout=5) as response:return response.read()

    @classmethod
    def post(cls,path,body):
        request=Request(cls.base+path,data=json.dumps(body).encode(),headers={
            'Content-Type':'application/json','Origin':cls.base,'X-Notlinear-Local':'1','X-Notlinear-Agent':'1'})
        with urlopen(request,timeout=5) as response:return json.load(response)

    def test_health_owns_backend_and_current_entrypoint(self):
        self.assertEqual(self.health['pid'],self.proc.pid)
        self.assertEqual(self.health['entrypoint'],'/web/')

    def test_payload_manifest_hashes_and_desktop_baseline(self):
        manifest=json.loads((self.payload/'release-manifest.json').read_text())
        self.assertEqual(manifest['entrypoint'],'/web/')
        self.assertEqual(manifest['desktop_baseline'],'3529b689eeb18cc9e021850a829c5cd9f5942e49')
        for name,digest in manifest['files'].items():
            self.assertEqual(hashlib.sha256((self.payload/name).read_bytes()).hexdigest(),digest,name)
        self.assertFalse((self.payload/'frontend').exists())

    def test_current_ui_assets_and_all_settings_sections(self):
        html=self.get('/web/').decode()
        urls=re.findall(r'(?:src|href)="(/web/[^\"]+)"',html)
        self.assertTrue(urls)
        scripts=''
        for url in urls:
            data=self.get(url)
            if url.endswith('.js'):scripts+=data.decode()
        for label in ['Models & keys','Subscriptions','General','Skills','Integrations','Modes','Runtime logs']:
            self.assertIn(label,scripts,label)
        with self.assertRaises(HTTPError) as error:self.get('/frontend/index.html')
        error.exception.close()

    def test_backup_tools_changelog_logo_and_companion(self):
        for path in ['/tools/export-data.html','/tools/import-data.html','/CHANGELOG.md','/logo.svg']:
            self.assertTrue(self.get(path),path)
        session=self.post('/__notlinear_agents/session',{})
        self.assertTrue(session['installed'])
        result=self.post('/__notlinear_open_files',{})
        self.assertTrue(result.get('cancelled'))

    def test_foreign_origin_cannot_open_native_dialog(self):
        request=Request(self.base+'/__notlinear_open_files',data=b'{}',headers={
            'Origin':'https://unrelated.example','Content-Type':'application/json'})
        with self.assertRaises(HTTPError) as error:urlopen(request,timeout=5)
        self.assertEqual(error.exception.code,403);error.exception.close()
