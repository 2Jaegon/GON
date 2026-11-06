// ==========================================================================
// Gon ASO Web — claude.ai & side_pj Direct Chat Interface Architecture
// Pure clean typography. No icons or emojis outside the sidebar navigation.
// ==========================================================================

const API_HOST = (typeof window !== "undefined" && window.location && window.location.hostname)
  ? window.location.hostname
  : "127.0.0.1";
const API_URL = `http://${API_HOST}:4000/api/v1`;

let currentWorkspaceId = "00000000-0000-7000-8000-000000000002";
let currentProjectId = "00000000-0000-7000-8000-000000000003";
let activeSessionId = null;
let activeRunId = null;
let activeEventSource = null;
let cachedSessions = [];

// ==========================================================================
// Authenticated API Fetch & Session Handling
// ==========================================================================

async function apiFetch(url, opts = {}) {
  const merged = {
    ...opts,
    credentials: "include",
    headers: {
      ...(opts.headers || {}),
    },
  };
  const res = await fetch(url, merged);
  if (res.status === 401) {
    showLoginView();
    throw new Error("UNAUTHENTICATED");
  }
  return res;
}

let currentAuthMode = "login";
let currentGoogleClientId = "";

function showLoginView() {
  const loginView = document.getElementById("login-view");
  const appLayout = document.getElementById("app-layout");
  const floatingToggle = document.getElementById("floating-sidebar-toggle");

  if (loginView) loginView.classList.remove("hidden");
  if (appLayout) appLayout.classList.add("hidden");
  if (floatingToggle) floatingToggle.classList.add("hidden");

  switchAuthMode(currentAuthMode);
  initGoogleSignIn();
}

function hideLoginView() {
  const loginView = document.getElementById("login-view");
  const appLayout = document.getElementById("app-layout");
  const floatingToggle = document.getElementById("floating-sidebar-toggle");

  if (loginView) loginView.classList.add("hidden");
  if (appLayout) appLayout.classList.remove("hidden");
  if (floatingToggle) floatingToggle.classList.remove("hidden");
}

function switchAuthMode(mode) {
  currentAuthMode = mode === "signup" ? "signup" : "login";
  const tabLogin = document.getElementById("auth-tab-login");
  const tabSignup = document.getElementById("auth-tab-signup");
  const nameGroup = document.getElementById("auth-name-group");
  const submitBtn = document.getElementById("auth-submit-btn");
  const switchPrompt = document.getElementById("auth-switch-prompt");
  const switchBtn = document.getElementById("auth-switch-btn");
  const passwordInput = document.getElementById("auth-password-input");
  const errEl = document.getElementById("login-error-message");

  if (errEl) errEl.classList.add("hidden");

  const isSignup = currentAuthMode === "signup";
  if (tabLogin) {
    tabLogin.classList.toggle("active", !isSignup);
    tabLogin.setAttribute("aria-selected", String(!isSignup));
  }
  if (tabSignup) {
    tabSignup.classList.toggle("active", isSignup);
    tabSignup.setAttribute("aria-selected", String(isSignup));
  }
  if (nameGroup) {
    nameGroup.classList.toggle("hidden", !isSignup);
  }
  if (submitBtn) {
    submitBtn.textContent = isSignup ? "회원가입" : "로그인";
  }
  if (switchPrompt) {
    switchPrompt.textContent = isSignup ? "이미 계정이 있으신가요?" : "계정이 없으신가요?";
  }
  if (switchBtn) {
    switchBtn.textContent = isSignup ? "로그인" : "회원가입";
  }
  if (passwordInput) {
    passwordInput.placeholder = isSignup ? "비밀번호 입력 (최소 6자 이상)" : "비밀번호 입력";
    passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
  }
}

function toggleAuthMode() {
  switchAuthMode(currentAuthMode === "login" ? "signup" : "login");
}

function showAuthError(msg) {
  const errEl = document.getElementById("login-error-message");
  if (errEl) {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  }
}

async function handleEmailAuthSubmit(event) {
  if (event) event.preventDefault();
  const emailInput = document.getElementById("auth-email-input");
  const passwordInput = document.getElementById("auth-password-input");
  const nameInput = document.getElementById("auth-name-input");
  const submitBtn = document.getElementById("auth-submit-btn");
  const errEl = document.getElementById("login-error-message");

  if (errEl) errEl.classList.add("hidden");

  const email = emailInput ? emailInput.value.trim() : "";
  const password = passwordInput ? passwordInput.value : "";
  const name = nameInput ? nameInput.value.trim() : "";

  if (!email || !password) {
    showAuthError("이메일과 비밀번호를 입력해 주세요.");
    return;
  }

  const isSignup = currentAuthMode === "signup";
  const endpoint = isSignup ? `${API_URL}/auth/signup` : `${API_URL}/auth/login`;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = isSignup ? "가입 처리 중..." : "로그인 중...";
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(isSignup ? { email, password, name } : { email, password }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const code = data?.error?.code;
      const message = data?.error?.message || (isSignup ? "회원가입에 실패했어요." : "로그인에 실패했어요.");
      if (!isSignup && code === "USER_NOT_FOUND") {
        switchAuthMode("signup");
        showAuthError("등록된 계정이 없어요. 회원가입 탭으로 전환했어요. 이름과 비밀번호를 확인하고 계정을 등록해 주세요.");
        return;
      }
      showAuthError(message);
      return;
    }

    if (passwordInput) passwordInput.value = "";
    hideLoginView();
    await init();
  } catch (err) {
    console.error("Email auth error:", err);
    showAuthError("서버와 통신 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = currentAuthMode === "signup" ? "회원가입" : "로그인";
    }
  }
}

let isGisInitialized = false;

async function initGoogleSignIn() {
  const errEl = document.getElementById("login-error-message");
  const warnEl = document.getElementById("login-config-warning");
  const btnContainer = document.getElementById("google-signin-btn-container");
  const fallbackBtn = document.getElementById("google-fallback-btn");

  if (errEl) errEl.classList.add("hidden");
  if (warnEl) warnEl.classList.add("hidden");

  try {
    const configRes = await fetch(`${API_URL}/auth/config`, { credentials: "include" });
    if (!configRes.ok) {
      showAuthError("인증 설정을 불러올 수 없어요.");
      return;
    }

    const configData = await configRes.json();
    const googleClientId = configData.googleClientId || "";
    currentGoogleClientId = googleClientId;

    if (!googleClientId || googleClientId.trim() === "") {
      if (btnContainer) {
        btnContainer.innerHTML = "";
        btnContainer.classList.add("hidden");
      }
      if (fallbackBtn) fallbackBtn.classList.remove("hidden");
      return;
    }

    let retryCount = 0;
    function checkGisLoaded() {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        try {
          window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: handleGoogleSignInCallback,
          });
          isGisInitialized = true;
          if (fallbackBtn) fallbackBtn.classList.add("hidden");
          if (btnContainer) {
            btnContainer.classList.remove("hidden");
            btnContainer.innerHTML = "";
            window.google.accounts.id.renderButton(btnContainer, {
              theme: "outline",
              size: "large",
              shape: "rectangular",
              width: 360,
              text: "continue_with",
              locale: "ko",
            });
          }
        } catch (gisErr) {
          console.warn("Google GIS init warning:", gisErr);
          if (fallbackBtn) fallbackBtn.classList.remove("hidden");
        }
      } else if (retryCount < 20) {
        retryCount += 1;
        setTimeout(checkGisLoaded, 150);
      } else {
        if (fallbackBtn) fallbackBtn.classList.remove("hidden");
      }
    }
    checkGisLoaded();
  } catch (err) {
    console.error("Failed to init Google sign-in:", err);
    showAuthError("서버 연결에 실패했어요.");
  }
}

function triggerGoogleAuthFlow() {
  if (currentGoogleClientId && window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        openGoogleConnectModal();
      }
    });
  } else {
    openGoogleConnectModal();
  }
}

function openGoogleConnectModal() {
  const modal = document.getElementById("google-connect-modal-backdrop");
  if (modal) {
    modal.classList.remove("hidden");
    const emailInput = document.getElementById("google-quick-email");
    if (emailInput) emailInput.focus();
  }
}

function closeGoogleConnectModal() {
  const modal = document.getElementById("google-connect-modal-backdrop");
  if (modal) modal.classList.add("hidden");
}

function fillDefaultGoogleAccount() {
  const emailInput = document.getElementById("google-quick-email");
  const nameInput = document.getElementById("google-quick-name");
  if (emailInput) emailInput.value = "ljgon425@gmail.com";
  if (nameInput) nameInput.value = "이재곤";
}

async function handleGoogleQuickConnect(event) {
  if (event) event.preventDefault();
  const emailInput = document.getElementById("google-quick-email");
  const nameInput = document.getElementById("google-quick-name");
  const submitBtn = document.getElementById("google-quick-submit-btn");

  const email = emailInput ? emailInput.value.trim() : "";
  const name = nameInput ? nameInput.value.trim() : "";
  if (!email) return;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "연동 중...";
  }

  try {
    const res = await fetch(`${API_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, name: name || email.split("@")[0] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showAuthError(data?.error?.message || "Google 로그인 처리에 실패했어요.");
      closeGoogleConnectModal();
      return;
    }
    closeGoogleConnectModal();
    hideLoginView();
    await init();
  } catch (err) {
    console.error("Google quick connect error:", err);
    showAuthError("Google 로그인 연동 중 오류가 발생했어요.");
    closeGoogleConnectModal();
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Google로 계속하기";
    }
  }
}

async function handleGoogleSignInCallback(response) {
  const errEl = document.getElementById("login-error-message");
  if (errEl) errEl.classList.add("hidden");

  try {
    const res = await fetch(`${API_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ credential: response.credential }),
    });

    if (res.status === 403) {
      showAuthError("허용되지 않은 계정이에요");
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showAuthError(data?.error?.message || "로그인에 실패했어요. 다시 시도해 주세요.");
      return;
    }

    hideLoginView();
    await init();
  } catch (err) {
    console.error("Google sign-in error:", err);
    showAuthError("로그인 처리 중 오류가 발생했어요.");
  }
}

async function handleLogout() {
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch (err) {
    console.error("Logout error:", err);
  } finally {
    closeProfileDropdown();
    showLoginView();
  }
}

// ==========================================================================
// Sidebar Collapse / Expand State
// ==========================================================================

function initSidebarState() {
  const saved = localStorage.getItem("gon.sidebar_collapsed");
  const isCollapsed = saved === "true";
  applySidebarState(isCollapsed);
}

function toggleSidebarCollapse() {
  const layout = document.getElementById("app-layout");
  const isCurrentlyCollapsed = layout ? layout.classList.contains("sidebar-collapsed") : false;
  applySidebarState(!isCurrentlyCollapsed);
}

function applySidebarState(collapsed) {
  const layout = document.getElementById("app-layout");
  const floatingBtn = document.getElementById("floating-sidebar-toggle");
  if (layout) {
    layout.classList.toggle("sidebar-collapsed", collapsed);
  }
  if (floatingBtn) {
    floatingBtn.classList.toggle("visible", collapsed);
  }
  try {
    localStorage.setItem("gon.sidebar_collapsed", String(collapsed));
  } catch (e) {
    // fallback
  }

  // Smoothly sync canvas resolution across the entire CSS transition
  resizeCobwebCanvas();
  let frames = 0;
  const syncStep = () => {
    resizeCobwebCanvas();
    frames++;
    if (frames < 20) {
      requestAnimationFrame(syncStep);
    }
  };
  requestAnimationFrame(syncStep);
}

// ==========================================================================
// Theme Management (Light / Dark / System Mode)
// ==========================================================================

let currentThemePref = "light";

function initTheme() {
  currentThemePref = localStorage.getItem("gon.theme_preference") || "light";
  applyThemePreference(currentThemePref);

  if (window.matchMedia) {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (currentThemePref === "system") {
        applyThemePreference("system");
      }
    };
    if (media.addEventListener) {
      media.addEventListener("change", handler);
    } else if (media.addListener) {
      media.addListener(handler);
    }
  }
}

