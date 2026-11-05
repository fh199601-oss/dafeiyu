(function () {
  'use strict';
  const $ = id => document.getElementById(id), api = TrenchPet.request;
  const mac = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  $('grok-os-hint').textContent = mac ? ' Mac 解压后双击唯一的安装脚本；需要 macOS 13.5 或更新版本，首次配对按系统提示授权。Mac 面板连接尚待真机验收。' : '';
  let busy = false, poll, current, autoEnable = false, installUntil = 0, unread=[];
  const states = { sending: '发送中', accepted: '研究中', publishing: '等待报告发布确认', completed: '已完成', failed: '未完成', uncertain: '发送未确认', interrupted: '请打开 Bot 查看' };
  const phases = { preparing: '正在建立连接通道…', waiting: '请把下方这句话发送给你想连接的 Bot，等待自动配对。', connecting: '正在连接 Bot 面板，请保持 Grok Bot 桌面版打开。', connected: '已配对', 'needs-attention': '需要你看一下 Grok Bot 面板' };
  function feedback(text) { $('grok-feedback').textContent = text; }
  function draw(c,events=unread) {
    unread=events||[];
    const setup=$('grok-setup-details');if(setup&&(!current||current.configured!==c.configured))setup.open=!c.configured;
    $('grok-settings').dataset.connected=String(Boolean(c.configured));
    current = c; $('grok-badge').textContent = c.installed ? c.configured ? '已连接 · ' + c.bot.name : '组件已就绪' : '待安装组件';
    $('grok-badge').title = $('grok-badge').textContent;
    const connected = c.configured ? c.channel === 'offline' ? `已配对 ${c.bot.name}；网络通道当前离线，发送新任务时会重新建立。在途任务可直接到 Bot 查看。` : `已连接 ${c.bot.name}。完成后会通过大肥鱼提醒，报告在 Bot 中查看。` : '组件已就绪，可以生成配对话。';
    feedback(c.storageError || (c.installed ? c.pair && c.pair.stage !== 'connected' ? phases[c.pair.stage] + (c.pair.error ? '：' + c.pair.error : '') : connected : '请先使用上方“准备安装器”，完成安装后会自动检测。' + (c.error && !/请先/.test(c.error) ? ' '+c.error : '')));
    const expired = c.pair?.stage === 'waiting' && Date.now() > c.pair.expires;
    if (expired) feedback('配对话已过期，请重新生成，再发送给你选择的 Bot。');
    $('grok-pair').disabled = busy || !c.installed || Boolean(c.storageError) || (!expired && ['preparing','connecting','waiting'].includes(c.pair?.stage));
    $('grok-retry').hidden = c.pair?.stage !== 'needs-attention';
    $('grok-cancel').hidden = !c.pair || c.pair.stage === 'connected';
    $('grok-disconnect').hidden = !c.configured && !c.storageError;
    $('grok-disconnect').textContent = c.storageError ? '清除损坏的连接资料' : '断开 Bot';
    $('grok-enable-x').disabled = busy || !c.configured || !c.installed;
    $('grok-pair-box').hidden = !['waiting','connecting','needs-attention'].includes(c.pair?.stage) || !$('grok-prompt').value;
    if (c.prompt) { $('grok-prompt').value = c.prompt; $('grok-pair-box').hidden = false; }
    if (!c.pair || c.pair.stage === 'connected') $('grok-prompt').value = '';
    const list = $('grok-tasks'), focused = document.activeElement;
    const focusedTask = focused?.closest('.grok-task')?.dataset.taskId;
    const focusedControl = focused?.tagName === 'BUTTON' ? 'button' : 'a';
    list.replaceChildren();
    for (const task of [...(c.tasks || [])].reverse().slice(0, 20)) {
      const row = document.createElement('div'); row.className = 'grok-task'; row.dataset.taskId = task.id;
      const isUnread=unread.some(event=>event.id===task.id);row.dataset.unread=String(isUnread);
      const title = document.createElement('strong'); title.textContent = task.title;
      const status = document.createElement('small'); status.textContent = `研究 #${task.id.slice(0,8)} · ${task.botName} · ${states[task.status] || task.status} · ${new Date(task.createdAt).toLocaleString('zh-CN')}`;
      const desc = document.createElement('p'); desc.textContent = task.summary || '研究完成后会在网页提醒你。';
      row.append(title, status, desc);
      if(isUnread){const badge=document.createElement('span');badge.className='grok-unread-label';badge.textContent='未读';row.prepend(badge);}
      const actions=document.createElement('div');actions.className='grok-task-actions';
      const markRead=async()=>{
        try{
          await chrome.storage.local.set({['grokNotificationRead:'+task.id]:{id:task.id,status:task.status,botUrl:task.botUrl,readAt:Date.now()}});
          await api({type:'grok:notification-read',id:task.id});await refresh();
        }catch(e){feedback(e.message);}
      };
      if (/^grokbot:\/\/app\/v1\/agent\?id=[A-Za-z0-9_-]{1,128}$/.test(task.botUrl)) { const a = document.createElement('a'); a.href = task.botUrl; a.textContent = '打开对应 Bot ↗'; a.addEventListener('click',markRead);actions.append(a); }
      if(isUnread){const button=document.createElement('button');button.className='secondary';button.textContent='标为已读';button.addEventListener('click',markRead);actions.append(button);}
      row.append(actions);
      list.append(row);
    }
    if (focusedTask) {
      const row = [...list.children].find(item => item.dataset.taskId === focusedTask);
      const control = row?.querySelector(focusedControl) || row?.querySelector('a');
      control?.focus({ preventScroll: true });
    }
    $('grok-empty').hidden = Boolean(c.tasks?.length);
    clearTimeout(poll);
    if ((c.installed || Date.now()<installUntil) && !document.hidden) poll = setTimeout(refresh, !c.installed || c.pair && c.pair.stage !== 'connected' ? 2000 : 10000);
    if (autoEnable && c.configured && c.pair?.stage === 'connected') { autoEnable = false; api({ type: 'grok:enable-x' }).then(result => feedback(`已连接 ${c.bot.name}，X 项目研究已开启。打开帖子详情，在 1.5 秒内连点大肥鱼 ${result.settings.xResearchClicks} 次即可发送。`)).catch(e => feedback(e.message)); }
  }
  async function refresh() { if (busy) return; try { const result=await api({ type: 'grok:status' });draw(result.connection,result.events); } catch (e) { feedback(e.message); } }
  async function action(type) {
    if (busy) return; busy = true; $('grok-pair').disabled = true; feedback(type === 'grok:pair' ? '正在准备一次性配对话，请稍等…' : '正在处理…');
    try { const r = await api({ type }); if (type === 'grok:pair') autoEnable = $('grok-auto-x').checked; if (['grok:cancel','grok:disconnect'].includes(type)) autoEnable = false; busy = false; draw(r.connection); }
    catch (e) { busy = false; if (current) draw(current); feedback(e.message); }
  }
  $('grok-detect').addEventListener('click', refresh);
  $('grok-pair').addEventListener('click', () => action('grok:pair'));
  $('grok-retry').addEventListener('click', () => action('grok:retry'));
  $('grok-cancel').addEventListener('click', () => action('grok:cancel'));
  $('grok-disconnect').addEventListener('click', () => action('grok:disconnect'));
  $('grok-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('grok-prompt').value); feedback('已复制。粘贴给你新建的 Bot 即可，保持这个设置页和 Grok Bot 打开。'); } catch { $('grok-prompt').select(); feedback('请按 '+(mac?'⌘C':'Ctrl+C')+' 复制配对话。'); } });
  $('grok-enable-x').addEventListener('click', async () => { try { const result=await api({ type: 'grok:enable-x' });feedback(`已开启 X 项目研究。在 1.5 秒内连点大肥鱼 ${result.settings.xResearchClicks} 次；详情页直接发送，信息流中再选择帖子。`); } catch (e) { feedback(e.message); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); else clearTimeout(poll); });
  window.addEventListener('trench-installer-launched',()=>{installUntil=Date.now()+180000;refresh();});
  window.addEventListener('focus',()=>{if(Date.now()<installUntil)refresh();});
  if(globalThis.chrome?.storage)chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.grokNotificationInbox&&!document.hidden)refresh();});
  if (globalThis.chrome?.runtime?.id) refresh(); else { $('grok-pair').disabled = true; feedback('加载浏览器插件后，可在这里连接 Grok Bot。'); }
})();
