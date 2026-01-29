// State
let config = null;
let pages = [];
let currentPageId = null;
let stagingOnline = false;

// DOM elements
const siteName = document.getElementById("siteName");
const pageSelector = document.getElementById("pageSelector");
const stagingStatus = document.getElementById("stagingStatus");
const productionFrame = document.getElementById("productionFrame");
const stagingFrame = document.getElementById("stagingFrame");
const productionEmpty = document.getElementById("productionEmpty");
const stagingEmpty = document.getElementById("stagingEmpty");
const stagingOffline = document.getElementById("stagingOffline");
const syncBtn = document.getElementById("syncBtn");
const pullBtn = document.getElementById("pullBtn");
const pushBtn = document.getElementById("pushBtn");
const regenerateCssBtn = document.getElementById("regenerateCssBtn");
const refreshProduction = document.getElementById("refreshProduction");
const refreshStaging = document.getElementById("refreshStaging");
const toastContainer = document.getElementById("toastContainer");

// Toast notifications
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// API helpers
async function api(endpoint, options = {}) {
  const response = await fetch(`/api${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

// Load configuration
async function loadConfig() {
  try {
    config = await api("/config");
    siteName.textContent = config.site.name;
    stagingOnline = config.staging.running;
    updateStagingStatus();
  } catch (err) {
    showToast("Failed to load config: " + err.message, "error");
  }
}

// Update staging status indicator
function updateStagingStatus() {
  const dot = stagingStatus.querySelector(".status-dot");
  const text = stagingStatus.querySelector("span:last-child");

  if (stagingOnline) {
    dot.classList.remove("offline");
    dot.classList.add("online");
    text.textContent = "Staging: Online";
  } else {
    dot.classList.remove("online");
    dot.classList.add("offline");
    text.textContent = "Staging: Offline";
  }

  // Update staging panel
  if (currentPageId) {
    stagingEmpty.classList.add("hidden");
    if (stagingOnline) {
      stagingOffline.classList.add("hidden");
      stagingFrame.classList.remove("hidden");
    } else {
      stagingOffline.classList.remove("hidden");
      stagingFrame.classList.add("hidden");
    }
  }
}

// Load pages
async function loadPages() {
  try {
    pages = await api("/pages");
    pageSelector.innerHTML = '<option value="">Select a page...</option>';

    for (const page of pages) {
      const option = document.createElement("option");
      option.value = page.id;
      option.textContent = `${page.title} (ID: ${page.id})`;
      pageSelector.appendChild(option);
    }

    pageSelector.disabled = false;
  } catch (err) {
    showToast("Failed to load pages: " + err.message, "error");
  }
}

// Select a page
function selectPage(pageId) {
  currentPageId = pageId;
  const page = pages.find((p) => p.id === Number(pageId));

  if (!page) {
    // Reset to empty state
    productionFrame.classList.add("hidden");
    stagingFrame.classList.add("hidden");
    productionEmpty.classList.remove("hidden");
    stagingEmpty.classList.remove("hidden");
    stagingOffline.classList.add("hidden");
    syncBtn.disabled = true;
    pullBtn.disabled = true;
    pushBtn.disabled = true;
    regenerateCssBtn.disabled = true;
    return;
  }

  // Show production frame
  productionEmpty.classList.add("hidden");
  productionFrame.classList.remove("hidden");
  productionFrame.src = page.url;

  // Show staging frame if online
  stagingEmpty.classList.add("hidden");
  if (stagingOnline) {
    stagingOffline.classList.add("hidden");
    stagingFrame.classList.remove("hidden");
    stagingFrame.src = page.stagingUrl;
  } else {
    stagingOffline.classList.remove("hidden");
    stagingFrame.classList.add("hidden");
  }

  // Enable buttons
  syncBtn.disabled = !stagingOnline;
  pullBtn.disabled = false;
  pushBtn.disabled = false;
  regenerateCssBtn.disabled = false;
}

// Sync page to staging
async function syncToStaging() {
  if (!currentPageId) return;

  syncBtn.disabled = true;
  try {
    await api(`/sync/${currentPageId}`, { method: "POST" });
    showToast("Synced to staging successfully", "success");
    // Refresh staging frame
    if (stagingFrame.src) {
      stagingFrame.src = stagingFrame.src;
    }
  } catch (err) {
    showToast("Sync failed: " + err.message, "error");
  } finally {
    syncBtn.disabled = !stagingOnline;
  }
}

// Pull page from production
async function pullFromProduction() {
  if (!currentPageId) return;

  pullBtn.disabled = true;
  try {
    await api(`/pull/${currentPageId}`, { method: "POST" });
    showToast("Pulled from production successfully", "success");
  } catch (err) {
    showToast("Pull failed: " + err.message, "error");
  } finally {
    pullBtn.disabled = false;
  }
}

// Push page to production
async function pushToProduction() {
  if (!currentPageId) return;

  if (!confirm("Are you sure you want to push local changes to production?")) {
    return;
  }

  pushBtn.disabled = true;
  try {
    await api(`/push/${currentPageId}`, { method: "POST" });
    showToast("Pushed to production successfully", "success");
    // Refresh production frame
    if (productionFrame.src) {
      productionFrame.src = productionFrame.src;
    }
  } catch (err) {
    showToast("Push failed: " + err.message, "error");
  } finally {
    pushBtn.disabled = false;
  }
}

// Regenerate CSS
async function regenerateCss() {
  if (!currentPageId) return;

  regenerateCssBtn.disabled = true;
  try {
    await api(`/regenerate-css/${currentPageId}`, { method: "POST" });
    showToast("CSS cache invalidated. Reload to see changes.", "success");
  } catch (err) {
    showToast("Regenerate CSS failed: " + err.message, "error");
  } finally {
    regenerateCssBtn.disabled = false;
  }
}

// Refresh frames
function refreshProductionFrame() {
  if (productionFrame.src) {
    productionFrame.src = productionFrame.src;
  }
}

function refreshStagingFrame() {
  if (stagingFrame.src) {
    stagingFrame.src = stagingFrame.src;
  }
}

// Check staging status periodically
async function checkStagingStatus() {
  try {
    const status = await api("/staging/status");
    const wasOnline = stagingOnline;
    stagingOnline = status.running;

    if (wasOnline !== stagingOnline) {
      updateStagingStatus();
      if (stagingOnline) {
        showToast("Staging environment is now online", "success");
      } else {
        showToast("Staging environment went offline", "error");
      }
    }
  } catch {
    // Ignore errors during status check
  }
}

// Event listeners
pageSelector.addEventListener("change", (e) => selectPage(e.target.value));
syncBtn.addEventListener("click", syncToStaging);
pullBtn.addEventListener("click", pullFromProduction);
pushBtn.addEventListener("click", pushToProduction);
regenerateCssBtn.addEventListener("click", regenerateCss);
refreshProduction.addEventListener("click", refreshProductionFrame);
refreshStaging.addEventListener("click", refreshStagingFrame);

// Initialize
async function init() {
  await loadConfig();
  await loadPages();

  // Check staging status every 10 seconds
  setInterval(checkStagingStatus, 10000);
}

init();
