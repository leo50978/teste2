const NETWORK_STYLE_ID = "kobposh-network-quality-style";
const DEFAULT_PING_INTERVAL_MS = 12000;
const DEFAULT_HIDDEN_INTERVAL_MS = 22000;
const DEFAULT_TIMEOUT_MS = 4200;

function ensureStyles() {
  if (document.getElementById(NETWORK_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = NETWORK_STYLE_ID;
  style.textContent = `
    .kob-network-indicator {
      --kob-net-bg: rgba(18, 27, 22, 0.76);
      --kob-net-border: rgba(255, 255, 255, 0.12);
      --kob-net-text: #f8fff8;
      --kob-net-muted: rgba(248, 255, 248, 0.72);
      --kob-net-accent: #67e08d;
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 10px);
      left: calc(env(safe-area-inset-left, 0px) + 10px);
      z-index: 4000;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 7px 10px;
      border-radius: 999px;
      border: 1px solid var(--kob-net-border);
      background: var(--kob-net-bg);
      color: var(--kob-net-text);
      box-shadow: 0 10px 24px rgba(7, 12, 9, 0.28);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      pointer-events: none;
      user-select: none;
    }

    .kob-network-indicator--inline {
      position: relative;
      top: auto;
      left: auto;
      z-index: auto;
      min-height: 32px;
      padding: 6px 10px;
    }

    .kob-network-indicator--top-right {
      left: auto;
      right: calc(env(safe-area-inset-right, 0px) + 10px);
    }

    .kob-network-indicator--top-center {
      left: 50%;
      transform: translateX(-50%);
    }

    .kob-network-indicator__bars {
      display: inline-flex;
      align-items: flex-end;
      gap: 2px;
      height: 14px;
      flex-shrink: 0;
    }

    .kob-network-indicator__bar {
      width: 3px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.22);
      transition: background 180ms ease, opacity 180ms ease, transform 180ms ease;
    }

    .kob-network-indicator__bar:nth-child(1) { height: 5px; }
    .kob-network-indicator__bar:nth-child(2) { height: 8px; }
    .kob-network-indicator__bar:nth-child(3) { height: 11px; }
    .kob-network-indicator__bar:nth-child(4) { height: 14px; }

    .kob-network-indicator__meta {
      display: flex;
      align-items: baseline;
      gap: 6px;
      min-width: 0;
    }

    .kob-network-indicator__label {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .kob-network-indicator__detail {
      font-size: 11px;
      font-weight: 700;
      color: var(--kob-net-muted);
      white-space: nowrap;
    }

    .kob-network-indicator[data-tone="excellent"],
    .kob-network-indicator[data-tone="good"] {
      --kob-net-accent: #67e08d;
    }

    .kob-network-indicator[data-tone="fair"] {
      --kob-net-accent: #ffd166;
    }

    .kob-network-indicator[data-tone="poor"] {
      --kob-net-accent: #ff8b5e;
    }

    .kob-network-indicator[data-tone="offline"] {
      --kob-net-accent: #ff5d73;
    }

    .kob-network-indicator[data-tone="checking"] {
      --kob-net-accent: #9ec5ff;
    }

    .kob-network-indicator[data-bars="0"] .kob-network-indicator__bar,
    .kob-network-indicator[data-bars="1"] .kob-network-indicator__bar,
    .kob-network-indicator[data-bars="2"] .kob-network-indicator__bar,
    .kob-network-indicator[data-bars="3"] .kob-network-indicator__bar,
    .kob-network-indicator[data-bars="4"] .kob-network-indicator__bar {
      background: rgba(255, 255, 255, 0.18);
    }

    .kob-network-indicator[data-bars="1"] .kob-network-indicator__bar:nth-child(-n+1),
    .kob-network-indicator[data-bars="2"] .kob-network-indicator__bar:nth-child(-n+2),
    .kob-network-indicator[data-bars="3"] .kob-network-indicator__bar:nth-child(-n+3),
    .kob-network-indicator[data-bars="4"] .kob-network-indicator__bar:nth-child(-n+4) {
      background: var(--kob-net-accent);
    }

    @media (max-width: 640px) {
      .kob-network-indicator {
        min-height: 32px;
        padding: 6px 9px;
      }

      .kob-network-indicator__label,
      .kob-network-indicator__detail {
        font-size: 10px;
      }
    }
  `;
  document.head.appendChild(style);
}

function getConfiguredApiBaseUrl() {
  const candidates = [
    window.localStorage?.getItem("kobposh_api_base_url"),
    window.__KOBPOSH_API_BASE_URL,
    window.__KOBPOSH_RUNTIME_CONFIG__?.apiBaseUrl,
  ];
  for (const raw of candidates) {
    const value = String(raw || "").trim();
    if (value) return value.replace(/\/+$/, "");
  }
  return "";
}

function buildProbeUrl() {
  const baseUrl = getConfiguredApiBaseUrl();
  const suffix = `/api/health?ts=${Date.now()}`;
  return baseUrl ? `${baseUrl}${suffix}` : suffix;
}

function readNavigatorConnectionHints() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return {
    effectiveType: String(connection?.effectiveType || "").trim().toLowerCase(),
    downlink: Number(connection?.downlink || 0),
    rtt: Number(connection?.rtt || 0),
    saveData: connection?.saveData === true,
  };
}

function clampBars(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(4, Math.trunc(count)));
}

