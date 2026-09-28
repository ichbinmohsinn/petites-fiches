/* Petites Fiches — French vocabulary flashcards
 * Plain JavaScript, no build step. Data: /data/vocabulary.json
 * Accounts, sync, leaderboard and live games: Supabase (see supabase/schema.sql)
 */
(function(){
"use strict";

const CFG = window.APP_CONFIG || {};
const APP = CFG.appName || 'Petites Fiches';
const CONFIGURED = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && !/YOUR-/.test(CFG.supabaseUrl + CFG.supabaseAnonKey) && window.supabase);
const sb = CONFIGURED ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}}) : null;

let CATS=[], CAT={}, CARDS=[], BYID={}, BYCAT={}, GROUPS=[];
const DAY = 86400000, INTERVALS=[0,1,3,7,14,30], SESSION_SIZE = 12;
const AVATARS=['🦊','🐼','🐸','🦉','🐯','🐨','🐙','🦄','🐝','🐧','🦁','🐢','🥐','🗼','🎨','⚽','🎸','🌻','🚲','🧀'];

/* ================= state: device first, then account ================= */
const KEY='petites-fiches-v1';
function fresh(){ return {cards:{},xp:0,streak:0,lastDay:null,today:{date:null,n:0},goal:20,dir:'fr',week:{key:null,xp:0},games:{played:0,won:0,lastCode:null},since:Date.now(),owner:null}; }
function normalize(s){ const f=fresh(); s=Object.assign(f,s||{}); s.week=s.week||f.week; s.games=Object.assign(f.games,s.games||{}); s.today=s.today||f.today; s.cards=s.cards||{}; return s; }
function loadLocal(){ try{ const s=JSON.parse(localStorage.getItem(KEY)); if(s&&s.cards) return normalize(s); }catch(e){} return fresh(); }
let S = loadLocal();

const ACC = {ready:!CONFIGURED, id:null, email:'', name:'', avatar:'🙂', synced:false};
let saveT=null, playerT=null;
function saveLocal(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }
function save(){
  saveLocal();
  if(sb && ACC.id){ clearTimeout(saveT); saveT=setTimeout(pushProgress, 1500); clearTimeout(playerT); playerT=setTimeout(pushPlayer, 4000); }
}
let pushing=false, pushAgain=false;
async function pushProgress(){
  if(!sb||!ACC.id) return;
  if(pushing){ pushAgain=true; return; } pushing=true;
  const {error}=await sb.from('progress').upsert({user_id:ACC.id, data:S, updated_at:new Date().toISOString()});
  if(!error) ACC.synced=true;
  pushing=false; if(pushAgain){ pushAgain=false; pushProgress(); }
}
async function pushPlayer(){
  if(!sb||!ACC.id) return;
  const st=globalStats(), wk=weekKey();
  await sb.from('profiles').update({xp:S.xp, learned:st.learned, mastered:st.mastered, streak:currentStreak(), week_key:wk,
    week_xp:S.week.key===wk?S.week.xp:0, games_played:S.games.played, games_won:S.games.won, last_active:new Date().toISOString()}).eq('id',ACC.id);
}
function flushNow(){ if(sb&&ACC.id){ clearTimeout(saveT); clearTimeout(playerT); pushProgress(); pushPlayer(); } }
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushNow(); });

function mergeStates(a,b){
  const base=normalize(JSON.parse(JSON.stringify(a.xp>=b.xp?a:b))), other=a.xp>=b.xp?b:a;
  for(const [id,c] of Object.entries(other.cards||{})){ const m=base.cards[id]; if(!m || (c.n||0)>(m.n||0)) base.cards[id]=c; }
  base.since=Math.min(a.since||Date.now(), b.since||Date.now());
  return base;
}
async function loadAccount(user){
  ACC.id=user.id; ACC.email=user.email||'';
  let prof=null;
  for(let i=0;i<3 && !prof;i++){ const r=await sb.from('profiles').select('*').eq('id',user.id).maybeSingle(); prof=r.data; if(!prof) await new Promise(r=>setTimeout(r,600)); }
  if(prof){ ACC.name=prof.display_name; ACC.avatar=prof.avatar; }
  const {data:row}=await sb.from('progress').select('data').eq('user_id',user.id).maybeSingle();
  const local=S;
  const localIsMine = !local.owner || local.owner===user.id;
  const localHas = Object.keys(local.cards).length>0;
  if(row && row.data && Object.keys(row.data).length){
    const remote=normalize(row.data);
    S = (localIsMine && localHas) ? mergeStates(remote, local) : remote;
  } else {
    S = localIsMine ? local : fresh();
  }
  S.owner=user.id; saveLocal(); ACC.synced=true;
  pushProgress(); pushPlayer();
}
function signedOut(){ ACC.id=null; ACC.name=''; ACC.email=''; ACC.avatar='🙂'; ACC.synced=false; S=fresh(); try{localStorage.removeItem(KEY);}catch(e){} }

async function initAuth(){
  if(!sb){ ACC.ready=true; return; }
  let handled=false;
  sb.auth.onAuthStateChange((event, session)=>{
    setTimeout(async ()=>{ // run outside the auth callback, as Supabase recommends
      if(event==='PASSWORD_RECOVERY'){ location.hash='#/reset'; }
      if(event==='SIGNED_OUT'){ signedOut(); ACC.ready=true; render(); return; }
      if(session && session.user && session.user.id!==ACC.id && (event==='SIGNED_IN'||event==='INITIAL_SESSION')){
        await loadAccount(session.user); ACC.ready=true; cleanUrl();
        const r=route().name; let next=null; try{ next=sessionStorage.getItem('pf-next'); sessionStorage.removeItem('pf-next'); }catch(e){}
        if(['login','signup'].includes(r)) location.hash=next||'#/'; else if(!['study','game'].includes(r)) render();
        return;
      }
      if(event==='INITIAL_SESSION' && !session){ ACC.ready=true; if(!['study'].includes(route().name)) render(); }
      handled=true;
    },0);
  });
  setTimeout(()=>{ if(!ACC.ready){ ACC.ready=true; render(); } }, 6000);
}
function cleanUrl(){ if(location.search){ history.replaceState(null,'',location.pathname+location.hash); } }

/* ================= helpers ================= */
const $=(sel,el=document)=>el.querySelector(sel);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const gClass=g=>g?('g-'+g.replace(/[\s/]/g,'')):'';
const G_LABEL={m:'masc.',f:'fém.','m/f':'m / f',pl:'plural','m pl':'masc. pl.','f pl':'fém. pl.'};
function gTag(g){ return g? `<span class="tag ${gClass(g)}">${G_LABEL[g]||g}</span>` : ''; }
function box(id){ return (S.cards[id]||{}).b||0; }
function isDue(id,now=Date.now()){ const s=S.cards[id]; return s && s.d<=now; }
function catStats(cid){ const list=BYCAT[cid]; let learned=0,mastered=0,due=0; const now=Date.now();
  list.forEach(c=>{const b=box(c.id); if(b>=1)learned++; if(b>=4)mastered++; if(isDue(c.id,now))due++;});
  return {total:list.length,learned,mastered,due}; }
