const { loginAction } = require("./lib/authLogic");
const { parseJsonBody } = require("./lib/parseEventBody");

const headers = {
  "Content-Type": "application/json",
};

exports.handler = async (event, context) => {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: "Method not allowed" }),
    };
  }
  try {
    const body = parseJsonBody(event);
    const r = await loginAction(body);
    return {
      statusCode: r.statusCode,
      headers,
      body: JSON.stringify(r.json),
    };
  } catch (err) {
    console.error("login function error:", err.message || err);
    let message = "Server error during login.";
    if (err.code === "MISSING_MONGODB_URI" || String(err.message || "").includes("MONGODB_URI")) {
      message =
        "Database not configured: add MONGODB_URI in Netlify (secret, **Functions** scope), redeploy, and allow Atlas from 0.0.0.0/0.";
    } else if (err.name === "MongoServerSelectionError" || err.name === "MongoNetworkError") {
      message =
        "Cannot reach MongoDB. Check Atlas IP allowlist and MONGODB_URI (user/password, cluster host).";
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message }),
    };
  }
};
