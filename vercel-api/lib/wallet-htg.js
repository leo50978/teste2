const { makeHttpError } = require("./http");
const { safeInt } = require("./safe");

const RATE_HTG_TO_DOES = 20;

function normalizeFundingCurrency(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "htg" ? "htg" : "does";
}

function htgToDoes(amountHtg = 0) {
  const safeAmountHtg = Math.max(0, safeInt(amountHtg));
  return safeAmountHtg > 0 ? safeAmountHtg * RATE_HTG_TO_DOES : 0;
}

function doesToHtg(amountDoes = 0) {
  const safeAmountDoes = Math.max(0, safeInt(amountDoes));
  return safeAmountDoes > 0 ? Math.floor(safeAmountDoes / RATE_HTG_TO_DOES) : 0;
}

function pickFirstFinite(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric);
    }
  }
  return null;
}

function readApprovedHtg(source = {}) {
  const legacyDoes = pickFirstFinite(source.doesApprovedBalance, source.approvedDoesBalance);
  return Math.max(
    0,
    pickFirstFinite(
      source.approvedHtgAvailable,
      source.approvedGourdesAvailable,
      source.htgApprovedAvailable,
      source.approvedHtg,
      legacyDoes != null ? doesToHtg(legacyDoes) : null
    ) || 0
  );
}

function readProvisionalHtg(source = {}) {
  const legacyDoes = pickFirstFinite(source.doesProvisionalBalance, source.provisionalDoesBalance);
  return Math.max(
    0,
    pickFirstFinite(
      source.provisionalHtgAvailable,
      source.provisionalGourdesAvailable,
      source.htgProvisionalAvailable,
      source.provisionalHtg,
      legacyDoes != null ? doesToHtg(legacyDoes) : null
    ) || 0
  );
}

function readWithdrawableHtg(source = {}, approvedHtg = readApprovedHtg(source)) {
  const explicit = pickFirstFinite(source.withdrawableHtg, source.withdrawableGourdes);
  if (explicit == null) {
    return Math.max(0, safeInt(approvedHtg));
  }
  return Math.max(0, Math.min(safeInt(approvedHtg), safeInt(explicit)));
}

function buildBalancesPatch({
  approvedHtg = 0,
  provisionalHtg = 0,
  withdrawableHtg = null,
} = {}) {
  const nextApprovedHtg = Math.max(0, safeInt(approvedHtg));
  const nextProvisionalHtg = Math.max(0, safeInt(provisionalHtg));
  const nextPlayableHtg = Math.max(0, nextApprovedHtg + nextProvisionalHtg);
  const requestedWithdrawableHtg = withdrawableHtg == null
    ? nextApprovedHtg
    : Math.max(0, safeInt(withdrawableHtg));
  const nextWithdrawableHtg = Math.max(0, Math.min(nextApprovedHtg, requestedWithdrawableHtg));

  const nextApprovedDoes = htgToDoes(nextApprovedHtg);
  const nextProvisionalDoes = htgToDoes(nextProvisionalHtg);
  const nextDoes = Math.max(0, nextApprovedDoes + nextProvisionalDoes);

  return {
    approvedHtgAvailable: nextApprovedHtg,
    approvedGourdesAvailable: nextApprovedHtg,
    htgApprovedAvailable: nextApprovedHtg,
    approvedHtg: nextApprovedHtg,
    provisionalHtgAvailable: nextProvisionalHtg,
    provisionalGourdesAvailable: nextProvisionalHtg,
    htgProvisionalAvailable: nextProvisionalHtg,
    provisionalHtg: nextProvisionalHtg,
    playableHtg: nextPlayableHtg,
    availableGourdes: nextPlayableHtg,
    withdrawableHtg: nextWithdrawableHtg,
    approvedDoesBalance: nextApprovedDoes,
    doesApprovedBalance: nextApprovedDoes,
    provisionalDoesBalance: nextProvisionalDoes,
    doesProvisionalBalance: nextProvisionalDoes,
    approvedDoes: nextApprovedDoes,
    provisionalDoes: nextProvisionalDoes,
    doesBalance: nextDoes,
    exchangeableDoesAvailable: nextDoes,
  };
}

