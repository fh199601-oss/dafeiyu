/* Joint-space animation and a damped drag pendulum. No DOM or storage work here. */
(function(root) {
  'use strict';
  const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
  const ease = n => { n=clamp(n,0,1); return n*n*(3-2*n); };
  class Motion {
    constructor(){this.action='idle';this.t=0;this.clock=0;this.velocity=0;this.swing=0;this.omega=0;this.look={x:0,y:0};}
    play(action){this.action=action;this.t=0;}
    drag(vx){this.velocity=clamp(vx,-3200,3200);}
    gaze(x,y){this.look={x:clamp(x,-1,1),y:clamp(y,-1,1)};}
    step(dt, reduced=false){
      dt=clamp(dt,0,.08);
      if(!reduced){
        this.t+=dt;this.clock+=dt;
        for(let remaining=dt;remaining>0;){
          const h=Math.min(remaining,1/120);remaining-=h;
          const target=this.action==='drag'?clamp(this.velocity*.0005,-1.05,1.05):0;
          this.omega+=(100*(target-this.swing)-11*this.omega)*h;
          this.swing+=this.omega*h;this.velocity*=Math.exp(-h*5);
        }
      }
      const t=reduced?.9:this.t, c=reduced?0:this.clock, a=this.action;
      const f={action:a,time:t,bodyX:0,bodyY:0,bodyR:0,sx:1,sy:1,headX:0,headY:0,headR:0,
        armL:-.12,armR:.12,legL:0,legR:0,tail:Math.sin(c*1.8)*.09,ahoge:Math.sin(c*2.7)*.08,
        hair:Math.sin(c*1.4)*.018,gazeX:this.look.x*5,gazeY:this.look.y*3,eyes:'open',mouth:'smile',
        blink:!reduced&&((c%4.3)>.0&&(c%4.3)<.13),paper:0,tissue:0,zz:0,confetti:false,wall:false};
      if(a==='idle'){f.headR=Math.sin(c*.9)*.018;f.armL+=Math.sin(c*1.5)*.035;f.armR-=Math.sin(c*1.5)*.035;}
      if(a==='drag'){
        f.legL=this.swing+Math.sin(c*15)*.13;f.legR=this.swing+Math.sin(c*17+1)*.13;
        f.armL=.95+Math.sin(t*29)*.85;f.armR=-.95+Math.sin(t*31+1)*.85;
        f.bodyR=this.swing*.12;f.headR=-f.bodyR*.65;f.bodyY=-12;
        f.tail=-this.swing*.3+Math.sin(t*11)*.12;f.ahoge=-this.swing*.45;
        f.eyes='fear';f.mouth='o';
      }
      if(a==='pat'){
        const bounce=t<.16?-Math.sin(t/.16*Math.PI)*.13:Math.sin((t-.16)*15)*Math.exp(-(t-.16)*3.7)*.16;
        f.sy=1+bounce;f.sx=1-bounce*.65;f.bodyY=-Math.max(0,bounce)*180;
        f.armL=.9*Math.exp(-t*1.4)+Math.sin(t*10)*.15*Math.exp(-t);f.armR=-f.armL;
        f.headR=Math.sin(t*7)*.06*Math.exp(-t);f.eyes=t<1.4?'happy':'open';f.mouth='happy';
        f.legL=-.12*Math.exp(-t);f.legR=.12*Math.exp(-t);
      }
      if(a==='sleep'){
        f.headR=.13+Math.sin(c*1.1)*.025;f.headY=8;f.eyes='closed';f.mouth='sleep';
        f.armL=-.9;f.armR=.9;f.legL=-.18;f.legR=.2;f.tail=-.32;f.zz=3;f.bodyY=10;
      }
      if(a==='buy'){
        f.armL=2.25+Math.sin(t*8)*.22;f.armR=-2.25-Math.sin(t*8)*.22;
        f.headY=Math.sin(t*8)*2;f.mouth='happy';
      }
      if(a==='profit'){
        const p=t%1.05, jump=Math.max(0,Math.sin(clamp((p-.16)/.7,0,1)*Math.PI));
        // A short dip prepares the jump without stretching the painted face or
        // rigid hands. Only the click/pat interaction keeps its soft rebound.
        f.bodyY=-jump*68+(p<.16?Math.sin(p/.16*Math.PI)*5:0);
        const raised=ease((p-.06)/.2)*(1-ease((p-.8)/.23));
        f.armL=raised*2.6;f.armR=-raised*2.6;f.legL=-jump*.25;f.legR=jump*.25;
        f.eyes='happy';f.mouth='happy';f.confetti=true;f.tail=Math.sin(t*10)*.18;
      }
      if(a==='close'){
        const bow=ease(t/.7)*(1-ease((t-1.8)/.7));
        f.headY=22*bow;f.headR=.1*bow;f.bodyR=.07*bow;f.sy=1-.06*bow;
        f.armL=-.5*bow;f.armR=.5*bow;f.eyes=bow>.5?'closed':'open';
      }
      if(a==='comfort'){
        const reach=ease(t/.75)*(1-ease((t-3.8)/.9));
        f.armR=-1.35*reach;f.armL=-.4;f.tissue=reach;f.headR=-.07;f.mouth='soft';f.gazeX=4;
      }
      if(a==='pout'){
        f.armL=-1.1;f.armR=1.1;f.headR=-.07;f.mouth='pout';f.eyes='pout';
        f.legR=Math.max(0,Math.sin(t*13))*.3*Math.exp(-t*.6);
      }
      if(a==='alert'){
        const phase=t*17;
        f.legL=Math.sin(phase)*.9;f.legR=-f.legL;
        f.armL=-Math.sin(phase)*1.15;f.armR=-f.armL;
        f.bodyY=-Math.abs(Math.cos(phase))*12;f.bodyR=.09;f.headR=-.06;
        f.tail=-.2+Math.sin(phase)*.17;f.ahoge=-.15+Math.sin(phase+.4)*.15;f.mouth='o';
      }
      if(a==='news'){
        f.armL=-.65;f.armR=.65;f.paper=1;f.gazeX=((t%1.8)/1.8*2-1)*10;
        f.gazeY=4+Math.floor(t/1.8)%2*3;f.blink=t%1.8>1.7;f.mouth='soft';f.headY=2;
      }
      if(a==='peek'){
        const reveal=ease(t/.8)*(1-ease((t-2.25)/.8));
        f.wall=true;f.bodyX=330-reveal*133;f.headX=-reveal*75;f.headR=-.14*reveal;
        f.armL=.6;f.gazeX=-7;f.gazeY=-1;f.wallX=370;
      }
      if(reduced){f.confetti=false;f.zz=a==='sleep'?1:0;f.blink=false;}
      return f;
    }
  }
  root.WhaleMotion={Motion,ease};
  if(typeof module!=='undefined')module.exports=root.WhaleMotion;
})(globalThis);
