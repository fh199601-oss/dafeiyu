/* Run with: osascript -l JavaScript locate-mac.js <extension-id>.
 * No browser profile is modified; only the selected extension entry is inspected.
 */
var MacInstallerLocator = (function () {
  'use strict';
  // The legacy display name remains accepted only for in-place upgrades.
  var EXPECTED_NAMES = ['大肥鱼', '战壕精灵 · 蓝鲸娘'];
  var INSTALLER_NAME = '一键安装AI连接组件-Mac.command';

  function absolutePath(value) {
    return typeof value === 'string' && value.charAt(0) === '/' && !/[\x00\r\n]/.test(value);
  }

  function joinPath(left, right) {
    return left.replace(/\/+$/, '') + '/' + right.replace(/^\/+/, '');
  }

  function quotedValue(text, quote) {
    var value = '';
    for (var i = 1; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === quote) return value;
      if (quote === '"' && ch === '\\' && /["\\]/.test(text.charAt(i + 1))) {
        value += text.charAt(++i);
      } else {
        value += ch;
      }
    }
    return null;
  }

  // ps does not reliably preserve argv quoting. For an unquoted value, spaces
  // belong to its path until the next option. Quoted and escaped paths also work.
  function userDataDir(command) {
    if (typeof command !== 'string') return null;
    var match = /(?:^|\s)(["']?)--user-data-dir(?:=|\s+)/.exec(command);
    if (!match) return null;
    var rest = command.slice(match.index + match[0].length);
    var value;
    if (match[1]) {
      value = quotedValue(match[1] + rest, match[1]);
    } else if (rest.charAt(0) === '"' || rest.charAt(0) === "'") {
      value = quotedValue(rest, rest.charAt(0));
    } else {
      value = rest.split(/\s+--?[a-zA-Z][\w-]*(?:=|\s|$)/, 1)[0].trim();
      value = value.replace(/\\([\\ "'])/g, '$1');
    }
    return absolutePath(value) ? value : null;
  }

  function mainBrowser(executable) {
    return /^\/[^\r\n]*\/(Google Chrome(?: for Testing)?|Microsoft Edge)\.app\/Contents\/MacOS\/\1$/.test(String(executable || ''));
  }

  function browserProcesses(processList) {
    var processes = [];
    String(processList || '').split(/\r?\n/).forEach(function (line) {
      var match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
      if (match && mainBrowser(match[2])) processes.push({ pid: match[1], executable: match[2] });
    });
    return processes;
  }

  function browserRoots(processRecords) {
    var roots = [];
    (Array.isArray(processRecords) ? processRecords : []).forEach(function (process) {
      // Check the executable obtained separately from ps comm, never a
      // Chrome-looking path placed in another program's command arguments.
      if (!process || !mainBrowser(process.executable)) return;
      var root = userDataDir(process.command);
      if (root && roots.indexOf(root) < 0) roots.push(root);
    });
    return roots;
  }

  function matchingEntry(config, extensionId) {
    var entries = config && config.extensions && config.extensions.settings;
    if (!entries || !Object.prototype.hasOwnProperty.call(entries, extensionId)) return null;
    var entry = entries[extensionId];
    if (!entry || !absolutePath(entry.path)) return null;
    if (entry.state !== undefined && entry.state !== 1) return null;
    return entry;
  }

  function locatePackage(extensionId, home, processText, io) {
    if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('安装器标识无效，请回到大肥鱼小屋重新准备安装器。');
    if (!absolutePath(home)) throw new Error('无法读取当前 Mac 用户目录。');
    var roots = browserRoots(processText).concat([
      joinPath(home, 'Library/Application Support/Google/Chrome'),
      joinPath(home, 'Library/Application Support/Microsoft Edge'),
      joinPath(home, 'Library/Application Support/Google/Chrome for Testing')
    ]);
    var visitedRoots = [], packages = [], matched = false;
    roots.forEach(function (root) {
      root = io.canonical(root);
      if (!absolutePath(root) || visitedRoots.indexOf(root) >= 0) return;
      visitedRoots.push(root);
      var profiles = [root];
      io.children(root).forEach(function (name) {
        if (typeof name === 'string' && name !== '.' && name !== '..' && !/[\/\x00\r\n]/.test(name)) {
          profiles.push(joinPath(root, name));
        }
      });
      profiles.forEach(function (profile) {
        ['Preferences', 'Secure Preferences'].forEach(function (filename) {
          var entry = matchingEntry(io.readJson(joinPath(profile, filename)), extensionId);
          if (!entry) return;
          matched = true;
          var extension = io.canonical(entry.path);
          if (!absolutePath(extension) || !/\/extension$/.test(extension)) return;
          var manifest = io.readJson(joinPath(extension, 'manifest.json'));
          if (!manifest || EXPECTED_NAMES.indexOf(manifest.name) < 0 || manifest.manifest_version !== 3) return;
          var packageRoot = extension.slice(0, -'/extension'.length);
          if (!packageRoot || !io.isFile(joinPath(packageRoot, 'connector/install-mac.mjs')) ||
              !io.isFile(joinPath(packageRoot, INSTALLER_NAME))) return;
          if (packages.indexOf(packageRoot) < 0) packages.push(packageRoot);
        });
      });
    });
    if (packages.length > 1) {
      throw new Error('发现多个使用相同标识的大肥鱼安装包。请在浏览器中移除旧副本，再从正在使用的大肥鱼小屋重新准备安装器。');
    }
    if (packages.length === 1) return packages[0];
    if (matched) {
      throw new Error('找到了大肥鱼，但完整安装包已移动或文件不齐。请保留解压后的完整文件夹，在扩展管理中重新加载其中的 extension 文件夹，然后重试。');
    }
    throw new Error('没有找到这个大肥鱼对应的浏览器安装记录。请保持 Chrome 或 Edge 打开，在扩展管理中重新加载大肥鱼，再回到大肥鱼小屋重新准备安装器。自定义浏览器资料目录需要浏览器正在运行。');
  }

  return { userDataDir: userDataDir, browserProcesses: browserProcesses, browserRoots: browserRoots, matchingEntry: matchingEntry, locatePackage: locatePackage };
})();

function run(argv) {
  ObjC.import('Foundation');
  var fm = $.NSFileManager.defaultManager;
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  function canonical(path) {
    return ObjC.unwrap($(path).stringByStandardizingPath.stringByResolvingSymlinksInPath);
  }
  var io = {
    canonical: canonical,
    children: function (path) {
      try { return ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError($(path), null)) || []; }
      catch (_) { return []; }
    },
    readJson: function (path) {
      try {
        var text = ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, null));
        return typeof text === 'string' ? JSON.parse(text) : null;
      } catch (_) { return null; }
    },
    isFile: function (path) {
      try {
        var attributes = fm.attributesOfItemAtPathError($(path), null);
        return attributes && ObjC.unwrap(attributes.objectForKey($.NSFileType)) === ObjC.unwrap($.NSFileTypeRegular);
      } catch (_) { return false; }
    }
  };
  var processes = [];
  try {
    // -x without -a stays within the current user's processes. Only a parsed
    // numeric pid enters this otherwise fixed shell command.
    processes = MacInstallerLocator.browserProcesses(app.doShellScript('/bin/ps -ww -x -o pid= -o comm='));
    processes.forEach(function (process) {
      try { process.command = app.doShellScript('/bin/ps -ww -p ' + process.pid + ' -o command='); }
      catch (_) { process.command = ''; }
    });
  } catch (_) {}
  return MacInstallerLocator.locatePackage(String(argv[0] || ''), ObjC.unwrap($.NSHomeDirectory()), processes, io);
}
