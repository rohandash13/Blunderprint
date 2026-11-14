"""Check the deployed JVM budget, including when Render retains its old JAVA_OPTS override."""
import argparse
import json
import re
import subprocess
import time


def check(image):
    container = subprocess.check_output([
        "docker", "run", "-d", "--memory", "512m", "-e",
        "JAVA_OPTS=-Xmx320m -XX:+UseSerialGC -XX:+PrintFlagsFinal", image,
    ], text=True).strip()
    try:
        for _ in range(30):
            result = subprocess.run(["docker", "logs", container], capture_output=True, text=True, check=True)
            flags = result.stdout + result.stderr
            if "MaxHeapSize" in flags and "ReservedCodeCacheSize" in flags:
                break
            time.sleep(0.5)
    finally:
        subprocess.run(["docker", "rm", "-f", container], capture_output=True, check=True)
    expected = {"MaxHeapSize": 160 * 1024**2, "MaxMetaspaceSize": 96 * 1024**2,
                "ReservedCodeCacheSize": 32 * 1024**2, "MaxDirectMemorySize": 16 * 1024**2}
    actual = {}
    for name, ceiling in expected.items():
        match = re.search(r"\b" + name + r"\s*:?=\s*(\d+)", flags)
        actual[name] = int(match.group(1)) if match else None
        if actual[name] is None or actual[name] > ceiling or actual[name] == 0:
            raise AssertionError(f"{name}={actual[name]} exceeds explicit budget {ceiling}")
    return actual


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="blunderprint-api-memory")
    args = parser.parse_args()
    print(json.dumps(check(args.image), indent=2))
