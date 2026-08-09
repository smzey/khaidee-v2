import { PLANS } from '@khaidee/domain';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Session } from '../session';
import { theme } from '../theme';
import type { Queue } from '../useQueue';

export function LaunchPadScreen({
  session,
  queue,
  onOpenOrders,
  onOpenHistory,
  onOpenForecasting,
  onOpenReport,
  onOpenMenu,
  onOpenQr,
  onOpenStall,
  onOpenPlans,
  onSignOut,
}: {
  session: Session;
  queue: Queue;
  onOpenOrders: () => void;
  onOpenHistory: () => void;
  onOpenForecasting: () => void;
  onOpenReport: () => void;
  onOpenMenu: () => void;
  onOpenQr: () => void;
  onOpenStall: () => void;
  onOpenPlans: () => void;
  onSignOut: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const loading = queue.connection === 'connecting' && queue.orders.length === 0;
  const offline = queue.connection === 'offline';
  const openOrders = queue.open;
  const waiting = openOrders.filter((order) => order.status === 'placed').length;
  const ready = openOrders.filter((order) => order.status === 'ready').length;
  const completed = queue.orders.filter((order) => order.status === 'completed').length;
  const historyCount = queue.orders.filter(
    (order) => order.status === 'completed' || order.status === 'cancelled',
  ).length;
  const forecastOrders = queue.orders.filter((order) => order.status !== 'cancelled').length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await queue.refresh();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mark}>KHAIDEE</Text>
          <Text style={styles.stall} numberOfLines={1}>
            {session.stall.name}
          </Text>
          <Text style={styles.status}>
            {offline ? 'No connection' : session.stall.isOpen ? 'Open today' : 'Closed'}
          </Text>
        </View>
        <View>
          <Pressable
            style={styles.menuButton}
            onPress={() => setMenuOpen((current) => !current)}
            hitSlop={10}
            testID="launch-menu"
          >
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
          </Pressable>
          {menuOpen && (
            <View style={styles.menu}>
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onOpenStall();
                }}
                style={styles.menuItem}
                testID="settings"
              >
                <Text style={styles.menuText}>Settings</Text>
              </Pressable>
              <View style={styles.menuRule} />
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onOpenPlans();
                }}
                style={styles.menuItem}
                testID="plans"
              >
                <Text style={styles.menuText}>Plan</Text>
              </Pressable>
              <View style={styles.menuRule} />
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
                style={styles.menuItem}
                testID="signout"
              >
                <Text style={styles.menuText}>Sign out</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      <View style={styles.summary}>
        <Metric label="Waiting" value={waiting} tone={waiting > 0 ? 'hot' : 'plain'} />
        <Metric label="Ready" value={ready} tone={ready > 0 ? 'dark' : 'plain'} />
        <Metric label="Done" value={completed} tone="plain" />
      </View>

      <Text style={styles.section}>Modules</Text>

      <View style={styles.modules}>
        <ModuleShortcut
          label="Orders"
          icon="#"
          accent={theme.stool}
          badge={loading ? null : String(openOrders.length)}
          loading={loading}
          onPress={onOpenOrders}
          testID="module-orders"
        />
        <ModuleShortcut
          label="Menu"
          icon="M"
          accent={theme.chilli}
          onPress={onOpenMenu}
          testID="module-menu"
        />
        <ModuleShortcut
          label="History"
          icon="H"
          accent={theme.yolk}
          darkIcon
          badge={String(historyCount)}
          badgeTone="plain"
          onPress={onOpenHistory}
          testID="module-history"
        />
        <ModuleShortcut
          label="Prep"
          icon="F"
          accent={theme.ink}
          badge={String(forecastOrders)}
          badgeTone="warm"
          onPress={onOpenForecasting}
          testID="module-forecasting"
        />
        <ModuleShortcut
          label="Report"
          icon="R"
          accent={theme.stool}
          badge={String(completed)}
          badgeTone="plain"
          onPress={onOpenReport}
          testID="module-report"
        />
        <ModuleShortcut
          label="Stall"
          icon="S"
          accent={theme.stool}
          badge={session.stall.isOpen ? 'ON' : 'OFF'}
          badgeTone={session.stall.isOpen ? 'blue' : 'muted'}
          onPress={onOpenStall}
          testID="module-stall"
        />
        <ModuleShortcut
          label="Plan"
          icon="฿"
          accent={theme.yolk}
          darkIcon
          badge={PLANS[session.stall.tier].nameEn.toUpperCase()}
          badgeTone="dark"
          onPress={onOpenPlans}
          testID="module-plans"
        />
        <ModuleShortcut
          label="QR"
          icon="QR"
          accent={theme.ink}
          badge="SCAN"
          badgeTone="warm"
          onPress={onOpenQr}
          testID="module-qr"
        />
      </View>
    </ScrollView>
  );
}

