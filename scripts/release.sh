#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-$(node -p "require('./package.json').version")}"
RELEASE_DIR="$ROOT/release/baby-quirt-${VERSION}"

echo "==> Building Baby Quirt ${VERSION}"

npm ci
npm run build
npm run test:all
npm run test:contracts

echo "==> Creating release bundle"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/bin" "$RELEASE_DIR/lib" "$RELEASE_DIR/ops"

# Copy runtime
cp -r dist "$RELEASE_DIR/lib/"
cp package.json package-lock.json "$RELEASE_DIR/lib/"
cp -r node_modules "$RELEASE_DIR/lib/node_modules"

cat > "$RELEASE_DIR/bin/baby-quirt-daemon" << 'EOF'
#!/usr/bin/env bash
exec /opt/node-v24.18.0-linux-x64/bin/node /opt/baby-quirt/current/lib/dist/index.js
EOF
chmod +x "$RELEASE_DIR/bin/baby-quirt-daemon"

cat > "$RELEASE_DIR/bin/baby-quirt" << 'EOF'
#!/usr/bin/env bash
exec /opt/node-v24.18.0-linux-x64/bin/node /opt/baby-quirt/current/lib/dist/cli/main.js "$@"
EOF
chmod +x "$RELEASE_DIR/bin/baby-quirt"

for cmd in install verify rollback repair; do
  cat > "$RELEASE_DIR/bin/baby-quirt-${cmd}" << EOF
#!/usr/bin/env bash
exec /opt/node-v24.18.0-linux-x64/bin/node /opt/baby-quirt/current/lib/dist/cli/${cmd}.js "\$@"
EOF
  chmod +x "$RELEASE_DIR/bin/baby-quirt-${cmd}"
done

# Ops files
cp -r ops/systemd "$RELEASE_DIR/ops/"
cp -r ops/tmpfiles "$RELEASE_DIR/ops/"
cp -r schemas "$RELEASE_DIR/"
cp -r contracts "$RELEASE_DIR/"

# Version manifest
cat > "$RELEASE_DIR/manifest.json" << EOF
{
  "product": "baby-quirt",
  "version": "${VERSION}",
  "nodeVersion": "24.18.0",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commit": "$(git rev-parse HEAD 2>/dev/null || echo unknown)"
}
EOF

# Create tarball
ARCHIVE="release/baby-quirt-${VERSION}.tar.gz"
tar -czf "$ARCHIVE" -C release "baby-quirt-${VERSION}"

# SHA-256 digest
DIGEST=$(sha256sum "$ARCHIVE" | awk '{print $1}')
echo "$DIGEST  baby-quirt-${VERSION}.tar.gz" > "release/baby-quirt-${VERSION}.sha256"

echo "==> Release bundle: $ARCHIVE"
echo "==> SHA-256: $DIGEST"
echo "$DIGEST"
