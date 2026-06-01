import {
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "./firebase-init.js";
import { formatAuthError } from "./auth.js";
import {
  debugSimulateDameWinSecure,
  debugSimulateDuelWinSecure,
  debugSimulateMorpionV3FriendWinSecure,
  debugSimulateMorpionV3WinSecure,
  debugSimulatePongWinSecure,
  getChampionnaDashboardSnapshotSecure,
  getDepositFundingStatusSecure,
  updateChampionnaMatchScoreSecure,
} from "./secure-functions.js";

const PROBES = [
  {
    id: "pong",
    label: "Pong",
    copy: "Teste le Pong V2 actif avec la logique HTG actuelle.",
    supportsStakeHtg: [5, 25],
    run: (stakeDoes) => debugSimulatePongWinSecure({ stakeDoes, fundingCurrency: "htg" }),
  },
  {
    id: "morpion-v3-public",
    label: "Mopyon piblik V3",
    copy: "Teste le Mopyon public actuel du site.",
    supportsStakeHtg: [25],
    run: (stakeDoes) => debugSimulateMorpionV3WinSecure({ stakeHtg: doesToHtg(stakeDoes), fundingCurrency: "htg" }),
  },
  {
    id: "morpion-v3-friend",
    label: "Mopyon prive V3",
    copy: "Teste le flux salon prive ami de la version actuelle.",
    supportsStakeHtg: [25],
    run: (stakeDoes) => debugSimulateMorpionV3FriendWinSecure({ stakeHtg: doesToHtg(stakeDoes), fundingCurrency: "htg" }),
  },
  {
    id: "dame",
    label: "Dame",
    copy: "Teste le jeu de Dame actuel avec le split wallet du compte.",
    supportsStakeHtg: [5, 25],
    run: (stakeDoes) => debugSimulateDameWinSecure({ stakeDoes, fundingCurrency: "htg" }),
  },
  {
    id: "duel-v2",
    label: "Domino Duel 2 joueurs",
    copy: "Teste le flux Duel Domino 2 joueurs avec settlement de gain.",
    supportsStakeHtg: [5, 25],
    run: (stakeDoes) => debugSimulateDuelWinSecure({ stakeDoes, fundingCurrency: "htg" }),
  },
];

const state = {
  currentUser: null,
  funding: null,
  authBusy: false,
  runningProbeId: "",
  championnaBusy: false,
  championnaSavingMatchId: "",
  championnaSnapshot: null,
  championnaGameKey: "domino",
  localOriginAllowed: false,
  results: [],
  liveLogs: [],
};

const dom = {
  userBadge: document.getElementById("cpUserBadge"),
  originBadge: document.getElementById("cpOriginBadge"),
  sessionState: document.getElementById("cpSessionState"),
  loginForm: document.getElementById("cpLoginForm"),
  email: document.getElementById("cpEmail"),
  password: document.getElementById("cpPassword"),
  loginBtn: document.getElementById("cpLoginBtn"),
  logoutBtn: document.getElementById("cpLogoutBtn"),
  authMessage: document.getElementById("cpAuthMessage"),
  stakeSelect: document.getElementById("cpStakeSelect"),
  refreshBtn: document.getElementById("cpRefreshBtn"),
  runAllBtn: document.getElementById("cpRunAllBtn"),
  clearBtn: document.getElementById("cpClearBtn"),
  liveLogs: document.getElementById("cpLiveLogs"),
  approvedValue: document.getElementById("cpApprovedValue"),
  pendingValue: document.getElementById("cpPendingValue"),
  playableValue: document.getElementById("cpPlayableValue"),
  withdrawableValue: document.getElementById("cpWithdrawableValue"),
  probeGrid: document.getElementById("cpProbeGrid"),
  results: document.getElementById("cpResults"),
  championnaRefreshBtn: document.getElementById("cpChampionnaRefreshBtn"),
  championnaGameSelect: document.getElementById("cpChampionnaGameSelect"),
  championnaSummary: document.getElementById("cpChampionnaSummary"),
  championnaMessage: document.getElementById("cpChampionnaMessage"),
  championnaMatches: document.getElementById("cpChampionnaMatches"),
};

function safeInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : 0;
}

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatHtg(value) {
  return `${safeInt(value).toLocaleString("fr-FR")} HTG`;
}

