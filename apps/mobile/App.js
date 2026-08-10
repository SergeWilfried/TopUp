// TOPUP — airtime, data & eSIM purchase app (Expo / React Native)
// Faithful port of the HTML design prototype (Modernist design system).
// Navigation is a simple screen state machine; swap for react-navigation if preferred.
// Tab destinations live in ./screens; shared primitives in ./ui; catalogue in ./data.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Linking, StatusBar, Alert } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { useFonts, Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold } from '@expo-google-fonts/archivo';
import { useTranslation } from 'react-i18next';
import './i18n';
import { loadStoredLanguage } from './i18n';

import { C, F, fmt, fmtN, CARRIERS, detect, ussdFor, dataPacks, airtimePacks, esimCountries, esimPlansFor, navItems, TAB_SCREENS, SEEN_ONBOARDING, VPN_STORE } from '@topup/core';
import { Btn, BackHeader, Kicker, Tag, PackGrid, SummaryRow, Toggle2, TabBar, Brand, st } from './ui';
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

// Seeded demo data. Sign-out restores these so the next session never inherits
// the previous account's history, points, eSIMs or VPN.
const SEED_ESIMS = [
  { id: 1, label: 'Orange · Personal', iccid: 'ICCID ···· 8842', status: 'active', dataLeft: '2.4 GB', renew: 'Renews Sep 01' },
  { id: 2, label: 'Travel · West Africa', iccid: 'ICCID ···· 3317', status: 'paused', dataLeft: '4.8 GB', renew: 'Expires Aug 21' },
];
const SEED_HISTORY = [
  { desc: '1 GB · 7 days', meta: 'AUG 06 · Orange · 07 09 55 12 34', amount: '500 FCFA', status: 'DELIVERED' },
  { desc: '2 000 FCFA airtime', meta: 'AUG 04 · MTN · 05 44 21 78 90', amount: '2 000 FCFA', status: 'DELIVERED' },
  { desc: '150 MB · 24 h', meta: 'AUG 02 · Moov · 01 02 33 47 65', amount: '200 FCFA', status: 'DELIVERED' },
  { desc: '3 GB · 30 days', meta: 'JUL 28 · Orange · 07 09 55 12 34', amount: '1 500 FCFA', status: 'DELIVERED' },
];
const SEED_POINTS = 1240;
const SEED_PHONE = '07 09 55 12 34';

