package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
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

type githubIssue struct {
	Title         string `json:"title"`
	HTMLURL       string `json:"html_url"`
	RepositoryURL string `json:"repository_url"`
	Body          string `json:"body"`
	Comments      int    `json:"comments"`
}

type githubSearchResult struct {
	Items []githubIssue `json:"items"`
}

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

func fetchOpenIssues(org string, c chan *githubSearchResult, wg *sync.WaitGroup) {
	defer wg.Done()

	since := time.Now().Add(-1 * time.Hour).Format(time.RFC3339Nano)
	query := "q=" + url.QueryEscape(fmt.Sprintf(`is:issue state:open label:"good first issue" org:"%s" no:assignee -linked:pr created:>%s`, org, since))
	endpoint := "https://api.github.com/search/issues?" + query
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		log.Printf("error creating request for org %s: %v", org, err)
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", githubAPIKey))
	req.Header.Set("User-Agent", "aws-lambda")

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("error fetching issues for org %s: %v", org, err)
		return
	}

	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("HTTP request failed for org %s with status %d: %s", org, resp.StatusCode, string(body))
		return
	}

	var res githubSearchResult
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		log.Printf("error decoding response for org %s: %v", org, err)
		return
	}
	c <- &res
}

func generateIssueRow(item githubIssue, isLastIssue bool) string {
	parts := strings.Split(item.RepositoryURL, "/")
	repoName := parts[len(parts)-1]

	var truncatedBody string
	if item.Body != "" {
		if len(item.Body) > 200 {
			truncatedBody = item.Body[:200] + "..."
		} else {
			truncatedBody = item.Body
		}
	} else {
		truncatedBody = "No description provided"
	}

	truncatedBody = strings.ReplaceAll(truncatedBody, "<", "&lt;")
	truncatedBody = strings.ReplaceAll(truncatedBody, ">", "&gt;")
	truncatedBody = strings.ReplaceAll(truncatedBody, "\n", " ")

	paddingStyle := "0 0 28px 0"
	if isLastIssue {
		paddingStyle = "0"
	}

	commentStr := ""
	if item.Comments > 0 {
		plural := "s"
		if item.Comments == 1 {
			plural = ""
		}
		commentStr = fmt.Sprintf(" &middot; %d comment%s", item.Comments, plural)
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
    </tr>`, paddingStyle, repoName, commentStr, item.HTMLURL, item.Title, truncatedBody)
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

func toOrgIssues(r *githubSearchResult) (OrgIssues, bool) {
	if len(r.Items) == 0 {
		return OrgIssues{}, false
	}

	parts := strings.Split(r.Items[0].RepositoryURL, "/")
	if len(parts) <= 4 {
		return OrgIssues{}, false
	}

	var issues []string
	for i, issue := range r.Items {
		issues = append(issues, generateIssueRow(issue, i == len(r.Items)-1))
	}

	return OrgIssues{Org: parts[4], issues: strings.Join(issues, ""), count: len(r.Items)}, true
}

func searchAndNotify() error {
	if err := checkEnvVars(); err != nil {
		return err
	}

	orgs := strings.Split(orgsToSearch, ", ")
	res := make(chan *githubSearchResult, len(orgs))

	var wg sync.WaitGroup

	for _, org := range orgs {
		wg.Add(1)
		go fetchOpenIssues(org, res, &wg)
	}

	go func() {
		wg.Wait()
		close(res)
	}()

	issuesByOrg := []OrgIssues{}
	totalIssues := 0

	for r := range res {
		if orgIssues, ok := toOrgIssues(r); ok {
			totalIssues += orgIssues.count
			issuesByOrg = append(issuesByOrg, orgIssues)
		}
	}

	if len(issuesByOrg) == 0 {
		return nil
	}

	emailBody := generateEmailBody(issuesByOrg, totalIssues)

	plural := "s"
	if totalIssues == 1 {
		plural = ""
	}
	subject := fmt.Sprintf("%d new good first issue%s", totalIssues, plural)
	return sendEmail(subject, emailBody)
}

func main() {
	lambda.Start(searchAndNotify)
}
