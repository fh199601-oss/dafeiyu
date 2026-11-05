#!/bin/bash
set -e
package_root="$(CDPATH= cd -P "$(dirname "$0")" && pwd)"
if /usr/bin/open -Ra "Google Chrome"; then
  /usr/bin/open -a "Google Chrome" "$package_root/extension/home.html"
else
  /usr/bin/open -a "Microsoft Edge" "$package_root/extension/home.html"
fi
