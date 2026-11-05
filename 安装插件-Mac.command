#!/bin/bash
set -e
package_root="$(CDPATH= cd -P "$(dirname "$0")" && pwd)"
if /usr/bin/open -Ra "Google Chrome"; then
  /usr/bin/open -a "Google Chrome" "chrome://extensions"
else
  /usr/bin/open -a "Microsoft Edge" "edge://extensions"
fi
/usr/bin/open "$package_root/extension"
echo "在扩展程序页开启开发者模式，加载已解压的扩展程序，选择刚打开的 extension 文件夹。"
