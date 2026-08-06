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
        <Pressable style={styles.tile} onPress={onOpenOrders} testID="module-orders">
          <View style={styles.tileTop}>
            <View style={styles.iconBox}>
              <Text style={styles.iconText}>#</Text>
            </View>
            <View style={styles.badge}>
              {loading ? (
                <ActivityIndicator color={theme.white} size="small" />
              ) : (
                <Text style={styles.badgeText}>{openOrders.length}</Text>
              )}
            </View>
          </View>
          <Text style={styles.tileTitle}>Orders</Text>
          <Text style={styles.tileBody}>
            Live queue, accept orders, mark food ready, and complete pickup.
          </Text>
          <Text style={styles.tileAction}>Open orders</Text>
        </Pressable>

        <Pressable style={styles.tile} onPress={onOpenMenu} testID="module-menu">
          <View style={styles.tileTop}>
            <View style={[styles.iconBox, { backgroundColor: theme.chilli }]}>
              <Text style={styles.iconText}>M</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: theme.white, borderWidth: 1, borderColor: theme.ink }]}>
              <Text style={[styles.badgeText, { color: theme.ink }]}>MENU</Text>
            </View>
          </View>
          <Text style={styles.tileTitle}>Menu</Text>
          <Text style={styles.tileBody}>
            Add categories, create dishes, set prices, and mark sold out items.
          </Text>
          <Text style={styles.tileAction}>Open menu</Text>
        </Pressable>

        <Pressable style={styles.tile} onPress={onOpenHistory} testID="module-history">
          <View style={styles.tileTop}>
            <View style={[styles.iconBox, { backgroundColor: theme.yolk }]}>
              <Text style={[styles.iconText, { color: theme.ink }]}>H</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: theme.white, borderWidth: 1, borderColor: theme.ink }]}>
              <Text style={[styles.badgeText, { color: theme.ink }]}>{historyCount}</Text>
            </View>
          </View>
          <Text style={styles.tileTitle}>History</Text>
          <Text style={styles.tileBody}>
            Done and cancelled orders from today, with totals and payment method.
          </Text>
          <Text style={styles.tileAction}>Open history</Text>
        </Pressable>

        <Pressable
          style={styles.tile}
          onPress={onOpenForecasting}
          testID="module-forecasting"
        >
          <View style={styles.tileTop}>
            <View style={[styles.iconBox, { backgroundColor: theme.ink }]}>
              <Text style={styles.iconText}>F</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: theme.yolk }]}>
              <Text style={[styles.badgeText, { color: theme.ink }]}>
                {forecastOrders}
              </Text>
            </View>
          </View>
          <Text style={styles.tileTitle}>Forecasting</Text>
          <Text style={styles.tileBody}>
            Tomorrow prep from sales history, recipes, and weather.
          </Text>
          <Text style={styles.tileAction}>Open forecast</Text>
        </Pressable>

        <Pressable style={styles.tile} onPress={onOpenReport} testID="module-report">
          <View style={styles.tileTop}>
            <View style={[styles.iconBox, { backgroundColor: theme.stool }]}>
              <Text style={styles.iconText}>R</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: theme.white, borderWidth: 1, borderColor: theme.ink }]}>
              <Text style={[styles.badgeText, { color: theme.ink }]}>{completed}</Text>
            </View>
          </View>
          <Text style={styles.tileTitle}>Report</Text>
          <Text style={styles.tileBody}>
            Today sales, top dishes, payment split, service times, and written note.
          </Text>
          <Text style={styles.tileAction}>Open report</Text>
        </Pressable>

        <Pressable style={styles.tile} onPress={onOpenStall} testID="module-stall">
          <View style={styles.tileTop}>
            <View style={[styles.iconBox, { backgroundColor: theme.stool }]}>
              <Text style={styles.iconText}>S</Text>
            </View>
            <View style={[styles.badge, session.stall.isOpen ? styles.badgeOpen : styles.badgeClosed]}>
              <Text style={styles.badgeText}>{session.stall.isOpen ? 'ON' : 'OFF'}</Text>
            </View>
          </View>
          <Text style={styles.tileTitle}>Stall</Text>
          <Text style={styles.tileBody}>
            Customer ordering, QR identity, and counter setup.
          </Text>
          <Text style={styles.tileAction}>Open stall</Text>
        </Pressable>

        <Pressable style={styles.tile} onPress={onOpenPlans} testID="module-plans">
          <View style={styles.tileTop}>
            <View style={[styles.iconBox, { backgroundColor: theme.yolk }]}>
              <Text style={[styles.iconText, { color: theme.ink }]}>฿</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: theme.ink }]}>
              <Text style={styles.badgeText}>
                {PLANS[session.stall.tier].nameEn.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.tileTitle}>Plan</Text>
          <Text style={styles.tileBody}>
            {session.stall.tier === 'premium'
              ? 'You are on the top plan. Here is what it covers.'
              : 'Core modules are free. See optional growth and expert add-ons.'}
          </Text>
          <Text style={styles.tileAction}>See plans</Text>
        </Pressable>

        <Pressable style={styles.tile} onPress={onOpenQr} testID="module-qr">
          <View style={styles.tileTop}>
            <View style={[styles.iconBox, { backgroundColor: theme.ink }]}>
              <Text style={styles.iconText}>QR</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: theme.yolk }]}>
              <Text style={[styles.badgeText, { color: theme.ink }]}>SCAN</Text>
            </View>
          </View>
          <Text style={styles.tileTitle}>QR Code</Text>
          <Text style={styles.tileBody}>
            Show the customer ordering code for this stall.
          </Text>
          <Text style={styles.tileAction}>Open QR</Text>
        </Pressable>
      </View>
    </ScrollView>
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
  tile: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    padding: 16,
    minHeight: 190,
  },
  modules: { gap: 12 },
  tileTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 3,
    backgroundColor: theme.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { color: theme.white, fontSize: 26, fontWeight: '800' },
  badge: {
    minWidth: 40,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: theme.stool,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: theme.white, fontWeight: '800', fontSize: 17 },
  badgeOpen: { backgroundColor: theme.stool },
  badgeClosed: { backgroundColor: theme.muted },
  tileTitle: { fontSize: 25, fontWeight: '800', color: theme.ink, marginBottom: 6 },
  tileBody: { fontSize: 15, color: theme.muted, lineHeight: 21, marginBottom: 18 },
  tileAction: { fontSize: 15, color: theme.stool, fontWeight: '800' },
});