function formatSignedHtg(value) {
  const amount = safeInt(value);
  return `${amount > 0 ? "+" : ""}${amount.toLocaleString("fr-FR")} HTG`;
}

function formatDateTime(ms = Date.now()) {
  return new Date(ms).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function doesToHtg(stakeDoes) {
  return Math.max(0, Math.floor(safeInt(stakeDoes) / 20));
}

function getSelectedStakeDoes() {
  return safeInt(dom.stakeSelect?.value || 500) || 500;
}

function isLocalLabOrigin() {
  try {
    const host = String(window.location.hostname || "").trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  } catch (_error) {
    return false;
  }
}

function snapshotSummary(snapshot = null) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    approvedHtgAvailable: safeInt(source.approvedHtgAvailable),
    provisionalHtgAvailable: safeInt(source.provisionalHtgAvailable),
    playableHtg: safeInt(source.playableHtg),
    withdrawableHtg: safeInt(source.withdrawableHtg),
  };
}

function fundingSplitSummary(entryFunding = null) {
  const source = entryFunding && typeof entryFunding === "object" ? entryFunding : {};
  return {
    approvedDoes: safeInt(source.approvedDoes),
    provisionalDoes: safeInt(source.provisionalDoes),
    welcomeDoes: safeInt(source.welcomeDoes),
    convertedHtg: safeInt(source.convertedHtg),
  };
}

function setAuthMessage(message = "", tone = "muted") {
  if (!dom.authMessage) return;
  dom.authMessage.textContent = String(message || "");
  dom.authMessage.style.color = tone === "danger"
    ? "#fb7185"
    : tone === "success"
      ? "#86efac"
      : "var(--muted)";
}

function pushLiveLog(level = "info", message = "", payload = null) {
  state.liveLogs.unshift({
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    atMs: Date.now(),
    level: String(level || "info"),
    message: String(message || ""),
    payload,
  });
  state.liveLogs = state.liveLogs.slice(0, 80);
  renderLiveLogs();
}

function setAuthBusy(busy) {
  state.authBusy = busy === true;
  if (dom.loginBtn) dom.loginBtn.disabled = state.authBusy;
  if (dom.logoutBtn) dom.logoutBtn.disabled = state.authBusy;
}

async function refreshFunding() {
  if (!auth.currentUser?.uid) {
    state.funding = null;
    renderFunding();
    return null;
  }
  const funding = await getDepositFundingStatusSecure();
  state.funding = funding || {};
  renderFunding();
  return funding;
}

function renderFunding() {
  const summary = snapshotSummary(state.funding);
  dom.approvedValue.textContent = state.funding ? formatHtg(summary.approvedHtgAvailable) : "--";
  dom.pendingValue.textContent = state.funding ? formatHtg(summary.provisionalHtgAvailable) : "--";
  dom.playableValue.textContent = state.funding ? formatHtg(summary.playableHtg) : "--";
  dom.withdrawableValue.textContent = state.funding ? formatHtg(summary.withdrawableHtg) : "--";
}

function renderLiveLogs() {
  if (!dom.liveLogs) return;
  if (!state.liveLogs.length) {
    dom.liveLogs.innerHTML = `<div class="log-line"><strong>Pa gen log poko</strong><span class="helper">Klike sou yon probe oubyen rafrechi wallet la pou ranpli journal la.</span></div>`;
    return;
  }
  dom.liveLogs.innerHTML = state.liveLogs.map((entry) => `
    <div class="log-line">
      <strong>${escapeHtml(formatDateTime(entry.atMs))} · ${escapeHtml(entry.level.toUpperCase())} · ${escapeHtml(entry.message)}</strong>
      ${entry.payload == null ? "" : `<code>${escapeHtml(JSON.stringify(entry.payload, null, 2))}</code>`}
    </div>
  `).join("");
}

