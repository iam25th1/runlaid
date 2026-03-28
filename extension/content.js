// ═══════════════════════════════════════════════════════════
// RUNLAID.exe — Chrome Extension Content Script
// Watches claude.ai, injects game directly (no iframe)
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  let gameVisible = false;
  let container = null;
  let streamStartTime = 0;
  let streamingDetected = false;
  let codeDetected = false;
  let responseLength = 0;
  let checkInterval = null;
  let hideTimeout = null;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let gameInstance = null;

  const STREAM_DELAY_MS = 5000;       // 5s of ANY streaming = trigger
  const HIDE_DELAY_MS = 5000;

  // ── Find Claude's input box ──
  function getInputBox() {
    // Try multiple selectors for the input area
    return document.querySelector('[contenteditable="true"]') ||
           document.querySelector('textarea') ||
           document.querySelector('[class*="ProseMirror"]') ||
           document.querySelector('[data-placeholder="Reply..."]');
  }

  function getInputBoxRect() {
    const el = getInputBox();
    if (!el) return null;
    // Walk up to find the outer container (the visible box with border)
    let box = el;
    for (let i = 0; i < 5; i++) {
      if (box.parentElement) box = box.parentElement;
    }
    return box.getBoundingClientRect();
  }

  let positionInterval = null;

  // ── Create overlay with inline canvas ──
  function createOverlay() {
    if (container) return;

    container = document.createElement('div');
    container.id = 'runlaid-container';

    const style = document.createElement('style');
    style.textContent = `
      #runlaid-container {
        position: fixed;
        z-index: 2147483647;
        border-radius: 10px 10px 0 0; overflow: hidden;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(124,80,255,0.15);
        transition: opacity 0.4s ease, transform 0.4s ease;
        opacity: 0; transform: translateY(10px);
        background: #0F0D1A; font-family: 'JetBrains Mono', Consolas, monospace;
      }
      #runlaid-container.visible { opacity: 1; transform: translateY(0); }
      #runlaid-container.minimized #runlaid-canvas-wrap { display: none; }
      #runlaid-header {
        height: 28px; background: #1E1C30; display: flex;
        align-items: center; justify-content: space-between;
        padding: 0 10px; cursor: default;
        border-bottom: 1px solid rgba(124,80,255,0.12);
        user-select: none;
      }
      #runlaid-title { font-size: 10px; color: #7C50FF; letter-spacing: 0.5px; font-weight: 600; }
      #runlaid-controls { display: flex; gap: 4px; }
      #runlaid-controls button {
        width: 20px; height: 20px; border: none; background: transparent;
        color: #666; font-size: 11px; cursor: pointer; border-radius: 4px;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s; font-family: monospace;
      }
      #runlaid-controls button:hover { background: rgba(255,255,255,0.08); color: #fff; }
      #runlaid-close:hover { background: rgba(226,75,74,0.2) !important; color: #E24B4A !important; }
      #runlaid-canvas-wrap { width: 100%; }
      #runlaid-canvas-wrap canvas { display: block; width: 100%; }
    `;
    document.head.appendChild(style);

    container.innerHTML = `
      <div id="runlaid-header">
        <span id="runlaid-title">RUNLAID.exe</span>
        <div id="runlaid-controls">
          <button id="runlaid-minimize" title="Minimize">\u2500</button>
          <button id="runlaid-close" title="Close">\u2715</button>
        </div>
      </div>
      <div id="runlaid-canvas-wrap"></div>
    `;
    document.body.appendChild(container);

    container.querySelector('#runlaid-minimize').addEventListener('click', () => {
      container.classList.toggle('minimized');
    });
    container.querySelector('#runlaid-close').addEventListener('click', () => {
      hideGame(true);
    });

    // Position tracker — keeps container anchored above input box
    positionContainer();
    positionInterval = setInterval(positionContainer, 300);
  }

  function positionContainer() {
    if (!container) return;
    const rect = getInputBoxRect();
    if (!rect) {
      // Fallback: center bottom
      container.style.left = '50%';
      container.style.bottom = '80px';
      container.style.width = '600px';
      container.style.marginLeft = '-300px';
      return;
    }
    container.style.left = rect.left + 'px';
    container.style.width = rect.width + 'px';
    container.style.top = (rect.top - container.offsetHeight - 6) + 'px';
    container.style.bottom = 'auto';
  }

  // ── Launch game directly in content script context ──
  function launchGame() {
    const wrap = container.querySelector('#runlaid-canvas-wrap');
    if (!wrap) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'runlaid-c';
    wrap.appendChild(canvas);

    // Run game engine directly (canvas API works from content script)
    gameEngineCode();
  }

  function showGame() {
    if (gameVisible) return;
    
    // Force clean any stale container
    const stale = document.getElementById('runlaid-container');
    if (stale) { stale.remove(); container = null; }
    window._runlaid = null;
    
    createOverlay();
    gameVisible = true;
    container.classList.remove('minimized');
    requestAnimationFrame(() => { container.classList.add('visible'); });

    launchGame();

    setTimeout(() => {
      if (window._runlaid) window._runlaid.start();
    }, 500);
  }

  function hideGame(immediate) {
    if (!gameVisible && !container) return;
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    if (progressFeedInterval) { clearInterval(progressFeedInterval); progressFeedInterval = null; }
    if (positionInterval) { clearInterval(positionInterval); positionInterval = null; }

    if (immediate) {
      if (container) { container.classList.remove('visible'); }
      setTimeout(() => {
        if (container) { container.remove(); container = null; }
        gameVisible = false;
        window._runlaid = null;
      }, 400);
    } else {
      // Let finish screen show, then fade
      setTimeout(() => {
        if (container) container.classList.remove('visible');
        setTimeout(() => {
          if (container) { container.remove(); container = null; }
          gameVisible = false;
          window._runlaid = null;
        }, 500);
      }, 4000); // 4s to read the summary
    }
  }

  // ── DOM Detection ──
  function isStreaming() {
    return !!document.querySelector('[data-is-streaming="true"]');
  }

  function hasCodeBlocks() {
    const el = document.querySelector('[data-is-streaming]');
    if (!el) return false;
    // Check for actual code elements OR collapsed code containers (buttons, expandable sections)
    return el.querySelectorAll('pre, code, [class*="code"], [class*="Code"], button[class*="copy"]').length > 0;
  }

  function getResponseLength() {
    const el = document.querySelector('[data-is-streaming]');
    return el ? (el.textContent || '').length : 0;
  }

  // Also check if Claude is actively "thinking" or using tools
  function isWorking() {
    return !!document.querySelector('[data-is-streaming="true"]') ||
           !!document.querySelector('[class*="thinking"]') ||
           !!document.querySelector('[class*="Thinking"]');
  }

  // ── Main loop ──
  let progressFeedInterval = null;

  function startWatching() {
    if (checkInterval) return;
    checkInterval = setInterval(() => {
      const nowStreaming = isStreaming();

      if (nowStreaming && !streamingDetected) {
        streamingDetected = true;
        streamStartTime = Date.now();
        console.log('[RUNLAID.exe] Streaming detected...');
      }

      if (streamingDetected && nowStreaming) {
        const elapsed = Date.now() - streamStartTime;

        // SIMPLE: if streaming for 5+ seconds, launch game. That's it.
        if (!gameVisible && elapsed >= STREAM_DELAY_MS) {
          console.log('[RUNLAID.exe] Launching! elapsed=' + elapsed + 'ms');
          showGame();

          if (progressFeedInterval) clearInterval(progressFeedInterval);
          let feedProg = 0;
          progressFeedInterval = setInterval(() => {
            if (!gameVisible || !streamingDetected) { clearInterval(progressFeedInterval); return; }
            feedProg = Math.min(65, feedProg + 0.3);
            if (window._runlaid) window._runlaid.setProgress(feedProg);
          }, 300);
        }
      }

      if (!nowStreaming && streamingDetected) {
        streamingDetected = false;
        console.log('[RUNLAID.exe] Streaming stopped.');
        if (progressFeedInterval) { clearInterval(progressFeedInterval); progressFeedInterval = null; }

        if (gameVisible) {
          // Push progress to 100 — triggers finish line rush
          if (window._runlaid) window._runlaid.setProgress(100);
          // Wait for finish line animation + summary screen, then hide
          hideTimeout = setTimeout(() => { hideGame(false); }, 5000);
        }
        codeDetected = false;
        responseLength = 0;
      }
    }, 500);
  }

  startWatching();
  console.log('[RUNLAID.exe] Content script loaded. Watching for Claude activity...');



  // ═══════════════════════════════════════════════════════════
  // RUNLAID.exe v2.2 — TURF WAR: Grounded Edition
  // 3v3, items on surfaces, player takeover, detailed scene
  // ═══════════════════════════════════════════════════════════

  function gameEngineCode() {
    const canvas = document.getElementById('runlaid-c');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 640, H = 180;
    canvas.width = W; canvas.height = H;

    const GY = H - 20;
    const CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',
      ai:'#D85A30',aiB:'#c94b22',
      hum:'#4A90D9',humB:'#3570B0',
      acc:'#7C50FF',cyan:'#50C8FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700'};

    // Zones with desk/surface positions built in
    const ZONES = [
      {name:'Tech Office',sky:'#0c1015',ac:'#3fb950',gnd:'#0a0e14',gl:'#182028',
        items:['CODE','PR','BUG FIX','API','DEPLOY','TEST'],icons:['code','code','doc','code','doc','folder'],
        desks:[{x:50,w:55,type:'desk'},{x:170,w:55,type:'desk'},{x:290,w:55,type:'desk'},{x:410,w:55,type:'desk'},{x:530,w:55,type:'desk'}],
        bgColor:'#0d1218',wallColor:'#10161e',floorDetail:'grid'},
      {name:'Design Studio',sky:'#14100a',ac:'#E8A000',gnd:'#121008',gl:'#221c10',
        items:['WIREFRAME','LOGO','MOCKUP','LAYOUT','ICON','PALETTE'],icons:['doc','img','img','doc','folder','img'],
        desks:[{x:40,w:60,type:'easel'},{x:160,w:55,type:'desk'},{x:290,w:50,type:'tablet'},{x:400,w:55,type:'desk'},{x:530,w:55,type:'easel'}],
        bgColor:'#161008',wallColor:'#1a1208',floorDetail:'wood'},
      {name:'Newsroom',sky:'#080808',ac:'#E24B4A',gnd:'#0c0c0c',gl:'#1a1a1a',
        items:['ARTICLE','HEADLINE','SCOOP','REPORT','PHOTO','EDIT'],icons:['doc','doc','doc','folder','img','doc'],
        desks:[{x:50,w:55,type:'desk'},{x:170,w:50,type:'desk'},{x:300,w:55,type:'desk'},{x:420,w:50,type:'desk'},{x:540,w:55,type:'desk'}],
        bgColor:'#0a0a0a',wallColor:'#111',floorDetail:'tile'},
      {name:'Film Set',sky:'#150008',ac:'#FFD700',gnd:'#120510',gl:'#221020',
        items:['SCRIPT','SCENE','CUT','VFX','TAKE','EDIT'],icons:['doc','folder','doc','code','doc','doc'],
        desks:[{x:60,w:50,type:'camera'},{x:180,w:55,type:'desk'},{x:310,w:50,type:'chair'},{x:430,w:55,type:'desk'},{x:550,w:50,type:'camera'}],
        bgColor:'#140510',wallColor:'#1a0812',floorDetail:'carpet'},
      {name:'Trading Floor',sky:'#040a04',ac:'#E8A000',gnd:'#060a06',gl:'#142014',
        items:['REPORT','FORECAST','TRADE','MODEL','AUDIT','BRIEF'],icons:['doc','chart','doc','code','folder','chart'],
        desks:[{x:45,w:60,type:'screens'},{x:170,w:55,type:'desk'},{x:300,w:60,type:'screens'},{x:430,w:55,type:'desk'},{x:550,w:60,type:'screens'}],
        bgColor:'#050c05',wallColor:'#0a140a',floorDetail:'marble'},
    ];

    const HSKINS = [
      {bc:'#3570B0',sk:'#F4C7A3',hr:'#3A2A1A'},{bc:'#4A4A4A',sk:'#D4A574',hr:'#2A2A2A'},
      {bc:'#C04878',sk:'#F0D5C0',hr:'#8B3A1A'},{bc:'#3A9080',sk:'#C8A882',hr:'#1A3A2A'},
      {bc:'#A83030',sk:'#F0D0B0',hr:'#5A2A1A'},{bc:'#8A5090',sk:'#F0C8B0',hr:'#5A2A3A'},
    ];

    const POWERUPS = [
      {name:'OVERCLOCK',color:'#50C8FF',icon:'\u26A1',dur:420},
      {name:'FREEZE',color:'#99AAFF',icon:'\u2744',dur:200},
      {name:'MAGNET',color:'#7C50FF',icon:'\u25CE',dur:300},
    ];

    // ═══ STATE ═══
    let state='INTRO',fr=0,score=0,prog=0,zone=0,side=null;
    let tugAI=50,tugHuman=50;
    let introT=0,invT=0;
    let trT=0,trTxt='',trA=0;
    let overT=0,frzT=0,magT=0;
    let playerIdx=-1; // index into the appropriate team array

    // ═══ ENTITIES ═══
    let items=[];
    let aiTeam=[]; // exactly 3
    let humTeam=[]; // exactly 3
    let particles=[];
    let powerups=[];

    // Character: always grounded (y = GY - h)
    function mkChar(x,type,skin){
      const h=22;
      return {x:x,y:GY-h,w:16,h:h,type:type,skin:skin||null,
        targetItem:null,walkDir:0,speed:type==='ai'?1.3:1.1,
        phase:Math.random()*6.28,blinkT:~~(Math.random()*200),
        isPlayer:false,surprised:false,surpriseT:0,
        idleT:0,carrying:false,carryT:0};
    }

    function initScene(){
      items=[];powerups=[];particles=[];
      humTeam=[];aiTeam=[];playerIdx=-1;
      for(let i=0;i<3;i++){
        humTeam.push(mkChar(60+i*200+Math.random()*40,'human',HSKINS[i%HSKINS.length]));
      }
    }

    function spawnAIs(){
      for(let i=0;i<3;i++){
        const c=mkChar(W+20+i*35,'ai',null);
        c._marchTarget=120+i*200+Math.random()*40;
        c._marching=true;
        aiTeam.push(c);
      }
    }

    // ═══ ITEMS: spawn on surfaces ═══
    function spawnItem(){
      const z=ZONES[zone];
      const idx=~~(Math.random()*z.items.length);
      const label=z.items[idx],icon=z.icons[idx];
      // Pick a random desk/surface to spawn on
      const desk=z.desks[~~(Math.random()*z.desks.length)];
      const ix=desk.x+5+Math.random()*(desk.w-15);
      // Items sit on the desk surface (about 18px above ground)
      const iy=GY-28-Math.random()*4;
      // Sometimes spawn on floor between desks
      const onFloor=Math.random()<.3;
      const fx=40+Math.random()*(W-80);
      const fy=GY-10-Math.random()*3;

      items.push({
        x:onFloor?fx:ix, y:onFloor?fy:iy,
        w:18, h:14, label:label, icon:icon,
        grabbed:false, grabSide:null, grabT:0,
        age:0, maxAge:400+Math.random()*300,
        bobP:Math.random()*6.28,
        onDesk:!onFloor
      });
    }

    function spawnPowerup(){
      const p=POWERUPS[~~(Math.random()*POWERUPS.length)];
      const z=ZONES[zone];
      const desk=z.desks[~~(Math.random()*z.desks.length)];
      powerups.push({x:desk.x+desk.w/2,y:GY-32,...p,sz:11,bobP:Math.random()*6.28,age:0});
    }

    // ═══ INPUT ═══
    canvas.addEventListener('mousedown',e=>{
      e.preventDefault();e.stopPropagation();
      const rect=canvas.getBoundingClientRect();
      const mx=(e.clientX-rect.left)*(W/rect.width);
      const my=(e.clientY-rect.top)*(H/rect.height);

      if(state==='CHOOSE'){
        const bw=110,bh=26,gap=14,totalW=bw*3+gap*2,bx=W/2-totalW/2,by=H/2+14;
        if(my>=by&&my<=by+bh){
          if(mx>=bx&&mx<bx+bw){side='ai';takeOver('ai')}
          else if(mx>=bx+bw+gap&&mx<bx+bw*2+gap){side='human';takeOver('human')}
          else if(mx>=bx+bw*2+gap*2&&mx<bx+bw*3+gap*2){side='observe';state='PLAYING'}
        }
        return;
      }

      if(state==='FINISHED'&&window._runlaidBtns){
        const b=window._runlaidBtns;
        if(my>=b.btnY&&my<=b.btnY+b.btnH){
          // Twitter/X share
          if(mx>=b.twBtnX&&mx<b.twBtnX+b.btnW){
            shareToTwitter();return;
          }
          // Save PNG card
          if(mx>=b.pngBtnX&&mx<b.pngBtnX+b.btnW){
            savePNGCard();return;
          }
        }
      }

      if(state==='PLAYING'&&side!=='observe'&&playerIdx>=0){
        const team=side==='ai'?aiTeam:humTeam;
        const pc=team[playerIdx];
        if(!pc)return;

        // ALWAYS set walk target to click X position
        pc._walkToX=mx;
        pc.targetItem=null; // clear item target

        // If clicking near an item, also target it for pickup
        let best=null,bd=Infinity;
        for(const it of items){
          if(it.grabbed)continue;
          const dx=mx-(it.x+it.w/2),dy=my-(it.y+it.h/2);
          const d=Math.sqrt(dx*dx+dy*dy);
          if(d<45&&d<bd){bd=d;best=it}
        }
        if(best){pc.targetItem=best}

        // Click powerup
        for(let i=powerups.length-1;i>=0;i--){
          const p=powerups[i];const py=p.y+Math.sin(p.bobP)*3;
          if(Math.abs(mx-p.x)<16&&Math.abs(my-py)<16){
            if(p.name==='OVERCLOCK')overT=p.dur;
            if(p.name==='FREEZE')frzT=p.dur;
            if(p.name==='MAGNET')magT=p.dur;
            particles.push({x:p.x,y:py,vx:0,vy:0,life:22,color:p.color,sz:18,type:'ring'});
            powerups.splice(i,1);
          }
        }
      }
    });
    canvas.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation()});

    function takeOver(s){
      state='PLAYING';
      const team=s==='ai'?aiTeam:humTeam;
      // Take control of first team member
      playerIdx=0;
      team[0].isPlayer=true;
      team[0].speed=2.2; // player is faster
    }

    // ═══ UPDATE ═══
    function update(){
      fr++;

      if(state==='INTRO'){
        introT++;
        if(introT>40&&introT%55===0)spawnItem();
        updateChars(humTeam,false);
        if(introT>=150){state='INVASION';invT=0;spawnAIs()}
        return;
      }

      if(state==='INVASION'){
        invT++;
        for(const a of aiTeam){
          if(a._marching){if(a.x>a._marchTarget){a.x-=2.5;a.phase+=.12}else{a._marching=false}}
          a.y=GY-a.h; // keep grounded
        }
        if(invT>50){for(const h of humTeam){if(!h.surprised){h.surprised=true;h.surpriseT=0}}}
        if(invT>25&&invT%45===0)spawnItem();
        updateChars(humTeam,false);
        if(invT>=110)state='CHOOSE';
        return;
      }

      if(state==='CHOOSE'){
        updateChars(humTeam,true);updateChars(aiTeam,true);
        if(fr%35===0)spawnItem();
        updateItems();return;
      }

      if(state!=='PLAYING')return;

      // Zone
      const pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){
        trTxt=ZONES[pz].name+' disrupted.';trT=75;trA=0;
        items=[];powerups=[];
        // Clear targets but DON'T reposition anyone
        for(let i=0;i<3;i++){
          humTeam[i].targetItem=null;humTeam[i].surprised=false;
          humTeam[i].skin=HSKINS[(zone*3+i)%HSKINS.length];
          aiTeam[i].targetItem=null;
        }
      }

      if(overT>0)overT--;if(frzT>0)frzT--;if(magT>0)magT--;
      if(trT>0){trT--;if(trT>50)trA=Math.min(1,trA+.06);else if(trT<15)trA=Math.max(0,trA-.06)}

      // Spawn
      const sr=overT>0?18:Math.max(25,50-prog*.15);
      if(fr%Math.floor(sr)===0&&items.filter(i=>!i.grabbed).length<10)spawnItem();
      if(fr%500===0&&Math.random()<.4)spawnPowerup();

      // Update
      updateItems();
      if(frzT<=0||side==='ai')updateChars(aiTeam,true);
      if(frzT<=0||side==='human')updateChars(humTeam,true);
      updateParticles();

      // Magnet for player
      if(magT>0&&playerIdx>=0){
        const team=side==='ai'?aiTeam:humTeam;
        const pc=team[playerIdx];
        if(pc){
          for(const it of items){
            if(it.grabbed)continue;
            const dx=pc.x-it.x,dy=pc.y-it.y;
            const d=Math.sqrt(dx*dx+dy*dy);
            if(d<70&&d>8){it.x+=dx/d*2}
          }
        }
      }

      if(prog>=100)state='FINISHED';
    }

    function updateItems(){
      for(let i=items.length-1;i>=0;i--){
        const it=items[i];it.age++;it.bobP+=.03;
        if(it.grabbed){it.grabT++;if(it.grabT>20){items.splice(i,1);continue}}
        if(it.age>it.maxAge&&!it.grabbed){items.splice(i,1)}
      }
    }

    function updateChars(team,canGrab){
      for(const c of team){
        c.phase+=.05;c.blinkT++;
        if(c.surprised)c.surpriseT++;
        c.y=GY-c.h; // ALWAYS grounded

        if(!canGrab)continue;
        if(c.isPlayer)continue;

        // ── Progressive difficulty: AI scales with zone ──
        const diff=c.type==='ai'?1+zone*0.25:1; // AI gets 25% stronger per zone
        const idleMax=c.type==='ai'?Math.max(5,20-zone*4):15+~~(Math.random()*25);

        // NPC AI: find and walk to items
        if(!c.targetItem||c.targetItem.grabbed){
          c.targetItem=null;c.idleT++;
          if(c.idleT>idleMax){
            let best=null,bd=Infinity;
            for(const it of items){
              if(it.grabbed)continue;
              const d=Math.abs(c.x-(it.x+it.w/2));
              if(c.type==='ai'||Math.random()<.7){
                if(d<bd){bd=d;best=it}
              }
            }
            if(best){c.targetItem=best;c.idleT=0}
          }
        }

        // Walk toward target (X only — grounded)
        if(c.targetItem&&!c.targetItem.grabbed){
          const tx=c.targetItem.x+c.targetItem.w/2;
          const dx=tx-c.x;
          const spd=(c.type==='ai'?c.speed*1.2:c.speed)*diff;
          if(Math.abs(dx)>6){
            c.x+=Math.sign(dx)*spd;
            c.walkDir=Math.sign(dx);
            c.phase+=.04*spd;
          }else{
            // Grab!
            c.targetItem.grabbed=true;c.targetItem.grabSide=c.type;c.targetItem.grabT=0;
            const basePts=c.type==='ai'?0.7:0.5;
            const pts=basePts*diff; // AI scores more in later zones
            if(c.type==='ai')tugAI+=pts;else tugHuman+=pts;
            const total=tugAI+tugHuman;tugAI=tugAI/total*100;tugHuman=tugHuman/total*100;
            particles.push({x:c.targetItem.x,y:c.targetItem.y,vx:0,vy:0,life:18,color:c.type==='ai'?CL.ai:CL.hum,sz:14,type:'ring'});
            c.targetItem=null;c.idleT=0;
            c.carrying=true;c.carryT=20;
          }
        }

        if(c.carryT>0)c.carryT--;else c.carrying=false;

        // Keep in bounds
        c.x=Math.max(15,Math.min(W-20,c.x));
      }

      // Player character walking
      if(canGrab){
        const pTeam=side==='ai'?aiTeam:humTeam;
        if(playerIdx>=0&&pTeam[playerIdx]){
          const pc=pTeam[playerIdx];
          pc.y=GY-pc.h; // grounded

          // Determine walk target: item target takes priority, else walk-to-X
          let walkTarget=null;
          if(pc.targetItem&&!pc.targetItem.grabbed){
            walkTarget=pc.targetItem.x+pc.targetItem.w/2;
          }else if(pc._walkToX!==undefined){
            walkTarget=pc._walkToX;
          }

          // Walk toward target
          if(walkTarget!==null){
            const dx=walkTarget-pc.x;
            if(Math.abs(dx)>5){
              pc.x+=Math.sign(dx)*pc.speed;
              pc.walkDir=Math.sign(dx);
              pc.phase+=.05*pc.speed;
            }else{
              // Arrived at walk target
              if(pc.targetItem&&!pc.targetItem.grabbed){
                // Pick up targeted item
                pc.targetItem.grabbed=true;pc.targetItem.grabSide=side;pc.targetItem.grabT=0;
                score++;
                if(side==='ai')tugAI+=1.5;else tugHuman+=1.5;
                const total=tugAI+tugHuman;tugAI=tugAI/total*100;tugHuman=tugHuman/total*100;
                for(let i=0;i<5;i++)particles.push({x:pc.targetItem.x,y:pc.targetItem.y,vx:(Math.random()-.5)*3,vy:-Math.random()*2,life:18,color:side==='ai'?CL.ai:CL.hum,sz:3,type:'dot'});
                pc.targetItem=null;pc.carrying=true;pc.carryT=20;
              }
              pc._walkToX=undefined; // arrived, stop
            }
          }

          // AUTO-PICKUP: grab any ungrabbed item within 12px while walking
          for(const it of items){
            if(it.grabbed)continue;
            const d=Math.abs(pc.x-(it.x+it.w/2));
            if(d<12){
              it.grabbed=true;it.grabSide=side;it.grabT=0;
              score++;
              if(side==='ai')tugAI+=1.5;else tugHuman+=1.5;
              const total=tugAI+tugHuman;tugAI=tugAI/total*100;tugHuman=tugHuman/total*100;
              particles.push({x:it.x,y:it.y,vx:0,vy:0,life:15,color:side==='ai'?CL.ai:CL.hum,sz:12,type:'ring'});
              pc.carrying=true;pc.carryT=20;
              if(pc.targetItem===it)pc.targetItem=null;
            }
          }

          pc.x=Math.max(15,Math.min(W-20,pc.x));
        }
      }
    }

    function updateParticles(){
      for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx;p.y+=p.vy;p.life--;if(p.life<=0)particles.splice(i,1)}
    }

    // ═══ DRAWING ═══
    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}
    function dk(hex,a){let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return '#'+[r,g,b].map(c=>Math.floor(c*(1-a)).toString(16).padStart(2,'0')).join('')}

    // ── Environment ──
    function drawEnvironment(){
      const z=ZONES[zone];

      // Back wall
      ctx.fillStyle=z.wallColor;ctx.fillRect(0,0,W,GY-30);

      // Wall details
      ctx.strokeStyle='rgba(255,255,255,.02)';ctx.lineWidth=1;
      // Vertical wall panels
      for(let x=0;x<W;x+=80){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,GY-30);ctx.stroke()}
      // Horizontal trim
      ctx.fillStyle='rgba(255,255,255,.03)';ctx.fillRect(0,GY-32,W,2);

      // Ceiling light strips
      for(let i=0;i<4;i++){
        const lx=80+i*160;
        ctx.fillStyle='rgba(255,255,255,.03)';ctx.fillRect(lx,0,40,2);
        // Light cone (subtle)
        ctx.globalAlpha=.015;
        ctx.beginPath();ctx.moveTo(lx,2);ctx.lineTo(lx-20,GY-30);ctx.lineTo(lx+60,GY-30);ctx.lineTo(lx+40,2);ctx.closePath();
        ctx.fillStyle=z.ac;ctx.fill();ctx.globalAlpha=1;
      }

      // Floor
      ctx.fillStyle=z.gnd;ctx.fillRect(0,GY-30,W,H-GY+30);
      // Floor detail
      if(z.floorDetail==='grid'){
        ctx.strokeStyle='rgba(255,255,255,.02)';ctx.lineWidth=.5;
        for(let x=0;x<W;x+=30){ctx.beginPath();ctx.moveTo(x,GY-30);ctx.lineTo(x,H);ctx.stroke()}
        for(let y=GY-30;y<H;y+=15){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
      }else if(z.floorDetail==='wood'){
        ctx.strokeStyle='rgba(255,255,255,.015)';ctx.lineWidth=.5;
        for(let y=GY-28;y<H;y+=8){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
      }else if(z.floorDetail==='tile'){
        ctx.strokeStyle='rgba(255,255,255,.025)';ctx.lineWidth=.5;
        for(let x=0;x<W;x+=25){ctx.beginPath();ctx.moveTo(x,GY-30);ctx.lineTo(x,H);ctx.stroke()}
        for(let y=GY-30;y<H;y+=25){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
      }else if(z.floorDetail==='carpet'){
        ctx.fillStyle='rgba(255,255,255,.01)';
        for(let x=0;x<W;x+=10){for(let y=GY-28;y<H;y+=10){if((x+y)%20===0)ctx.fillRect(x,y,5,5)}}
      }else if(z.floorDetail==='marble'){
        ctx.strokeStyle='rgba(255,200,100,.015)';ctx.lineWidth=.5;
        for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,GY-30);ctx.lineTo(x,H);ctx.stroke()}
      }

      // Ground line
      ctx.strokeStyle=z.gl;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,GY);ctx.lineTo(W,GY);ctx.stroke();

      // Desks/furniture
      for(const d of z.desks){
        // Desk surface
        ctx.fillStyle='#1a1f28';rr(ctx,d.x,GY-18,d.w,4,2);ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.04)';ctx.lineWidth=.5;rr(ctx,d.x,GY-18,d.w,4,2);ctx.stroke();
        // Legs
        ctx.fillStyle='#14181f';
        ctx.fillRect(d.x+4,GY-14,2,14);ctx.fillRect(d.x+d.w-6,GY-14,2,14);

        if(d.type==='screens'||d.type==='desk'){
          // Monitor
          ctx.fillStyle='#1a1f28';rr(ctx,d.x+d.w/2-12,GY-36,24,16,2);ctx.fill();
          ctx.fillStyle='#0d1218';rr(ctx,d.x+d.w/2-10,GY-34,20,12,1);ctx.fill();
          // Screen glow
          ctx.fillStyle=ZONES[zone].ac+'08';rr(ctx,d.x+d.w/2-10,GY-34,20,12,1);ctx.fill();
          // Stand
          ctx.fillStyle='#14181f';ctx.fillRect(d.x+d.w/2-2,GY-20,4,3);
        }
        if(d.type==='easel'){
          // Easel/canvas
          ctx.fillStyle='#1e1a14';rr(ctx,d.x+10,GY-42,d.w-20,22,2);ctx.fill();
          ctx.strokeStyle='rgba(255,255,255,.03)';ctx.lineWidth=.5;rr(ctx,d.x+10,GY-42,d.w-20,22,2);ctx.stroke();
          // Easel legs
          ctx.strokeStyle='#2a2218';ctx.lineWidth=1.5;
          ctx.beginPath();ctx.moveTo(d.x+15,GY-20);ctx.lineTo(d.x+10,GY);ctx.stroke();
          ctx.beginPath();ctx.moveTo(d.x+d.w-15,GY-20);ctx.lineTo(d.x+d.w-10,GY);ctx.stroke();
        }
        if(d.type==='camera'){
          ctx.fillStyle='#2a2a3a';ctx.beginPath();ctx.arc(d.x+d.w/2,GY-30,7,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#1a1a2a';ctx.beginPath();ctx.arc(d.x+d.w/2,GY-30,5,0,Math.PI*2);ctx.fill();
          // Tripod
          ctx.strokeStyle='#222';ctx.lineWidth=1.5;
          ctx.beginPath();ctx.moveTo(d.x+d.w/2,GY-23);ctx.lineTo(d.x+d.w/2-8,GY);ctx.stroke();
          ctx.beginPath();ctx.moveTo(d.x+d.w/2,GY-23);ctx.lineTo(d.x+d.w/2+8,GY);ctx.stroke();
        }
        if(d.type==='tablet'){
          ctx.fillStyle='#1e1a28';rr(ctx,d.x+d.w/2-8,GY-32,16,14,2);ctx.fill();
          ctx.strokeStyle='rgba(255,255,255,.03)';ctx.lineWidth=.5;rr(ctx,d.x+d.w/2-8,GY-32,16,14,2);ctx.stroke();
        }
        if(d.type==='chair'){
          // Office chair
          ctx.fillStyle='#1a1520';rr(ctx,d.x+d.w/2-8,GY-14,16,10,3);ctx.fill();
          ctx.fillStyle='#1a1520';rr(ctx,d.x+d.w/2-10,GY-28,20,14,3);ctx.fill();
          ctx.fillStyle='#111';ctx.beginPath();ctx.arc(d.x+d.w/2,GY-2,3,0,Math.PI*2);ctx.fill();
        }
      }
    }

    // ── Draw item (on surface) ──
    function drawItem(it){
      if(it.grabbed){
        ctx.globalAlpha=Math.max(0,1-it.grabT/20);
        const col=it.grabSide==='ai'?CL.ai:CL.hum;
        ctx.fillStyle=col+'44';rr(ctx,it.x,it.y,it.w,it.h,2);ctx.fill();
        ctx.globalAlpha=1;return;
      }
      // Subtle bob
      const by=it.y+Math.sin(it.bobP)*.8;
      ctx.globalAlpha=1;

      ctx.fillStyle='#282840';
      if(it.icon==='code'){
        rr(ctx,it.x,by,it.w,it.h,2);ctx.fill();ctx.strokeStyle=CL.grn+'BB';ctx.lineWidth=1;rr(ctx,it.x,by,it.w,it.h,2);ctx.stroke();
        ctx.fillStyle='#8d8';ctx.font='bold 7px monospace';ctx.fillText('</>',it.x+3,by+10);
      }else if(it.icon==='doc'){
        rr(ctx,it.x,by,it.w,it.h,2);ctx.fill();ctx.strokeStyle='#888';ctx.lineWidth=.8;rr(ctx,it.x,by,it.w,it.h,2);ctx.stroke();
        ctx.fillStyle='#777';ctx.fillRect(it.x+4,by+3,it.w-8,1.5);ctx.fillRect(it.x+4,by+6,it.w-10,1.5);ctx.fillRect(it.x+4,by+9,it.w-7,1.5);
      }else if(it.icon==='img'){
        rr(ctx,it.x,by,it.w,it.h,2);ctx.fill();ctx.strokeStyle='#888';ctx.lineWidth=.8;rr(ctx,it.x,by,it.w,it.h,2);ctx.stroke();
        ctx.fillStyle=CL.grn+'88';ctx.beginPath();ctx.moveTo(it.x+3,by+it.h-3);ctx.lineTo(it.x+8,by+4);ctx.lineTo(it.x+13,by+it.h-3);ctx.closePath();ctx.fill();
        ctx.fillStyle=CL.amb+'88';ctx.beginPath();ctx.arc(it.x+it.w-5,by+4,2,0,Math.PI*2);ctx.fill();
      }else if(it.icon==='folder'){
        ctx.beginPath();ctx.moveTo(it.x,by+3);ctx.lineTo(it.x+6,by+3);ctx.lineTo(it.x+8,by);ctx.lineTo(it.x+it.w,by);
        ctx.lineTo(it.x+it.w,by+it.h);ctx.lineTo(it.x,by+it.h);ctx.closePath();ctx.fill();
        ctx.strokeStyle=CL.amb+'BB';ctx.lineWidth=.8;ctx.stroke();
      }else if(it.icon==='chart'){
        rr(ctx,it.x,by,it.w,it.h,2);ctx.fill();ctx.strokeStyle='#888';ctx.lineWidth=.8;rr(ctx,it.x,by,it.w,it.h,2);ctx.stroke();
        const bars=[7,11,5,9,13];for(let b=0;b<5;b++){ctx.fillStyle=CL.grn+'99';ctx.fillRect(it.x+2+b*3.2,by+it.h-2-bars[b]*.6,2.2,bars[b]*.6)}
      }

      // Label
      ctx.fillStyle='#bbb';ctx.font='bold 6px monospace';ctx.textAlign='center';
      ctx.fillText(it.label,it.x+it.w/2,by+it.h+7);ctx.textAlign='left';
      ctx.globalAlpha=1;
    }

    // ── Draw character ──
    function drawChar(c){
      const s=c.h/22;const isAI=c.type==='ai';
      const walking=c.targetItem&&!c.targetItem.grabbed;
      const bob=walking?Math.abs(Math.sin(c.phase))*1.2*s:0;
      const ls=walking?Math.sin(c.phase)*3*s:0;

      ctx.save();ctx.translate(c.x+c.w/2,GY);

      // Player glow
      if(c.isPlayer){
        ctx.globalAlpha=.1+Math.sin(fr*.07)*.04;
        const gc=isAI?CL.ai:CL.hum;
        const gr=ctx.createRadialGradient(0,-c.h/2,2,0,-c.h/2,20*s);
        gr.addColorStop(0,gc);gr.addColorStop(1,'transparent');
        ctx.fillStyle=gr;ctx.beginPath();ctx.arc(0,-c.h/2,20*s,0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=1;
      }

      // Shadow
      ctx.fillStyle='rgba(0,0,0,.1)';ctx.beginPath();ctx.ellipse(0,0,7*s,2*s,0,0,Math.PI*2);ctx.fill();

      // Legs
      const legCol=isAI?dk(CL.aiB,.3):dk(c.skin.bc,.3);
      ctx.strokeStyle=legCol;ctx.lineWidth=2.5*s;ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(-2.5*s,-5*s-bob);ctx.lineTo(-2.5*s+ls*.5,-1);ctx.stroke();
      ctx.beginPath();ctx.moveTo(2.5*s,-5*s-bob);ctx.lineTo(2.5*s-ls*.5,-1);ctx.stroke();

      // Body
      const bodyCol=isAI?CL.aiB:c.skin.bc;
      ctx.fillStyle=bodyCol;rr(ctx,-5*s,-13*s-bob,10*s,9*s,3*s);ctx.fill();
      ctx.strokeStyle=dk(bodyCol,.2);ctx.lineWidth=.7*s;rr(ctx,-5*s,-13*s-bob,10*s,9*s,3*s);ctx.stroke();

      // Arms
      const armSw=walking?Math.sin(c.phase+.5)*2*s:Math.sin(c.phase*.3)*.5*s;
      ctx.strokeStyle=bodyCol;ctx.lineWidth=2*s;
      ctx.beginPath();ctx.moveTo(-5*s,-10*s-bob);ctx.lineTo(-6*s-armSw,-5*s-bob);ctx.stroke();
      ctx.beginPath();ctx.moveTo(5*s,-10*s-bob);ctx.lineTo(6*s+armSw,-5*s-bob);ctx.stroke();
      ctx.fillStyle=isAI?CL.ai:c.skin.sk;
      ctx.beginPath();ctx.arc(-6*s-armSw,-4.5*s-bob,1.6*s,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(6*s+armSw,-4.5*s-bob,1.6*s,0,Math.PI*2);ctx.fill();

      // Head
      const hR=6.5*s,hy=-17.5*s-bob;
      if(isAI){
        ctx.fillStyle=CL.ai;ctx.beginPath();ctx.arc(0,hy,hR,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle='#a04520';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,hy,hR,0,Math.PI*2);ctx.stroke();
        ctx.strokeStyle=CL.acc;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,hy-hR);ctx.lineTo(0,hy-hR-4*s);ctx.stroke();
        ctx.fillStyle=CL.acc;ctx.beginPath();ctx.arc(0,hy-hR-4*s,1.8*s,0,Math.PI*2);ctx.fill();
        ctx.globalAlpha=.2+Math.sin(fr*.1)*.08;ctx.beginPath();ctx.arc(0,hy-hR-4*s,3*s,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
        ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(0,hy+.5,3*s,3.5*s,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#40C8E0';ctx.beginPath();ctx.arc(.5*s,hy+1,1.8*s,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#0a2a3a';ctx.beginPath();ctx.arc(.5*s,hy+1,.9*s,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='rgba(255,255,255,.5)';ctx.beginPath();ctx.arc(-.8*s,hy-.8,.8*s,0,Math.PI*2);ctx.fill();
      }else{
        ctx.fillStyle=c.skin.sk;ctx.beginPath();ctx.arc(0,hy,hR,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=c.skin.hr;ctx.beginPath();ctx.arc(0,hy,hR,Math.PI,2*Math.PI);ctx.fill();
        const bl=c.blinkT%200>195;
        if(c.surprised&&c.surpriseT<120){
          ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(0,hy+.5,3*s,4*s,0,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#1a1a2e';ctx.beginPath();ctx.arc(0,hy+1,1.8*s,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle='#3a2a1a';ctx.lineWidth=.6;ctx.beginPath();ctx.arc(0,hy+4.5*s,1.2*s,0,Math.PI*2);ctx.stroke();
        }else if(!bl){
          ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(0,hy+.5,2.8*s,3.2*s,0,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#1a1a2e';ctx.beginPath();ctx.arc(0,hy+1,1.3*s,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='rgba(255,255,255,.5)';ctx.beginPath();ctx.arc(-.8*s,hy-.3,.7*s,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle='rgba(0,0,0,.12)';ctx.lineWidth=.5*s;ctx.beginPath();ctx.arc(0,hy+3.5*s,1.8*s,.2,Math.PI-.3);ctx.stroke();
        }
      }

      // "YOU" label
      if(c.isPlayer){
        ctx.fillStyle=isAI?CL.ai:CL.hum;ctx.font='bold 7px monospace';ctx.textAlign='center';
        ctx.fillText('\u25BC YOU',0,hy-hR-4*s-(isAI?4:0));
        ctx.textAlign='left';
      }

      // Carry indicator
      if(c.carrying&&c.carryT>0){
        ctx.fillStyle=isAI?CL.ai+'88':CL.hum+'88';ctx.font='bold 6px monospace';ctx.textAlign='center';
        ctx.fillText('+1',0,hy-hR-2*s-(isAI?4:0));ctx.textAlign='left';
      }

      ctx.restore();
    }

    // ═══ MAIN DRAW ═══
    function draw(){
      const z=ZONES[zone];
      ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);

      // Zone watermark
      ctx.globalAlpha=.025;ctx.font='800 22px Syne,sans-serif';ctx.fillStyle=z.ac;
      ctx.fillText(z.name.toUpperCase(),15,GY-35);ctx.globalAlpha=1;

      drawEnvironment();

      // Items
      for(const it of items)drawItem(it);

      // Powerups
      for(const p of powerups){
        p.bobP+=.035;p.age++;const py=p.y+Math.sin(p.bobP)*3;
        ctx.save();ctx.translate(p.x,py);
        ctx.beginPath();for(let i=0;i<6;i++){const a=Math.PI/3*i-Math.PI/6;i===0?ctx.moveTo(Math.cos(a)*p.sz,Math.sin(a)*p.sz):ctx.lineTo(Math.cos(a)*p.sz,Math.sin(a)*p.sz)}
        ctx.closePath();ctx.fillStyle=p.color+'33';ctx.fill();ctx.strokeStyle=p.color;ctx.lineWidth=1.2;ctx.stroke();
        ctx.fillStyle=p.color;ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText(p.icon,0,3);ctx.textAlign='left';
        ctx.restore();
      }

      // Characters (sort by x for depth)
      const allChars=[...humTeam,...aiTeam].sort((a,b)=>a.x-b.x);
      for(const c of allChars)drawChar(c);

      // Particles
      for(const p of particles){
        if(p.type==='ring'){ctx.globalAlpha=p.life/22*.4;ctx.strokeStyle=p.color;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,p.sz*(1-p.life/22),0,Math.PI*2);ctx.stroke()}
        else{ctx.globalAlpha=p.life/18;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill()}
        ctx.globalAlpha=1;
      }

      // ═══ HUD ═══
      if(state==='PLAYING'){
        if(side!=='observe'){
          ctx.fillStyle=side==='ai'?CL.ai:CL.hum;ctx.font='bold 11px monospace';ctx.fillText('\u2B21 '+score,10,14);
          ctx.font='bold 7px monospace';ctx.fillStyle='#888';ctx.fillText(side==='ai'?'AI AGENT':'HUMAN',10,23);
        }
        ctx.textAlign='right';ctx.fillStyle='#555';ctx.font='bold 8px monospace';ctx.fillText(z.name,W-10,14);ctx.textAlign='left';
        let px=side!=='observe'?60:10;
        if(overT>0){ctx.fillStyle='#50C8FF';ctx.font='bold 7px monospace';ctx.fillText('\u26A1FAST',px,14);px+=40}
        if(frzT>0){ctx.fillStyle='#99AAFF';ctx.font='bold 7px monospace';ctx.fillText('\u2744FRZ',px,14);px+=35}
        if(magT>0){ctx.fillStyle='#7C50FF';ctx.font='bold 7px monospace';ctx.fillText('\u25CEMAG',px,14);px+=35}
      }

      // Tug bar
      if(state==='PLAYING'||state==='CHOOSE'||state==='INVASION'){
        const bY=H-7,bW=W-20,bH=4;
        ctx.fillStyle='#21262d';rr(ctx,10,bY,bW,bH,2);ctx.fill();
        const aiW=bW*(tugAI/100);
        ctx.fillStyle=CL.ai+'cc';rr(ctx,10,bY,aiW,bH,2);ctx.fill();
        ctx.fillStyle=CL.hum+'cc';rr(ctx,10+aiW,bY,bW-aiW,bH,2);ctx.fill();
        ctx.fillStyle='#fff';ctx.fillRect(10+bW/2-1,bY-1,2,bH+2);
        ctx.font='bold 6px monospace';ctx.fillStyle=CL.ai;ctx.fillText('AI '+Math.round(tugAI)+'%',12,bY-2);
        ctx.textAlign='right';ctx.fillStyle=CL.hum;ctx.fillText('HUMAN '+Math.round(tugHuman)+'%',W-12,bY-2);ctx.textAlign='left';
      }

      if(state==='PLAYING'){const pY=H-13,pW=W-20;ctx.fillStyle='#21262d33';ctx.fillRect(10,pY,pW,2);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(10,pY,pW*(prog/100),2)}

      // CHOOSE overlay
      if(state==='CHOOSE'){
        ctx.fillStyle='rgba(15,13,26,0.55)';ctx.fillRect(0,0,W,H);
        ctx.font='800 15px Syne,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';
        ctx.fillText('THE DISPLACEMENT HAS BEGUN',W/2,H/2-12);
        ctx.strokeStyle=CL.acc+'44';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(W/2-110,H/2-2);ctx.lineTo(W/2+110,H/2-2);ctx.stroke();
        const bw=110,bh=26,gap=14,totalBW=bw*3+gap*2,bx=W/2-totalBW/2,by=H/2+10;
        ctx.fillStyle=CL.ai+'22';rr(ctx,bx,by,bw,bh,5);ctx.fill();ctx.strokeStyle=CL.ai;ctx.lineWidth=1.5;rr(ctx,bx,by,bw,bh,5);ctx.stroke();ctx.fillStyle=CL.ai;ctx.font='bold 9px monospace';ctx.fillText('JOIN AS AI',bx+bw/2,by+16);
        const bx2=bx+bw+gap;ctx.fillStyle=CL.hum+'22';rr(ctx,bx2,by,bw,bh,5);ctx.fill();ctx.strokeStyle=CL.hum;ctx.lineWidth=1.5;rr(ctx,bx2,by,bw,bh,5);ctx.stroke();ctx.fillStyle=CL.hum;ctx.font='bold 9px monospace';ctx.fillText('JOIN AS HUMAN',bx2+bw/2,by+16);
        const bx3=bx+bw*2+gap*2;ctx.fillStyle='#ffffff11';rr(ctx,bx3,by,bw,bh,5);ctx.fill();ctx.strokeStyle='#888';ctx.lineWidth=1;rr(ctx,bx3,by,bw,bh,5);ctx.stroke();ctx.fillStyle='#999';ctx.font='bold 9px monospace';ctx.fillText('OBSERVE',bx3+bw/2,by+16);
        ctx.textAlign='left';
      }

      if(state==='INTRO'){ctx.globalAlpha=Math.min(1,introT/30)*.6;ctx.font='bold 9px monospace';ctx.fillStyle='#888';ctx.textAlign='center';ctx.fillText('Workers producing...',W/2,14);ctx.textAlign='left';ctx.globalAlpha=1}
      if(state==='INVASION'){ctx.globalAlpha=Math.min(1,invT/20)*.8;ctx.font='800 13px Syne';ctx.fillStyle=CL.ai;ctx.textAlign='center';ctx.fillText('AI AGENTS INCOMING...',W/2,14);ctx.textAlign='left';ctx.globalAlpha=1}
      if(trT>0&&trTxt){ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Syne';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.globalAlpha=1}

      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.88)';ctx.fillRect(0,0,W,H);
        const winner=tugAI>tugHuman?'AI':'HUMANS',winCol=tugAI>tugHuman?CL.ai:CL.hum;
        ctx.font='800 16px Syne';ctx.textAlign='center';ctx.fillStyle=winCol;ctx.fillText(winner+' WIN THE TURF WAR',W/2,H*.22);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code 0',W/2,H*.22+14);
        if(side!=='observe'){ctx.font='bold 11px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' items captured',W/2,H*.46)}
        ctx.font='bold 9px monospace';ctx.fillStyle='#555';ctx.fillText('AI '+Math.round(tugAI)+'% vs HUMAN '+Math.round(tugHuman)+'%',W/2,H*.46+(side!=='observe'?14:0));

        // Share buttons
        const btnW=100,btnH=22,btnGap=12;
        const btnY=H*.72;
        const twBtnX=W/2-btnW-btnGap/2;
        const pngBtnX=W/2+btnGap/2;

        // Twitter/X button
        ctx.fillStyle='#1DA1F2'+'22';rr(ctx,twBtnX,btnY,btnW,btnH,4);ctx.fill();
        ctx.strokeStyle='#1DA1F2';ctx.lineWidth=1;rr(ctx,twBtnX,btnY,btnW,btnH,4);ctx.stroke();
        ctx.fillStyle='#1DA1F2';ctx.font='bold 9px monospace';
        ctx.fillText('\u{1F426} SHARE ON X',twBtnX+btnW/2,btnY+15);

        // Save PNG button
        ctx.fillStyle=CL.acc+'22';rr(ctx,pngBtnX,btnY,btnW,btnH,4);ctx.fill();
        ctx.strokeStyle=CL.acc;ctx.lineWidth=1;rr(ctx,pngBtnX,btnY,btnW,btnH,4);ctx.stroke();
        ctx.fillStyle=CL.acc;ctx.font='bold 9px monospace';
        ctx.fillText('\u{1F4BE} SAVE CARD',pngBtnX+btnW/2,btnY+15);

        ctx.textAlign='left';

        // Store button positions for click handler
        window._runlaidBtns={twBtnX,pngBtnX,btnW,btnH,btnY};
      }

      ctx.globalAlpha=.02;for(let y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.globalAlpha=1;
    }

    // ═══ SHARE FUNCTIONS ═══

    function generateCard(){
      const card=document.createElement('canvas');
      card.width=600;card.height=315;
      const c=card.getContext('2d');

      // Background
      c.fillStyle='#0F0D1A';c.fillRect(0,0,600,315);

      // Accent border
      c.strokeStyle=CL.acc+'44';c.lineWidth=2;c.strokeRect(1,1,598,313);

      // Grid pattern
      c.globalAlpha=.03;c.strokeStyle=CL.acc;c.lineWidth=.5;
      for(let x=0;x<600;x+=30){c.beginPath();c.moveTo(x,0);c.lineTo(x,315);c.stroke()}
      for(let y=0;y<315;y+=30){c.beginPath();c.moveTo(0,y);c.lineTo(600,y);c.stroke()}
      c.globalAlpha=1;

      // Title
      c.font='800 36px Syne,sans-serif';c.textAlign='center';c.fillStyle='#fff';
      c.fillText('RUNLAID',300,55);
      c.font='bold 14px monospace';c.fillStyle=CL.acc;c.fillText('.exe',385,55);

      // Subtitle
      c.font='bold 11px monospace';c.fillStyle='#555';c.fillText('THE GREAT DISPLACEMENT',300,75);

      // Divider
      c.strokeStyle=CL.acc+'44';c.lineWidth=1;c.beginPath();c.moveTo(150,90);c.lineTo(450,90);c.stroke();

      // Winner
      const winner=tugAI>tugHuman?'AI':'HUMANS';
      const winCol=tugAI>tugHuman?CL.ai:CL.hum;
      c.font='800 28px Syne,sans-serif';c.fillStyle=winCol;
      c.fillText(winner+' WIN',300,130);

      // Tug bar
      const bx=100,by=150,bw=400,bh=16;
      c.fillStyle='#21262d';rr(c,bx,by,bw,bh,8);c.fill();
      const aiW=bw*(tugAI/100);
      c.fillStyle=CL.ai;rr(c,bx,by,aiW,bh,8);c.fill();
      c.fillStyle=CL.hum;rr(c,bx+aiW,by,bw-aiW,bh,8);c.fill();
      c.fillStyle='#fff';c.fillRect(bx+bw/2-1,by-2,2,bh+4);

      c.font='bold 12px monospace';
      c.fillStyle=CL.ai;c.textAlign='left';c.fillText('AI '+Math.round(tugAI)+'%',bx,by+bh+18);
      c.fillStyle=CL.hum;c.textAlign='right';c.fillText('HUMAN '+Math.round(tugHuman)+'%',bx+bw,by+bh+18);
      c.textAlign='center';

      // Player stats
      if(side!=='observe'){
        const sideLabel=side==='ai'?'AI AGENT':'HUMAN';
        const sideCol=side==='ai'?CL.ai:CL.hum;
        c.font='bold 12px monospace';c.fillStyle='#666';c.fillText('Played as '+sideLabel,300,215);
        c.font='bold 22px monospace';c.fillStyle=CL.acc;c.fillText('\u2B21 '+score+' items captured',300,245);
      }else{
        c.font='bold 12px monospace';c.fillStyle='#666';c.fillText('Observed the displacement',300,230);
      }

      // Footer
      c.font='bold 10px monospace';c.fillStyle='#444';c.fillText('The displacement continues. \u2022 @25thprmr',300,290);

      return card;
    }

    function savePNGCard(){
      try{
        const card=generateCard();
        const link=document.createElement('a');
        link.download='runlaid-result.png';
        link.href=card.toDataURL('image/png');
        link.click();
      }catch(e){console.error('[RUNLAID] PNG save failed:',e)}
    }

    function shareToTwitter(){
      const winner=tugAI>tugHuman?'AI':'HUMANS';
      let text='';
      if(side!=='observe'){
        text=winner+' won the turf war in RUNLAID.exe!\n\n'
          +'\u2B21 '+score+' items captured\n'
          +'AI '+Math.round(tugAI)+'% vs HUMAN '+Math.round(tugHuman)+'%\n\n'
          +'I played as '+(side==='ai'?'AI Agent':'Human')+' while Claude coded.\n\n'
          +'by @25thprmr';
      }else{
        text=winner+' won the turf war in RUNLAID.exe!\n\n'
          +'AI '+Math.round(tugAI)+'% vs HUMAN '+Math.round(tugHuman)+'%\n\n'
          +'I watched the displacement unfold while Claude coded.\n\n'
          +'by @25thprmr';
      }
      // Also save the PNG so they can attach it
      try{
        const card=generateCard();
        const link=document.createElement('a');
        link.download='runlaid-result.png';
        link.href=card.toDataURL('image/png');
        link.click();
      }catch(e){}
      // Open Twitter intent
      const url='https://x.com/intent/tweet?text='+encodeURIComponent(text);
      window.open(url,'_blank');
    }

    // ═══ API ═══
    window._runlaid={
      start:function(){state='INTRO';fr=0;score=0;tugAI=50;tugHuman=50;prog=0;zone=0;side=null;introT=0;invT=0;trT=0;overT=0;frzT=0;magT=0;playerIdx=-1;initScene()},
      setProgress:function(v){if(state==='PLAYING'||state==='CHOOSE')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state,score,prog,tugAI,tugHuman,side}}
    };

    function loop(){if(!document.getElementById('runlaid-c'))return;update();draw();requestAnimationFrame(loop)}
    loop();
  }
})();
