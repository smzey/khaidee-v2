import { type OrderDto, formatBaht } from '@khaidee/domain';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerPushToken } from './api';

let configured = false;
let permissionAsked = false;

function configureHandler() {
  if (configured || Platform.OS === 'web') return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function prepareOrderNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  configureHandler();

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'New orders',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (permissionAsked) return false;

  permissionAsked = true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

function projectId(): string | undefined {
  const easProjectId = Constants.easConfig?.projectId;
  const configProjectId = (
    Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  )?.eas?.projectId;
  return easProjectId ?? configProjectId;
}

export async function registerRemoteOrderNotifications(
  authToken: string,
): Promise<boolean> {
  const allowed = await prepareOrderNotifications();
  if (!allowed || Platform.OS === 'web') return false;

  try {
    const id = projectId();
    const pushToken = await Notifications.getExpoPushTokenAsync(
      id ? { projectId: id } : undefined,
    );
    await registerPushToken(authToken, {
      token: pushToken.data,
      platform:
        Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null,
    });
    return true;
  } catch {
    return false;
  }
}

export async function notifyLocalNewOrder(order: OrderDto): Promise<void> {
  const allowed = await prepareOrderNotifications();
  if (!allowed) return;

  const itemCount = order.lines.reduce((total, line) => total + line.qty, 0);
  const firstItem = order.lines[0]?.nameSnapshot;
  const body = firstItem
    ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'} · ${firstItem} · ${formatBaht(order.total)}`
    : `${formatBaht(order.total)} waiting`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `New order #${order.queueNo}`,
      body,
      sound: 'default',
      data: { orderId: order.id },
    },
    trigger: null,
  });
}

export function onOrderNotificationTap(openOrders: () => void): { remove(): void } {
  if (Platform.OS === 'web') return { remove() {} };
  configureHandler();
  return Notifications.addNotificationResponseReceivedListener(openOrders);
}
