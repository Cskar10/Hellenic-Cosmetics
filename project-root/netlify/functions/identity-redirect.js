exports.handler = async (event, context) => {
  if (!context.clientContext || !context.clientContext.identity) {
    return {
      statusCode: 302,
      headers: {
        Location: "/login.html"  // redirect if not logged in
      }
    };
  }
  return {
    statusCode: 200,
    body: "ok"
  };
};