function getEffectiveTheme(pref) {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyThemePreference(pref) {
  currentThemePref = pref;
  try {
    localStorage.setItem("gon.theme_preference", pref);
  } catch (e) {
    // fallback
  }

  const effective = getEffectiveTheme(pref);
  document.documentElement.dataset.theme = effective;
  updateThemeModalUI(pref);
}

function updateThemeModalUI(pref) {
  ["light", "dark", "system"].forEach((p) => {
    const card = document.getElementById(`theme-opt-${p}`);
    if (card) {
      card.classList.toggle("active", p === pref);
    }
  });
}

function selectThemeOption(pref) {
  applyThemePreference(pref);
}

// ==========================================================================
// Settings Modal & Profile Dropdown Menu
// ==========================================================================

function toggleProfileDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("profile-dropdown-menu");
  const chevron = document.getElementById("user-chip-chevron");
  const btn = document.getElementById("btn-user-profile");
  if (!menu) return;
  const isClosed = menu.classList.contains("hidden");
  if (isClosed) {
    menu.classList.remove("hidden");
    if (chevron) chevron.classList.add("open");
    if (btn) btn.setAttribute("aria-expanded", "true");
  } else {
    menu.classList.add("hidden");
    if (chevron) chevron.classList.remove("open");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
}

function closeProfileDropdown() {
  const menu = document.getElementById("profile-dropdown-menu");
  const chevron = document.getElementById("user-chip-chevron");
  const btn = document.getElementById("btn-user-profile");
  if (menu) menu.classList.add("hidden");
  if (chevron) chevron.classList.remove("open");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function openSettingsFromProfile() {
  closeProfileDropdown();
  openSettingsModal();
}

function openUsageFromProfile() {
  closeProfileDropdown();
  switchTab("usage");
}

function openConnectionsFromProfile() {
  closeProfileDropdown();
  switchTab("connections");
}

function openRunnerFromProfile() {
  closeProfileDropdown();
  switchTab("runner");
}

document.addEventListener("click", (e) => {
  const menu = document.getElementById("profile-dropdown-menu");
  const container = document.getElementById("user-profile-menu-container");
  if (menu && !menu.classList.contains("hidden")) {
    if (!container || !container.contains(e.target)) {
      closeProfileDropdown();
    }
  }
});

function openSettingsModal() {
  const modal = document.getElementById("settings-modal-backdrop");
  if (modal) {
    updateThemeModalUI(currentThemePref);
    renderSettingsWorkspaceFolders();
    modal.classList.remove("hidden");
  }
}

function closeSettingsModal() {
  const modal = document.getElementById("settings-modal-backdrop");
  if (modal) {
    modal.classList.add("hidden");
  }
}

function closeSettingsModalOnBackdrop(e) {
  if (e.target && e.target.id === "settings-modal-backdrop") {
    closeSettingsModal();
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSettingsModal();
    closeProfileDropdown();
  }
});

// ==========================================================================
// Sidebar Recent Runs / History (Collapsible Toggle)
// ==========================================================================

let isSidebarRunsOpen = true;

function toggleSidebarRuns() {
  isSidebarRunsOpen = !isSidebarRunsOpen;
  const container = document.getElementById("sidebar-runs-container");
  const chevron = document.getElementById("sidebar-runs-chevron");
  if (container) {
    container.classList.toggle("collapsed", !isSidebarRunsOpen);
  }
  if (chevron) {
    chevron.classList.toggle("open", isSidebarRunsOpen);
  }
}

function formatRunTitle(rawRequest) {
  if (!rawRequest || typeof rawRequest !== "string") return "새 작업";
  let line = rawRequest.trim().split("\n")[0].trim();
  line = line.replace(/^[#*\-•\d.]+\s*/, "").trim();
  if (line.length > 28) {
    line = line.slice(0, 28) + "...";
  }
  return line || "새 작업";
}

function groupRunsIntoSessions(runs) {
  const sessionsMap = new Map();
  for (const r of runs) {
    const sessId = (r.runContext && r.runContext.sessionId) ? r.runContext.sessionId : r.id;
    if (!sessionsMap.has(sessId)) {
      sessionsMap.set(sessId, {
        id: sessId,
        title: formatRunTitle(r.rawRequest),
        createdAt: r.createdAt || new Date().toISOString(),
        updatedAt: r.createdAt || new Date().toISOString(),
        runs: [r]
      });
    } else {
      const sess = sessionsMap.get(sessId);
      sess.runs.push(r);
      const t = new Date(r.createdAt || 0).getTime();
      if (t > new Date(sess.updatedAt).getTime()) {
        sess.updatedAt = r.createdAt;
      }
    }
  }

  for (const sess of sessionsMap.values()) {
    sess.runs.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    if (sess.runs.length > 0 && sess.runs[0].rawRequest) {
      sess.title = formatRunTitle(sess.runs[0].rawRequest);
    }
  }

  return Array.from(sessionsMap.values()).sort((a, b) => {
    return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
  });
}

let sidebarSearchQuery = "";

function renderSidebarSessions(sessions) {
  cachedSessions = sessions || [];
  const list = document.getElementById("sidebar-runs-list");
  const countEl = document.getElementById("sidebar-runs-count");
  if (countEl) countEl.textContent = sessions ? sessions.length : 0;

  if (!list) return;
  if (!sessions || sessions.length === 0) {
    list.innerHTML = `<div class="sidebar-runs-empty">최근 항목이 없습니다</div>`;
    return;
  }

  const q = sidebarSearchQuery.trim();
  const visible = q && window.filterSessions ? window.filterSessions(sessions, q) : sessions;
  if (visible.length === 0) {
    list.innerHTML = `<div class="sidebar-runs-empty">검색 결과가 없어요</div>`;
    return;
  }

  list.innerHTML = visible.map((s) => {
    const isActive = activeSessionId === s.id;
    return `
      <div class="sidebar-run-item-wrap ${isActive ? "active" : ""}">
        <button type="button" class="sidebar-run-item" onclick="viewSession('${s.id}')" title="${escapeHtml(s.title || '')}">
          <span class="sidebar-run-title">${q && window.highlightMatch ? window.highlightMatch(s.title || '새 대화', q) : escapeHtml(s.title || '새 대화')}</span>
        </button>
        <button type="button" class="sidebar-run-delete-btn" onclick="deleteSession('${s.id}', event)" title="대화 세션 삭제" aria-label="대화 세션 삭제">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
  }).join("");
}

function renderSidebarRuns(items) {
  const sessions = groupRunsIntoSessions(items || []);
  renderSidebarSessions(sessions);
}

async function loadSidebarRuns() {
  if (!currentWorkspaceId || !currentProjectId) return;
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/projects/${currentProjectId}/runs`);
    if (res.ok) {
      const data = await res.json();
      const items = data.items || [];
      const sessions = groupRunsIntoSessions(items);
      try {
        localStorage.setItem("gon.sessions_cache", JSON.stringify(sessions));
      } catch (e) {}
      renderSidebarSessions(sessions);
    }
  } catch (err) {
    console.warn("Load sidebar runs error:", err);
  }
}

// ==========================================================================
// Custom Confirmation Dialog & Toast Notifications
// ==========================================================================

function showConfirmDialog({ title = "확인", message = "", confirmText = "삭제", cancelText = "취소", danger = true } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById("confirm-dialog-backdrop");
    const titleEl = document.getElementById("confirm-modal-title");
    const descEl = document.getElementById("confirm-modal-desc");
    const confirmBtn = document.getElementById("confirm-modal-confirm-btn");
    const cancelBtn = document.getElementById("confirm-modal-cancel-btn");

    if (!backdrop || !confirmBtn || !cancelBtn) {
      resolve(confirm(message || title));
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = message;
    if (confirmText) confirmBtn.textContent = confirmText;
    if (cancelText) cancelBtn.textContent = cancelText;

    confirmBtn.className = danger ? "btn btn-danger" : "btn btn-primary";

    const cleanup = () => {
      backdrop.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onBackdrop);
      window.removeEventListener("keydown", onKeyDown);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onBackdrop = (e) => {
      if (e.target === backdrop) {
        cleanup();
        resolve(false);
      }
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        cleanup();
        resolve(false);
      } else if (e.key === "Enter") {
        cleanup();
        resolve(true);
      }
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onBackdrop);
    window.addEventListener("keydown", onKeyDown);

    backdrop.classList.remove("hidden");
    confirmBtn.focus();
  });
}

function showToast(message, type = "info") {
  let toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = `gon-toast toast-${type}`;
  toast.innerHTML = `<span class="toast-message">${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("show");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toast.remove();
    }, 250);
  }, 2600);
}

async function deleteSession(sessionId, e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  const confirmed = await showConfirmDialog({
    title: "대화 기록 삭제",
    message: "이 대화 기록을 삭제하시겠습니까? 삭제된 대화는 복구할 수 없습니다.",
    confirmText: "삭제",
    cancelText: "취소",
    danger: true
  });
  if (!confirmed) return;

  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/projects/${currentProjectId}/sessions/${sessionId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      cachedSessions = cachedSessions.filter((s) => s.id !== sessionId);
      try {
        localStorage.setItem("gon.sessions_cache", JSON.stringify(cachedSessions));
      } catch {}
      if (activeSessionId === sessionId) {
        startNewConversation();
      } else {
        renderSidebarSessions(cachedSessions);
      }
      showToast("대화 기록이 삭제되었습니다.", "success");
    } else {
      showToast("대화 삭제에 실패했습니다.", "error");
    }
  } catch (err) {
    console.error("Delete session error:", err);
    showToast("서버 연결 실패로 대화를 삭제하지 못했습니다.", "error");
  }
}

async function deleteRun(runId, e) {
  return deleteSession(runId, e);
}

// ==========================================================================
// Chat Expand / Collapse Toggle (side_pj isChatExpanded exact behavior)
// ==========================================================================

let isChatExpanded = false;

function toggleChatExpand() {
  const chatView = document.getElementById("view-chat");
  const panel = document.getElementById("chat-panel-container");
  const btn = document.getElementById("btn-chat-expand");
  if (!chatView) return;

  const isEmptyMode = chatView.classList.contains("empty-mode");
  if (isEmptyMode) {
    const isNowOpen = !chatView.classList.contains("graph-open");
    chatView.classList.toggle("graph-open", isNowOpen);
    chatView.classList.remove("graph-collapsed");
    isChatExpanded = !isNowOpen;
  } else {
    isChatExpanded = !chatView.classList.contains("graph-collapsed");
    chatView.classList.toggle("graph-collapsed", isChatExpanded);
    if (panel) panel.classList.toggle("chat-expanded", isChatExpanded);
  }

  if (btn) {
    const maxIcon = btn.querySelector(".icon-maximize");
    const minIcon = btn.querySelector(".icon-minimize");
    if (maxIcon && minIcon) {
      maxIcon.classList.toggle("hidden", isChatExpanded);
      minIcon.classList.toggle("hidden", !isChatExpanded);
    }
    btn.setAttribute(
      "title",
      isChatExpanded ? "우측 그래프 사이드바 열기 [Esc]" : "우측 그래프 사이드바 접기 [Esc]"
    );
  }

  resizeCobwebCanvas();
  let frames = 0;
  const syncStep = () => {
    resizeCobwebCanvas();
    frames++;
    if (frames < 20) requestAnimationFrame(syncStep);
  };
  requestAnimationFrame(syncStep);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isChatExpanded) {
    toggleChatExpand();
  }
});

// ==========================================================================
// Model Picker & Reasoning Effort (subscription models from GET /models)
// ==========================================================================

const EFFORT_LABELS = {
  low: "Low",
  medium: "중간",
  high: "High",
};

// usage.provider / connection provider -> AI display name + logo
const AI_BRANDS = {
  anthropic: { name: "Claude", logo: "/logos/anthropic.svg" },
  google: { name: "Gemini", logo: "/logos/google.svg" },
  antigravity: { name: "Gemini", logo: "/logos/google.svg" },
  openai: { name: "Codex", logo: "/logos/openai.svg" },
};

function aiBrand(provider) {
  return AI_BRANDS[provider] || { name: "AI", logo: null };
}

// Avatar for an assistant answer; unknown providers (e.g. "mock") get a neutral icon.
function assistantAvatarHtml(provider) {
  const brand = aiBrand(provider);
  if (brand.logo) {
    return `<img src="${brand.logo}" alt="${escapeHtml(brand.name)}" class="assistant-avatar" width="24" height="24">`;
  }
  return `<svg class="assistant-avatar assistant-avatar-generic" role="img" aria-label="AI" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"></circle><path d="M8 13s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>`;
}

function setTurnAvatar(runId, provider) {
  const turn = document.getElementById(`turn-${runId}`);
  const old = turn && turn.querySelector(".assistant-avatar");
  if (old) old.outerHTML = assistantAvatarHtml(provider);
}

let modelCatalog = []; // GET /models -> subscription[]
let modelSelection = null; // { connectionId, model, effort }

function selectedConnection() {
  return modelSelection ? modelCatalog.find((c) => c.connectionId === modelSelection.connectionId) : null;
}

function defaultEffort(conn) {
  const efforts = (conn && conn.efforts && conn.efforts.length > 0) ? conn.efforts : ["low", "medium", "high"];
  return efforts.includes("medium") ? "medium" : efforts[0] || "medium";
}

function getModelBaseId(modelId) {
  if (!modelId) return "";
  return String(modelId).replace(/-(low|medium|high)$/i, "");
}

function cleanModelLabel(label) {
  if (!label) return "";
  return String(label).replace(/\s*\((Low|Medium|High)\)\s*$/i, "").trim();
}

function resolveModelIdForEffort(conn, modelId, effort) {
  if (!conn || !Array.isArray(conn.models) || !modelId) return modelId;
  if (!effort) return modelId;
  const baseId = getModelBaseId(modelId);
  const candidate = `${baseId}-${effort}`;
  const found = conn.models.find((m) => m.id === candidate);
  if (found) return found.id;
  const exact = conn.models.find((m) => m.id === modelId);
  if (exact) return exact.id;
  const anyVariant = conn.models.find((m) => getModelBaseId(m.id) === baseId);
  return anyVariant ? anyVariant.id : modelId;
}

function deduplicateConnectionModels(conn) {
  if (!conn || !Array.isArray(conn.models)) return [];
  if (conn.provider !== "google") return conn.models;
  const seenBases = new Map();
  for (const m of conn.models) {
    const baseId = getModelBaseId(m.id);
    if (!seenBases.has(baseId)) {
      seenBases.set(baseId, {
        id: m.id,
        baseId,
        label: cleanModelLabel(m.label)
      });
    } else if (/-medium$/i.test(m.id)) {
      seenBases.set(baseId, {
        id: m.id,
        baseId,
        label: cleanModelLabel(m.label)
      });
    }
  }
  return Array.from(seenBases.values());
}

// Keep the saved selection if it is still offered; otherwise fall back to the first model.
function normalizeModelSelection(saved) {
  const conn = saved && modelCatalog.find((c) => c.connectionId === saved.connectionId && c.models.some((m) => m.id === saved.model || getModelBaseId(m.id) === getModelBaseId(saved.model)));
  if (conn) {
    const efforts = (conn.efforts && conn.efforts.length > 0) ? conn.efforts : ["low", "medium", "high"];
    const effort = efforts.includes(saved.effort) ? saved.effort : defaultEffort(conn);
    const resolvedModel = resolveModelIdForEffort(conn, saved.model, effort);
    return { connectionId: conn.connectionId, model: resolvedModel, effort };
  }
  const first = modelCatalog.find((c) => c.models.length > 0);
  if (!first) return null;
  const effort = defaultEffort(first);
  const resolvedModel = resolveModelIdForEffort(first, first.models[0].id, effort);
  return { connectionId: first.connectionId, model: resolvedModel, effort };
}

let modelCatalogLoadError = false;

function saveModelSelection() {
  try {
    if (!modelSelection) {
      localStorage.removeItem("gon.model_selection");
    } else {
      localStorage.setItem("gon.model_selection", JSON.stringify(modelSelection));
    }
  } catch (e) {}
}

function initModelPicker() {
  const list = document.getElementById("popover-model-list");
  if (list) {
    list.addEventListener("click", (e) => {
      const item = e.target.closest(".popover-model-item");
      if (item) selectModelItem(item.dataset.connectionId, item.dataset.modelId);
    });
  }
  renderModelPicker();
}

async function loadModelCatalog() {
  if (!currentWorkspaceId) return;
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/models`);
    if (!res.ok) {
      modelCatalogLoadError = true;
      renderModelPicker();
      return;
    }
    const data = await res.json();
    modelCatalog = Array.isArray(data.subscription) ? data.subscription : [];
    modelCatalogLoadError = false;
  } catch (err) {
    console.warn("Load models error:", err);
    modelCatalogLoadError = true;
    renderModelPicker();
    return;
  }
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("gon.model_selection") || "null");
  } catch (e) {}
  modelSelection = normalizeModelSelection(modelSelection || saved);
  saveModelSelection();
  renderModelPicker();
}

