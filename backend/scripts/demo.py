"""Run against an already started local service; appends anonymous demo data."""

import argparse
import json
import os
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description="新增匿名场景并演示煎药全流程")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--count", type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.count <= 50:
        parser.error("count 必须为 1–50")
    headers = {"Content-Type": "application/json"}
    if os.environ.get("DECOCTION_API_KEY"):
        headers["X-API-Key"] = os.environ["DECOCTION_API_KEY"]

    def request(path, body=None, method="GET"):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(args.url.rstrip("/") + "/api/v1" + path,
                                     data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)

    try:
        request("/simulation/pause", method="POST")
        scene = request("/simulation/scenarios", {"count": args.count}, "POST")
        request("/simulation/step", {"seconds": 86400}, "POST")
        batches = [request(f"/batches/{ident}") for ident in scene["batch_ids"]]
        for b in batches:
            print(f"{b['id']}  {b['status']}  bags={b['produced_bags']}  trace={b['trace_code']}")
        if not all(b["status"] == "completed" for b in batches):
            raise SystemExit("存在未完成批次，请检查设备故障或暂停状态")
        summary = request("/dashboard")
        print(json.dumps({"virtual_seconds": summary["clock"]["now"],
                          "completed": summary["batch_counts"]["completed"],
                          "dispatched_bags": summary["dispatched_bags"]}, ensure_ascii=False, indent=2))
    except urllib.error.URLError as error:
        raise SystemExit(f"请求失败，请确认服务已启动、地址与密钥正确：{error}") from error


if __name__ == "__main__":
    main()
