async function searchAndNotify() {
  const orgsToSearch = process.env.ORGS_TO_SEARCH;
  const recipients = process.env.RECIPIENTS;
  const resend_api_key = process.env.RESEND_API_KEY;
  const github_api_key = process.env.GITHUB_TOKEN;

  if (!orgsToSearch || !recipients || !resend_api_key) {
    console.error("Missing required environment variables");
    return { error: "Missing required environment variables" };
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
        `https://api.github.com/search/issues?${queryString}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            Authorization: `Bearer ${github_api_key}`,
            "User-Agent": "aws-lambda",
          },
        }
      );
      requests.push(request);
    }

    const responses = await Promise.all(requests);

    const results = await Promise.all(
      responses.map(async (response) => {
        if (!response.ok) {
          console.error(
            `GitHub API error: ${response.status} ${response.statusText}`
          );
          return null;
        }
        return await response.json();
      })
    );

  // Check if any requests failed
  if (results.some((result) => result === null)) {
    return {
      error: "GitHub API request failed",
      details: "One or more GitHub API requests returned an error",
    };
  }

    const issuesByOrg = [];

    results.forEach((result) => {
      if (!result || !result.items || result.items.length === 0) return;

      const orgRaw = result.items[0].repository_url.split("/")[4];
      const organization =
        orgRaw.charAt(0).toUpperCase() + orgRaw.slice(1).toLowerCase();

      const issues = result.items
        .map((item, index) => {
          const repoName = item.repository_url.split("/").pop();
          const truncatedBody = item.body
            ? item.body.length > 200
              ? item.body.substring(0, 200) + "..."
              : item.body
            : "No description provided";

          const isLastIssue = index === result.items.length - 1;

          return `
          <tr>
            <td style="padding: ${isLastIssue ? "0" : "0 0 28px 0"};">
              <p style="margin: 0 0 6px 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 500; color: #999; letter-spacing: 0.08em; text-transform: uppercase;">
                ${repoName}${item.comments > 0 ? ` &middot; ${item.comments} comment${item.comments !== 1 ? "s" : ""}` : ""}
              </p>
              <a href="${item.html_url}" style="font-family: Georgia, 'Times New Roman', serif; font-size: 17px; color: #111; text-decoration: none; line-height: 1.45;">${item.title}</a>
              <p style="margin: 6px 0 0 0; font-family: Georgia, 'Times New Roman', serif; font-size: 14px; color: #777; line-height: 1.55;">
                ${truncatedBody
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/\n/g, " ")}
              </p>
            </td>
          </tr>`;
        })
        .join("");

      issuesByOrg.push({ organization, issues, count: result.items.length });
    });

    const totalIssues = issuesByOrg.reduce(
      (sum, org) => sum + org.count,
      0
    );

    const issueWord = totalIssues === 1 ? "opportunity" : "opportunities";

    const emailBody = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background: #ffffff;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #ffffff;">
            <tr>
              <td style="padding: 32px 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 520px; margin: 0 auto;">

                  <!-- Header -->
                  <tr>
                    <td style="padding: 0 0 24px 0;">
                      <p style="margin: 0 0 2px 0; font-family: Georgia, 'Times New Roman', serif; font-size: 16px; color: #111; font-style: italic; line-height: 1.3;">Good First Issues</p>
                      <p style="margin: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #aaa; letter-spacing: 0.02em;">${totalIssues} ${issueWord} from the last hour</p>
                    </td>
                  </tr>

                  <!-- Divider -->
                  <tr><td style="height: 1px; background: #e5e5e5; font-size: 0; line-height: 0;">&nbsp;</td></tr>

                  <!-- Content -->
                  ${issuesByOrg
                    .map(
                      ({ organization, issues }, index) => `
                  <tr>
                    <td style="padding: 20px 0 0 0;">
                      <p style="margin: 0 0 14px 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 600; color: #bbb; letter-spacing: 0.1em; text-transform: uppercase;">${organization}</p>
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        ${issues}
                      </table>
                    </td>
                  </tr>
                  ${index < issuesByOrg.length - 1 ? '<tr><td style="padding-top: 20px; height: 1px;"><div style="height: 1px; background: #f0f0f0;"></div></td></tr>' : ""}
                  `
                    )
                    .join("")}

                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

  if (!issuesByOrg.length) {
    return { message: "No new issues found" };
  }

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
        html: emailBody,
      }),
    });
  } catch (error) {
    console.error("Error sending email:", error);
  }

  return { success: true };
}

export const handler = async (event) => {
  const result = await searchAndNotify();

  return {
    statusCode: result.error ? 500 : 200,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(result),
  };
};
