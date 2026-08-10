import {
  type OrderDto,
  formatBaht,
  lineTotal,
  localTime,
  statusLabel,
} from '@khaidee/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  ScrollView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchHistory } from '../api';
import {
  activeHistorySettingsCount,
  filterHistoryOrders,
  type HistoryFilter,
  type HistoryRange,
  historySummary,
  presetRange,
  todayRange,
} from '../history';
import type { Session } from '../session';
import { statusColour, theme } from '../theme';
import type { Queue } from '../useQueue';

export function HistoryScreen({
  session,
  queue,
  onBack,
}: {
  session: Session;
  queue: Queue;
  onBack: () => void;
}) {
  const [range, setRange] = useState<HistoryRange>(() => todayRange());
  const [fromInput, setFromInput] = useState(range.from);
  const [toInput, setToInput] = useState(range.to);
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const refreshQueue = queue.refresh;

  const load = useCallback(
    async (nextRange = range, options: { refreshQueue?: boolean } = {}) => {
      setError(null);
      const response = await fetchHistory(session.token, nextRange);
      setOrders(response.orders);
      if (options.refreshQueue) await refreshQueue();
    },
    [range, refreshQueue, session.token],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    void load()
      .catch((caught) => {
        if (live) setError(caught instanceof Error ? caught.message : 'Could not load history');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [load]);

  const shown = useMemo(
    () => filterHistoryOrders(orders, { search, filter }),
    [filter, orders, search],
  );
  const summary = historySummary(shown);
  const activeSettings = activeHistorySettingsCount({ range, filter });

  const choosePreset = (preset: 'today' | 'yesterday' | '7d' | '30d') => {
    const next = presetRange(preset);
    setRange(next);
    setFromInput(next.from);
    setToInput(next.to);
  };

  const applyCustomRange = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromInput) || !/^\d{4}-\d{2}-\d{2}$/.test(toInput)) {
      setError('Use YYYY-MM-DD for both dates');
      return;
    }
    if (fromInput > toInput) {
      setError('The range starts after it ends');
      return;
    }
    setRange({ from: fromInput, to: toInput, label: 'Custom' });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mark}>HISTORY</Text>
          <Text style={styles.title}>{range.label}</Text>
          <Text style={styles.subtitle}>{range.from === range.to ? range.from : `${range.from} to ${range.to}`}</Text>
        </View>
        <Pressable onPress={onBack} hitSlop={12} testID="history-back">
          <Text style={styles.back}>Home</Text>
        </Pressable>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(order) => order.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load(range, { refreshQueue: true }).catch((caught) => {
                setError(caught instanceof Error ? caught.message : 'Could not refresh history');
              });
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.summary}>
              <Metric label="Sales" value={formatBaht(summary.salesTotal)} tone="dark" />
              <Metric label="Done" value={String(summary.completed)} tone="blue" />
              <Metric label="Average" value={formatBaht(summary.averageOrder)} tone="dark" />
            </View>
            <View style={styles.payLine}>
              <Text style={styles.payText}>Cash {formatBaht(summary.cashTotal)}</Text>
              <Text style={styles.payText}>PromptPay {formatBaht(summary.promptpayTotal)}</Text>
              <Text style={styles.payText}>Cancel {summary.cancelled}</Text>
            </View>
            <View style={styles.searchRow}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search orders"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.search}
                testID="history-search"
              />
              <Pressable
                onPress={() => setFiltersOpen((open) => !open)}
                style={[styles.filterButton, filtersOpen && styles.filterButtonActive]}
                accessibilityRole="button"
                accessibilityLabel="Filter history"
                testID="history-filter-toggle"
              >
                <MaterialCommunityIcons
                  name="filter-variant"
                  size={21}
                  color={filtersOpen ? theme.white : theme.ink}
                />
                {activeSettings > 0 && (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>{activeSettings}</Text>
                  </View>
                )}
              </Pressable>
            </View>
            {filtersOpen && (
              <View style={styles.filterPanel}>
                <RangeControls
                  active={range.label}
                  from={fromInput}
                  to={toInput}
                  onPreset={choosePreset}
                  onFrom={setFromInput}
                  onTo={setToInput}
                  onApply={applyCustomRange}
                />
                <FilterChips active={filter} onChange={setFilter} />
              </View>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
            {loading && <Text style={styles.loading}>Loading history...</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{search || filter !== 'all' ? 'No matching orders' : 'No history here'}</Text>
            <Text style={styles.emptyBody}>
              {search || filter !== 'all'
                ? 'Change the search or filter to widen the list.'
                : 'Finished and cancelled orders will show in this range.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => <HistoryCard order={item} />}
      />
    </View>
  );
}

function RangeControls({
  active,
  from,
  to,
  onPreset,
  onFrom,
  onTo,
  onApply,
}: {
  active: string;
  from: string;
  to: string;
  onPreset: (preset: 'today' | 'yesterday' | '7d' | '30d') => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onApply: () => void;
}) {
  const presets: Array<{
    label: string;
    value: 'today' | 'yesterday' | '7d' | '30d';
  }> = [
    { label: 'Today', value: 'today' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: '7 days', value: '7d' },
    { label: '30 days', value: '30d' },
  ];

  return (
    <View style={styles.controlBlock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {presets.map((preset) => (
          <Chip
            key={preset.value}
            label={preset.label}
            active={active === preset.label}
            onPress={() => onPreset(preset.value)}
          />
        ))}
      </ScrollView>
      <View style={styles.customRange}>
        <TextInput
          value={from}
          onChangeText={onFrom}
          style={styles.dateInput}
          placeholder="From"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
        />
        <TextInput
          value={to}
          onChangeText={onTo}
          style={styles.dateInput}
          placeholder="To"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
        />
        <Pressable onPress={onApply} style={styles.applyButton}>
          <Text style={styles.applyText}>Apply</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FilterChips({
  active,
  onChange,
}: {
  active: HistoryFilter;
  onChange: (filter: HistoryFilter) => void;
}) {
  const filters: Array<{ label: string; value: HistoryFilter }> = [
    { label: 'All', value: 'all' },
    { label: 'Done', value: 'completed' },
    { label: 'Cancel', value: 'cancelled' },
    { label: 'Cash', value: 'cash' },
    { label: 'PromptPay', value: 'promptpay' },
    { label: 'QR', value: 'customer' },
    { label: 'Ring-up', value: 'ring-up' },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {filters.map((filter) => (
        <Chip
          key={filter.value}
          label={filter.label}
          active={active === filter.value}
          onPress={() => onChange(filter.value)}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
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
              {order.businessDate} - {localTime(finishedAt)}
            </Text>
            <Text style={styles.meta}>
              {source} - {order.lines.reduce((sum, line) => sum + line.qty, 0)} items
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

        <View style={styles.timeGrid}>
          <TimeCell label="Placed" value={localTime(order.placedAt)} />
          <TimeCell label="Ready" value={order.readyAt ? localTime(order.readyAt) : '-'} />
          <TimeCell label="Done" value={order.completedAt ? localTime(order.completedAt) : '-'} />
        </View>

        <View style={styles.foot}>
          <Text style={styles.payment}>{payment}</Text>
          <Text style={styles.total}>{formatBaht(order.total)}</Text>
        </View>
      </View>
    </View>
  );
}

function TimeCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.timeCell}>
      <Text style={styles.timeLabel}>{label}</Text>
      <Text style={styles.timeValue}>{value}</Text>
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
  subtitle: { marginTop: 2, color: theme.muted, fontSize: 13, fontWeight: '800' },
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
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  filterButton: {
    width: 46,
    height: 46,
    borderWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {
    borderColor: theme.ink,
    backgroundColor: theme.ink,
  },
  filterBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.chilli,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: theme.white,
  },
  filterBadgeText: {
    color: theme.white,
    fontSize: 11,
    fontWeight: '900',
  },
  filterPanel: {
    borderWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.white,
    padding: 10,
    marginBottom: 8,
  },
  controlBlock: { gap: 8 },
  chips: {
    gap: 8,
    paddingVertical: 6,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: theme.ink,
    backgroundColor: theme.ink,
  },
  chipText: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '900',
  },
  chipTextActive: {
    color: theme.white,
  },
  customRange: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  dateInput: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.white,
    paddingHorizontal: 10,
    color: theme.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  applyButton: {
    minHeight: 42,
    paddingHorizontal: 14,
    backgroundColor: theme.stool,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: { color: theme.white, fontSize: 13, fontWeight: '900' },
  search: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.white,
    paddingHorizontal: 12,
    color: theme.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  error: {
    color: theme.chilli,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
  loading: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
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
  timeGrid: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.rule,
    marginTop: 12,
  },
  timeCell: {
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: theme.rule,
  },
  timeLabel: {
    color: theme.muted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  timeValue: {
    marginTop: 2,
    color: theme.ink,
    fontSize: 15,
    fontWeight: '900',
  },
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
