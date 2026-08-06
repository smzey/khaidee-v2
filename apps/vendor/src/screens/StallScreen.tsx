import { useEffect, useState } from 'react';
import type React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FloatingToast } from '../components/FloatingToast';
import { setStallOpen, updateStall } from '../api';
import type { Session, Stall } from '../session';
import { theme } from '../theme';

export function StallScreen({
  session,
  onBack,
  onStallChanged,
}: {
  session: Session;
  onBack: () => void;
  onStallChanged: (stall: Stall) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [name, setName] = useState(session.stall.name);
  const [promptpayId, setPromptpayId] = useState(session.stall.promptpayId ?? '');
  const [pin, setPin] = useState('');

  useEffect(() => {
    setName(session.stall.name);
    setPromptpayId(session.stall.promptpayId ?? '');
  }, [session.stall.name, session.stall.promptpayId]);

  const toggleOpen = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const stall = await setStallOpen(session.token, !session.stall.isOpen);
      onStallChanged(stall);
    } catch {
      setError('Could not update the stall.');
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    const trimmedName = name.trim();
    setSavingProfile(true);
    setError(null);
    setSaved(null);
    try {
      const stall = await updateStall(session.token, {
        name: trimmedName,
        promptpayId: promptpayId.trim() ? promptpayId.trim() : null,
      });
      onStallChanged(stall);
      setSaved('Stall details saved.');
    } catch (caught) {
      setError((caught as { message?: string }).message ?? 'Could not save stall details.');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePin = async () => {
    setSavingPin(true);
    setError(null);
    setSaved(null);
    try {
      const stall = await updateStall(session.token, { pin: pin.trim() });
      onStallChanged(stall);
      setPin('');
      setSaved('PIN updated.');
    } catch (caught) {
      setError((caught as { message?: string }).message ?? 'Could not update PIN.');
    } finally {
      setSavingPin(false);
    }
  };

  const profileReady = name.trim().length > 0;
  const pinReady = /^\d{4,8}$/.test(pin.trim());

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
      >
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mark}>STALL</Text>
          <Text style={styles.title} numberOfLines={1}>
            {session.stall.name}
          </Text>
        </View>
        <Pressable onPress={onBack} hitSlop={12} testID="stall-back">
          <Text style={styles.home}>Home</Text>
        </Pressable>
      </View>

      <View style={styles.statusPanel}>
        <View>
          <Text style={styles.label}>Customer ordering</Text>
          <Text style={styles.state}>{session.stall.isOpen ? 'Open' : 'Closed'}</Text>
        </View>
        <Pressable
          style={[styles.switch, session.stall.isOpen && styles.switchOn]}
          onPress={toggleOpen}
          disabled={busy}
          testID="stall-open-toggle"
        >
          {busy ? (
            <ActivityIndicator color={session.stall.isOpen ? theme.white : theme.ink} />
          ) : (
            <View
              style={[
                styles.knob,
                session.stall.isOpen && styles.knobOn,
              ]}
            />
          )}
        </Pressable>
      </View>

      <View style={styles.form}>
        <Text style={styles.groupTitle}>Details</Text>
        <Field
          label="Stall name"
          value={name}
          onChangeText={setName}
          placeholder="67 Noodle"
        />
        <Field
          label="PromptPay"
          value={promptpayId}
          onChangeText={setPromptpayId}
          placeholder="0812345678"
          inputMode="numeric"
        />
        <Pressable
          style={[styles.button, (!profileReady || savingProfile) && styles.buttonOff]}
          onPress={saveProfile}
          disabled={!profileReady || savingProfile}
          testID="stall-save-profile"
        >
          {savingProfile ? (
            <ActivityIndicator color={theme.white} />
          ) : (
            <Text style={styles.buttonText}>Save details</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.form}>
        <Text style={styles.groupTitle}>PIN</Text>
        <Field
          label="New PIN"
          value={pin}
          onChangeText={(value) => setPin(value.replace(/[^0-9]/g, ''))}
          placeholder="4 to 8 digits"
          inputMode="numeric"
          secureTextEntry
          maxLength={8}
        />
        <Pressable
          style={[styles.button, (!pinReady || savingPin) && styles.buttonOff]}
          onPress={savePin}
          disabled={!pinReady || savingPin}
          testID="stall-save-pin"
        >
          {savingPin ? (
            <ActivityIndicator color={theme.white} />
          ) : (
            <Text style={styles.buttonText}>Update PIN</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.info}>
        <Text style={styles.label}>Customer path</Text>
        <Text style={styles.value}>/s/{session.stall.slug}</Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.label}>Stall ID</Text>
        <Text style={styles.value}>{session.stall.id}</Text>
      </View>

      </ScrollView>
      <FloatingToast
        message={error ?? saved}
        tone={error ? 'error' : 'success'}
        onDone={() => {
          setError(null);
          setSaved(null);
        }}
      />
    </View>
  );
}

function Field({
  label,
  ...props
}: {
  label: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        style={[styles.input, props.style]}
        placeholderTextColor={theme.muted}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  scroll: { flex: 1 },
  body: { padding: 18, paddingBottom: 42, maxWidth: 620, width: '100%', alignSelf: 'center' },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 20,
  },
  mark: {
    fontSize: 12,
    letterSpacing: 4,
    color: theme.muted,
    fontWeight: '800',
    marginBottom: 8,
  },
  title: { fontSize: 30, lineHeight: 35, fontWeight: '800', color: theme.ink },
  home: { fontSize: 14, color: theme.muted, fontWeight: '800' },
  statusPanel: {
    minHeight: 110,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 12,
  },
  form: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 14,
    marginBottom: 12,
  },
  groupTitle: { fontSize: 20, fontWeight: '800', color: theme.ink, marginBottom: 14 },
  label: {
    fontSize: 12,
    color: theme.muted,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 15,
    fontSize: 18,
    color: theme.ink,
    backgroundColor: theme.white,
    marginBottom: 14,
  },
  button: {
    backgroundColor: theme.stool,
    minHeight: 54,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: theme.white, fontSize: 16, fontWeight: '800' },
  state: { fontSize: 30, fontWeight: '800', color: theme.ink },
  switch: {
    width: 76,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.ink,
    backgroundColor: theme.white,
    padding: 4,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: theme.stool, borderColor: theme.stool },
  knob: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.ink,
  },
  knobOn: { alignSelf: 'flex-end', backgroundColor: theme.white },
  info: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 14,
    marginBottom: 10,
  },
  value: { fontSize: 17, color: theme.ink, fontWeight: '700' },
  saved: {
    backgroundColor: theme.stool,
    color: theme.white,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
    fontWeight: '800',
  },
  error: {
    backgroundColor: theme.chilli,
    color: theme.white,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
  },
});
