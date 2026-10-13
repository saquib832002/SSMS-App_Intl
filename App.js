// App.js
import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import AppNavigator from "./navigation/AppNavigator";
import { AuthProvider, navigationRef } from "./context/AuthContext";
import SecurityGates from "./components/SecurityGates";
import { _t, _tx, initLanguage, useLanguage, LANGUAGES } from "./services/i18n";

// ── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.log('WHITE SCREEN ERROR:', error.message);
    console.log('COMPONENT:', info?.componentStack?.substring(0, 500));
  }
  render() {
    if (this.state.hasError) {
      return (
        <ScrollView style={{ flex:1, backgroundColor:'#fff', padding:20, marginTop:60 }}>
          <Text style={{ fontSize:16, fontWeight:'bold', color:'red', marginBottom:8 }}>{_t("App Error:")}</Text>
          <Text style={{ fontSize:13, color:'#c00', marginBottom:12 }}>
            {_tx(this.state.error?.message)}
          </Text>
          <Text style={{ fontSize:10, color:'#555', fontFamily:'monospace' }}>
            {this.state.error?.stack?.substring(0, 600)}
          </Text>
          <TouchableOpacity
            style={{ marginTop:20, padding:14, backgroundColor:'#2563eb', borderRadius:10 }}
            onPress={() => this.setState({ hasError:false, error:null })}
          >
            <Text style={{ color:'#fff', textAlign:'center', fontWeight:'700' }}>{_t("Retry")}</Text>
          </TouchableOpacity>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

// ── Language: the saved language is applied before the first screen; a change re-draws the screens ──
function LanguageRoot({ children }) {
  const [ready, setReady] = React.useState(false);
  const lang = useLanguage();
  React.useEffect(() => { initLanguage().finally(() => setReady(true)); }, []);
  if (!ready) return null;
  const rtl = !!LANGUAGES.find((l) => l.code === lang)?.rtl;
  return <View key={lang} style={{ flex: 1, direction: rtl ? "rtl" : "ltr" }}>{children}</View>;
}

// ─────────────────────────────────────────────────────────────────────────────
const App = () => (
  <ErrorBoundary>
    <AuthProvider>
      {/* Pass navigationRef so AuthContext can redirect without navigation prop */}
      <LanguageRoot>
        <NavigationContainer ref={navigationRef}>
          <AppNavigator />
          {/* privacy choices still to answer + two-step reminder, after sign-in */}
          <SecurityGates />
        </NavigationContainer>
      </LanguageRoot>
    </AuthProvider>
  </ErrorBoundary>
);

export default App;