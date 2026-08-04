#!/usr/bin/env bash
# 打开原版参考资源预览页
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
open "$ROOT/resources/reference/index.html"
