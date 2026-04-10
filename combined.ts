// ============================================================
// FILE: app.ts
// ============================================================

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
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
  var SYNC_KEYS = ["qsc_users","qsc_reports","qsc_report_template","qsc_school_logo","qsc_score_sheets"];
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
</script>
<script>
(function(){
/* =====================================================================
   QSC PATCH SCRIPT — runs after React mounts, patches DOM reactively
   ===================================================================== */

/* ---- 1. TOAST SYSTEM ---- */
function showToast(msg, type) {
  var t = document.getElementById('__qsc_toast__');
  if (!t) {
    t = document.createElement('div');
    t.id = '__qsc_toast__';
    t.style.cssText = 'position:fixed;bottom:28px;right:28px;z-index:999999;font-family:system-ui,sans-serif;font-size:14px;padding:13px 22px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.18);transition:opacity 0.35s;max-width:360px;pointer-events:none;';
    document.body.appendChild(t);
  }
  clearTimeout(t._tmr);
  t.style.background = (type === 'error') ? '#fef2f2' : (type === 'warning' ? '#fffbeb' : '#f0fdf4');
  t.style.color     = (type === 'error') ? '#b91c1c' : (type === 'warning' ? '#92400e' : '#15803d');
  t.style.border    = '1.5px solid ' + ((type === 'error') ? '#fca5a5' : (type === 'warning' ? '#fde68a' : '#86efac'));
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.display = 'block';
  t._tmr = setTimeout(function(){ t.style.opacity='0'; setTimeout(function(){ t.style.display='none'; },350); }, 3500);
}
window.__qscToast = showToast;

/* ---- 2. TRACK APP READY + INTERCEPT qsc_users SAVES FOR TOAST ---- */
var _appReady = false;
window.addEventListener('load', function(){ setTimeout(function(){ _appReady = true; }, 800); });
var _prevUsers = localStorage.getItem('qsc_users');
var _setItemOrig = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
  _setItemOrig(key, value);
  if (_appReady && key === 'qsc_users' && value !== _prevUsers) {
    _prevUsers = value;
    showToast('User credentials updated successfully!', 'success');
  }
  if (key === 'qsc_score_sheets') {
    var p = document.getElementById('__qsc_ss_admin_panel__');
    if (p) renderSubmittedSheets(p);
  }
};

/* ---- 3. HELPERS ---- */
function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('qsc_current_user') || 'null'); } catch(e){ return null; }
}
function getScoreSheets() {
  try { return JSON.parse(localStorage.getItem('qsc_score_sheets') || '[]'); } catch(e){ return []; }
}
function saveScoreSheets(arr) {
  localStorage.setItem('qsc_score_sheets', JSON.stringify(arr));
}

/* ---- 4. MAIN MUTATION OBSERVER ---- */
var _obs = new MutationObserver(function(){
  patchManageUsers();
  patchScoreSheetModal();
  patchReportPreview();
  patchAdminReports();
});
document.addEventListener('DOMContentLoaded', function(){
  _obs.observe(document.body, { childList: true, subtree: true });
});

/* =====================================================================
   PATCH: MANAGE USERS — add search + Add User button
   ===================================================================== */
function patchManageUsers() {
  var h2s = document.querySelectorAll('h2');
  var heading = null;
  for (var i=0; i<h2s.length; i++){
    if (h2s[i].textContent.trim() === 'Manage User Credentials') { heading = h2s[i]; break; }
  }
  if (!heading) return;
  var container = heading.parentElement;
  if (!container || container.dataset.qscMuPatched) return;
  container.dataset.qscMuPatched = 'true';

  /* Search bar */
  var searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'margin-bottom:14px;';
  searchWrap.innerHTML = '<input id="__qsc_user_search__" type="text" placeholder="Search users by name or username…" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:system-ui,sans-serif;outline:none;transition:border-color 0.2s;" onfocus="this.style.borderColor=\'#003087\'" onblur="this.style.borderColor=\'#d1d5db\'"/>';
  container.insertBefore(searchWrap, heading.nextSibling);

  /* Add User button */
  var addBtn = document.createElement('button');
  addBtn.textContent = '+ Add User';
  addBtn.style.cssText = 'background:#003087;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:16px;font-family:system-ui,sans-serif;transition:background 0.2s;display:block;';
  addBtn.onmouseover = function(){ this.style.background='#004cc7'; };
  addBtn.onmouseout  = function(){ this.style.background='#003087'; };
  addBtn.onclick = function(){ showAddUserModal(); };
  container.insertBefore(addBtn, searchWrap);

  /* Search filter logic (runs on each mutation since cards re-render) */
  setInterval(function(){
    var inp = document.getElementById('__qsc_user_search__');
    if (!inp || !inp.value) return;
    var q = inp.value.toLowerCase();
    var cont = inp.closest('[data-qsc-mu-patched]') || container;
    var cards = cont.querySelectorAll('.bg-white.border.border-gray-200.rounded-xl');
    cards.forEach(function(card){
      var txt = card.textContent.toLowerCase();
      card.style.display = txt.includes(q) ? '' : 'none';
    });
  }, 400);
}

