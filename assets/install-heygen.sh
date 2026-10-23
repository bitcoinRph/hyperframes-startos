#!/bin/sh
# Official static releases; no installer execution, package-manager hooks or auth.
# Refresh version and BOTH hashes from the official release's checksums.txt.
set -eu
VERSION=v0.10.0
ARCH="${2:-$(dpkg --print-architecture)}"
PREFIX="${1:-/usr/local}"
case "$ARCH" in
  amd64) SHA256=5edd58ee09ac92aadeea8742523530e7b4051caf100c97eba2fd8399f246ccea ;;
  arm64) SHA256=64f225ed848a5f6d0d5af1d7f7bccd8a8ec014dba0cd6540f9fd1a2ac3ab0e85 ;;
  *) printf 'unsupported HeyGen architecture: %s\n' "$ARCH" >&2; exit 1 ;;
esac
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
URL="https://static.heygen.ai/cli/releases/$VERSION/heygen_${VERSION}_linux_${ARCH}.tar.gz"
curl --proto '=https' --tlsv1.2 -fsSL "$URL" -o "$WORK/heygen.tar.gz"
printf '%s  %s\n' "$SHA256" "$WORK/heygen.tar.gz" | sha256sum -c -
# Extract only named files; never execute the upstream install/update script.
tar -xzf "$WORK/heygen.tar.gz" -C "$WORK" heygen LICENSE README.md
install -d "$PREFIX/bin" "$PREFIX/share/licenses/heygen"
install -m 0755 "$WORK/heygen" "$PREFIX/bin/heygen"
install -m 0644 "$WORK/LICENSE" "$WORK/README.md" "$PREFIX/share/licenses/heygen/"
# Execution is deliberately the caller's step (arm64 cross-download is allowed).
