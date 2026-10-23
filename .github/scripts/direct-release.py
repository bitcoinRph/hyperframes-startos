#!/usr/bin/env python3
"""Direct GitHub release assets, never Actions artifacts; immutable SHA-bound drafts.

GH_TOKEN is required only for this process. No deletes, clobbers or tag updates.
All uploaded and finalized bytes are re-downloaded using release/asset IDs.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import quote

ARCHES = ('x86_64', 'aarch64')


def digest(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


class GitHub:
    def __init__(self, repo):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
            raise ValueError('invalid repository')
        self.base = f'repos/{repo}'
        self.repo = repo

    def api(self, path, method='GET', data=None):
        args = ['gh', 'api', path, '--method', method]
        if data is not None:
            args += ['--input', '-']
        result = subprocess.run(args, input=json.dumps(data) if data is not None else None,
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if result.returncode:
            # Do not echo signed URLs or authorization details from gh stderr.
            raise RuntimeError(f'GitHub API {method} failed, exit {result.returncode}')
        return json.loads(result.stdout) if result.stdout.strip() else None

    def pages(self, path):
        values = []
        for page in range(1, 1001):
            batch = self.api(f'{path}?per_page=100&page={page}')
            values.extend(batch)
            if len(batch) < 100:
                return values
        raise ValueError('pagination exceeds safety limit')

    def list_releases(self):
        # GET /releases/tags/:tag can return 404 for drafts. List authenticated
        # drafts once during prepare, then use the numeric release ID throughout.
        return self.pages(f'{self.base}/releases')

    def tag_sha(self, tag):
        refs = self.api(f'{self.base}/git/matching-refs/tags/{quote(tag, safe="")}')
        exact = [r for r in refs if r['ref'] == f'refs/tags/{tag}']
        if not exact:
            return None
        obj = exact[0]['object']
        for _ in range(10):
            if obj['type'] == 'commit':
                return obj['sha']
            if obj['type'] != 'tag':
                break
            obj = self.api(f'{self.base}/git/tags/{obj["sha"]}')['object']
        raise ValueError('tag is not a bounded commit reference')

    def create(self, payload):
        return self.api(f'{self.base}/releases', 'POST', payload)

    def get(self, rid):
        release = self.api(f'{self.base}/releases/{rid}')
        release['assets'] = self.pages(f'{self.base}/releases/{rid}/assets')
        return release

    def upload(self, rid, name, path):
        url = f'https://uploads.github.com/{self.base}/releases/{rid}/assets?name={quote(name, safe="")}'
        result = subprocess.run(['gh', 'api', url, '--method', 'POST',
                                 '-H', 'Content-Type: application/octet-stream', '--input', str(path)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=1800)
        if result.returncode:
            raise RuntimeError(f'direct release upload failed, exit {result.returncode}; rerun safely, never clobber')

    def download(self, asset, path):
        with Path(path).open('wb') as f:
            result = subprocess.run(['gh', 'api', f'{self.base}/releases/assets/{asset["id"]}',
                                     '-H', 'Accept: application/octet-stream'], stdout=f,
                                    stderr=subprocess.PIPE, timeout=1800)
        if result.returncode:
            raise RuntimeError(f'release asset readback failed, exit {result.returncode}')

    def create_tag(self, tag, sha):
        self.api(f'{self.base}/git/refs', 'POST', {'ref': f'refs/tags/{tag}', 'sha': sha})

    def publish(self, rid):
        self.api(f'{self.base}/releases/{rid}', 'PATCH',
                 {'draft': False, 'prerelease': False, 'make_latest': 'true'})


class Delivery:
    def __init__(self, api, sha, version, mode):
        if not re.fullmatch(r'[0-9a-f]{40}', sha):
            raise ValueError('expected full lowercase commit SHA')
        if not re.fullmatch(r'\d+\.\d+\.\d+:\d+', version) or mode not in ('rc', 'stable'):
            raise ValueError('invalid StartOS version/mode')
        self.api, self.sha, self.version, self.mode = api, sha, version, mode
        self.tag = f'rc-{sha}' if mode == 'rc' else 'v' + version.replace(':', '_')
        self.binding = json.dumps({'delivery_schema': 1, 'sha': sha, 'version': version, 'mode': mode}, sort_keys=True)

    def bound(self, rid):
        r = self.api.get(rid)
        if (r['tag_name'], r['target_commitish'], r['body']) != (self.tag, self.sha, self.binding):
            raise ValueError('release metadata/SHA binding mismatch; never reuse a different release')
        if self.mode == 'rc' and (not r['draft'] or not r['prerelease']):
            raise ValueError('RC must remain a draft prerelease')
        if self.mode == 'stable' and r['prerelease']:
            raise ValueError('stable channel metadata mismatch')
        tagged = self.api.tag_sha(self.tag)
        if tagged is not None and tagged != self.sha:
            raise ValueError('immutable tag SHA mismatch')
        return r

    def prepare(self):
        tagged = self.api.tag_sha(self.tag)
        if tagged is not None and tagged != self.sha:
            raise ValueError('existing immutable version points at another SHA; no version churn or overwrite')
        matches = [r for r in self.api.list_releases() if r['tag_name'] == self.tag]
        if len(matches) > 1:
            raise ValueError('ambiguous release')
        if matches:
            rid = matches[0]['id']
        else:
            rid = self.api.create({'tag_name': self.tag, 'target_commitish': self.sha,
                                   'name': f'HyperFrames {self.version}' + (' RC ' + self.sha if self.mode == 'rc' else ''),
                                   'body': self.binding, 'draft': True, 'prerelease': self.mode == 'rc',
                                   'make_latest': 'false'})['id']
        self.bound(rid)
        return rid

    def bundle(self, arch, directory):
        if arch not in ARCHES:
            raise ValueError('unsupported architecture')
        directory = Path(directory)
        package = f'hyperframes_{arch}.s9pk'
        names = {package, 'qa.json', 'SHA256SUMS'}
        if {p.name for p in directory.iterdir()} != names:
            raise ValueError('incomplete or unexpected bundle files')
        checksums = {}
        for line in (directory/'SHA256SUMS').read_text().splitlines():
            match = re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9_.-]+)', line)
            if not match or match[2] in checksums:
                raise ValueError('invalid/duplicate checksum entry')
            checksums[match[2]] = match[1]
        if set(checksums) != {package, 'qa.json'}:
            raise ValueError('checksums must cover package and QA evidence')
        for name, expected in checksums.items():
            path = directory/name
            if path.is_symlink() or not path.is_file() or digest(path) != expected:
                raise ValueError('bundle checksum mismatch')
        qa = json.loads((directory/'qa.json').read_text())
        if (qa.get('schema'), qa.get('status'), qa.get('sha'), qa.get('version'), qa.get('arch'),
            qa.get('paid_generation'), qa.get('network')) != (1, 'passed', self.sha, self.version, arch, False, 'none'):
            raise ValueError('QA evidence SHA/version/architecture mismatch')
        if qa.get('package') != {'name': package, 'sha256': checksums[package], 'size': (directory/package).stat().st_size}:
            raise ValueError('QA package identity mismatch')
        signer = qa.get('signer', {})
        if (not re.fullmatch(r'[0-9a-f]{64}', signer.get('public_key_hex', '')) or
            not re.fullmatch(r'[0-9a-f]{128}', signer.get('signature_hex', ''))):
            raise ValueError('missing verified native signer evidence')
        if any((directory/n).stat().st_size >= 2 * 1024**3 for n in names):
            raise ValueError('GitHub release asset must be smaller than 2 GiB')
        return names

    def upload(self, rid, arch, directory):
        names = self.bundle(arch, directory)
        release = self.bound(rid)
        for name in sorted(names):
            remote = f'{arch}--{name}'
            existing = [a for a in release['assets'] if a['name'] == remote]
            if len(existing) > 1:
                raise ValueError('duplicate remote asset')
            if not existing:
                if not release['draft']:
                    raise ValueError('published releases are immutable; cannot add missing assets')
                self.api.upload(rid, remote, Path(directory)/name)
                release = self.bound(rid)
                existing = [a for a in release['assets'] if a['name'] == remote]
            if len(existing) != 1:
                raise ValueError('uploaded asset absent on readback')
            with tempfile.TemporaryDirectory(prefix='release-readback-') as temp:
                downloaded = Path(temp)/name
                self.api.download(existing[0], downloaded)
                if (downloaded.stat().st_size != existing[0]['size'] or
                    digest(downloaded) != digest(Path(directory)/name)):
                    raise ValueError('existing/uploaded asset differs; overwrite forbidden')

    def finalize(self, rid):
        release = self.bound(rid)
        expected = {f'{arch}--{name}' for arch in ARCHES
                    for name in (f'hyperframes_{arch}.s9pk', 'qa.json', 'SHA256SUMS')}
        if len(release['assets']) != len(expected) or {a['name'] for a in release['assets']} != expected:
            raise ValueError('both complete native architecture bundles required; release remains draft')
        with tempfile.TemporaryDirectory(prefix='release-finalize-') as temp:
            signers = set()
            for arch in ARCHES:
                directory = Path(temp)/arch
                directory.mkdir()
                for asset in release['assets']:
                    if asset['name'].startswith(arch + '--'):
                        path = directory/asset['name'].split('--', 1)[1]
                        self.api.download(asset, path)
                        if path.stat().st_size != asset['size']:
                            raise ValueError('asset size mismatch')
                self.bundle(arch, directory)
                signers.add(json.loads((directory/'qa.json').read_text())['signer']['public_key_hex'])
            if self.mode == 'stable' and len(signers) != 1:
                raise ValueError('stable architectures must share the existing developer signing identity')
        if self.mode == 'stable':
            if self.api.tag_sha(self.tag) is None:
                self.api.create_tag(self.tag, self.sha)
            if release['draft']:
                self.api.publish(rid)
            final = self.bound(rid)
            if final['draft'] or final['prerelease'] or self.api.tag_sha(self.tag) != self.sha:
                raise ValueError('publication readback mismatch')
        else:
            self.bound(rid)
        return rid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('prepare', 'upload', 'finalize'))
    parser.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY'))
    parser.add_argument('--sha', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--mode', choices=('rc', 'stable'), required=True)
    parser.add_argument('--release-id', type=int)
    parser.add_argument('--arch', choices=ARCHES)
    parser.add_argument('--directory', type=Path)
    args = parser.parse_args()
    delivery = Delivery(GitHub(args.repo or ''), args.sha, args.version, args.mode)
    if args.operation == 'prepare':
        print(delivery.prepare())
    else:
        if not args.release_id:
            parser.error('--release-id required')
        if args.operation == 'upload':
            if not args.arch or not args.directory:
                parser.error('--arch and --directory required')
            delivery.upload(args.release_id, args.arch, args.directory)
        else:
            print(delivery.finalize(args.release_id))


if __name__ == '__main__':
    main()