/* =====================================================================
   ADD USER MODAL
   ===================================================================== */
function showAddUserModal() {
  var old = document.getElementById('__qsc_au_modal__');
  if (old) old.remove();
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
    '<select id="__au_role__" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>',
    '<div style="display:flex;gap:12px;">',
    '<button id="__au_ok__" style="flex:1;background:#003087;color:#fff;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Add User</button>',
    '<button id="__au_cancel__" style="flex:1;background:#f3f4f6;color:#333;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>',
    '</div></div>'
  ].join('');
  document.body.appendChild(modal);

  function field(lbl, id, type, ph) {
    return '<div style="margin-bottom:14px;"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:#333;">'+lbl+'</label><input id="'+id+'" type="'+type+'" placeholder="'+ph+'" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;"/></div>';
  }

  document.getElementById('__au_cancel__').onclick = function(){ modal.remove(); };
  modal.onclick = function(e){ if(e.target===modal) modal.remove(); };
  document.getElementById('__au_ok__').onclick = function(){
    var dn   = document.getElementById('__au_dn__').value.trim();
    var un   = document.getElementById('__au_un__').value.trim();
    var pw   = document.getElementById('__au_pw__').value.trim();
    var role = document.getElementById('__au_role__').value;
    var err  = document.getElementById('__qsc_au_err__');
    err.style.display = 'none';
    if (!un || !pw) { err.textContent='Username and password are required.'; err.style.display='block'; return; }
    var users = [];
    try { users = JSON.parse(localStorage.getItem('qsc_users')||'[]'); } catch(e){}
    if (users.find(function(u){ return u.username===un; })) {
      err.textContent='Username already exists. Choose a different one.'; err.style.display='block'; return;
    }
    users.push({ id:'u_'+Date.now(), username:un, password:pw, displayName:dn||un, role:role });
    _prevUsers = JSON.stringify(users);
    localStorage.setItem('qsc_users', JSON.stringify(users));
    modal.remove();
    showToast('User "' + (dn||un) + '" added successfully!', 'success');
    window.dispatchEvent(new StorageEvent('storage', { key:'qsc_users' }));
  };
}

/* =====================================================================
   PATCH: SCORE SHEET MODAL — A4 size + Save Draft / Submit buttons
   ===================================================================== */
function patchScoreSheetModal() {
  var h2s = document.querySelectorAll('h2');
  var heading = null;
  for (var i=0; i<h2s.length; i++){
    if (h2s[i].textContent.trim() === 'Create Score Sheet') { heading = h2s[i]; break; }
  }
  if (!heading) return;
  var modal = heading.closest('.bg-white.rounded-2xl');
  if (!modal || modal.dataset.qscSsPatched) return;
  modal.dataset.qscSsPatched = 'true';

  /* A4 portrait sizing */
  modal.style.width = '210mm';
  modal.style.maxWidth = '210mm';
  modal.style.minHeight = '297mm';

  /* Find the footer row that contains the Preview & Print button */
  var btns = modal.querySelectorAll('button');
  var printBtn = null;
  for (var i=0; i<btns.length; i++){
    if (btns[i].textContent.trim().toLowerCase().includes('print')) { printBtn = btns[i]; break; }
  }
  if (!printBtn) return;
  var row = printBtn.parentElement;
  if (!row || row.dataset.qscSsBtnPatched) return;
  row.dataset.qscSsBtnPatched = 'true';

  /* Save as Draft */
  var draftBtn = document.createElement('button');
  draftBtn.textContent = 'Save as Draft';
  draftBtn.type = 'button';
  draftBtn.style.cssText = 'background:#f3f4f6;color:#374151;border:1.5px solid #d1d5db;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;';
  draftBtn.onclick = function(){ captureAndSaveSheet(modal, 'draft'); };
  row.insertBefore(draftBtn, printBtn);

  /* Submit to Admin */
  var submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit to Admin';
  submitBtn.type = 'button';
  submitBtn.style.cssText = 'background:#16a34a;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;';
  submitBtn.onclick = function(){ captureAndSaveSheet(modal, 'submitted'); };
  row.insertBefore(submitBtn, printBtn);
}