function renderSession() {
  const email = String(state.currentUser?.email || "").trim();
  const uid = String(state.currentUser?.uid || "").trim();
  dom.userBadge.textContent = email ? `${email} · ${uid.slice(0, 8)}` : "Pa konekte";
  dom.originBadge.textContent = state.localOriginAllowed
    ? `${window.location.origin} · OK`
    : `${window.location.origin || "origin vide"} · bloke`;

  if (!state.localOriginAllowed) {
    dom.sessionState.className = "warning is-danger";
    dom.sessionState.innerHTML = `
      <strong>Origin pa bon</strong>
      <span class="warning-copy">Callables debug yo mande localhost oswa .local. Louvri paj sa a depi yon serveur lokal, pa depi file:// oswa hosting live.</span>
    `;
  } else if (!state.currentUser?.uid) {
    dom.sessionState.className = "warning";
    dom.sessionState.innerHTML = `
      <strong>Konto test la poko konekte</strong>
      <span class="warning-copy">Mete email ak modpas kont joueur ki gen pending lan.</span>
    `;
  } else {
    dom.sessionState.className = "warning";
    dom.sessionState.innerHTML = `
      <strong>Kont pare</strong>
      <span class="warning-copy">Ou konekte sou konto test la. Kounye a ou ka lanse probes yo youn pa youn.</span>
    `;
  }
}

function probeButtonDisabled(probe) {
  const stakeHtg = doesToHtg(getSelectedStakeDoes());
  if (!state.localOriginAllowed) return true;
  if (!state.currentUser?.uid) return true;
  if (state.runningProbeId) return true;
  if (Array.isArray(probe.supportsStakeHtg) && !probe.supportsStakeHtg.includes(stakeHtg)) return true;
  return false;
}

function renderProbes() {
  const stakeHtg = doesToHtg(getSelectedStakeDoes());
  dom.probeGrid.innerHTML = PROBES.map((probe) => {
    const disabled = probeButtonDisabled(probe);
    const running = state.runningProbeId === probe.id;
    const hint = Array.isArray(probe.supportsStakeHtg) && !probe.supportsStakeHtg.includes(stakeHtg)
      ? `Probe sa a mande ${probe.supportsStakeHtg.join(" / ")} HTG.`
      : probe.copy;
    return `
      <button
        class="probe-btn${running ? " is-running" : ""}"
        type="button"
        data-probe-id="${escapeHtml(probe.id)}"
        ${disabled ? "disabled" : ""}
      >
        <strong>${escapeHtml(probe.label)}</strong>
        <span>${escapeHtml(hint)}</span>
      </button>
    `;
  }).join("");

  dom.probeGrid.querySelectorAll("[data-probe-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const probeId = String(button.getAttribute("data-probe-id") || "").trim();
      void runProbeById(probeId);
    });
  });

  dom.runAllBtn.disabled = !state.localOriginAllowed || !state.currentUser?.uid || Boolean(state.runningProbeId);
  dom.refreshBtn.disabled = !state.currentUser?.uid || Boolean(state.runningProbeId);
}

function getChampionnaSnapshotParts() {
  const snapshot = state.championnaSnapshot && typeof state.championnaSnapshot === "object"
    ? state.championnaSnapshot
    : {};
  return {
    games: Array.isArray(snapshot.games) ? snapshot.games : [],
    registrationsByGame: snapshot.registrationsByGame && typeof snapshot.registrationsByGame === "object"
      ? snapshot.registrationsByGame
      : {},
    bracketsByGame: snapshot.bracketsByGame && typeof snapshot.bracketsByGame === "object"
      ? snapshot.bracketsByGame
      : {},
  };
}

function groupMatchesByRound(matches = []) {
  const grouped = [];
  const byRound = new Map();
  (Array.isArray(matches) ? matches : []).forEach((match) => {
    const roundLabel = String(match?.roundLabel || "Match").trim() || "Match";
    const key = `${safeInt(match?.roundOrder || 99)}_${roundLabel}`;
    if (!byRound.has(key)) {
      byRound.set(key, { label: roundLabel.replace(/\s+-\s+Match\s+\d+$/i, ""), matches: [] });
      grouped.push(byRound.get(key));
    }
    byRound.get(key).matches.push(match);
  });
  return grouped;
}

