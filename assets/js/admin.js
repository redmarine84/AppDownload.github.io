(() => {
  "use strict";

  const config = window.DOWNLOAD_PORTAL_CONFIG || {};
  const API_BASE = "https://api.github.com";
  const API_VERSION = config.githubApiVersion || "2026-03-10";
  const MAX_ASSET_SIZE = 2 * 1024 * 1024 * 1024;

  let token = "";
  let connectedUser = null;
  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    applyConfiguration();
    bindEvents();
  }

  function cacheElements() {
    [
      "github-token", "toggle-token", "connect-button", "connection-status", "configured-repo",
      "release-form", "app-name", "app-slug", "version", "category", "platform", "icon",
      "summary", "description", "requirements", "release-notes", "release-files", "file-drop",
      "file-list", "prerelease", "latest", "publish-button", "publish-progress", "progress-label",
      "progress-percent", "progress-bar", "publish-log", "form-message", "recent-releases",
      "refresh-releases"
    ].forEach((id) => { elements[toCamel(id)] = document.getElementById(id); });
  }

  function applyConfiguration() {
    const brand = config.brandName || "CodeVault";
    document.title = `Publisher Console | ${brand}`;
    document.querySelectorAll("[data-brand-name]").forEach((node) => { node.textContent = brand; });
    elements.configuredRepo.textContent = `${config.githubOwner || "OWNER"}/${config.githubRepository || "REPOSITORY"}`;
    const repoUrl = `https://github.com/${encodeURIComponent(config.githubOwner || "OWNER")}/${encodeURIComponent(config.githubRepository || "REPOSITORY")}`;
    document.querySelectorAll("[data-repo-link]").forEach((link) => { link.href = repoUrl; });
  }

  function bindEvents() {
    elements.toggleToken.addEventListener("click", () => {
      const hidden = elements.githubToken.type === "password";
      elements.githubToken.type = hidden ? "text" : "password";
      elements.toggleToken.textContent = hidden ? "Hide" : "Show";
    });

    elements.connectButton.addEventListener("click", connect);
    elements.releaseForm.addEventListener("submit", publishRelease);
    elements.appName.addEventListener("input", autoSlug);
    elements.appSlug.addEventListener("input", normalizeSlugInput);
    elements.releaseFiles.addEventListener("change", renderFileList);
    elements.refreshReleases.addEventListener("click", loadRecentReleases);

    ["dragenter", "dragover"].forEach((type) => elements.fileDrop.addEventListener(type, (event) => {
      event.preventDefault();
      elements.fileDrop.classList.add("is-dragging");
    }));
    ["dragleave", "drop"].forEach((type) => elements.fileDrop.addEventListener(type, (event) => {
      event.preventDefault();
      elements.fileDrop.classList.remove("is-dragging");
    }));
    elements.fileDrop.addEventListener("drop", (event) => {
      if (!event.dataTransfer.files.length) return;
      elements.releaseFiles.files = event.dataTransfer.files;
      renderFileList();
    });

    window.addEventListener("beforeunload", () => {
      token = "";
      connectedUser = null;
      elements.githubToken.value = "";
    });
  }

  async function connect() {
    clearMessage();
    const enteredToken = elements.githubToken.value.trim();
    if (!enteredToken) return setMessage("Enter your fine-grained GitHub token.", "error");
    if (!isConfigured()) return setMessage("Update githubOwner and githubRepository in assets/js/config.js first.", "error");

    setConnection("loading", "Testing connection...");
    elements.connectButton.disabled = true;

    try {
      token = enteredToken;
      const [user, repo] = await Promise.all([
        githubFetch("/user"),
        githubFetch(`/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepository)}`)
      ]);

      connectedUser = user;
      const permission = repo.permissions?.push || repo.permissions?.admin || repo.permissions?.maintain;
      if (!permission) throw new Error("The token can read this repository but does not appear to have write access.");

      setConnection("success", `Connected as ${user.login}`);
      elements.publishButton.disabled = false;
      await loadRecentReleases();
    } catch (error) {
      token = "";
      connectedUser = null;
      elements.publishButton.disabled = true;
      setConnection("error", error.message);
    } finally {
      elements.connectButton.disabled = false;
    }
  }

  async function publishRelease(event) {
    event.preventDefault();
    clearMessage();

    if (!token || !connectedUser) return setMessage("Connect to GitHub before publishing.", "error");
    if (!elements.releaseForm.reportValidity()) return;

    const files = [...elements.releaseFiles.files];
    if (!files.length) return setMessage("Choose at least one application file.", "error");
    const oversized = files.find((file) => file.size >= MAX_ASSET_SIZE);
    if (oversized) return setMessage(`${oversized.name} is too large. Each GitHub release asset must be smaller than 2 GiB.`, "error");

    const data = readFormData();
    const tag = `${data.slug}-v${data.version.replace(/^v/i, "")}`;
    const totalSteps = files.length + 1;
    let completedSteps = 0;

    setPublishing(true);
    resetProgress();

    try {
      log(`Creating release ${tag}...`);
      setProgress(5, "Creating GitHub release...");

      const release = await githubFetch(`/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepository)}/releases`, {
        method: "POST",
        body: JSON.stringify({
          tag_name: tag,
          target_commitish: config.defaultBranch || "main",
          name: `${data.appName} v${data.version.replace(/^v/i, "")}`,
          body: buildReleaseBody(data),
          draft: false,
          prerelease: data.prerelease,
          generate_release_notes: false
        })
      });

      completedSteps += 1;
      log(`Release created: ${release.name}`, "success");

      for (const file of files) {
        const basePercent = Math.round((completedSteps / totalSteps) * 100);
        setProgress(basePercent, `Uploading ${file.name}...`);
        log(`Uploading ${file.name} (${formatBytes(file.size)})...`);
        await uploadAsset(release.id, file);
        completedSteps += 1;
        setProgress(Math.round((completedSteps / totalSteps) * 100), `Uploaded ${file.name}`);
        log(`${file.name} uploaded successfully.`, "success");
      }

      setProgress(100, "Release published successfully");
      setMessage(`Published ${data.appName} v${data.version}. It may take a few seconds to appear in the public catalog.`, "success");
      log("Publishing complete.", "success");
      elements.releaseForm.reset();
      elements.latest.checked = true;
      elements.fileList.innerHTML = "";
      await loadRecentReleases();
    } catch (error) {
      log(`Error: ${error.message}`, "error");
      setMessage(error.message, "error");
      setProgress(0, "Publishing failed");
    } finally {
      setPublishing(false);
    }
  }

  function readFormData() {
    return {
      appName: elements.appName.value.trim(),
      slug: normalizeSlug(elements.appSlug.value),
      version: elements.version.value.trim(),
      category: elements.category.value,
      platform: elements.platform.value,
      icon: elements.icon.value,
      summary: elements.summary.value.trim(),
      description: elements.description.value.trim(),
      requirements: splitLines(elements.requirements.value),
      releaseNotes: elements.releaseNotes.value.trim(),
      prerelease: elements.prerelease.checked,
      display: elements.latest.checked
    };
  }

  function buildReleaseBody(data) {
    const metadata = JSON.stringify(data, null, 2);
    const requirements = data.requirements.length
      ? data.requirements.map((line) => `- ${line}`).join("\n")
      : "- No special requirements listed.";
    const notes = data.releaseNotes || "No release notes were provided.";
    const description = data.description || data.summary;

    return `<!-- DOWNLOAD_PORTAL_META\n${metadata}\nDOWNLOAD_PORTAL_META -->\n\n# ${data.appName} v${data.version.replace(/^v/i, "")}\n\n${description}\n\n## System Requirements\n\n${requirements}\n\n## Release Notes\n\n${notes}\n`;
  }

  async function uploadAsset(releaseId, file) {
    const url = `https://uploads.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepository)}/releases/${releaseId}/assets?name=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "Content-Type": file.type || "application/octet-stream"
      },
      body: file
    });

    if (!response.ok) {
      const detail = await safeJson(response);
      if (response.status === 422) throw new Error(`${file.name} already exists on this release or GitHub rejected the asset.`);
      throw new Error(detail.message || `Upload failed with HTTP ${response.status}.`);
    }
    return response.json();
  }

  async function loadRecentReleases() {
    if (!token) {
      elements.recentReleases.innerHTML = '<p class="muted-text">Connect to GitHub to view recent releases.</p>';
      return;
    }

    elements.refreshReleases.disabled = true;
    elements.recentReleases.innerHTML = '<p class="muted-text">Loading releases...</p>';
    try {
      const releases = await githubFetch(`/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepository)}/releases?per_page=8`);
      if (!releases.length) {
        elements.recentReleases.innerHTML = '<p class="muted-text">No releases have been published yet.</p>';
        return;
      }

      elements.recentReleases.innerHTML = releases.map((release) => `
        <article class="release-row">
          <div>
            <strong>${escapeHtml(release.name || release.tag_name)}</strong>
            <span>${escapeHtml(release.tag_name)} · ${formatDate(release.published_at || release.created_at)}</span>
          </div>
          <div class="release-row-meta">
            <span>${release.assets?.length || 0} file${release.assets?.length === 1 ? "" : "s"}</span>
            ${release.prerelease ? '<span class="badge badge-warning">Pre-release</span>' : '<span class="badge badge-success">Published</span>'}
            <a href="${escapeAttribute(release.html_url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>
          </div>
        </article>`).join("");
    } catch (error) {
      elements.recentReleases.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
    } finally {
      elements.refreshReleases.disabled = false;
    }
  }

  async function githubFetch(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const detail = await safeJson(response);
      const suffix = detail.documentation_url ? " Check the token's repository selection and Contents permission." : "";
      throw new Error(`${detail.message || `GitHub returned HTTP ${response.status}`}.${suffix}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function renderFileList() {
    const files = [...elements.releaseFiles.files];
    elements.fileList.innerHTML = files.map((file) => `
      <div class="file-row ${file.size >= MAX_ASSET_SIZE ? "file-error" : ""}">
        <span class="file-type">${escapeHtml(fileExtension(file.name))}</span>
        <span><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span>
        <span>${file.size >= MAX_ASSET_SIZE ? "Too large" : "Ready"}</span>
      </div>`).join("");
  }

  function autoSlug() {
    if (elements.appSlug.dataset.edited === "true") return;
    elements.appSlug.value = normalizeSlug(elements.appName.value);
  }

  function normalizeSlugInput() {
    elements.appSlug.dataset.edited = "true";
    elements.appSlug.value = normalizeSlug(elements.appSlug.value);
  }

  function normalizeSlug(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  function setConnection(type, message) {
    elements.connectionStatus.dataset.state = type;
    elements.connectionStatus.textContent = message;
  }

  function setPublishing(active) {
    elements.publishButton.disabled = active || !connectedUser;
    elements.connectButton.disabled = active;
    elements.releaseForm.querySelectorAll("input, textarea, select").forEach((field) => {
      if (field.id !== "github-token") field.disabled = active;
    });
    elements.publishProgress.hidden = false;
  }

  function resetProgress() {
    elements.publishLog.innerHTML = "";
    setProgress(0, "Preparing release...");
  }

  function setProgress(percent, label) {
    const safePercent = Math.max(0, Math.min(100, percent));
    elements.progressBar.style.width = `${safePercent}%`;
    elements.progressPercent.textContent = `${safePercent}%`;
    elements.progressLabel.textContent = label;
  }

  function log(message, type = "info") {
    const line = document.createElement("p");
    line.dataset.type = type;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    elements.publishLog.appendChild(line);
    elements.publishLog.scrollTop = elements.publishLog.scrollHeight;
  }

  function setMessage(message, type) {
    elements.formMessage.dataset.state = type;
    elements.formMessage.textContent = message;
  }

  function clearMessage() {
    elements.formMessage.textContent = "";
    delete elements.formMessage.dataset.state;
  }

  function splitLines(value) {
    return String(value || "").split(/\r?\n/).map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
  }

  function isConfigured() {
    return config.githubOwner && config.githubRepository && config.githubOwner !== "OWNER" && config.githubRepository !== "REPOSITORY";
  }

  function toCamel(value) {
    return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  }

  function fileExtension(name) {
    const extension = name.includes(".") ? name.split(".").pop() : "FILE";
    return extension.slice(0, 5).toUpperCase();
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  async function safeJson(response) {
    try { return await response.json(); } catch { return {}; }
  }
})();
