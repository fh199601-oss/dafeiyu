(function () {
  'use strict';
  const BUILD=globalThis.chrome?.runtime?.getManifest?.().version||'preview-0.5.0';
  if (globalThis.TrenchPet?.version===BUILD) return;
  globalThis.TrenchPet?.dispose?.();
  document.dispatchEvent(new Event('trench-pet-replace'));
  document.getElementById('trench-pet-root')?.remove();
  const C = globalThis.TrenchCore;
  const RESULT_VISIBLE_MS = 5000;
  const RESEARCH_CLICK_WINDOW_MS=1500;
  const READ_RECEIPT_PREFIX='grokNotificationRead:';
  const extension = !!globalThis.chrome?.runtime?.id;
  const asset = name => extension ? chrome.runtime.getURL(name) : new URL(name, document.baseURI).href;
  const request = async payload => {
    let deadline;
    try {
      const pending = !extension && globalThis.TrenchPreviewBridge ? TrenchPreviewBridge.send(payload) : chrome.runtime.sendMessage(payload);
      const timeout=/^grok:(research|pair|retry)$/.test(payload.type)?90000:payload.type.endsWith('finance-peek')?5000:15000;
      const answer = await Promise.race([pending,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('连接暂时没有响应，请再点一次重试')),timeout);})]);
      if (!answer?.ok) throw new Error(answer?.error || '插件连接已断开');
      return answer;
    } catch (error) { throw new Error(error.message?.includes('invalidated') ? '插件已更新，正在恢复页面连接；若未恢复请刷新网页' : error.message); }finally{clearTimeout(deadline);}
  };
  function mount({ container = document.documentElement, preview = false, settings: initial, onAction, patch: customPatch } = {}) {
    const host = document.createElement('div');
    host.id = preview ? 'trench-pet-preview' : 'trench-pet-root';
    // Resetting all properties also overrides the stylesheet's :host palette.
    // Set it after the reset: CanvasText can be white on a dark-scheme document.
    host.setAttribute('style', `all:initial!important;color:#253858!important;color-scheme:only light!important;position:${preview ? 'absolute' : 'fixed'}!important;inset:0!important;pointer-events:none!important;z-index:${preview ? '5' : '2147483646'}!important;display:block!important;`);
    const shadow = host.attachShadow({ mode: 'open' });
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = asset('pet.css');
    shadow.append(link);
    const world = document.createElement('div'); world.className = 'world';
    world.innerHTML = `<div class="pet"><div class="motion"><div class="sprite"></div></div><button class="hit" aria-label="大肥鱼：点击摸头，拖动搬家，右键打开动作菜单"></button></div><button class="pocket" title="叫大肥鱼出来" aria-label="展开大肥鱼" hidden>🐋</button><div class="bubble" role="status" aria-live="polite" hidden><small></small><p></p><button class="bubble-close" aria-label="关闭气泡">×</button></div><div class="menu" hidden><div class="menu-head"><strong>陪你玩一会儿</strong><button aria-label="关闭动作菜单">×</button></div><div class="menu-grid"></div><p class="menu-note">交易与消息动作均为体验，不代表真实数据。</p><div class="menu-foot"><button data-tool="home">打开宠物小屋 ↗</button><button data-tool="collapse">收进口袋</button><button data-tool="exclude">本站不打扰</button></div></div>`;
    shadow.append(world); container.append(host);
    const bubbleShape=document.createElementNS('http://www.w3.org/2000/svg','svg');
    bubbleShape.setAttribute('class','bubble-outline');bubbleShape.setAttribute('viewBox','0 0 320 200');bubbleShape.setAttribute('preserveAspectRatio','none');bubbleShape.setAttribute('aria-hidden','true');
    bubbleShape.innerHTML='<path d="M160 5C245 3 310 41 313 91C316 139 246 180 155 180C148 180 141 180 134 179C127 194 101 196 91 181C88 177 88 174 87 171C39 157 7 127 6 93C4 46 70 7 160 5Z" fill="white" stroke="#243468" stroke-width="4.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
    const bubbleThoughts=document.createElementNS('http://www.w3.org/2000/svg','svg');
    bubbleThoughts.setAttribute('class','bubble-thoughts');bubbleThoughts.setAttribute('viewBox','0 0 66 48');bubbleThoughts.setAttribute('aria-hidden','true');
    bubbleThoughts.innerHTML='<ellipse cx="16" cy="12" rx="13" ry="9" fill="white" stroke="#243468" stroke-width="4.5"/><ellipse cx="48" cy="38" rx="8" ry="6" fill="white" stroke="#243468" stroke-width="4"/>';
    world.querySelector('.bubble').prepend(bubbleShape,bubbleThoughts);
    world.style.setProperty('--pet-atlas', `url("${asset('assets/whale-poses.png')}")`);
    const pet = shadow.querySelector('.pet'), motion = shadow.querySelector('.motion');
    const canvas = document.createElement('canvas'); canvas.className = 'rig-canvas';
    canvas.setAttribute('aria-hidden', 'true'); motion.replaceChildren(canvas);
    const rig = WhaleRig.create(canvas, asset('assets/whale-poses.png'));
    const hit = shadow.querySelector('.hit'), bubble = shadow.querySelector('.bubble'), menu = shadow.querySelector('.menu'), pocket = shadow.querySelector('.pocket');
    let settings = C.sanitizeSettings(initial), action = 'idle', sleeping = false, destroyed = false;
    const speak=C.createSpeaker();
    let actionTimer = 0, bubbleTimer = 0, idleTimer = 0, pointer = null, bounds, clicks = [], audio = null;
    let clickBuffer = null, clickLoading = null, clickSource = null, audioGeneration = 0, audioPlays = 0;
    let financeGeneration = 0, financeTimer = 0;
    let researchClickCount=0,researchClickStart=0,researchClickContext='';
    let pendingNotifications=[], showingNotification='', notificationTimer=0, lastInboxCheck=0, inboxRevision=-1;
    const readNotifications=new Set();
    const pendingReads=new Map();let readRetryTimer=0,writingReads=null,inboxRefresh=null,inboxReady=true;
    let point = { x: 0, y: 0 }, seen = new Set(), localPosition = preview ? { x: .5, y: .68 } : settings.position;
    const cleanups = [];
    function listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); }
    const dimensions = () => preview ? { width: container.clientWidth, height: container.clientHeight } : { width: innerWidth, height: innerHeight };
    async function patch(change) {
      try {
        if (preview && (change.position || 'collapsed' in change)) {
          settings = C.patchSettings(settings, change);
          if (change.position) localPosition = change.position;
          render(); return;
        }
        const result = customPatch ? await customPatch(change) : await request({ type: 'settings:patch', patch: change });
        update(result.settings || result);
      } catch (error) { say(error.message); }
    }
    function placeOverlays() {
      const d = dimensions();
      const detailed=bubble.classList.contains('finance-bubble')||bubble.classList.contains('notification-bubble');
      const longText=Array.from(bubble.querySelector('p').textContent||'').length>38;
      const preferred=detailed?C.clamp(bounds.size*1.03+14,196,236):C.clamp(bounds.size,156,214);
      const rows=bubble.classList.contains('finance-bubble')?[...bubble.querySelectorAll('.finance-row')]:[];
      const rowWidth=rows.reduce((max,row)=>Math.max(max,[...row.children].reduce((sum,node)=>sum+node.getBoundingClientRect().width,0)+(parseFloat(getComputedStyle(row).columnGap)||0)),0);
      const padding=getComputedStyle(bubble);
      const required=rowWidth+(parseFloat(padding.paddingLeft)||0)+(parseFloat(padding.paddingRight)||0);
      const bw=Math.min(Math.max(preferred+(longText?20:0),Math.ceil(required)),252,d.width-24);
      bubble.style.width=`${bw}px`;
      const bh=bubble.offsetHeight||88;
      const gap=32+bounds.size*.09;
      bubble.style.left = `${C.clamp(point.x + bounds.size / 2 - bw / 2, 12, Math.max(12, d.width - bw - 12))}px`;
      bubble.style.top = `${C.clamp(point.y-bh-gap,12,Math.max(12,d.height-bh-44))}px`;
      const mw = Math.min(254, d.width - 24), mh = menu.offsetHeight || 260;
      menu.style.left = `${C.clamp(point.x + bounds.size / 2 - mw / 2, 12, Math.max(12, d.width - mw - 12))}px`;
      menu.style.top = `${C.clamp(point.y - mh - 10, 12, Math.max(12, d.height - mh - 12))}px`;
    }
    function render() {
      if (destroyed) return;
      const d = dimensions();
      bounds = C.placement(localPosition, d.width, d.height, preview ? Math.max(settings.size, 220) : settings.size);
      if (!pointer?.moved) point = { x: bounds.x, y: bounds.y };
      Object.assign(pet.style, { left: `${point.x}px`, top: `${point.y}px`, width: `${bounds.size}px`, height: `${bounds.size}px` });
      host.hidden = !preview && (!settings.enabled || C.isExcluded(location.hostname, settings.excludedSites));
      // hidden is overridden by the host's deliberate inline reset, so explicitly set visibility.
      host.style.setProperty('visibility', host.hidden ? 'hidden' : 'visible', 'important');
      pet.hidden = settings.collapsed;
      pocket.hidden = !settings.collapsed;
      Object.assign(pocket.style, { left: `${C.clamp(point.x + bounds.size - 50, 10, Math.max(10, d.width - 58))}px`, top: `${C.clamp(point.y + bounds.size - 50, 10, Math.max(10, d.height - 58))}px` });
      world.classList.toggle('reduced', settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches);
      world.classList.toggle('paused', document.hidden || host.hidden);
      rig.configure({size: bounds.size, enabled: !document.hidden && !host.hidden && !settings.collapsed && (!preview || d.width > 0), reduced: world.classList.contains('reduced')});
      if (host.hidden || settings.collapsed) { bubble.hidden = true; menu.hidden = true; }
      placeOverlays();
    }
    function dismissBubbleAfterResult(onDismiss) {
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => {
        bubbleTimer = 0;
        if(destroyed || bubble.hidden || document.hidden || host.hidden || settings.collapsed)return;
        onDismiss?.();bubble.hidden = true;showNotification();
      }, RESULT_VISIBLE_MS);
    }
    function say(text, demo = false, duration = RESULT_VISIBLE_MS, chain = '') {
      showingNotification='';bubble.classList.remove('notification-bubble');
      stopFinance(); bubble.classList.remove('finance-bubble'); bubble.removeAttribute('title');
      clearTimeout(bubbleTimer);
      bubble.querySelector('p').textContent = text;
      bubble.querySelector('small').textContent = demo ? `动作体验${chain ? ` · ${chain === 'bsc' ? 'BSC' : 'Solana'}` : ''}` : '';
      bubble.hidden = false; placeOverlays();
      bubbleTimer = duration > 0 ? setTimeout(() => { bubbleTimer=0;bubble.hidden = true; showNotification(); }, duration) : 0;
    }
    function stopFinance() { financeGeneration++; clearTimeout(financeTimer); }
    function resetResearchClicks(){researchClickCount=0;researchClickStart=0;researchClickContext='';}
    function researchClick(){
      if(researchBusy){resetResearchClicks();return;}
      const now=performance.now(),context=location.origin+location.pathname;
      // The whole gesture must fit in 1.5s from the first click; a succession
      // of slow clicks must not extend the deadline indefinitely.
      if(!researchClickCount||context!==researchClickContext||now-researchClickStart>RESEARCH_CLICK_WINDOW_MS){
        researchClickCount=0;researchClickStart=now;researchClickContext=context;
      }
      researchClickCount++;
      if(researchClickCount>=settings.xResearchClicks){resetResearchClicks();research();}
    }
    function accountBubble(fromInteraction=false) {
      if (preview || !extension || !globalThis.TrenchFinance) return;
      const provider = C.clickAction(settings, location.href);
      if (provider === 'companion') {resetResearchClicks();return;}
      if (provider === 'grok') { if(fromInteraction)researchClick();return; }
      resetResearchClicks();
      const binanceView = settings.binanceView, chainAtStart = TrenchFinance.context(location.href)?.chain;
      stopFinance(); clearTimeout(bubbleTimer); bubbleTimer = 0;
      const generation = financeGeneration;
      let finished = false, lastData = null, queryId='', recoveries=0, transientErrors=0;
      const startedAt=Date.now();
      bubble.classList.add('finance-bubble'); bubble.hidden = false; bubble.removeAttribute('title');
      bubble.querySelector('small').textContent = provider === 'binance' ? '币安 · 查询中' : 'GMGN · 查询中';
      if(provider==='gmgn')bubble.title='GMGN · 查询中';
      bubble.querySelector('p').textContent = '正在读取…'; placeOverlays();
      function alive() {
        if (destroyed || generation !== financeGeneration || pointer?.moved || bubble.hidden || document.hidden || host.hidden || settings.collapsed) return false;
        if (provider !== C.clickAction(settings, location.href) || (provider === 'binance' && binanceView !== settings.binanceView) || chainAtStart !== TrenchFinance.context(location.href)?.chain) { accountBubble(); return false; }
        return true;
      }
      const complete = data => provider === 'binance' ? data?.rows?.length === 2 && data.rows.every(row => row.amount != null) : data?.balance != null && data?.pnl != null;
      const available = data => provider === 'binance' ? data?.rows?.some(row => row.amount != null) : data?.balance != null || data?.pnl != null;
      function draw(data) {
        if (!alive()) return;
        lastData = data;
        const time = data?.at ? new Date(data.at).toLocaleTimeString('zh-CN', { hour12: false }) : '';
        const staleFields = Array.isArray(data?.staleFields) ? data.staleFields : [];
        const state = data?.refreshing ? (data.cached ? '上次 ' : '') + time + ' · 更新中' : staleFields.length ? time + ' · 含上次结果' : data?.cached && data?.nextRefreshAt > Date.now() ? '上次 ' + time : data?.cached ? '上次 ' + time + (data?.reason ? ' · 暂未更新' : '') : time + (data?.reason ? ' · 未全部更新' : '');
        const name = provider === 'binance' ? '币安' : 'GMGN' + (data?.name ? ' · ' + data.name : '') + ' · ' + (data?.count || 0) + ' 个钱包';
        const details=name + (state ? ' · ' + state : '');
        const gmgnHeading = 'GMGN' + (time ? ' · ' + (data?.cached || staleFields.length ? '上次 ' : '') + time : data?.refreshing ? ' · 更新中' : '');
        bubble.querySelector('small').textContent = provider === 'gmgn' ? gmgnHeading : details;
        bubble.title = (provider === 'binance' ? (data?.scope || '') + (data?.walletNames?.length ? '总资产覆盖：' + data.walletNames.join('、') + '。' : '') : details+'\n仅汇总当前保存的钱包名单。API 1d 已实现盈亏可能与主页 24h 不同。') + (data?.reason || '') + (data?.nextRefreshAt > Date.now() ? ' 下次可刷新：' + new Date(data.nextRefreshAt).toLocaleTimeString('zh-CN',{hour12:false}) : '');
        if(provider==='gmgn')for(const field of staleFields){const at=data[field+'At'];bubble.title+=' '+(field==='balance'?'余额':'盈亏')+'为上次结果'+(at?'（'+new Date(at).toLocaleString('zh-CN',{hour12:false})+'）':'')+'。';}
        const rows = provider === 'binance' ? (data?.rows || []).map(row => ({ label: row.label, amount: row.amount, pnl: row.pnl,
          text: row.amount == null ? (data?.refreshing ? '更新中…' : '未取得') : (row.pnl && Number(row.amount) > 0 ? '+' : '') + TrenchFinance.format(row.amount, 2) + ' ' + row.unit })) : [
          { label: (data?.symbol || '主币') + '余额', amount: data?.balance, text: TrenchFinance.format(data?.balance, 8) ?? (data?.refreshing ? '更新中…' : '暂未取得') },
          { label: '1日已实现', amount: data?.pnl, pnl: true, text: TrenchFinance.format(data?.pnl, 2, true) ?? (data?.refreshing ? '更新中…' : '暂未取得') }];
        const body = bubble.querySelector('p'); body.replaceChildren();
        for (const row of rows.slice(0, 2)) {
          const line = document.createElement('span'); line.className = 'finance-row';
          const label = document.createElement('span'); label.textContent = row.label + '：';
          const value = document.createElement('strong'); value.textContent = row.text;
          value.className = row.amount == null ? 'finance-missing' : row.pnl && Number(row.amount) ? Number(row.amount) > 0 ? 'finance-positive' : 'finance-negative' : 'finance-neutral';
          line.append(label, value); body.append(line);
        }
        if (!available(data) && !data?.refreshing && data?.reason) body.textContent = data.reason;
        placeOverlays();
      }
      function end(data,error){
        finished=true;if(!alive())return;
        const reason=error?.message||data?.reason||'';
        if(!available(data)&&available(lastData))draw({...lastData,cached:true,refreshing:false,reason:reason||'本次刷新未完成，显示上次结果'});
        else if(data)draw({...data,refreshing:false});
        else {bubble.querySelector('small').textContent=provider==='binance'?'币安 · 暂未更新':'GMGN · 暂未更新';if(provider==='gmgn')bubble.title='GMGN · 暂未更新';bubble.querySelector('p').textContent=reason||'连接暂时中断，再点一下即可重试';placeOverlays();}
        dismissBubbleAfterResult(stopFinance);
      }
      async function start(){
        const {finance}=await request({type:provider+':finance-start'});if(!alive())return;
        queryId=finance?.queryId||'';
        if(available(finance))draw(finance);
        else if(available(lastData))draw({...lastData,cached:true,refreshing:!!finance?.refreshing});
        if(!finance?.refreshing){end(finance);return;}
        financeTimer=setTimeout(poll,400);
      }
      async function poll() {
        if (!alive()||finished) return;
        if(Date.now()-startedAt>150000){end(null,new Error('本次查询超时，再点一次会重新查询'));return;}
        try{
          const {finance}=await request({type:provider+':finance-peek'});if(!alive())return;
          if(!finance||finance.queryId!==queryId){
            // Another tab may already have started (or completed) a newer read
            // of this same account/chain. Adopt that result instead of racing
            // it with another fetch or mistaking it for a worker restart.
            if(finance?.queryId&&(finance.refreshing||Number(finance.at)>=startedAt))queryId=finance.queryId;
            else{
              if(recoveries++<1){await start();return;}
              end(null,new Error('后台连接已重建，请再点一次查询最新数据'));return;
            }
          }
          transientErrors=0;
          if(!finance.refreshing){end(finance);return;}
          if(available(finance)&&(!complete(lastData)||complete(finance)))draw(finance);
        }catch(error){if(transientErrors++>=1){end(null,error);return;}}
        if(alive()&&!finished)financeTimer=setTimeout(poll,450);
      }
      (async()=>{
        try{const {finance}=await request({type:provider+':finance-peek',checkWallets:provider==='gmgn'&&fromInteraction});if(alive()){
          // Peek is only a preview. Let the background start/gate decide whether
          // to reuse it, join an in-flight query, or refresh, as settings do.
          if(available(finance))draw({...finance,cached:true,refreshing:true});
        }}catch{}
        if(alive())await start();
      })().catch(async error=>{if(!alive())return;if(!error.message.includes('插件已更新')){try{await start();return;}catch(second){error=second;}}end(null,error);});
    }
    let researchBusy = false, researchGeneration = 0, researchAbort;
    function notificationHeading(task){
      const name=document.createElement('span');name.className='notification-owner';name.textContent=task.botName;name.title=task.botName;
      const count=document.createElement('span');count.className='notification-count';count.textContent=' · '+pendingNotifications.length+' 条未读';
      bubble.querySelector('small').replaceChildren(name,count);placeOverlays();
    }
    function aiBubble(task, completed = false) {
      const accepted = task.status === 'accepted', sending = task.status === 'sending';
      const title = completed ? task.status === 'completed' ? '任务已完成' : '任务有新状态' : accepted ? '已发送任务' : sending ? '正在发送任务…' : task.status === 'publishing' ? '报告发送待确认' : '请查看任务状态';
      say(`${task.botName}：${title}`, false, sending || completed ? 0 : RESULT_VISIBLE_MS);
      const p = bubble.querySelector('p'); p.replaceChildren();
      const a = document.createElement('a');
      if (!/^grokbot:\/\/app\/v1\/agent\?id=[A-Za-z0-9_-]{1,128}$/.test(task.botUrl || '')) { p.textContent = '请在小屋的 AI 连接中查看任务'; return; }
      const letters=Array.from(task.botName||'Bot'),name=letters.length>18?letters.slice(0,18).join('')+'…':task.botName;
      a.href = task.botUrl; a.textContent = `${name}：${completed&&task.status==='completed'?speak('researchComplete'):!completed&&accepted?speak('researchAccepted'):title+'，点击查看'} ↗`;
      a.className = 'grok-result-link'; a.title = task.botName+'\n'+(task.summary || '打开对应的 Grok Bot'); p.append(a);
      if(completed){
        bubble.classList.add('notification-bubble');showingNotification=task.id;
        // Completion reminders stay unread and visible until an explicit open
        // or close. Ordinary results and submission confirmations keep 5s.
        a.addEventListener('click',()=>readNotification(task.id));
      }
      bubble.querySelector('small').textContent = 'Grok Bot · ' + (task.status === 'completed' ? '研究报告' : '项目研究'); placeOverlays();
      if(completed)notificationHeading(task);
    }
    function receiveNotifications(events,revision=0){
      if(!Number.isSafeInteger(revision)||revision<inboxRevision||destroyed)return;
      inboxRevision=revision;inboxReady=true;
      pendingNotifications=Array.isArray(events)?events.filter(e=>e&&!readNotifications.has(e.id)&&['completed','failed','interrupted'].includes(e.status)&&/^grokbot:\/\/app\/v1\/agent\?id=[A-Za-z0-9_-]{1,128}$/.test(e.botUrl||'')).slice(0,40):[];
      if(showingNotification&&!pendingNotifications.some(e=>e.id===showingNotification)){showingNotification='';bubble.hidden=true;}
      const current=pendingNotifications.find(e=>e.id===showingNotification);
      if(current&&!bubble.hidden)notificationHeading(current);
      showNotification();
    }
    function applyReadReceipt(receipt){
      if(!receipt||!/^[A-Za-z0-9_-]{1,128}$/.test(receipt.id||'')||!Number.isFinite(receipt.readAt)||receipt.readAt<Date.now()-7*86400000||receipt.readAt>Date.now()+60000||!/^grokbot:\/\/app\/v1\/agent\?id=[A-Za-z0-9_-]{1,128}$/.test(receipt.botUrl||''))return;
      readNotifications.add(receipt.id);pendingNotifications=pendingNotifications.filter(e=>e.id!==receipt.id);
      if(showingNotification===receipt.id){showingNotification='';clearTimeout(bubbleTimer);bubbleTimer=0;bubble.hidden=true;}
      showNotification();
    }
    function flushReadReceipts(){
      if(writingReads||destroyed||!pendingReads.size)return writingReads;
      clearTimeout(readRetryTimer);
      writingReads=(async()=>{
        for(const [id,receipt] of pendingReads){
          try{
            // A per-message outbox survives focus changes, page closure and a
            // sleeping worker. Other pages can hide it immediately via storage.
            if(receipt.botUrl)await chrome.storage.local.set({[READ_RECEIPT_PREFIX+id]:receipt});
            const result=await request({type:'grok:notification-read',id});
            pendingReads.delete(id);receiveNotifications(result.events,result.revision);
          }catch{}
        }
      })().finally(()=>{writingReads=null;if(!destroyed&&pendingReads.size)readRetryTimer=setTimeout(flushReadReceipts,2000);});
      return writingReads;
    }
    function readNotification(id){
      const task=pendingNotifications.find(e=>e.id===id);
      pendingReads.set(id,{id,status:task?.status,botUrl:task?.botUrl,readAt:Date.now()});
      clearTimeout(bubbleTimer);bubbleTimer=0;
      readNotifications.add(id);
      pendingNotifications=pendingNotifications.filter(e=>e.id!==id);showingNotification='';bubble.hidden=true;
      flushReadReceipts();showNotification();
    }
    function syncInboxRecord(data){
      if(!Number.isSafeInteger(data?.revision)||data.revision<inboxRevision||destroyed)return;
      for(const item of data?.items||[])if(item.readAt)readNotifications.add(item.id);
      receiveNotifications((data?.items||[]).filter(item=>!item.readAt),data.revision);
    }
    function refreshInbox(force=false){
      if(preview||!extension||destroyed)return;
      if(inboxRefresh)return inboxRefresh;
      if(!force&&Date.now()-lastInboxCheck<1000)return;
      lastInboxCheck=Date.now();inboxReady=false;
      inboxRefresh=(async()=>{
        try{
          const stored=await chrome.storage.local.get(null);if(destroyed)return;
          for(const [key,receipt] of Object.entries(stored))if(key.startsWith(READ_RECEIPT_PREFIX))applyReadReceipt(receipt);
          if(stored.grokNotificationInbox)syncInboxRecord(stored.grokNotificationInbox);
          else inboxReady=true;
          showNotification();
        }catch{}
        try{const result=await request({type:'grok:inbox'});if(!destroyed)receiveNotifications(result.events,result.revision);}catch{}
      })().finally(()=>{inboxRefresh=null;});
      flushReadReceipts();return inboxRefresh;
    }
    function showNotification(){
      clearTimeout(notificationTimer);
      const next=pendingNotifications[0];
      if(!next||!inboxReady||preview||destroyed||document.hidden||host.hidden||settings.collapsed)return;
      if(showingNotification&&!bubble.hidden)return;
      if(researchBusy||pointer||!menu.hidden||!bubble.hidden){notificationTimer=setTimeout(showNotification,1200);return;}
      play('news',{silent:true});aiBubble(next,true);chime();
    }
    async function research() {
      if (researchBusy || !globalThis.TrenchX) return;
      const generation = ++researchGeneration; researchBusy = true;
      const controller = researchAbort = new AbortController();
      try {
        const detailId = TrenchX.postId(location.href);
        let post = TrenchX.current();
        if (!post && detailId) {
          say('正在读取这条帖子…',false,0);
          post = await TrenchX.waitCurrent({ signal: controller.signal });
          if (destroyed || document.hidden || controller.signal.aborted || generation !== researchGeneration || detailId !== TrenchX.postId(location.href)) return;
          if (!post) { say('暂时没能读到这条帖子的文字，请展开正文后再试。'); return; }
        }
        if (!post) { say('点一下要研究的帖子；5 秒未选择自动退出，随时按 Esc 取消。', false, 0); post = await TrenchX.select({ signal: controller.signal }); }
        if (destroyed || document.hidden || controller.signal.aborted || generation !== researchGeneration) return;
        if (!post) { bubble.hidden = true; showNotification(); return; }
        say('正在把这条帖子交给你的 Bot…', false, 0);
        const result = await request({ type: 'grok:research', post });
        if (!destroyed && !document.hidden && generation === researchGeneration) aiBubble(result.task);
      } catch (error) { if (!destroyed && !document.hidden && !controller.signal.aborted && generation === researchGeneration) say(error.message); }
      finally { researchBusy = false; if (researchAbort === controller) researchAbort = null; }
    }
    function unlockAudio() {
      if (!settings.sound && !settings.interactionSound) return;
      try {
        audio ||= new AudioContext();
        if (audio.state === 'suspended') audio.resume().catch(() => {});
        clickLoading ||= audio.decodeAudioData(Uint8Array.from(atob(WhaleClickAudio), c => c.charCodeAt(0)).buffer)
          .then(buffer => { clickBuffer = buffer; }).catch(() => { canvas.dataset.audio = 'unavailable'; });
      } catch {}
    }
    async function gugi() {
      if (!settings.interactionSound || document.hidden) return;
      unlockAudio(); const generation = ++audioGeneration;
      await clickLoading;
      if (generation !== audioGeneration || destroyed || !settings.interactionSound || document.hidden || !clickBuffer || audio?.state !== 'running') return;
      clickSource?.stop();
      const source = audio.createBufferSource(), gain = audio.createGain();
      source.buffer = clickBuffer; gain.gain.value = .65; source.connect(gain); gain.connect(audio.destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); if (clickSource === source) clickSource = null; };
      source.start(); clickSource = source; audioPlays++; canvas.dataset.audio = 'played';
    }
    function chime() {
      if (!settings.sound || document.hidden || !audio || audio.state !== 'running') return;
      const now = audio.currentTime;
      for (let i = 0; i < 2; i++) {
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.type = 'sine'; osc.frequency.value = i ? 880 : 660;
        gain.gain.setValueAtTime(0, now + i * .12);
        gain.gain.linearRampToValueAtTime(.04, now + i * .12 + .015);
        gain.gain.exponentialRampToValueAtTime(.001, now + i * .12 + .18);
        osc.connect(gain); gain.connect(audio.destination); osc.start(now + i * .12); osc.stop(now + i * .12 + .2);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      }
    }
    function scheduleIdle() {
      clearTimeout(idleTimer);
      if (destroyed || document.hidden || settings.energy === 'quiet' || !settings.enabled || settings.collapsed || host.hidden) return;
      const delay = settings.energy === 'lively' ? 18000 + Math.random() * 17000 : 45000 + Math.random() * 40000;
      idleTimer = setTimeout(() => {
        if (action === 'idle' && !pointer && menu.hidden) play(Math.random() < .5 ? 'peek' : 'sleep', { silent: true, temporary: true });
        scheduleIdle();
      }, delay);
    }
    function play(next, { demo = false, silent = false, temporary = false, chain = '' } = {}) {
      if (destroyed || !C.ACTIONS[next]) return false;
      clearTimeout(actionTimer);
      action = next;
      rig.play(next);
      if (next === 'sleep' && !temporary) sleeping = true;
      else if (next !== 'drag') sleeping = false;
      motion.dataset.motion = C.ACTIONS[next].motion;
      pet.dataset.action = next;
      render();
      if (!silent) say(speak(next), demo, RESULT_VISIBLE_MS, chain);
      if (next === 'alert' || next === 'profit') chime();
      if (next === 'pat' && !silent) gugi();
      onAction?.(next, demo);
      const duration = temporary ? 6500 : C.ACTIONS[next].duration;
      if (duration) actionTimer = setTimeout(() => play('idle', { silent: true }), duration);
      scheduleIdle(); return true;
    }
    function update(value) {
      const previousProvider = C.clickAction(settings, location.href), previousView = settings.binanceView,previousResearchClicks=settings.xResearchClicks;
      settings = C.sanitizeSettings(value);
      if(previousResearchClicks!==settings.xResearchClicks||previousProvider!==C.clickAction(settings,location.href)||!settings.enabled||settings.collapsed)resetResearchClicks();
      if (previousProvider !== C.clickAction(settings, location.href) || previousView !== settings.binanceView) {
        researchGeneration++; researchAbort?.abort(); globalThis.TrenchX?.cancel();
        stopFinance(); clearTimeout(bubbleTimer); bubble.hidden = true;
      }
      if (!settings.interactionSound) { audioGeneration++; clickSource?.stop(); clickSource = null; }
      if (!preview) localPosition = settings.position;
      render(); scheduleIdle();showNotification();
    }
    function toggleMenu() { resetResearchClicks();stopFinance(); clearTimeout(bubbleTimer);bubbleTimer=0;menu.hidden = !menu.hidden; bubble.hidden = true; render();if(menu.hidden)showNotification(); }
    for (const [key, info] of Object.entries(C.ACTIONS)) {
      if (key === 'drag') continue;
      const button = document.createElement('button'); button.textContent = info.name;
      button.dataset.action = key;
      listen(button, 'click', () => { unlockAudio(); menu.hidden = true; play(key, { demo: ['buy', 'profit', 'close', 'comfort', 'alert', 'news'].includes(key) }); });
      menu.querySelector('.menu-grid').append(button);
    }
    listen(hit, 'pointerdown', event => {
      if (event.button !== 0) return;
      unlockAudio(); hit.setPointerCapture(event.pointerId);
      pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastTime: performance.now(), x: point.x, y: point.y, moved: false };
      menu.hidden = true; event.preventDefault();
    });
    listen(hit, 'pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.startX, dy = event.clientY - pointer.startY;
      if (!pointer.moved && Math.hypot(dx, dy) > 5) { resetResearchClicks();stopFinance(); pointer.moved = true; play('drag', { silent: true }); bubble.hidden = true; pet.classList.add('dragging'); }
      if (!pointer.moved) return;
      const now = performance.now(), dt = Math.max(8, now - pointer.lastTime);
      rig.drag((event.clientX - pointer.lastX) / dt * 1000 * 512 / bounds.size);
      pointer.lastX = event.clientX; pointer.lastTime = now;
      point = { x: C.clamp(pointer.x + dx, bounds.margin, bounds.maxX), y: C.clamp(pointer.y + dy, bounds.margin, bounds.maxY) };
      render();
    });
    function release(event, cancelled = false) {
      if (!pointer || event.pointerId !== pointer.id) return;
      const wasDragged = pointer.moved; pointer = null; pet.classList.remove('dragging');
      if (wasDragged) {
        localPosition = C.normalizedPosition(point.x, point.y, bounds);
        patch({ position: localPosition }); play('pat', { silent: true });
      } else if (!cancelled) {
        const now = Date.now(); clicks = clicks.filter(time => now - time < 1800); clicks.push(now);
        const impatient = clicks.length >= 10;
        play(impatient ? 'pout' : 'pat', {silent:researchBusy});
        if (impatient || researchBusy) gugi();
        accountBubble(true);
      }
      if(cancelled)resetResearchClicks();
    }
    listen(hit, 'pointerup', event => release(event));
    listen(hit, 'pointercancel', event => release(event, true));
    listen(hit, 'lostpointercapture', event => release(event, true));
    listen(hit, 'contextmenu', event => { event.preventDefault(); toggleMenu(); });
    listen(hit, 'keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault();if(event.repeat)return;unlockAudio(); play('pat',{silent:researchBusy});if(researchBusy)gugi();accountBubble(true); }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); toggleMenu(); }
      if (event.key.startsWith('Arrow')) {
        event.preventDefault(); const delta = event.shiftKey ? 30 : 10;
        const dx = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
        const dy = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
        localPosition = C.normalizedPosition(point.x + dx, point.y + dy, bounds); patch({ position: localPosition }); render();
      }
    });
    listen(shadow, 'click', event => {
      const tool = event.target.closest('[data-tool]')?.dataset.tool;
      if (tool === 'menu') toggleMenu();
      if (tool === 'sleep') play(sleeping ? 'idle' : 'sleep');
      if (tool === 'collapse') patch({ collapsed: true });
      if (tool === 'home') request({ type: 'open:home' }).catch(error => say(error.message));
      if (tool === 'exclude') {
        if (preview) { say('在普通网页上使用“本站不打扰”即可。'); return; }
        patch({ excludedSites: [...settings.excludedSites, location.hostname] });
      }
    });
    listen(pocket, 'click', () => { patch({ collapsed: false }); play('peek'); });
    listen(menu.querySelector('.menu-head button'), 'click', () => { menu.hidden = true;showNotification(); });
    listen(bubble.querySelector('button'), 'click', () => { if(showingNotification){readNotification(showingNotification);return;}globalThis.TrenchX?.cancel();stopFinance(); bubble.hidden = true;showNotification(); });
    listen(document, 'keydown', event => { if (event.key === 'Escape') { resetResearchClicks();researchAbort?.abort(); globalThis.TrenchX?.cancel(); stopFinance(); menu.hidden = true; bubble.hidden = true; showNotification(); } });
    listen(document, 'visibilitychange', () => { render(); scheduleIdle(); if (document.hidden) { resetResearchClicks();inboxReady=false;stopFinance();clearTimeout(bubbleTimer);bubbleTimer=0;audioGeneration++; clickSource?.stop(); clickSource = null; bubble.hidden = true; menu.hidden = true; }else{refreshInbox(true);} });
    listen(window,'blur',resetResearchClicks);
    listen(window,'popstate',resetResearchClicks);
    listen(window,'focus',()=>{refreshInbox(true);});
    listen(document, 'pointermove', event => {
      if (pointer || !bounds || document.hidden || host.hidden) return;
      const origin = preview ? container.getBoundingClientRect() : {left:0,top:0};
      rig.gaze((event.clientX-origin.left-point.x-bounds.size/2)/250,(event.clientY-origin.top-point.y-bounds.size*.45)/250);
    }, {passive:true});
    listen(window, 'resize', render);
    const media = matchMedia('(prefers-reduced-motion: reduce)'); listen(media, 'change', render);
    const observer = preview ? new ResizeObserver(render) : null; observer?.observe(container);
    const messages = (message, sender, respond) => {
      if(sender.id===chrome.runtime.id&&message?.type==='pet:ping'){respond({ok:true,version:BUILD});return;}
      if(sender.id===chrome.runtime.id&&message?.type==='grok:notifications'){receiveNotifications(message.events,message.revision);respond({queued:true});return;}
      if (sender.id === chrome.runtime.id && message?.type === 'grok:event') {
        const event = message.event, id = `grok:${event?.id}:${event?.seq}`;
        if (seen.has(id)) { respond({ displayed: true }); return; }
        if (!event || document.hidden || host.hidden || settings.collapsed || destroyed || researchBusy || pointer || !menu.hidden) { respond({ displayed: false }); return; }
        seen.add(id); if (seen.size > 100) seen.delete(seen.values().next().value);
        play('news', { silent: true }); aiBubble(event, true); chime(); respond({ displayed: true }); return;
      }
      if (sender.id === chrome.runtime.id && message?.type === 'finance:invalidate') {
        stopFinance(); if(bubble.classList.contains('finance-bubble'))bubble.hidden=true;
        showNotification(); respond({ ok: true }); return;
      }
      if (sender.id !== chrome.runtime.id || message?.type !== 'pet:event') return;
      const event = message.event;
      if (event?.source !== 'demo' || !C.ACTIONS[event.action]) { respond({ ok: false, error: '不支持的事件' }); return; }
      if (seen.has(event.id)) { respond({ ok: true, duplicate: true }); return; }
      if (document.hidden) { respond({ ok: false, error: '请先切回这个网页，再体验动作' }); return; }
      seen.add(event.id); if (seen.size > 100) seen.delete(seen.values().next().value);
      if (settings.collapsed) patch({ collapsed: false });
      play(event.action, { demo: true, chain: event.chain }); respond({ ok: true });
    };
    if (extension && !preview) chrome.runtime.onMessage.addListener(messages);
    function destroy() {
      if(destroyed)return;
      researchGeneration++; researchAbort?.abort(); globalThis.TrenchX?.cancel();
      stopFinance(); globalThis.TrenchWalletSync?.stop();
      destroyed = true; clearTimeout(actionTimer); clearTimeout(bubbleTimer); clearTimeout(idleTimer);clearTimeout(notificationTimer);clearTimeout(readRetryTimer);
      cleanups.forEach(fn => fn()); observer?.disconnect();
      // Reloaded extensions can lose their API binding before the old DOM world
      // is disposed. Listener cleanup must not prevent canvas/audio teardown.
      if (extension && !preview) { try { chrome.runtime.onMessage.removeListener(messages); } catch {} }
      audioGeneration++; clickSource?.stop(); rig.destroy(); audio?.close().catch(() => {}); host.remove();
    }
    play('idle', { silent: true });
    return { play, update, destroy, host, refreshInbox, syncInboxRecord, applyReadReceipt, get action() { return action; }, unlockAudio,
      inspect: () => ({...rig.state, audioPlays, audioDuration: clickBuffer?.duration || 0}), ready: rig.ready };
  }
  globalThis.TrenchPet = { mount, request,version:BUILD };
  if (extension && /^https?:$/.test(location.protocol) && window === window.top && !document.getElementById('trench-pet-root')) {
    const pet = mount({ settings: { enabled: false } });
    const resume=()=>{pet.refreshInbox(true);return request({ type: 'state:get' }).then(state => {pet.update(state.settings);}).catch(() => {});};
    const visible=()=>{if(!document.hidden)resume();};
    resume();
    const changed = (changes, area) => { if(area!=='local')return;for(const [key,change] of Object.entries(changes))if(key.startsWith(READ_RECEIPT_PREFIX)&&change.newValue)pet.applyReadReceipt(change.newValue);if(changes.settings)pet.update(changes.settings.newValue);if(changes.grokNotificationInbox)pet.syncInboxRecord(changes.grokNotificationInbox.newValue); };
    chrome.storage.onChanged.addListener(changed);
    const pagehide=event=>{if(!event.persisted)dispose();};
    const dispose=()=>{pet.destroy();try{chrome.storage.onChanged.removeListener(changed);}catch{}window.removeEventListener('pageshow',resume);window.removeEventListener('pagehide',pagehide);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);document.removeEventListener('trench-pet-replace',dispose);};
    globalThis.TrenchPet.dispose=dispose;
    document.addEventListener('trench-pet-replace',dispose,{once:true});
    window.addEventListener('pageshow',resume);
    window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    window.addEventListener('pagehide',pagehide);
  }
})();
