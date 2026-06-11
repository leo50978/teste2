export const SUPPORT_WHATSAPP_PHONE = "50940507232";
export const SUPPORT_WHATSAPP_LABEL = `+${SUPPORT_WHATSAPP_PHONE}`;

export function buildSupportWhatsAppUrl(message = "") {
  const base = `https://wa.me/${SUPPORT_WHATSAPP_PHONE}`;
  const text = String(message || "").trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
