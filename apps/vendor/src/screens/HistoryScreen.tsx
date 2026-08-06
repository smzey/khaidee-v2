import {
  type OrderDto,
  formatBaht,
  lineTotal,
  localTime,
  statusLabel,
} from '@khaidee/domain';
import { useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  Pressable,
} from 'react-native';
import { statusColour, theme } from '../theme';
import type { Queue } from '../useQueue';

export function HistoryScreen({
  queue,
  onBack,
}: {
  queue: Queue;
  onBack: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const history = useMemo(
    () =>
      queue.orders.filter(
        (order) => order.status === 'completed' || order.status === 'cancelled',
      ),
    [queue.orders],
  );
  const completed = history.filter((order) => order.status === 'completed');
  const cancelled = history.length - completed.length;
  const salesTotal = completed.reduce((sum, order) => sum + order.total, 0);
  const promptpay = completed.filter((order) => order.paymentMethod === 'promptpay').length;
  const cash = completed.filter((order) => order.paymentMethod === 'cash').length;

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mark}>HISTORY</Text>
          <Text style={styles.title}>Today</Text>
        </View>
        <Pressable onPress={onBack} hitSlop={12} testID="history-back">
          <Text style={styles.back}>Home</Text>
        </Pressable>
      </View>

      <FlatList
        data={history}
        keyExtractor={(order) => order.id}
        contentContainerStyle={styles.list}
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
        ListHeaderComponent={
          <View>
            <View style={styles.summary}>
              <Metric label="Sales" value={formatBaht(salesTotal)} tone="dark" />
              <Metric label="Done" value={String(completed.length)} tone="blue" />
              <Metric label="Cancel" value={String(cancelled)} tone="red" />
            </View>
            <View style={styles.payLine}>
              <Text style={styles.payText}>Cash {cash}</Text>
              <Text style={styles.payText}>PromptPay {promptpay}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No history yet</Text>
            <Text style={styles.emptyBody}>
              Finished and cancelled orders will show here today.
            </Text>
          </View>
        }
        renderItem={({ item }) => <HistoryCard order={item} />}
      />
    </View>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'dark' | 'blue' | 'red';
}) {
  const color = tone === 'red' ? theme.chilli : tone === 'blue' ? theme.stool : theme.ink;
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function HistoryCard({ order }: { order: OrderDto }) {
  const finishedAt = order.completedAt ?? order.readyAt ?? order.acceptedAt ?? order.placedAt;
  const source = order.source === 'vendor' ? 'Ring-up' : 'Customer';
  const payment =
    order.paymentMethod === 'promptpay'
      ? 'PromptPay'
      : order.paymentMethod === 'cash'
        ? 'Cash'
        : 'No payment';

  return (
    <View style={styles.card}>
      <View style={[styles.edge, { backgroundColor: statusColour[order.status] }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <View>
            <Text style={styles.queueNo}>#{order.queueNo}</Text>
            <Text style={styles.meta}>
              {source} - {localTime(finishedAt)}
            </Text>
          </View>
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>{statusLabel(order.status)}</Text>
          </View>
        </View>

        {order.lines.map((line, index) => (
          <View key={`${line.menuItemId}-${index}`} style={styles.line}>
            <Text style={styles.lineQty}>{line.qty}x</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{line.nameSnapshot}</Text>
              {line.options.length > 0 && (
                <Text style={styles.lineOptions}>
                  {line.options.map((option) => option.nameSnapshot).join(' - ')}
                </Text>
              )}
            </View>
            <Text style={styles.lineAmount}>{formatBaht(lineTotal(line))}</Text>
          </View>
        ))}

        <View style={styles.foot}>
          <Text style={styles.payment}>{payment}</Text>
          <Text style={styles.total}>{formatBaht(order.total)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.rule,
    gap: 12,
  },
  mark: {
    fontSize: 12,
    letterSpacing: 3,
    color: theme.muted,
    fontWeight: '800',
    marginBottom: 4,
  },
  title: { fontSize: 24, lineHeight: 29, color: theme.ink, fontWeight: '900' },
  back: { fontSize: 14, color: theme.muted, fontWeight: '700' },
  list: {
    padding: 12,
    paddingBottom: 40,
    gap: 12,
  },
  summary: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  metric: {
    flex: 1,
    minHeight: 78,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  metricValue: {
    fontSize: 23,
    lineHeight: 27,
    fontWeight: '900',
    textAlign: 'center',
  },
  metricLabel: {
    marginTop: 3,
    color: theme.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  payLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  payText: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  empty: {
    alignItems: 'center',
    padding: 42,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
  },
  emptyTitle: { fontSize: 18, color: theme.ink, fontWeight: '800', marginBottom: 6 },
  emptyBody: { fontSize: 14, color: theme.muted, textAlign: 'center', lineHeight: 20 },
  card: {
    flexDirection: 'row',
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    overflow: 'hidden',
  },
  edge: { width: 6 },
  cardBody: { flex: 1, padding: 14 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  queueNo: { fontSize: 30, lineHeight: 34, color: theme.ink, fontWeight: '900' },
  meta: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  statusPill: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    color: theme.ink,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  lineQty: { minWidth: 24, color: theme.ink, fontSize: 15, fontWeight: '800' },
  lineName: { color: theme.ink, fontSize: 15, fontWeight: '700' },
  lineOptions: { marginTop: 1, color: theme.muted, fontSize: 12 },
  lineAmount: { color: theme.ink, fontSize: 14, fontWeight: '800' },
  foot: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  payment: { color: theme.muted, fontSize: 13, fontWeight: '800' },
  total: { color: theme.ink, fontSize: 22, lineHeight: 26, fontWeight: '900' },
});
