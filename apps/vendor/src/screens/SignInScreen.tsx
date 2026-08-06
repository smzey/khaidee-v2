import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError, signIn } from '../api';
import { FloatingToast } from '../components/FloatingToast';
import { clearSession, type Session, saveSession } from '../session';
import { theme } from '../theme';

const cleanSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);

/**
 * Deliberately the smallest screen in the app. A vendor signs in about once a
 * month — the token lasts one — so this exists to be got through, not to be
 * designed. Everything worth building is on the other side of it.
 */
export function SignInScreen({
  onCreate,
  onSignedIn,
}: {
  onCreate: () => void;
  onSignedIn: (s: Session) => void;
}) {
  const [slug, setSlug] = useState('');
  const [pin, setPin] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const typed = slug.trim();
      const normalized = cleanSlug(typed);
      const result = await signIn(normalized || typed, pin.trim()).catch((caught) => {
        if (!normalized || normalized === typed) throw caught;
        return signIn(typed, pin.trim());
      });
      const session: Session = { token: result.token, stall: result.vendor };
      if (rememberMe) await saveSession(session);
      else await clearSession();
      onSignedIn(session);
    } catch (caught) {
      const apiError = caught as ApiError;
      setError(
        apiError.status === 401
          ? 'That stall name and PIN do not match.'
          : apiError.message,
      );
      setBusy(false);
    }
  };

  const ready = slug.trim().length > 0 && pin.trim().length >= 4;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.body}>
        <Text style={styles.mark}>KHAIDEE</Text>
        <Text style={styles.title}>Open your stall</Text>

        <Text style={styles.label}>Stall name</Text>
        <TextInput
          style={styles.input}
          value={slug}
          onChangeText={setSlug}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Your stall name"
          placeholderTextColor={theme.muted}
          inputMode="text"
          testID="slug"
        />

        <Text style={styles.label}>PIN</Text>
        <TextInput
          style={styles.input}
          value={pin}
          onChangeText={setPin}
          secureTextEntry
          inputMode="numeric"
          maxLength={8}
          placeholder="••••"
          placeholderTextColor={theme.muted}
          testID="pin"
        />

        <Pressable
          style={styles.remember}
          onPress={() => setRememberMe((current) => !current)}
          hitSlop={8}
        >
          <View style={[styles.box, rememberMe && styles.boxOn]}>
            {rememberMe && <Text style={styles.check}>✓</Text>}
          </View>
          <Text style={styles.rememberText}>Remember me on this phone</Text>
        </Pressable>

        <Pressable
          style={[styles.button, !ready && styles.buttonOff]}
          onPress={submit}
          disabled={!ready || busy}
          testID="signin"
        >
          {busy ? (
            <ActivityIndicator color={theme.white} />
          ) : (
            <Text style={styles.buttonText}>Start the day</Text>
          )}
        </Pressable>

        <Pressable onPress={onCreate} hitSlop={10}>
          <Text style={styles.create}>Create a new stall</Text>
        </Pressable>
      </View>
      <FloatingToast
        message={error}
        tone="error"
        onDone={() => setError(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  body: { flex: 1, justifyContent: 'center', padding: 24, maxWidth: 480, width: '100%', alignSelf: 'center' },
  mark: {
    fontSize: 12,
    letterSpacing: 4,
    color: theme.muted,
    fontWeight: '700',
    marginBottom: 8,
  },
  title: { fontSize: 30, fontWeight: '800', color: theme.ink, marginBottom: 28 },
  label: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: theme.muted,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 16,
    fontSize: 18,
    color: theme.ink,
    backgroundColor: theme.white,
    marginBottom: 18,
  },
  button: {
    backgroundColor: theme.stool,
    paddingVertical: 18,
    borderRadius: 2,
    alignItems: 'center',
    marginTop: 6,
    minHeight: 58,
    justifyContent: 'center',
  },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: theme.white, fontSize: 17, fontWeight: '700' },
  error: {
    backgroundColor: theme.chilli,
    color: theme.white,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  remember: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  box: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: theme.ink,
    backgroundColor: theme.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: theme.ink },
  check: { color: theme.white, fontSize: 16, fontWeight: '800', lineHeight: 18 },
  rememberText: { color: theme.ink, fontSize: 15, fontWeight: '700' },
  hint: { marginTop: 20, fontSize: 12, color: theme.muted, textAlign: 'center' },
  create: {
    marginTop: 18,
    fontSize: 15,
    color: theme.stool,
    textAlign: 'center',
    fontWeight: '800',
  },
});
