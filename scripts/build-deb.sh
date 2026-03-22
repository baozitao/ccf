#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$PROJECT_DIR/release"
PKG_NAME="ccf"
PKG_VERSION="0.1.0"
ARCH="amd64"
DEB_NAME="${PKG_NAME}_${PKG_VERSION}_${ARCH}.deb"

echo "=== Building CCF deb package ==="
echo "Project dir: $PROJECT_DIR"
echo "Output: $RELEASE_DIR/$DEB_NAME"

# Step 1: Build the project
echo ""
echo "--- Step 1: Building with electron-vite ---"
cd "$PROJECT_DIR"
npx electron-vite build --mode production

# Step 2: Copy fab.html to dist/renderer/ (it may not be included by default)
echo ""
echo "--- Step 2: Copying fab.html to dist/renderer/ ---"
cp "$PROJECT_DIR/src/renderer/fab.html" "$PROJECT_DIR/dist/renderer/fab.html"

# Step 3: Create temp staging directory
echo ""
echo "--- Step 3: Creating deb package structure ---"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

PKG_ROOT="$TMPDIR/${PKG_NAME}_${PKG_VERSION}_${ARCH}"

# Create directory structure
mkdir -p "$PKG_ROOT/DEBIAN"
mkdir -p "$PKG_ROOT/opt/ccf"
mkdir -p "$PKG_ROOT/usr/share/applications"
mkdir -p "$PKG_ROOT/usr/local/bin"
mkdir -p "$PKG_ROOT/opt/ccf/commands"

# Step 4: Copy app files into /opt/ccf/
echo "--- Step 4: Copying app files ---"
cp -r "$PROJECT_DIR/dist"       "$PKG_ROOT/opt/ccf/dist"
cp -r "$PROJECT_DIR/resources"  "$PKG_ROOT/opt/ccf/resources"
cp -r "$PROJECT_DIR/node_modules" "$PKG_ROOT/opt/ccf/node_modules"
cp    "$PROJECT_DIR/package.json"  "$PKG_ROOT/opt/ccf/package.json"

# Step 5: Write the toggle script
echo "--- Step 5: Writing toggle script ---"
cat > "$PKG_ROOT/opt/ccf/commands/toggle.sh" << 'EOF'
#!/bin/bash
# Toggle CCF window via local HTTP endpoint
curl -s http://127.0.0.1:19850/ > /dev/null 2>&1
EOF
chmod +x "$PKG_ROOT/opt/ccf/commands/toggle.sh"

# Step 6: Write the launcher script
echo "--- Step 6: Writing launcher script ---"
cat > "$PKG_ROOT/usr/local/bin/ccf" << 'EOF'
#!/bin/bash
cd /opt/ccf
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
exec node_modules/electron/dist/electron . --no-sandbox "$@"
EOF
chmod +x "$PKG_ROOT/usr/local/bin/ccf"

# Step 7: Write the .desktop file
echo "--- Step 7: Writing .desktop file ---"
cat > "$PKG_ROOT/usr/share/applications/ccf.desktop" << 'EOF'
[Desktop Entry]
Name=CCF (Claude Code Floating)
Exec=/usr/local/bin/ccf
Icon=/opt/ccf/resources/icon.png
Type=Application
Categories=Development;
StartupNotify=true
Comment=Desktop overlay UI for Claude Code CLI
EOF

# Step 8: Write DEBIAN/control
echo "--- Step 8: Writing DEBIAN/control ---"
cat > "$PKG_ROOT/DEBIAN/control" << EOF
Package: ccf
Version: ${PKG_VERSION}
Architecture: ${ARCH}
Depends: libgtk-3-0, libnss3, libxss1, libasound2t64
Maintainer: baozitao
Description: Claude Code Floating - Desktop overlay UI for Claude Code CLI
 CCF is a floating desktop overlay that provides a GUI for the Claude Code CLI,
 supporting toggle keybinding, session management, and inline terminal rendering.
EOF

# Step 9: Write DEBIAN/postinst
echo "--- Step 9: Writing DEBIAN/postinst ---"
cat > "$PKG_ROOT/DEBIAN/postinst" << 'POSTINST'
#!/bin/bash
set -e

# Fix chrome-sandbox setuid permissions (required for Electron without --no-sandbox at OS level)
SANDBOX="/opt/ccf/node_modules/electron/dist/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
    chown root:root "$SANDBOX"
    chmod 4755 "$SANDBOX"
    echo "ccf: chrome-sandbox permissions set."
fi

# Set up GNOME F3 keybinding for CCF toggle
# Runs as the invoking user if SUDO_USER is set, otherwise skips
REAL_USER="${SUDO_USER:-}"
if [ -n "$REAL_USER" ]; then
    REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"
    export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u "$REAL_USER")/bus"

    run_as_user() {
        sudo -u "$REAL_USER" \
            DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
            HOME="$REAL_HOME" \
            "$@"
    }

    echo "ccf: Setting up GNOME F3 keybinding for toggle..."

    # Use custom keybinding slot 0
    BINDING_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/"
    ARRAY_KEY="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings"

    run_as_user gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings \
        "['${BINDING_PATH}']" 2>/dev/null || true

    run_as_user gsettings set \
        org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:"${BINDING_PATH}" \
        name 'Toggle CCF' 2>/dev/null || true

    run_as_user gsettings set \
        org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:"${BINDING_PATH}" \
        command '/opt/ccf/commands/toggle.sh' 2>/dev/null || true

    run_as_user gsettings set \
        org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:"${BINDING_PATH}" \
        binding 'F3' 2>/dev/null || true

    echo "ccf: GNOME F3 keybinding configured (slot custom0)."
else
    echo "ccf: SUDO_USER not set — skipping GNOME keybinding setup. Run manually:"
    echo "  gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings \"['/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/']\""
    echo "  gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ name 'Toggle CCF'"
    echo "  gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ command '/opt/ccf/commands/toggle.sh'"
    echo "  gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/ binding 'F3'"
fi

# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications/ 2>/dev/null || true
fi

echo "ccf: Installation complete. Run 'ccf' to start."
exit 0
POSTINST
chmod 0755 "$PKG_ROOT/DEBIAN/postinst"

# Step 10: Build the .deb
echo ""
echo "--- Step 10: Building deb package ---"
mkdir -p "$RELEASE_DIR"
dpkg-deb --build --root-owner-group "$PKG_ROOT" "$RELEASE_DIR/$DEB_NAME"

echo ""
echo "=== Done! ==="
echo "Package written to: $RELEASE_DIR/$DEB_NAME"
echo ""
echo "Install with:"
echo "  sudo dpkg -i $RELEASE_DIR/$DEB_NAME"
echo "  sudo apt-get install -f  # fix any missing deps"
