const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Motion}=require('../extension/motion.js');
function drive(m,v,seconds=.35){let f;for(let i=0;i<seconds*120;i++){m.drag(v);f=m.step(1/120);}return f;}
test('drag pendulum trails horizontal velocity, reverses smoothly and settles when held still',()=>{
 const m=new Motion();m.play('drag');
 const right=drive(m,1400);assert.ok((right.legL+right.legR)/2>.45);
 // A downward limb rotated positively points left, opposite a rightward drag.
 assert.ok(-Math.sin((right.legL+right.legR)/2)<0);assert.equal(right.eyes,'fear');
 const before=m.swing;m.drag(-1400);m.step(1/120);assert.ok(Math.abs(m.swing-before)<.08,'no direction snap');
 const left=drive(m,-1400,.6);assert.ok((left.legL+left.legR)/2<-.45);
 for(let i=0;i<480;i++)m.step(1/120);assert.ok(Math.abs(m.swing)<.005);
});
test('spring remains stable across 30/60/120 Hz and delayed browser frames',()=>{
 const values=[];
 for(const dt of [1/30,1/60,1/120]){const m=new Motion();m.play('drag');for(let i=0;i<1/dt;i++){m.drag(900);m.step(dt);}values.push(m.swing);m.step(15);assert.ok(Number.isFinite(m.swing)&&Math.abs(m.swing)<1.5);}
 assert.ok(Math.max(...values)-Math.min(...values)<.04);
});
test('running alternates feet with opposing arms; reading moves gaze without moving the head',()=>{
 const m=new Motion();m.play('alert');const a=m.step(.06);assert.ok(a.legL*a.legR<0);assert.ok(a.armL*a.legL<0);
 m.play('news');const first=m.step(.06);let last;for(let i=0;i<15;i++)last=m.step(.06);
 assert.ok(last.gazeX-first.gazeX>8);assert.equal(last.headX,first.headX);assert.equal(last.headY,first.headY);
});
test('peek reveals head relative to torso while wall stays fixed; tissue extends with the hand',()=>{
 const m=new Motion();m.play('peek');const first=m.step(0);let last;for(let i=0;i<16;i++)last=m.step(.06);
 assert.equal(first.wallX,last.wallX);assert.ok(last.headX<first.headX-60);assert.ok(last.bodyX<first.bodyX);
 m.play('comfort');const start=m.step(0);for(let i=0;i<16;i++)last=m.step(.06);
 assert.equal(start.tissue,0);assert.equal(last.tissue,1);assert.ok(last.armR<start.armR-1);
});
test('reduced motion stops physics and has no confetti; sleep supplies independent Z effects',()=>{
 const m=new Motion();m.play('profit');const a=m.step(.06,true);for(let i=0;i<20;i++)assert.deepEqual(m.step(.06,true),a);
 assert.equal(a.confetti,false);m.play('sleep');assert.equal(m.step(.06).zz,3);
});
test('celebration prepares and repeats its jump without changing face or hand proportions',()=>{
 const m=new Motion();m.play('profit');let min=0,max=0;
 for(let i=0;i<3.4*120;i++){const f=m.step(1/120);assert.equal(f.sx,1);assert.equal(f.sy,1);min=Math.min(min,f.bodyY);max=Math.max(max,f.bodyY);}
 assert.ok(min<-67,'retains full jump height');assert.ok(max>4.9&&max<5.1,'prepares with a small downward movement');
});