function classifyNetworkQuality({ online, latencyMs, failed, hints }) {
  if (!online) {
    return { tone: "offline", bars: 0, label: "Offline", detail: "Pa gen rezo" };
  }

  if (failed) {
    return { tone: "poor", bars: 1, label: "Instab", detail: "Rezo feb" };
  }

  if (!Number.isFinite(latencyMs) || latencyMs <= 0) {
    return { tone: "checking", bars: 2, label: "Test...", detail: "N ap mezire" };
  }

  let score = 4;
  if (latencyMs > 650) score = 1;
  else if (latencyMs > 420) score = 2;
  else if (latencyMs > 220) score = 3;

  if (hints.saveData) score = Math.min(score, 2);
  if (hints.effectiveType === "slow-2g" || hints.effectiveType === "2g") score = Math.min(score, 1);
  else if (hints.effectiveType === "3g") score = Math.min(score, 2);
  if (Number.isFinite(hints.rtt) && hints.rtt > 0) {
    if (hints.rtt > 800) score = Math.min(score, 1);
    else if (hints.rtt > 450) score = Math.min(score, 2);
  }

  if (score >= 4) return { tone: "excellent", bars: 4, label: "Bon", detail: `${Math.round(latencyMs)}ms` };
  if (score === 3) return { tone: "good", bars: 3, label: "Korek", detail: `${Math.round(latencyMs)}ms` };
  if (score === 2) return { tone: "fair", bars: 2, label: "Mwayen", detail: `${Math.round(latencyMs)}ms` };
  return { tone: "poor", bars: 1, label: "Move", detail: `${Math.round(latencyMs)}ms` };
}

function updateIndicator(root, snapshot) {
  const next = classifyNetworkQuality(snapshot);
  root.dataset.tone = next.tone;
  root.dataset.bars = String(clampBars(next.bars));
  const label = root.querySelector("[data-kob-network-label]");
  const detail = root.querySelector("[data-kob-network-detail]");
  if (label) label.textContent = next.label;
  if (detail) detail.textContent = next.detail;
}

