let loadingNode = null;
let loadingRecoveryBound = false;

function ensureLoadingNode() {
  if (loadingNode && document.body.contains(loadingNode)) return loadingNode;

  const node = document.createElement("div");
  node.id = "globalLoadingOverlay";
  node.className = "fixed inset-0 z-[5000] hidden items-center justify-center bg-black/45 p-4 backdrop-blur-sm";
  node.innerHTML = `
    <div class="w-full max-w-xs rounded-3xl border border-white/20 bg-[#3F4766]/70 p-5 text-white shadow-[14px_14px_34px_rgba(16,23,40,0.5),-10px_-10px_24px_rgba(112,126,165,0.2)] backdrop-blur-xl">
      <div class="flex items-center gap-3">
        <div class="h-5 w-5 animate-spin rounded-full border-2 border-white/35 border-t-white"></div>
        <p id="globalLoadingText" class="text-sm font-semibold">Chargement...</p>
      </div>
    </div>
  `;
  document.body.appendChild(node);
  loadingNode = node;
  return node;
}

function bindLoadingRecovery() {
  if (loadingRecoveryBound || typeof window === "undefined") return;
  loadingRecoveryBound = true;

  window.addEventListener("pageshow", (event) => {
    const navigationEntries = typeof performance !== "undefined"
      && typeof performance.getEntriesByType === "function"
      ? performance.getEntriesByType("navigation")
      : [];
    const navigationType = navigationEntries[0]?.type || "";
    if (event?.persisted === true || navigationType === "back_forward") {
      hideGlobalLoading();
    }
  });
}

export function showGlobalLoading(message = "Chargement...") {
  bindLoadingRecovery();
  const node = ensureLoadingNode();
  const text = node.querySelector("#globalLoadingText");
  if (text) text.textContent = message;
  node.classList.remove("hidden");
  node.classList.add("flex");
}

export function hideGlobalLoading() {
  bindLoadingRecovery();
  const node = ensureLoadingNode();
  node.classList.add("hidden");
  node.classList.remove("flex");
}

export async function withGlobalLoading(task, message = "Chargement...") {
  showGlobalLoading(message);
  try {
    return await task();
  } finally {
    hideGlobalLoading();
  }
}

export async function withButtonLoading(button, task, options = {}) {
  const defaultLabel = options.defaultLabel || "Traiter";
  const loadingLabel = options.loadingLabel || "Chargement...";
  if (!button) return task();

  const previousHtml = button.innerHTML;
  const alreadyDisabled = button.disabled === true;

  button.disabled = true;
  button.innerHTML = `
    <span class="inline-flex items-center gap-2">
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"></span>
      <span>${loadingLabel}</span>
    </span>
  `;

  try {
    return await task();
  } finally {
    button.disabled = alreadyDisabled;
    button.innerHTML = previousHtml || defaultLabel;
  }
}
