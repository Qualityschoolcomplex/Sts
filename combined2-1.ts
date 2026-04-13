// ============================================================
// FILE: app.ts
// ============================================================

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

// ─── Server→Client sync script (runs synchronously before React hydrates) ───
const syncScript = `
<script>
(function(){
  var SYNC_KEYS = ["qsc_users","qsc_reports","qsc_report_template","qsc_school_logo","qsc_score_sheets","qsc_student_names"];
  var API_BASE  = "/api/storage";
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", API_BASE, false);
    xhr.send();
    if (xhr.status === 200) {
      var data = JSON.parse(xhr.responseText);
      for (var i = 0; i < SYNC_KEYS.length; i++) {
        var k = SYNC_KEYS[i];
        if (data.hasOwnProperty(k)) { localStorage.setItem(k, data[k]); }
        else { localStorage.removeItem(k); }
      }
    }
  } catch(e) { console.warn("QSC sync error:", e); }

  // Intercept localStorage so every write is mirrored to DB
  var _set    = localStorage.setItem.bind(localStorage);
  var _remove = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    _set(key, value);
    if (SYNC_KEYS.indexOf(key) !== -1) {
      fetch(API_BASE + "/" + encodeURIComponent(key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: value })
      }).catch(function(){});
    }
  };
  localStorage.removeItem = function(key) {
    _remove(key);
    if (SYNC_KEYS.indexOf(key) !== -1) {
      fetch(API_BASE + "/" + encodeURIComponent(key), { method: "DELETE" }).catch(function(){});
    }
  };
})();
</script>`;

