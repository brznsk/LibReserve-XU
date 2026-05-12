const { loginAction } = require("./lib/authLogic");
const { parseJsonBody } = require("./lib/parseEventBody");

const headers = {
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
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
    if (String(err.message || "").includes("MONGODB_URI")) {
      message =
        "Database not configured: add MONGODB_URI in Netlify → Environment variables, then redeploy.";
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message }),
    };
  }
};
