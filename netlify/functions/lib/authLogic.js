/**
 * Keep in sync with js/server.js login / register / users behavior.
 */
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

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

async function ensureDb() {
  if (mongoose.connection.readyState === 1) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in Netlify environment variables.");
  if (!connectPromise) {
    connectPromise = mongoose.connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 15000,
    });
  }
  await connectPromise;
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
  usersAction: () => withDb(() => usersAction()),
};
