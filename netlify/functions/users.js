const { usersAction, patchUserAction } = require("./lib/authLogic");
const { parseJsonBody } = require("./lib/parseEventBody");

const headers = {
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "GET" && event.httpMethod !== "PATCH") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ message: "Method not allowed" }),
    };
  }
  try {
    const r =
      event.httpMethod === "PATCH" ? await patchUserAction(parseJsonBody(event)) : await usersAction();
    return {
      statusCode: r.statusCode,
      headers,
      body: JSON.stringify(r.json),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: "Could not fetch users." }),
    };
  }
};
