const { createStaffAction, patchStaffPasswordAction } = require("./lib/authLogic");
const { parseJsonBody } = require("./lib/parseEventBody");

const headers = {
  "Content-Type": "application/json",
};

exports.handler = async (event, context) => {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  try {
    if (event.httpMethod === "POST") {
      const body = parseJsonBody(event);
      const r = await createStaffAction(body);
      return {
        statusCode: r.statusCode,
        headers,
        body: JSON.stringify(r.json),
      };
    }
    if (event.httpMethod === "PATCH") {
      const body = parseJsonBody(event);
      const r = await patchStaffPasswordAction(body);
      return {
        statusCode: r.statusCode,
        headers,
        body: JSON.stringify(r.json),
      };
    }
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: "Method not allowed" }),
    };
  } catch (err) {
    console.error("staff function:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: "Staff request failed. Check function logs." }),
    };
  }
};
