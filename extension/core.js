/* Shared, deterministic state. No wallet connection or external network requests. */
(function (root) {
  'use strict';
  // Binance defaults to the UTC daily spot + USDT futures estimate.
  const DEFAULTS = Object.freeze({
    enabled: true, size: 180, energy: 'gentle', sound: false, interactionSound: true,
    reducedMotion: false, collapsed: false, position: { x: 1, y: 1 }, excludedSites: [],
    clickMode: 'auto', clickRoutingVersion: 1, clickGmgn: 'gmgn', clickBinance: 'binance', clickX: 'companion', clickOther: 'companion', binanceView: 'daily-pnl', xResearchClicks: 3
  });
  const ACTIONS = Object.freeze({
    idle:    { index: 0, name: '待机晃尾', duration: 0, motion: 'breathe', phrase: '嗯？我在呢。' },
    sleep:   { index: 1, name: '抱尾打盹', duration: 0, motion: 'sleep', phrase: '尾巴借我抱一会儿……' },
    pat:     { index: 2, name: '摸头害羞', duration: 2600, motion: 'shy', phrase: '再摸一下，也可以。' },
    buy:     { index: 3, name: '建仓打气', duration: 2800, motion: 'ready', phrase: '收到！我陪你一起看着。' },
    profit:  { index: 4, name: '落袋欢呼', duration: 3400, motion: 'jump', phrase: '落袋啦！给你撒一点开心。' },
    close:   { index: 5, name: '清仓谢幕', duration: 3000, motion: 'bow', phrase: '这一站收工，辛苦啦。' },
    comfort: { index: 6, name: '递纸安慰', duration: 5000, motion: 'comfort', phrase: '先缓一下，我在这里陪你。' },
    pout:    { index: 7, name: '气鼓鼓', duration: 2400, motion: 'pout', phrase: '戳这么多下，脸都要鼓起来啦。' },
    alert:   { index: 8, name: '急报冲刺', duration: 3800, motion: 'run', phrase: '有动静！快来看这条消息。' },
    news:    { index: 9, name: '抱报播讯', duration: 4400, motion: 'news', phrase: '今日小报送到，慢慢看。' },
    drag:    { index: 10, name: '被拎起来', duration: 0, motion: 'dangle', phrase: '诶——要把我搬去哪里？' },
    peek:    { index: 11, name: '角落探头', duration: 3200, motion: 'peek', phrase: '偷偷看看你在忙什么。' }
  });
  const PHRASES=Object.freeze(Object.fromEntries(Object.entries({
    idle:'嗯？我在呢。|今天的角落，也有我。|小尾巴值班中。|你忙你的，我陪着。|发了一小会儿呆，被你发现啦。|这里风平浪静，适合陪你。|需要搭子的时候，戳一下我。|先伸个懒腰，再看下一页。|我在认真陪你发呆。|留了一点安静给你。|今天也做一只有耐心的鲸。|一人一鲸，慢慢来。',
    sleep:'尾巴借我抱一会儿……|充电五分钟，陪你一整天。|眼皮有自己的休息计划。|小鲸暂时潜入梦里。|梦里应该不用盯盘吧。|嘘，正在收集一点精神。|这个角落，刚好够打个盹。|呼……尾巴也睡着了。|让我把这一个梦做完。|困意到账，先收下啦。|醒来还在这里陪你。|暂时闭眼，陪伴没有下线。',
    pat:'再摸一下，也可以。|咕叽！收到摸摸啦。|头顶的快乐又多了一点。|轻一点，呆毛会害羞。|这一下，算今天的小奖励。|被摸到心情亮起来了。|嗯嗯，你的鲸在这里。|谢谢投喂摸摸。|尾巴已经偷偷翘起来啦。|刚好想跟你贴贴。|手心暖暖的，好喜欢。|摸完记得歇歇手哦。',
    buy:'收到！我陪你一起看着。|小本本打开，先记下计划。|坐稳啦，按自己的节奏来。|我负责陪伴，你负责想清楚。|决定前，给自己一点时间。|看清楚信息，再做决定。|小鲸站好岗，耐心不缺席。|计划写明白，心里会踏实些。|这一步，我陪你认真看。|深呼吸一下，再往下走。|眼睛睁大，心情放稳。|准备好了，也别忘了留余地。',
    profit:'落袋啦！给你撒一点开心。|今天的小庆祝，安排上。|彩带接住，快乐收好。|为你的这一站拍拍手。|开心的时候，也慢慢呼吸。|这一刻值得笑一笑。|小鲸送你一场迷你彩带雨。|尾巴都替你高兴起来了。|好消息收到，跳一下庆祝。|给这份开心盖个鲸鱼章。|奖励自己休息片刻吧。|祝贺你，今天也辛苦啦。',
    close:'这一站收工，辛苦啦。|合上小本本，歇一会儿。|一段告一段落，我还在。|先把肩膀放松下来。|收工仪式：给自己点个头。|下一步可以晚一点再想。|这一页翻过去，喝口水吧。|走完这一程，值得休息。|整理好心情，再出发也不迟。|我陪你把这一站送完。|先坐稳，给脑袋放个小假。|尾巴挥挥，跟这一程说再见。',
    comfort:'先缓一下，我在这里陪你。|纸巾递给你，慢慢来。|现在不用急着做下一个决定。|把肩膀放下来，歇一小会儿。|难过的时候，也可以什么都不说。|先照顾好自己，好吗。|这一刻不好受，我陪你坐坐。|喝点水，再看看窗外。|不想说话的话，我就安静陪着。|今天已经很努力了，先休息。|一张纸巾，一点陪伴。|心情缓过来之前，不用催自己。',
    pout:'戳这么多下，脸都要鼓起来啦。|咕！呆毛都要打结了。|摸摸可以，连击要收小饼干。|脸颊正在缓冲，请稍候。|小鲸气球，正在充气。|再戳就把尾巴借给你挠痒痒。|我数着呢，已经好多下啦。|哼，给我一点喘气时间。|抗议一下，但还是想陪你。|这两边脸颊，可不是按钮哦。|手指先休息，我也缓缓。|好啦好啦，知道你喜欢我啦。',
    alert:'有动静！快来看这条消息。|小短腿出发，消息送到。|咕咕！这里有个新提醒。|先停一下，我带了消息。|报告报告，信封到啦。|这条消息，我跑着送来的。|尾巴急刹车，提醒已抵达。|抬头看我，有件事告诉你。|小鲸快递，签收一下。|哒哒哒，新消息在这里。|有更新啦，记得瞧一眼。|跑完这一小段，消息交给你。',
    news:'今日小报送到，慢慢看。|我把小报摊开啦。|一起看看这一页写了什么。|眼睛跟着字走，别着急。|翻一页，看看新鲜事。|小鲸读报时间开始。|先看来源，再看热闹。|有空的话，陪我读一小段。|消息很多，我们慢慢捋。|小报角角已经压好啦。|给忙碌的你留一页阅读时间。|看完这一条，再休息一下眼睛。',
    drag:'诶——要把我搬去哪里？|轻拿轻放，这里有一只鲸。|小短腿暂时离线！|飞起来了，尾巴还没跟上。|抓稳呀，我有一点点怕高。|搬家途中，抱紧我的呆毛。|这边那边，我听你的安排。|咕叽！给我一个软着陆。|脚脚够不到地板啦。|新角落会不会更舒服呀。|慢一点，小鲸正在适应惯性。|请把我放在你看得见的地方。',
    peek:'偷偷看看你在忙什么。|墙边探出一只小鲸。|忙完了吗？我就看一眼。|这个角度，也能陪到你。|咕……被发现啦。|先露个脑袋打招呼。|探头确认，你还在就好。|我藏得这么认真，还是被看见了。|借个角落，偷偷陪你一下。|不打扰，我路过探个头。|墙后的小尾巴快藏不住啦。|嘿，在这里，往这边看。',
    researchAccepted:'已发送任务，有结果就来叫你。|已发送任务，你可以继续逛啦。|已发送任务，研究搭子接到啦。|已发送任务，小鲸记下这件事了。|已发送任务，报告好后提醒你。|已发送任务，先让资料跑一会儿。|已发送任务，这条帖子有人接手啦。|已发送任务，完成消息会送到这里。|已发送任务，我陪你等结果。|已发送任务，任务小本本添了一条。|已发送任务，稍后一起看报告。|已发送任务，不用一直守着页面。',
    researchComplete:'任务已完成，点击查看报告。|任务已完成，小鲸把消息送来啦。|任务已完成，这份报告可以看了。|任务已完成，研究搭子交卷啦。|任务已完成，有空来读一读。|任务已完成，这一条已经整理好了。|任务已完成，点击回 Bot 看结论。|任务已完成，报告在等你签收。|任务已完成，小本本上打个勾。|任务已完成，重点已经备好啦。|任务已完成，来看看研究结果吧。|任务已完成，点击打开这一份报告。'
  }).map(([key,text])=>[key,Object.freeze(text.split('|'))])));
  function createSpeaker(random=Math.random){
    const states=new Map();
    return key=>{const phrases=PHRASES[key]||PHRASES.idle;let state=states.get(key);if(!state){state={bag:[],last:''};states.set(key,state);}
      if(!state.bag.length){state.bag=[...phrases];for(let i=state.bag.length-1;i>0;i--){const j=Math.floor(Math.max(0,Math.min(.999999,Number(random())||0))*(i+1));[state.bag[i],state.bag[j]]=[state.bag[j],state.bag[i]];}if(state.bag.at(-1)===state.last)[state.bag[0],state.bag[state.bag.length-1]]=[state.bag.at(-1),state.bag[0]];}
      return state.last=state.bag.pop();};
  }
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  function normalizeSite(value) {
    let text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    try { text = new URL(text.includes('://') ? text : `https://${text}`).hostname; } catch { return ''; }
    return /^[a-z0-9.-]+$/.test(text) && !text.includes('..') ? text.replace(/\.$/, '') : '';
  }
  function sanitizeSettings(raw = {}) {
    if (!raw || typeof raw !== 'object') raw = {};
    const result = { ...DEFAULTS, position: { ...DEFAULTS.position }, excludedSites: [] };
    for (const key of ['enabled', 'sound', 'interactionSound', 'reducedMotion', 'collapsed']) {
      if (typeof raw[key] === 'boolean') result[key] = raw[key];
    }
    result.size = clamp(Number(raw.size ?? DEFAULTS.size), 100, 280);
    result.energy = ['quiet', 'gentle', 'lively'].includes(raw.energy) ? raw.energy : 'gentle';
    result.clickMode = ['auto', 'gmgn', 'binance', 'companion'].includes(raw.clickMode) ? raw.clickMode : DEFAULTS.clickMode;
    result.binanceView = ['assets', 'assets-pnl', 'daily-pnl', 'spot-daily', 'futures'].includes(raw.binanceView) ? raw.binanceView : DEFAULTS.binanceView;
    const researchClicks=['number','string'].includes(typeof raw.xResearchClicks)?Number(raw.xResearchClicks):NaN;
    result.xResearchClicks=Number.isInteger(researchClicks)&&researchClicks>=1&&researchClicks<=5?researchClicks:DEFAULTS.xResearchClicks;
    for (const key of ['clickGmgn', 'clickBinance', 'clickX', 'clickOther']) {
      const choices = key === 'clickX' ? ['gmgn', 'binance', 'companion', 'grok'] : ['gmgn', 'binance', 'companion'];
      result[key] = choices.includes(raw[key]) ? raw[key] : DEFAULTS[key];
    }
    result.position = {
      x: clamp(Number(raw.position?.x ?? 1), 0, 1),
      y: clamp(Number(raw.position?.y ?? 1), 0, 1)
    };
    result.excludedSites = [...new Set((Array.isArray(raw.excludedSites) ? raw.excludedSites : [])
      .map(normalizeSite).filter(Boolean))].slice(0, 100);
    return result;
  }
  function upgradeSettings(raw) {
    const settings = sanitizeSettings(raw);
    // Releases through 0.5.24 stored a global GMGN default with no choice provenance.
    // Repair it once; a fixed mode explicitly selected in this release keeps its marker.
    if (raw?.clickRoutingVersion !== 1 && raw?.clickMode === 'gmgn') settings.clickMode = 'auto';
    return settings;
  }
  function patchSettings(current, patch = {}) {
    return sanitizeSettings({ ...upgradeSettings(current), ...patch });
  }
  function isExcluded(hostname, sites) {
    const host = String(hostname).toLowerCase();
    return sites.some(site => host === site || host.endsWith(`.${site}`));
  }
  function allowedPage(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) &&
        parsed.hostname !== 'chromewebstore.google.com' &&
        !(parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'));
    } catch { return false; }
  }
  function clickAction(settings, href) {
    if (settings.clickMode !== 'auto') return settings.clickMode;
    let host = ''; try { host = new URL(href).hostname.toLowerCase(); } catch {}
    const belongs = domain => host === domain || host.endsWith('.' + domain);
    return belongs('gmgn.ai') ? settings.clickGmgn : belongs('binance.com') ? settings.clickBinance
      : belongs('x.com') || belongs('twitter.com') ? settings.clickX : settings.clickOther;
  }
  function placement(position, width, height, size, ratio = 1) {
    const margin = 12;
    const petSize = Math.min(size, Math.max(48, width - margin * 2), Math.max(48, (height - 48) / ratio));
    const maxX = Math.max(margin, width - petSize - margin);
    const maxY = Math.max(margin, height - petSize * ratio - 34);
    return { x: margin + clamp(position.x, 0, 1) * (maxX - margin),
      y: margin + clamp(position.y, 0, 1) * (maxY - margin), size: petSize, maxX, maxY, margin };
  }
  function normalizedPosition(x, y, bounds) {
    return {
      x: bounds.maxX > bounds.margin ? clamp((x - bounds.margin) / (bounds.maxX - bounds.margin), 0, 1) : 0,
      y: bounds.maxY > bounds.margin ? clamp((y - bounds.margin) / (bounds.maxY - bounds.margin), 0, 1) : 0
    };
  }
  function base58Length(address) {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let number = 0n;
    for (const character of address) {
      const index = alphabet.indexOf(character);
      if (index === -1) return -1;
      number = number * 58n + BigInt(index);
    }
    let bytes = 0;
    while (number > 0n) { number >>= 8n; bytes++; }
    const leading = address.match(/^1*/)[0].length;
    return bytes + leading;
  }
  function validateAddress(chain, address) {
    const value = String(address || '').trim();
    if (chain === 'bsc') return /^0x[0-9a-fA-F]{40}$/.test(value);
    if (chain === 'solana') return value.length >= 32 && value.length <= 44 && base58Length(value) === 32;
    return false;
  }
  function sanitizeWallets(raw) {
    if (!Array.isArray(raw)) return [];
    const unique = new Set();
    return raw.filter(wallet => wallet && validateAddress(wallet.chain, wallet.address)).map(wallet => ({
      id: String(wallet.id || '').slice(0, 64), chain: wallet.chain,
      address: wallet.address.trim(), label: String(wallet.label || '未命名地址').trim().slice(0, 24),
      kind: wallet.kind === 'self' ? 'self' : 'watch'
    })).filter(wallet => {
      const key = `${wallet.chain}:${wallet.chain === 'bsc' ? wallet.address.toLowerCase() : wallet.address}`;
      if (unique.has(key)) return false;
      unique.add(key); return true;
    }).slice(0, 30);
  }
  function demoEvent(action, chain = 'bsc') {
    if (!ACTIONS[action]) throw new Error('未知动作');
    return { id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: 'demo', chain: chain === 'solana' ? 'solana' : 'bsc', action, createdAt: Date.now() };
  }
  const api = { DEFAULTS, ACTIONS, PHRASES, createSpeaker, clamp, normalizeSite, sanitizeSettings, patchSettings,
    upgradeSettings, isExcluded, allowedPage, clickAction, placement, normalizedPosition, validateAddress, sanitizeWallets, demoEvent };
  root.TrenchCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
