"""
patch_signing.py — CI helper script

expo prebuild generates app/build.gradle with a release signingConfig block
that looks like this:

    signingConfigs {
        release {
            storeFile file(MYAPP_RELEASE_STORE_FILE)
            storePassword MYAPP_RELEASE_STORE_PASSWORD
            keyAlias MYAPP_RELEASE_KEY_ALIAS
            keyPassword MYAPP_RELEASE_KEY_PASSWORD
        }
    }

If the generated file already has this pattern, we're done.
If not (older expo prebuild templates), we inject it via string replacement.

The actual values come from gradle.properties, which the CI sets up before
calling this script. No hardcoded passwords in build.gradle.

Usage:
    python3 scripts/patch_signing.py <path/to/app/build.gradle>
"""
import sys
import re

gradle_file = sys.argv[1]

with open(gradle_file, 'r') as f:
    content = f.read()

print("--- Checking existing signingConfigs in build.gradle ---")

# Check if expo prebuild already generated a signingConfigs.release block
has_signing_configs = 'signingConfigs' in content
has_release_config = bool(re.search(r'signingConfigs\s*\{.*?release\s*\{', content, re.DOTALL))
has_gradle_props = 'MYAPP_RELEASE_STORE_FILE' in content

print(f"  Has signingConfigs: {has_signing_configs}")
print(f"  Has release config: {has_release_config}")
print(f"  Uses gradle.properties vars: {has_gradle_props}")

if has_release_config and has_gradle_props:
    print("  signingConfigs.release already references gradle.properties — no changes needed.")
elif has_release_config and not has_gradle_props:
    print("  Found signingConfigs.release but not using gradle.properties vars — patching...")
    # Replace the body of the release signing config with gradle.properties references
    content = re.sub(
        r'(signingConfigs\s*\{[^}]*release\s*\{)[^}]*(})',
        r'''\1
            storeFile file(MYAPP_RELEASE_STORE_FILE)
            storePassword MYAPP_RELEASE_STORE_PASSWORD
            keyAlias MYAPP_RELEASE_KEY_ALIAS
            keyPassword MYAPP_RELEASE_KEY_PASSWORD
        \2''',
        content,
        count=1,
        flags=re.DOTALL,
    )
    with open(gradle_file, 'w') as f:
        f.write(content)
    print("  Patched signingConfigs.release to use gradle.properties vars.")
else:
    print("  No signingConfigs.release found — injecting complete block...")
    # Inject a full signingConfigs block + wire to release buildType
    signing_block = (
        '\n    signingConfigs {\n'
        '        release {\n'
        '            storeFile file(MYAPP_RELEASE_STORE_FILE)\n'
        '            storePassword MYAPP_RELEASE_STORE_PASSWORD\n'
        '            keyAlias MYAPP_RELEASE_KEY_ALIAS\n'
        '            keyPassword MYAPP_RELEASE_KEY_PASSWORD\n'
        '        }\n'
        '    }\n'
    )
    # Insert after "android {"
    content = re.sub(r'(android\s*\{)', r'\1' + signing_block, content, count=1)
    # Wire to release buildType — use DOTALL so . matches newlines
    content = re.sub(
        r'(release\s*\{(?:(?!release\s*\{).)*?minifyEnabled)',
        r'\1',  # leave as-is, add signingConfig on next line
        content,
        count=1,
        flags=re.DOTALL,
    )
    # Simpler: just append signingConfig after the first "minifyEnabled" in release
    content = re.sub(
        r'(minifyEnabled\s+\S+)',
        r'\1\n            signingConfig signingConfigs.release',
        content,
        count=1,
    )
    with open(gradle_file, 'w') as f:
        f.write(content)
    print("  Injected signingConfigs block and wired to release buildType.")

# Print relevant section for verification
lines = content.splitlines()
print("\n--- Signing-related lines in build.gradle ---")
for i, line in enumerate(lines, 1):
    if any(kw in line for kw in ['signing', 'Signing', 'MYAPP', 'storeFile', 'keyAlias', 'minify']):
        print(f"  {i:3}: {line}")
