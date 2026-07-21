/**
 * PUBLIC WEBSITE CONFIGURATION
 *
 * This file is visible to everyone. Never put a GitHub token, password,
 * private key, or other secret here.
 */
window.DOWNLOAD_PORTAL_CONFIG = {
  brandName: "CodeVault",
  pageTitle: "CodeVault Downloads",
  githubOwner: "redmarine84",
  githubRepository: "AppDownload.github.io",
  defaultBranch: "master",
  supportEmail: "redhead_usmc@yahoo.com",
  aboutText:
    "This download portal contains independently developed Windows applications, utilities, reporting tools, and workflow solutions. Each release is hosted through GitHub Releases for dependable delivery and transparent version history.",

  // Demo cards are shown only when the repository has no compatible releases
  // or while you are first configuring the site.
  showDemoAppsWhenEmpty: true,

  // GitHub's currently documented REST API version.
  githubApiVersion: "2026-03-10"
};
