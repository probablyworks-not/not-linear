"""Exercise packaged file routing without native dialogs or personal data."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SOURCE = Path(__file__).resolve().parents[1] / 'backend/server.py'


class PackagedServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.bundle = root / 'bundle'
        self.data = root / 'user-data'
        self.bundle.mkdir()
        self.data.mkdir()
        (self.bundle / 'frontend').mkdir()
        (self.bundle / 'frontend/index.html').write_text('application shell')
        (self.bundle / 'CHANGELOG.md').write_text('bundled changelog')
        spec = importlib.util.spec_from_file_location('packaged_server', SOURCE)
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {'NOTLINEAR_DATA_DIR': str(self.data)}):
            spec.loader.exec_module(self.module)
        handler = self.module.NotlinearHandler
        self.server = self.module.ThreadingHTTPServer(('127.0.0.1', 0),
            lambda *a, **kw: handler(*a, directory=str(self.bundle), **kw))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, body=None):
        payload = json.dumps(body).encode() if body is not None else None
        request = Request(self.url + path, data=payload,
                          headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=3) as response:
            return response.read()

    def test_health_identifies_own_process(self):
        health = json.loads(self.request('/__notlinear_health'))
        self.assertEqual(health, {'ok': True, 'app': 'notlinear', 'pid': os.getpid()})

    def test_shell_and_live_changelog_stay_in_bundle(self):
        self.assertEqual(self.request('/frontend/index.html'), b'application shell')
        self.assertEqual(self.request('/frontend/../CHANGELOG.md'), b'bundled changelog')

    def test_runtime_logs_write_outside_bundle_and_are_readable(self):
        result = json.loads(self.request('/__notlinear_runtime_logs', {'events': []}))
        self.assertTrue(result['ok'])
        self.assertTrue((self.data / 'logs.md').is_file())
        self.assertFalse((self.bundle / 'logs.md').exists())
        self.assertIn(b'Runtime logs', self.request('/logs.md'))

    def test_feedback_roundtrip_preserves_relative_media_paths(self):
        media = 'feedback/media/sample.png'
        body = {'path': media, 'base64': base64.b64encode(b'sample-image').decode()}
        self.assertEqual(json.loads(self.request('/__notlinear_feedback_upload', body))['path'], media)
        self.assertEqual(self.request('/' + media), b'sample-image')
        result = json.loads(self.request('/__notlinear_feedback_save', {'text': 'packaging test'}))
        self.assertEqual(result['path'], 'feedback/FEEDBACK.md')
        self.assertTrue((self.data / 'feedback/FEEDBACK.md').is_file())
        self.assertFalse((self.bundle / 'feedback').exists())
        self.assertTrue(json.loads(self.request('/__notlinear_feedback_list', {}))['entries'])
        self.request('/__notlinear_feedback_discard', {'path': media})
        self.assertFalse((self.data / media).exists())

    def test_media_traversal_and_symlink_escape_remain_rejected(self):
        with self.assertRaises(ValueError):
            self.module._media_file_from_rel('../outside.png')
        (self.data / 'feedback/media/escape').mkdir(parents=True)
        (self.data / 'feedback/media/escape/link').symlink_to(self.bundle / 'CHANGELOG.md')
        with self.assertRaises(ValueError):
            self.module._media_file_from_rel('feedback/media/escape/link')
        with self.assertRaises(HTTPError) as error:
            self.request('/feedback/media/escape/link')
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_packaged_mode_rejects_foreign_origins_before_writing(self):
        self.module.PACKAGED = True
        request = Request(self.url + '/__notlinear_runtime_logs', data=b'{"events":[]}',
                          headers={'Origin': 'https://unrelated.example', 'Content-Type': 'application/json'})
        with self.assertRaises(HTTPError) as error:
            urlopen(request, timeout=3)
        self.assertEqual(error.exception.code, 403)
        error.exception.close()
        self.assertFalse((self.data / 'logs.md').exists())
        self.assertNotIn(b'Access-Control-Allow-Origin', self.request('/__notlinear_health'))

    def test_packaged_mode_accepts_same_origin_and_rejects_rebinding(self):
        self.module.PACKAGED = True
        request = Request(self.url + '/__notlinear_runtime_logs', data=b'{"events":[]}',
                          headers={'Origin': self.url, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=3) as response:
            self.assertEqual(response.status, 200)
            self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
        request = Request(self.url + '/__notlinear_health', headers={'Host': 'unrelated.example'})
        with self.assertRaises(HTTPError) as error:
            urlopen(request, timeout=3)
        self.assertEqual(error.exception.code, 403)
        error.exception.close()

    def test_development_data_directory_default_is_unchanged(self):
        spec = importlib.util.spec_from_file_location('development_server', SOURCE)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {}, clear=True):
            spec.loader.exec_module(module)
        self.assertEqual(module.DATA_ROOT, SOURCE.parent.parent)


if __name__ == '__main__':
    unittest.main()
