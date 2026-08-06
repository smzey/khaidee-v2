import { PLANS, type Tier, type TierPlan, priceLabel } from '@khaidee/domain';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { type PlansResponse, fetchPlans, isSignedOut } from '../api';
import type { Session } from '../session';
import { theme } from '../theme';

/**
 * What the stall is on, and what the next step up buys.
 *
 * The plans are fetched rather than bundled — a price change should reach a
 * vendor's phone without an app-store release. The local PLANS are the
 * fallback for a stall standing somewhere with no signal, which is most of
 * them, most of the time.
 */
export function PlansScreen({
  session,
  onBack,
  highlight,
}: {
  session: Session;
  onBack: () => void;
  /** Scrolls to and marks the tier the vendor just bumped into. */
  highlight?: Tier;
}) {
  const [data, setData] = useState<PlansResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void fetchPlans(session.token)
      .then((found) => {
        if (live) setData(found);
      })
      .catch((error: unknown) => {
        if (!isSignedOut(error) && live) setData(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [session.token]);

  const current: Tier = data?.current ?? session.stall.tier;
  const plans: TierPlan[] = data?.plans ?? [PLANS.free, PLANS.pro, PLANS.premium];

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button">
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Plans</Text>
        <Text style={styles.lead}>
          Core ordering, reports, forecasting, QR, and counter sales are free.
        </Text>
      </View>

      {loading ? (
        <View style={styles.centred}>
          <ActivityIndicator color={theme.ink} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {plans.map((plan) => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              current={plan.tier === current}
              flagged={plan.tier === highlight}
            />
          ))}

          {/*
            No payment gateway yet, and pretending otherwise would be the one
            screen in this app that lies. Said plainly instead.
          */}
          <Text style={styles.footnote}>
            Paid plans are optional add-ons while billing is being set up. The
            current stall workflow stays free.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function PlanCard({
  plan,
  current,
  flagged,
}: {
  plan: TierPlan;
  current: boolean;
  flagged: boolean;
}) {
  return (
    <View
      style={[styles.card, current && styles.cardCurrent, flagged && styles.cardFlagged]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.planName}>{plan.nameEn}</Text>
        {current ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>YOUR PLAN</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.price}>{priceLabel(plan.tier)}</Text>
      <Text style={styles.tagline}>{plan.taglineEn}</Text>
      <Text style={styles.taglineTh}>{plan.taglineTh}</Text>

      <View style={styles.rule} />

      {plan.inherits ? (
        <Text style={styles.inherits}>
          Everything in {PLANS[plan.inherits].nameEn}, plus:
        </Text>
      ) : null}

      {plan.linesEn.map((line, index) => (
        <View key={line} style={styles.line}>
          <Text style={styles.tick}>✓</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.lineText}>{line}</Text>
            <Text style={styles.lineTextTh}>{plan.linesTh[index]}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  head: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: theme.rule,
  },
  back: { fontSize: 16, fontWeight: '800', color: theme.stool, marginBottom: 8 },
  title: { fontSize: 30, fontWeight: '900', color: theme.ink, letterSpacing: -0.5 },
  lead: { fontSize: 14, color: theme.muted, marginTop: 4, lineHeight: 20 },

  centred: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 14, paddingBottom: 40 },

  card: {
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    backgroundColor: theme.white,
    padding: 18,
  },
  cardCurrent: { borderWidth: 2, borderColor: theme.ink },
  cardFlagged: { borderWidth: 2, borderColor: theme.yolk },

  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planName: { fontSize: 24, fontWeight: '900', color: theme.ink },
  badge: {
    backgroundColor: theme.ink,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
  },
  badgeText: {
    color: theme.white,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },

  price: { fontSize: 21, fontWeight: '900', color: theme.stool, marginTop: 6 },
  tagline: { fontSize: 15, fontWeight: '700', color: theme.ink, marginTop: 8 },
  taglineTh: { fontSize: 14, color: theme.muted, marginTop: 1 },

  rule: { height: 1, backgroundColor: theme.rule, marginVertical: 14 },
  inherits: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.muted,
    marginBottom: 10,
  },

  line: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  tick: { color: theme.stool, fontSize: 15, fontWeight: '900', lineHeight: 21 },
  lineText: { fontSize: 15, color: theme.ink, lineHeight: 21 },
  lineTextTh: { fontSize: 13, color: theme.muted, lineHeight: 19 },

  footnote: {
    fontSize: 13,
    color: theme.muted,
    lineHeight: 19,
    paddingHorizontal: 2,
    paddingTop: 4,
  },
});
