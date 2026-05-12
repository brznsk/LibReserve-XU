const { adminSetupAction } = require("./lib/authLogic");
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
    const r = await adminSetupAction(body);
    return {
      statusCode: r.statusCode,
      headers,
      body: JSON.stringify(r.json),
    };
  } catch (err) {
    console.error("admin-setup function error:", err.name, err.message || err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: "Could not create administrator. Check function logs." }),
    };
  }
};
