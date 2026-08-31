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

signing_config = (
    '\nsigningConfigs {\n'
    '    release {\n'
    '        storeFile file("' + keystore_path + '")\n'
    '        storePassword "lumio1234"\n'
    '        keyAlias "lumio-release"\n'
    '        keyPassword "lumio1234"\n'
    '    }\n'
    '}\n'
)

# Insert signingConfigs block inside the android { } block
content = re.sub(r'(android\s*\{)', r'\1' + signing_config, content, count=1)

# Wire signingConfig to the release buildType
content = re.sub(
    r'(buildTypes\s*\{[^}]*release\s*\{)',
    r'\1\n            signingConfig signingConfigs.release',
    content,
    count=1,
)

with open(gradle_file, 'w') as f:
    f.write(content)

print("Signing configured in", gradle_file)
