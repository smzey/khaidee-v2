import { type OrderDto } from '@khaidee/domain';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import {
  notifyLocalNewOrder,
  onOrderNotificationTap,
  prepareOrderNotifications,
  registerRemoteOrderNotifications,
} from './notifications';
import { ForecastingScreen } from './screens/ForecastingScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { LaunchPadScreen } from './screens/LaunchPadScreen';
import { MenuScreen } from './screens/MenuScreen';
import { PlansScreen } from './screens/PlansScreen';
import { QueueScreen } from './screens/QueueScreen';
import { QrScreen } from './screens/QrScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { ReportScreen } from './screens/ReportScreen';
import { SignInScreen } from './screens/SignInScreen';
import { StallScreen } from './screens/StallScreen';
import { restoreRememberedSession } from './authFlow';
import { type Session, clearSession, saveStallIfRemembered } from './session';
import { theme } from './theme';
import { useQueue } from './useQueue';

/**
 * The whole app is one decision: is there a session? The token lasts a month,
 * so for a working vendor the answer is yes every morning and this component
 * is invisible.
 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  const [module, setModule] = useState<
    | 'home'
    | 'orders'
    | 'history'
    | 'forecasting'
    | 'report'
    | 'menu'
    | 'qr'
    | 'stall'
    | 'plans'
  >('home');
  const [remotePushReady, setRemotePushReady] = useState(false);

  const signOut = useCallback(async () => {
    await clearSession();
    setModule('home');
    setSession(null);
  }, []);

  const alertNewOrder = useCallback((order: OrderDto) => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    if (!remotePushReady) void notifyLocalNewOrder(order);
  }, [remotePushReady]);
  const handleQueueSignedOut = useCallback(() => {
    void signOut();
  }, [signOut]);
  const queue = useQueue(session?.token ?? null, alertNewOrder, handleQueueSignedOut);

  useEffect(() => {
    let live = true;
    void restoreRememberedSession().then((found) => {
      if (!live) return;
      setSession(found);
      setChecked(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setRemotePushReady(false);
      return;
    }

    let live = true;
    void prepareOrderNotifications();
    void registerRemoteOrderNotifications(session.token).then((ready) => {
      if (live) setRemotePushReady(ready);
    });
    return () => {
      live = false;
    };
  }, [session]);

  useEffect(() => {
    const subscription = onOrderNotificationTap(() => setModule('orders'));
    return () => subscription.remove();
  }, []);

  if (!checked) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: theme.paper, justifyContent: 'center' }}>
          <ActivityIndicator color={theme.ink} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.paper }} edges={['top']}>
        {session ? (
          module === 'orders' ? (
            <QueueScreen session={session} queue={queue} onBack={() => setModule('home')} />
          ) : module === 'history' ? (
            <HistoryScreen session={session} queue={queue} onBack={() => setModule('home')} />
          ) : module === 'forecasting' ? (
            <ForecastingScreen
              session={session}
              onBack={() => setModule('home')}
            />
          ) : module === 'report' ? (
            <ReportScreen session={session} onBack={() => setModule('home')} />
          ) : module === 'menu' ? (
            <MenuScreen session={session} onBack={() => setModule('home')} />
          ) : module === 'qr' ? (
            <QrScreen session={session} onBack={() => setModule('home')} />
          ) : module === 'plans' ? (
            <PlansScreen session={session} onBack={() => setModule('home')} />
          ) : module === 'stall' ? (
            <StallScreen
              session={session}
              onBack={() => setModule('home')}
              onStallChanged={(stall) =>
                setSession((current) => {
                  if (!current) return current;
                  void saveStallIfRemembered(stall);
                  return { ...current, stall };
                })
              }
            />
          ) : (
            <LaunchPadScreen
              session={session}
              queue={queue}
              onOpenOrders={() => setModule('orders')}
              onOpenHistory={() => setModule('history')}
              onOpenForecasting={() => setModule('forecasting')}
              onOpenReport={() => setModule('report')}
              onOpenMenu={() => setModule('menu')}
              onOpenQr={() => setModule('qr')}
              onOpenStall={() => setModule('stall')}
              onOpenPlans={() => setModule('plans')}
              onSignOut={signOut}
            />
          )
        ) : authMode === 'register' ? (
          <RegisterScreen
            onBack={() => setAuthMode('signin')}
            onSignedIn={(nextSession) => {
              setSession(nextSession);
              setModule('home');
              setAuthMode('signin');
            }}
          />
        ) : (
          <SignInScreen
            onCreate={() => setAuthMode('register')}
            onSignedIn={(nextSession) => {
              setSession(nextSession);
              setModule('home');
            }}
          />
        )}

      </SafeAreaView>
    </SafeAreaProvider>
  );
}
