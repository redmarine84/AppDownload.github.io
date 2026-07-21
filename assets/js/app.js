(() => {
  "use strict";

  const config = window.DOWNLOAD_PORTAL_CONFIG || {};
  const state = { apps: [], filteredApps: [] };

  const iconMap = {
    terminal: "&gt;_",
    dashboard: "▦",
    database: "◉",
    gear: "⚙",
    package: "⬡",
    robot: "🤖",
    chart: "⌁",
    code: "{ }"
  };

  const demoApps = [
    {
      slug: "daily-ops-report-bot",
      name: "Daily Ops Report Bot",
      version: "1.0.0",
      category: "Business",
      platform: "Windows 10/11",
      icon: "robot",
      summary: "Inventory, order, production, and daily reporting software for small businesses.",
      description: "A demonstration card shown until compatible GitHub Releases are available. Publish your first release from admin.html to replace the demo catalog.",
      requirements: ["Windows 10 or later", ".NET Desktop Runtime"],
      releaseNotes: "Demo application entry.",
      publishedAt: new Date().toISOString(),
      totalDownloads: 0,
      assets: [],
      htmlUrl: "#",
      isDemo: true
    },
    {
      slug: "manufacturing-dashboard",
      name: "Manufacturing Dashboard",
      version: "2.4.1",
      category: "Dashboard",
      platform: "Windows",
      icon: "dashboard",
      summary: "A live production dashboard for schedules, KPIs, status, and operational visibility.",
      description: "A demonstration card shown until compatible GitHub Releases are available.",
      requirements: ["Windows 10 or later"],
      releaseNotes: "Demo application entry.",
      publishedAt: new Date(Date.now() - 86400000 * 14).toISOString(),
      totalDownloads: 0,
      assets: [],
      htmlUrl: "#",
      isDemo: true
    },
    {
      slug: "macro-recorder",
      name: "Macro Recorder",
      version: "0.9.0",
      category: "Utility",
      platform: "Windows",
      icon: "terminal",
      summary: "Record and replay mouse clicks, cursor movement, keyboard input, and repeatable workflows.",
      description: "A demonstration card shown until compatible GitHub Releases are available.",
      requirements: ["Windows 10 or later"],
      releaseNotes: "Demo application entry.",
      publishedAt: new Date(Date.now() - 86400000 * 30).toISOString(),
      totalDownloads: 0,
      assets: [],
      htmlUrl: "#",
      isDemo: true
    }
  ];

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    applyConfiguration();
    bindEvents();
    loadCatalog();
  }

  function cacheElements() {
    elements.grid = document.getElementById("app-grid");
    elements.template = document.getElementById("app-card-template");
    elements.loading = document.getElementById("loading-state");
    elements.empty = document.getElementById("empty-state");
    elements.search = document.getElementById("search-input");
    elements.category = document.getElementById("category-filter");
    elements.sort = document.getElementById("sort-filter");
    elements.clear = document.getElementById("clear-filters");
    elements.modal = document.getElementById("details-modal");
    elements.modalContent = document.getElementById("modal-content");
    elements.syncBadge = document.getElementById("sync-badge");
    elements.syncText = document.getElementById("sync-text");
  }

  function applyConfiguration() {
    const brand = config.brandName || "CodeVault";
    document.title = config.pageTitle || `${brand} Downloads`;
    document.querySelectorAll("[data-brand-name]").forEach((node) => { node.textContent = brand; });

    const repoUrl = `https://github.com/${encodeURIComponent(config.githubOwner || "OWNER")}/${encodeURIComponent(config.githubRepository || "REPOSITORY")}`;
    document.querySelectorAll("[data-repo-link]").forEach((link) => { link.href = repoUrl; });
    document.querySelectorAll("[data-releases-link]").forEach((link) => { link.href = `${repoUrl}/releases`; });

    const supportLink = document.getElementById("support-link");
    if (supportLink) supportLink.href = `mailto:${config.supportEmail || "support@example.com"}`;

    const about = document.querySelector("[data-about-text]");
    if (about && config.aboutText) about.textContent = config.aboutText;

    document.getElementById("current-year").textContent = new Date().getFullYear();
  }

  function bindEvents() {
    elements.search.addEventListener("input", filterAndRender);
    elements.category.addEventListener("change", filterAndRender);
    elements.sort.addEventListener("change", filterAndRender);
    elements.clear.addEventListener("click", () => {
      elements.search.value = "";
      elements.category.value = "all";
      elements.sort.value = "newest";
      filterAndRender();
    });

    document.querySelector(".modal-close").addEventListener("click", () => elements.modal.close());
    elements.modal.addEventListener("click", (event) => {
      if (event.target === elements.modal) elements.modal.close();
    });

    const navToggle = document.querySelector(".nav-toggle");
    const nav = document.getElementById("main-nav");
    navToggle.addEventListener("click", () => {
      const open = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    }));

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        elements.search.focus();
      }
      if (event.key === "Escape" && elements.modal.open) elements.modal.close();
    });
  }

  async function loadCatalog() {
    setSyncState("loading", "Connecting...");
    elements.loading.hidden = false;
    elements.grid.innerHTML = "";

    try {
      validateConfiguration();
      const endpoint = `https://api.github.com/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepository)}/releases?per_page=100`;
      const response = await fetch(endpoint, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": config.githubApiVersion || "2026-03-10"
        }
      });

      if (!response.ok) {
        const detail = await safeJson(response);
        throw new Error(detail.message || `GitHub returned HTTP ${response.status}`);
      }

      const releases = await response.json();
      const apps = buildCatalog(releases);

      if (!apps.length && config.showDemoAppsWhenEmpty) {
        state.apps = demoApps;
        setSyncState("demo", "Demo catalog");
      } else {
        state.apps = apps;
        setSyncState("success", "Synced with GitHub");
      }
    } catch (error) {
      console.error("Catalog loading failed:", error);
      if (config.showDemoAppsWhenEmpty) {
        state.apps = demoApps;
        setSyncState("warning", "Demo mode");
      } else {
        state.apps = [];
        setSyncState("error", "Catalog unavailable");
      }
    } finally {
      elements.loading.hidden = true;
      populateCategories();
      updateStats();
      filterAndRender();
    }
  }

  function validateConfiguration() {
    if (!config.githubOwner || !config.githubRepository || config.githubOwner === "OWNER" || config.githubRepository === "REPOSITORY") {
      throw new Error("Configure githubOwner and githubRepository in assets/js/config.js.");
    }
  }

  function buildCatalog(releases) {
    const newestBySlug = new Map();

    releases
      .filter((release) => !release.draft)
      .forEach((release) => {
        const meta = parseMetadata(release.body || "");
        if (!meta || meta.display === false) return;

        const slug = cleanText(meta.slug || release.tag_name || "application", 60);
        const app = {
          slug,
          name: cleanText(meta.appName || release.name || slug, 80),
          version: cleanText(meta.version || release.tag_name || "", 30).replace(/^v/i, ""),
          category: cleanText(meta.category || "Other", 40),
          platform: cleanText(meta.platform || "Windows", 40),
          icon: cleanText(meta.icon || "code", 20),
          summary: cleanText(meta.summary || "Software release available for download.", 240),
          description: cleanText(meta.description || stripMetadata(release.body || ""), 5000),
          requirements: normalizeLines(meta.requirements),
          releaseNotes: cleanText(meta.releaseNotes || stripMetadata(release.body || ""), 5000),
          publishedAt: release.published_at || release.created_at,
          totalDownloads: (release.assets || []).reduce((total, asset) => total + Number(asset.download_count || 0), 0),
          assets: (release.assets || []).map((asset) => ({
            id: asset.id,
            name: cleanText(asset.name, 255),
            url: asset.browser_download_url,
            size: Number(asset.size || 0),
            downloads: Number(asset.download_count || 0),
            contentType: asset.content_type || "application/octet-stream"
          })),
          htmlUrl: release.html_url,
          prerelease: Boolean(release.prerelease),
          isDemo: false
        };

        const existing = newestBySlug.get(slug);
        if (!existing || new Date(app.publishedAt) > new Date(existing.publishedAt)) newestBySlug.set(slug, app);
      });

    return Array.from(newestBySlug.values());
  }

  function parseMetadata(body) {
    const match = body.match(/<!--\s*DOWNLOAD_PORTAL_META\s*([\s\S]*?)\s*DOWNLOAD_PORTAL_META\s*-->/i);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch (error) {
      console.warn("A release contains invalid portal metadata.", error);
      return null;
    }
  }

  function stripMetadata(body) {
    return body
      .replace(/<!--\s*DOWNLOAD_PORTAL_META[\s\S]*?DOWNLOAD_PORTAL_META\s*-->/i, "")
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/[-*]\s+/g, "")
      .trim();
  }

  function normalizeLines(value) {
    if (Array.isArray(value)) return value.map((line) => cleanText(line, 200)).filter(Boolean);
    if (typeof value !== "string") return [];
    return value.split(/\r?\n/).map((line) => cleanText(line.replace(/^[-*]\s*/, ""), 200)).filter(Boolean);
  }

  function cleanText(value, maxLength = 500) {
    return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, maxLength);
  }

  function populateCategories() {
    const current = elements.category.value;
    const categories = [...new Set(state.apps.map((app) => app.category).filter(Boolean))].sort();
    elements.category.innerHTML = '<option value="all">All Categories</option>';
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      elements.category.appendChild(option);
    });
    if ([...elements.category.options].some((option) => option.value === current)) elements.category.value = current;
  }

  function filterAndRender() {
    const searchTerm = elements.search.value.trim().toLowerCase();
    const category = elements.category.value;

    state.filteredApps = state.apps.filter((app) => {
      const searchable = `${app.name} ${app.summary} ${app.category} ${app.platform}`.toLowerCase();
      return (!searchTerm || searchable.includes(searchTerm)) && (category === "all" || app.category === category);
    });

    if (elements.sort.value === "name") {
      state.filteredApps.sort((a, b) => a.name.localeCompare(b.name));
    } else if (elements.sort.value === "downloads") {
      state.filteredApps.sort((a, b) => b.totalDownloads - a.totalDownloads);
    } else {
      state.filteredApps.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    }

    renderApps();
  }

  function renderApps() {
    elements.grid.innerHTML = "";
    elements.empty.hidden = state.filteredApps.length > 0;

    state.filteredApps.forEach((app, index) => {
      const fragment = elements.template.content.cloneNode(true);
      const card = fragment.querySelector(".app-card");
      card.style.setProperty("--card-delay", `${index * 45}ms`);

      const icon = fragment.querySelector(".app-icon");
      icon.innerHTML = iconMap[app.icon] || iconMap.code;
      icon.dataset.icon = app.icon;

      const badges = fragment.querySelector(".app-badges");
      if (app.prerelease) badges.appendChild(makeBadge("Pre-release", "warning"));
      if (app.isDemo) badges.appendChild(makeBadge("Demo", "muted"));
      else badges.appendChild(makeBadge("Latest", "success"));

      fragment.querySelector(".app-category").textContent = app.category;
      fragment.querySelector(".app-title").textContent = app.name;
      fragment.querySelector(".app-summary").textContent = app.summary;
      fragment.querySelector(".app-version").textContent = `v${app.version}`;
      fragment.querySelector(".app-platform").textContent = app.platform;
      fragment.querySelector(".app-downloads").textContent = `${formatNumber(app.totalDownloads)} downloads`;

      fragment.querySelector(".details-button").addEventListener("click", () => openDetails(app));
      const download = fragment.querySelector(".download-button");
      const primaryAsset = selectPrimaryAsset(app.assets);
      if (primaryAsset) {
        download.href = primaryAsset.url;
        download.textContent = "Download";
        download.setAttribute("download", "");
      } else if (!app.isDemo && app.htmlUrl) {
        download.href = app.htmlUrl;
        download.textContent = "View Release";
        download.target = "_blank";
        download.rel = "noopener noreferrer";
      } else {
        download.href = "#";
        download.textContent = "Demo Only";
        download.classList.add("is-disabled");
        download.addEventListener("click", (event) => event.preventDefault());
      }

      elements.grid.appendChild(fragment);
    });
  }

  function openDetails(app) {
    const files = app.assets.length
      ? app.assets.map((asset) => `
          <a class="asset-row" href="${escapeAttribute(asset.url)}" download>
            <span class="asset-icon">↓</span>
            <span><strong>${escapeHtml(asset.name)}</strong><small>${formatBytes(asset.size)} · ${formatNumber(asset.downloads)} downloads</small></span>
            <span class="asset-action">Download</span>
          </a>`).join("")
      : '<p class="muted-text">No downloadable files are attached to this release.</p>';

    const requirements = app.requirements.length
      ? `<ul>${app.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "<p>No special requirements listed.</p>";

    elements.modalContent.innerHTML = `
      <div class="modal-app-header">
        <div class="app-icon large" data-icon="${escapeAttribute(app.icon)}">${iconMap[app.icon] || iconMap.code}</div>
        <div>
          <p class="app-category">${escapeHtml(app.category)}</p>
          <h2>${escapeHtml(app.name)}</h2>
          <div class="modal-version-row"><span>Version ${escapeHtml(app.version)}</span><span>${escapeHtml(app.platform)}</span><span>${formatDate(app.publishedAt)}</span></div>
        </div>
      </div>
      <p class="modal-summary">${escapeHtml(app.summary)}</p>
      <div class="modal-sections">
        <section><h3>About</h3><p class="preserve-lines">${escapeHtml(app.description || app.summary)}</p></section>
        <section><h3>System Requirements</h3>${requirements}</section>
        <section><h3>Release Notes</h3><p class="preserve-lines">${escapeHtml(app.releaseNotes || "No release notes were provided.")}</p></section>
        <section class="files-section"><h3>Available Files</h3><div class="asset-list">${files}</div></section>
      </div>
      ${!app.isDemo && app.htmlUrl ? `<a class="release-link" href="${escapeAttribute(app.htmlUrl)}" target="_blank" rel="noopener noreferrer">View complete release on GitHub ↗</a>` : ""}
    `;
    elements.modal.showModal();
  }

  function selectPrimaryAsset(assets) {
    if (!assets.length) return null;
    const preferred = [".exe", ".msi", ".zip", ".msix", ".dmg", ".pkg", ".appimage"];
    return [...assets].sort((a, b) => {
      const ai = preferred.findIndex((ext) => a.name.toLowerCase().endsWith(ext));
      const bi = preferred.findIndex((ext) => b.name.toLowerCase().endsWith(ext));
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })[0];
  }

  function updateStats() {
    document.getElementById("app-count").textContent = state.apps.length;
    const total = state.apps.reduce((sum, app) => sum + app.totalDownloads, 0);
    document.getElementById("download-count").textContent = formatNumber(total);
    const latest = state.apps.length
      ? state.apps.reduce((date, app) => new Date(app.publishedAt) > date ? new Date(app.publishedAt) : date, new Date(0))
      : null;
    document.getElementById("latest-date").textContent = latest ? latest.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
  }

  function setSyncState(type, text) {
    elements.syncBadge.dataset.state = type;
    elements.syncText.textContent = text;
  }

  function makeBadge(text, type) {
    const badge = document.createElement("span");
    badge.className = `badge badge-${type}`;
    badge.textContent = text;
    return badge;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatNumber(number) {
    return new Intl.NumberFormat(undefined, { notation: number >= 10000 ? "compact" : "standard" }).format(number || 0);
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
