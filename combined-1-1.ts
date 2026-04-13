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

const syncScript = `
<script>
(function(){
  var SYNC_KEYS = ["qsc_users","qsc_reports","qsc_report_template","qsc_school_logo","qsc_score_sheets","qsc_student_names"];
  var API_BASE = "/api/storage";
  try {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", API_BASE, false);
    xhr.send();
    if (xhr.status === 200) {
      var data = JSON.parse(xhr.responseText);
      for (var i = 0; i < SYNC_KEYS.length; i++) {
        var k = SYNC_KEYS[i];
        if (data.hasOwnProperty(k)) {
          localStorage.setItem(k, data[k]);
        } else {
          localStorage.removeItem(k);
        }
      }
    }
  } catch(e) { console.warn("Failed to preload data from server:", e); }
  var origSetItem = localStorage.setItem.bind(localStorage);
  var origRemoveItem = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    origSetItem(key, value);
    if (SYNC_KEYS.indexOf(key) !== -1) {
      fetch(API_BASE + "/" + encodeURIComponent(key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: value })
      }).catch(function(){});
    }
  };
  localStorage.removeItem = function(key) {
    origRemoveItem(key);
    if (SYNC_KEYS.indexOf(key) !== -1) {
      fetch(API_BASE + "/" + encodeURIComponent(key), {
        method: "DELETE"
      }).catch(function(){});
    }
  };
})();
</script>`;