function resolveEntryFundingSplitHtg(entryFunding = {}) {
  const approvedFromHtg = Math.max(0, safeInt(entryFunding.approvedHtg));
  const provisionalFromHtg = Math.max(0, safeInt(entryFunding.provisionalHtg));
  const approvedFromDoes = doesToHtg(entryFunding.approvedDoes);
  const provisionalFromDoes = doesToHtg(entryFunding.provisionalDoes);

  let approvedHtg = Math.max(approvedFromHtg, approvedFromDoes);
  let provisionalHtg = Math.max(provisionalFromHtg, provisionalFromDoes);

  if (approvedHtg <= 0 && provisionalHtg <= 0) {
    const convertedHtg = Math.max(0, safeInt(entryFunding.convertedHtg));
    approvedHtg = convertedHtg;
    provisionalHtg = 0;
  }

  return {
    approvedHtg,
    provisionalHtg,
    totalHtg: Math.max(0, approvedHtg + provisionalHtg),
  };
}

function splitRewardAcrossEntryFunding(rewardHtg = 0, rewardEntryFunding = null) {
  const safeRewardHtg = Math.max(0, safeInt(rewardHtg));
  if (safeRewardHtg <= 0) {
    return {
      approvedRewardHtg: 0,
      provisionalRewardHtg: 0,
    };
  }

  const entrySplit = resolveEntryFundingSplitHtg(rewardEntryFunding || {});
  if (entrySplit.provisionalHtg <= 0) {
    return {
      approvedRewardHtg: safeRewardHtg,
      provisionalRewardHtg: 0,
    };
  }
  if (entrySplit.approvedHtg <= 0) {
    return {
      approvedRewardHtg: 0,
      provisionalRewardHtg: safeRewardHtg,
    };
  }

  const provisionalRewardHtg = Math.min(
    safeRewardHtg,
    Math.max(
      0,
      Math.round((safeRewardHtg * entrySplit.provisionalHtg) / Math.max(1, entrySplit.totalHtg))
    )
  );
  const approvedRewardHtg = Math.max(0, safeRewardHtg - provisionalRewardHtg);

  return {
    approvedRewardHtg,
    provisionalRewardHtg,
  };
}