function renderModelPicker() {
  const conn = selectedConnection();
  const labelEl = document.getElementById("model-picker-display-label");
  if (labelEl) {
    const model = conn && conn.models.find((m) => m.id === modelSelection.model);
    if (!model) {
      labelEl.textContent = "모델 선택";
    } else {
      const cleanName = conn.provider === "google" ? cleanModelLabel(model.label) : model.label;
      const effort = modelSelection.effort ? ` · ${EFFORT_LABELS[modelSelection.effort] || modelSelection.effort}` : "";
      labelEl.textContent = `${cleanName}${effort}`;
    }
  }

  const efforts = conn ? ((conn.efforts && conn.efforts.length > 0) ? conn.efforts : ["low", "medium", "high"]) : [];
  const effortRow = document.getElementById("popover-effort-row");
  if (effortRow) {
    effortRow.classList.toggle("hidden", efforts.length === 0);
    if (effortRow.nextElementSibling) effortRow.nextElementSibling.classList.toggle("hidden", efforts.length === 0);
  }
  document.querySelectorAll(".effort-btn").forEach((btn) => {
    btn.classList.toggle("hidden", !efforts.includes(btn.dataset.effort));
    btn.classList.toggle("active", !!modelSelection && btn.dataset.effort === modelSelection.effort);
  });

  const composerEffortWrap = document.getElementById("composer-effort-wrapper");
  const composerEffortSelect = document.getElementById("composer-effort-select");
  if (composerEffortWrap) {
    composerEffortWrap.classList.toggle("hidden", !conn || efforts.length === 0);
  }
  if (composerEffortSelect && modelSelection && modelSelection.effort) {
    composerEffortSelect.value = modelSelection.effort;
  }

  const list = document.getElementById("popover-model-list");
  if (!list) return;
  if (modelCatalog.length === 0) {
    if (modelCatalogLoadError) {
      list.innerHTML = `
        <li class="popover-empty">
          <span>모델 목록을 불러오지 못했어요</span>
          <button type="button" class="btn btn-sm" onclick="loadModelCatalog()">다시 시도</button>
        </li>`;
    } else {
      list.innerHTML = `
        <li class="popover-empty">
          <span>연결된 AI가 없어요</span>
          <button type="button" class="btn btn-sm" onclick="openConnectionsFromPicker()">연결 화면으로 가기</button>
        </li>`;
    }
    return;
  }
  list.innerHTML = `<li class="popover-section-title">구독 AI 서비스 및 모델</li>` + modelCatalog.map((c) => {
    const brand = aiBrand(c.provider);
    const plan = c.planVerified && c.plan ? c.plan.toUpperCase() : (c.planVerified ? "구독 연결됨" : "구독");
    const logo = brand.logo ? `<img src="${brand.logo}" alt="" width="16" height="16">` : "";
    const displayModels = deduplicateConnectionModels(c);
    const items = displayModels.map((m) => {
      const active = modelSelection &&
        modelSelection.connectionId === c.connectionId &&
        (modelSelection.model === m.id || (c.provider === "google" && getModelBaseId(modelSelection.model) === getModelBaseId(m.id)));
      return `
        <li class="popover-model-item${active ? " active" : ""}" data-connection-id="${escapeHtml(c.connectionId)}" data-model-id="${escapeHtml(m.id)}">
          <div class="model-meta"><span class="model-name">${escapeHtml(m.label)}</span></div>
          <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </li>`;
    }).join("");
    return `
      <li class="popover-provider-head">${logo}<span class="popover-provider-name">${escapeHtml(cleanServiceTitle(c.provider, c.displayName))}</span><span class="popover-provider-plan">${escapeHtml(plan)}</span></li>${items}`;
  }).join("");
}

function openConnectionsFromPicker() {
  closeModelPickerPopover();
  switchNavTab("connections");
}

function closeModelPickerPopover() {
  const popover = document.getElementById("model-picker-popover");
  if (popover) popover.classList.add("hidden");
  const btn = document.getElementById("composer-model-picker-btn");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function toggleModelPickerPopover(e) {
  if (e) e.stopPropagation();
  const popover = document.getElementById("model-picker-popover");
  const btn = document.getElementById("composer-model-picker-btn");
  if (!popover) return;
  if (popover.classList.contains("hidden")) {
    popover.classList.remove("hidden");
    if (btn) btn.setAttribute("aria-expanded", "true");
    loadModelCatalog(); // pick up connections added since the last load
  } else {
    closeModelPickerPopover();
  }
}

function selectModelEffort(effort) {
  if (!modelSelection) return;
  const conn = selectedConnection();
  modelSelection.effort = effort;
  if (conn) {
    modelSelection.model = resolveModelIdForEffort(conn, modelSelection.model, effort);
  }
  saveModelSelection();
  renderModelPicker();
}

function selectModelItem(connectionId, modelId) {
  const conn = modelCatalog.find((c) => c.connectionId === connectionId);
  if (!conn) return;
  const efforts = (conn.efforts && conn.efforts.length > 0) ? conn.efforts : ["low", "medium", "high"];
  const current = modelSelection && modelSelection.effort;
  const nextEffort = efforts.includes(current) ? current : defaultEffort(conn);
  const resolvedModel = resolveModelIdForEffort(conn, modelId, nextEffort);
  modelSelection = { connectionId, model: resolvedModel, effort: nextEffort };
  saveModelSelection();
  renderModelPicker();
  closeModelPickerPopover();
}

document.addEventListener("click", (e) => {
  const popover = document.getElementById("model-picker-popover");
  const container = document.getElementById("model-picker-container");
  if (popover && !popover.classList.contains("hidden")) {
    if (!container || !container.contains(e.target)) closeModelPickerPopover();
  }
});

// ==========================================================================
// Live Real-Time Dot Cobweb Nexus Visualizer Engine (Canvas 2D, 60fps)
// Visualizes parallel task breakdown as dots and cobweb lines
// ==========================================================================

let cobwebCanvas = null;
let cobwebCtx = null;
let cobwebAnimFrame = null;
let cobwebPan = { x: 0, y: 0 };
let cobwebIsDragging = false;
let cobwebDragStart = { x: 0, y: 0 };

// Center ASO Orchestrator Node
const cobwebCoreNode = {
  radius: 13,
  pulse: 0,
  label: "ASO Core",
};

// Parallel Task Nodes list
let cobwebTaskNodes = [];
// Moving data/signal particles across cobweb lines
let cobwebParticles = [];
// Ambient floating ether dust points
let cobwebAmbientDots = [];

function initCobwebCanvas() {
  cobwebCanvas = document.getElementById("dot-cobweb-canvas");
  if (!cobwebCanvas) return;
  cobwebCtx = cobwebCanvas.getContext("2d");

  // Create ambient dots for living intelligence feel
  cobwebAmbientDots = [];
  for (let i = 0; i < 36; i++) {
    cobwebAmbientDots.push({
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 350,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      radius: Math.random() * 1.5 + 1.2,
      alpha: Math.random() * 0.25 + 0.15,
    });
  }

  // Setup interactions: drag to pan
  cobwebCanvas.addEventListener("mousedown", (e) => {
    cobwebIsDragging = true;
    cobwebDragStart = { x: e.clientX - cobwebPan.x, y: e.clientY - cobwebPan.y };
  });

  window.addEventListener("mousemove", (e) => {
    if (cobwebIsDragging) {
      cobwebPan.x = e.clientX - cobwebDragStart.x;
      cobwebPan.y = e.clientY - cobwebDragStart.y;
    }
    handleCobwebHover(e);
  });

  window.addEventListener("mouseup", () => {
    cobwebIsDragging = false;
  });

  window.addEventListener("resize", () => {
    resizeCobwebCanvas();
  });

  if (window.ResizeObserver && cobwebCanvas) {
    const ro = new ResizeObserver(() => {
      resizeCobwebCanvas();
    });
    ro.observe(cobwebCanvas);
  }

  resizeCobwebCanvas();

  // Start rendering loop
  if (cobwebAnimFrame) cancelAnimationFrame(cobwebAnimFrame);
  renderCobwebFrame();
}

function resizeCobwebCanvas() {
  if (!cobwebCanvas) return;
  const rect = cobwebCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(rect.width, 200);
  const h = Math.max(rect.height, 150);
  const targetBufferW = Math.round(w * dpr);
  const targetBufferH = Math.round(h * dpr);

  if (cobwebCanvas.width !== targetBufferW || cobwebCanvas.height !== targetBufferH) {
    cobwebCanvas.width = targetBufferW;
    cobwebCanvas.height = targetBufferH;
  }
}

function resetCobwebCamera() {
  cobwebPan = { x: 0, y: 0 };
}

function setCobwebTasks(tasks) {
  if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
    cobwebTaskNodes = [];
    updateCobwebBadge("대기 중");
    return;
  }

  const count = tasks.length;
  updateCobwebBadge(`${count}개 병렬 태스크`);

  const rect = cobwebCanvas ? cobwebCanvas.getBoundingClientRect() : { width: 310, height: 500 };
  const baseW = rect.width || 310;
  const baseH = rect.height || 500;
  const radius = Math.max(68, Math.min(115, Math.min(baseW * 0.34, baseH * 0.28) + count * 4));

  cobwebTaskNodes = tasks.map((t, idx) => {
    const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
    return {
      key: t.key || `task-${idx + 1}`,
      name: t.title || t.key,
      skill: t.skill || "Standard",
      status: "pending", // 'pending' | 'running' | 'completed' | 'failed'
      targetAngle: angle,
      currentAngle: angle,
      dist: radius,
      pulse: 0,
      glow: 0,
      floatOffset: Math.random() * 10,
    };
  });

  // Burst signal particles from core to all task dots
  cobwebTaskNodes.forEach((node) => {
    emitCobwebParticle(0, 0, node, "dispatch");
  });
}

function setCobwebTaskStatus(taskKey, status) {
  const node = cobwebTaskNodes.find((n) => n.key === taskKey);
  if (!node) return;
  node.status = status;

  if (status === "running") {
    node.pulse = 1.0;
    node.glow = 1.0;
    updateCobwebBadge(`실행 중: ${node.name.slice(0, 14)}`);
    // Continuously emit signal particles to running node
    emitCobwebParticle(0, 0, node, "pulse");
  } else if (status === "completed") {
    node.glow = 0.8;
    updateCobwebBadge(`완료됨: ${node.name.slice(0, 14)}`);
    emitCobwebParticle(node, 0, 0, "diff");
  }
}

function setCobwebAllDone() {
  cobwebTaskNodes.forEach((n) => {
    n.status = "completed";
    n.glow = 0.6;
  });
  cobwebCoreNode.pulse = 1.5;
  updateCobwebBadge("모든 태스크 완료");
}

function resetCobweb() {
  cobwebTaskNodes = [];
  cobwebParticles = [];
  cobwebPan = { x: 0, y: 0 };
  updateCobwebBadge("대기 중");
}

function updateCobwebBadge(text) {
  const badge = document.getElementById("cobweb-task-count-badge");
  if (badge) badge.textContent = text;
}

function emitCobwebParticle(from, to, targetNode, type) {
  for (let i = 0; i < 3; i++) {
    cobwebParticles.push({
      progress: Math.random() * 0.2,
      speed: 0.018 + Math.random() * 0.012,
      targetNode: targetNode,
      type: type,
    });
  }
}

function handleCobwebHover(e) {
  if (!cobwebCanvas) return;
  const rect = cobwebCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  if (mouseX < 0 || mouseX > rect.width || mouseY < 0 || mouseY > rect.height) {
    hideCobwebTooltip();
    return;
  }

  const cx = rect.width / 2 + cobwebPan.x;
  const cy = rect.height / 2 + cobwebPan.y;

  // Check hover on task nodes
  let hoveredNode = null;
  for (const node of cobwebTaskNodes) {
    const nx = cx + Math.cos(node.currentAngle) * node.dist;
    const ny = cy + Math.sin(node.currentAngle) * node.dist;
    const dist = Math.hypot(mouseX - nx, mouseY - ny);
    if (dist < 22) {
      hoveredNode = { node, screenX: nx + rect.left, screenY: ny + rect.top };
      break;
    }
  }

  if (hoveredNode) {
    showCobwebTooltip(hoveredNode);
  } else {
    hideCobwebTooltip();
  }
}

function showCobwebTooltip({ node, screenX, screenY }) {
  const tip = document.getElementById("cobweb-node-tooltip");
  if (!tip) return;
  const statusLabel =
    node.status === "running" ? "실행 중" : node.status === "completed" ? "완료" : node.status === "failed" ? "실패" : "대기";
  tip.innerHTML = `
    <strong>${escapeHtml(node.name)}</strong><br>
    스킬: <code>${escapeHtml(node.skill)}</code> · 상태: ${statusLabel}
  `;
  tip.style.left = `${screenX}px`;
  tip.style.top = `${screenY - 12}px`;
  tip.classList.remove("hidden");
}

function hideCobwebTooltip() {
  const tip = document.getElementById("cobweb-node-tooltip");
  if (tip) tip.classList.add("hidden");
}

