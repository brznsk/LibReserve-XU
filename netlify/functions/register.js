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
    if (String(err.message || "").includes("MONGODB_URI")) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          message:
            "Database not configured. Set MONGODB_URI for Functions in Netlify, then redeploy.",
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
