/* JXA, run by /usr/bin/osascript. No clipboard or account-file access. */
function run() {
  ObjC.import('Foundation');
  var bytes = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var target = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(target.id || '') || !/^[A-Za-z0-9_-]{1,150}$/.test(target.routineId || '') || !/^(?:大肥鱼连接|精灵连接)·[A-F0-9]{6}$/.test(target.routineName || '') || !target.name) throw Error('BOT_MISMATCH');
  var app = Application.currentApplication(); app.includeStandardAdditions = true;
  var se = Application('System Events'), proc;
  try {
    var matches = se.applicationProcesses.whose({ name: 'Grok Bot' })();
    if (!matches.length) throw Error('GROK_NOT_OPEN'); proc = matches[0];
    try { proc.attributes.byName('AXEnhancedUserInterface').value = true; } catch (_) {}
    try { proc.attributes.byName('AXManualAccessibility').value = true; } catch (_) {}
    // Reading UI elements invokes macOS's standard authorization, never bypasses it.
    proc.windows[0].uiElements();
  } catch (e) { if (String(e).indexOf('GROK_NOT_OPEN') >= 0) throw e; throw Error('ACCESS_REQUIRED'); }
  function attr(node, name) { try { return node.attributes.byName(name).value(); } catch (_) { return ''; } }
  function label(node) { try { var n = node.name(); if (typeof n === 'string' && n) return n; } catch (_) {} try { return node.description() || ''; } catch (_) { return ''; } }
  function role(node) { try { return node.role(); } catch (_) { return ''; } }
  function scanAll(predicate) {
    var queue; try { queue = proc.windows[0].uiElements(); } catch (_) { throw Error('ACCESS_REQUIRED'); }
    var count = 0, found = [];
    while (queue.length && count++ < 3500) {
      var node = queue.shift(); if (predicate(node)) found.push(node);
      try { queue = queue.concat(node.uiElements()); } catch (_) {}
    }
    return found;
  }
  function scan(predicate) { return scanAll(predicate)[0] || null; }
  function unique(predicate) { var found=scanAll(predicate); if(found.length > 1)throw Error('ROUTINE_NOT_FOUND'); return found[0] || null; }
  function wait(predicate, attempts) { for (var i=0;i<(attempts || 4);i++) { var found=scan(predicate); if(found)return found; delay(0.5); } return null; }
  function named(name) { return scan(function(n){return label(n) === name;}); }
  function press(node) { try { node.actions.byName('AXPress').perform(); } catch (_) { try { node.click(); } catch (_) { throw Error('ACCESS_REQUIRED'); } } }
  function isBot(node) { var r=role(node); if(r !== 'AXHeading' && r !== 'AXStaticText' && r !== 'AXGroup')return false;
    return label(node) === target.name && (r === 'AXHeading' || attr(node,'AXIdentifier') === 'sand-conversation-heading' || attr(node,'AXDOMIdentifier') === 'sand-conversation-heading'); }
  function isUrl(n) { return label(n)==='Webhook URL' && ['AXTextField','AXTextArea'].indexOf(role(n))>=0; }
  function panel() { return named(target.routineName) && scan(isBot) ? unique(isUrl) : null; }
  function isRow(n) { var s=label(n);return role(n)==='AXButton' && (s===target.routineName || s.indexOf(target.routineName+' ')===0); }
  function isEntry(n) { return role(n)==='AXButton' && ['打开例行任务 '+target.routineName,'打开例程 '+target.routineName,'Open routine '+target.routineName].indexOf(label(n))>=0; }
  proc.frontmost = true;
  // The host resolves target.id against the selected Bot's official metadata.
  // Prefer the current conversation and its unique pairing entry; avoid changing
  // an already correct UI just because the Bot supplied a wrong callback ID.
  if (!scan(isBot)) {
    app.openLocation('grokbot://app/v1/agent?id=' + encodeURIComponent(target.id));
    if (!wait(isBot)) throw Error('BOT_MISMATCH');
  }
  var urlField = panel();
  if (!urlField) {
    var entry=unique(isEntry), row=unique(isRow);
    if(entry)press(entry);
    else if(row)press(row);
    else app.openLocation('grokbot://app/v1/sidebar?agent=' + encodeURIComponent(target.id) + '&tab=routines');
    // A conversation entry may open the list first, or go straight to details.
    for(var attempt=0;attempt<12;attempt++) {
      if(!scan(isBot))throw Error('BOT_MISMATCH');
      urlField=panel(); if(urlField)break;
      row=unique(isRow); if(row) { press(row); delay(0.5); urlField=panel(); if(urlField)break; }
      delay(0.5);
    }
  }
  if(!urlField || !named(target.routineName) || !scan(isBot))throw Error('ROUTINE_NOT_FOUND');
  // The input may be mounted before its URL value arrives. Wait only for an
  // empty value; a nonempty URL is validated immediately and never retried.
  var url='';
  for(var urlAttempt=0;urlAttempt<=6;urlAttempt++) {
    if(!scan(isBot) || !named(target.routineName))throw Error('ROUTINE_MISMATCH');
    urlField=panel(); if(!urlField)throw Error('ROUTINE_NOT_FOUND');
    url=String(attr(urlField,'AXValue') || '').trim();
    if(url)break;
    if(urlAttempt<6)delay(0.5);
  }
  if(!url)throw Error('ROUTINE_NOT_FOUND');
  var parsed=url.match(/^https:\/\/([A-Za-z0-9.-]+)(?::443)?\/automations\/webhook\/([A-Za-z0-9_%~-]+)$/);
  var host=parsed ? parsed[1].toLowerCase() : '', routineId='';
  try { routineId=parsed ? decodeURIComponent(parsed[2]) : ''; } catch (_) {}
  if(!/(^|\.)(cursor\.com|cursor\.sh|x\.ai|grok\.com)$/.test(host) || routineId!==target.routineId)throw Error('ROUTINE_MISMATCH');
  var revealed=false;
  try {
    var show=named('显示Webhook 密钥') || named('Show Webhook key') || named('Show webhook secret');
    if(show){press(show);revealed=true;}
    if(!scan(isBot) || !named(target.routineName) || String(attr(urlField,'AXValue') || '').trim()!==url)throw Error('ROUTINE_MISMATCH');
    var keyField=wait(function(n){return ['Webhook 密钥','Webhook key','Webhook secret'].indexOf(label(n))>=0 && ['AXTextField','AXTextArea'].indexOf(role(n))>=0;});
    var key=keyField ? String(attr(keyField,'AXValue') || '') : '';
    if(!key || /^[●•*]+$/.test(key))throw Error('KEY_NOT_VISIBLE');
    if(!scan(isBot) || !named(target.routineName) || String(attr(urlField,'AXValue') || '').trim()!==url)throw Error('ROUTINE_MISMATCH');
    return JSON.stringify({url:url,key:key});
  } finally {
    if(revealed){var hide=named('隐藏Webhook 密钥') || named('Hide Webhook key') || named('Hide webhook secret');if(hide)press(hide);}
  }
}