function renderCobwebFrame() {
  if (!cobwebCanvas || !cobwebCtx) {
    cobwebAnimFrame = requestAnimationFrame(renderCobwebFrame);
    return;
  }

  const rect = cobwebCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetBufferW = Math.round(rect.width * dpr);
  const targetBufferH = Math.round(rect.height * dpr);

  if (cobwebCanvas.width !== targetBufferW || cobwebCanvas.height !== targetBufferH) {
    cobwebCanvas.width = targetBufferW;
    cobwebCanvas.height = targetBufferH;
  }

  const w = rect.width;
  const h = rect.height;

  if (w <= 0 || h <= 0) {
    cobwebAnimFrame = requestAnimationFrame(renderCobwebFrame);
    return;
  }

  cobwebCtx.save();
  cobwebCtx.scale(dpr, dpr);
  cobwebCtx.clearRect(0, 0, w, h);

  const cx = w / 2 + cobwebPan.x;
  const cy = h / 2 + cobwebPan.y;
  const isDark = document.documentElement.dataset.theme === "dark";

  // Palette colors based on comfortable Warm Paper & Dark Chat Ground
  const colorCore = isDark ? "#D97757" : "#C15F3C";
  const colorLine = isDark ? "rgba(217, 119, 87, 0.22)" : "rgba(193, 95, 60, 0.20)";
  const colorPending = isDark ? "#76726A" : "#8C8980";
  const colorRunning = isDark ? "#E48769" : "#C15F3C";
  const colorDone = isDark ? "#22C55E" : "#16A34A";

  const time = performance.now() * 0.001;

  // Dynamically scale task nodes orbit radius with canvas dimensions
  if (cobwebTaskNodes.length > 0) {
    const targetOrbitRadius = Math.max(95, Math.min(210, Math.min(w * 0.22, h * 0.36) + cobwebTaskNodes.length * 6));
    cobwebTaskNodes.forEach((node) => {
      node.dist += (targetOrbitRadius - node.dist) * 0.08;
    });
  }

  // 1. Draw Ambient Floating Dots & subtle mesh lines
  const maxAmbientX = Math.min(w * 0.44, 560);
  const maxAmbientY = Math.min(h * 0.40, 260);

  for (let i = 0; i < cobwebAmbientDots.length; i++) {
    const dot = cobwebAmbientDots[i];
    dot.x += dot.vx;
    dot.y += dot.vy;

    // Boundary bounce
    if (Math.abs(dot.x) > maxAmbientX) dot.vx *= -1;
    if (Math.abs(dot.y) > maxAmbientY) dot.vy *= -1;

    const dx = cx + dot.x;
    const dy = cy + dot.y;

    cobwebCtx.beginPath();
    cobwebCtx.arc(dx, dy, dot.radius, 0, Math.PI * 2);
    cobwebCtx.fillStyle = isDark
      ? `rgba(232, 228, 220, ${dot.alpha * 0.7})`
      : `rgba(102, 100, 94, ${dot.alpha * 0.6})`;
    cobwebCtx.fill();

    // Connect close ambient dots (cobweb effect)
    for (let j = i + 1; j < cobwebAmbientDots.length; j++) {
      const other = cobwebAmbientDots[j];
      const dist = Math.hypot(dot.x - other.x, dot.y - other.y);
      if (dist < 65) {
        cobwebCtx.beginPath();
        cobwebCtx.moveTo(dx, dy);
        cobwebCtx.lineTo(cx + other.x, cy + other.y);
        cobwebCtx.strokeStyle = isDark
          ? `rgba(232, 228, 220, ${(1 - dist / 65) * 0.06})`
          : `rgba(102, 100, 94, ${(1 - dist / 65) * 0.08})`;
        cobwebCtx.lineWidth = 0.75;
        cobwebCtx.stroke();
      }
    }
  }

  // 2. Draw Cobweb Nexus Lines between Core and Task Nodes
  cobwebTaskNodes.forEach((node, i) => {
    // Subtle organic floating movement
    const floatVal = Math.sin(time * 1.5 + node.floatOffset) * 4;
    const actualDist = node.dist + floatVal;
    const nx = cx + Math.cos(node.currentAngle) * actualDist;
    const ny = cy + Math.sin(node.currentAngle) * actualDist;

    // Line from Core to Task Dot
    cobwebCtx.beginPath();
    cobwebCtx.moveTo(cx, cy);
    cobwebCtx.lineTo(nx, ny);
    cobwebCtx.strokeStyle = node.status === "running" ? colorRunning : colorLine;
    cobwebCtx.lineWidth = node.status === "running" ? 1.6 : 1.1;
    cobwebCtx.setLineDash(node.status === "pending" ? [3, 3] : []);
    cobwebCtx.stroke();
    cobwebCtx.setLineDash([]);

    // Line to next neighboring task dot (Spider Cobweb Outer Ring)
    const nextNode = cobwebTaskNodes[(i + 1) % cobwebTaskNodes.length];
    if (nextNode && cobwebTaskNodes.length > 1) {
      const nextFloat = Math.sin(time * 1.5 + nextNode.floatOffset) * 4;
      const nextX = cx + Math.cos(nextNode.currentAngle) * (nextNode.dist + nextFloat);
      const nextY = cy + Math.sin(nextNode.currentAngle) * (nextNode.dist + nextFloat);

      cobwebCtx.beginPath();
      cobwebCtx.moveTo(nx, ny);
      cobwebCtx.lineTo(nextX, nextY);
      cobwebCtx.strokeStyle = isDark ? "rgba(255, 121, 75, 0.15)" : "rgba(255, 121, 75, 0.12)";
      cobwebCtx.lineWidth = 0.85;
      cobwebCtx.stroke();
    }
  });

  // 3. Draw Flowing Signal Particles
  for (let i = cobwebParticles.length - 1; i >= 0; i--) {
    const p = cobwebParticles[i];
    p.progress += p.speed;

    if (p.progress >= 1.0) {
      cobwebParticles.splice(i, 1);
      continue;
    }

    const node = p.targetNode;
    if (!node) continue;

    const nx = cx + Math.cos(node.currentAngle) * node.dist;
    const ny = cy + Math.sin(node.currentAngle) * node.dist;

    const px = cx + (nx - cx) * p.progress;
    const py = cy + (ny - cy) * p.progress;

    cobwebCtx.beginPath();
    cobwebCtx.arc(px, py, 2.5, 0, Math.PI * 2);
    cobwebCtx.fillStyle = colorCore;
    cobwebCtx.shadowColor = colorCore;
    cobwebCtx.shadowBlur = 6;
    cobwebCtx.fill();
    cobwebCtx.shadowBlur = 0;
  }

  // 4. Draw Core Hub Node (ASO Orchestrator Hub)
  cobwebCoreNode.pulse += 0.035;
  const corePulseRadius = cobwebCoreNode.radius + (Math.sin(cobwebCoreNode.pulse) + 1) * 3;

  // Pulse ring
  cobwebCtx.beginPath();
  cobwebCtx.arc(cx, cy, corePulseRadius + 4, 0, Math.PI * 2);
  cobwebCtx.strokeStyle = isDark ? "rgba(217, 119, 87, 0.35)" : "rgba(193, 95, 60, 0.30)";
  cobwebCtx.lineWidth = 1.2;
  cobwebCtx.stroke();

  // Core Main Dot
  cobwebCtx.beginPath();
  cobwebCtx.arc(cx, cy, cobwebCoreNode.radius, 0, Math.PI * 2);
  cobwebCtx.fillStyle = colorCore;
  cobwebCtx.shadowColor = colorCore;
  cobwebCtx.shadowBlur = 10;
  cobwebCtx.fill();
  cobwebCtx.shadowBlur = 0;

  // Core Dot Inner Core
  cobwebCtx.beginPath();
  cobwebCtx.arc(cx, cy, 5, 0, Math.PI * 2);
  cobwebCtx.fillStyle = "#FFFFFF";
  cobwebCtx.fill();

  // Core Label
  cobwebCtx.font = "600 11px Pretendard, system-ui, sans-serif";
  cobwebCtx.fillStyle = isDark ? "#E8E4DC" : "#141413";
  cobwebCtx.textAlign = "center";
  cobwebCtx.fillText("ASO Core", cx, cy + 26);

  // 5. Draw Task Nodes (Parallel Task Dots)
  cobwebTaskNodes.forEach((node) => {
    const floatVal = Math.sin(time * 1.5 + node.floatOffset) * 4;
    const nx = cx + Math.cos(node.currentAngle) * (node.dist + floatVal);
    const ny = cy + Math.sin(node.currentAngle) * (node.dist + floatVal);

    const nodeColor =
      node.status === "completed"
        ? colorDone
        : node.status === "running"
        ? colorRunning
        : node.status === "failed"
        ? "#DC2626"
        : colorPending;

    // Running pulse wave
    if (node.status === "running") {
      node.pulse += 0.05;
      const pulseR = 9 + (Math.sin(node.pulse) + 1) * 4;
      cobwebCtx.beginPath();
      cobwebCtx.arc(nx, ny, pulseR, 0, Math.PI * 2);
      cobwebCtx.strokeStyle = colorRunning;
      cobwebCtx.lineWidth = 1.2;
      cobwebCtx.stroke();
    }

    // Task Dot Circle
    cobwebCtx.beginPath();
    cobwebCtx.arc(nx, ny, 8.5, 0, Math.PI * 2);
    cobwebCtx.fillStyle = nodeColor;
    cobwebCtx.shadowColor = nodeColor;
    cobwebCtx.shadowBlur = node.status === "running" ? 8 : 3;
    cobwebCtx.fill();
    cobwebCtx.shadowBlur = 0;

    // Inner White Dot
    cobwebCtx.beginPath();
    cobwebCtx.arc(nx, ny, 3, 0, Math.PI * 2);
    cobwebCtx.fillStyle = "#FFFFFF";
    cobwebCtx.fill();

    // Node Name Label
    cobwebCtx.font = "500 10.5px Pretendard, system-ui, sans-serif";
    cobwebCtx.fillStyle = isDark ? "#A8A49C" : "#66645E";
    cobwebCtx.textAlign = "center";
    const shortLabel = node.name.length > 12 ? node.name.slice(0, 11) + ".." : node.name;
    cobwebCtx.fillText(shortLabel, nx, ny + 18);
  });

  cobwebCtx.restore();
  cobwebAnimFrame = requestAnimationFrame(renderCobwebFrame);
}

// ==========================================================================
// Navigation & Tab Switching
// ==========================================================================

function switchNavTab(tabId) {
  if (tabId === "custom") {
    openSettingsModal();
    return;
  }
  switchTab(tabId);
}

function ensureSidebarRunsExpanded() {
  const runsList = document.getElementById("sidebar-runs-container");
  const chevron = document.getElementById("runs-chevron");
  if (runsList && runsList.classList.contains("hidden")) {
    runsList.classList.remove("hidden");
    if (chevron) chevron.classList.add("open");
    try { localStorage.setItem("gon.runs_collapsed", "false"); } catch {}
  }
}

function focusSearchInput() {
  const input = document.getElementById("sidebar-search-input");
  const wrap = document.getElementById("sidebar-search-input-wrap");
  const btn = document.getElementById("sidebar-search-btn");
  if (!input) return;

  // Toggle off if already visible
  if (!input.hidden) {
    closeSidebarSearch();
    return;
  }

  ensureSidebarRunsExpanded();
  if (wrap) wrap.classList.remove("hidden");
  input.hidden = false;
  if (btn) {
    btn.classList.add("active");
    btn.setAttribute("aria-expanded", "true");
  }
  input.focus();
  input.select();
}

function closeSidebarSearch() {
  const input = document.getElementById("sidebar-search-input");
  const wrap = document.getElementById("sidebar-search-input-wrap");
  const btn = document.getElementById("sidebar-search-btn");
  if (input) {
    input.value = "";
    input.hidden = true;
  }
  if (wrap) {
    wrap.classList.add("hidden");
  }
  if (btn) {
    btn.classList.remove("active");
    btn.setAttribute("aria-expanded", "false");
  }
  sidebarSearchQuery = "";
  renderSidebarSessions(cachedSessions);
}

(function initSidebarSearch() {
  const input = document.getElementById("sidebar-search-input");
  if (!input) return;
  input.addEventListener("input", () => {
    sidebarSearchQuery = input.value;
    ensureSidebarRunsExpanded();
    renderSidebarSessions(cachedSessions);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSidebarSearch();
    }
  });
  input.addEventListener("blur", () => {
    if (!input.value.trim()) {
      closeSidebarSearch();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (input.hidden) return;
    const searchRow = document.getElementById("sidebar-search-row");
    const runsContainer = document.getElementById("sidebar-runs-container");
    if (searchRow && searchRow.contains(e.target)) return;
    if (runsContainer && runsContainer.contains(e.target)) return;
    if (!input.value.trim()) {
      closeSidebarSearch();
    }
  });
})();

function switchTab(tabId) {
  const normalizedTabId = tabId === "runners" ? "runner" : tabId;
  const target = document.getElementById(`view-${normalizedTabId}`);
  if (!target) {
    return;
  }

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === normalizedTabId);
  });
  document.querySelectorAll(".view-panel").forEach((sec) => {
    sec.classList.remove("active");
  });
  target.classList.add("active");

  // Load view-specific data
  if (normalizedTabId === "connections") loadConnections();
  if (normalizedTabId === "runner") loadRunners();
  if (normalizedTabId === "usage") loadUsage();
  if (normalizedTabId === "skills") loadSkills();
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ==========================================================================
// Initialization
// ==========================================================================

async function init() {
  initTheme();
  initSidebarState();
  initModelPicker();
  initCobwebCanvas();
  setupComposerListeners();
  initComposerDragAndDrop();

  // Instant render cached sessions from localStorage before network calls
  try {
    const cached = JSON.parse(localStorage.getItem("gon.sessions_cache") || "[]");
    if (Array.isArray(cached) && cached.length > 0) {
      cachedSessions = cached;
      renderSidebarSessions(cached);
    }
  } catch {}

  try {
    // 1. Fetch user profile (Session Check)
    const meRes = await fetch(`${API_URL}/me`, { credentials: "include" });
    if (meRes.status === 401) {
      showLoginView();
      return;
    }
    if (!meRes.ok) {
      showLoginView();
      return;
    }
    hideLoginView();

    const me = await meRes.json();
    const displayName = (me.displayName && me.displayName !== "Default Developer")
      ? me.displayName
      : (me.email ? me.email.split("@")[0] : "이재곤");
    const nameEl = document.getElementById("user-display-name");
    const avatarEl = document.getElementById("user-avatar");
    const greetingEl = document.getElementById("greeting-title");

    if (nameEl) nameEl.textContent = `${displayName} - Pro`;
    if (avatarEl) avatarEl.textContent = displayName.charAt(0);
    if (greetingEl) greetingEl.textContent = `${displayName}님, 안녕하세요`;

    const menuNameEl = document.getElementById("profile-menu-name");
    const menuAvatarEl = document.getElementById("profile-menu-avatar");
    if (menuNameEl) menuNameEl.textContent = displayName;
    if (menuAvatarEl) menuAvatarEl.textContent = displayName.charAt(0);

    // 2. Fetch workspaces
    const wsRes = await apiFetch(`${API_URL}/workspaces`);
    if (wsRes.ok) {
      const data = await wsRes.json();
      if (data.items.length > 0) {
        currentWorkspaceId = data.items[0].id;
        loadModelCatalog();
        await loadProjects();
        await initWorkspaceFolderState();
        await loadSidebarRuns();

        // Restore active session if preserved in localStorage
        try {
          const savedActiveSessionId = localStorage.getItem("gon.active_session_id") || localStorage.getItem("gon.active_run_id");
          if (savedActiveSessionId) {
            await viewSession(savedActiveSessionId);
          }
        } catch {}
      }
    }
  } catch (err) {
    console.error("Initialization error:", err);
  }
}

// ==========================================================================
// Desktop Workspace Directory Selector & State Management
// ==========================================================================

function normalizePath(p) {
  if (!p) return "";
  return p.replace(/\\+/g, "/").replace(/\/+/g, "/").trim();
}

let rawSavedActivePath = localStorage.getItem("gon.active_workspace_path") || "";
let currentActiveWorkspacePath = normalizePath(rawSavedActivePath);
let currentRunnerDevice = null;
let currentAllowedWorkspacePaths = [];

async function initWorkspaceFolderState() {
  if (!currentWorkspaceId) return;
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runners`);
    if (res.ok) {
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        currentRunnerDevice = data.items[0];
        const pathsRes = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runners/${currentRunnerDevice.id}/paths`);
        if (pathsRes.ok) {
          const pathData = await pathsRes.json();
          currentAllowedWorkspacePaths = (pathData.allowedPaths || []).map(normalizePath).filter(Boolean);
          const serverActive = normalizePath(pathData.activePath);
          if (!currentActiveWorkspacePath || !currentAllowedWorkspacePaths.includes(currentActiveWorkspacePath)) {
            currentActiveWorkspacePath = serverActive || currentAllowedWorkspacePaths[0] || "";
            try {
              localStorage.setItem("gon.active_workspace_path", currentActiveWorkspacePath);
            } catch {}
          }
        }
      } else {
        currentRunnerDevice = null;
        currentAllowedWorkspacePaths = [];
        currentActiveWorkspacePath = "";
        try { localStorage.removeItem("gon.active_workspace_path"); } catch {}
      }
    }
  } catch (err) {
    console.error("Workspace folder init error:", err);
  }
  renderWorkspaceChip();
}

