import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// DOM fixtures intentionally include accessibility roles omitted by the original
// Grok fixture. No real X account, native host or Bot receives any request.
const output = path.resolve('test-results/x-research'); await fs.mkdir(output,{recursive:true});
const script = await fs.readFile('extension/x-research.js','utf8');
const browser = await chromium.launch({channel:'msedge',headless:true});
const context = await browser.newContext({viewport:{width:1280,height:900}}), page=await context.newPage();
let body = '', passes = []; const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><style>article{margin:20px;padding:20px;border:1px solid #abc} [data-testid=tweetText]{padding:8px} [role=link]{cursor:pointer}</style><button id="outside">外部按钮</button>${body}`}));
const header = name => `<div data-testid="User-Name"><a role="link" href="/${name}">${name}</a><a role="link" href="/${name}">@${name}</a></div>`;
const time = (name,id,tag='time') => `<a role="link" href="/${name}/status/${id}"><${tag}>10月29日</${tag}></a>`;
const text = (value,id='') => `<div data-testid="tweetText"${id?` id="${id}"`:''}>${value}</div>`;
const article = (id,value,options={}) => `<article data-testid="tweet" role="${options.role||'article'}" id="post-${id}" ${options.style?`style="${options.style}"`:''}>${options.inner||header(options.user||'Project')+time(options.user||'Project',id)+text(value)}</article>`;
const quote = (id='999',value='引用项目的正文') => `<div role="link" tabindex="0" id="quote-${id}">${header('Quoted')}${time('Quoted',id)}${text(value)}</div>`;
async function setup(markup,url='https://x.com/Project/status/123') { body=markup;await page.goto(url);await page.addScriptTag({content:script}); }
async function read(id='123') { return page.evaluate(id=>TrenchX.read(document.getElementById('post-'+id)),id); }
const current=()=>page.evaluate(()=>TrenchX.current());
function pass(label){passes.push(label);console.log('PASS '+label);}
async function select(){await page.evaluate(()=>{window.selection={pending:true};TrenchX.select().then(post=>{window.selection={post};},error=>{window.selection={error:error.message};});});}
async function result(){return page.evaluate(()=>window.selection);}

try {
  await setup(article('123','实际有正文'));
  assert.deepEqual(await current(),{url:'https://x.com/project/status/123',text:'实际有正文',author:'Project@Project'});
  pass('Realistic <a role="link"><time> is a valid outer permalink, not a quote');

  await setup(`<div role="link" tabindex="0">${article('123','祖先链接中的完整正文',{role:'link'})}</div>`);
  assert.equal((await current()).text,'祖先链接中的完整正文');
  pass('Role=link on the article or its enclosing timeline container does not hide text');

  await setup(article('123','',{inner:`<div role="link">${header('Project')}${time('Project','123')}${text('整帖内部链接包装')}${quote()}</div>`}));
  assert.equal((await current()).text,'整帖内部链接包装');
  pass('Whole-post inner link wrapper remains readable while its nested quote is excluded');

  await setup(article('123','',{inner:header('Project')+time('Project','123')+text('主帖<br>第二行')+quote()+`<div data-testid="quoteTweet">${text('显式引用')}</div>`}));
  const quoted=await current();assert.equal(quoted.text,'主帖\n第二行');assert.equal(quoted.url,'https://x.com/project/status/123');
  pass('Quoted card text, author and permalink never replace the selected outer post');

  const mediaQuote = `<div role="link" tabindex="0">${header('Quoted')}${time('Quoted','999')}<div data-testid="tweetPhoto"><img alt="图片引用，没有文字"></div></div>`;
  for (const dateTag of ['time','span']) {
    await setup(article('123','',{inner:header('Project')+text('主帖引用了一张图片')+mediaQuote+time('Project','123',dateTag)}));
    assert.deepEqual(await current(),{url:'https://x.com/project/status/123',text:'主帖引用了一张图片',author:'Project@Project'});
  }
  pass('An image-only quote before the main detail date never supplies the main permalink');

  await setup(article('123','',{inner:'<div data-testid="unknown-header-layout">作者信息</div>'+text('缺少外层作者标记的主帖')+mediaQuote+time('Project','123')}));
  assert.deepEqual(await current(),{url:'https://x.com/project/status/123',text:'缺少外层作者标记的主帖',author:''});
  pass('Image-only quote identity is excluded when the main username marker is absent');

  await setup(article('123','',{inner:`<div role="link">${header('Project')}${text('整帖链接包装含图片引用')}${mediaQuote}${time('Project','123')}</div>`}));
  assert.equal((await current()).text,'整帖链接包装含图片引用');
  pass('Whole-post link wrapper still reads its main text and date after a media quote');

  for (const dateTag of ['time','span']) {
    await setup(article('123','',{inner:'<div data-testid="unknown-header-layout">项目作者</div>'+time('Project','123',dateTag)+text('主帖仍可识别')+quote()}));
    const withoutHeader=await current();assert.equal(withoutHeader.text,'主帖仍可识别');assert.equal(withoutHeader.author,'');assert.equal(withoutHeader.url,'https://x.com/project/status/123');
  }
  pass('A missing outer username marker does not promote the quoted username or text');

  await setup(article('123','',{inner:header('Project')+time('Project','123')+text('外层正文')+article('999','嵌套引用正文',{user:'Quoted'})}));
  assert.equal((await current()).text,'外层正文');assert.equal(await read('999'),null);
  pass('Nested article quote cannot be read as an independent timeline target');

  await setup(article('123','',{inner:header('Project')+time('Project','123','span')+text('没有 time 标签的正文 <a role="link" href="/other/status/456">提到另一帖</a>')+quote()}));
  assert.equal((await current()).url,'https://x.com/project/status/123');assert.ok((await current()).text.includes('没有 time 标签'));
  pass('Plain-text date permalink fallback excludes status links inside tweet text and quotes');

  await setup(article('123','',{inner:header('Project')+time('Project','123','span')+time('Other','456','span')+text('不能猜是哪条帖')}));
  assert.equal(await current(),null);
  pass('Ambiguous outer permalinks fail closed');

  await setup(article('123','正文',{user:'RenamedUser'}),'https://twitter.com/OLDNAME/status/123?s=20');
  assert.equal((await current()).url,'https://x.com/renameduser/status/123');
  pass('Detail matching uses stable status ID across handle case, rename and Twitter alias');

  await setup(article('123','i web 状态详情'),'https://x.com/i/web/status/123');
  assert.equal((await current()).text,'i web 状态详情');
  const urls=await page.evaluate(()=>['https://x.com/i/web/status/123','https://x.com/i/status/123','https://twitter.com/Project/status/123/photo/1?x=1','https://x.com/Project/status/123/video/1'].map(TrenchX.canonical));
  assert.deepEqual(urls,['https://x.com/i/status/123','https://x.com/i/status/123','https://x.com/project/status/123','https://x.com/project/status/123']);
  pass('Legacy i/web/status, i/status, photo and video routes normalize consistently');

  await setup(article('456','先出现的回复')+article('123','目标帖子'),'https://x.com/i/status/123');
  assert.equal((await current()).text,'目标帖子');
  await setup(article('456','回复包含引用',{inner:header('Reply')+time('Reply','456')+text('回复')+quote('123','只能在引用中看到目标正文')}));
  assert.equal(await current(),null);
  pass('Other replies or a quoted copy of the requested status are not sent as the current post');

  await setup(article('123','',{inner:header('Project')+time('Project','123')+'<img alt="只有图片">'+quote()}));
  assert.equal(await current(),null);
  await setup(article('123','',{inner:header('Project')+time('Project','123')+text('隐藏克隆')}).replace('data-testid="tweetText"','data-testid="tweetText" hidden'));
  assert.equal(await current(),null);
  pass('Image-only posts and hidden clones cannot borrow quoted or invisible text');

  await setup(article('123','',{inner:header('Project')+time('Project','123')}));
  const delayed=await page.evaluate(async()=>{setTimeout(()=>document.getElementById('post-123').insertAdjacentHTML('beforeend','<div data-testid="tweetText">延迟加载正文</div>'),200);const start=performance.now();const post=await TrenchX.waitCurrent();return {post,elapsed:performance.now()-start};});
  assert.equal(delayed.post.text,'延迟加载正文');assert.ok(delayed.elapsed>=150&&delayed.elapsed<1500);
  pass('Bounded waiting picks up lazily inserted detail text');

  await setup(article('123','',{inner:header('Project')+time('Project','123')}));
  const changed=await page.evaluate(async()=>{setTimeout(()=>{history.pushState(null,'','/New/status/456');document.getElementById('post-123').insertAdjacentHTML('beforeend','<div data-testid="tweetText">过时正文</div>');},100);return TrenchX.waitCurrent();});
  assert.equal(changed,null);
  await setup(article('123','',{inner:header('Project')+time('Project','123')}));
  const aborted=await page.evaluate(async()=>{const controller=new AbortController();setTimeout(()=>controller.abort(),80);return TrenchX.waitCurrent({signal:controller.signal});});assert.equal(aborted,null);
  const timeout=await page.evaluate(async()=>{const start=performance.now();const post=await TrenchX.waitCurrent({timeout:5000});return {post,elapsed:performance.now()-start};});assert.equal(timeout.post,null);assert.ok(timeout.elapsed>=1400&&timeout.elapsed<2400);
  pass('Waiting cancels on navigation/abort and never exceeds the 1.5-second configured bound');
  await setup(article('123','已存在正文'));
  assert.equal(await page.evaluate(()=>{const controller=new AbortController();controller.abort();return TrenchX.waitCurrent({signal:controller.signal});}),null);
  pass('An already-aborted detail request cannot return existing text');

  await setup(`<div role="link">${article('123','信息流主帖',{style:'outline: 2px dashed red !important'})}${article('456','应选择第二条')}</div>`,'https://x.com/home');
  await page.evaluate(()=>{window.documentClicks=0;document.addEventListener('click',()=>window.documentClicks++);});
  await select();await page.locator('#post-456 [data-testid="tweetText"]').click();
  assert.equal((await result()).post.text,'应选择第二条');assert.equal(await page.evaluate(()=>window.documentClicks),0);
  pass('Timeline selection captures exactly the clicked article and suppresses navigation');

  await select();await page.locator('#post-123').hover();await page.keyboard.press('Escape');
  assert.deepEqual(await result(),{post:null});
  assert.equal(await page.locator('#post-123').evaluate(el=>el.style.getPropertyPriority('outline')),'important');
  assert.match(await page.locator('#post-123').evaluate(el=>el.style.outline),/dashed/);
  pass('Escape is a true cancellation and restores the page outline including !important');

  await select();await page.locator('#post-123').hover();
  const started = Date.now();
  await page.waitForTimeout(4400);assert.deepEqual(await result(),{pending:true});
  await page.waitForFunction(()=>window.selection.post===null,{},{timeout:1800});
  assert(Date.now()-started>=4700,'Selection must remain available for five seconds');
  assert.equal(await page.locator('#post-123').evaluate(n=>n.style.getPropertyValue('outline')),'red dashed 2px');
  const clicksBefore=await page.evaluate(()=>window.documentClicks);
  await page.locator('#post-456 [data-testid="tweetText"]').click();
  assert.equal(await page.evaluate(()=>window.documentClicks),clicksBefore+1);assert.deepEqual(await result(),{post:null});
  pass('Selection expires after five seconds, restores the highlight, and stops intercepting ordinary post clicks');

  await select();
  const lateClick=await page.evaluate(()=>{
    const original=performance.now.bind(performance),before=window.documentClicks;
    performance.now=()=>original()+6000;
    try{document.querySelector('#post-123 [data-testid="tweetText"]').click();return window.documentClicks-before;}
    finally{delete performance.now;}
  });
  assert.equal(lateClick,1);assert.deepEqual(await result(),{post:null});
  pass('A delayed timeout callback cannot capture a click beyond the selection deadline');

  await page.evaluate(()=>{window.selectController=new AbortController();window.selection={pending:true};TrenchX.select({signal:selectController.signal}).then(post=>window.selection={post});});
  await page.locator('#post-123').hover();await page.evaluate(()=>selectController.abort());
  assert.deepEqual(await result(),{post:null});
  assert.equal(await page.evaluate(()=>TrenchX.select({signal:AbortSignal.abort()})),null);
  pass('Aborting research immediately releases selection, including an already-aborted request');

  await setup(article('123','',{inner:header('Project')+time('Project','123')+text('引用所属主帖')+quote()}),'https://x.com/home');
  await select();await page.locator('#quote-999 [data-testid="tweetText"]').click();assert.equal((await result()).post.text,'引用所属主帖');
  pass('Clicking a quote card while choosing the outer post still sends only its outer text');

  await setup(article('123','',{inner:header('Project')+time('Project','123')+'<span id="image-label">只有图片</span>'}),'https://x.com/home');
  await select();await page.locator('#image-label').click();const missing=await result();assert.match(missing.error,/正文或链接/);assert.ok(!('post'in missing));
  await select();await page.locator('#outside').click();assert.deepEqual(await result(),{pending:true});await page.evaluate(()=>TrenchX.cancel());assert.deepEqual(await result(),{post:null});
  pass('Unreadable selected post rejects with an error; outside clicks and cancellation do not send a task');

  const unsafe=await page.evaluate(()=>['https://x.com.evil.test/a/status/1','http://x.com/a/status/1','https://name:secret@x.com/a/status/1','https://x.com:444/a/status/1','javascript:alert(1)',''].map(TrenchX.canonical));assert.deepEqual(unsafe,Array(6).fill(''));
  pass('Lookalike hosts, credentialed URLs, non-HTTPS routes and malformed values are rejected');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passes,errors,fixtureOnly:true,liveXTested:false,botRequests:0},null,2));
  console.log(`Completed ${passes.length} isolated X extraction scenarios.`);
} finally {await context.close();await browser.close();}
