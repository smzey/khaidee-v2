import { formatBaht } from '@khaidee/domain';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchTomorrowForecast, type TomorrowForecast } from '../api';
import { formatForecastQty } from '../forecasting';
import type { Session } from '../session';
import { theme } from '../theme';

export function ForecastingScreen({
  session,
  onBack,
}: {
  session: Session;
  onBack: () => void;
}) {
  const [forecast, setForecast] = useState<TomorrowForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setForecast(await fetchTomorrowForecast(session.token));
      setError(null);
    } catch {
      setError('Could not load tomorrow forecast.');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mark}>FORECASTING</Text>
          <Text style={styles.title}>Tomorrow</Text>
        </View>
        <Pressable onPress={onBack} hitSlop={12} testID="forecasting-back">
          <Text style={styles.back}>Home</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.ink} />
        </View>
      ) : (
        <FlatList
          data={forecast?.ingredients ?? []}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
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
          ListHeaderComponent={
            <View>
              {error && <Text style={styles.error}>{error}</Text>}
              {forecast && (
                <>
                  <View style={styles.summary}>
                    <Metric
                      label="Avg sales"
                      value={formatBaht(forecast.history.averageRevenue)}
                      tone="dark"
                    />
                    <Metric
                      label="Forecast"
                      value={formatBaht(forecast.history.projectedRevenue)}
                      tone="blue"
                    />
                    <Metric
                      label="Orders"
                      value={String(forecast.history.completedOrders)}
                      tone="red"
                    />
                  </View>
                  <WeatherBox forecast={forecast} />
                  {forecast.notes.length > 0 && (
                    <View style={styles.notes}>
                      {forecast.notes.map((note) => (
                        <Text key={note} style={styles.noteText}>
                          {note}
                        </Text>
                      ))}
                    </View>
                  )}
                  {forecast.missingRecipeDishes.length > 0 && (
                    <View style={styles.warning}>
                      <Text style={styles.warningTitle}>Missing recipes</Text>
                      <Text style={styles.warningBody}>
                        {forecast.missingRecipeDishes.slice(0, 5).join(', ')}
                        {forecast.missingRecipeDishes.length > 5 ? '...' : ''}
                      </Text>
                    </View>
                  )}
                </>
              )}
              <Text style={styles.section}>Main Ingredients</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No prep forecast yet</Text>
              <Text style={styles.emptyBody}>
                Finish some orders and add ingredients in Menu to forecast tomorrow.
              </Text>
            </View>
          }
          renderItem={({ item }) => <IngredientCard ingredient={item} />}
        />
      )}
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
  tone: 'blue' | 'dark' | 'red';
}) {
  const color = tone === 'red' ? theme.chilli : tone === 'dark' ? theme.ink : theme.stool;
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function WeatherBox({ forecast }: { forecast: TomorrowForecast }) {
  const weather = forecast.weather;
  return (
    <View style={styles.weather}>
      <View>
        <Text style={styles.weatherTitle}>
          {weather ? `${weather.summary} in ${weather.location}` : 'Weather unavailable'}
        </Text>
        <Text style={styles.weatherBody}>
          {weather
            ? `${weather.tempMinC ?? '-'}-${weather.tempMaxC ?? '-'} C, rain ${weather.precipitationProbability ?? '-'}%`
            : 'Forecast uses sales average only.'}
        </Text>
      </View>
      <View style={styles.multiplier}>
        <Text style={styles.multiplierValue}>
          {Math.round(forecast.history.demandMultiplier * 100)}%
        </Text>
        <Text style={styles.multiplierLabel}>Demand</Text>
      </View>
    </View>
  );
}

function IngredientCard({
  ingredient,
}: {
  ingredient: TomorrowForecast['ingredients'][number];
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.ingredientName}>{ingredient.name}</Text>
        <Text style={styles.ingredientTotal}>
          {formatForecastQty(ingredient.forecastQty, ingredient.unit)}
        </Text>
      </View>
      <View style={styles.breakdown}>
        <View style={styles.breakdownCell}>
          <Text style={styles.breakdownValue}>
            {formatForecastQty(ingredient.averageQty, ingredient.unit)}
          </Text>
          <Text style={styles.breakdownLabel}>Daily avg</Text>
        </View>
        <View style={styles.breakdownCell}>
          <Text style={styles.breakdownValue}>
            {formatForecastQty(ingredient.forecastQty, ingredient.unit)}
          </Text>
          <Text style={styles.breakdownLabel}>Tomorrow</Text>
        </View>
      </View>
      <Text style={styles.dishes} numberOfLines={2}>
        {ingredient.dishes.join(', ')}
      </Text>
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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12, paddingBottom: 40, gap: 12 },
  error: {
    backgroundColor: theme.chilli,
    color: theme.white,
    padding: 12,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 12,
  },
  summary: { flexDirection: 'row', gap: 8, marginBottom: 12 },
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
    fontSize: 22,
    lineHeight: 26,
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
  weather: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    padding: 14,
    marginBottom: 12,
  },
  weatherTitle: { color: theme.ink, fontSize: 17, fontWeight: '900', marginBottom: 3 },
  weatherBody: { color: theme.muted, fontSize: 14, fontWeight: '800' },
  multiplier: {
    minWidth: 72,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.paper,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: theme.rule,
  },
  multiplierValue: { color: theme.stool, fontSize: 20, fontWeight: '900' },
  multiplierLabel: {
    color: theme.muted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  notes: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  noteText: { color: theme.muted, fontSize: 13, fontWeight: '800', lineHeight: 18 },
  warning: {
    backgroundColor: '#FFF4CC',
    borderWidth: 1,
    borderColor: theme.yolk,
    borderRadius: 3,
    padding: 12,
    marginBottom: 12,
  },
  warningTitle: { color: theme.ink, fontSize: 15, fontWeight: '900', marginBottom: 4 },
  warningBody: { color: theme.muted, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  section: {
    fontSize: 12,
    color: theme.muted,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  empty: {
    alignItems: 'center',
    padding: 36,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
  },
  emptyTitle: { fontSize: 18, color: theme.ink, fontWeight: '900', marginBottom: 6 },
  emptyBody: { fontSize: 14, color: theme.muted, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 14,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  ingredientName: {
    flex: 1,
    color: theme.ink,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '900',
  },
  ingredientTotal: { color: theme.ink, fontSize: 23, lineHeight: 27, fontWeight: '900' },
  breakdown: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  breakdownCell: {
    flex: 1,
    backgroundColor: theme.paper,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 10,
  },
  breakdownValue: { color: theme.ink, fontSize: 16, fontWeight: '900' },
  breakdownLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  dishes: { color: theme.muted, fontSize: 13, fontWeight: '700', lineHeight: 18 },
});
