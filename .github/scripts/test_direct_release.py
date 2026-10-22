import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('direct-release.py')
SHA = 'a' * 40

class FakeGitHub:
    def __init__(self):
        self.releases = []
        self.assets = {}
        self.tags = {}
        self.calls = []
    def list_releases(self):
        return self.releases
    def tag_sha(self, tag):
        return self.tags.get(tag)
    def create(self, payload):
        self.calls.append(('create', payload.copy()))
        r = dict(payload, id=42, assets=[])
        self.releases.append(r)
        return r
    def get(self, rid):
        self.calls.append(('get-id', rid))
        return next(r for r in self.releases if r['id'] == rid)
    def upload(self, rid, name, path):
        self.calls.append(('upload', rid, name))
        raw = Path(path).read_bytes()
        asset = {'id': len(self.assets)+1, 'name': name, 'size': len(raw)}
        self.assets[asset['id']] = raw
        self.get(rid)['assets'].append(asset)
    def download(self, asset, path):
        Path(path).write_bytes(self.assets[asset['id']])
    def create_tag(self, tag, sha):
        if tag in self.tags:
            raise ValueError('tag exists')
        self.tags[tag] = sha
    def publish(self, rid):
        self.calls.append(('publish', rid))
        self.get(rid).update(draft=False, prerelease=False)

class DeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not SCRIPT.exists():
            return
        spec = importlib.util.spec_from_file_location('direct_release', SCRIPT)
        cls.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.m)
    def setUp(self):
        self.assertTrue(SCRIPT.exists(), 'direct-release.py implementation missing')
        self.api = FakeGitHub()
        self.d = self.m.Delivery(self.api, SHA, '0.8.185:0', 'rc')
    def bundle(self, root, arch):
        path = root / arch
        path.mkdir()
        package = f'hyperframes_{arch}.s9pk'
        (path/package).write_bytes(b'test fixture, not a real native package')
        qa = {'schema': 1, 'status': 'passed', 'sha': SHA, 'version': '0.8.185:0', 'arch': arch,
              'package': {'name': package, 'sha256': hashlib.sha256((path/package).read_bytes()).hexdigest(), 'size': (path/package).stat().st_size},
              'paid_generation': False, 'network': 'none',
              'signer': {'public_key_hex': 'c'*64, 'signature_hex': 'd'*128}}
        (path/'qa.json').write_text(json.dumps(qa))
        (path/'SHA256SUMS').write_text(''.join(f'{hashlib.sha256((path/n).read_bytes()).hexdigest()}  {n}\n' for n in [package, 'qa.json']))
        return path
    def test_prepare_uses_draft_id_and_not_latest(self):
        rid = self.d.prepare()
        self.assertEqual(rid, 42)
        payload = self.api.calls[0][1]
        self.assertTrue(payload['draft'])
        self.assertTrue(payload['prerelease'])
        self.assertEqual(payload['make_latest'], 'false')
        self.assertEqual(payload['target_commitish'], SHA)
        self.assertEqual(self.d.prepare(), rid)
        self.assertTrue(any(c == ('get-id', rid) for c in self.api.calls))
    def test_sha_binding_mismatch_rejected(self):
        rid = self.d.prepare()
        self.api.get(rid)['target_commitish'] = 'b'*40
        with self.assertRaises(ValueError):
            self.d.prepare()
    def test_missing_arch_cannot_publish(self):
        stable = self.m.Delivery(self.api, SHA, '0.8.185:0', 'stable')
        rid = stable.prepare()
        with self.assertRaises(ValueError):
            stable.finalize(rid)
        self.assertTrue(self.api.get(rid)['draft'])
        self.assertNotIn(('publish', rid), self.api.calls)
    def test_both_arches_rc_remains_draft_no_quota_calls(self):
        rid = self.d.prepare()
        with tempfile.TemporaryDirectory() as temp:
            for arch in ('x86_64', 'aarch64'):
                self.d.upload(rid, arch, self.bundle(Path(temp), arch))
            self.d.finalize(rid)
        self.assertTrue(self.api.get(rid)['draft'])
        self.assertEqual(len(self.api.get(rid)['assets']), 6)
        self.assertFalse(any(c[0] == 'publish' for c in self.api.calls))
    def test_identical_upload_resume_no_overwrite(self):
        rid = self.d.prepare()
        with tempfile.TemporaryDirectory() as temp:
            path = self.bundle(Path(temp), 'x86_64')
            self.d.upload(rid, 'x86_64', path)
            self.d.upload(rid, 'x86_64', path)
        self.assertEqual(len([c for c in self.api.calls if c[0]=='upload']), 3)
    def test_changed_remote_asset_rejected_no_overwrite(self):
        rid = self.d.prepare()
        with tempfile.TemporaryDirectory() as temp:
            path = self.bundle(Path(temp), 'x86_64')
            self.d.upload(rid, 'x86_64', path)
            self.api.assets[1] = b'corrupted'
            with self.assertRaises(ValueError):
                self.d.upload(rid, 'x86_64', path)
        self.assertEqual(len([c for c in self.api.calls if c[0]=='upload']), 3)
    def test_existing_tag_other_sha_rejected(self):
        stable = self.m.Delivery(self.api, SHA, '0.8.185:0', 'stable')
        self.api.tags[stable.tag] = 'b'*40
        with self.assertRaises(ValueError):
            stable.prepare()
    def test_complete_stable_publishes_only_after_readback(self):
        stable = self.m.Delivery(self.api, SHA, '0.8.185:0', 'stable')
        rid = stable.prepare()
        with tempfile.TemporaryDirectory() as temp:
            for arch in ('x86_64', 'aarch64'):
                stable.upload(rid, arch, self.bundle(Path(temp), arch))
            stable.finalize(rid)
            stable.finalize(rid)
        self.assertFalse(self.api.get(rid)['draft'])
        self.assertEqual(self.api.tags[stable.tag], SHA)
        self.assertEqual(len([c for c in self.api.calls if c[0]=='publish']), 1)
    def test_stable_mismatched_signers_cannot_publish(self):
        stable = self.m.Delivery(self.api, SHA, '0.8.185:0', 'stable')
        rid = stable.prepare()
        with tempfile.TemporaryDirectory() as temp:
            for arch in ('x86_64', 'aarch64'):
                path = self.bundle(Path(temp), arch)
                if arch == 'aarch64':
                    qa = json.loads((path/'qa.json').read_text())
                    qa['signer']['public_key_hex'] = 'e'*64
                    (path/'qa.json').write_text(json.dumps(qa))
                    (path/'SHA256SUMS').write_text(''.join(f'{hashlib.sha256((path/n).read_bytes()).hexdigest()}  {n}\n' for n in [f'hyperframes_{arch}.s9pk', 'qa.json']))
                stable.upload(rid, arch, path)
            with self.assertRaises(ValueError):
                stable.finalize(rid)
        self.assertTrue(self.api.get(rid)['draft'])

    def test_unknown_asset_rejected(self):
        rid = self.d.prepare()
        self.api.get(rid)['assets'].append({'id': 999, 'name': 'surprise', 'size': 1})
        with self.assertRaises(ValueError):
            self.d.finalize(rid)

if __name__ == '__main__':
    unittest.main()
