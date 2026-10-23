#!/usr/bin/env python3
"""Fail-closed native pre-upload QA. Docker + unsquashfs + sqfs2tar required.

start-cli s9pk inspect <package> {manifest,commitment,file-tree} --format json
and inspect <package> cat <path> are the supported inspection commands.
SDK s9pk.mk produces hyperframes_<arch>.s9pk. The packed v2 filesystem is
images/<arch>/hyperframes.squashfs plus .json (runtime metadata) and .env.
Neither the manifest image key nor that metadata is a Docker content ID.
The CLI pack implementation uses buildx --output=type=oci,dest=- (no durable
Docker tag); see Start9Labs/start-os, start-core/src/s9pk/v2/pack.rs.
Consequently a tag resembling 'hyperframes' is NOT proof of package identity.
If no exact content ID is committed, import the packaged squashfs locally.
No pulls, credentials, generation, uploads, or registry writes are performed.
"""
import argparse
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time

DOCTOR_REQUIRED = ('bundled SFX assets', 'heygen on PATH', 'heygen version',
                   'ffmpeg on PATH', 'ffprobe on PATH', 'node version')


def validate_manifest(m, arch, sha, version):
    if (m.get('id'), m.get('version'), m.get('gitHash')) != ('hyperframes', version, sha):
        raise ValueError('manifest id/version/gitHash does not match expected clean source')
    if set(m.get('images', {})) != {'hyperframes'}:
        raise ValueError('unexpected manifest images')
    if m['images']['hyperframes'].get('arch') != [arch]:
        raise ValueError('manifest image is not exclusively the native architecture')
    if m.get('hardwareRequirements', {}).get('arch') != [arch]:
        raise ValueError('manifest hardware architecture mismatch')


def signature_identity(header, public_der=None):
    # StartOS v2: magic/version (3), Ed25519 key (32), signature (64).
    # start-cli inspect opens this archive with verify_prehashed_strict(s9pk),
    # so a successful inspect already authenticates the root commitment.
    if len(header) < 99 or header[:3] != b';;\x02':
        raise ValueError('expected signed StartOS v2 package header')
    pubkey = header[3:35]
    if public_der is not None and public_der != bytes.fromhex('302a300506032b6570032100') + pubkey:
        raise ValueError('package signer does not match expected public build key')
    return {'public_key_hex': pubkey.hex(), 'signature_hex': header[35:99].hex(),
            'verification': 'start-cli inspect: Ed25519ph strict, s9pk context'}


def validate_commitment(commitment):
    try:
        encoded = commitment['rootSighash']
        if not isinstance(encoded, str) or not re.fullmatch(r'[A-Za-z0-9+/]{43}=?', encoded):
            raise ValueError('invalid commitment hash format')
        # StartOS emits STANDARD base64 without padding; retain its literal form in evidence.
        raw = base64.b64decode(encoded + '=' * (-len(encoded) % 4), validate=True)
        size = commitment['rootMaxsize']
        if len(raw) != 32 or type(size) is not int or size <= 0:
            raise ValueError('invalid commitment fields')
    except (KeyError, TypeError, binascii.Error) as exc:
        raise ValueError('invalid package commitment') from exc


def validate_doctor(doctor):
    checks = {c['name']: c for c in doctor.get('checks', [])}
    if doctor.get('ok') is not True or any(checks.get(n, {}).get('ok') is not True for n in DOCTOR_REQUIRED):
        raise ValueError('media-use doctor failed a required local dependency')
    if any(c.get('ok') is not True and n != 'heygen authenticated' for n, c in checks.items()):
        raise ValueError('media-use doctor has an unexpected failure')
    if checks.get('heygen authenticated', {}).get('ok') is not False:
        raise ValueError('doctor did not demonstrate a credential-free environment')


def digest(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def inventory(root):
    result = {}
    for p in sorted(Path(root).rglob('*')):
        name = p.relative_to(root).as_posix()
        if p.is_symlink():
            result[name] = {'symlink': os.readlink(p)}
        elif p.is_file():
            result[name] = {'sha256': digest(p), 'executable': bool(p.stat().st_mode & 0o111)}
    if not result:
        raise ValueError(f'empty source/runtime tree: {root}')
    return result


def exact_image(config, listing):
    source = config.get('source')
    candidate = source.get('dockerTag') if isinstance(source, dict) else None
    if isinstance(candidate, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', candidate):
        if candidate in listing.splitlines():
            return candidate
    return None


def run(args, *, cwd=None, output=None):
    """Bounded subprocesses; stream multi-GB package members straight to disk."""
    if output is not None:
        with Path(output).open('wb') as f:
            result = subprocess.run(args, cwd=cwd, stdout=f, stderr=subprocess.PIPE, timeout=600)
        text = ''
    else:
        result = subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
        text = result.stdout.decode()
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1:4]} exited {result.returncode}: {result.stderr.decode(errors="replace")}')
    return text.strip()


