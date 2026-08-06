import {
  type Cart,
  type MenuItem,
  type OrderDto,
  type PaymentMethod,
  addEntry,
  cartCount,
  cartToLines,
  cartTotal,
  emptyCart,
  formatBaht,
  lineTotal,
  localTime,
  minutesBetween,
  removeEntry,
  validateSelection,
} from '@khaidee/domain';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  acceptOrder,
  cancelOrder,
  completeOrder,
  fetchMenu,
  fetchRingUpPromptPayQr,
  readyOrder,
  ringUpOrder,
} from '../api';
import type { Session } from '../session';
import { nextAction, statusColour, theme } from '../theme';
import type { Queue } from '../useQueue';

/**
 * The screen the vendor actually lives in. Newest order at the top, one
 * obvious action per card, and nothing that needs reading twice — this is
 * looked at between stirring and serving, not studied.
 */
export function QueueScreen({
  session,
  queue,
  onBack,
}: {
  session: Session;
  queue: Queue;
  onBack: () => void;
}) {
  // The stall phone sits on the cart all day. A screen that sleeps is a
  // screen that misses orders.
  useKeepAwake();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ringing, setRinging] = useState(false);

  const act = async (order: OrderDto, run: () => Promise<OrderDto>) => {
    setBusyId(order.id);
    try {
      queue.apply(await run());
    } catch {
      await queue.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const advance = (order: OrderDto) => {
    if (order.status === 'placed') {
      return act(order, () => acceptOrder(session.token, order.id));
    }
    if (order.status === 'accepted') {
      return act(order, () => readyOrder(session.token, order.id));
    }
    if (order.status === 'ready') {
      return act(order, () =>
        completeOrder(session.token, order.id, order.paymentMethod ?? 'cash'),
      );
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.stall} numberOfLines={1}>
            Orders
          </Text>
          <Connection state={queue.connection} />
        </View>
        <Pressable onPress={onBack} hitSlop={12} testID="orders-back">
          <Text style={styles.signOut}>Home</Text>
        </Pressable>
      </View>

      <View style={styles.quickRow}>
        <Pressable
          style={styles.ringButton}
          onPress={() => setRinging(true)}
          testID="ring-up-open"
        >
          <Text style={styles.ringButtonText}>Ring-up</Text>
        </Pressable>
      </View>

      <FlatList
        data={queue.open}
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
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No orders waiting</Text>
            <Text style={styles.emptyBody}>
              New orders appear here the moment a customer sends one.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            busy={busyId === item.id}
            onAdvance={() => void advance(item)}
            onCancel={() => void act(item, () => cancelOrder(session.token, item.id))}
          />
        )}
      />

      {ringing && (
        <RingUpSheet
          session={session}
          onClose={() => setRinging(false)}
          onDone={(order) => {
            queue.apply(order);
            setRinging(false);
          }}
        />
      )}
    </View>
  );
}

function uuidV4(): string {
  const bytes = new Uint8Array(16);
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

function orderClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? uuidV4();
}

function defaultOptions(item: MenuItem): string[] {
  return item.optionGroups.flatMap((group) =>
    group.minSelect > 0
      ? group.options
          .filter((option) => option.isAvailable)
          .slice(0, group.minSelect)
          .map((option) => option.id)
      : [],
  );
}

