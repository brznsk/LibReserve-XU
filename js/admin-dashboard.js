let session = null;

const ADMIN_UI_OVERRIDES_KEY = "xu_admin_ui_overrides";

function apiBase() {
  return (
    window.XU_API_BASE ||
    (console.warn("[LibReserve] Load js/xu-api-base.js before admin-dashboard.js"),
    "http://127.0.0.1:3000/api")
  );
}

function readOverrides() {
  try {
    const o = JSON.parse(localStorage.getItem(ADMIN_UI_OVERRIDES_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch (e) {
    return {};
  }
}

function writeOverrides(obj) {
  localStorage.setItem(ADMIN_UI_OVERRIDES_KEY, JSON.stringify(obj));
}

function mergeUser(u) {
  const part = readOverrides()[u.email.toLowerCase()] || {};
  return { ...u, ...part };
}

async function getDisplayUsers() {
  const api = await getUsers();
  return api.map(mergeUser);
}

function countActiveAdmins(users) {
  return users.filter((u) => u.type === "admin" && u.accountStatus === "active").length;
}

(async function adminInit() {
  try {
    session = JSON.parse(sessionStorage.getItem("xu_session") || "null");
  } catch (e) {
    session = null;
  }
  if (!session || session.type !== "admin") {
    window.location.href = "LogIn.html";
    return;
  }
  const users = await getUsers();
  const live = users.find((u) => u.email.toLowerCase() === session.email.toLowerCase());
  if (!live || live.accountStatus !== "active" || live.type !== "admin") {
    sessionStorage.removeItem("xu_session");
    window.location.href = "LogIn.html";
    return;
  }
  const initials = ((session.fname || "A")[0] + (session.lname || "D")[0]).toUpperCase();
  document.getElementById("user-avatar").textContent = initials;
  document.getElementById("user-name").textContent =
    (session.fname || "") + " " + (session.lname || "");
  document.getElementById("search-users").addEventListener("input", () => {
    renderUserTable();
  });
  document.getElementById("users-tbody").addEventListener("click", onTableClick);
  await renderUserTable();
})();

function openAddStaffModal() {
  openStaffModal();
}

function onTableClick(e) {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const email = decodeURIComponent(btn.getAttribute("data-email"));
  const act = btn.getAttribute("data-act");
  if (act === "assist") void toggleAssistant(email);
  if (act === "staffdesk") void toggleStaffDeskLogin(email);
  if (act === "active") void toggleUserActive(email);
  if (act === "staffpw") openStaffPwModal(email);
}

async function renderUserTable() {
  const q = document.getElementById("search-users").value.trim().toLowerCase();
  const users = await getDisplayUsers();
  const filtered = users.filter((u) => {
    if (!q) return true;
    const hay = (u.email + u.fname + u.lname + (u.sid || "") + u.type).toLowerCase();
    return hay.includes(q);
  });
  const tbody = document.getElementById("users-tbody");
  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="6"><div class="empty-state" style="padding:2rem"><p>No users match.</p></div></td></tr>';
    return;
  }
  const activeAdmins = countActiveAdmins(users);
  tbody.innerHTML = filtered
    .map((u) => {
      const inactive = u.accountStatus === "inactive";
      const isSelf = u.email.toLowerCase() === session.email.toLowerCase();
      const lastAdmin = u.type === "admin" && u.accountStatus === "active" && activeAdmins <= 1;

      let privCell = "—";
      let privBtn = "";
      if (u.type === "student") {
        privCell = u.staffPortalAccess
          ? '<span class="status-badge status-approved">Assistant tag</span>'
          : '<span style="color:var(--text-faint)">—</span>';
        if (!isSelf) {
          privBtn = `<button type="button" class="btn-small" data-act="assist" data-email="${encodeURIComponent(
            u.email
          )}">${u.staffPortalAccess ? "Remove tag" : "Tag assistant"}</button>`;
        }
      } else if (u.type === "staff") {
        const deskOk = u.staffPortalAccess === true;
        privCell = deskOk
          ? '<span class="status-badge status-approved">Desk login</span>'
          : '<span style="color:var(--text-faint)">No desk login</span>';
        if (!isSelf) {
          privBtn = `<button type="button" class="btn-small" data-act="staffdesk" data-email="${encodeURIComponent(
            u.email
          )}">${deskOk ? "Revoke desk login" : "Grant desk login"}</button>`;
        }
      }

      const deactivateLabel = inactive ? "Activate" : "Deactivate";
      let statusBtn = "";
      if (u.type === "admin") {
        if (isSelf || lastAdmin) {
          statusBtn = `<button type="button" class="btn-small" disabled title="Cannot deactivate the last active administrator.">${deactivateLabel}</button>`;
        } else {
          statusBtn = `<button type="button" class="btn-small ${
            inactive ? "" : "danger"
          }" data-act="active" data-email="${encodeURIComponent(u.email)}">${deactivateLabel}</button>`;
        }
      } else {
        statusBtn = `<button type="button" class="btn-small ${
          inactive ? "" : "danger"
        }" data-act="active" data-email="${encodeURIComponent(u.email)}">${deactivateLabel}</button>`;
      }

      let accountBtns = statusBtn;
      if (u.type === "staff") {
        accountBtns = `<button type="button" class="btn-small" data-act="staffpw" data-email="${encodeURIComponent(
          u.email
        )}">New password</button>${statusBtn}`;
      }

      const typeClass =
        u.type === "admin" ? "type-admin" : u.type === "staff" ? "type-staff" : "type-student";

      return `<tr class="${inactive ? "inactive" : ""}">
        <td><b>${escapeHtml(u.email)}</b></td>
        <td>${escapeHtml(u.fname)} ${escapeHtml(u.lname)}</td>
        <td><span class="type-pill ${typeClass}">${escapeHtml(u.type)}</span></td>
        <td>${escapeHtml(u.sid || "—")}</td>
        <td>${privCell}<div class="toggle-row" style="margin-top:6px">${privBtn}</div></td>
        <td><div class="toggle-row" style="gap:6px;flex-wrap:wrap">${accountBtns}</div></td>
      </tr>`;
    })
    .join("");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function toggleUserActive(email) {
  const users = await getDisplayUsers();
  const idx = users.findIndex((u) => u.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return;
  const u = users[idx];
  const next = u.accountStatus === "active" ? "inactive" : "active";
  if (u.type === "admin" && next === "inactive") {
    const others = users.filter(
      (x) =>
        x.type === "admin" &&
        x.accountStatus === "active" &&
        x.email.toLowerCase() !== email.toLowerCase()
    );
    if (others.length === 0) {
      alert("You cannot deactivate the last active administrator.");
      return;
    }
  }
  const key = email.toLowerCase();
  const overrides = readOverrides();
  overrides[key] = { ...(overrides[key] || {}), accountStatus: next };
  writeOverrides(overrides);
  await renderUserTable();
}

async function toggleAssistant(email) {
  const users = await getDisplayUsers();
  const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
  if (!u || u.type !== "student") return;
  const key = email.toLowerCase();
  const overrides = readOverrides();
  overrides[key] = { ...(overrides[key] || {}), staffPortalAccess: !u.staffPortalAccess };
  writeOverrides(overrides);
  await renderUserTable();
}

async function toggleStaffDeskLogin(email) {
  const users = await getDisplayUsers();
  const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
  if (!u || u.type !== "staff") return;
  const key = email.toLowerCase();
  const overrides = readOverrides();
  overrides[key] = { ...(overrides[key] || {}), staffPortalAccess: !u.staffPortalAccess };
  writeOverrides(overrides);
  await renderUserTable();
}

function openStaffModal() {
  const modal = document.getElementById("staff-modal");
  if (!modal) return;
  modal.classList.add("open");
  document.getElementById("nfname").value = "";
  document.getElementById("nlname").value = "";
  document.getElementById("nemail").value = "";
  document.getElementById("nsid").value = "";
  document.getElementById("npw").value = "";
  document.getElementById("ncpw").value = "";
  document.getElementById("staff-form-err").style.display = "none";
}

function closeStaffModal() {
  const modal = document.getElementById("staff-modal");
  if (modal) modal.classList.remove("open");
}

async function submitNewStaff() {
  const errEl = document.getElementById("staff-form-err");
  errEl.style.display = "none";
  const fname = document.getElementById("nfname").value.trim();
  const lname = document.getElementById("nlname").value.trim();
  const email = document.getElementById("nemail").value.trim();
  const sid = document.getElementById("nsid").value.trim();
  const password = document.getElementById("npw").value;
  const confirm = document.getElementById("ncpw").value;

  if (!fname || !lname) {
    errEl.textContent = "Enter the staff member's full name.";
    errEl.style.display = "block";
    return;
  }
  const em = validateStaffEmail(email);
  if (em.error) {
    errEl.textContent = em.error;
    errEl.style.display = "block";
    return;
  }
  const sidRes = validateStaffEmployeeId(sid);
  if (sidRes.error) {
    errEl.textContent = sidRes.error;
    errEl.style.display = "block";
    return;
  }
  const pwErr = validatePasswordPolicy(password);
  if (pwErr) {
    errEl.textContent = pwErr;
    errEl.style.display = "block";
    return;
  }
  if (password !== confirm) {
    errEl.textContent = "Passwords do not match.";
    errEl.style.display = "block";
    return;
  }

  const btn = document.querySelector("#staff-modal .modal-footer .btn-reserve");
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${apiBase()}/staff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fname,
        lname,
        email: em.normalized,
        sid: sidRes.normalized,
        password,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = data.message || "Could not create staff account.";
      errEl.style.display = "block";
      return;
    }
    closeStaffModal();
    await renderUserTable();
  } catch (e) {
    console.error(e);
    errEl.textContent = e.message || "Network error. Try again.";
    errEl.style.display = "block";
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openStaffPwModal(email) {
  document.getElementById("pw-reset-email").value = email;
  document.getElementById("pw-reset-for-email").textContent = "Account: " + email;
  document.getElementById("rpw").value = "";
  document.getElementById("rcpw").value = "";
  document.getElementById("pw-reset-err").style.display = "none";
  document.getElementById("reset-staff-pw-modal").classList.add("open");
}

function closeStaffPwModal() {
  document.getElementById("reset-staff-pw-modal").classList.remove("open");
}

async function submitStaffPwReset() {
  const errEl = document.getElementById("pw-reset-err");
  errEl.style.display = "none";
  const pw = document.getElementById("rpw").value.trim();
  const cpw = document.getElementById("rcpw").value.trim();
  const email = document.getElementById("pw-reset-email").value.trim();
  const pwErr = validatePasswordPolicy(pw);
  if (pwErr) {
    errEl.textContent = pwErr;
    errEl.style.display = "block";
    return;
  }
  if (pw !== cpw) {
    errEl.textContent = "Passwords do not match.";
    errEl.style.display = "block";
    return;
  }

  const btn = document.getElementById("reset-confirm-btn");
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${apiBase()}/staff`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.textContent = data.message || "Could not update password.";
      errEl.style.display = "block";
      return;
    }
    closeStaffPwModal();
  } catch (e) {
    console.error(e);
    errEl.textContent = e.message || "Network error.";
    errEl.style.display = "block";
  } finally {
    if (btn) btn.disabled = false;
  }
}

function logout() {
  sessionStorage.removeItem("xu_session");
  window.location.href = "LogIn.html";
}