function renderChampionnaDashboard() {
  if (!dom.championnaGameSelect || !dom.championnaSummary || !dom.championnaMatches) return;
  const { games, registrationsByGame, bracketsByGame } = getChampionnaSnapshotParts();
  const gameKey = state.championnaGameKey || dom.championnaGameSelect.value || "domino";
  const game = games.find((item) => item.key === gameKey) || { key: gameKey, name: gameKey };
  const registrations = registrationsByGame[gameKey] || [];
  const bracket = bracketsByGame[gameKey] || null;
  const matches = Array.isArray(bracket?.matches) ? bracket.matches : [];
  const completedCount = matches.filter((match) => String(match?.status || "") === "completed").length;

  if (games.length) {
    dom.championnaGameSelect.innerHTML = games.map((item) => `
      <option value="${escapeHtml(item.key)}" ${item.key === gameKey ? "selected" : ""}>
        ${escapeHtml(item.name)} (${safeInt(item.registrationCount)}/8)
      </option>
    `).join("");
  }

  dom.championnaSummary.innerHTML = `
    <span class="championna-pill">Jeu: ${escapeHtml(game.name || gameKey)}</span>
    <span class="championna-pill">Inscrits: ${escapeHtml(String(registrations.length))}/8</span>
    <span class="championna-pill">Matchs finis: ${escapeHtml(String(completedCount))}/${escapeHtml(String(matches.length || 7))}</span>
    <span class="championna-pill">Statut: ${escapeHtml(bracket?.status || (bracket ? "active" : "en attente"))}</span>
  `;

  if (!state.currentUser?.uid) {
    dom.championnaMessage.textContent = "Konekte ak yon kont admin pou chaje dashboard Championna a.";
    dom.championnaMatches.innerHTML = `<div class="empty">Dashboard la ap tann koneksyon admin.</div>`;
    dom.championnaRefreshBtn.disabled = true;
    return;
  }

  dom.championnaRefreshBtn.disabled = state.championnaBusy;
  dom.championnaMessage.textContent = state.championnaBusy
    ? "N ap chaje done Championna yo..."
    : bracket
      ? "Antre score final match la. Le gagnant dwe gen 2 pati gagnees."
      : "Pa gen bracket pou jeu sa a poko. Tiraj la kreye le 8 moun fin enskri.";

  if (!bracket) {
    dom.championnaMatches.innerHTML = `
      <div class="empty">
        ${escapeHtml(game.name || gameKey)} poko gen kalandriye. Inscrits aktyel: ${escapeHtml(String(registrations.length))}/8.
      </div>
    `;
    return;
  }

  if (!matches.length) {
    dom.championnaMatches.innerHTML = `<div class="empty">Bracket la egziste, men pa gen match ladan l.</div>`;
    return;
  }

  dom.championnaMatches.innerHTML = groupMatchesByRound(matches).map((round) => `
    <section class="championna-round">
      <h3>${escapeHtml(round.label)}</h3>
      ${round.matches.map(renderChampionnaMatchCard).join("")}
    </section>
  `).join("");

  dom.championnaMatches.querySelectorAll("[data-championna-score-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const matchId = String(form.getAttribute("data-match-id") || "").trim();
      const homeScore = form.querySelector("[data-home-score]")?.value ?? "";
      const awayScore = form.querySelector("[data-away-score]")?.value ?? "";
      void saveChampionnaMatchScore(matchId, homeScore, awayScore);
    });
  });
}

function renderChampionnaMatchCard(match = {}) {
  const matchId = String(match?.id || "").trim();
  const status = String(match?.status || "scheduled").trim();
  const isCompleted = status === "completed";
  const isReady = Boolean(match?.homeUid && match?.awayUid);
  const isSaving = state.championnaSavingMatchId === matchId;
  const homeScore = match?.homeScore == null ? "" : safeInt(match.homeScore);
  const awayScore = match?.awayScore == null ? "" : safeInt(match.awayScore);
  const winnerText = isCompleted && match?.winnerName
    ? `Ganyan: ${String(match.winnerName)}`
    : isReady
      ? "Pare pou score"
      : "Ap tann gagnant faz avan an";
  return `
    <article class="championna-match">
      <div>
        <strong>${escapeHtml(match.roundLabel || matchId || "Match")}</strong>
        <span class="championna-status">${escapeHtml(winnerText)}</span>
      </div>
      <div class="championna-pair">
        <div class="championna-player">
          <strong>${escapeHtml(match.homeName || "TBD")}</strong>
          <span>Kay</span>
        </div>
        <div class="championna-versus">${escapeHtml(isCompleted ? `${homeScore} - ${awayScore}` : "VS")}</div>
        <div class="championna-player" style="text-align: right;">
          <strong>${escapeHtml(match.awayName || "TBD")}</strong>
          <span>Deyo</span>
        </div>
      </div>
      <form class="championna-score-form" data-championna-score-form data-match-id="${escapeHtml(matchId)}">
        <div class="field">
          <label>Score kay</label>
          <input type="number" min="0" max="2" step="1" value="${escapeHtml(String(homeScore))}" data-home-score ${!isReady || isSaving ? "disabled" : ""} />
        </div>
        <div class="field">
          <label>Score deyo</label>
          <input type="number" min="0" max="2" step="1" value="${escapeHtml(String(awayScore))}" data-away-score ${!isReady || isSaving ? "disabled" : ""} />
        </div>
        <button class="primary-btn" type="submit" ${!isReady || isSaving ? "disabled" : ""}>
          ${escapeHtml(isSaving ? "Nap sove..." : "Sove score + pase faz")}
        </button>
      </form>
    </article>
  `;
}

