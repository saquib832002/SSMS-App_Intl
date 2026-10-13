import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';
// live bus tracking: the background location task must be defined when the app starts
import './services/BusTracker';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
