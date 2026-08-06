import { useCallback, useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchQrCard } from '../api';
import { FloatingToast } from '../components/FloatingToast';
import type { Session } from '../session';
import { theme } from '../theme';

type QrMode = 'public' | 'lan';
type QrVariant = {
  label: string;
  orderUrl: string;
  qrDataUrl: string;
  exportDataUrl: string;
};

export function QrScreen({
  session,
  onBack,
}: {
  session: Session;
  onBack: () => void;
}) {
  const [qr, setQr] = useState<{
    variants: Record<QrMode, QrVariant>;
  } | null>(null);
  const [mode, setMode] = useState<QrMode>('public');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const card = await fetchQrCard(session.token);
      const fallback = {
        label: 'QR',
        orderUrl: card.orderUrl,
        qrDataUrl: card.qrDataUrl,
        exportDataUrl: card.exportDataUrl,
      };
      setQr({
        variants: {
          public: card.variants?.public ?? fallback,
          lan: card.variants?.lan ?? fallback,
        },
      });
      setError(null);
      setNotice(null);
    } catch {
      setError('Could not load the QR code.');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  const exportQr = useCallback(async () => {
    if (!qr || exporting) return;
    const selectedQr = qr.variants[mode];

    setExporting(true);
    setNotice(null);
    setError(null);

    try {
      const sharingAvailable = await Sharing.isAvailableAsync();
      if (!sharingAvailable) {
        throw new Error('Sharing is not available.');
      }

      const base64 = selectedQr.exportDataUrl.replace(/^data:image\/png;base64,/, '');
      if (base64 === selectedQr.exportDataUrl) {
        throw new Error('Export image was not PNG data.');
      }

      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!directory) {
        throw new Error('No file directory available.');
      }

      const safeSlug = session.stall.slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'stall';
      const fileUri = `${directory}khaidee-${safeSlug}-qr.png`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/png',
        dialogTitle: 'Export QR code',
        UTI: 'public.png',
      });
      setNotice('QR code export opened.');
    } catch {
      setError('Could not export the QR code.');
    } finally {
      setExporting(false);
    }
  }, [exporting, mode, qr, session.stall.slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const qrVariants = qr?.variants ?? null;
  const selectedQr = qrVariants?.[mode] ?? null;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
      >
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mark}>QR CODE</Text>
          <Text style={styles.title} numberOfLines={1}>
            {session.stall.name}
          </Text>
        </View>
        <Pressable onPress={onBack} hitSlop={12} testID="qr-back">
          <Text style={styles.home}>Home</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.ink} />
          </View>
        ) : qrVariants && selectedQr ? (
          <>
            <View style={styles.switcher}>
              {(['public', 'lan'] as const).map((value) => {
                const active = mode === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setMode(value)}
                    style={[styles.switchButton, active && styles.switchButtonActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`qr-mode-${value}`}
                  >
                    <Text style={[styles.switchText, active && styles.switchTextActive]}>
                      {qrVariants[value].label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Image
              source={{ uri: selectedQr.qrDataUrl }}
              style={styles.qr}
              resizeMode="contain"
              testID="customer-qr"
            />
            <Text style={styles.hint}>
              {mode === 'public' ? 'For sharing outside this Wi-Fi.' : 'For the same Wi-Fi as this Mac.'}
            </Text>
          </>
        ) : (
          <Text style={styles.error}>{error ?? 'No QR code available.'}</Text>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.secondaryButton, loading && styles.disabledButton]}
          onPress={() => void refresh()}
          disabled={loading}
          testID="refresh-qr"
        >
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Refresh QR</Text>
        </Pressable>
        <Pressable
          style={[styles.button, (!qr || exporting) && styles.disabledButton]}
          onPress={() => void exportQr()}
          disabled={!selectedQr || exporting}
          testID="export-qr"
        >
          <Text style={styles.buttonText}>{exporting ? 'Exporting...' : 'Export QR'}</Text>
        </Pressable>
      </View>
      </ScrollView>
      <FloatingToast
        message={error ?? notice}
        tone={error ? 'error' : 'success'}
        onDone={() => {
          setError(null);
          setNotice(null);
        }}
      />
    </View>
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
  panel: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    padding: 18,
    alignItems: 'center',
  },
  loading: { minHeight: 320, alignItems: 'center', justifyContent: 'center' },
  switcher: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: theme.paper,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 4,
    padding: 5,
    marginBottom: 18,
  },
  switchButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchButtonActive: {
    backgroundColor: theme.ink,
  },
  switchText: {
    color: theme.muted,
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  switchTextActive: {
    color: theme.white,
  },
  qr: {
    width: '100%',
    maxWidth: 360,
    aspectRatio: 1,
    marginBottom: 18,
  },
  label: {
    alignSelf: 'stretch',
    fontSize: 12,
    color: theme.muted,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  hint: {
    alignSelf: 'stretch',
    color: theme.muted,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  button: {
    flex: 1,
    backgroundColor: theme.stool,
    minHeight: 56,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  buttonText: { color: theme.white, fontSize: 16, fontWeight: '800' },
  secondaryButton: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
  },
  secondaryButtonText: { color: theme.ink },
  disabledButton: { opacity: 0.5 },
  notice: {
    backgroundColor: theme.stool,
    color: theme.white,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
    alignSelf: 'stretch',
  },
  error: {
    backgroundColor: theme.chilli,
    color: theme.white,
    padding: 12,
    fontSize: 15,
    marginTop: 12,
    alignSelf: 'stretch',
  },
});
