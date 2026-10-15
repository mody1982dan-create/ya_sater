import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,signInAnonymously} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getDatabase,ref,get,set,remove,onValue,runTransaction} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import {firebaseConfig} from './firebase-config.js';
import {acts,challenges} from './game_data.js';

const abc='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const clamp=n=>Math.max(0,Math.min(100,n));
function randomCode(){const b=new Uint8Array(6);crypto.getRandomValues(b);return Array.from(b,x=>abc[x%abc.length]).join('');}
function shuffled(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
function validName(name){const x=String(name||'').trim().replace(/\s+/g,' ');if(!x||Array.from(x).length>22||/[<>\r\n]/.test(x))throw Error('الاسم لازم يكون من ١ إلى ٢٢ حرفًا.');return x;}
function sceneFor(meta){const act=acts[Math.floor(meta.round/2)];return meta.round%2===0?act.main:act.follow[meta.routes?.[Math.floor(meta.round/2)]||'a'];}
function friendlyError(e){const code=String(e?.code||'');if(code.includes('permission-denied'))return 'تم رفض الطلب. تأكدي من وجود الغرفة، وأن قواعد Firebase منشورة، أو أن الغرفة لم تكتمل.';if(code.includes('auth/operation-not-allowed'))return 'فعّلي تسجيل الدخول المجهول (Anonymous) في Firebase Authentication.';if(code.includes('auth/unauthorized-domain'))return 'أضيفي عنوان GitHub Pages إلى النطاقات المسموح بها في Firebase Authentication.';if(code.includes('network')||code.includes('unavailable'))return 'تحققي من اتصال الإنترنت ثم حاولي مجددًا.';return e?.message||'حصل خطأ غير متوقع.';}
function makeView(code,room,uid){
 const m=room.meta,players=Object.entries(room.players||{}).sort((a,b)=>(a[1].joinedAt-b[1].joinedAt)||a[0].localeCompare(b[0]));
 const votes=room.votes?.[m.round]||{};
 const entries=players.map(([id,p])=>({id,name:p.name,score:m.scores?.[id]||0,isHost:id===m.hostUid,voted:Object.hasOwn(votes,id)}));
 const stage=acts[Math.min(Math.floor(m.round/2),3)];
 const out={code,phase:m.phase,isHost:uid===m.hostUid,selfId:uid,selfName:room.players[uid]?.name,players:entries,maxPlayers:10,round:m.round,act:stage.name,actIcon:stage.icon,stats:{...m.stats},voteCount:Object.keys(votes).filter(k=>Object.hasOwn(room.players,k)).length,version:m.version||1};
 if(['vote','reveal'].includes(m.phase)){
  const s=sceneFor(m);out.scene={emoji:s.emoji,title:s.title,desc:s.desc,options:s.options.map(o=>o.t)};
  out.myVote=Object.hasOwn(votes,uid)?votes[uid]:null;
 }
 if(m.phase==='reveal')out.result=m.result;
 if(['challenge','challengeResult'].includes(m.phase)){
  const ci=(m.round/2)-1;
  out.challenge=challenges[m.challengeOrder[ci]];
  out.challengePlayer=entries[ci%entries.length]?.name||out.selfName;
  out.challengeStartedAt=m.challengeStartedAt||null;
  out.challengeResult=m.challengeResult||null;
 }
 return out;
}
async function hostMeta(code,fn){
 const path=ref(db,'rooms/'+code+'/meta');
 const tx=await runTransaction(path,m=>{
  if(!m||m.hostUid!==authUser.uid)return;
  const next=fn(JSON.parse(JSON.stringify(m)));
  if(!next)return;
  next.version=(m.version||0)+1;
  return next;
 },{applyLocally:false});
 if(!tx.committed)throw Error('تعذر تنفيذ الأمر، يمكن أن المرحلة تغيّرت. حدّثي الصفحة وجربي.');
}
async function api(action,payload){
 if(!db||!authUser)throw Error('اتصال Firebase غير جاهز. تأكدي من الإعدادات والإنترنت.');
 const uid=authUser.uid;
 if(action==='create'){
  const name=validName(payload.name);
  for(let n=0;n<12;n++){
   const code=randomCode();
   const room={meta:{hostUid:uid,phase:'lobby',round:0,routes:{},stats:{budget:75,time:72,mood:65},scores:{[uid]:0},challengeOrder:shuffled([...Array(challenges.length).keys()]).slice(0,3),challengeStartedAt:0,version:1,createdAt:Date.now()},players:{[uid]:{name,joinedAt:Date.now()}}};
   const tx=await runTransaction(ref(db,'rooms/'+code),old=>old?undefined:room,{applyLocally:false});
   if(tx.committed)return {code,uid};
  }
  throw Error('تعذر إنشاء رمز جديد. حاولي مرة ثانية.');
 }
 if(action==='join'){
  const code=String(payload.code||'').trim().toUpperCase();const name=validName(payload.name);
  if(!/^[A-Z2-9]{6}$/.test(code))throw Error('رمز الغرفة لازم يكون من ٦ خانات.');
  const snap=await get(ref(db,'rooms/'+code));const room=snap.val();
  if(!room)throw Error('الغرفة غير موجودة، راجعي الرمز.');
  if(room.players?.[uid])return {code,uid};
  if(room.meta?.phase!=='lobby')throw Error('العزيمة بدأت بالفعل. انتظري الجولة القادمة.');
  const people=Object.values(room.players||{});
  if(people.length>=10)throw Error('الغرفة مكتملة: الحد الأعلى ١٠ أشخاص.');
  if(people.some(p=>p.name.trim().toLowerCase()===name.toLowerCase()))throw Error('الاسم مستخدم داخل الغرفة. اختاري اسمًا مختلفًا.');
  await set(ref(db,'rooms/'+code+'/players/'+uid),{name,joinedAt:Date.now()});
  return {code,uid};
 }
 const code=id?.code;
 if(!code||id.uid!==uid)throw Error('بيانات دخول الغرفة غير متوافقة مع هذا الجهاز.');
 if(action==='vote'){
  if(!Number.isInteger(payload.choice)||payload.choice<0||payload.choice>2)throw Error('اختيار غير صحيح.');
  await set(ref(db,'rooms/'+code+'/votes/'+view.round+'/'+uid),payload.choice);
  return {ok:true};
 }
 if(action==='leave'){
  if(view?.phase!=='lobby')throw Error('الخروج متاح قبل بداية العزيمة.');
  if(view.isHost)await remove(ref(db,'rooms/'+code));
  else await remove(ref(db,'rooms/'+code+'/players/'+uid));
  return {left:true};
 }
 if(action==='start'){
  const snap=await get(ref(db,'rooms/'+code+'/players'));
  if(Object.keys(snap.val()||{}).length<2)throw Error('لازم شخصين على الأقل لبدء العزيمة.');
  await hostMeta(code,m=>{if(m.phase!=='lobby')return;m.phase='vote';return m;});return {ok:true};
 }
 if(action==='reveal'){
  const snap=await get(ref(db,'rooms/'+code));const room=snap.val();if(!room||room.meta.phase!=='vote')throw Error('التصويت انتهى أو الغرفة غير موجودة.');
  const m=room.meta,players=room.players||{},votes=room.votes?.[m.round]||{};
  const scene=sceneFor(m),ids=Object.keys(players);
  const choices=ids.map(x=>votes[x]).filter(v=>Number.isInteger(v)&&v>=0&&v<3);
  if(choices.length===0)throw Error('لازم صوت واحد على الأقل قبل كشف القرار.');
  const counts=scene.options.map((_,i)=>choices.filter(v=>v===i).length);
  let winner=0;for(let i=1;i<counts.length;i++)if(counts[i]>counts[winner]||(counts[i]===counts[winner]&&scene.options[i].p>scene.options[winner].p))winner=i;
  const choice=scene.options[winner],best=Math.max(...scene.options.map(x=>x.p));
  await hostMeta(code,next=>{
   if(next.phase!=='vote'||next.round!==m.round)return;
   const before={...next.stats};
   ['budget','time','mood'].forEach((key,i)=>{next.stats[key]=clamp(next.stats[key]+choice.d[i]);});
   if(next.round%2===0)next.routes={...next.routes,[Math.floor(next.round/2)]:choice.to};
   next.scores={...next.scores};
   for(const p of ids){const v=votes[p];if(!Number.isInteger(v))continue;const score=3+(v===winner?5:0)+(scene.options[v].p===best?10:0);next.scores[p]=(next.scores[p]||0)+score;}
   next.result={index:winner,choice:choice.t,description:choice.r,counts,delta:['budget','time','mood'].map(k=>next.stats[k]-before[k])};
   next.phase='reveal';return next;
  });return {ok:true};
 }
 if(action==='advance'){
  await hostMeta(code,m=>{
   if(m.phase==='reveal'){
    m.round+=1;m.result=null;
    if(m.round>=8)m.phase='finished';
    else if([2,4,6].includes(m.round)){m.phase='challenge';m.challengeStartedAt=0;m.challengeResult=null;}
    else m.phase='vote';
   }else if(m.phase==='challengeResult'){m.phase='vote';m.challengeStartedAt=0;m.challengeResult=null;}
   else return;
   return m;
  });return {ok:true};
 }
 if(action==='challenge-start'){
  await hostMeta(code,m=>{if(m.phase!=='challenge'||m.challengeStartedAt)return;m.challengeStartedAt=Date.now();return m;});return {ok:true};
 }
 if(action==='challenge-result'){
  if(typeof payload.success!=='boolean')throw Error('حددي نجاح التحدي أولًا.');
  const ps=await get(ref(db,'rooms/'+code+'/players'));
  const entries=Object.entries(ps.val()||{}).sort((a,b)=>a[1].joinedAt-b[1].joinedAt||a[0].localeCompare(b[0]));
  await hostMeta(code,m=>{
   if(m.phase!=='challenge'||!m.challengeStartedAt)return;
   const idx=m.round/2-1,who=entries[idx%entries.length];if(!who)return;
   const delta=payload.success?7:-3,before=m.stats.mood;
   m.stats.mood=clamp(m.stats.mood+delta);m.scores={...m.scores};
   const pts=payload.success?15:0;m.scores[who[0]]=(m.scores[who[0]]||0)+pts;
   m.challengeResult={success:payload.success,name:who[1].name,points:pts,moodDelta:m.stats.mood-before};m.phase='challengeResult';return m;
  });return {ok:true};
 }
 if(action==='restart'){
  if(view?.phase!=='finished')throw Error('كملي العزيمة قبل جولة جديدة.');
  await remove(ref(db,'rooms/'+code+'/votes'));
  await hostMeta(code,m=>{if(m.phase!=='finished')return;m.phase='vote';m.round=0;m.routes={};m.stats={budget:75,time:72,mood:65};m.result=null;m.challengeStartedAt=0;m.challengeResult=null;m.scores={};m.challengeOrder=shuffled([...Array(challenges.length).keys()]).slice(0,3);return m;});return {ok:true};
 }
 throw Error('الإجراء غير معروف.');
}

'use strict';
const KEY='ya_sater_firebase_room_v2';
const el=document.getElementById('app');
const queryRoom=new URLSearchParams(location.search).get('room')?.trim()?.toUpperCase()?.slice(0,6)||'';
let id=(()=>{try{return JSON.parse(sessionStorage.getItem(KEY)||'null')}catch{return null}})();
let view=null, mode=queryRoom?'join':'create', error='', busy=false, tick=null, lastVersion=-1;
let stopListener=null, authUser=null, db=null, autoResolving=false, firebaseStatus='';
if(queryRoom && id && id.code!==queryRoom){id=null;sessionStorage.removeItem(KEY)}
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s);
function section(k,title,sub,body){el.className='paper';el.innerHTML=`<div class="head"><span class="eyebrow">✦ ${k}</span><h1>${title}</h1><p>${sub}</p></div><div class="body">${body}</div>`;}
function btnAction(selector,fn){const b=$(selector);if(b)b.addEventListener('click',fn);}
async function act(action,extra={}){
 if(busy||!id)return;busy=true;
 try {
  const out=await api(action,{...id,...extra});
  if(out?.left){if(stopListener){stopListener();stopListener=null;}sessionStorage.removeItem(KEY);id=null;view=null;lastVersion=-1;renderStart();}
 }catch(e){showError(friendlyError(e));}
 finally{busy=false;checkAutoResolve();}
}
function showError(msg){error=msg;const spot=$('#err');if(spot){spot.textContent=msg;spot.hidden=false;}else alert(msg)}
function errorBox(){return `<p id="err" class="warning" ${error?'':'hidden'}>${E(error)}</p>`}
function saveSession(data){id=data;sessionStorage.setItem(KEY,JSON.stringify(id));view=null;lastVersion=-1;error='';fetchState()}
function renderStart(){clearInterval(tick);section('تجربة جماعية • ١٠ أشخاص','العزيمة على الأبواب!','العبوا مع بعض من جوالاتكم؛ كل وحدة تصوّت من جهازها وتتغير السالفة باختياراتكم.',`<div class="modegrid"><button id="modeCreate" class="mode ${mode==='create'?'active':''}">🏠 أنشئ غرفة</button><button id="modeJoin" class="mode ${mode==='join'?'active':''}">🔑 ادخل برمز</button></div><label class="field" for="name">اسمك في اللمّة</label><input class="input" id="name" maxlength="22" placeholder="مثال: نورة" autocomplete="nickname"><div id="roomWrap" ${mode==='join'?'':'hidden'}><label class="field" for="room">رمز الغرفة (٦ خانات)</label><input class="input" id="room" maxlength="6" placeholder="مثال: AB34FG" dir="ltr" style="text-transform:uppercase;letter-spacing:3px;text-align:center" value="${E(queryRoom)}"></div>${firebaseStatus?`<p class="warning">${E(firebaseStatus)}</p>`:''}${errorBox()}<button class="btn main block" id="enter">${mode==='create'?'إنشاء الغرفة واستقبال اللاعبات':'الدخول إلى العزيمة'}</button><p class="muted">يبدأ اللعب من شخصين حتى ١٠. رابط الغرفة ورمزها يُرسلان للمشاركات. لا يحتاج تسجيل أو تنزيل.</p>`);
 btnAction('#modeCreate',()=>{mode='create';error='';const name=$('#name').value;renderStart();$('#name').value=name});
 btnAction('#modeJoin',()=>{mode='join';error='';const name=$('#name').value;renderStart();$('#name').value=name});
 btnAction('#enter',async()=>{if(busy)return;busy=true;error='';const b=$('#enter');b.disabled=true;try{const name=$('#name').value;const code=$('#room')?.value.toUpperCase().trim();saveSession(await api(mode==='create'?'create':'join',{name,code}));}catch(e){showError(friendlyError(e))}finally{busy=false;b.disabled=false}});
}
function statusLine(){return `<div class="stages"><span class="badge">${E(view.actIcon)} ${E(view.act)} — المرحلة ${Math.floor(view.round/2)+1} من ٤</span><b>الموقف ${Math.min(view.round+1,8)} / ٨</b></div>`}
function meters(){return `<div class="meter-row">${[['budget','💰','الميزانية'],['time','⏳','الوقت'],['mood','💗','الوناسة']].map(([key,icon,label])=>`<div class="meter-card"><div class="meter-label"><span>${icon} ${label}</span><b>${view.stats[key]}٪</b></div><div class="line"><span class="fill ${key}" style="width:${view.stats[key]}%"></span></div></div>`).join('')}</div>`}
function people(){return `<div class="people">${view.players.map(p=>`<div class="person ${p.voted?'on':''}">${p.isHost?'👑':p.voted?'✅':'👤'} ${E(p.name)}${p.id===view.selfId?' (أنت)':''}<small>${view.phase==='vote'?(p.voted?'صوّتت':'تنتظر التصويت'):`${p.score} نقطة`}</small></div>`).join('')}</div>`}
function roomHeader(){return `<div class="flex"><b>🔒 الغرفة: <span dir="ltr">${E(view.code)}</span></b><span class="badge">${view.players.length} / ١٠ لاعبين</span></div>`}
function hostNote(){return view.isHost?'👑 أنت صاحبة الغرفة، وعندك التحكم في بدء الجولات وكشف النتائج.':'👑 صاحبة الغرفة تدير الجولات.'}
function renderLobby(){section('لمّة خاصة برمز دخول','يا هلا بالضيوف!','ارسلي الرابط أو الرمز لكل لاعبة، وابدؤوا متى ما اكتملتم.',`${roomHeader()}<div class="codebox"><span class="muted">رمز الانضمام</span><div class="roomcode">${E(view.code)}</div><button id="shareLink" class="btn">🔗 مشاركة رابط الدخول</button><p class="muted">اللي تضغط الرابط تكتب اسمها وتنضم فورًا.</p></div><div class="flex"><h3>👭 الموجودين بالعزيمة</h3><span class="badge">الباقي ${view.maxPlayers-view.players.length} أماكن</span></div>${people()}${errorBox()}<p class="notice">${hostNote()} البداية متاحة من لاعبتين، والحد الأعلى ١٠.</p><div class="btn-row">${view.isHost?`<button class="btn main" id="start" ${view.players.length<2?'disabled':''}>🎉 ابدأ العزيمة</button>`:''}<button class="btn ghost" id="leave">الخروج من الغرفة</button></div>`);
 btnAction('#start',()=>act('start'));btnAction('#leave',()=>{if(view.isHost&&!confirm('خروج صاحبة العزيمة ينهي الغرفة للجميع. متأكدة؟'))return;act('leave')});
 btnAction('#shareLink',async()=>{const url=new URL(location.href);url.searchParams.set('room',view.code);const text=url.toString();if(navigator.share){try{await navigator.share({title:'يا ساتر! جتنا عزيمة',text:'تعالي لعزيمتنا! رمز الدخول: '+view.code,url:text});return}catch(e){if(e.name==='AbortError')return}}try{await navigator.clipboard.writeText(text);showToast('تم نسخ الرابط! 📋')}catch(e){prompt('انسخي رابط الغرفة:',text)}});
}
function renderVote(){const my=view.myVote;section('الجولة الجارية','وش نسوي الحين؟','كل لاعبة تصوّت من جوالها، والخيار الأكثر تصويتًا يغيّر أحداث العزيمة.',`${roomHeader()}${statusLine()}${meters()}<div class="scene"><div class="emoji">${view.scene.emoji}</div><h2>${E(view.scene.title)}</h2><p>${E(view.scene.desc)}</p></div><div style="margin-top:17px"><b>اختاري قرارك (صوت واحد فقط):</b></div>${view.scene.options.map((label,i)=>`<button data-choice="${i}" class="choice ${my===i?'selected':''}" ${my!==null?'disabled':''}><span>${E(label)}</span><span class="letter">${['أ','ب','ج'][i]} ${my===i?'✓':''}</span></button>`).join('')}<div class="vote-track"><div class="flex"><b>${view.voteCount} / ${view.players.length} صوّتوا</b><span class="muted">${my!==null?'✅ تم تثبيت اختيارك':'⏳ بانتظار التصويت'}</span></div><div class="line"><span class="fill" style="width:${view.voteCount/view.players.length*100}%"></span></div></div>${errorBox()}${view.isHost?`<button class="btn main block" id="reveal" ${view.voteCount===0?'disabled':''}>🔮 اكشفي النتيجة الآن</button><p class="muted">إذا صوّت الجميع تنكشف النتيجة تلقائيًا، أو تقدرين تكشفينها قبل ذلك.</p>`:'<p class="notice">إذا انتهى التصويت تظهر نتيجة القرار للجميع بنفس اللحظة.</p>'}${people()}`);
 document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>act('vote',{choice:Number(b.dataset.choice)}));btnAction('#reveal',()=>act('reveal'));
}
function delta(name,val){return `<span class="delta ${val>0?'good':val<0?'bad':''}">${name} ${val>0?'+':''}${val}٪</span>`}
function renderReveal(){const r=view.result;section('اتفقنا على القرار!','يا ساتر، وش صار؟','تصويتكم غيّر مجرى القصة. ويمكن القرار الجاي يورطكم أكثر!',`${roomHeader()}${statusLine()}${meters()}<div class="scene"><div class="emoji">🎉</div><h2>${E(r.choice)}</h2><p>${E(r.description)}</p></div><div class="outcome"><b>أثر قرار الأغلبية على العزيمة:</b><div>${delta('الميزانية',r.delta[0])}${delta('الوقت',r.delta[1])}${delta('الوناسة',r.delta[2])}</div></div><h3>🗳️ كيف كانت الأصوات؟</h3><div class="tally">${r.counts.map((n,i)=>`<span>${['أ','ب','ج'][i]}: ${n} ${n===1?'صوت':'أصوات'}</span>`).join('')}</div><p class="muted">النقاط: ٣ للمشاركة + ٥ مع الأغلبية + ١٠ للخيار الأذكى (وفق قواعد اللعبة).</p>${view.isHost?`<button class="btn main block" id="next">${view.round===7?'🏆 اعرضي النتيجة النهائية':'➡️ الموقف التالي'}</button>`:'<p class="notice">صاحبة الغرفة تنتقل للموقف التالي.</p>'}${people()}`);btnAction('#next',()=>act('advance'));
}
function renderChallenge(){const c=view.challenge;const remain=view.challengeStartedAt?Math.max(0,c.sec-Math.floor((Date.now()-view.challengeStartedAt)/1000)):c.sec;section('بطاقة مفاجأة','تحدّي اللمّة!','الآن وقفة ضحك وتمثيل، وبعدها نكمل سالفة العزيمة.',`${roomHeader()}${meters()}<div class="scene"><div class="emoji">${c.emoji}</div><h2>${E(c.title)}</h2><p>${E(c.desc)}</p></div><p class="notice">🎤 التحدّي على: <strong>${E(view.challengePlayer)}</strong> — والباقيات يقررون هل نجحت!</p><div class="count" id="timer">${remain}</div>${view.isHost?`${!view.challengeStartedAt?'<button class="btn main block" id="startTimer">⏱️ ابدئي مؤقت التحدي</button>':'<div class="btn-row"><button class="btn main" id="pass">👏 نجحت</button><button class="btn" id="fail">😅 ما ضبط</button></div>'}`:'<p class="muted" style="text-align:center">المؤقت والحكم عند صاحبة الغرفة.</p>'}<p class="muted">مدة التحدي ${c.sec} ثانية، والفائزة تأخذ ١٥ نقطة.</p>`);
 btnAction('#startTimer',()=>act('challenge-start'));btnAction('#pass',()=>act('challenge-result',{success:true}));btnAction('#fail',()=>act('challenge-result',{success:false}));
 clearInterval(tick);if(view.challengeStartedAt)tick=setInterval(()=>{const t=$('#timer');if(t)t.textContent=Math.max(0,c.sec-Math.floor((Date.now()-view.challengeStartedAt)/1000))},450);
}
function renderChallengeResult(){const c=view.challengeResult;section('خلص التحدي','يا سلام على اللمّة!','على الفوز أو الخسارة، المهم إن السالفة تكمل.',`${roomHeader()}${meters()}<div class="scene"><div class="emoji">${c.success?'🏅':'🤭'}</div><h2>${c.success?'كفو يا '+E(c.name):'عوافي يا '+E(c.name)}</h2><p>${c.success?'أبدعتي، وزادت وناسة العزيمة!':'الضحكة أهم من النتيجة، الجاية أحلى.'}</p><b>⭐ ${c.points} نقطة</b><div>${delta('الوناسة',c.moodDelta)}</div></div>${view.isHost?'<button class="btn main block" id="afterChallenge">نرجع للعزيمة ←</button>':'<p class="notice">بانتظار صاحبة الغرفة نكمل الجولة...</p>'}${people()}`);btnAction('#afterChallenge',()=>act('advance'));
}
function renderFinished(){const s=view.stats;const score=Math.round(s.budget*.22+s.time*.22+s.mood*.56);const outcome=score>=84?['عزيمة أسطورية!','🏆']:score>=65?['عزيمة تفتح النفس!','✨']:score>=45?['عدّت على خير!','😅']:['يا ساتر! وش هالعزيمة؟','🙈'];const sorted=[...view.players].sort((a,b)=>b.score-a.score);section('النتيجة النهائية','الحمد لله على السلامة!','خلصت عزيمتنا، وشوفوا مين تصرفت بحكمة ومين ورّطتنا!',`${roomHeader()}<div class="finale" style="margin-top:16px"><div style="font-size:52px">${outcome[1]}</div><h2>${outcome[0]}</h2><p>👑 نجمة اللمّة: ${E(sorted.filter(p=>p.score===sorted[0].score).map(p=>p.name).join(' و '))}</p><b>نتيجة العزيمة: ${score} / ١٠٠</b></div>${meters()}<h3>🏅 ترتيب اللاعبات</h3><div class="ranks">${sorted.map((p,i)=>`<div class="rank"><span>${['🥇','🥈','🥉'][i]||'⭐'} ${E(p.name)}</span><span>${p.score} نقطة</span></div>`).join('')}</div><div class="btn-row">${view.isHost?'<button class="btn main" id="restart">🔄 جولة ثانية</button>':''}<button class="btn" id="copyResults">📋 نسخ النتيجة</button></div>`);
 btnAction('#restart',()=>act('restart'));
 btnAction('#copyResults',async()=>{const t=`يا ساتر! جتنا عزيمة 🫖\n${outcome[1]} ${outcome[0]}\n\n${sorted.map((p,i)=>`${i+1}. ${p.name}: ${p.score} نقطة`).join('\n')}\n\nالنتيجة: ${score}/100`;try{await navigator.clipboard.writeText(t);showToast('نسخت النتيجة 📋')}catch(e){prompt('انسخي النتيجة:',t)}});
}
let toastTimeout=null;function showToast(text){const n=document.createElement('div');n.textContent=text;n.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#53385f;color:#fff;border-radius:13px;padding:10px 16px;z-index:99';document.body.append(n);clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>n.remove(),2200)}
function render(){clearInterval(tick);if(!view)return renderStart();if(view.phase==='lobby')renderLobby();else if(view.phase==='vote')renderVote();else if(view.phase==='reveal')renderReveal();else if(view.phase==='challenge')renderChallenge();else if(view.phase==='challengeResult')renderChallengeResult();else if(view.phase==='finished')renderFinished();}
function fetchState(){
 if(stopListener){stopListener();stopListener=null;}
 if(!id||!db||!authUser)return;
 const roomCode=id.code;
 stopListener=onValue(ref(db,'rooms/'+roomCode),(snapshot)=>{
  if(!id||id.code!==roomCode)return;
  const room=snapshot.val();
  if(!room||!room.players?.[authUser.uid]){
   stopListener?.();stopListener=null;sessionStorage.removeItem(KEY);id=null;view=null;
   error='الغرفة غير موجودة أو خرجتِ منها. يمكنك الدخول من جديد.';renderStart();return;
  }
  view=makeView(roomCode,room,authUser.uid);error='';render();checkAutoResolve();
 },(err)=>{firebaseStatus='تعذر متابعة الغرفة. تحققي من قواعد Firebase أو الاتصال بالإنترنت.';if(!view){renderStart();}else{showError(friendlyError(err));}});
}
function checkAutoResolve(){
 if(!view||!view.isHost||view.phase!=='vote'||view.voteCount===0||view.voteCount!==view.players.length||busy||autoResolving)return;
 autoResolving=true;
 Promise.resolve().then(()=>act('reveal')).finally(()=>{autoResolving=false;});
}
async function init(){
 renderStart();
 if(!firebaseConfig.apiKey||firebaseConfig.apiKey.includes('PUT_YOUR_')||firebaseConfig.projectId==='YOUR_PROJECT_ID'){
  firebaseStatus='يحتاج ربط Firebase: افتحي ملف firebase-config.js وأضيفي إعدادات المشروع، ثم ارفعيه على GitHub.';
  renderStart();return;
 }
 try{
  const app=initializeApp(firebaseConfig);db=getDatabase(app);const auth=getAuth(app);
  const cred=await signInAnonymously(auth);authUser=cred.user;firebaseStatus='';
  if(id){if(id.uid!==authUser.uid){sessionStorage.removeItem(KEY);id=null;error='هوية هذا الجهاز تغيّرت، ادخلي الغرفة من جديد.';renderStart();}else fetchState();}
  else renderStart();
 }catch(e){firebaseStatus=friendlyError(e);renderStart();}
}
init();

