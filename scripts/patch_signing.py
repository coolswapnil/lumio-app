"""
patch_signing.py — CI helper script
Injects signingConfigs into the generated android/app/build.gradle
so that assembleRelease can sign the APK without a pre-existing keystore.

Usage:
    python3 scripts/patch_signing.py <path/to/build.gradle> <path/to/keystore>
"""
import sys
import re

gradle_file = sys.argv[1]
keystore_path = sys.argv[2]

with open(gradle_file, 'r') as f:
    content = f.read()

# ── 1. Build the signingConfigs block text ────────────────────────────────────
signing_block = (
    'signingConfigs {\n'
    '    release {\n'
    '        storeFile file("' + keystore_path + '")\n'
    '        storePassword "lumio1234"\n'
    '        keyAlias "lumio-release"\n'
    '        keyPassword "lumio1234"\n'
    '    }\n'
    '}\n'
)

# ── 2. Insert signingConfigs inside android { } — before buildTypes ───────────
# re.DOTALL makes . match newlines so [^}] is no longer needed.
# Strategy: find "android {" and inject the block right after the opening brace.
content = re.sub(
    r'(android\s*\{)',
    r'\1\n    ' + signing_block,
    content,
    count=1,
    flags=re.DOTALL,
)

# ── 3. Wire signingConfig to the release buildType ────────────────────────────
# Match "release {" inside buildTypes, spanning multiple lines with re.DOTALL.
content = re.sub(
    r'(buildTypes\s*\{.*?release\s*\{)',
    r'\1\n            signingConfig signingConfigs.release',
    content,
    count=1,
    flags=re.DOTALL,
)

with open(gradle_file, 'w') as f:
    f.write(content)

print("Signing configured successfully in", gradle_file)

# Print a snippet to verify injection (first 60 lines)
lines = content.splitlines()
print("--- build.gradle (first 60 lines) ---")
for i, line in enumerate(lines[:60], 1):
    print(f"{i:3}: {line}")