// ─── Main patch script — all DOM-level features injected at runtime ───
const patchScript = `
<script>
(function(){
'use strict';

/* ══════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════ */
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function ord(n){
  n = parseInt(n)||0;
  var s=['th','st','nd','rd'], v=n%100;
  return n+(s[(v-20)%10]||s[v]||s[0]);
}

function showToast(msg, type){
  var t = document.getElementById('__qsc_toast__');
  if(!t){
    t = document.createElement('div');
    t.id = '__qsc_toast__';
    Object.assign(t.style,{
      position:'fixed',bottom:'24px',right:'24px',zIndex:'2147483647',
      fontFamily:'system-ui,sans-serif',fontSize:'14px',padding:'12px 20px',
      borderRadius:'10px',boxShadow:'0 4px 24px rgba(0,0,0,0.18)',
      transition:'opacity 0.3s',maxWidth:'380px',pointerEvents:'none',
      lineHeight:'1.4'
    });
    document.body.appendChild(t);
  }
  clearTimeout(t._tmr);
  var colors = {
    success:{ bg:'#f0fdf4', color:'#15803d', border:'#86efac' },
    error:  { bg:'#fef2f2', color:'#b91c1c', border:'#fca5a5' },
    warning:{ bg:'#fffbeb', color:'#92400e', border:'#fde68a' },
  };
  var c = colors[type]||colors.success;
  t.style.background = c.bg; t.style.color = c.color;
  t.style.border = '1.5px solid '+c.border;
  t.textContent = msg; t.style.opacity='1'; t.style.display='block';
  t._tmr = setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.style.display='none'; },300); },3500);
}

function getCurrentUser(){ try{ return JSON.parse(localStorage.getItem('qsc_current_user')||'null'); }catch(e){ return null; } }
function getScoreSheets(){ try{ return JSON.parse(localStorage.getItem('qsc_score_sheets')||'[]'); }catch(e){ return []; } }
function saveScoreSheets(a){ localStorage.setItem('qsc_score_sheets', JSON.stringify(a)); }
function getStudentNames(){ try{ return JSON.parse(localStorage.getItem('qsc_student_names')||'[]'); }catch(e){ return []; } }
function saveStudentNames(a){ localStorage.setItem('qsc_student_names', JSON.stringify(a)); }
function getUsers(){ try{ return JSON.parse(localStorage.getItem('qsc_users')||'[]'); }catch(e){ return []; } }
function saveUsers(a){ localStorage.setItem('qsc_users', JSON.stringify(a)); }

function calcGrade(t){
  if(t>=80)return 'A1'; if(t>=70)return 'B2'; if(t>=65)return 'B3';
  if(t>=60)return 'C4'; if(t>=55)return 'C5'; if(t>=50)return 'C6';
  if(t>=45)return 'D7'; if(t>=40)return 'E8'; return 'F9';
}
function gradeRemark(g){
  return {A1:'Excellent',B2:'Very Good',B3:'Good',C4:'Credit',C5:'Credit',C6:'Credit',D7:'Pass',E8:'Pass',F9:'Fail'}[g]||'';
}

/* ══════════════════════════════════════════════════════
   REPLIT BADGE REMOVAL (incognito-safe)
══════════════════════════════════════════════════════ */
function killReplitBadge(){
  ['replit-badge','replit-pill','[data-repl-id]','#replit-badge','#replit-pill',
   '.replit-badge','.replit-pill','[class*="replit-"]','[id*="replit-"]'
  ].forEach(function(sel){
    try{ document.querySelectorAll(sel).forEach(function(el){ el.remove(); }); }catch(e){}
  });
  if(!document.getElementById('__qsc_badge_style__')){
    var s = document.createElement('style');
    s.id = '__qsc_badge_style__';
    s.textContent = [
      'replit-badge,replit-pill,[data-repl-id],.replit-badge,.replit-pill,',
      '[class*="replit-"],[id*="replit-"]{',
      'display:none!important;visibility:hidden!important;',
      'opacity:0!important;pointer-events:none!important;',
      'width:0!important;height:0!important;position:absolute!important;}'
    ].join('');
    (document.head||document.documentElement).appendChild(s);
  }
}
killReplitBadge();
setInterval(killReplitBadge, 300);
document.addEventListener('DOMContentLoaded', killReplitBadge);
window.addEventListener('load', function(){ killReplitBadge(); setTimeout(killReplitBadge,1000); setTimeout(killReplitBadge,3000); });

/* ══════════════════════════════════════════════════════
   MUTATION OBSERVER — re-runs patchers on React re-renders
══════════════════════════════════════════════════════ */
var _obs = new MutationObserver(function(){
  killReplitBadge();
  patchManageUsers();
  patchScoreSheet();
  patchCreateReport();
  patchAdminReports();
  patchStaffDashboard();
  patchAdminLogoUpload();
  patchStaffReportAccess();
});
document.addEventListener('DOMContentLoaded', function(){
  _obs.observe(document.body, { childList:true, subtree:true });
});

/* ══════════════════════════════════════════════════════
   localStorage interceptor — live-update admin panel
══════════════════════════════════════════════════════ */
var _origSet = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value){
  _origSet(key, value);
  if(key==='qsc_score_sheets'){
    var p = document.getElementById('__qsc_ss_admin_panel__');
    if(p) renderSubmittedSheets(p);
  }
};

/* ══════════════════════════════════════════════════════
   STAFF DASHBOARD — Student Names panel
══════════════════════════════════════════════════════ */
function patchStaffDashboard(){
  var user = getCurrentUser();
  if(!user||user.role!=='staff') return;

  // Find the score-sheets section heading
  var heading = null;
  document.querySelectorAll('h2,h3').forEach(function(h){
    var t = h.textContent.trim();
    if(!heading && (t==='Score Sheets'||t==='My Score Sheets'||t==='Create Score Sheet')) heading=h;
  });
  if(!heading) return;

  // Walk up to find a suitable container
  var container = heading.parentElement;
  for(var up=0;up<4;up++){
    if(container&&container.parentElement&&container.parentElement!==document.body) container=container.parentElement;
    else break;
  }
  if(!container||container.dataset.qscSnPatched) return;
  container.dataset.qscSnPatched='true';

  var panel = document.createElement('div');
  panel.id='__qsc_sn_panel__';
  panel.style.cssText='background:#fff;border:1.5px solid #e5e7eb;border-radius:14px;padding:22px 24px;margin-bottom:24px;box-shadow:0 1px 4px rgba(0,0,0,0.06);';
  renderStudentNamesPanel(panel);
  container.insertBefore(panel, container.firstChild);
}

function renderStudentNamesPanel(panel){
  var names = getStudentNames();
  var chips = names.length===0
    ? '<p style="color:#9ca3af;font-size:13px;margin:0;">No student names saved yet.</p>'
    : '<div id="__qsc_sn_chips__" style="display:flex;flex-wrap:wrap;gap:8px;">'+
      names.map(function(n,i){
        return '<span style="display:inline-flex;align-items:center;gap:5px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;padding:4px 12px;font-size:13px;color:#1e40af;font-family:system-ui,sans-serif;">'+
          esc(n)+
          '<button data-del-name="'+i+'" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:15px;line-height:1;padding:0;margin-left:2px;" title="Remove">&times;</button>'+
          '</span>';
      }).join('')+'</div>';

  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'+
      '<h3 style="font-size:16px;font-weight:700;color:#111827;margin:0;">Student Names</h3>'+
      '<button id="__qsc_sn_add_btn__" style="background:#003087;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">+ Add Name</button>'+
    '</div>'+
    '<div id="__qsc_sn_add_row__" style="display:none;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;">'+
      '<input id="__qsc_sn_inp__" type="text" placeholder="Student full name…" style="flex:1;min-width:200px;padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;outline:none;" />'+
      '<button id="__qsc_sn_save__" style="background:#16a34a;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Save</button>'+
      '<button id="__qsc_sn_cancel__" style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'+
    '</div>'+
    chips;

  var addBtn   = document.getElementById('__qsc_sn_add_btn__');
  var addRow   = document.getElementById('__qsc_sn_add_row__');
  var inp      = document.getElementById('__qsc_sn_inp__');
  var saveBtn  = document.getElementById('__qsc_sn_save__');
  var cancelBtn= document.getElementById('__qsc_sn_cancel__');

  if(addBtn&&addRow){ addBtn.onclick=function(){ addRow.style.display='flex'; if(inp) inp.focus(); }; }
  if(cancelBtn&&addRow){ cancelBtn.onclick=function(){ addRow.style.display='none'; if(inp) inp.value=''; }; }
  if(saveBtn&&inp){
    function doSave(){
      var v=inp.value.trim(); if(!v) return;
      var arr=getStudentNames();
      if(!arr.includes(v)){ arr.push(v); saveStudentNames(arr); showToast('Name saved!','success'); }
      inp.value='';
      if(addRow) addRow.style.display='none';
      renderStudentNamesPanel(panel);
    }
    saveBtn.onclick=doSave;
    inp.onkeydown=function(e){ if(e.key==='Enter') doSave(); };
  }
  var chips2 = document.getElementById('__qsc_sn_chips__');
  if(chips2){
    chips2.onclick=function(e){
      var btn=e.target.closest('[data-del-name]'); if(!btn) return;
      var idx=parseInt(btn.getAttribute('data-del-name'));
      var arr=getStudentNames(); arr.splice(idx,1); saveStudentNames(arr);
      renderStudentNamesPanel(panel);
      showToast('Name removed.','warning');
    };
  }
}

/* ══════════════════════════════════════════════════════
   MANAGE USERS — Add User, Search, Delete
══════════════════════════════════════════════════════ */
function patchManageUsers(){
  var heading=null;
  document.querySelectorAll('h2').forEach(function(h){
    if(h.textContent.trim()==='Manage User Credentials') heading=h;
  });
  if(!heading) return;
  var container=heading.parentElement;
  if(!container||container.dataset.qscMuPatched) return;
  container.dataset.qscMuPatched='true';

  // Add User button
  var addBtn=document.createElement('button');
  addBtn.textContent='+ Add User';
  addBtn.style.cssText='background:#003087;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px;display:block;font-family:system-ui,sans-serif;';
  addBtn.onmouseover=function(){this.style.background='#004db8';};
  addBtn.onmouseout=function(){this.style.background='#003087';};
  addBtn.onclick=showAddUserModal;
  container.insertBefore(addBtn, heading.nextSibling);

  // Search box
  var searchWrap=document.createElement('div');
  searchWrap.style.cssText='margin-bottom:14px;';
  searchWrap.innerHTML='<input id="__qsc_user_search__" type="text" placeholder="Search by name or username…" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;" />';
  container.insertBefore(searchWrap, addBtn.nextSibling);

  setInterval(function(){
    var inp=document.getElementById('__qsc_user_search__');
    if(!inp) return;
    var q=inp.value.toLowerCase();
    container.querySelectorAll('.bg-white.border,.bg-white.rounded-xl,[class*="rounded-xl"][class*="border"]').forEach(function(card){
      if(card.id&&card.id.startsWith('__qsc_')) return;
      card.style.display=(!q||card.textContent.toLowerCase().includes(q))?'':'none';
    });
  },400);

  // Inject Delete buttons into existing user cards
  injectDeleteButtons(container);
}

function injectDeleteButtons(container){
  var currentUser=getCurrentUser();
  container.querySelectorAll('.bg-white.border,.bg-white.rounded-xl,[class*="rounded-xl"]').forEach(function(card){
    if(card.id&&card.id.startsWith('__qsc_')) return;
    if(card.dataset.qscDelBtn) return;
    card.dataset.qscDelBtn='true';

    // Try to figure out username from card text
    var usernameEl=card.querySelector('[class*="mono"],[class*="font-mono"],.font-mono');
    var username=usernameEl?usernameEl.textContent.trim():'';

    if(!username){
      // Try to find "Username: xyz" pattern
      var text=card.textContent;
      var m=text.match(/Username[:\s]+(\S+)/i);
      if(m) username=m[1];
    }

    // Don't show delete for current user
    if(!username||username===(currentUser&&currentUser.username)) return;

    var btnRow=card.querySelector('[class*="flex"]');
    if(!btnRow) return;

    var delBtn=document.createElement('button');
    delBtn.textContent='Delete';
    delBtn.setAttribute('data-del-user', username);
    delBtn.style.cssText='background:#fef2f2;color:#b91c1c;border:1.5px solid #fca5a5;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-left:8px;font-family:system-ui,sans-serif;';
    delBtn.onclick=function(){
      var uname=this.getAttribute('data-del-user');
      if(!confirm('Delete user "'+uname+'"? This cannot be undone.')) return;
      var users=getUsers().filter(function(u){ return u.username!==uname; });
      saveUsers(users);
      showToast('User "'+uname+'" deleted.','warning');
      window.dispatchEvent(new StorageEvent('storage',{key:'qsc_users'}));
      // Remove the card from DOM
      card.remove();
    };
    btnRow.appendChild(delBtn);
  });
}

function showAddUserModal(){
  var old=document.getElementById('__qsc_au_modal__'); if(old) old.remove();
  var modal=document.createElement('div');
  modal.id='__qsc_au_modal__';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';

  function fld(label,id,type,ph){
    return '<div style="margin-bottom:14px;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:5px;color:#374151;">'+label+'</label>'+
      '<input id="'+id+'" type="'+type+'" placeholder="'+ph+'" style="width:100%;padding:9px 13px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>';
  }

  modal.innerHTML=
    '<div style="background:#fff;border-radius:16px;padding:32px;width:440px;max-width:93vw;box-shadow:0 20px 60px rgba(0,0,0,0.25);">'+
      '<h3 style="font-size:18px;font-weight:700;margin:0 0 20px;color:#111;">Add New User</h3>'+
      '<div id="__au_err__" style="display:none;background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:14px;"></div>'+
      fld('Display Name','__au_dn__','text','e.g. John Doe')+
      fld('Username *','__au_un__','text','unique username')+
      fld('Password *','__au_pw__','password','password')+
      '<div style="margin-bottom:20px;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:5px;color:#374151;">Role *</label>'+
      '<select id="__au_role__" style="width:100%;padding:9px 13px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">'+
      '<option value="staff">Staff</option><option value="admin">Admin</option></select></div>'+
      '<div style="display:flex;gap:12px;">'+
      '<button id="__au_ok__" style="flex:1;background:#003087;color:#fff;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Add User</button>'+
      '<button id="__au_cancel__" style="flex:1;background:#f3f4f6;color:#374151;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>'+
      '</div></div>';

  document.body.appendChild(modal);
  document.getElementById('__au_cancel__').onclick=function(){ modal.remove(); };
  modal.onclick=function(e){ if(e.target===modal) modal.remove(); };
  document.getElementById('__au_ok__').onclick=function(){
    var dn=document.getElementById('__au_dn__').value.trim();
    var un=document.getElementById('__au_un__').value.trim();
    var pw=document.getElementById('__au_pw__').value.trim();
    var role=document.getElementById('__au_role__').value;
    var err=document.getElementById('__au_err__');
    err.style.display='none';
    if(!un||!pw){ err.textContent='Username and password are required.'; err.style.display='block'; return; }
    var users=getUsers();
    if(users.find(function(u){ return u.username===un; })){
      err.textContent='Username already exists.'; err.style.display='block'; return;
    }
    users.push({ id:'u_'+Date.now(), username:un, password:pw, displayName:dn||un, role:role });
    saveUsers(users);
    modal.remove();
    showToast('User "'+(dn||un)+'" added!','success');
    window.dispatchEvent(new StorageEvent('storage',{key:'qsc_users'}));
  };
}

/* ══════════════════════════════════════════════════════
   SCORE SHEET — A4, ordinal position, search, save/submit
══════════════════════════════════════════════════════ */
function patchScoreSheet(){
  var heading=null;
  document.querySelectorAll('h2').forEach(function(h){
    if(h.textContent.trim()==='Create Score Sheet') heading=h;
  });
  if(!heading) return;

  var modal=heading.closest('.bg-white.rounded-2xl')||heading.closest('[class*="bg-white"]')||heading.closest('[class*="shadow"]');
  if(!modal||modal.dataset.qscSsPatched) return;
  modal.dataset.qscSsPatched='true';

  // A4 dimensions
  modal.style.width='210mm';
  modal.style.maxWidth='210mm';
  modal.style.minHeight='297mm';
  modal.style.boxSizing='border-box';

  // Inject name autocomplete dropdowns
  injectNameDropdowns(modal);

  // Inject search box for student name filtering
  injectScoreSheetSearch(modal);

  // Remove "Grade" column header & cells
  removeGradeFromSheet(modal);

  // Make position cells ordinal
  updateOrdinalPositions(modal);

  // Add Save Draft / Submit buttons next to Print
  var printBtn=null;
  modal.querySelectorAll('button').forEach(function(b){
    var t=b.textContent.trim().toLowerCase();
    if(!printBtn&&(t.includes('print')||t.includes('export'))) printBtn=b;
  });
  if(!printBtn) return;
  var btnRow=printBtn.parentElement;
  if(!btnRow||btnRow.dataset.qscSsBtnsPatched) return;
  btnRow.dataset.qscSsBtnsPatched='true';

  var draftBtn=document.createElement('button');
  draftBtn.textContent='Save Draft';
  draftBtn.type='button';
  draftBtn.style.cssText='background:#f3f4f6;color:#374151;border:1.5px solid #d1d5db;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;';
  draftBtn.onclick=function(){ captureSheet(modal,'draft'); };
  btnRow.insertBefore(draftBtn,printBtn);

  var submitBtn=document.createElement('button');
  submitBtn.textContent='Submit to Admin';
  submitBtn.type='button';
  submitBtn.style.cssText='background:#16a34a;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;';
  submitBtn.onclick=function(){ captureSheet(modal,'submitted'); };
  btnRow.insertBefore(submitBtn,printBtn);

  var previewBtn=document.createElement('button');
  previewBtn.textContent='Preview';
  previewBtn.type='button';
  previewBtn.style.cssText='background:#0f172a;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;';
  previewBtn.onclick=function(){ previewSheet(modal); };
  btnRow.insertBefore(previewBtn,printBtn);
}

function removeGradeFromSheet(modal){
  modal.querySelectorAll('th').forEach(function(th){
    if(th.textContent.trim().toLowerCase()==='grade') th.style.display='none';
  });
  // Find grade column index
  var gradeIdx=-1;
  var ths=Array.from(modal.querySelectorAll('thead tr th'));
  ths.forEach(function(th,i){ if(th.textContent.trim().toLowerCase()==='grade') gradeIdx=i; });
  if(gradeIdx<0) return;
  modal.querySelectorAll('tbody tr').forEach(function(tr){
    var tds=tr.querySelectorAll('td');
    if(tds[gradeIdx]) tds[gradeIdx].style.display='none';
  });
}

function updateOrdinalPositions(modal){
  // Find Position column and render ordinals
  var posIdx=-1;
  var ths=Array.from(modal.querySelectorAll('thead tr th'));
  ths.forEach(function(th,i){
    var t=th.textContent.trim().toLowerCase();
    if(t==='position'||t==='pos'||t==='rank') posIdx=i;
  });
  if(posIdx<0) return;
  modal.querySelectorAll('tbody tr').forEach(function(tr){
    var tds=tr.querySelectorAll('td');
    if(tds[posIdx]){
      var v=parseInt(tds[posIdx].textContent.trim());
      if(!isNaN(v)&&v>0) tds[posIdx].textContent=ord(v);
    }
  });
}

function injectNameDropdowns(modal){
  var names=getStudentNames();
  if(!names.length) return;
  modal.querySelectorAll('tbody tr').forEach(function(tr){
    if(tr.dataset.qscDl) return;
    var inputs=tr.querySelectorAll('input');
    var nameInp=null;
    inputs.forEach(function(inp){ if(inp.placeholder&&inp.placeholder.toLowerCase().includes('name')) nameInp=inp; });
    if(!nameInp&&inputs.length>0) nameInp=inputs[0];
    if(!nameInp) return;
    tr.dataset.qscDl='true';
    var dlId='__qsc_dl_'+Math.random().toString(36).slice(2)+'__';
    var dl=document.createElement('datalist'); dl.id=dlId;
    names.forEach(function(n){ var o=document.createElement('option'); o.value=n; dl.appendChild(o); });
    nameInp.setAttribute('list',dlId);
    nameInp.setAttribute('autocomplete','off');
    nameInp.parentNode.appendChild(dl);
  });
}

function injectScoreSheetSearch(modal){
  if(modal.dataset.qscSearchInj) return;
  modal.dataset.qscSearchInj='true';
  var thead=modal.querySelector('thead');
  if(!thead) return;
  var wrap=document.createElement('div');
  wrap.style.cssText='padding:10px 0;';
  wrap.innerHTML='<input id="__qsc_ss_search__" type="text" placeholder="Search student names…" style="width:260px;padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;outline:none;" />';
  thead.parentElement.parentElement.insertBefore(wrap, thead.parentElement);
  var inp=document.getElementById('__qsc_ss_search__');
  if(inp){
    inp.oninput=function(){
      var q=inp.value.toLowerCase();
      modal.querySelectorAll('tbody tr').forEach(function(tr){
        var text=tr.textContent.toLowerCase();
        tr.style.display=(!q||text.includes(q))?'':'none';
      });
    };
  }
}

function captureSheet(modal, status){
  function lval(labelText){
    var els=modal.querySelectorAll('label');
    for(var i=0;i<els.length;i++){
      if(els[i].textContent.trim()===labelText){
        var sib=els[i].nextElementSibling;
        if(sib) return sib.tagName==='SELECT'?sib.options[sib.selectedIndex].text:(sib.value||'');
      }
    }
    return '';
  }
  var rows=[];
  modal.querySelectorAll('tbody tr').forEach(function(tr){
    var inp=tr.querySelectorAll('input');
    if(inp.length>=2){
      var name=inp[0].value||'';
      var cs=inp.length>=3?inp[inp.length-2].value:'';
      var ex=inp.length>=3?inp[inp.length-1].value:(inp.length>=2?inp[1].value:'');
      rows.push({ no:rows.length+1, studentName:name, classScore:cs, exam100:ex });
    }
  });
  var user=getCurrentUser();
  var now=new Date().toISOString();
  var sheet={
    id:'ss_'+Date.now(),
    title:lval('Sheet Title')||('Score Sheet '+new Date().toLocaleDateString()),
    subject:lval('Subject'), class:lval('Class'), term:lval('Term'), academicYear:lval('Academic Year'),
    rows:rows, status:status,
    staffUsername:user?user.username:'', staffName:user?(user.displayName||user.username):'',
    createdAt:now, submittedAt:status==='submitted'?now:null
  };
  var sheets=getScoreSheets(); sheets.push(sheet); saveScoreSheets(sheets);
  if(status==='draft'){
    showToast('Score sheet saved as draft!','success');
  } else {
    showToast('Submitted to admin!','success');
    // Try to close modal
    var closeEls=modal.querySelectorAll('button');
    for(var i=0;i<closeEls.length;i++){
      if(closeEls[i].querySelector('svg')||closeEls[i].textContent.trim()==='×'||closeEls[i].getAttribute('aria-label')==='Close'){
        setTimeout(function(el){ el.click(); },250,closeEls[i]); break;
      }
    }
  }
}

function previewSheet(modal){
  function lval(labelText){
    var els=modal.querySelectorAll('label');
    for(var i=0;i<els.length;i++){
      if(els[i].textContent.trim()===labelText){
        var sib=els[i].nextElementSibling;
        if(sib) return sib.tagName==='SELECT'?sib.options[sib.selectedIndex].text:(sib.value||'');
      }
    }
    return '';
  }
  var rows=[];
  modal.querySelectorAll('tbody tr').forEach(function(tr){
    var inp=tr.querySelectorAll('input');
    if(inp.length>=2){
      var name=inp[0].value||'';
      var cs=parseFloat(inp.length>=3?inp[inp.length-2].value:0)||0;
      var ex100=parseFloat(inp.length>=3?inp[inp.length-1].value:(inp.length>=2?inp[1].value:0))||0;
      var ex70=Math.round(ex100/100*70*10)/10;
      var total=Math.round((cs+ex70)*10)/10;
      rows.push({ no:rows.length+1, name:name, cs:cs, ex100:ex100, ex70:ex70, total:total });
    }
  });

  // Sort by total desc to get positions
  var sorted=rows.filter(function(r){ return r.name; }).slice().sort(function(a,b){ return b.total-a.total; });
  var posMap={};
  sorted.forEach(function(r,i){ posMap[r.no]=i+1; });

  var rowHtml=rows.map(function(r){
    var pos=r.name&&posMap[r.no]?ord(posMap[r.no]):'';
    return '<tr><td>'+r.no+'</td><td style="text-align:left">'+esc(r.name)+'</td>'+
      '<td>'+r.cs+'</td><td>'+r.ex100+'</td><td>'+r.ex70+'</td>'+
      '<td style="font-weight:700">'+r.total+'</td><td>'+pos+'</td></tr>';
  }).join('');

  var w=window.open('','_blank'); if(!w) return;
  w.document.write([
    '<!DOCTYPE html><html><head><title>Score Sheet Preview</title>',
    '<style>@page{size:A4 landscape;margin:10mm;}body{font-family:Arial,sans-serif;font-size:10px;}',
    'h2,h3{margin:0 0 4px;}table{width:100%;border-collapse:collapse;}',
    'th,td{border:1px solid #555;padding:3px 6px;text-align:center;}',
    'th{background:#dce8f5;}td:nth-child(2){text-align:left;}</style></head><body>',
    '<h2>QUALITY SCHOOL COMPLEX</h2>',
    '<h3>'+esc(lval('Sheet Title')||'Score Sheet')+'</h3>',
    '<p style="font-size:10px;margin:4px 0 8px;">Subject: '+esc(lval('Subject'))+
    ' | Class: '+esc(lval('Class'))+' | Term: '+esc(lval('Term'))+' | Year: '+esc(lval('Academic Year'))+'</p>',
    '<table><thead><tr>',
    '<th>#</th><th>Student Name</th><th>Class Score (30%)</th>',
    '<th>Exam Score (100%)</th><th>Exam Score (70%)</th><th>Total</th><th>Position</th>',
    '</tr></thead><tbody>'+rowHtml+'</tbody></table>',
    '</body></html>'
  ].join(''));
  w.document.close();
  setTimeout(function(){ w.focus(); w.print(); },500);
}

/* ══════════════════════════════════════════════════════
   CREATE REPORT (Staff) — no Grade, student dropdown, autofill
══════════════════════════════════════════════════════ */
function patchCreateReport(){
  var user=getCurrentUser();
  if(!user||user.role!=='staff') return;

  var heading=null;
  document.querySelectorAll('h2').forEach(function(h){
    var t=h.textContent.trim();
    if(!heading&&(t==='Create Report'||t==='Generate Report'||t==='Create Report Card')) heading=h;
  });
  if(!heading) return;

  var modal=heading.closest('[style*="position: fixed"]')||heading.closest('[style*="position:fixed"]')||
            heading.closest('.fixed')||heading.closest('[class*="fixed"]')||heading.parentElement;
  if(!modal||modal.dataset.qscCrPatched) return;
  modal.dataset.qscCrPatched='true';

  // Remove Grade column
  removeGradeFromReport(modal);
  // Inject student name dropdown
  injectReportStudentDropdown(modal);
  // Wire auto-fill
  wireReportAutoFill(modal);
}

function removeGradeFromReport(container){
  var gradeIdx=-1;
  var ths=Array.from(container.querySelectorAll('th'));
  ths.forEach(function(th,i){
    if(th.textContent.trim().toLowerCase()==='grade'){ th.style.display='none'; gradeIdx=i; }
  });
  if(gradeIdx<0) return;
  container.querySelectorAll('tbody tr,tr').forEach(function(tr){
    var tds=tr.querySelectorAll('td');
    if(tds[gradeIdx]) tds[gradeIdx].style.display='none';
  });
}

function injectReportStudentDropdown(modal){
  modal.querySelectorAll('label').forEach(function(lbl){
    var t=lbl.textContent.trim().toLowerCase();
    if(t!=='student name'&&t!=="student's name"&&t!=='name of student') return;
    var inp=lbl.nextElementSibling;
    if(!inp||inp.tagName!=='INPUT'){ inp=lbl.parentElement?lbl.parentElement.querySelector('input'):null; }
    if(!inp||inp.dataset.qscSnDl) return;
    inp.dataset.qscSnDl='true';

    var saved=getStudentNames();
    var fromSheets=[];
    getScoreSheets().filter(function(s){ return s.status==='submitted'||s.status==='approved'; }).forEach(function(sh){
      (sh.rows||[]).forEach(function(r){ if(r.studentName&&!fromSheets.includes(r.studentName)) fromSheets.push(r.studentName); });
    });
    var all=saved.slice();
    fromSheets.forEach(function(n){ if(!all.includes(n)) all.push(n); });

    var dlId='__qsc_cr_dl__';
    var ex=document.getElementById(dlId); if(ex) ex.remove();
    var dl=document.createElement('datalist'); dl.id=dlId;
    all.forEach(function(n){ var o=document.createElement('option'); o.value=n; dl.appendChild(o); });
    inp.setAttribute('list',dlId);
    inp.setAttribute('autocomplete','off');
    inp.parentNode.appendChild(dl);
  });
}

function wireReportAutoFill(modal){
  modal.querySelectorAll('label').forEach(function(lbl){
    var t=lbl.textContent.trim().toLowerCase();
    if(t!=='student name'&&t!=="student's name"&&t!=='name of student') return;
    var inp=lbl.nextElementSibling;
    if(!inp||inp.tagName!=='INPUT'){ inp=lbl.parentElement?lbl.parentElement.querySelector('input'):null; }
    if(!inp||inp.dataset.qscAfWired) return;
    inp.dataset.qscAfWired='true';
    function tryFill(){
      var name=inp.value.trim(); if(!name) return;
      var sheets=getScoreSheets().filter(function(s){ return s.status==='submitted'||s.status==='approved'; });
      var matched=[];
      sheets.forEach(function(sh){
        (sh.rows||[]).forEach(function(r){
          if((r.studentName||'').toLowerCase()===name.toLowerCase()) matched.push({subject:sh.subject,classScore:r.classScore,exam100:r.exam100});
        });
      });
      if(!matched.length) return;
      var trs=modal.querySelectorAll('tbody tr');
      matched.forEach(function(m,idx){
        var tr=trs[idx]; if(!tr) return;
        var inputs=tr.querySelectorAll('input');
        var selects=tr.querySelectorAll('select');
        selects.forEach(function(sel){
          for(var i=0;i<sel.options.length;i++){
            if(sel.options[i].text===m.subject||sel.options[i].value===m.subject){ sel.selectedIndex=i; sel.dispatchEvent(new Event('change',{bubbles:true})); break; }
          }
        });
        if(!selects.length&&inputs[0]){ inputs[0].value=m.subject||''; inputs[0].dispatchEvent(new Event('input',{bubbles:true})); }
        if(inputs.length>=2){ inputs[inputs.length-2].value=m.classScore||''; inputs[inputs.length-2].dispatchEvent(new Event('input',{bubbles:true})); }
        if(inputs.length>=1){ inputs[inputs.length-1].value=m.exam100||''; inputs[inputs.length-1].dispatchEvent(new Event('input',{bubbles:true})); }
      });
      showToast('Scores auto-filled from score sheets!','success');
    }
    inp.addEventListener('change',tryFill);
    inp.addEventListener('blur',tryFill);
  });
}

/* ══════════════════════════════════════════════════════
   ADMIN GENERATE REPORT — Grade→Position (ordinal)
══════════════════════════════════════════════════════ */
function patchAdminReports(){
  var user=getCurrentUser();
  if(!user||user.role!=='admin') return;

  document.querySelectorAll('h2,h3').forEach(function(h){
    var t=h.textContent.trim();
    if(t!=='Student Reports'&&t!=='Generate Reports'&&t!=='Reports'&&t!=='Report Cards') return;
    var container=h.closest('[class*="p-"]')||h.closest('[class*="bg-white"]')||h.parentElement;
    if(!container) return;
    container.querySelectorAll('th').forEach(function(th){
      if(th.textContent.trim().toLowerCase()==='grade'&&!th.dataset.qscGrReplaced){
        th.dataset.qscGrReplaced='true'; th.textContent='Position';
      }
    });
    // Convert grade cell values to ordinal positions where applicable
    container.querySelectorAll('tbody tr').forEach(function(tr,rowIdx){
      var tds=Array.from(tr.querySelectorAll('td'));
      tds.forEach(function(td,colIdx){
        var ths2=Array.from(container.querySelectorAll('th'));
        if(ths2[colIdx]&&ths2[colIdx].textContent.trim()==='Position'){
          var v=parseInt(td.textContent.trim());
          if(!isNaN(v)&&v>0&&!td.dataset.ordinalDone){ td.dataset.ordinalDone='true'; td.textContent=ord(v); }
        }
      });
    });
  });

  patchSubmittedScoreSheets();
}

/* ══════════════════════════════════════════════════════
   SUBMITTED SCORE SHEETS PANEL (Admin)
══════════════════════════════════════════════════════ */
function patchSubmittedScoreSheets(){
  var user=getCurrentUser();
  if(!user||user.role!=='admin') return;

  var reportsH2=null;
  document.querySelectorAll('h2,h3').forEach(function(h){
    var t=h.textContent.trim();
    if(!reportsH2&&(t==='Student Reports'||t==='Reports'||t==='Generate Reports'||t==='Report Cards')) reportsH2=h;
  });
  if(!reportsH2) return;

  var section=reportsH2.parentElement;
  for(var up=0;up<5;up++){
    if(section&&section.children.length>=2) break;
    section=section?section.parentElement:null;
  }
  if(!section) section=reportsH2.parentElement;
  if(!section||section.dataset.qscSsAdminPatched) return;
  section.dataset.qscSsAdminPatched='true';

  var panel=document.createElement('div');
  panel.id='__qsc_ss_admin_panel__';
  panel.style.cssText='margin-top:32px;';
  section.appendChild(panel);
  renderSubmittedSheets(panel);
}

function renderSubmittedSheets(panel){
  var sheets=getScoreSheets().filter(function(s){ return s.status==='submitted'||s.status==='approved'; });
  panel.innerHTML='';

  var hdr=document.createElement('div');
  hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
  hdr.innerHTML='<h2 style="font-size:18px;font-weight:700;color:#111827;margin:0;">Submitted Score Sheets</h2>'+
    '<span style="font-size:13px;color:#6b7280;font-family:system-ui,sans-serif;">'+sheets.length+' sheet(s)</span>';
  panel.appendChild(hdr);

  if(!sheets.length){
    var empty=document.createElement('div');
    empty.style.cssText='text-align:center;padding:48px 0;color:#9ca3af;font-family:system-ui,sans-serif;';
    empty.innerHTML='<div style="font-size:40px;margin-bottom:10px;">📋</div><p style="font-weight:600;margin:0;">No submitted score sheets yet</p>';
    panel.appendChild(empty); return;
  }

  sheets.forEach(function(sheet){
    var card=document.createElement('div');
    card.style.cssText='background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,0.06);margin-bottom:12px;';
    var d=new Date(sheet.submittedAt||sheet.createdAt);
    var dateStr=d.toLocaleDateString()+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    var approved=sheet.status==='approved';
    card.innerHTML=
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">'+
        '<div>'+
          '<h3 style="font-size:15px;font-weight:700;color:#111;margin:0 0 6px;font-family:system-ui,sans-serif;">'+esc(sheet.title||'Untitled')+'</h3>'+
          '<div style="font-size:12px;color:#6b7280;display:flex;flex-wrap:wrap;gap:10px;font-family:system-ui,sans-serif;">'+
            '<span>Subject: <strong style="color:#374151;">'+esc(sheet.subject||'—')+'</strong></span>'+
            '<span>Class: <strong style="color:#374151;">'+esc(sheet.class||'—')+'</strong></span>'+
            '<span>Term: <strong style="color:#374151;">'+esc(sheet.term||'—')+'</strong></span>'+
            '<span>By: <strong style="color:#374151;">'+esc(sheet.staffName||sheet.staffUsername||'—')+'</strong></span>'+
            '<span>Date: <strong style="color:#374151;">'+dateStr+'</strong></span>'+
            '<span>Records: <strong style="color:#374151;">'+(sheet.rows||[]).filter(function(r){return r.studentName;}).length+'</strong></span>'+
          '</div>'+
        '</div>'+
        '<div style="display:flex;gap:8px;flex-shrink:0;align-items:flex-start;">'+
          (approved
            ? '<span style="background:#dcfce7;color:#15803d;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;font-family:system-ui,sans-serif;">✓ Approved</span>'
            : '<button data-ss-approve="'+sheet.id+'" style="background:#16a34a;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Approve</button>')+
          '<button data-ss-print="'+sheet.id+'" style="background:#003087;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Print</button>'+
          '<button data-ss-delete="'+sheet.id+'" style="background:#fef2f2;color:#b91c1c;border:1.5px solid #fca5a5;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Delete</button>'+
        '</div>'+
      '</div>';
    panel.appendChild(card);
  });

  panel.onclick=function(e){
    var target=e.target.closest('[data-ss-print],[data-ss-delete],[data-ss-approve]');
    if(!target) return;
    var pid=target.getAttribute('data-ss-print');
    var did=target.getAttribute('data-ss-delete');
    var aid=target.getAttribute('data-ss-approve');
    if(pid) printScoreSheet(pid);
    if(did) deleteScoreSheet(did,panel);
    if(aid) approveScoreSheet(aid,panel);
  };
}

function printScoreSheet(id){
  var sheet=getScoreSheets().find(function(s){ return s.id===id; }); if(!sheet) return;
  var rows=(sheet.rows||[]).map(function(r,i){
    var cs=parseFloat(r.classScore)||0, ex100=parseFloat(r.exam100)||0;
    var ex70=Math.round(ex100/100*70*10)/10;
    var total=Math.round((cs+ex70)*10)/10;
    return '<tr><td>'+(i+1)+'</td><td style="text-align:left">'+esc(r.studentName||'')+'</td>'+
      '<td>'+cs+'</td><td>'+ex100+'</td><td>'+ex70+'</td>'+
      '<td style="font-weight:700">'+total+'</td></tr>';
  }).join('');
  var w=window.open('','_blank'); if(!w) return;
  w.document.write([
    '<!DOCTYPE html><html><head><title>Score Sheet</title>',
    '<style>@page{size:A4 landscape;margin:10mm;}body{font-family:Arial,sans-serif;font-size:10px;}',
    'h2,h3{margin:0 0 4px;}table{width:100%;border-collapse:collapse;}',
    'th,td{border:1px solid #555;padding:3px 6px;text-align:center;}th{background:#dce8f5;}',
    'td:nth-child(2){text-align:left;}.meta{font-size:10px;margin-bottom:8px;}</style></head><body>',
    '<h2>'+esc(sheet.title||'Score Sheet')+'</h2>',
    '<div class="meta">Subject: '+esc(sheet.subject||'')+'&nbsp;|&nbsp;Class: '+esc(sheet.class||'')+
      '&nbsp;|&nbsp;Term: '+esc(sheet.term||'')+'&nbsp;|&nbsp;Year: '+esc(sheet.academicYear||'')+
      '&nbsp;|&nbsp;Staff: '+esc(sheet.staffName||sheet.staffUsername||'')+'</div>',
    '<table><thead><tr><th>#</th><th>Student Name</th>',
    '<th>Class Score (30%)</th><th>Exam Score (100%)</th><th>Exam Score (70%)</th><th>Total</th>',
    '</tr></thead><tbody>'+rows+'</tbody></table>',
    '</body></html>'
  ].join(''));
  w.document.close();
  setTimeout(function(){ w.focus(); w.print(); },500);
}

function deleteScoreSheet(id,panel){
  if(!confirm('Delete this score sheet? This cannot be undone.')) return;
  saveScoreSheets(getScoreSheets().filter(function(s){ return s.id!==id; }));
  renderSubmittedSheets(panel);
  showToast('Score sheet deleted.','warning');
}

function approveScoreSheet(id,panel){
  var sheets=getScoreSheets();
  for(var i=0;i<sheets.length;i++){
    if(sheets[i].id===id){ sheets[i].status='approved'; sheets[i].approvedAt=new Date().toISOString(); break; }
  }
  saveScoreSheets(sheets);
  renderSubmittedSheets(panel);
  showToast('Score sheet approved! Staff can now create reports.','success');
}

/* ══════════════════════════════════════════════════════
   ADMIN LOGO UPLOAD
══════════════════════════════════════════════════════ */
function patchAdminLogoUpload(){
  var user=getCurrentUser();
  if(!user||user.role!=='admin') return;
  var heading=null;
  document.querySelectorAll('h2,h3').forEach(function(h){
    var t=h.textContent.trim();
    if(!heading&&(t==='Report Template'||t==='School Settings'||t==='Report Settings'||t==='Customize Report')) heading=h;
  });
  if(!heading) return;
  var container=heading.closest('[class*="bg-white"]')||heading.closest('[class*="p-"]')||heading.parentElement;
  if(!container||container.dataset.qscLogoPatched) return;
  var emailLabel=null;
  container.querySelectorAll('label').forEach(function(l){
    var t=l.textContent.trim().toLowerCase();
    if(t.includes('email')||t.includes('e-mail')) emailLabel=l;
  });
  if(!emailLabel) return;
  container.dataset.qscLogoPatched='true';

  var logoPanel=document.createElement('div');
  logoPanel.id='__qsc_logo_panel__';
  logoPanel.style.cssText='margin:16px 0;padding:16px;border:1.5px dashed #d1d5db;border-radius:12px;background:#f9fafb;';

  function renderLogo(){
    var logo=localStorage.getItem('qsc_school_logo')||'';
    logoPanel.innerHTML=
      '<label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">School Logo</label>'+
      (logo
        ? '<div style="margin-bottom:10px;text-align:center;"><img src="'+logo+'" style="max-height:80px;max-width:160px;object-fit:contain;border:1px solid #e5e7eb;border-radius:8px;padding:4px;background:#fff;" /><br/>'+
          '<button id="__qsc_logo_rm__" style="margin-top:6px;background:#fef2f2;color:#b91c1c;border:1.5px solid #fca5a5;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Remove Logo</button></div>'
        : '<p style="font-size:12px;color:#9ca3af;margin:0 0 8px;">No logo uploaded yet.</p>')+
      '<input id="__qsc_logo_file__" type="file" accept="image/*" style="font-size:13px;" />';
    var fi=document.getElementById('__qsc_logo_file__');
    if(fi){ fi.onchange=function(e){ var f=e.target.files[0]; if(!f) return;
      if(f.size>2*1024*1024){ showToast('File must be under 2MB.','error'); return; }
      var r=new FileReader(); r.onload=function(ev){ localStorage.setItem('qsc_school_logo',ev.target.result); showToast('Logo uploaded!','success'); renderLogo(); }; r.readAsDataURL(f); }; }
    var rm=document.getElementById('__qsc_logo_rm__');
    if(rm){ rm.onclick=function(){ localStorage.removeItem('qsc_school_logo'); showToast('Logo removed.','warning'); renderLogo(); }; }
  }
  renderLogo();

  var insertAfter=emailLabel.parentElement||emailLabel;
  if(insertAfter.nextSibling) insertAfter.parentNode.insertBefore(logoPanel,insertAfter.nextSibling);
  else insertAfter.parentNode.appendChild(logoPanel);
}

/* ══════════════════════════════════════════════════════
   STAFF REPORT ACCESS — locked until admin approves
══════════════════════════════════════════════════════ */
function patchStaffReportAccess(){
  var user=getCurrentUser();
  if(!user||user.role!=='staff') return;
  var approved=getScoreSheets().filter(function(s){ return s.staffUsername===user.username&&s.status==='approved'; });
  var hasApproved=approved.length>0;

  document.querySelectorAll('h2,h3').forEach(function(h){
    var t=h.textContent.trim();
    if(t!=='Create Report'&&t!=='Generate Report'&&t!=='Create Report Card'&&t!=='Report Cards'&&t!=='Reports') return;
    var section=h.closest('[class*="bg-white"]')||h.closest('[class*="p-"]')||h.parentElement;
    if(!section||section.dataset.qscAccessPatched) return;
    if(hasApproved) return; // allow access

    section.dataset.qscAccessPatched='true';
    section.querySelectorAll('button').forEach(function(btn){
      var bt=btn.textContent.trim().toLowerCase();
      if(bt.includes('create')||bt.includes('generate')||bt.includes('new report')){
        btn.disabled=true; btn.style.opacity='0.45'; btn.style.cursor='not-allowed';
        btn.title='Submit score sheets to admin first';
        btn.onclick=function(e){ e.preventDefault(); e.stopPropagation(); showToast('Admin must approve your score sheets first.','warning'); return false; };
      }
    });
    if(!section.querySelector('#__qsc_access_msg__')){
      var msg=document.createElement('div');
      msg.id='__qsc_access_msg__';
      msg.style.cssText='background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:12px 16px;margin-top:12px;font-size:13px;color:#92400e;font-family:system-ui,sans-serif;';
      msg.innerHTML='<strong>Access Restricted:</strong> Submit your score sheets and wait for admin approval before creating reports.';
      if(h.nextSibling) h.parentNode.insertBefore(msg,h.nextSibling); else h.parentNode.appendChild(msg);
    }
  });
}

})();
</script>`;