function renderWorkspaceChip() {
  const labelEl = document.getElementById("composer-folder-btn-label");
  const btnEl = document.getElementById("composer-folder-btn");
  if (!labelEl) return;

  if (!currentActiveWorkspacePath) {
    labelEl.textContent = "작업 폴더";
    if (btnEl) btnEl.title = "데스크탑 작업 폴더 선택";
    return;
  }

  const norm = normalizePath(currentActiveWorkspacePath);
  const parts = norm.split("/").filter(Boolean);
  const folderName = parts.length > 0 ? parts[parts.length - 1] : norm;

  labelEl.textContent = folderName;
  if (btnEl) {
    btnEl.title = `데스크탑 작업 폴더: ${norm} (클릭하여 변경)`;
  }
}

let currentBrowsedLocalPath = "";
let currentBrowsedParentPath = "";

function openRunnerRegisterModal() {
  const modal = document.getElementById("runner-register-modal-backdrop");
  if (modal) {
    modal.classList.remove("hidden");
    loadLocalFolderBrowser(currentActiveWorkspacePath || "");
  }
}

function closeRunnerRegisterModal() {
  const modal = document.getElementById("runner-register-modal-backdrop");
  if (modal) {
    modal.classList.add("hidden");
  }
}

function closeRunnerRegisterModalOnBackdrop(e) {
  if (e.target && e.target.id === "runner-register-modal-backdrop") {
    closeRunnerRegisterModal();
  }
}

async function loadLocalFolderBrowser(targetPath = "") {
  if (!currentWorkspaceId) return;
  const listEl = document.getElementById("local-folder-list");
  const pathInput = document.getElementById("local-folder-path-input");
  const shortcutsEl = document.getElementById("local-folder-shortcuts");
  const upBtn = document.getElementById("local-folder-up-btn");

  if (listEl) {
    listEl.innerHTML = `<span class="text-faint text-sm" style="padding:8px;">폴더 목록을 불러오는 중...</span>`;
  }

  try {
    const qs = targetPath ? `?path=${encodeURIComponent(targetPath)}` : "";
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/local-dirs${qs}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (listEl) {
        listEl.innerHTML = `<span class="text-faint text-sm" style="padding:8px;color:rgb(var(--c-danger));">${escapeHtml(data?.error?.message || "폴더를 열 수 없어요.")}</span>`;
      }
      return;
    }

    currentBrowsedLocalPath = data.currentPath || "";
    currentBrowsedParentPath = data.parentPath || "";

    if (pathInput) {
      pathInput.value = currentBrowsedLocalPath;
    }
    if (upBtn) {
      upBtn.disabled = !currentBrowsedParentPath;
    }

    if (shortcutsEl && Array.isArray(data.shortcuts)) {
      shortcutsEl.innerHTML = data.shortcuts.map((s) => `
        <button type="button" class="local-folder-shortcut-chip" onclick="loadLocalFolderBrowser('${escapeHtml(s.path)}')">
          ${escapeHtml(s.label)}
        </button>
      `).join("");
    }

    if (listEl) {
      const dirs = Array.isArray(data.directories) ? data.directories : [];
      if (dirs.length === 0) {
        listEl.innerHTML = `<span class="text-faint text-sm" style="padding:10px;">하위 폴더가 없습니다. 아래 '현재 폴더를 작업 폴더로 선택'을 눌러 이 폴더를 사용하세요.</span>`;
      } else {
        listEl.innerHTML = dirs.map((d) => `
          <button type="button" class="local-folder-item" onclick="loadLocalFolderBrowser('${escapeHtml(d.path)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:rgb(var(--c-accent));flex-shrink:0;">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.name)}</span>
          </button>
        `).join("");
      }
    }
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<span class="text-faint text-sm" style="padding:8px;">폴더 목록 조회 실패: ${escapeHtml(err.message)}</span>`;
    }
  }
}

function browseLocalParentFolder() {
  if (currentBrowsedParentPath) {
    loadLocalFolderBrowser(currentBrowsedParentPath);
  }
}

function browseLocalFolderByInput() {
  const pathInput = document.getElementById("local-folder-path-input");
  const val = pathInput ? pathInput.value.trim() : "";
  if (val) {
    loadLocalFolderBrowser(val);
  }
}

async function confirmSelectedLocalFolder() {
  if (!currentWorkspaceId) return;
  const pathInput = document.getElementById("local-folder-path-input");
  const targetPath = (pathInput && pathInput.value.trim()) || currentBrowsedLocalPath;
  if (!targetPath) {
    showToast("선택할 폴더 경로를 확인해 주세요", "error");
    return;
  }

  const btn = document.getElementById("confirm-local-folder-btn");
  if (btn) btn.disabled = true;

  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/select-local-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: targetPath })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.activePath) {
      if (data.device) currentRunnerDevice = data.device;
      currentActiveWorkspacePath = normalizePath(data.activePath);
      currentAllowedWorkspacePaths = (data.allowedPaths || [data.activePath]).map(normalizePath);
      try {
        localStorage.setItem("gon.active_workspace_path", currentActiveWorkspacePath);
      } catch {}
      renderWorkspaceChip();
      renderSettingsWorkspaceFolders();
      closeRunnerRegisterModal();
      showToast("작업 폴더가 설정되었어요: " + currentActiveWorkspacePath, "success");
    } else {
      showToast(data?.error?.message || "폴더 설정에 실패했어요", "error");
    }
  } catch (err) {
    showToast("폴더 설정 오류: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function issuePairingCodeInModal() {
  if (!currentWorkspaceId) return;
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runner-pairings`, {
      method: "POST"
    });
    if (res.ok) {
      const data = await res.json();
      const codeEl = document.getElementById("modal-pairing-code-value");
      const cmdEl = document.getElementById("modal-pairing-command-text");
      const boxEl = document.getElementById("modal-pairing-code-display");
      if (codeEl) codeEl.textContent = data.pairingCode;
      if (cmdEl) cmdEl.textContent = `aso-runner pair ${data.pairingCode}`;
      if (boxEl) boxEl.classList.remove("hidden");
    } else {
      showToast("페어링 코드 생성에 실패했어요", "error");
    }
  } catch (err) {
    showToast("페어링 코드 생성 오류: " + err.message, "error");
  }
}

function copyModalPairingCommand() {
  const cmdEl = document.getElementById("modal-pairing-command-text");
  if (!cmdEl) return;
  navigator.clipboard.writeText(cmdEl.textContent || "").then(() => {
    showToast("페어링 명령어를 복사했어요", "success");
  }).catch(() => {});
}

async function pickLocalHostFolderFromModal() {
  if (!currentWorkspaceId) return;
  const btn = document.getElementById("modal-pick-local-folder-btn");
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/pick-local-folder`, {
      method: "POST"
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 200 && data.activePath) {
      if (data.device) currentRunnerDevice = data.device;
      currentActiveWorkspacePath = normalizePath(data.activePath);
      currentAllowedWorkspacePaths = (data.allowedPaths || [data.activePath]).map(normalizePath);
      try {
        localStorage.setItem("gon.active_workspace_path", currentActiveWorkspacePath);
      } catch {}
      renderWorkspaceChip();
      renderSettingsWorkspaceFolders();
      closeRunnerRegisterModal();
      showToast("작업 폴더가 설정되었어요: " + currentActiveWorkspacePath, "success");
    } else if (res.status === 200 && data.cancelled) {
      showToast("Windows 폴더 선택 창이 닫혔어요. 위 폴더 목록에서 직접 선택하실 수도 있어요.", "info");
    } else if (res.status !== 200) {
      showToast(data.error?.message || "폴더를 선택하지 못했어요", "error");
    }
  } catch (err) {
    showToast("폴더 선택 오류: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function pickWorkspaceFolder() {
  openRunnerRegisterModal();
}

function renderSettingsWorkspaceFolders() {
  const nameEl = document.getElementById("settings-runner-name");
  const statusEl = document.getElementById("settings-runner-status");
  const deleteBtn = document.getElementById("settings-runner-delete-btn");

  if (currentRunnerDevice) {
    if (nameEl) nameEl.textContent = currentRunnerDevice.name;
    if (statusEl) {
      statusEl.textContent = currentRunnerDevice.status === "online" ? "온라인" : "오프라인";
      statusEl.className = `badge ${currentRunnerDevice.status === "online" ? "badge-accent" : "badge-sub"}`;
    }
    if (deleteBtn) deleteBtn.style.display = "inline-flex";
  } else {
    if (nameEl) nameEl.textContent = "연결된 PC가 없어요";
    if (statusEl) {
      statusEl.textContent = "미등록";
      statusEl.className = "badge badge-sub";
    }
    if (deleteBtn) deleteBtn.style.display = "none";
  }

  const listEl = document.getElementById("settings-allowed-paths-list");
  if (listEl) {
    const cleanPaths = Array.from(new Set(
      (currentAllowedWorkspacePaths || []).map(normalizePath).filter(Boolean)
    ));
    if (cleanPaths.length === 0) {
      listEl.innerHTML = `<span class="text-faint text-sm">등록된 폴더가 없어요</span>`;
    } else {
      listEl.innerHTML = cleanPaths.map(p => {
        const isActive = p === normalizePath(currentActiveWorkspacePath);
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(var(--c-sunken),0.5);border:1px solid ${isActive ? 'rgba(var(--c-accent),0.6)' : 'rgb(var(--c-line))'};border-radius:6px;">
            <div style="display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;flex:1;" onclick="selectWorkspacePath('${escapeHtml(p)}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              <span style="font-family:monospace;font-size:12px;color:rgb(var(--c-ink));">${escapeHtml(p)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              ${isActive ? '<span class="badge badge-accent" style="font-size:11px;">현재 활성</span>' : `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 8px;" onclick="selectWorkspacePath('${escapeHtml(p)}')">선택</button>`}
              <button class="btn btn-ghost btn-sm text-danger" style="font-size:12px;padding:2px 6px;color:rgb(var(--c-danger));" onclick="event.stopPropagation(); removeWorkspacePath('${escapeHtml(p)}')" title="이 폴더 권한 제거">✕</button>
            </div>
          </div>
        `;
      }).join("");
    }
  }
}

async function selectWorkspacePath(dirPath) {
  if (!dirPath) return;
  const clean = normalizePath(dirPath);
  currentActiveWorkspacePath = clean;
  try {
    localStorage.setItem("gon.active_workspace_path", clean);
  } catch {}

  if (currentWorkspaceId && currentRunnerDevice) {
    try {
      await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runners/${currentRunnerDevice.id}/active-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: clean })
      });
    } catch {}
  }

  renderWorkspaceChip();
  renderSettingsWorkspaceFolders();
}

async function removeWorkspacePath(dirPath) {
  if (!dirPath || !currentWorkspaceId || !currentRunnerDevice) return;
  const clean = normalizePath(dirPath);
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runners/${currentRunnerDevice.id}/paths`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: clean })
    });
    if (res.ok) {
      const data = await res.json();
      currentAllowedWorkspacePaths = (data.allowedPaths || []).map(normalizePath);
      if (currentActiveWorkspacePath === clean) {
        currentActiveWorkspacePath = currentAllowedWorkspacePaths[0] || "";
        try { localStorage.setItem("gon.active_workspace_path", currentActiveWorkspacePath); } catch {}
      }
      renderWorkspaceChip();
      renderSettingsWorkspaceFolders();
      showToast("작업 공간 폴더가 제거되었습니다.", "info");
    }
  } catch (err) {
    showToast("폴더 제거 오류: " + err.message, "error");
  }
}

async function handleDeleteCurrentRunner() {
  if (!currentRunnerDevice) return;
  await deleteRunnerDevice(currentRunnerDevice.id, currentRunnerDevice.name);
}

async function deleteRunnerDevice(deviceId, deviceName) {
  if (!deviceId || !currentWorkspaceId) return;
  const targetName = deviceName || "러너 기기";
  const confirmed = await showConfirmDialog({
    title: "러너 기기 등록 해제",
    message: `'${targetName}' 기기의 등록을 해제하시겠습니까? 등록 해제 시 이 기기와의 로컬 연결이 즉시 종료되며, 다시 사용하려면 새로운 페어링 코드로 연결해야 합니다.`,
    confirmText: "등록 해제",
    cancelText: "취소",
    danger: true
  });
  if (!confirmed) return;

  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runners/${deviceId}`, {
      method: "DELETE"
    });
    if (res.ok) {
      showToast(`'${targetName}' 기기가 등록 해제되었습니다.`, "success");
      if (currentRunnerDevice && currentRunnerDevice.id === deviceId) {
        currentRunnerDevice = null;
        currentAllowedWorkspacePaths = [];
        currentActiveWorkspacePath = "";
        try { localStorage.removeItem("gon.active_workspace_path"); } catch {}
        renderWorkspaceChip();
      }
      await loadRunners();
      renderSettingsWorkspaceFolders();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast("기기 등록 해제 실패: " + (err.error?.message || res.statusText), "error");
    }
  } catch (e) {
    showToast("기기 등록 해제 오류: " + e.message, "error");
  }
}

// ==========================================================================
// Projects Loading
// ==========================================================================

async function loadProjects() {
  if (!currentWorkspaceId) return;
  const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/projects`);
  if (res.ok) {
    const data = await res.json();
    if (data.items.length > 0) {
      currentProjectId = data.items[0].id;
    }
  }
}

// ==========================================================================
// Composer Listeners & New Conversation
// ==========================================================================

function setupComposerListeners() {
  const textarea = document.getElementById("run-request-input");
  if (!textarea) return;

  textarea.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitChatPrompt();
    }
  });

  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  });
}

function startNewConversation() {
  switchTab("chat");
  const chatView = document.getElementById("view-chat");
  const thread = document.getElementById("chat-thread");
  const input = document.getElementById("run-request-input");

  if (chatView) {
    chatView.classList.add("empty-mode");
  }
  if (thread) {
    thread.innerHTML = "";
  }
  if (input) {
    input.value = "";
    input.style.height = "auto";
    input.focus();
  }

  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
  activeSessionId = null;
  activeRunId = null;
  try {
    localStorage.removeItem("gon.active_session_id");
    localStorage.removeItem("gon.active_run_id");
  } catch {}
  resetCobweb();
  renderSidebarSessions(cachedSessions);
}

// ==========================================================================
// Direct Chat Execution & WorkProcess Lifecycle
// ==========================================================================

