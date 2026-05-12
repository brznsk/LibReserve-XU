const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { getMongoUriOrThrow } = require("./mongoUri");

const userSchema = new mongoose.Schema({
  fname: { type: String, required: true },
  lname: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  type: { type: String, enum: ["admin", "staff", "student"], required: true },
  sid: String,
  accountStatus: { type: String, default: "active" },
  staffPortalAccess: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model("User", userSchema);

let connectPromise = null;

let builtinAdminSeedAttempted = false;

async function ensureBuiltinDemoAdminWhenConnected() {
  if (mongoose.connection.readyState !== 1) return;
  if (builtinAdminSeedAttempted) return;
  builtinAdminSeedAttempted = true;
  const email = "admin@xu.edu.ph";
  try {
    const exists = await User.findOne({ email });
    if (exists) return;
    const hashed = await bcrypt.hash("LibraryAdmin!24", 10);
    await User.create({
      fname: "Library",
      lname: "Administrator",
      email,
      password: hashed,
      type: "admin",
      accountStatus: "active",
    });
  } catch (e) {
    if (e && e.code === 11000) return;
    console.error("ensureBuiltinDemoAdmin:", e && e.message);
    builtinAdminSeedAttempted = false;
  }
}

async function ensureDb() {
  if (mongoose.connection.readyState === 1) {
    await ensureBuiltinDemoAdminWhenConnected();
    return;
  }
  const uri = getMongoUriOrThrow();
  if (!connectPromise) {
    connectPromise = mongoose.connect(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });
  }
  await connectPromise;
  await ensureBuiltinDemoAdminWhenConnected();
}

function sessionPayload(userDoc, responseType, loginRole) {
  const o = userDoc.toObject();
  delete o.password;
  o.type = responseType;
  o.loginRole = loginRole;
  return o;
}

async function loginAction(body) {
  const { email, password, type } = body;
  const emailLower = String(email || "").toLowerCase();

  if (type === "student") {
    const student = await User.findOne({ email: emailLower, type: "student" });
    if (student) {
      if (student.accountStatus === "inactive") {
        return { statusCode: 403, json: { message: "This account has been deactivated." } };
      }
      const ok = await bcrypt.compare(password, student.password);
      if (!ok) return { statusCode: 401, json: { message: "Invalid password." } };
      return { statusCode: 200, json: sessionPayload(student, "student", "student") };
    }

    if (/@my\.xu\.edu\.ph$/i.test(emailLower)) {
      const staff = await User.findOne({ email: emailLower, type: "staff" });
      if (staff) {
        if (staff.accountStatus === "inactive") {
          return { statusCode: 403, json: { message: "This account has been deactivated." } };
        }
        const okStaff = await bcrypt.compare(password, staff.password);
        if (!okStaff) return { statusCode: 401, json: { message: "Invalid password." } };
        return { statusCode: 200, json: sessionPayload(staff, "student", "staff") };
      }
    }

    return { statusCode: 401, json: { message: "Account not found for this role." } };
  }

  if (type === "staff") {
    const staffUser = await User.findOne({ email: emailLower, type: "staff" });
    if (staffUser) {
      if (staffUser.accountStatus === "inactive") {
        return { statusCode: 403, json: { message: "This account has been deactivated." } };
      }
      const ok = await bcrypt.compare(password, staffUser.password);
      if (!ok) return { statusCode: 401, json: { message: "Invalid password." } };
      return { statusCode: 200, json: sessionPayload(staffUser, "staff", "staff") };
    }
    const assistant = await User.findOne({
      email: emailLower,
      type: "student",
      staffPortalAccess: true,
    });
    if (assistant) {
      if (assistant.accountStatus === "inactive") {
        return { statusCode: 403, json: { message: "This account has been deactivated." } };
      }
      const okA = await bcrypt.compare(password, assistant.password);
      if (!okA) return { statusCode: 401, json: { message: "Invalid password." } };
      return { statusCode: 200, json: sessionPayload(assistant, "staff", "staff") };
    }
    return { statusCode: 401, json: { message: "Account not found for this role." } };
  }

  const user = await User.findOne({ email: emailLower, type });
  if (!user) {
    return { statusCode: 401, json: { message: "Account not found for this role." } };
  }
  if (user.accountStatus === "inactive") {
    return { statusCode: 403, json: { message: "This account has been deactivated." } };
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return { statusCode: 401, json: { message: "Invalid password." } };
  }

  const loginRole = type === "admin" ? "admin" : "staff";
  return { statusCode: 200, json: sessionPayload(user, type, loginRole) };
}

async function registerAction(body) {
  const { fname, lname, sid, email, password, type } = body || {};
  const emailLower = String(email || "")
    .trim()
    .toLowerCase();

  if (!emailLower || !String(fname || "").trim() || !String(lname || "").trim() || !password) {
    return {
      statusCode: 400,
      json: { message: "Please fill in all required fields (name, email, password)." },
    };
  }
  if (type !== "student") {
    return { statusCode: 400, json: { message: "Invalid account type for registration." } };
  }

  const existingUser = await User.findOne({ email: emailLower }).collation({
    locale: "en",
    strength: 2,
  });
  if (existingUser) {
    return { statusCode: 400, json: { message: "Email already registered." } };
  }

  const hashed = await bcrypt.hash(password, 10);

  const newUser = new User({
    fname: String(fname).trim(),
    lname: String(lname).trim(),
    sid: sid != null ? String(sid).trim() : undefined,
    email: emailLower,
    password: hashed,
    type: "student",
  });

  try {
    await newUser.save();
  } catch (e) {
    if (e && e.code === 11000) {
      return { statusCode: 400, json: { message: "Email already registered." } };
    }
    throw e;
  }

  return { statusCode: 201, json: sessionPayload(newUser, "student", "student") };
}

async function adminSetupAction(body) {
  const adminCount = await User.countDocuments({ type: "admin" });
  if (adminCount > 0) {
    return {
      statusCode: 403,
      json: { message: "An administrator already exists. Sign in from the login page." },
    };
  }

  const { fname, lname, email, password, type } = body || {};
  if (type !== "admin") {
    return { statusCode: 400, json: { message: "Invalid account type." } };
  }
  const emailLower = String(email || "")
    .trim()
    .toLowerCase();
  if (!emailLower || !/^[^\s@]+@xu\.edu\.ph$/i.test(emailLower)) {
    return {
      statusCode: 400,
      json: { message: "Administrator email must be your official @xu.edu.ph address." },
    };
  }
  if (!String(fname || "").trim() || !String(lname || "").trim() || !password) {
    return {
      statusCode: 400,
      json: { message: "Please fill in all required fields." },
    };
  }

  const existingUser = await User.findOne({ email: emailLower }).collation({
    locale: "en",
    strength: 2,
  });
  if (existingUser) {
    return { statusCode: 400, json: { message: "That email is already registered." } };
  }

  const hashed = await bcrypt.hash(password, 10);
  await User.create({
    fname: String(fname).trim(),
    lname: String(lname).trim(),
    email: emailLower,
    password: hashed,
    type: "admin",
  });

  return { statusCode: 201, json: { message: "Administrator created successfully." } };
}

function validatePasswordForStaff(pw) {
  if (!pw || pw.length < 12) return "Password must be at least 12 characters.";
  if (!/[a-z]/.test(pw)) return "Password must include at least one lowercase letter.";
  if (!/[A-Z]/.test(pw)) return "Password must include at least one uppercase letter.";
  if (!/[^A-Za-z0-9]/.test(pw)) {
    return "Password must include at least one special character (e.g. !@#$%).";
  }
  return null;
}

function normalizeStaffEmail(raw) {
  const email = String(raw || "").trim();
  if (!email) return { error: "Please enter an email address.", normalized: null };
  const lower = email.toLowerCase();
  if (!/^[^\s@]+@(?:xu\.edu\.ph|my\.xu\.edu\.ph)$/i.test(lower)) {
    return {
      error: "Staff email must be @xu.edu.ph or @my.xu.edu.ph.",
      normalized: null,
    };
  }
  return { error: null, normalized: lower };
}

function normalizeStaffEmployeeId(raw) {
  const id = String(raw || "").trim();
  if (!id) return { error: "Please enter Staff/Employee ID.", normalized: null };
  if (!/^[A-Za-z0-9-]{3,24}$/.test(id)) {
    return {
      error: "Staff/Employee ID must be 3–24 characters (letters, numbers, or hyphen only).",
      normalized: null,
    };
  }
  return { error: null, normalized: id };
}

async function createStaffAction(body) {
  const { fname, lname, email, sid, password } = body || {};
  if (!String(fname || "").trim() || !String(lname || "").trim()) {
    return { statusCode: 400, json: { message: "Enter first and last name." } };
  }
  const pwErr = validatePasswordForStaff(password);
  if (pwErr) return { statusCode: 400, json: { message: pwErr } };
  const em = normalizeStaffEmail(email);
  if (em.error) return { statusCode: 400, json: { message: em.error } };
  const sidNorm = normalizeStaffEmployeeId(sid);
  if (sidNorm.error) return { statusCode: 400, json: { message: sidNorm.error } };

  const existingUser = await User.findOne({ email: em.normalized }).collation({
    locale: "en",
    strength: 2,
  });
  if (existingUser) {
    return { statusCode: 400, json: { message: "That email is already registered." } };
  }

  const hashed = await bcrypt.hash(password, 10);
  try {
    await User.create({
      fname: String(fname).trim(),
      lname: String(lname).trim(),
      email: em.normalized,
      sid: sidNorm.normalized,
      password: hashed,
      type: "staff",
      staffPortalAccess: false,
      accountStatus: "active",
    });
  } catch (e) {
    if (e && e.code === 11000) {
      return { statusCode: 400, json: { message: "That email is already registered." } };
    }
    throw e;
  }
  return { statusCode: 201, json: { message: "Staff account created." } };
}

async function patchStaffPasswordAction(body) {
  const { email, password } = body || {};
  const pwErr = validatePasswordForStaff(password);
  if (pwErr) return { statusCode: 400, json: { message: pwErr } };
  const emailLower = String(email || "").trim().toLowerCase();
  if (!emailLower) return { statusCode: 400, json: { message: "Missing account email." } };

  const user = await User.findOne({ email: emailLower, type: "staff" });
  if (!user) {
    return { statusCode: 404, json: { message: "Staff account not found for that email." } };
  }
  user.password = await bcrypt.hash(password, 10);
  await user.save();
  return { statusCode: 200, json: { message: "Password updated." } };
}

async function usersAction() {
  const users = await User.find({}, "-password");
  return { statusCode: 200, json: users };
}

async function withDb(fn) {
  await ensureDb();
  return fn();
}

module.exports = {
  loginAction: (body) => withDb(() => loginAction(body)),
  registerAction: (body) => withDb(() => registerAction(body)),
  adminSetupAction: (body) => withDb(() => adminSetupAction(body)),
  createStaffAction: (body) => withDb(() => createStaffAction(body)),
  patchStaffPasswordAction: (body) => withDb(() => patchStaffPasswordAction(body)),
  usersAction: () => withDb(() => usersAction()),
  ensureBuiltinDemoAdminWhenConnected,
};