let cachedHtml: string | null = null;

function getInjectedHtml(): string {
  if (cachedHtml) return cachedHtml;
  const htmlPath = path.join(__dirname, "..", "public", "index.html");
  let raw = fs.readFileSync(htmlPath, "utf-8");
  // Strip all Replit badge scripts
  raw = raw.replace(/<script[^>]*replit-cdn\.com[^>]*><\/script>/gi, "");
  raw = raw.replace(/<script[^>]*replit-pill[^>]*><\/script>/gi, "");
  raw = raw.replace(/<script[^>]*data-repl-id[^>]*><\/script>/gi, "");
  raw = raw.replace(/<link[^>]*replit[^>]*>/gi, "");
  // Inject our scripts right after <head>
  raw = raw.replace("<head>", "<head>" + syncScript + patchScript);
  cachedHtml = raw;
  return cachedHtml;
}

// ─── Download routes (unchanged from original) ───
const DOWNLOAD_FILES: Record<string, { disk: string; name: string; label: string }> = {
  "app.ts": {
    disk: path.join(__dirname, "..", "src", "app.ts"),
    name: "app.ts",
    label: "Server entry (app.ts)",
  },
  "routes-storage.ts": {
    disk: path.join(__dirname, "..", "src", "routes", "storage.ts"),
    name: "routes-storage.ts",
    label: "Storage routes (routes/storage.ts)",
  },
  "routes-index.ts": {
    disk: path.join(__dirname, "..", "src", "routes", "index.ts"),
    name: "routes-index.ts",
    label: "Routes index (routes/index.ts)",
  },
  "schema-storage.ts": {
    disk: path.join(__dirname, "..", "..", "..", "lib", "db", "src", "schema", "storage.ts"),
    name: "schema-storage.ts",
    label: "DB schema (lib/db/src/schema/storage.ts)",
  },
  "schema-index.ts": {
    disk: path.join(__dirname, "..", "..", "..", "lib", "db", "src", "schema", "index.ts"),
    name: "schema-index.ts",
    label: "Schema index (lib/db/src/schema/index.ts)",
  },
  "index.html": {
    disk: path.join(__dirname, "..", "public", "index.html"),
    name: "index.html",
    label: "Frontend HTML (public/index.html)",
  },
};