function ModuleShortcut({
  label,
  icon,
  accent,
  darkIcon = false,
  badge,
  badgeTone = 'blue',
  loading = false,
  onPress,
  testID,
}: {
  label: string;
  icon: string;
  accent: string;
  darkIcon?: boolean;
  badge?: string | null;
  badgeTone?: 'blue' | 'dark' | 'warm' | 'plain' | 'muted';
  loading?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const badgeStyle =
    badgeTone === 'dark'
      ? styles.shortcutBadgeDark
      : badgeTone === 'warm'
        ? styles.shortcutBadgeWarm
        : badgeTone === 'plain'
          ? styles.shortcutBadgePlain
          : badgeTone === 'muted'
            ? styles.shortcutBadgeMuted
            : styles.shortcutBadgeBlue;
  const badgeTextStyle =
    badgeTone === 'plain' || badgeTone === 'warm'
      ? styles.shortcutBadgeTextDark
      : styles.shortcutBadgeTextLight;

  return (
    <Pressable style={styles.shortcut} onPress={onPress} testID={testID}>
      <View style={[styles.shortcutIcon, { backgroundColor: accent }]}>
        <Text
          style={[styles.shortcutIconText, darkIcon && styles.shortcutIconTextDark]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {icon}
        </Text>
        {(loading || badge) && (
          <View style={[styles.shortcutBadge, badgeStyle]}>
            {loading ? (
              <ActivityIndicator color={theme.white} size="small" />
            ) : (
              <Text style={[styles.shortcutBadgeText, badgeTextStyle]} numberOfLines={1}>
                {badge}
              </Text>
            )}
          </View>
        )}
      </View>
      <Text style={styles.shortcutLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'plain' | 'hot' | 'dark';
}) {
  const color = tone === 'hot' ? theme.chilli : tone === 'dark' ? theme.ink : theme.stool;
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
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
    fontWeight: '700',
    marginBottom: 8,
  },
  stall: { fontSize: 30, lineHeight: 35, fontWeight: '800', color: theme.ink },
  status: { marginTop: 6, fontSize: 14, color: theme.muted, fontWeight: '700' },
  menuButton: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    backgroundColor: theme.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  menuLine: {
    width: 18,
    height: 2,
    backgroundColor: theme.ink,
  },
  menu: {
    position: 'absolute',
    right: 0,
    top: 48,
    width: 150,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    zIndex: 20,
  },
  menuItem: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 14 },
  menuRule: { height: 1, backgroundColor: theme.rule },
  menuText: { color: theme.ink, fontSize: 15, fontWeight: '800' },
  summary: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  metric: {
    flex: 1,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    paddingVertical: 14,
    paddingHorizontal: 10,
    minHeight: 82,
    justifyContent: 'center',
  },
  metricValue: { fontSize: 30, lineHeight: 34, fontWeight: '800', textAlign: 'center' },
  metricLabel: {
    marginTop: 2,
    fontSize: 12,
    color: theme.muted,
    fontWeight: '800',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  section: {
    fontSize: 12,
    color: theme.muted,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 10,
  },
  modules: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
    rowGap: 22,
  },
  shortcut: {
    width: '25%',
    minHeight: 116,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  shortcutIcon: {
    width: 60,
    height: 60,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.ink,
    marginBottom: 8,
  },
  shortcutIconText: {
    color: theme.white,
    fontSize: 27,
    lineHeight: 31,
    fontWeight: '900',
  },
  shortcutIconTextDark: { color: theme.ink },
  shortcutLabel: {
    minHeight: 36,
    color: theme.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  shortcutBadge: {
    position: 'absolute',
    right: -8,
    top: -8,
    minWidth: 28,
    height: 28,
    maxWidth: 62,
    paddingHorizontal: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutBadgeBlue: { backgroundColor: theme.stool },
  shortcutBadgeDark: { backgroundColor: theme.ink },
  shortcutBadgeWarm: { backgroundColor: theme.yolk },
  shortcutBadgePlain: { backgroundColor: theme.white },
  shortcutBadgeMuted: { backgroundColor: theme.muted },
  shortcutBadgeText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
  shortcutBadgeTextLight: { color: theme.white },
  shortcutBadgeTextDark: { color: theme.ink },
});
