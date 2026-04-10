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

// ─── Injected scripts ────────────────────────────────────────────────────────

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

/* ══════════════════════════════════════════════════════════════════════════
   QSC PATCH SCRIPT
   ══════════════════════════════════════════════════════════════════════════ */

/* ─── TOAST ─────────────────────────────────────────────────────────────── */
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

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('qsc_current_user')||'null'); } catch(e){ return null; }
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

/* ─── TRACK READY + INTERCEPT qsc_users SAVES FOR TOAST ─────────────────── */
var _appReady = false;
window.addEventListener('load', function(){ setTimeout(function(){ _appReady=true; }, 900); });
var _prevUsers = localStorage.getItem('qsc_users');
var _setItemOrig = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  _setItemOrig(key, value);
  if (_appReady && key==='qsc_users' && value!==_prevUsers) {
    _prevUsers = value;
    showToast('User credentials updated successfully!', 'success');
  }
  if (key==='qsc_score_sheets') {
    var p = document.getElementById('__qsc_ss_admin_panel__');
    if (p) renderSubmittedSheets(p);
  }
};

/* ─── REMOVE REPLIT BUTTON ───────────────────────────────────────────────── */
function removeReplitPill() {
  var pill = document.querySelector('replit-badge,replit-pill,[data-repl-id]');
  if (pill) pill.remove();
  /* Also hide by style if the element is a shadow-root-based web component */
  var style = document.getElementById('__qsc_pill_hide__');
  if (!style) {
    style = document.createElement('style');
    style.id = '__qsc_pill_hide__';
    style.textContent = 'replit-badge,replit-pill,[data-repl-id]{display:none!important;visibility:hidden!important;}';
    document.head.appendChild(style);
  }
}
removeReplitPill();

/* ─── MUTATION OBSERVER ──────────────────────────────────────────────────── */
var _obs = new MutationObserver(function(){
  removeReplitPill();
  patchManageUsers();
  patchScoreSheetModal();
  patchCreateReport();
  patchAdminReports();
  patchStaffDashboard();
  patchStaffDetailsForm();
});
document.addEventListener('DOMContentLoaded', function(){
  _obs.observe(document.body, { childList:true, subtree:true });
});

/* ══════════════════════════════════════════════════════════════════════════
   PATCH: STAFF DASHBOARD — Student Names Section
   ══════════════════════════════════════════════════════════════════════════ */
