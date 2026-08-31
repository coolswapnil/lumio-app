"""
write_gradle_properties.py — CI helper
Appends signing variables to android/gradle.properties.

Usage:
    python3 scripts/write_gradle_properties.py <android/gradle.properties>
"""
import sys

props_file = sys.argv[1]

signing_props = (
    "\n# Release signing config (written by CI)\n"
    "MYAPP_RELEASE_STORE_FILE=lumio-release.keystore\n"
    "MYAPP_RELEASE_KEY_ALIAS=lumio-release\n"
    "MYAPP_RELEASE_STORE_PASSWORD=lumio1234\n"
    "MYAPP_RELEASE_KEY_PASSWORD=lumio1234\n"
)

with open(props_file, 'a') as f:
    f.write(signing_props)

print(f"Signing props written to {props_file}")
