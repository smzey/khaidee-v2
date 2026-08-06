import { PLANS, type Tier, can, priceLabel } from '@khaidee/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError, askAssistant, upgradeNeeded } from '../api';
import {
  type ChatMessage,
  SUGGESTIONS,
  consultedLabel,
  nextMessageId,
  toHistory,
} from '../assistantThread';
import { theme } from '../theme';

/**
 * The assistant, as a bubble that follows the vendor across the app.
 *
 * It answers only from the stall's own figures — the server gives the model
 * tools rather than data, so a number it states was fetched, not remembered.
 * The caption under each answer says what it read, which is the point: the
 * vendor should be able to tell the difference between an answer and a guess.
 */
export function AssistantBubble({
  token,
  tier,
  onUpgrade,
}: {
  token: string;
  tier: Tier;
  onUpgrade: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // The bubble stays visible on the free plan and sells the upgrade rather
  // than disappearing. A feature a vendor never sees is one they never buy.
  const included = can(tier, 'assistant');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [messages, thinking, open]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || thinking) return;

      const asked: ChatMessage = {
        id: nextMessageId(),
        role: 'user',
        content: question,
      };

      // The thread as it stood BEFORE this question — the question travels in
      // its own field, and sending it twice makes the model answer it twice.
      const history = toHistory(messages);
      setMessages((current) => [...current, asked]);
      setDraft('');
      setThinking(true);

      try {
        const answer = await askAssistant(token, question, history);
        setMessages((current) => [
          ...current,
          {
            id: nextMessageId(),
            role: 'assistant',
            content: answer.reply,
            consulted: answer.toolCalls.map((call) => call.name),
          },
        ]);
      } catch (error) {
        // A plan that lapsed mid-conversation should show a price, not an
        // error the vendor cannot act on.
        if (upgradeNeeded(error)) {
          setBlocked(true);
          setMessages((current) => current.slice(0, -1));
          return;
        }
        setMessages((current) => [
          ...current,
          {
            id: nextMessageId(),
            role: 'assistant',
            failed: true,
            content:
              error instanceof ApiError
                ? error.message
                : 'Something went wrong. Try again.',
          },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [messages, thinking, token],
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ask about your stall"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.bubble, pressed && styles.bubblePressed]}
      >
        <Text style={styles.bubbleMark}>ถาม</Text>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropTap} onPress={() => setOpen(false)} />

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.sheet}
          >
            <View style={styles.grabber} />

            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Ask about your stall</Text>
                <Text style={styles.subtitle}>
                  Answers come from your own orders
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setOpen(false)}
                hitSlop={12}
                style={styles.close}
              >
                <Text style={styles.closeMark}>✕</Text>
              </Pressable>
            </View>

            {!included || blocked ? (
              <Upsell
                onUpgrade={() => {
                  setOpen(false);
                  onUpgrade();
                }}
              />
            ) : (
            <ScrollView
              ref={scroller}
              style={styles.thread}
              contentContainerStyle={styles.threadInner}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyLead}>
                    Ask anything about how the stall is doing.
                  </Text>
                  {SUGGESTIONS.map((suggestion) => (
                    <Pressable
                      key={suggestion}
                      accessibilityRole="button"
                      onPress={() => void send(suggestion)}
                      style={({ pressed }) => [
                        styles.chip,
                        pressed && styles.chipPressed,
                      ]}
                    >
                      <Text style={styles.chipText}>{suggestion}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                messages.map((message) => (
                  <Turn key={message.id} message={message} />
                ))
              )}

              {thinking ? (
                <View style={[styles.turn, styles.fromBot]}>
                  <ActivityIndicator color={theme.muted} />
                </View>
              ) : null}
            </ScrollView>
            )}

            {!included || blocked ? null : (
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Ask something…"
                placeholderTextColor={theme.muted}
                style={styles.input}
                multiline
                maxLength={500}
                editable={!thinking}
                onSubmitEditing={() => void send(draft)}
                returnKeyType="send"
                accessibilityLabel="Your question"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                disabled={thinking || draft.trim().length === 0}
                onPress={() => void send(draft)}
                style={({ pressed }) => [
                  styles.send,
                  (thinking || draft.trim().length === 0) && styles.sendOff,
                  pressed && styles.sendPressed,
                ]}
              >
                <Text style={styles.sendMark}>→</Text>
              </Pressable>
            </View>
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

function Upsell({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <View style={styles.upsell}>
      <Text style={styles.upsellLead}>
        Ask anything about your stall and get an answer from your own orders —
        how today went, what sells best, whether this week beat last week.
      </Text>
      <Text style={styles.upsellPlan}>
        {PLANS.pro.nameEn} · {priceLabel('pro')}
      </Text>
      <Text style={styles.upsellTagline}>{PLANS.pro.taglineEn}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onUpgrade}
        style={({ pressed }) => [styles.upsellButton, pressed && styles.upsellPressed]}
      >
        <Text style={styles.upsellButtonText}>See plans</Text>
      </Pressable>
    </View>
  );
}

function Turn({ message }: { message: ChatMessage }) {
  const mine = message.role === 'user';
  const caption = message.consulted ? consultedLabel(message.consulted) : null;

  return (
    <View style={[styles.turn, mine ? styles.fromMe : styles.fromBot]}>
      <View
        style={[
          styles.balloon,
          mine && styles.balloonMine,
          message.failed && styles.balloonFailed,
        ]}
      >
        <Text style={[styles.body, mine && styles.bodyMine]}>{message.content}</Text>
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    right: 16,
    bottom: 22,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: theme.stool,
    borderWidth: 2,
    borderColor: theme.ink,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 90,
    elevation: 8,
  },
  bubblePressed: { backgroundColor: theme.ink },
  bubbleMark: {
    color: theme.white,
    fontSize: 19,
    fontWeight: '900',
  },

  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropTap: { flex: 1, backgroundColor: 'rgba(22,24,28,0.34)' },
  sheet: {
    height: '82%',
    backgroundColor: theme.paper,
    borderTopWidth: 2,
    borderColor: theme.ink,
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.rule,
    marginTop: 10,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderColor: theme.rule,
  },
  title: { fontSize: 19, fontWeight: '900', color: theme.ink },
  subtitle: { fontSize: 13, color: theme.muted, marginTop: 2 },
  close: { padding: 4 },
  closeMark: { fontSize: 20, color: theme.muted, fontWeight: '800' },

  thread: { flex: 1 },
  threadInner: { padding: 16, paddingBottom: 22, gap: 12 },

  empty: { gap: 10, paddingTop: 6 },
  emptyLead: {
    fontSize: 15,
    color: theme.muted,
    marginBottom: 4,
    lineHeight: 21,
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: theme.white,
  },
  chipPressed: { backgroundColor: theme.rule },
  chipText: { fontSize: 15, fontWeight: '700', color: theme.ink },

  turn: { maxWidth: '88%' },
  fromMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  fromBot: { alignSelf: 'flex-start' },
  balloon: {
    borderRadius: 3,
    borderWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.white,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  balloonMine: {
    backgroundColor: theme.stool,
    borderColor: theme.ink,
  },
  balloonFailed: {
    backgroundColor: theme.white,
    borderColor: theme.chilli,
  },
  body: { fontSize: 16, lineHeight: 23, color: theme.ink },
  bodyMine: { color: theme.white, fontWeight: '700' },
  caption: {
    fontSize: 12,
    color: theme.muted,
    marginTop: 5,
    marginLeft: 2,
  },

  upsell: { flex: 1, padding: 20, gap: 10 },
  upsellLead: { fontSize: 16, lineHeight: 24, color: theme.ink },
  upsellPlan: { fontSize: 20, fontWeight: '900', color: theme.stool, marginTop: 10 },
  upsellTagline: { fontSize: 14, color: theme.muted },
  upsellButton: {
    marginTop: 14,
    backgroundColor: theme.stool,
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: 3,
    paddingVertical: 16,
    alignItems: 'center',
  },
  upsellPressed: { backgroundColor: theme.ink },
  upsellButtonText: { color: theme.white, fontSize: 16, fontWeight: '900' },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
    borderColor: theme.rule,
    backgroundColor: theme.white,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: 3,
    paddingHorizontal: 13,
    paddingTop: 13,
    paddingBottom: 13,
    fontSize: 16,
    color: theme.ink,
    backgroundColor: theme.paper,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 3,
    backgroundColor: theme.stool,
    borderWidth: 1,
    borderColor: theme.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: theme.rule, borderColor: theme.rule },
  sendPressed: { backgroundColor: theme.ink },
  sendMark: { color: theme.white, fontSize: 21, fontWeight: '900' },
});
