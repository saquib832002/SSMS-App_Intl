// ============================================
// screens/LoginScreen.js
// ============================================
import React, { useState, useContext, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Dimensions,
  Keyboard,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../context/AuthContext";
import { AppStyles, Theme } from "../styles/AppStyles";

import { BASE_URL } from "../Environment/EnvironmentConfig";
const { width } = Dimensions.get("window");
const isTablet = width >= 768;

export default function LoginScreen({ navigation }) {
  const { login } = useContext(AuthContext);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [secureText, setSecureText] = useState(true);
  const [loading, setLoading] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "android" ? "keyboardDidShow" : "keyboardWillShow";
    const hideEvent = Platform.OS === "android" ? "keyboardDidHide" : "keyboardWillHide";
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const handleLogin = async () => {
    if (!username.trim()) {
      Alert.alert("Validation", "Please enter username");
      return;
    }

    if (!password.trim()) {
      Alert.alert("Validation", "Please enter password");
      return;
    }
      const loginUrl = `${BASE_URL.replace(/\/+$/, "")}/UserServiceApi/login`;
     // console.log("=== LOGIN URL ===", loginUrl);
try {
      setLoading(true);
      const response = await fetch(loginUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      // Safe parse — strip any PHP warnings prepended before the JSON body
      const rawText = await response.text();
      //console.log("=== RAW LOGIN RESPONSE ===", rawText.slice(0, 300));
      let res;
      try {
        const jsonStart = rawText.indexOf('{');
        if (jsonStart === -1) {
          console.error("Server returned non-JSON (first 300 chars):", rawText.slice(0, 300));
          throw new Error(`Server error ${response.status}: unexpected response`);
        }
        if (jsonStart > 0) {
          console.warn("PHP warning stripped from response:", rawText.slice(0, jsonStart).trim());
        }
        res = JSON.parse(rawText.slice(jsonStart));
      } catch (parseErr) {
        console.error("Server response (first 300 chars):", rawText.slice(0, 300));
        throw new Error(`Server error ${response.status}: ${parseErr.message}`);
      }
      //console.log("=== LOGIN RESPONSE ===", JSON.stringify(res.data));

      // Backend wraps response in { status: true, data: { token, ssmsUserName, ... } }
      const data = res.data ?? res;

      if (res.status) {
        const userData = {
          ssmsUserName:   data.ssmsUserName   ?? data.username    ?? '',
          firstName:      data.firstName      ?? '',
          lastName:       data.lastName       ?? '',
          userEmail:      data.userEmail       ?? data.email       ?? '',
          ssmsUserRole:   data.ssmsUserRole    ?? data.role        ?? '',
          ssmsClientCode: data.ssmsClientCode  ?? data.client_code ?? '',
          token:          data.token           ?? '',
          expiresAt:      data.expiresAt       ?? null,
          branchId:       data.branchId        ?? null,
          enrollmentId:   data.enrollmentId    ?? data.enrollment_id ?? null,
          staffId:        data.staffId         ?? null,
          billingModel:   data.billingModel === 'subscription' ? 'subscription' : 'legacy',
          // Product modules (school / finance / library …) – same as before
          activeModules:  Array.isArray(data.activeModules) ? data.activeModules : ['school'],
          // Plan features for subscription (international) schools
          activeFeatures: Array.isArray(data.activeFeatures) ? data.activeFeatures : ['core'],
        };
       // console.log("=== STORING USER ===", JSON.stringify(userData));
        login(userData);
        // No manual navigation needed — AppNavigator's auth guard switches
        // to the authenticated stack automatically when user becomes non-null.

      } else {
       Alert.alert("Login Failed", res.message || "Invalid username or password");
       // Alert.alert("Login Attempt", `Username: ${username}\nPassword: ${password}\n\n(${BASE_URL}/UserServiceApi/login)`);    

      }
    } catch (error) {
      console.error("Login error:", error);
      Alert.alert("Error", "Unable to connect to server");
    //  Alert.alert("Login Attempt", `Username: ${username}\nPassword: ${password}\n\n(${BASE_URL}/UserServiceApi/login)`);    

    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={AppStyles.safeArea}>
      <LinearGradient
        colors={["#e0ecff", "#f8fbff", "#eef4ff"]}
        style={AppStyles.gradientBg}
      >
        <ScrollView
            contentContainerStyle={[AppStyles.scrollContainer, { paddingBottom: keyboardHeight + 40 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* ================= TOP SECTION ================= */}
            <View style={AppStyles.topSection}>
              <View style={AppStyles.logoOuter}>
                <LinearGradient
                  colors={["#2563eb", "#1d4ed8", "#0f172a"]}
                  style={AppStyles.logoCircle}
                >
                  <Feather name="book-open" size={isTablet ? 34 : 28} color="#fff" />
                </LinearGradient>
              </View>

              <Text style={AppStyles.appTitle}>School Management System</Text>
              <Text style={AppStyles.appSubtitle}>
                By ManagemyAcademy
              </Text>
            </View>

            {/* ================= MIDDLE SECTION ================= */}
            <View style={AppStyles.middleSection}>
              <View style={AppStyles.loginCard}>
                <View style={AppStyles.cardHeader}>
                  <Text style={AppStyles.cardTitle}>Welcome Back</Text>
                  <Text style={AppStyles.cardSubtitle}>
                    Login to continue...
                  </Text>
                </View>

                {/* Username */}
                <View style={AppStyles.fieldBlock}>
                  <Text style={AppStyles.fieldLabel}>Username</Text>
                  <View style={AppStyles.inputWrapper}>
                    <Feather
                      name="user"
                      size={18}
                      color="#190fd7"
                      style={AppStyles.inputIcon}
                    />
                    <TextInput
                      placeholder="Enter your username"
                      placeholderTextColor="#c72f5c"
                      style={AppStyles.input}
                      value={username}
                      onChangeText={setUsername}
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                {/* Password */}
                <View style={AppStyles.fieldBlock}>
                  <Text style={AppStyles.fieldLabel}>Password</Text>
                  <View style={AppStyles.inputWrapper}>
                    <Feather
                      name="lock"
                      size={18}
                      color="#190fd7"
                      style={AppStyles.inputIcon}
                    />
                    <TextInput
                      placeholder="Enter your password"
                      placeholderTextColor="#c72f5c"
                      secureTextEntry={secureText}
                      style={AppStyles.input}
                      value={password}
                      onChangeText={setPassword}
                    />
                    <Pressable onPress={() => setSecureText((prev) => !prev)}>
                      <Feather
                        name={secureText ? "eye-off" : "eye"}
                        size={18}
                        color="#64748b"
                      />
                    </Pressable>
                  </View>
                </View>

                <View style={AppStyles.actionRow}>
                 <TouchableOpacity
                   onPress={() => navigation.navigate("ForgotPassword")}
                 >
                   <Text style={AppStyles.forgotLink}>Forgot Password?</Text>
                 </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[AppStyles.loginButton, loading && AppStyles.loginButtonDisabled]}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Feather name="log-in" size={18} color="#fff" />
                      <Text style={AppStyles.loginButtonText}> Login</Text>
                    </>
                  )}
                </TouchableOpacity>

                <View style={AppStyles.registerRow}>
                  <Text style={AppStyles.registerText}>Don’t have an account? </Text>
                 </View>
                <View style={AppStyles.registerRow}>
                  <TouchableOpacity onPress={() => navigation.navigate("TrialRegistrationScreen")}>
                    <Text style={AppStyles.registerLink}>Register here for your institution account</Text>
                  </TouchableOpacity>
                </View>
                <View style={[AppStyles.registerRow, { marginTop: 10 }]}>
                  <TouchableOpacity onPress={() => navigation.navigate("StudentParentRegistration")}>
                    <Text style={AppStyles.registerLink}>Student / Parent? Register here</Text>
                  </TouchableOpacity>
                </View>
                <View style={[AppStyles.registerRow, { marginTop: 10 }]}>
                  <TouchableOpacity
                    onPress={() =>
                      navigation.navigate("TrialRegistrationScreen", { verifyMode: true })
                    }
                  >
                    <Text style={AppStyles.registerLink}>Verify existing registration</Text>
                  </TouchableOpacity>
                </View>

                <View style={[AppStyles.registerRow, { marginTop: 16 }]}>
                  <View style={{ height: 1, flex: 1, backgroundColor: '#e2e8f0' }} />
                </View>

                <View style={[AppStyles.registerRow, { marginTop: 16 }]}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 }}
                    onPress={() => navigation.navigate("ContactScreen")}
                  >
                    <Feather name="headphones" size={15} color="#ea580c" />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#ea580c' }}>Contact Admin / Support</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* ================= BOTTOM SECTION ================= */}
            <View style={AppStyles.bottomSection}>
              <Text style={AppStyles.versionText}>Version 1.0.0</Text>
              <Text style={AppStyles.bottomSubText}>
                Built for efficient school administration with secure access,
                responsive design, and enterprise-ready workflows across web,
                Android, iOS, and tablets.
              </Text>

              <View style={AppStyles.featureRow}>
                <View style={AppStyles.featureBadge}>
                  <Feather name="shield" size={14} color="#2563eb" />
                  <Text style={AppStyles.featureText}> Secure</Text>
                </View>
                <View style={AppStyles.featureBadge}>
                  <Feather name="monitor" size={14} color="#2563eb" />
                  <Text style={AppStyles.featureText}> Web Ready</Text>
                </View>
                <View style={AppStyles.featureBadge}>
                  <Feather name="smartphone" size={14} color="#2563eb" />
                  <Text style={AppStyles.featureText}> Mobile Ready</Text>
                </View>
              </View>
            </View>
          </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

// const Appstyles = Appstylesheet.create({
//   safeArea: {
//     flex: 1,
//     backgroundColor: "#f8fbff",
//   },
//   gradientBg: {
//     flex: 1,
//   },
//   flexOne: {
//     flex: 1,
//   },
//   scrollContainer: {
//     flexGrow: 1,
//     justifyContent: "space-between",
//     paddingHorizontal: isTablet ? 60 : 22,
//     paddingVertical: isTablet ? 34 : 22,
//   },

//   // Top
//   topSection: {
//     alignItems: "center",
//     marginTop: isTablet ? 20 : 10,
//     marginBottom: 20,
//   },
//   logoOuter: {
//     marginBottom: 16,
//   },
//   logoCircle: {
//     width: isTablet ? 94 : 82,
//     height: isTablet ? 94 : 82,
//     borderRadius: 47,
//     justifyContent: "center",
//     alignItems: "center",
//     shadowColor: "#1d4ed8",
//     shadowOpacity: 0.22,
//     shadowRadius: 10,
//     shadowOffset: { width: 0, height: 6 },
//     elevation: 7,
//   },
//   appTitle: {
//     fontSize: isTablet ? 30 : 24,
//     fontWeight: "800",
//     color: "#0f172a",
//     textAlign: "center",
//     marginBottom: 8,
//   },
//   appSubtitle: {
//     fontSize: isTablet ? 16 : 14,
//     color: "#475569",
//     textAlign: "center",
//     lineHeight: 22,
//     maxWidth: isTablet ? 560 : "100%",
//   },

//   // Middle
//   middleSection: {
//     flex: 1,
//     justifyContent: "center",
//     marginVertical: 14,
//   },
//   loginCard: {
//     backgroundColor: "rgba(255,255,255,0.95)",
//     borderRadius: 22,
//     padding: isTablet ? 30 : 22,
//     shadowColor: "#0f172a",
//     shadowOpacity: 0.1,
//     shadowRadius: 14,
//     shadowOffset: { width: 0, height: 6 },
//     elevation: 5,
//     borderWidth: 1,
//     borderColor: "#e2e8f0",
//     maxWidth: isTablet ? 620 : "100%",
//     alignSelf: "center",
//     width: "100%",
//   },
//   cardHeader: {
//     marginBottom: 18,
//   },
//   cardTitle: {
//     fontSize: isTablet ? 28 : 22,
//     fontWeight: "700",
//     color: "#0f172a",
//     marginBottom: 6,
//   },
//   cardSubtitle: {
//     fontSize: isTablet ? 15 : 14,
//     color: "#64748b",
//   },
//   fieldBlock: {
//     marginBottom: 10,
//   },
//   fieldLabel: {
//     marginBottom: 7,
//     color: "#334155",
//     fontWeight: "600",
//     fontSize: 14,
//   },
//   inputWrapper: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: "#f8fafc",
//     borderWidth: 1,
//     borderColor: "#cbd5e1",
//     borderRadius: 14,
//     paddingHorizontal: 14,
//     minHeight: isTablet ? 58 : 52,
//   },
//   inputIcon: {
//     marginRight: 10,
//   },
//   input: {
//     flex: 1,
//     color: "#0f172a",
//     fontSize: isTablet ? 16 : 15,
//     paddingVertical: 12,
//   },
//   actionRow: {
//     alignItems: "flex-end",
//     marginTop: 2,
//     marginBottom: 18,
//   },
//   linkText: {
//     color: "#2563eb",
//     fontSize: 14,
//     fontWeight: "600",
//   },
//   loginButton: {
//     backgroundColor: "#2563eb",
//     minHeight: 54,
//     borderRadius: 14,
//     alignItems: "center",
//     justifyContent: "center",
//     flexDirection: "row",
//     marginBottom: 18,
//     shadowColor: "#2563eb",
//     shadowOpacity: 0.24,
//     shadowRadius: 8,
//     shadowOffset: { width: 0, height: 4 },
//     elevation: 4,
//   },
//   loginButtonDisabled: {
//     backgroundColor: "#7aa3f7",
//   },
//   loginButtonText: {
//     color: "#fff",
//     fontSize: 16,
//     fontWeight: "700",
//   },
//   registerRow: {
//     flexDirection: "row",
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   registerText: {
//     color: "#64748b",
//     fontSize: 14,
//   },
//   registerLink: {
//     color: "#2563eb",
//     fontSize: 14,
//     fontWeight: "700",
//   },

//   // Bottom
//   bottomSection: {
//     alignItems: "center",
//     marginTop: 14,
//     paddingBottom: 10,
//   },
//   versionText: {
//     fontSize: 13,
//     color: "#334155",
//     fontWeight: "700",
//     marginBottom: 8,
//   },
//   bottomSubText: {
//     textAlign: "center",
//     fontSize: 12,
//     color: "#64748b",
//     lineHeight: 18,
//     maxWidth: isTablet ? 620 : "100%",
//     marginBottom: 14,
//   },
//   featureRow: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "center",
//     gap: 10,
//   },
//   featureBadge: {
//     flexDirection: "row",
//     alignItems: "center",
//     backgroundColor: "#eff6ff",
//     borderWidth: 1,
//     borderColor: "#bfdbfe",
//     borderRadius: 20,
//     paddingHorizontal: 12,
//     paddingVertical: 7,
//     marginHorizontal: 4,
//     marginVertical: 4,
//   },
//   featureText: {
//     color: "#1e3a8a",
//     fontSize: 12,
//     fontWeight: "600",
//   },
// });