const patchScript = `
<script>
(function(){

/* ═══════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════ */
function showToast(msg, type) {
  var t = document.getElementById('__qsc_toast__');
  if (!t) {
    t = document.createElement('div');
    t.id = '__qsc_toast__';
    t.style.cssText = 'position:fixed;bottom:28px;right:28px;z-index:999999;font-family:system-ui,sans-serif;font-size:14px;padding:13px 22px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.18);transition:opacity 0.35s;max-width:360px;pointer-events:none;';
    document.body.appendChild(t);
  }
  clearTimeout(t._tmr);
  t.style.background = (type==='error')?'#fef2f2':(type==='warning'?'#fffbeb':'#f0fdf4');
  t.style.color      = (type==='error')?'#b91c1c':(type==='warning'?'#92400e':'#15803d');
  t.style.border     = '1.5px solid '+((type==='error')?'#fca5a5':(type==='warning'?'#fde68a':'#86efac'));
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.display = 'block';
  t._tmr = setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.style.display='none'; },350); }, 3500);
}
window.__qscToast = showToast;

function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('qsc_current_user')||'null'); } catch(e){ return null; }
}
function getUsers() {
  try { return JSON.parse(localStorage.getItem('qsc_users')||'[]'); } catch(e){ return []; }
}
function saveUsers(arr) {
  localStorage.setItem('qsc_users', JSON.stringify(arr));
}
function getScoreSheets() {
  try { return JSON.parse(localStorage.getItem('qsc_score_sheets')||'[]'); } catch(e){ return []; }
}
function saveScoreSheets(arr) {
  localStorage.setItem('qsc_score_sheets', JSON.stringify(arr));
}
function getStudentNames() {
  try { return JSON.parse(localStorage.getItem('qsc_student_names')||'[]'); } catch(e){ return []; }
}
function saveStudentNames(arr) {
  localStorage.setItem('qsc_student_names', JSON.stringify(arr));
}
function getReports() {
  try { return JSON.parse(localStorage.getItem('qsc_reports')||'[]'); } catch(e){ return []; }
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function calcGrade(total) {
  if (total>=80) return 'A1'; if (total>=70) return 'B2'; if (total>=65) return 'B3';
  if (total>=60) return 'C4'; if (total>=55) return 'C5'; if (total>=50) return 'C6';
  if (total>=45) return 'D7'; if (total>=40) return 'E8'; return 'F9';
}
function gradeRemarks(g) {
  return {A1:'Excellent',B2:'Very Good',B3:'Good',C4:'Credit',C5:'Credit',C6:'Credit',D7:'Pass',E8:'Pass',F9:'Fail'}[g]||'';
}

/* ═══════════════════════════════════════════════════
   FIX: updateUserCredentials must also update qsc_current_user
   so that login works after admin changes credentials.
   We patch localStorage.setItem to intercept qsc_users saves
   and keep qsc_current_user in sync when the current user's
   own record is modified.
═══════════════════════════════════════════════════ */
var _appReady = false;
window.addEventListener('load', function(){ setTimeout(function(){ _appReady=true; }, 900); });
var _prevUsers = localStorage.getItem('qsc_users');

// Intercept setItem for live reactive updates
var _setItemOrig = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  _setItemOrig(key, value);

  // When qsc_users changes: sync current user's session data to match new credentials
  if (key === 'qsc_users') {
    try {
      var updatedUsers = JSON.parse(value || '[]');
      var currentUser  = getCurrentUser();
      if (currentUser) {
        // Find user by id (id is stable; username may have changed)
        var match = updatedUsers.find(function(u){
          return u.id === currentUser.id || u.username === currentUser.username;
        });
        if (match) {
          // Silently update qsc_current_user so the in-memory session stays fresh
          _setItemOrig('qsc_current_user', JSON.stringify(match));
        }
      }
    } catch(e){}

    if (_appReady && value !== _prevUsers) {
      _prevUsers = value;
      showToast('User credentials updated successfully!', 'success');
    }
  }

  // Live-update the admin score-sheet panel when score sheets change
  if (key === 'qsc_score_sheets') {
    var p = document.getElementById('__qsc_ss_admin_panel__');
    if (p) renderSubmittedSheets(p);
    // Also refresh staff generate-report view if visible
    var gp = document.getElementById('__qsc_staff_generate_panel__');
    if (gp) renderStaffGeneratePanel(gp);
  }
};

/* ═══════════════════════════════════════════════════
   MUTATION OBSERVER — re-patches on every React re-render
═══════════════════════════════════════════════════ */
var _obs = new MutationObserver(function(){
  patchManageUsers();
  patchScoreSheetModal();
  patchCreateReport();
  patchAdminReports();
  patchStaffDashboard();
  patchStaffDetailsForm();
  patchAdminLogoUpload();
  patchStaffReportAccess();
  patchStaffGenerateReport();
});
document.addEventListener('DOMContentLoaded', function(){
  _obs.observe(document.body, { childList:true, subtree:true });
});

/* ═══════════════════════════════════════════════════
   STAFF DASHBOARD — Student Names panel
═══════════════════════════════════════════════════ */
function patchStaffDashboard() {
  var user = getCurrentUser();
  if (!user || user.role !== 'staff') return;

  var h2s = document.querySelectorAll('h2,h3');
  var scoreHeading = null;
  for (var i=0; i<h2s.length; i++) {
    var txt = h2s[i].textContent.trim();
    if (txt === 'Score Sheets' || txt === 'My Score Sheets' || txt === 'Create Score Sheet') {
      scoreHeading = h2s[i]; break;
    }
  }
  if (!scoreHeading) return;

  var container = scoreHeading.parentElement;
  if (!container) return;
  for (var up=0; up<3; up++) {
    if (container.parentElement && container.parentElement !== document.body) {
      container = container.parentElement; break;
    }
  }
  if (container.dataset.qscSnPatched) return;
  container.dataset.qscSnPatched = 'true';

  var panel = document.createElement('div');
  panel.id = '__qsc_sn_panel__';
  panel.style.cssText = 'background:#fff;border:1.5px solid #e5e7eb;border-radius:14px;padding:22px 24px;margin-bottom:24px;box-shadow:0 1px 4px rgba(0,0,0,0.06);';
  renderStudentNamesPanel(panel);
  container.insertBefore(panel, container.firstChild);
}

function renderStudentNamesPanel(panel) {
  var names = getStudentNames();
  panel.innerHTML = [
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">',
    '<h3 style="font-size:16px;font-weight:700;color:#111;margin:0;">Student Names</h3>',
    '<button id="__qsc_sn_add_btn__" style="background:#003087;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">+ Add Name</button>',
    '</div>',
    '<div id="__qsc_sn_add_row__" style="display:none;margin-bottom:12px;flex-wrap:wrap;gap:8px;align-items:center;">',
    '<input id="__qsc_sn_input__" type="text" placeholder="Enter student name\u2026" style="flex:1;min-width:180px;padding:9px 13px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;font-family:system-ui,sans-serif;outline:none;" />',
    '<button id="__qsc_sn_save__" style="background:#16a34a;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Save</button>',
    '<button id="__qsc_sn_cancel__" style="background:#f3f4f6;color:#374151;border:1.5px solid #d1d5db;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Cancel</button>',
    '</div>',
    names.length===0
      ? '<p style="color:#9ca3af;font-size:13px;margin:0;">No student names saved yet. Click \u201c+ Add Name\u201d to start.</p>'
      : '<ul id="__qsc_sn_list__" style="list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px;">' +
        names.map(function(n,idx){
          return '<li style="display:inline-flex;align-items:center;gap:6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;padding:5px 12px;font-size:13px;color:#1e40af;font-family:system-ui,sans-serif;">'
            + escHtml(n)
            + '<button data-sn-del="'+idx+'" style="background:none;border:none;cursor:pointer;color:#6b7280;font-size:14px;line-height:1;padding:0;margin-left:2px;">&times;</button>'
            + '</li>';
        }).join('')
        + '</ul>',
  ].join('');

  var addBtn    = document.getElementById('__qsc_sn_add_btn__');
  var addRow    = document.getElementById('__qsc_sn_add_row__');
  var inp       = document.getElementById('__qsc_sn_input__');
  var saveBtn   = document.getElementById('__qsc_sn_save__');
  var cancelBtn = document.getElementById('__qsc_sn_cancel__');

  if (addBtn && addRow)    { addBtn.onclick    = function(){ addRow.style.display='flex'; if(inp) inp.focus(); }; }
  if (cancelBtn && addRow) { cancelBtn.onclick = function(){ addRow.style.display='none'; if(inp) inp.value=''; }; }
  if (saveBtn && inp) {
    saveBtn.onclick = function(){
      var val = inp.value.trim();
      if (!val) return;
      var names2 = getStudentNames();
      if (!names2.includes(val)) { names2.push(val); saveStudentNames(names2); showToast('Student name saved!','success'); }
      inp.value = ''; if (addRow) addRow.style.display='none';
      renderStudentNamesPanel(panel);
    };
    inp.addEventListener('keydown', function(e){ if(e.key==='Enter') saveBtn.click(); });
  }
  var list = document.getElementById('__qsc_sn_list__');
  if (list) {
    list.onclick = function(e){
      var btn = e.target.closest('[data-sn-del]'); if(!btn) return;
      var idx = parseInt(btn.getAttribute('data-sn-del'));
      var names3 = getStudentNames(); names3.splice(idx,1); saveStudentNames(names3);
      renderStudentNamesPanel(panel); showToast('Name removed.','warning');
    };
  }
}

/* ═══════════════════════════════════════════════════
   STAFF DETAILS FORM — toast on save
═══════════════════════════════════════════════════ */
function patchStaffDetailsForm() {
  document.querySelectorAll('button').forEach(function(btn){
    if (btn.dataset.qscStaffSavePatched) return;
    var txt = btn.textContent.trim().toLowerCase();
    if ((txt==='save changes'||txt==='update profile'||txt==='save profile'||txt==='update details'||txt==='save') && btn.closest('form,section,div')) {
      var container = btn.closest('form,section,div'); if (!container) return;
      var isStaffForm = false;
      container.querySelectorAll('label').forEach(function(l){
        if (l.textContent.toLowerCase().includes('display name')||l.textContent.toLowerCase().includes('username')) isStaffForm=true;
      });
      if (!isStaffForm) return;
      btn.dataset.qscStaffSavePatched = 'true';
      btn.addEventListener('click', function(){ setTimeout(function(){ showToast('Staff details updated successfully!','success'); },300); });
    }
  });
}

/* ═══════════════════════════════════════════════════
   MANAGE USERS — Add User + Search + Delete
═══════════════════════════════════════════════════ */
function patchManageUsers() {
  var h2s = document.querySelectorAll('h2');
  var heading = null;
  for (var i=0; i<h2s.length; i++){
    if (h2s[i].textContent.trim()==='Manage User Credentials') { heading=h2s[i]; break; }
  }
  if (!heading) return;
  var container = heading.parentElement;
  if (!container || container.dataset.qscMuPatched) return;
  container.dataset.qscMuPatched = 'true';

  // ── Add User button ──
  var addBtn = document.createElement('button');
  addBtn.textContent = '+ Add User';
  addBtn.style.cssText = 'background:#003087;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px;font-family:system-ui,sans-serif;display:block;';
  addBtn.onmouseover = function(){ this.style.background='#004cc7'; };
  addBtn.onmouseout  = function(){ this.style.background='#003087'; };
  addBtn.onclick = function(){ showAddUserModal(); };
  container.insertBefore(addBtn, heading.nextSibling);

  // ── Search box ──
  var searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'margin-bottom:14px;';
  searchWrap.innerHTML = '<input id="__qsc_user_search__" type="text" placeholder="Search users by name or username\u2026" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:system-ui,sans-serif;outline:none;" />';
  container.insertBefore(searchWrap, addBtn.nextSibling);

  // Live search filter
  setInterval(function(){
    var inp = document.getElementById('__qsc_user_search__'); if(!inp) return;
    var q = inp.value.toLowerCase();
    container.querySelectorAll('.bg-white.border.border-gray-200.rounded-xl,.bg-white.rounded-xl').forEach(function(card){
      if (card.id && card.id.startsWith('__qsc_')) return;
      card.style.display = (!q || card.textContent.toLowerCase().includes(q)) ? '' : 'none';
    });
  }, 400);

  // ── Inject Delete buttons into existing user cards ──
  injectDeleteButtons(container);
}

function injectDeleteButtons(container) {
  var currentUser = getCurrentUser();
  // Find all user cards (they contain an Edit button)
  container.querySelectorAll('.bg-white.border.border-gray-200.rounded-xl,.bg-white.rounded-xl').forEach(function(card){
    if (card.id && card.id.startsWith('__qsc_')) return;
    if (card.dataset.qscDelInjected) return;
    card.dataset.qscDelInjected = 'true';

    // Get username from the card — try mono text first, then pattern match
    var usernameEl = card.querySelector('[class*="mono"],[class*="font-mono"],.font-mono');
    var username = usernameEl ? usernameEl.textContent.trim() : '';
    if (!username) {
      var match = card.textContent.match(/Username:\s*(\S+)/i);
      if (match) username = match[1];
    }
    // Don't add delete button for the current user's own card
    if (!username || (currentUser && username === currentUser.username)) return;

    // Find the button row
    var btnRow = card.querySelector('[class*="flex"][class*="gap"]');
    if (!btnRow) btnRow = card.querySelector('button') ? card.querySelector('button').parentElement : null;
    if (!btnRow) return;

    var delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.setAttribute('data-del-username', username);
    delBtn.style.cssText = 'background:#fef2f2;color:#b91c1c;border:1.5px solid #fca5a5;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;margin-left:6px;';
    delBtn.onmouseover = function(){ this.style.background='#fee2e2'; };
    delBtn.onmouseout  = function(){ this.style.background='#fef2f2'; };
    delBtn.onclick = function(){
      var uname = this.getAttribute('data-del-username');
      if (!confirm('Delete user "'+uname+'"? This cannot be undone.')) return;
      var users = getUsers().filter(function(u){ return u.username !== uname; });
      saveUsers(users);
      card.remove();
      showToast('User "'+uname+'" deleted.','warning');
      window.dispatchEvent(new StorageEvent('storage', { key:'qsc_users' }));
    };
    btnRow.appendChild(delBtn);
  });
}

function showAddUserModal() {
  var old = document.getElementById('__qsc_au_modal__'); if(old) old.remove();
  function field(lbl, id, type, ph) {
    return '<div style="margin-bottom:14px;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#333;">'+lbl+'</label><input id="'+id+'" type="'+type+'" placeholder="'+ph+'" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:system-ui,sans-serif;" /></div>';
  }
  var modal = document.createElement('div');
  modal.id = '__qsc_au_modal__';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';
  modal.innerHTML = [
    '<div style="background:#fff;border-radius:16px;padding:32px;width:440px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">',
    '<h3 style="font-size:18px;font-weight:700;margin:0 0 20px;color:#111;">Add New User</h3>',
    '<div id="__qsc_au_err__" style="display:none;background:#fef2f2;border:1px solid #fca5a5;color:#b91c1c;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:14px;"></div>',
    field('Display Name','__au_dn__','text','e.g. John Doe'),
    field('Username *','__au_un__','text','unique username'),
    field('Password *','__au_pw__','password','password'),
    '<div style="margin-bottom:20px;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#333;">Role *</label>',
    '<select id="__au_role__" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:system-ui,sans-serif;"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>',
    '<div style="display:flex;gap:12px;">',
    '<button id="__au_ok__" style="flex:1;background:#003087;color:#fff;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Add User</button>',
    '<button id="__au_cancel__" style="flex:1;background:#f3f4f6;color:#333;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Cancel</button>',
    '</div></div>'
  ].join('');
  document.body.appendChild(modal);
  document.getElementById('__au_cancel__').onclick = function(){ modal.remove(); };
  modal.onclick = function(e){ if(e.target===modal) modal.remove(); };
  document.getElementById('__au_ok__').onclick = function(){
    var dn   = document.getElementById('__au_dn__').value.trim();
    var un   = document.getElementById('__au_un__').value.trim();
    var pw   = document.getElementById('__au_pw__').value.trim();
    var role = document.getElementById('__au_role__').value;
    var err  = document.getElementById('__qsc_au_err__');
    err.style.display = 'none';
    if (!un||!pw){ err.textContent='Username and password are required.'; err.style.display='block'; return; }
    var users = getUsers();
    if (users.find(function(u){ return u.username===un; })){
      err.textContent='Username already exists.'; err.style.display='block'; return;
    }
    users.push({ id:'u_'+Date.now(), username:un, password:pw, displayName:dn||un, role:role });
    saveUsers(users);
    modal.remove();
    showToast('User "'+(dn||un)+'" added successfully!','success');
    window.dispatchEvent(new StorageEvent('storage', { key:'qsc_users' }));
  };
}

/* ═══════════════════════════════════════════════════
   SCORE SHEET MODAL — A4, save/submit, name dropdown
═══════════════════════════════════════════════════ */
function patchScoreSheetModal() {
  var h2s = document.querySelectorAll('h2');
  var heading = null;
  for (var i=0; i<h2s.length; i++){
    if (h2s[i].textContent.trim()==='Create Score Sheet') { heading=h2s[i]; break; }
  }
  if (!heading) return;
  var modal = heading.closest('.bg-white.rounded-2xl') || heading.closest('[class*="bg-white"]') || heading.closest('[class*="shadow"]');
  if (!modal || modal.dataset.qscSsPatched) return;
  modal.dataset.qscSsPatched = 'true';
  modal.style.width = '210mm'; modal.style.maxWidth = '210mm';
  modal.style.minHeight = '297mm'; modal.style.boxSizing = 'border-box';
  injectStudentNameDropdowns(modal);
  var btns = modal.querySelectorAll('button');
  var printBtn = null;
  for (var i=0; i<btns.length; i++){
    var t = btns[i].textContent.trim().toLowerCase();
    if (t.includes('print')||t.includes('export')) { printBtn=btns[i]; break; }
  }
  if (!printBtn) return;
  var row = printBtn.parentElement;
  if (!row || row.dataset.qscSsBtnPatched) return;
  row.dataset.qscSsBtnPatched = 'true';
  var draftBtn = document.createElement('button');
  draftBtn.textContent = 'Save as Draft'; draftBtn.type = 'button';
  draftBtn.style.cssText = 'background:#f3f4f6;color:#374151;border:1.5px solid #d1d5db;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;';
  draftBtn.onclick = function(){ captureAndSaveSheet(modal,'draft'); };
  row.insertBefore(draftBtn, printBtn);
  var submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit to Admin'; submitBtn.type = 'button';
  submitBtn.style.cssText = 'background:#16a34a;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;';
  submitBtn.onclick = function(){ captureAndSaveSheet(modal,'submitted'); };
  row.insertBefore(submitBtn, printBtn);
}

function injectStudentNameDropdowns(modal) {
  var names = getStudentNames(); if (!names.length) return;
  modal.querySelectorAll('tbody tr').forEach(function(tr){
    if (tr.dataset.qscSnDropdown) return;
    var inputs = tr.querySelectorAll('input');
    var nameInput = null;
    inputs.forEach(function(inp){ if (inp.placeholder && inp.placeholder.toLowerCase().includes('name')) nameInput=inp; });
    if (!nameInput && inputs.length>1) nameInput=inputs[1];
    else if (!nameInput && inputs.length>0) nameInput=inputs[0];
    if (!nameInput) return;
    tr.dataset.qscSnDropdown = 'true';
    var dlId = '__qsc_sn_dl_'+Math.random().toString(36).slice(2)+'__';
    var dl = document.createElement('datalist'); dl.id = dlId;
    names.forEach(function(n){ var opt=document.createElement('option'); opt.value=n; dl.appendChild(opt); });
    nameInput.setAttribute('list',dlId); nameInput.setAttribute('autocomplete','off');
    nameInput.parentNode.appendChild(dl);
  });
}

function captureAndSaveSheet(modal, status) {
  var labels = modal.querySelectorAll('label');
  function getFieldVal(labelText) {
    for (var i=0; i<labels.length; i++){
      if (labels[i].textContent.trim()===labelText) {
        var sib = labels[i].nextElementSibling;
        if (sib) return (sib.tagName==='SELECT' ? sib.options[sib.selectedIndex].text : sib.value)||'';
      }
    }
    return '';
  }
  var rows = [];
  modal.querySelectorAll('tbody tr').forEach(function(tr){
    var inp = tr.querySelectorAll('input');
    if (inp.length>=3) {
      rows.push({ no:rows.length+1, studentName:inp[0].value||inp[1]&&inp[1].value||'', classScore:inp[inp.length-2]?inp[inp.length-2].value:'', exam100:inp[inp.length-1]?inp[inp.length-1].value:'' });
    }
  });
  var user = getCurrentUser(); var now = new Date().toISOString();
  var sheet = {
    id:'ss_'+Date.now(), title:getFieldVal('Sheet Title')||('Score Sheet '+new Date().toLocaleDateString()),
    subject:getFieldVal('Subject'), class:getFieldVal('Class'), term:getFieldVal('Term'), academicYear:getFieldVal('Academic Year'),
    rows:rows, status:status, staffUsername:user?user.username:'', staffName:user?(user.displayName||user.username):'',
    createdAt:now, submittedAt:status==='submitted'?now:null
  };
  var sheets = getScoreSheets(); sheets.push(sheet); saveScoreSheets(sheets);
  if (status==='draft') { showToast('Score sheet saved as draft!','success'); }
  else {
    showToast('Score sheet submitted to admin!','success');
    var closeBtn = null; var allBtns = modal.querySelectorAll('button');
    for (var i=0; i<allBtns.length; i++){
      if (allBtns[i].querySelector('svg')||allBtns[i].textContent.trim()==='\u2715'||allBtns[i].getAttribute('aria-label')==='Close') { closeBtn=allBtns[i]; break; }
    }
    if (closeBtn) setTimeout(function(){ closeBtn.click(); },250);
  }
}

/* ═══════════════════════════════════════════════════
   CREATE REPORT (staff) — remove Grade col, student
   dropdown from saved names + score sheets, auto-fill
═══════════════════════════════════════════════════ */
function patchCreateReport() {
  var user = getCurrentUser();
  if (!user || user.role !== 'staff') return;
  var h2s = document.querySelectorAll('h2');
  var heading = null;
  for (var i=0; i<h2s.length; i++){
    var txt = h2s[i].textContent.trim();
    if (txt==='Create Report'||txt==='Generate Report'||txt==='Create Report Card') { heading=h2s[i]; break; }
  }
  if (!heading) return;
  var modal = heading.closest('[style*="position: fixed"]')||heading.closest('[style*="position:fixed"]')||heading.closest('.fixed')||heading.closest('[class*="fixed"]')||heading.parentElement;
  if (!modal || modal.dataset.qscCrPatched) return;
  modal.dataset.qscCrPatched = 'true';
  removeGradeColumn(modal);
  injectStudentNameFieldDropdown(modal);
  wireScoreSheetAutoFill(modal);
}

function removeGradeColumn(container) {
  var gradeColIdx = -1;
  container.querySelectorAll('th').forEach(function(th, idx){
    if (th.textContent.trim().toLowerCase()==='grade') { th.style.display='none'; gradeColIdx=idx; }
  });
  if (gradeColIdx<0) return;
  container.querySelectorAll('tbody tr, tr').forEach(function(tr){
    var tds = tr.querySelectorAll('td');
    if (tds[gradeColIdx]) tds[gradeColIdx].style.display='none';
  });
}

function injectStudentNameFieldDropdown(modal) {
  modal.querySelectorAll('label').forEach(function(lbl){
    var lblTxt = lbl.textContent.trim().toLowerCase();
    if (lblTxt!=='student name'&&lblTxt!=="student's name"&&lblTxt!=='name of student') return;
    var inp = lbl.nextElementSibling;
    if (!inp||inp.tagName!=='INPUT') { var parent=lbl.parentElement; if(parent) inp=parent.querySelector('input'); }
    if (!inp||inp.tagName!=='INPUT'||inp.dataset.qscSnDl) return;
    inp.dataset.qscSnDl = 'true';

    // Combine saved names + names from approved/submitted score sheets
    var savedNames = getStudentNames();
    var sheetNames = [];
    getScoreSheets().filter(function(s){ return s.status==='submitted'||s.status==='approved'; }).forEach(function(sheet){
      (sheet.rows||[]).forEach(function(row){
        if (row.studentName && sheetNames.indexOf(row.studentName)===-1) sheetNames.push(row.studentName);
      });
    });
    var allNames = savedNames.slice();
    sheetNames.forEach(function(n){ if (allNames.indexOf(n)===-1) allNames.push(n); });

    var dlId = '__qsc_cr_sn_dl__';
    var existing = document.getElementById(dlId); if(existing) existing.remove();
    var dl = document.createElement('datalist'); dl.id=dlId;
    allNames.forEach(function(n){ var opt=document.createElement('option'); opt.value=n; dl.appendChild(opt); });
    inp.setAttribute('list',dlId); inp.setAttribute('autocomplete','off');
    inp.parentNode.appendChild(dl);
  });
}

function wireScoreSheetAutoFill(modal) {
  modal.querySelectorAll('label').forEach(function(lbl){
    var lblTxt = lbl.textContent.trim().toLowerCase();
    if (lblTxt!=='student name'&&lblTxt!=="student's name"&&lblTxt!=='name of student') return;
    var inp = lbl.nextElementSibling;
    if (!inp||inp.tagName!=='INPUT') { var parent=lbl.parentElement; if(parent) inp=parent.querySelector('input'); }
    if (!inp||inp.tagName!=='INPUT'||inp.dataset.qscAfWired) return;
    inp.dataset.qscAfWired = 'true';
    inp.addEventListener('change', function(){
      var studentName = inp.value.trim(); if(!studentName) return;
      autoFillFromScoreSheets(modal, studentName);
    });
    inp.addEventListener('input', function(){
      var studentName = inp.value.trim(); if(!studentName) return;
      if (getStudentNames().indexOf(studentName)!==-1) autoFillFromScoreSheets(modal,studentName);
    });
  });
}

function autoFillFromScoreSheets(modal, studentName) {
  var matched = [];
  getScoreSheets().filter(function(s){ return s.status==='submitted'||s.status==='approved'; }).forEach(function(sheet){
    (sheet.rows||[]).forEach(function(row){
      if ((row.studentName||'').toLowerCase()===studentName.toLowerCase()) {
        matched.push({ subject:sheet.subject, classScore:row.classScore, exam100:row.exam100 });
      }
    });
  });
  if (!matched.length) return;
  var trs = modal.querySelectorAll('tbody tr');
  matched.forEach(function(m, idx){
    var tr = trs[idx]; if(!tr) return;
    var inputs = tr.querySelectorAll('input'); var selects = tr.querySelectorAll('select');
    if (selects.length>0) {
      for (var s=0; s<selects.length; s++) {
        var sel=selects[s];
        for (var o=0; o<sel.options.length; o++) {
          if (sel.options[o].text===m.subject||sel.options[o].value===m.subject) { sel.selectedIndex=o; sel.dispatchEvent(new Event('change',{bubbles:true})); break; }
        }
      }
    }
    if (inputs[0]&&!selects.length) { inputs[0].value=m.subject||''; inputs[0].dispatchEvent(new Event('input',{bubbles:true})); }
    if (inputs.length>=2) { inputs[inputs.length-2].value=m.classScore||''; inputs[inputs.length-2].dispatchEvent(new Event('input',{bubbles:true})); }
    if (inputs.length>=1) { inputs[inputs.length-1].value=m.exam100||''; inputs[inputs.length-1].dispatchEvent(new Event('input',{bubbles:true})); }
  });
  showToast('Score data auto-filled from submitted score sheets!','success');
}

/* ═══════════════════════════════════════════════════
   ADMIN GENERATE REPORT — Grade→Position
═══════════════════════════════════════════════════ */
function patchAdminReports() {
  var user = getCurrentUser();
  if (!user||user.role!=='admin') return;
  document.querySelectorAll('h2,h3').forEach(function(h2){
    var txt = h2.textContent.trim();
    if (txt!=='Student Reports'&&txt!=='Generate Reports'&&txt!=='Reports'&&txt!=='Report Cards') return;
    var container = h2.closest('[class*="p-"]')||h2.closest('[class*="bg-white"]')||h2.parentElement;
    if (!container) return;
    container.querySelectorAll('th').forEach(function(th){
      if (th.textContent.trim().toLowerCase()==='grade'&&!th.dataset.qscGrReplaced) { th.dataset.qscGrReplaced='true'; th.textContent='Position'; }
    });
  });
  patchSubmittedScoreSheets();
}

/* ═══════════════════════════════════════════════════
   SUBMITTED SCORE SHEETS — admin review panel
═══════════════════════════════════════════════════ */
function patchSubmittedScoreSheets() {
  var user = getCurrentUser(); if (!user||user.role!=='admin') return;
  var h2s = document.querySelectorAll('h2,h3');
  var reportsH2 = null;
  for (var i=0; i<h2s.length; i++){
    var txt = h2s[i].textContent.trim();
    if (txt==='Student Reports'||txt==='Reports'||txt==='Generate Reports'||txt==='Report Cards') { reportsH2=h2s[i]; break; }
  }
  if (!reportsH2) return;
  var reportsSection = reportsH2.parentElement;
  for (var up=0; up<5; up++){
    if (reportsSection&&reportsSection.children.length>=2) break;
    reportsSection = reportsSection?reportsSection.parentElement:null;
  }
  if (!reportsSection) reportsSection = reportsH2.parentElement;
  if (!reportsSection||reportsSection.dataset.qscSsAdminPatched) return;
  reportsSection.dataset.qscSsAdminPatched = 'true';
  var panel = document.createElement('div');
  panel.id = '__qsc_ss_admin_panel__'; panel.style.cssText = 'margin-top:32px;';
  reportsSection.appendChild(panel);
  renderSubmittedSheets(panel);
}

function renderSubmittedSheets(panel) {
  var sheets = getScoreSheets().filter(function(s){ return s.status==='submitted'||s.status==='approved'; });
  panel.innerHTML = '';
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
  hdr.innerHTML = '<h2 style="font-size:18px;font-weight:700;color:#111;margin:0;">Submitted Score Sheets</h2>';
  panel.appendChild(hdr);
  if (!sheets.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:48px 0;color:#9ca3af;';
    empty.innerHTML = '<div style="font-size:36px;margin-bottom:10px;">&#x1F4CA;</div><p style="font-weight:600;font-family:system-ui,sans-serif;">No submitted score sheets yet</p>';
    panel.appendChild(empty); return;
  }
  sheets.forEach(function(sheet){
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.06);margin-bottom:12px;';
    var d = new Date(sheet.submittedAt||sheet.createdAt);
    var dateStr = d.toLocaleDateString()+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    card.innerHTML = [
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;">',
      '<div>',
      '<h3 style="font-size:15px;font-weight:700;color:#111;margin:0 0 4px;font-family:system-ui,sans-serif;">'+escHtml(sheet.title||'Untitled')+'</h3>',
      '<div style="font-size:13px;color:#6b7280;display:flex;flex-wrap:wrap;gap:12px;margin-top:4px;font-family:system-ui,sans-serif;">',
      '<span>Subject: <strong style="color:#374151;">'+escHtml(sheet.subject||'\u2014')+'</strong></span>',
      '<span>Class: <strong style="color:#374151;">'+escHtml(sheet.class||'\u2014')+'</strong></span>',
      '<span>Term: <strong style="color:#374151;">'+escHtml(sheet.term||'\u2014')+'</strong></span>',
      '<span>By: <strong style="color:#374151;">'+escHtml(sheet.staffName||sheet.staffUsername||'\u2014')+'</strong></span>',
      '<span>Submitted: <strong style="color:#374151;">'+dateStr+'</strong></span>',
      '</div></div>',
      '<div style="display:flex;gap:8px;margin-left:12px;flex-shrink:0;">',
      (sheet.status==='submitted'
        ? '<button data-ss-approve="'+sheet.id+'" style="background:#16a34a;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Approve</button>'
        : '<span style="background:#dcfce7;color:#15803d;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;font-family:system-ui,sans-serif;">\u2713 Approved</span>'),
      '<button data-ss-print="'+sheet.id+'" style="background:#003087;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Print</button>',
      '<button data-ss-delete="'+sheet.id+'" style="background:#fef2f2;color:#b91c1c;border:1.5px solid #fca5a5;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Delete</button>',
      '</div></div>',
      sheet.rows&&sheet.rows.length ? '<div style="font-size:12px;color:#9ca3af;margin-top:10px;padding-top:10px;border-top:1px solid #f3f4f6;font-family:system-ui,sans-serif;">'+sheet.rows.filter(function(r){return r.studentName;}).length+' student records</div>' : ''
    ].join('');
    panel.appendChild(card);
  });
  panel.onclick = function(e){
    var target = e.target.closest ? e.target.closest('[data-ss-print],[data-ss-delete],[data-ss-approve]') : e.target;
    if (!target) return;
    var printId   = target.getAttribute('data-ss-print');
    var deleteId  = target.getAttribute('data-ss-delete');
    var approveId = target.getAttribute('data-ss-approve');
    if (printId)   printScoreSheet(printId);
    if (deleteId)  deleteScoreSheet(deleteId, panel);
    if (approveId) approveScoreSheet(approveId, panel);
  };
}

function printScoreSheet(id) {
  var sheet = getScoreSheets().find(function(s){ return s.id===id; }); if(!sheet) return;
  var rows = (sheet.rows||[]).map(function(r,idx){
    var cs=parseFloat(r.classScore)||0, e100=parseFloat(r.exam100)||0;
    var e70=Math.round(e100/100*70*10)/10;
    var total=(r.classScore!==''||r.exam100!=='') ? Math.round((cs+e70)*10)/10 : '';
    var grade=total!=='' ? calcGrade(total) : ''; var remarks=grade?gradeRemarks(grade):'';
    return '<tr><td>'+(idx+1)+'</td><td style="text-align:left">'+escHtml(r.studentName||'')+'</td><td>'+cs+'</td><td>'+e100+'</td><td>'+e70+'</td><td style="font-weight:700">'+(total!==''?total:'')+'</td><td>'+grade+'</td><td>'+remarks+'</td></tr>';
  }).join('');
  var w=window.open('','_blank'); if(!w) return;
  w.document.write([
    '<!DOCTYPE html><html><head><title>Score Sheet</title>',
    '<style>@page{size:A4 landscape;margin:10mm;}body{font-family:Arial,sans-serif;font-size:10px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #555;padding:3px 5px;text-align:center;}th{background:#dce8f5;}td:nth-child(2){text-align:left;}</style></head><body>',
    '<h2>'+escHtml(sheet.title||'Score Sheet')+'</h2>',
    '<p><strong>Subject:</strong> '+escHtml(sheet.subject||'')+' &nbsp; <strong>Class:</strong> '+escHtml(sheet.class||'')+' &nbsp; <strong>Term:</strong> '+escHtml(sheet.term||'')+' &nbsp; <strong>Staff:</strong> '+escHtml(sheet.staffName||sheet.staffUsername||'')+'</p>',
    '<table><thead><tr><th>#</th><th>Student Name</th><th>Class Score (30%)</th><th>Exam Score (100%)</th><th>Exam Score (70%)</th><th>Total</th><th>Grade</th><th>Remarks</th></tr></thead>',
    '<tbody>'+rows+'</tbody></table></body></html>'
  ].join(''));
  w.document.close(); setTimeout(function(){ w.focus(); w.print(); },500);
}

function deleteScoreSheet(id, panel) {
  if (!confirm('Delete this score sheet?')) return;
  saveScoreSheets(getScoreSheets().filter(function(s){ return s.id!==id; }));
  renderSubmittedSheets(panel); showToast('Score sheet deleted.','warning');
}

function approveScoreSheet(id, panel) {
  var sheets = getScoreSheets();
  for (var i=0; i<sheets.length; i++) {
    if (sheets[i].id===id) { sheets[i].status='approved'; sheets[i].approvedAt=new Date().toISOString(); break; }
  }
  saveScoreSheets(sheets); renderSubmittedSheets(panel);
  showToast('Score sheet approved! Staff can now generate reports.','success');
}

/* ═══════════════════════════════════════════════════
   ADMIN LOGO UPLOAD
═══════════════════════════════════════════════════ */
function patchAdminLogoUpload() {
  var user = getCurrentUser(); if (!user||user.role!=='admin') return;
  var settingsHeading = null;
  document.querySelectorAll('h2,h3').forEach(function(h){
    var txt = h.textContent.trim();
    if (!settingsHeading && (txt==='Report Template'||txt==='School Settings'||txt==='Report Settings'||txt==='Template Settings'||txt==='Customize Report')) settingsHeading=h;
  });
  if (!settingsHeading) return;
  var settingsContainer = settingsHeading.closest('[class*="bg-white"]')||settingsHeading.closest('[class*="p-"]')||settingsHeading.parentElement;
  if (!settingsContainer||settingsContainer.dataset.qscLogoPatched) return;
  var emailLabel = null;
  settingsContainer.querySelectorAll('label').forEach(function(l){
    var lt = l.textContent.trim().toLowerCase();
    if (lt.includes('email')||lt.includes('e-mail')) emailLabel=l;
  });
  if (!emailLabel) return;
  settingsContainer.dataset.qscLogoPatched = 'true';
  var logoPanel = document.createElement('div');
  logoPanel.id = '__qsc_logo_panel__';
  logoPanel.style.cssText = 'margin:16px 0;padding:16px;border:1.5px dashed #d1d5db;border-radius:12px;background:#f9fafb;';
  function renderLogoPanel() {
    var currentLogo = localStorage.getItem('qsc_school_logo')||'';
    logoPanel.innerHTML = [
      '<label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">School Logo</label>',
      currentLogo ? '<div style="margin-bottom:10px;text-align:center;"><img src="'+currentLogo+'" style="max-height:80px;max-width:160px;object-fit:contain;border:1px solid #e5e7eb;border-radius:8px;padding:4px;background:#fff;" /><br/><button id="__qsc_logo_remove__" style="margin-top:6px;background:#fef2f2;color:#b91c1c;border:1.5px solid #fca5a5;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">Remove Logo</button></div>' : '<p style="font-size:12px;color:#9ca3af;margin:0 0 8px;">No logo uploaded.</p>',
      '<input id="__qsc_logo_file__" type="file" accept="image/*" style="font-size:13px;" />'
    ].join('');
    var fi = document.getElementById('__qsc_logo_file__');
    if (fi) { fi.onchange = function(e){ var f=e.target.files[0]; if(!f) return; if(f.size>2*1024*1024){showToast('Logo must be under 2MB.','error');return;} var r=new FileReader(); r.onload=function(ev){localStorage.setItem('qsc_school_logo',ev.target.result);showToast('Logo uploaded!','success');renderLogoPanel();}; r.readAsDataURL(f); }; }
    var rm = document.getElementById('__qsc_logo_remove__');
    if (rm) { rm.onclick = function(){ localStorage.removeItem('qsc_school_logo'); showToast('Logo removed.','warning'); renderLogoPanel(); }; }
  }
  renderLogoPanel();
  var insertAfter = emailLabel.parentElement||emailLabel;
  if (insertAfter.nextSibling) insertAfter.parentNode.insertBefore(logoPanel,insertAfter.nextSibling);
  else insertAfter.parentNode.appendChild(logoPanel);
}

/* ═══════════════════════════════════════════════════
   STAFF REPORT ACCESS GATE
   Staff can only access report generation after admin
   approves at least one of their score sheets.
═══════════════════════════════════════════════════ */
function patchStaffReportAccess() {
  var user = getCurrentUser(); if (!user||user.role!=='staff') return;
  var hasApproved = getScoreSheets().some(function(s){ return s.staffUsername===user.username&&s.status==='approved'; });
  document.querySelectorAll('h2,h3').forEach(function(h){
    var txt = h.textContent.trim();
    if (txt!=='Create Report'&&txt!=='Generate Report'&&txt!=='Create Report Card'&&txt!=='Report Cards'&&txt!=='Reports') return;
    var section = h.closest('[class*="bg-white"]')||h.closest('[class*="p-"]')||h.parentElement;
    if (!section||section.dataset.qscAccessPatched) return;
    if (hasApproved) return; // access granted
    section.dataset.qscAccessPatched = 'true';
    section.querySelectorAll('button').forEach(function(btn){
      var btnTxt = btn.textContent.trim().toLowerCase();
      if (btnTxt.includes('create')||btnTxt.includes('generate')||btnTxt.includes('new report')) {
        btn.disabled=true; btn.style.opacity='0.5'; btn.style.cursor='not-allowed';
        btn.title='Admin must approve a score sheet first';
        btn.onclick=function(e){ e.preventDefault(); e.stopPropagation(); showToast('Wait for admin to approve a score sheet before generating reports.','warning'); return false; };
      }
    });
    if (!section.querySelector('#__qsc_access_msg__')) {
      var msg = document.createElement('div');
      msg.id = '__qsc_access_msg__';
      msg.style.cssText = 'background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:12px 16px;margin-top:12px;font-size:13px;color:#92400e;font-family:system-ui,sans-serif;';
      msg.innerHTML = '<strong>Access Restricted:</strong> Submit your score sheet to admin and wait for approval before generating reports.';
      if (h.nextSibling) h.parentNode.insertBefore(msg,h.nextSibling); else h.parentNode.appendChild(msg);
    }
  });
}

/* ═══════════════════════════════════════════════════
   STAFF GENERATE REPORT — shows admin-saved reports +
   "Import from Score Sheet" button to pull student data
═══════════════════════════════════════════════════ */
function patchStaffGenerateReport() {
  var user = getCurrentUser(); if (!user||user.role!=='staff') return;
  // Only inject if the staff has at least one approved sheet
  var hasApproved = getScoreSheets().some(function(s){ return s.staffUsername===user.username&&s.status==='approved'; });
  if (!hasApproved) return;

  // Find the generate/report section for staff
  var heading = null;
  document.querySelectorAll('h2,h3').forEach(function(h){
    var txt = h.textContent.trim();
    if (!heading && (txt==='Generate Report'||txt==='Create Report'||txt==='Reports'||txt==='Report Cards')) heading=h;
  });
  if (!heading) return;
  var section = heading.closest('[class*="bg-white"]')||heading.closest('[class*="p-"]')||heading.parentElement;
  if (!section||section.dataset.qscStaffGenPatched) return;
  section.dataset.qscStaffGenPatched = 'true';

  // Inject the admin reports panel + import-from-scoresheet panel
  var panel = document.createElement('div');
  panel.id = '__qsc_staff_generate_panel__';
  panel.style.cssText = 'margin-top:24px;';
  section.appendChild(panel);
  renderStaffGeneratePanel(panel);
}

function renderStaffGeneratePanel(panel) {
  var user = getCurrentUser(); if (!user) return;
  var adminReports = getReports(); // admin-saved reports
  var mySheets = getScoreSheets().filter(function(s){ return s.staffUsername===user.username&&(s.status==='submitted'||s.status==='approved'); });
  panel.innerHTML = '';

  // ── Admin saved reports section ──
  var adminHdr = document.createElement('div');
  adminHdr.style.cssText = 'margin-bottom:20px;';
  adminHdr.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:#111;margin:0 0 12px;font-family:system-ui,sans-serif;">Admin Report Templates</h3>';
  if (!adminReports.length) {
    adminHdr.innerHTML += '<p style="font-size:13px;color:#9ca3af;font-family:system-ui,sans-serif;">No report templates saved by admin yet.</p>';
  } else {
    var reportList = document.createElement('div');
    reportList.style.cssText = 'display:grid;gap:10px;';
    adminReports.forEach(function(rpt){
      var card = document.createElement('div');
      card.style.cssText = 'background:#f8fafc;border:1.5px solid #e5e7eb;border-radius:10px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;';
      card.innerHTML = '<div style="font-family:system-ui,sans-serif;"><div style="font-size:14px;font-weight:600;color:#111;">'+escHtml(rpt.studentName||'Report')+'</div><div style="font-size:12px;color:#6b7280;margin-top:2px;">Class: '+escHtml(rpt.class||'')+'  &nbsp; Term: '+escHtml(rpt.term||'')+'  &nbsp; Year: '+escHtml(rpt.academicYear||'')+'</div></div>'+
        '<button data-view-report="'+rpt.id+'" style="background:#003087;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">View</button>';
      reportList.appendChild(card);
    });
    adminHdr.appendChild(reportList);
  }
  panel.appendChild(adminHdr);

  // ── Import from Score Sheet section ──
  var importSection = document.createElement('div');
  importSection.style.cssText = 'border-top:1.5px solid #e5e7eb;padding-top:20px;';
  importSection.innerHTML = '<h3 style="font-size:16px;font-weight:700;color:#111;margin:0 0 12px;font-family:system-ui,sans-serif;">Import Student Results from Score Sheets</h3>';

  if (!mySheets.length) {
    importSection.innerHTML += '<p style="font-size:13px;color:#9ca3af;font-family:system-ui,sans-serif;">No submitted or approved score sheets available.</p>';
  } else {
    importSection.innerHTML += '<p style="font-size:13px;color:#6b7280;margin-bottom:12px;font-family:system-ui,sans-serif;">Select a score sheet to preview and import student results into your report.</p>';
    var sheetList = document.createElement('div');
    sheetList.style.cssText = 'display:grid;gap:10px;';
    mySheets.forEach(function(sheet){
      var d = new Date(sheet.submittedAt||sheet.createdAt);
      var dateStr = d.toLocaleDateString();
      var statusBadge = sheet.status==='approved'
        ? '<span style="background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;">\u2713 Approved</span>'
        : '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;">Submitted</span>';
      var studentCount = (sheet.rows||[]).filter(function(r){return r.studentName;}).length;
      var card = document.createElement('div');
      card.style.cssText = 'background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.05);';
      card.innerHTML = [
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">',
        '<div style="flex:1;font-family:system-ui,sans-serif;">',
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">',
        '<span style="font-size:14px;font-weight:700;color:#111;">'+escHtml(sheet.title||'Score Sheet')+'</span>',
        statusBadge,
        '</div>',
        '<div style="font-size:12px;color:#6b7280;display:flex;flex-wrap:wrap;gap:10px;">',
        '<span>Subject: <strong style="color:#374151;">'+escHtml(sheet.subject||'\u2014')+'</strong></span>',
        '<span>Class: <strong style="color:#374151;">'+escHtml(sheet.class||'\u2014')+'</strong></span>',
        '<span>Term: <strong style="color:#374151;">'+escHtml(sheet.term||'\u2014')+'</strong></span>',
        '<span>Date: <strong style="color:#374151;">'+dateStr+'</strong></span>',
        '<span>Students: <strong style="color:#374151;">'+studentCount+'</strong></span>',
        '</div>',
        '</div>',
        '<button data-import-sheet="'+sheet.id+'" style="background:#003087;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:system-ui,sans-serif;">Import Results</button>',
        '</div>'
      ].join('');
      sheetList.appendChild(card);
    });
    importSection.appendChild(sheetList);
  }
  panel.appendChild(importSection);

  // Wire up interactions
  panel.onclick = function(e) {
    var importBtn = e.target.closest('[data-import-sheet]');
    var viewBtn   = e.target.closest('[data-view-report]');
    if (importBtn) showImportModal(importBtn.getAttribute('data-import-sheet'));
    if (viewBtn)   showReportViewModal(viewBtn.getAttribute('data-view-report'));
  };
}

/* ═══════════════════════════════════════════════════
   IMPORT FROM SCORE SHEET MODAL
   Lets staff select a score sheet and see all student
   results — and use them to pre-fill a Create Report form
═══════════════════════════════════════════════════ */
function showImportModal(sheetId) {
  var sheet = getScoreSheets().find(function(s){ return s.id===sheetId; });
  if (!sheet) return;
  var old = document.getElementById('__qsc_import_modal__'); if(old) old.remove();

  var rows = (sheet.rows||[]).filter(function(r){ return r.studentName; });
  var rowHtml = rows.map(function(r, idx){
    var cs = parseFloat(r.classScore)||0, e100 = parseFloat(r.exam100)||0;
    var e70 = Math.round(e100/100*70*10)/10;
    var total = Math.round((cs+e70)*10)/10;
    var grade = calcGrade(total); var remarks = gradeRemarks(grade);
    return '<tr style="cursor:pointer;" data-student-row="'+idx+'">'
      +'<td style="border:1px solid #e5e7eb;padding:8px 10px;text-align:left;">'+escHtml(r.studentName)+'</td>'
      +'<td style="border:1px solid #e5e7eb;padding:8px 10px;text-align:center;">'+cs+'</td>'
      +'<td style="border:1px solid #e5e7eb;padding:8px 10px;text-align:center;">'+e100+'</td>'
      +'<td style="border:1px solid #e5e7eb;padding:8px 10px;text-align:center;">'+e70+'</td>'
      +'<td style="border:1px solid #e5e7eb;padding:8px 10px;text-align:center;font-weight:700;">'+total+'</td>'
      +'<td style="border:1px solid #e5e7eb;padding:8px 10px;text-align:center;">'+grade+'</td>'
      +'<td style="border:1px solid #e5e7eb;padding:8px 10px;text-align:center;font-size:12px;color:#6b7280;">'+remarks+'</td>'
      +'</tr>';
  }).join('');

  var modal = document.createElement('div');
  modal.id = '__qsc_import_modal__';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow-y:auto;font-family:system-ui,sans-serif;';
  modal.innerHTML = [
    '<div style="background:#fff;border-radius:16px;width:100%;max-width:860px;box-shadow:0 24px 64px rgba(0,0,0,0.3);">',
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid #e5e7eb;">',
    '<div>',
    '<h2 style="font-size:18px;font-weight:700;margin:0;color:#111;">Import from Score Sheet</h2>',
    '<p style="font-size:13px;color:#6b7280;margin:4px 0 0;">'+escHtml(sheet.title||'')+'  &bull;  Subject: '+escHtml(sheet.subject||'')+'  &bull;  Class: '+escHtml(sheet.class||'')+'  &bull;  Term: '+escHtml(sheet.term||'')+'</p>',
    '</div>',
    '<button id="__qsc_import_close__" style="background:none;border:none;font-size:22px;cursor:pointer;color:#9ca3af;line-height:1;">&times;</button>',
    '</div>',
    rows.length===0 ? '<div style="padding:40px;text-align:center;color:#9ca3af;"><p>No student records in this score sheet.</p></div>' : [
      '<div style="padding:16px 24px;border-bottom:1px solid #e5e7eb;">',
      '<p style="font-size:13px;color:#374151;margin:0;">Click a row to copy that student\u2019s results into the Create Report form, or use the buttons below.</p>',
      '</div>',
      '<div style="overflow-x:auto;padding:20px 24px;">',
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">',
      '<thead><tr style="background:#f0f4ff;">',
      '<th style="border:1px solid #e5e7eb;padding:8px 10px;text-align:left;font-weight:600;color:#374151;">Student Name</th>',
      '<th style="border:1px solid #e5e7eb;padding:8px 10px;font-weight:600;color:#374151;">Class Score (30%)</th>',
      '<th style="border:1px solid #e5e7eb;padding:8px 10px;font-weight:600;color:#374151;">Exam Score (100%)</th>',
      '<th style="border:1px solid #e5e7eb;padding:8px 10px;font-weight:600;color:#374151;">Exam Score (70%)</th>',
      '<th style="border:1px solid #e5e7eb;padding:8px 10px;font-weight:600;color:#374151;">Total</th>',
      '<th style="border:1px solid #e5e7eb;padding:8px 10px;font-weight:600;color:#374151;">Grade</th>',
      '<th style="border:1px solid #e5e7eb;padding:8px 10px;font-weight:600;color:#374151;">Remarks</th>',
      '</tr></thead>',
      '<tbody id="__qsc_import_tbody__">'+rowHtml+'</tbody>',
      '</table></div>',
      '<div style="padding:16px 24px;border-top:1px solid #e5e7eb;display:flex;gap:12px;justify-content:flex-end;">',
      '<button id="__qsc_import_all__" style="background:#003087;color:#fff;border:none;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Import All Students</button>',
      '<button id="__qsc_import_cancel__" style="background:#f3f4f6;color:#374151;border:none;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Close</button>',
      '</div>',
    ].join(''),
    '</div>'
  ].join('');
  document.body.appendChild(modal);

  document.getElementById('__qsc_import_close__').onclick = function(){ modal.remove(); };
  document.getElementById('__qsc_import_cancel__') && (document.getElementById('__qsc_import_cancel__').onclick = function(){ modal.remove(); });
  modal.onclick = function(e){ if(e.target===modal) modal.remove(); };

  // Row hover effect + single-student import
  var tbody = document.getElementById('__qsc_import_tbody__');
  if (tbody) {
    tbody.querySelectorAll('tr').forEach(function(tr, idx){
      tr.onmouseover = function(){ this.style.background='#f0f4ff'; };
      tr.onmouseout  = function(){ this.style.background=''; };
      tr.onclick = function(){
        var r = rows[idx]; if(!r) return;
        fillCreateReportField(r.studentName, sheet);
        modal.remove();
        showToast('Imported results for '+r.studentName,'success');
      };
    });
  }

  // Import all — fills the student name and scores for each row
  var importAllBtn = document.getElementById('__qsc_import_all__');
  if (importAllBtn) {
    importAllBtn.onclick = function(){
      rows.forEach(function(r){ fillCreateReportField(r.studentName, sheet); });
      modal.remove();
      showToast('All '+rows.length+' students imported!','success');
    };
  }
}

function fillCreateReportField(studentName, sheet) {
  // Try to find an open Create Report modal and fill the student name field
  var createModal = null;
  document.querySelectorAll('h2').forEach(function(h){
    var txt = h.textContent.trim();
    if (txt==='Create Report'||txt==='Generate Report'||txt==='Create Report Card') {
      createModal = h.closest('[style*="position: fixed"]')||h.closest('[style*="position:fixed"]')||h.closest('.fixed')||h.closest('[class*="fixed"]')||h.parentElement;
    }
  });
  if (!createModal) { showToast('Open the Create Report form first, then import.','warning'); return; }
  // Fill student name field
  createModal.querySelectorAll('label').forEach(function(lbl){
    var t = lbl.textContent.trim().toLowerCase();
    if (t!=='student name'&&t!=="student's name"&&t!=='name of student') return;
    var inp = lbl.nextElementSibling;
    if (!inp||inp.tagName!=='INPUT') { var p=lbl.parentElement; if(p) inp=p.querySelector('input'); }
    if (!inp||inp.tagName!=='INPUT') return;
    inp.value = studentName;
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    inp.dispatchEvent(new Event('change',{bubbles:true}));
  });
  // Auto-fill score rows from this sheet
  autoFillFromScoreSheets(createModal, studentName);
}

function showReportViewModal(reportId) {
  var rpt = getReports().find(function(r){ return r.id===reportId; }); if(!rpt) return;
  showToast('Opening report for '+escHtml(rpt.studentName||'student')+'...','success');
  // Dispatch a storage event so the React app's report viewer can pick it up if wired
  window.dispatchEvent(new CustomEvent('qsc_view_report', { detail: { reportId: reportId } }));
}

})();
</script>`;

