import { Alert, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * How a customer reaches a human.
 *
 * A failed top-up is this product's entire customer-service surface, and the
 * app had no way to raise one — "Help & support" was a row that did nothing.
 * Both channels are build-time config so a market can point them wherever its
 * support actually sits; WhatsApp is only offered when a number is set, since
 * an unset number would open a chat with nobody.
 */
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? 'support@tofee.app';
// E.164 digits, no plus — what wa.me wants.
export const SUPPORT_WHATSAPP = (process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP ?? '').replace(/\D/g, '');

export const hasWhatsApp = () => SUPPORT_WHATSAPP.length >= 8;

/**
 * When no app can take the URL — a phone with no mail account, or WhatsApp
 * not installed — the tap must still leave the customer with something: the
 * address and the reference, copyable. Silence here reads as a broken button.
 */
const fallback = (t, address, message) =>
  Alert.alert(t('support.fallbackTitle'), t('support.fallbackBody', { address, message }), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('support.copyDetails'),
      onPress: () => Clipboard.setStringAsync(`${address}\n${message}`).catch(() => {}),
    },
  ]);

const open = async (t, url, address, message) => {
  try {
    const ok = await Linking.canOpenURL(url);
    if (!ok) return fallback(t, address, message);
    await Linking.openURL(url);
  } catch {
    fallback(t, address, message);
  }
};

/** Opens WhatsApp to the support line, with the order reference pre-filled. */
export const openWhatsApp = (t, message) =>
  open(t, `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`, `+${SUPPORT_WHATSAPP}`, message);

/** Opens the mail app with subject and body pre-filled. */
export const openEmail = (t, subject, body) =>
  open(
    t,
    `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    SUPPORT_EMAIL,
    `${subject} — ${body}`,
  );
