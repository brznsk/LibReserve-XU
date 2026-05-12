async function doRegister() {
  const fname = document.getElementById("fname").value.trim();
  const lname = document.getElementById("lname").value.trim();
  const sid = document.getElementById("sid").value.trim();
  const email = document.getElementById("email").value.trim();
  const pw = document.getElementById("pw").value;
  const cpw = document.getElementById("cpw").value;
  const btn = document.getElementById("reg-btn");

  if (!fname || !lname) return showAlert("error", "Please enter your first and last name.");

  const sidRes = validateStudentSchoolId(sid);
  if (sidRes.error) return showAlert("error", sidRes.error);

  const emailRes = validateStudentEmail(email);
  if (emailRes.error) return showAlert("error", emailRes.error);

  const pwErr = validatePasswordPolicy(pw);
  if (pwErr) return showAlert("error", pwErr);

  if (pw !== cpw) return showAlert("error", "Passwords do not match.");

  btn.disabled = true;
  btn.textContent = "Saving to Database...";

  try {
    const response = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fname,
        lname,
        sid: sidRes.normalized,
        email: emailRes.normalized,
        password: pw,
        type: "student",
      }),
    });

    let result = {};
    try {
      result = await response.json();
    } catch (_) {
      if (!response.ok) {
        throw new Error(
          "Server returned " +
            response.status +
            " with no JSON body. If this is Netlify, check Functions logs and MONGODB_URI (Functions scope + redeploy)."
        );
      }
    }

    if (!response.ok) {
      throw new Error(
        result.message ||
          (response.status === 503
            ? "Service unavailable (often missing MONGODB_URI for Functions or MongoDB unreachable). Check Netlify env + Atlas."
            : "Registration failed.")
      );
    }

    sessionStorage.setItem("xu_session", JSON.stringify(result));
    showAlert("success", "Welcome! Taking you to your dashboard...");
    setTimeout(() => {
      window.location.href = "StudentDashBoard.html";
    }, 600);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Create Account";
    showAlert("error", err.message);
  }
}

function showAlert(type, text) {
  const errEl = document.getElementById("err");
  const okEl = document.getElementById("suc");
  if (errEl) errEl.style.display = "none";
  if (okEl) okEl.style.display = "none";
  const target = type === "error" ? errEl : okEl;
  if (target) {
    target.textContent = text;
    target.style.display = "block";
  }
}
