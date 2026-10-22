"""Repository wiring contracts; no GitHub network or credentials required."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

class WorkflowTests(unittest.TestCase):
    def test_no_actions_artifact_service_in_any_workflow(self):
        for path in (ROOT/'.github/workflows').glob('*.yml'):
            text = path.read_text()
            for forbidden in ('actions/upload-artifact', 'actions/download-artifact', 'softprops/action-gh-release'):
                self.assertNotIn(forbidden, text, str(path))
    def test_stable_entrypoints_share_gated_direct_delivery(self):
        for name in ('tagAndRelease.yml', 'release.yml'):
            text = (ROOT/'.github/workflows'/name).read_text()
            self.assertIn('uses: ./.github/workflows/directRelease.yml', text)
            self.assertIn('expected_sha: ${{ github.sha }}', text)
            self.assertNotIn('git push', text)
    def test_existing_build_entrypoint_can_dispatch_premerge_rc(self):
        text = (ROOT/'.github/workflows/build.yml').read_text()
        self.assertIn('deliver_assets:', text)
        self.assertIn("github.event_name == 'workflow_dispatch' && inputs.deliver_assets", text)
        self.assertIn('expected_sha: ${{ inputs.expected_sha }}', text)

    def test_pr_build_readonly_no_secrets(self):
        text = (ROOT/'.github/workflows/build.yml').read_text()
        pr_jobs = text.split('  deliver_rc:')[0]
        self.assertNotIn('contents: write', pr_jobs)
        self.assertNotIn('secrets.', text)
        self.assertNotIn('pull_request_target', text)
    def test_direct_gate_uses_same_runner_and_id(self):
        text = (ROOT/'.github/workflows/directRelease.yml').read_text()
        self.assertLess(text.index('native-package-qa.py'), text.index('direct-release.py upload'))
        self.assertIn('needs: [checks, prepare, native]', text)
        self.assertIn('release_id:', text)
        self.assertIn('persist-credentials: false', text)
        self.assertNotIn('continue-on-error: true\n        uses:', text)

    def test_packed_qa_tools_and_non_destructive_storage_diagnostics(self):
        text = (ROOT/'.github/workflows/directRelease.yml').read_text()
        self.assertIn('squashfs-tools squashfs-tools-ng', text)
        self.assertIn('command -v sqfs2tar', text)
        self.assertIn('docker system df', text)
        self.assertIn('df -hT', text)
        self.assertIn('df -i', text)
        self.assertIn('du -xsh', text)
        self.assertIn('trap storage_diagnostics EXIT', text)
        for forbidden in ('prune', 'rm -rf', 'docker system clean'):
            self.assertNotIn(forbidden, text)

if __name__ == '__main__':
    unittest.main()