function applyHtgStakeDebit(walletData = {}, { stakeHtg = 0 } = {}) {
  const safeStakeHtg = Math.max(0, safeInt(stakeHtg));
  if (safeStakeHtg <= 0) {
    throw makeHttpError(400, "invalid-stake", "Montant HTG invalide.");
  }

  const beforeApprovedHtg = readApprovedHtg(walletData);
  const beforeProvisionalHtg = readProvisionalHtg(walletData);
  const beforePlayableHtg = Math.max(0, beforeApprovedHtg + beforeProvisionalHtg);
  if (safeStakeHtg > beforePlayableHtg) {
    throw makeHttpError(409, "insufficient-funds", "Solde HTG insuffisant.", {
      requestedAmount: safeStakeHtg,
      approvedHtgAvailable: beforeApprovedHtg,
      provisionalHtgAvailable: beforeProvisionalHtg,
      playableHtg: beforePlayableHtg,
    });
  }

  const beforeWithdrawableHtg = readWithdrawableHtg(walletData, beforeApprovedHtg);
  const consumedProvisionalHtg = Math.min(beforeProvisionalHtg, safeStakeHtg);
  const consumedApprovedHtg = Math.max(0, safeStakeHtg - consumedProvisionalHtg);

  const afterApprovedHtg = Math.max(0, beforeApprovedHtg - consumedApprovedHtg);
  const afterProvisionalHtg = Math.max(0, beforeProvisionalHtg - consumedProvisionalHtg);
  const afterWithdrawableHtg = Math.max(
    0,
    Math.min(afterApprovedHtg, beforeWithdrawableHtg - consumedApprovedHtg)
  );

  const balancesPatch = buildBalancesPatch({
    approvedHtg: afterApprovedHtg,
    provisionalHtg: afterProvisionalHtg,
    withdrawableHtg: afterWithdrawableHtg,
  });

  return {
    balancesPatch,
    afterDoes: safeInt(balancesPatch.doesBalance),
    afterApprovedDoes: safeInt(balancesPatch.doesApprovedBalance),
    afterProvisionalDoes: safeInt(balancesPatch.doesProvisionalBalance),
    afterApprovedHtgAvailable: safeInt(balancesPatch.approvedHtgAvailable),
    afterProvisionalHtgAvailable: safeInt(balancesPatch.provisionalHtgAvailable),
    afterPlayableHtg: safeInt(balancesPatch.playableHtg),
    afterWithdrawableHtg: safeInt(balancesPatch.withdrawableHtg),
    gameEntryFunding: {
      fundingCurrency: "htg",
      convertedHtg: safeStakeHtg,
      nativeHtg: true,
      approvedHtg: consumedApprovedHtg,
      provisionalHtg: consumedProvisionalHtg,
      approvedDoes: htgToDoes(consumedApprovedHtg),
      provisionalDoes: htgToDoes(consumedProvisionalHtg),
      welcomeDoes: 0,
      provisionalSources: consumedProvisionalHtg > 0
        ? [{ amountGourdes: consumedProvisionalHtg, amountDoes: htgToDoes(consumedProvisionalHtg) }]
        : [],
    },
  };
}

function applyHtgRewardCredit(walletData = {}, { rewardHtg = 0, rewardEntryFunding = null } = {}) {
  const safeRewardHtg = Math.max(0, safeInt(rewardHtg));
  const beforeApprovedHtg = readApprovedHtg(walletData);
  const beforeProvisionalHtg = readProvisionalHtg(walletData);
  const beforeWithdrawableHtg = readWithdrawableHtg(walletData, beforeApprovedHtg);

  const rewardSplit = splitRewardAcrossEntryFunding(safeRewardHtg, rewardEntryFunding);
  const afterApprovedHtg = beforeApprovedHtg + rewardSplit.approvedRewardHtg;
  const afterProvisionalHtg = beforeProvisionalHtg + rewardSplit.provisionalRewardHtg;
  const afterWithdrawableHtg = Math.max(
    0,
    Math.min(afterApprovedHtg, beforeWithdrawableHtg + rewardSplit.approvedRewardHtg)
  );

  const balancesPatch = buildBalancesPatch({
    approvedHtg: afterApprovedHtg,
    provisionalHtg: afterProvisionalHtg,
    withdrawableHtg: afterWithdrawableHtg,
  });

  return {
    balancesPatch,
    afterDoes: safeInt(balancesPatch.doesBalance),
    afterApprovedDoes: safeInt(balancesPatch.doesApprovedBalance),
    afterProvisionalDoes: safeInt(balancesPatch.doesProvisionalBalance),
    afterApprovedHtgAvailable: safeInt(balancesPatch.approvedHtgAvailable),
    afterProvisionalHtgAvailable: safeInt(balancesPatch.provisionalHtgAvailable),
    afterPlayableHtg: safeInt(balancesPatch.playableHtg),
    afterWithdrawableHtg: safeInt(balancesPatch.withdrawableHtg),
    rewardSplitHtg: rewardSplit,
  };
}

module.exports = {
  RATE_HTG_TO_DOES,
  applyHtgRewardCredit,
  applyHtgStakeDebit,
  buildBalancesPatch,
  doesToHtg,
  htgToDoes,
  normalizeFundingCurrency,
  readApprovedHtg,
  readProvisionalHtg,
  readWithdrawableHtg,
};