function RingUpSheet({
  session,
  onClose,
  onDone,
}: {
  session: Session;
  onClose: () => void;
  onDone: (order: OrderDto) => void;
}) {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptpayQr, setPromptpayQr] = useState<string | null>(null);
  const [promptpayLoading, setPromptpayLoading] = useState(false);
  const [choosing, setChoosing] = useState<MenuItem | null>(null);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [clientId] = useState(orderClientId);

  useEffect(() => {
    let live = true;
    fetchMenu(session.token)
      .then((items) => {
        if (!live) return;
        setMenu(items.filter((item) => item.isAvailable));
        setError(null);
      })
      .catch(() => live && setError('Could not load menu.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [session.token]);

  const pricedEntries = useMemo(
    () =>
      cart.flatMap((entry) => {
        const [line] = cartToLines([entry], menu);
        return line ? [{ entry, line }] : [];
      }),
    [cart, menu],
  );
  const total = cartTotal(cart, menu);
  const count = cartCount(cart);

  useEffect(() => {
    if (paymentMethod !== 'promptpay' || total <= 0) {
      setPromptpayQr(null);
      setPromptpayLoading(false);
      return;
    }

    let live = true;
    setPromptpayLoading(true);
    fetchRingUpPromptPayQr(session.token, total)
      .then((payment) => {
        if (!live) return;
        setPromptpayQr(payment.promptpayQrDataUrl);
      })
      .catch(() => live && setPromptpayQr(null))
      .finally(() => live && setPromptpayLoading(false));

    return () => {
      live = false;
    };
  }, [paymentMethod, session.token, total]);

  const addItem = (item: MenuItem) => {
    if (item.optionGroups.length > 0) {
      setChoosing(item);
      setOptionIds(defaultOptions(item));
      return;
    }
    setCart((current) => addEntry(current, item.id));
  };

  const toggleOption = (item: MenuItem, groupId: string, optionId: string) => {
    const group = item.optionGroups.find((candidate) => candidate.id === groupId);
    if (!group) return;

    setOptionIds((current) => {
      const groupOptionIds = new Set(group.options.map((option) => option.id));
      const has = current.includes(optionId);

      if (group.maxSelect === 1) {
        return [...current.filter((id) => !groupOptionIds.has(id)), optionId];
      }

      if (has) return current.filter((id) => id !== optionId);

      const selectedInGroup = current.filter((id) => groupOptionIds.has(id));
      if (selectedInGroup.length >= group.maxSelect) return current;
      return [...current, optionId];
    });
  };

  const confirmOptions = () => {
    if (!choosing || validateSelection(choosing, optionIds).length > 0) return;
    setCart((current) => addEntry(current, choosing.id, optionIds));
    setChoosing(null);
    setOptionIds([]);
  };

  const save = async () => {
    if (count === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      const order = await ringUpOrder(session.token, {
        clientId,
        lines: cart.map((entry) => ({
          itemId: entry.itemId,
          qty: entry.qty,
          optionIds: entry.optionIds,
        })),
        paymentMethod,
      });
      onDone(order);
    } catch {
      setError('Could not save the sale.');
    } finally {
      setSaving(false);
    }
  };

  const canAddOptions =
    choosing !== null && validateSelection(choosing, optionIds).length === 0;

  return (
    <View style={styles.ringOverlay}>
      <View style={styles.ringSheet}>
        <View style={styles.ringHead}>
          <View>
            <Text style={styles.ringEyebrow}>Counter sale</Text>
            <Text style={styles.ringTitle}>Ring-up</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.ringError}>{error}</Text>}

        <ScrollView style={styles.ringBody} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color={theme.ink} />
          ) : (
            <View style={styles.menuGrid}>
              {menu.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.menuTile}
                  onPress={() => addItem(item)}
                >
                  <Text style={styles.menuTileName} numberOfLines={2}>
                    {item.nameEn}
                  </Text>
                  <Text style={styles.menuTilePrice}>{formatBaht(item.price)}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {choosing && (
            <View style={styles.optionPanel}>
              <Text style={styles.optionTitle}>{choosing.nameEn}</Text>
              {choosing.optionGroups.map((group) => (
                <View key={group.id} style={styles.optionGroup}>
                  <Text style={styles.optionLabel}>
                    {group.nameEn}
                    {group.minSelect > 0 ? ' *' : ''}
                  </Text>
                  <View style={styles.optionChoices}>
                    {group.options
                      .filter((option) => option.isAvailable)
                      .map((option) => (
                        <Pressable
                          key={option.id}
                          style={[
                            styles.optionChip,
                            optionIds.includes(option.id) && styles.optionChipOn,
                          ]}
                          onPress={() => toggleOption(choosing, group.id, option.id)}
                        >
                          <Text
                            style={[
                              styles.optionChipText,
                              optionIds.includes(option.id) && styles.optionChipTextOn,
                            ]}
                          >
                            {option.nameEn}
                            {option.priceDelta ? ` +${formatBaht(option.priceDelta)}` : ''}
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                </View>
              ))}
              <View style={styles.optionActions}>
                <Pressable style={styles.optionQuiet} onPress={() => setChoosing(null)}>
                  <Text style={styles.optionQuietText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.optionAdd, !canAddOptions && styles.disabled]}
                  onPress={confirmOptions}
                  disabled={!canAddOptions}
                >
                  <Text style={styles.optionAddText}>Add item</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.cartBox}>
            <Text style={styles.cartTitle}>Sale</Text>
            {pricedEntries.length === 0 ? (
              <Text style={styles.cartEmpty}>Tap menu items above.</Text>
            ) : (
              pricedEntries.map(({ entry, line }) => (
                <View key={entry.key} style={styles.cartLine}>
                  <Pressable
                    style={styles.cartRemove}
                    onPress={() => setCart((current) => removeEntry(current, entry.key))}
                    hitSlop={8}
                  >
                    <Text style={styles.cartRemoveText}>-</Text>
                  </Pressable>
                  <Text style={styles.cartQty}>{line.qty}×</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cartName}>{line.nameSnapshot}</Text>
                    {line.options.length > 0 && (
                      <Text style={styles.cartOptions}>
                        {line.options.map((option) => option.nameSnapshot).join(' · ')}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.cartAmount}>{formatBaht(lineTotal(line))}</Text>
                </View>
              ))
            )}
          </View>

        </ScrollView>

        <View style={styles.ringFoot}>
          <View style={styles.paySwitch}>
            {(['cash', 'promptpay'] as const).map((method) => (
              <Pressable
                key={method}
                style={[
                  styles.payChoice,
                  paymentMethod === method && styles.payChoiceOn,
                ]}
                onPress={() => setPaymentMethod(method)}
              >
                <Text
                  style={[
                    styles.payChoiceText,
                    paymentMethod === method && styles.payChoiceTextOn,
                  ]}
                >
                  {method === 'cash' ? 'Cash' : 'PromptPay'}
                </Text>
              </Pressable>
            ))}
          </View>
          {paymentMethod === 'promptpay' && total > 0 && (
            <View style={styles.promptpayBox}>
              <View style={styles.promptpayCopy}>
                <Text style={styles.promptpayTitle}>Ready to scan</Text>
                <Text style={styles.promptpayAmount}>{formatBaht(total)}</Text>
              </View>
              {promptpayLoading ? (
                <ActivityIndicator color={theme.ink} />
              ) : promptpayQr ? (
                <Image
                  source={{ uri: promptpayQr }}
                  style={styles.promptpayQr}
                  resizeMode="contain"
                />
              ) : (
                <Text style={styles.promptpayMissing}>
                  Add PromptPay in Stall settings to show a QR here.
                </Text>
              )}
              <Text style={styles.promptpayHint}>
                Save the sale after the bank app shows it paid.
              </Text>
            </View>
          )}
          <Pressable
            style={[styles.saveSale, count === 0 && styles.disabled]}
            onPress={() => void save()}
            disabled={count === 0 || saving}
            testID="ring-up-save"
          >
            {saving ? (
              <ActivityIndicator color={theme.white} />
            ) : (
              <Text style={styles.saveSaleText}>
                Save {total > 0 ? formatBaht(total) : 'sale'}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Connection({ state }: { state: Queue['connection'] }) {
  const label = {
    connecting: 'Connecting…',
    live: 'Live',
    polling: 'Checking every few seconds',
    offline: 'No connection',
  }[state];

  const colour = {
    connecting: theme.muted,
    live: theme.stool,
    polling: theme.yolk,
    offline: theme.chilli,
  }[state];

  return (
    <View style={styles.conn}>
      <View style={[styles.connDot, { backgroundColor: colour }]} />
      <Text style={[styles.connText, { color: colour }]}>{label}</Text>
    </View>
  );
}

function OrderCard({
  order,
  busy,
  onAdvance,
  onCancel,
}: {
  order: OrderDto;
  busy: boolean;
  onAdvance: () => void;
  onCancel: () => void;
}) {
  const waited = minutesBetween(order.placedAt, new Date());
  const action = nextAction[order.status as keyof typeof nextAction];

  return (
    <View style={styles.card}>
      <View style={[styles.edge, { backgroundColor: statusColour[order.status] }]} />

      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <Text style={styles.queueNo}>#{order.queueNo}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.time}>{localTime(order.placedAt)}</Text>
            <Text style={styles.waited}>
              {waited === 0 ? 'just now' : `${waited} min ago`}
            </Text>
          </View>
        </View>

        {order.lines.map((line, index) => (
          <View key={`${line.menuItemId}-${index}`} style={styles.line}>
            <Text style={styles.lineQty}>{line.qty}×</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.lineName}>{line.nameSnapshot}</Text>
              {line.options.length > 0 && (
                <Text style={styles.lineOptions}>
                  {line.options.map((option) => option.nameSnapshot).join(' · ')}
                </Text>
              )}
            </View>
            <Text style={styles.lineAmount}>{formatBaht(lineTotal(line))}</Text>
          </View>
        ))}

        <View style={styles.foot}>
          <Text style={styles.total}>{formatBaht(order.total)}</Text>
          <Pressable
            style={[styles.action, { backgroundColor: statusColour[order.status] }]}
            onPress={onAdvance}
            disabled={busy}
            testID={`advance-${order.queueNo}`}
          >
            {busy ? (
              <ActivityIndicator color={theme.white} />
            ) : (
              <Text style={styles.actionText}>{action}</Text>
            )}
          </Pressable>
        </View>

        {order.status === 'placed' && (
          <Pressable onPress={onCancel} hitSlop={8} testID={`cancel-${order.queueNo}`}>
            <Text style={styles.cancel}>Can’t make this — cancel it</Text>
          </Pressable>
        )}
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
  stall: { fontSize: 20, fontWeight: '800', color: theme.ink },
  signOut: { fontSize: 14, color: theme.muted, fontWeight: '600' },
  conn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  connDot: { width: 8, height: 8, borderRadius: 4 },
  connText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  quickRow: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 2,
    alignItems: 'flex-end',
  },
  ringButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 2,
    backgroundColor: theme.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringButtonText: { color: theme.white, fontSize: 14, fontWeight: '800' },

  list: { padding: 12, gap: 12, paddingBottom: 40 },

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
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  queueNo: { fontSize: 34, fontWeight: '800', color: theme.ink, lineHeight: 36 },
  time: { fontSize: 13, color: theme.ink, fontWeight: '600' },
  waited: { fontSize: 12, color: theme.muted },

  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  lineQty: { fontSize: 16, fontWeight: '700', color: theme.ink, minWidth: 26 },
  lineName: { fontSize: 16, color: theme.ink },
  lineOptions: { fontSize: 13, color: theme.muted, marginTop: 1 },
  lineAmount: { fontSize: 15, fontWeight: '600', color: theme.ink },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.rule,
    gap: 12,
  },
  total: { fontSize: 22, fontWeight: '800', color: theme.ink },
  action: {
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderRadius: 2,
    minWidth: 140,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { color: theme.white, fontSize: 16, fontWeight: '700' },
  cancel: { marginTop: 12, fontSize: 13, color: theme.muted, textAlign: 'center' },

  empty: { padding: 48, alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.ink, marginBottom: 6 },
  emptyBody: { fontSize: 15, color: theme.muted, textAlign: 'center', lineHeight: 21 },

  ringOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(22, 24, 28, 0.45)',
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  ringSheet: {
    maxHeight: '92%',
    backgroundColor: theme.paper,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  ringHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.rule,
  },
  ringEyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: theme.muted,
    fontWeight: '800',
  },
  ringTitle: { fontSize: 28, lineHeight: 32, color: theme.ink, fontWeight: '900' },
  closeText: { fontSize: 14, color: theme.muted, fontWeight: '700' },
  ringError: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    backgroundColor: '#FDECEC',
    color: theme.chilli,
    fontWeight: '700',
  },
  ringBody: { paddingHorizontal: 12, paddingTop: 12 },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  menuTile: {
    width: '31.8%',
    minHeight: 88,
    padding: 10,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 4,
    justifyContent: 'space-between',
  },
  menuTileName: {
    fontSize: 14,
    lineHeight: 18,
    color: theme.ink,
    fontWeight: '700',
  },
  menuTilePrice: {
    marginTop: 8,
    fontSize: 13,
    color: theme.stool,
    fontWeight: '800',
  },
  optionPanel: {
    marginTop: 12,
    padding: 12,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 4,
  },
  optionTitle: { fontSize: 18, fontWeight: '900', color: theme.ink },
  optionGroup: { marginTop: 12 },
  optionLabel: {
    fontSize: 12,
    color: theme.muted,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  optionChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.rule,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.paper,
  },
  optionChipOn: { backgroundColor: theme.ink, borderColor: theme.ink },
  optionChipText: { fontSize: 13, color: theme.ink, fontWeight: '700' },
  optionChipTextOn: { color: theme.white },
  optionActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  optionQuiet: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: theme.rule,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
  },
  optionQuietText: { color: theme.muted, fontWeight: '800' },
  optionAdd: {
    flex: 1.4,
    minHeight: 48,
    backgroundColor: theme.stool,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
  },
  optionAddText: { color: theme.white, fontWeight: '900' },
  cartBox: {
    marginTop: 14,
    marginBottom: 14,
    padding: 12,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 4,
  },
  cartTitle: {
    fontSize: 12,
    color: theme.muted,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  cartEmpty: { color: theme.muted, fontSize: 14 },
  cartLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: theme.rule,
  },
  cartRemove: {
    minWidth: 32,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartRemoveText: {
    color: theme.muted,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 28,
  },
  cartQty: {
    minWidth: 30,
    fontSize: 14,
    fontWeight: '800',
    color: theme.ink,
  },
  cartName: { fontSize: 15, color: theme.ink, fontWeight: '700' },
  cartOptions: { fontSize: 12, color: theme.muted, marginTop: 2 },
  cartAmount: { fontSize: 14, color: theme.ink, fontWeight: '800' },
  promptpayBox: {
    marginBottom: 14,
    padding: 14,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 4,
    alignItems: 'center',
  },
  promptpayCopy: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  promptpayTitle: {
    fontSize: 12,
    color: theme.muted,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  promptpayAmount: { fontSize: 24, color: theme.ink, fontWeight: '900' },
  promptpayQr: {
    width: 220,
    height: 220,
    backgroundColor: theme.white,
  },
  promptpayMissing: {
    paddingVertical: 24,
    color: theme.chilli,
    textAlign: 'center',
    fontWeight: '700',
    lineHeight: 20,
  },
  promptpayHint: {
    marginTop: 10,
    color: theme.muted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  ringFoot: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: theme.rule,
    backgroundColor: theme.paper,
  },
  paySwitch: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 10,
  },
  payChoice: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.paper,
  },
  payChoiceOn: { backgroundColor: theme.ink },
  payChoiceText: { color: theme.ink, fontWeight: '800' },
  payChoiceTextOn: { color: theme.white },
  saveSale: {
    minHeight: 56,
    backgroundColor: theme.stool,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
  },
  saveSaleText: { color: theme.white, fontSize: 17, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});
