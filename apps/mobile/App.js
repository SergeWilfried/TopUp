// TOPUP — airtime, data & eSIM purchase app (Expo / React Native)
// Faithful port of the HTML design prototype (Modernist design system).
// Navigation is a simple screen state machine; swap for react-navigation if preferred.
// Tab destinations live in ./screens; shared primitives in ./ui; catalogue in ./data.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StatusBar, Alert, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { useFonts, Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { useTranslation } from 'react-i18next';
import './i18n';
import { loadStoredLanguage } from './i18n';

import { C, F, fmt, fmtN, CARRIERS, countryFromCanonical, detect, flagFor, navItems, networksFor, PAYABLE_COUNTRIES, TAB_SCREENS, SEEN_ONBOARDING } from '@topup/core';
import {
  ApiError,
  catalogue as fetchCatalogue,
  esimPlans as fetchEsimPlans,
  loadSession,
  me,
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
import { Btn, BackHeader, EmptyState, Kicker, Tag, PackGrid, PhoneInput, SummaryRow, Toggle2, TabBar, Brand, st } from './ui';
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

/** An order row as the history list wants it. */
const toHistoryRow = (o, t) => ({
  desc: o.detail,
  meta: `${new Date(o.createdAt).toLocaleDateString()} · ${String(o.product).toUpperCase()}`,
  amount: fmt(o.amount),
  status: t(`common.orderStatus.${o.status}`, String(o.status).toUpperCase()),
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
  const [carrier, setCarrier] = useState('Orange');
  const [pack, setPack] = useState(null);
  const [pay, setPay] = useState(null); // method id, chosen from what the region supports
  const [paying, setPaying] = useState(false);
  const [points, setPoints] = useState(0);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(null); // error code, or null
  const [verifying, setVerifying] = useState(false);
  const [email, setEmail] = useState(''); // where VPN configs get delivered
  const [esimCountry, setEsimCountry] = useState('Côte d’Ivoire');
  const [countrySearch, setCountrySearch] = useState('');
  const [esims, setEsims] = useState([]);
  const [history, setHistory] = useState([]);
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
  const [locations, setLocations] = useState([]); // /servers
  const [esimPlanList, setEsimPlanList] = useState([]);
  const [payError, setPayError] = useState(null);
  const [order, setOrder] = useState(null); // in-flight purchase
  const [quote, setQuote] = useState(null); // what this market is actually charged
  const [dialable, setDialable] = useState([]); // wallets payable by dialling
  const [lastBuy, setLastBuy] = useState(null); // the repeatable purchase
  const [copiedUssd, setCopiedUssd] = useState(false);

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
   * What this market will actually be charged.
   *
   * Catalogue prices are XOF, but a customer paying by card settles in their
   * own currency — showing FCFA on the payment step would name a figure that
   * never appears on their statement. The server owns the conversion, so it is
   * asked rather than approximated here.
   */
  useEffect(() => {
    if (screen !== 'pay' || !pack?.id) { setQuote(null); return; }
    let alive = true;
    paymentMethods(country, pack.id)
      .then((r) => {
        if (!alive) return;
        setQuote(r.quote ?? null);
        setDialable(r.dialable ?? []);
      })
      .catch(() => alive && setQuote(null));
    return () => { alive = false; };
  }, [screen, pack?.id, country]);

  /**
   * Pulls everything the signed-in account owns.
   *
   * The subscription, orders and points are all server state now — the app
   * holds no authoritative copy, so a purchase made elsewhere, an expiry, or a
   * refund shows up here without the app having to guess.
   */
  const refreshAccount = React.useCallback(async () => {
    const [account, orders] = await Promise.all([
      me().catch(() => null),
      myOrders(i18n.language?.slice(0, 2)).catch(() => null),
    ]);
    if (account) {
      setMyNumber(account.msisdn || '');
      setPhone((p) => p || account.msisdn || '');
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
    if (orders) {
      setPoints(orders.points ?? 0);
      setHistory((orders.orders ?? []).map((o) => toHistoryRow(o, t)));
    }
  }, [t]);

  // Catalogue and locations are public, so they load before sign-in — the
  // plans and packs are browsable without an account.
  useEffect(() => {
    let alive = true;
    const lang = i18n.language?.slice(0, 2) || 'en';
    Promise.all([
      loadStoredLanguage(),
      AsyncStorage.multiGet([SEEN_ONBOARDING, VPN_ADDED_STORE, LAST_BUY_STORE]).catch(() => []),
      loadSession().catch(() => null),
      fetchCatalogue(lang).catch(() => null),
      vpnServers().catch(() => null),
    ]).then(async ([, pairs, token, catalogueData, servers]) => {
      if (!alive) return;
      const stored = Object.fromEntries(pairs || []);
      if (stored[SEEN_ONBOARDING]) { setScreen('welcome'); setAuthFrom('welcome'); }
      try {
        setVpnAdded(JSON.parse(stored[VPN_ADDED_STORE] || '[]'));
        if (stored[LAST_BUY_STORE]) setLastBuy(JSON.parse(stored[LAST_BUY_STORE]));
      } catch {
        // Corrupt record — start clean rather than block launch.
      }
      if (catalogueData) setCat(catalogueData);
      else setCatFailed(true);
      if (servers) setLocations(servers.servers ?? []);

      // A stored session skips sign-in on relaunch, but only if it still works:
      // the token may have expired or been signed out on another device.
      if (token) {
        await refreshAccount().catch(() => {});
        if (alive) setScreen('home');
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

  if (!fontsLoaded || !booted) return null;

  const momoName = carrier === 'MTN' ? 'MTN MoMo' : carrier + ' Money';
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
    setPaying(true);
    setPayError(null);
    try {
      const started = await startCheckout({
        productId: pack.id,
        country,
        // The wallet charged is always the buyer's own. Sending the recipient's
        // number here would push the approval prompt to them instead.
        msisdn: isMomo ? myNumber || phone : undefined,
        // Only meaningful when topping up someone else's line.
        recipientMsisdn: !isVpn && service !== 'esim' && phone !== myNumber ? phone : undefined,
        // The picker's value: delivery needs the recipient's dialling code, and
        // it is not always the buyer's.
        recipientCountry,
        email: emailOk ? email.trim() : undefined,
        instrument: isDial ? 'dial' : undefined,
        carrier: isDial ? method.carrier : undefined,
      });
      setOrder(started);

      if (started.action === 'redirect' && started.url) {
        await WebBrowser.openBrowserAsync(started.url).catch(() => {});
      }

      const final = await waitForOrder(started.orderId);
      if (final.status !== 'delivered') {
        setPayError(final.failureReason || `order_${final.status}`);
        return;
      }

      // Points, history and subscription all come back from the server rather
      // than being incremented locally, so the app cannot drift from the books.
      await refreshAccount();

      // Remembered only on success, and only for the things worth repeating —
      // a VPN plan or an eSIM is not a habitual purchase.
      if (!isVpn && service !== 'esim' && pack?.id) {
        const repeat = {
          productId: pack.id,
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
      }

      setOrder(null);
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
    } finally {
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
   * Networks available on the recipient's line. Only Côte d'Ivoire has prefix
   * hints, because that is the only numbering plan we actually hold.
   */
  const networkOptions =
    recipientCountry === 'CI'
      ? CARRIERS
      : networksFor(recipientCountry).map((name) => ({ name, prefix: null }));

  // The deal tile and the button under it must name the same catalogue line.
  const deal = (cat?.data ?? []).find((d) => d.bonus) ?? cat?.data?.[0] ?? null;

  // Airtime and data are a separate SKU on every network, so the catalogue
  // carries one row per carrier. Showing them all put three "150 MB" tiles
  // under an "MTN" heading; the list is the selected network's only.
  const packs =
    (service === 'airtime' ? cat?.airtime : cat?.data)
      ?.filter((p) => !p.network || p.network === carrier)
      .map(toPack) ?? [];
  const goBuy = (svc) => { setService(svc); setForSelf(true); setScreen('recipient'); };
  const openPack = (p) => { setPack(p); setScreen('pay'); };
  const showNav = TAB_SCREENS.includes(screen);

  return (
    // Top inset is applied once here; the tab bar owns the bottom inset so its
    // background still bleeds past the home indicator.
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top, paddingBottom: showNav ? 0 : insets.bottom }}>
      <StatusBar barStyle="dark-content" />

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
              {detect(phone) ? <Text style={{ color: C.accent, fontSize: 12, marginTop: 6, fontFamily: F.body }}>{t('auth.detected', { carrier: detect(phone) })}</Text> : null}
            </View>
            <Btn
              label={verifying ? t('auth.verifying') : t('auth.sendCode')}
              disabled={digits.length < 8 || verifying}
              onPress={async () => {
                setCarrier(detect(phone) || carrier);
                setOtp('');
                setOtpError(null);
                setVerifying(true);
                try {
                  await requestCode(phone, dialCountry);
                  setScreen('otp');
                } catch (e) {
                  setOtpError(e instanceof ApiError ? e.code : 'network_error');
                } finally {
                  setVerifying(false);
                }
              }}
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
            <TextInput
              style={[st.input, { fontSize: 32, fontFamily: F.heading, letterSpacing: 16, textAlign: 'center', minHeight: 64 }]}
              value={otp}
              onChangeText={(v) => { setOtp(v.replace(/\D/g, '').slice(0, 6)); setOtpError(null); }}
              keyboardType="number-pad" placeholder="000000" maxLength={6}
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
          </View>
        </View>
      )}

      {screen === 'home' && (
        <HomeScreen
          points={points}
          history={history}
          deal={deal ? toPack(deal) : null}
          lastBuy={lastBuy}
          // Straight to payment: the pack, the line and the wallet are all
          // known, so there is nothing left to ask.
          onRepeat={() => {
            const p = (cat?.[lastBuy.service] ?? []).find((x) => x.id === lastBuy.productId);
            if (!p) return; // withdrawn from the catalogue since
            setService(lastBuy.service);
            setCarrier(lastBuy.carrier);
            setPhone(lastBuy.recipient);
            setRecipientCountry(lastBuy.recipientCountry);
            if (lastBuy.methodId) setPay(lastBuy.methodId);
            setPack(toPack(p));
            setPayError(null);
            setScreen('pay');
          }}
          onBuy={goBuy}
          // The deal has to be a real catalogue line: checkout buys a product id,
          // and a hand-built pack has nothing to charge against.
          onDailyDeal={() => {
            if (!deal) return;
            setService('data');
            setPack(toPack(deal));
            setScreen('pay');
          }}
          onVpn={() => setScreen(vpn ? 'vpn' : 'vpnPlans')}
          hasVpn={!!vpn}
        />
      )}

      {screen === 'history' && (
        <HistoryScreen history={history} onBuy={() => goBuy('data')} />
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
          onLanguage={() => setScreen('language')}
          onSignOut={signOut}
        />
      )}

      {screen === 'recipient' && (
        <ScrollView style={{ flex: 1 }}>
          <BackHeader onBack={() => setScreen('home')} label={t('recipient.step')} />
          <View style={{ padding: 20, gap: 20 }}>
            <Text style={st.h2}>{t('recipient.title')}</Text>
            <Toggle2
              opts={[{ label: t('recipient.forMyself'), val: true }, { label: t('recipient.someoneElse'), val: false }]}
              value={forSelf}
              onChange={(v) => { setForSelf(v); setPhone(v ? myNumber : ''); }}
            />
            <View>
              <Text style={st.fieldLabel}>{t('auth.phoneLabel')}</Text>
              {/* The recipient can be in another country — a top-up sent home
                  from abroad — so this picker is the delivery country and is
                  kept separate from the one that decides the payment rail. */}
              <PhoneInput
                value={phone}
                onChangeText={(v) => { setPhone(v); const d = detect(v); if (d) setCarrier(d); }}
                country={recipientCountry}
                onCountryChange={setRecipientCountry}
                placeholder={t('auth.phonePlaceholder')}
              />
            </View>
            <View>
              <Text style={st.fieldLabel}>{t('recipient.networkLabel')}{detect(phone) ? <Text style={{ color: C.accent }}>{t('recipient.detectedSuffix')}</Text> : null}</Text>
              {/* Networks follow the recipient's country. These used to be the
                  three Ivorian carriers with Ivorian prefix hints regardless,
                  so a +226 number was offered Orange/MTN/Moov "PRÉFIXE 07".
                  Prefix hints only exist for the home market, so they are only
                  shown there. */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {networkOptions.map((c) => (
                  <Pressable key={c.name} onPress={() => setCarrier(c.name)} style={[st.carrierCell, carrier === c.name && { borderColor: C.accent, backgroundColor: C.accent100 }]}>
                    <Text style={{ fontFamily: F.heading, fontSize: 14, color: C.text }}>{c.name}</Text>
                    {c.prefix ? (
                      <Text style={[st.subText, { fontSize: 10 }]}>{t('recipient.prefix', { prefix: c.prefix })}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>
            <Btn label={t('common.continue')} disabled={digits.length < 8} onPress={() => setScreen('packs')} />
          </View>
        </ScrollView>
      )}

      {screen === 'packs' && (
        <ScrollView style={{ flex: 1 }}>
          <BackHeader onBack={() => setScreen('recipient')} label={t('packs.step')} />
          <View style={{ padding: 20, gap: 16 }}>
            <View style={st.rowBetween}>
              <Text style={st.h2}>{service === 'airtime' ? t('packs.airtimeTitle') : t('packs.dataTitle')}</Text>
              <Tag kind="neutral">{carrier}</Tag>
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
            {service === 'airtime' && (
              <Pressable
                onPress={() => setScreen('amount')}
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
          onConfirm={(amt) => openPack({
            n: fmtN(amt) + ' FCFA',
            v: t('packs.airtimeCredit'),
            p: amt,
            b: amt >= 5000 ? '+10% BONUS' : amt >= 1000 ? '+5% BONUS' : null,
          })}
        />
      )}

      {screen === 'pay' && (
        <ScrollView style={{ flex: 1 }}>
          <BackHeader onBack={() => setScreen(isVpn ? 'vpnPlans' : service === 'esim' ? 'esimPlans' : 'packs')} label={t('pay.step')} />
          <View style={{ padding: 20, gap: 18 }}>
            <View style={{ borderWidth: 2, borderColor: C.text, padding: 16 }}>
              <Kicker>{t('pay.summary')}</Kicker>
              <SummaryRow k={t('pay.to')} v={isVpn ? t('pay.vpnSubscription') : service === 'esim' ? t('pay.newEsim') : (forSelf ? t('pay.myNumber') : '') + phone} />
              {!isVpn && <SummaryRow k={t('pay.network')} v={carrier} />}
              <SummaryRow k={t('pay.pack')} v={pack ? pack.n : '—'} />
              {/* The fee is broken out rather than folded into the total. It is a
                  small amount on a familiar face value, so a customer who sees
                  1 020 F charged for a 1 000 F top-up with no explanation reads it
                  as being shortchanged. Shown only when there is one — every
                  zero-fee line would just be noise on eSIM and VPN. */}
              {quote && quote.feeXof > 0 && (
                <>
                  <SummaryRow k={t('pay.subtotal')} v={formatMoney(quote.subtotal, quote.currency)} />
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
                  placeholder={t('pay.emailPlaceholder')}
                />
                <Text style={[st.subText, { marginTop: 6 }]}>
                  {t('pay.emailNote', { phone })}
                </Text>
              </View>
            )}
            <View style={{ gap: 8 }}>
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
                      : t('pay.momoSub', { phone: myNumber || phone }),
                }))
                .map((m) => (
                <Pressable key={m.id} onPress={() => setPay(m.id)} style={[st.payOpt, method?.id === m.id && { borderColor: C.accent, backgroundColor: C.accent100 }]}>
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
            </View>
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
              </View>
            )}

            {order?.action === 'approve_on_handset' && paying && (
              <View style={{ borderWidth: 2, borderColor: C.text, padding: 16, gap: 8 }}>
                <Kicker>{t('pay.authorize', { provider: method?.title ?? momoName })}</Kicker>
                <Text style={st.subText}>{t('pay.approveOnHandset', { phone })}</Text>
                <Text style={st.subText}>{t('pay.waitingNote', { provider: method?.title ?? momoName })}</Text>
              </View>
            )}

            {/* A custom airtime amount is not a catalogue line, and POST /checkout
                only takes a product id — there is no variable-amount path on the
                API yet, so this says so instead of failing at the last step. */}
            {!pack?.id && (
              <View style={{ borderWidth: 2, borderColor: C.accent, padding: 12 }}>
                <Text style={{ color: C.accent700, fontFamily: F.semi, fontSize: 13 }}>
                  {t('pay.customUnavailable')}
                </Text>
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
              disabled={paying || !pack?.id || !payment.supported || (isVpn && !emailOk)}
              onPress={doPay}
            />
          </View>
        </ScrollView>
      )}

      {screen === 'success' && (
        <ScrollView style={{ flex: 1 }}>
          <View style={{ backgroundColor: C.accent, padding: 20, paddingTop: 36 }}>
            <Kicker light>{t('success.kicker')}</Kicker>
            <Text style={{ color: C.bg, fontFamily: F.heading, fontSize: 56, letterSpacing: -1 }}>{t('success.title')}</Text>
          </View>
          <View style={{ padding: 20, gap: 16 }}>
            <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
              <SummaryRow k={t('pay.to')} v={service === 'esim' ? t('pay.newEsim') : phone} />
              <SummaryRow k={t('pay.pack')} v={pack ? pack.n + ' · ' + carrier : '—'} />
              <SummaryRow k={t('success.paid')} v={pack ? fmt(pack.p) : '—'} bold />
            </View>
            <Tag>{t('success.pointsEarned', { count: earnPts })}</Tag>
            {service === 'esim' && (
              <View style={{ borderWidth: 2, borderColor: C.text, padding: 16, gap: 12 }}>
                <Kicker>{t('success.esimKicker')}</Kicker>
                <Text style={st.subText}>{t('success.esimBody')}</Text>
                <Btn
                  label={t('success.esimCta')}
                  onPress={() => {
                    setEsims((e) => [{ id: Date.now(), label: pack.n, iccid: 'ICCID ···· ' + (1000 + (Date.now() % 9000)), status: 'active', dataLeft: pack.n.split('·').pop().trim(), renew: 'Valid from today' }, ...e]);
                    setScreen('esim');
                  }}
                />
              </View>
            )}
            <Btn label={t('common.done')} onPress={() => setScreen('home')} />
            {service !== 'esim' && <Btn variant="secondary" label={t('success.buyAnother')} onPress={() => setScreen('packs')} />}
          </View>
        </ScrollView>
      )}

      {screen === 'esim' && (
        <ScrollView style={{ flex: 1 }}>
          <View style={[st.backHeader, { justifyContent: 'space-between' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Btn variant="ghost" label="←" onPress={() => setScreen('profile')} />
              <Text style={st.h2}>{t('esim.title')}</Text>
            </View>
            <Btn label={t('esim.newCta')} onPress={() => { setCountrySearch(''); setScreen('esimCountry'); }} style={{ minHeight: 36 }} />
          </View>
          <View style={{ padding: 20, gap: 12 }}>
            {esims.length === 0 ? (
              <EmptyState
                art={NoEsim}
                title={t('empty.esimTitle')}
                body={t('empty.esimBody')}
                cta={t('empty.esimCta')}
                onCta={() => { setCountrySearch(''); setScreen('esimCountry'); }}
              />
            ) : null}
            {esims.map((e) => (
              <View key={e.id} style={{ borderWidth: 2, borderColor: C.text, padding: 14, gap: 10 }}>
                <View style={st.rowBetween}>
                  <Text style={{ fontFamily: F.heading, fontSize: 16, color: C.text }}>{e.label}</Text>
                  <Tag kind={e.status === 'active' ? 'accent' : 'neutral'}>{e.status === 'active' ? t('common.active') : t('common.paused')}</Tag>
                </View>
                <View style={[st.rowBetween, { borderBottomWidth: 1, borderColor: C.rule, paddingBottom: 8 }]}>
                  <Text style={st.subText}>{e.iccid}</Text>
                  <Text style={st.subText}>{e.renew}</Text>
                </View>
                <View style={st.rowBetween}>
                  <Text style={{ fontFamily: F.body, fontSize: 13, color: C.text }}>
                    <Text style={{ fontFamily: F.semi }}>{e.dataLeft}</Text> <Text style={{ color: C.muted }}>{t('esim.dataLeft')}</Text>
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <Btn variant="ghost" label={t('esim.topUp')} onPress={() => { setService('data'); setForSelf(true); setScreen('packs'); }} />
                    <Btn variant="secondary" label={e.status === 'active' ? t('esim.pause') : t('esim.activate')} onPress={() => setEsims((list) => list.map((x) => (x.id === e.id ? { ...x, status: x.status === 'active' ? 'paused' : 'active' } : x)))} />
                  </View>
                </View>
              </View>
            ))}
            <Text style={st.subText}>{t('esim.note')}</Text>
          </View>
        </ScrollView>
      )}

      {screen === 'esimCountry' && (
        <ScrollView style={{ flex: 1 }}>
          <BackHeader onBack={() => setScreen('esim')} label={t('esim.destinationStep')} />
          <View style={{ padding: 20 }}>
            <Text style={st.h2}>{t('esim.destinationTitle')}</Text>
            <Text style={[st.subText, { marginBottom: 14 }]}>{t('esim.destinationSub')}</Text>
            <TextInput style={[st.input, { marginBottom: 14 }]} value={countrySearch} onChangeText={setCountrySearch} placeholder={t('esim.searchPlaceholder')} />
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
                    setEsimCountry(c.name);
                    setEsimPlanList([]);
                    setScreen('esimPlans');
                    // Plans are per-destination, so they are fetched on demand
                    // rather than shipped inside the catalogue payload.
                    const res = await fetchEsimPlans(c.name, i18n.language?.slice(0, 2) || 'en').catch(() => null);
                    if (res) setEsimPlanList(res.plans.map(toPack));
                  }}
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
        <ScrollView style={{ flex: 1 }}>
          <BackHeader onBack={() => setScreen('esimCountry')} label={t('esim.plansStep')} />
          <View style={{ padding: 20 }}>
            <View style={st.rowBetween}>
              <Text style={st.h2}>{t('esim.plansTitle')}</Text>
              <Tag kind="neutral">{esimCountry}</Tag>
            </View>
            <Text style={[st.subText, { marginBottom: 16 }]}>{t('esim.plansSub')}</Text>
            <PackGrid
              items={esimPlanList}
              onSelect={(p) => { setService('esim'); setCarrier(p.carrier); openPack(p); }}
              loading={esimPlanList.length === 0 && cat !== null}
              title={t('empty.packsTitle')}
              body={t('empty.packsBody')}
            />
          </View>
        </ScrollView>
      )}

      {showNav && <TabBar items={navItems(t)} value={screen} onChange={setScreen} insetBottom={insets.bottom} />}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <TopUp />
    </SafeAreaProvider>
  );
}
