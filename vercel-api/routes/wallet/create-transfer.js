const { admin, db } = require("../../lib/firebase-admin");
const { requireAuth } = require("../../lib/auth");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { sanitizeEmail } = require("../../lib/deposits");
const { safeInt, sanitizeText } = require("../../lib/safe");
const {
  HTG_TRANSFER_FEE_HTG,
  HTG_TRANSFER_MIN_HTG,
  assertWalletNotFrozen,
  buildTransferHistoryRecord,
  transferHistoryRef,
  transferLedgerRef,
  walletRef,
} = require("../../lib/player-wallet");
const {
  buildBalancesPatch,
  readApprovedHtg,
  readProvisionalHtg,
  readWithdrawableHtg,
} = require("../../lib/wallet-htg");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const uid = String(decoded.uid || "").trim();
    const email = sanitizeEmail(decoded.email || "", 160);
    const payload = await parseJsonBody(req);
    const recipientUid = sanitizeText(payload.recipientUid || "", 160);
    const grossAmountHtg = safeInt(payload.amountHtg);
    const clientRequestId = sanitizeText(payload.requestId || payload.clientRequestId || "", 120);
    const feeHtg = HTG_TRANSFER_FEE_HTG;

    if (!recipientUid || recipientUid === uid) {
      throw makeHttpError(400, "invalid-argument", "Destinataire invalide.");
    }
    if (grossAmountHtg < HTG_TRANSFER_MIN_HTG) {
      throw makeHttpError(400, "invalid-argument", `Montant minimum: ${HTG_TRANSFER_MIN_HTG} HTG.`);
    }
    if (grossAmountHtg <= feeHtg) {
      throw makeHttpError(400, "invalid-argument", "Montant insuffisant pour couvrir les frais.");
    }

    const senderRef = walletRef(uid);
    const recipientRef = walletRef(recipientUid);
    const senderTransfersRef = transferHistoryRef(uid);
    const recipientTransfersRef = transferHistoryRef(recipientUid);
    const transferRef = transferLedgerRef().doc();

    const result = await db.runTransaction(async (tx) => {
      const duplicateQuery = clientRequestId
        ? senderTransfersRef.where("clientRequestId", "==", clientRequestId).limit(1)
        : null;

      const reads = [
        tx.get(senderRef),
        tx.get(recipientRef),
      ];
      if (duplicateQuery) {
        reads.push(tx.get(duplicateQuery));
      }

      const [senderSnap, recipientSnap, duplicateSnap] = await Promise.all(reads);

      if (!senderSnap.exists) {
        throw makeHttpError(404, "sender-not-found", "Compte source introuvable.");
      }
      if (!recipientSnap.exists) {
        throw makeHttpError(404, "recipient-not-found", "Compte destinataire introuvable.");
      }

      const senderData = senderSnap.data() || {};
      const recipientData = recipientSnap.data() || {};
      assertWalletNotFrozen(senderData);

      if (duplicateQuery && duplicateSnap && !duplicateSnap.empty) {
        const existing = duplicateSnap.docs[0]?.data() || {};
        return {
          ok: true,
          duplicate: true,
          transferId: String(existing.transferId || duplicateSnap.docs[0].id || ""),
          grossAmountHtg: safeInt(existing.grossAmountHtg),
          feeHtg: safeInt(existing.feeHtg),
          netAmountHtg: safeInt(existing.netAmountHtg),
          createdAtMs: safeInt(existing.createdAtMs),
          recipient: {
            uid: String(existing.recipientUid || recipientUid),
            username: String(existing.recipientUsername || ""),
            name: String(existing.recipientName || ""),
          },
        };
      }

      const senderApprovedBefore = readApprovedHtg(senderData);
      const senderProvisional = readProvisionalHtg(senderData);
      const senderWithdrawableBefore = readWithdrawableHtg(senderData, senderApprovedBefore);
      if (senderApprovedBefore < grossAmountHtg) {
        throw makeHttpError(409, "insufficient-funds", "Solde HTG approuve insuffisant.", {
          approvedHtgAvailable: senderApprovedBefore,
          requestedAmount: grossAmountHtg,
        });
      }

      const recipientApprovedBefore = readApprovedHtg(recipientData);
      const recipientProvisional = readProvisionalHtg(recipientData);
      const recipientWithdrawableBefore = readWithdrawableHtg(recipientData, recipientApprovedBefore);
      const netAmountHtg = grossAmountHtg - feeHtg;
      const nowMs = Date.now();

      const senderBalances = buildBalancesPatch({
        approvedHtg: senderApprovedBefore - grossAmountHtg,
        provisionalHtg: senderProvisional,
        withdrawableHtg: Math.max(0, senderWithdrawableBefore - grossAmountHtg),
      });
      const recipientBalances = buildBalancesPatch({
        approvedHtg: recipientApprovedBefore + netAmountHtg,
        provisionalHtg: recipientProvisional,
        withdrawableHtg: recipientWithdrawableBefore + netAmountHtg,
      });

      const senderTransferSentHtgTotal = safeInt(senderData.transferSentHtgTotal) + grossAmountHtg;
      const senderTransferFeePaidHtgTotal = safeInt(senderData.transferFeePaidHtgTotal) + feeHtg;
      const recipientTransferReceivedHtgTotal = safeInt(recipientData.transferReceivedHtgTotal) + netAmountHtg;
      const senderIdentity = {
        uid,
        email: email || String(senderData.email || ""),
        username: senderData.username || "",
        name: senderData.name || senderData.displayName || "",
      };
      const recipientIdentity = {
        uid: recipientUid,
        email: String(recipientData.email || ""),
        username: recipientData.username || "",
        name: recipientData.name || recipientData.displayName || "",
      };

      const senderRecord = buildTransferHistoryRecord({
        transferId: transferRef.id,
        direction: "sent",
        sender: senderIdentity,
        recipient: recipientIdentity,
        grossAmountHtg,
        feeHtg,
        netAmountHtg,
        clientRequestId,
        senderApprovedBefore,
        senderApprovedAfter: safeInt(senderBalances.approvedHtgAvailable),
        recipientApprovedBefore,
        recipientApprovedAfter: safeInt(recipientBalances.approvedHtgAvailable),
        createdAtMs: nowMs,
      });

      const recipientRecord = buildTransferHistoryRecord({
        direction: "received",
        transferId: transferRef.id,
        sender: senderIdentity,
        recipient: recipientIdentity,
        grossAmountHtg,
        feeHtg,
        netAmountHtg,
        clientRequestId,
        senderApprovedBefore,
        senderApprovedAfter: safeInt(senderBalances.approvedHtgAvailable),
        recipientApprovedBefore,
        recipientApprovedAfter: safeInt(recipientBalances.approvedHtgAvailable),
        createdAtMs: nowMs,
      });

      tx.set(transferRef, {
        ...senderRecord,
        status: "completed",
        visibleTo: "both",
        type: "peer_transfer",
        createdByUid: uid,
        clientRequestId: clientRequestId || transferRef.id,
      }, { merge: true });
      tx.set(senderTransfersRef.doc(transferRef.id), {
        ...senderRecord,
        status: "completed",
        visibleTo: "sender",
      }, { merge: true });
      tx.set(recipientTransfersRef.doc(transferRef.id), {
        ...recipientRecord,
        status: "completed",
        visibleTo: "recipient",
      }, { merge: true });
      tx.set(senderRef, {
        uid,
        email: email || String(senderData.email || ""),
        ...senderBalances,
        transferSentHtgTotal: senderTransferSentHtgTotal,
        transferFeePaidHtgTotal: senderTransferFeePaidHtgTotal,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      tx.set(recipientRef, {
        uid: recipientUid,
        email: String(recipientData.email || ""),
        ...recipientBalances,
        transferReceivedHtgTotal: recipientTransferReceivedHtgTotal,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        transferId: transferRef.id,
        grossAmountHtg,
        feeHtg,
        netAmountHtg,
        senderApprovedHtgAvailable: safeInt(senderBalances.approvedHtgAvailable),
        recipientApprovedHtgAvailable: safeInt(recipientBalances.approvedHtgAvailable),
        createdAtMs: nowMs,
        clientRequestId: clientRequestId || transferRef.id,
        recipient: {
          uid: recipientUid,
          username: senderRecord.recipientUsername,
          name: senderRecord.recipientName,
        },
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible d'envoyer le transfert.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
