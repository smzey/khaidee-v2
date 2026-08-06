import type { ReactNode } from 'react';
import { formatBaht, type ReportBrief } from '@khaidee/domain';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ApiError,
  fetchReport,
  type VendorReport,
  writeReportBrief,
} from '../api';
import {
  buildReportStatementHtml,
  reportStatementFileName,
} from '../reportStatement';
import type { Session } from '../session';
import { theme } from '../theme';

type Language = 'th' | 'en';

export function ReportScreen({
  session,
  onBack,
}: {
  session: Session;
  onBack: () => void;
}) {
  const [report, setReport] = useState<VendorReport | null>(null);
  const [brief, setBrief] = useState<ReportBrief | null>(null);
  const [language, setLanguage] = useState<Language>('th');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchReport(session.token);
      setReport(next);
      setBrief(null);
      setMessage(null);
    } catch {
      setMessage('Could not load report.');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const writeNote = async () => {
    setWriting(true);
    try {
      const next = await writeReportBrief(session.token, language);
      setReport(next);
      setBrief(next.brief);
      setMessage(
        next.skipped === 'not_enough_trade'
          ? 'Too little completed trade to write a useful note yet.'
          : next.cached
            ? 'Loaded saved note for these numbers.'
            : 'Report note ready.',
      );
    } catch (error) {
      setMessage(reportErrorMessage(error));
    } finally {
      setWriting(false);
    }
  };

  const ensureBrief = async (): Promise<{
    report: VendorReport;
    brief: ReportBrief | null;
  } | null> => {
    if (!report) return null;
    if (brief) return { report, brief };
    const next = await writeReportBrief(session.token, language);
    setReport(next);
    setBrief(next.brief);
    return { report: next, brief: next.brief };
  };

  const exportPdf = async () => {
    if (!report || exporting) return;

    setExporting(true);
    setMessage(null);
    try {
      const sharingAvailable = await Sharing.isAvailableAsync();
      if (!sharingAvailable) throw new Error('Sharing is not available.');

      const statement = await ensureBrief();
      if (!statement) throw new Error('No report available.');

      const printed = await Print.printToFileAsync({
        html: buildReportStatementHtml(statement),
      });
      const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!directory) throw new Error('No file directory available.');

      const fileUri = `${directory}${reportStatementFileName(
        statement.report,
        session.stall.slug,
      )}`;
      await FileSystem.copyAsync({ from: printed.uri, to: fileUri });
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Export report PDF',
        UTI: 'com.adobe.pdf',
      });
      setMessage('PDF statement export opened.');
    } catch (error) {
      setMessage(reportErrorMessage(error, 'Could not export the PDF statement.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mark}>REPORT</Text>
          <Text style={styles.title}>Today</Text>
        </View>
        <Pressable onPress={onBack} hitSlop={12} testID="report-back">
          <Text style={styles.back}>Home</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.ink} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroller}
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
          {message && <Text style={styles.message}>{message}</Text>}
          {report ? (
            <>
              <Text style={styles.date}>
                {report.range.from === report.range.to
                  ? report.range.from
                  : `${report.range.from} - ${report.range.to}`}
              </Text>
              <View style={styles.summary}>
                <Metric label="Sales" value={formatBaht(report.facts.takings.gross)} tone="dark" />
                <Metric label="Orders" value={String(report.facts.takings.orders)} tone="blue" />
                <Metric label="Avg" value={formatBaht(report.facts.takings.averageOrder)} tone="red" />
              </View>

              <View style={styles.split}>
                <Split label="Cash" value={formatBaht(report.facts.payment.cash.baht)} />
                <Split label="PromptPay" value={formatBaht(report.facts.payment.promptpay.baht)} />
                <Split label="Queue" value={formatBaht(report.facts.unfinished.openBaht)} />
              </View>

              <View style={styles.noteTools}>
                <View style={styles.language}>
                  <Pressable
                    onPress={() => setLanguage('th')}
                    style={[styles.langButton, language === 'th' && styles.langActive]}
                  >
                    <Text style={[styles.langText, language === 'th' && styles.langTextActive]}>
                      Thai
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setLanguage('en')}
                    style={[styles.langButton, language === 'en' && styles.langActive]}
                  >
                    <Text style={[styles.langText, language === 'en' && styles.langTextActive]}>
                      EN
                    </Text>
                  </Pressable>
                </View>
                <Pressable
                  onPress={writeNote}
                  disabled={writing}
                  style={[styles.writeButton, writing && styles.disabled]}
                  testID="write-report-note"
                >
                  {writing ? (
                    <ActivityIndicator color={theme.white} size="small" />
                  ) : (
                    <Text style={styles.writeText}>Write note</Text>
                  )}
                </Pressable>
              </View>

              <Pressable
                onPress={() => void exportPdf()}
                disabled={!report || exporting}
                style={[styles.exportButton, (!report || exporting) && styles.disabled]}
                testID="export-report-pdf"
              >
                {exporting ? (
                  <ActivityIndicator color={theme.ink} size="small" />
                ) : (
                  <Text style={styles.exportText}>Export PDF statement</Text>
                )}
              </Pressable>

              {brief && <BriefCard brief={brief} />}

              <Section title="Top Dishes">
                {report.facts.dishes.length ? (
                  report.facts.dishes.slice(0, 8).map((dish) => (
                    <RankRow
                      key={dish.menuItemId}
                      name={dish.name}
                      meta={`${dish.qty} sold`}
                      value={formatBaht(dish.baht)}
                      percent={`${dish.shareOfTakings}%`}
                    />
                  ))
                ) : (
                  <EmptyLine text="No completed dishes yet." />
                )}
              </Section>

              <Section title="Options">
                {report.facts.options.length ? (
                  report.facts.options.slice(0, 6).map((option) => (
                    <RankRow
                      key={option.name}
                      name={option.name}
                      meta={`${option.qty} times`}
                      value={formatBaht(option.baht)}
                      percent={`${option.attachRate}%`}
                    />
                  ))
                ) : (
                  <EmptyLine text="No option choices yet." />
                )}
              </Section>

              <Section title="By Hour">
                {report.facts.hours.length ? (
                  report.facts.hours.map((hour) => (
                    <HourRow key={hour.hour} hour={hour.hour} baht={hour.baht} />
                  ))
                ) : (
                  <EmptyLine text="No completed sales by hour yet." />
                )}
              </Section>

              <Section title="Service">
                <View style={styles.serviceGrid}>
                  <Split
                    label="Ready"
                    value={
                      report.facts.service.medianMinutesToReady === null
                        ? '-'
                        : `${report.facts.service.medianMinutesToReady} min`
                    }
                  />
                  <Split
                    label="Slowest"
                    value={
                      report.facts.service.slowestMinutesToReady === null
                        ? '-'
                        : `${report.facts.service.slowestMinutesToReady} min`
                    }
                  />
                  <Split
                    label="Pickup"
                    value={
                      report.facts.service.medianMinutesToCollect === null
                        ? '-'
                        : `${report.facts.service.medianMinutesToCollect} min`
                    }
                  />
                </View>
              </Section>
            </>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No report</Text>
              <Text style={styles.emptyBody}>Pull down to try again.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function reportErrorMessage(
  error: unknown,
  fallback = 'Could not write the note right now.',
): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.code === 'ai_unavailable') {
    return 'Add XAI_API_KEY to the API .env, then restart API.';
  }
  if (error.code === 'ai_key_rejected') {
    return 'xAI rejected this API key. Check the key or billing in xAI Console.';
  }
  if (error.code === 'ai_rate_limited') {
    return 'Grok is rate limited right now. Try again shortly.';
  }
  return fallback;
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

function Split({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.splitCell}>
      <Text style={styles.splitValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.splitLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.section}>{title}</Text>
      <View style={styles.rows}>{children}</View>
    </View>
  );
}