let attachedFiles = [];

function triggerFilePicker() {
  const input = document.getElementById("composer-file-input");
  if (input) input.click();
}

function handleFileSelected(event) {
  const files = event.target.files;
  if (files && files.length > 0) {
    addFilesToAttachments(Array.from(files));
  }
  event.target.value = "";
}

function addFilesToAttachments(fileList) {
  fileList.forEach((file) => {
    const isImage = file.type.startsWith("image/");
    const reader = new FileReader();

    if (isImage) {
      reader.onload = (e) => {
        attachedFiles.push({
          name: file.name,
          size: file.size,
          type: file.type,
          dataUrl: e.target.result,
          isImage: true
        });
        renderAttachmentsPreview();
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = (e) => {
        attachedFiles.push({
          name: file.name,
          size: file.size,
          type: file.type,
          text: typeof e.target.result === "string" ? e.target.result : "",
          isImage: false
        });
        renderAttachmentsPreview();
      };
      reader.readAsText(file);
    }
  });
}

function removeAttachment(index) {
  attachedFiles.splice(index, 1);
  renderAttachmentsPreview();
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function renderAttachmentsPreview() {
  const bar = document.getElementById("composer-attachments-bar");
  if (!bar) return;

  if (attachedFiles.length === 0) {
    bar.innerHTML = "";
    bar.classList.add("hidden");
    return;
  }

  bar.classList.remove("hidden");
  bar.innerHTML = attachedFiles
    .map((file, idx) => {
      const thumb = file.isImage
        ? `<img src="${file.dataUrl}" alt="${escapeHtml(file.name)}" class="attachment-chip-thumb" />`
        : `<svg class="attachment-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
      return `
        <div class="composer-attachment-chip">
          ${thumb}
          <div class="attachment-chip-info">
            <span class="attachment-chip-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
            <span class="attachment-chip-size">${formatBytes(file.size)}</span>
          </div>
          <button type="button" class="attachment-chip-del" onclick="removeAttachment(${idx})" title="삭제">×</button>
        </div>
      `;
    })
    .join("");
}

function initComposerDragAndDrop() {
  const wrapper = document.getElementById("composer-wrapper");
  if (!wrapper) return;

  ["dragenter", "dragover"].forEach((eventName) => {
    wrapper.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    wrapper.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.classList.remove("drag-over");
    });
  });

  wrapper.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      addFilesToAttachments(Array.from(files));
    }
  });
}

function isLikelyChat(prompt) {
  const text = prompt.trim().toLowerCase();
  const buildKeywords = [
    "만들어", "만들기", "작성해", "작성하기", "구현해", "구현하기", "수정해", "수정하기",
    "추가해", "추가하기", "분석해", "분석하기", "리팩토링", "계획", "설계", "개발해",
    "고쳐줘", "고치기", "빌드", "배포", "테스트", "코드", "파일", "컴포넌트", "함수",
    "클래스", "버그", "에러", "스크립트", "엔드포인트", "마이그레이션", "아키텍처",
    "create", "build", "make", "implement", "add", "fix", "refactor", "plan",
    "design", "develop", "code", "file", "test", "debug", "error", "write", "generate"
  ];
  const hasBuild = buildKeywords.some((kw) => text.includes(kw));
  if (hasBuild) return false;
  return text.length <= 30 || /ㅎㅇ|안녕|반가워|누구|소개|날씨|고마워|감사|hi|hello|hey/i.test(text);
}

async function submitChatPrompt() {
  const input = document.getElementById("run-request-input");
  if (!input) return;
  const requestText = input.value.trim();
  if (!requestText && attachedFiles.length === 0) return;

  if (modelSelection?.connectionId && !currentActiveWorkspacePath) {
    showToast("작업할 폴더를 먼저 선택해 주세요", "info");
    await pickWorkspaceFolder();
    if (!currentActiveWorkspacePath) return;
  }

  const currentAttachments = [...attachedFiles];
  attachedFiles = [];
  renderAttachmentsPreview();

  // Clear input and reset height
  input.value = "";
  input.style.height = "auto";

  // Switch chat view to active conversation mode (leaves empty mode)
  const chatView = document.getElementById("view-chat");
  if (chatView) chatView.classList.remove("empty-mode");

  const thread = document.getElementById("chat-thread");
  if (!thread) return;

  // 1. Append User Message Bubble with attached files / images
  const userRow = document.createElement("div");
  userRow.className = "user-message-row";

  let attachmentsHtml = "";
  if (currentAttachments.length > 0) {
    attachmentsHtml = `<div class="user-attachments-grid">` +
      currentAttachments.map((f) => {
        if (f.isImage) {
          return `<img src="${f.dataUrl}" alt="${escapeHtml(f.name)}" class="user-attachment-img" />`;
        }
        return `
          <div class="user-attachment-card">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            <span>${escapeHtml(f.name)} (${formatBytes(f.size)})</span>
          </div>
        `;
      }).join("") + `</div>`;
  }

  const textHtml = requestText ? `<div>${escapeHtml(requestText)}</div>` : "";
  userRow.innerHTML = `<div class="user-bubble">${attachmentsHtml}${textHtml}</div>`;
  thread.appendChild(userRow);

  const isChat = isLikelyChat(requestText);
  const chatProvider = selectedConnection()?.provider;
  const tempId = "run-" + Date.now();
  const assistantTurn = document.createElement("div");
  assistantTurn.className = "assistant-turn";
  assistantTurn.id = `turn-${tempId}`;
  assistantTurn.innerHTML = `
    <div class="assistant-row">
      ${assistantAvatarHtml(chatProvider)}
      <div class="assistant-main">
        <!-- WorkProcess Accordion (side_pj & Claude style with subtle left border line) -->
        <div class="work-process-wrap ${isChat ? 'hidden' : ''}" id="process-wrap-${tempId}">
          <button type="button" class="work-process-toggle-btn" onclick="toggleWorkProcess('${tempId}')">
            <span class="working-dot" id="dot-${tempId}"></span>
            <span class="work-process-title" id="process-status-text-${tempId}">요구사항 구체화 중...</span>
            <svg class="chevron-icon open" id="arrow-${tempId}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
          <div class="work-process-drawer" id="drawer-${tempId}">
            <div class="work-process-inner">
              <!-- Section: Requirements -->
              <div class="process-sub-item hidden" id="sec-req-${tempId}">
                <div class="process-sub-label">요구사항 구체화</div>
                <div class="req-content-box" id="req-content-${tempId}"></div>
              </div>

              <!-- Section: Tasks DAG -->
              <div class="process-sub-item hidden" id="sec-tasks-${tempId}">
                <div class="process-sub-label">실행 계획 DAG</div>
                <div class="tasks-flow-box" id="tasks-content-${tempId}"></div>
              </div>

              <!-- Section: Approval Gate Banner -->
              <div class="approval-gate-box hidden" id="gate-${tempId}">
                <span>작업 계획이 수립되었습니다. 승인 후 코드를 실행합니다.</span>
                <button class="btn btn-accent btn-sm" onclick="approvePlanInTurn('${tempId}')">계획 승인</button>
              </div>

              <!-- Section: Terminal Stream Log -->
              <div class="process-sub-item">
                <div class="process-sub-label">실행 스트림 로그</div>
                <div class="terminal-box" id="term-${tempId}">스트림 대기 중...</div>
              </div>

              <!-- Section: File Diffs -->
              <div class="process-sub-item hidden" id="sec-diff-${tempId}">
                <div class="process-sub-label">생성된 파일 Diff</div>
                <div class="diff-box-inner" id="diff-content-${tempId}"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Assistant Response Text (Clean Markdown without box border) -->
        <div class="report-viewer" id="response-${tempId}">
          ${isChat ? `${escapeHtml(aiBrand(chatProvider).name)}가 답변을 쓰고 있어요…` : '작업 환경을 준비하고 있습니다...'}
        </div>
      </div>
    </div>
  `;
  thread.appendChild(assistantTurn);
  scrollChatToBottom();

  // Ensure active session exists, or initialize a new one
  if (!activeSessionId) {
    const uuid = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    activeSessionId = "sess-" + uuid;
    try {
      localStorage.setItem("gon.active_session_id", activeSessionId);
    } catch {}
  }

  const mode = document.getElementById("run-mode-select") ? document.getElementById("run-mode-select").value : "auto";
  const requireApproval = document.getElementById("run-approval-check") ? document.getElementById("run-approval-check").checked : true;

  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/projects/${currentProjectId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: requestText || (currentAttachments.length > 0 ? `${currentAttachments.map(f => f.name).join(", ")} 파일 확인` : "요청"),
        sessionId: activeSessionId,
        workspacePath: currentActiveWorkspacePath || undefined,
        executionMode: mode,
        connectionId: modelSelection?.connectionId,
        model: modelSelection?.model,
        effort: modelSelection?.effort || undefined,
        attachments: currentAttachments.map(f => ({
          name: f.name,
          size: f.size,
          type: f.type,
          dataUrl: f.dataUrl,
          text: f.text
        })),
        options: { requirePlanApproval: requireApproval }
      })
    });

    if (!res.ok) {
      updateTurnStatus(tempId, "요청 처리 실패", false);
      let apiMessage = "";
      if (res.status === 400) {
        try {
          apiMessage = (await res.json())?.error?.message || "";
        } catch {}
      }
      if (apiMessage) showToast(apiMessage, "error");
      const respEl = document.getElementById(`response-${tempId}`);
      if (respEl) respEl.textContent = apiMessage || "작업 생성에 실패했습니다. API 서버 상태를 확인하세요.";
      return;
    }

    const data = await res.json();
    const actualRunId = data.runId;
    activeRunId = actualRunId;
    if (data.sessionId) {
      activeSessionId = data.sessionId;
      try {
        localStorage.setItem("gon.active_session_id", data.sessionId);
      } catch {}
    }
    try {
      localStorage.setItem("gon.active_run_id", actualRunId);
    } catch {}

    rebindTurnIds(tempId, actualRunId);
    await loadSidebarRuns();
    connectRunSSE(actualRunId);
  } catch (err) {
    console.error("Submit error:", err);
    updateTurnStatus(tempId, "네트워크 오류 발생", false);
    const respEl = document.getElementById(`response-${tempId}`);
    if (respEl) respEl.textContent = "서버 연결에 실패했습니다: " + err.message;
  }
}

function rebindTurnIds(oldId, newId) {
  const turn = document.getElementById(`turn-${oldId}`);
  if (!turn) return;
  turn.id = `turn-${newId}`;

  const prefixes = [
    "process-wrap-", "dot-", "process-status-text-", "arrow-",
    "drawer-", "sec-req-", "req-content-", "sec-tasks-",
    "tasks-content-", "gate-", "term-", "sec-diff-",
    "diff-content-", "response-"
  ];

  prefixes.forEach((prefix) => {
    const el = document.getElementById(`${prefix}${oldId}`);
    if (el) el.id = `${prefix}${newId}`;
  });

  const toggleBtn = turn.querySelector(".work-process-toggle-btn");
  if (toggleBtn) {
    toggleBtn.onclick = () => toggleWorkProcess(newId);
  }
  const gateBtn = turn.querySelector(".approval-gate-box button");
  if (gateBtn) {
    gateBtn.onclick = () => approvePlanInTurn(newId);
  }
}

function toggleWorkProcess(runId) {
  const drawer = document.getElementById(`drawer-${runId}`);
  const arrow = document.getElementById(`arrow-${runId}`);
  if (drawer && arrow) {
    const isHidden = drawer.classList.toggle("hidden");
    arrow.classList.toggle("open", !isHidden);
  }
}

function appendLogToTurn(runId, evType, dataStr) {
  const t = document.getElementById(`term-${runId}`);
  if (t) {
    const time = new Date().toLocaleTimeString();
    t.textContent += `[${time}] [${evType}] ${dataStr}\n`;
    t.scrollTop = t.scrollHeight;
  }
}

function connectRunSSE(runId) {
  if (activeEventSource) {
    activeEventSource.close();
  }

  const sseUrl = `${API_URL}/workspaces/${currentWorkspaceId}/runs/${runId}/events`;
  activeEventSource = new EventSource(sseUrl, { withCredentials: true });

  const term = document.getElementById(`term-${runId}`);
  if (term) term.textContent = "";

  const appendLog = (evType, dataStr) => appendLogToTurn(runId, evType, dataStr);

  activeEventSource.addEventListener("run:classified", (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.mode === "chat") {
        const wrap = document.getElementById(`process-wrap-${runId}`);
        if (wrap) wrap.classList.add("hidden");
        updateCobwebBadge("일상 대화");
      }
    } catch {}
    appendLog("run:classified", e.data);
  });

  activeEventSource.addEventListener("chat:response", (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.usage?.provider) setTurnAvatar(runId, payload.usage.provider);
      if (payload.text) {
        setResponseText(runId, payload.text);
      }
    } catch {
      setResponseText(runId, e.data);
    }
    const wrap = document.getElementById(`process-wrap-${runId}`);
    if (wrap) wrap.classList.add("hidden");
    scrollChatToBottom();
  });

  activeEventSource.addEventListener("run:refining", (e) => {
    updateTurnStatus(runId, "요구사항 구체화 중...", true);
    setResponseText(runId, "요구사항을 분석하고 핵심 목표와 기술 제약 조건을 수립하고 있습니다.");
    appendLog("run:refining", e.data);
  });

  activeEventSource.addEventListener("requirements:refined", (e) => {
    try {
      const payload = JSON.parse(e.data);
      renderRequirementsInTurn(runId, payload.requirements);
      updateTurnStatus(runId, "요구사항 정립 완료 (실행 계획 설계 중...)", true);
      setResponseText(runId, "요구사항 정립이 완료되었습니다. 작업을 분할하여 실행 계획(DAG)을 구성합니다.");
      appendLog("requirements:refined", "목표/제약/기준 정립 완료");
    } catch {
      appendLog("requirements:refined", e.data);
    }
  });

  activeEventSource.addEventListener("plan:created", (e) => {
    try {
      const payload = JSON.parse(e.data);
      renderTasksInTurn(runId, payload.tasks);
      setCobwebTasks(payload.tasks);
      updateTurnStatus(runId, `작업 계획 수립 완료 (${payload.tasks.length}개 단계)`, true);
      setResponseText(runId, `${payload.tasks.length}개의 실행 단계가 준비되었습니다.`);
      appendLog("plan:created", `${payload.tasks.length} tasks ready`);
    } catch {
      appendLog("plan:created", e.data);
    }
  });

  activeEventSource.addEventListener("run:awaiting_approval", (e) => {
    updateTurnStatus(runId, "계획 승인 대기 중", false);
    const gate = document.getElementById(`gate-${runId}`);
    if (gate) gate.classList.remove("hidden");
    setResponseText(runId, "작업 계획이 수립되었습니다. 상단 실행 과정의 '계획 승인' 버튼을 누르면 구현이 시작됩니다.");
    appendLog("run:awaiting_approval", "사용자 승인 대기");
  });

  activeEventSource.addEventListener("plan:approved", (e) => {
    updateTurnStatus(runId, "계획 승인 완료 (전문가 스킬 조율 중)", true);
    const gate = document.getElementById(`gate-${runId}`);
    if (gate) gate.classList.add("hidden");
    setResponseText(runId, "계획이 승인되었습니다. 선정된 스킬을 적용하여 코드를 구현합니다.");
    appendLog("plan:approved", "계획 승인 완료");
  });

  activeEventSource.addEventListener("task:started", (e) => {
    try {
      const payload = JSON.parse(e.data);
      updateTurnStatus(runId, `Task 실행 중: ${payload.taskKey || ""}`, true);
      markTaskRunning(runId, payload.taskKey);
      setCobwebTaskStatus(payload.taskKey, "running");
      appendLog("task:started", payload.taskKey || e.data);
    } catch {
      appendLog("task:started", e.data);
    }
  });

  activeEventSource.addEventListener("task:skills_routed", (e) => {
    appendLog("task:skills_routed", e.data);
  });

  activeEventSource.addEventListener("task:diff_generated", async (e) => {
    appendLog("task:diff_generated", e.data);
    await loadDiffsInTurn(runId);
  });

  activeEventSource.addEventListener("task:completed", (e) => {
    try {
      const payload = JSON.parse(e.data);
      markTaskCompleted(runId, payload.taskKey);
      setCobwebTaskStatus(payload.taskKey, "completed");
      appendLog("task:completed", payload.taskKey || e.data);
    } catch {
      appendLog("task:completed", e.data);
    }
  });

  activeEventSource.addEventListener("run:verifying", (e) => {
    updateTurnStatus(runId, "결과 검증 및 테스트 중...", true);
    setResponseText(runId, "코드 작성이 완료되어 테스트 및 결과 무결성을 검증하고 있습니다.");
    appendLog("run:verifying", "검증 시작");
  });

  activeEventSource.addEventListener("run:completed", async (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.output) {
        setResponseText(runId, payload.output);
        const wrap = document.getElementById(`process-wrap-${runId}`);
        if (wrap) wrap.classList.add("hidden");
      } else {
        updateTurnStatus(runId, "작업 및 검증 완료", false);
        setCobwebAllDone();
        await loadDiffsInTurn(runId);
      }
    } catch {
      updateTurnStatus(runId, "작업 및 검증 완료", false);
    }
    appendLog("run:completed", "작업 완료");
    updateCobwebBadge("대기 중");
    await loadSidebarRuns();
    await loadUsage();
    scrollChatToBottom();
  });

  activeEventSource.addEventListener("run:failed", (e) => {
    updateTurnStatus(runId, "작업 실패", false);
    let errText = "작업 실행 중 오류가 발생했습니다. 상단 실행 과정의 터미널 로그를 확인하세요.";
    try {
      const payload = JSON.parse(e.data);
      if (payload?.error) {
        errText = `작업 실행 중 오류가 발생했어요: ${payload.error}`;
      }
    } catch {}
    setResponseText(runId, errText);
    appendLog("run:failed", e.data);
    loadSidebarRuns();
  });

  const otherEvents = ["run:executing", "task:progress", "task:test_completed"];
  otherEvents.forEach((type) => {
    activeEventSource.addEventListener(type, (e) => {
      appendLog(type, e.data);
    });
  });
}

function updateTurnStatus(runId, text, isWorking) {
  const statusEl = document.getElementById(`process-status-text-${runId}`);
  if (statusEl) statusEl.textContent = text;
  const dot = document.getElementById(`dot-${runId}`);
  if (dot) {
    if (isWorking) {
      dot.className = "working-dot";
      dot.style.display = "inline-block";
    } else {
      dot.className = "working-dot";
      dot.style.animation = "none";
      dot.style.opacity = "0.7";
    }
  }
}

function renderSafeMarkdown(rawText) {
  if (!rawText) return "";
  const codeBlocks = [];
  const textWithPlaceholders = String(rawText).replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length;
    const safeLang = escapeHtml(lang || "code");
    const safeCode = escapeHtml(code.replace(/\n$/, ""));
    codeBlocks.push(`
      <div class="md-code-block" style="margin:10px 0;border:1px solid rgb(var(--c-line));border-radius:8px;overflow:hidden;background:rgb(var(--c-sunken));">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid rgb(var(--c-line));font-size:12px;color:rgb(var(--c-ink-sub));">
          <span>${safeLang}</span>
          <button type="button" class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;" onclick="copyCodeBlock(this)">복사</button>
        </div>
        <pre style="margin:0;padding:12px;overflow-x:auto;font-family:var(--font-mono, monospace);font-size:13px;line-height:1.5;"><code>${safeCode}</code></pre>
      </div>
    `);
    return `@@CODE_BLOCK_${idx}@@`;
  });

  let html = escapeHtml(textWithPlaceholders);
  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code style="padding:2px 5px;border-radius:4px;background:rgb(var(--c-sunken));font-family:var(--font-mono, monospace);font-size:0.9em;">$1</code>');
  // Bold
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Headings
  html = html.replace(/^### (.+)$/gm, '<strong style="display:block;font-size:1.05em;margin:10px 0 4px;">$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong style="display:block;font-size:1.12em;margin:12px 0 6px;">$1</strong>');
  // Bullet items
  html = html.replace(/^[•\-*] (.+)$/gm, '<div style="margin-left:10px;">• $1</div>');
  // Line breaks
  html = html.replace(/\n/g, "<br>");

  codeBlocks.forEach((blockHtml, idx) => {
    html = html.replace(`@@CODE_BLOCK_${idx}@@`, blockHtml);
  });

  return html;
}

function copyCodeBlock(btn) {
  const pre = btn?.closest(".md-code-block")?.querySelector("code");
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent || "").then(() => {
    const orig = btn.textContent;
    btn.textContent = "복사됨";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }).catch(() => {});
}

function setResponseText(runId, text) {
  const respEl = document.getElementById(`response-${runId}`);
  if (respEl) {
    respEl.innerHTML = renderSafeMarkdown(text);
  }
}

function renderRequirementsInTurn(runId, reqs) {
  const sec = document.getElementById(`sec-req-${runId}`);
  const content = document.getElementById(`req-content-${runId}`);
  if (!sec || !content || !reqs) return;
  sec.classList.remove("hidden");

  let html = "";
  if (reqs.goals && reqs.goals.length > 0) {
    html += `<div><strong>핵심 목표 (Goals):</strong></div>`;
    html += reqs.goals.map((g) => `<div style="margin-left:8px;">• ${escapeHtml(g)}</div>`).join("");
  }
  if (reqs.constraints && reqs.constraints.length > 0) {
    html += `<div style="margin-top:6px;"><strong>기술 제약 (Constraints):</strong></div>`;
    html += reqs.constraints.map((c) => `<div style="margin-left:8px;">• ${escapeHtml(c)}</div>`).join("");
  }
  if (reqs.acceptanceCriteria && reqs.acceptanceCriteria.length > 0) {
    html += `<div style="margin-top:6px;"><strong>완료 기준 (Acceptance Criteria):</strong></div>`;
    html += reqs.acceptanceCriteria.map((a) => `<div style="margin-left:8px;">• ${escapeHtml(a)}</div>`).join("");
  }
  content.innerHTML = html;
}

function renderTasksInTurn(runId, tasks) {
  const sec = document.getElementById(`sec-tasks-${runId}`);
  const content = document.getElementById(`tasks-content-${runId}`);
  if (!sec || !content || !tasks) return;
  sec.classList.remove("hidden");

  content.innerHTML = tasks.map((t, idx) => `
    <div class="task-item-row" id="task-row-${runId}-${t.key}">
      <div>
        <div class="task-item-title">${idx + 1}. ${escapeHtml(t.title)}</div>
        <div class="task-item-deps">Key: <code>${escapeHtml(t.key)}</code> · 의존성: ${t.deps && t.deps.length ? escapeHtml(t.deps.join(", ")) : "독립"}</div>
      </div>
      <span class="badge badge-sub" id="task-badge-${runId}-${t.key}">대기</span>
    </div>
  `).join("");
}

function markTaskRunning(runId, taskKey) {
  if (!taskKey) return;
  const badge = document.getElementById(`task-badge-${runId}-${taskKey}`);
  if (badge) {
    badge.className = "badge badge-accent";
    badge.textContent = "진행중";
  }
}

function markTaskCompleted(runId, taskKey) {
  if (!taskKey) return;
  const badge = document.getElementById(`task-badge-${runId}-${taskKey}`);
  if (badge) {
    badge.className = "badge status-completed";
    badge.textContent = "완료";
  }
}

async function approvePlanInTurn(runId) {
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runs/${runId}/plan/approve`, {
      method: "POST"
    });
    if (res.ok) {
      const gate = document.getElementById(`gate-${runId}`);
      if (gate) gate.classList.add("hidden");
      updateTurnStatus(runId, "계획 승인됨 (실행 중)", true);
    } else {
      alert("계획 승인에 실패했습니다.");
    }
  } catch (err) {
    console.error("Approval error:", err);
  }
}

async function loadDiffsInTurn(runId) {
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runs/${runId}/artifacts`);
    if (res.ok) {
      const data = await res.json();
      const sec = document.getElementById(`sec-diff-${runId}`);
      const content = document.getElementById(`diff-content-${runId}`);
      if (!sec || !content) return;
      if (data.items && data.items.length > 0) {
        sec.classList.remove("hidden");
        content.textContent = data.items.map((a) => `[생성된 파일 diff] ${a.artifactType} (${a.storageKey}) — ${a.byteSize} bytes`).join("\n");
      }
    }
  } catch (err) {
    console.warn("Load diffs error:", err);
  }
}

function scrollChatToBottom() {
  const area = document.getElementById("chat-scroll-area");
  if (area) {
    area.scrollTop = area.scrollHeight;
  }
}

// ==========================================================================
// View Run in Direct Chat
// ==========================================================================

async function viewSession(sessionId) {
  activeSessionId = sessionId;
  try {
    localStorage.setItem("gon.active_session_id", sessionId);
  } catch {}

  switchTab("chat");

  const chatView = document.getElementById("view-chat");
  if (chatView) chatView.classList.remove("empty-mode");

  let session = cachedSessions.find((s) => s.id === sessionId);
  if (!session) {
    try {
      const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/projects/${currentProjectId}/runs`);
      if (res.ok) {
        const data = await res.json();
        const sessions = groupRunsIntoSessions(data.items || []);
        cachedSessions = sessions;
        session = sessions.find((s) => s.id === sessionId);
      }
    } catch (e) {
      console.warn("Fetch session error:", e);
    }
  }

  renderSidebarSessions(cachedSessions);

  if (!session || !session.runs || session.runs.length === 0) {
    return;
  }

  const thread = document.getElementById("chat-thread");
  if (!thread) return;

  // Clear existing thread to render this session's full conversation history
  thread.innerHTML = "";

  for (const run of session.runs) {
    await renderTurnInThread(thread, run);
  }

  // Set activeRunId to the latest run in the session
  const lastRun = session.runs[session.runs.length - 1];
  activeRunId = lastRun.id;
  try {
    localStorage.setItem("gon.active_run_id", lastRun.id);
  } catch {}

  if (lastRun.status === "running" || lastRun.status === "queued" || lastRun.status === "planning" || lastRun.status === "refining") {
    connectRunSSE(lastRun.id);
  }

  resizeCobwebCanvas();
  scrollChatToBottom();
}

