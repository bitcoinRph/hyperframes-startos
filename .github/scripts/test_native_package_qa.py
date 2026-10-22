"""Credential-free unit tests; no Docker daemon or native execution implied."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('native-package-qa.py')


class PackageQATests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert SCRIPT.exists(), 'native package QA implementation is missing'
        spec = importlib.util.spec_from_file_location('native_qa', SCRIPT)
        assert spec is not None and spec.loader is not None
        cls.qa = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.qa)

    def manifest(self):
        return {'id': 'hyperframes', 'version': '0.8.185:0', 'gitHash': 'a' * 40,
                'images': {'hyperframes': {'source': 'packed', 'arch': ['aarch64']}},
                'hardwareRequirements': {'arch': ['aarch64']}}

    def test_manifest_accepts_exact_native_identity(self):
        self.qa.validate_manifest(self.manifest(), 'aarch64', 'a' * 40, '0.8.185:0')

    def test_manifest_fails_closed_on_identity_or_arch_mismatch(self):
        for key, value in [('version', '0.8.185:1'), ('gitHash', 'a' * 40 + '-modified'),
                           ('id', 'other'), ('images', {}),
                           ('hardwareRequirements', {'arch': ['x86_64']})]:
            with self.subTest(key=key):
                m = self.manifest()
                m[key] = value
                with self.assertRaises(ValueError):
                    self.qa.validate_manifest(m, 'aarch64', 'a' * 40, '0.8.185:0')
        m = self.manifest()
        m['images']['hyperframes']['arch'] = ['aarch64', 'x86_64']
        with self.assertRaises(ValueError):
            self.qa.validate_manifest(m, 'aarch64', 'a' * 40, '0.8.185:0')

    def test_doctor_allows_only_missing_authentication(self):
        checks = [{'name': n, 'ok': True} for n in self.qa.DOCTOR_REQUIRED]
        checks.append({'name': 'heygen authenticated', 'ok': False})
        self.qa.validate_doctor({'ok': True, 'checks': checks})
        for name in self.qa.DOCTOR_REQUIRED:
            bad = copy.deepcopy(checks)
            next(c for c in bad if c['name'] == name)['ok'] = False
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.qa.validate_doctor({'ok': True, 'checks': bad})
        for bad in [{'ok': True, 'checks': []}, {'ok': False, 'checks': checks}]:
            with self.assertRaises(ValueError):
                self.qa.validate_doctor(bad)

    def test_tree_inventory_binds_bytes_and_symlink_targets(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'a').write_bytes(b'hello')
            (root / 'link').symlink_to('a')
            self.assertEqual(self.qa.inventory(root), {
                'a': {'sha256': hashlib.sha256(b'hello').hexdigest(), 'executable': False},
                'link': {'symlink': 'a'}})
            (root / 'a').chmod(0o755)
            self.assertTrue(self.qa.inventory(root)['a']['executable'])

    def test_exact_content_image_selection_never_uses_similar_tags(self):
        image_id = 'sha256:' + 'b' * 64
        listing = image_id + '\nsha256:' + 'c' * 64 + '\n'
        self.assertEqual(self.qa.exact_image({'source': {'dockerTag': image_id}}, listing), image_id)
        for source in ['packed', {'dockerTag': 'hyperframes:latest'},
                       {'dockerTag': 'sha256:' + 'd' * 64}]:
            self.assertIsNone(self.qa.exact_image({'source': source}, listing))

    def test_cli_rejects_non_full_sha_before_work(self):
        import subprocess
        result = subprocess.run(['python3', str(SCRIPT), '--arch', 'aarch64',
                                 '--expected-sha', 'abcd', '--expected-version', '0.8.185:0',
                                 '--output-dir', '/should-not-be-created'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('40 lowercase hex', result.stderr)

    def test_runtime_probe_is_offline_ephemeral_and_uses_actual_commands(self):
        command = self.qa.runtime_command('sha256:' + 'a' * 64, ['hyperframes', '--help'])
        for flag in ['--network=none', '--pull=never', '--read-only', '--rm']:
            self.assertIn(flag, command)
        self.assertIn('HOME=/tmp/qa-home', command)
        self.assertEqual(command[-2:], ['hyperframes', '--help'])
        self.assertNotIn('--platform', ' '.join(command))

    def test_qa_rejects_non_native_host_before_inspecting_package(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d, patch.object(self.qa.platform, 'machine', return_value='x86_64'):
            with self.assertRaisesRegex(ValueError, 'native host'):
                self.qa.perform_qa('aarch64', 'a' * 40, '0.8.185:0', Path(d), Path(d))

    def test_signature_header_requires_matching_public_build_key(self):
        pubkey = bytes(range(32))
        der = bytes.fromhex('302a300506032b6570032100') + pubkey
        header = b';;\x02' + pubkey + bytes(range(64))
        self.assertEqual(self.qa.signature_identity(header, der)['public_key_hex'], pubkey.hex())
        with self.assertRaises(ValueError):
            self.qa.signature_identity(header, der[:-1] + b'X')
        with self.assertRaises(ValueError):
            self.qa.signature_identity(b'bad' + header[3:], der)

    def test_command_failure_is_fatal(self):
        with self.assertRaises(RuntimeError):
            self.qa.run(['python3', '-c', 'raise SystemExit(7)'])

    def test_orchestration_extracts_packed_image_and_binds_artifacts(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            repo = Path(d)
            out = repo / 'out'
            out.mkdir()
            package = repo / 'hyperframes_aarch64.s9pk'
            package.write_bytes(b';;\x02' + bytes(range(32)) + bytes(range(64)) + b'unit-test-not-real-s9pk')
            for source in ['hyperframes/skills', 'community-skills/skills', 'skills', 'heygen-skills/skills']:
                folder = repo / source
                folder.mkdir(parents=True)
                (folder / 'SKILL.md').write_text('test skill')
            (repo / 'community-adaptations').mkdir()
            for name in ['day-in-my-life', 'session-story']:
                (repo / 'community-adaptations' / (name + '.SKILL.md')).write_text('overlay')
            calls = []
            doctor = {'ok': True, 'checks': [{'name': n, 'ok': True} for n in self.qa.DOCTOR_REQUIRED] +
                      [{'name': 'heygen authenticated', 'ok': False}]}
            def fake_run(args, *, cwd=None, output=None):
                calls.append(args)
                if args[0] == 'git':
                    if args[1] == 'status': return ''
                    if args[1] == 'ls-tree': return '160000 commit ' + 'a' * 40 + '\t' + args[-1]
                    return 'a' * 40
                if args[:2] == ['start-cli', '--version']: return 'start-cli 2.1.0'
                if args[0] == 'start-cli':
                    if 'manifest' in args: return json.dumps(self.manifest())
                    if 'commitment' in args: return json.dumps({'rootSighash': 'A' * 43 + '=', 'rootMaxsize': 123})
                    if 'file-tree' in args:
                        return json.dumps(['images/aarch64/hyperframes' + s for s in ['.squashfs', '.json', '.env']])
                    if output is not None:
                        output.write_bytes(b'unit squashfs')
                        return ''
                    return '{}' if args[-1].endswith('.json') else 'PATH=/usr/local/bin:/usr/bin'
                if args[0] == 'unsquashfs':
                    root = Path(args[2])
                    for source, target in [('hyperframes/skills', 'opt/hyperframes/skills'),
                                           ('community-skills/skills', 'opt/hyperframes-community/skills'),
                                           ('skills', 'opt/hyperframes-startos/skills'),
                                           ('heygen-skills/skills', 'opt/heygen-skills/skills')]:
                        import shutil
                        shutil.copytree(repo / source, root / target)
                    for name in ['day-in-my-life', 'session-story']:
                        target = root / 'opt/hyperframes-community/skills' / name
                        target.mkdir()
                        (target / 'SKILL.md').write_text('overlay')
                    return ''
                if args[0] == 'tar': return ''
                if args[:3] == ['docker', 'image', 'ls']: return ''
                if args[:3] == ['docker', 'image', 'import']: return 'sha256:' + 'b' * 64
                if args[:3] == ['docker', 'image', 'inspect']: return 'arm64'
                if args[:3] == ['docker', 'image', 'rm']: return ''
                if args[:2] == ['docker', 'run']:
                    if args[-2:] == ['uname', '-m']: return 'aarch64'
                    if args[-2:] == ['hyperframes', '--version']: return '0.8.185'
                    if args[-2:] == ['heygen', '--version']: return 'heygen v0.10.0'
                    if args[-2:] == ['--doctor', '--json']: return json.dumps(doctor)
                    if 'sh' in args:
                        self.assertIn('/opt/hyperframes-startos/server/dist/main.js', args[-1])
                        return '/usr/local/bin/hyperframes\n/usr/local/bin/heygen'
                    return 'Usage: help'
                raise AssertionError(args)
            with patch.object(self.qa, 'run', side_effect=fake_run), patch.object(self.qa.platform, 'machine', return_value='aarch64'):
                report = self.qa.perform_qa('aarch64', 'a' * 40, '0.8.185:0', out, repo)
            self.assertEqual(report['image_origin'], 'package-squashfs-import')
            self.assertEqual((out / package.name).read_bytes(), package.read_bytes())
            self.assertEqual(report['submodules']['hyperframes']['sha'], 'a' * 40)
            self.assertTrue((out / 'SHA256SUMS').exists())
            self.assertIn(['docker', 'image', 'rm', 'sha256:' + 'b' * 64], calls)

    def test_commitment_accepts_sdk_unpadded_standard_base64(self):
        self.qa.validate_commitment({'rootSighash': 'A' * 43, 'rootMaxsize': 123})

    def test_commitment_rejects_malformed_hash_and_non_positive_size(self):
        self.qa.validate_commitment({'rootSighash': 'A' * 43 + '=', 'rootMaxsize': 123})
        for value in [{}, {'rootSighash': 'invalid', 'rootMaxsize': 123},
                      {'rootSighash': 'A' * 43 + '=', 'rootMaxsize': 0}]:
            with self.assertRaises(ValueError):
                self.qa.validate_commitment(value)

    def test_evidence_checksum_binds_package_and_report(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            (out / 'hyperframes_aarch64.s9pk').write_bytes(b'package')
            self.qa.write_evidence(out, {'status': 'passed', 'sha': 'a' * 40})
            self.assertEqual(json.loads((out / 'qa.json').read_text())['status'], 'passed')
            lines = (out / 'SHA256SUMS').read_text().splitlines()
            self.assertEqual(len(lines), 2)
            for line in lines:
                digest, name = line.split('  ')
                self.assertEqual(digest, hashlib.sha256((out / name).read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