function RankRow({
  name,
  meta,
  value,
  percent,
}: {
  name: string;
  meta: string;
  value: string;
  percent: string;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.rowMeta}>{meta}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowValue}>{value}</Text>
        <Text style={styles.rowMeta}>{percent}</Text>
      </View>
    </View>
  );
}

function HourRow({ hour, baht }: { hour: number; baht: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.hour}>{String(hour).padStart(2, '0')}:00</Text>
      <Text style={styles.rowValue}>{formatBaht(baht)}</Text>
    </View>
  );
}

function BriefCard({ brief }: { brief: ReportBrief }) {
  return (
    <View style={styles.brief}>
      <Text style={styles.briefTitle}>{brief.headline}</Text>
      <Text style={styles.briefBody}>{brief.summary}</Text>
      {[...brief.wins, ...brief.watch].slice(0, 4).map((line) => (
        <Text key={line} style={styles.briefPoint}>
          {line}
        </Text>
      ))}
      {brief.actions.slice(0, 3).map((action) => (
        <View key={`${action.action}-${action.when}`} style={styles.action}>
          <Text style={styles.actionText}>{action.action}</Text>
          <Text style={styles.actionBecause}>{action.because}</Text>
        </View>
      ))}
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <Text style={styles.emptyLine}>{text}</Text>;
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
  scroller: { flex: 1 },
  body: { padding: 12, paddingBottom: 40, gap: 12 },
  message: {
    backgroundColor: theme.ink,
    color: theme.white,
    padding: 12,
    borderRadius: 3,
    fontSize: 14,
    fontWeight: '800',
  },
  date: {
    color: theme.muted,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  summary: { flexDirection: 'row', gap: 8 },
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
  split: { flexDirection: 'row', gap: 8 },
  splitCell: {
    flex: 1,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 12,
  },
  splitValue: { color: theme.ink, fontSize: 17, fontWeight: '900' },
  splitLabel: {
    marginTop: 3,
    color: theme.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  noteTools: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  language: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: theme.white,
  },
  langButton: {
    minHeight: 44,
    minWidth: 66,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  langActive: { backgroundColor: theme.ink },
  langText: { color: theme.muted, fontSize: 14, fontWeight: '900' },
  langTextActive: { color: theme.white },
  writeButton: {
    flex: 1,
    minHeight: 44,
    backgroundColor: theme.stool,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  disabled: { opacity: 0.55 },
  writeText: { color: theme.white, fontSize: 15, fontWeight: '900' },
  exportButton: {
    minHeight: 46,
    backgroundColor: theme.yolk,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  exportText: { color: theme.ink, fontSize: 15, fontWeight: '900' },
  brief: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    padding: 14,
    gap: 8,
  },
  briefTitle: { color: theme.ink, fontSize: 19, lineHeight: 24, fontWeight: '900' },
  briefBody: { color: theme.muted, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  briefPoint: { color: theme.ink, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  action: {
    borderTopWidth: 1,
    borderTopColor: theme.rule,
    paddingTop: 8,
    marginTop: 2,
  },
  actionText: { color: theme.stool, fontSize: 14, lineHeight: 20, fontWeight: '900' },
  actionBecause: { color: theme.muted, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  sectionBlock: { gap: 8 },
  section: {
    fontSize: 12,
    color: theme.muted,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  rows: { gap: 8 },
  row: {
    minHeight: 64,
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowName: { color: theme.ink, fontSize: 16, lineHeight: 20, fontWeight: '900' },
  rowMeta: { color: theme.muted, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  rowRight: { alignItems: 'flex-end' },
  rowValue: { color: theme.ink, fontSize: 16, lineHeight: 20, fontWeight: '900' },
  hour: { color: theme.muted, fontSize: 14, fontWeight: '900', letterSpacing: 0.8 },
  serviceGrid: { flexDirection: 'row', gap: 8 },
  emptyLine: {
    backgroundColor: theme.white,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    padding: 14,
    color: theme.muted,
    fontSize: 14,
    fontWeight: '800',
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
});