def run_stream(producer, consumer, *, timeout=600):
    """Pipe multi-GB bytes without an archive file; fail closed on EITHER process."""
    deadline = time.monotonic() + timeout
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(producer, stdout=subprocess.PIPE, stderr=errors)
        assert process.stdout is not None  # Popen stdout=PIPE
        try:
            with process.stdout:
                result = subprocess.run(consumer, stdin=process.stdout, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, timeout=timeout)
            if result.returncode:
                raise RuntimeError(f'consumer {consumer} exited {result.returncode}: '
                                   f'{result.stderr.decode(errors="replace")}')
            code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
            if code:
                errors.seek(0)
                raise RuntimeError(f'producer {producer} exited {code}: '
                                   f'{errors.read().decode(errors="replace")}')
            return result.stdout.decode().strip()
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


def import_packed_image(squashfs):
    # Preserve root ownership/mode/xattrs and hardlinks; never skip unsupported files.
    # No full extracted root or root.tar: containerd already stores blob + snapshot.
    image = run_stream(['sqfs2tar', '--no-skip', '--root-becomes', '.', str(squashfs)],
                       ['docker', 'image', 'import', '-'])
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
        raise ValueError('Docker import did not return a content ID')
    return image


def runtime_command(image, args):
    # env -i removes even image-baked credentials. No host mounts or env forwarding.
    return ['docker', 'run', '--rm', '--pull=never', '--network=none', '--read-only',
            '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--tmpfs', '/tmp:rw,nosuid,size=256m', '--tmpfs', '/data:rw,nosuid,size=256m',
            '--workdir', '/tmp', '--entrypoint', '/usr/bin/env', image, '-i',
            'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            'HOME=/tmp/qa-home', 'HEYGEN_CONFIG_DIR=/tmp/qa-home/.heygen',
            'HEYGEN_NO_ANALYTICS=1', 'HEYGEN_NO_UPDATE_CHECK=1', 'HEYGEN_NONINTERACTIVE=1',
            'HYPERFRAMES_NO_TELEMETRY=1', 'HYPERFRAMES_NO_UPDATE_CHECK=1', *args]


