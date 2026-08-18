// TOPUP — airtime, data & eSIM purchase app (Expo / React Native)
// Faithful port of the HTML design prototype (Modernist design system).
// Navigation is a simple screen state machine; swap for react-navigation if preferred.
// Tab destinations live in ./screens; shared primitives in ./ui; catalogue in ./data.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StatusBar, Alert, Linking, KeyboardAvoidingView, Platform, BackHandler } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { useFonts, Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { useTranslation } from 'react-i18next';
import './i18n';
import { loadStoredLanguage } from './i18n';

import { TOURS, TourOverlay, TourProvider, TourTarget, tourFor, tourStoreKey } from './tour';
import { C, F, fmt, fmtN, airtimeBonusFor, canonicalMsisdn, countryFromCanonical, detect, flagFor, navItems, networksFor, prefixFor, toE164, toNational, PAYABLE_COUNTRIES, TAB_SCREENS, SEEN_ONBOARDING } from '@topup/core';
import {
  ApiError,
  catalogue as fetchCatalogue,
  features as fetchFeatures,
  esimPlans as fetchEsimPlans,
  loadSession,
  me,
  myEsims,
  myOrders,
  provisionPeer,
  requestCode,
  signOut as apiSignOut,
  startCheckout,
  verifyCode,
  vpnServers,
  waitForOrder,
  paymentMethods,
} from './api';
import { detectCountry, deviceCountry, formatMoney, methodsFor } from './payment';
import { hasWhatsApp, openEmail, openWhatsApp, SUPPORT_EMAIL } from './support';
import { ProviderBadge, ProviderLogo } from './providers';
import { Btn, BackHeader, EmptyState, Kicker, Tag, PackGrid, PhoneInput, SummaryRow, StatusText, Toggle2, TabBar, Brand, orderTone, st } from './ui';
import { NoEsim, NoLocations, NoResults, Offline } from './illustrations';
import Onboarding from './screens/Onboarding';
import HomeScreen from './screens/HomeScreen';
import HistoryScreen from './screens/HistoryScreen';
import RewardsScreen from './screens/RewardsScreen';
import ProfileScreen from './screens/ProfileScreen';
import AmountScreen from './screens/AmountScreen';
import VpnPlansScreen from './screens/VpnPlansScreen';
import VpnLocationsScreen from './screens/VpnLocationsScreen';
import VpnSetupScreen from './screens/VpnSetupScreen';
import VpnScreen from './screens/VpnScreen';
import VpnRecoverScreen from './screens/VpnRecoverScreen';
import LanguageScreen from './screens/LanguageScreen';
import { EsimDetailScreen, EsimInstallCard, EsimListScreen } from './screens/EsimScreens';

// Which locations have been exported into WireGuard on this handset. Local by
// nature: the server knows the peer exists, not whether the file was imported.
const VPN_ADDED_STORE = 'topup.vpn.added';

/**
 * The last purchase that went through, kept for one-tap repeat.
 *
 * This is what an account is actually for in a product bought two to four times
 * a month: not history, not deal notifications — removing the six taps the
 * customer already made once. Stored locally so it works before sign-in and
 * survives a signed-out session.
 */
const LAST_BUY_STORE = 'topup.lastBuy';

/**
 * The network the account's own line is on.
 *
 * `/me` does not carry it, and the wallet a customer pays from is not reliably
 * the SIM they are topping up. So it is learned from what they tell us: the
 * network they last topped their own line up with, or the one detected from
 * their number at sign-in. Used to pre-select the network on "for myself" so
 * a repeat customer never has to pick it again — and cleared at sign-out,
 * since it belongs to the account, not the handset.
 */
const MY_CARRIER_STORE = 'topup.myCarrier';

/**
 * Where the country pickers start.
 *
 * The launch market, not the handset's region. A phone bought abroad or set to
 * another locale reported the wrong country, and the picker being quietly wrong
 * is how a login code goes to someone else's number. The device is used only as
 * a hint, and only when it names a market we can actually serve.
 */
const LAUNCH_COUNTRY = process.env.EXPO_PUBLIC_LAUNCH_COUNTRY ?? 'BF';
const launchCountry = (() => {
  const device = deviceCountry();
  return device && PAYABLE_COUNTRIES.some((c) => c.code === device) ? device : LAUNCH_COUNTRY;
})();

/**
 * A catalogue product as the pack grid wants it.
 *
 * `id` is carried through because checkout identifies the purchase by product,
 * never by price — the server re-reads the price from its own row, so a stale
 * or tampered client cannot change what is charged.
 */
const toPack = (p) => ({
  id: p.id,
  n: p.name,
  v: p.terms,
  p: p.price,
  b: p.bonus,
  days: p.days,
  carrier: p.network,
});

/**
 * A free amount of airtime as the pay step wants it.
 *
 * `custom` is what tells checkout to send an amount and a network instead of a
 * product id; the server rebuilds the same shape on its side, so a 1 500 F
 * custom top-up is priced, fee'd and delivered exactly like a 1 500 F pack.
 */
const customPack = (amount, t) => ({
  custom: true,
  n: fmtN(amount) + ' FCFA',
  v: t('packs.airtimeCredit'),
  p: amount,
  b: airtimeBonusFor(amount),
});

/**
 * An order row as the lists want it. Keeps the raw order too — the detail
 * screen prints reference, dates and failure reason straight from it.
 */
const toHistoryRow = (o, t, lang) => ({
  id: o.id,
  desc: o.detail,
  meta: `${new Date(o.createdAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB')} · ${String(o.product).toUpperCase()}`,
  amount: fmt(o.amount),
  code: o.status,
  status: t(`common.orderStatus.${o.status}`, String(o.status).toUpperCase()),
  raw: o,
});