async function refreshChampionnaDashboard() {
  if (!state.currentUser?.uid || state.championnaBusy) {
    renderChampionnaDashboard();
    return;
  }
  state.championnaBusy = true;
  renderChampionnaDashboard();
  try {
    const snapshot = await getChampionnaDashboardSnapshotSecure({});
    state.championnaSnapshot = snapshot || {};
    pushLiveLog("success", "Dashboard Championna chaje", {
      games: Array.isArray(snapshot?.games) ? snapshot.games.length : 0,
    });
  } catch (error) {
    setAuthMessage(formatAuthError(error, "Dashboard Championna pa ka chaje."), "danger");
    pushLiveLog("error", "Echec dashboard Championna", {
      message: error?.message || "",
      code: error?.code || "",
    });
  } finally {
    state.championnaBusy = false;
    renderChampionnaDashboard();
  }
}

async function saveChampionnaMatchScore(matchId, homeScore, awayScore) {
  if (!state.currentUser?.uid || !matchId || state.championnaSavingMatchId) return;
  state.championnaSavingMatchId = matchId;
  renderChampionnaDashboard();
  try {
    const result = await updateChampionnaMatchScoreSecure({
      gameKey: state.championnaGameKey,
      matchId,
      homeScore: safeInt(homeScore),
      awayScore: safeInt(awayScore),
    });
    pushLiveLog("success", "Score Championna sove", {
      gameKey: state.championnaGameKey,
      matchId,
      winner: result?.match?.winnerName || "",
    });
    await refreshChampionnaDashboard();
    setAuthMessage("Score Championna a sove, kalandriye piblik la mete ajou.", "success");
  } catch (error) {
    setAuthMessage(formatAuthError(error, "Score Championna a pa sove."), "danger");
    pushLiveLog("error", "Echec score Championna", {
      gameKey: state.championnaGameKey,
      matchId,
      message: error?.message || "",
      code: error?.code || "",
    });
  } finally {
    state.championnaSavingMatchId = "";
    renderChampionnaDashboard();
  }
}

