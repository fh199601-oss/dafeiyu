#!/bin/bash
set -e
package_root="$(CDPATH= cd -P "$(dirname "$0")" && pwd)"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "这个安装器用于 Mac。Windows 请运行 一键安装AI连接组件.cmd。"
  exit 1
fi
cpu="$(uname -m)"
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then cpu="arm64"; fi
case "$cpu" in
  arm64) runtime_arch="arm64" ;;
  x86_64) runtime_arch="x64" ;;
  *) echo "暂不支持这个 Mac 架构。"; exit 1 ;;
esac
runtime="$package_root/connector/bin/darwin-$runtime_arch/node"
chmod u+x "$runtime" "$package_root/connector/bin/darwin-$runtime_arch/cloudflared"
if ! "$runtime" "$package_root/connector/install-mac.mjs"; then
  echo "安装未完成。请查看上面的原因；若 macOS 阻止打开，请按系统提示允许该安装包后重试。"
  read -r -p "按回车关闭…" reply
  exit 1
fi
echo "安装完成，可以关闭这个窗口。"