function patchStaffDashboard() {
  /* Find the staff dashboard. Look for a heading that indicates the staff area
     but NOT the score sheet modal or create report modal. */
  var h2s = document.querySelectorAll('h2,h3');
  var scoreHeading = null;
  for (var i=0; i<h2s.length; i++) {
    if (h2s[i].textContent.trim() === 'Score Sheets' || h2s[i].textContent.trim() === 'My Score Sheets') {
      scoreHeading = h2s[i];
      break;
    }
  }
  /* Inject student names section into the staff dashboard sidebar or section */
  /* We look for a section that has a "Create Score Sheet" or "Score Sheets" heading
     and inject our student names manager near it */
  if (!scoreHeading) return;
  var container = scoreHeading.parentElement;
  if (!container) return;
  /* Check if already patched */
  if (container.dataset.qscSnPatched) return;
  /* Walk up if needed */
  for (var up=0; up<3; up++) {
    if (container.parentElement && container.parentElement !== document.body) {
      container = container.parentElement;
      break;
    }
  }
  if (container.dataset.qscSnPatched) return;
  container.dataset.qscSnPatched = 'true';

  var panel = document.createElement('div');
  panel.id = '__qsc_sn_panel__';
  panel.style.cssText = 'background:#fff;border:1.5px solid #e5e7eb;border-radius:14px;padding:22px 24px;margin-bottom:24px;';
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
    '<div id="__qsc_sn_add_row__" style="display:none;margin-bottom:12px;display:none;flex-wrap:wrap;gap:8px;align-items:center;">',
    '<input id="__qsc_sn_input__" type="text" placeholder="Enter student name…" style="flex:1;min-width:180px;padding:9px 13px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;font-family:system-ui,sans-serif;outline:none;" />',
    '<button id="__qsc_sn_save__" style="background:#16a34a;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Save</button>',
    '<button id="__qsc_sn_cancel__" style="background:#f3f4f6;color:#374151;border:1.5px solid #d1d5db;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Cancel</button>',
    '</div>',
    names.length===0
      ? '<p style="color:#9ca3af;font-size:13px;margin:0;">No student names saved yet. Click "+ Add Name" to start.</p>'
      : '<ul id="__qsc_sn_list__" style="list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px;">' +
        names.map(function(n,idx){
          return '<li style="display:inline-flex;align-items:center;gap:6px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;padding:5px 12px;font-size:13px;color:#1e40af;font-family:system-ui,sans-serif;">'
            + escHtml(n)
            + '<button data-sn-del="'+idx+'" style="background:none;border:none;cursor:pointer;color:#6b7280;font-size:14px;line-height:1;padding:0;margin-left:2px;">&times;</button>'
            + '</li>';
        }).join('')
        + '</ul>',
  ].join('');

  /* Bind events */
  var addBtn = document.getElementById('__qsc_sn_add_btn__');
  var addRow = document.getElementById('__qsc_sn_add_row__');
  var inp    = document.getElementById('__qsc_sn_input__');
  var saveBtn= document.getElementById('__qsc_sn_save__');
  var cancelBtn = document.getElementById('__qsc_sn_cancel__');

  if (addBtn && addRow) {
    addBtn.onclick = function(){
      addRow.style.display = 'flex';
      if (inp) inp.focus();
    };
  }
  if (cancelBtn && addRow) {
    cancelBtn.onclick = function(){
      addRow.style.display = 'none';
      if (inp) inp.value = '';
    };
  }
  if (saveBtn && inp) {
    saveBtn.onclick = function(){
      var val = inp.value.trim();
      if (!val) return;
      var names2 = getStudentNames();
      if (!names2.includes(val)) {
        names2.push(val);
        saveStudentNames(names2);
        showToast('Student name saved!', 'success');
      }
      inp.value = '';
      if (addRow) addRow.style.display = 'none';
      renderStudentNamesPanel(panel);
    };
    inp.addEventListener('keydown', function(e){
      if (e.key==='Enter') saveBtn.click();
    });
  }
  /* Delete handlers */
  var list = document.getElementById('__qsc_sn_list__');
  if (list) {
    list.onclick = function(e){
      var btn = e.target.closest('[data-sn-del]');
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-sn-del'));
      var names3 = getStudentNames();
      names3.splice(idx, 1);
      saveStudentNames(names3);
      renderStudentNamesPanel(panel);
      showToast('Name removed.', 'warning');
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   PATCH: STAFF DETAILS FORM — show toast on save
   ══════════════════════════════════════════════════════════════════════════ */
function patchStaffDetailsForm() {
  /* Look for any form with a "Save" or "Update" button that might be staff details */
  var btns = document.querySelectorAll('button');
  btns.forEach(function(btn){
    if (btn.dataset.qscStaffSavePatched) return;
    var txt = btn.textContent.trim().toLowerCase();
    if ((txt==='save changes' || txt==='update profile' || txt==='save profile' || txt==='update details' || txt==='save') && btn.closest('form,section,div')) {
      var container = btn.closest('form,section,div');
      /* Check it looks like a staff details form by checking for nearby label */
      if (!container) return;
      var labels = container.querySelectorAll('label');
      var isStaffForm = false;
      labels.forEach(function(l){
        if (l.textContent.toLowerCase().includes('display name') || l.textContent.toLowerCase().includes('username')) isStaffForm = true;
      });
      if (!isStaffForm) return;
      btn.dataset.qscStaffSavePatched = 'true';
      btn.addEventListener('click', function(){
        setTimeout(function(){ showToast('Staff details updated successfully!', 'success'); }, 300);
      });
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   PATCH: MANAGE USERS — Add User button + Search
   ══════════════════════════════════════════════════════════════════════════ */
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

  /* Add User button */
  var addBtn = document.createElement('button');
  addBtn.textContent = '+ Add User';
  addBtn.style.cssText = 'background:#003087;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px;font-family:system-ui,sans-serif;display:block;';
  addBtn.onmouseover = function(){ this.style.background='#004cc7'; };
  addBtn.onmouseout  = function(){ this.style.background='#003087'; };
  addBtn.onclick = function(){ showAddUserModal(); };
  container.insertBefore(addBtn, heading.nextSibling);

  /* Search bar */
  var searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'margin-bottom:14px;';
  searchWrap.innerHTML = '<input id="__qsc_user_search__" type="text" placeholder="Search users by name or username…" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:system-ui,sans-serif;outline:none;" onfocus="this.style.borderColor=\'#003087\'" onblur="this.style.borderColor=\'#d1d5db\'"/>';
  container.insertBefore(searchWrap, addBtn.nextSibling);

  setInterval(function(){
    var inp = document.getElementById('__qsc_user_search__');
    if (!inp) return;
    var q = inp.value.toLowerCase();
    var cards = container.querySelectorAll('.bg-white.border.border-gray-200.rounded-xl,.bg-white.rounded-xl');
    cards.forEach(function(card){
      if (card.id && card.id.startsWith('__qsc_')) return;
      card.style.display = (!q || card.textContent.toLowerCase().includes(q)) ? '' : 'none';
    });
  }, 400);
}

/* ─── ADD USER MODAL ─────────────────────────────────────────────────────── */
function showAddUserModal() {
  var old = document.getElementById('__qsc_au_modal__');
  if (old) old.remove();

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
    err.style.display='none';
    if (!un||!pw){ err.textContent='Username and password are required.'; err.style.display='block'; return; }
    var users=[];
    try { users=JSON.parse(localStorage.getItem('qsc_users')||'[]'); } catch(e){}
    if (users.find(function(u){ return u.username===un; })){
      err.textContent='Username already exists.'; err.style.display='block'; return;
    }
    users.push({ id:'u_'+Date.now(), username:un, password:pw, displayName:dn||un, role:role });
    localStorage.setItem('qsc_users', JSON.stringify(users));
    modal.remove();
    showToast('User "' +(dn||un)+ '" added successfully!', 'success');
    window.dispatchEvent(new StorageEvent('storage', { key:'qsc_users' }));
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   PATCH: SCORE SHEET MODAL — A4 size + Save Draft / Submit + Student dropdown
   ══════════════════════════════════════════════════════════════════════════ */
function patchScoreSheetModal() {
  var h2s = document.querySelectorAll('h2');
  var heading = null;
  for (var i=0; i<h2s.length; i++){
    if (h2s[i].textContent.trim()==='Create Score Sheet') { heading=h2s[i]; break; }
  }
  if (!heading) return;
  var modal = heading.closest('.bg-white.rounded-2xl') || heading.closest('[class*="bg-white"]');
  if (!modal || modal.dataset.qscSsPatched) return;
  modal.dataset.qscSsPatched = 'true';

  /* A4 portrait sizing */
  modal.style.width = '210mm';
  modal.style.maxWidth = '210mm';
  modal.style.minHeight = '297mm';
  modal.style.boxSizing = 'border-box';

  /* Inject student name dropdowns into each student name input cell */
  injectStudentNameDropdowns(modal);

  /* Find Print button to add Draft + Submit beside it */
  var btns = modal.querySelectorAll('button');
  var printBtn = null;
  for (var i=0; i<btns.length; i++){
    if (btns[i].textContent.trim().toLowerCase().includes('print')) { printBtn=btns[i]; break; }
  }
  if (!printBtn) return;
  var row = printBtn.parentElement;
  if (!row || row.dataset.qscSsBtnPatched) return;
  row.dataset.qscSsBtnPatched = 'true';

  var draftBtn = document.createElement('button');
  draftBtn.textContent = 'Save as Draft';
  draftBtn.type = 'button';
  draftBtn.style.cssText = 'background:#f3f4f6;color:#374151;border:1.5px solid #d1d5db;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;';
  draftBtn.onclick = function(){ captureAndSaveSheet(modal, 'draft'); };
  row.insertBefore(draftBtn, printBtn);

  var submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit to Admin';
  submitBtn.type = 'button';
  submitBtn.style.cssText = 'background:#16a34a;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;';
  submitBtn.onclick = function(){ captureAndSaveSheet(modal, 'submitted'); };
  row.insertBefore(submitBtn, printBtn);
}

function injectStudentNameDropdowns(modal) {
  var names = getStudentNames();
  if (!names.length) return;
  var trs = modal.querySelectorAll('tbody tr');
  trs.forEach(function(tr){
    if (tr.dataset.qscSnDropdown) return;
    var firstInput = tr.querySelector('td:first-child input, td:nth-child(1) input');
    /* Some tables have no/sn/name as first input */
    var inputs = tr.querySelectorAll('input');
    /* Find the name input — usually the one with a larger minWidth or placeholder containing "name" */
    var nameInput = null;
    inputs.forEach(function(inp){
      if (inp.placeholder && inp.placeholder.toLowerCase().includes('name')) nameInput = inp;
    });
    if (!nameInput && inputs.length > 0) {
      /* second input might be the name (after serial no) */
      nameInput = inputs[1] || inputs[0];
    }
    if (!nameInput) return;
    tr.dataset.qscSnDropdown = 'true';

    /* Create datalist */
    var dlId = '__qsc_sn_dl_' + Math.random().toString(36).slice(2) + '__';
    var dl = document.createElement('datalist');
    dl.id = dlId;
    names.forEach(function(n){
      var opt = document.createElement('option');
      opt.value = n;
      dl.appendChild(opt);
    });
    nameInput.setAttribute('list', dlId);
    nameInput.setAttribute('autocomplete', 'off');
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
  var title   = getFieldVal('Sheet Title');
  var subject = getFieldVal('Subject');
  var cls     = getFieldVal('Class');
  var term    = getFieldVal('Term');
  var yr      = getFieldVal('Academic Year');
  var rows = [];
  modal.querySelectorAll('tbody tr').forEach(function(tr){
    var inp = tr.querySelectorAll('input');
    if (inp.length>=3) {
      rows.push({ no:rows.length+1, studentName:inp[0].value, classScore:inp[1].value, exam100:inp[2].value });
    }
  });
  var user = getCurrentUser();
  var now  = new Date().toISOString();
  var sheet = {
    id:'ss_'+Date.now(), title:title||('Score Sheet '+new Date().toLocaleDateString()),
    subject:subject, class:cls, term:term, academicYear:yr, rows:rows, status:status,
    staffUsername:user?user.username:'', staffName:user?(user.displayName||user.username):'',
    createdAt:now, submittedAt:status==='submitted'?now:null
  };
  var sheets = getScoreSheets();
  sheets.push(sheet);
  saveScoreSheets(sheets);
  if (status==='draft') {
    showToast('Score sheet saved as draft!', 'success');
  } else {
    showToast('Score sheet submitted to admin!', 'success');
    /* Close modal */
    var closeBtn = null;
    var allBtns = modal.querySelectorAll('button');
    for (var i=0; i<allBtns.length; i++){
      if (allBtns[i].querySelector('svg') || allBtns[i].textContent.trim()==='✕' || allBtns[i].getAttribute('aria-label')==='Close') { closeBtn=allBtns[i]; break; }
    }
    if (closeBtn) setTimeout(function(){ closeBtn.click(); }, 250);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   PATCH: CREATE REPORT — remove 'Grade' column, add student name dropdown,
          auto-fill from score sheets
   ══════════════════════════════════════════════════════════════════════════ */
var _crPatched = false;
function patchCreateReport() {
  /* Find the Create Report modal */
  var h2s = document.querySelectorAll('h2');
  var heading = null;
  for (var i=0; i<h2s.length; i++){
    var txt = h2s[i].textContent.trim();
    if (txt==='Create Report' || txt==='Generate Report') { heading=h2s[i]; break; }
  }
  if (!heading) return;
  var modal = heading.closest('[style*="position: fixed"],[style*="position:fixed"]') || heading.parentElement;
  if (!modal || modal.dataset.qscCrPatched) return;
  modal.dataset.qscCrPatched = 'true';

  /* Remove 'Grade' column from the report table */
  removeGradeColumn(modal);

  /* Inject student name autocomplete for the STUDENT NAME field */
  injectStudentNameFieldDropdown(modal);

  /* Auto-fill from score sheets when student name changes */
  wireScoreSheetAutoFill(modal);
}

function removeGradeColumn(modal) {
  /* Find all th elements and hide any that say "Grade" */
  var ths = modal.querySelectorAll('th');
  var gradeColIdx = -1;
  ths.forEach(function(th, idx){
    if (th.textContent.trim().toLowerCase()==='grade') {
      th.style.display='none';
      gradeColIdx = idx;
    }
  });
  if (gradeColIdx < 0) return;
  /* Also hide corresponding td cells */
  var trs = modal.querySelectorAll('tbody tr');
  trs.forEach(function(tr){
    var tds = tr.querySelectorAll('td');
    if (tds[gradeColIdx]) tds[gradeColIdx].style.display='none';
  });
}

function injectStudentNameFieldDropdown(modal) {
  /* Find a label or input for "Student Name" in the form area */
  var labels = modal.querySelectorAll('label');
  labels.forEach(function(lbl){
    if (lbl.textContent.trim().toUpperCase()!=='STUDENT NAME' && lbl.textContent.trim().toLowerCase()!=='student name') return;
    var inp = lbl.nextElementSibling;
    if (!inp || inp.tagName!=='INPUT') return;
    if (inp.dataset.qscSnDl) return;
    inp.dataset.qscSnDl = 'true';

    var names = getStudentNames();
    var dlId = '__qsc_cr_sn_dl__';
    var existing = document.getElementById(dlId);
    if (existing) existing.remove();
    var dl = document.createElement('datalist');
    dl.id = dlId;
    names.forEach(function(n){
      var opt = document.createElement('option'); opt.value=n; dl.appendChild(opt);
    });
    inp.setAttribute('list', dlId);
    inp.setAttribute('autocomplete', 'off');
    inp.parentNode.appendChild(dl);
  });
}

function wireScoreSheetAutoFill(modal) {
  /* When the STUDENT NAME input in the create report form changes,
     look up submitted score sheets and auto-fill subjects/scores */
  var labels = modal.querySelectorAll('label');
  labels.forEach(function(lbl){
    if (lbl.textContent.trim().toUpperCase()!=='STUDENT NAME' && lbl.textContent.trim().toLowerCase()!=='student name') return;
    var inp = lbl.nextElementSibling;
    if (!inp || inp.tagName!=='INPUT' || inp.dataset.qscAfWired) return;
    inp.dataset.qscAfWired = 'true';
    inp.addEventListener('change', function(){
      var studentName = inp.value.trim();
      if (!studentName) return;
      autoFillFromScoreSheets(modal, studentName);
    });
  });
}

function autoFillFromScoreSheets(modal, studentName) {
  var sheets = getScoreSheets().filter(function(s){ return s.status==='submitted'; });
  var matched = [];
  sheets.forEach(function(sheet){
    (sheet.rows||[]).forEach(function(row){
      if ((row.studentName||'').toLowerCase()===studentName.toLowerCase()) {
        matched.push({ subject:sheet.subject, classScore:row.classScore, exam100:row.exam100, sheet:sheet });
      }
    });
  });
  if (!matched.length) return;
  /* Fill the subject rows in the report table */
  var trs = modal.querySelectorAll('tbody tr');
  matched.forEach(function(m, idx){
    var tr = trs[idx];
    if (!tr) return;
    /* Try to set subject input/select */
    var inputs = tr.querySelectorAll('input');
    if (inputs[0]) inputs[0].value = m.subject||'';
    if (inputs[1]) inputs[1].value = m.classScore||'';
    if (inputs[2]) inputs[2].value = m.exam100||'';
  });
  showToast('Score data auto-filled from submitted score sheets!', 'success');
}

/* ══════════════════════════════════════════════════════════════════════════
   PATCH: ADMIN GENERATE REPORT — replace 'Grade' with 'Position' in table
   ══════════════════════════════════════════════════════════════════════════ */
function patchAdminReports() {
  /* Find admin generate report section */
  var h2s = document.querySelectorAll('h2');
  h2s.forEach(function(h2){
    var txt = h2.textContent.trim();
    if (txt!=='Student Reports' && txt!=='Generate Reports' && txt!=='Reports') return;
    var container = h2.closest('[class*="p-"],[class*="bg-white"]') || h2.parentElement;
    if (!container) return;

    /* Replace Grade headers with Position */
    var ths = container.querySelectorAll('th');
    ths.forEach(function(th){
      if (th.textContent.trim().toLowerCase()==='grade' && !th.dataset.qscGrReplaced) {
        th.dataset.qscGrReplaced = 'true';
        th.textContent = 'Position';
      }
    });

    /* Rename "View / Print" buttons to "View & Print" */
    var btns = container.querySelectorAll('button');
    btns.forEach(function(btn){
      if (btn.textContent.trim()==='View / Print' && !btn.dataset.qscPrintRenamed) {
        btn.dataset.qscPrintRenamed = 'true';
        btn.textContent = 'View & Print';
      }
    });
  });

  /* Inject submitted score sheets panel for admin */
  patchSubmittedScoreSheets();
}

/* ══════════════════════════════════════════════════════════════════════════
   PATCH: SUBMITTED SCORE SHEETS (Admin view)
   ══════════════════════════════════════════════════════════════════════════ */
function patchSubmittedScoreSheets() {
  var user = getCurrentUser();
  if (!user || user.role!=='admin') return;

  /* Find the Student Reports section */
  var h2s = document.querySelectorAll('h2');
  var reportsH2 = null;
  for (var i=0; i<h2s.length; i++){
    if (h2s[i].textContent.trim()==='Student Reports' || h2s[i].textContent.trim()==='Reports') {
      reportsH2=h2s[i]; break;
    }
  }
  if (!reportsH2) return;

  var reportsSection = reportsH2.parentElement;
  for (var up=0; up<5; up++){
    if (reportsSection && reportsSection.children.length>=2) break;
    reportsSection = reportsSection?reportsSection.parentElement:null;
  }
  if (!reportsSection) reportsSection = reportsH2.parentElement;
  if (!reportsSection || reportsSection.dataset.qscSsAdminPatched) return;
  reportsSection.dataset.qscSsAdminPatched = 'true';

  var panel = document.createElement('div');
  panel.id = '__qsc_ss_admin_panel__';
  panel.style.cssText = 'margin-top:32px;';
  reportsSection.appendChild(panel);
  renderSubmittedSheets(panel);
}

function renderSubmittedSheets(panel) {
  var sheets = getScoreSheets().filter(function(s){ return s.status==='submitted'; });
  panel.innerHTML = '';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
  hdr.innerHTML = '<h2 style="font-size:18px;font-weight:700;color:#111;margin:0;">Submitted Score Sheets</h2>';
  panel.appendChild(hdr);

  if (!sheets.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:48px 0;color:#9ca3af;';
    empty.innerHTML = '<div style="font-size:36px;margin-bottom:10px;">📊</div><p style="font-weight:600;font-family:system-ui,sans-serif;">No submitted score sheets yet</p>';
    panel.appendChild(empty);
    return;
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
      '<span>Subject: <strong style="color:#374151;">'+escHtml(sheet.subject||'—')+'</strong></span>',
      '<span>Class: <strong style="color:#374151;">'+escHtml(sheet.class||'—')+'</strong></span>',
      '<span>Term: <strong style="color:#374151;">'+escHtml(sheet.term||'—')+'</strong></span>',
      '<span>By: <strong style="color:#374151;">'+escHtml(sheet.staffName||sheet.staffUsername||'—')+'</strong></span>',
      '<span>Submitted: <strong style="color:#374151;">'+dateStr+'</strong></span>',
      '</div></div>',
      '<div style="display:flex;gap:8px;margin-left:12px;flex-shrink:0;">',
      '<button data-ss-print="'+sheet.id+'" style="background:#003087;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Print</button>',
      '<button data-ss-delete="'+sheet.id+'" style="background:#fef2f2;color:#b91c1c;border:1.5px solid #fca5a5;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;">Delete</button>',
      '</div></div>',
      sheet.rows&&sheet.rows.length
        ? '<div style="font-size:12px;color:#9ca3af;margin-top:10px;padding-top:10px;border-top:1px solid #f3f4f6;font-family:system-ui,sans-serif;">'+sheet.rows.filter(function(r){return r.studentName;}).length+' student records</div>' : ''
    ].join('');
    panel.appendChild(card);
  });

  panel.onclick = function(e){
    var printId  = e.target.dataset&&e.target.dataset.ssPrint;
    var deleteId = e.target.dataset&&e.target.dataset.ssDelete;
    if (printId)  printScoreSheet(printId);
    if (deleteId) deleteScoreSheet(deleteId, panel);
  };
}

function printScoreSheet(id) {
  var sheets = getScoreSheets();
  var sheet = sheets.find(function(s){ return s.id===id; });
  if (!sheet) return;
  var rows = (sheet.rows||[]).map(function(r,idx){
    var cs = parseFloat(r.classScore)||0;
    var e100 = parseFloat(r.exam100)||0;
    var e70 = Math.round(e100/100*70*10)/10;
    var total = (r.classScore!==''||r.exam100!=='') ? Math.round((cs+e70)*10)/10 : '';
    var grade = total!=='' ? calcGrade(total) : '';
    var remarks = grade ? gradeRemarks(grade) : '';
    return '<tr><td>'+(idx+1)+'</td><td style="text-align:left">'+escHtml(r.studentName||'')+'</td><td>'+cs+'</td><td>'+e100+'</td><td>'+e70+'</td><td style="font-weight:700">'+(total!==''?total:'')+'</td><td>'+grade+'</td><td>'+remarks+'</td></tr>';
  }).join('');
  var w = window.open('','_blank');
  if (!w) return;
  w.document.write([
    '<!DOCTYPE html><html><head><title>Score Sheet - '+escHtml(sheet.title||'')+'</title>',
    '<style>@page{size:A4 landscape;margin:10mm;}body{font-family:Arial,sans-serif;font-size:10px;}',
    'table{width:100%;border-collapse:collapse;}th,td{border:1px solid #555;padding:3px 5px;text-align:center;}',
    'th{background:#dce8f5;}td:nth-child(2){text-align:left;}h2,h3{margin:0 0 4px;}',
    '.meta{margin-bottom:8px;font-size:11px;}</style></head><body>',
    '<h2>'+escHtml(sheet.title||'Score Sheet')+'</h2>',
    '<div class="meta"><strong>Subject:</strong> '+escHtml(sheet.subject||'')+'&nbsp;&nbsp;',
    '<strong>Class:</strong> '+escHtml(sheet.class||'')+'&nbsp;&nbsp;',
    '<strong>Term:</strong> '+escHtml(sheet.term||'')+'&nbsp;&nbsp;',
    '<strong>Year:</strong> '+escHtml(sheet.academicYear||'')+'&nbsp;&nbsp;',
    '<strong>Staff:</strong> '+escHtml(sheet.staffName||sheet.staffUsername||''),
    '</div>',
    '<table><thead><tr><th>#</th><th>Student Name</th><th>Class Score (30%)</th><th>Exam Score (100%)</th>',
    '<th>Exam Score (70%)</th><th>Total</th><th>Grade</th><th>Remarks</th>',
    '</tr></thead><tbody>'+rows+'</tbody></table>',
    '<scr'+'ipt>window.onload=function(){window.print();};<'+'/script>',
    '</body></html>'
  ].join(''));
  w.document.close();
}

function deleteScoreSheet(id, panel) {
  if (!confirm('Delete this score sheet?')) return;
  var sheets = getScoreSheets().filter(function(s){ return s.id!==id; });
  saveScoreSheets(sheets);
  renderSubmittedSheets(panel);
  showToast('Score sheet deleted.', 'warning');
}

})();
</script>`;

let cachedHtml: string | null = null;

function getInjectedHtml(): string {
  if (cachedHtml) return cachedHtml;
  const htmlPath = path.join(__dirname, "..", "public", "index.html");
  let raw = fs.readFileSync(htmlPath, "utf-8");
  // Remove Replit pill script tag
  raw = raw.replace(/<script[^>]*replit-cdn\.com[^>]*><\/script>/gi, "");
  raw = raw.replace(/<script[^>]*replit-pill[^>]*><\/script>/gi, "");
  // Inject sync + patch scripts at top of <head>
  raw = raw.replace("<head>", "<head>" + syncScript + patchScript);
  cachedHtml = raw;
  return cachedHtml;
}

// ─── Download endpoints ───────────────────────────────────────────────────────

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

// Combined download (all .ts files)
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

// Downloads index page
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
  <title>Download Updated Files — QSC SIS</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 48px; background: #f5f7fa; }
    h2 { color: #003087; margin-bottom: 6px; }
    p { color: #555; margin-top: 0; font-size: 14px; }
    ul { list-style: none; padding: 0; background: #fff; border-radius: 12px; padding: 24px 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
    li a:hover { color: #004cc7; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
  </style>
</head>
<body>
  <h2>Updated Files — Download Individually</h2>
  <p>Click any file to download it to your computer.</p>
  <ul>
    ${rows}
    <hr />
    ${combinedRow}
  </ul>
</body>
</html>`);
});

// Individual file download
app.get("/downloads/:file", (req, res) => {
  const key = req.params.file;
  const entry = DOWNLOAD_FILES[key];
  if (!entry) {
    res.status(404).send("File not found");
    return;
  }
  if (!fs.existsSync(entry.disk)) {
    res.status(404).send("File does not exist on disk");
    return;
  }
  res.download(entry.disk, entry.name);
});

// Serve favicon
app.get("/favicon.svg", (req, res) => {
  const faviconPath = path.join(__dirname, "..", "public", "favicon.svg");
  if (fs.existsSync(faviconPath)) {
    res.type("image/svg+xml").sendFile(faviconPath);
  } else {
    res.status(204).end();
  }
});

// Serve the SPA for all non-API routes
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