function renderResults() {
  if (!state.results.length) {
    dom.results.innerHTML = `<div class="empty">Pa gen okenn run poko. Klike sou yon probe pou demare premye test la.</div>`;
    return;
  }

  dom.results.innerHTML = state.results.map((item) => {
    const summaryBefore = snapshotSummary(item.result?.beforeFunding);
    const summaryAfter = snapshotSummary(item.result?.afterFunding);
    const deltas = item.result?.deltas && typeof item.result.deltas === "object" ? item.result.deltas : {};
    const split = fundingSplitSummary(item.result?.entryMutation?.gameEntryFunding);
    const beforeCollections = item.result?.beforeCollections || null;
    const afterCollections = item.result?.afterCollections || null;
    const debugTrail = Array.isArray(item.result?.debugTrail) ? item.result.debugTrail : [];
    const copy = item.ok
      ? `Net espere ${formatSignedHtg(item.result?.expectedNetHtg || 0)}. Surveille surtout la ligne pending si la mise venait du pending.`
      : String(item.errorMessage || "Le probe a echoue.");
    return `
      <article class="result-card ${item.ok ? "ok" : "error"}">
        <div class="result-top">
          <div>
            <h3>${escapeHtml(item.label)}</h3>
            <p class="result-copy">${escapeHtml(copy)}</p>
          </div>
          <div class="result-stamp">${escapeHtml(formatDateTime(item.atMs))}</div>
        </div>

        ${item.ok ? `
          <div class="result-grid">
            <section class="snapshot">
              <h4>Avant</h4>
              <div class="snapshot-list">
                <div class="row"><span>Approved</span><strong>${escapeHtml(formatHtg(summaryBefore.approvedHtgAvailable))}</strong></div>
                <div class="row"><span>Pending</span><strong>${escapeHtml(formatHtg(summaryBefore.provisionalHtgAvailable))}</strong></div>
                <div class="row"><span>Playable</span><strong>${escapeHtml(formatHtg(summaryBefore.playableHtg))}</strong></div>
                <div class="row"><span>Withdrawable</span><strong>${escapeHtml(formatHtg(summaryBefore.withdrawableHtg))}</strong></div>
              </div>
            </section>
            <section class="snapshot">
              <h4>Apres</h4>
              <div class="snapshot-list">
                <div class="row"><span>Approved</span><strong>${escapeHtml(formatHtg(summaryAfter.approvedHtgAvailable))}</strong></div>
                <div class="row"><span>Pending</span><strong>${escapeHtml(formatHtg(summaryAfter.provisionalHtgAvailable))}</strong></div>
                <div class="row"><span>Playable</span><strong>${escapeHtml(formatHtg(summaryAfter.playableHtg))}</strong></div>
                <div class="row"><span>Withdrawable</span><strong>${escapeHtml(formatHtg(summaryAfter.withdrawableHtg))}</strong></div>
              </div>
            </section>
            <section class="snapshot">
              <h4>Funding d'entree</h4>
              <div class="snapshot-list">
                <div class="row"><span>Approved Does</span><strong>${escapeHtml(String(split.approvedDoes))}</strong></div>
                <div class="row"><span>Pending Does</span><strong>${escapeHtml(String(split.provisionalDoes))}</strong></div>
                <div class="row"><span>Welcome Does</span><strong>${escapeHtml(String(split.welcomeDoes))}</strong></div>
                <div class="row"><span>Converted HTG</span><strong>${escapeHtml(formatHtg(split.convertedHtg))}</strong></div>
              </div>
            </section>
          </div>

          <div class="delta-grid">
            <section class="delta-card">
              <h4>Deltas observes</h4>
              <div class="delta-list">
                <div class="row"><span>Approved</span><strong class="${safeInt(deltas.approvedHtg) >= 0 ? "positive" : "negative"}">${escapeHtml(formatSignedHtg(deltas.approvedHtg))}</strong></div>
                <div class="row"><span>Pending</span><strong class="${safeInt(deltas.provisionalHtg) >= 0 ? "positive" : "negative"}">${escapeHtml(formatSignedHtg(deltas.provisionalHtg))}</strong></div>
                <div class="row"><span>Playable</span><strong class="${safeInt(deltas.playableHtg) >= 0 ? "positive" : "negative"}">${escapeHtml(formatSignedHtg(deltas.playableHtg))}</strong></div>
                <div class="row"><span>Withdrawable</span><strong class="${safeInt(deltas.withdrawableHtg) >= 0 ? "positive" : "negative"}">${escapeHtml(formatSignedHtg(deltas.withdrawableHtg))}</strong></div>
              </div>
            </section>
          </div>

          <div class="collection-grid">
            ${renderCollectionSnapshot("Collections avant", beforeCollections)}
            ${renderCollectionSnapshot("Collections apres", afterCollections)}
            <section class="collection-card">
              <h4>Debug trail</h4>
              ${debugTrail.length ? `
                <div class="table-shell">
                  <table>
                    <thead>
                      <tr><th>Heure</th><th>Step</th><th>Details</th></tr>
                    </thead>
                    <tbody>
                      ${debugTrail.map((entry) => `
                        <tr>
                          <td>${escapeHtml(formatDateTime(entry.atMs || Date.now()))}</td>
                          <td>${escapeHtml(String(entry.step || ""))}</td>
                          <td><code>${escapeHtml(JSON.stringify(entry.details || {}, null, 2))}</code></td>
                        </tr>
                      `).join("")}
                    </tbody>
                  </table>
                </div>
              ` : `<p class="helper">Pa gen debug trail retounen pou probe sa a.</p>`}
            </section>
          </div>
        ` : ""}

        <details>
          <summary>Voir JSON brut</summary>
          <pre>${escapeHtml(JSON.stringify(item.ok ? item.result : item.error, null, 2))}</pre>
        </details>
      </article>
    `;
  }).join("");
}

