async function searchAndNotify(env) {
  const orgsToSearch = env.ORGS_TO_SEARCH;
  const recipients = env.RECIPIENTS;
  const resend_api_key = env.RESEND_API_KEY;
  const github_api_key = env.GITHUB_TOKEN;

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
            "User-Agent": "cloudflare-worker",
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
          const borderStyle = isLastIssue
            ? ""
            : "border-bottom: 1px solid #e8e8e8;";

          return `
          <div style="margin-bottom: ${
            isLastIssue ? "0" : "36px"
          }; padding-bottom: ${isLastIssue ? "0" : "36px"}; ${borderStyle}">
            <h3 style="margin: 0 0 12px 0; font-family: 'Baskerville', 'Georgia', 'Times New Roman', serif; font-size: 20px; font-weight: 400; line-height: 1.4;">
              <a href="${
                item.html_url
              }" style="color: #000000; text-decoration: none; border-bottom: 1px solid #000000;">
                ${item.title}
              </a>
            </h3>
            <div style="margin-bottom: 14px; font-family: 'Courier New', 'Courier', monospace; font-size: 11px; color: #666666; letter-spacing: 0.03em;">
              <span style="color: #000000;">${repoName}</span>
              ${
                item.comments > 0
                  ? `<span style="margin: 0 8px;">—</span><span>${
                      item.comments
                    } comment${item.comments !== 1 ? "s" : ""}</span>`
                  : ""
              }
            </div>
            <p style="margin: 0; font-family: 'Georgia', 'Times New Roman', serif; font-size: 16px; color: #1a1a1a; line-height: 1.7;">
              ${truncatedBody
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\n/g, "<br/>")}
            </p>
          </div>
        `;
        })
        .join("");

      issuesByOrg.push({ organization, issues });
    });

    const totalIssues = issuesByOrg.reduce(
      (sum, org) => sum + org.issues.split("<div style=").length - 1,
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
        <body style="margin: 0; padding: 0; font-family: 'Baskerville', 'Georgia', 'Times New Roman', serif; background: #f8f8f6; min-height: 100vh;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #f8f8f6;">
            <tr>
              <td style="padding: 60px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #000000;">

                  <!-- Masthead -->
                  <tr>
                    <td style="padding: 48px 56px 40px 56px; border-bottom: 3px double #000000;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td style="text-align: center;">
                            <div style="margin-bottom: 8px;">
                              <span style="font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 400; color: #000000;">Issue Digest</span>
                            </div>
                            <h1 style="margin: 0 0 12px 0; font-family: 'Baskerville', 'Georgia', 'Times New Roman', serif; font-size: 42px; font-weight: 400; color: #000000; letter-spacing: -0.01em; line-height: 1.1; font-style: italic;">
                              Good First Issues
                            </h1>
                            <div style="width: 48px; height: 1px; background: #000000; margin: 16px auto 16px auto;"></div>
                            <p style="margin: 0; font-family: 'Georgia', 'Times New Roman', serif; font-size: 14px; color: #000000; line-height: 1.6;">
                              ${totalIssues} ${issueWord} · Last hour
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Content -->
                  <tr>
                    <td style="padding: 48px 56px;">
                      ${issuesByOrg
                        .map(
                          ({ organization, issues }, index) => `
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: ${
                          index === issuesByOrg.length - 1 ? "0" : "56px"
                        };">
                          <tr>
                            <td>
                              <div style="margin-bottom: 32px; padding-bottom: 12px; border-bottom: 1px solid #000000;">
                                <h2 style="margin: 0; font-family: 'Baskerville', 'Georgia', 'Times New Roman', serif; font-size: 24px; font-weight: 400; color: #000000; letter-spacing: 0.02em;">
                                  ${organization}
                                </h2>
                              </div>
                              ${issues}
                            </td>
                          </tr>
                        </table>
                      `
                        )
                        .join("")}
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="padding: 32px 56px 48px 56px; border-top: 1px solid #e8e8e8;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td style="text-align: center;">
                            <p style="margin: 0; font-family: 'Georgia', 'Times New Roman', serif; font-size: 12px; color: #999999; line-height: 1.7;">
                              ✦
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

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

export default {
  async fetch(_request, env, _ctx) {
    const result = await searchAndNotify(env);
    return new Response(JSON.stringify(result), {
      status: result.error ? 500 : 200,
      headers: { "Content-Type": "application/json" },
    });
  },

  async scheduled(_event, env, _ctx) {
    await searchAndNotify(env);
  },
};
