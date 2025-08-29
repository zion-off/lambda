export const handler = async () => {
  const orgsToSearch = process.env.ORGS_TO_SEARCH;
  const recipients = process.env.RECIPIENTS;
  const resend_api_key = process.env.RESEND_API_KEY;

  if (!orgsToSearch || !recipients || !resend_api_key) {
    console.error("Missing required environment variables");
    return;
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const requests = [];

  for (const org of orgsToSearch.split(",")) {
    const queryString =
      "q=" +
      encodeURIComponent(
        `is:issue state:open label:"good first issue" org:"${org}" no:assignee -linked:pr created:>${oneHourAgo}`
      );
    const request = fetch(
      `https://api.github.com/search/issues?q${queryString}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    requests.push(request);
  }

  const results = await Promise.all(requests);

  const body = [];

  results.map((result) => {
    if (!result.items) return;

    const orgRaw = result.items[0].repository_url.split("/")[4];
    const organization =
      orgRaw.charAt(0).toUpperCase() + orgRaw.slice(1).toLowerCase();
    body.push(`<h2>${organization}</h2>`);

    for (const item of result.items) {
      body.push(`<a href="${item.html_url}">${item.title}</a>`);
      if (item.body) body.push(`<p>${item.body}</p>`);
    }

    body.push("<br/>");
  });

  if (!body.length) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resend_api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Notifications <notifications@mail.zzzzion.com>",
        to: recipients.split(","),
        subject: "New good first issues",
        html: body.join("<br/>"),
      }),
    });
  } catch (error) {
    console.error("Error sending email:", error);
  }
};