async function renderTurnInThread(thread, run) {
  const reqText = run.rawRequest || `대화 #${run.id.slice(0, 8)}`;
  const attachments = run.runContext?.attachments || [];

  const userRow = document.createElement("div");
  userRow.className = "user-message-row";

  let attachmentsHtml = "";
  if (attachments && attachments.length > 0) {
    attachmentsHtml = `<div class="user-attachments-grid">` +
      attachments.map((f) => {
        if (f.isImage || (f.type && f.type.startsWith("image/"))) {
          return `<img src="${f.dataUrl}" alt="${escapeHtml(f.name)}" class="user-attachment-img" />`;
        }
        return `
          <div class="user-attachment-card">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            <span>${escapeHtml(f.name)} (${formatBytes(f.size || 0)})</span>
          </div>
        `;
      }).join("") + `</div>`;
  }

  const textHtml = reqText ? `<div>${escapeHtml(reqText)}</div>` : "";
  userRow.innerHTML = `<div class="user-bubble">${attachmentsHtml}${textHtml}</div>`;
  thread.appendChild(userRow);

  const isChat = run.executionMode === "chat" || isLikelyChat(reqText);
  const assistantTurn = document.createElement("div");
  assistantTurn.className = "assistant-turn";
  assistantTurn.id = `turn-${run.id}`;
  assistantTurn.innerHTML = `
    <div class="assistant-row">
      ${assistantAvatarHtml(null)}
      <div class="assistant-main">
        <div class="work-process-wrap ${isChat ? 'hidden' : ''}" id="process-wrap-${run.id}">
          <button type="button" class="work-process-toggle-btn" onclick="toggleWorkProcess('${run.id}')">
            <span class="working-dot" id="dot-${run.id}"></span>
            <span class="work-process-title" id="process-status-text-${run.id}">기록된 작업 내역</span>
            <svg class="chevron-icon open" id="arrow-${run.id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
          <div class="work-process-drawer" id="drawer-${run.id}">
            <div class="work-process-inner">
              <div class="process-sub-item hidden" id="sec-req-${run.id}">
                <div class="process-sub-label">요구사항 구체화</div>
                <div class="req-content-box" id="req-content-${run.id}">기록을 불러오는 중...</div>
              </div>
              <div class="process-sub-item hidden" id="sec-tasks-${run.id}">
                <div class="process-sub-label">실행 계획 DAG</div>
                <div class="tasks-flow-box" id="tasks-content-${run.id}">기록을 불러오는 중...</div>
              </div>
              <div class="process-sub-item">
                <div class="process-sub-label">실행 스트림 로그</div>
                <div class="terminal-box" id="term-${run.id}">이벤트 대기 중...</div>
              </div>
              <div class="process-sub-item hidden" id="sec-diff-${run.id}">
                <div class="process-sub-label">생성된 파일 Diff</div>
                <div class="diff-box-inner" id="diff-content-${run.id}">산출물 불러오는 중...</div>
              </div>
            </div>
          </div>
        </div>
        <div class="report-viewer" id="response-${run.id}">
          ${run.status === "completed" ? "답변을 불러오는 중입니다..." : "처리 중입니다..."}
        </div>
      </div>
    </div>
  `;
  thread.appendChild(assistantTurn);

  // Restore details and response from events
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runs/${run.id}/event-list`);
    if (res.ok) {
      const data = await res.json();
      const events = data.items || [];
      let finalOutput = "";
      for (const ev of events) {
        if (ev.payload?.usage?.provider && (ev.eventType === "chat:response" || ev.eventType === "run:completed")) {
          setTurnAvatar(run.id, ev.payload.usage.provider);
        }
        if (ev.eventType === "chat:response" && ev.payload?.text) {
          finalOutput = ev.payload.text;
        } else if (ev.eventType === "run:completed" && ev.payload?.output) {
          finalOutput = ev.payload.output;
        } else if (ev.eventType === "requirements:refined" && ev.payload?.requirements) {
          renderRequirementsInTurn(run.id, ev.payload.requirements);
        } else if (ev.eventType === "plan:created" && ev.payload?.tasks) {
          renderTasksInTurn(run.id, ev.payload.tasks);
        } else if (ev.eventType === "run:failed") {
          finalOutput = "작업 중 오류 발생: " + (ev.payload?.error || "실패");
        }
        appendLogToTurn(run.id, ev.eventType, typeof ev.payload === "string" ? ev.payload : JSON.stringify(ev.payload));
      }
      if (finalOutput) {
        setResponseText(run.id, finalOutput);
        if (isChat) {
          const wrap = document.getElementById(`process-wrap-${run.id}`);
          if (wrap) wrap.classList.add("hidden");
        }
      } else if (run.status === "completed") {
        setResponseText(run.id, "작업이 성공적으로 완료되었습니다.");
      }
    }
  } catch (err) {
    console.warn("Event list restore error:", err);
  }

  await loadDiffsInTurn(run.id);
}

async function viewRun(runId) {
  const session = cachedSessions.find((s) => s.runs && s.runs.some((r) => r.id === runId));
  if (session) {
    await viewSession(session.id);
  } else {
    await viewSession(runId);
  }
}

// ==========================================================================
// Skills Catalog
// ==========================================================================

async function loadSkills() {
  const grid = document.getElementById("skills-grid");
  if (!grid) return;
  try {
    const res = await apiFetch(`${API_URL}/skills`);
    if (!res.ok) {
      grid.innerHTML = `<p class="text-faint">등록된 스킬이 없어요</p>`;
      return;
    }
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) {
      grid.innerHTML = `<p class="text-faint">등록된 스킬이 없어요</p>`;
      return;
    }
    grid.innerHTML = items.map((s) => `
      <div class="skill-card">
        <div class="skill-header">
          <span class="skill-name">${escapeHtml(s.name || s.id)}</span>
          <span class="badge badge-accent">${escapeHtml(s.source || "builtin")}</span>
        </div>
        <p class="skill-desc">${escapeHtml(s.description || "설명이 없어요")}</p>
      </div>
    `).join("");
  } catch (err) {
    console.warn("Load skills error:", err);
    grid.innerHTML = `<p class="text-faint">등록된 스킬이 없어요</p>`;
  }
}

// ==========================================================================
// AI Subscriptions
// ==========================================================================

async function detectSubscriptions() {
  if (!currentWorkspaceId) return;
  const btn = document.getElementById("detect-subs-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "새로고침 중…";
  }
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/connections/detect-subscriptions`, {
      method: "POST"
    });
    if (res.ok) {
      await loadConnections();
      await loadModelCatalog();
      showToast("AI 서비스 연결 상태를 새로고침했어요", "success");
    } else {
      showToast("상태 새로고침 실패", "error");
    }
  } catch (err) {
    showToast("새로고침 오류: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "상태 새로고침";
    }
  }
}