function TopUp() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts({ Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold });
  const [screen, setScreen] = useState('onboarding');
  const [authFrom, setAuthFrom] = useState('onboarding'); // where "back" from sign-in returns to
  const [service, setService] = useState('data');
  const [forSelf, setForSelf] = useState(true);
  const [phone, setPhone] = useState('');
  const [myNumber, setMyNumber] = useState(''); // the account's own MSISDN, for "top up myself"
  const [myCarrier, setMyCarrier] = useState(null); // network of the account's own line, when known
  const [carrier, setCarrier] = useState('Orange');
  const [pack, setPack] = useState(null);
  const [pay, setPay] = useState(null); // method id, chosen from what the region supports
  const [paying, setPaying] = useState(false);
  const [points, setPoints] = useState(0);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(null); // error code, or null
  const [verifying, setVerifying] = useState(false);
  // When the code may be re-requested. Twilio rate-limits sends, and a
  // customer hammering RESEND is the fastest way to lock themselves out.
  const [resendAt, setResendAt] = useState(0);
  const [email, setEmail] = useState(''); // where VPN configs get delivered
  const [esimCountry, setEsimCountry] = useState('Côte d’Ivoire');
  const [countrySearch, setCountrySearch] = useState('');
  const [esims, setEsims] = useState([]); // profiles the account owns, from /me/esims
  const [viewEsim, setViewEsim] = useState(null); // the one open on the detail screen
  const [topUpIccid, setTopUpIccid] = useState(null); // set when a plan is bought for an existing profile
  const [history, setHistory] = useState([]);
  // True while /me/orders is in flight, so an empty list can say "loading"
  // rather than asserting "no purchases yet" before the answer is in.
  const [accountLoading, setAccountLoading] = useState(false);
  const [viewOrder, setViewOrder] = useState(null); // row open on the order screen
  const [orderFrom, setOrderFrom] = useState('history'); // where its ← returns to
  const [booted, setBooted] = useState(false);
  const [vpn, setVpn] = useState(null); // active VPN subscription, from /me
  const [vpnLoc, setVpnLoc] = useState(null); // location being installed (setup step 02)
  const [vpnConfig, setVpnConfig] = useState(null); // the peer config, returned once
  const [vpnAdded, setVpnAdded] = useState([]); // location codes exported on this phone
  const [vpnFresh, setVpnFresh] = useState(false); // show the post-purchase banner once
  const [vpnBusy, setVpnBusy] = useState(false);
  const [recoverFrom, setRecoverFrom] = useState('vpnPlans'); // where the recovery page returns to
  // Server-owned data. Null until loaded so screens can tell "empty" from "not yet".
  const [cat, setCat] = useState(null); // /catalogue
  // Distinct from `cat === null`: that is "not yet", this is "asked and failed".
  const [catFailed, setCatFailed] = useState(false);
  // Every feature on until the worker says otherwise: a failed or slow lookup
  // should not blank the home screen, and the worker enforces the truth anyway.
  const [features, setFeatures] = useState(null);
  const [locations, setLocations] = useState([]); // /servers
  const [esimPlanList, setEsimPlanList] = useState([]);
  // In flight, rather than inferred from an empty list: a destination that
  // genuinely has no plans is not the same as one still loading, and inferring
  // it left an empty list spinning for ever.
  const [esimPlansLoading, setEsimPlansLoading] = useState(false);
  const [payError, setPayError] = useState(null);
  const [order, setOrder] = useState(null); // in-flight purchase
  /**
   * What the success screen prints. Captured at the moment the order is
   * confirmed — reference, what was actually charged, the fee — rather than
   * re-derived from `pack.p`, which is the list price and not the figure on
   * the customer's wallet statement.
   */
  const [receipt, setReceipt] = useState(null);
  const [copiedRef, setCopiedRef] = useState(false);
  // How long the customer has been waiting on the wallet, for the panel copy.
  const [waitStart, setWaitStart] = useState(null);
  const [nowTick, setNowTick] = useState(0);
  // Cancels the poll: on STOP WAITING, or if the pay screen is somehow left.
  const payAbort = React.useRef(null);
  // The screen at the moment a long await returns — a purchase must not
  // teleport someone who is elsewhere by then.
  const screenRef = React.useRef('onboarding');
  const [quote, setQuote] = useState(null); // what this market is actually charged
  const [dialable, setDialable] = useState([]); // wallets payable by dialling
  const [lastBuy, setLastBuy] = useState(null); // the repeatable purchase
  const [copiedUssd, setCopiedUssd] = useState(false);
  // Which tour is running, and which have been finished. `seenTours` is null
  // until storage resolves, so a tour cannot flash open for someone who has
  // already dismissed it.
  const [tourOpen, setTourOpen] = useState(null);
  const [seenTours, setSeenTours] = useState(null);

  const reloadCatalogue = React.useCallback(async () => {
    setCatFailed(false);
    setCat(null);
    const lang = i18n.language?.slice(0, 2) || 'en';
    const [data, servers] = await Promise.all([
      fetchCatalogue(lang).catch(() => null),
      vpnServers().catch(() => null),
    ]);
    if (data) setCat(data);
    else setCatFailed(true);
    if (servers) setLocations(servers.servers ?? []);
  }, [i18n.language]);

  /**
   * The country of the number being signed in with, and therefore of the wallet
   * that pays. Seeded from the handset's region, then owned by the picker —
   * device locale is wrong for anyone abroad or on a second-hand phone.
   */
  const [dialCountry, setDialCountry] = useState(launchCountry);
  // Where a top-up is delivered, which need not be where it is paid from.
  const [recipientCountry, setRecipientCountry] = useState(launchCountry);

  /**
   * Where the *buyer* is, which is what decides the rail.
   *
   * Deliberately not derived from `phone`: that field holds whoever the order
   * is for — a friend's line for a top-up, nothing at all for an eSIM bound for
   * China. The picker wins over everything, since it is the one signal the
   * customer actually stated.
   *
   * Declared up here because the quote effect depends on it, and every hook has
   * to run before the font/boot guard returns.
   */
  // A signed-in account's own number is canonical E.164 and names its country
  // exactly; the picker may simply be sitting on the launch default, which the
  // customer never touched. So the account wins once we have one.
  const country = detectCountry({
    chosen: countryFromCanonical(myNumber) ?? dialCountry,
    msisdn: myNumber,
  });

  /**
   * Which services this market has switched on.
   *
   * Placed after `country` rather than beside the catalogue load, because it
   * depends on it — and `country` is declared below the boot guard. Reading it
   * earlier would be a use-before-initialisation crash on the first render.
   *
   * A failed lookup leaves `features` null, which reads as "everything on":
   * the worker refuses disabled services on its own, so the cost of guessing
   * wrong is a service that appears and then declines, rather than a home
   * screen that silently loses half its tiles because one request failed.
   */
  useEffect(() => {
    let cancelled = false;
    fetchFeatures(country)
      .then((r) => { if (!cancelled) setFeatures(r?.features ?? null); })
      .catch(() => { if (!cancelled) setFeatures(null); });
    return () => { cancelled = true; };
  }, [country]);

  /**
   * Opens a feature's tour the first time that feature is used.
   *
   * At the point of the task, not at first launch: someone opening the airtime
   * form has a question about this form, which is exactly when an explanation
   * is worth reading and exactly when it is remembered.
   *
   * Delayed a beat because steps are measured against real views — pointing at
   * a screen mid-transition measures nothing and drops every step.
   */
  useEffect(() => {
    if (!seenTours) return;
    const name = tourFor(screen, service);
    if (!name || seenTours[name]) return;
    const id = setTimeout(() => setTourOpen(name), 350);
    return () => clearTimeout(id);
  }, [seenTours, screen, service]);

  const endTour = React.useCallback(() => {
    setTourOpen((name) => {
      if (name) {
        setSeenTours((prev) => ({ ...prev, [name]: true }));
        AsyncStorage.setItem(tourStoreKey(name), '1').catch(() => {});
      }
      return null;
    });
  }, []);

  useEffect(() => { screenRef.current = screen; }, [screen]);

  /**
   * Android hardware back.
   *
   * The app is a screen state machine, so without this the system button
   * left the app from every screen — including mid-payment. The listener is
   * registered once and dispatches through a ref, which the render below
   * keeps pointed at a closure over the current state.
   */
  const onHardwareBack = React.useRef(() => false);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => onHardwareBack.current());
    return () => sub.remove();
  }, []);

  // A one-second tick while a wallet approval is pending, so the panel can
  // say how long it has been — silence past thirty seconds reads as a hang.
  useEffect(() => {
    if (!waitStart) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waitStart]);

  // The resend countdown needs a clock while the OTP screen is up.
  useEffect(() => {
    if (screen !== 'otp') return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [screen]);

  // Leaving the pay screen mid-poll (Android back, a future deep link) must
  // stop the poll: otherwise it resolves minutes later and pushes a success
  // or error onto whatever the customer is doing by then.
  useEffect(() => {
    if (screen !== 'pay' && payAbort.current) payAbort.current.abort();
  }, [screen]);

  /** True unless the market has explicitly switched this off. */
  const featureOn = React.useCallback((name) => features?.[name] !== false, [features]);

  /**
   * What this market will actually be charged.
   *
   * Catalogue prices are XOF, but a customer paying by card settles in their
   * own currency — showing FCFA on the payment step would name a figure that
   * never appears on their statement. The server owns the conversion, so it is
   * asked rather than approximated here.
   */
  useEffect(() => {
    if (screen !== 'pay' || !(pack?.id || pack?.custom)) { setQuote(null); return; }
    let alive = true;
    paymentMethods(country, pack.id, pack.custom ? pack.p : undefined)
      .then((r) => {
        if (!alive) return;
        setQuote(r.quote ?? null);
        setDialable(r.dialable ?? []);
      })
      .catch(() => alive && setQuote(null));
    return () => { alive = false; };
  }, [screen, pack?.id, pack?.custom, pack?.p, country]);

  /**
   * Pulls everything the signed-in account owns.
   *
   * The subscription, orders and points are all server state now — the app
   * holds no authoritative copy, so a purchase made elsewhere, an expiry, or a
   * refund shows up here without the app having to guess.
   */
  const refreshAccount = React.useCallback(async () => {
    setAccountLoading(true);
    const [account, orders, ownedEsims] = await Promise.all([
      // A 401 means the stored session is dead (expired, or signed out on
      // another handset). api.js has already dropped the token; the screen
      // has to follow, or the customer sits on a home page with no account.
      me().catch((e) => (e instanceof ApiError && e.status === 401 ? 'unauthorized' : null)),
      myOrders(i18n.language?.slice(0, 2)).catch(() => null),
      myEsims().catch(() => null),
    ]).finally(() => setAccountLoading(false));
    if (account === 'unauthorized') {
      setMyNumber('');
      setHistory([]);
      setPoints(0);
      setAuthFrom('welcome');
      setScreen('welcome');
      return;
    }
    if (account) {
      setMyNumber(account.msisdn || '');
      // National form for the field: the E.164 digits under a picker already
      // showing the dialling code read as a doubled prefix.
      setPhone((p) => p || (account.msisdn ? toNational(account.msisdn, countryFromCanonical(account.msisdn)) : ''));
      if (account.email) setEmail((e) => e || account.email);
      setVpn(
        account.subscriptionActive
          ? {
              expiresAt: account.subExpiresAt,
              email: account.email,
              peers: account.peers ?? [],
              deviceLimit: account.deviceLimit,
            }
          : null,
      );
    }
    if (ownedEsims) setEsims(ownedEsims.esims ?? []);
    if (orders) {
      setPoints(orders.points ?? 0);
      setHistory((orders.orders ?? []).map((o) => toHistoryRow(o, t, i18n.language?.slice(0, 2))));
    }
  }, [t]);

  // Catalogue and locations are public, so they load before sign-in — the
  // plans and packs are browsable without an account.
  //
  // They are *started* here but not *awaited*: boot used to block on both,
  // which on a slow connection meant seconds of blank frame after the splash.
  // Every screen that needs them already distinguishes "not yet" from "empty",
  // so they can arrive whenever they arrive.
  useEffect(() => {
    let alive = true;
    const lang = i18n.language?.slice(0, 2) || 'en';
    fetchCatalogue(lang)
      .then((data) => { if (alive) setCat(data); })
      .catch(() => { if (alive) setCatFailed(true); });
    vpnServers()
      .then((r) => { if (alive) setLocations(r.servers ?? []); })
      .catch(() => {});
    Promise.all([
      loadStoredLanguage(),
      AsyncStorage.multiGet([SEEN_ONBOARDING, VPN_ADDED_STORE, LAST_BUY_STORE, MY_CARRIER_STORE, ...Object.keys(TOURS).map(tourStoreKey)]).catch(() => []),
      loadSession().catch(() => null),
    ]).then(async ([, pairs, token]) => {
      if (!alive) return;
      const stored = Object.fromEntries(pairs || []);
      if (stored[SEEN_ONBOARDING]) { setScreen('welcome'); setAuthFrom('welcome'); }
      try {
        setVpnAdded(JSON.parse(stored[VPN_ADDED_STORE] || '[]'));
        if (stored[LAST_BUY_STORE]) setLastBuy(JSON.parse(stored[LAST_BUY_STORE]));
        if (stored[MY_CARRIER_STORE]) setMyCarrier(stored[MY_CARRIER_STORE]);
        setSeenTours(
          Object.fromEntries(Object.keys(TOURS).map((n) => [n, Boolean(stored[tourStoreKey(n)])])),
        );
      } catch {
        // Corrupt record — start clean rather than block launch.
      }
      // A stored session skips sign-in on relaunch. The account refresh is
      // not awaited either: home renders at once with its lists in the
      // "loading" state, and fills in when /me/orders answers. A dead token is
      // cleared by the 401 handler, at which point the app is signed out.
      if (token) {
        setScreen('home');
        refreshAccount().catch(() => {});
      }
      if (alive) setBooted(true);
    });
    return () => { alive = false; };
  }, [refreshAccount]);

  // Which locations this handset has exported is genuinely local — the server
  // knows the peers exist, not which ones made it into WireGuard here.
  useEffect(() => {
    if (!booted) return;
    AsyncStorage.setItem(VPN_ADDED_STORE, JSON.stringify(vpnAdded)).catch(() => {});
  }, [booted, vpnAdded]);

  /**
   * Networks a top-up can be delivered to in the recipient's country.
   *
   * The known operator list first, then anything the catalogue actually sells
   * into that market that the list has missed — a distributor can add a
   * network before we do. Prefix hints only appear for markets whose numbering
   * plan we hold; elsewhere the customer simply picks.
   *
   * Declared above the boot guard because the clamp effect below depends on
   * it, and hooks have to run on every render.
   */
  const networkOptions = React.useMemo(() => {
    const known = networksFor(recipientCountry);
    const sold = [...(cat?.airtime ?? []), ...(cat?.data ?? [])]
      .filter((p) => p.country === recipientCountry && p.network)
      .map((p) => p.network);
    const names = [...new Set([...known, ...sold])];
    return names.map((name) => ({ name, prefix: prefixFor(recipientCountry, name) }));
  }, [recipientCountry, cat]);

  /**
   * Keeps the chosen network inside what the recipient's country offers.
   *
   * `carrier` outlives the screen that set it — sign-in guesses one from the
   * account's own number, a previous purchase leaves another — so by the time
   * the recipient form opens it can name a network this country does not
   * have. Nothing was highlighted, CONTINUE still worked, and the pack list
   * came up empty. Now: keep it if it is offered, take the number's own hint
   * if that is, take the only option when there is one, and otherwise clear
   * it so the customer has to choose. Never the first in the list by default —
   * credit sent to the wrong network cannot be recovered.
   */
  useEffect(() => {
    if (screen !== 'recipient') return;
    if (networkOptions.some((c) => c.name === carrier)) return;
    const guessed = detect(phone, recipientCountry);
    if (guessed && networkOptions.some((c) => c.name === guessed)) setCarrier(guessed);
    else if (networkOptions.length === 1) setCarrier(networkOptions[0].name);
    else setCarrier(null);
  }, [screen, recipientCountry, networkOptions, carrier, phone]);

  if (!fontsLoaded || !booted) return null;

  const carrierOk = networkOptions.some((c) => c.name === carrier);

  /**
   * Shared tail of both wallet panels: the reference (what support asks for),
   * how long we have been waiting, and a way to stop without leaving. Stopping
   * ends the poll only — the order stands and turns up in History.
   */
  /**
   * Where the system back button goes from each screen — the same targets the
   * on-screen ← uses, so the two never disagree. `null` means "let the OS
   * handle it" (leave the app), which is only right on the entry screens and
   * the home tab; every other tab goes home first.
   */
  const hardwareBackTarget = () => {
    switch (screen) {
      case 'onboarding':
      case 'welcome':
      case 'home':
        return null;
      case 'history':
      case 'rewards':
      case 'profile':
      case 'recipient':
      case 'success':
        return 'home';
      case 'login':
        return authFrom;
      case 'otp':
        return 'login';
      case 'packs':
        return 'recipient';
      case 'amount':
        return 'packs';
      case 'pay':
        // Locked while a payment is being confirmed, like the on-screen ←.
        return paying ? 'stay' : isVpn ? 'vpnPlans' : service === 'esim' ? 'esimPlans' : 'packs';
      case 'esim':
      case 'language':
      case 'vpn':
        return 'profile';
      case 'order':
        return orderFrom;
      case 'esimCountry':
      case 'esimDetail':
        return 'esim';
      case 'esimPlans':
        return topUpIccid ? 'esim' : 'esimCountry';
      case 'vpnPlans':
        return vpn ? 'vpn' : 'home';
      case 'vpnLocations':
        setVpnFresh(false);
        return 'vpn';
      case 'vpnSetup':
        return 'vpnLocations';
      case 'vpnRecover':
        return recoverFrom;
      default:
        return 'home';
    }
  };
  onHardwareBack.current = () => {
    if (tourOpen) { endTour(); return true; }
    const target = hardwareBackTarget();
    if (target === null) return false;
    if (target !== 'stay') setScreen(target);
    return true;
  };

  /** Stops polling. The order stands; it will show in History either way. */
  const stopWaiting = () => payAbort.current?.abort();
  const waitSeconds = waitStart ? Math.max(0, Math.floor(((nowTick || Date.now()) - waitStart) / 1000)) : 0;
  const waitingFooter = order?.orderId ? (
    <View style={{ borderTopWidth: 1, borderColor: C.rule, paddingTop: 10, gap: 6 }}>
      <View style={st.rowBetween}>
        <Text style={[st.subText, { fontFamily: F.semi }]}>{t('pay.orderRef', { ref: order.orderId })}</Text>
        <Text style={st.subText}>{t('pay.waitingFor', { seconds: waitSeconds })}</Text>
      </View>
      <Btn variant="ghost" label={t('pay.stopWaiting')} onPress={stopWaiting} style={{ alignSelf: 'flex-start' }} />
    </View>
  ) : null;

  const momoName = carrier === 'MTN' ? 'MTN MoMo' : carrier ? carrier + ' Money' : '';
  const payment = methodsFor(country, dialable);
  // Default to the first method the region actually offers.
  const method = payment.methods.find((m) => m.id === pay) ?? payment.methods[0] ?? null;
  const isMomo = method?.kind === 'momo' || method?.kind === 'dial';
  const isDial = method?.kind === 'dial';
  const earnPts = pack ? Math.floor(pack.p / 100) : 0;
  const digits = phone.replace(/\D/g, '');
  const isVpn = service === 'vpn';
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  /**
   * Runs a real purchase.
   *
   * The server decides the rail from the country and re-reads the price from
   * its own catalogue, so nothing here can change what is charged. Mobile money
   * resolves when the customer approves the prompt on their handset; card rails
   * hand off to a browser. Either way the outcome is read back from
   * GET /checkout/:orderId rather than assumed from the redirect.
   */
  const finishPay = async () => {
    const renewing = isVpn && !!vpn;
    // Compared in canonical form: the field holds a national number now, and
    // the account's is E.164 digits — a raw string compare would call the
    // customer's own line "someone else" and send it as a recipient.
    const toSelf = !!myNumber && canonicalMsisdn(phone, recipientCountry) === myNumber;
    setPaying(true);
    setPayError(null);
    setReceipt(null);
    const controller = new AbortController();
    payAbort.current = controller;
    try {
      const started = await startCheckout({
        productId: pack.custom ? undefined : pack.id,
        amount: pack.custom ? pack.p : undefined,
        network: pack.custom ? carrier : undefined,
        iccid: service === 'esim' && topUpIccid ? topUpIccid : undefined,
        country,
        // The wallet charged is always the buyer's own. Sending the recipient's
        // number here would push the approval prompt to them instead.
        msisdn: isMomo ? myNumber || phone : undefined,
        // Only meaningful when topping up someone else's line.
        recipientMsisdn: !isVpn && service !== 'esim' && !toSelf ? phone : undefined,
        // The picker's value: delivery needs the recipient's dialling code, and
        // it is not always the buyer's.
        recipientCountry,
        email: emailOk ? email.trim() : undefined,
        instrument: isDial ? 'dial' : undefined,
        carrier: isDial ? method.carrier : undefined,
      });
      setOrder(started);
      setWaitStart(Date.now());

      if (started.action === 'redirect' && started.url) {
        await WebBrowser.openBrowserAsync(started.url).catch(() => {});
      }

      const final = await waitForOrder(started.orderId, { signal: controller.signal });
      if (final.status !== 'delivered') {
        setPayError(final.failureReason || `order_${final.status}`);
        // The order exists whatever happened to it; the customer's history is
        // where they will look for it, so it must be current before they do.
        await refreshAccount().catch(() => {});
        return;
      }

      // Points, history and subscription all come back from the server rather
      // than being incremented locally, so the app cannot drift from the books.
      await refreshAccount();

      // The quote the order was placed on is what the wallet took. Fall back
      // to the screen's quote, then the list price, only if the response had
      // none — an older worker, or a zero-fee product.
      const q = started.quote ?? quote ?? null;
      setReceipt({
        orderId: started.orderId,
        service,
        to: isVpn ? null : service === 'esim' ? null : (toE164(phone, recipientCountry) ?? phone),
        network: isVpn ? null : carrier,
        pack: pack?.n ?? '—',
        currency: q?.currency ?? 'XOF',
        amount: q?.amount ?? pack?.p ?? 0,
        amountXof: q?.amountXof ?? pack?.p ?? 0,
        fee: q?.fee ?? 0,
        feeXof: q?.feeXof ?? 0,
        feePct: q?.feePct ?? 0,
        createdAt: Date.now(),
        // The provisioned profile, when this was an eSIM: the success screen
        // shows the real QR and install links from it.
        esim: final.esim ?? null,
      });

      // Remembered only on success, and only for the things worth repeating —
      // a VPN plan or an eSIM is not a habitual purchase.
      if (!isVpn && service !== 'esim' && (pack?.id || pack?.custom)) {
        const repeat = {
          productId: pack.custom ? null : pack.id,
          customAmount: pack.custom ? pack.p : null,
          label: pack.n,
          price: pack.p,
          service,
          carrier,
          recipient: phone,
          recipientCountry,
          methodId: method?.id ?? null,
        };
        setLastBuy(repeat);
        AsyncStorage.setItem(LAST_BUY_STORE, JSON.stringify(repeat)).catch(() => {});
        // A successful top-up of their own line is the best evidence of which
        // network it is on; remember it so "for myself" pre-selects it.
        if (toSelf && carrier) {
          setMyCarrier(carrier);
          AsyncStorage.setItem(MY_CARRIER_STORE, carrier).catch(() => {});
        }
      }

      setOrder(null);
      // Only move on if the customer is still here to be moved. Back is
      // disabled while paying, so this is belt-and-braces for the paths that
      // bypass it — but a purchase surfacing on the wrong screen is exactly
      // the failure worth two lines.
      if (screenRef.current !== 'pay') return;
      if (isVpn) {
        // Renewing changes nothing they have to re-scan, so don't send them
        // back through setup — only a first purchase needs that.
        setVpnFresh(!renewing);
        setScreen(renewing ? 'vpn' : 'vpnLocations');
      } else {
        setScreen('success');
      }
    } catch (e) {
      setPayError(e instanceof ApiError ? e.code : 'network_error');
      // Cancelled or timed out is not "nothing happened" — the order may still
      // complete. Pull history so a pending row is there when they look.
      if (e instanceof ApiError && (e.code === 'cancelled' || e.code === 'timeout')) {
        await refreshAccount().catch(() => {});
      }
    } finally {
      payAbort.current = null;
      setWaitStart(null);
      setPaying(false);
    }
  };

  // Sign-out must actually clear the session: the VPN record is persisted, so
  // leaving it behind would hand the next person on this handset a paid
  // subscription. Configs stay recoverable by email from the welcome screen.
  const signOut = () => {
    Alert.alert(t('profile.signOutTitle'), t('profile.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.signOutConfirm'),
        style: 'destructive',
        onPress: async () => {
          // Revoke server-side first: dropping only the local copy would leave
          // a working token behind on a handset being handed on.
          await apiSignOut().catch(() => {});
          setVpn(null);
          setVpnAdded([]);
          setVpnLoc(null);
          setVpnConfig(null);
          setVpnFresh(false);
          setEsims([]);
          setHistory([]);
          setPoints(0);
          setPhone('');
          setCarrier('Orange');
          setMyCarrier(null);
          AsyncStorage.removeItem(MY_CARRIER_STORE).catch(() => {});
          setEmail('');
          setPack(null);
          setService('data');
          setPay(null);
          setOtp('');
          setOtpError(false);
          setAuthFrom('welcome');
          setScreen('welcome');
        },
      },
    ]);
  };

  const doPay = () => {
    if (paying || !pack || (isVpn && !emailOk)) return;
    finishPay();
  };

  /**
   * Requests an SMS code — from the sign-in button and from RESEND on the code
   * screen, so the two cannot drift. A network at sign-in is a first guess at
   * the account's own line, remembered for "for myself".
   */
  const RESEND_COOLDOWN_MS = 30000;
  const sendCode = async ({ resend = false } = {}) => {
    if (verifying) return;
    if (!resend) {
      const own = detect(phone, dialCountry);
      setCarrier(own || carrier);
      if (own) {
        setMyCarrier(own);
        AsyncStorage.setItem(MY_CARRIER_STORE, own).catch(() => {});
      }
    }
    setOtp('');
    setOtpError(null);
    setVerifying(true);
    try {
      await requestCode(phone, dialCountry);
      setResendAt(Date.now() + RESEND_COOLDOWN_MS);
      if (!resend) setScreen('otp');
    } catch (e) {
      setOtpError(e instanceof ApiError ? e.code : 'network_error');
    } finally {
      setVerifying(false);
    }
  };
  const resendIn = Math.max(0, Math.ceil((resendAt - (nowTick || Date.now())) / 1000));
  // The deal tile and the button under it must name the same catalogue line.
  //
  // No fallback to the first product on purpose. Data rows are synced from the
  // distributor, which has no notion of a bonus, so the find below matches
  // nothing until someone deliberately marks a product — and the old
  // `?? cat.data[0]` quietly turned that into the cheapest bundle in the
  // catalogue, advertised as "Daily deal · Today only". Nothing on offer means
  // no card, rather than promoting a row nobody chose.
  const deal = (cat?.data ?? []).find((d) => d.bonus) ?? null;

  // Airtime and data are a separate SKU on every network, so the catalogue
  // carries one row per carrier. Showing them all put three "150 MB" tiles
  // under an "MTN" heading; the list is the selected network's only.
  const packs =
    (service === 'airtime' ? cat?.airtime : cat?.data)
      ?.filter((p) => !p.network || p.network === carrier)
      .map(toPack) ?? [];
  /**
   * Puts the recipient form in its "for myself" state: the account's own line
   * in national form, its country as the delivery country, and its network
   * pre-selected when we know it. Shared by the quick-buy tiles and the toggle
   * so both arrive at the same screen.
   */
  const selectSelf = () => {
    setForSelf(true);
    setRecipientCountry(country);
    setPhone(myNumber ? toNational(myNumber, country) : '');
    if (myCarrier) setCarrier(myCarrier); // the clamp effect drops it if the country does not offer it
  };
  const goBuy = (svc) => { setService(svc); selectSelf(); setScreen('recipient'); };
  const openOrder = (row, from) => { setViewOrder(row); setOrderFrom(from); setScreen('order'); };
  /**
   * A top-up is a plan bought for a profile the customer already has: same
   * plan list as a first purchase for that destination, with the ICCID carried
   * through checkout so the provider adds the plan rather than issuing a new
   * profile.
   */
  const topUpEsim = async (e) => {
    const dest = (cat?.esimDestinations ?? []).find((d) => d.code === e.country) ?? null;
    // A destination we have stopped selling has no plans to show. Say so here
    // rather than opening a plan list that can only ever be empty — the eSIM
    // itself keeps working, it just cannot be topped up through us.
    if (!dest) {
      Alert.alert(t('esim.topUpUnavailableTitle'), t('esim.topUpUnavailableBody'));
      return;
    }
    setTopUpIccid(e.iccid);
    setEsimCountry(dest.name);
    setEsimPlanList([]);
    setScreen('esimPlans');
    await loadEsimPlans(dest.name);
  };

  /** Plans for one destination, with an honest in-flight flag. */
  const loadEsimPlans = async (name) => {
    setEsimPlansLoading(true);
    const res = await fetchEsimPlans(name, i18n.language?.slice(0, 2) || 'en').catch(() => null);
    setEsimPlanList(res ? res.plans.map(toPack) : []);
    setEsimPlansLoading(false);
  };
  /**
   * Reaches support with the order reference already in the message — the
   * one thing they will ask for, and the one thing a customer on the phone
   * cannot easily read out.
   */
  const contactSupport = (ref) => {
    const subject = t('support.subject', { ref: ref ?? '—' });
    const body = t('support.body', { ref: ref ?? '—', phone: myNumber ? '+' + myNumber : phone });
    if (hasWhatsApp()) openWhatsApp(t, `${subject}\n${body}`);
    else openEmail(t, subject, body);
  };
  // A fresh pack is a fresh attempt: the last one's error must not follow it.
  const openPack = (p) => { setPack(p); setPayError(null); setOrder(null); setScreen('pay'); };
  const showNav = TAB_SCREENS.includes(screen);

  return (
    // Top inset is applied once here; the tab bar owns the bottom inset so its
    // background still bleeds past the home indicator.
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top, paddingBottom: showNav ? 0 : insets.bottom }}>
      <StatusBar barStyle="dark-content" />
      {/* One avoider for every screen: the email field on the VPN payment
          step and the number field on the recipient form both sat under the
          keyboard, and every button below an input needed a second tap. Android
          resizes the window itself, so only iOS gets padding. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      {/* First run goes straight to auth; 'welcome' is the returning-user entry after sign out. */}
      {screen === 'onboarding' && (
        <Onboarding
          onDone={() => {
            AsyncStorage.setItem(SEEN_ONBOARDING, '1').catch(() => {});
            setAuthFrom('onboarding');
            setScreen('login');
          }}
        />
      )}

      {screen === 'welcome' && (
        <View style={{ flex: 1 }}>
          <View style={[st.header, { borderBottomWidth: 2, borderColor: C.divider }]}>
            <Brand />
          </View>
          <View style={{ flex: 1, backgroundColor: C.accent, padding: 20, justifyContent: 'flex-end' }}>
            <Text style={st.poster}>{t('welcome.poster')}</Text>
          </View>
          <View style={{ padding: 20, gap: 10 }}>
            <Text style={st.subText}>{t('welcome.trust')}</Text>
            <Btn label={t('welcome.cta')} onPress={() => { setAuthFrom('welcome'); setScreen('login'); }} />
            {/* Reachable without an OTP on purpose: someone on a new phone
                cannot receive a code on the old SIM. */}
            <Btn
              variant="ghost"
              label={t('welcome.recover')}
              onPress={() => { setRecoverFrom('welcome'); setScreen('vpnRecover'); }}
            />
          </View>
        </View>
      )}

      {screen === 'login' && (
        <View style={{ flex: 1 }}>
          <BackHeader onBack={() => setScreen(authFrom)} label={t('auth.signIn')} />
          <View style={{ padding: 20, gap: 20 }}>
            <Text style={st.h2}>{t('auth.title')}</Text>
            <View>
              <Text style={st.fieldLabel}>{t('auth.phoneLabel')}</Text>
              <PhoneInput
                value={phone}
                onChangeText={setPhone}
                country={dialCountry}
                onCountryChange={setDialCountry}
                placeholder={t('auth.phonePlaceholder')}
              />
              {detect(phone, dialCountry) ? <Text style={{ color: C.accentText, fontSize: 12, marginTop: 6, fontFamily: F.body }}>{t('auth.detected', { carrier: detect(phone, dialCountry) })}</Text> : null}
            </View>
            <Btn
              label={verifying ? t('auth.verifying') : t('auth.sendCode')}
              disabled={digits.length < 8 || verifying}
              onPress={() => sendCode()}
            />
            {/* A failed send used to leave this screen completely silent: the
                button finished, nothing moved, and no reason was given. */}
            {otpError && (
              <View style={{ borderWidth: 2, borderColor: C.accent, padding: 12 }}>
                <Text style={{ color: C.accent700, fontFamily: F.semi, fontSize: 13 }}>
                  {t(`auth.error.${otpError}`, t('auth.sendFailed'))}
                </Text>
              </View>
            )}
            <Text style={st.subText}>{t('auth.smsNote')}</Text>
            <Btn
              variant="ghost"
              label={t('auth.recoverCta')}
              onPress={() => { setRecoverFrom('login'); setScreen('vpnRecover'); }}
              style={{ alignSelf: 'flex-start' }}
            />
          </View>
        </View>
      )}

      {screen === 'otp' && (
        <View style={{ flex: 1 }}>
          <BackHeader onBack={() => setScreen('login')} label={t('auth.verify')} />
          <View style={{ padding: 20, gap: 20 }}>
            <View>
              <Text style={st.h2}>{t('auth.enterCode')}</Text>
              <Text style={st.subText}>{t('auth.sentTo')} <Text style={{ fontFamily: F.semi }}>{phone}</Text></Text>
            </View>
            {/* Focused on arrival and tagged as a one-time code, so iOS and
                Android offer the SMS code above the keyboard instead of
                making the customer read and retype six digits. */}
            <TextInput
              style={[st.input, { fontSize: 32, fontFamily: F.heading, letterSpacing: 16, textAlign: 'center', minHeight: 64 }]}
              value={otp}
              onChangeText={(v) => { setOtp(v.replace(/\D/g, '').slice(0, 6)); setOtpError(null); }}
              keyboardType="number-pad" placeholder="000000" maxLength={6}
              autoFocus
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              accessibilityLabel={t('auth.enterCode')}
            />
            {otpError && (
              <View style={{ borderWidth: 2, borderColor: C.accent, padding: 12 }}>
                <Text style={{ color: C.accent700, fontFamily: F.semi, fontSize: 13 }}>{t(`auth.error.${otpError}`, t('auth.wrongCode'))}</Text>
              </View>
            )}
            <Btn
              label={verifying ? t('auth.verifying') : t('auth.verifyCta')}
              disabled={otp.length < 6 || verifying}
              onPress={async () => {
                setVerifying(true);
                setOtpError(null);
                try {
                  await verifyCode(phone, otp, dialCountry);
                  await refreshAccount();
                  setScreen('home');
                } catch (e) {
                  setOtpError(e instanceof ApiError ? e.code : 'network_error');
                  setOtp('');
                } finally {
                  setVerifying(false);
                }
              }}
            />
            {/* A late SMS used to mean going back and retyping the number.
                Held for 30 s after each send so the button cannot be used to
                burn through the provider's rate limit. */}
            <Btn
              variant="ghost"
              label={resendIn > 0 ? t('auth.resendIn', { seconds: resendIn }) : t('auth.resend')}
              disabled={resendIn > 0 || verifying}
              onPress={() => sendCode({ resend: true })}
              style={{ alignSelf: 'flex-start' }}
            />
          </View>
        </View>
      )}

      {screen === 'home' && (
        <HomeScreen
          points={points}
          history={history}
          loading={accountLoading}
          deal={deal ? toPack(deal) : null}
          lastBuy={lastBuy}
          // Straight to payment: the pack, the line and the wallet are all
          // known, so there is nothing left to ask.
          onRepeat={() => {
            const p = lastBuy.customAmount
              ? null
              : (cat?.[lastBuy.service] ?? []).find((x) => x.id === lastBuy.productId);
            if (!p && !lastBuy.customAmount) return; // withdrawn from the catalogue since
            // One tap goes straight to payment, skipping every screen that
            // would otherwise have hidden a switched-off service.
            if (!featureOn(lastBuy.service)) return;
            if (lastBuy.customAmount && !featureOn('customAmount')) return;
            setService(lastBuy.service);
            setCarrier(lastBuy.carrier);
            setPhone(lastBuy.recipient);
            setRecipientCountry(lastBuy.recipientCountry);
            if (lastBuy.methodId) setPay(lastBuy.methodId);
            setPack(lastBuy.customAmount ? customPack(lastBuy.customAmount, t) : toPack(p));
            setPayError(null);
            setScreen('pay');
          }}
          onBuy={goBuy}
          onOpenOrder={(row) => openOrder(row, 'home')}
          // The deal has to be a real catalogue line: checkout buys a product id,
          // and a hand-built pack has nothing to charge against.
          onDailyDeal={() => {
            if (!deal) return;
            setService('data');
            setPack(toPack(deal));
            setScreen('pay');
          }}
          onVpn={() => setScreen(vpn ? 'vpn' : 'vpnPlans')}
          // Straight to picking a destination: the promo exists to start that
          // choice, and the list screen would be empty for someone with none.
          onEsim={() => { setCountrySearch(''); setScreen('esimCountry'); }}
          hasVpn={!!vpn}
          hasEsim={esims.length > 0}
          featureOn={featureOn}
        />
      )}

      {screen === 'history' && (
        <HistoryScreen history={history} loading={accountLoading} onBuy={() => goBuy('data')} onOpen={(row) => openOrder(row, 'history')} />
      )}

      {screen === 'rewards' && <RewardsScreen points={points} onRedeem={(cost) => setPoints((p) => p - cost)} />}

      {screen === 'profile' && (
        <ProfileScreen
          carrier={carrier}
          phone={myNumber || phone}
          country={country}
          esims={esims}
          vpn={vpn}
          onEsims={() => setScreen('esim')}
          onVpn={() => setScreen('vpn')}
          featureOn={featureOn}
          onLanguage={() => setScreen('language')}
          onHelp={() => contactSupport(null)}
          supportChannel={hasWhatsApp() ? 'WhatsApp' : SUPPORT_EMAIL}
          onSignOut={signOut}
        />
      )}

      {screen === 'recipient' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <BackHeader onBack={() => setScreen('home')} label={t('recipient.step')} />
          <View style={{ padding: 20, gap: 20 }}>
            <Text style={st.h2}>{t('recipient.title')}</Text>
            <TourTarget name="who">
              <Toggle2
                opts={[{ label: t('recipient.forMyself'), val: true }, { label: t('recipient.someoneElse'), val: false }]}
                value={forSelf}
                // "For myself" is the account's own line, country and network;
                // "someone else" starts from a blank number and keeps the
                // country the customer last picked.
                onChange={(v) => { if (v) selectSelf(); else { setForSelf(false); setPhone(''); } }}
              />
            </TourTarget>
            <TourTarget name="number">
              <Text style={st.fieldLabel}>{t('auth.phoneLabel')}</Text>
              {/* The recipient can be in another country — a top-up sent home
                  from abroad — so this picker is the delivery country and is
                  kept separate from the one that decides the payment rail. */}
              <PhoneInput
                value={phone}
                onChangeText={(v) => { setPhone(v); const d = detect(v, recipientCountry); if (d) setCarrier(d); }}
                country={recipientCountry}
                onCountryChange={setRecipientCountry}
                placeholder={t('auth.phonePlaceholder')}
              />
            </TourTarget>
            <TourTarget name="network">
              <Text style={st.fieldLabel}>{t('recipient.networkLabel')}{detect(phone, recipientCountry) === carrier && carrier ? <Text style={{ color: C.accentText }}>{t('recipient.detectedSuffix')}</Text> : null}</Text>
              {/* Networks follow the recipient's country. These used to be the
                  three Ivorian carriers with Ivorian prefix hints regardless,
                  so a +226 number was offered Orange/MTN/Moov "PRÉFIXE 07".
                  Prefix hints only exist for markets whose plan we hold. */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {networkOptions.map((c) => (
                  <Pressable
                    key={c.name}
                    onPress={() => setCarrier(c.name)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: carrier === c.name }}
                    style={[st.carrierCell, carrier === c.name && { borderColor: C.accent, backgroundColor: C.accent100 }]}
                  >
                    {/* The mark does the recognising; the name stays for the
                        screen reader and for a network whose art is missing. */}
                    <ProviderLogo network={c.name} country={recipientCountry} size={40} style={{ marginBottom: 6 }} />
                    <Text style={{ fontFamily: F.heading, fontSize: 14, color: C.text }}>{c.name}</Text>
                    {c.prefix ? (
                      <Text style={[st.subText, { fontSize: 10 }]}>{t('recipient.prefix', { prefix: c.prefix })}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
              {/* Says why CONTINUE is off, rather than leaving a dead button:
                  either no network is chosen yet, or none can be served. */}
              {networkOptions.length === 0 ? (
                <Text style={[st.subText, { marginTop: 8, color: C.accent700 }]}>{t('recipient.noNetworks')}</Text>
              ) : !carrierOk ? (
                <Text style={[st.subText, { marginTop: 8 }]}>{t('recipient.pickNetwork')}</Text>
              ) : null}
            </TourTarget>
            <Btn label={t('common.continue')} disabled={digits.length < 8 || !carrierOk} onPress={() => setScreen('packs')} />
          </View>
        </ScrollView>
      )}

      {screen === 'packs' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <BackHeader onBack={() => setScreen('recipient')} label={t('packs.step')} />
          <View style={{ padding: 20, gap: 16 }}>
            <View style={st.rowBetween}>
              <Text style={st.h2}>{service === 'airtime' ? t('packs.airtimeTitle') : t('packs.dataTitle')}</Text>
              <ProviderBadge network={carrier} country={recipientCountry} />
            </View>
            <Toggle2 opts={[{ label: t('packs.airtimeToggle'), val: 'airtime' }, { label: t('packs.dataToggle'), val: 'data' }]} value={service} onChange={setService} />
            <PackGrid
              items={packs}
              onSelect={openPack}
              loading={cat === null && !catFailed}
              art={catFailed ? Offline : undefined}
              title={catFailed ? t('empty.offlineTitle') : t('empty.packsTitle')}
              body={catFailed ? t('empty.offlineBody') : t('empty.packsBody')}
              cta={catFailed ? t('empty.retry') : null}
              onCta={catFailed ? reloadCatalogue : null}
            />
            {service === 'airtime' && featureOn('customAmount') && (
              <Pressable
                onPress={() => setScreen('amount')}
                accessibilityRole="button"
                accessibilityLabel={`${t('packs.customTitle')}. ${t('packs.customSub')}`}
                style={({ pressed }) => [st.customBox, st.rowBetween, pressed && { backgroundColor: C.accent100 }]}
              >
                <View style={{ flex: 1 }}>
                  <Kicker>{t('packs.customKicker')}</Kicker>
                  <Text style={st.rowTitle}>{t('packs.customTitle')}</Text>
                  <Text style={st.subText}>{t('packs.customSub')}</Text>
                </View>
                <Text style={st.arrow}>→</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      )}

      {screen === 'language' && <LanguageScreen onBack={() => setScreen('profile')} />}

      {screen === 'vpnPlans' && (
        <VpnPlansScreen
          plans={(cat?.vpn ?? []).map(toPack)}
          locations={locations}
          onBack={() => setScreen(vpn ? 'vpn' : 'home')}
          onRestore={() => { setRecoverFrom('vpnPlans'); setScreen('vpnRecover'); }}
          onSelect={(plan) => {
            setService('vpn');
            setPack(plan);
            setPay(null);
            if (vpn) setEmail(vpn.email); // renewals keep the delivery address
            setScreen('pay');
          }}
        />
      )}

      {screen === 'vpn' && (
        <VpnScreen
          vpn={vpn}
          locations={locations}
          onBack={() => setScreen('profile')}
          onSetup={() => { setVpnFresh(false); setScreen('vpnLocations'); }}
          onBuy={() => setScreen('vpnPlans')}
          onRestore={() => { setRecoverFrom('vpn'); setScreen('vpnRecover'); }}
        />
      )}

      {screen === 'vpnLocations' && vpn && (
        <VpnLocationsScreen
          locations={locations}
          added={vpnAdded}
          // /me only knows an email once the account has one; a customer who
          // signed in by phone and typed a delivery address at checkout has
          // none linked. Deliberately not linked server-side from an
          // unauthenticated checkout — that would let anyone attach their own
          // address to someone else's number and then sign in as them.
          email={vpn.email || email}
          justPurchased={vpnFresh}
          onBack={() => { setVpnFresh(false); setScreen('vpn'); }}
          onSelect={async (l) => {
            if (vpnBusy) return;
            setVpnBusy(true);
            setVpnFresh(false);
            try {
              // The server issues the keys and returns the config exactly once,
              // so it is held in memory for this screen only — there is nothing
              // to re-derive it from if we drop it.
              const peer = await provisionPeer(l.code);
              setVpnLoc(l);
              setVpnConfig(peer.conf);
              setScreen('vpnSetup');
            } catch (e) {
              Alert.alert(
                t('vpn.provisionError'),
                t(`vpn.error.${e instanceof ApiError ? e.code : 'network_error'}`, t('vpn.provisionErrorBody')),
              );
            } finally {
              setVpnBusy(false);
            }
          }}
        />
      )}

      {screen === 'vpnSetup' && vpn && vpnLoc && vpnConfig && (
        <VpnSetupScreen
          config={vpnConfig}
          loc={vpnLoc}
          onBack={() => setScreen('vpnLocations')}
          onAnother={() => setScreen('vpnLocations')}
          onExported={(code) => setVpnAdded((a) => (a.includes(code) ? a : [...a, code]))}
        />
      )}

      {screen === 'vpnRecover' && (
        <VpnRecoverScreen
          signedOut={recoverFrom === 'welcome' || recoverFrom === 'login'}
          onBack={() => setScreen(recoverFrom)}
          onOpenConfigs={(addr) => {
            // A real magic link returns the account's existing configs; here we
            // rehydrate the local subscription so setup has a token to work from.
            setVpn((v) => v || {
              plan: 'Restored VPN',
              expiresAt: Date.now() + 30 * 86400000,
              email: addr,
              token: 'tk_restored',
            });
            setVpnFresh(false);
            setScreen('vpnLocations');
          }}
        />
      )}

      {screen === 'amount' && (
        <AmountScreen
          carrier={carrier}
          onBack={() => setScreen('packs')}
          onConfirm={(amt) => openPack(customPack(amt, t))}
        />
      )}

      {screen === 'pay' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {/* Locked while a payment is in flight: leaving mid-poll used to let a
              success screen appear minutes later over an unrelated screen. STOP
              WAITING below is the way out — it ends the poll, not the order. */}
          <BackHeader
            onBack={() => setScreen(isVpn ? 'vpnPlans' : service === 'esim' ? 'esimPlans' : 'packs')}
            label={t('pay.step')}
            disabled={paying}
          />
          <View style={{ padding: 20, gap: 18 }}>
            <TourTarget name="total">
            <View style={{ borderWidth: 2, borderColor: C.text, padding: 16 }}>
              <Kicker>{t('pay.summary')}</Kicker>
              <SummaryRow k={t('pay.to')} v={isVpn ? t('pay.vpnSubscription') : service === 'esim' ? t('pay.newEsim') : (forSelf ? t('pay.myNumber') : '') + (toE164(phone, recipientCountry) ?? phone)} />
              {!isVpn && <SummaryRow k={t('pay.network')} v={carrier} />}
              <SummaryRow k={t('pay.pack')} v={pack ? pack.n : '—'} />
              {/* The fee is broken out rather than folded into the total. It is a
                  small amount on a familiar face value, so a customer who sees
                  1 020 F charged for a 1 000 F top-up with no explanation reads it
                  as being shortchanged. Shown only when there is one — every
                  zero-fee line would just be noise on eSIM and VPN. */}
              {quote && quote.feeXof > 0 && (
                <>
                  <SummaryRow
                    k={t('pay.fee', { pct: quote.feePct })}
                    v={formatMoney(quote.fee, quote.currency)}
                  />
                </>
              )}
              {/* The quote is what the provider will actually take. Falling back
                  to the XOF list price only while it loads. */}
              <SummaryRow
                k={t('pay.total')}
                v={quote ? formatMoney(quote.amount, quote.currency) : pack ? fmt(pack.p) : '—'}
                bold
              />
              {quote && quote.currency !== 'XOF' && (
                <SummaryRow k={t('pay.converted')} v={fmt(quote.amountXof)} />
              )}
            </View>
            </TourTarget>

            {isVpn && (
              <View>
                <Text style={st.fieldLabel}>{t('pay.emailLabel')}</Text>
                <TextInput
                  style={st.input}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  returnKeyType="done"
                  placeholder={t('pay.emailPlaceholder')}
                />
                <Text style={[st.subText, { marginTop: 6 }]}>
                  {t('pay.emailNote', { phone: toE164(myNumber || phone, country) ?? (myNumber || phone) })}
                </Text>
              </View>
            )}
            <TourTarget name="method" style={{ gap: 8 }}>
              <Text style={st.fieldLabel}>{t('pay.payWith')}</Text>
              {payment.methods
                .map((m) => ({
                  id: m.id,
                  // Two rows can share a wallet name, so the subtitle has to
                  // carry the difference: dialling a code versus being prompted.
                  name: m.title,
                  sub:
                    m.kind === 'dial'
                      ? t('pay.dialSub')
                      : t('pay.momoSub', { phone: toE164(myNumber || phone, country) ?? (myNumber || phone) }),
                }))
                .map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setPay(m.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: method?.id === m.id }}
                  accessibilityLabel={`${m.name}. ${m.sub}`}
                  style={[st.payOpt, method?.id === m.id && { borderColor: C.accent, backgroundColor: C.accent100 }]}
                >
                  <View style={[st.radioDot, method?.id === m.id && { backgroundColor: C.accent, borderColor: C.accent }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowTitle}>{m.name}</Text>
                    <Text style={st.subText}>{m.sub}</Text>
                  </View>
                </Pressable>
              ))}
              {!payment.supported && (
                <Text style={st.subText}>{t('pay.unsupportedRegion', { country })}</Text>
              )}
            </TourTarget>
            <Text style={st.subText}>{t('pay.earn', { count: earnPts })}</Text>

            {/* PawaPay pushes an approval prompt to the handset — there is no
                USSD string to dial, so this waits on the customer rather than
                asking them to type anything. */}
            {/* Dial-to-pay. The code opens the operator's merchant menu; the
                amount and PIN are typed inside that session, so the figure has
                to be stated here — the string cannot carry it. */}
            {order?.action === 'dial' && paying && (
              <View style={{ borderWidth: 2, borderColor: C.text, padding: 16, gap: 12 }}>
                <Kicker>{t('pay.dialKicker', { provider: method?.title ?? '' })}</Kicker>
                <View style={[st.rowBetween, { backgroundColor: C.surface, borderWidth: 1, borderColor: C.divider, padding: 12 }]}>
                  <Text style={{ fontFamily: F.heading, fontSize: 22, color: C.text }}>{order.ussd}</Text>
                  <Btn
                    variant="ghost"
                    label={copiedUssd ? t('common.copied') : t('common.copy')}
                    onPress={async () => {
                      await Clipboard.setStringAsync(order.ussd);
                      setCopiedUssd(true);
                      setTimeout(() => setCopiedUssd(false), 2000);
                    }}
                  />
                </View>
                <Text style={st.subText}>{t('pay.dialSim', { carrier: method?.carrier ?? '' })}</Text>
                <Text style={st.subText}>{t('pay.dialAmount')}</Text>
                <Btn
                  label={t('pay.dialCta')}
                  onPress={() => Linking.openURL('tel:' + encodeURIComponent(order.ussd)).catch(() => {})}
                />
                <Text style={st.subText}>{t('pay.dialWaiting')}</Text>
                {waitingFooter}
              </View>
            )}

            {order?.action === 'approve_on_handset' && paying && (
              <View style={{ borderWidth: 2, borderColor: C.text, padding: 16, gap: 8 }}>
                <Kicker>{t('pay.authorize', { provider: method?.title ?? momoName })}</Kicker>
                {/* The prompt lands on the wallet being charged — the buyer's
                    own line — never on the recipient's, which is what `phone`
                    holds when topping up someone else. */}
                <Text style={st.subText}>{t('pay.approveOnHandset', { phone: toE164(myNumber || phone, country) ?? (myNumber || phone) })}</Text>
                <Text style={st.subText}>{t('pay.waitingNote', { provider: method?.title ?? momoName })}</Text>
                {waitingFooter}
              </View>
            )}

            {payError && (
              <View style={{ borderWidth: 2, borderColor: C.accent, padding: 12 }}>
                <Text style={{ color: C.accent700, fontFamily: F.semi, fontSize: 13 }}>
                  {t(`pay.error.${payError}`, t('pay.errorGeneric'))}
                </Text>
              </View>
            )}

            <Btn
              label={paying
                ? t('pay.processing')
                : t(isMomo ? 'pay.confirm' : 'pay.payNow', { amount: quote ? formatMoney(quote.amount, quote.currency) : pack ? fmt(pack.p) : '' })}
              disabled={paying || !(pack?.id || pack?.custom) || !payment.supported || (isVpn && !emailOk)}
              onPress={doPay}
            />
          </View>
        </ScrollView>
      )}

      {screen === 'order' && viewOrder && (() => {
        const o = viewOrder.raw ?? {};
        const tone = orderTone(o.status);
        const when = (ms) => (ms ? new Date(ms).toLocaleString(i18n.language?.slice(0, 2) === 'fr' ? 'fr-FR' : 'en-GB') : '—');
        return (
          <ScrollView style={{ flex: 1 }}>
            <BackHeader onBack={() => setScreen(orderFrom)} label={t('order.step')} />
            <View style={{ padding: 20, gap: 16 }}>
              {/* Title wraps; the status keeps its width and stays on screen. */}
              <View style={[st.rowBetween, { alignItems: 'flex-start', gap: 12 }]}>
                {o.network ? <ProviderLogo network={o.network} country={o.recipientCountry} size={44} style={{ marginTop: 2 }} /> : null}
                <Text style={[st.h2, { flex: 1, flexShrink: 1 }]}>{viewOrder.desc}</Text>
                <View style={{ flexShrink: 0, paddingTop: 8 }}>
                  <StatusText code={o.status} label={viewOrder.status} />
                </View>
              </View>
              {/* What happened, in the customer's terms — not the raw code. */}
              {tone === 'bad' && (
                <View style={{ borderWidth: 2, borderColor: C.accent, padding: 12 }}>
                  <Text style={{ color: C.accent700, fontFamily: F.semi, fontSize: 13 }}>
                    {t(`order.explain.${o.status}`, t('order.explain.generic'))}
                    {o.failureReason ? ' ' + t(`pay.error.${o.failureReason}`, '') : ''}
                  </Text>
                </View>
              )}
              {tone === 'wait' && <Text style={st.subText}>{t('order.inFlight')}</Text>}
              <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
                <SummaryRow k={t('pay.to')} v={o.recipientMsisdn ? '+' + String(o.recipientMsisdn).replace(/^\+/, '') : myNumber ? t('pay.myNumber') + '+' + myNumber : '—'} />
                <SummaryRow k={t('order.amount')} v={viewOrder.amount} bold />
                <SummaryRow k={t('order.placed')} v={when(o.createdAt)} />
                {o.deliveredAt ? <SummaryRow k={t('order.deliveredAt')} v={when(o.deliveredAt)} /> : null}
                <View style={[st.sumRow, { alignItems: 'center' }]}>
                  <Text style={st.sumKey}>{t('success.ref')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[st.sumVal, { fontFamily: F.heading }]} selectable>{o.id ?? '—'}</Text>
                    <Btn
                      variant="ghost"
                      label={copiedRef ? t('common.copied') : t('common.copy')}
                      style={{ minHeight: 32 }}
                      onPress={async () => {
                        if (!o.id) return;
                        await Clipboard.setStringAsync(o.id);
                        setCopiedRef(true);
                        setTimeout(() => setCopiedRef(false), 2000);
                      }}
                    />
                  </View>
                </View>
              </View>
              {/* Support is one tap from any order, and the primary action on
                  one that went wrong. */}
              <Btn
                variant={tone === 'bad' ? 'primary' : 'secondary'}
                label={t('order.contact')}
                onPress={() => contactSupport(o.id)}
              />
              <Text style={st.subText}>{t('order.contactSub', { channel: hasWhatsApp() ? 'WhatsApp' : SUPPORT_EMAIL })}</Text>
            </View>
          </ScrollView>
        );
      })()}

      {screen === 'success' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <View style={{ backgroundColor: C.accent, padding: 20, paddingTop: 36 }}>
            <Kicker light>{t('success.kicker')}</Kicker>
            <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 56, letterSpacing: -1 }}>{t('success.title')}</Text>
          </View>
          <View style={{ padding: 20, gap: 16 }}>
            {/* Printed from the confirmed order, not the pack: `pack.p` is the
                list price, and the wallet statement shows price plus fee. The
                reference is what support will ask for, so it is copyable. */}
            <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
              <SummaryRow k={t('pay.to')} v={service === 'esim' ? t('pay.newEsim') : (receipt?.to ?? (toE164(phone, recipientCountry) ?? phone))} />
              <SummaryRow k={t('pay.pack')} v={(receipt?.pack ?? pack?.n ?? '—') + (receipt?.network ? ' · ' + receipt.network : '')} />
              {receipt && receipt.feeXof > 0 && (
                <SummaryRow k={t('pay.fee', { pct: receipt.feePct })} v={formatMoney(receipt.fee, receipt.currency)} />
              )}
              <SummaryRow
                k={t('success.paid')}
                v={receipt ? formatMoney(receipt.amount, receipt.currency) : pack ? fmt(pack.p) : '—'}
                bold
              />
              {receipt && receipt.currency !== 'XOF' && (
                <SummaryRow k={t('pay.converted')} v={fmt(receipt.amountXof)} />
              )}
              {receipt?.orderId ? (
                <View style={[st.sumRow, { alignItems: 'center' }]}>
                  <Text style={st.sumKey}>{t('success.ref')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[st.sumVal, { fontFamily: F.heading }]} selectable>{receipt.orderId}</Text>
                    <Btn
                      variant="ghost"
                      label={copiedRef ? t('common.copied') : t('common.copy')}
                      style={{ minHeight: 32 }}
                      onPress={async () => {
                        await Clipboard.setStringAsync(receipt.orderId);
                        setCopiedRef(true);
                        setTimeout(() => setCopiedRef(false), 2000);
                      }}
                    />
                  </View>
                </View>
              ) : null}
            </View>
            <Tag>{t('success.pointsEarned', { count: earnPts })}</Tag>
            {service === 'esim' && (
              <View style={{ gap: 12 }}>
                <View>
                  <Kicker>{t('success.esimKicker')}</Kicker>
                  <Text style={st.subText}>{receipt?.esim ? t('success.esimBody') : t('esim.preparing')}</Text>
                </View>
                {/* Straight from the provider: the ICCID it issued, the LPA code
                    the QR encodes, the one-tap link. Nothing here is invented. */}
                {receipt?.esim ? <EsimInstallCard esim={receipt.esim} compact /> : null}
                <Btn variant="secondary" label={t('esim.myEsims')} onPress={() => setScreen('esim')} />
              </View>
            )}
            <Btn label={t('common.done')} onPress={() => setScreen('home')} />
            {service !== 'esim' && <Btn variant="secondary" label={t('success.buyAnother')} onPress={() => setScreen('packs')} />}
          </View>
        </ScrollView>
      )}

      {screen === 'esim' && (
        <EsimListScreen
          esims={esims}
          destinations={cat?.esimDestinations ?? []}
          onBack={() => setScreen('profile')}
          onNew={() => { setTopUpIccid(null); setCountrySearch(''); setScreen('esimCountry'); }}
          onOpen={(e) => { setViewEsim(e); setScreen('esimDetail'); }}
          onTopUp={topUpEsim}
        />
      )}

      {screen === 'esimDetail' && (
        <EsimDetailScreen esim={viewEsim} destinations={cat?.esimDestinations ?? []} onBack={() => setScreen('esim')} onTopUp={topUpEsim} />
      )}

      {screen === 'esimCountry' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <BackHeader onBack={() => setScreen('esim')} label={t('esim.destinationStep')} />
          <View style={{ padding: 20 }}>
            <Text style={st.h2}>{t('esim.destinationTitle')}</Text>
            <Text style={[st.subText, { marginBottom: 14 }]}>{t('esim.destinationSub')}</Text>
            <TourTarget name="destination" style={{ marginBottom: 14 }}>
              <TextInput style={st.input} value={countrySearch} onChangeText={setCountrySearch} placeholder={t('esim.searchPlaceholder')} />
            </TourTarget>
            {(() => {
              const shown = (cat?.esimDestinations ?? []).filter((c) =>
                c.name.toLowerCase().includes(countrySearch.trim().toLowerCase()),
              );
              if (shown.length) return null;
              // A search that matches nothing is a different problem from a
              // catalogue that has nothing, and says so.
              return countrySearch.trim() ? (
                <EmptyState art={NoResults} title={t('empty.searchTitle')} body={t('empty.searchBody')} />
              ) : (
                <EmptyState
                  art={NoLocations}
                  loading={cat === null}
                  title={t('empty.destinationsTitle')}
                  body={t('empty.destinationsBody')}
                />
              );
            })()}
            <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
              {(cat?.esimDestinations ?? []).filter((c) => c.name.toLowerCase().includes(countrySearch.trim().toLowerCase())).map((c) => (
                <Pressable
                  key={c.code}
                  onPress={async () => {
                    setTopUpIccid(null);
                    setEsimCountry(c.name);
                    setEsimPlanList([]);
                    setScreen('esimPlans');
                    // Plans are per-destination, so they are fetched on demand
                    // rather than shipped inside the catalogue payload.
                    await loadEsimPlans(c.name);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.name}. ${c.sub}`}
                  style={({ pressed }) => [st.packRow, pressed && { backgroundColor: C.accent100 }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    <View style={{ width: 30, height: 30, borderWidth: 1.5, borderColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
                      {/* Regions like "Global" have no flag, so the code stands in. */}
                      {flagFor(c.code)
                        ? <Text style={{ fontSize: 17, lineHeight: 22 }}>{flagFor(c.code)}</Text>
                        : <Text style={{ fontFamily: F.heading, fontSize: 11, color: C.text }}>{c.code}</Text>}
                    </View>
                    <View>
                      <Text style={st.rowTitle}>{c.name}</Text>
                      <Text style={st.subText}>{c.sub}</Text>
                    </View>
                  </View>
                  <Text style={st.arrow}>→</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      )}

      {screen === 'esimPlans' && (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <BackHeader onBack={() => setScreen(topUpIccid ? 'esim' : 'esimCountry')} label={t('esim.plansStep')} />
          <View style={{ padding: 20 }}>
            <View style={st.rowBetween}>
              <Text style={st.h2}>{topUpIccid ? t('esim.topUpTitle') : t('esim.plansTitle')}</Text>
              <Tag kind="neutral">{esimCountry}</Tag>
            </View>
            <Text style={[st.subText, { marginBottom: 16 }]}>{t('esim.plansSub')}</Text>
            <PackGrid
              items={esimPlanList}
              onSelect={(p) => { setService('esim'); setCarrier(p.carrier); openPack(p); }}
              loading={esimPlansLoading}
              title={t('empty.packsTitle')}
              body={t('empty.packsBody')}
            />
          </View>
        </ScrollView>
      )}

      </KeyboardAvoidingView>
      {showNav && <TabBar items={navItems(t)} value={screen} onChange={setScreen} insetBottom={insets.bottom} />}

      {/* Copy is looked up per tour and step, so adding a step is a target name
          and two keys rather than another branch here. Steps whose target is
          not on screen are dropped when the tour resolves. */}
      <TourOverlay
        visible={Boolean(tourOpen)}
        onDone={endTour}
        steps={(tourOpen ? TOURS[tourOpen].steps : []).map((step) => ({
          name: step,
          title: t(`tour.${tourOpen}.${step}Title`),
          body: t(`tour.${tourOpen}.${step}Body`),
        }))}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <TourProvider>
        <TopUp />
      </TourProvider>
    </SafeAreaProvider>
  );
}
