"""Exercise all resident engine roles against a disposable local DB; never point this at production."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import time
import urllib.request


def request(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as response:
        return json.load(response)


def probe(container, base, username, out):
    if not base.startswith("http://127.0.0.1:"):
        raise ValueError("Only a loopback test backend is allowed")
    for _ in range(60):
        try:
            request(base, "/health")
            break
        except Exception:
            time.sleep(1)
    outcomes = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        tasks = {
            "live_engine": pool.submit(request, base, "/engine/analyze", {
                "fen": "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"}),
            "rescore": pool.submit(request, base, f"/admin/players/{username}/rescore", {}),
        }
        while not all(task.done() for task in tasks.values()):
            state = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]["State"]
            if not state["Running"]:
                break
            time.sleep(2)
        for name, task in tasks.items():
            try:
                outcomes[name] = task.result()
            except Exception as error:
                outcomes[name] = {"error": str(error)}
    state = json.loads(subprocess.check_output(["docker", "inspect", container]))[0]
    result = {"container": container, "image": state["Image"], "memory_limit_bytes": state["HostConfig"]["Memory"],
              "memory_swap_limit_bytes": state["HostConfig"]["MemorySwap"],
              "oom_killed": state["State"]["OOMKilled"], "exit_code": state["State"]["ExitCode"],
              "running": state["State"]["Running"], "outcomes": outcomes}
    if result["running"]:
        result["peak_bytes"] = int(subprocess.check_output([
            "docker", "exec", container, "cat", "/sys/fs/cgroup/memory.peak"]).strip())
        result["swap_bytes"] = int(subprocess.check_output([
            "docker", "exec", container, "cat", "/sys/fs/cgroup/memory.swap.current"]).strip())
        result["stockfish_processes"] = sum(line.split()[-1:] == ["stockfish"] for line in subprocess.check_output([
            "docker", "top", container, "-eo", "pid,comm"], text=True).splitlines())
        result["stats"] = json.loads(subprocess.check_output([
            "docker", "stats", "--no-stream", "--format", "{{json .}}", container]))
    Path(out).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    if (result["oom_killed"] or not result["running"] or any("error" in r for r in outcomes.values())
        or result["memory_swap_limit_bytes"] != result["memory_limit_bytes"]
        or result.get("swap_bytes", 0) != 0 or result.get("stockfish_processes") != 1):
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:18082")
    parser.add_argument("--username", default="Knight_ofthelight73")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    probe(args.container, args.base_url, args.username, args.out)