def perform_qa(arch, sha, version, out, repo):
    if platform.machine() != arch:
        raise ValueError('QA must run on the matching native host, not emulation')
    git = lambda *args: run(['git', *args], cwd=repo)
    if git('rev-parse', 'HEAD') != sha or git('status', '--porcelain', '--untracked-files=no'):
        raise ValueError('source HEAD mismatch or dirty tracked source')
    submodules = {}
    for name in ('hyperframes', 'community-skills'):
        entry = git('ls-tree', 'HEAD', '--', name).split()
        actual = run(['git', 'rev-parse', 'HEAD'], cwd=repo / name)
        dirty = run(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=repo / name)
        if len(entry) != 4 or entry[0] != '160000' or entry[2] != actual or dirty:
            raise ValueError(f'unpinned or dirty submodule: {name}')
        submodules[name] = {'sha': actual, 'tree': run(['git', 'rev-parse', 'HEAD^{tree}'], cwd=repo / name)}
    package = repo / f'hyperframes_{arch}.s9pk'
    before = digest(package)
    inspect = lambda *args: run(['start-cli', 's9pk', 'inspect', str(package), *args], cwd=repo)
    manifest = json.loads(inspect('manifest', '--format', 'json'))
    validate_manifest(manifest, arch, sha, version)
    commitment = json.loads(inspect('commitment', '--format', 'json'))
    validate_commitment(commitment)
    with package.open('rb') as f:
        signer = signature_identity(f.read(99))
    paths = json.loads(inspect('file-tree', '--format', 'json'))
    prefix = f'images/{arch}/hyperframes'
    for suffix in ('.squashfs', '.json', '.env'):
        if prefix + suffix not in paths:
            raise ValueError(f'package lacks native image member: {prefix + suffix}')
    # Packed manifests usually have source="packed", not a Docker image ID.
    listing = run(['docker', 'image', 'ls', '--no-trunc', '--quiet'])
    image = exact_image(manifest['images']['hyperframes'], listing)
    imported = False
    report = {'schema': 1, 'status': 'passed', 'sha': sha, 'arch': arch, 'version': version,
              'package': {'name': package.name, 'sha256': before, 'size': package.stat().st_size},
              'manifest': manifest, 'commitment': commitment, 'signer': signer, 'submodules': submodules,
              'source_tree': git('rev-parse', 'HEAD^{tree}'),
              'heygen_skills_tree': git('rev-parse', 'HEAD:heygen-skills'),
              'start_cli_version': run(['start-cli', '--version']),
              'paid_generation': False, 'network': 'none', 'credentials': 'empty env and ephemeral HOME'}
    with tempfile.TemporaryDirectory(prefix='native-package-qa-') as temp:
        temp = Path(temp)
        squashfs = temp / 'runtime.squashfs'
        run(['start-cli', 's9pk', 'inspect', str(package), 'cat', prefix + '.squashfs'], output=squashfs)
        root = temp / 'root'
        # Extract only the four inventory roots; stream the complete runtime to Docker.
        run(['unsquashfs', '-d', str(root), str(squashfs),
             'opt/hyperframes/skills', 'opt/hyperframes-startos/skills',
             'opt/heygen-skills/skills', 'opt/hyperframes-community/skills'])
        trees = {}
        for source, target in [('hyperframes/skills', 'opt/hyperframes/skills'),
                               ('skills', 'opt/hyperframes-startos/skills'),
                               ('heygen-skills/skills', 'opt/heygen-skills/skills'),
                               ('community-skills/skills', 'opt/hyperframes-community/skills')]:
            expected = inventory(repo / source)
            if source.startswith('community-skills'):
                for name in ('day-in-my-life', 'session-story'):
                    replacement = repo / 'community-adaptations' / f'{name}.SKILL.md'
                    expected[f'{name}/SKILL.md'] = {'sha256': digest(replacement),
                                                   'executable': bool(replacement.stat().st_mode & 0o111)}
            if inventory(root / target) != expected:
                raise ValueError(f'packaged skill tree differs from pinned source: {source}')
            trees[target] = expected
        report['skill_trees'] = trees
        report['runtime_squashfs_sha256'] = digest(squashfs)
        report['image_metadata'] = json.loads(inspect('cat', prefix + '.json'))
        # Preserve package env as evidence, not as credentials for probes.
        report['image_env_sha256'] = hashlib.sha256(inspect('cat', prefix + '.env').encode()).hexdigest()
        try:
            if image is None:
                image = import_packed_image(squashfs)
                imported = True
            report['image_id'] = image
            report['image_origin'] = 'package-squashfs-import' if imported else 'exact-manifest-content-id'
            docker_arch = run(['docker', 'image', 'inspect', '--format', '{{.Architecture}}', image])
            if docker_arch != {'x86_64': 'amd64', 'aarch64': 'arm64'}[arch]:
                raise ValueError('Docker image architecture mismatch')
            probe = lambda *args: run(runtime_command(image, list(args)))
            if probe('uname', '-m') != arch:
                raise ValueError('runtime architecture mismatch')
            # Check PATH resolution and files in the FINAL image, not the build stage.
            report['runtime_paths'] = probe('sh', '-ec',
                'command -v hyperframes; command -v heygen; test -x /usr/local/bin/heygen; '
                'test -f /opt/hyperframes-startos/server/dist/main.js; '
                'test -f /opt/hyperframes/skills/media-use/scripts/resolve.mjs')
            report['hyperframes_version'] = probe('hyperframes', '--version')
            upstream_version = version.split(':', 1)[0]
            found = re.findall(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', report['hyperframes_version'])
            if found != [upstream_version]:
                raise ValueError('native HyperFrames CLI version mismatch')
            report['hyperframes_help'] = probe('hyperframes', '--help')
            report['heygen_version'] = probe('heygen', '--version')
            if not re.search(r'\bv0\.10\.0\b', report['heygen_version']):
                raise ValueError('HeyGen must be v0.10.0')
            report['heygen_help'] = probe('heygen', '--help')
            if not report['hyperframes_help'] or not report['heygen_help']:
                raise ValueError('empty CLI help')
            report['media_use_doctor'] = json.loads(probe('hyperframes', 'media-use', 'resolve', '--doctor', '--json'))
            validate_doctor(report['media_use_doctor'])
        finally:
            if imported:
                run(['docker', 'image', 'rm', image])
    if digest(package) != before:
        raise ValueError('package changed during QA')
    shutil.copyfile(package, out / package.name)
    write_evidence(out, report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch', required=True, choices=('x86_64', 'aarch64'))
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--expected-version', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha):
        parser.error('expected SHA must be 40 lowercase hex characters')
    if not re.fullmatch(r'\d+\.\d+\.\d+:\d+', args.expected_version):
        parser.error('expected version must use StartOS format, e.g. 0.8.185:0')
    out = args.output_dir.resolve()
    if out.exists() and any(out.iterdir()):
        parser.error('output directory must be absent or empty (no stale evidence)')
    out.mkdir(parents=True, exist_ok=True)
    try:
        perform_qa(args.arch, args.expected_sha, args.expected_version, out, Path(__file__).resolve().parents[2])
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
        print(f'native-package-qa: FAILED: {exc}', file=sys.stderr)
        return 1
    print(f'native-package-qa: passed; artifacts in {out}')
    return 0


def write_evidence(out, report):
    (out / 'qa.json').write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    files = sorted(p for p in out.iterdir() if p.is_file() and p.name != 'SHA256SUMS')
    (out / 'SHA256SUMS').write_text(''.join(f'{digest(p)}  {p.name}\n' for p in files))


if __name__ == '__main__':
    sys.exit(main())