let cachedHtml: string | null = null;

function getInjectedHtml(): string {
  if (cachedHtml) return cachedHtml;
  const htmlPath = path.join(__dirname, "..", "public", "index.html");
  let raw = fs.readFileSync(htmlPath, "utf-8");
  raw = raw.replace(/<script[^>]*replit-cdn\.com[^>]*><\/script>/gi, "");
  raw = raw.replace(/<script[^>]*replit-pill[^>]*><\/script>/gi, "");
  raw = raw.replace(/<script[^>]*data-repl-id[^>]*><\/script>/gi, "");
  raw = raw.replace("<head>", "<head>" + syncScript + patchScript);
  cachedHtml = raw;
  return cachedHtml;
}

app.get("/favicon.svg", (req, res) => {
  const faviconPath = path.join(__dirname, "..", "public", "favicon.svg");
  if (fs.existsSync(faviconPath)) {
    res.type("image/svg+xml").sendFile(faviconPath);
  } else {
    res.status(204).end();
  }
});

app.get("/{*path}", (req, res) => {
  try {
    res.type("html").send(getInjectedHtml());
  } catch (err) {
    res.status(500).send("Could not load application.");
  }
});

export default app;


// ============================================================
// FILE: routes-storage.ts
// ============================================================

import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { kvStore } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const ALLOWED_KEYS = new Set([
  "qsc_users",
  "qsc_reports",
  "qsc_report_template",
  "qsc_school_logo",
  "qsc_score_sheets",
  "qsc_student_names",
]);

const router: IRouter = Router();

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
  const key = req.params["key"]!;
  if (!ALLOWED_KEYS.has(key)) {
    res.status(403).json({ error: "key not allowed" });
    return;
  }
  const { value } = req.body as { value?: unknown };
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
  const key = req.params["key"]!;
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
import downloadsRouter from "./downloads";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(downloadsRouter);

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