function TopUp() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts({ Archivo_400Regular, Archivo_600SemiBold, Archivo_800ExtraBold });
  const [screen, setScreen] = useState('onboarding');
  const [authFrom, setAuthFrom] = useState('onboarding'); // where "back" from sign-in returns to
  const [service, setService] = useState('data');
  const [forSelf, setForSelf] = useState(true);
  const [phone, setPhone] = useState(SEED_PHONE);
  const [carrier, setCarrier] = useState('Orange');
  const [pack, setPack] = useState(null);
  const [pay, setPay] = useState(null); // method id, chosen from what the region supports
  const [paying, setPaying] = useState(false);
  const [ussdStep, setUssdStep] = useState(false);
  const [copied, setCopied] = useState(false);
  const [points, setPoints] = useState(SEED_POINTS);
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState(null); // error code, or null
  const [verifying, setVerifying] = useState(false);
  const [email, setEmail] = useState(''); // where VPN configs get delivered
  const [esimCountry, setEsimCountry] = useState('Côte d’Ivoire');
  const [countrySearch, setCountrySearch] = useState('');
  const [esims, setEsims] = useState(SEED_ESIMS);
  const [history, setHistory] = useState(SEED_HISTORY);
  const [booted, setBooted] = useState(false);
  const [vpn, setVpn] = useState(null); // active VPN subscription, once purchased
  const [vpnLoc, setVpnLoc] = useState(null); // location being installed (setup step 02)
  const [vpnAdded, setVpnAdded] = useState([]); // location codes exported on this phone
  const [vpnFresh, setVpnFresh] = useState(false); // show the post-purchase banner once
  const [recoverFrom, setRecoverFrom] = useState('vpnPlans'); // where the recovery page returns to

  // Returning devices skip the intro, and pick their VPN back up where it was.
  useEffect(() => {
    let alive = true;
    Promise.all([
      loadStoredLanguage(),
      AsyncStorage.multiGet([SEEN_ONBOARDING, VPN_STORE]).catch(() => []),
      // A stored session skips sign-in on relaunch.
      loadSession().catch(() => null),
    ])
      .then(([, pairs, token]) => {
        if (token && alive) setScreen('home');
        if (!alive) return;
        const stored = Object.fromEntries(pairs || []);
        if (stored[SEEN_ONBOARDING]) { setScreen('welcome'); setAuthFrom('welcome'); }
        try {
          const saved = stored[VPN_STORE] && JSON.parse(stored[VPN_STORE]);
          if (saved?.vpn?.token) {
            setVpn(saved.vpn);
            setVpnAdded(saved.added || []);
          }
        } catch {
          // Corrupt record — start clean rather than block launch.
        }
        setBooted(true);
      });
    return () => { alive = false; };
  }, []);

  // Mirror the subscription to disk whenever it moves. Gated on `booted` so the
  // initial empty state can never overwrite what we just read back.
  useEffect(() => {
    if (!booted) return;
    if (vpn) AsyncStorage.setItem(VPN_STORE, JSON.stringify({ vpn, added: vpnAdded })).catch(() => {});
    else AsyncStorage.removeItem(VPN_STORE).catch(() => {});
  }, [booted, vpn, vpnAdded]);

  if (!fontsLoaded || !booted) return null;

  const momoName = carrier === 'MTN' ? 'MTN MoMo' : carrier + ' Money';
  // Rails are regional — a Stripe button in Abidjan cannot be charged, because
  // Stripe does not settle XOF. Ask where we are before offering anything.
  const country = detectCountry({ msisdn: phone });
  const payment = methodsFor(country);
  // Default to the first method the region actually offers.
  const method = payment.methods.find((m) => m.id === pay) ?? payment.methods[0] ?? null;
  const isMomo = method?.kind === 'momo';
  const earnPts = pack ? Math.floor(pack.p / 100) : 0;
  const digits = phone.replace(/\D/g, '');
  const isVpn = service === 'vpn';
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const finishPay = () => {
    setPaying(true);
    setTimeout(() => {
      const isEsim = service === 'esim';
      setHistory((h) => [
        {
          desc: isVpn || isEsim ? pack.n : pack.n + ' · ' + pack.v,
          meta: 'AUG 08 · ' + (isVpn ? 'VPN · ' + email.trim() : carrier + (isEsim ? ' · New eSIM' : ' · ' + phone)),
          amount: fmt(pack.p),
          status: t('common.delivered'),
        },
        ...h,
      ]);
      setPoints((p) => p + earnPts);
      setPaying(false);
      setUssdStep(false);
      setCopied(false);
      if (isVpn) {
        const renewing = !!vpn;
        setVpn((v) => ({
          plan: pack.n + ' VPN',
          // Extend from the current end date when it is still in the future,
          // otherwise from today — a lapsed customer does not get free days back.
          expiresAt: Math.max(v?.expiresAt ?? 0, Date.now()) + pack.days * 86400000,
          email: v?.email || email.trim(),
          // The token seeds every config, so reissuing it would silently break
          // every tunnel the customer already installed. A renewal keeps it.
          token: v?.token || 'tk_' + Date.now().toString(36),
        }));
        // Renewing changes nothing they have to re-scan, so don't send them
        // back through setup — only a first purchase needs that.
        setVpnFresh(!renewing);
        setScreen(renewing ? 'vpn' : 'vpnLocations');
      } else {
        setScreen('success');
      }
    }, 1400);
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
        onPress: () => {
          setVpn(null);
          setVpnAdded([]);
          setVpnLoc(null);
          setVpnFresh(false);
          setEsims(SEED_ESIMS);
          setHistory(SEED_HISTORY);
          setPoints(SEED_POINTS);
          setPhone(SEED_PHONE);
          setCarrier('Orange');
          setEmail('');
          setPack(null);
          setService('data');
          setPay(null);
          setUssdStep(false);
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
    if (isMomo && !ussdStep) { setUssdStep(true); setCopied(false); return; }
    finishPay();
  };
  const packs = service === 'airtime' ? airtimePacks(t) : dataPacks(t);
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
              <TextInput style={[st.input, { fontSize: 18 }]} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder={t('auth.phonePlaceholder')} />
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
                  await requestCode(phone);
                  setScreen('otp');
                } catch (e) {
                  setOtpError(e instanceof ApiError ? e.code : 'network_error');
                } finally {
                  setVerifying(false);
                }
              }}
            />
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
                  await verifyCode(phone, otp);
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
          onBuy={goBuy}
          onDailyDeal={() => { setService('data'); setPack({ n: '2 GB · Daily deal', v: 'Valid 7 days', p: 800 }); setScreen('pay'); }}
          onVpn={() => setScreen(vpn ? 'vpn' : 'vpnPlans')}
          hasVpn={!!vpn}
        />
      )}

      {screen === 'history' && <HistoryScreen history={history} />}

      {screen === 'rewards' && <RewardsScreen points={points} onRedeem={(cost) => setPoints((p) => p - cost)} />}

      {screen === 'profile' && (
        <ProfileScreen
          carrier={carrier}
          phone={phone}
          esims={esims}
          momoName={momoName}
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
              onChange={(v) => { setForSelf(v); setPhone(v ? SEED_PHONE : ''); }}
            />
            <View>
              <Text style={st.fieldLabel}>{t('auth.phoneLabel')}</Text>
              <TextInput
                style={st.input} value={phone} keyboardType="phone-pad" placeholder={t('auth.phonePlaceholder')}
                onChangeText={(t) => { setPhone(t); const d = detect(t); if (d) setCarrier(d); }}
              />
            </View>
            <View>
              <Text style={st.fieldLabel}>{t('recipient.networkLabel')}{detect(phone) ? <Text style={{ color: C.accent }}>{t('recipient.detectedSuffix')}</Text> : null}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {CARRIERS.map((c) => (
                  <Pressable key={c.name} onPress={() => setCarrier(c.name)} style={[st.carrierCell, carrier === c.name && { borderColor: C.accent, backgroundColor: C.accent100 }]}>
                    <Text style={{ fontFamily: F.heading, fontSize: 14, color: C.text }}>{c.name}</Text>
                    <Text style={[st.subText, { fontSize: 10 }]}>{t('recipient.prefix', { prefix: c.prefix })}</Text>
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
            <PackGrid items={packs} onSelect={openPack} />
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
          onBack={() => setScreen(vpn ? 'vpn' : 'home')}
          onRestore={() => { setRecoverFrom('vpnPlans'); setScreen('vpnRecover'); }}
          onSelect={(plan) => {
            setService('vpn');
            setPack(plan);
            setPay(null);
            setUssdStep(false);
            if (vpn) setEmail(vpn.email); // renewals keep the delivery address
            setScreen('pay');
          }}
        />
      )}

      {screen === 'vpn' && (
        <VpnScreen
          vpn={vpn}
          onBack={() => setScreen('profile')}
          onSetup={() => { setVpnFresh(false); setScreen('vpnLocations'); }}
          onBuy={() => setScreen('vpnPlans')}
          onRestore={() => { setRecoverFrom('vpn'); setScreen('vpnRecover'); }}
        />
      )}

      {screen === 'vpnLocations' && vpn && (
        <VpnLocationsScreen
          added={vpnAdded}
          email={vpn.email}
          justPurchased={vpnFresh}
          onBack={() => { setVpnFresh(false); setScreen('vpn'); }}
          onSelect={(l) => { setVpnLoc(l); setVpnFresh(false); setScreen('vpnSetup'); }}
        />
      )}

      {screen === 'vpnSetup' && vpn && vpnLoc && (
        <VpnSetupScreen
          token={vpn.token}
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
              <SummaryRow k={t('pay.total')} v={pack ? fmt(pack.p) : '—'} bold />
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
                .map((m) =>
                  m.kind === 'momo'
                    ? { id: m.id, name: m.title, sub: t('pay.momoSub', { phone }) }
                    : { id: m.id, name: m.title, sub: t('pay.cardSub') },
                )
                .map((m) => (
                <Pressable key={m.id} onPress={() => { setPay(m.id); setUssdStep(false); }} style={[st.payOpt, method?.id === m.id && { borderColor: C.accent, backgroundColor: C.accent100 }]}>
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
            {isMomo && ussdStep ? (
              <View style={{ borderWidth: 2, borderColor: C.text, padding: 16, gap: 12 }}>
                <Kicker>{t('pay.authorize', { provider: method?.title ?? momoName })}</Kicker>
                <Text style={st.subText}>{t('pay.dialNote')}</Text>
                <View style={[st.rowBetween, { backgroundColor: C.surface, borderWidth: 1, borderColor: C.divider, padding: 12 }]}>
                  <Text style={{ fontFamily: F.heading, fontSize: 22, color: C.text }}>{ussdFor(carrier, pack.p)}</Text>
                  <Btn variant="ghost" label={copied ? t('common.copied') : t('common.copy')} onPress={async () => { await Clipboard.setStringAsync(ussdFor(carrier, pack.p)); setCopied(true); setTimeout(() => setCopied(false), 2000); }} />
                </View>
                <Btn label={paying ? t('pay.waiting') : t('pay.dialCta')} disabled={paying} onPress={() => { Linking.openURL('tel:' + encodeURIComponent(ussdFor(carrier, pack.p))).catch(() => {}); finishPay(); }} />
                <Text style={st.subText}>{t('pay.waitingNote', { provider: method?.title ?? momoName })}</Text>
              </View>
            ) : (
              <Btn
                label={paying
                  ? t('pay.processing')
                  : t(isMomo ? 'pay.confirm' : 'pay.payNow', { amount: pack ? fmt(pack.p) : '' })}
                disabled={paying || (isVpn && !emailOk)}
                onPress={doPay}
              />
            )}
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
            <View style={{ borderTopWidth: 2, borderColor: C.divider }}>
              {esimCountries(t).filter((c) => c.name.toLowerCase().includes(countrySearch.trim().toLowerCase())).map((c) => (
                <Pressable key={c.code} onPress={() => { setEsimCountry(c.name); setScreen('esimPlans'); }} style={({ pressed }) => [st.packRow, pressed && { backgroundColor: C.accent100 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    <View style={{ width: 30, height: 30, borderWidth: 1.5, borderColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: F.heading, fontSize: 11, color: C.text }}>{c.code}</Text>
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
              items={esimPlansFor(esimCountry, t)}
              onSelect={(p) => { setService('esim'); setCarrier(p.carrier); openPack(p); }}
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