function captureAndSaveSheet(modal, status) {
  var labels = modal.querySelectorAll('label');
  function getFieldVal(labelText) {
    for (var i=0; i<labels.length; i++){
      if (labels[i].textContent.trim() === labelText) {
        var sib = labels[i].nextElementSibling;
        if (sib) return (sib.tagName === 'SELECT' ? sib.options[sib.selectedIndex].text : sib.value) || '';
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
    if (inp.length >= 3) {
      rows.push({ no: rows.length+1, studentName: inp[0].value, classScore: inp[1].value, exam100: inp[2].value });
    }
  });

  var user = getCurrentUser();
  var now  = new Date().toISOString();
  var sheet = {
    id: 'ss_' + Date.now(),
    title: title || ('Score Sheet ' + new Date().toLocaleDateString()),
    subject: subject, class: cls, term: term, academicYear: yr,
    rows: rows,
    status: status,
    staffUsername: user ? user.username : '',
    staffName: user ? (user.displayName || user.username) : '',
    createdAt: now,
    submittedAt: status === 'submitted' ? now : null
  };

  var sheets = getScoreSheets();
  sheets.push(sheet);
  saveScoreSheets(sheets);

  if (status === 'draft') {
    showToast('Score sheet saved as draft!', 'success');
  } else {
    showToast('Score sheet submitted to admin!', 'success');
    var closeBtn = modal.querySelector('button[class*="text-gray-400"]');
    if (!closeBtn) {
      var allBtns = modal.querySelectorAll('button');
      for (var i=0; i<allBtns.length; i++){
        if (allBtns[i].querySelector('svg') || allBtns[i].textContent.trim()==='✕') { closeBtn=allBtns[i]; break; }
      }
    }
    if (closeBtn) setTimeout(function(){ closeBtn.click(); }, 200);
  }
}

/* =====================================================================
   PATCH: REPORT PREVIEW MODAL — ensure Print works, add direct print for admin
   ===================================================================== */
function patchReportPreview() {
  /* The hd modal has a heading "View Report" or "Report Preview" */
  var headings = document.querySelectorAll('div[style*="position: fixed"] h2, div[style*="position:fixed"] h2');
  headings.forEach(function(h2){
    var txt = h2.textContent.trim();
    if (txt !== 'View Report' && txt !== 'Report Preview') return;
    var modal = h2.closest('div[style*="position"]');
    if (!modal || modal.dataset.qscRpPatched) return;
    modal.dataset.qscRpPatched = 'true';
    /* Nothing needed — Print/Save PDF button already exists in the app */
  });
}

/* =====================================================================
   PATCH: ADMIN REPORTS — print button per report row + submitted score sheets
   ===================================================================== */
function patchAdminReports() {
  /* Add "Print" button next to each "View / Print" button in the reports list */
  var btns = document.querySelectorAll('button');
  btns.forEach(function(btn){
    if (btn.textContent.trim() !== 'View / Print') return;
    if (btn.dataset.qscPrintAdded) return;
    btn.dataset.qscPrintAdded = 'true';
    /* Actually View/Print already opens the hd modal which has Print/Save PDF inside.
       The user's request: "admin should also be able to print reports" —
       We rename the existing button text to be clearer */
    btn.textContent = 'View & Print';
  });

  /* Inject submitted score sheets panel below student reports section */
  patchSubmittedScoreSheets();
}

/* =====================================================================
   PATCH: SUBMITTED SCORE SHEETS (Admin view)
   ===================================================================== */
function patchSubmittedScoreSheets() {
  /* Only inject for admin — check current user role */
  var user = getCurrentUser();
  if (!user || user.role !== 'admin') return;

  /* Find the Student Reports section heading */
  var h2s = document.querySelectorAll('h2');
  var reportsH2 = null;
  for (var i=0; i<h2s.length; i++){
    if (h2s[i].textContent.trim() === 'Student Reports') { reportsH2 = h2s[i]; break; }
  }
  if (!reportsH2) return;

  /* Walk up to find a container div that holds multiple children (the reports grid) */
  var reportsSection = reportsH2.parentElement;
  for (var up=0; up<5; up++) {
    if (reportsSection && reportsSection.children.length >= 2) break;
    reportsSection = reportsSection ? reportsSection.parentElement : null;
  }
  if (!reportsSection) reportsSection = reportsH2.parentElement;
  if (!reportsSection || reportsSection.dataset.qscSsAdminPatched) return;
  reportsSection.dataset.qscSsAdminPatched = 'true';

  /* Create the submitted score sheets section */
  var panel = document.createElement('div');
  panel.id = '__qsc_ss_admin_panel__';
  panel.style.cssText = 'margin-top:32px;';
  reportsSection.appendChild(panel);

  renderSubmittedSheets(panel);
  _ssWatchInstalled = true;
}
var _ssWatchInstalled = false;

function renderSubmittedSheets(panel) {
  var sheets = getScoreSheets().filter(function(s){ return s.status === 'submitted'; });
  panel.innerHTML = '';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
  hdr.innerHTML = '<h2 style="font-size:18px;font-weight:700;color:#111;margin:0;">Submitted Score Sheets</h2>';
  panel.appendChild(hdr);

  if (sheets.length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:48px 0;color:#9ca3af;';
    empty.innerHTML = '<div style="font-size:36px;margin-bottom:10px;">📊</div><p style="font-weight:600;">No submitted score sheets yet</p>';
    panel.appendChild(empty);
    return;
  }

  sheets.forEach(function(sheet){
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.06);margin-bottom:12px;';
    var d = new Date(sheet.submittedAt||sheet.createdAt);
    var dateStr = d.toLocaleDateString()+' '+d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    card.innerHTML = [
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;">',
      '<div>',
      '<h3 style="font-size:15px;font-weight:700;color:#111;margin:0 0 4px;">'+escHtml(sheet.title||'Untitled')+'</h3>',
      '<div style="font-size:13px;color:#6b7280;display:flex;flex-wrap:wrap;gap:12px;margin-top:4px;">',
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
      sheet.rows && sheet.rows.length ? '<div style="font-size:12px;color:#9ca3af;margin-top:10px;padding-top:10px;border-top:1px solid #f3f4f6;">'+sheet.rows.filter(function(r){return r.studentName;}).length+' student records</div>' : ''
    ].join('');
    panel.appendChild(card);
  });

  /* Event delegation */
  panel.onclick = function(e){
    var printId  = e.target.dataset && e.target.dataset.ssPrint;
    var deleteId = e.target.dataset && e.target.dataset.ssDelete;
    if (printId)  printScoreSheet(printId);
    if (deleteId) deleteScoreSheet(deleteId, panel);
  };
}

