#!/usr/bin/env python
"""測試用環境守衛（Python 版，給舊的 Python Playwright 腳本使用）。

與 tests/support/env-guard.cjs 規則一致：
- 只解析 .env.development.local，不讀 .env.local / .bak / .env.production.local。
- 驗證 Supabase URL ref、anon / service_role JWT 的 role 與 ref claim、
  EXPECTED_SUPABASE_PROJECT_REF、ALLOW_DEV_DATABASE_OPERATIONS、NODE_ENV。
- 錯誤訊息不含祕密，ref 一律遮罩。

用法（舊腳本第一行）：
    from env_guard import assert_dev_environment, preflight_server
    assert_dev_environment()          # 失敗時印訊息並 exit 2
    preflight_server("http://localhost:3002")

CLI：python tests/support/env_guard.py [--server [baseUrl]]
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

# 需與 tests/support/env-refs.cjs 一致（單元測試會比對）。
DEV_REF = "mjpdfpxqttbhzeimmtqr"
PRODUCTION_REFS = ("odvksgucvfoaqrumpran",)
PRODUCTION_REF_PREFIX = "odvk"
ALLOWED_ENV_FILE = ".env.development.local"
TEST_SITE_ORIGIN = "http://localhost:3002"


class EnvGuardError(Exception):
    exit_code = 2


def mask(value) -> str:
    if not value:
        return "<missing>"
    v = str(value)
    if len(v) <= 8:
        return f"{v[:2]}...{v[-2:]}"
    return f"{v[:4]}...{v[-4:]}"


def parse_env_text(text: str) -> dict:
    out: dict = {}
    for raw in str(text).splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not m:
            continue
        value = m.group(2)
        if value[:1] in ("'", '"') and value.rfind(value[0]) > 0:
            value = value[1 : value.rfind(value[0])]
        else:
            value = re.sub(r"\s+#.*$", "", value).strip()
        out[m.group(1)] = value
    return out


def default_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_dev_env_file(root=None, file_name: str = ALLOWED_ENV_FILE) -> dict:
    """只接受 .env.development.local；其他檔名一律丟錯。"""
    if str(file_name) != ALLOWED_ENV_FILE:
        raise EnvGuardError(
            f'拒絕載入 env 檔 "{Path(str(file_name)).name}"：測試工具只允許 {ALLOWED_ENV_FILE}'
        )
    path = Path(root or default_root()) / ALLOWED_ENV_FILE
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        raise EnvGuardError(f"找不到 {ALLOWED_ENV_FILE}（應位於專案根目錄）") from None
    return parse_env_text(text)


def _parse_ref(url_value: str) -> str:
    try:
        host = (urlparse(url_value).hostname or "").lower()
    except ValueError:
        raise EnvGuardError("NEXT_PUBLIC_SUPABASE_URL 不是有效的網址") from None
    m = re.match(r"^([a-z0-9]+)\.supabase\.co$", host)
    if not m:
        raise EnvGuardError("NEXT_PUBLIC_SUPABASE_URL 不是 Supabase 專案網域")
    return m.group(1)


def _decode_jwt(token, label: str) -> dict:
    parts = str(token or "").split(".")
    if len(parts) < 2:
        raise EnvGuardError(f"{label} 不是有效的 JWT")
    try:
        seg = parts[1].replace("-", "+").replace("_", "/")
        seg += "=" * (-len(seg) % 4)
        return json.loads(base64.b64decode(seg).decode("utf-8"))
    except Exception:
        raise EnvGuardError(f"{label} 的內容無法解碼") from None


def _is_prod(ref: str) -> bool:
    return ref in PRODUCTION_REFS or str(ref).startswith(PRODUCTION_REF_PREFIX)


def validate_dev_env(env: dict, node_env=None) -> dict:
    e = env or {}
    url = e.get("NEXT_PUBLIC_SUPABASE_URL")
    if not url:
        raise EnvGuardError("NEXT_PUBLIC_SUPABASE_URL 為必填")
    url_ref = _parse_ref(url)
    safe = f"ref {mask(url_ref)}"
    if _is_prod(url_ref):
        raise EnvGuardError(f"Supabase ref 屬於 Production（{safe}），拒絕執行")
    if url_ref != DEV_REF:
        raise EnvGuardError(f"Supabase URL 的 ref 不是 DEV（{safe}）")
    if not e.get("EXPECTED_SUPABASE_PROJECT_REF"):
        raise EnvGuardError("EXPECTED_SUPABASE_PROJECT_REF 為必填")
    if e["EXPECTED_SUPABASE_PROJECT_REF"] != url_ref:
        raise EnvGuardError("EXPECTED_SUPABASE_PROJECT_REF 與 Supabase URL 的 ref 不一致")
    if e.get("ALLOW_DEV_DATABASE_OPERATIONS") != "true":
        raise EnvGuardError("ALLOW_DEV_DATABASE_OPERATIONS 必須嚴格等於 true")
    effective = node_env if node_env is not None else os.environ.get("NODE_ENV")
    if effective == "production" or e.get("NODE_ENV") == "production":
        raise EnvGuardError("NODE_ENV 不得為 production")
    for key, role in (
        ("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"),
        ("SUPABASE_SERVICE_ROLE_KEY", "service_role"),
    ):
        if not e.get(key):
            raise EnvGuardError(f"{key} 為必填")
        payload = _decode_jwt(e[key], key)
        if payload.get("role") != role:
            raise EnvGuardError(f"{key} 的 JWT role 必須是 {role}")
        ref = payload.get("ref")
        if not ref:
            raise EnvGuardError(f"{key} 的 JWT 缺少 ref claim")
        if _is_prod(str(ref)):
            raise EnvGuardError(f"{key} 的 JWT ref 屬於 Production（ref {mask(ref)}）")
        if ref != DEV_REF:
            raise EnvGuardError(f"{key} 的 JWT ref 不是 DEV（ref {mask(ref)}）")
    for key, value in e.items():
        if isinstance(value, str) and any(r in value for r in PRODUCTION_REFS):
            raise EnvGuardError(f"環境變數 {key} 含有 Production ref，拒絕執行")
    return {"project_ref": mask(url_ref), "node_env": effective or "<unset>"}


def assert_dev_environment(root=None, env=None, node_env=None, exit_on_fail: bool = True) -> dict:
    """載入 .env.development.local 並驗證。失敗時預設印出訊息並 exit 2。回傳 env。"""
    try:
        loaded = env if env is not None else load_dev_env_file(root)
        validate_dev_env(loaded, node_env)
        return loaded
    except EnvGuardError as error:
        if not exit_on_fail:
            raise
        print("Environment guard failed", file=sys.stderr)
        print(f"Reason: {error}", file=sys.stderr)
        sys.exit(2)


def preflight_server(base_url: str = TEST_SITE_ORIGIN, timeout: float = 15.0) -> int:
    """/api/workspace/session 不得為 503（200 或 401 皆可）。回傳 HTTP 狀態碼。"""
    origin = base_url.rstrip("/")
    if not re.match(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$", origin):
        raise EnvGuardError("測試站只允許 localhost / 127.0.0.1")

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):  # noqa: D401
            return None

    opener = urllib.request.build_opener(_NoRedirect)
    try:
        status = opener.open(f"{origin}/api/workspace/session", timeout=timeout).status
    except urllib.error.HTTPError as http_error:
        status = http_error.code
    except Exception:
        raise EnvGuardError(f"無法連線測試站 {origin}（伺服器未啟動？）") from None
    if status == 503:
        raise EnvGuardError("測試站 /api/workspace/session 回 503：伺服器未通過 DEV 守衛，拒絕使用")
    if status >= 500:
        raise EnvGuardError(f"測試站 /api/workspace/session 回 {status}")
    return status


def main(argv: list) -> None:
    try:
        env = assert_dev_environment(exit_on_fail=False)
        print("Environment guard passed")
        print(f"Project Ref: {mask(_parse_ref(env['NEXT_PUBLIC_SUPABASE_URL']))}")
        if "--server" in argv:
            i = argv.index("--server")
            url = argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else TEST_SITE_ORIGIN
            print(f"Server preflight passed (HTTP {preflight_server(url)})")
    except EnvGuardError as error:
        print("Environment guard failed", file=sys.stderr)
        print(f"Reason: {error}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main(sys.argv[1:])
