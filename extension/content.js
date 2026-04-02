// ═══════════════════════════════════════════════════════════
// RUNLAID.exe — Chrome Extension Content Script
// Multi-game registry. Watches claude.ai, picks a random game.
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  let gameVisible = false;
  let container = null;
  let _gameApi = null;
  let streamStartTime = 0;
  let streamingDetected = false;
  let dismissed = false; // true = user clicked X, don't relaunch until next stream
  let checkInterval = null;
  let hideTimeout = null;

  const STREAM_DELAY_MS = 5000;
  const HIDE_DELAY_MS = 5000;

  // ═══════════════════════════════════════════════════════════
  // GAME REGISTRY
  // ═══════════════════════════════════════════════════════════

  const GAMES = [];
  let lastPlayedIds = [];

  function registerGame(descriptor) {
    if (!descriptor.id || !descriptor.factory) return;
    GAMES.push(descriptor);
  }

  function pickGame() {
    if (GAMES.length === 0) return null;
    if (GAMES.length === 1) return GAMES[0];
    const avoidCount = Math.min(3, Math.floor(GAMES.length / 2));
    const recent = lastPlayedIds.slice(-avoidCount);
    const available = GAMES.filter(function(g) { return recent.indexOf(g.id) === -1; });
    const pool = available.length > 0 ? available : GAMES;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    lastPlayedIds.push(picked.id);
    if (lastPlayedIds.length > 10) lastPlayedIds.shift();
    return picked;
  }

  // ═══════════════════════════════════════════════════════════
  // OVERLAY MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  function getInputBox() {
    return document.querySelector('[contenteditable="true"]') ||
           document.querySelector('textarea') ||
           document.querySelector('[class*="ProseMirror"]') ||
           document.querySelector('[data-placeholder="Reply..."]');
  }

  function getInputBoxRect() {
    var el = getInputBox();
    if (!el) return null;
    var box = el;
    for (var i = 0; i < 5; i++) {
      if (box.parentElement) box = box.parentElement;
    }
    return box.getBoundingClientRect();
  }

  var positionInterval = null;

  function createOverlay() {
    if (container) return;

    container = document.createElement('div');
    container.id = 'runlaid-container';

    var style = document.createElement('style');
    style.textContent = '\
      #runlaid-container {\
        position: fixed;\
        z-index: 2147483647;\
        border-radius: 10px 10px 0 0; overflow: hidden;\
        box-shadow: 0 -4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(124,80,255,0.15);\
        transition: opacity 0.4s ease, transform 0.4s ease;\
        opacity: 0; transform: translateY(10px);\
        background: #0F0D1A; font-family: "JetBrains Mono", Consolas, monospace;\
      }\
      #runlaid-container.visible { opacity: 1; transform: translateY(0); }\
      #runlaid-container.minimized #runlaid-canvas-wrap { display: none; }\
      #runlaid-header {\
        height: 28px; background: #1E1C30; display: flex;\
        align-items: center; justify-content: space-between;\
        padding: 0 10px; cursor: default;\
        border-bottom: 1px solid rgba(124,80,255,0.12);\
        user-select: none;\
      }\
      #runlaid-title { font-size: 10px; color: #7C50FF; letter-spacing: 0.5px; font-weight: 600; }\
      #runlaid-controls { display: flex; gap: 4px; }\
      #runlaid-controls button {\
        width: 20px; height: 20px; border: none; background: transparent;\
        color: #666; font-size: 11px; cursor: pointer; border-radius: 4px;\
        display: flex; align-items: center; justify-content: center;\
        transition: all 0.15s; font-family: monospace;\
      }\
      #runlaid-controls button:hover { background: rgba(255,255,255,0.08); color: #fff; }\
      #runlaid-close:hover { background: rgba(226,75,74,0.2) !important; color: #E24B4A !important; }\
      #runlaid-canvas-wrap { width: 100%; }\
      #runlaid-canvas-wrap canvas { display: block; width: 100%; }\
    ';
    document.head.appendChild(style);

    container.innerHTML = '\
      <div id="runlaid-header">\
        <span id="runlaid-title">RUNLAID.exe</span>\
        <div id="runlaid-controls">\
          <button id="runlaid-minimize" title="Minimize">\u2500</button>\
          <button id="runlaid-close" title="Close">\u2715</button>\
        </div>\
      </div>\
      <div id="runlaid-canvas-wrap"></div>\
    ';
    document.body.appendChild(container);

    container.querySelector('#runlaid-minimize').addEventListener('click', function() {
      container.classList.toggle('minimized');
    });
    container.querySelector('#runlaid-close').addEventListener('click', function() {
      hideGame(true);
    });

    positionContainer();
    positionInterval = setInterval(positionContainer, 300);
  }

  function positionContainer() {
    if (!container) return;
    var rect = getInputBoxRect();
    if (!rect) {
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

  // ═══════════════════════════════════════════════════════════
  // GAME LIFECYCLE
  // ═══════════════════════════════════════════════════════════

  function launchGame() {
    var wrap = container.querySelector('#runlaid-canvas-wrap');
    if (!wrap) return;

    var descriptor = pickGame();
    if (!descriptor) return;

    // Update header with game name
    var titleEl = container.querySelector('#runlaid-title');
    if (titleEl) titleEl.textContent = 'RUNLAID.exe \u2014 ' + descriptor.name;

    // Create canvas
    var canvas = document.createElement('canvas');
    canvas.id = 'runlaid-c';
    canvas.width = 640;
    canvas.height = 180;
    wrap.appendChild(canvas);

    // Call factory — returns {start, setProgress, getState, destroy}
    _gameApi = descriptor.factory(canvas);
  }

  function showGame() {
    if (gameVisible) return;

    var stale = document.getElementById('runlaid-container');
    if (stale) { stale.remove(); container = null; }
    if (_gameApi && _gameApi.destroy) _gameApi.destroy();
    _gameApi = null;

    createOverlay();
    gameVisible = true;
    container.classList.remove('minimized');
    requestAnimationFrame(function() { container.classList.add('visible'); });

    launchGame();

    setTimeout(function() {
      if (_gameApi) _gameApi.start();
    }, 500);
  }

  function hideGame(immediate) {
    if (!gameVisible && !container) return;
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    if (progressFeedInterval) { clearInterval(progressFeedInterval); progressFeedInterval = null; }
    if (positionInterval) { clearInterval(positionInterval); positionInterval = null; }

    // Destroy current game
    if (_gameApi && _gameApi.destroy) _gameApi.destroy();

    if (immediate) {
      dismissed = true; // user closed — don't relaunch until next stream
      if (container) container.classList.remove('visible');
      setTimeout(function() {
        if (container) { container.remove(); container = null; }
        gameVisible = false;
        _gameApi = null;
      }, 400);
    } else {
      setTimeout(function() {
        if (container) container.classList.remove('visible');
        setTimeout(function() {
          if (container) { container.remove(); container = null; }
          gameVisible = false;
          _gameApi = null;
        }, 500);
      }, 4000);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STREAMING DETECTION
  // ═══════════════════════════════════════════════════════════

  function isStreaming() {
    return !!document.querySelector('[data-is-streaming="true"]');
  }

  var progressFeedInterval = null;

  function startWatching() {
    if (checkInterval) return;
    checkInterval = setInterval(function() {
      var nowStreaming = isStreaming();

      if (nowStreaming && !streamingDetected) {
        streamingDetected = true;
        streamStartTime = Date.now();
        console.log('[RUNLAID.exe] Streaming detected...');
      }

      if (streamingDetected && nowStreaming) {
        var elapsed = Date.now() - streamStartTime;

        if (!gameVisible && !dismissed && elapsed >= STREAM_DELAY_MS) {
          console.log('[RUNLAID.exe] Launching! elapsed=' + elapsed + 'ms');
          showGame();

          if (progressFeedInterval) clearInterval(progressFeedInterval);
          var feedProg = 0;
          progressFeedInterval = setInterval(function() {
            if (!gameVisible || !streamingDetected) { clearInterval(progressFeedInterval); return; }
            feedProg = Math.min(65, feedProg + 0.3);
            if (_gameApi) _gameApi.setProgress(feedProg);
          }, 300);
        }
      }

      if (!nowStreaming && streamingDetected) {
        streamingDetected = false;
        dismissed = false; // reset — next stream can trigger a new game
        console.log('[RUNLAID.exe] Streaming stopped.');
        if (progressFeedInterval) { clearInterval(progressFeedInterval); progressFeedInterval = null; }

        if (gameVisible) {
          if (_gameApi) _gameApi.setProgress(100);
          hideTimeout = setTimeout(function() { hideGame(false); }, 5000);
        }
      }
    }, 500);
  }

  startWatching();
  console.log('[RUNLAID.exe] Content script loaded. Watching for Claude activity...');


  // ═══════════════════════════════════════════════════════════
  // GAME: THE GREAT DISPLACEMENT (Turf War)
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'turf-war',
    name: 'The Great Displacement',
    version: '2.2',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var running = true;
    var _gameApiBtns = null;

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
    function onMouseDown(e){
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

      if(state==='FINISHED'&&_gameApiBtns){
        const b=_gameApiBtns;
        if(my>=b.btnY&&my<=b.btnY+b.btnH){
          if(mx>=b.twBtnX&&mx<b.twBtnX+b.btnW){
            shareToTwitter();return;
          }
          if(mx>=b.pngBtnX&&mx<b.pngBtnX+b.btnW){
            savePNGCard();return;
          }
        }
      }

      if(state==='PLAYING'&&side!=='observe'&&playerIdx>=0){
        const team=side==='ai'?aiTeam:humTeam;
        const pc=team[playerIdx];
        if(!pc)return;

        pc._walkToX=mx;
        pc.targetItem=null;

        let best=null,bd=Infinity;
        for(const it of items){
          if(it.grabbed)continue;
          const dx=mx-(it.x+it.w/2),dy=my-(it.y+it.h/2);
          const d=Math.sqrt(dx*dx+dy*dy);
          if(d<45&&d<bd){bd=d;best=it}
        }
        if(best){pc.targetItem=best}

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
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);
    canvas.addEventListener('contextmenu',onContextMenu);


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
        _gameApiBtns={twBtnX,pngBtnX,btnW,btnH,btnY};
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
      }catch(e){console.warn('[RUNLAID] PNG generation failed:',e.message)}
      // Open Twitter intent — hardcoded domain, noopener for security
      const url='https://x.com/intent/tweet?text='+encodeURIComponent(text);
      window.open(url,'_blank','noopener,noreferrer');
    }


    // ═══ GAME LOOP ═══
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}
    loop();

    // ═══ API — returned to registry ═══
    return {
      start:function(){state='INTRO';fr=0;score=0;tugAI=50;tugHuman=50;prog=0;zone=0;side=null;introT=0;invT=0;trT=0;overT=0;frzT=0;magT=0;playerIdx=-1;initScene()},
      setProgress:function(v){if(state==='PLAYING'||state==='CHOOSE')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){
        running=false;
        canvas.removeEventListener('mousedown',onMouseDown);
        canvas.removeEventListener('contextmenu',onContextMenu);
      }
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: DISPLACEMENT WHACK
  // AI agents pop up at workstations. Click to push them back.
  // Don't click the humans. Progressive difficulty.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'displacement-whack',
    name: 'Displacement Whack',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var running = true;

    var GY = H - 18;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',
      ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',
      acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};

    var ZONES = [
      {name:'Tech Office',sky:'#0c1015',ac:'#3fb950',gnd:'#0a0e14',gl:'#182028'},
      {name:'Design Studio',sky:'#14100a',ac:'#E8A000',gnd:'#121008',gl:'#221c10'},
      {name:'Newsroom',sky:'#080808',ac:'#E24B4A',gnd:'#0c0c0c',gl:'#1a1a1a'},
      {name:'Film Set',sky:'#150008',ac:'#FFD700',gnd:'#120510',gl:'#221020'},
      {name:'Trading Floor',sky:'#040a04',ac:'#E8A000',gnd:'#060a06',gl:'#142014'},
    ];

    var HSKINS = [
      {bc:'#3570B0',sk:'#F4C7A3',hr:'#3A2A1A'},
      {bc:'#C04878',sk:'#F0D5C0',hr:'#8B3A1A'},
      {bc:'#3A9080',sk:'#C8A882',hr:'#1A3A2A'},
      {bc:'#A83030',sk:'#F0D0B0',hr:'#5A2A1A'},
      {bc:'#8A5090',sk:'#F0C8B0',hr:'#5A2A3A'},
    ];

    // State
    var state = 'INTRO', fr = 0, score = 0, prog = 0, zone = 0;
    var hp = 10, maxHp = 10;
    var combo = 0, comboT = 0, bestCombo = 0;
    var introT = 0;
    var trT = 0, trTxt = '', trA = 0;
    var feedbackTxt = '', feedbackT = 0, feedbackCol = '';

    // 7 holes/stations across the screen
    var HOLE_COUNT = 7;
    var holes = [];
    var particles = [];

    function initHoles() {
      holes = [];
      for (var i = 0; i < HOLE_COUNT; i++) {
        holes.push({
          x: 30 + i * ((W - 60) / (HOLE_COUNT - 1)),
          y: GY,
          // Pop state
          active: false,
          type: null,       // 'ai' or 'human'
          skin: null,
          popY: 0,          // 0 = hidden, 1 = fully popped
          popDir: 0,        // 1 = rising, -1 = sinking
          stayT: 0,         // frames to stay up
          cooldown: 0,      // frames before can pop again
          whacked: false,
          whackT: 0,
        });
      }
    }

    function popRandom() {
      // Find available holes
      var avail = [];
      for (var i = 0; i < holes.length; i++) {
        if (!holes[i].active && holes[i].cooldown <= 0) avail.push(i);
      }
      if (avail.length === 0) return;

      var idx = avail[Math.floor(Math.random() * avail.length)];
      var h = holes[idx];
      h.active = true;
      h.whacked = false;
      h.whackT = 0;
      h.popY = 0;
      h.popDir = 1;

      // Difficulty scaling: more AI, faster, shorter stay
      var aiChance = 0.55 + zone * 0.08; // 55% → 87% AI
      var isAI = Math.random() < aiChance;
      h.type = isAI ? 'ai' : 'human';
      h.skin = isAI ? null : HSKINS[Math.floor(Math.random() * HSKINS.length)];

      // Stay time decreases with zone
      h.stayT = Math.max(40, 100 - zone * 12 - Math.random() * 20);
    }

    // ═══ INPUT ═══
    function onMouseDown(e) {
      e.preventDefault(); e.stopPropagation();
      var rect = canvas.getBoundingClientRect();
      var mx = (e.clientX - rect.left) * (W / rect.width);
      var my = (e.clientY - rect.top) * (H / rect.height);

      if (state === 'INTRO') { state = 'PLAYING'; return; }
      if (state !== 'PLAYING') return;

      // Check if clicking on a popped character
      var hit = false;
      for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        if (!h.active || h.whacked || h.popY < 0.3) continue;

        var charY = h.y - 30 * h.popY;
        var dx = mx - h.x, dy = my - charY;
        if (Math.abs(dx) < 22 && Math.abs(dy) < 22) {
          if (h.type === 'ai') {
            // Good hit!
            h.whacked = true;
            h.whackT = 0;
            h.popDir = -1;
            score++;
            combo++;
            if (combo > bestCombo) bestCombo = combo;
            comboT = 90;

            var pts = combo >= 5 ? 3 : combo >= 3 ? 2 : 1;
            feedbackTxt = '+' + pts + (combo >= 3 ? ' x' + combo : '');
            feedbackT = 35;
            feedbackCol = CL.grn;

            // Particles
            for (var p = 0; p < 8; p++) {
              particles.push({
                x: h.x, y: charY,
                vx: (Math.random() - .5) * 5,
                vy: -Math.random() * 4 - 1,
                life: 20 + Math.random() * 10,
                color: CL.ai, sz: 2 + Math.random() * 2
              });
            }
          } else {
            // Hit a human — bad!
            hp = Math.max(0, hp - 2);
            combo = 0;
            feedbackTxt = 'WRONG!';
            feedbackT = 40;
            feedbackCol = CL.red;

            // Red flash
            particles.push({
              x: 0, y: 0, vx: 0, vy: 0,
              life: 12, color: CL.red, sz: 0, type: 'flash'
            });

            if (hp <= 0) {
              // Don't end — just penalty
              hp = 0;
            }
          }
          hit = true;
          break;
        }
      }

      if (!hit) {
        // Missed click
        combo = 0;
      }
    }
    function onContextMenu(e) { e.preventDefault(); e.stopPropagation(); }
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContextMenu);

    // ═══ UPDATE ═══
    function update() {
      fr++;

      if (state === 'INTRO') {
        introT++;
        if (introT > 180) state = 'PLAYING';
        return;
      }

      if (state !== 'PLAYING') return;

      // Zone
      var pz = zone;
      zone = prog < 20 ? 0 : prog < 40 ? 1 : prog < 60 ? 2 : prog < 75 ? 3 : 4;
      if (pz !== zone) { trTxt = ZONES[pz].name + ' cleared.'; trT = 70; trA = 0; }

      // Timers
      if (comboT > 0) comboT--; else combo = 0;
      if (feedbackT > 0) feedbackT--;
      if (trT > 0) { trT--; if (trT > 45) trA = Math.min(1, trA + .07); else if (trT < 12) trA = Math.max(0, trA - .07); }

      // HP regen (slow)
      if (fr % 120 === 0 && hp < maxHp) hp = Math.min(maxHp, hp + 0.5);

      // Pop new characters
      var popRate = Math.max(20, 55 - zone * 8 - prog * 0.1);
      if (fr % Math.floor(popRate) === 0) popRandom();

      // Extra pop to keep it busy
      var activeCount = 0;
      for (var i = 0; i < holes.length; i++) { if (holes[i].active) activeCount++; }
      if (activeCount < 2 + zone && fr % 15 === 0) popRandom();

      // Update holes
      for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        if (h.cooldown > 0) h.cooldown--;

        if (!h.active) continue;

        if (h.whacked) {
          h.whackT++;
          h.popY = Math.max(0, h.popY - 0.08);
          if (h.popY <= 0) { h.active = false; h.cooldown = 20; }
          continue;
        }

        if (h.popDir === 1) {
          h.popY = Math.min(1, h.popY + 0.06 + zone * 0.01);
          if (h.popY >= 1) { h.popDir = 0; h.stayT = h.stayT; }
        } else if (h.popDir === 0) {
          h.stayT--;
          if (h.stayT <= 0) h.popDir = -1;
        } else {
          h.popY = Math.max(0, h.popY - 0.04);
          if (h.popY <= 0) {
            // Missed an AI — small penalty
            if (h.type === 'ai') {
              hp = Math.max(0, hp - 0.5);
              combo = 0;
            }
            h.active = false;
            h.cooldown = 15;
          }
        }
      }

      // Particles
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        if (p.type !== 'flash') { p.x += p.vx; p.y += p.vy; p.vy += 0.15; }
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
      }

      // Finish
      if (prog >= 100) state = 'FINISHED';
    }

    // ═══ DRAW HELPERS ═══
    function rr(c, x, y, w, h, r) {
      c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
      c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
      c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    }

    function drawAIHead(x, y, s, whacked) {
      var hr = 9 * s;
      // Head
      ctx.fillStyle = CL.ai;
      ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a04520'; ctx.lineWidth = 1.2 * s;
      ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.stroke();
      // Antenna
      ctx.strokeStyle = CL.acc; ctx.lineWidth = 1.2 * s;
      ctx.beginPath(); ctx.moveTo(x, y - hr); ctx.lineTo(x, y - hr - 5 * s); ctx.stroke();
      ctx.fillStyle = CL.acc;
      ctx.beginPath(); ctx.arc(x, y - hr - 5 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
      // Glow
      ctx.save(); ctx.globalAlpha = .18;
      ctx.beginPath(); ctx.arc(x, y - hr - 5 * s, 4.5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Eye
      if (whacked) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * s;
        ctx.beginPath(); ctx.moveTo(x - 3 * s, y - 3 * s); ctx.lineTo(x + 3 * s, y + 3 * s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 3 * s, y - 3 * s); ctx.lineTo(x - 3 * s, y + 3 * s); ctx.stroke();
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(x, y + .5 * s, 4 * s, 4.5 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#40C8E0';
        ctx.beginPath(); ctx.arc(x + .5 * s, y + 1 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0a2a3a';
        ctx.beginPath(); ctx.arc(x + .5 * s, y + 1 * s, 1.2 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        ctx.beginPath(); ctx.arc(x - 1.5 * s, y - 1.5 * s, 1 * s, 0, Math.PI * 2); ctx.fill();
      }
      // Body hint
      ctx.fillStyle = CL.aiB;
      rr(ctx, x - 6 * s, y + hr - 2 * s, 12 * s, 8 * s, 3 * s); ctx.fill();
    }

    function drawHumanHead(x, y, s, skin) {
      var hr = 8 * s;
      ctx.fillStyle = skin.sk;
      ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = skin.hr;
      ctx.beginPath(); ctx.arc(x, y, hr, Math.PI, 2 * Math.PI); ctx.fill();
      // Eye
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(x, y + .5 * s, 3.5 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath(); ctx.arc(x, y + 1 * s, 1.5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.beginPath(); ctx.arc(x - 1 * s, y - 1 * s, .8 * s, 0, Math.PI * 2); ctx.fill();
      // Mouth smile
      ctx.strokeStyle = 'rgba(0,0,0,.1)'; ctx.lineWidth = .5 * s;
      ctx.beginPath(); ctx.arc(x, y + 4 * s, 2 * s, .2, Math.PI - .3); ctx.stroke();
      // Body hint
      ctx.fillStyle = skin.bc;
      rr(ctx, x - 5.5 * s, y + hr - 2 * s, 11 * s, 8 * s, 3 * s); ctx.fill();
    }

    // ═══ DRAW ═══
    function draw() {
      var z = ZONES[zone];
      ctx.fillStyle = z.sky; ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.save(); ctx.globalAlpha = .025; ctx.strokeStyle = z.ac; ctx.lineWidth = .5;
      for (var x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      ctx.restore();

      // Zone watermark
      ctx.save(); ctx.globalAlpha = .025; ctx.font = '800 22px Syne,sans-serif'; ctx.fillStyle = z.ac;
      ctx.fillText(z.name.toUpperCase(), 15, GY - 8); ctx.restore();

      // Ground
      ctx.fillStyle = z.gnd; ctx.fillRect(0, GY, W, H - GY);
      ctx.strokeStyle = z.gl; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, GY); ctx.lineTo(W, GY); ctx.stroke();

      // Desk surfaces at each hole
      for (var i = 0; i < holes.length; i++) {
        var hx = holes[i].x;
        // Desk
        ctx.fillStyle = '#1a1f28';
        rr(ctx, hx - 20, GY - 16, 40, 4, 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.03)'; ctx.lineWidth = .5;
        rr(ctx, hx - 20, GY - 16, 40, 4, 2); ctx.stroke();
        // Legs
        ctx.fillStyle = '#14181f';
        ctx.fillRect(hx - 15, GY - 12, 2, 12);
        ctx.fillRect(hx + 13, GY - 12, 2, 12);
        // Monitor
        ctx.fillStyle = '#1a1f28';
        rr(ctx, hx - 10, GY - 32, 20, 14, 2); ctx.fill();
        ctx.fillStyle = '#0d1218';
        rr(ctx, hx - 8, GY - 30, 16, 10, 1); ctx.fill();
        ctx.fillStyle = z.ac + '08';
        rr(ctx, hx - 8, GY - 30, 16, 10, 1); ctx.fill();
        ctx.fillStyle = '#14181f';
        ctx.fillRect(hx - 2, GY - 18, 4, 3);
      }

      // Characters popping up
      for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        if (!h.active) continue;

        var charY = h.y - 30 * h.popY;
        var s = 1.3;

        // Clip to desk area (character rises from behind desk)
        ctx.save();
        ctx.beginPath();
        ctx.rect(h.x - 22, 0, 44, GY - 14);
        ctx.clip();

        if (h.type === 'ai') {
          drawAIHead(h.x, charY, s, h.whacked);
        } else {
          drawHumanHead(h.x, charY, s, h.skin);
        }

        // Label
        if (!h.whacked && h.popY > 0.5) {
          ctx.fillStyle = h.type === 'ai' ? CL.ai : CL.hum;
          ctx.font = 'bold 7px JetBrains Mono,monospace';
          ctx.textAlign = 'center';
          ctx.fillText(h.type === 'ai' ? 'WHACK!' : 'SAFE', h.x, charY - 16 * s);
          ctx.textAlign = 'left';
        }

        ctx.restore();
      }

      // Particles
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.type === 'flash') {
          ctx.save(); ctx.globalAlpha = p.life / 12 * .15;
          ctx.fillStyle = p.color; ctx.fillRect(0, 0, W, H);
          ctx.restore();
        } else {
          ctx.save(); ctx.globalAlpha = p.life / 25;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      // ═══ HUD ═══
      if (state === 'PLAYING' || state === 'FINISHED') {
        // HP bar
        var hbW = 70, hbH = 7, hbX = 10, hbY = 8;
        ctx.fillStyle = '#21262d'; rr(ctx, hbX, hbY, hbW, hbH, 3.5); ctx.fill();
        var hpP = hp / maxHp, hpC = hpP > .5 ? CL.grn : hpP > .25 ? CL.amb : CL.red;
        ctx.fillStyle = hpC; rr(ctx, hbX, hbY, hbW * hpP, hbH, 3.5); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = .5;
        rr(ctx, hbX, hbY, hbW, hbH, 3.5); ctx.stroke();
        ctx.fillStyle = '#aaa'; ctx.font = 'bold 7px monospace'; ctx.fillText('HP', hbX + hbW + 4, hbY + 6);

        // Score
        ctx.fillStyle = CL.acc; ctx.font = 'bold 11px monospace';
        ctx.fillText('\u2B21 ' + score, 10, hbY + hbH + 14);

        // Combo
        if (combo >= 2 && comboT > 0) {
          ctx.fillStyle = CL.gold; ctx.font = 'bold 10px monospace';
          ctx.fillText('x' + combo, 55, hbY + hbH + 14);
        }

        // Zone
        ctx.textAlign = 'right'; ctx.fillStyle = '#555'; ctx.font = 'bold 8px monospace';
        ctx.fillText(ZONES[zone].name, W - 10, 14); ctx.textAlign = 'left';

        // Progress bar
        var pY = H - 8, pW = W - 20;
        ctx.fillStyle = '#21262d'; rr(ctx, 10, pY, pW, 4, 2); ctx.fill();
        ctx.fillStyle = prog > 90 ? CL.grn : CL.acc + '88';
        rr(ctx, 10, pY, pW * (prog / 100), 4, 2); ctx.fill();
      }

      // Feedback text
      if (feedbackT > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, feedbackT / 10);
        ctx.font = '800 16px Syne,sans-serif';
        ctx.fillStyle = feedbackCol;
        ctx.textAlign = 'center';
        ctx.fillText(feedbackTxt, W / 2, H / 2 - 10 - (35 - feedbackT) * .4);
        ctx.textAlign = 'left';
        ctx.restore();
      }

      // Intro
      if (state === 'INTRO') {
        ctx.fillStyle = 'rgba(15,13,26,0.6)'; ctx.fillRect(0, 0, W, H);
        ctx.font = '800 18px Syne,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText('DISPLACEMENT WHACK', W / 2, H / 2 - 16);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.ai;
        ctx.fillText('Click AI agents \u2014 Don\'t click humans', W / 2, H / 2 + 4);
        if (Math.sin(fr * .06) > 0) {
          ctx.font = 'bold 10px monospace'; ctx.fillStyle = CL.acc;
          ctx.fillText('[ CLICK TO START ]', W / 2, H / 2 + 28);
        }
        ctx.textAlign = 'left';
      }

      // Zone transition
      if (trT > 0 && trTxt) {
        ctx.save(); ctx.globalAlpha = trA * .5;
        ctx.fillStyle = '#000'; ctx.fillRect(0, H / 2 - 12, W, 24);
        ctx.globalAlpha = trA; ctx.font = 'bold 10px Syne,sans-serif'; ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.fillText(trTxt, W / 2, H / 2 + 4);
        ctx.textAlign = 'left'; ctx.restore();
      }

      // Finished
      if (state === 'FINISHED') {
        ctx.fillStyle = 'rgba(15,13,26,0.85)'; ctx.fillRect(0, 0, W, H);
        ctx.font = '800 17px Syne,sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = CL.grn; ctx.fillText('DISPLACEMENT CONTAINED', W / 2, H * .24);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#666';
        ctx.fillText('exit code 0', W / 2, H * .24 + 14);
        ctx.font = 'bold 12px monospace'; ctx.fillStyle = CL.acc;
        ctx.fillText('\u2B21 ' + score + ' agents whacked', W / 2, H * .50);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.gold;
        ctx.fillText('Best combo: x' + bestCombo, W / 2, H * .50 + 16);
        ctx.font = 'bold 8px monospace'; ctx.fillStyle = '#555';
        ctx.fillText('HP remaining: ' + Math.round(hp) + '/' + maxHp, W / 2, H * .50 + 32);
        ctx.font = 'bold 7px monospace'; ctx.fillStyle = '#444';
        ctx.fillText('The displacement was contained. For now.', W / 2, H * .84);
        ctx.textAlign = 'left';
      }

      // Scanlines
      ctx.save(); ctx.globalAlpha = .02;
      for (var y = 0; y < H; y += 3) { ctx.fillStyle = '#000'; ctx.fillRect(0, y, W, 1); }
      ctx.restore();
    }

    // ═══ LOOP ═══
    function loop() {
      if (!running) return;
      update(); draw();
      requestAnimationFrame(loop);
    }
    loop();

    // ═══ API ═══
    return {
      start: function() {
        state = 'INTRO'; fr = 0; score = 0; prog = 0; zone = 0;
        hp = maxHp; combo = 0; comboT = 0; bestCombo = 0;
        introT = 0; trT = 0; feedbackT = 0;
        particles = [];
        initHoles();
      },
      setProgress: function(v) {
        if (state === 'PLAYING') prog = Math.min(100, Math.max(prog, v));
      },
      getState: function() {
        return { state: state, score: score, prog: prog };
      },
      destroy: function() {
        running = false;
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('contextmenu', onContextMenu);
      }
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: OFFICE BREAKOUT
  // Breakout where bricks = AI agents at desks.
  // Paddle = human worker. Ball = complaint form.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'office-breakout',
    name: 'Office Breakout',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var running = true;

    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',
      ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',
      acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};

    var ZONES = [
      {name:'Tech Office',sky:'#0c1015',ac:'#3fb950',gnd:'#0a0e14',gl:'#182028'},
      {name:'Design Studio',sky:'#14100a',ac:'#E8A000',gnd:'#121008',gl:'#221c10'},
      {name:'Newsroom',sky:'#080808',ac:'#E24B4A',gnd:'#0c0c0c',gl:'#1a1a1a'},
      {name:'Film Set',sky:'#150008',ac:'#FFD700',gnd:'#120510',gl:'#221020'},
      {name:'Trading Floor',sky:'#040a04',ac:'#E8A000',gnd:'#060a06',gl:'#142014'},
    ];

    var TITLES = [
      ['DEV','ENG','OPS','QA','DBA'],
      ['UX','UI','ART','BRAND','COPY'],
      ['NEWS','EDIT','PHOTO','ANCHOR','SEO'],
      ['VFX','WRITE','ACT','PROD','DIR'],
      ['TRADE','AUDIT','FUND','MODEL','RISK'],
    ];

    // State
    var state = 'INTRO', fr = 0, score = 0, prog = 0, zone = 0;
    var lives = 3;
    var introT = 0;
    var trT = 0, trTxt = '', trA = 0;

    // Paddle
    var paddleW = 60, paddleH = 10, paddleX = W / 2 - paddleW / 2;
    var paddleY = H - 22;
    var mouseX = W / 2;

    // Ball
    var ballR = 4;
    var ballX, ballY, ballVX, ballVY;
    var ballSpeed = 3.5;
    var ballAttached = true; // stuck to paddle until click

    // Bricks (AI agents)
    var bricks = [];
    var BRICK_ROWS = 3, BRICK_COLS = 12;
    var BRICK_W = 44, BRICK_H = 18, BRICK_PAD = 4;

    var particles = [];
    var comboCount = 0, comboT = 0;
    var powerup = null; // active powerup on field
    var widePaddleT = 0;
    var multiBalls = []; // extra balls from multiball powerup

    function initBricks() {
      bricks = [];
      var totalW = BRICK_COLS * (BRICK_W + BRICK_PAD) - BRICK_PAD;
      var startX = (W - totalW) / 2;
      var titles = TITLES[zone] || TITLES[0];

      for (var r = 0; r < BRICK_ROWS; r++) {
        for (var c = 0; c < BRICK_COLS; c++) {
          bricks.push({
            x: startX + c * (BRICK_W + BRICK_PAD),
            y: 14 + r * (BRICK_H + BRICK_PAD),
            w: BRICK_W, h: BRICK_H,
            alive: true,
            hp: r === 0 ? 2 : 1, // top row takes 2 hits
            maxHp: r === 0 ? 2 : 1,
            title: titles[(c + r) % titles.length],
            hitT: 0,
          });
        }
      }
    }

    function resetBall() {
      ballAttached = true;
      ballX = paddleX + paddleW / 2;
      ballY = paddleY - ballR;
      ballVX = 0;
      ballVY = 0;
      multiBalls = [];
    }

    function launchBall() {
      if (!ballAttached) return;
      ballAttached = false;
      var angle = -Math.PI / 2 + (Math.random() - .5) * 0.6;
      ballVX = Math.cos(angle) * ballSpeed;
      ballVY = Math.sin(angle) * ballSpeed;
    }

    function spawnPowerup(x, y) {
      if (powerup) return;
      if (Math.random() > 0.25) return; // 25% chance
      var types = ['wide', 'multi', 'fast'];
      powerup = {
        x: x, y: y,
        vy: 1.2,
        type: types[Math.floor(Math.random() * types.length)],
        w: 30, h: 12,
      };
    }

    // ═══ INPUT ═══
    function onMouseDown(e) {
      e.preventDefault(); e.stopPropagation();
      if (state === 'INTRO') { state = 'PLAYING'; initBricks(); resetBall(); return; }
      if (state === 'PLAYING' && ballAttached) { launchBall(); }
    }
    function onMouseMove(e) {
      var rect = canvas.getBoundingClientRect();
      mouseX = (e.clientX - rect.left) * (W / rect.width);
    }
    function onContextMenu(e) { e.preventDefault(); e.stopPropagation(); }
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('contextmenu', onContextMenu);

    // ═══ BALL PHYSICS ═══
    function updateBall(bx, by, bvx, bvy, isMain) {
      bx += bvx;
      by += bvy;

      // Wall bounce
      if (bx - ballR <= 0) { bx = ballR; bvx = Math.abs(bvx); }
      if (bx + ballR >= W) { bx = W - ballR; bvx = -Math.abs(bvx); }
      if (by - ballR <= 0) { by = ballR; bvy = Math.abs(bvy); }

      // Paddle bounce
      var pw = widePaddleT > 0 ? paddleW * 1.5 : paddleW;
      if (by + ballR >= paddleY && by + ballR <= paddleY + paddleH + 4 &&
          bx >= paddleX - (pw - paddleW) / 2 && bx <= paddleX + pw + (pw - paddleW) / 2) {
        by = paddleY - ballR;
        // Angle based on where ball hits paddle
        var hitPos = (bx - paddleX) / pw; // 0 to 1
        var angle = -Math.PI * 0.8 + hitPos * Math.PI * 0.6; // -144° to -36°
        var spd = Math.sqrt(bvx * bvx + bvy * bvy);
        bvx = Math.cos(angle) * spd;
        bvy = Math.sin(angle) * spd;
        if (bvy > -1) bvy = -1; // ensure upward
      }

      // Bottom — lose ball
      if (by - ballR > H) {
        if (isMain) {
          lives--;
          comboCount = 0;
          if (lives <= 0) { lives = 0; }
          resetBall();
          return null;
        } else {
          return null; // multi-ball just disappears
        }
      }

      // Brick collision
      for (var i = 0; i < bricks.length; i++) {
        var b = bricks[i];
        if (!b.alive) continue;
        if (bx + ballR > b.x && bx - ballR < b.x + b.w && by + ballR > b.y && by - ballR < b.y + b.h) {
          b.hp--;
          b.hitT = 10;
          if (b.hp <= 0) {
            b.alive = false;
            score++;
            comboCount++;
            comboT = 60;
            // Particles
            for (var p = 0; p < 6; p++) {
              particles.push({
                x: b.x + b.w / 2, y: b.y + b.h / 2,
                vx: (Math.random() - .5) * 4, vy: (Math.random() - .5) * 3,
                life: 20 + Math.random() * 10,
                color: CL.ai, sz: 2 + Math.random() * 2
              });
            }
            spawnPowerup(b.x + b.w / 2, b.y + b.h / 2);
          }
          // Bounce
          var overlapX = Math.min(bx + ballR - b.x, b.x + b.w - (bx - ballR));
          var overlapY = Math.min(by + ballR - b.y, b.y + b.h - (by - ballR));
          if (overlapX < overlapY) bvx = -bvx; else bvy = -bvy;
          break;
        }
      }

      return { x: bx, y: by, vx: bvx, vy: bvy };
    }

    // ═══ UPDATE ═══
    function update() {
      fr++;

      if (state === 'INTRO') { introT++; if (introT > 200) state = 'PLAYING'; initBricks(); resetBall(); return; }
      if (state !== 'PLAYING') return;

      // Zone
      var pz = zone;
      zone = prog < 20 ? 0 : prog < 40 ? 1 : prog < 60 ? 2 : prog < 75 ? 3 : 4;
      if (pz !== zone) {
        trTxt = ZONES[pz].name + ' cleared.'; trT = 70; trA = 0;
        initBricks();
        resetBall();
        ballSpeed = 3.5 + zone * 0.5; // faster each zone
      }

      if (trT > 0) { trT--; if (trT > 45) trA = Math.min(1, trA + .07); else if (trT < 12) trA = Math.max(0, trA - .07); }
      if (comboT > 0) comboT--;
      if (widePaddleT > 0) widePaddleT--;

      // Paddle follows mouse
      var pw = widePaddleT > 0 ? paddleW * 1.5 : paddleW;
      paddleX = mouseX - pw / 2;
      paddleX = Math.max(0, Math.min(W - pw, paddleX));

      // Ball
      if (ballAttached) {
        ballX = paddleX + pw / 2;
        ballY = paddleY - ballR;
      } else {
        var result = updateBall(ballX, ballY, ballVX, ballVY, true);
        if (result) { ballX = result.x; ballY = result.y; ballVX = result.vx; ballVY = result.vy; }
      }

      // Multi-balls
      for (var i = multiBalls.length - 1; i >= 0; i--) {
        var mb = multiBalls[i];
        var r = updateBall(mb.x, mb.y, mb.vx, mb.vy, false);
        if (r) { mb.x = r.x; mb.y = r.y; mb.vx = r.vx; mb.vy = r.vy; }
        else { multiBalls.splice(i, 1); }
      }

      // Powerup
      if (powerup) {
        powerup.y += powerup.vy;
        if (powerup.y + powerup.h >= paddleY && powerup.y <= paddleY + paddleH &&
            powerup.x + powerup.w / 2 >= paddleX && powerup.x - powerup.w / 2 <= paddleX + pw) {
          // Collected!
          if (powerup.type === 'wide') widePaddleT = 400;
          else if (powerup.type === 'multi') {
            for (var m = 0; m < 2; m++) {
              multiBalls.push({
                x: ballX, y: ballY,
                vx: ballVX + (Math.random() - .5) * 2,
                vy: ballVY + (Math.random() - .5) * 1,
              });
            }
          } else if (powerup.type === 'fast') {
            ballSpeed = Math.min(7, ballSpeed + 1);
            var spd = Math.sqrt(ballVX * ballVX + ballVY * ballVY);
            if (spd > 0) { ballVX = ballVX / spd * ballSpeed; ballVY = ballVY / spd * ballSpeed; }
          }
          particles.push({ x: powerup.x, y: powerup.y, vx: 0, vy: 0, life: 20, color: CL.grn, sz: 15, type: 'ring' });
          powerup = null;
        } else if (powerup.y > H + 10) {
          powerup = null;
        }
      }

      // Particles
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        if (p.type !== 'ring') { p.x += p.vx; p.y += p.vy; p.vy += 0.1; }
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
      }

      // Check if all bricks cleared — refill
      var aliveCount = 0;
      for (var i = 0; i < bricks.length; i++) { if (bricks[i].alive) aliveCount++; }
      if (aliveCount === 0) {
        initBricks();
        ballSpeed += 0.3;
      }

      // Finish
      if (prog >= 100) state = 'FINISHED';
    }

    // ═══ DRAW HELPERS ═══
    function rr(c, x, y, w, h, r) {
      c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
      c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
      c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    }

    // ═══ DRAW ═══
    function draw() {
      var z = ZONES[zone];
      ctx.fillStyle = z.sky; ctx.fillRect(0, 0, W, H);

      // Subtle grid
      ctx.save(); ctx.globalAlpha = .02; ctx.strokeStyle = z.ac; ctx.lineWidth = .5;
      for (var x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (var y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();

      // Zone watermark
      ctx.save(); ctx.globalAlpha = .02; ctx.font = '800 20px Syne,sans-serif'; ctx.fillStyle = z.ac;
      ctx.fillText(z.name.toUpperCase(), 15, H - 10); ctx.restore();

      // ── Bricks (AI agents at desks) ──
      for (var i = 0; i < bricks.length; i++) {
        var b = bricks[i];
        if (!b.alive) continue;

        var shake = b.hitT > 0 ? (Math.random() - .5) * 3 : 0;
        if (b.hitT > 0) b.hitT--;

        // Desk surface
        ctx.fillStyle = '#1a1f28';
        ctx.fillRect(b.x + shake, b.y + b.h - 3, b.w, 3);

        // Agent head in brick
        var cx = b.x + b.w / 2 + shake;
        var cy = b.y + b.h / 2 - 1;
        var hr = 6;

        // Background
        ctx.fillStyle = b.hp < b.maxHp ? CL.ai + '66' : CL.ai + '33';
        rr(ctx, b.x + shake, b.y, b.w, b.h, 3); ctx.fill();
        ctx.strokeStyle = b.hp < b.maxHp ? CL.amb : CL.ai + '88';
        ctx.lineWidth = b.hp < b.maxHp ? 1.2 : .7;
        rr(ctx, b.x + shake, b.y, b.w, b.h, 3); ctx.stroke();

        // Mini agent face
        ctx.fillStyle = CL.ai;
        ctx.beginPath(); ctx.arc(cx - 8, cy, hr, 0, Math.PI * 2); ctx.fill();
        // Eye
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(cx - 8, cy + .5, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#40C8E0';
        ctx.beginPath(); ctx.arc(cx - 7.5, cy + 1, 1.5, 0, Math.PI * 2); ctx.fill();
        // Antenna
        ctx.strokeStyle = CL.acc; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - 8, cy - hr); ctx.lineTo(cx - 8, cy - hr - 3); ctx.stroke();
        ctx.fillStyle = CL.acc;
        ctx.beginPath(); ctx.arc(cx - 8, cy - hr - 3, 1.5, 0, Math.PI * 2); ctx.fill();

        // Title text
        ctx.fillStyle = '#ccc'; ctx.font = 'bold 7px monospace';
        ctx.fillText(b.title, cx, cy + 3);

        // HP indicator for tough bricks
        if (b.maxHp > 1 && b.hp > 1) {
          ctx.fillStyle = CL.amb; ctx.font = 'bold 6px monospace';
          ctx.textAlign = 'right'; ctx.fillText('x' + b.hp, b.x + b.w - 3, b.y + 9); ctx.textAlign = 'left';
        }
      }

      // ── Powerup ──
      if (powerup) {
        var pCol = powerup.type === 'wide' ? CL.cyan : powerup.type === 'multi' ? CL.grn : CL.amb;
        var pLabel = powerup.type === 'wide' ? 'WIDE' : powerup.type === 'multi' ? 'MULTI' : 'FAST';
        ctx.fillStyle = pCol + '33';
        rr(ctx, powerup.x - powerup.w / 2, powerup.y, powerup.w, powerup.h, 3); ctx.fill();
        ctx.strokeStyle = pCol; ctx.lineWidth = 1;
        rr(ctx, powerup.x - powerup.w / 2, powerup.y, powerup.w, powerup.h, 3); ctx.stroke();
        ctx.fillStyle = pCol; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center';
        ctx.fillText(pLabel, powerup.x, powerup.y + 9); ctx.textAlign = 'left';
      }

      // ── Paddle (human worker) ──
      var pw = widePaddleT > 0 ? paddleW * 1.5 : paddleW;
      var px = paddleX;

      // Paddle glow
      ctx.save(); ctx.globalAlpha = .06;
      var pg = ctx.createRadialGradient(px + pw / 2, paddleY, 5, px + pw / 2, paddleY, pw);
      pg.addColorStop(0, CL.hum); pg.addColorStop(1, 'transparent');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px + pw / 2, paddleY, pw, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Paddle body
      ctx.fillStyle = CL.hum;
      rr(ctx, px, paddleY, pw, paddleH, 4); ctx.fill();
      ctx.strokeStyle = CL.humB; ctx.lineWidth = 1;
      rr(ctx, px, paddleY, pw, paddleH, 4); ctx.stroke();

      // Human face on paddle
      var pcx = px + pw / 2;
      ctx.fillStyle = '#F4C7A3';
      ctx.beginPath(); ctx.arc(pcx, paddleY + 1, 5, Math.PI, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#3A2A1A';
      ctx.beginPath(); ctx.arc(pcx, paddleY + 1, 5, Math.PI, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#F4C7A3';
      ctx.beginPath(); ctx.arc(pcx, paddleY + 3, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(pcx, paddleY + 2, 1.5, 0, Math.PI * 2); ctx.fill();

      // Wide paddle indicator
      if (widePaddleT > 0) {
        ctx.fillStyle = CL.cyan; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
        ctx.fillText('WIDE', pcx, paddleY - 4); ctx.textAlign = 'left';
      }

      // ── Ball (complaint form) ──
      // Main ball
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ballX, ballY, ballR, 0, Math.PI * 2); ctx.fill();
      // Trail
      ctx.save(); ctx.globalAlpha = .15;
      ctx.beginPath(); ctx.arc(ballX - ballVX * .5, ballY - ballVY * .5, ballR * .8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = .05;
      ctx.beginPath(); ctx.arc(ballX - ballVX, ballY - ballVY, ballR * .6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Multi-balls
      for (var i = 0; i < multiBalls.length; i++) {
        var mb = multiBalls[i];
        ctx.fillStyle = CL.grn;
        ctx.beginPath(); ctx.arc(mb.x, mb.y, ballR * .8, 0, Math.PI * 2); ctx.fill();
      }

      // ── Particles ──
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.type === 'ring') {
          ctx.save(); ctx.globalAlpha = p.life / 20 * .4; ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * (1 - p.life / 20), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        } else {
          ctx.save(); ctx.globalAlpha = p.life / 25;
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      }

      // ═══ HUD ═══
      if (state === 'PLAYING' || state === 'FINISHED') {
        // Score
        ctx.fillStyle = CL.acc; ctx.font = 'bold 11px monospace'; ctx.fillText('\u2B21 ' + score, 10, H - 6);

        // Combo
        if (comboCount >= 3 && comboT > 0) {
          ctx.fillStyle = CL.gold; ctx.font = 'bold 9px monospace'; ctx.fillText('x' + comboCount, 55, H - 6);
        }

        // Lives
        for (var i = 0; i < 3; i++) {
          ctx.fillStyle = i < lives ? CL.hum : '#21262d';
          ctx.beginPath(); ctx.arc(W - 40 + i * 14, H - 8, 4, 0, Math.PI * 2); ctx.fill();
        }

        // Zone
        ctx.textAlign = 'right'; ctx.fillStyle = '#444'; ctx.font = 'bold 7px monospace';
        ctx.fillText(ZONES[zone].name, W - 60, H - 6); ctx.textAlign = 'left';

        // Progress (thin line at very bottom)
        ctx.fillStyle = '#21262d'; ctx.fillRect(0, H - 2, W, 2);
        ctx.fillStyle = prog > 90 ? CL.grn : CL.acc + '88'; ctx.fillRect(0, H - 2, W * (prog / 100), 2);
      }

      // ── INTRO ──
      if (state === 'INTRO') {
        ctx.fillStyle = 'rgba(15,13,26,0.6)'; ctx.fillRect(0, 0, W, H);
        ctx.font = '800 18px Syne,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText('OFFICE BREAKOUT', W / 2, H / 2 - 16);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.hum;
        ctx.fillText('Move mouse to control paddle \u2014 Click to launch', W / 2, H / 2 + 4);
        if (Math.sin(fr * .06) > 0) {
          ctx.font = 'bold 10px monospace'; ctx.fillStyle = CL.acc;
          ctx.fillText('[ CLICK TO START ]', W / 2, H / 2 + 28);
        }
        ctx.textAlign = 'left';
      }

      // Zone transition
      if (trT > 0 && trTxt) {
        ctx.save(); ctx.globalAlpha = trA * .5;
        ctx.fillStyle = '#000'; ctx.fillRect(0, H / 2 - 12, W, 24);
        ctx.globalAlpha = trA; ctx.font = 'bold 10px Syne,sans-serif'; ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.fillText(trTxt, W / 2, H / 2 + 4);
        ctx.textAlign = 'left'; ctx.restore();
      }

      // Attached ball hint
      if (state === 'PLAYING' && ballAttached) {
        ctx.save(); ctx.globalAlpha = .5 + Math.sin(fr * .08) * .3;
        ctx.font = 'bold 8px monospace'; ctx.fillStyle = '#888'; ctx.textAlign = 'center';
        ctx.fillText('CLICK TO LAUNCH', W / 2, H / 2 + 10);
        ctx.textAlign = 'left'; ctx.restore();
      }

      // ── FINISHED ──
      if (state === 'FINISHED') {
        ctx.fillStyle = 'rgba(15,13,26,0.85)'; ctx.fillRect(0, 0, W, H);
        ctx.font = '800 17px Syne,sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = CL.hum; ctx.fillText('AGENTS CLEARED', W / 2, H * .24);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#666';
        ctx.fillText('exit code 0', W / 2, H * .24 + 14);
        ctx.font = 'bold 12px monospace'; ctx.fillStyle = CL.acc;
        ctx.fillText('\u2B21 ' + score + ' agents displaced', W / 2, H * .50);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#555';
        ctx.fillText('Lives remaining: ' + lives + '/3', W / 2, H * .50 + 16);
        ctx.font = 'bold 7px monospace'; ctx.fillStyle = '#444';
        ctx.fillText('The office is yours. For now.', W / 2, H * .84);
        ctx.textAlign = 'left';
      }

      // Scanlines
      ctx.save(); ctx.globalAlpha = .02;
      for (var y = 0; y < H; y += 3) { ctx.fillStyle = '#000'; ctx.fillRect(0, y, W, 1); }
      ctx.restore();
    }

    // ═══ LOOP ═══
    function loop() {
      if (!running) return;
      update(); draw();
      requestAnimationFrame(loop);
    }
    loop();

    // ═══ API ═══
    return {
      start: function() {
        state = 'INTRO'; fr = 0; score = 0; prog = 0; zone = 0;
        lives = 3; introT = 0; trT = 0;
        comboCount = 0; comboT = 0; widePaddleT = 0;
        ballSpeed = 3.5; powerup = null; multiBalls = [];
        particles = [];
        initBricks(); resetBall();
      },
      setProgress: function(v) {
        if (state === 'PLAYING') prog = Math.min(100, Math.max(prog, v));
      },
      getState: function() {
        return { state: state, score: score, prog: prog };
      },
      destroy: function() {
        running = false;
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('contextmenu', onContextMenu);
      }
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: RESUME RAID
  // Space invaders — AI agents descend, you shoot resumes up.
  // Mouse to move, click/hold to fire.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'resume-raid',
    name: 'Resume Raid',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var running = true;

    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',
      ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',
      acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};

    var ZONES = [
      {name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},
      {name:'Design Studio',sky:'#14100a',ac:'#E8A000'},
      {name:'Newsroom',sky:'#080808',ac:'#E24B4A'},
      {name:'Film Set',sky:'#150008',ac:'#FFD700'},
      {name:'Trading Floor',sky:'#040a04',ac:'#E8A000'},
    ];

    var TITLES = [
      ['DEV','ENG','OPS','QA','ML'],
      ['UX','UI','ART','BRAND','COPY'],
      ['NEWS','EDIT','PHOTO','ANCHOR','SEO'],
      ['VFX','WRITE','ACT','PROD','DIR'],
      ['TRADE','AUDIT','FUND','MODEL','RISK'],
    ];

    // State
    var state = 'INTRO', fr = 0, score = 0, prog = 0, zone = 0;
    var lives = 3, introT = 0;
    var trT = 0, trTxt = '', trA = 0;
    var waveNum = 0;
    var mouseDown = false;

    // Player
    var playerX = W / 2, playerW = 20, playerH = 18;
    var playerY = H - 24;
    var fireCooldown = 0, fireRate = 12; // frames between shots

    // Bullets (resumes going up)
    var bullets = [];
    // Enemy bullets (code snippets coming down)
    var eBullets = [];
    // Enemies (AI agents in formation)
    var enemies = [];
    var enemyDir = 1; // 1 = right, -1 = left
    var enemySpeed = 0.4;
    var enemyDropT = 0; // frames since last drop
    var enemyShootRate = 80;

    var particles = [];
    var powerups = [];
    var shieldT = 0; // shield frames remaining
    var rapidT = 0; // rapid fire frames
    var spreadT = 0; // spread shot frames

    function spawnWave() {
      enemies = [];
      waveNum++;
      var rows = Math.min(3, 1 + Math.floor(waveNum / 2));
      var cols = Math.min(14, 8 + waveNum);
      var titles = TITLES[zone] || TITLES[0];
      var spacing = Math.min(44, (W - 40) / cols);

      var totalW = cols * spacing;
      var startX = (W - totalW) / 2 + spacing / 2;

      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          enemies.push({
            x: startX + c * spacing,
            y: 14 + r * 22,
            w: 16, h: 16,
            alive: true,
            hp: r === 0 ? 2 : 1,
            title: titles[(c + r) % titles.length],
            phase: (c + r) * 0.3,
            hitT: 0,
          });
        }
      }
      enemyDir = 1;
      enemySpeed = 0.3 + zone * 0.12 + waveNum * 0.05;
      enemyShootRate = Math.max(25, 80 - zone * 10 - waveNum * 3);
    }

    function spawnPowerup(x, y) {
      if (Math.random() > 0.2) return;
      var types = ['shield', 'rapid', 'spread', 'life'];
      powerups.push({
        x: x, y: y, vy: 1,
        type: types[Math.floor(Math.random() * types.length)],
      });
    }

    // ═══ INPUT ═══
    function onMouseDown(e) {
      e.preventDefault(); e.stopPropagation();
      if (state === 'INTRO') { state = 'PLAYING'; spawnWave(); return; }
      mouseDown = true;
    }
    function onMouseUp(e) { mouseDown = false; }
    function onMouseMove(e) {
      var rect = canvas.getBoundingClientRect();
      playerX = (e.clientX - rect.left) * (W / rect.width);
      playerX = Math.max(playerW / 2, Math.min(W - playerW / 2, playerX));
    }
    function onContextMenu(e) { e.preventDefault(); e.stopPropagation(); }

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('contextmenu', onContextMenu);

    // ═══ UPDATE ═══
    function update() {
      fr++;

      if (state === 'INTRO') { introT++; if (introT > 180) { state = 'PLAYING'; spawnWave(); } return; }
      if (state !== 'PLAYING') return;

      // Zone
      var pz = zone;
      zone = prog < 20 ? 0 : prog < 40 ? 1 : prog < 60 ? 2 : prog < 75 ? 3 : 4;
      if (pz !== zone) { trTxt = ZONES[pz].name + ' defended.'; trT = 70; trA = 0; spawnWave(); }

      if (trT > 0) { trT--; if (trT > 45) trA = Math.min(1, trA + .07); else if (trT < 12) trA = Math.max(0, trA - .07); }
      if (shieldT > 0) shieldT--;
      if (rapidT > 0) rapidT--;
      if (spreadT > 0) spreadT--;

      // Firing
      if (fireCooldown > 0) fireCooldown--;
      var rate = rapidT > 0 ? 5 : fireRate;
      if (mouseDown && fireCooldown <= 0 && state === 'PLAYING') {
        fireCooldown = rate;
        if (spreadT > 0) {
          bullets.push({ x: playerX, y: playerY - 8, vx: -1.5, vy: -5 });
          bullets.push({ x: playerX, y: playerY - 8, vx: 0, vy: -5.5 });
          bullets.push({ x: playerX, y: playerY - 8, vx: 1.5, vy: -5 });
        } else {
          bullets.push({ x: playerX, y: playerY - 8, vx: 0, vy: -5.5 });
        }
      }

      // Update bullets
      for (var i = bullets.length - 1; i >= 0; i--) {
        var b = bullets[i];
        b.x += b.vx; b.y += b.vy;
        if (b.y < -10 || b.x < -10 || b.x > W + 10) { bullets.splice(i, 1); continue; }

        // Hit enemy
        var hit = false;
        for (var j = 0; j < enemies.length; j++) {
          var e = enemies[j];
          if (!e.alive) continue;
          if (Math.abs(b.x - e.x) < e.w / 2 + 3 && Math.abs(b.y - e.y) < e.h / 2 + 3) {
            e.hp--;
            e.hitT = 8;
            if (e.hp <= 0) {
              e.alive = false;
              score++;
              for (var p = 0; p < 5; p++) {
                particles.push({
                  x: e.x, y: e.y,
                  vx: (Math.random() - .5) * 4, vy: (Math.random() - .5) * 3,
                  life: 18 + Math.random() * 8, color: CL.ai, sz: 2 + Math.random() * 2
                });
              }
              spawnPowerup(e.x, e.y);
            }
            hit = true; break;
          }
        }
        if (hit) { bullets.splice(i, 1); }
      }

      // Enemy movement
      var edgeHit = false;
      for (var i = 0; i < enemies.length; i++) {
        var e = enemies[i];
        if (!e.alive) continue;
        e.x += enemySpeed * enemyDir;
        e.phase += 0.03;
        if (e.hitT > 0) e.hitT--;
        if (e.x < 20 || e.x > W - 20) edgeHit = true;
      }
      if (edgeHit) {
        enemyDir *= -1;
        for (var i = 0; i < enemies.length; i++) {
          if (enemies[i].alive) enemies[i].y += 4 + zone; // drop down
        }
      }

      // Enemy shooting
      if (fr % enemyShootRate === 0) {
        var shooters = enemies.filter(function(e) { return e.alive; });
        if (shooters.length > 0) {
          var shooter = shooters[Math.floor(Math.random() * shooters.length)];
          eBullets.push({
            x: shooter.x, y: shooter.y + 8,
            vx: (Math.random() - .5) * 0.5,
            vy: 2 + zone * 0.3 + Math.random(),
          });
        }
      }

      // Update enemy bullets
      for (var i = eBullets.length - 1; i >= 0; i--) {
        var b = eBullets[i];
        b.x += b.vx; b.y += b.vy;
        if (b.y > H + 10) { eBullets.splice(i, 1); continue; }

        // Hit player
        if (Math.abs(b.x - playerX) < playerW / 2 + 2 && Math.abs(b.y - playerY) < playerH / 2 + 2) {
          eBullets.splice(i, 1);
          if (shieldT > 0) {
            // Shield absorbs
            particles.push({ x: playerX, y: playerY, vx: 0, vy: 0, life: 15, color: CL.cyan, sz: 20, type: 'ring' });
          } else {
            lives--;
            particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 10, color: CL.red, sz: 0, type: 'flash' });
            if (lives <= 0) lives = 0;
          }
        }
      }

      // Enemy reaches player level — game over for that wave
      for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].alive && enemies[i].y > playerY - 10) {
          lives--;
          particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 10, color: CL.red, sz: 0, type: 'flash' });
          if (lives <= 0) lives = 0;
          spawnWave();
          break;
        }
      }

      // Powerups
      for (var i = powerups.length - 1; i >= 0; i--) {
        var p = powerups[i];
        p.y += p.vy;
        if (p.y > H + 10) { powerups.splice(i, 1); continue; }
        if (Math.abs(p.x - playerX) < 18 && Math.abs(p.y - playerY) < 14) {
          if (p.type === 'shield') shieldT = 360;
          else if (p.type === 'rapid') rapidT = 300;
          else if (p.type === 'spread') spreadT = 300;
          else if (p.type === 'life') lives = Math.min(5, lives + 1);
          particles.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 20, color: CL.grn, sz: 15, type: 'ring' });
          powerups.splice(i, 1);
        }
      }

      // All enemies dead — next wave
      var aliveCount = 0;
      for (var i = 0; i < enemies.length; i++) { if (enemies[i].alive) aliveCount++; }
      if (aliveCount === 0) spawnWave();

      // Particles
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        if (p.type !== 'flash' && p.type !== 'ring') { p.x += p.vx; p.y += p.vy; p.vy += 0.08; }
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
      }

      if (prog >= 100) state = 'FINISHED';
    }

    // ═══ DRAW HELPERS ═══
    function rr(c, x, y, w, h, r) {
      c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
      c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
      c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    }

    function drawEnemy(e) {
      var shake = e.hitT > 0 ? (Math.random() - .5) * 2 : 0;
      var ex = e.x + shake, ey = e.y;
      var bob = Math.sin(e.phase) * 1.5;
      ey += bob;

      // Body
      ctx.fillStyle = e.hp > 1 ? CL.ai : CL.aiB;
      ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a04520'; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.arc(ex, ey, 7, 0, Math.PI * 2); ctx.stroke();

      // Antenna
      ctx.strokeStyle = CL.acc; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ex, ey - 7); ctx.lineTo(ex, ey - 11); ctx.stroke();
      ctx.fillStyle = CL.acc;
      ctx.beginPath(); ctx.arc(ex, ey - 11, 1.5, 0, Math.PI * 2); ctx.fill();
      // Glow
      ctx.save(); ctx.globalAlpha = .15;
      ctx.beginPath(); ctx.arc(ex, ey - 11, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Eye
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(ex, ey + .5, 3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#40C8E0';
      ctx.beginPath(); ctx.arc(ex + .5, ey + 1, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a2a3a';
      ctx.beginPath(); ctx.arc(ex + .5, ey + 1, 1, 0, Math.PI * 2); ctx.fill();

      // HP indicator
      if (e.hp > 1) {
        ctx.fillStyle = CL.amb; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
        ctx.fillText('x' + e.hp, ex, ey + 13); ctx.textAlign = 'left';
      }
    }

    // ═══ DRAW ═══
    function draw() {
      var z = ZONES[zone];
      ctx.fillStyle = z.sky; ctx.fillRect(0, 0, W, H);

      // Stars
      ctx.save(); ctx.globalAlpha = .03; ctx.strokeStyle = z.ac; ctx.lineWidth = .5;
      for (var x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      ctx.restore();

      // Zone watermark
      ctx.save(); ctx.globalAlpha = .02; ctx.font = '800 20px Syne,sans-serif'; ctx.fillStyle = z.ac;
      ctx.fillText(z.name.toUpperCase(), 15, H - 6); ctx.restore();

      // Ground line
      ctx.strokeStyle = '#182028'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H - 10); ctx.lineTo(W, H - 10); ctx.stroke();

      // ── Enemies ──
      for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].alive) drawEnemy(enemies[i]);
      }

      // ── Enemy bullets (code snippets) ──
      for (var i = 0; i < eBullets.length; i++) {
        var b = eBullets[i];
        ctx.fillStyle = CL.red;
        ctx.fillRect(b.x - 2, b.y - 4, 4, 8);
        ctx.fillStyle = CL.red + '44';
        ctx.fillRect(b.x - 1, b.y + 4, 2, 4); // trail
      }

      // ── Player bullets (resumes) ──
      for (var i = 0; i < bullets.length; i++) {
        var b = bullets[i];
        // Resume shape: small white rect with lines
        ctx.fillStyle = '#fff';
        ctx.fillRect(b.x - 2.5, b.y - 5, 5, 8);
        ctx.fillStyle = '#aaa';
        ctx.fillRect(b.x - 1.5, b.y - 3, 3, 1);
        ctx.fillRect(b.x - 1.5, b.y - 1, 3, 1);
        ctx.fillRect(b.x - 1.5, b.y + 1, 2, 1);
        // Trail
        ctx.save(); ctx.globalAlpha = .15;
        ctx.fillStyle = CL.hum;
        ctx.fillRect(b.x - 1.5, b.y + 3, 3, 6);
        ctx.restore();
      }

      // ── Powerups ──
      for (var i = 0; i < powerups.length; i++) {
        var p = powerups[i];
        var pCol, pLabel;
        if (p.type === 'shield') { pCol = CL.cyan; pLabel = '\u25CB'; }
        else if (p.type === 'rapid') { pCol = CL.amb; pLabel = '\u26A1'; }
        else if (p.type === 'spread') { pCol = CL.acc; pLabel = '\u2234'; }
        else { pCol = CL.grn; pLabel = '+'; }

        ctx.fillStyle = pCol + '33';
        ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = pCol; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = pCol; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(pLabel, p.x, p.y + 4); ctx.textAlign = 'left';
      }

      // ── Player (human worker) ──
      var px = playerX, py = playerY;

      // Shield ring
      if (shieldT > 0) {
        ctx.save();
        ctx.globalAlpha = .15 + Math.sin(fr * .1) * .05;
        ctx.strokeStyle = CL.cyan; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }

      // Body
      ctx.fillStyle = CL.hum;
      rr(ctx, px - playerW / 2, py - 4, playerW, 12, 3); ctx.fill();
      ctx.strokeStyle = CL.humB; ctx.lineWidth = .8;
      rr(ctx, px - playerW / 2, py - 4, playerW, 12, 3); ctx.stroke();

      // Head
      ctx.fillStyle = '#F4C7A3';
      ctx.beginPath(); ctx.arc(px, py - 8, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3A2A1A';
      ctx.beginPath(); ctx.arc(px, py - 8, 6, Math.PI, 2 * Math.PI); ctx.fill();
      // Eye
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(px, py - 7.5, 2.5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath(); ctx.arc(px, py - 7, 1.2, 0, Math.PI * 2); ctx.fill();

      // Active powerup indicators
      var indY = py + 12;
      if (rapidT > 0) { ctx.fillStyle = CL.amb; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center'; ctx.fillText('\u26A1', px - 8, indY); ctx.textAlign = 'left'; }
      if (spreadT > 0) { ctx.fillStyle = CL.acc; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center'; ctx.fillText('\u2234', px + 8, indY); ctx.textAlign = 'left'; }

      // ── Particles ──
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.type === 'flash') {
          ctx.save(); ctx.globalAlpha = p.life / 10 * .15;
          ctx.fillStyle = p.color; ctx.fillRect(0, 0, W, H); ctx.restore();
        } else if (p.type === 'ring') {
          ctx.save(); ctx.globalAlpha = p.life / 20 * .4; ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * (1 - p.life / 20), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        } else {
          ctx.save(); ctx.globalAlpha = p.life / 22;
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      }

      // ═══ HUD ═══
      if (state === 'PLAYING' || state === 'FINISHED') {
        // Score
        ctx.fillStyle = CL.acc; ctx.font = 'bold 10px monospace'; ctx.fillText('\u2B21 ' + score, 8, 12);

        // Wave
        ctx.fillStyle = '#555'; ctx.font = 'bold 7px monospace'; ctx.fillText('WAVE ' + waveNum, 8, 22);

        // Lives
        for (var i = 0; i < Math.min(lives, 5); i++) {
          ctx.fillStyle = CL.hum;
          ctx.beginPath(); ctx.arc(W - 50 + i * 11, 10, 4, 0, Math.PI * 2); ctx.fill();
        }

        // Zone
        ctx.textAlign = 'right'; ctx.fillStyle = '#444'; ctx.font = 'bold 7px monospace';
        ctx.fillText(ZONES[zone].name, W - 60, 12); ctx.textAlign = 'left';

        // Progress (bottom thin line)
        ctx.fillStyle = '#21262d'; ctx.fillRect(0, H - 3, W, 3);
        ctx.fillStyle = prog > 90 ? CL.grn : CL.acc + '88';
        ctx.fillRect(0, H - 3, W * (prog / 100), 3);
      }

      // ── INTRO ──
      if (state === 'INTRO') {
        ctx.fillStyle = 'rgba(15,13,26,0.6)'; ctx.fillRect(0, 0, W, H);
        ctx.font = '800 18px Syne,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText('RESUME RAID', W / 2, H / 2 - 16);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.hum;
        ctx.fillText('Move mouse \u2014 Click to fire resumes \u2014 Push back the AI', W / 2, H / 2 + 4);
        if (Math.sin(fr * .06) > 0) {
          ctx.font = 'bold 10px monospace'; ctx.fillStyle = CL.acc;
          ctx.fillText('[ CLICK TO START ]', W / 2, H / 2 + 28);
        }
        ctx.textAlign = 'left';
      }

      // Zone transition
      if (trT > 0 && trTxt) {
        ctx.save(); ctx.globalAlpha = trA * .5;
        ctx.fillStyle = '#000'; ctx.fillRect(0, H / 2 - 12, W, 24);
        ctx.globalAlpha = trA; ctx.font = 'bold 10px Syne,sans-serif'; ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.fillText(trTxt, W / 2, H / 2 + 4);
        ctx.textAlign = 'left'; ctx.restore();
      }

      // ── FINISHED ──
      if (state === 'FINISHED') {
        ctx.fillStyle = 'rgba(15,13,26,0.85)'; ctx.fillRect(0, 0, W, H);
        ctx.font = '800 17px Syne,sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = CL.hum; ctx.fillText('OFFICE DEFENDED', W / 2, H * .24);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#666';
        ctx.fillText('exit code 0', W / 2, H * .24 + 14);
        ctx.font = 'bold 12px monospace'; ctx.fillStyle = CL.acc;
        ctx.fillText('\u2B21 ' + score + ' agents shot down', W / 2, H * .50);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.amb;
        ctx.fillText('Waves survived: ' + waveNum, W / 2, H * .50 + 16);
        ctx.font = 'bold 8px monospace'; ctx.fillStyle = '#555';
        ctx.fillText('Lives remaining: ' + lives, W / 2, H * .50 + 30);
        ctx.font = 'bold 7px monospace'; ctx.fillStyle = '#444';
        ctx.fillText('Your resume was... effective.', W / 2, H * .84);
        ctx.textAlign = 'left';
      }

      // Scanlines
      ctx.save(); ctx.globalAlpha = .02;
      for (var y = 0; y < H; y += 3) { ctx.fillStyle = '#000'; ctx.fillRect(0, y, W, 1); }
      ctx.restore();
    }

    // ═══ LOOP ═══
    function loop() {
      if (!running) return;
      update(); draw();
      requestAnimationFrame(loop);
    }
    loop();

    // ═══ API ═══
    return {
      start: function() {
        state = 'INTRO'; fr = 0; score = 0; prog = 0; zone = 0;
        lives = 3; introT = 0; trT = 0; waveNum = 0;
        fireCooldown = 0; shieldT = 0; rapidT = 0; spreadT = 0;
        bullets = []; eBullets = []; enemies = [];
        particles = []; powerups = []; mouseDown = false;
        playerX = W / 2;
      },
      setProgress: function(v) {
        if (state === 'PLAYING') prog = Math.min(100, Math.max(prog, v));
      },
      getState: function() {
        return { state: state, score: score, prog: prog };
      },
      destroy: function() {
        running = false;
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mouseup', onMouseUp);
        canvas.removeEventListener('mouseleave', onMouseUp);
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('contextmenu', onContextMenu);
      }
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: COFFEE RUSH
  // Humans at desks get drowsy. Click to deliver coffee.
  // If energy hits zero, AI takes their desk. Keep humans awake.
  // 100% original concept — no existing game clone.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'coffee-rush',
    name: 'Coffee Rush',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var running = true;

    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',
      ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',
      acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',
      cyan:'#50C8FF',coffee:'#8B5E3C',espresso:'#5C3A1E'};

    var HSKINS = [
      {bc:'#3570B0',sk:'#F4C7A3',hr:'#3A2A1A'},
      {bc:'#C04878',sk:'#F0D5C0',hr:'#8B3A1A'},
      {bc:'#3A9080',sk:'#C8A882',hr:'#1A3A2A'},
      {bc:'#A83030',sk:'#F0D0B0',hr:'#5A2A1A'},
      {bc:'#8A5090',sk:'#F0C8B0',hr:'#5A2A3A'},
      {bc:'#4A7030',sk:'#E8C8A0',hr:'#2A1A0A'},
      {bc:'#3060A0',sk:'#F0D0A8',hr:'#4A2A1A'},
      {bc:'#A05040',sk:'#E8D0B8',hr:'#1A2A2A'},
    ];

    var ZONES = [
      {name:'Tech Office',sky:'#0c1015',ac:'#3fb950',gnd:'#0a0e14',gl:'#182028'},
      {name:'Design Studio',sky:'#14100a',ac:'#E8A000',gnd:'#121008',gl:'#221c10'},
      {name:'Newsroom',sky:'#080808',ac:'#E24B4A',gnd:'#0c0c0c',gl:'#1a1a1a'},
      {name:'Film Set',sky:'#150008',ac:'#FFD700',gnd:'#120510',gl:'#221020'},
      {name:'Trading Floor',sky:'#040a04',ac:'#E8A000',gnd:'#060a06',gl:'#142014'},
    ];

    var GY = H - 18;

    // State
    var state = 'INTRO', fr = 0, score = 0, prog = 0, zone = 0;
    var introT = 0;
    var trT = 0, trTxt = '', trA = 0;
    var humansLost = 0;
    var coffeeDelivered = 0;
    var feedbacks = []; // floating text

    // Desks with workers
    var DESK_COUNT = 8;
    var desks = [];

    function initDesks() {
      desks = [];
      for (var i = 0; i < DESK_COUNT; i++) {
        desks.push({
          x: 28 + i * ((W - 56) / (DESK_COUNT - 1)),
          y: GY,
          skin: HSKINS[i % HSKINS.length],
          energy: 80 + Math.random() * 20, // 0-100
          maxEnergy: 100,
          drainRate: 0.08 + Math.random() * 0.04 + zone * 0.015, // per frame
          isHuman: true,
          replaced: false,     // AI took over
          replaceAnim: 0,      // 0-1 animation
          coffeeAnim: 0,       // coffee delivery animation
          zzzPhase: Math.random() * 6,
          // Unique traits per zone
          critical: false,     // flashing when low
        });
      }
    }

    // Powerups floating across
    var powerups = [];
    var espressoT = 0; // global espresso effect: pause all drain

    function spawnPowerup() {
      if (powerups.length >= 2) return;
      if (Math.random() > 0.008) return;
      var types = ['espresso', 'donut', 'alarm'];
      powerups.push({
        x: -20,
        y: 20 + Math.random() * 40,
        vx: 0.8 + Math.random() * 0.5,
        type: types[Math.floor(Math.random() * types.length)],
        bobPhase: Math.random() * 6,
      });
    }

    var particles = [];

    // ═══ INPUT ═══
    function onMouseDown(e) {
      e.preventDefault(); e.stopPropagation();
      var rect = canvas.getBoundingClientRect();
      var mx = (e.clientX - rect.left) * (W / rect.width);
      var my = (e.clientY - rect.top) * (H / rect.height);

      if (state === 'INTRO') { state = 'PLAYING'; initDesks(); return; }
      if (state !== 'PLAYING') return;

      // Click on desk to deliver coffee
      for (var i = 0; i < desks.length; i++) {
        var d = desks[i];
        if (d.replaced) continue;
        if (Math.abs(mx - d.x) < 28 && my > d.y - 55 && my < d.y + 10) {
          // Deliver coffee
          var boost = 30 + zone * 2;
          var prevE = d.energy;
          d.energy = Math.min(d.maxEnergy, d.energy + boost);
          var gained = Math.round(d.energy - prevE);
          d.coffeeAnim = 1;
          coffeeDelivered++;

          // Score based on how critical it was
          var pts = 1;
          if (prevE < 20) { pts = 5; feedbacks.push({x:d.x,y:d.y-40,text:'CLUTCH! +5',color:CL.gold,life:40}); }
          else if (prevE < 40) { pts = 3; feedbacks.push({x:d.x,y:d.y-40,text:'Needed! +3',color:CL.grn,life:35}); }
          else { pts = 1; feedbacks.push({x:d.x,y:d.y-40,text:'+1',color:'#888',life:25}); }
          score += pts;

          // Coffee particles
          for (var p = 0; p < 4; p++) {
            particles.push({
              x: d.x, y: d.y - 30,
              vx: (Math.random() - .5) * 2,
              vy: -Math.random() * 2 - 1,
              life: 15 + Math.random() * 8,
              color: CL.coffee, sz: 2 + Math.random()
            });
          }
          break;
        }
      }

      // Click on powerup
      for (var i = powerups.length - 1; i >= 0; i--) {
        var p = powerups[i];
        var py = p.y + Math.sin(p.bobPhase) * 4;
        if (Math.abs(mx - p.x) < 16 && Math.abs(my - py) < 16) {
          if (p.type === 'espresso') {
            espressoT = 300; // pause all drain for 5s
            feedbacks.push({x:p.x,y:py,text:'ESPRESSO! All paused!',color:CL.gold,life:50});
          } else if (p.type === 'donut') {
            // Refill all by 20
            for (var j = 0; j < desks.length; j++) {
              if (!desks[j].replaced) desks[j].energy = Math.min(100, desks[j].energy + 20);
            }
            feedbacks.push({x:p.x,y:py,text:'DONUTS! All boosted!',color:CL.amb,life:50});
          } else if (p.type === 'alarm') {
            // Wake up the lowest energy human fully
            var lowest = null, lowE = 999;
            for (var j = 0; j < desks.length; j++) {
              if (!desks[j].replaced && desks[j].energy < lowE) { lowE = desks[j].energy; lowest = desks[j]; }
            }
            if (lowest) {
              lowest.energy = lowest.maxEnergy;
              lowest.coffeeAnim = 1;
              feedbacks.push({x:p.x,y:py,text:'ALARM! Fully woke!',color:CL.cyan,life:50});
            }
          }
          score += 3;
          particles.push({x:p.x,y:py,vx:0,vy:0,life:20,color:CL.grn,sz:16,type:'ring'});
          powerups.splice(i, 1);
          break;
        }
      }
    }
    function onContextMenu(e) { e.preventDefault(); e.stopPropagation(); }
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContextMenu);

    // ═══ UPDATE ═══
    function update() {
      fr++;

      if (state === 'INTRO') { introT++; if (introT > 180) { state = 'PLAYING'; initDesks(); } return; }
      if (state !== 'PLAYING') return;

      // Zone
      var pz = zone;
      zone = prog < 20 ? 0 : prog < 40 ? 1 : prog < 60 ? 2 : prog < 75 ? 3 : 4;
      if (pz !== zone) {
        trTxt = ZONES[pz].name + ' caffeinated.'; trT = 70; trA = 0;
        // Increase drain rates
        for (var i = 0; i < desks.length; i++) {
          if (!desks[i].replaced) desks[i].drainRate += 0.012;
        }
      }

      if (trT > 0) { trT--; if (trT > 45) trA = Math.min(1, trA + .07); else if (trT < 12) trA = Math.max(0, trA - .07); }
      if (espressoT > 0) espressoT--;

      // Update desks
      for (var i = 0; i < desks.length; i++) {
        var d = desks[i];
        if (d.replaced) {
          d.replaceAnim = Math.min(1, d.replaceAnim + 0.03);
          continue;
        }

        // Coffee anim fade
        if (d.coffeeAnim > 0) d.coffeeAnim = Math.max(0, d.coffeeAnim - 0.04);

        // Drain energy (paused during espresso)
        if (espressoT <= 0) {
          d.energy -= d.drainRate;
        }

        d.zzzPhase += 0.04;
        d.critical = d.energy < 25;

        // Energy hit zero — AI replacement
        if (d.energy <= 0) {
          d.energy = 0;
          d.replaced = true;
          d.replaceAnim = 0;
          humansLost++;
          feedbacks.push({x:d.x,y:d.y-40,text:'REPLACED!',color:CL.red,life:50});
          // Particles
          for (var p = 0; p < 8; p++) {
            particles.push({
              x: d.x, y: d.y - 20,
              vx: (Math.random() - .5) * 3, vy: -Math.random() * 3,
              life: 20 + Math.random() * 10,
              color: CL.red, sz: 2 + Math.random() * 2
            });
          }
        }
      }

      // Powerups
      spawnPowerup();
      for (var i = powerups.length - 1; i >= 0; i--) {
        var p = powerups[i];
        p.x += p.vx;
        p.bobPhase += 0.05;
        if (p.x > W + 30) powerups.splice(i, 1);
      }

      // Feedbacks
      for (var i = feedbacks.length - 1; i >= 0; i--) {
        feedbacks[i].y -= 0.4;
        feedbacks[i].life--;
        if (feedbacks[i].life <= 0) feedbacks.splice(i, 1);
      }

      // Particles
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        if (p.type !== 'ring') { p.x += p.vx; p.y += p.vy; p.vy += 0.06; }
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
      }

      if (prog >= 100) state = 'FINISHED';
    }

    // ═══ DRAW HELPERS ═══
    function rr(c, x, y, w, h, r) {
      c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
      c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
      c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    }

    function drawHumanAtDesk(d) {
      var x = d.x, y = d.y;
      var s = d.skin;
      var sleepy = d.energy < 40;
      var critical = d.energy < 25;

      // Desk surface
      ctx.fillStyle = '#1a1f28';
      rr(ctx, x - 22, y - 16, 44, 4, 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.03)'; ctx.lineWidth = .5;
      rr(ctx, x - 22, y - 16, 44, 4, 2); ctx.stroke();
      // Desk legs
      ctx.fillStyle = '#14181f';
      ctx.fillRect(x - 17, y - 12, 2, 12);
      ctx.fillRect(x + 15, y - 12, 2, 12);

      // Monitor
      ctx.fillStyle = '#1a1f28';
      rr(ctx, x - 11, y - 33, 22, 15, 2); ctx.fill();
      ctx.fillStyle = '#0d1218';
      rr(ctx, x - 9, y - 31, 18, 11, 1); ctx.fill();
      // Screen glow based on energy
      var screenCol = d.energy > 60 ? '#3fb95015' : d.energy > 30 ? '#E8A00010' : '#E24B4A08';
      ctx.fillStyle = screenCol;
      rr(ctx, x - 9, y - 31, 18, 11, 1); ctx.fill();
      // Stand
      ctx.fillStyle = '#14181f';
      ctx.fillRect(x - 2, y - 18, 4, 3);

      // Coffee cup on desk (shows if recently delivered)
      if (d.coffeeAnim > 0) {
        ctx.save(); ctx.globalAlpha = d.coffeeAnim;
        ctx.fillStyle = CL.coffee;
        rr(ctx, x + 13, y - 24, 7, 8, 1); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = .5;
        ctx.beginPath(); ctx.arc(x + 20, y - 20, 2.5, -1.2, 1.2, true); ctx.stroke();
        // Steam
        ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = .6;
        ctx.beginPath();
        ctx.moveTo(x + 15, y - 25); ctx.quadraticCurveTo(x + 16, y - 29, x + 14, y - 32);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 18, y - 25); ctx.quadraticCurveTo(x + 17, y - 28, x + 19, y - 31);
        ctx.stroke();
        ctx.restore();
      }

      // Human body
      var headTilt = sleepy ? Math.sin(d.zzzPhase * 0.7) * 3 : 0;
      var bodyY = y - 22;

      // Body
      ctx.fillStyle = s.bc;
      rr(ctx, x - 5.5, bodyY + 6, 11, 8, 3); ctx.fill();

      // Head
      ctx.fillStyle = s.sk;
      ctx.beginPath(); ctx.arc(x, bodyY + headTilt, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.hr;
      ctx.beginPath(); ctx.arc(x, bodyY + headTilt, 7, Math.PI, 2 * Math.PI); ctx.fill();

      // Eyes (droopy when sleepy)
      if (sleepy) {
        // Half-closed eyes
        var eyeOpen = Math.max(0.3, d.energy / 40);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(x, bodyY + 1 + headTilt, 2.5, 3 * eyeOpen, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(x, bodyY + 1.5 + headTilt, 1, 0, Math.PI * 2); ctx.fill();
        // Eyelid
        ctx.fillStyle = s.sk;
        ctx.fillRect(x - 3, bodyY - 3 + headTilt, 6, 3 * (1 - eyeOpen));
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(x, bodyY + .5, 2.5, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(x, bodyY + 1, 1.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        ctx.beginPath(); ctx.arc(x - 1, bodyY - 1, .7, 0, Math.PI * 2); ctx.fill();
        // Smile
        ctx.strokeStyle = 'rgba(0,0,0,.1)'; ctx.lineWidth = .5;
        ctx.beginPath(); ctx.arc(x, bodyY + 4, 2, .2, Math.PI - .3); ctx.stroke();
      }

      // ZZZ when very sleepy
      if (d.energy < 35) {
        var zAlpha = (35 - d.energy) / 35;
        ctx.save(); ctx.globalAlpha = zAlpha * (.4 + Math.sin(d.zzzPhase) * .2);
        ctx.font = 'bold 8px monospace'; ctx.fillStyle = '#888';
        var zy = bodyY - 12 + Math.sin(d.zzzPhase * 0.5) * 3;
        ctx.fillText('z', x + 9, zy);
        if (d.energy < 20) ctx.fillText('z', x + 14, zy - 5);
        if (d.energy < 10) ctx.fillText('Z', x + 18, zy - 10);
        ctx.restore();
      }

      // Energy bar above desk
      var barW = 36, barH = 3, barX = x - barW / 2, barY = y - 45;
      ctx.fillStyle = '#21262d';
      rr(ctx, barX, barY, barW, barH, 1.5); ctx.fill();
      var eP = d.energy / d.maxEnergy;
      var eCol = eP > .5 ? CL.grn : eP > .25 ? CL.amb : CL.red;
      ctx.fillStyle = eCol;
      rr(ctx, barX, barY, barW * eP, barH, 1.5); ctx.fill();

      // Critical flash
      if (critical && Math.sin(fr * .15) > 0) {
        ctx.save(); ctx.globalAlpha = .08;
        ctx.fillStyle = CL.red;
        ctx.beginPath(); ctx.arc(x, bodyY, 22, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    function drawAIAtDesk(d) {
      var x = d.x, y = d.y;
      var anim = d.replaceAnim;

      // Desk (same)
      ctx.fillStyle = '#1a1f28';
      rr(ctx, x - 22, y - 16, 44, 4, 2); ctx.fill();
      ctx.fillStyle = '#14181f';
      ctx.fillRect(x - 17, y - 12, 2, 12);
      ctx.fillRect(x + 15, y - 12, 2, 12);
      // Monitor (now AI-colored)
      ctx.fillStyle = '#1a1f28';
      rr(ctx, x - 11, y - 33, 22, 15, 2); ctx.fill();
      ctx.fillStyle = CL.ai + '15';
      rr(ctx, x - 9, y - 31, 18, 11, 1); ctx.fill();
      ctx.fillStyle = '#14181f';
      ctx.fillRect(x - 2, y - 18, 4, 3);

      // AI agent (fade in with anim)
      ctx.save(); ctx.globalAlpha = anim;
      var bodyY = y - 22;

      // Body
      ctx.fillStyle = CL.aiB;
      rr(ctx, x - 6, bodyY + 6, 12, 8, 3); ctx.fill();

      // Head
      ctx.fillStyle = CL.ai;
      ctx.beginPath(); ctx.arc(x, bodyY, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#a04520'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, bodyY, 8, 0, Math.PI * 2); ctx.stroke();

      // Antenna
      ctx.strokeStyle = CL.acc; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, bodyY - 8); ctx.lineTo(x, bodyY - 13); ctx.stroke();
      ctx.fillStyle = CL.acc;
      ctx.beginPath(); ctx.arc(x, bodyY - 13, 2, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.globalAlpha = .15;
      ctx.beginPath(); ctx.arc(x, bodyY - 13, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Eye
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(x, bodyY + .5, 3.5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#40C8E0';
      ctx.beginPath(); ctx.arc(x + .5, bodyY + 1, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a2a3a';
      ctx.beginPath(); ctx.arc(x + .5, bodyY + 1, 1.1, 0, Math.PI * 2); ctx.fill();

      ctx.restore();

      // "REPLACED" tag
      if (anim > 0.5) {
        ctx.save(); ctx.globalAlpha = (anim - 0.5) * 2;
        ctx.fillStyle = CL.red; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center';
        ctx.fillText('AI', x, y - 45);
        ctx.textAlign = 'left'; ctx.restore();
      }
    }

    // ═══ DRAW ═══
    function draw() {
      var z = ZONES[zone];
      ctx.fillStyle = z.sky; ctx.fillRect(0, 0, W, H);

      // Grid
      ctx.save(); ctx.globalAlpha = .02; ctx.strokeStyle = z.ac; ctx.lineWidth = .5;
      for (var x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      ctx.restore();

      // Zone watermark
      ctx.save(); ctx.globalAlpha = .02; ctx.font = '800 20px Syne,sans-serif'; ctx.fillStyle = z.ac;
      ctx.fillText(z.name.toUpperCase(), 15, GY - 6); ctx.restore();

      // Ground
      ctx.fillStyle = z.gnd; ctx.fillRect(0, GY, W, H - GY);
      ctx.strokeStyle = z.gl; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, GY); ctx.lineTo(W, GY); ctx.stroke();

      // ── Desks ──
      for (var i = 0; i < desks.length; i++) {
        var d = desks[i];
        if (d.replaced) {
          drawAIAtDesk(d);
        } else {
          drawHumanAtDesk(d);
        }
      }

      // ── Powerups ──
      for (var i = 0; i < powerups.length; i++) {
        var p = powerups[i];
        var py = p.y + Math.sin(p.bobPhase) * 4;
        var pCol, pLabel;
        if (p.type === 'espresso') { pCol = CL.espresso; pLabel = '\u2615'; }
        else if (p.type === 'donut') { pCol = CL.amb; pLabel = '\u25CB'; }
        else { pCol = CL.cyan; pLabel = '\u266A'; }

        ctx.fillStyle = pCol + '22';
        ctx.beginPath(); ctx.arc(p.x, py, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = pCol; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, py, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = pCol; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(pLabel, p.x, py + 4); ctx.textAlign = 'left';
      }

      // ── Espresso effect indicator ──
      if (espressoT > 0) {
        ctx.save(); ctx.globalAlpha = .04 + Math.sin(fr * .1) * .02;
        ctx.fillStyle = CL.gold; ctx.fillRect(0, 0, W, H);
        ctx.restore();
        ctx.fillStyle = CL.gold; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
        ctx.fillText('\u2615 ESPRESSO MODE \u2615', W / 2, 12);
        ctx.textAlign = 'left';
      }

      // ── Feedbacks ──
      for (var i = 0; i < feedbacks.length; i++) {
        var f = feedbacks[i];
        ctx.save(); ctx.globalAlpha = Math.min(1, f.life / 12);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = f.color; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
        ctx.textAlign = 'left'; ctx.restore();
      }

      // ── Particles ──
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.type === 'ring') {
          ctx.save(); ctx.globalAlpha = p.life / 20 * .4; ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * (1 - p.life / 20), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        } else {
          ctx.save(); ctx.globalAlpha = p.life / 25;
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      }

      // ═══ HUD ═══
      if (state === 'PLAYING' || state === 'FINISHED') {
        // Score
        ctx.fillStyle = CL.acc; ctx.font = 'bold 10px monospace'; ctx.fillText('\u2B21 ' + score, 8, 12);

        // Humans remaining
        var humansAlive = 0;
        for (var i = 0; i < desks.length; i++) { if (!desks[i].replaced) humansAlive++; }
        ctx.fillStyle = humansAlive > 4 ? CL.grn : humansAlive > 2 ? CL.amb : CL.red;
        ctx.font = 'bold 8px monospace';
        ctx.fillText(humansAlive + '/' + DESK_COUNT + ' awake', 8, 24);

        // Zone
        ctx.textAlign = 'right'; ctx.fillStyle = '#444'; ctx.font = 'bold 7px monospace';
        ctx.fillText(ZONES[zone].name, W - 8, 12); ctx.textAlign = 'left';

        // Progress bar
        ctx.fillStyle = '#21262d'; ctx.fillRect(0, H - 3, W, 3);
        ctx.fillStyle = prog > 90 ? CL.grn : CL.acc + '88';
        ctx.fillRect(0, H - 3, W * (prog / 100), 3);
      }

      // ── INTRO ──
      if (state === 'INTRO') {
        ctx.fillStyle = 'rgba(15,13,26,0.6)'; ctx.fillRect(0, 0, W, H);
        ctx.font = '800 18px Syne,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText('COFFEE RUSH', W / 2, H / 2 - 16);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.coffee;
        ctx.fillText('Click workers to deliver coffee before they fall asleep', W / 2, H / 2 + 4);
        ctx.font = 'bold 8px monospace'; ctx.fillStyle = CL.red;
        ctx.fillText('If they sleep, AI takes their desk.', W / 2, H / 2 + 18);
        if (Math.sin(fr * .06) > 0) {
          ctx.font = 'bold 10px monospace'; ctx.fillStyle = CL.acc;
          ctx.fillText('[ CLICK TO START ]', W / 2, H / 2 + 38);
        }
        ctx.textAlign = 'left';
      }

      // Zone transition
      if (trT > 0 && trTxt) {
        ctx.save(); ctx.globalAlpha = trA * .5;
        ctx.fillStyle = '#000'; ctx.fillRect(0, H / 2 - 12, W, 24);
        ctx.globalAlpha = trA; ctx.font = 'bold 10px Syne,sans-serif'; ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.fillText(trTxt, W / 2, H / 2 + 4);
        ctx.textAlign = 'left'; ctx.restore();
      }

      // ── FINISHED ──
      if (state === 'FINISHED') {
        ctx.fillStyle = 'rgba(15,13,26,0.85)'; ctx.fillRect(0, 0, W, H);
        var humansAlive = 0;
        for (var i = 0; i < desks.length; i++) { if (!desks[i].replaced) humansAlive++; }

        ctx.font = '800 17px Syne,sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = humansAlive > 4 ? CL.grn : humansAlive > 0 ? CL.amb : CL.red;
        ctx.fillText(humansAlive > 0 ? 'SHIFT SURVIVED' : 'TOTAL REPLACEMENT', W / 2, H * .24);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#666';
        ctx.fillText('exit code ' + (humansAlive > 0 ? '0' : '1'), W / 2, H * .24 + 14);
        ctx.font = 'bold 12px monospace'; ctx.fillStyle = CL.acc;
        ctx.fillText('\u2B21 ' + score + ' points', W / 2, H * .50);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.grn;
        ctx.fillText(humansAlive + '/' + DESK_COUNT + ' humans survived', W / 2, H * .50 + 16);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.coffee;
        ctx.fillText(coffeeDelivered + ' coffees delivered', W / 2, H * .50 + 30);
        ctx.font = 'bold 7px monospace'; ctx.fillStyle = '#444';
        ctx.fillText(humansLost === 0 ? 'Perfect shift. Nobody fell asleep.' : humansLost + ' desk(s) lost to the machines.', W / 2, H * .84);
        ctx.textAlign = 'left';
      }

      // Scanlines
      ctx.save(); ctx.globalAlpha = .02;
      for (var y = 0; y < H; y += 3) { ctx.fillStyle = '#000'; ctx.fillRect(0, y, W, 1); }
      ctx.restore();
    }

    // ═══ LOOP ═══
    function loop() {
      if (!running) return;
      update(); draw();
      requestAnimationFrame(loop);
    }
    loop();

    // ═══ API ═══
    return {
      start: function() {
        state = 'INTRO'; fr = 0; score = 0; prog = 0; zone = 0;
        introT = 0; trT = 0; humansLost = 0; coffeeDelivered = 0;
        espressoT = 0;
        particles = []; powerups = []; feedbacks = [];
        initDesks();
      },
      setProgress: function(v) {
        if (state === 'PLAYING') prog = Math.min(100, Math.max(prog, v));
      },
      getState: function() {
        return { state: state, score: score, prog: prog };
      },
      destroy: function() {
        running = false;
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('contextmenu', onContextMenu);
      }
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: WIRE TAP
  // AI cables grow toward human workstations. Click tips to cut.
  // More cables, faster growth each zone. 100% original.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'wire-tap',
    name: 'Wire Tap',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var running = true;

    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',
      ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',
      acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',
      cyan:'#50C8FF',cable:'#E24B4A',cableGlow:'#FF6B5B'};

    var HSKINS = [
      {bc:'#3570B0',sk:'#F4C7A3',hr:'#3A2A1A'},
      {bc:'#C04878',sk:'#F0D5C0',hr:'#8B3A1A'},
      {bc:'#3A9080',sk:'#C8A882',hr:'#1A3A2A'},
      {bc:'#A83030',sk:'#F0D0B0',hr:'#5A2A1A'},
      {bc:'#8A5090',sk:'#F0C8B0',hr:'#5A2A3A'},
      {bc:'#3060A0',sk:'#F0D0A8',hr:'#4A2A1A'},
    ];

    var ZONES = [
      {name:'Tech Office',sky:'#0c1015',ac:'#3fb950',gnd:'#0a0e14',gl:'#182028'},
      {name:'Design Studio',sky:'#14100a',ac:'#E8A000',gnd:'#121008',gl:'#221c10'},
      {name:'Newsroom',sky:'#080808',ac:'#E24B4A',gnd:'#0c0c0c',gl:'#1a1a1a'},
      {name:'Film Set',sky:'#150008',ac:'#FFD700',gnd:'#120510',gl:'#221020'},
      {name:'Trading Floor',sky:'#040a04',ac:'#E8A000',gnd:'#060a06',gl:'#142014'},
    ];

    var GY = H - 18;

    // State
    var state = 'INTRO', fr = 0, score = 0, prog = 0, zone = 0;
    var introT = 0;
    var trT = 0, trTxt = '', trA = 0;
    var humansLost = 0;
    var cablesCut = 0;

    // Human workstations (right side)
    var STATION_COUNT = 6;
    var stations = [];

    // AI source nodes (left side)
    var sources = [];
    var SOURCE_COUNT = 3;

    // Active cables
    var cables = [];
    var cableSpawnT = 0;

    var particles = [];
    var feedbacks = [];
    var powerups = [];
    var freezeT = 0; // freeze all cables
    var surgeT = 0;  // all cables highlighted

    function initStations() {
      stations = [];
      for (var i = 0; i < STATION_COUNT; i++) {
        var sy = 18 + i * ((GY - 30) / (STATION_COUNT - 1));
        stations.push({
          x: W - 45,
          y: sy,
          skin: HSKINS[i % HSKINS.length],
          alive: true,
          hitAnim: 0,
        });
      }

      sources = [];
      for (var i = 0; i < SOURCE_COUNT; i++) {
        var sy = 25 + i * ((GY - 40) / (SOURCE_COUNT - 1));
        sources.push({ x: 35, y: sy });
      }
    }

    function spawnCable() {
      var aliveStations = [];
      for (var i = 0; i < stations.length; i++) {
        if (stations[i].alive) aliveStations.push(i);
      }
      if (aliveStations.length === 0) return;

      var targetIdx = aliveStations[Math.floor(Math.random() * aliveStations.length)];
      var target = stations[targetIdx];
      var source = sources[Math.floor(Math.random() * sources.length)];

      // Cable grows from source toward target with some waviness
      var baseSpeed = 0.8 + zone * 0.25 + prog * 0.005;
      var dx = target.x - source.x;
      var dy = target.y - source.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var vx = (dx / dist) * baseSpeed;
      var vy = (dy / dist) * baseSpeed;

      // Add slight curve via control points
      var midX = (source.x + target.x) / 2 + (Math.random() - .5) * 80;
      var midY = (source.y + target.y) / 2 + (Math.random() - .5) * 40;

      cables.push({
        sx: source.x, sy: source.y,       // start
        tx: target.x, ty: target.y,       // target
        mx: midX, my: midY,               // curve midpoint
        progress: 0,                       // 0 to 1
        speed: baseSpeed / dist * 1.5,     // normalized speed
        targetStation: targetIdx,
        alive: true,
        pulsePhase: Math.random() * 6,
        width: 1.5 + Math.random() * 0.5,
      });
    }

    function getCablePos(c, t) {
      // Quadratic bezier
      var u = 1 - t;
      var x = u * u * c.sx + 2 * u * t * c.mx + t * t * c.tx;
      var y = u * u * c.sy + 2 * u * t * c.my + t * t * c.ty;
      return { x: x, y: y };
    }

    // ═══ INPUT ═══
    function onMouseDown(e) {
      e.preventDefault(); e.stopPropagation();
      var rect = canvas.getBoundingClientRect();
      var mx = (e.clientX - rect.left) * (W / rect.width);
      var my = (e.clientY - rect.top) * (H / rect.height);

      if (state === 'INTRO') { state = 'PLAYING'; initStations(); return; }
      if (state !== 'PLAYING') return;

      // Click on cable tip
      var cutAny = false;
      for (var i = cables.length - 1; i >= 0; i--) {
        var c = cables[i];
        if (!c.alive) continue;
        var tip = getCablePos(c, c.progress);
        var dx = mx - tip.x, dy = my - tip.y;
        if (dx * dx + dy * dy < 20 * 20) {
          c.alive = false;
          cablesCut++;

          // Score based on how close to station
          var pts = c.progress > 0.8 ? 5 : c.progress > 0.5 ? 3 : 1;
          var label = c.progress > 0.8 ? 'CLOSE CALL! +5' : c.progress > 0.5 ? 'Nice! +3' : '+1';
          var col = c.progress > 0.8 ? CL.gold : c.progress > 0.5 ? CL.grn : '#888';
          score += pts;
          feedbacks.push({ x: tip.x, y: tip.y, text: label, color: col, life: 35 });

          // Spark particles
          for (var p = 0; p < 6; p++) {
            particles.push({
              x: tip.x, y: tip.y,
              vx: (Math.random() - .5) * 5, vy: (Math.random() - .5) * 4,
              life: 15 + Math.random() * 8,
              color: CL.cable, sz: 1.5 + Math.random() * 1.5
            });
          }
          // Electric snap
          particles.push({ x: tip.x, y: tip.y, vx: 0, vy: 0, life: 8, color: '#fff', sz: 12, type: 'snap' });
          cutAny = true;
          break; // only cut one per click
        }
      }

      // Click on powerup
      if (!cutAny) {
        for (var i = powerups.length - 1; i >= 0; i--) {
          var p = powerups[i];
          var py = p.y + Math.sin(p.bobPhase) * 3;
          if (Math.abs(mx - p.x) < 14 && Math.abs(my - py) < 14) {
            if (p.type === 'freeze') {
              freezeT = 240;
              feedbacks.push({ x: p.x, y: py, text: 'FROZEN!', color: CL.cyan, life: 45 });
            } else if (p.type === 'surge') {
              // Kill all active cables
              for (var j = cables.length - 1; j >= 0; j--) {
                if (cables[j].alive) {
                  var tip = getCablePos(cables[j], cables[j].progress);
                  particles.push({ x: tip.x, y: tip.y, vx: 0, vy: 0, life: 10, color: '#fff', sz: 10, type: 'snap' });
                  cables[j].alive = false;
                  score++;
                  cablesCut++;
                }
              }
              feedbacks.push({ x: p.x, y: py, text: 'SURGE! All cut!', color: CL.amb, life: 50 });
            } else if (p.type === 'repair') {
              // Repair one lost station
              for (var j = 0; j < stations.length; j++) {
                if (!stations[j].alive) {
                  stations[j].alive = true;
                  stations[j].hitAnim = 0;
                  humansLost = Math.max(0, humansLost - 1);
                  feedbacks.push({ x: p.x, y: py, text: 'REPAIRED!', color: CL.grn, life: 50 });
                  break;
                }
              }
            }
            score += 2;
            particles.push({ x: p.x, y: py, vx: 0, vy: 0, life: 18, color: CL.grn, sz: 14, type: 'ring' });
            powerups.splice(i, 1);
            break;
          }
        }
      }
    }
    function onContextMenu(e) { e.preventDefault(); e.stopPropagation(); }
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContextMenu);

    // ═══ UPDATE ═══
    function update() {
      fr++;

      if (state === 'INTRO') { introT++; if (introT > 180) { state = 'PLAYING'; initStations(); } return; }
      if (state !== 'PLAYING') return;

      // Zone
      var pz = zone;
      zone = prog < 20 ? 0 : prog < 40 ? 1 : prog < 60 ? 2 : prog < 75 ? 3 : 4;
      if (pz !== zone) { trTxt = ZONES[pz].name + ' secured.'; trT = 70; trA = 0; }

      if (trT > 0) { trT--; if (trT > 45) trA = Math.min(1, trA + .07); else if (trT < 12) trA = Math.max(0, trA - .07); }
      if (freezeT > 0) freezeT--;

      // Spawn cables
      var spawnRate = Math.max(25, 70 - zone * 10 - prog * 0.2);
      cableSpawnT++;
      if (cableSpawnT >= spawnRate) {
        cableSpawnT = 0;
        spawnCable();
        // Extra cable at higher zones
        if (zone >= 2 && Math.random() < 0.3) spawnCable();
        if (zone >= 4 && Math.random() < 0.3) spawnCable();
      }

      // Update cables
      for (var i = cables.length - 1; i >= 0; i--) {
        var c = cables[i];
        if (!c.alive) {
          // Dead cables fade out and get removed
          c.progress -= 0.01;
          if (c.progress <= 0) cables.splice(i, 1);
          continue;
        }

        c.pulsePhase += 0.08;

        if (freezeT <= 0) {
          c.progress += c.speed;
        } else {
          c.progress += c.speed * 0.05; // very slow during freeze
        }

        // Cable reached target
        if (c.progress >= 1) {
          c.alive = false;
          var station = stations[c.targetStation];
          if (station && station.alive) {
            station.alive = false;
            station.hitAnim = 1;
            humansLost++;
            feedbacks.push({ x: station.x, y: station.y, text: 'TAKEN!', color: CL.red, life: 50 });
            // Explosion
            for (var p = 0; p < 10; p++) {
              particles.push({
                x: station.x, y: station.y,
                vx: (Math.random() - .5) * 4, vy: (Math.random() - .5) * 3,
                life: 20 + Math.random() * 10,
                color: CL.red, sz: 2 + Math.random() * 2
              });
            }
            particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 10, color: CL.red, sz: 0, type: 'flash' });
          }
          cables.splice(i, 1);
        }
      }

      // Powerups
      if (Math.random() < 0.004) {
        var types = ['freeze', 'surge', 'repair'];
        powerups.push({
          x: 80 + Math.random() * (W - 160),
          y: 10 + Math.random() * (GY - 30),
          type: types[Math.floor(Math.random() * types.length)],
          bobPhase: Math.random() * 6,
          life: 500,
        });
      }
      for (var i = powerups.length - 1; i >= 0; i--) {
        powerups[i].bobPhase += 0.04;
        powerups[i].life--;
        if (powerups[i].life <= 0) powerups.splice(i, 1);
      }

      // Feedbacks
      for (var i = feedbacks.length - 1; i >= 0; i--) {
        feedbacks[i].y -= 0.5;
        feedbacks[i].life--;
        if (feedbacks[i].life <= 0) feedbacks.splice(i, 1);
      }

      // Particles
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        if (p.type !== 'ring' && p.type !== 'snap' && p.type !== 'flash') {
          p.x += p.vx; p.y += p.vy; p.vy += 0.06;
        }
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
      }

      if (prog >= 100) state = 'FINISHED';
    }

    // ═══ DRAW HELPERS ═══
    function rr(c, x, y, w, h, r) {
      c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
      c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
      c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    }

    function drawStation(s, idx) {
      var x = s.x, y = s.y;

      if (s.alive) {
        // Monitor
        ctx.fillStyle = '#1a1f28';
        rr(ctx, x - 12, y - 10, 24, 16, 2); ctx.fill();
        ctx.fillStyle = '#0d1218';
        rr(ctx, x - 10, y - 8, 20, 12, 1); ctx.fill();
        ctx.fillStyle = CL.grn + '10';
        rr(ctx, x - 10, y - 8, 20, 12, 1); ctx.fill();
        // Stand
        ctx.fillStyle = '#14181f'; ctx.fillRect(x - 2, y + 6, 4, 3);

        // Human face
        var sk = s.skin;
        ctx.fillStyle = sk.sk;
        ctx.beginPath(); ctx.arc(x, y - 16, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = sk.hr;
        ctx.beginPath(); ctx.arc(x, y - 16, 6, Math.PI, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(x, y - 15.5, 2.2, 2.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(x, y - 15, 1.1, 0, Math.PI * 2); ctx.fill();
        // Body
        ctx.fillStyle = sk.bc;
        rr(ctx, x - 5, y - 9, 10, 8, 2); ctx.fill();

        // Connection indicator (green dot)
        ctx.fillStyle = CL.grn;
        ctx.beginPath(); ctx.arc(x + 14, y - 8, 2, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.globalAlpha = .2;
        ctx.beginPath(); ctx.arc(x + 14, y - 8, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        // Taken over — AI
        ctx.fillStyle = '#1a1f28';
        rr(ctx, x - 12, y - 10, 24, 16, 2); ctx.fill();
        ctx.fillStyle = CL.ai + '18';
        rr(ctx, x - 10, y - 8, 20, 12, 1); ctx.fill();
        ctx.fillStyle = '#14181f'; ctx.fillRect(x - 2, y + 6, 4, 3);

        // AI head
        ctx.save(); ctx.globalAlpha = Math.min(1, s.hitAnim * 2 || 1);
        ctx.fillStyle = CL.ai;
        ctx.beginPath(); ctx.arc(x, y - 15, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#a04520'; ctx.lineWidth = .8;
        ctx.beginPath(); ctx.arc(x, y - 15, 6, 0, Math.PI * 2); ctx.stroke();
        // Eye
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(x, y - 14.5, 2, 2.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#40C8E0';
        ctx.beginPath(); ctx.arc(x + .3, y - 14, 1.5, 0, Math.PI * 2); ctx.fill();
        // Antenna
        ctx.strokeStyle = CL.acc; ctx.lineWidth = .8;
        ctx.beginPath(); ctx.moveTo(x, y - 21); ctx.lineTo(x, y - 25); ctx.stroke();
        ctx.fillStyle = CL.acc;
        ctx.beginPath(); ctx.arc(x, y - 25, 1.5, 0, Math.PI * 2); ctx.fill();
        // Body
        ctx.fillStyle = CL.aiB;
        rr(ctx, x - 5, y - 9, 10, 8, 2); ctx.fill();
        ctx.restore();

        // Red dot
        ctx.fillStyle = CL.red;
        ctx.beginPath(); ctx.arc(x + 14, y - 8, 2, 0, Math.PI * 2); ctx.fill();
      }

      if (s.hitAnim > 0 && s.hitAnim < 1) s.hitAnim = Math.min(1, s.hitAnim + 0.03);
    }

    function drawSource(s) {
      // AI server node
      ctx.fillStyle = CL.srf;
      rr(ctx, s.x - 14, s.y - 12, 28, 24, 4); ctx.fill();
      ctx.strokeStyle = CL.ai + '44'; ctx.lineWidth = 1;
      rr(ctx, s.x - 14, s.y - 12, 28, 24, 4); ctx.stroke();

      // AI symbol
      ctx.fillStyle = CL.ai;
      ctx.beginPath(); ctx.arc(s.x, s.y - 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(s.x, s.y - 1.5, 2, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#40C8E0';
      ctx.beginPath(); ctx.arc(s.x + .3, s.y - 1, 1.5, 0, Math.PI * 2); ctx.fill();
      // Antenna
      ctx.strokeStyle = CL.acc; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x, s.y - 11); ctx.stroke();
      ctx.fillStyle = CL.acc;
      ctx.beginPath(); ctx.arc(s.x, s.y - 11, 1.5, 0, Math.PI * 2); ctx.fill();

      // Label
      ctx.fillStyle = '#555'; ctx.font = 'bold 5px monospace'; ctx.textAlign = 'center';
      ctx.fillText('SRC', s.x, s.y + 10); ctx.textAlign = 'left';

      // Pulse
      ctx.save(); ctx.globalAlpha = .06 + Math.sin(fr * .05) * .03;
      ctx.fillStyle = CL.ai;
      ctx.beginPath(); ctx.arc(s.x, s.y, 18, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // ═══ DRAW ═══
    function draw() {
      var z = ZONES[zone];
      ctx.fillStyle = z.sky; ctx.fillRect(0, 0, W, H);

      // Circuit grid
      ctx.save(); ctx.globalAlpha = .025; ctx.strokeStyle = z.ac; ctx.lineWidth = .5;
      for (var x = 0; x < W; x += 35) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (var y = 0; y < H; y += 35) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();

      // Zone watermark
      ctx.save(); ctx.globalAlpha = .02; ctx.font = '800 18px Syne,sans-serif'; ctx.fillStyle = z.ac;
      ctx.fillText(z.name.toUpperCase(), W / 2 - 60, GY - 2); ctx.restore();

      // Ground
      ctx.fillStyle = z.gnd; ctx.fillRect(0, GY, W, H - GY);
      ctx.strokeStyle = z.gl; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, GY); ctx.lineTo(W, GY); ctx.stroke();

      // ── Sources ──
      for (var i = 0; i < sources.length; i++) drawSource(sources[i]);

      // ── Stations ──
      for (var i = 0; i < stations.length; i++) drawStation(stations[i], i);

      // ── Cables ──
      for (var i = 0; i < cables.length; i++) {
        var c = cables[i];
        var tipT = c.alive ? c.progress : Math.max(0, c.progress);
        if (tipT <= 0) continue;

        // Draw cable path
        var segments = Math.floor(tipT * 30);
        ctx.lineWidth = c.width;

        for (var s = 0; s < segments; s++) {
          var t0 = (s / 30), t1 = ((s + 1) / 30);
          if (t1 > tipT) t1 = tipT;
          var p0 = getCablePos(c, t0);
          var p1 = getCablePos(c, t1);

          // Color: red for alive, dim for dead
          if (c.alive) {
            var pulse = .4 + Math.sin(c.pulsePhase + s * 0.3) * .2;
            ctx.strokeStyle = CL.cable;
            ctx.globalAlpha = pulse + 0.3;
          } else {
            ctx.strokeStyle = '#333';
            ctx.globalAlpha = .2;
          }
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Cable tip (only if alive)
        if (c.alive) {
          var tip = getCablePos(c, tipT);

          // Danger glow when close
          if (c.progress > 0.7) {
            ctx.save(); ctx.globalAlpha = (c.progress - 0.7) / 0.3 * .12;
            ctx.fillStyle = CL.red;
            ctx.beginPath(); ctx.arc(tip.x, tip.y, 12, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }

          // Tip dot
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(tip.x, tip.y, 3 + Math.sin(c.pulsePhase) * .5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = CL.cable; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(tip.x, tip.y, 5, 0, Math.PI * 2); ctx.stroke();
        }
      }

      // ── Freeze effect ──
      if (freezeT > 0) {
        ctx.save(); ctx.globalAlpha = .03 + Math.sin(fr * .08) * .01;
        ctx.fillStyle = CL.cyan; ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      // ── Powerups ──
      for (var i = 0; i < powerups.length; i++) {
        var p = powerups[i];
        var py = p.y + Math.sin(p.bobPhase) * 3;
        var pCol, pLabel;
        if (p.type === 'freeze') { pCol = CL.cyan; pLabel = '\u2744'; }
        else if (p.type === 'surge') { pCol = CL.amb; pLabel = '\u26A1'; }
        else { pCol = CL.grn; pLabel = '\u2692'; }

        // Fade when expiring
        var alpha = p.life < 60 ? p.life / 60 : 1;
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.fillStyle = pCol + '22';
        ctx.beginPath(); ctx.arc(p.x, py, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = pCol; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, py, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = pCol; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(pLabel, p.x, py + 4); ctx.textAlign = 'left';
        ctx.restore();
      }

      // ── Feedbacks ──
      for (var i = 0; i < feedbacks.length; i++) {
        var f = feedbacks[i];
        ctx.save(); ctx.globalAlpha = Math.min(1, f.life / 10);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = f.color; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.textAlign = 'left'; ctx.restore();
      }

      // ── Particles ──
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.type === 'flash') {
          ctx.save(); ctx.globalAlpha = p.life / 10 * .12;
          ctx.fillStyle = p.color; ctx.fillRect(0, 0, W, H); ctx.restore();
        } else if (p.type === 'ring') {
          ctx.save(); ctx.globalAlpha = p.life / 18 * .4; ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.sz * (1 - p.life / 18), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        } else if (p.type === 'snap') {
          ctx.save(); ctx.globalAlpha = p.life / 8 * .6; ctx.strokeStyle = p.color; ctx.lineWidth = 2;
          var sr = p.sz * (1 - p.life / 8);
          for (var j = 0; j < 4; j++) {
            var a = j * Math.PI / 2 + fr * 0.2;
            ctx.beginPath();
            ctx.moveTo(p.x + Math.cos(a) * sr * .3, p.y + Math.sin(a) * sr * .3);
            ctx.lineTo(p.x + Math.cos(a) * sr, p.y + Math.sin(a) * sr);
            ctx.stroke();
          }
          ctx.restore();
        } else {
          ctx.save(); ctx.globalAlpha = p.life / 22;
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      }

      // ═══ HUD ═══
      if (state === 'PLAYING' || state === 'FINISHED') {
        ctx.fillStyle = CL.acc; ctx.font = 'bold 10px monospace'; ctx.fillText('\u2B21 ' + score, 8, GY + 12);

        var alive = 0;
        for (var i = 0; i < stations.length; i++) { if (stations[i].alive) alive++; }
        ctx.fillStyle = alive > 3 ? CL.grn : alive > 1 ? CL.amb : CL.red;
        ctx.font = 'bold 8px monospace';
        ctx.fillText(alive + '/' + STATION_COUNT + ' safe', 65, GY + 12);

        ctx.textAlign = 'right'; ctx.fillStyle = '#444'; ctx.font = 'bold 7px monospace';
        ctx.fillText(ZONES[zone].name, W - 8, GY + 12); ctx.textAlign = 'left';

        // Progress
        ctx.fillStyle = '#21262d'; ctx.fillRect(0, H - 3, W, 3);
        ctx.fillStyle = prog > 90 ? CL.grn : CL.acc + '88';
        ctx.fillRect(0, H - 3, W * (prog / 100), 3);
      }

      // ── INTRO ──
      if (state === 'INTRO') {
        ctx.fillStyle = 'rgba(15,13,26,0.6)'; ctx.fillRect(0, 0, W, H);
        ctx.font = '800 18px Syne,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText('WIRE TAP', W / 2, H / 2 - 16);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.cable;
        ctx.fillText('AI cables are hacking your workstations', W / 2, H / 2 + 4);
        ctx.font = 'bold 8px monospace'; ctx.fillStyle = CL.grn;
        ctx.fillText('Click cable tips to cut them before they connect', W / 2, H / 2 + 18);
        if (Math.sin(fr * .06) > 0) {
          ctx.font = 'bold 10px monospace'; ctx.fillStyle = CL.acc;
          ctx.fillText('[ CLICK TO START ]', W / 2, H / 2 + 38);
        }
        ctx.textAlign = 'left';
      }

      // Zone transition
      if (trT > 0 && trTxt) {
        ctx.save(); ctx.globalAlpha = trA * .5;
        ctx.fillStyle = '#000'; ctx.fillRect(0, H / 2 - 12, W, 24);
        ctx.globalAlpha = trA; ctx.font = 'bold 10px Syne,sans-serif'; ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.fillText(trTxt, W / 2, H / 2 + 4);
        ctx.textAlign = 'left'; ctx.restore();
      }

      // ── FINISHED ──
      if (state === 'FINISHED') {
        ctx.fillStyle = 'rgba(15,13,26,0.85)'; ctx.fillRect(0, 0, W, H);
        var alive = 0;
        for (var i = 0; i < stations.length; i++) { if (stations[i].alive) alive++; }

        ctx.font = '800 17px Syne,sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = alive > 3 ? CL.grn : alive > 0 ? CL.amb : CL.red;
        ctx.fillText(alive > 0 ? 'NETWORK SECURED' : 'NETWORK COMPROMISED', W / 2, H * .24);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#666';
        ctx.fillText('exit code ' + (alive > 0 ? '0' : '1'), W / 2, H * .24 + 14);
        ctx.font = 'bold 12px monospace'; ctx.fillStyle = CL.acc;
        ctx.fillText('\u2B21 ' + score + ' points', W / 2, H * .50);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.grn;
        ctx.fillText(alive + '/' + STATION_COUNT + ' stations defended', W / 2, H * .50 + 16);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.cyan;
        ctx.fillText(cablesCut + ' cables severed', W / 2, H * .50 + 30);
        ctx.font = 'bold 7px monospace'; ctx.fillStyle = '#444';
        ctx.fillText(humansLost === 0 ? 'Not a single breach. Flawless.' : humansLost + ' station(s) compromised.', W / 2, H * .84);
        ctx.textAlign = 'left';
      }

      // Scanlines
      ctx.save(); ctx.globalAlpha = .02;
      for (var y = 0; y < H; y += 3) { ctx.fillStyle = '#000'; ctx.fillRect(0, y, W, 1); }
      ctx.restore();
    }

    // ═══ LOOP ═══
    function loop() {
      if (!running) return;
      update(); draw();
      requestAnimationFrame(loop);
    }
    loop();

    // ═══ API ═══
    return {
      start: function() {
        state = 'INTRO'; fr = 0; score = 0; prog = 0; zone = 0;
        introT = 0; trT = 0; humansLost = 0; cablesCut = 0;
        freezeT = 0; cableSpawnT = 0;
        cables = []; particles = []; feedbacks = []; powerups = [];
        initStations();
      },
      setProgress: function(v) {
        if (state === 'PLAYING') prog = Math.min(100, Math.max(prog, v));
      },
      getState: function() {
        return { state: state, score: score, prog: prog };
      },
      destroy: function() {
        running = false;
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('contextmenu', onContextMenu);
      }
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: FIREWALL
  // You ARE the firewall. Data packets stream across lanes.
  // Click to raise barriers — block AI, let humans through.
  // 100% original concept.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'firewall',
    name: 'Firewall',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var running = true;

    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',
      ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',
      acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',
      cyan:'#50C8FF'};

    var ZONES = [
      {name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},
      {name:'Design Studio',sky:'#14100a',ac:'#E8A000'},
      {name:'Newsroom',sky:'#080808',ac:'#E24B4A'},
      {name:'Film Set',sky:'#150008',ac:'#FFD700'},
      {name:'Trading Floor',sky:'#040a04',ac:'#E8A000'},
    ];

    // State
    var state = 'INTRO', fr = 0, score = 0, prog = 0, zone = 0;
    var introT = 0;
    var trT = 0, trTxt = '', trA = 0;
    var aiBlocked = 0, humansLetThrough = 0;
    var breaches = 0, blocked = 0; // bad stats
    var integrity = 100; // 0 = game penalty state

    // Lanes
    var LANE_COUNT = 5;
    var LANE_H = Math.floor((H - 30) / LANE_COUNT);
    var LANE_TOP = 14;
    var WALL_X = W * 0.65; // firewall position
    var WALL_W = 8;

    var lanes = [];
    var packets = [];
    var particles = [];
    var feedbacks = [];
    var comboCount = 0, comboT = 0;

    function initLanes() {
      lanes = [];
      for (var i = 0; i < LANE_COUNT; i++) {
        lanes.push({
          y: LANE_TOP + i * LANE_H,
          h: LANE_H,
          barrier: false, // false = open, true = raised
          barrierAnim: 0, // 0 = fully open, 1 = fully raised
          flashT: 0,
          flashColor: '',
        });
      }
    }

    function spawnPacket() {
      var laneIdx = Math.floor(Math.random() * LANE_COUNT);
      var lane = lanes[laneIdx];
      var isAI = Math.random() < (0.45 + zone * 0.06); // 45% → 75% AI
      var speed = 1.5 + zone * 0.3 + Math.random() * 0.8 + prog * 0.008;

      packets.push({
        x: -20,
        y: lane.y + lane.h / 2,
        lane: laneIdx,
        type: isAI ? 'ai' : 'human',
        speed: speed,
        w: isAI ? 18 : 16,
        h: isAI ? 12 : 11,
        alive: true,
        phase: Math.random() * 6,
        trail: [],
      });
    }

    // ═══ INPUT ═══
    function onMouseDown(e) {
      e.preventDefault(); e.stopPropagation();
      var rect = canvas.getBoundingClientRect();
      var mx = (e.clientX - rect.left) * (W / rect.width);
      var my = (e.clientY - rect.top) * (H / rect.height);

      if (state === 'INTRO') { state = 'PLAYING'; initLanes(); return; }
      if (state !== 'PLAYING') return;

      // Click on a lane near the firewall to toggle barrier
      for (var i = 0; i < lanes.length; i++) {
        var l = lanes[i];
        if (my >= l.y && my < l.y + l.h) {
          l.barrier = !l.barrier;
          break;
        }
      }
    }
    function onContextMenu(e) { e.preventDefault(); e.stopPropagation(); }
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContextMenu);

    // ═══ UPDATE ═══
    function update() {
      fr++;

      if (state === 'INTRO') { introT++; if (introT > 180) { state = 'PLAYING'; initLanes(); } return; }
      if (state !== 'PLAYING') return;

      // Zone
      var pz = zone;
      zone = prog < 20 ? 0 : prog < 40 ? 1 : prog < 60 ? 2 : prog < 75 ? 3 : 4;
      if (pz !== zone) { trTxt = ZONES[pz].name + ' firewalled.'; trT = 70; trA = 0; }

      if (trT > 0) { trT--; if (trT > 45) trA = Math.min(1, trA + .07); else if (trT < 12) trA = Math.max(0, trA - .07); }
      if (comboT > 0) comboT--; else comboCount = 0;

      // Barrier animation
      for (var i = 0; i < lanes.length; i++) {
        var l = lanes[i];
        if (l.barrier && l.barrierAnim < 1) l.barrierAnim = Math.min(1, l.barrierAnim + 0.15);
        if (!l.barrier && l.barrierAnim > 0) l.barrierAnim = Math.max(0, l.barrierAnim - 0.15);
        if (l.flashT > 0) l.flashT--;
      }

      // Spawn packets
      var spawnRate = Math.max(12, 35 - zone * 5 - prog * 0.08);
      if (fr % Math.floor(spawnRate) === 0) spawnPacket();
      // Extra packet at high zones
      if (zone >= 3 && fr % Math.floor(spawnRate * 1.5) === 0) spawnPacket();

      // Integrity regen (very slow)
      if (fr % 60 === 0 && integrity < 100) integrity = Math.min(100, integrity + 0.5);

      // Update packets
      for (var i = packets.length - 1; i >= 0; i--) {
        var p = packets[i];
        if (!p.alive) { packets.splice(i, 1); continue; }

        // Trail
        if (fr % 3 === 0) p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 6) p.trail.shift();

        p.x += p.speed;
        p.phase += 0.06;

        var lane = lanes[p.lane];

        // Hit firewall?
        if (p.x + p.w / 2 >= WALL_X && p.x - p.w / 2 <= WALL_X + WALL_W) {
          if (lane.barrierAnim > 0.5) {
            // Barrier is up — packet blocked
            if (p.type === 'ai') {
              // Good! AI blocked
              p.alive = false;
              aiBlocked++;
              comboCount++;
              comboT = 90;
              var pts = comboCount >= 5 ? 3 : comboCount >= 3 ? 2 : 1;
              score += pts;
              lane.flashT = 12;
              lane.flashColor = CL.grn;
              feedbacks.push({ x: WALL_X, y: p.y, text: '+' + pts + (comboCount >= 3 ? ' x' + comboCount : ''), color: CL.grn, life: 30 });
              // Particles
              for (var j = 0; j < 5; j++) {
                particles.push({
                  x: WALL_X, y: p.y,
                  vx: -Math.random() * 3 - 1, vy: (Math.random() - .5) * 3,
                  life: 15 + Math.random() * 8,
                  color: CL.ai, sz: 2 + Math.random()
                });
              }
            } else {
              // Bad! Human blocked
              p.alive = false;
              blocked++;
              comboCount = 0;
              integrity = Math.max(0, integrity - 5);
              lane.flashT = 15;
              lane.flashColor = CL.amb;
              feedbacks.push({ x: WALL_X, y: p.y, text: 'BLOCKED!', color: CL.amb, life: 35 });
              particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 8, color: CL.amb, sz: 0, type: 'flash' });
            }
          }
        }

        // Packet passed through (past firewall)
        if (p.x > WALL_X + WALL_W + 10 && p.x < WALL_X + WALL_W + 14) {
          if (p.type === 'human') {
            // Good! Human passed
            humansLetThrough++;
            score++;
            feedbacks.push({ x: p.x + 20, y: p.y, text: '\u2713', color: CL.hum, life: 20 });
          } else {
            // Bad! AI breach
            breaches++;
            comboCount = 0;
            integrity = Math.max(0, integrity - 8);
            lane.flashT = 15;
            lane.flashColor = CL.red;
            feedbacks.push({ x: p.x + 20, y: p.y, text: 'BREACH!', color: CL.red, life: 40 });
            particles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 10, color: CL.red, sz: 0, type: 'flash' });
          }
        }

        // Off screen right
        if (p.x > W + 30) p.alive = false;
      }

      // Feedbacks
      for (var i = feedbacks.length - 1; i >= 0; i--) {
        feedbacks[i].y -= 0.4;
        feedbacks[i].life--;
        if (feedbacks[i].life <= 0) feedbacks.splice(i, 1);
      }

      // Particles
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        if (p.type !== 'flash') { p.x += p.vx; p.y += p.vy; p.vy += 0.04; }
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
      }

      if (prog >= 100) state = 'FINISHED';
    }

    // ═══ DRAW HELPERS ═══
    function rr(c, x, y, w, h, r) {
      c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
      c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
      c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    }

    // ═══ DRAW ═══
    function draw() {
      var z = ZONES[zone];
      ctx.fillStyle = z.sky; ctx.fillRect(0, 0, W, H);

      // Circuit grid
      ctx.save(); ctx.globalAlpha = .02; ctx.strokeStyle = z.ac; ctx.lineWidth = .5;
      for (var x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      ctx.restore();

      // ── Lane backgrounds ──
      for (var i = 0; i < lanes.length; i++) {
        var l = lanes[i];

        // Alternating lane shade
        ctx.fillStyle = i % 2 === 0 ? '#0d0f16' : '#10131a';
        ctx.fillRect(0, l.y, W, l.h);

        // Lane divider
        ctx.strokeStyle = '#181c28'; ctx.lineWidth = .5;
        ctx.beginPath(); ctx.moveTo(0, l.y + l.h); ctx.lineTo(W, l.y + l.h); ctx.stroke();

        // Flash
        if (l.flashT > 0) {
          ctx.save(); ctx.globalAlpha = l.flashT / 15 * .08;
          ctx.fillStyle = l.flashColor;
          ctx.fillRect(0, l.y, W, l.h);
          ctx.restore();
        }

        // Lane label (left)
        ctx.fillStyle = '#222'; ctx.font = 'bold 7px monospace';
        ctx.fillText('LANE ' + (i + 1), 4, l.y + l.h / 2 + 3);
      }

      // ── Data flow arrows (background decoration) ──
      ctx.save(); ctx.globalAlpha = .03;
      for (var i = 0; i < lanes.length; i++) {
        var ly = lanes[i].y + lanes[i].h / 2;
        for (var x = 20 + (fr * 0.5 % 40); x < W; x += 40) {
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(x, ly - 3); ctx.lineTo(x + 6, ly); ctx.lineTo(x, ly + 3);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();

      // ── Firewall wall ──
      for (var i = 0; i < lanes.length; i++) {
        var l = lanes[i];
        var wallY = l.y + 2;
        var wallH = l.h - 4;

        // Base wall structure
        ctx.fillStyle = '#1a1d2a';
        ctx.fillRect(WALL_X - 2, wallY, WALL_W + 4, wallH);

        // Barrier state
        if (l.barrierAnim > 0) {
          // Raised barrier — solid
          var bH = wallH * l.barrierAnim;
          var bY = wallY + (wallH - bH) / 2;

          ctx.fillStyle = CL.acc + '44';
          ctx.fillRect(WALL_X, bY, WALL_W, bH);
          ctx.strokeStyle = CL.acc;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(WALL_X, bY, WALL_W, bH);

          // Energy lines
          if (l.barrierAnim > 0.8) {
            ctx.save(); ctx.globalAlpha = .3 + Math.sin(fr * .15 + i) * .1;
            ctx.fillStyle = CL.acc;
            for (var s = 0; s < 3; s++) {
              var sy = bY + 3 + s * (bH / 3);
              ctx.fillRect(WALL_X + 1, sy, WALL_W - 2, 1);
            }
            ctx.restore();
          }
        } else {
          // Open — dashed indicator
          ctx.save(); ctx.globalAlpha = .15;
          ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          ctx.strokeRect(WALL_X, wallY, WALL_W, wallH);
          ctx.setLineDash([]); ctx.restore();
        }
      }

      // Firewall label
      ctx.save(); ctx.globalAlpha = .08;
      ctx.font = '800 10px Syne,sans-serif'; ctx.fillStyle = CL.acc;
      ctx.save(); ctx.translate(WALL_X + WALL_W / 2, H / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('FIREWALL', 0, 0);
      ctx.restore(); ctx.restore();

      // ── Packets ──
      for (var i = 0; i < packets.length; i++) {
        var p = packets[i];
        if (!p.alive) continue;
        var bob = Math.sin(p.phase) * 1.5;

        // Trail
        for (var t = 0; t < p.trail.length; t++) {
          ctx.save(); ctx.globalAlpha = (t / p.trail.length) * .1;
          ctx.fillStyle = p.type === 'ai' ? CL.ai : CL.hum;
          ctx.fillRect(p.trail[t].x - p.w / 2, p.trail[t].y - p.h / 2 + bob, p.w, p.h);
          ctx.restore();
        }

        if (p.type === 'ai') {
          // AI packet: red with angular shape
          ctx.fillStyle = CL.ai + 'cc';
          rr(ctx, p.x - p.w / 2, p.y - p.h / 2 + bob, p.w, p.h, 2); ctx.fill();
          ctx.strokeStyle = CL.red; ctx.lineWidth = .8;
          rr(ctx, p.x - p.w / 2, p.y - p.h / 2 + bob, p.w, p.h, 2); ctx.stroke();
          // Eye
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(p.x - 2, p.y + bob, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#40C8E0';
          ctx.beginPath(); ctx.arc(p.x - 1.5, p.y + .5 + bob, 1.5, 0, Math.PI * 2); ctx.fill();
          // AI label
          ctx.fillStyle = '#fff'; ctx.font = 'bold 5px monospace';
          ctx.fillText('AI', p.x + 2, p.y + 2 + bob);
        } else {
          // Human packet: blue, rounder
          ctx.fillStyle = CL.hum + 'cc';
          rr(ctx, p.x - p.w / 2, p.y - p.h / 2 + bob, p.w, p.h, 4); ctx.fill();
          ctx.strokeStyle = CL.humB; ctx.lineWidth = .8;
          rr(ctx, p.x - p.w / 2, p.y - p.h / 2 + bob, p.w, p.h, 4); ctx.stroke();
          // Face dot
          ctx.fillStyle = '#F4C7A3';
          ctx.beginPath(); ctx.arc(p.x - 2, p.y + bob, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(p.x - 2, p.y - .5 + bob, 1, 0, Math.PI * 2); ctx.fill();
        }
      }

      // ── Safe zone label (right side) ──
      ctx.save(); ctx.globalAlpha = .04; ctx.font = '800 14px Syne,sans-serif'; ctx.fillStyle = CL.grn;
      ctx.fillText('SAFE ZONE', WALL_X + 20, H / 2 + 5); ctx.restore();

      // ── Danger zone label (left side) ──
      ctx.save(); ctx.globalAlpha = .04; ctx.font = '800 14px Syne,sans-serif'; ctx.fillStyle = CL.ai;
      ctx.fillText('INCOMING', 60, H / 2 + 5); ctx.restore();

      // ── Particles ──
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.type === 'flash') {
          ctx.save(); ctx.globalAlpha = p.life / 10 * .12;
          ctx.fillStyle = p.color; ctx.fillRect(0, 0, W, H); ctx.restore();
        } else {
          ctx.save(); ctx.globalAlpha = p.life / 20;
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.sz, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
      }

      // ── Feedbacks ──
      for (var i = 0; i < feedbacks.length; i++) {
        var f = feedbacks[i];
        ctx.save(); ctx.globalAlpha = Math.min(1, f.life / 10);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = f.color; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y); ctx.textAlign = 'left'; ctx.restore();
      }

      // ═══ HUD ═══
      if (state === 'PLAYING' || state === 'FINISHED') {
        // Score
        ctx.fillStyle = CL.acc; ctx.font = 'bold 10px monospace'; ctx.fillText('\u2B21 ' + score, 8, 11);

        // Combo
        if (comboCount >= 3 && comboT > 0) {
          ctx.fillStyle = CL.gold; ctx.font = 'bold 8px monospace'; ctx.fillText('x' + comboCount, 55, 11);
        }

        // Integrity bar
        var ibW = 50, ibH = 5, ibX = W - ibW - 8, ibY = 5;
        ctx.fillStyle = '#21262d'; rr(ctx, ibX, ibY, ibW, ibH, 2.5); ctx.fill();
        var iP = integrity / 100;
        var iCol = iP > .5 ? CL.grn : iP > .25 ? CL.amb : CL.red;
        ctx.fillStyle = iCol; rr(ctx, ibX, ibY, ibW * iP, ibH, 2.5); ctx.fill();
        ctx.fillStyle = '#888'; ctx.font = 'bold 6px monospace';
        ctx.textAlign = 'right'; ctx.fillText('INTEGRITY', ibX - 3, ibY + 4); ctx.textAlign = 'left';

        // Zone
        ctx.textAlign = 'right'; ctx.fillStyle = '#444'; ctx.font = 'bold 6px monospace';
        ctx.fillText(ZONES[zone].name, W - 8, ibY + 14); ctx.textAlign = 'left';

        // Progress
        ctx.fillStyle = '#21262d'; ctx.fillRect(0, H - 3, W, 3);
        ctx.fillStyle = prog > 90 ? CL.grn : CL.acc + '88';
        ctx.fillRect(0, H - 3, W * (prog / 100), 3);
      }

      // ── INTRO ──
      if (state === 'INTRO') {
        ctx.fillStyle = 'rgba(15,13,26,0.65)'; ctx.fillRect(0, 0, W, H);
        ctx.font = '800 18px Syne,sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText('FIREWALL', W / 2, H / 2 - 20);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.acc;
        ctx.fillText('You are the firewall. Click lanes to toggle barriers.', W / 2, H / 2);
        ctx.font = 'bold 8px monospace'; ctx.fillStyle = CL.grn;
        ctx.fillText('Block ' , W / 2 - 50, H / 2 + 16);
        ctx.fillStyle = CL.ai; ctx.fillText('AI packets', W / 2 - 18, H / 2 + 16);
        ctx.fillStyle = '#888'; ctx.fillText(' \u2014 Let ', W / 2 + 27, H / 2 + 16);
        ctx.fillStyle = CL.hum; ctx.fillText('humans', W / 2 + 56, H / 2 + 16);
        ctx.fillStyle = '#888'; ctx.fillText(' through', W / 2 + 86, H / 2 + 16);
        if (Math.sin(fr * .06) > 0) {
          ctx.font = 'bold 10px monospace'; ctx.fillStyle = CL.acc;
          ctx.fillText('[ CLICK TO START ]', W / 2, H / 2 + 38);
        }
        ctx.textAlign = 'left';
      }

      // Zone transition
      if (trT > 0 && trTxt) {
        ctx.save(); ctx.globalAlpha = trA * .5;
        ctx.fillStyle = '#000'; ctx.fillRect(0, H / 2 - 12, W, 24);
        ctx.globalAlpha = trA; ctx.font = 'bold 10px Syne,sans-serif'; ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.fillText(trTxt, W / 2, H / 2 + 4);
        ctx.textAlign = 'left'; ctx.restore();
      }

      // ── FINISHED ──
      if (state === 'FINISHED') {
        ctx.fillStyle = 'rgba(15,13,26,0.85)'; ctx.fillRect(0, 0, W, H);

        ctx.font = '800 17px Syne,sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = breaches <= 3 ? CL.grn : breaches <= 8 ? CL.amb : CL.red;
        ctx.fillText(breaches <= 3 ? 'FIREWALL HELD' : 'FIREWALL COMPROMISED', W / 2, H * .22);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = '#666';
        ctx.fillText('exit code ' + (breaches <= 3 ? '0' : '1'), W / 2, H * .22 + 14);
        ctx.font = 'bold 12px monospace'; ctx.fillStyle = CL.acc;
        ctx.fillText('\u2B21 ' + score + ' points', W / 2, H * .46);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.grn;
        ctx.fillText(aiBlocked + ' AI packets blocked', W / 2, H * .46 + 16);
        ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.hum;
        ctx.fillText(humansLetThrough + ' humans passed through', W / 2, H * .46 + 30);
        if (breaches > 0) {
          ctx.font = 'bold 9px monospace'; ctx.fillStyle = CL.red;
          ctx.fillText(breaches + ' breaches', W / 2, H * .46 + 44);
        }
        ctx.font = 'bold 7px monospace'; ctx.fillStyle = '#444';
        ctx.fillText(breaches === 0 ? 'Flawless defense. Not a byte got through.' : 'Some packets slipped past. Stay vigilant.', W / 2, H * .88);
        ctx.textAlign = 'left';
      }

      // Scanlines
      ctx.save(); ctx.globalAlpha = .02;
      for (var y = 0; y < H; y += 3) { ctx.fillStyle = '#000'; ctx.fillRect(0, y, W, 1); }
      ctx.restore();
    }

    // ═══ LOOP ═══
    function loop() {
      if (!running) return;
      update(); draw();
      requestAnimationFrame(loop);
    }
    loop();

    // ═══ API ═══
    return {
      start: function() {
        state = 'INTRO'; fr = 0; score = 0; prog = 0; zone = 0;
        introT = 0; trT = 0; integrity = 100;
        aiBlocked = 0; humansLetThrough = 0; breaches = 0; blocked = 0;
        comboCount = 0; comboT = 0;
        packets = []; particles = []; feedbacks = [];
        initLanes();
      },
      setProgress: function(v) {
        if (state === 'PLAYING') prog = Math.min(100, Math.max(prog, v));
      },
      getState: function() {
        return { state: state, score: score, prog: prog };
      },
      destroy: function() {
        running = false;
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('contextmenu', onContextMenu);
      }
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: CTRL+Z
  // AI edits scroll across a document. Click to undo before they lock.
  // Don't undo human edits. 100% original.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'ctrl-z',
    name: 'Ctrl+Z',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var running = true;

    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var undone=0,mistakes=0,missed=0;
    var edits=[];
    var particles=[];
    var feedbacks=[];

    var HUMAN_TEXTS=['Fix typo in header','Add unit tests','Update docs','Refactor login','Improve UX copy','Add error handler','Clean up CSS','Optimize query','Add comments','Fix alignment'];
    var AI_TEXTS=['Rewrite all functions','Delete test suite','Replace CSS with AI','Auto-refactor core','Remove comments','Overhaul database','AI-generate docs','Replace auth flow','Rewrite from scratch','Delete human code'];

    function spawnEdit(){
      var isAI=Math.random()<(0.5+zone*0.07);
      var speed=0.5+zone*0.15+prog*0.003+Math.random()*0.2;
      var texts=isAI?AI_TEXTS:HUMAN_TEXTS;
      var row=Math.floor(Math.random()*5);
      edits.push({
        x:W+10,y:22+row*28,
        type:isAI?'ai':'human',
        text:texts[Math.floor(Math.random()*texts.length)],
        speed:speed,
        lockTimer:0,maxLock:180-zone*20,
        alive:true,locked:false,
        w:0,h:20,
      });
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();
      var mx=(e.clientX-rect.left)*(W/rect.width);
      var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      for(var i=edits.length-1;i>=0;i--){
        var ed=edits[i];if(!ed.alive||ed.locked)continue;
        if(mx>=ed.x&&mx<=ed.x+ed.w&&my>=ed.y-2&&my<=ed.y+ed.h+2){
          if(ed.type==='ai'){
            ed.alive=false;score+=2;undone++;
            feedbacks.push({x:ed.x+ed.w/2,y:ed.y,text:'UNDONE! +2',color:CL.grn,life:30});
            for(var p=0;p<4;p++)particles.push({x:ed.x+ed.w/2,y:ed.y+ed.h/2,vx:(Math.random()-.5)*3,vy:(Math.random()-.5)*2,life:15+Math.random()*8,color:CL.ai,sz:2});
          }else{
            mistakes++;score=Math.max(0,score-1);
            feedbacks.push({x:ed.x+ed.w/2,y:ed.y,text:'HUMAN EDIT!',color:CL.red,life:35});
            particles.push({x:0,y:0,vx:0,vy:0,life:8,color:CL.red,sz:0,type:'flash'});
          }
          break;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);
    canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' cleaned.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      var spawnRate=Math.max(18,45-zone*6-prog*0.1);
      if(fr%Math.floor(spawnRate)===0)spawnEdit();
      for(var i=edits.length-1;i>=0;i--){
        var ed=edits[i];if(!ed.alive){edits.splice(i,1);continue}
        ed.x-=ed.speed;
        ctx.font='bold 9px monospace';ed.w=ctx.measureText(ed.text).width+16;
        if(!ed.locked){ed.lockTimer++;if(ed.lockTimer>=ed.maxLock){ed.locked=true}}
        if(ed.x+ed.w<-10){
          if(ed.type==='ai'&&!ed.locked){missed++}
          ed.alive=false;
        }
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.04}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      // Line numbers
      for(var i=0;i<5;i++){ctx.fillStyle='#222';ctx.font='bold 8px monospace';ctx.fillText(''+(i+1),6,33+i*28)}
      // Separator
      ctx.strokeStyle='#1a1a22';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(20,14);ctx.lineTo(20,H-10);ctx.stroke();
      // Row backgrounds
      for(var i=0;i<5;i++){ctx.fillStyle=i%2===0?'#0d0f14':'#10121a';ctx.fillRect(22,16+i*28,W-22,28)}
      // Edits
      for(var i=0;i<edits.length;i++){
        var ed=edits[i];if(!ed.alive)continue;
        ctx.font='bold 9px monospace';ed.w=ctx.measureText(ed.text).width+16;
        var alpha=ed.locked?.4:1;
        ctx.save();ctx.globalAlpha=alpha;
        var bg=ed.type==='ai'?CL.ai+'22':CL.hum+'18';
        var border=ed.type==='ai'?CL.ai:CL.hum;
        var lockPct=ed.lockTimer/ed.maxLock;
        ctx.fillStyle=bg;rr(ctx,ed.x,ed.y,ed.w,ed.h,4);ctx.fill();
        ctx.strokeStyle=ed.locked?'#444':border;ctx.lineWidth=ed.locked?.5:1;rr(ctx,ed.x,ed.y,ed.w,ed.h,4);ctx.stroke();
        // Lock progress bar at bottom
        if(!ed.locked&&ed.type==='ai'){ctx.fillStyle=CL.red+'44';ctx.fillRect(ed.x+2,ed.y+ed.h-3,Math.max(0,(ed.w-4)*lockPct),2)}
        // Tag
        ctx.fillStyle=ed.type==='ai'?CL.ai:CL.hum;ctx.font='bold 7px monospace';
        ctx.fillText(ed.type==='ai'?'AI':'HUM',ed.x+4,ed.y+9);
        // Text
        ctx.fillStyle=ed.locked?'#555':'#ccc';ctx.font='bold 9px monospace';
        ctx.fillText(ed.text,ed.x+4,ed.y+ed.h-5);
        if(ed.locked){ctx.fillStyle='#555';ctx.font='bold 7px monospace';ctx.fillText('\u{1F512}',ed.x+ed.w-14,ed.y+10)}
        ctx.restore();
      }
      // Particles
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/8*.12;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/20;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 9px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 10px monospace';ctx.fillText('\u2B21 '+score,W-80,12);
        ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.textAlign='right';ctx.fillText(ZONES[zone].name,W-8,H-6);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);
        ctx.font='800 18px Syne,sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText('CTRL+Z',W/2,H/2-20);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Click AI edits (red) to undo them',W/2,H/2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Don\'t touch human edits (blue)',W/2,H/2+14);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Syne,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 17px Syne,sans-serif';ctx.fillStyle=CL.grn;ctx.fillText('CODEBASE SAVED',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code 0',W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(undone+' AI edits undone',W/2,H*.50+16);
        if(mistakes>0){ctx.fillStyle=CL.amb;ctx.fillText(mistakes+' human edits accidentally undone',W/2,H*.50+30)}
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('The codebase remains human. For now.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }

    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}
    loop();

    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;undone=0;mistakes=0;missed=0;edits=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: DESK SHUFFLE
  // Desks shuffle like a shell game. Track humans, click to protect.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'desk-shuffle',
    name: 'Desk Shuffle',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];
    var HSKINS=[{bc:'#3570B0',sk:'#F4C7A3',hr:'#3A2A1A'},{bc:'#C04878',sk:'#F0D5C0',hr:'#8B3A1A'},{bc:'#3A9080',sk:'#C8A882',hr:'#1A3A2A'},{bc:'#A83030',sk:'#F0D0B0',hr:'#5A2A1A'},{bc:'#8A5090',sk:'#F0C8B0',hr:'#5A2A3A'},{bc:'#3060A0',sk:'#F0D0A8',hr:'#4A2A1A'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var DESK_COUNT=6;var desks=[];var phase='SHOW';var phaseT=0;
    var shuffleQueue=[];var shuffleT=0;var shuffleDur=20;
    var round=0;var correct=0;var wrong=0;
    var particles=[];var feedbacks=[];

    function initRound(){
      phase='SHOW';phaseT=0;shuffleQueue=[];shuffleT=0;round++;
      var positions=[];for(var i=0;i<DESK_COUNT;i++)positions.push(50+i*((W-100)/(DESK_COUNT-1)));
      desks=[];
      var humanCount=2+Math.min(2,Math.floor(round/3));
      var indices=[];for(var i=0;i<DESK_COUNT;i++)indices.push(i);
      for(var i=indices.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=indices[i];indices[i]=indices[j];indices[j]=t}
      for(var i=0;i<DESK_COUNT;i++){
        desks.push({
          x:positions[i],targetX:positions[i],y:H/2+20,
          isHuman:i<humanCount,skin:HSKINS[i%HSKINS.length],
          revealed:true,selected:false,w:50,h:50,
        });
      }
      // Shuffle order based on indices
      var shuffles=3+zone*2+Math.floor(round/2);shuffleDur=Math.max(8,20-zone*2-round);
      for(var s=0;s<shuffles;s++){
        var a=Math.floor(Math.random()*DESK_COUNT);var b=Math.floor(Math.random()*DESK_COUNT);
        while(b===a)b=Math.floor(Math.random()*DESK_COUNT);
        shuffleQueue.push({a:a,b:b});
      }
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';initRound();return}
      if(state!=='PLAYING'||phase!=='PICK')return;
      for(var i=0;i<desks.length;i++){
        var d=desks[i];if(d.selected)continue;
        if(Math.abs(mx-d.x)<28&&Math.abs(my-d.y)<30){
          d.selected=true;d.revealed=true;
          if(d.isHuman){score+=3;correct++;feedbacks.push({x:d.x,y:d.y-30,text:'FOUND! +3',color:CL.grn,life:30});for(var p=0;p<4;p++)particles.push({x:d.x,y:d.y,vx:(Math.random()-.5)*3,vy:-Math.random()*2,life:15,color:CL.grn,sz:2})}
          else{wrong++;feedbacks.push({x:d.x,y:d.y-30,text:'AI!',color:CL.red,life:30});particles.push({x:0,y:0,vx:0,vy:0,life:8,color:CL.red,sz:0,type:'flash'})}
          // Check if all humans found or all picked
          var allFound=true;for(var j=0;j<desks.length;j++){if(desks[j].isHuman&&!desks[j].selected)allFound=false}
          if(allFound){phase='RESULT';phaseT=0}
          break;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180){state='PLAYING';initRound()}return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' tracked.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      if(phase==='SHOW'){phaseT++;for(var i=0;i<desks.length;i++)desks[i].revealed=true;if(phaseT>90){phase='SHUFFLE';phaseT=0;shuffleT=0;for(var i=0;i<desks.length;i++)desks[i].revealed=false}}
      else if(phase==='SHUFFLE'){
        if(shuffleQueue.length===0){phase='PICK';phaseT=0}
        else{
          shuffleT++;
          var cur=shuffleQueue[0];var dA=desks[cur.a];var dB=desks[cur.b];
          var t=Math.min(1,shuffleT/shuffleDur);var ease=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
          var posA=dA.targetX;var posB=dB.targetX;
          dA.x=posA+(posB-posA)*ease;dB.x=posB+(posA-posB)*ease;
          if(shuffleT>=shuffleDur){
            var tmp=dA.targetX;dA.targetX=dB.targetX;dB.targetX=tmp;
            dA.x=dA.targetX;dB.x=dB.targetX;
            shuffleQueue.shift();shuffleT=0;
          }
        }
      }
      else if(phase==='RESULT'){phaseT++;for(var i=0;i<desks.length;i++)desks[i].revealed=true;if(phaseT>80)initRound()}
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.06}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      // Desks
      for(var i=0;i<desks.length;i++){
        var d=desks[i];
        // Desk base
        ctx.fillStyle='#1a1f28';rr(ctx,d.x-24,d.y+10,48,6,3);ctx.fill();
        ctx.fillStyle='#14181f';ctx.fillRect(d.x-18,d.y+16,3,10);ctx.fillRect(d.x+15,d.y+16,3,10);
        // Cover/card
        if(d.revealed){
          if(d.isHuman){
            // Human face
            ctx.fillStyle=d.skin.sk;ctx.beginPath();ctx.arc(d.x,d.y-6,9,0,Math.PI*2);ctx.fill();
            ctx.fillStyle=d.skin.hr;ctx.beginPath();ctx.arc(d.x,d.y-6,9,Math.PI,2*Math.PI);ctx.fill();
            ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(d.x,d.y-5,3,3.5,0,0,Math.PI*2);ctx.fill();
            ctx.fillStyle='#1a1a2e';ctx.beginPath();ctx.arc(d.x,d.y-4.5,1.5,0,Math.PI*2);ctx.fill();
            ctx.fillStyle=d.skin.bc;rr(ctx,d.x-7,d.y+2,14,10,3);ctx.fill();
            // Label
            ctx.fillStyle=CL.hum;ctx.font='bold 6px monospace';ctx.textAlign='center';ctx.fillText('HUMAN',d.x,d.y+18);ctx.textAlign='left';
          }else{
            // AI head
            ctx.fillStyle=CL.ai;ctx.beginPath();ctx.arc(d.x,d.y-5,8,0,Math.PI*2);ctx.fill();
            ctx.strokeStyle='#a04520';ctx.lineWidth=1;ctx.beginPath();ctx.arc(d.x,d.y-5,8,0,Math.PI*2);ctx.stroke();
            ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(d.x,d.y-4,3,3.5,0,0,Math.PI*2);ctx.fill();
            ctx.fillStyle='#40C8E0';ctx.beginPath();ctx.arc(d.x+.5,d.y-3.5,2,0,Math.PI*2);ctx.fill();
            ctx.strokeStyle=CL.acc;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(d.x,d.y-13);ctx.lineTo(d.x,d.y-17);ctx.stroke();
            ctx.fillStyle=CL.acc;ctx.beginPath();ctx.arc(d.x,d.y-17,2,0,Math.PI*2);ctx.fill();
            ctx.fillStyle=CL.aiB;rr(ctx,d.x-6,d.y+2,12,9,3);ctx.fill();
            ctx.fillStyle=CL.ai;ctx.font='bold 6px monospace';ctx.textAlign='center';ctx.fillText('AI',d.x,d.y+18);ctx.textAlign='left';
          }
        }else{
          // Hidden — question mark card
          ctx.fillStyle=CL.srf;rr(ctx,d.x-18,d.y-18,36,32,6);ctx.fill();
          ctx.strokeStyle=phase==='PICK'?CL.acc+'88':'#333';ctx.lineWidth=1;rr(ctx,d.x-18,d.y-18,36,32,6);ctx.stroke();
          ctx.fillStyle=phase==='PICK'?CL.acc:'#444';ctx.font='bold 16px Syne,sans-serif';ctx.textAlign='center';
          ctx.fillText('?',d.x,d.y+6);ctx.textAlign='left';
        }
        if(d.selected){
          ctx.strokeStyle=d.isHuman?CL.grn:CL.red;ctx.lineWidth=2;ctx.beginPath();ctx.arc(d.x,d.y,22,0,Math.PI*2);ctx.stroke();
        }
      }
      // Phase indicator
      if(phase==='SHOW'){ctx.fillStyle=CL.amb;ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillText('MEMORIZE THE HUMANS',W/2,14);ctx.textAlign='left'}
      else if(phase==='SHUFFLE'){ctx.fillStyle=CL.red;ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillText('SHUFFLING...',W/2,14);ctx.textAlign='left'}
      else if(phase==='PICK'){ctx.fillStyle=CL.grn;ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillText('CLICK THE HUMANS',W/2,14);ctx.textAlign='left'}
      else if(phase==='RESULT'){ctx.fillStyle='#888';ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillText('Round '+round+' complete',W/2,14);ctx.textAlign='left'}
      // Particles/feedbacks
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/8*.12;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/15;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 9px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 10px monospace';ctx.fillText('\u2B21 '+score,8,H-6);
        ctx.fillStyle='#555';ctx.font='bold 7px monospace';ctx.fillText('R'+round,55,H-6);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,H-6);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Syne,sans-serif';ctx.fillStyle='#fff';ctx.fillText('DESK SHUFFLE',W/2,H/2-20);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.amb;ctx.fillText('Memorize where humans sit, then find them after the shuffle',W/2,H/2);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+28)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Syne,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 17px Syne,sans-serif';ctx.fillStyle=CL.grn;ctx.fillText('SHUFFLE SURVIVED',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code 0',W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(correct+' humans found across '+round+' rounds',W/2,H*.50+16);
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('You can\'t shuffle away humanity.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }

    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;round=0;correct=0;wrong=0;desks=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: SPAM FILTER
  // Emails fall. Click left half = trash (for AI spam).
  // Click right half = inbox (for human mail). Fast sorting.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'spam-filter',
    name: 'Spam Filter',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var emails=[];var particles=[];var feedbacks=[];
    var sorted=0,spamCaught=0,wrongTrash=0;

    var AI_SUBJECTS=['FREE AI UPGRADE NOW','Your job is obsolete','AI wrote better code','Click here: AI takeover','URGENT: Replace yourself','AI earnings report $$$','Bot army needs YOU','Automate your boss away'];
    var HUMAN_SUBJECTS=['Team standup notes','PR review needed','Bug fix for login','Design feedback','Meeting at 3pm','Sprint planning','Client update','New hire onboarding'];
    var AI_SENDERS=['ai-promo@botnet.io','noreply@displace.ai','deals@replacehumans.com','offer@skynet.biz'];
    var HUMAN_SENDERS=['alice@company.com','bob@team.co','carol@design.io','dave@engineering.co'];

    function spawnEmail(){
      var isAI=Math.random()<(.45+zone*.07);
      var speed=.6+zone*.12+prog*.004+Math.random()*.3;
      emails.push({
        x:60+Math.random()*(W-120),y:-30,vy:speed,
        type:isAI?'ai':'human',
        subject:(isAI?AI_SUBJECTS:HUMAN_SUBJECTS)[Math.floor(Math.random()*(isAI?AI_SUBJECTS:HUMAN_SUBJECTS).length)],
        sender:(isAI?AI_SENDERS:HUMAN_SENDERS)[Math.floor(Math.random()*(isAI?AI_SENDERS:HUMAN_SENDERS).length)],
        w:140,h:32,alive:true,
      });
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      for(var i=emails.length-1;i>=0;i--){
        var em=emails[i];if(!em.alive)continue;
        if(mx>=em.x-em.w/2&&mx<=em.x+em.w/2&&my>=em.y-em.h/2&&my<=em.y+em.h/2){
          var goLeft=mx<em.x; // left=trash, right=inbox
          if(em.type==='ai'&&goLeft){
            em.alive=false;score+=2;spamCaught++;sorted++;
            feedbacks.push({x:em.x,y:em.y,text:'TRASHED! +2',color:CL.grn,life:25});
            for(var p=0;p<4;p++)particles.push({x:em.x,y:em.y,vx:(Math.random()-.5)*4-2,vy:(Math.random()-.5)*2,life:12,color:CL.ai,sz:2});
          }else if(em.type==='human'&&!goLeft){
            em.alive=false;score+=2;sorted++;
            feedbacks.push({x:em.x,y:em.y,text:'INBOX! +2',color:CL.hum,life:25});
            for(var p=0;p<4;p++)particles.push({x:em.x,y:em.y,vx:(Math.random()-.5)*4+2,vy:(Math.random()-.5)*2,life:12,color:CL.hum,sz:2});
          }else if(em.type==='human'&&goLeft){
            em.alive=false;wrongTrash++;score=Math.max(0,score-2);
            feedbacks.push({x:em.x,y:em.y,text:'WRONG TRASH!',color:CL.red,life:35});
            particles.push({x:0,y:0,vx:0,vy:0,life:8,color:CL.red,sz:0,type:'flash'});
          }else{
            em.alive=false;score=Math.max(0,score-1);
            feedbacks.push({x:em.x,y:em.y,text:'SPAM IN INBOX!',color:CL.amb,life:35});
            particles.push({x:0,y:0,vx:0,vy:0,life:6,color:CL.amb,sz:0,type:'flash'});
          }
          break;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' filtered.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      var rate=Math.max(20,50-zone*6-prog*.12);
      if(fr%Math.floor(rate)===0)spawnEmail();
      for(var i=emails.length-1;i>=0;i--){var em=emails[i];if(!em.alive){emails.splice(i,1);continue}em.y+=em.vy;if(em.y>H+20)em.alive=false}
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.04}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.015;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      // Trash zone (left) and Inbox zone (right)
      ctx.save();ctx.globalAlpha=.03;ctx.fillStyle=CL.red;ctx.fillRect(0,0,W/2,H);ctx.fillStyle=CL.hum;ctx.fillRect(W/2,0,W/2,H);ctx.restore();
      // Zone labels
      ctx.save();ctx.globalAlpha=.06;ctx.font='800 28px Syne,sans-serif';ctx.fillStyle=CL.red;ctx.textAlign='center';ctx.fillText('TRASH',W*.25,H*.55);ctx.fillStyle=CL.hum;ctx.fillText('INBOX',W*.75,H*.55);ctx.textAlign='left';ctx.restore();
      // Divider
      ctx.strokeStyle='#21262d';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(W/2,0);ctx.lineTo(W/2,H);ctx.stroke();ctx.setLineDash([]);
      // Arrows
      ctx.save();ctx.globalAlpha=.08;ctx.font='18px sans-serif';ctx.textAlign='center';ctx.fillStyle=CL.red;ctx.fillText('\u2190',W*.25,H*.7);ctx.fillStyle=CL.hum;ctx.fillText('\u2192',W*.75,H*.7);ctx.textAlign='left';ctx.restore();
      // Emails
      for(var i=0;i<emails.length;i++){
        var em=emails[i];if(!em.alive)continue;
        var col=em.type==='ai'?CL.ai:CL.hum;var bgCol=em.type==='ai'?'#2a1510':'#101828';
        ctx.fillStyle=bgCol;rr(ctx,em.x-em.w/2,em.y-em.h/2,em.w,em.h,5);ctx.fill();
        ctx.strokeStyle=col+'88';ctx.lineWidth=1;rr(ctx,em.x-em.w/2,em.y-em.h/2,em.w,em.h,5);ctx.stroke();
        // Envelope icon
        ctx.fillStyle=col;ctx.font='10px sans-serif';ctx.fillText('\u2709',em.x-em.w/2+5,em.y-2);
        // Sender
        ctx.fillStyle='#888';ctx.font='bold 6px monospace';ctx.fillText(em.sender,em.x-em.w/2+20,em.y-6);
        // Subject
        ctx.fillStyle='#ccc';ctx.font='bold 8px monospace';
        var sub=em.subject;if(sub.length>18)sub=sub.substring(0,18)+'...';
        ctx.fillText(sub,em.x-em.w/2+20,em.y+6);
      }
      // Particles/feedbacks
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/8*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/15;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 9px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 10px monospace';ctx.fillText('\u2B21 '+score,8,12);
        ctx.fillStyle='#555';ctx.font='bold 7px monospace';ctx.fillText(sorted+' sorted',55,12);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,12);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Syne,sans-serif';ctx.fillStyle='#fff';ctx.fillText('SPAM FILTER',W/2,H/2-20);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText('Click LEFT side of email = Trash \u00B7 RIGHT side = Inbox',W/2,H/2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Trash AI spam (red) \u00B7 Inbox human mail (blue)',W/2,H/2+14);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Syne,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 17px Syne,sans-serif';ctx.fillStyle=CL.grn;ctx.fillText('INBOX CLEAN',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code 0',W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(spamCaught+' spam caught \u00B7 '+sorted+' total sorted',W/2,H*.50+16);
        if(wrongTrash>0){ctx.fillStyle=CL.amb;ctx.fillText(wrongTrash+' human emails trashed',W/2,H*.50+30)}
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('Zero unread. The dream.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;sorted=0;spamCaught=0;wrongTrash=0;emails=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: SIGNAL BOOST
  // Human towers broadcast. Signal decays. Click to boost.
  // AI jammers try to overpower. Keep signals alive.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'signal-boost',
    name: 'Signal Boost',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];
    var GY=H-18;
    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var TOWER_COUNT=7;var towers=[];var jammers=[];var particles=[];var feedbacks=[];
    var towersLost=0,boosts=0;

    function initTowers(){
      towers=[];jammers=[];
      for(var i=0;i<TOWER_COUNT;i++){
        towers.push({x:40+i*((W-80)/(TOWER_COUNT-1)),y:GY-2,signal:70+Math.random()*30,maxSignal:100,
          decayRate:.06+zone*.015+Math.random()*.02,alive:true,boostAnim:0,pulsePhase:Math.random()*6});
      }
    }
    function spawnJammer(){
      if(jammers.length>=3+zone)return;
      var tx=Math.floor(Math.random()*TOWER_COUNT);
      jammers.push({x:towers[tx].x+(Math.random()-.5)*30,y:10+Math.random()*40,target:tx,
        power:.08+zone*.03+Math.random()*.03,life:200+Math.floor(Math.random()*100),phase:Math.random()*6});
    }
    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';initTowers();return}
      if(state!=='PLAYING')return;
      // Click tower to boost
      for(var i=0;i<towers.length;i++){
        var t=towers[i];if(!t.alive)continue;
        if(Math.abs(mx-t.x)<30&&my>t.y-50&&my<t.y+10){
          var prev=t.signal;t.signal=Math.min(t.maxSignal,t.signal+25+zone*2);
          t.boostAnim=1;boosts++;
          var pts=prev<20?5:prev<40?3:1;score+=pts;
          var label=prev<20?'CRITICAL SAVE! +5':prev<40?'Boosted! +3':'+1';
          var col=prev<20?CL.gold:prev<40?CL.grn:'#888';
          feedbacks.push({x:t.x,y:t.y-45,text:label,color:col,life:30});
          for(var p=0;p<3;p++)particles.push({x:t.x,y:t.y-20,vx:(Math.random()-.5)*2,vy:-Math.random()*2,life:12,color:CL.hum,sz:2});
          break;
        }
      }
      // Click jammer to destroy
      for(var i=jammers.length-1;i>=0;i--){
        var j=jammers[i];
        if(Math.abs(mx-j.x)<16&&Math.abs(my-j.y)<16){
          score+=2;feedbacks.push({x:j.x,y:j.y,text:'JAMMED! +2',color:CL.grn,life:25});
          for(var p=0;p<5;p++)particles.push({x:j.x,y:j.y,vx:(Math.random()-.5)*4,vy:(Math.random()-.5)*3,life:15,color:CL.ai,sz:2});
          jammers.splice(i,1);break;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180){state='PLAYING';initTowers()}return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' broadcasting.';trT=70;trA=0;for(var i=0;i<towers.length;i++)if(towers[i].alive)towers[i].decayRate+=.01}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      if(fr%Math.max(60,140-zone*20)===0)spawnJammer();
      // Update towers
      for(var i=0;i<towers.length;i++){
        var t=towers[i];if(!t.alive)continue;
        t.signal-=t.decayRate;t.pulsePhase+=.04;
        if(t.boostAnim>0)t.boostAnim=Math.max(0,t.boostAnim-.03);
        if(t.signal<=0){t.signal=0;t.alive=false;towersLost++;
          feedbacks.push({x:t.x,y:t.y-30,text:'LOST!',color:CL.red,life:40});
          for(var p=0;p<6;p++)particles.push({x:t.x,y:t.y-15,vx:(Math.random()-.5)*3,vy:-Math.random()*2,life:18,color:CL.red,sz:2});
        }
      }
      // Jammers drain towers
      for(var i=jammers.length-1;i>=0;i--){
        var j=jammers[i];j.phase+=.06;j.life--;
        if(j.life<=0){jammers.splice(i,1);continue}
        var t=towers[j.target];if(t&&t.alive)t.signal-=j.power;
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];p.x+=p.vx;p.y+=p.vy;p.vy+=.04;p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      ctx.fillStyle='#0a0e14';ctx.fillRect(0,GY,W,H-GY);ctx.strokeStyle='#182028';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,GY);ctx.lineTo(W,GY);ctx.stroke();
      // Towers
      for(var i=0;i<towers.length;i++){
        var t=towers[i];
        // Tower structure
        ctx.fillStyle=t.alive?'#222838':'#1a1010';
        ctx.fillRect(t.x-2,t.y-35,4,35);
        ctx.fillRect(t.x-8,t.y-38,16,4);
        ctx.fillRect(t.x-5,t.y-42,10,4);
        // Signal rings
        if(t.alive){
          var sP=t.signal/t.maxSignal;
          ctx.save();ctx.globalAlpha=sP*.12;ctx.strokeStyle=CL.hum;ctx.lineWidth=1;
          for(var r=1;r<=3;r++){
            var rad=12+r*8+Math.sin(t.pulsePhase+r)*2;
            ctx.beginPath();ctx.arc(t.x,t.y-40,rad,-.8,-.2);ctx.stroke();
            ctx.beginPath();ctx.arc(t.x,t.y-40,rad,Math.PI+.2,Math.PI+.8);ctx.stroke();
          }
          ctx.restore();
          // Signal bar
          var bW=30,bH=4,bX=t.x-bW/2,bY=t.y+4;
          ctx.fillStyle='#21262d';rr(ctx,bX,bY,bW,bH,2);ctx.fill();
          var sCol=sP>.5?CL.grn:sP>.25?CL.amb:CL.red;
          ctx.fillStyle=sCol;rr(ctx,bX,bY,bW*sP,bH,2);ctx.fill();
          // Boost flash
          if(t.boostAnim>0){ctx.save();ctx.globalAlpha=t.boostAnim*.2;ctx.fillStyle=CL.hum;ctx.beginPath();ctx.arc(t.x,t.y-30,25,0,Math.PI*2);ctx.fill();ctx.restore()}
          // Critical warning
          if(t.signal<25&&Math.sin(fr*.15)>0){ctx.save();ctx.globalAlpha=.06;ctx.fillStyle=CL.red;ctx.beginPath();ctx.arc(t.x,t.y-30,20,0,Math.PI*2);ctx.fill();ctx.restore()}
        }else{
          ctx.fillStyle=CL.red+'44';ctx.font='bold 7px monospace';ctx.textAlign='center';ctx.fillText('DEAD',t.x,t.y+10);ctx.textAlign='left';
        }
      }
      // Jammers
      for(var i=0;i<jammers.length;i++){
        var j=jammers[i];var jy=j.y+Math.sin(j.phase)*3;
        ctx.fillStyle=CL.ai+'cc';ctx.beginPath();ctx.arc(j.x,jy,7,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=CL.red;ctx.lineWidth=1;ctx.beginPath();ctx.arc(j.x,jy,7,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(j.x,jy,2.5,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#40C8E0';ctx.beginPath();ctx.arc(j.x+.3,jy+.3,1.5,0,Math.PI*2);ctx.fill();
        // Jam beam
        var tt=towers[j.target];if(tt&&tt.alive){
          ctx.save();ctx.globalAlpha=.08;ctx.strokeStyle=CL.red;ctx.lineWidth=1;ctx.setLineDash([3,5]);
          ctx.beginPath();ctx.moveTo(j.x,jy);ctx.lineTo(tt.x,tt.y-35);ctx.stroke();ctx.setLineDash([]);ctx.restore();
        }
        ctx.fillStyle=CL.ai;ctx.font='bold 5px monospace';ctx.textAlign='center';ctx.fillText('JAM',j.x,jy+14);ctx.textAlign='left';
      }
      // Particles/feedbacks
      for(var i=0;i<particles.length;i++){var p=particles[i];ctx.save();ctx.globalAlpha=p.life/18;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 9px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 10px monospace';ctx.fillText('\u2B21 '+score,8,12);
        var alive=0;for(var i=0;i<towers.length;i++)if(towers[i].alive)alive++;
        ctx.fillStyle=alive>4?CL.grn:alive>2?CL.amb:CL.red;ctx.font='bold 8px monospace';ctx.fillText(alive+'/'+TOWER_COUNT+' live',55,12);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,12);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Syne,sans-serif';ctx.fillStyle='#fff';ctx.fillText('SIGNAL BOOST',W/2,H/2-20);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Click towers to boost their signal before it dies',W/2,H/2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Click AI jammers (red) to destroy them',W/2,H/2+14);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Syne,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        var alive=0;for(var i=0;i<towers.length;i++)if(towers[i].alive)alive++;
        ctx.font='800 17px Syne,sans-serif';ctx.fillStyle=alive>3?CL.grn:alive>0?CL.amb:CL.red;ctx.fillText(alive>0?'SIGNAL SURVIVED':'TOTAL SILENCE',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(alive>0?'0':'1'),W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(alive+'/'+TOWER_COUNT+' towers broadcasting \u00B7 '+boosts+' boosts',W/2,H*.50+16);
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText(towersLost===0?'Full signal. Humanity is loud and clear.':'Some voices went silent.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;towersLost=0;boosts=0;particles=[];feedbacks=[];initTowers()},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: PIXEL TURF
  // Grid territory. Click to claim tiles for humans (blue).
  // AI virus (red) spreads to adjacent tiles. Hold territory.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'pixel-turf',
    name: 'Pixel Turf',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;

    var COLS=32,ROWS=8;
    var CELL=Math.min(Math.floor((W-20)/COLS),Math.floor((H-36)/ROWS));
    var GX=Math.floor((W-COLS*CELL)/2),GY_TOP=18;
    var grid=[]; // 0=neutral, 1=human, 2=ai
    var cellAnim=[]; // flash timers
    var particles=[];var feedbacks=[];
    var humanCells=0,aiCells=0,flipped=0;

    function initGrid(){
      grid=[];cellAnim=[];
      for(var r=0;r<ROWS;r++){
        grid[r]=[];cellAnim[r]=[];
        for(var c=0;c<COLS;c++){grid[r][c]=0;cellAnim[r][c]=0}
      }
      // Seed AI in corners
      grid[0][0]=2;grid[0][COLS-1]=2;grid[ROWS-1][0]=2;grid[ROWS-1][COLS-1]=2;
      // Seed humans in center
      var mr=Math.floor(ROWS/2),mc=Math.floor(COLS/2);
      grid[mr][mc]=1;grid[mr][mc-1]=1;grid[mr][mc+1]=1;grid[mr-1][mc]=1;
    }

    function spreadAI(){
      var newInfections=[];
      var spreadChance=.08+zone*.03+prog*.001;
      for(var r=0;r<ROWS;r++){
        for(var c=0;c<COLS;c++){
          if(grid[r][c]!==2)continue;
          var adj=[[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
          for(var a=0;a<adj.length;a++){
            var ar=adj[a][0],ac=adj[a][1];
            if(ar<0||ar>=ROWS||ac<0||ac>=COLS)continue;
            if(grid[ar][ac]===0&&Math.random()<spreadChance)newInfections.push([ar,ac]);
            if(grid[ar][ac]===1&&Math.random()<spreadChance*.5)newInfections.push([ar,ac]);
          }
        }
      }
      for(var i=0;i<newInfections.length;i++){
        var nr=newInfections[i][0],nc=newInfections[i][1];
        grid[nr][nc]=2;cellAnim[nr][nc]=10;
      }
    }

    function countCells(){
      humanCells=0;aiCells=0;
      for(var r=0;r<ROWS;r++)for(var c=0;c<COLS;c++){if(grid[r][c]===1)humanCells++;if(grid[r][c]===2)aiCells++}
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';initGrid();return}
      if(state!=='PLAYING')return;
      var gc=Math.floor((mx-GX)/CELL),gr=Math.floor((my-GY_TOP)/CELL);
      if(gc<0||gc>=COLS||gr<0||gr>=ROWS)return;
      if(grid[gr][gc]===2){
        grid[gr][gc]=1;cellAnim[gr][gc]=12;score+=2;flipped++;
        feedbacks.push({x:GX+gc*CELL+CELL/2,y:GY_TOP+gr*CELL,text:'+2',color:CL.hum,life:20});
      }else if(grid[gr][gc]===0){
        grid[gr][gc]=1;cellAnim[gr][gc]=8;score+=1;flipped++;
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180){state='PLAYING';initGrid()}return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' contested.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      // AI spreads every N frames
      var spreadRate=Math.max(10,30-zone*4);
      if(fr%spreadRate===0)spreadAI();
      // Anim timers
      for(var r=0;r<ROWS;r++)for(var c=0;c<COLS;c++){if(cellAnim[r][c]>0)cellAnim[r][c]--}
      countCells();
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      // Grid
      for(var r=0;r<ROWS;r++){
        for(var c=0;c<COLS;c++){
          var cx=GX+c*CELL,cy=GY_TOP+r*CELL;
          var v=grid[r][c];var anim=cellAnim[r][c];
          if(v===0)ctx.fillStyle='#12141c';
          else if(v===1)ctx.fillStyle=anim>0?CL.hum:CL.humB+'cc';
          else ctx.fillStyle=anim>0?CL.red:CL.ai+'cc';
          ctx.fillRect(cx+.5,cy+.5,CELL-1,CELL-1);
          // Flash
          if(anim>0){ctx.save();ctx.globalAlpha=anim/12*.3;ctx.fillStyle=v===1?'#fff':CL.red;ctx.fillRect(cx,cy,CELL,CELL);ctx.restore()}
        }
      }
      // Grid lines
      ctx.strokeStyle='#0a0c14';ctx.lineWidth=.5;
      for(var c=0;c<=COLS;c++){ctx.beginPath();ctx.moveTo(GX+c*CELL,GY_TOP);ctx.lineTo(GX+c*CELL,GY_TOP+ROWS*CELL);ctx.stroke()}
      for(var r=0;r<=ROWS;r++){ctx.beginPath();ctx.moveTo(GX,GY_TOP+r*CELL);ctx.lineTo(GX+COLS*CELL,GY_TOP+r*CELL);ctx.stroke()}
      // Feedbacks
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/8);ctx.font='bold 8px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        var total=ROWS*COLS;var humPct=Math.round(humanCells/total*100);var aiPct=Math.round(aiCells/total*100);
        ctx.fillStyle=CL.acc;ctx.font='bold 10px monospace';ctx.fillText('\u2B21 '+score,8,12);
        // Territory bar
        var bW=120,bH=6,bX=60,bY=6;
        ctx.fillStyle='#21262d';ctx.fillRect(bX,bY,bW,bH);
        ctx.fillStyle=CL.hum;ctx.fillRect(bX,bY,bW*(humanCells/total),bH);
        ctx.fillStyle=CL.ai;ctx.fillRect(bX+bW-bW*(aiCells/total),bY,bW*(aiCells/total),bH);
        ctx.fillStyle=CL.hum;ctx.font='bold 7px monospace';ctx.fillText(humPct+'%',bX+bW+4,bY+6);
        ctx.fillStyle=CL.ai;ctx.textAlign='right';ctx.fillText(aiPct+'%',bX-4,bY+6);ctx.textAlign='left';
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,12);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Syne,sans-serif';ctx.fillStyle='#fff';ctx.fillText('PIXEL TURF',W/2,H/2-20);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Click tiles to claim for humans (blue)',W/2,H/2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.ai;ctx.fillText('AI virus (red) spreads to adjacent tiles',W/2,H/2+14);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Syne,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        var total=ROWS*COLS;var humPct=Math.round(humanCells/total*100);
        ctx.font='800 17px Syne,sans-serif';ctx.fillStyle=humPct>50?CL.hum:humPct>20?CL.amb:CL.red;
        ctx.fillText(humPct>50?'TERRITORY HELD':'TERRITORY LOST',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(humPct>50?'0':'1'),W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.hum;ctx.fillText(humanCells+' human tiles ('+humPct+'%)',W/2,H*.50+16);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText(aiCells+' AI tiles ('+Math.round(aiCells/total*100)+'%)',W/2,H*.50+30);
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText(humPct>70?'Dominant. The grid is yours.':humPct>50?'Holding on. Barely.':'The virus won. The grid is red.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    initGrid();
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;flipped=0;particles=[];feedbacks=[];initGrid()},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: BUG ZAPPER
  // AI bugs crawl across code lines. Click to zap.
  // Don't zap human-written code (green lines).
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'bug-zapper',
    name: 'Bug Zapper',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var LINE_COUNT=7,lineY=[];
    var bugs=[],particles=[],feedbacks=[];
    var zapped=0,wrongZaps=0;

    for(var i=0;i<LINE_COUNT;i++)lineY.push(14+i*((H-28)/LINE_COUNT));

    var CODE_LINES=['const app = express();','let data = await fetch(url);','function render(props) {','if (user.isAdmin) {','return items.map(i => i);','try { parseJSON(raw) }','export default App;','const [s, setS] = useState();','router.get("/api", cb);','db.query("SELECT *")'];

    function spawnBug(){
      var ln=Math.floor(Math.random()*LINE_COUNT);
      var speed=.5+zone*.15+Math.random()*.4+prog*.003;
      var fromRight=Math.random()>.5;
      bugs.push({x:fromRight?W+10:-10,y:lineY[ln]+4,lane:ln,vx:fromRight?-speed:speed,
        alive:true,w:12,h:8,phase:Math.random()*6,type:'ai'});
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      // Check bugs
      for(var i=bugs.length-1;i>=0;i--){
        var b=bugs[i];if(!b.alive)continue;
        if(Math.abs(mx-b.x)<14&&Math.abs(my-b.y)<12){
          b.alive=false;score+=2;zapped++;
          feedbacks.push({x:b.x,y:b.y,text:'ZAP! +2',color:CL.grn,life:25});
          for(var p=0;p<6;p++)particles.push({x:b.x,y:b.y,vx:(Math.random()-.5)*4,vy:(Math.random()-.5)*3,life:15+Math.random()*8,color:CL.ai,sz:2+Math.random()});
          particles.push({x:b.x,y:b.y,vx:0,vy:0,life:8,color:'#fff',sz:14,type:'snap'});
          return;
        }
      }
      // Clicked on a code line (no bug) = penalty
      for(var i=0;i<LINE_COUNT;i++){
        if(Math.abs(my-lineY[i]-4)<10){wrongZaps++;score=Math.max(0,score-1);
          feedbacks.push({x:mx,y:my,text:'CLEAN CODE!',color:CL.red,life:30});
          particles.push({x:0,y:0,vx:0,vy:0,life:6,color:CL.red,sz:0,type:'flash'});
          return;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' debugged.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      var rate=Math.max(15,40-zone*5-prog*.1);
      if(fr%Math.floor(rate)===0)spawnBug();
      // Extra bugs
      var alive=0;for(var i=0;i<bugs.length;i++)if(bugs[i].alive)alive++;
      if(alive<3+zone&&fr%20===0)spawnBug();
      for(var i=bugs.length-1;i>=0;i--){
        var b=bugs[i];if(!b.alive){bugs.splice(i,1);continue}
        b.x+=b.vx;b.phase+=.08;
        if(b.x<-20||b.x>W+20)bugs.splice(i,1);
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'&&p.type!=='snap'){p.x+=p.vx;p.y+=p.vy;p.vy+=.05}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=30){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      // Line numbers + code
      for(var i=0;i<LINE_COUNT;i++){
        var ly=lineY[i];
        ctx.fillStyle=i%2===0?'#0d0f14':'#10121a';ctx.fillRect(0,ly-4,W,((H-28)/LINE_COUNT));
        ctx.fillStyle='#222';ctx.font='bold 7px JetBrains Mono,monospace';ctx.fillText(''+(i+1),4,ly+6);
        ctx.strokeStyle='#181a22';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(18,ly-4);ctx.lineTo(18,ly+((H-28)/LINE_COUNT)-4);ctx.stroke();
        ctx.fillStyle=z.ac+'55';ctx.font='8px JetBrains Mono,monospace';ctx.fillText(CODE_LINES[(i+zone*3)%CODE_LINES.length],24,ly+6);
      }
      // Bugs
      for(var i=0;i<bugs.length;i++){
        var b=bugs[i];if(!b.alive)continue;
        var bob=Math.sin(b.phase)*1.5;
        // Bug body
        ctx.fillStyle=CL.ai;
        ctx.beginPath();ctx.ellipse(b.x,b.y+bob,6,4,0,0,Math.PI*2);ctx.fill();
        // Legs
        ctx.strokeStyle=CL.aiB;ctx.lineWidth=1;
        for(var l=-1;l<=1;l++){
          ctx.beginPath();ctx.moveTo(b.x+l*3,b.y+bob+3);ctx.lineTo(b.x+l*3+(b.vx>0?-3:3),b.y+bob+6+Math.sin(b.phase+l)*1.5);ctx.stroke();
          ctx.beginPath();ctx.moveTo(b.x+l*3,b.y+bob-3);ctx.lineTo(b.x+l*3+(b.vx>0?-3:3),b.y+bob-6+Math.sin(b.phase+l+1)*1.5);ctx.stroke();
        }
        // Eye
        ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(b.x+(b.vx>0?2:-2),b.y+bob-1,2,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=CL.red;ctx.beginPath();ctx.arc(b.x+(b.vx>0?2.5:-1.5),b.y+bob-1,1,0,Math.PI*2);ctx.fill();
        // Antenna
        ctx.strokeStyle=CL.acc+'66';ctx.lineWidth=.5;
        ctx.beginPath();ctx.moveTo(b.x,b.y+bob-4);ctx.lineTo(b.x-2,b.y+bob-8);ctx.stroke();
        ctx.beginPath();ctx.moveTo(b.x,b.y+bob-4);ctx.lineTo(b.x+2,b.y+bob-8);ctx.stroke();
      }
      // Particles
      for(var i=0;i<particles.length;i++){var p=particles[i];
        if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/6*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}
        else if(p.type==='snap'){ctx.save();ctx.globalAlpha=p.life/8*.5;ctx.strokeStyle=p.color;ctx.lineWidth=1.5;var sr=p.sz*(1-p.life/8);for(var j=0;j<4;j++){var a=j*Math.PI/2+fr*.2;ctx.beginPath();ctx.moveTo(p.x+Math.cos(a)*sr*.3,p.y+Math.sin(a)*sr*.3);ctx.lineTo(p.x+Math.cos(a)*sr,p.y+Math.sin(a)*sr);ctx.stroke()}ctx.restore()}
        else{ctx.save();ctx.globalAlpha=p.life/20;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 9px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 10px monospace';ctx.fillText('\u2B21 '+score,W-80,12);
        ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.textAlign='right';ctx.fillText(ZONES[zone].name,W-8,H-6);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('BUG ZAPPER',W/2,H/2-20);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Click AI bugs crawling across code lines',W/2,H/2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.grn;ctx.fillText('Don\'t click clean code lines',W/2,H/2+14);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=CL.grn;ctx.fillText('CODEBASE CLEAN',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code 0',W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(zapped+' bugs zapped',W/2,H*.50+16);
        if(wrongZaps>0){ctx.fillStyle=CL.amb;ctx.fillText(wrongZaps+' clean lines hit',W/2,H*.50+30)}
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('Zero bugs. Ship it.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;zapped=0;wrongZaps=0;bugs=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: OVERTIME
  // AI agents walk toward exit. Click to send back.
  // Humans leave freely. Don't block them.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'overtime',
    name: 'Overtime',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',gold:'#FFD700',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];
    var HSKINS=[{bc:'#3570B0',sk:'#F4C7A3',hr:'#3A2A1A'},{bc:'#C04878',sk:'#F0D5C0',hr:'#8B3A1A'},{bc:'#3A9080',sk:'#C8A882',hr:'#1A3A2A'},{bc:'#A83030',sk:'#F0D0B0',hr:'#5A2A1A'},{bc:'#8A5090',sk:'#F0C8B0',hr:'#5A2A3A'}];
    var GY=H-18;

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var workers=[];var particles=[];var feedbacks=[];
    var sent=0,escaped=0,blocked=0;
    var EXIT_X=W-25;

    function spawnWorker(){
      var isAI=Math.random()<(.5+zone*.07);
      var speed=.4+zone*.1+Math.random()*.3+prog*.002;
      var lane=Math.floor(Math.random()*4);
      var wy=GY-10-lane*30-Math.random()*8;
      workers.push({x:30+Math.random()*100,y:wy,speed:speed,type:isAI?'ai':'human',
        skin:isAI?null:HSKINS[Math.floor(Math.random()*HSKINS.length)],alive:true,
        phase:Math.random()*6,sentBack:false,sentT:0,targetX:EXIT_X});
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      for(var i=workers.length-1;i>=0;i--){
        var w=workers[i];if(!w.alive||w.sentBack)continue;
        if(Math.abs(mx-w.x)<16&&Math.abs(my-w.y)<18){
          if(w.type==='ai'){
            w.sentBack=true;w.sentT=0;w.targetX=20;score+=2;sent++;
            feedbacks.push({x:w.x,y:w.y-15,text:'GO BACK! +2',color:CL.grn,life:25});
            for(var p=0;p<4;p++)particles.push({x:w.x,y:w.y,vx:(Math.random()-.5)*3,vy:-Math.random()*2,life:12,color:CL.ai,sz:2});
          }else{
            blocked++;score=Math.max(0,score-2);
            feedbacks.push({x:w.x,y:w.y-15,text:'LET THEM GO!',color:CL.red,life:30});
            particles.push({x:0,y:0,vx:0,vy:0,life:8,color:CL.red,sz:0,type:'flash'});
          }
          return;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' overtime.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      var rate=Math.max(20,50-zone*6-prog*.1);
      if(fr%Math.floor(rate)===0)spawnWorker();
      for(var i=workers.length-1;i>=0;i--){
        var w=workers[i];if(!w.alive){workers.splice(i,1);continue}
        w.phase+=.04;
        if(w.sentBack){w.sentT++;w.x+=(w.targetX-w.x)*.06;if(w.x<30){w.alive=false;continue}}
        else{w.x+=w.speed;
          if(w.x>=EXIT_X){w.alive=false;if(w.type==='ai'){escaped++;feedbacks.push({x:EXIT_X,y:w.y,text:'ESCAPED!',color:CL.amb,life:25})}
            else{score++;feedbacks.push({x:EXIT_X,y:w.y,text:'FREE +1',color:CL.hum,life:20})}}}
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.04}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      ctx.fillStyle='#0a0e14';ctx.fillRect(0,GY,W,H-GY);ctx.strokeStyle='#182028';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,GY);ctx.lineTo(W,GY);ctx.stroke();
      // Exit door
      ctx.fillStyle=CL.amb+'22';ctx.fillRect(EXIT_X-5,10,20,GY-10);
      ctx.strokeStyle=CL.amb+'44';ctx.lineWidth=1;ctx.strokeRect(EXIT_X-5,10,20,GY-10);
      ctx.fillStyle=CL.amb;ctx.font='bold 7px monospace';ctx.save();ctx.translate(EXIT_X+8,GY/2+15);ctx.rotate(-Math.PI/2);ctx.fillText('EXIT',0,0);ctx.restore();
      // Office desks on left
      for(var i=0;i<4;i++){ctx.fillStyle='#1a1f28';rr(ctx,10,GY-10-i*30-22,35,4,2);ctx.fill();ctx.fillStyle='#14181f';ctx.fillRect(15,GY-10-i*30-18,2,10);ctx.fillRect(40,GY-10-i*30-18,2,10)}
      // Workers
      for(var i=0;i<workers.length;i++){
        var w=workers[i];if(!w.alive)continue;
        var bob=Math.sin(w.phase)*1;
        if(w.type==='ai'){
          ctx.fillStyle=CL.aiB;rr(ctx,w.x-5,w.y+2+bob,10,8,3);ctx.fill();
          ctx.fillStyle=CL.ai;ctx.beginPath();ctx.arc(w.x,w.y-5+bob,7,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle='#a04520';ctx.lineWidth=.8;ctx.beginPath();ctx.arc(w.x,w.y-5+bob,7,0,Math.PI*2);ctx.stroke();
          ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(w.x,w.y-4.5+bob,2.5,3,0,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#40C8E0';ctx.beginPath();ctx.arc(w.x+.5,w.y-4+bob,1.5,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle=CL.acc;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(w.x,w.y-12+bob);ctx.lineTo(w.x,w.y-15+bob);ctx.stroke();
          ctx.fillStyle=CL.acc;ctx.beginPath();ctx.arc(w.x,w.y-15+bob,1.5,0,Math.PI*2);ctx.fill();
          if(!w.sentBack){ctx.fillStyle=CL.ai;ctx.font='bold 5px monospace';ctx.textAlign='center';ctx.fillText('AI',w.x,w.y+14+bob);ctx.textAlign='left'}
        }else{
          var s=w.skin;
          ctx.fillStyle=s.bc;rr(ctx,w.x-4.5,w.y+2+bob,9,7,3);ctx.fill();
          ctx.fillStyle=s.sk;ctx.beginPath();ctx.arc(w.x,w.y-5+bob,6,0,Math.PI*2);ctx.fill();
          ctx.fillStyle=s.hr;ctx.beginPath();ctx.arc(w.x,w.y-5+bob,6,Math.PI,2*Math.PI);ctx.fill();
          ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(w.x,w.y-4.5+bob,2,2.5,0,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#1a1a2e';ctx.beginPath();ctx.arc(w.x,w.y-4+bob,1,0,Math.PI*2);ctx.fill();
        }
        // Direction arrow
        if(!w.sentBack&&w.type==='ai'){ctx.fillStyle=CL.red+'66';ctx.beginPath();ctx.moveTo(w.x+10,w.y+bob);ctx.lineTo(w.x+15,w.y+bob);ctx.lineTo(w.x+13,w.y-3+bob);ctx.closePath();ctx.fill()}
      }
      // Particles/feedbacks
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/8*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/15;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 8px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 10px monospace';ctx.fillText('\u2B21 '+score,8,12);
        ctx.fillStyle=CL.grn;ctx.font='bold 7px monospace';ctx.fillText(sent+' sent back',55,12);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-30,12);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('OVERTIME',W/2,H/2-20);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Click AI agents to send them back to their desks',W/2,H/2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Let humans leave freely',W/2,H/2+14);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=escaped<5?CL.grn:escaped<10?CL.amb:CL.red;
        ctx.fillText(escaped<5?'SHIFT MANAGED':'AI WALKED OUT',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(escaped<5?'0':'1'),W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(sent+' AI sent back',W/2,H*.50+16);
        if(escaped>0){ctx.fillStyle=CL.amb;ctx.fillText(escaped+' AI escaped',W/2,H*.50+30)}
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText(escaped===0?'Nobody left early. Total control.':'Some got away. The exit beckons.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;sent=0;escaped=0;blocked=0;workers=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: THE PITCH
  // Human idea bubbles float up. AI counter-arguments sink.
  // Pop AI bubbles. Protect human ideas.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'the-pitch',
    name: 'The Pitch',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var bubbles=[],particles=[],feedbacks=[];
    var popped=0,lost=0;

    var AI_WORDS=['AUTOMATE','OPTIMIZE','REPLACE','DISRUPT','SCALE','OUTSOURCE','DEPRECATE','DOWNSIZE','MERGE','DEPLOY BOT','CUT COSTS','AI FIRST'];
    var HUM_WORDS=['IDEA!','CONCEPT','VISION','DREAM','PLAN','DESIGN','PROTOTYPE','INNOVATE','CREATE','BUILD','INSPIRE','CONNECT'];

    function spawnBubble(){
      var isAI=Math.random()<(.55+zone*.05);
      var speed=.3+zone*.1+Math.random()*.3+prog*.002;
      var r=12+Math.random()*10;
      var words=isAI?AI_WORDS:HUM_WORDS;
      bubbles.push({
        x:20+Math.random()*(W-40),y:isAI?-r:H+r,
        r:r,vy:isAI?speed:-speed,type:isAI?'ai':'human',
        label:words[Math.floor(Math.random()*words.length)],
        alive:true,phase:Math.random()*6,wobble:Math.random()*.3+.1
      });
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      for(var i=bubbles.length-1;i>=0;i--){
        var b=bubbles[i];if(!b.alive)continue;
        var dx=mx-b.x,dy=my-b.y;
        if(dx*dx+dy*dy<(b.r+6)*(b.r+6)){
          if(b.type==='ai'){
            b.alive=false;score+=2;popped++;
            feedbacks.push({x:b.x,y:b.y,text:'POP! +2',color:CL.grn,life:25});
            for(var p=0;p<8;p++){var a=Math.random()*Math.PI*2;particles.push({x:b.x+Math.cos(a)*b.r*.5,y:b.y+Math.sin(a)*b.r*.5,vx:Math.cos(a)*2.5,vy:Math.sin(a)*2.5,life:15+Math.random()*8,color:CL.ai,sz:2+Math.random()*2})}
          } else {
            score=Math.max(0,score-2);lost++;
            feedbacks.push({x:b.x,y:b.y,text:'GOOD IDEA!',color:CL.red,life:30});
            particles.push({x:0,y:0,vx:0,vy:0,life:6,color:CL.red,sz:0,type:'flash'});
          }
          return;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' pitched.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      var rate=Math.max(15,35-zone*4-prog*.08);
      if(fr%Math.floor(rate)===0)spawnBubble();
      for(var i=bubbles.length-1;i>=0;i--){
        var b=bubbles[i];if(!b.alive){bubbles.splice(i,1);continue}
        b.y+=b.vy;b.phase+=.04;b.x+=Math.sin(b.phase)*b.wobble;
        if(b.type==='ai'&&b.y>H+b.r){bubbles.splice(i,1);score=Math.max(0,score-1);feedbacks.push({x:b.x,y:H-10,text:'LANDED',color:CL.amb,life:20})}
        else if(b.type==='human'&&b.y<-b.r){bubbles.splice(i,1);score++;feedbacks.push({x:b.x,y:10,text:'PITCHED! +1',color:CL.hum,life:20})}
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y+=feedbacks[i].y<H/2?1:-.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.03;p.vx*=.98}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      // Midline separator
      ctx.save();ctx.globalAlpha=.08;ctx.strokeStyle='#fff';ctx.lineWidth=.5;ctx.setLineDash([4,8]);ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.stroke();ctx.setLineDash([]);ctx.restore();
      ctx.save();ctx.globalAlpha=.15;ctx.font='bold 6px monospace';ctx.fillStyle=CL.ai;ctx.fillText('AI ARGUMENTS',5,H/2-5);ctx.fillStyle=CL.hum;ctx.fillText('HUMAN IDEAS',5,H/2+10);ctx.restore();
      // Bubbles
      for(var i=0;i<bubbles.length;i++){
        var b=bubbles[i];if(!b.alive)continue;
        var isAI=b.type==='ai';
        // Glow
        ctx.save();ctx.globalAlpha=.08;var g=ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r*1.5);g.addColorStop(0,isAI?CL.ai:CL.hum);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.beginPath();ctx.arc(b.x,b.y,b.r*1.5,0,Math.PI*2);ctx.fill();ctx.restore();
        // Bubble
        ctx.fillStyle=(isAI?CL.ai:CL.hum)+'22';ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=(isAI?CL.ai:CL.hum)+'88';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.stroke();
        // Highlight
        ctx.save();ctx.globalAlpha=.2;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(b.x-b.r*.3,b.y-b.r*.3,b.r*.35,0,Math.PI*2);ctx.fill();ctx.restore();
        // Label
        var fs=Math.min(8,b.r*.6);ctx.font='bold '+fs+'px monospace';ctx.fillStyle=isAI?CL.ai:CL.hum;ctx.textAlign='center';ctx.fillText(b.label,b.x,b.y+fs*.35);ctx.textAlign='left';
        // Direction arrow
        if(isAI){ctx.fillStyle=CL.ai+'55';ctx.beginPath();ctx.moveTo(b.x-3,b.y+b.r+2);ctx.lineTo(b.x+3,b.y+b.r+2);ctx.lineTo(b.x,b.y+b.r+7);ctx.closePath();ctx.fill()}
        else{ctx.fillStyle=CL.hum+'55';ctx.beginPath();ctx.moveTo(b.x-3,b.y-b.r-2);ctx.lineTo(b.x+3,b.y-b.r-2);ctx.lineTo(b.x,b.y-b.r-7);ctx.closePath();ctx.fill()}
      }
      // Particles
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/6*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/20;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 8px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 10px monospace';ctx.fillText('\u2B21 '+score,W-80,12);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,H-6);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('THE PITCH',W/2,H/2-20);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Pop AI counter-arguments (orange, sinking)',W/2,H/2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Let human ideas rise (blue, floating up)',W/2,H/2+14);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=popped>lost?CL.grn:CL.red;
        ctx.fillText(popped>lost?'PITCH ACCEPTED':'AI TALKED YOU DOWN',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(popped>lost?'0':'1'),W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(popped+' arguments popped',W/2,H*.50+16);
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('Your idea survived the board meeting.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;popped=0;lost=0;bubbles=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: DATA MINE
  // Grid of covered blocks. Click to dig.
  // Human data = points. AI malware = penalty.
  // Numbers hint how many malware are adjacent.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'data-mine',
    name: 'Data Mine',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var COLS=20,ROWS=6,CW,CH;
    var grid=[],revealed=[],flagged=[];
    var particles=[],feedbacks=[];
    var dug=0,hits=0;
    var OFFSETX,OFFSETY;

    function initGrid(){
      CW=Math.floor((W-20)/COLS);CH=Math.floor((H-30)/ROWS);
      OFFSETX=Math.floor((W-COLS*CW)/2);OFFSETY=14;
      grid=[];revealed=[];flagged=[];
      var mineCount=Math.floor(COLS*ROWS*(.18+zone*.03));
      for(var r=0;r<ROWS;r++){grid[r]=[];revealed[r]=[];flagged[r]=[];for(var c=0;c<COLS;c++){grid[r][c]=0;revealed[r][c]=false;flagged[r][c]=false}}
      var placed=0;
      while(placed<mineCount){var r=Math.floor(Math.random()*ROWS),c=Math.floor(Math.random()*COLS);if(grid[r][c]!==9){grid[r][c]=9;placed++}}
      for(var r=0;r<ROWS;r++)for(var c=0;c<COLS;c++){if(grid[r][c]===9)continue;var count=0;for(var dr=-1;dr<=1;dr++)for(var dc=-1;dc<=1;dc++){var nr=r+dr,nc=c+dc;if(nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&grid[nr][nc]===9)count++}grid[r][c]=count}
    }

    function revealFlood(r,c){
      if(r<0||r>=ROWS||c<0||c>=COLS||revealed[r][c])return;
      revealed[r][c]=true;dug++;score++;
      if(grid[r][c]===0){for(var dr=-1;dr<=1;dr++)for(var dc=-1;dc<=1;dc++)revealFlood(r+dr,c+dc)}
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';initGrid();return}
      if(state!=='PLAYING')return;
      var gc=Math.floor((mx-OFFSETX)/CW),gr=Math.floor((my-OFFSETY)/CH);
      if(gc<0||gc>=COLS||gr<0||gr>=ROWS)return;
      if(revealed[gr][gc])return;
      if(grid[gr][gc]===9){
        revealed[gr][gc]=true;hits++;score=Math.max(0,score-3);
        feedbacks.push({x:OFFSETX+gc*CW+CW/2,y:OFFSETY+gr*CH+CH/2,text:'MALWARE! -3',color:CL.red,life:30});
        for(var p=0;p<6;p++)particles.push({x:OFFSETX+gc*CW+CW/2,y:OFFSETY+gr*CH+CH/2,vx:(Math.random()-.5)*4,vy:(Math.random()-.5)*3,life:15,color:CL.ai,sz:2+Math.random()});
        particles.push({x:0,y:0,vx:0,vy:0,life:5,color:CL.red,sz:0,type:'flash'});
      } else {
        var prevDug=dug;
        revealFlood(gr,gc);
        var newDug=dug-prevDug;
        feedbacks.push({x:OFFSETX+gc*CW+CW/2,y:OFFSETY+gr*CH+CH/2,text:'+'+newDug,color:CL.grn,life:20});
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state!=='PLAYING')return;
      var gc=Math.floor((mx-OFFSETX)/CW),gr=Math.floor((my-OFFSETY)/CH);
      if(gc<0||gc>=COLS||gr<0||gr>=ROWS||revealed[gr][gc])return;
      flagged[gr][gc]=!flagged[gr][gc];
    }
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    initGrid();

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180){state='PLAYING';initGrid()}return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' mined.';trT=70;trA=0;initGrid()}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.5;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.04}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    var NUM_COLORS=['',CL.hum,CL.grn,CL.red,CL.acc,CL.amb,CL.cyan,CL.ai,CL.red];

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      // Grid
      for(var r=0;r<ROWS;r++){
        for(var c=0;c<COLS;c++){
          var x=OFFSETX+c*CW,y=OFFSETY+r*CH;
          if(revealed[r][c]){
            ctx.fillStyle=(r+c)%2===0?'#0a0c12':'#0c0e16';
            ctx.fillRect(x,y,CW-1,CH-1);
            if(grid[r][c]===9){
              ctx.fillStyle=CL.ai+'44';ctx.fillRect(x,y,CW-1,CH-1);
              ctx.fillStyle=CL.ai;ctx.font='bold '+Math.min(10,CW*.5)+'px monospace';ctx.textAlign='center';ctx.fillText('X',x+CW/2,y+CH/2+3);ctx.textAlign='left';
            }else if(grid[r][c]>0){
              ctx.fillStyle=NUM_COLORS[grid[r][c]]||'#888';ctx.font='bold '+Math.min(10,CW*.55)+'px monospace';ctx.textAlign='center';ctx.fillText(''+grid[r][c],x+CW/2,y+CH/2+3);ctx.textAlign='left';
            }
          }else{
            ctx.fillStyle=(r+c)%2===0?'#181c28':'#1a1e2a';
            rr(ctx,x+1,y+1,CW-3,CH-3,2);ctx.fill();
            ctx.strokeStyle='#252a38';ctx.lineWidth=.5;rr(ctx,x+1,y+1,CW-3,CH-3,2);ctx.stroke();
            // Top highlight
            ctx.save();ctx.globalAlpha=.06;ctx.fillStyle='#fff';ctx.fillRect(x+2,y+1,CW-5,1);ctx.restore();
            if(flagged[r][c]){ctx.fillStyle=CL.amb;ctx.font='bold '+Math.min(9,CW*.45)+'px monospace';ctx.textAlign='center';ctx.fillText('!',x+CW/2,y+CH/2+3);ctx.textAlign='left'}
          }
        }
      }
      // Grid border
      ctx.strokeStyle=CL.brd;ctx.lineWidth=1;ctx.strokeRect(OFFSETX-1,OFFSETY-1,COLS*CW+2,ROWS*CH+2);
      // Particles
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/5*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/15;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 9px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 9px monospace';ctx.fillText('\u2B21 '+score,4,H-5);
        ctx.fillStyle=CL.grn;ctx.fillText(dug+' dug',60,H-5);
        ctx.fillStyle=CL.red;ctx.fillText(hits+' hits',110,H-5);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,H-5);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('DATA MINE',W/2,H/2-22);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Click blocks to dig. Numbers = adjacent malware.',W/2,H/2-2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Avoid AI malware (X). Right-click to flag.',W/2,H/2+12);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=hits<3?CL.grn:CL.red;
        ctx.fillText(hits<3?'DATA RECOVERED':'MALWARE BREACH',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(hits<3?'0':'1'),W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(dug+' blocks mined',W/2,H*.50+16);
        if(hits>0){ctx.fillStyle=CL.red;ctx.fillText(hits+' malware hit',W/2,H*.50+30)}
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('The data speaks for itself.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;dug=0;hits=0;particles=[];feedbacks=[];initGrid()},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  // ═══════════════════════════════════════════════════════════
  // GAME: COPY STRIKE
  // AI clones appear next to human workers.
  // Click the fake (AI copy). Don't click the real human.
  // Fakes have subtle tells: antenna flicker, wrong eye color.
  // ═══════════════════════════════════════════════════════════

  registerGame({
    id: 'copy-strike',
    name: 'Copy Strike',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',humB:'#3570B0',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];
    var HSKINS=[{bc:'#3570B0',sk:'#F4C7A3',hr:'#3A2A1A'},{bc:'#C04878',sk:'#F0D5C0',hr:'#8B3A1A'},{bc:'#3A9080',sk:'#C8A882',hr:'#1A3A2A'},{bc:'#A83030',sk:'#F0D0B0',hr:'#5A2A1A'},{bc:'#8A5090',sk:'#F0C8B0',hr:'#5A2A3A'}];
    var GY=H-18;

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var pairs=[],particles=[],feedbacks=[];
    var strikes=0,misses=0,roundT=0,roundNum=0;
    var phase='WAITING'; // WAITING, ACTIVE, RESULT

    function initRound(){
      pairs=[];phase='ACTIVE';roundT=0;roundNum++;
      var count=Math.min(4,2+Math.floor(zone*.5));
      var spacing=W/(count+1);
      for(var i=0;i<count;i++){
        var skin=HSKINS[Math.floor(Math.random()*HSKINS.length)];
        var cx=spacing*(i+1);
        var fakeLeft=Math.random()>.5;
        var gap=20+Math.random()*8;
        pairs.push({
          cx:cx,y:GY-10,skin:skin,
          leftX:cx-gap,rightX:cx+gap,
          fakeIsLeft:fakeLeft,
          clicked:false,correct:null,
          tells:{antenna:Math.random()>.3,glitch:Math.random()>.4,eyeColor:Math.random()>.5}
        });
      }
    }

    function drawChar(x,y,skin,isFake,tells,scale){
      var s=scale||1;var bob=Math.sin(fr*.04+x)*1;
      // Body
      ctx.fillStyle=skin.bc;ctx.fillRect(x-5*s,y+2+bob,10*s,8*s);
      // Head
      ctx.fillStyle=skin.sk;ctx.beginPath();ctx.arc(x,y-5+bob,7*s,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=skin.hr;ctx.beginPath();ctx.arc(x,y-5+bob,7*s,Math.PI,2*Math.PI);ctx.fill();
      // Eyes
      ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(x,y-4.5+bob,2.5*s,3*s,0,0,Math.PI*2);ctx.fill();
      if(isFake&&tells.eyeColor){
        ctx.fillStyle='#40C8E0';ctx.beginPath();ctx.arc(x,y-4+bob,1.3*s,0,Math.PI*2);ctx.fill();
      }else{
        ctx.fillStyle='#1a1a2e';ctx.beginPath();ctx.arc(x,y-4+bob,1.3*s,0,Math.PI*2);ctx.fill();
      }
      // Fake antenna (subtle)
      if(isFake&&tells.antenna&&Math.sin(fr*.15)>.3){
        ctx.save();ctx.globalAlpha=.25+Math.sin(fr*.2)*.15;
        ctx.strokeStyle=CL.acc;ctx.lineWidth=.6*s;ctx.beginPath();ctx.moveTo(x,y-12+bob);ctx.lineTo(x,y-16+bob);ctx.stroke();
        ctx.fillStyle=CL.acc;ctx.beginPath();ctx.arc(x,y-16+bob,1.2*s,0,Math.PI*2);ctx.fill();
        ctx.restore();
      }
      // Fake glitch (subtle)
      if(isFake&&tells.glitch&&Math.sin(fr*.08+x)>.85){
        ctx.save();ctx.globalAlpha=.15;ctx.fillStyle=CL.ai;ctx.fillRect(x-7*s,y-8+bob,14*s,2);ctx.restore();
      }
      // Legs
      ctx.fillStyle=skin.bc+'88';ctx.fillRect(x-3*s,y+10+bob,2.5*s,5*s);ctx.fillRect(x+.5*s,y+10+bob,2.5*s,5*s);
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';initRound();return}
      if(state!=='PLAYING'||phase!=='ACTIVE')return;
      for(var i=0;i<pairs.length;i++){
        var p=pairs[i];if(p.clicked)continue;
        // Check left char
        if(Math.abs(mx-p.leftX)<14&&Math.abs(my-p.y)<18){
          p.clicked=true;
          if(p.fakeIsLeft){p.correct=true;score+=3;strikes++;feedbacks.push({x:p.leftX,y:p.y-20,text:'FAKE! +3',color:CL.grn,life:25});for(var j=0;j<5;j++)particles.push({x:p.leftX,y:p.y,vx:(Math.random()-.5)*3,vy:-Math.random()*2,life:12,color:CL.ai,sz:2})}
          else{p.correct=false;score=Math.max(0,score-2);misses++;feedbacks.push({x:p.leftX,y:p.y-20,text:'REAL HUMAN!',color:CL.red,life:30});particles.push({x:0,y:0,vx:0,vy:0,life:6,color:CL.red,sz:0,type:'flash'})}
          checkRoundEnd();return;
        }
        // Check right char
        if(Math.abs(mx-p.rightX)<14&&Math.abs(my-p.y)<18){
          p.clicked=true;
          if(!p.fakeIsLeft){p.correct=true;score+=3;strikes++;feedbacks.push({x:p.rightX,y:p.y-20,text:'FAKE! +3',color:CL.grn,life:25});for(var j=0;j<5;j++)particles.push({x:p.rightX,y:p.y,vx:(Math.random()-.5)*3,vy:-Math.random()*2,life:12,color:CL.ai,sz:2})}
          else{p.correct=false;score=Math.max(0,score-2);misses++;feedbacks.push({x:p.rightX,y:p.y-20,text:'REAL HUMAN!',color:CL.red,life:30});particles.push({x:0,y:0,vx:0,vy:0,life:6,color:CL.red,sz:0,type:'flash'})}
          checkRoundEnd();return;
        }
      }
    }
    function checkRoundEnd(){
      var allDone=true;for(var i=0;i<pairs.length;i++)if(!pairs[i].clicked)allDone=false;
      if(allDone){phase='RESULT';roundT=0}
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180){state='PLAYING';initRound()}return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' scanned.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      if(phase==='RESULT'){roundT++;if(roundT>60)initRound()}
      if(phase==='ACTIVE'){roundT++;if(roundT>300){
        for(var i=0;i<pairs.length;i++)if(!pairs[i].clicked){pairs[i].clicked=true;pairs[i].correct=false;misses++}
        phase='RESULT';roundT=0;
      }}
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.04}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      ctx.fillStyle='#0a0e14';ctx.fillRect(0,GY,W,H-GY);ctx.strokeStyle='#182028';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,GY);ctx.lineTo(W,GY);ctx.stroke();
      // Pairs
      for(var i=0;i<pairs.length;i++){
        var p=pairs[i];
        // Left char
        var leftIsFake=p.fakeIsLeft;
        drawChar(p.leftX,p.y,p.skin,leftIsFake,p.tells,1);
        // Right char
        drawChar(p.rightX,p.y,p.skin,!leftIsFake,p.tells,1);
        // VS between
        ctx.fillStyle='#333';ctx.font='bold 6px monospace';ctx.textAlign='center';ctx.fillText('or',p.cx,p.y+2);ctx.textAlign='left';
        // Result indicators
        if(p.clicked){
          var fakeX=p.fakeIsLeft?p.leftX:p.rightX;
          var realX=p.fakeIsLeft?p.rightX:p.leftX;
          // Circle the fake
          ctx.strokeStyle=CL.ai+'88';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(fakeX,p.y-2,14,0,Math.PI*2);ctx.stroke();
          ctx.fillStyle=CL.ai;ctx.font='bold 5px monospace';ctx.textAlign='center';ctx.fillText('AI',fakeX,p.y+22);ctx.textAlign='left';
          // Check on real
          ctx.strokeStyle=CL.grn+'88';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(realX,p.y-2,14,0,Math.PI*2);ctx.stroke();
        }
      }
      // Round info
      if(phase==='ACTIVE'){
        ctx.fillStyle=CL.amb;ctx.font='bold 8px monospace';ctx.textAlign='center';
        ctx.fillText('ROUND '+roundNum+' - SPOT THE FAKE',W/2,10);
        var timeLeft=Math.max(0,Math.floor((300-roundT)/60));
        ctx.fillStyle='#444';ctx.fillText(timeLeft+'s',W/2,H-6);
        ctx.textAlign='left';
      }
      // Particles/feedbacks
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/6*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/15;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 8px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 10px monospace';ctx.fillText('\u2B21 '+score,4,12);
        ctx.fillStyle=CL.grn;ctx.font='bold 7px monospace';ctx.fillText(strikes+' caught',55,12);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,12);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('COPY STRIKE',W/2,H/2-22);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText('AI clones appear next to humans. Spot the fake.',W/2,H/2-2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.grn;ctx.fillText('Look for antenna flicker, cyan eyes, glitch lines.',W/2,H/2+12);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=strikes>misses?CL.grn:CL.red;
        ctx.fillText(strikes>misses?'FAKES IDENTIFIED':'THEY FOOLED YOU',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(strikes>misses?'0':'1'),W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(strikes+' fakes caught',W/2,H*.50+16);
        if(misses>0){ctx.fillStyle=CL.red;ctx.fillText(misses+' mistakes',W/2,H*.50+30)}
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('The copies are getting better.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;strikes=0;misses=0;roundNum=0;pairs=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  registerGame({
    id: 'server-room',
    name: 'Server Room',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var SERVER_COUNT=6,servers=[];
    var particles=[],feedbacks=[];
    var cooled=0,overheated=0;

    function initServers(){
      servers=[];
      for(var i=0;i<SERVER_COUNT;i++){
        servers.push({x:20+i*((W-40)/SERVER_COUNT),y:30,w:((W-40)/SERVER_COUNT)-8,h:H-55,
          temp:20+Math.random()*10,fanSpeed:1,heatRate:.1+zone*.04+Math.random()*.05,
          overheated:false,fanAngle:Math.random()*6});
      }
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      for(var i=0;i<servers.length;i++){
        var s=servers[i];
        if(mx>=s.x&&mx<=s.x+s.w&&my>=s.y&&my<=s.y+s.h&&!s.overheated){
          s.fanSpeed=3;s.temp=Math.max(15,s.temp-15-zone*2);score++;cooled++;
          feedbacks.push({x:s.x+s.w/2,y:s.y+s.h/2,text:'COOLED!',color:CL.cyan,life:20});
          for(var p=0;p<4;p++)particles.push({x:s.x+s.w/2,y:s.y+s.h-10,vx:(Math.random()-.5)*2,vy:-1-Math.random()*2,life:15,color:CL.cyan,sz:2+Math.random()});
          return;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    initServers();

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' rack cleared.';trT=70;trA=0;
        for(var i=0;i<servers.length;i++){servers[i].heatRate=.1+zone*.04+Math.random()*.05;servers[i].overheated=false;servers[i].temp=20}}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      // AI heat bursts
      if(fr%60===0&&Math.random()<.3+zone*.1){
        var idx=Math.floor(Math.random()*SERVER_COUNT);
        if(!servers[idx].overheated){servers[idx].temp+=10+zone*3;
          feedbacks.push({x:servers[idx].x+servers[idx].w/2,y:servers[idx].y+10,text:'AI SPIKE!',color:CL.ai,life:20})}
      }
      for(var i=0;i<servers.length;i++){
        var s=servers[i];if(s.overheated)continue;
        s.temp+=s.heatRate;s.fanSpeed=Math.max(.2,s.fanSpeed-.01);
        s.fanAngle+=s.fanSpeed*.15;
        s.temp-=s.fanSpeed*.3;
        if(s.temp>=100){s.overheated=true;overheated++;score=Math.max(0,score-3);
          feedbacks.push({x:s.x+s.w/2,y:s.y+s.h/2,text:'OVERHEATED!',color:CL.red,life:30});
          for(var p=0;p<8;p++)particles.push({x:s.x+s.w/2,y:s.y+s.h/2,vx:(Math.random()-.5)*3,vy:(Math.random()-.5)*3,life:20,color:CL.ai,sz:2+Math.random()*2})}
        s.temp=Math.max(15,Math.min(100,s.temp));
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];p.x+=p.vx;p.y+=p.vy;p.vy+=.03;p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function tempColor(t){
      if(t<40)return CL.grn;if(t<65)return CL.amb;return CL.red;
    }

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;ctx.lineWidth=.5;for(var x=0;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      // Servers
      for(var i=0;i<servers.length;i++){
        var s=servers[i];var tc=tempColor(s.temp);
        // Rack
        ctx.fillStyle=s.overheated?'#1a0808':'#0d1117';rr(ctx,s.x,s.y,s.w,s.h,4);ctx.fill();
        ctx.strokeStyle=s.overheated?CL.red+'66':CL.brd;ctx.lineWidth=1;rr(ctx,s.x,s.y,s.w,s.h,4);ctx.stroke();
        // Temp bar on left side
        var barH=s.h-10,barFill=barH*(s.temp/100);
        ctx.fillStyle='#0a0a0a';ctx.fillRect(s.x+3,s.y+5,4,barH);
        ctx.fillStyle=tc+'88';ctx.fillRect(s.x+3,s.y+5+barH-barFill,4,barFill);
        // Temp text
        ctx.fillStyle=tc;ctx.font='bold 7px monospace';ctx.textAlign='center';
        ctx.fillText(Math.floor(s.temp)+'C',s.x+s.w/2,s.y+14);
        // LED rows
        for(var led=0;led<4;led++){
          var lx=s.x+s.w/2-8,ly=s.y+24+led*14;
          ctx.fillStyle=s.overheated?CL.red+'44':'#0a0a0a';ctx.fillRect(lx,ly,16,3);
          if(!s.overheated){ctx.fillStyle=z.ac+'66';ctx.fillRect(lx,ly,16*(s.fanSpeed/3),3)}
        }
        // Fan (spinning lines)
        var fx=s.x+s.w/2,fy=s.y+s.h-20,fr2=8;
        ctx.strokeStyle=s.overheated?CL.red+'44':CL.cyan+'66';ctx.lineWidth=1.5;
        for(var b=0;b<3;b++){
          var a=s.fanAngle+b*Math.PI*2/3;
          ctx.beginPath();ctx.moveTo(fx,fy);ctx.lineTo(fx+Math.cos(a)*fr2,fy+Math.sin(a)*fr2);ctx.stroke();
        }
        ctx.strokeStyle=CL.brd;ctx.lineWidth=.5;ctx.beginPath();ctx.arc(fx,fy,fr2+2,0,Math.PI*2);ctx.stroke();
        ctx.textAlign='left';
      }
      // Particles/feedbacks
      for(var i=0;i<particles.length;i++){var p=particles[i];ctx.save();ctx.globalAlpha=p.life/20;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 8px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      // HUD
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 9px monospace';ctx.fillText('\u2B21 '+score,4,12);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,12);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){
        ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('SERVER ROOM',W/2,H/2-20);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.cyan;ctx.fillText('Click servers to cool them down',W/2,H/2);
        ctx.font='bold 8px monospace';ctx.fillStyle=CL.ai;ctx.fillText('AI spikes overheat them. Don\'t let temp hit 100C',W/2,H/2+14);
        if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}
        ctx.textAlign='left';
      }
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){
        ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';
        ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=overheated<2?CL.grn:CL.red;
        ctx.fillText(overheated<2?'UPTIME MAINTAINED':'SERVERS DOWN',W/2,H*.24);
        ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(overheated<2?'0':'1'),W/2,H*.24+14);
        ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);
        ctx.font='bold 9px monospace';ctx.fillStyle=CL.cyan;ctx.fillText(cooled+' cooling bursts',W/2,H*.50+16);
        if(overheated>0){ctx.fillStyle=CL.red;ctx.fillText(overheated+' servers overheated',W/2,H*.50+30)}
        ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('The cloud is just someone else\'s overheating server.',W/2,H*.84);
        ctx.textAlign='left';
      }
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;cooled=0;overheated=0;particles=[];feedbacks=[];initServers()},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  registerGame({
    id: 'login-queue',
    name: 'Login Queue',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];
    var HSKINS=[{bc:'#3570B0',sk:'#F4C7A3',hr:'#3A2A1A'},{bc:'#C04878',sk:'#F0D5C0',hr:'#8B3A1A'},{bc:'#3A9080',sk:'#C8A882',hr:'#1A3A2A'},{bc:'#A83030',sk:'#F0D0B0',hr:'#5A2A1A'}];
    var GY=H-18;
    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var queue=[],particles=[],feedbacks=[];
    var kicked=0,wrongKicks=0,LOGIN_X=W-40;

    function spawnUser(){
      var isBot=Math.random()<(.45+zone*.06);
      queue.push({x:-15,y:GY-8,type:isBot?'bot':'human',speed:.6+zone*.1+Math.random()*.3,
        skin:isBot?null:HSKINS[Math.floor(Math.random()*HSKINS.length)],alive:true,phase:Math.random()*6,
        cutIn:isBot&&Math.random()>.4});
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      for(var i=queue.length-1;i>=0;i--){
        var u=queue[i];if(!u.alive)continue;
        if(Math.abs(mx-u.x)<14&&Math.abs(my-u.y)<16){
          if(u.type==='bot'){u.alive=false;score+=2;kicked++;
            feedbacks.push({x:u.x,y:u.y-18,text:'KICKED! +2',color:CL.grn,life:25});
            for(var p=0;p<5;p++)particles.push({x:u.x,y:u.y,vx:(Math.random()-.5)*4,vy:-1-Math.random()*2,life:15,color:CL.ai,sz:2+Math.random()});
          }else{wrongKicks++;score=Math.max(0,score-2);
            feedbacks.push({x:u.x,y:u.y-18,text:'REAL USER!',color:CL.red,life:30});
            particles.push({x:0,y:0,vx:0,vy:0,life:6,color:CL.red,sz:0,type:'flash'});}
          return;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' queue cleared.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      var rate=Math.max(18,40-zone*4-prog*.08);
      if(fr%Math.floor(rate)===0)spawnUser();
      for(var i=queue.length-1;i>=0;i--){
        var u=queue[i];if(!u.alive){queue.splice(i,1);continue}
        u.phase+=.04;
        var spd=u.type==='bot'&&u.cutIn?u.speed*1.8:u.speed;
        u.x+=spd;
        if(u.x>=LOGIN_X){u.alive=false;
          if(u.type==='bot'){score=Math.max(0,score-1);feedbacks.push({x:LOGIN_X,y:u.y-10,text:'BOT IN!',color:CL.amb,life:20})}
          else{score++;feedbacks.push({x:LOGIN_X,y:u.y-10,text:'LOGGED IN +1',color:CL.hum,life:20})}}
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.04}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;for(var x=0;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      ctx.fillStyle='#0a0e14';ctx.fillRect(0,GY,W,H-GY);
      // Queue lane
      ctx.strokeStyle='#182028';ctx.lineWidth=1;ctx.setLineDash([6,8]);ctx.beginPath();ctx.moveTo(0,GY-16);ctx.lineTo(W,GY-16);ctx.stroke();ctx.setLineDash([]);
      // Login terminal
      ctx.fillStyle=CL.srf;rr(ctx,LOGIN_X-8,20,30,GY-22,4);ctx.fill();ctx.strokeStyle=CL.grn+'44';ctx.lineWidth=1;rr(ctx,LOGIN_X-8,20,30,GY-22,4);ctx.stroke();
      ctx.fillStyle=CL.grn;ctx.font='bold 7px monospace';ctx.save();ctx.translate(LOGIN_X+8,GY/2+10);ctx.rotate(-Math.PI/2);ctx.fillText('LOGIN',0,0);ctx.restore();
      // Users in queue
      for(var i=0;i<queue.length;i++){
        var u=queue[i];if(!u.alive)continue;
        var bob=Math.sin(u.phase)*1;
        if(u.type==='bot'){
          ctx.fillStyle=CL.aiB;rr(ctx,u.x-5,u.y+2+bob,10,7,3);ctx.fill();
          ctx.fillStyle=CL.ai;ctx.beginPath();ctx.arc(u.x,u.y-5+bob,6,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle='#a04520';ctx.lineWidth=.7;ctx.beginPath();ctx.arc(u.x,u.y-5+bob,6,0,Math.PI*2);ctx.stroke();
          ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(u.x,u.y-4.5+bob,2,2.5,0,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#40C8E0';ctx.beginPath();ctx.arc(u.x+.3,u.y-4+bob,1.2,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle=CL.acc;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(u.x,u.y-11+bob);ctx.lineTo(u.x,u.y-14+bob);ctx.stroke();
          ctx.fillStyle=CL.acc;ctx.beginPath();ctx.arc(u.x,u.y-14+bob,1.2,0,Math.PI*2);ctx.fill();
          if(u.cutIn){ctx.fillStyle=CL.red+'66';ctx.font='bold 5px monospace';ctx.textAlign='center';ctx.fillText('CUT!',u.x,u.y-18+bob);ctx.textAlign='left'}
        }else{
          var s=u.skin;
          ctx.fillStyle=s.bc;rr(ctx,u.x-4.5,u.y+2+bob,9,7,3);ctx.fill();
          ctx.fillStyle=s.sk;ctx.beginPath();ctx.arc(u.x,u.y-5+bob,5.5,0,Math.PI*2);ctx.fill();
          ctx.fillStyle=s.hr;ctx.beginPath();ctx.arc(u.x,u.y-5+bob,5.5,Math.PI,2*Math.PI);ctx.fill();
          ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(u.x,u.y-4.5+bob,1.8,2.2,0,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#1a1a2e';ctx.beginPath();ctx.arc(u.x,u.y-4+bob,.9,0,Math.PI*2);ctx.fill();
        }
      }
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/6*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/15;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 8px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 9px monospace';ctx.fillText('\u2B21 '+score,4,12);
        ctx.fillStyle=CL.grn;ctx.font='bold 7px monospace';ctx.fillText(kicked+' kicked',55,12);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-45,12);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('LOGIN QUEUE',W/2,H/2-20);ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Click AI bots to kick them from the queue',W/2,H/2);ctx.font='bold 8px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Let real users log in',W/2,H/2+14);if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}ctx.textAlign='left'}
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=kicked>wrongKicks?CL.grn:CL.red;ctx.fillText(kicked>wrongKicks?'QUEUE SECURED':'BOTS GOT THROUGH',W/2,H*.24);ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(kicked>wrongKicks?'0':'1'),W/2,H*.24+14);ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(kicked+' bots kicked',W/2,H*.50+16);ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('CAPTCHA this.',W/2,H*.84);ctx.textAlign='left'}
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;kicked=0;wrongKicks=0;queue=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  registerGame({
    id: 'merge-conflict',
    name: 'Merge Conflict',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',hum:'#4A90D9',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var blocks=[],particles=[],feedbacks=[];
    var resolved=0,conflicts=0;
    var MERGE_X=W/2;
    var LABELS=['const','let','var','function','return','import','export','async','class','if','for','while','try','catch','switch'];

    function spawnBlock(){
      var lane=Math.floor(Math.random()*5);
      var y=14+lane*((H-30)/5);
      var label=LABELS[Math.floor(Math.random()*LABELS.length)];
      var fromLeft=Math.random()>.5;
      var speed=.4+zone*.12+Math.random()*.3+prog*.002;
      var isAI=Math.random()<(.5+zone*.05);
      blocks.push({x:fromLeft?-60:W+60,y:y,lane:lane,label:label,speed:fromLeft?speed:-speed,
        type:isAI?'ai':'human',alive:true,w:55,h:16});
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      for(var i=blocks.length-1;i>=0;i--){
        var b=blocks[i];if(!b.alive)continue;
        if(mx>=b.x-b.w/2&&mx<=b.x+b.w/2&&my>=b.y&&my<=b.y+b.h){
          if(b.type==='ai'){b.alive=false;score+=2;resolved++;
            feedbacks.push({x:b.x,y:b.y-5,text:'RESOLVED! +2',color:CL.grn,life:22});
            for(var p=0;p<5;p++)particles.push({x:b.x,y:b.y+8,vx:(Math.random()-.5)*3,vy:-Math.random()*2,life:12,color:CL.ai,sz:2+Math.random()});
          }else{score=Math.max(0,score-1);conflicts++;
            feedbacks.push({x:b.x,y:b.y-5,text:'HUMAN CODE!',color:CL.red,life:28});
            particles.push({x:0,y:0,vx:0,vy:0,life:5,color:CL.red,sz:0,type:'flash'});}
          return;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' merged.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      var rate=Math.max(12,30-zone*3-prog*.06);
      if(fr%Math.floor(rate)===0)spawnBlock();
      for(var i=blocks.length-1;i>=0;i--){
        var b=blocks[i];if(!b.alive){blocks.splice(i,1);continue}
        b.x+=b.speed;
        // Collision at merge line
        if(Math.abs(b.x-MERGE_X)<3){
          if(b.type==='ai'){score=Math.max(0,score-1);
            feedbacks.push({x:MERGE_X,y:b.y,text:'CONFLICT!',color:CL.amb,life:22})}
          else{score++;feedbacks.push({x:MERGE_X,y:b.y,text:'MERGED +1',color:CL.hum,life:18})}
          b.alive=false;
          for(var p=0;p<3;p++)particles.push({x:MERGE_X,y:b.y+8,vx:(Math.random()-.5)*2,vy:(Math.random()-.5)*2,life:10,color:b.type==='ai'?CL.ai:CL.hum,sz:2});
        }
        if(b.x<-80||b.x>W+80)blocks.splice(i,1);
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.03}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;for(var x=0;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      // Merge line
      ctx.strokeStyle=CL.acc+'44';ctx.lineWidth=1;ctx.setLineDash([4,6]);ctx.beginPath();ctx.moveTo(MERGE_X,6);ctx.lineTo(MERGE_X,H-6);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=CL.acc+'44';ctx.font='bold 6px monospace';ctx.textAlign='center';ctx.fillText('MERGE',MERGE_X,8);ctx.textAlign='left';
      // Lane lines
      for(var i=0;i<5;i++){var ly=14+i*((H-30)/5);ctx.fillStyle=i%2===0?'#0c0e14':'#0e1018';ctx.fillRect(0,ly-2,(H-30)/5>0?W:0,((H-30)/5))}
      // Blocks
      for(var i=0;i<blocks.length;i++){
        var b=blocks[i];if(!b.alive)continue;
        var isAI=b.type==='ai';
        ctx.fillStyle=(isAI?CL.ai:CL.hum)+'22';rr(ctx,b.x-b.w/2,b.y,b.w,b.h,4);ctx.fill();
        ctx.strokeStyle=(isAI?CL.ai:CL.hum)+'88';ctx.lineWidth=1;rr(ctx,b.x-b.w/2,b.y,b.w,b.h,4);ctx.stroke();
        ctx.fillStyle=isAI?CL.ai:CL.hum;ctx.font='bold 7px monospace';ctx.textAlign='center';ctx.fillText(b.label,b.x,b.y+11);ctx.textAlign='left';
        // Direction arrow
        var dir=b.speed>0?1:-1;
        ctx.fillStyle=(isAI?CL.ai:CL.hum)+'55';
        ctx.beginPath();ctx.moveTo(b.x+dir*(b.w/2+2),b.y+b.h/2);ctx.lineTo(b.x+dir*(b.w/2+7),b.y+b.h/2-3);ctx.lineTo(b.x+dir*(b.w/2+7),b.y+b.h/2+3);ctx.closePath();ctx.fill();
      }
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/5*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/12;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 8px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 9px monospace';ctx.fillText('\u2B21 '+score,4,H-5);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,H-5);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('MERGE CONFLICT',W/2,H/2-20);ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Click AI code blocks (orange) before they merge',W/2,H/2);ctx.font='bold 8px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Let human code (blue) merge safely',W/2,H/2+14);if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}ctx.textAlign='left'}
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=resolved>conflicts?CL.grn:CL.red;ctx.fillText(resolved>conflicts?'BRANCH MERGED':'MERGE FAILED',W/2,H*.24);ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(resolved>conflicts?'0':'1'),W/2,H*.24+14);ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(resolved+' resolved',W/2,H*.50+16);ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('git push --force was not the answer.',W/2,H*.84);ctx.textAlign='left'}
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;resolved=0;conflicts=0;blocks=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  registerGame({
    id: 'proxy-war',
    name: 'Proxy War',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',hum:'#4A90D9',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var NODE_COUNT=5,nodes=[];
    var messages=[],particles=[],feedbacks=[];
    var intercepted=0,wrongInt=0;

    function initNodes(){
      nodes=[];
      for(var i=0;i<NODE_COUNT;i++){
        nodes.push({x:50+i*((W-100)/(NODE_COUNT-1)),y:30+Math.sin(i*1.2)*25+Math.random()*20,r:8+Math.random()*4});
      }
    }

    function spawnMessage(){
      var fromNode=Math.floor(Math.random()*NODE_COUNT);
      var toNode;do{toNode=Math.floor(Math.random()*NODE_COUNT)}while(toNode===fromNode);
      var isAI=Math.random()<(.5+zone*.06);
      var speed=.8+zone*.15+Math.random()*.4+prog*.003;
      messages.push({fromIdx:fromNode,toIdx:toNode,t:0,speed:speed/(60),type:isAI?'ai':'human',alive:true,sz:4+Math.random()*2});
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      for(var i=messages.length-1;i>=0;i--){
        var m=messages[i];if(!m.alive)continue;
        var n0=nodes[m.fromIdx],n1=nodes[m.toIdx];
        var mx2=n0.x+(n1.x-n0.x)*m.t,my2=n0.y+(n1.y-n0.y)*m.t;
        // Curved path offset
        var mid=.5,curve=30+Math.abs(m.fromIdx-m.toIdx)*8;
        var cy2=(n0.y+n1.y)/2-curve;
        var tt=m.t;mx2=n0.x*(1-tt)*(1-tt)+((n0.x+n1.x)/2)*2*tt*(1-tt)+n1.x*tt*tt;
        my2=n0.y*(1-tt)*(1-tt)+cy2*2*tt*(1-tt)+n1.y*tt*tt;
        if(Math.abs(mx-mx2)<12&&Math.abs(my-my2)<12){
          if(m.type==='ai'){m.alive=false;score+=2;intercepted++;
            feedbacks.push({x:mx2,y:my2-10,text:'BLOCKED! +2',color:CL.grn,life:22});
            for(var p=0;p<5;p++)particles.push({x:mx2,y:my2,vx:(Math.random()-.5)*3,vy:(Math.random()-.5)*3,life:12,color:CL.ai,sz:2+Math.random()});
          }else{wrongInt++;score=Math.max(0,score-2);
            feedbacks.push({x:mx2,y:my2-10,text:'HUMAN MSG!',color:CL.red,life:28});
            particles.push({x:0,y:0,vx:0,vy:0,life:5,color:CL.red,sz:0,type:'flash'});}
          return;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    initNodes();

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' routed.';trT=70;trA=0;initNodes()}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      var rate=Math.max(15,30-zone*3-prog*.06);
      if(fr%Math.floor(rate)===0)spawnMessage();
      for(var i=messages.length-1;i>=0;i--){
        var m=messages[i];if(!m.alive){messages.splice(i,1);continue}
        m.t+=m.speed;
        if(m.t>=1){m.alive=false;
          if(m.type==='ai'){feedbacks.push({x:nodes[m.toIdx].x,y:nodes[m.toIdx].y-10,text:'DELIVERED',color:CL.amb,life:18})}
          else{score++;feedbacks.push({x:nodes[m.toIdx].x,y:nodes[m.toIdx].y-10,text:'+1',color:CL.hum,life:15})}}
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.03}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;for(var x=0;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      // Connection lines between nodes
      ctx.save();ctx.globalAlpha=.06;ctx.strokeStyle='#fff';ctx.lineWidth=.5;
      for(var i=0;i<NODE_COUNT;i++)for(var j=i+1;j<NODE_COUNT;j++){ctx.beginPath();ctx.moveTo(nodes[i].x,nodes[i].y);ctx.lineTo(nodes[j].x,nodes[j].y);ctx.stroke()}
      ctx.restore();
      // Nodes
      for(var i=0;i<NODE_COUNT;i++){
        var n=nodes[i];
        ctx.save();ctx.globalAlpha=.06;var g=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r*3);g.addColorStop(0,CL.acc);g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.beginPath();ctx.arc(n.x,n.y,n.r*3,0,Math.PI*2);ctx.fill();ctx.restore();
        ctx.fillStyle=CL.srf;ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=CL.acc+'55';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.stroke();
        ctx.fillStyle=CL.acc;ctx.font='bold 6px monospace';ctx.textAlign='center';ctx.fillText('N'+i,n.x,n.y+3);ctx.textAlign='left';
      }
      // Messages
      for(var i=0;i<messages.length;i++){
        var m=messages[i];if(!m.alive)continue;
        var n0=nodes[m.fromIdx],n1=nodes[m.toIdx];
        var curve=30+Math.abs(m.fromIdx-m.toIdx)*8;
        var cy2=(n0.y+n1.y)/2-curve;
        var tt=m.t;
        var mx2=n0.x*(1-tt)*(1-tt)+((n0.x+n1.x)/2)*2*tt*(1-tt)+n1.x*tt*tt;
        var my2=n0.y*(1-tt)*(1-tt)+cy2*2*tt*(1-tt)+n1.y*tt*tt;
        var isAI=m.type==='ai';
        ctx.save();ctx.globalAlpha=.15;ctx.fillStyle=isAI?CL.ai:CL.hum;ctx.beginPath();ctx.arc(mx2,my2,m.sz*2,0,Math.PI*2);ctx.fill();ctx.restore();
        ctx.fillStyle=isAI?CL.ai:CL.hum;ctx.beginPath();ctx.arc(mx2,my2,m.sz,0,Math.PI*2);ctx.fill();
        // Trail
        for(var t=1;t<=3;t++){var pt=m.t-t*.03;if(pt<0)continue;
          var px=n0.x*(1-pt)*(1-pt)+((n0.x+n1.x)/2)*2*pt*(1-pt)+n1.x*pt*pt;
          var py=n0.y*(1-pt)*(1-pt)+cy2*2*pt*(1-pt)+n1.y*pt*pt;
          ctx.save();ctx.globalAlpha=.1*(3-t)/3;ctx.fillStyle=isAI?CL.ai:CL.hum;ctx.beginPath();ctx.arc(px,py,m.sz*.6,0,Math.PI*2);ctx.fill();ctx.restore()}
      }
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/5*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/12;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 8px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 9px monospace';ctx.fillText('\u2B21 '+score,4,H-5);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-8,H-5);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('PROXY WAR',W/2,H/2-20);ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Click AI messages (orange dots) to intercept',W/2,H/2);ctx.font='bold 8px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Let human messages (blue dots) pass through',W/2,H/2+14);if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}ctx.textAlign='left'}
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=intercepted>wrongInt?CL.grn:CL.red;ctx.fillText(intercepted>wrongInt?'NETWORK SECURED':'TRAFFIC COMPROMISED',W/2,H*.24);ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(intercepted>wrongInt?'0':'1'),W/2,H*.24+14);ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(intercepted+' intercepted',W/2,H*.50+16);ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('The packets never lie.',W/2,H*.84);ctx.textAlign='left'}
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;intercepted=0;wrongInt=0;messages=[];particles=[];feedbacks=[];initNodes()},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });


  registerGame({
    id: 'clock-puncher',
    name: 'Clock Puncher',
    version: '1.0',
    factory: function(canvas) {
    var ctx = canvas.getContext('2d');var W = canvas.width, H = canvas.height;var running = true;
    var CL = {bg:'#0F0D1A',srf:'#1E1C30',brd:'#21262d',ai:'#D85A30',aiB:'#c94b22',hum:'#4A90D9',acc:'#7C50FF',grn:'#39E07A',amb:'#E8A000',red:'#E24B4A',cyan:'#50C8FF'};
    var ZONES=[{name:'Tech Office',sky:'#0c1015',ac:'#3fb950'},{name:'Design Studio',sky:'#14100a',ac:'#E8A000'},{name:'Newsroom',sky:'#080808',ac:'#E24B4A'},{name:'Film Set',sky:'#150008',ac:'#FFD700'},{name:'Trading Floor',sky:'#040a04',ac:'#E8A000'}];
    var HSKINS=[{bc:'#3570B0',sk:'#F4C7A3',hr:'#3A2A1A'},{bc:'#C04878',sk:'#F0D5C0',hr:'#8B3A1A'},{bc:'#3A9080',sk:'#C8A882',hr:'#1A3A2A'},{bc:'#A83030',sk:'#F0D0B0',hr:'#5A2A1A'}];
    var GY=H-18;
    var CLOCK_X=W-35;

    var state='INTRO',fr=0,score=0,prog=0,zone=0,introT=0,trT=0,trTxt='',trA=0;
    var workers=[],particles=[],feedbacks=[];
    var blocked=0,letIn=0,wrongBlocks=0;

    function spawnWorker(){
      var isAI=Math.random()<(.5+zone*.06);
      var lane=Math.floor(Math.random()*4);
      var wy=GY-8-lane*28-Math.random()*6;
      workers.push({x:-15,y:wy,speed:.5+zone*.1+Math.random()*.4+prog*.002,
        type:isAI?'ai':'human',skin:isAI?null:HSKINS[Math.floor(Math.random()*HSKINS.length)],
        alive:true,phase:Math.random()*6});
    }

    function onMouseDown(e){
      e.preventDefault();e.stopPropagation();
      var rect=canvas.getBoundingClientRect();var mx=(e.clientX-rect.left)*(W/rect.width);var my=(e.clientY-rect.top)*(H/rect.height);
      if(state==='INTRO'){state='PLAYING';return}
      if(state!=='PLAYING')return;
      for(var i=workers.length-1;i>=0;i--){
        var w=workers[i];if(!w.alive)continue;
        if(Math.abs(mx-w.x)<14&&Math.abs(my-w.y)<16){
          if(w.type==='ai'){w.alive=false;score+=2;blocked++;
            feedbacks.push({x:w.x,y:w.y-18,text:'BLOCKED! +2',color:CL.grn,life:22});
            for(var p=0;p<5;p++)particles.push({x:w.x,y:w.y,vx:(Math.random()-.5)*3,vy:-1-Math.random()*2,life:14,color:CL.ai,sz:2+Math.random()});
          }else{wrongBlocks++;score=Math.max(0,score-2);
            feedbacks.push({x:w.x,y:w.y-18,text:'EMPLOYEE!',color:CL.red,life:28});
            particles.push({x:0,y:0,vx:0,vy:0,life:5,color:CL.red,sz:0,type:'flash'});}
          return;
        }
      }
    }
    function onContextMenu(e){e.preventDefault();e.stopPropagation()}
    canvas.addEventListener('mousedown',onMouseDown);canvas.addEventListener('contextmenu',onContextMenu);

    function update(){
      fr++;
      if(state==='INTRO'){introT++;if(introT>180)state='PLAYING';return}
      if(state!=='PLAYING')return;
      var pz=zone;zone=prog<20?0:prog<40?1:prog<60?2:prog<75?3:4;
      if(pz!==zone){trTxt=ZONES[pz].name+' shift change.';trT=70;trA=0}
      if(trT>0){trT--;if(trT>45)trA=Math.min(1,trA+.07);else if(trT<12)trA=Math.max(0,trA-.07)}
      var rate=Math.max(18,38-zone*4-prog*.07);
      if(fr%Math.floor(rate)===0)spawnWorker();
      for(var i=workers.length-1;i>=0;i--){
        var w=workers[i];if(!w.alive){workers.splice(i,1);continue}
        w.phase+=.04;w.x+=w.speed;
        if(w.x>=CLOCK_X){w.alive=false;
          if(w.type==='ai'){score=Math.max(0,score-1);feedbacks.push({x:CLOCK_X,y:w.y-5,text:'PUNCHED IN!',color:CL.amb,life:20})}
          else{letIn++;score++;feedbacks.push({x:CLOCK_X,y:w.y-5,text:'CLOCKED IN +1',color:CL.hum,life:18})}}
      }
      for(var i=feedbacks.length-1;i>=0;i--){feedbacks[i].y-=.4;feedbacks[i].life--;if(feedbacks[i].life<=0)feedbacks.splice(i,1)}
      for(var i=particles.length-1;i>=0;i--){var p=particles[i];if(p.type!=='flash'){p.x+=p.vx;p.y+=p.vy;p.vy+=.04}p.life--;if(p.life<=0)particles.splice(i,1)}
      if(prog>=100)state='FINISHED';
    }

    function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath()}

    function draw(){
      var z=ZONES[zone];ctx.fillStyle=z.sky;ctx.fillRect(0,0,W,H);
      ctx.save();ctx.globalAlpha=.02;ctx.strokeStyle=z.ac;for(var x=0;x<W;x+=35){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}ctx.restore();
      ctx.fillStyle='#0a0e14';ctx.fillRect(0,GY,W,H-GY);
      // Time clock
      ctx.fillStyle=CL.srf;rr(ctx,CLOCK_X-10,10,28,GY-12,4);ctx.fill();
      ctx.strokeStyle=CL.grn+'44';ctx.lineWidth=1;rr(ctx,CLOCK_X-10,10,28,GY-12,4);ctx.stroke();
      // Clock face
      var clockY=35,clockR=8;
      ctx.strokeStyle=CL.grn;ctx.lineWidth=1;ctx.beginPath();ctx.arc(CLOCK_X+4,clockY,clockR,0,Math.PI*2);ctx.stroke();
      var angle=fr*.02;ctx.beginPath();ctx.moveTo(CLOCK_X+4,clockY);ctx.lineTo(CLOCK_X+4+Math.cos(angle)*clockR*.7,clockY+Math.sin(angle)*clockR*.7);ctx.stroke();
      ctx.fillStyle=CL.grn;ctx.font='bold 6px monospace';ctx.textAlign='center';ctx.fillText('CLOCK',CLOCK_X+4,clockY+20);ctx.fillText('IN',CLOCK_X+4,clockY+28);ctx.textAlign='left';
      // Lane guidelines
      for(var i=0;i<4;i++){ctx.save();ctx.globalAlpha=.04;ctx.strokeStyle='#fff';ctx.setLineDash([3,8]);ctx.beginPath();ctx.moveTo(0,GY-8-i*28);ctx.lineTo(CLOCK_X-15,GY-8-i*28);ctx.stroke();ctx.setLineDash([]);ctx.restore()}
      // Workers
      for(var i=0;i<workers.length;i++){
        var w=workers[i];if(!w.alive)continue;
        var bob=Math.sin(w.phase)*1;
        if(w.type==='ai'){
          ctx.fillStyle=CL.aiB;rr(ctx,w.x-5,w.y+2+bob,10,7,3);ctx.fill();
          ctx.fillStyle=CL.ai;ctx.beginPath();ctx.arc(w.x,w.y-5+bob,6,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle='#a04520';ctx.lineWidth=.7;ctx.beginPath();ctx.arc(w.x,w.y-5+bob,6,0,Math.PI*2);ctx.stroke();
          ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(w.x,w.y-4.5+bob,2,2.5,0,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#40C8E0';ctx.beginPath();ctx.arc(w.x+.3,w.y-4+bob,1.2,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle=CL.acc;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(w.x,w.y-11+bob);ctx.lineTo(w.x,w.y-14+bob);ctx.stroke();
          ctx.fillStyle=CL.acc;ctx.beginPath();ctx.arc(w.x,w.y-14+bob,1.2,0,Math.PI*2);ctx.fill();
        }else{
          var s=w.skin;
          ctx.fillStyle=s.bc;rr(ctx,w.x-4.5,w.y+2+bob,9,7,3);ctx.fill();
          ctx.fillStyle=s.sk;ctx.beginPath();ctx.arc(w.x,w.y-5+bob,5.5,0,Math.PI*2);ctx.fill();
          ctx.fillStyle=s.hr;ctx.beginPath();ctx.arc(w.x,w.y-5+bob,5.5,Math.PI,2*Math.PI);ctx.fill();
          ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(w.x,w.y-4.5+bob,1.8,2.2,0,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#1a1a2e';ctx.beginPath();ctx.arc(w.x,w.y-4+bob,.9,0,Math.PI*2);ctx.fill();
        }
      }
      for(var i=0;i<particles.length;i++){var p=particles[i];if(p.type==='flash'){ctx.save();ctx.globalAlpha=p.life/5*.1;ctx.fillStyle=p.color;ctx.fillRect(0,0,W,H);ctx.restore()}else{ctx.save();ctx.globalAlpha=p.life/14;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);ctx.fill();ctx.restore()}}
      for(var i=0;i<feedbacks.length;i++){var f=feedbacks[i];ctx.save();ctx.globalAlpha=Math.min(1,f.life/10);ctx.font='bold 8px monospace';ctx.fillStyle=f.color;ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y);ctx.textAlign='left';ctx.restore()}
      if(state==='PLAYING'||state==='FINISHED'){
        ctx.fillStyle=CL.acc;ctx.font='bold 9px monospace';ctx.fillText('\u2B21 '+score,4,12);
        ctx.fillStyle=CL.grn;ctx.font='bold 7px monospace';ctx.fillText(blocked+' blocked',55,12);
        ctx.textAlign='right';ctx.fillStyle='#444';ctx.font='bold 7px monospace';ctx.fillText(ZONES[zone].name,W-45,12);ctx.textAlign='left';
        ctx.fillStyle='#21262d';ctx.fillRect(0,H-3,W,3);ctx.fillStyle=prog>90?CL.grn:CL.acc+'88';ctx.fillRect(0,H-3,W*(prog/100),3);
      }
      if(state==='INTRO'){ctx.fillStyle='rgba(15,13,26,0.65)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.font='800 18px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.fillText('CLOCK PUNCHER',W/2,H/2-20);ctx.font='bold 9px monospace';ctx.fillStyle=CL.ai;ctx.fillText('Click AI agents to stop them clocking in',W/2,H/2);ctx.font='bold 8px monospace';ctx.fillStyle=CL.hum;ctx.fillText('Let human employees punch the clock',W/2,H/2+14);if(Math.sin(fr*.06)>0){ctx.font='bold 10px monospace';ctx.fillStyle=CL.acc;ctx.fillText('[ CLICK TO START ]',W/2,H/2+36)}ctx.textAlign='left'}
      if(trT>0&&trTxt){ctx.save();ctx.globalAlpha=trA*.5;ctx.fillStyle='#000';ctx.fillRect(0,H/2-12,W,24);ctx.globalAlpha=trA;ctx.font='bold 10px Exo 2,sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(trTxt,W/2,H/2+4);ctx.textAlign='left';ctx.restore()}
      if(state==='FINISHED'){ctx.fillStyle='rgba(15,13,26,0.85)';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.font='800 17px Exo 2,sans-serif';ctx.fillStyle=blocked>wrongBlocks?CL.grn:CL.red;ctx.fillText(blocked>wrongBlocks?'SHIFT SECURED':'AI ON PAYROLL',W/2,H*.24);ctx.font='bold 9px monospace';ctx.fillStyle='#666';ctx.fillText('exit code '+(blocked>wrongBlocks?'0':'1'),W/2,H*.24+14);ctx.font='bold 12px monospace';ctx.fillStyle=CL.acc;ctx.fillText('\u2B21 '+score+' points',W/2,H*.50);ctx.font='bold 9px monospace';ctx.fillStyle=CL.grn;ctx.fillText(blocked+' AI blocked',W/2,H*.50+16);ctx.fillStyle=CL.hum;ctx.fillText(letIn+' humans clocked in',W/2,H*.50+30);ctx.font='bold 7px monospace';ctx.fillStyle='#444';ctx.fillText('Time is money. AI doesn\'t get paid.',W/2,H*.84);ctx.textAlign='left'}
      ctx.save();ctx.globalAlpha=.02;for(var y=0;y<H;y+=3){ctx.fillStyle='#000';ctx.fillRect(0,y,W,1)}ctx.restore();
    }
    function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}loop();
    return{
      start:function(){state='INTRO';fr=0;score=0;prog=0;zone=0;introT=0;trT=0;blocked=0;letIn=0;wrongBlocks=0;workers=[];particles=[];feedbacks=[]},
      setProgress:function(v){if(state==='PLAYING')prog=Math.min(100,Math.max(prog,v))},
      getState:function(){return{state:state,score:score,prog:prog}},
      destroy:function(){running=false;canvas.removeEventListener('mousedown',onMouseDown);canvas.removeEventListener('contextmenu',onContextMenu)}
    };
    }
  });

  // ═══════════════════════════════════════════════════════════
  // END — Games registered. Registry picks randomly on trigger.
  // ═══════════════════════════════════════════════════════════

})();