function globalStats(){ let learned=0,mastered=0; for(const c of CARDS){const b=box(c.id); if(b>=1)learned++; if(b>=4)mastered++;} return {learned,mastered}; }
function allDue(){ const now=Date.now(); return CARDS.filter(c=>isDue(c.id,now)); }
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function dayStr(ts){ const d=new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
const todayStr=()=>dayStr(Date.now());
function todayCount(){ return S.today.date===todayStr()? S.today.n : 0; }
function currentStreak(){ const t=todayStr(), y=dayStr(Date.now()-DAY); return (S.lastDay===t||S.lastDay===y)? S.streak : 0; }
function weekKey(){ const d=new Date(); const day=(d.getDay()+6)%7; d.setHours(0,0,0,0); d.setDate(d.getDate()-day); return dayStr(d.getTime()); }
function firstName(){ return (ACC.name||'').trim().split(/\s+/)[0]||''; }
function avatar(emoji, cls='avatar'){ return `<span class="${cls}" aria-hidden="true">${esc(emoji||'🙂')}</span>`; }

/* ================= speech ================= */
let frVoice=null;
function pickVoice(){ if(!('speechSynthesis' in window)) return; const v=speechSynthesis.getVoices();
  frVoice=v.find(x=>/^fr[-_]FR/i.test(x.lang)&&/google|amélie|thomas|audrey|natural/i.test(x.name))||v.find(x=>/^fr[-_]FR/i.test(x.lang))||v.find(x=>/^fr/i.test(x.lang))||null; }
if('speechSynthesis' in window){ pickVoice(); speechSynthesis.onvoiceschanged=pickVoice; }
function speakable(t){ return t.replace(/[()]/g,'').replace(/\s*=\s*/g,', ').replace(/\s\/\s/g,', ').replace(/…/g,'').replace(/—/g,',').replace(/\s+/g,' ').trim(); }
function speak(text){
  if(!('speechSynthesis' in window)){ toast('Audio is not supported in this browser'); return; }
  speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(speakable(text)); u.lang='fr-FR'; u.rate=.88; if(frVoice)u.voice=frVoice; speechSynthesis.speak(u);
}
let toastT; function toast(msg){ let t=$('.toast'); if(!t){t=document.createElement('div');t.className='toast';t.setAttribute('role','status');document.body.appendChild(t);} t.textContent=msg; clearTimeout(toastT); toastT=setTimeout(()=>t.remove(),2600); }

/* ================= spaced repetition ================= */
function addXp(n){ S.xp+=n; const wk=weekKey(); if(S.week.key!==wk) S.week={key:wk,xp:0}; S.week.xp+=n; }
function touchDay(){ const t=todayStr(); if(S.today.date!==t){ const y=dayStr(Date.now()-DAY); S.streak=(S.lastDay===y)? S.streak+1 : 1; S.lastDay=t; S.today={date:t,n:0}; } }
function grade(id, good){
  const now=Date.now(); const s=S.cards[id]||{b:0,d:now,n:0};
  s.n=(s.n||0)+1;
  if(good){ s.b=Math.min(s.b+1,5); s.d=now+INTERVALS[s.b]*DAY; addXp(10); }
  else { s.b=Math.max(1,s.b-1); s.d=now+10*60*1000; addXp(2); }
  S.cards[id]=s; touchDay(); S.today.n++; save();
}
function buildSession(pool){
  const now=Date.now();
  const due=pool.filter(c=>isDue(c.id,now)).sort((a,b)=>S.cards[a.id].d-S.cards[b.id].d);
  const fr=pool.filter(c=>!S.cards[c.id]);
  let pick=due.slice(0,SESSION_SIZE);
  if(pick.length<SESSION_SIZE) pick=pick.concat(fr.slice(0,SESSION_SIZE-pick.length));
  if(!pick.length) pick=pool.slice().sort((a,b)=>box(a.id)-box(b.id)||S.cards[a.id].d-S.cards[b.id].d).slice(0,SESSION_SIZE);
  return shuffle(pick).map(c=>c.id);
}
function wordOfDay(){
  const skip=new Set(['countries','nationalities','numbers','culture','quantities']);
  const pool=CARDS.filter(c=>!skip.has(c.cat)&&(c.t==='noun'||c.t==='verb'||(!c.t && c.fr.length<26)));
  let h=2166136261; for(const ch of todayStr()){ h^=ch.charCodeAt(0); h=Math.imul(h,16777619); }
  return pool[Math.abs(h)%pool.length];
}

/* ================= router & chrome ================= */
function route(){ const h=location.hash.replace(/^#\/?/,'').split('/'); return {name:h[0]||'home',arg:h[1],arg2:h[2]}; }
window.addEventListener('hashchange',render);
let session=null, keyHandler=null, cleanup=[];
document.addEventListener('keydown',e=>{ if(keyHandler) keyHandler(e); });

function topbar(active){
  const right = ACC.id ? `<a class="me-btn" href="#/profile" aria-label="Your profile">${avatar(ACC.avatar)}</a>`
              : (sb ? `<a class="login-btn" href="#/login">Log in</a>` : '');
  return `<header class="top">
    <a class="brand" href="#/" aria-label="${esc(APP)} home"><b>${esc(APP)}</b><span>A1</span></a>
    <div class="spacer"></div>
    <span class="pill" title="Days in a row">🔥 ${currentStreak()}</span>
    <span class="pill" title="Points earned">⭐ ${S.xp}</span>
    <button class="icon-btn" id="themeBtn" aria-label="Switch light or dark mode">◐</button>
    ${right}
  </header>
  ${active!==undefined?`<nav class="nav" aria-label="Main">
    <a href="#/" ${active==='home'?'aria-current="page"':''}>Decks</a>
    <a href="#/leaders" ${active==='leaders'?'aria-current="page"':''}>Leaderboard</a>
    <a href="#/profile" ${active==='profile'?'aria-current="page"':''}>Profile</a>
    <a class="live" href="#/live" ${active==='live'?'aria-current="page"':''}>🎮 Play live</a>
  </nav>`:''}`;
}
function footer(){ return `<footer class="sitefoot"><span>© ${new Date().getFullYear()} ${esc(APP)}</span><a href="/privacy.html">Privacy</a><button class="linkbtn" id="shareBtn">Share this app</button></footer>`; }
function bindTop(){
  const b=$('#themeBtn'); if(b) b.onclick=()=>{ const r=document.documentElement; const dark = r.dataset.theme? r.dataset.theme==='dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme= dark?'light':'dark'; try{localStorage.setItem(KEY+'-theme',r.dataset.theme);}catch(e){} };
  const sh=$('#shareBtn'); if(sh) sh.onclick=shareApp;
}
async function shareApp(){
  const data={title:APP, text:'Learn French vocabulary with me on '+APP+' 🇫🇷', url:location.origin+'/'};
  try{ if(navigator.share){ await navigator.share(data); return; } await navigator.clipboard.writeText(data.url); toast('Link copied — paste it to your friends'); }catch(e){}
}
function gate(title, text){
  try{ sessionStorage.setItem('pf-next', location.hash); }catch(e){}
  $('#app').innerHTML = topbar(route().name==='leaders'?'leaders':route().name==='live'?'live':'profile') + `<div class="gate"><div class="panel"><h2>${title}</h2><p>${text}</p>
    <div class="btns"><a class="cta" href="#/signup">Create a free account</a><a class="cta alt" href="#/login">I already have one</a></div></div></div>`;
  bindTop();
}

function render(){
  keyHandler=null; stopConfetti=true; cleanup.forEach(f=>{try{f();}catch(e){}}); cleanup=[];
  if(!CARDS.length) return;
  const r=route(); window.scrollTo(0,0);
  if(r.name==='deck'&&CAT[r.arg]) return renderDeck(r.arg);
  if(r.name==='study') return startStudy(r.arg, r.arg2||'cards');
  if(r.name==='login') return renderLogin();
  if(r.name==='signup') return renderSignup();
  if(r.name==='forgot') return renderForgot();
  if(r.name==='reset') return renderReset();
  if(r.name==='profile') return renderProfile();
  if(r.name==='leaders') return renderLeaders(r.arg||'week');
  if(r.name==='live') return renderLive();
  if(r.name==='join') return renderLive(r.arg);
  if(r.name==='game' && r.arg) return renderGame(r.arg.toUpperCase());
  renderHome();
}

/* ================= AUTH PAGES ================= */
function authShell(title, lead, body, alt){
  if(!sb){ $('#app').innerHTML=topbar()+`<div class="auth"><div class="panel"><h2>Accounts aren't switched on yet</h2><p>Add your Supabase details to <b>assets/config.js</b> to turn on sign-up and log-in. Everything else works without them.</p><a class="cta" href="#/">Back to the decks</a></div></div>`; bindTop(); return false; }
  $('#app').innerHTML = topbar() + `<div class="auth"><h1>${title}</h1><p class="lead">${lead}</p><div class="panel">${body}</div>${alt?`<p class="alt-link">${alt}</p>`:''}</div>`;
  bindTop(); return true;
}
function googleBlock(){ return CFG.googleSignIn ? `<button class="google" id="googleBtn" type="button"><span aria-hidden="true">G</span> Continue with Google</button><div class="divider">or with email</div>` : ''; }
function bindGoogle(){ const g=$('#googleBtn'); if(g) g.onclick=async()=>{ const {error}=await sb.auth.signInWithOAuth({provider:'google', options:{redirectTo:location.origin+'/'}}); if(error) $('#aErr').textContent='Google sign-in is not available right now.'; }; }
function friendlyAuthError(e){
  const m=(e&&e.message||'').toLowerCase();
  if(m.includes('invalid login')) return 'That email and password don’t match. Check both, or reset your password.';
  if(m.includes('not confirmed')) return 'Confirm your email first — open the link we sent to your inbox.';
  if(m.includes('already registered')||m.includes('already been registered')) return 'An account with this email already exists. Log in instead.';
  if(m.includes('password')&&m.includes('least')) return 'Use a password with at least 8 characters.';
  if(m.includes('rate')||m.includes('seconds')) return 'Too many attempts. Wait a minute and try again.';
  if(m.includes('valid email')||m.includes('invalid email')) return 'Enter a valid email address.';
  return e&&e.message ? e.message : 'Something went wrong. Check your connection and try again.';
}
function renderLogin(){
  if(ACC.id){ location.hash='#/'; return; }
  if(!authShell('Bon retour !','Log in to pick up where you left off.',
    `${googleBlock()}<form id="f" novalidate>
      <label class="field">Email<input id="em" type="email" autocomplete="email" required></label>
      <label class="field">Password<input id="pw" type="password" autocomplete="current-password" required></label>
      <button class="cta" id="go">Log in</button><p class="err" id="aErr" role="alert"></p></form>
      <p class="alt-link" style="margin-top:4px"><a href="#/forgot">Forgot your password?</a></p>`,
    `New here? <a href="#/signup">Create a free account</a>`)) return;
  bindGoogle();
  $('#f').onsubmit=async e=>{ e.preventDefault(); const go=$('#go'); go.disabled=true; $('#aErr').textContent='';
    const {error}=await sb.auth.signInWithPassword({email:$('#em').value.trim(), password:$('#pw').value});
    go.disabled=false; if(error) $('#aErr').textContent=friendlyAuthError(error); };
}
function renderSignup(){
  if(ACC.id){ location.hash='#/'; return; }
  const hasLocal=Object.keys(S.cards).length>0;
  if(!authShell('Créer un compte','Save your progress on every device, join the leaderboard and play live with friends.',
    `${googleBlock()}<form id="f" novalidate>
      <label class="field">Your name<input id="nm" maxlength="30" autocomplete="nickname" required placeholder="How friends will see you"></label>
      <label class="field">Email<input id="em" type="email" autocomplete="email" required></label>
      <label class="field">Password<input id="pw" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label>
      <button class="cta" id="go">Create account</button><p class="err" id="aErr" role="alert"></p><p class="ok" id="aOk" role="status"></p>
      <p style="font-size:13px;color:var(--ink-faint);margin:8px 0 0">${hasLocal?'The words you already studied on this device will be added to your account. ':''}By signing up you agree to the <a href="/privacy.html">privacy notice</a>.</p></form>`,
    `Already have an account? <a href="#/login">Log in</a>`)) return;
  bindGoogle();
  $('#f').onsubmit=async e=>{ e.preventDefault(); $('#aErr').textContent=''; $('#aOk').textContent='';
    const name=$('#nm').value.trim(), email=$('#em').value.trim(), pw=$('#pw').value;
    if(!name){ $('#aErr').textContent='Add your name so friends can find you on the leaderboard.'; return; }
    if(pw.length<8){ $('#aErr').textContent='Use a password with at least 8 characters.'; return; }
    const go=$('#go'); go.disabled=true;
    const {data,error}=await sb.auth.signUp({email, password:pw, options:{data:{display_name:name}, emailRedirectTo:location.origin+'/'}});
    go.disabled=false;
    if(error){ $('#aErr').textContent=friendlyAuthError(error); return; }
    if(data && data.session){ return; } // signed in straight away (email confirmation off)
    $('#f').innerHTML=`<p style="font-size:17px;color:var(--ink);margin:0 0 8px"><b>Check your inbox.</b></p><p>We sent a confirmation link to <b>${esc(email)}</b>. Open it on this device to finish creating your account.</p><a class="cta alt" href="#/">Keep studying meanwhile</a>`;
  };
}
function renderForgot(){
  if(!authShell('Mot de passe oublié ?','Enter your email and we’ll send you a link to choose a new password.',
    `<form id="f" novalidate><label class="field">Email<input id="em" type="email" autocomplete="email" required></label>
      <button class="cta" id="go">Send reset link</button><p class="err" id="aErr" role="alert"></p><p class="ok" id="aOk" role="status"></p></form>`,
    `<a href="#/login">Back to log in</a>`)) return;
  $('#f').onsubmit=async e=>{ e.preventDefault(); const go=$('#go'); go.disabled=true; $('#aErr').textContent='';
    const {error}=await sb.auth.resetPasswordForEmail($('#em').value.trim(), {redirectTo:location.origin+'/'});
    go.disabled=false; if(error) $('#aErr').textContent=friendlyAuthError(error); else $('#aOk').textContent='If that email has an account, a reset link is on its way. Check your inbox and spam folder.'; };
}
function renderReset(){
  if(!authShell('Nouveau mot de passe','Choose a new password for your account.',
    `<form id="f" novalidate><label class="field">New password<input id="pw" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label>
      <button class="cta" id="go">Save new password</button><p class="err" id="aErr" role="alert"></p><p class="ok" id="aOk" role="status"></p></form>`)) return;
  $('#f').onsubmit=async e=>{ e.preventDefault(); const pw=$('#pw').value; if(pw.length<8){ $('#aErr').textContent='Use at least 8 characters.'; return; }
    const go=$('#go'); go.disabled=true; const {error}=await sb.auth.updateUser({password:pw}); go.disabled=false;
    if(error) $('#aErr').textContent= /session/i.test(error.message)? 'This reset link has expired. Request a new one from the log-in page.' : friendlyAuthError(error);
    else { $('#aOk').textContent='Password saved.'; setTimeout(()=>location.hash='#/',900); } };
}

/* ================= HOME ================= */
function renderHome(){
  const due=allDue().length, n=todayCount(), pct=Math.min(100,Math.round(n/S.goal*100));
  const learnedAll=globalStats().learned;
  const hour=new Date().getHours(); const hello = hour>=18||hour<4 ? 'Bonsoir' : 'Bonjour';
  const nm=firstName();
  const greet = n>=S.goal ? (nm?`Bravo, ${esc(nm)} !`:'Objectif atteint !') : (nm? `${hello}, ${esc(nm)} !` : `${hello} !`);
  const sub = learnedAll ? `You've learned ${learnedAll} of ${CARDS.length} words. Pick a deck, or clear the cards waiting for review.`
                         : `${CARDS.length} everyday French words in ${CATS.length} themed decks, with audio. Start anywhere — each word comes back just before you'd forget it.`;
  const banner = (!ACC.id && sb && ACC.ready) ? `<div class="banner">You're studying as a guest, so progress stays on this device. <a href="#/signup">Create a free account</a> to save it everywhere, join the leaderboard and play live with friends.</div>` : '';
  const nx=CATS.find(k=>BYCAT[k.id].some(x=>!S.cards[x.id]))||CATS[0];
  const w=wordOfDay();
  let html = topbar('home') + banner + `
  <section class="hello">
    <div><h1>${greet}</h1><p>${sub}</p></div>
    <div class="today">
      <div class="row"><span class="big">${n} / ${S.goal}</span><small>cards today</small></div>
      <div class="goal" role="progressbar" aria-label="Daily goal" aria-valuemin="0" aria-valuemax="${S.goal}" aria-valuenow="${n}"><i style="width:${pct}%"></i></div>
      ${due? `<a class="cta alt" href="#/study/all/cards">Review ${due} waiting card${due>1?'s':''}</a>` : `<a class="cta" href="#/study/${nx.id}/cards">${learnedAll?'Learn new words: ':'Start with '}${esc(nx.name)}</a>`}
    </div>
  </section>
  <section class="wotd" aria-label="Word of the day">
    <span class="lbl">mot du jour</span>
    <p class="w ${gClass(w.g)}">${esc(w.fr)}${gTag(w.g)}</p>
    <p class="m">${esc(w.en)}${w.pron?` · <span style="font-family:var(--f-hand);font-size:20px">“${esc(w.pron)}”</span>`:''}</p>
    ${w.note?`<p class="n">${esc(w.note)}</p>`:''}
    <div class="acts"><button class="chip-btn" data-say="${esc(w.fr)}">🔊 Hear it</button><a class="chip-btn" href="#/deck/${w.cat}">${CAT[w.cat].emoji} ${esc(CAT[w.cat].name)} deck</a></div>
  </section>
  <label class="search"><span aria-hidden="true">🔎</span><input id="q" type="search" placeholder="Search a word in French or English" aria-label="Search words"></label>
  <div class="results" id="results" hidden></div>`;
  GROUPS.forEach(g=>{
    html+=`<section class="group"><h2>${esc(g)}</h2><div class="grid">`;
    CATS.filter(c=>c.group===g).forEach(c=>{
      const st=catStats(c.id), m=st.mastered/st.total*100, l=(st.learned-st.mastered)/st.total*100;
      html+=`<a class="fiche" href="#/deck/${c.id}">
        ${st.due?`<span class="due" title="Cards waiting for review">${st.due}</span>`:''}
        <span class="em" aria-hidden="true">${c.emoji}</span><span class="nm">${esc(c.name)}</span>
        <span class="ct">${st.learned? `${st.learned} of ${st.total} learned` : `${st.total} words`}</span>
        <span class="bar" aria-hidden="true"><i class="m" style="width:${m}%"></i><i class="l" style="width:${l}%"></i></span></a>`;
    });
    html+=`</div></section>`;
  });
  html+=footer();
  $('#app').innerHTML=html; bindTop(); bindSay($('#app'));
  const q=$('#q'), res=$('#results');
  q.oninput=()=>{ const v=q.value.trim(); if(v.length<2){res.hidden=true;return;}
    const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const nv=norm(v); const hits=CARDS.filter(c=>norm(c.fr).includes(nv)||norm(c.en).includes(nv)).slice(0,12);
    res.hidden=false; res.innerHTML = hits.length? `<div class="list">${hits.map(c=>itemRow(c,true)).join('')}</div>` : `<div class="empty"><p>No word matches “${esc(v)}”. Try the English meaning or a shorter spelling.</p></div>`;
    bindSay(res); };
}
function itemRow(c,showCat){
  const b=box(c.id);
  return `<div class="item"><button class="say" data-say="${esc(c.fr)}" aria-label="Hear ${esc(c.fr)}">🔊</button>
    <div><div class="fr ${gClass(c.g)}">${esc(c.fr)}${gTag(c.g)}</div><div class="en">${esc(c.en)}${showCat?` · ${esc(CAT[c.cat].name)}`:''}</div></div>
    <span class="dot s${b}" title="${b>=4?'Mastered':b>=1?'Learning':'New'}"></span></div>`;
}
function bindSay(root){ root.querySelectorAll('[data-say]').forEach(b=>b.onclick=e=>{e.stopPropagation();e.preventDefault();speak(b.dataset.say);}); }

/* ================= DECK ================= */
function renderDeck(cid){
  const c=CAT[cid], st=catStats(cid), list=BYCAT[cid];
  const hasG=list.some(x=>x.g);
  $('#app').innerHTML = topbar() + `
    <a class="back" href="#/">← All decks</a>
    <div class="deckhead"><span class="em" aria-hidden="true">${c.emoji}</span><div><h1>${esc(c.name)}</h1>
      <p>${st.total} words · ${st.learned} learned · ${st.mastered} mastered${st.due?` · ${st.due} waiting for review`:''}</p></div></div>
    <div class="modes">
      <a class="mode" href="#/study/${cid}/cards"><span class="ic" aria-hidden="true">🃏</span><span><b>Flashcards</b><span>Flip, listen, and rate yourself</span></span></a>
      <a class="mode" href="#/study/${cid}/quiz"><span class="ic" aria-hidden="true">🎯</span><span><b>Quiz</b><span>Pick the right meaning out of four</span></span></a>
      <a class="mode" href="#/live/${cid}"><span class="ic" aria-hidden="true">🎮</span><span><b>Play live</b><span>Challenge friends on this deck</span></span></a>
    </div>
    ${hasG?`<p class="legend"><span><i style="background:var(--masc)"></i>masculine</span><span><i style="background:var(--fem)"></i>feminine</span><span><i style="background:var(--plur)"></i>plural</span></p>`:''}
    <div class="list">${list.map(x=>itemRow(x)).join('')}</div>`;
  bindTop(); bindSay($('#app'));
}

/* ================= STUDY ================= */
function startStudy(cid, mode){
  const pool = cid==='all' ? allDue() : (BYCAT[cid]||[]);
  if(!pool.length){ location.hash='#/'; return; }
  const ids = cid==='all' ? shuffle(pool.map(c=>c.id)).slice(0,20) : buildSession(pool);
  session={cid,mode,ids,i:0,pool,right:0,wrong:0,requeued:new Set(),xp0:S.xp,newLearned:0};
  renderCard();
}
function studyShell(inner){
  const s=session, pct=Math.round(s.i/s.ids.length*100);
  const title = s.cid==='all' ? 'Review' : CAT[s.cid].name;
  return topbar()+`<div class="study">
    <a class="back" href="${s.cid==='all'?'#/':'#/deck/'+s.cid}">← ${esc(title)}</a>
    <div class="studybar">
      <div class="progress" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="${s.ids.length}" aria-valuenow="${s.i}"><i style="width:${pct}%"></i></div>
      <div class="toggle" role="group" aria-label="Card direction">
        <button data-dir="fr" aria-pressed="${S.dir==='fr'}">FR → EN</button><button data-dir="en" aria-pressed="${S.dir==='en'}">EN → FR</button>
      </div>
    </div>${inner}</div>`;
}
function bindDir(){ document.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>{S.dir=b.dataset.dir;save();renderCard();}); }
function requeue(s,c){ if(!s.requeued.has(c.id)){ s.requeued.add(c.id); s.ids.splice(Math.min(s.i+4,s.ids.length),0,c.id); } }

function renderCard(){
  const s=session; if(s.i>=s.ids.length) return renderDone();
  const c=BYID[s.ids[s.i]];
  if(s.mode==='quiz') return renderQuiz(c);
  const frSide = `<div class="word ${gClass(c.g)} ${c.fr.length>28?'long':''}">${esc(c.fr)}</div>${c.pron?`<div class="pron">“${esc(c.pron)}”</div>`:''}`;
  const enSide = `<div class="word ${c.en.length>28?'long':''}">${esc(c.en)}</div>`;
  const front = S.dir==='fr'? frSide : enSide;
  const back = S.dir==='fr'? `<div class="sub ${gClass(c.g)}">${esc(c.fr)}</div>`+enSide : frSide+`<div class="sub">${esc(c.en)}</div>`;
  const meta = `<span>${esc(CAT[c.cat].emoji)} ${esc(CAT[c.cat].name)}</span><span>${gTag(c.g)}</span>`;
  $('#app').innerHTML = studyShell(`
    <div class="stage"><button class="card" id="card" aria-label="Flashcard. Press to flip.">
      <div class="face front"><div class="meta">${meta}</div><div class="main">${front}<div class="hint">Tap to see the answer</div></div></div>
      <div class="face backside"><div class="meta">${meta}</div><div class="main">${back}${c.note?`<div class="note">${esc(c.note)}</div>`:''}</div></div>
    </button></div>
    <div class="answer" id="ans">
      <button class="say" id="sayBtn" style="grid-column:1/-1;width:auto;height:auto;padding:12px;background:var(--card);box-shadow:var(--shadow);border-radius:14px;font-size:16px;font-weight:600">🔊 Hear it</button>
    </div>
    <p class="kbd">Space flips · 1 still learning · 2 got it · S hear it</p>`);
  bindTop(); bindDir();
  const card=$('#card');
  $('#sayBtn').onclick=()=>speak(c.fr);
  card.onclick=()=>flip();
  if(S.dir==='fr') setTimeout(()=>speak(c.fr),250);
  function flip(){
    if(card.classList.contains('flipped')) { card.classList.remove('flipped'); return; }
    card.classList.add('flipped'); if(S.dir==='en') speak(c.fr);
    if(!$('#again')){
      $('#ans').insertAdjacentHTML('afterbegin',`<button class="again" id="again">Still learning</button><button class="gotit" id="got">Got it</button>`);
      $('#again').onclick=()=>answer(false); $('#got').onclick=()=>answer(true);
    }
  }
  function answer(good){
    if(!S.cards[c.id]) s.newLearned++;
    grade(c.id,good); good? s.right++ : s.wrong++;
    if(!good) requeue(s,c);
    s.i++; renderCard();
  }
  keyHandler = e=>{
    if(e.target.tagName==='INPUT') return;
    if(e.code==='Space'){e.preventDefault();flip();}
    else if(e.key==='s'||e.key==='S') speak(c.fr);
    else if(card.classList.contains('flipped')&&(e.key==='1'||e.key==='2')) answer(e.key==='2');
  };
}
function makeOptions(c, toFr){
  const key = x=> toFr? x.fr : x.en;
  const sameCat=(BYCAT[c.cat]||[]).filter(x=>x.id!==c.id && key(x)!==key(c));
  const pool = sameCat.length>=3 ? sameCat : sameCat.concat(CARDS.filter(x=>x.cat!==c.cat && x.t===c.t && key(x)!==key(c)));
  const seen=new Set([key(c)]); const distract=[];
  for(const x of shuffle(pool)){ if(!seen.has(key(x))){seen.add(key(x));distract.push(x);} if(distract.length===3)break; }
  return shuffle([c,...distract]);
}
function renderQuiz(c){
  const s=session, toFr = S.dir==='en';
  const key = x=> toFr? x.fr : x.en;
  const options=makeOptions(c,toFr);
  const prompt = toFr ? `<div class="word">${esc(c.en)}</div>` : `<div class="word ${gClass(c.g)}">${esc(c.fr)}</div>${c.pron?`<div style="font-family:var(--f-hand);font-size:24px;color:var(--ink-soft)">“${esc(c.pron)}”</div>`:''}`;
  $('#app').innerHTML = studyShell(`
    <div class="qcard"><div style="display:flex;justify-content:space-between;font-size:14px;color:var(--ink-soft);margin-bottom:12px"><span>${toFr?'Which is the French?':'What does it mean?'}</span><span>${toFr?'':gTag(c.g)}</span></div>
      ${prompt}<div style="margin-top:12px"><button class="say" id="sayBtn" aria-label="Hear it">🔊</button></div></div>
    <div class="opts">${options.map((o,i)=>`<button class="opt" data-id="${o.id}"><span class="k">${i+1}</span><span class="${toFr?gClass(o.g):''}" ${toFr?'style="font-family:var(--f-word);font-weight:400"':''}>${esc(key(o))}</span></button>`).join('')}</div>
    <div id="after"></div>
    <p class="kbd">Press 1–4 to answer · Enter for next · S hear it</p>`);
  bindTop(); bindDir();
  $('#sayBtn').onclick=()=>speak(c.fr);
  if(!toFr) setTimeout(()=>speak(c.fr),250);
  let answered=false;
  const btns=[...document.querySelectorAll('.opt')];
  function choose(btn){
    if(answered) return; answered=true;
    const good = btn.dataset.id===c.id;
    btns.forEach(b=>{ b.disabled=true; if(b.dataset.id===c.id) b.classList.add('right'); });
    if(!good) btn.classList.add('wrong');
    if(!S.cards[c.id]) s.newLearned++;
    grade(c.id,good); good? s.right++ : s.wrong++;
    if(toFr||!good) speak(c.fr);
    if(!good) requeue(s,c);
    $('#after').innerHTML = `${c.note?`<p style="font-family:var(--f-hand);font-size:24px;color:var(--margin);margin:14px 4px 0;line-height:1.1">${esc(c.note)}</p>`:''}<button class="cta next" id="nextBtn">${s.i+1>=s.ids.length?'See results':'Next'}</button>`;
    $('#nextBtn').onclick=next; $('#nextBtn').focus();
  }
  function next(){ s.i++; renderCard(); }
  btns.forEach(b=>b.onclick=()=>choose(b));
  keyHandler=e=>{
    if(e.target.tagName==='INPUT') return;
    if(!answered && /^[1-4]$/.test(e.key) && btns[+e.key-1]) choose(btns[+e.key-1]);
    else if(answered && e.key==='Enter'){ e.preventDefault(); next(); }
    else if(e.key==='s'||e.key==='S') speak(c.fr);
  };
}
function renderDone(){
  keyHandler=null;
  const s=session, total=s.right+s.wrong, acc= total? Math.round(s.right/total*100):0, gained=S.xp-s.xp0;
  const title = acc>=90?'Excellent !':acc>=70?'Très bien !':acc>=50?'Pas mal !':'Courage !';
  const scrawl = acc>=90?'bravo, 20/20':acc>=70?'keep it up':acc>=50?'getting there':'practice makes perfect';
  flushNow();
  $('#app').innerHTML = topbar()+`<section class="done">
    <h1>${title}</h1><span class="scrawl">${scrawl}</span>
    <div class="stats"><div class="stat"><b>${acc}%</b><span>correct</span></div><div class="stat"><b>+${gained}</b><span>points</span></div><div class="stat"><b>${s.newLearned}</b><span>new words</span></div></div>
    <div class="btns">
      ${s.cid==='all'?'':`<a class="cta" href="#/study/${s.cid}/${s.mode}" id="again2">Study 12 more</a>`}
      ${s.cid==='all'?'':`<a class="cta alt" href="#/study/${s.cid}/${s.mode==='quiz'?'cards':'quiz'}">Switch to ${s.mode==='quiz'?'flashcards':'quiz'}</a>`}
      ${!ACC.id&&sb?`<a class="cta alt" href="#/signup">Save this progress — create a free account</a>`:''}
      <a class="back" style="justify-content:center;margin-top:6px" href="#/">Back to all decks</a>
    </div></section>`;
  bindTop();
  const ag=$('#again2'); if(ag) ag.onclick=e=>{ e.preventDefault(); startStudy(s.cid,s.mode); };
  if(acc>=70) confetti();
}

/* ================= PROFILE ================= */
function renderProfile(){
  if(!ACC.ready){ $('#app').innerHTML=topbar('profile')+`<div class="empty"><p>Loading your profile…</p></div>`; bindTop(); return; }
  if(!ACC.id) return gate('Your profile','Create a free account to keep your progress on every device, set a name and avatar, and see your stats.');
  const st=globalStats(), n=todayCount();
  const since = new Date(S.since||Date.now()).toLocaleDateString(undefined,{month:'long',year:'numeric'});
  $('#app').innerHTML = topbar('profile') + `
    <div class="profile-head">${avatar(ACC.avatar,'avatar lg')}
      <div><h1>${esc(ACC.name||'You')}</h1><p style="margin:4px 0 0;color:var(--ink-soft)">Learning since ${esc(since)} · ${ACC.synced?'progress saved to your account':'saving…'}</p></div></div>
    <div class="statgrid">
      <div class="stat"><b>${S.xp}</b><span>points</span></div>
      <div class="stat"><b>${currentStreak()}</b><span>day streak</span></div>
      <div class="stat"><b>${st.learned}</b><span>words learned</span></div>
      <div class="stat"><b>${st.mastered}</b><span>words mastered</span></div>
      <div class="stat"><b>${n}</b><span>cards today</span></div>
      <div class="stat"><b>${S.week.key===weekKey()?S.week.xp:0}</b><span>points this week</span></div>
      <div class="stat"><b>${S.games.played}</b><span>live games</span></div>
      <div class="stat"><b>${S.games.won}</b><span>live wins</span></div>
    </div>
    <div class="two">
      <div class="panel"><h2>Daily goal</h2><p>How many cards you want to study each day.</p>
        <div class="goalpick" role="group" aria-label="Daily goal">${[10,20,30,50].map(g=>`<button data-goal="${g}" aria-pressed="${S.goal===g}">${g} cards</button>`).join('')}</div></div>
      <div class="panel"><h2>Progress by section</h2>
        ${GROUPS.map(g=>{ const ids=CATS.filter(c=>c.group===g).flatMap(c=>BYCAT[c.id]); const l=ids.filter(c=>box(c.id)>=1).length, m=ids.filter(c=>box(c.id)>=4).length;
          return `<div class="gprog"><span>${esc(g)}</span><span class="bar"><i class="m" style="width:${m/ids.length*100}%"></i><i class="l" style="width:${(l-m)/ids.length*100}%"></i></span><span style="text-align:right;color:var(--ink-soft)">${Math.round(l/ids.length*100)}%</span></div>`; }).join('')}
      </div>
      <div class="panel"><h2>Name & avatar</h2><p>This is how you appear on the leaderboard and in live games.</p>
        <label class="field">Name<input id="pName" maxlength="30" value="${esc(ACC.name)}"></label>
        <div class="emoji-pick" role="group" aria-label="Avatar">${AVATARS.map(a=>`<button data-av="${a}" aria-pressed="${a===ACC.avatar}" aria-label="Avatar ${a}">${a}</button>`).join('')}</div>
        <button class="cta" id="pSave" style="margin-top:14px">Save changes</button><p class="err" id="pErr" role="alert"></p><p class="ok" id="pOk" role="status"></p></div>
      <div class="panel"><h2>Account</h2><p>Signed in as <b>${esc(ACC.email)}</b></p>
        <button class="cta alt" id="signOut">Log out</button>
        <p style="margin:18px 0 0"><button class="linkbtn" id="reset">Reset my study progress</button></p>
        <p style="margin:10px 0 0"><button class="danger" id="delAcc">Delete my account</button></p></div>
    </div>${footer()}`;
  bindTop();
  let pickAv=ACC.avatar;
  document.querySelectorAll('[data-goal]').forEach(b=>b.onclick=()=>{ S.goal=+b.dataset.goal; save(); renderProfile(); });
  document.querySelectorAll('[data-av]').forEach(b=>b.onclick=()=>{ pickAv=b.dataset.av; document.querySelectorAll('[data-av]').forEach(x=>x.setAttribute('aria-pressed',x===b)); });
  $('#pSave').onclick=async()=>{ const nm=$('#pName').value.trim(); $('#pErr').textContent=''; $('#pOk').textContent='';
    if(!nm){ $('#pErr').textContent='Your name can’t be empty.'; return; }
    const {error}=await sb.from('profiles').update({display_name:nm, avatar:pickAv}).eq('id',ACC.id);
    if(error){ $('#pErr').textContent='Could not save. Check your connection and try again.'; return; }
    ACC.name=nm; ACC.avatar=pickAv; renderProfile(); toast('Profile saved'); };
  $('#signOut').onclick=async()=>{ flushNow(); await new Promise(r=>setTimeout(r,400)); await sb.auth.signOut(); location.hash='#/'; };
  $('#reset').onclick=()=>{ if(confirm('Reset all study progress, points and streak? Your leaderboard score goes back to zero.')){ const keep={dir:S.dir,goal:S.goal,owner:S.owner}; S=normalize(keep); save(); flushNow(); render(); } };
  $('#delAcc').onclick=async()=>{ if(!confirm('Delete your account and all your progress for good? This can’t be undone.')) return;
    const {error}=await sb.rpc('delete_my_account'); if(error){ toast('Could not delete the account. Try again later.'); return; }
    await sb.auth.signOut(); signedOut(); location.hash='#/'; toast('Your account has been deleted'); };
}

/* ================= LEADERBOARD ================= */
function renderLeaders(tab){
  if(!sb) return gate('Leaderboard','Accounts are not switched on for this site yet.');
  if(!ACC.ready){ $('#app').innerHTML=topbar('leaders')+`<div class="empty"><p>Loading…</p></div>`; bindTop(); return; }
  if(!ACC.id) return gate('See who’s learning','Create a free account to join the leaderboard and compare your progress with friends.');
  $('#app').innerHTML = topbar('leaders') + `
    <div class="deckhead"><span class="em" aria-hidden="true">🏆</span><div><h1>Leaderboard</h1><p>Points come from flashcards, quizzes and live games.</p></div></div>
    <div class="toggle" role="group" aria-label="Period" style="margin-bottom:16px">
      <button data-tab="week" aria-pressed="${tab==='week'}">This week</button><button data-tab="all" aria-pressed="${tab==='all'}">All time</button>
    </div>
    <div id="board"><div class="empty"><p>Loading the leaderboard…</p></div></div>
    <div class="share-row" style="margin-top:18px"><button class="cta alt" style="max-width:340px" id="invite">Invite friends to compete</button></div>${footer()}`;
  bindTop(); $('#invite').onclick=shareApp;
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{ location.hash='#/leaders/'+b.dataset.tab; });
  async function load(){
    let q=sb.from('profiles').select('id,display_name,avatar,xp,week_xp,week_key,learned,streak,last_active');
    q = tab==='week' ? q.eq('week_key',weekKey()).gt('week_xp',0).order('week_xp',{ascending:false}) : q.gt('xp',0).order('xp',{ascending:false});
    const {data,error}=await q.limit(100);
    const b=$('#board'); if(!b) return;
    if(error){ b.innerHTML=`<div class="empty"><p>The leaderboard couldn't load. Check your connection and reload.</p></div>`; return; }
    if(!data.length){ b.innerHTML=`<div class="empty"><p>${tab==='week'?'Nobody has scored this week yet. Study a deck to take first place.':'No scores yet. Study a deck to get on the board.'}</p><a class="cta" style="max-width:320px;margin:0 auto" href="#/">Pick a deck</a></div>`; return; }
    const medal=i=>['🥇','🥈','🥉'][i]||String(i+1);
    b.innerHTML = `<div class="board">${data.map((r,i)=>{ const isMe=r.id===ACC.id; const days=Math.floor((Date.now()-new Date(r.last_active).getTime())/DAY);
      return `<div class="brow ${isMe?'me':''}"><span class="rk">${medal(i)}</span>${avatar(r.avatar)}
        <div style="min-width:0"><div class="nm">${esc(r.display_name)}${isMe?' (you)':''}</div>
        <div class="sub">${r.learned||0} words learned · 🔥 ${r.streak||0} · ${days<=0?'active today':days===1?'active yesterday':`active ${days} days ago`}</div></div>
        <span class="pts">${tab==='week'?r.week_xp:r.xp}</span></div>`; }).join('')}</div>`;
  }
  flushNow(); setTimeout(load, 600);
  const iv=setInterval(load, 30000); cleanup.push(()=>clearInterval(iv));
}

/* ================= LIVE GAME ================= */
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHAPES=['▲','◆','●','■'];
function renderLive(joinCode){
  if(!sb) return gate('Play live','Accounts are not switched on for this site yet.');
  if(!ACC.ready){ $('#app').innerHTML=topbar('live')+`<div class="empty"><p>Loading…</p></div>`; bindTop(); return; }
  if(!ACC.id) return gate('Play live with friends','Create a free account to host or join a live quiz. It takes 30 seconds.');
  const pre = route().arg && CAT[route().arg] ? route().arg : 'greetings';
  $('#app').innerHTML = topbar('live') + `
    <div class="deckhead"><span class="em" aria-hidden="true">🎮</span><div><h1>Play live</h1><p>Race your friends on the same questions. Faster right answers score more.</p></div></div>
    <div class="two">
    <div class="panel"><h2>Host a game</h2><p>You'll get a 4-letter code to share. You play too.</p>
      <label class="field">Deck<select id="hDeck">${GROUPS.map(g=>`<optgroup label="${esc(g)}">${CATS.filter(c=>c.group===g).map(c=>`<option value="${c.id}" ${c.id===pre?'selected':''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label class="field">Questions<select id="hN"><option>5</option><option selected>10</option><option>15</option></select></label>
      <label class="field">Seconds per question<select id="hT"><option>10</option><option selected>15</option><option>20</option></select></label>
      <button class="cta" id="hostBtn">Create game</button><p class="err" id="hErr" role="alert"></p></div>
    <div class="panel"><h2>Join a game</h2><p>Enter the code your friend shared.</p>
      <label class="field">Game code<input id="jCode" class="code-in" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" value="${esc((joinCode||'').toUpperCase().slice(0,4))}"></label>
      <button class="cta alt" id="joinBtn">Join game</button><p class="err" id="jErr" role="alert"></p></div>
    </div>${footer()}`;
  bindTop();
  $('#hostBtn').onclick=hostGame; $('#joinBtn').onclick=joinGame;
  $('#jCode').onkeydown=e=>{ if(e.key==='Enter') joinGame(); };
  if(joinCode && /^[A-Za-z0-9]{4}$/.test(joinCode)) joinGame();
}
async function hostGame(){
  const btn=$('#hostBtn'); btn.disabled=true; $('#hErr').textContent='';
  const cat=$('#hDeck').value, n=+$('#hN').value, dur=+$('#hT').value*1000;
  const qs = shuffle(BYCAT[cat]).slice(0,n).map(c=>{ const opts=makeOptions(c,false); return {id:c.id, opts:opts.map(o=>o.id), ans:opts.findIndex(o=>o.id===c.id)}; });
  sb.rpc('cleanup_old_games').then(()=>{},()=>{});
  for(let tries=0; tries<6; tries++){
    const code=Array.from({length:4},()=>CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join('');
    const {error}=await sb.from('games').insert({code, host:ACC.id, cat, qs, dur, phase:'lobby', q:-1, scores:{}});
    if(!error){
      const r=await sb.from('game_players').insert({game_code:code, user_id:ACC.id, answers:{}});
      if(r.error){ break; }
      location.hash='#/game/'+code; return;
    }
    if(error.code!=='23505') break; // 23505 = code already taken, try another
  }
  btn.disabled=false; $('#hErr').textContent='Could not create the game. Check your connection and try again.';
}
async function joinGame(){
  const code=$('#jCode').value.trim().toUpperCase(); const err=$('#jErr'); err.textContent='';
  if(!/^[A-Z0-9]{4}$/.test(code)){ err.textContent='Codes are 4 letters or numbers, like K7QP.'; return; }
  $('#joinBtn').disabled=true;
  const {data:g}=await sb.from('games').select('code,phase').eq('code',code).maybeSingle();
  if(!g){ err.textContent=`No game uses the code ${code}. Check it with your host.`; $('#joinBtn').disabled=false; return; }
  const {data:mine}=await sb.from('game_players').select('user_id').eq('game_code',code).eq('user_id',ACC.id).maybeSingle();
  if(!mine){
    if(g.phase!=='lobby'){ err.textContent='That game has already started. Ask the host to start a new one.'; $('#joinBtn').disabled=false; return; }
    const {error}=await sb.from('game_players').insert({game_code:code, user_id:ACC.id, answers:{}});
    if(error){ err.textContent='Could not join. Check your connection and try again.'; $('#joinBtn').disabled=false; return; }
  }
  location.hash='#/game/'+code;
}
function pts(ans, correctIdx, dur){ if(!ans || ans.c!==correctIdx) return 0; return Math.max(100, Math.round(1000 - 500*Math.min(ans.ms,dur)/dur)); }

function renderGame(code){
  if(!sb||!ACC.ready){ $('#app').innerHTML=topbar()+`<div class="empty"><p>Connecting…</p></div>`; bindTop(); return; }
  if(!ACC.id){ location.hash='#/live'; return; }
  const G={code, game:null, players:{}, names:{}, localStart:0, lastQ:-2, lastPhase:'', revealing:false, timer:null, tick:null, counted:false, fetching:false, again:false};
  $('#app').innerHTML=topbar()+`<div class="study" id="gameRoot"><div class="empty"><p>Opening game ${esc(code)}…</p></div></div>`; bindTop();
  const isHost=()=>G.game&&G.game.host===ACC.id;

  async function refetch(){
    if(G.fetching){ G.again=true; return; } G.fetching=true;
    const [g,p]=await Promise.all([ sb.from('games').select('*').eq('code',code).maybeSingle(), sb.from('game_players').select('user_id,answers').eq('game_code',code) ]);
    G.fetching=false;
    if(!$('#gameRoot')) return;
    if(!g.error && !g.data){ $('#gameRoot').innerHTML=`<div class="empty"><p>Game ${esc(code)} has ended or doesn't exist.</p><a class="cta" href="#/live">Back to Play live</a></div>`; return; }
    if(g.data) G.game=g.data;
    if(p.data){ G.players={}; p.data.forEach(r=>G.players[r.user_id]=r); }
    const missing=Object.keys(G.players).concat(G.game?[G.game.host]:[]).filter(id=>!G.names[id]);
    if(missing.length){ const {data}=await sb.from('profiles').select('id,display_name,avatar').in('id',missing); (data||[]).forEach(r=>G.names[r.id]=r); }
    onState();
    if(G.again){ G.again=false; refetch(); }
  }
  const ch=sb.channel('game-'+code)
    .on('postgres_changes',{event:'*',schema:'public',table:'games',filter:'code=eq.'+code},refetch)
    .on('postgres_changes',{event:'*',schema:'public',table:'game_players',filter:'game_code=eq.'+code},refetch)
    .subscribe();
  const poll=setInterval(refetch, 2500); // safety net if live updates are slow
  cleanup.push(()=>{ sb.removeChannel(ch); clearInterval(poll); clearTimeout(G.timer); clearInterval(G.tick); });
  refetch();

  const nameOf=id=> id===ACC.id ? 'You' : (G.names[id]&&G.names[id].display_name)||'Player';
  const avOf=id=> (G.names[id]&&G.names[id].avatar)||'🙂';
  function scoresNow(uptoQ){ const g=G.game, sc={}; Object.keys(G.players).forEach(id=>{ let t=0; for(let i=0;i<=uptoQ;i++){ t+=pts((G.players[id].answers||{})[i], g.qs[i].ans, g.dur); } sc[id]=t; }); return sc; }

  function onState(){
    const g=G.game; if(!g) return;
    if(g.q!==G.lastQ || g.phase!==G.lastPhase){
      if(g.phase==='question' && g.q!==G.lastQ) G.localStart=Date.now();
      G.lastQ=g.q; G.lastPhase=g.phase; draw();
    } else if(g.phase==='lobby'||g.phase==='question') draw(true);
    if(isHost() && g.phase==='question'){
      const ids=Object.keys(G.players); const all=ids.length && ids.every(id=>(G.players[id].answers||{})[g.q]);
      if(all) reveal();
      else { clearTimeout(G.timer); G.timer=setTimeout(reveal, Math.max(0, G.localStart+g.dur+1500-Date.now())); }
    }
  }
  async function reveal(){
    const g=G.game; if(!isHost()||G.revealing||g.phase!=='question') return;
    G.revealing=true; clearTimeout(G.timer);
    const {error}=await sb.from('games').update({phase:'reveal', scores:scoresNow(g.q)}).eq('code',code);
    G.revealing=false; if(!error){ g.phase='reveal'; } refetch();
  }
  async function hostNext(){
    const g=G.game; if(!isHost()) return;
    const upd = (g.q+1>=g.qs.length) ? {phase:'end', scores:scoresNow(g.q)} : {phase:'question', q:g.q+1};
    const {error}=await sb.from('games').update(upd).eq('code',code);
    if(error) toast('Could not reach the game. Try again.'); else refetch();
  }
  async function answer(i){
    const g=G.game; if(!g||g.phase!=='question') return;
    const me=G.players[ACC.id]; if(!me) return;
    const mine=Object.assign({}, me.answers||{}); if(mine[g.q]) return;
    const ms=Date.now()-G.localStart; if(ms>g.dur) return;
    mine[g.q]={c:i,ms}; me.answers=mine;
    document.querySelectorAll('.kopt').forEach(b=>{ b.disabled=true; if(+b.dataset.i===i) b.classList.add('pick'); });
    const lm=$('#lockMsg'); if(lm) lm.textContent='Answer locked in. Waiting for the others…';
    const {error}=await sb.from('game_players').update({answers:mine}).eq('game_code',code).eq('user_id',ACC.id);
    if(error){ delete mine[g.q]; toast('Your answer did not send. Tap again.'); document.querySelectorAll('.kopt').forEach(b=>b.disabled=false); }
    else refetch();
  }

  function draw(partial){
    const g=G.game, root=$('#gameRoot'); if(!root) return;
    const ids=Object.keys(G.players);
    const deck=CAT[g.cat]||{emoji:'🃏',name:'Deck'};
    if(g.phase==='lobby'){
      root.innerHTML=`<a class="back" href="#/live">← Leave</a>
        <div class="panel center"><p style="margin:0">${deck.emoji} ${esc(deck.name)} · ${g.qs.length} questions · ${g.dur/1000}s each</p>
        <div class="bigcode" aria-label="Game code">${esc(code)}</div>
        <p>Send friends the invite link, or they can open <b>${esc(location.host)}</b>, tap <b>Play live</b>, and enter this code.</p>
        <div class="share-row"><button class="chip-btn" id="copyCode">Copy invite</button></div>
        <div class="lobby-players">${ids.map(id=>`<span class="pchip">${avatar(avOf(id))}${esc(nameOf(id))}${id===g.host?' 👑':''}</span>`).join('')}</div>
        ${isHost()? `<button class="cta" id="startBtn">Start game with ${ids.length} player${ids.length===1?'':'s'}</button>` : `<p><b>Waiting for ${esc(nameOf(g.host))} to start…</b></p>`}</div>`;
      const sbn=$('#startBtn'); if(sbn) sbn.onclick=()=>{ sbn.disabled=true; hostNext(); };
      $('#copyCode').onclick=async()=>{ const txt=`Join my French quiz on ${APP}! Tap to join: ${location.origin}/#/join/${code}`; try{ if(navigator.share) await navigator.share({text:txt}); else { await navigator.clipboard.writeText(txt); toast('Invite copied'); } }catch(e){} };
      return;
    }
    if(g.phase==='question'){
      const q=g.qs[g.q], c=BYID[q.id]; const mine=((G.players[ACC.id]||{}).answers||{})[g.q];
      const answered=ids.filter(id=>(G.players[id].answers||{})[g.q]).length;
      if(partial && $('#qWord')){ const a=$('#answeredN'); if(a) a.textContent=`${answered} of ${ids.length} answered`; return; }
      clearInterval(G.tick);
      root.innerHTML=`<div class="studybar"><b>Question ${g.q+1} of ${g.qs.length}</b><span style="flex:1"></span><span id="answeredN" style="color:var(--ink-soft);font-size:14px">${answered} of ${ids.length} answered</span></div>
        <div class="timer"><i id="tbar" style="width:100%"></i></div>
        <div class="qcard"><div style="font-size:14px;color:var(--ink-soft);margin-bottom:10px">What does it mean?</div>
          <div class="word ${gClass(c.g)}" id="qWord">${esc(c.fr)}</div><div style="margin-top:10px"><button class="say" id="sayBtn" aria-label="Hear it">🔊</button></div></div>
        <div class="kgrid">${q.opts.map((oid,i)=>`<button class="kopt k${i}" data-i="${i}" ${mine?'disabled':''}><span class="shape" aria-hidden="true">${SHAPES[i]}</span>${esc(BYID[oid].en)}</button>`).join('')}</div>
        <p class="center" id="lockMsg" style="color:var(--ink-soft)">${mine?'Answer locked in. Waiting for the others…':''}</p>`;
      if(mine) document.querySelectorAll('.kopt').forEach(b=>{ if(+b.dataset.i===mine.c) b.classList.add('pick'); });
      document.querySelectorAll('.kopt').forEach(b=>b.onclick=()=>answer(+b.dataset.i));
      $('#sayBtn').onclick=()=>speak(c.fr);
      if(!mine) setTimeout(()=>speak(c.fr),200);
      const upd=()=>{ const left=Math.max(0,1-(Date.now()-G.localStart)/g.dur); const tb=$('#tbar'); if(tb) tb.style.width=(left*100)+'%';
        if(left<=0){ clearInterval(G.tick); document.querySelectorAll('.kopt').forEach(b=>b.disabled=true); if(!((G.players[ACC.id]||{}).answers||{})[g.q]){ const lm=$('#lockMsg'); if(lm) lm.textContent="Time's up!"; } } };
      upd(); G.tick=setInterval(upd,250);
      keyHandler=e=>{ if(/^[1-4]$/.test(e.key)) answer(+e.key-1); };
      return;
    }
    clearInterval(G.tick);
    const q=g.qs[g.q], c=BYID[q.id]; const mine=((G.players[ACC.id]||{}).answers||{})[g.q];
    const got=pts(mine,q.ans,g.dur);
    const ranking=Object.entries(g.scores||{}).sort((a,b)=>b[1]-a[1]);
    if(g.phase==='reveal'){
      root.innerHTML=`<div class="studybar"><b>Question ${g.q+1} of ${g.qs.length}</b></div>
        <div class="qcard"><div class="word ${gClass(c.g)}">${esc(c.fr)}</div><p style="font-size:20px;margin:8px 0 0"><b>${esc(c.en)}</b></p>${c.note?`<p style="font-family:var(--f-hand);font-size:22px;color:var(--margin);margin:6px 0 0">${esc(c.note)}</p>`:''}</div>
        <div class="center"><div class="result-big">${mine? (got? `+${got}` : 'Not quite') : 'Too slow'}</div>
        <p style="color:var(--ink-soft)">${got? 'Nice and quick!' : mine? `The answer was “${esc(c.en)}”.` : 'No answer this time.'}</p></div>
        <div class="board" style="margin:16px 0">${ranking.slice(0,5).map(([id,s],i)=>`<div class="brow ${id===ACC.id?'me':''}"><span class="rk">${i+1}</span>${avatar(avOf(id))}<div class="nm">${esc(nameOf(id))}</div><span class="pts">${s}</span></div>`).join('')}</div>
        ${isHost()? `<button class="cta" id="nextQ">${g.q+1>=g.qs.length?'Show final results':'Next question'}</button>` : `<p class="center" style="color:var(--ink-soft)">Waiting for ${esc(nameOf(g.host))} to continue…</p>`}`;
      const nb=$('#nextQ'); if(nb){ nb.onclick=()=>{ nb.disabled=true; hostNext(); }; keyHandler=e=>{ if(e.key==='Enter'&&!nb.disabled){ nb.disabled=true; hostNext(); } }; }
      return;
    }
    // final results
    const won = ranking[0]&&ranking[0][0]===ACC.id&&ranking[0][1]>0;
    const myScore=(g.scores||{})[ACC.id]||0;
    if(!G.counted && S.games.lastCode!==code){ G.counted=true; S.games.lastCode=code; S.games.played++; if(won) S.games.won++; addXp(Math.round(myScore/50)); touchDay(); save(); flushNow(); }
    const top=ranking.slice(0,3); const order=[top[1],top[0],top[2]]; const cls=['second','first','third'];
    root.innerHTML=`<div class="center"><h1 class="result-big" style="font-weight:400">${won?'Vous avez gagné !':'Partie terminée !'}</h1>
      <p style="color:var(--ink-soft)">${deck.emoji} ${esc(deck.name)} · you earned ${Math.round(myScore/50)} points</p></div>
      <div class="podium">${order.map((r,i)=> r? `<div class="pod ${cls[i]}">${['🥈','🥇','🥉'][i]}<br>${avatar(avOf(r[0]))}<b>${esc(nameOf(r[0]))}</b><span style="font-family:var(--f-word);font-size:20px">${r[1]}</span></div>` : '<div></div>').join('')}</div>
      ${ranking.length>3?`<div class="board" style="margin-bottom:16px">${ranking.slice(3).map(([id,s],i)=>`<div class="brow ${id===ACC.id?'me':''}"><span class="rk">${i+4}</span>${avatar(avOf(id))}<div class="nm">${esc(nameOf(id))}</div><span class="pts">${s}</span></div>`).join('')}</div>`:''}
      <div class="btns"><a class="cta" href="#/live/${g.cat}">${isHost()?'Host another game':'Play again'}</a><a class="back" style="justify-content:center" href="#/leaders">See the leaderboard</a></div>`;
    if(won) confetti();
  }
}

/* ================= celebration ================= */
let stopConfetti=false;
function confetti(){
  stopConfetti=false;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv=$('#confetti'), ctx=cv.getContext('2d'); const W=cv.width=innerWidth, H=cv.height=innerHeight;
  const cs=getComputedStyle(document.documentElement); const cols=['--masc','--fem','--hl','--good','--plur'].map(v=>cs.getPropertyValue(v).trim());
  const P=Array.from({length:120},()=>({x:W/2+(Math.random()-.5)*120,y:H*.35,vx:(Math.random()-.5)*12,vy:-Math.random()*12-4,r:Math.random()*6+4,c:cols[Math.floor(Math.random()*cols.length)],a:Math.random()*6,va:(Math.random()-.5)*.3}));
  let t=0; (function tick(){ ctx.clearRect(0,0,W,H); P.forEach(p=>{p.vy+=.35;p.x+=p.vx;p.y+=p.vy;p.a+=p.va;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.fillStyle=p.c;ctx.fillRect(-p.r/2,-p.r/4,p.r,p.r/2);ctx.restore();});
    if(++t<150 && !stopConfetti) requestAnimationFrame(tick); else ctx.clearRect(0,0,W,H); })();
}

/* ================= boot ================= */
async function boot(){
  try{
    const res=await fetch('/vocabulary.json',{cache:'no-cache'});
    const RAW=await res.json();
    CATS = RAW.cats.map(([id,name,emoji,group])=>({id,name,emoji,group}));
    CAT = Object.fromEntries(CATS.map(c=>[c.id,c]));
    CARDS = RAW.cards.map(([id,fr,en,g,t,pron,note,ci])=>({id,fr,en,g,t,pron,note,cat:CATS[ci].id}));
    BYID = Object.fromEntries(CARDS.map(c=>[c.id,c]));
    BYCAT = {}; CARDS.forEach(c=>(BYCAT[c.cat]=BYCAT[c.cat]||[]).push(c));
    GROUPS = [...new Set(CATS.map(c=>c.group))];
  }catch(e){ $('#app').innerHTML='<div class="empty"><p>The word list could not load. Check your connection and reload the page.</p></div>'; return; }
  render();
  initAuth();
}
boot();
})();
