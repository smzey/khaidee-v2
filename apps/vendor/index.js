import { registerRootComponent } from 'expo';
import App from './src/App';

/*
 * Plain Expo entry rather than expo-router. The vendor app is one screen —
 * a router bought nothing and crashed on load in the web bundle. When there
 * are tabs (queue / ring-up / menu) it will be worth reintroducing.
 */
registerRootComponent(App);