function printScoreSheet(id) {
  var sheets = getScoreSheets();
  var sheet = sheets.find(function(s){ return s.id === id; });
  if (!sheet) return;

  var rows = (sheet.rows||[]).map(function(r, idx){
    var cs = parseFloat(r.classScore)||0;
    var e100 = parseFloat(r.exam100)||0;
    var e70 = Math.round(e100/100*70*10)/10;
    var total = (r.classScore!==''||r.exam100!=='') ? Math.round((cs+e70)*10)/10 : '';
    var grade = total !== '' ? calcGrade(total) : '';
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
    '<div class="meta">',
    '<strong>Subject:</strong> '+escHtml(sheet.subject||'')+'  &nbsp;',
    '<strong>Class:</strong> '+escHtml(sheet.class||'')+'  &nbsp;',
    '<strong>Term:</strong> '+escHtml(sheet.term||'')+'  &nbsp;',
    '<strong>Year:</strong> '+escHtml(sheet.academicYear||'')+'  &nbsp;',
    '<strong>Staff:</strong> '+escHtml(sheet.staffName||sheet.staffUsername||''),
    '</div>',
    '<table><thead><tr>',
    '<th>#</th><th>Student Name</th><th>Class Score (30%)</th><th>Exam Score (100%)</th>',
    '<th>Exam Score (70%)</th><th>Total</th><th>Grade</th><th>Remarks</th>',
    '</tr></thead><tbody>'+rows+'</tbody></table>',
    '<scr'+'ipt>window.onload=function(){window.print();};<'+'/script>',
    '</body></html>'
  ].join(''));
  w.document.close();
}