const TS_FILE_KEYS = ["app.ts", "routes-storage.ts", "routes-index.ts", "schema-storage.ts", "schema-index.ts"];

app.get("/downloads/combined.ts", (req, res) => {
  const parts = TS_FILE_KEYS.map((key) => {
    const entry = DOWNLOAD_FILES[key]!;
    const content = fs.readFileSync(entry.disk, "utf-8");
    const divider = "// " + "=".repeat(60);
    return `${divider}\n// FILE: ${entry.name}\n${divider}\n\n${content}`;
  });
  res.setHeader("Content-Disposition", 'attachment; filename="combined.ts"');
  res.type("text/plain").send(parts.join("\n\n"));
});

app.get("/downloads", (req, res) => {
  const rows = Object.entries(DOWNLOAD_FILES)
    .map(([key, entry]) => {
      return `<li style="margin:10px 0">
        <a href="/downloads/${encodeURIComponent(key)}" download="${entry.name}"
           style="font-family:monospace;font-size:15px;color:#003087;text-decoration:none;border-bottom:1px solid #003087;">
          ${entry.name}
        </a>
        <span style="font-size:12px;color:#555;margin-left:10px;">${entry.label}</span>
      </li>`;
    })
    .join("");

  const combinedRow = `<li style="margin:10px 0">
    <a href="/downloads/combined.ts" download="combined.ts"
       style="font-family:monospace;font-size:15px;color:#003087;text-decoration:none;border-bottom:1px solid #003087;">
      combined.ts
    </a>
    <span style="font-size:12px;color:#555;margin-left:10px;">All .ts files merged into one</span>
  </li>`;

  res.type("html").send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Download Files — QSC SIS</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 48px; background: #f5f7fa; }
    h2 { color: #003087; margin-bottom: 6px; }
    p { color: #555; margin-top: 0; font-size: 14px; }
    ul { list-style: none; padding: 0; background: #fff; border-radius: 12px; padding: 24px 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
  </style>
</head>
<body>
  <h2>Updated Files — Download Individually</h2>
  <p>Replace your existing files with these updated versions.</p>
  <ul>
    ${rows}
    <hr />
    ${combinedRow}
  </ul>
</body>
</html>`);
});

app.get("/downloads/:file", (req, res) => {
  const key = req.params.file;
  const entry = DOWNLOAD_FILES[key];
  if (!entry) { res.status(404).send("File not found"); return; }
  if (!fs.existsSync(entry.disk)) { res.status(404).send("File does not exist on disk"); return; }
  res.download(entry.disk, entry.name);
});

app.get("/favicon.svg", (req, res) => {
  const faviconPath = path.join(__dirname, "..", "public", "favicon.svg");
  if (fs.existsSync(faviconPath)) { res.type("image/svg+xml").sendFile(faviconPath); }
  else { res.status(204).end(); }
});

app.get("/{*path}", (req, res) => {
  res.type("html").send(getInjectedHtml());
});

export default app;


// ============================================================
// FILE: routes-storage.ts
// ============================================================

import { Router } from "express";
import { db } from "@workspace/db";
import { kvStore } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const ALLOWED_KEYS = new Set([
  "qsc_users",
  "qsc_reports",
  "qsc_report_template",
  "qsc_school_logo",
  "qsc_score_sheets",
  "qsc_student_names",
]);

const router = Router();

router.get("/storage", async (req, res) => {
  const rows = await db
    .select()
    .from(kvStore)
    .where(inArray(kvStore.key, [...ALLOWED_KEYS]));
  const data: Record<string, string> = {};
  for (const row of rows) {
    data[row.key] = row.value;
  }
  res.json(data);
});

router.put("/storage/:key", async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) {
    res.status(403).json({ error: "key not allowed" });
    return;
  }
  const { value } = req.body;
  if (typeof value !== "string") {
    res.status(400).json({ error: "value must be a string" });
    return;
  }
  await db
    .insert(kvStore)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: kvStore.key,
      set: { value, updatedAt: new Date() },
    });
  res.json({ ok: true });
});

router.delete("/storage/:key", async (req, res) => {
  const { key } = req.params;
  if (!ALLOWED_KEYS.has(key)) {
    res.status(403).json({ error: "key not allowed" });
    return;
  }
  await db.delete(kvStore).where(eq(kvStore.key, key));
  res.json({ ok: true });
});

export default router;


// ============================================================
// FILE: routes-index.ts
// ============================================================

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);

export default router;


// ============================================================
// FILE: schema-storage.ts
// ============================================================

import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const kvStore = pgTable("kv_store", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});


// ============================================================
// FILE: schema-index.ts
// ============================================================

export * from "./storage";
