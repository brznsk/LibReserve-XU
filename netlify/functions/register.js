const { registerAction } = require("./lib/authLogic");
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
    const r = await registerAction(body);
    return {
      statusCode: r.statusCode,
      headers,
      body: JSON.stringify(r.json),
    };
  } catch (err) {
    console.error("register function error:", err.name, err.message || err);
    if (err.name === "ValidationError") {
      const first = Object.values(err.errors || {})[0];
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: first?.message || "Registration failed. Check all fields.",
        }),
      };
    }
    if (err.code === 11000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ message: "Email already registered." }),
      };
    }
    if (err.code === "MISSING_MONGODB_URI") {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          message: err.message,
        }),
      };
    }
    const msg = String(err.message || "");
    if (msg.includes("MONGODB_URI")) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          message:
            "Database not configured. Set MONGODB_URI in Netlify (secret, **Functions** scope), redeploy, and confirm Atlas Network Access allows 0.0.0.0/0.",
        }),
      };
    }
    if (err.name === "MongoServerSelectionError" || err.name === "MongoNetworkError") {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          message:
            "Cannot reach MongoDB. Check Atlas Network Access (add 0.0.0.0/0), database user/password in MONGODB_URI, and that the cluster is running.",
        }),
      };
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message:
          "Registration failed (server). Check Netlify function logs for details, or try again later.",
      }),
    };
  }
};