function buildIndicatorElement({ inline = false, position = "top-left" } = {}) {
  const root = document.createElement("div");
  root.className = "kob-network-indicator";
  root.dataset.tone = "checking";
  root.dataset.bars = "2";
  if (inline) root.classList.add("kob-network-indicator--inline");
  if (position === "top-right") root.classList.add("kob-network-indicator--top-right");
  if (position === "top-center") root.classList.add("kob-network-indicator--top-center");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-label", "Qualite koneksyon internet");
  root.innerHTML = `
    <span class="kob-network-indicator__bars" aria-hidden="true">
      <span class="kob-network-indicator__bar"></span>
      <span class="kob-network-indicator__bar"></span>
      <span class="kob-network-indicator__bar"></span>
      <span class="kob-network-indicator__bar"></span>
    </span>
    <span class="kob-network-indicator__meta">
      <span class="kob-network-indicator__label" data-kob-network-label>Test...</span>
      <span class="kob-network-indicator__detail" data-kob-network-detail>N ap mezire</span>
    </span>
  `;
  return root;
}

export function mountNetworkQualityIndicator(options = {}) {
  ensureStyles();

  const {
    mountSelector = "",
    inline = false,
    position = "top-left",
    pingIntervalMs = DEFAULT_PING_INTERVAL_MS,
    hiddenIntervalMs = DEFAULT_HIDDEN_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    debugLabel = "NETWORK_QUALITY",
  } = options;

  const mountTarget = mountSelector ? document.querySelector(mountSelector) : null;
  const root = buildIndicatorElement({ inline, position });
  (mountTarget || document.body).appendChild(root);

  let intervalHandle = 0;
  let destroyed = false;
  let lastLatencyMs = NaN;
  let lastFailed = false;

  const render = () => {
    updateIndicator(root, {
      online: navigator.onLine !== false,
      latencyMs: lastLatencyMs,
      failed: lastFailed,
      hints: readNavigatorConnectionHints(),
    });
  };

  const probe = async () => {
    if (destroyed) return;
    if (navigator.onLine === false) {
      lastFailed = false;
      lastLatencyMs = NaN;
      render();
      return;
    }

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutHandle = window.setTimeout(() => controller?.abort(), timeoutMs);
    const probeStartedAt = performance.now();

    try {
      const response = await fetch(buildProbeUrl(), {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        signal: controller?.signal,
        headers: {
          "cache-control": "no-cache",
        },
      });
      if (!response.ok) throw new Error(`health-${response.status}`);
      lastLatencyMs = performance.now() - probeStartedAt;
      lastFailed = false;
    } catch (error) {
      lastFailed = true;
      lastLatencyMs = Number.isFinite(lastLatencyMs) ? lastLatencyMs : NaN;
      try {
        console.warn(`[${debugLabel}] probe failed`, error);
      } catch (_) {
        // noop
      }
    } finally {
      window.clearTimeout(timeoutHandle);
      render();
    }
  };

  const schedule = () => {
    if (intervalHandle) window.clearInterval(intervalHandle);
    const intervalMs = document.hidden ? hiddenIntervalMs : pingIntervalMs;
    intervalHandle = window.setInterval(() => {
      probe().catch(() => undefined);
    }, intervalMs);
  };

  const handleVisibility = () => {
    schedule();
    probe().catch(() => undefined);
  };

  const handleNetworkToggle = () => {
    lastFailed = navigator.onLine === false;
    if (navigator.onLine === false) {
      lastLatencyMs = NaN;
      render();
      return;
    }
    probe().catch(() => undefined);
  };

  const handleConnectionChange = () => {
    render();
    probe().catch(() => undefined);
  };

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  window.addEventListener("online", handleNetworkToggle);
  window.addEventListener("offline", handleNetworkToggle);
  document.addEventListener("visibilitychange", handleVisibility);
  if (connection?.addEventListener) {
    connection.addEventListener("change", handleConnectionChange);
  }

  render();
  schedule();
  probe().catch(() => undefined);

  return {
    element: root,
    refresh() {
      return probe();
    },
    destroy() {
      destroyed = true;
      if (intervalHandle) {
        window.clearInterval(intervalHandle);
        intervalHandle = 0;
      }
      window.removeEventListener("online", handleNetworkToggle);
      window.removeEventListener("offline", handleNetworkToggle);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (connection?.removeEventListener) {
        connection.removeEventListener("change", handleConnectionChange);
      }
      root.remove();
    },
  };
}