function renderKeyValueTable(title, objectValue = null) {
  const source = objectValue && typeof objectValue === "object" ? objectValue : {};
  const entries = Object.entries(source);
  if (!entries.length) {
    return `
      <section class="collection-card">
        <h4>${escapeHtml(title)}</h4>
        <p class="helper">Pa gen done.</p>
      </section>
    `;
  }
  return `
    <section class="collection-card">
      <h4>${escapeHtml(title)}</h4>
      <div class="table-shell">
        <table>
          <thead>
            <tr><th>Champ</th><th>Valeur</th></tr>
          </thead>
          <tbody>
            ${entries.map(([key, value]) => `
              <tr>
                <td>${escapeHtml(key)}</td>
                <td><code>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : String(value))}</code></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderArrayTable(title, rows = [], preferredKeys = []) {
  const safeRows = Array.isArray(rows) ? rows.slice(0, 20) : [];
  if (!safeRows.length) {
    return `
      <section class="collection-card">
        <h4>${escapeHtml(title)}</h4>
        <p class="helper">Pa gen liy.</p>
      </section>
    `;
  }
  const discoveredKeys = Array.from(new Set(safeRows.flatMap((row) => Object.keys(row || {}))));
  const orderedKeys = [...preferredKeys.filter((key) => discoveredKeys.includes(key)), ...discoveredKeys.filter((key) => !preferredKeys.includes(key))].slice(0, 10);
  return `
    <section class="collection-card">
      <h4>${escapeHtml(title)} · ${safeRows.length}/${Array.isArray(rows) ? rows.length : safeRows.length} lignes</h4>
      <div class="table-shell">
        <table>
          <thead>
            <tr>${orderedKeys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${safeRows.map((row) => `
              <tr>
                ${orderedKeys.map((key) => {
                  const value = row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : "";
                  return `<td><code>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : String(value))}</code></td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderCollectionSnapshot(title, collections = null) {
  if (!collections || typeof collections !== "object") {
    return `
      <section class="collection-card">
        <h4>${escapeHtml(title)}</h4>
        <p class="helper">Snapshot pa disponib pou probe sa a.</p>
      </section>
    `;
  }
  const counts = collections.counts && typeof collections.counts === "object" ? collections.counts : {};
  return `
    <section class="collection-card">
      <h4>${escapeHtml(title)}</h4>
      <div class="collection-meta">
        <span class="collection-chip">orders: ${escapeHtml(String(safeInt(counts.orders)))}</span>
        <span class="collection-chip">withdrawals: ${escapeHtml(String(safeInt(counts.withdrawals)))}</span>
        <span class="collection-chip">walletHistory: ${escapeHtml(String(safeInt(counts.walletHistory)))}</span>
      </div>
      ${renderKeyValueTable("Client doc", collections.clientData)}
      ${renderKeyValueTable("Wallet doc", collections.walletData)}
      ${renderArrayTable("Orders", collections.orders, ["id", "status", "resolutionStatus", "amountHtg", "provisionalHtgRemaining", "provisionalDoesRemaining", "provisionalGainDoes", "updatedAtMs", "createdAtMs"])}
      ${renderArrayTable("Withdrawals", collections.withdrawals, ["id", "status", "amountHtg", "createdAtMs", "updatedAtMs"])}
      ${renderArrayTable("Wallet history", collections.walletHistory, ["id", "type", "amountHtg", "amountDoes", "createdAtMs", "updatedAtMs", "note"])}
    </section>
  `;
}

async function runProbeById(probeId) {
  const probe = PROBES.find((item) => item.id === probeId);
  if (!probe || probeButtonDisabled(probe)) return;

  state.runningProbeId = probe.id;
  renderProbes();
  setAuthMessage(`Probe ${probe.label} an kou...`);
  pushLiveLog("info", `Demarrage probe ${probe.label}`, { stakeDoes: getSelectedStakeDoes(), stakeHtg: doesToHtg(getSelectedStakeDoes()) });

  try {
    const result = await probe.run(getSelectedStakeDoes());
    state.results.unshift({
      id: `${probe.id}_${Date.now()}`,
      atMs: Date.now(),
      label: probe.label,
      ok: true,
      result,
    });
    await refreshFunding();
    setAuthMessage(`Probe ${probe.label} fini. Verifye pending vs approved anba a.`, "success");
    pushLiveLog("success", `Probe ${probe.label} fini`, {
      expectedNetHtg: result?.expectedNetHtg || 0,
      deltas: result?.deltas || {},
    });
  } catch (error) {
    state.results.unshift({
      id: `${probe.id}_${Date.now()}`,
      atMs: Date.now(),
      label: probe.label,
      ok: false,
      error,
      errorMessage: String(error?.message || "Erreur inconnue."),
    });
    setAuthMessage(formatAuthError(error, `Probe ${probe.label} a echoue.`), "danger");
    pushLiveLog("error", `Probe ${probe.label} echoue`, {
      message: error?.message || "",
      code: error?.code || "",
      details: error?.details || null,
    });
  } finally {
    state.runningProbeId = "";
    renderProbes();
    renderResults();
  }
}

async function runAllProbes() {
  for (const probe of PROBES) {
    if (probeButtonDisabled(probe)) continue;
    // eslint-disable-next-line no-await-in-loop
    await runProbeById(probe.id);
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (state.authBusy) return;
  const email = String(dom.email?.value || "").trim();
  const password = String(dom.password?.value || "");
  if (!email || !password) {
    setAuthMessage("Mete email ak modpas konto test la.", "danger");
    return;
  }

  setAuthBusy(true);
  setAuthMessage("Koneksyon an kou...");
  pushLiveLog("info", "Tentative de connexion du compte test", { email });
  try {
    await signInWithEmailAndPassword(auth, email, password);
    setAuthMessage("Konto test la konekte.", "success");
    dom.password.value = "";
    pushLiveLog("success", "Compte test connecte", { email });
  } catch (error) {
    setAuthMessage(formatAuthError(error, "Koneksyon enposib."), "danger");
    pushLiveLog("error", "Echec connexion", { email, message: error?.message || "", code: error?.code || "" });
  } finally {
    setAuthBusy(false);
  }
}

async function handleLogout() {
  if (state.authBusy) return;
  setAuthBusy(true);
  try {
    await signOut(auth);
    setAuthMessage("Konto a dekonekte.");
    pushLiveLog("info", "Compte test deconnecte");
  } catch (error) {
    setAuthMessage(formatAuthError(error, "Dekoneksyon enposib."), "danger");
    pushLiveLog("error", "Echec deconnexion", { message: error?.message || "", code: error?.code || "" });
  } finally {
    setAuthBusy(false);
  }
}

function bindEvents() {
  dom.loginForm?.addEventListener("submit", (event) => {
    void handleLoginSubmit(event);
  });
  dom.logoutBtn?.addEventListener("click", () => {
    void handleLogout();
  });
  dom.refreshBtn?.addEventListener("click", () => {
    void refreshFunding().catch((error) => {
      setAuthMessage(formatAuthError(error, "Rafrechisman wallet la echoue."), "danger");
    });
  });
  dom.runAllBtn?.addEventListener("click", () => {
    void runAllProbes();
  });
  dom.clearBtn?.addEventListener("click", () => {
    state.results = [];
    renderResults();
    setAuthMessage("Rezilta yo netwaye.");
  });
  dom.stakeSelect?.addEventListener("change", () => {
    renderProbes();
  });
  dom.championnaRefreshBtn?.addEventListener("click", () => {
    void refreshChampionnaDashboard();
  });
  dom.championnaGameSelect?.addEventListener("change", () => {
    state.championnaGameKey = String(dom.championnaGameSelect.value || "domino").trim() || "domino";
    renderChampionnaDashboard();
  });
}

function bootstrap() {
  state.localOriginAllowed = isLocalLabOrigin();
  renderSession();
  renderFunding();
  renderResults();
  renderProbes();
  renderLiveLogs();
  renderChampionnaDashboard();
  bindEvents();

  onAuthStateChanged(auth, async (user) => {
    state.currentUser = user || null;
    renderSession();
    renderProbes();
    renderChampionnaDashboard();
    if (state.currentUser?.uid) {
      try {
        await refreshFunding();
        await refreshChampionnaDashboard();
        pushLiveLog("info", "Wallet rafrechi", snapshotSummary(state.funding));
      } catch (error) {
        setAuthMessage(formatAuthError(error, "Impossible de charger le wallet."), "danger");
        pushLiveLog("error", "Echec chargement wallet", { message: error?.message || "", code: error?.code || "" });
      }
    } else {
      state.funding = null;
      renderFunding();
    }
  });
}

bootstrap();