async function loginSubscriptionProvider(provider) {
  if (!currentWorkspaceId) return;
  const btn = document.getElementById(`conn-login-btn-${provider}`);
  const origText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "연결 확인 중…";
  }
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/connections/${encodeURIComponent(provider)}/login`, {
      method: "POST"
    });
    const data = await res.json().catch(() => ({}));
    await loadConnections();
    await loadModelCatalog();

    if (res.ok && data.pending && data.authUrl) {
      try {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
      } catch {}
      showToast(data.message || "브라우저에서 로그인 창을 열었어요. 인증 완료 시 자동으로 연결돼요.", "info");
      pollSubscriptionLoginCompletion(provider);
      return;
    }

    if (res.ok && (data.authenticated || data.success)) {
      showToast(data.message || "AI 서비스 계정이 성공적으로 연결되었어요!", "success");
    } else {
      showToast(data.message || data.error?.message || "로그인을 완료하지 못했어요", "error");
    }
  } catch (err) {
    showToast("로그인 연결 오류: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

let subscriptionPollTimer = null;

function pollSubscriptionLoginCompletion(provider) {
  if (subscriptionPollTimer) {
    clearInterval(subscriptionPollTimer);
    subscriptionPollTimer = null;
  }
  let attempts = 0;
  subscriptionPollTimer = setInterval(async () => {
    attempts += 1;
    if (attempts > 25 || !currentWorkspaceId) {
      clearInterval(subscriptionPollTimer);
      subscriptionPollTimer = null;
      return;
    }
    try {
      const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/connections/detect-subscriptions`, {
        method: "POST"
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const target = (data.items || []).find((c) => c.provider === provider);
      if (target && target.status === "connected") {
        clearInterval(subscriptionPollTimer);
        subscriptionPollTimer = null;
        await loadConnections();
        await loadModelCatalog();
        showToast(`${cleanServiceTitle(provider)} 계정이 연결되었어요!`, "success");
      }
    } catch {}
  }, 3000);
}

async function logoutSubscriptionProvider(provider) {
  if (!currentWorkspaceId) return;
  const btn = document.getElementById(`conn-logout-btn-${provider}`);
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/connections/${encodeURIComponent(provider)}/logout`, {
      method: "POST"
    });
    await loadConnections();
    await loadModelCatalog();
    if (res.ok) {
      showToast("구독 연결을 해제했어요", "info");
    } else {
      showToast("연결 해제 실패", "error");
    }
  } catch (err) {
    showToast("연결 해제 오류: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function cleanServiceTitle(provider, fallback) {
  if (provider === "anthropic") return "Claude (Anthropic)";
  if (provider === "openai") return "ChatGPT (OpenAI)";
  if (provider === "google") return "Gemini (Google)";
  return fallback || provider;
}

async function loadConnections() {
  if (!currentWorkspaceId) return;
  const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/connections`);
  if (res.ok) {
    const data = await res.json();
    const grid = document.getElementById("connections-list");
    if (!grid) return;
    if (!data.items || data.items.length === 0) {
      grid.innerHTML = `<p class="text-faint">연결 가능한 AI 서비스가 없어요.</p>`;
      return;
    }
    grid.innerHTML = data.items.map((c) => {
      const isConnected = c.status === "connected";
      const planName = c.metadata?.models?.plan ? String(c.metadata.models.plan).toUpperCase() : "";
      const modelCount = Array.isArray(c.metadata?.models?.models) ? c.metadata.models.models.length : 0;
      const serviceTitle = cleanServiceTitle(c.provider, c.displayName);
      const badge = isConnected
        ? `<span class="badge badge-accent">${escapeHtml(planName ? `연결됨 · ${planName}` : "연결됨")}</span>`
        : `<span class="badge badge-sub" style="color:#f59e0b;border-color:rgba(245,158,11,0.4);">로그인 필요</span>`;

      const subtitle = isConnected
        ? `${modelCount > 0 ? `${modelCount}개 모델 사용 가능 · ` : ""}구독 계정 연결됨`
        : "클릭하여 로그인 화면으로 이동하고 구독 계정을 연결하세요";

      const actionButtons = isConnected
        ? `<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
             <button type="button" class="btn btn-ghost btn-sm" id="conn-login-btn-${escapeHtml(c.provider)}" onclick="event.stopPropagation(); loginSubscriptionProvider('${escapeHtml(c.provider)}')">다시 로그인</button>
             <button type="button" class="btn btn-ghost btn-sm" style="color:#ef4444;" id="conn-logout-btn-${escapeHtml(c.provider)}" onclick="event.stopPropagation(); logoutSubscriptionProvider('${escapeHtml(c.provider)}')">연결 해제</button>
           </div>`
        : `<button type="button" class="btn btn-primary btn-sm" id="conn-login-btn-${escapeHtml(c.provider)}" onclick="event.stopPropagation(); loginSubscriptionProvider('${escapeHtml(c.provider)}')">로그인하여 연결</button>`;

      const cardClickAttr = isConnected
        ? ""
        : `onclick="loginSubscriptionProvider('${escapeHtml(c.provider)}')" style="margin-bottom:10px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;border:1px solid rgb(var(--c-line));border-radius:8px;cursor:pointer;"`;

      const defaultStyleAttr = `style="margin-bottom:10px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;border:1px solid rgb(var(--c-line));border-radius:8px;"`;

      return `
        <div class="content-card" ${isConnected ? defaultStyleAttr : cardClickAttr}>
          <div style="display:flex;align-items:center;gap:12px;min-width:0;">
            <img src="/logos/${escapeHtml(c.provider)}.svg" alt="" width="28" height="28" style="border-radius:6px;flex-shrink:0;" />
            <div style="min-width:0;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong style="font-size:15px;color:rgb(var(--c-ink));">${escapeHtml(serviceTitle)}</strong>
                ${badge}
              </div>
              <div class="text-faint" style="font-size:12px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(subtitle)}</div>
            </div>
          </div>
          ${actionButtons}
        </div>
      `;
    }).join("");
  }
}

// ==========================================================================
// Runner Device Pairing (W02)
// ==========================================================================

async function issuePairingCode() {
  if (!currentWorkspaceId) return;
  try {
    const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runner-pairings`, {
      method: "POST"
    });
    if (res.ok) {
      const data = await res.json();
      const codeEl = document.getElementById("pairing-code-value");
      const cmdEl = document.getElementById("pairing-command-text");
      const boxEl = document.getElementById("pairing-code-display");
      if (codeEl) codeEl.textContent = data.pairingCode;
      if (cmdEl) cmdEl.textContent = `aso-runner pair ${data.pairingCode}`;
      if (boxEl) boxEl.classList.remove("hidden");
      showToast("페어링 코드가 생성되었어요: " + data.pairingCode, "success");
    } else {
      showToast("페어링 코드 생성에 실패했어요", "error");
    }
  } catch (err) {
    showToast("페어링 코드 생성 오류: " + err.message, "error");
  }
}

function copyPairingCommand() {
  const el = document.getElementById("pairing-command-text");
  if (!el) return;
  const text = el.textContent || "";
  navigator.clipboard.writeText(text).then(() => {
    showToast("명령어를 복사했어요: " + text, "success");
  }).catch(() => {});
}

async function loadRunners() {
  if (!currentWorkspaceId) return;
  const res = await apiFetch(`${API_URL}/workspaces/${currentWorkspaceId}/runners`);
  if (res.ok) {
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      currentRunnerDevice = data.items[0];
    } else {
      currentRunnerDevice = null;
    }
    const list = document.getElementById("runners-list");
    if (!list) return;
    if (data.items.length === 0) {
      list.innerHTML = `<p class="text-faint">등록된 기기가 없습니다.</p>`;
      return;
    }
    list.innerHTML = data.items.map((r) => {
      const allowed = r.allowedPaths || [];
      const active = r.activePath || (allowed.length > 0 ? allowed[0] : "");
      return `
        <div class="content-card" style="margin-bottom:16px;">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <strong style="font-size:15px;">${escapeHtml(r.name)}</strong>
              <span class="badge ${r.status === "online" ? "badge-accent" : "badge-sub"}" style="margin-left:8px;">${r.status}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <button class="btn btn-sm btn-ghost" onclick="openSettingsModal()" style="font-size:12px;">작업 공간 관리</button>
              <button class="btn btn-sm btn-ghost text-danger" onclick="deleteRunnerDevice('${escapeHtml(r.id)}', '${escapeHtml(r.name)}')" style="font-size:12px;color:rgb(var(--c-danger));">기기 등록 해제</button>
            </div>
          </div>
          <div class="text-faint text-sm mt-2">기기 ID: <code>${escapeHtml(r.id)}</code> · 마지막 통신: ${escapeHtml(r.lastSeenAt || "방금 전")}</div>

          <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgb(var(--c-line));">
            <span style="font-size:13px;font-weight:600;display:block;margin-bottom:8px;">허가된 데스크탑 작업 공간:</span>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${allowed.map(p => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:rgba(var(--c-sunken),0.5);border-radius:6px;font-family:monospace;font-size:12px;">
                  <span>${escapeHtml(p)}</span>
                  <div style="display:flex;align-items:center;gap:6px;">
                    ${p === active ? '<span class="badge badge-accent" style="font-size:11px;">현재 활성</span>' : `<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 8px;" onclick="selectWorkspacePath('${escapeHtml(p)}')">선택</button>`}
                    <button class="btn btn-ghost btn-sm text-danger" style="font-size:11px;padding:2px 6px;color:rgb(var(--c-danger));" onclick="removeWorkspacePath('${escapeHtml(p)}')" title="이 폴더 권한 제거">✕</button>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }
}

// ==========================================================================
// Usage Ledger (W12)
// ==========================================================================

async function loadUsage() {
  if (!currentWorkspaceId) return;
  const url = activeRunId
    ? `${API_URL}/workspaces/${currentWorkspaceId}/runs/${activeRunId}/usage`
    : `${API_URL}/workspaces/${currentWorkspaceId}/projects/${currentProjectId}/runs`;

  try {
    const res = await apiFetch(url);
    if (res.ok) {
      const data = await res.json();
      const tbody = document.getElementById("usage-body");
      if (!tbody) return;

      if (activeRunId && data.items) {
        if (data.items.length === 0) {
          tbody.innerHTML = `<tr><td colspan="8" class="table-empty">기록된 사용량이 없습니다.</td></tr>`;
          return;
        }
        tbody.innerHTML = data.items.map((u) => `
          <tr>
            <td><code>${u.runId.slice(0, 8)}</code></td>
            <td>${escapeHtml(u.provider)} (${escapeHtml(u.model || "default")})</td>
            <td>${u.inputTokens.toLocaleString()}</td>
            <td>${u.outputTokens.toLocaleString()}</td>
            <td>${u.cachedInputTokens.toLocaleString()}</td>
            <td>${u.durationMs}ms</td>
            <td class="text-accent font-semibold">${u.measuredCostUsd !== null ? `$${u.measuredCostUsd.toFixed(4)}` : "—"}</td>
            <td><span class="badge badge-accent">${escapeHtml(u.costConfidence)}</span></td>
          </tr>
        `).join("");
      }
    }
  } catch (err) {
    console.warn("Load usage error:", err);
  }
}

// ==========================================================================
// Utilities
// ==========================================================================

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.addEventListener("DOMContentLoaded", init);
