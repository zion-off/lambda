package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
)

var (
	orgsToSearch string       = os.Getenv("ORGS_TO_SEARCH")
	recipients   string       = os.Getenv("RECIPIENTS")
	resendAPIKey string       = os.Getenv("RESEND_API_KEY")
	githubAPIKey string       = os.Getenv("GITHUB_TOKEN")
	client       *http.Client = &http.Client{}
)

type OrgIssues struct {
	Org    string
	issues string
	count  int
}

func checkEnvVars() error {
	if orgsToSearch == "" || recipients == "" || resendAPIKey == "" || githubAPIKey == "" {
		return errors.New("missing required environment variables")
	}
	return nil
}

func fetchOpenIssues(org string, c chan map[string]any, wg *sync.WaitGroup) {
	defer wg.Done()

	since := time.Now().Add(-1 * time.Hour).Format(time.RFC3339Nano)
	query := "q=" + url.QueryEscape(fmt.Sprintf(`is:issue state:open label:"good first issue" org:"%s" no:assignee -linked:pr created:>%s`, org, since))
	endpoint := "https://api.github.com/search/issues?" + query
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		c <- map[string]any{"error": err.Error()}
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", githubAPIKey))
	req.Header.Set("User-Agent", "aws-lambda")

	resp, err := client.Do(req)
	if err != nil {
		c <- map[string]any{"error": err.Error()}
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		c <- map[string]any{"error": fmt.Errorf("HTTP request failed with status %d: %s", resp.StatusCode, string(body))}
	}

	res := make(map[string]any)
	json.NewDecoder(resp.Body).Decode(&res)
	c <- res
}

func generateIssueRow(item any, isLastIssue bool) string {
	itemMap, ok := item.(map[string]any)
	if !ok {
		return ""
	}

	repoURL, _ := itemMap["repository_url"].(string)
	parts := strings.Split(repoURL, "/")
	repoName := parts[len(parts)-1]

	var truncatedBody string
	if body, ok := itemMap["body"].(string); ok && body != "" {
		if len(body) > 200 {
			truncatedBody = body[:200] + "..."
		} else {
			truncatedBody = body
		}
	} else {
		truncatedBody = "No description provided"
	}

	truncatedBody = strings.ReplaceAll(truncatedBody, "<", "&lt;")
	truncatedBody = strings.ReplaceAll(truncatedBody, ">", "&gt;")
	truncatedBody = strings.ReplaceAll(truncatedBody, "\n", " ")

	htmlURL, _ := itemMap["html_url"].(string)
	title, _ := itemMap["title"].(string)
	comments, _ := itemMap["comments"].(float64)

	paddingStyle := "0 0 28px 0"
	if isLastIssue {
		paddingStyle = "0"
	}

	commentStr := ""
	if comments > 0 {
		plural := "s"
		if comments == 1 {
			plural = ""
		}
		commentStr = fmt.Sprintf(" &middot; %d comment%s", int(comments), plural)
	}

	return fmt.Sprintf(`
    <tr>
      <td style="padding: %s;">
        <p style="margin: 0 0 6px 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 500; color: #999; letter-spacing: 0.08em; text-transform: uppercase;">
          %s%s
        </p>
        <a href="%s" style="font-family: Georgia, 'Times New Roman', serif; font-size: 17px; color: #111; text-decoration: none; line-height: 1.45;">%s</a>
        <p style="margin: 6px 0 0 0; font-family: Georgia, 'Times New Roman', serif; font-size: 14px; color: #777; line-height: 1.55;">
          %s
        </p>
      </td>
    </tr>`, paddingStyle, repoName, commentStr, htmlURL, title, truncatedBody)
}

func generateEmailBody(issuesByOrg []OrgIssues, totalIssues int) string {
	issueWord := "opportunities"
	if totalIssues == 1 {
		issueWord = "opportunity"
	}

	var contentBuilder strings.Builder
	for i, orgItem := range issuesByOrg {
		divider := ""
		if i < len(issuesByOrg)-1 {
			divider = `<tr><td style="padding-top: 20px; height: 1px;"><div style="height: 1px; background: #f0f0f0;"></div></td></tr>`
		}

		contentBuilder.WriteString(fmt.Sprintf(`
                <tr>
                  <td style="padding: 20px 0 0 0;">
                    <p style="margin: 0 0 14px 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 600; color: #bbb; letter-spacing: 0.1em; text-transform: uppercase;">%s</p>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%">
                      %s
                    </table>
                  </td>
                </tr>
                %s`, orgItem.Org, orgItem.issues, divider))
	}

	return fmt.Sprintf(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background: #ffffff;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="background: #ffffff;">
          <tr>
            <td style="padding: 32px 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="max-width: 520px; margin: 0 auto;">

                <!-- Header -->
                <tr>
                  <td style="padding: 0 0 24px 0;">
                    <p style="margin: 0 0 2px 0; font-family: Georgia, 'Times New Roman', serif; font-size: 16px; color: #111; font-style: italic; line-height: 1.3;">Good First Issues</p>
                    <p style="margin: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #aaa; letter-spacing: 0.02em;">%d %s from the last hour</p>
                  </td>
                </tr>

                <!-- Divider -->
                <tr><td style="height: 1px; background: #e5e5e5; font-size: 0; line-height: 0;">&nbsp;</td></tr>

                <!-- Content -->
                %s

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `, totalIssues, issueWord, contentBuilder.String())
}

func sendEmail(subject, body string) error {
	payload := map[string]any{
		"from":    "Notifications <notifications@mail.zzzzion.com>",
		"to":      strings.Split(recipients, ","),
		"subject": subject,
		"html":    body,
	}

	json, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewBuffer(json))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", resendAPIKey))

	resp, err := client.Do(req)
	if err != nil {
		return err
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to send email with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

func searchAndNotify() error {
	if err := checkEnvVars(); err != nil {
		return err
	}

	res := make(chan map[string]any, len(orgsToSearch))
	orgs := strings.Split(orgsToSearch, ", ")

	var wg sync.WaitGroup

	for _, org := range orgs {
		wg.Add(1)
		go fetchOpenIssues(org, res, &wg)
	}

	wg.Wait()

	issuesByOrg := []OrgIssues{}
	totalIssues := 0

	for r := range res {
		if _, ok := r["error"]; ok {
			continue
		}

		items, ok := r["items"].([]any)
		if !ok || len(items) == 0 {
			continue
		}

		item, ok := items[0].(map[string]any)
		if !ok {
			continue
		}

		issues := []string{}

		for i, issue := range items {
			issues = append(issues, generateIssueRow(issue, i == len(items)-1))
			totalIssues++
		}

		url, ok := item["repository_url"].(string)
		if !ok {
			continue
		}

		parts := strings.Split(url, "/")

		if len(parts) > 4 {
			continue
		}

		org := parts[4]

		issuesByOrg = append(issuesByOrg, OrgIssues{Org: org, issues: strings.Join(issues, ""), count: len(items)})
	}

	if len(issuesByOrg) == 0 {
		return nil
	}

	emailBody := generateEmailBody(issuesByOrg, totalIssues)

	go sendEmail(fmt.Sprintf("%d new good first issue%s", totalIssues, func() string {
		if totalIssues > 1 {
			return "s"
		}
		return ""
	}()), emailBody)
	return nil
}

func main() {
	lambda.Start(searchAndNotify)
}
