/** Set by js/xu-api-base.js (loaded before this file). */
const API_BASE =
  window.XU_API_BASE ||
  (console.warn("[LibReserve] Load js/xu-api-base.js before login.js; using http://127.0.0.1:3000/api"),
  "http://127.0.0.1:3000/api");

let currentType = "staff";

const ROLE_CONFIG = {
  admin: {
    label: "Administrator",
    sub: "Sign in with your administrator credentials",
    placeholder: "you@xu.edu.ph",
    footer: "hidden",
    badgeSvg:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  },
  staff: {
    label: "Library Staff",
    sub: "Library staff sign-in for the reservation desk.",
    placeholder: "you@xu.edu.ph or you@my.xu.edu.ph",
    footer: "staff",
    badgeSvg:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  },
  student: {
    label: "Student",
    sub: "Sign in with your registered student account",
    placeholder: "name@my.xu.edu.ph",
    footer: "student",
    badgeSvg:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5-10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
  },
};

function showLanding() {
  const land = document.getElementById("view-landing");
  const form = document.getElementById("view-form");
  land.classList.add("active");
  land.removeAttribute("hidden");
  form.classList.remove("active");
  form.setAttribute("hidden", "");
  const errEl = document.getElementById("error-msg");
  const okEl = document.getElementById("success-msg");
  if (errEl) errEl.style.display = "none";
  if (okEl) okEl.style.display = "none";
}

function openRoleForm(type) {
  currentType = type;
  const cfg = ROLE_CONFIG[type];
  if (!cfg) return;

  const land = document.getElementById("view-landing");
  const form = document.getElementById("view-form");
  land.classList.remove("active");
  land.setAttribute("hidden", "");
  form.classList.add("active");
  form.removeAttribute("hidden");

  document.getElementById("role-label").textContent = cfg.label;
  document.getElementById("role-sub").textContent = cfg.sub;
  document.getElementById("email").placeholder = cfg.placeholder;

  const iconWrap = document.getElementById("role-badge-icon");
  if (iconWrap) iconWrap.innerHTML = cfg.badgeSvg;

  const footer = document.getElementById("form-footer-links");
  if (footer) {
    if (cfg.footer === "hidden") {
      footer.style.display = "none";
    } else {
      footer.style.display = "block";
      footer.innerHTML =
        cfg.footer === "student"
          ? '<p>Don\'t have an account? <a href="Register.html">Create an account</a></p>'
          : '<p>Need student booking access? <a href="#" class="inline-switch" data-go="student">Use the Students sign-in</a></p>';
    }
  }

  const errEl = document.getElementById("error-msg");
  const okEl = document.getElementById("success-msg");
  if (errEl) errEl.style.display = "none";
  if (okEl) okEl.style.display = "none";
}

document.querySelector(".panel-right")?.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-go]");
  if (a?.getAttribute("data-go") === "student") {
    e.preventDefault();
    openRoleForm("student");
  }
});

async function handleLogin() {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const btn = document.getElementById("login-btn");

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) return showMsg("error", "Please enter both email and password.");

  btn.disabled = true;
  btn.textContent = "Verifying...";

  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.toLowerCase(),
        password: password,
        type: currentType,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      btn.disabled = false;
      btn.textContent = "Sign in";
      return showMsg("error", result.message || "Login failed.");
    }

    sessionStorage.setItem("xu_session", JSON.stringify(result));

    showMsg("success", "Access granted. Redirecting...");

    setTimeout(() => {
      if (result.type === "admin") {
        window.location.href = "AdminDashBoard.html";
      } else if (result.type === "staff") {
        window.location.href = "StaffDashBoard.html";
      } else {
        /* Students tile: same student UI for everyone (including assistants). Desk uses Library Staff sign-in. */
        window.location.href = "StudentDashBoard.html";
      }
    }, 650);
  } catch (err) {
    console.error("Login Error:", err);
    btn.disabled = false;
    btn.textContent = "Sign in";
    showMsg(
      "error",
      "Could not reach the server. Run the API locally (e.g. node js/server.js) and open this site over http://localhost."
    );
  }
}

function showMsg(type, text) {
  const errEl = document.getElementById("error-msg");
  const okEl = document.getElementById("success-msg");

  if (errEl) errEl.style.display = "none";
  if (okEl) okEl.style.display = "none";

  const target = type === "error" ? errEl : okEl;
  if (target) {
    target.textContent = text;
    target.style.display = "block";
  }
}
