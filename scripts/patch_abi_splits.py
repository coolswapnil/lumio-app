"""
patch_abi_splits.py — CI helper script
Appends ABI split configuration to android/app/build.gradle.

Usage:
    python3 scripts/patch_abi_splits.py <path/to/build.gradle>
"""
import sys

gradle_file = sys.argv[1]

block = """
android {
    splits {
        abi {
            enable true
            reset()
            include "arm64-v8a", "armeabi-v7a", "x86_64"
            universalApk true
        }
    }
}
"""

with open(gradle_file, 'a') as f:
    f.write(block)

print("ABI splits configured in", gradle_file)
