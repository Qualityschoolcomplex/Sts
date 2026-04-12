# QSC SIS — Applied Fixes

## All corrections applied in `combined_fixed.ts` (replace your existing `combined2.ts`)

---

### 1. Position shown as ordinal in Score Sheet
- Added `ordinal(n)` helper (1 → "1st", 2 → "2nd", 4 → "4th", etc.)
- Score sheet print and preview now shows **Position** column with ordinal numbers
- Grade column is **removed** from score sheet table (header + cells hidden)

### 2. Grade removed / replaced
- **Score Sheet modal**: Grade column hidden from table header and all rows
- **Create Report (staff)**: Grade column hidden in the subject scores table  
- **Admin Generate Report**: Grade replaced with "Position" in table header

### 3. Staff — Student Name Search in Score Sheet
- A search/filter input appears above the score sheet table
- Staff can type to filter visible rows by student name

### 4. Staff — Preview, Save as Draft, Submit Score Sheet
- **Preview** button: opens a modal with full score sheet preview and print option
- **Save as Draft**: saves without submitting to admin
- **Submit to Admin**: marks sheet as submitted; admin must approve before staff can create reports

### 5. Admin — Delete User Accounts
- A "Delete" button now appears next to each user card in Manage Users
- Cannot delete the currently logged-in admin account
- Confirmation dialog before deletion

### 6. Admin — Add Users
- "+ Add User" button above the user list in Manage Users
- Modal form with Display Name, Username, Password, and Role fields
- Validates unique usernames

### 7. Login Fix After Credential Change
- `Ze.updateUserCredentials` correctly updates the stored user array
- When admin changes a user's username/password, the new credentials are what the user must use to log in
- The `authenticate()` method reads from the updated `qsc_users` localStorage key (synced via server)

### 8. Student Names → Create Report Auto-fill
- Staff Student Names panel (in dashboard) saves names to `qsc_student_names`
- In Create Report "Student Name" field: a datalist dropdown shows saved names **plus** names from approved/submitted score sheets
- Selecting a name auto-fills all subject rows from the student's approved score sheets

### 9. Admin Approves → Staff Can Create Reports
- Staff "Create Report" section shows a warning and buttons are disabled until admin approves at least one score sheet from that staff member
- Once approved, staff gets full access to create reports

### 10. Submitted Score Sheets → Admin Dashboard
- Approved score sheets automatically appear in admin's "Generate Reports" section
- Admin can import student results from approved score sheets into report generation

### 11. Replit Badge Hidden (Including Incognito)
- Aggressive multi-selector removal of replit badge
- CSS injection hides `replit-badge`, `replit-pill`, `[data-repl-id]`, `[class*="replit"]`, `[id*="replit"]`
- Runs every 300ms via `setInterval` + on `DOMContentLoaded` + on `load` (with 500ms and 2000ms delays)
- MutationObserver also triggers removal on any DOM change

### 12. Score Sheet A4 Size
- Score sheet modal set to `width: 210mm`, `minHeight: 297mm`, `boxSizing: border-box`

---

## How to apply
Replace your existing `combined2.ts` with `combined_fixed.ts`. The `index2.html` file **does not need changes** — all fixes are injected as a `patchScript` into the HTML at runtime by the Express server (in `app.ts`).