function deleteScoreSheet(id, panel) {
  if (!confirm('Delete this score sheet?')) return;
  var sheets = getScoreSheets().filter(function(s){ return s.id !== id; });
  saveScoreSheets(sheets);
  renderSubmittedSheets(panel);
  showToast('Score sheet deleted.', 'warning');
}

function calcGrade(total) {
  if (total >= 80) return 'A1';
  if (total >= 70) return 'B2';
  if (total >= 65) return 'B3';
  if (total >= 60) return 'C4';
  if (total >= 55) return 'C5';
  if (total >= 50) return 'C6';
  if (total >= 45) return 'D7';
  if (total >= 40) return 'E8';
  return 'F9';
}
function gradeRemarks(g) {
  var m = {A1:'Excellent',B2:'Very Good',B3:'Good',C4:'Credit',C5:'Credit',C6:'Credit',D7:'Pass',E8:'Pass',F9:'Fail'};
  return m[g]||'';
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

})();
</script>
`;

let cachedHtml: string | null = null;

function getInjectedHtml(): string {
  if (cachedHtml) return cachedHtml;
  const htmlPath = path.join(__dirname, "..", "public", "index.html");
  const raw = fs.readFileSync(htmlPath, "utf-8");
  cachedHtml = raw.replace("<head>", "<head>" + syncScript);
  return cachedHtml;
}

const DOWNLOAD_FILES: Record<string, { disk: string; name: string }> = {
  "app.ts": {
    disk: path.join(__dirname, "..", "src", "app.ts"),
    name: "app.ts",
  },
  "routes-storage.ts": {
    disk: path.join(__dirname, "..", "src", "routes", "storage.ts"),
    name: "routes-storage.ts",
  },
  "routes-index.ts": {
    disk: path.join(__dirname, "..", "src", "routes", "index.ts"),
    name: "routes-index.ts",
  },
  "schema-storage.ts": {
    disk: path.join(__dirname, "..", "..", "..", "lib", "db", "src", "schema", "storage.ts"),
    name: "schema-storage.ts",
  },
  "schema-index.ts": {
    disk: path.join(__dirname, "..", "..", "..", "lib", "db", "src", "schema", "index.ts"),
    name: "schema-index.ts",
  },
  "index.html": {
    disk: path.join(__dirname, "..", "public", "index.html"),
    name: "index.html",
  },
};

const TS_FILES = ["app.ts", "routes-storage.ts", "routes-index.ts", "schema-storage.ts", "schema-index.ts"];

app.get("/downloads/combined.ts", (req, res) => {
  const parts = TS_FILES.map((key) => {
    const entry = DOWNLOAD_FILES[key]!;
    const content = fs.readFileSync(entry.disk, "utf-8");
    const divider = "// " + "=".repeat(60);
    return `${divider}\n// FILE: ${entry.name}\n${divider}\n\n${content}`;
  });
  const combined = parts.join("\n\n");
  res.setHeader("Content-Disposition", 'attachment; filename="combined.ts"');
  res.type("text/plain").send(combined);
});

app.get("/downloads", (req, res) => {
  const tsRow = `<li style="margin:10px 0"><a href="/downloads/combined.ts" download style="font-family:monospace;font-size:15px;color:#003087;text-decoration:none;border-bottom:1px solid #003087">combined.ts</a> <span style="font-size:12px;color:#555">(all .ts files in one)</span></li>`;
  const htmlRow = `<li style="margin:10px 0"><a href="/downloads/index.html" download style="font-family:monospace;font-size:15px;color:#003087;text-decoration:none;border-bottom:1px solid #003087">index.html</a></li>`;
  res.type("html").send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Download Updated Files</title>
<style>body{font-family:Arial,sans-serif;padding:40px;background:#f5f7fa}h2{color:#003087}ul{list-style:none;padding:0}</style>
</head><body><h2>Updated Files — Download Individually</h2><ul>${tsRow}${htmlRow}</ul></body></html>`);
});

app.get("/downloads/:file", (req, res) => {
  const entry = DOWNLOAD_FILES[req.params.file];
  if (!entry) { res.status(404).send("Not found"); return; }
  res.download(entry.disk, entry.name);
});

app.get("/favicon.svg", (req, res) => {
  const faviconPath = path.join(__dirname, "..", "public", "favicon.svg");
  if (fs.existsSync(faviconPath)) {
    res.type("image/svg+xml").sendFile(faviconPath);
  } else {
    res.status(204).end();
  }
});

app.get("/", (req, res) => {
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
