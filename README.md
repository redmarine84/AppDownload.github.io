# AppDownload.github.io
Websidte create to host all my created applications for anyone to download.
Enjoy!
App Download Portal
A responsive, tech-themed static website that displays software from GitHub Releases and includes a private publisher page for creating releases and uploading application files.
Included files
```text
index.html                 Public download catalog
admin.html                 Private release publisher (not linked publicly)
assets/css/styles.css      Complete responsive theme
assets/js/config.js        Public site configuration
assets/js/app.js           GitHub Releases catalog loader
assets/js/admin.js         Authenticated release uploader
.nojekyll                  Disables Jekyll processing on GitHub Pages
```
1. Create or choose a GitHub repository
Use a public repository for the website and releases. GitHub Pages can publish the website, while GitHub Releases stores the downloadable `.exe`, `.msi`, `.zip`, documentation, and checksum files.
2. Configure the site
Open `assets/js/config.js` and change:
```js
githubOwner: "redmarine84",
githubRepository: "redmarine84/AppDownload.github.io",
defaultBranch: "master",
supportEmail: "redhead_usmc@yahoo.com"
```
You may also change the brand name and About text there.
Never put a token in `config.js`. Everything in a GitHub Pages repository is public to site visitors.
3. Publish with GitHub Pages
Upload all files and folders to the repository root.
Open the repository on GitHub.
Select Settings → Pages.
Under Build and deployment, select Deploy from a branch.
Choose the `main` branch and `/ (root)` folder.
Save and wait for the Pages deployment to complete.
The public website will be:
```text
https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY_NAME/
```
For a username repository named `YOUR_GITHUB_USERNAME.github.io`, the URL is:
```text
https://YOUR_GITHUB_USERNAME.github.io/
```
4. Create the fine-grained GitHub token
Create a dedicated token only for publishing application releases:
GitHub profile picture → Settings.
Developer settings.
Personal access tokens → Fine-grained tokens.
Select Generate new token.
Give it a short expiration date you are comfortable renewing.
Under Repository access, choose Only select repositories.
Select only the repository used by this portal.
Under Repository permissions, set Contents to Read and write.
Generate and securely copy the token.
The GitHub Releases API and release asset upload API require `Contents: write` for a fine-grained token.
5. Upload an application from the website
Open:
```text
https://YOUR_SITE_URL/admin.html
```
Then:
Paste the fine-grained token.
Select Test Connection.
Enter the application name, version, category, description, and release notes.
Choose one or more application files.
Select Publish Release & Upload Files.
The token stays only in the current browser tab's JavaScript memory. It is not written to local storage, session storage, cookies, `config.js`, or the repository. Closing or reloading the page clears it.
Important security notes
Static GitHub Pages cannot truly password-protect `admin.html`. The real authorization is the GitHub token; without a valid token with write access, a visitor cannot publish anything.
Do not link `admin.html` in your public navigation. This starter does not link it.
Use the publisher only from a computer and browser you trust.
Never save the token in browser password managers, screenshots, source files, or chat messages.
Give the token access to only this one repository and only the minimum `Contents: Read and write` permission.
Use an expiration date and revoke the token immediately if it may have been exposed.
For stronger security later, move publishing behind a serverless backend or use GitHub Actions with stored repository secrets.
How the application catalog works
The publisher creates a GitHub Release with a small JSON metadata block inside the release description. The public site:
Fetches public releases through the GitHub REST API.
Reads the metadata block.
Groups releases by application slug.
Displays the newest release for each application.
Uses attached release assets as download buttons.
Displays GitHub's download counts.
Do not remove the hidden `DOWNLOAD_PORTAL_META` block from release descriptions created by the publisher.
Demo mode
Until the configured repository contains compatible releases, the public site displays three demo application cards. To turn demo mode off, change this in `assets/js/config.js`:
```js
showDemoAppsWhenEmpty: false
```
File size
GitHub release assets must each be smaller than 2 GiB. GitHub currently permits up to 1,000 assets per release and does not impose a total release size or release bandwidth limit.
Local preview
Because the catalog uses `fetch`, preview through a local web server instead of double-clicking `index.html`:
```bash
python -m http.server 8080
```
Then open:
```text
http://localhost:8080
```
