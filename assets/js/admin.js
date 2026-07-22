(() => {
  "use strict";

  const config = window.DOWNLOAD_PORTAL_CONFIG || {};
  const API_BASE = "https://api.github.com";
  const API_VERSION = config.githubApiVersion || "2026-03-10";
  const MAX_ASSET_SIZE = 2 * 1024 * 1024 * 1024;

  let token = "";
  let connectedUser = null;
  let editorMode = "create";
  let selectedRelease = null;
  let releasesCache = [];
  const removedAssetIds = new Set();
  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    applyConfiguration();
    bindEvents();
    resetEditor({ clearMessage: true });
  }

  function cacheElements() {
    [
      "github-token", "toggle-token", "connect-button", "connection-status", "configured-repo",
      "release-form", "app-name", "app-slug", "version", "category", "platform", "icon",
      "summary", "description", "requirements", "release-notes", "release-files", "file-drop",
      "file-list", "prerelease", "latest", "publish-button", "publish-progress", "progress-label",
      "progress-percent", "progress-bar", "publish-log", "form-message", "recent-releases",
      "refresh-releases", "editor-title", "editor-subtitle", "editor-mode", "editor-mode-title",
      "editor-mode-detail", "cancel-edit", "clear-form", "existing-assets-panel", "existing-assets"
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
    elements.releaseForm.addEventListener("submit", submitEditor);
    elements.appName.addEventListener("input", autoSlug);
    elements.appSlug.addEventListener("input", normalizeSlugInput);
    elements.releaseFiles.addEventListener("change", renderFileList);
    elements.refreshReleases.addEventListener("click", loadRecentReleases);
    elements.cancelEdit.addEventListener("click", () => resetEditor());
    elements.clearForm.addEventListener("click", () => resetEditor());
    elements.existingAssets.addEventListener("change", handleAssetRemovalToggle);
    elements.recentReleases.addEventListener("click", handleReleaseAction);

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
      try {
        elements.releaseFiles.files = event.dataTransfer.files;
      } catch {
        setMessage("Your browser could not add the dropped files. Use Choose application files instead.", "error");
        return;
      }
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
        githubFetch(repoPath())
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

  async function submitEditor(event) {
    event.preventDefault();
    clearMessage();

    if (!token || !connectedUser) return setMessage("Connect to GitHub before saving changes.", "error");
    if (!elements.releaseForm.reportValidity()) return;

    const files = [...elements.releaseFiles.files];
    const oversized = files.find((file) => file.size >= MAX_ASSET_SIZE);
    if (oversized) return setMessage(`${oversized.name} is too large. Each GitHub release asset must be smaller than 2 GiB.`, "error");

    if (!["edit", "import"].includes(editorMode) && !files.length) {
      return setMessage("Choose at least one application file for a new release.", "error");
    }

    const data = readFormData();
    setPublishing(true);
    resetProgress();

    try {
      if (["edit", "import"].includes(editorMode)) {
        await updateExistingRelease(data, files);
      } else {
        await createNewRelease(data, files);
      }
      await loadRecentReleases();
      resetEditor({ preserveMessage: true });
    } catch (error) {
      log(`Error: ${error.message}`, "error");
      setMessage(error.message, "error");
      setProgress(0, "Operation failed");
    } finally {
      setPublishing(false);
    }
  }

  async function createNewRelease(data, files) {
    const cleanVersion = data.version.replace(/^v/i, "");
    const tag = `${data.slug}-v${cleanVersion}`;
    const duplicate = releasesCache.find((release) => release.tag_name.toLowerCase() === tag.toLowerCase());
    if (duplicate) throw new Error(`A release using ${tag} already exists. Choose Edit Details or enter a different version number.`);

    const totalSteps = files.length + 1;
    let completedSteps = 0;

    log(`Creating release ${tag}...`);
    setProgress(5, "Creating GitHub release...");

    const release = await githubFetch(`${repoPath()}/releases`, {
      method: "POST",
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: config.defaultBranch || "main",
        name: `${data.appName} v${cleanVersion}`,
        body: buildReleaseBody(data),
        draft: false,
        prerelease: data.prerelease,
        generate_release_notes: false
      })
    });

    completedSteps += 1;
    log(`Release created: ${release.name}`, "success");

    for (const file of files) {
      setProgress(Math.round((completedSteps / totalSteps) * 100), `Uploading ${file.name}...`);
      log(`Uploading ${file.name} (${formatBytes(file.size)})...`);
      await uploadAsset(release.id, file);
      completedSteps += 1;
      setProgress(Math.round((completedSteps / totalSteps) * 100), `Uploaded ${file.name}`);
      log(`${file.name} uploaded successfully.`, "success");
    }

    setProgress(100, "Release published successfully");
    setMessage(`Published ${data.appName} v${cleanVersion}. The public catalog will use this as the newest visible version.`, "success");
    log("Publishing complete.", "success");
  }

  async function updateExistingRelease(data, files) {
    if (!selectedRelease) throw new Error("No release is selected for editing.");

    const release = selectedRelease;
    const existingByName = new Map((release.assets || []).map((asset) => [asset.name.toLowerCase(), asset]));
    const replacedOldIds = new Set();
    const deleteOnlyIds = [...removedAssetIds];
    const estimatedSteps = 1 + files.length + deleteOnlyIds.length;
    let completedSteps = 0;

    setProgress(5, "Saving release details...");
    log(`Updating ${release.name || release.tag_name}...`);

    const updated = await githubFetch(`${repoPath()}/releases/${release.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        tag_name: release.tag_name,
        target_commitish: release.target_commitish || config.defaultBranch || "main",
        name: `${data.appName} v${data.version.replace(/^v/i, "")}`,
        body: buildReleaseBody(data),
        draft: false,
        prerelease: data.prerelease
      })
    });

    completedSteps += 1;
    log("Application details saved.", "success");

    for (const file of files) {
      const existing = existingByName.get(file.name.toLowerCase());
      const progress = Math.round((completedSteps / Math.max(estimatedSteps, 1)) * 100);
      setProgress(progress, `${existing ? "Replacing" : "Uploading"} ${file.name}...`);

      if (existing) {
        log(`Replacing ${file.name} safely...`);
        await replaceAssetSafely(updated.id, existing, file);
        replacedOldIds.add(existing.id);
        log(`${file.name} replaced successfully.`, "success");
      } else {
        log(`Uploading ${file.name} (${formatBytes(file.size)})...`);
        await uploadAsset(updated.id, file);
        log(`${file.name} uploaded successfully.`, "success");
      }
      completedSteps += 1;
    }

    for (const assetId of deleteOnlyIds) {
      if (replacedOldIds.has(assetId)) continue;
      const asset = (release.assets || []).find((item) => item.id === assetId);
      setProgress(Math.round((completedSteps / Math.max(estimatedSteps, 1)) * 100), `Removing ${asset?.name || "file"}...`);
      log(`Removing ${asset?.name || "selected file"}...`);
      await deleteAsset(assetId);
      completedSteps += 1;
      log(`${asset?.name || "File"} removed.`, "success");
    }

    setProgress(100, "Changes saved successfully");
    setMessage(`Updated ${data.appName} v${data.version.replace(/^v/i, "")}. The public website will reflect the changes after GitHub's cache refreshes.`, "success");
    log("Update complete.", "success");
  }

  async function replaceAssetSafely(releaseId, existingAsset, file) {
    const temporaryName = makeTemporaryAssetName(file.name);
    const uploaded = await uploadAsset(releaseId, file, temporaryName);

    try {
      await deleteAsset(existingAsset.id);
      await renameAsset(uploaded.id, file.name);
    } catch (error) {
      throw new Error(`${error.message} The replacement was uploaded as ${temporaryName}, so the new file was not lost.`);
    }
  }

  async function uploadAsset(releaseId, file, assetName = file.name) {
    const url = `https://uploads.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepository)}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
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
      if (response.status === 422) throw new Error(`${assetName} already exists on this release or GitHub rejected the asset.`);
      throw new Error(detail.message || `Upload failed with HTTP ${response.status}.`);
    }
    return response.json();
  }

  async function renameAsset(assetId, name) {
    return githubFetch(`${repoPath()}/releases/assets/${assetId}`, {
      method: "PATCH",
      body: JSON.stringify({ name })
    });
  }

  async function deleteAsset(assetId) {
    return githubFetch(`${repoPath()}/releases/assets/${assetId}`, { method: "DELETE" });
  }

  async function loadRecentReleases() {
    if (!token) {
      elements.recentReleases.innerHTML = '<p class="muted-text">Connect to GitHub to view recent releases.</p>';
      return;
    }

    elements.refreshReleases.disabled = true;
    elements.recentReleases.innerHTML = '<p class="muted-text">Loading releases...</p>';
    try {
      releasesCache = await githubFetch(`${repoPath()}/releases?per_page=100`);
      renderRecentReleases();
    } catch (error) {
      elements.recentReleases.innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
    } finally {
      elements.refreshReleases.disabled = false;
    }
  }

  function renderRecentReleases() {
    if (!releasesCache.length) {
      elements.recentReleases.innerHTML = '<p class="muted-text">No releases have been published yet.</p>';
      return;
    }

    const latestBySlug = new Map();
    releasesCache.forEach((release) => {
      const meta = parseMetadata(release.body || "");
      if (!meta?.slug) return;
      const existing = latestBySlug.get(meta.slug);
      if (!existing || new Date(release.published_at || release.created_at) > new Date(existing.published_at || existing.created_at)) {
        latestBySlug.set(meta.slug, release);
      }
    });

    elements.recentReleases.innerHTML = releasesCache.map((release) => {
      const meta = parseMetadata(release.body || "");
      const managed = Boolean(meta);
      const version = managed ? String(meta.version || "").replace(/^v/i, "") : release.tag_name;
      const name = managed ? (meta.appName || release.name || release.tag_name) : (release.name || release.tag_name);
      const isNewest = managed && latestBySlug.get(meta.slug)?.id === release.id;
      const visible = managed && meta.display !== false;
      const fileCount = release.assets?.length || 0;

      return `
        <article class="release-row" data-release-id="${release.id}">
          <div class="release-row-main">
            <div>
              <strong>${escapeHtml(name)}</strong>
              <span>${escapeHtml(managed ? `v${version} · ${meta.slug}` : release.tag_name)} · ${formatDate(release.published_at || release.created_at)}</span>
            </div>
            <div class="release-statuses">
              ${managed ? '<span class="badge badge-success">Managed</span>' : '<span class="badge badge-muted">Manual Release</span>'}
              ${isNewest ? '<span class="badge badge-info">Newest</span>' : ""}
              ${managed && !visible ? '<span class="badge badge-warning">Hidden</span>' : ""}
              ${release.draft ? '<span class="badge badge-warning">Draft</span>' : ""}
              ${release.prerelease ? '<span class="badge badge-warning">Pre-release</span>' : ""}
            </div>
          </div>
          <div class="release-row-meta">
            <span>${fileCount} file${fileCount === 1 ? "" : "s"}</span>
            <a href="${escapeAttribute(release.html_url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>
          </div>
          <div class="release-row-actions">
            ${managed
              ? `<button class="button button-secondary button-small" type="button" data-action="edit" data-release-id="${release.id}">Edit Details</button>
                 <button class="button button-secondary button-small" type="button" data-action="new-version" data-release-id="${release.id}">New Version</button>`
              : `<button class="button button-secondary button-small" type="button" data-action="import" data-release-id="${release.id}">Add to Website</button>`}
            <button class="button button-danger button-small" type="button" data-action="delete" data-release-id="${release.id}">Delete</button>
          </div>
        </article>`;
    }).join("");
  }

  function handleReleaseAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    const releaseId = Number(button.dataset.releaseId);
    const action = button.dataset.action;
    if (action === "edit") beginEditRelease(releaseId);
    if (action === "new-version") beginNewVersion(releaseId);
    if (action === "import") beginImportRelease(releaseId);
    if (action === "delete") deleteRelease(releaseId);
  }

  function beginEditRelease(releaseId) {
    const release = releasesCache.find((item) => item.id === releaseId);
    const meta = release ? parseMetadata(release.body || "") : null;
    if (!release || !meta) return setMessage("This release does not contain website metadata and cannot be edited from the console.", "error");

    editorMode = "edit";
    selectedRelease = release;
    removedAssetIds.clear();
    fillEditor(meta, release);

    elements.editorTitle.textContent = "Edit Application";
    elements.editorSubtitle.textContent = "Change the current app card, visibility, or attached files";
    elements.editorMode.hidden = false;
    elements.editorModeTitle.textContent = "Editing existing release";
    elements.editorModeDetail.textContent = `${meta.appName} v${String(meta.version || "").replace(/^v/i, "")}`;
    elements.appSlug.disabled = true;
    elements.version.disabled = true;
    elements.releaseFiles.required = false;
    elements.publishButton.textContent = "Save Changes";
    renderExistingAssets(release.assets || []);
    clearSelectedFiles();
    clearMessage();
    scrollToEditor();
  }

  function beginImportRelease(releaseId) {
    const release = releasesCache.find((item) => item.id === releaseId);
    if (!release) return setMessage("The selected GitHub release could not be found.", "error");

    const appName = deriveApplicationName(release.name || release.tag_name);
    const version = deriveVersion(release.tag_name, release.name);
    const plainBody = cleanReleaseText(release.body || "");
    const meta = {
      appName,
      slug: normalizeSlug(appName || release.tag_name),
      version,
      category: "Other",
      platform: "Windows",
      icon: "code",
      summary: plainBody.split(/\r?\n/).find(Boolean)?.slice(0, 180) || `${appName} is available for download.`,
      description: plainBody,
      requirements: [],
      releaseNotes: plainBody,
      display: true
    };

    editorMode = "import";
    selectedRelease = release;
    removedAssetIds.clear();
    fillEditor(meta, release);

    elements.editorTitle.textContent = "Add Release to Website";
    elements.editorSubtitle.textContent = "Add website metadata to a release created directly on GitHub";
    elements.editorMode.hidden = false;
    elements.editorModeTitle.textContent = "Importing manual GitHub release";
    elements.editorModeDetail.textContent = release.tag_name;
    elements.appSlug.disabled = false;
    elements.version.disabled = false;
    elements.releaseFiles.required = false;
    elements.publishButton.textContent = "Add Release to Website";
    renderExistingAssets(release.assets || []);
    clearSelectedFiles();
    clearMessage();
    scrollToEditor();
  }

  function beginNewVersion(releaseId) {
    const release = releasesCache.find((item) => item.id === releaseId);
    const meta = release ? parseMetadata(release.body || "") : null;
    if (!release || !meta) return setMessage("This release does not contain website metadata and cannot be used as a version template.", "error");

    editorMode = "new-version";
    selectedRelease = release;
    removedAssetIds.clear();
    fillEditor(meta, release);

    elements.version.value = "";
    elements.releaseNotes.value = "";
    elements.latest.checked = true;
    elements.editorTitle.textContent = "Publish New Version";
    elements.editorSubtitle.textContent = "Reuse the app details and upload a newer build";
    elements.editorMode.hidden = false;
    elements.editorModeTitle.textContent = "Creating a new version";
    elements.editorModeDetail.textContent = `${meta.appName} · current version v${String(meta.version || "").replace(/^v/i, "")}`;
    elements.appSlug.disabled = true;
    elements.version.disabled = false;
    elements.releaseFiles.required = false;
    elements.publishButton.textContent = "Publish New Version";
    elements.existingAssetsPanel.hidden = true;
    elements.existingAssets.innerHTML = "";
    clearSelectedFiles();
    clearMessage();
    scrollToEditor();
    elements.version.focus();
  }

  function fillEditor(meta, release) {
    elements.releaseForm.reset();
    elements.appName.value = meta.appName || release.name || "";
    elements.appSlug.value = normalizeSlug(meta.slug || "");
    elements.appSlug.dataset.edited = "true";
    elements.version.value = String(meta.version || "").replace(/^v/i, "");
    setSelectValue(elements.category, meta.category || "Other");
    setSelectValue(elements.platform, meta.platform || "Windows");
    setSelectValue(elements.icon, meta.icon || "code");
    elements.summary.value = meta.summary || "";
    elements.description.value = meta.description || "";
    elements.requirements.value = Array.isArray(meta.requirements) ? meta.requirements.join("\n") : String(meta.requirements || "");
    elements.releaseNotes.value = meta.releaseNotes || "";
    elements.prerelease.checked = Boolean(release.prerelease);
    elements.latest.checked = meta.display !== false;
  }

  function resetEditor(options = {}) {
    editorMode = "create";
    selectedRelease = null;
    removedAssetIds.clear();
    elements.releaseForm.reset();
    elements.appSlug.disabled = false;
    elements.version.disabled = false;
    elements.appSlug.dataset.edited = "false";
    elements.releaseFiles.required = false;
    elements.latest.checked = true;
    elements.editorTitle.textContent = "Publish Application";
    elements.editorSubtitle.textContent = "Create a new app or release version";
    elements.editorMode.hidden = true;
    elements.editorModeDetail.textContent = "";
    elements.publishButton.textContent = "Publish Release & Upload Files";
    elements.publishButton.disabled = !connectedUser;
    elements.existingAssetsPanel.hidden = true;
    elements.existingAssets.innerHTML = "";
    elements.fileList.innerHTML = "";
    elements.publishProgress.hidden = true;
    if (!options.preserveMessage && !options.clearMessage) clearMessage();
    if (options.clearMessage) clearMessage();
  }

  function renderExistingAssets(assets) {
    elements.existingAssetsPanel.hidden = false;
    if (!assets.length) {
      elements.existingAssets.innerHTML = '<p class="muted-text">This release has no attached files.</p>';
      return;
    }

    elements.existingAssets.innerHTML = assets.map((asset) => `
      <label class="existing-asset-row" data-asset-id="${asset.id}">
        <span class="file-type">${escapeHtml(fileExtension(asset.name))}</span>
        <span><strong>${escapeHtml(asset.name)}</strong><small>${formatBytes(asset.size)} · ${formatNumber(asset.download_count || 0)} downloads</small></span>
        <span class="asset-remove-control"><input type="checkbox" data-remove-asset="${asset.id}"> Remove</span>
      </label>`).join("");
  }

  function handleAssetRemovalToggle(event) {
    const checkbox = event.target.closest("input[data-remove-asset]");
    if (!checkbox) return;
    const assetId = Number(checkbox.dataset.removeAsset);
    const row = checkbox.closest(".existing-asset-row");
    if (checkbox.checked) {
      removedAssetIds.add(assetId);
      row?.classList.add("is-removed");
    } else {
      removedAssetIds.delete(assetId);
      row?.classList.remove("is-removed");
    }
  }

  async function deleteRelease(releaseId) {
    if (!token || !connectedUser) return setMessage("Connect to GitHub before deleting a release.", "error");
    const release = releasesCache.find((item) => item.id === releaseId);
    if (!release) return;

    const label = release.name || release.tag_name;
    const confirmed = window.confirm(`Delete "${label}" and all files attached to it?\n\nThis cannot be undone from the website.`);
    if (!confirmed) return;

    setMessage(`Deleting ${label}...`, "success");
    setReleaseActionsDisabled(true);
    try {
      await githubFetch(`${repoPath()}/releases/${releaseId}`, { method: "DELETE" });
      if (selectedRelease?.id === releaseId) resetEditor({ preserveMessage: true });
      setMessage(`Deleted ${label}. The Git tag may remain in GitHub, but it will no longer appear as a release or on the website.`, "success");
      await loadRecentReleases();
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setReleaseActionsDisabled(false);
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

  function parseMetadata(body) {
    const match = String(body || "").match(/<!--\s*DOWNLOAD_PORTAL_META\s*([\s\S]*?)\s*DOWNLOAD_PORTAL_META\s*-->/i);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
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
      const permissionHint = [401, 403, 404].includes(response.status)
        ? " Check the token's repository selection and Contents permission."
        : "";
      throw new Error(`${detail.message || `GitHub returned HTTP ${response.status}`}.${permissionHint}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  function renderFileList() {
    const files = [...elements.releaseFiles.files];
    if (!files.length) {
      elements.fileList.innerHTML = "";
      return;
    }

    const existingNames = new Set((selectedRelease?.assets || []).map((asset) => asset.name.toLowerCase()));
    elements.fileList.innerHTML = files.map((file) => {
      const replacing = editorMode === "edit" && existingNames.has(file.name.toLowerCase());
      return `
        <div class="file-row ${file.size >= MAX_ASSET_SIZE ? "file-error" : ""}">
          <span class="file-type">${escapeHtml(fileExtension(file.name))}</span>
          <span><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span>
          <span>${file.size >= MAX_ASSET_SIZE ? "Too large" : replacing ? "Will replace" : "Ready"}</span>
        </div>`;
    }).join("");
  }

  function clearSelectedFiles() {
    elements.releaseFiles.value = "";
    elements.fileList.innerHTML = "";
  }

  function autoSlug() {
    if (elements.appSlug.dataset.edited === "true" || editorMode !== "create") return;
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

  function setSelectValue(select, value) {
    const text = String(value || "");
    let option = [...select.options].find((item) => item.value === text);
    if (!option && text) {
      option = document.createElement("option");
      option.value = text;
      option.textContent = text;
      select.appendChild(option);
    }
    select.value = text;
  }

  function setConnection(type, message) {
    elements.connectionStatus.dataset.state = type;
    elements.connectionStatus.textContent = message;
  }

  function setPublishing(active) {
    elements.publishButton.disabled = active || !connectedUser;
    elements.connectButton.disabled = active;
    elements.refreshReleases.disabled = active;
    elements.cancelEdit.disabled = active;
    elements.clearForm.disabled = active;
    elements.releaseForm.querySelectorAll("input, textarea, select, button").forEach((field) => {
      if (field.id !== "publish-button" && field.id !== "clear-form") field.disabled = active;
    });

    if (!active) {
      elements.appSlug.disabled = editorMode === "edit" || editorMode === "new-version";
      elements.version.disabled = editorMode === "edit";
      elements.cancelEdit.disabled = false;
      elements.clearForm.disabled = false;
    } else {
      elements.publishProgress.hidden = false;
    }
    setReleaseActionsDisabled(active);
  }

  function setReleaseActionsDisabled(disabled) {
    elements.recentReleases.querySelectorAll("button[data-action]").forEach((button) => {
      if (disabled) {
        button.dataset.wasDisabled = String(button.disabled);
        button.disabled = true;
      } else if (Object.prototype.hasOwnProperty.call(button.dataset, "wasDisabled")) {
        button.disabled = button.dataset.wasDisabled === "true";
        delete button.dataset.wasDisabled;
      }
    });
  }

  function resetProgress() {
    elements.publishLog.innerHTML = "";
    elements.publishProgress.hidden = false;
    setProgress(0, "Preparing...");
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

  function repoPath() {
    return `/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepository)}`;
  }

  function makeTemporaryAssetName(name) {
    const dotIndex = name.lastIndexOf(".");
    const timestamp = Date.now();
    if (dotIndex <= 0) return `${name}.replacement-${timestamp}`;
    return `${name.slice(0, dotIndex)}.replacement-${timestamp}${name.slice(dotIndex)}`;
  }

  function deriveApplicationName(value) {
    return String(value || "Application")
      .replace(/\s+v?\d+(?:\.\d+){0,3}(?:[-+][\w.-]+)?\s*$/i, "")
      .trim() || "Application";
  }

  function deriveVersion(...values) {
    for (const value of values) {
      const match = String(value || "").match(/(?:^|[-_\s])v?(\d+(?:\.\d+){0,3}(?:[-+][\w.-]+)?)$/i);
      if (match) return match[1];
    }
    return "1.0.0";
  }

  function cleanReleaseText(value) {
    return String(value || "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/^[-*]\s+/gm, "")
      .trim();
  }

  function scrollToEditor() {
    document.querySelector(".release-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
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
