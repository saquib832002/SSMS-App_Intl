// ============================================
// screens/StudentParentRegistrationScreen.js
// ============================================
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Keyboard,
  Linking,
  Dimensions,
  Modal,
  FlatList,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, MaterialIcons } from "@expo/vector-icons";
import { BASE_URL } from "../Environment/EnvironmentConfig";

// ─── DOB picker data ──────────────────────────────────────────────────────────
const CY = new Date().getFullYear();
const DOB_DAYS = Array.from({ length: 31 }, (_, i) => ({
  value: i + 1, label: String(i + 1).padStart(2, '0'),
}));
const DOB_MONTHS = [
  { value: 1, label: 'January' },  { value: 2, label: 'February' },
  { value: 3, label: 'March' },    { value: 4, label: 'April' },
  { value: 5, label: 'May' },      { value: 6, label: 'June' },
  { value: 7, label: 'July' },     { value: 8, label: 'August' },
  { value: 9, label: 'September' },{ value: 10, label: 'October' },
  { value: 11, label: 'November' },{ value: 12, label: 'December' },
];
const DOB_YEARS = Array.from({ length: 81 }, (_, i) => {
  const y = CY - i; return { value: y, label: String(y) };
});

// ─── Single scrollable column ─────────────────────────────────────────────────
function PickerColumn({ items, selected, onSelect }) {
  const ref = useRef(null);
  const scrollToSel = useCallback(() => {
    const idx = items.findIndex(x => x.value === selected);
    if (idx >= 0 && ref.current) {
      ref.current.scrollToIndex({ index: idx, animated: false, viewPosition: 0 });
    }
  }, [items, selected]);
  return (
    <FlatList
      ref={ref}
      data={items}
      keyExtractor={it => String(it.value)}
      style={{ flex: 1 }}
      getItemLayout={(_, i) => ({ length: 48, offset: 48 * i, index: i })}
      showsVerticalScrollIndicator={false}
      onLayout={scrollToSel}
      renderItem={({ item }) => {
        const sel = item.value === selected;
        return (
          <TouchableOpacity
            style={[dp.colItem, sel && dp.colItemSel]}
            onPress={() => onSelect(item.value)}
            activeOpacity={0.65}
          >
            <Text numberOfLines={1} style={[dp.colTxt, sel && dp.colTxtSel]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const { width } = Dimensions.get("window");
const isTablet = width >= 768;

// ─── Country dialling codes (195 countries, Pakistan pinned first) ────────────
const COUNTRY_CODES = [
  { label: '🇮🇳 India (+91)',                         value: '+91'   },
  { label: '🇦🇫 Afghanistan (+93)',                   value: '+93'   },
  { label: '🇦🇱 Albania (+355)',                      value: '+355'  },
  { label: '🇩🇿 Algeria (+213)',                      value: '+213'  },
  { label: '🇦🇩 Andorra (+376)',                      value: '+376'  },
  { label: '🇦🇴 Angola (+244)',                       value: '+244'  },
  { label: '🇦🇬 Antigua & Barbuda (+1268)',           value: '+1268' },
  { label: '🇦🇷 Argentina (+54)',                     value: '+54'   },
  { label: '🇦🇲 Armenia (+374)',                      value: '+374'  },
  { label: '🇦🇺 Australia (+61)',                     value: '+61'   },
  { label: '🇦🇹 Austria (+43)',                       value: '+43'   },
  { label: '🇦🇿 Azerbaijan (+994)',                   value: '+994'  },
  { label: '🇧🇸 Bahamas (+1242)',                     value: '+1242' },
  { label: '🇧🇭 Bahrain (+973)',                      value: '+973'  },
  { label: '🇧🇩 Bangladesh (+880)',                   value: '+880'  },
  { label: '🇧🇧 Barbados (+1246)',                    value: '+1246' },
  { label: '🇧🇾 Belarus (+375)',                      value: '+375'  },
  { label: '🇧🇪 Belgium (+32)',                       value: '+32'   },
  { label: '🇧🇿 Belize (+501)',                       value: '+501'  },
  { label: '🇧🇯 Benin (+229)',                        value: '+229'  },
  { label: '🇧🇹 Bhutan (+975)',                       value: '+975'  },
  { label: '🇧🇴 Bolivia (+591)',                      value: '+591'  },
  { label: '🇧🇦 Bosnia & Herzegovina (+387)',         value: '+387'  },
  { label: '🇧🇼 Botswana (+267)',                     value: '+267'  },
  { label: '🇧🇷 Brazil (+55)',                        value: '+55'   },
  { label: '🇧🇳 Brunei (+673)',                       value: '+673'  },
  { label: '🇧🇬 Bulgaria (+359)',                     value: '+359'  },
  { label: '🇧🇫 Burkina Faso (+226)',                 value: '+226'  },
  { label: '🇧🇮 Burundi (+257)',                      value: '+257'  },
  { label: '🇨🇻 Cabo Verde (+238)',                   value: '+238'  },
  { label: '🇰🇭 Cambodia (+855)',                     value: '+855'  },
  { label: '🇨🇲 Cameroon (+237)',                     value: '+237'  },
  { label: '🇨🇦 Canada (+1)',                         value: '+1'    },
  { label: '🇨🇫 Central African Republic (+236)',     value: '+236'  },
  { label: '🇹🇩 Chad (+235)',                         value: '+235'  },
  { label: '🇨🇱 Chile (+56)',                         value: '+56'   },
  { label: '🇨🇳 China (+86)',                         value: '+86'   },
  { label: '🇨🇴 Colombia (+57)',                      value: '+57'   },
  { label: '🇰🇲 Comoros (+269)',                      value: '+269'  },
  { label: '🇨🇩 Congo (DRC) (+243)',                  value: '+243'  },
  { label: '🇨🇬 Congo (Republic) (+242)',             value: '+242'  },
  { label: '🇨🇷 Costa Rica (+506)',                   value: '+506'  },
  { label: "🇨🇮 Côte d'Ivoire (+225)",               value: '+225'  },
  { label: '🇭🇷 Croatia (+385)',                      value: '+385'  },
  { label: '🇨🇺 Cuba (+53)',                          value: '+53'   },
  { label: '🇨🇾 Cyprus (+357)',                       value: '+357'  },
  { label: '🇨🇿 Czech Republic (+420)',               value: '+420'  },
  { label: '🇩🇰 Denmark (+45)',                       value: '+45'   },
  { label: '🇩🇯 Djibouti (+253)',                     value: '+253'  },
  { label: '🇩🇲 Dominica (+1767)',                    value: '+1767' },
  { label: '🇩🇴 Dominican Republic (+1809)',          value: '+1809' },
  { label: '🇪🇨 Ecuador (+593)',                      value: '+593'  },
  { label: '🇪🇬 Egypt (+20)',                         value: '+20'   },
  { label: '🇸🇻 El Salvador (+503)',                  value: '+503'  },
  { label: '🇬🇶 Equatorial Guinea (+240)',            value: '+240'  },
  { label: '🇪🇷 Eritrea (+291)',                      value: '+291'  },
  { label: '🇪🇪 Estonia (+372)',                      value: '+372'  },
  { label: '🇸🇿 Eswatini (+268)',                     value: '+268'  },
  { label: '🇪🇹 Ethiopia (+251)',                     value: '+251'  },
  { label: '🇫🇯 Fiji (+679)',                         value: '+679'  },
  { label: '🇫🇮 Finland (+358)',                      value: '+358'  },
  { label: '🇫🇷 France (+33)',                        value: '+33'   },
  { label: '🇬🇦 Gabon (+241)',                        value: '+241'  },
  { label: '🇬🇲 Gambia (+220)',                       value: '+220'  },
  { label: '🇬🇪 Georgia (+995)',                      value: '+995'  },
  { label: '🇩🇪 Germany (+49)',                       value: '+49'   },
  { label: '🇬🇭 Ghana (+233)',                        value: '+233'  },
  { label: '🇬🇷 Greece (+30)',                        value: '+30'   },
  { label: '🇬🇩 Grenada (+1473)',                     value: '+1473' },
  { label: '🇬🇹 Guatemala (+502)',                    value: '+502'  },
  { label: '🇬🇳 Guinea (+224)',                       value: '+224'  },
  { label: '🇬🇼 Guinea-Bissau (+245)',                value: '+245'  },
  { label: '🇬🇾 Guyana (+592)',                       value: '+592'  },
  { label: '🇭🇹 Haiti (+509)',                        value: '+509'  },
  { label: '🇭🇳 Honduras (+504)',                     value: '+504'  },
  { label: '🇭🇺 Hungary (+36)',                       value: '+36'   },
  { label: '🇮🇸 Iceland (+354)',                      value: '+354'  },
  { label: '🇮🇳 India (+91)',                         value: '+91'   },
  { label: '🇮🇩 Indonesia (+62)',                     value: '+62'   },
  { label: '🇮🇷 Iran (+98)',                          value: '+98'   },
  { label: '🇮🇶 Iraq (+964)',                         value: '+964'  },
  { label: '🇮🇪 Ireland (+353)',                      value: '+353'  },
  { label: '🇮🇱 Israel (+972)',                       value: '+972'  },
  { label: '🇮🇹 Italy (+39)',                         value: '+39'   },
  { label: '🇯🇲 Jamaica (+1876)',                     value: '+1876' },
  { label: '🇯🇵 Japan (+81)',                         value: '+81'   },
  { label: '🇯🇴 Jordan (+962)',                       value: '+962'  },
  { label: '🇰🇿 Kazakhstan (+7)',                     value: '+7'    },
  { label: '🇰🇪 Kenya (+254)',                        value: '+254'  },
  { label: '🇰🇮 Kiribati (+686)',                     value: '+686'  },
  { label: '🇽🇰 Kosovo (+383)',                       value: '+383'  },
  { label: '🇰🇼 Kuwait (+965)',                       value: '+965'  },
  { label: '🇰🇬 Kyrgyzstan (+996)',                   value: '+996'  },
  { label: '🇱🇦 Laos (+856)',                         value: '+856'  },
  { label: '🇱🇻 Latvia (+371)',                       value: '+371'  },
  { label: '🇱🇧 Lebanon (+961)',                      value: '+961'  },
  { label: '🇱🇸 Lesotho (+266)',                      value: '+266'  },
  { label: '🇱🇷 Liberia (+231)',                      value: '+231'  },
  { label: '🇱🇾 Libya (+218)',                        value: '+218'  },
  { label: '🇱🇮 Liechtenstein (+423)',                value: '+423'  },
  { label: '🇱🇹 Lithuania (+370)',                    value: '+370'  },
  { label: '🇱🇺 Luxembourg (+352)',                   value: '+352'  },
  { label: '🇲🇬 Madagascar (+261)',                   value: '+261'  },
  { label: '🇲🇼 Malawi (+265)',                       value: '+265'  },
  { label: '🇲🇾 Malaysia (+60)',                      value: '+60'   },
  { label: '🇲🇻 Maldives (+960)',                     value: '+960'  },
  { label: '🇲🇱 Mali (+223)',                         value: '+223'  },
  { label: '🇲🇹 Malta (+356)',                        value: '+356'  },
  { label: '🇲🇭 Marshall Islands (+692)',             value: '+692'  },
  { label: '🇲🇷 Mauritania (+222)',                   value: '+222'  },
  { label: '🇲🇺 Mauritius (+230)',                    value: '+230'  },
  { label: '🇲🇽 Mexico (+52)',                        value: '+52'   },
  { label: '🇫🇲 Micronesia (+691)',                   value: '+691'  },
  { label: '🇲🇩 Moldova (+373)',                      value: '+373'  },
  { label: '🇲🇨 Monaco (+377)',                       value: '+377'  },
  { label: '🇲🇳 Mongolia (+976)',                     value: '+976'  },
  { label: '🇲🇪 Montenegro (+382)',                   value: '+382'  },
  { label: '🇲🇦 Morocco (+212)',                      value: '+212'  },
  { label: '🇲🇿 Mozambique (+258)',                   value: '+258'  },
  { label: '🇲🇲 Myanmar (+95)',                       value: '+95'   },
  { label: '🇳🇦 Namibia (+264)',                      value: '+264'  },
  { label: '🇳🇷 Nauru (+674)',                        value: '+674'  },
  { label: '🇳🇵 Nepal (+977)',                        value: '+977'  },
  { label: '🇳🇱 Netherlands (+31)',                   value: '+31'   },
  { label: '🇳🇿 New Zealand (+64)',                   value: '+64'   },
  { label: '🇳🇮 Nicaragua (+505)',                    value: '+505'  },
  { label: '🇳🇪 Niger (+227)',                        value: '+227'  },
  { label: '🇳🇬 Nigeria (+234)',                      value: '+234'  },
  { label: '🇲🇰 North Macedonia (+389)',              value: '+389'  },
  { label: '🇳🇴 Norway (+47)',                        value: '+47'   },
  { label: '🇴🇲 Oman (+968)',                         value: '+968'  },
  { label: '🇵🇰 Pakistan (+92)',                      value: '+92'   },
  { label: '🇵🇼 Palau (+680)',                        value: '+680'  },
  { label: '🇵🇸 Palestine (+970)',                    value: '+970'  },
  { label: '🇵🇦 Panama (+507)',                       value: '+507'  },
  { label: '🇵🇬 Papua New Guinea (+675)',             value: '+675'  },
  { label: '🇵🇾 Paraguay (+595)',                     value: '+595'  },
  { label: '🇵🇪 Peru (+51)',                          value: '+51'   },
  { label: '🇵🇭 Philippines (+63)',                   value: '+63'   },
  { label: '🇵🇱 Poland (+48)',                        value: '+48'   },
  { label: '🇵🇹 Portugal (+351)',                     value: '+351'  },
  { label: '🇶🇦 Qatar (+974)',                        value: '+974'  },
  { label: '🇷🇴 Romania (+40)',                       value: '+40'   },
  { label: '🇷🇺 Russia (+7)',                         value: '+7'    },
  { label: '🇷🇼 Rwanda (+250)',                       value: '+250'  },
  { label: '🇰🇳 Saint Kitts & Nevis (+1869)',        value: '+1869' },
  { label: '🇱🇨 Saint Lucia (+1758)',                 value: '+1758' },
  { label: '🇻🇨 Saint Vincent & Grenadines (+1784)', value: '+1784' },
  { label: '🇼🇸 Samoa (+685)',                        value: '+685'  },
  { label: '🇸🇲 San Marino (+378)',                   value: '+378'  },
  { label: '🇸🇹 São Tomé & Príncipe (+239)',          value: '+239'  },
  { label: '🇸🇦 Saudi Arabia (+966)',                 value: '+966'  },
  { label: '🇸🇳 Senegal (+221)',                      value: '+221'  },
  { label: '🇷🇸 Serbia (+381)',                       value: '+381'  },
  { label: '🇸🇨 Seychelles (+248)',                   value: '+248'  },
  { label: '🇸🇱 Sierra Leone (+232)',                 value: '+232'  },
  { label: '🇸🇬 Singapore (+65)',                     value: '+65'   },
  { label: '🇸🇰 Slovakia (+421)',                     value: '+421'  },
  { label: '🇸🇮 Slovenia (+386)',                     value: '+386'  },
  { label: '🇸🇧 Solomon Islands (+677)',              value: '+677'  },
  { label: '🇸🇴 Somalia (+252)',                      value: '+252'  },
  { label: '🇿🇦 South Africa (+27)',                  value: '+27'   },
  { label: '🇸🇸 South Sudan (+211)',                  value: '+211'  },
  { label: '🇪🇸 Spain (+34)',                         value: '+34'   },
  { label: '🇱🇰 Sri Lanka (+94)',                     value: '+94'   },
  { label: '🇸🇩 Sudan (+249)',                        value: '+249'  },
  { label: '🇸🇷 Suriname (+597)',                     value: '+597'  },
  { label: '🇸🇪 Sweden (+46)',                        value: '+46'   },
  { label: '🇨🇭 Switzerland (+41)',                   value: '+41'   },
  { label: '🇸🇾 Syria (+963)',                        value: '+963'  },
  { label: '🇹🇼 Taiwan (+886)',                       value: '+886'  },
  { label: '🇹🇯 Tajikistan (+992)',                   value: '+992'  },
  { label: '🇹🇿 Tanzania (+255)',                     value: '+255'  },
  { label: '🇹🇭 Thailand (+66)',                      value: '+66'   },
  { label: '🇹🇱 Timor-Leste (+670)',                  value: '+670'  },
  { label: '🇹🇬 Togo (+228)',                         value: '+228'  },
  { label: '🇹🇴 Tonga (+676)',                        value: '+676'  },
  { label: '🇹🇹 Trinidad & Tobago (+1868)',           value: '+1868' },
  { label: '🇹🇳 Tunisia (+216)',                      value: '+216'  },
  { label: '🇹🇷 Turkey (+90)',                        value: '+90'   },
  { label: '🇹🇲 Turkmenistan (+993)',                 value: '+993'  },
  { label: '🇹🇻 Tuvalu (+688)',                       value: '+688'  },
  { label: '🇺🇬 Uganda (+256)',                       value: '+256'  },
  { label: '🇺🇦 Ukraine (+380)',                      value: '+380'  },
  { label: '🇦🇪 UAE (+971)',                          value: '+971'  },
  { label: '🇬🇧 United Kingdom (+44)',                value: '+44'   },
  { label: '🇺🇸 USA (+1)',                            value: '+1'    },
  { label: '🇺🇾 Uruguay (+598)',                      value: '+598'  },
  { label: '🇺🇿 Uzbekistan (+998)',                   value: '+998'  },
  { label: '🇻🇺 Vanuatu (+678)',                      value: '+678'  },
  { label: '🇻🇦 Vatican City (+39)',                  value: '+39'   },
  { label: '🇻🇪 Venezuela (+58)',                     value: '+58'   },
  { label: '🇻🇳 Vietnam (+84)',                       value: '+84'   },
  { label: '🇾🇪 Yemen (+967)',                        value: '+967'  },
  { label: '🇿🇲 Zambia (+260)',                       value: '+260'  },
  { label: '🇿🇼 Zimbabwe (+263)',                     value: '+263'  },
];

const ROLES = [
  { label: "Student", value: "Student", icon: "user" },
  { label: "Parent",  value: "Parent",  icon: "users" },
];

// Normalise phone to WhatsApp international format (no +)
// 03001234567 → 923001234567
function normalizePhone(raw) {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "92" + digits.slice(1);
  return digits;
}

// ─────────────────────────────────────────────────────────────────────────────
// Success card — shown after registration instead of an Alert
// ─────────────────────────────────────────────────────────────────────────────
function SuccessCard({ data, onOpenWhatsApp, onGoToLogin }) {
  const { fullName, sentEmail, sentEmailTo, whatsappPhone, whatsappText } = data;

  return (
    <View style={s.successCard}>
      {/* Icon */}
      <View style={s.successIconWrap}>
        <LinearGradient colors={["#22c55e", "#16a34a"]} style={s.successIconCircle}>
          <Feather name="check" size={isTablet ? 38 : 32} color="#fff" />
        </LinearGradient>
      </View>

      <Text style={s.successTitle}>Registration Successful!</Text>
      {fullName ? (
        <Text style={s.successName}>Welcome, {fullName}</Text>
      ) : null}
      <Text style={s.successSub}>
        Your account has been created and credentials delivered. Your login will be activated by the school administration shortly.
      </Text>

      {/* Delivery channels */}
      <View style={s.channelBox}>
        {sentEmail && sentEmailTo ? (
          <View style={s.channelRow}>
            <View style={[s.channelIconWrap, { backgroundColor: "#eff6ff" }]}>
              <Feather name="mail" size={16} color="#2563eb" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.channelLabel}>Credentials sent by Email</Text>
              <Text style={s.channelValue} numberOfLines={1}>{sentEmailTo}</Text>
            </View>
            <Feather name="check-circle" size={18} color="#22c55e" />
          </View>
        ) : null}

        {whatsappPhone ? (
          <>
            {sentEmail ? <View style={s.channelDivider} /> : null}
            <View style={s.channelRow}>
              <View style={[s.channelIconWrap, { backgroundColor: "#f0fdf4" }]}>
                {/* WhatsApp-style icon using phone */}
                <Feather name="phone" size={16} color="#16a34a" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.channelLabel}>Ready to send via WhatsApp</Text>
                <Text style={s.channelValue}>{whatsappPhone}</Text>
              </View>
              <Feather name="arrow-right" size={18} color="#16a34a" />
            </View>

            {/* Primary action — open WhatsApp */}
            <TouchableOpacity
              style={s.waBtn}
              onPress={onOpenWhatsApp}
              activeOpacity={0.85}
            >
              <Feather name="send" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={s.waBtnText}>Send Credentials via WhatsApp</Text>
            </TouchableOpacity>
            <Text style={s.waBtnHint}>
              Tap above to open WhatsApp — the message is pre-filled and ready to send.
            </Text>
          </>
        ) : null}
      </View>

      {/* Go to login */}
      <TouchableOpacity style={s.loginBtn} onPress={onGoToLogin} activeOpacity={0.85}>
        <Text style={s.loginBtnText}>Go to Login</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────
export default function StudentParentRegistrationScreen({ navigation }) {
  // ── Shared ────────────────────────────────────────────────────────────────
  const [role, setRole]                   = useState("Student");
  const [email, setEmail]                 = useState("");
  const [mobileNumber, setMobileNumber]   = useState("");
  const [loading, setLoading]             = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [successData, setSuccessData]     = useState(null);

  // ── Student-only ──────────────────────────────────────────────────────────
  const [enrollmentId, setEnrollmentId]   = useState("");
  // DOB stored as a Date object; sent to API as DD/MM/YYYY
  const [dobDate, setDobDate]             = useState(null);
  // Picker open/temp state
  const [pickerOpen, setPickerOpen]       = useState(false);
  const [tmpD, setTmpD]                   = useState(1);
  const [tmpM, setTmpM]                   = useState(1);
  const [tmpY, setTmpY]                   = useState(CY - 15);

  // ── Parent-only ───────────────────────────────────────────────────────────
  const [firstName, setFirstName]         = useState("");
  const [lastName, setLastName]           = useState("");

  // ── Country code (shared, mobile fields) ──────────────────────────────────
  const [countryCode, setCountryCode]     = useState("+91");
  const [ccOpen, setCcOpen]               = useState(false);

  const dobDisplay = dobDate
    ? dobDate.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";
  // API expects DD/MM/YYYY
  const dobForApi = dobDisplay;

  const openPicker = () => {
    if (dobDate) {
      setTmpD(dobDate.getDate());
      setTmpM(dobDate.getMonth() + 1);
      setTmpY(dobDate.getFullYear());
    } else {
      setTmpD(1); setTmpM(1); setTmpY(CY - 15);
    }
    setPickerOpen(true);
  };

  const confirmPicker = () => {
    // Clamp day to valid range for selected month/year
    const maxDay = new Date(tmpY, tmpM, 0).getDate();
    const safeDay = Math.min(tmpD, maxDay);
    setDobDate(new Date(tmpY, tmpM - 1, safeDay));
    setPickerOpen(false);
  };

  useEffect(() => {
    const showEvent = Platform.OS === "android" ? "keyboardDidShow" : "keyboardWillShow";
    const hideEvent = Platform.OS === "android" ? "keyboardDidHide" : "keyboardWillHide";
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const validateEmail = (val) =>
    !val.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());

  const validate = () => {
    if (role === "Parent") {
      if (!enrollmentId.trim()) {
        Alert.alert("Validation", "Please enter your child's enrollment ID");
        return false;
      }
      if (!firstName.trim()) {
        Alert.alert("Validation", "Please enter your name");
        return false;
      }
      if (!mobileNumber.trim()) {
        Alert.alert("Validation", "Please enter your mobile number — this will be your login username");
        return false;
      }
      if (!validateEmail(email)) {
        Alert.alert("Validation", "Please enter a valid email address");
        return false;
      }
    } else {
      if (!enrollmentId.trim()) {
        Alert.alert("Validation", "Please enter the Student Enrollment ID");
        return false;
      }
      if (!dobDate) {
        Alert.alert("Validation", "Please select the student's date of birth");
        return false;
      }
      const hasEmail  = email.trim().length > 0;
      const hasMobile = mobileNumber.trim().length > 0;
      if (!hasEmail && !hasMobile) {
        Alert.alert("Validation", "Please provide at least an email address or mobile number");
        return false;
      }
      if (!validateEmail(email)) {
        Alert.alert("Validation", "Please enter a valid email address");
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    try {
      setLoading(true);
      // Build full international mobile: strip leading zeros from local part,
      // then prepend country code digits (e.g. "+92" + "3001234567")
      const localDigits = mobileNumber.trim().replace(/\D/g, "").replace(/^0+/, "");
      const ccDigits    = countryCode.replace(/\D/g, "");
      const fullMobile  = localDigits ? ccDigits + localDigits : "";

      const payload = role === "Parent"
        ? {
            role,
            enrollmentId: enrollmentId.trim().toUpperCase(),
            firstName:    firstName.trim(),
            lastName:     lastName.trim(),
            mobileNumber: fullMobile,
            email:        email.trim(),
          }
        : {
            role,
            enrollmentId: enrollmentId.trim(),
            email:        email.trim(),
            mobileNumber: fullMobile,
            dateOfBirth:  dobForApi,
          };
      const response = await fetch(`${BASE_URL}UserServiceApi/registerStudentParent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res = await response.json();
      if (res.status) {
        setSuccessData(res);
      } else {
        Alert.alert(
          "Registration Failed",
          res.message || (role === "Parent"
            ? "No enrolled student found with this mobile number. Please use the number registered with the school."
            : "Student not found. Please verify your enrollment ID, date of birth, and contact details.")
        );
      }
    } catch (error) {
      console.error("Registration error:", error);
      Alert.alert("Error", "Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenWhatsApp = () => {
    if (!successData?.whatsappPhone || !successData?.whatsappText) return;
    const phone   = normalizePhone(successData.whatsappPhone);
    const encoded = encodeURIComponent(successData.whatsappText);
    Linking.openURL(`https://wa.me/${phone}?text=${encoded}`).catch(() =>
      Alert.alert("WhatsApp", "Could not open WhatsApp. Please make sure it is installed.")
    );
  };

  const bothProvided = email.trim().length > 0 && mobileNumber.trim().length > 0;

  return (
    <SafeAreaView style={s.safeArea}>
      <LinearGradient colors={["#e0ecff", "#f8fbff", "#eef4ff"]} style={s.gradient}>
        <ScrollView
          contentContainerStyle={[s.scrollContent, { paddingBottom: keyboardHeight + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Header — always visible */}
          <View style={s.header}>
            {!successData && (
              <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                <Feather name="arrow-left" size={20} color="#2563eb" />
              </TouchableOpacity>
            )}

            <View style={s.logoOuter}>
              <LinearGradient
                colors={successData ? ["#22c55e", "#16a34a", "#14532d"] : ["#2563eb", "#1d4ed8", "#0f172a"]}
                style={s.logoCircle}
              >
                <Feather
                  name={successData ? "user-check" : "user-plus"}
                  size={isTablet ? 32 : 26}
                  color="#fff"
                />
              </LinearGradient>
            </View>

            <Text style={s.pageTitle}>
              {successData ? "Registration Complete" : "Student / Parent Registration"}
            </Text>
            {!successData && (
              <Text style={s.pageSubtitle}>
                {role === "Parent"
                  ? "Provide your child's enrollment ID and your registered mobile to verify and create your account."
                  : "Verify your enrollment details to receive login credentials."}
              </Text>
            )}
          </View>

          {/* ── SUCCESS STATE ── */}
          {successData ? (
            <SuccessCard
              data={successData}
              onOpenWhatsApp={handleOpenWhatsApp}
              onGoToLogin={() => navigation.navigate("Login")}
            />
          ) : (
            /* ── FORM ── */
            <View style={s.card}>
              {/* Role Selector */}
              <Text style={s.sectionLabel}>Register as</Text>
              <View style={s.roleRow}>
                {ROLES.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    style={[s.roleBtn, role === r.value && s.roleBtnActive]}
                    onPress={() => {
                      setRole(r.value);
                      // Reset fields that don't overlap between roles
                      setEmail(""); setMobileNumber("");
                      setEnrollmentId(""); setDobDate(null);
                      setFirstName(""); setLastName("");
                    }}
                    activeOpacity={0.8}
                  >
                    <Feather
                      name={r.icon}
                      size={16}
                      color={role === r.value ? "#fff" : "#2563eb"}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={[s.roleBtnText, role === r.value && s.roleBtnTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── PARENT FIELDS ── */}
              {role === "Parent" ? (
                <>
                  {/* Info banner */}
                  <View style={[s.infoBanner, { marginBottom: 16 }]}>
                    <MaterialIcons name="info-outline" size={16} color="#1e40af" />
                    <Text style={s.infoText}>
                      Your mobile number will be your login username. We will verify it against the enrollment record to confirm you are the registered guardian.
                    </Text>
                  </View>

                  {/* Child's Enrollment ID — verification */}
                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>Child's Enrollment ID</Text>
                    <View style={s.inputWrapper}>
                      <Feather name="hash" size={17} color="#2563eb" style={s.inputIcon} />
                      <TextInput
                        placeholder="e.g. ETWF-2026-0005"
                        placeholderTextColor="#94a3b8"
                        style={s.input}
                        value={enrollmentId}
                        onChangeText={setEnrollmentId}
                        autoCapitalize="characters"
                      />
                    </View>
                    <Text style={s.hintText}>Enter the enrollment ID of any one of your children</Text>
                  </View>

                  {/* First Name */}
                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>First Name</Text>
                    <View style={s.inputWrapper}>
                      <Feather name="user" size={17} color="#2563eb" style={s.inputIcon} />
                      <TextInput
                        placeholder="Enter your first name"
                        placeholderTextColor="#94a3b8"
                        style={s.input}
                        value={firstName}
                        onChangeText={setFirstName}
                        autoCapitalize="words"
                      />
                    </View>
                  </View>

                  {/* Last Name */}
                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>
                      Last Name <Text style={s.optionalTag}>(optional)</Text>
                    </Text>
                    <View style={s.inputWrapper}>
                      <Feather name="user" size={17} color="#94a3b8" style={s.inputIcon} />
                      <TextInput
                        placeholder="Enter your last name"
                        placeholderTextColor="#94a3b8"
                        style={s.input}
                        value={lastName}
                        onChangeText={setLastName}
                        autoCapitalize="words"
                      />
                    </View>
                  </View>

                  {/* Mobile — required for parent, becomes their username */}
                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>Mobile Number</Text>
                    <View style={s.phoneRow}>
                      <TouchableOpacity style={s.ccBtn} onPress={() => setCcOpen(true)} activeOpacity={0.75}>
                        <Text style={s.ccText}>{countryCode}</Text>
                        <Feather name="chevron-down" size={12} color="#64748b" />
                      </TouchableOpacity>
                      <View style={[s.inputWrapper, { flex: 1 }]}>
                        <TextInput
                          placeholder="3001234567"
                          placeholderTextColor="#94a3b8"
                          style={s.input}
                          value={mobileNumber}
                          onChangeText={setMobileNumber}
                          keyboardType="phone-pad"
                          maxLength={15}
                        />
                      </View>
                    </View>
                    <Text style={s.hintText}>Must match the number registered with the school for your child</Text>
                  </View>

                  {/* Email — optional for parent */}
                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>
                      Email Address <Text style={s.optionalTag}>(optional)</Text>
                    </Text>
                    <View style={s.inputWrapper}>
                      <Feather name="mail" size={17} color="#2563eb" style={s.inputIcon} />
                      <TextInput
                        placeholder="Enter email address"
                        placeholderTextColor="#94a3b8"
                        style={s.input}
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>
                  </View>
                </>
              ) : (
                <>
                  {/* ── STUDENT FIELDS ── */}

                  {/* Enrollment ID */}
                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>Student Enrollment ID</Text>
                    <View style={s.inputWrapper}>
                      <Feather name="hash" size={17} color="#2563eb" style={s.inputIcon} />
                      <TextInput
                        placeholder="Enter enrollment ID"
                        placeholderTextColor="#94a3b8"
                        style={s.input}
                        value={enrollmentId}
                        onChangeText={setEnrollmentId}
                        autoCapitalize="characters"
                      />
                    </View>
                  </View>

                  {/* Date of Birth — custom 3-column picker */}
                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>Student Date of Birth</Text>
                    <TouchableOpacity
                      style={s.inputWrapper}
                      onPress={openPicker}
                      activeOpacity={0.75}
                    >
                      <Feather name="calendar" size={17} color="#2563eb" style={s.inputIcon} />
                      <Text style={[s.input, !dobDate && { color: "#94a3b8" }]}>
                        {dobDate
                          ? dobDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
                          : "Select date of birth"}
                      </Text>
                      <Feather name="chevron-down" size={16} color="#94a3b8" />
                    </TouchableOpacity>

                    <Modal
                      visible={pickerOpen}
                      transparent
                      animationType="slide"
                      onRequestClose={() => setPickerOpen(false)}
                    >
                      <View style={dp.overlay}>
                        <View style={dp.sheet}>
                          <View style={dp.header}>
                            <TouchableOpacity onPress={() => setPickerOpen(false)}>
                              <Text style={dp.cancelTxt}>Cancel</Text>
                            </TouchableOpacity>
                            <Text style={dp.title}>Date of Birth</Text>
                            <TouchableOpacity onPress={confirmPicker}>
                              <Text style={dp.doneTxt}>Done</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={dp.colLabels}>
                            <Text style={[dp.colLabel, { flex: 0.7 }]}>Day</Text>
                            <Text style={[dp.colLabel, { flex: 1.6 }]}>Month</Text>
                            <Text style={[dp.colLabel, { flex: 1 }]}>Year</Text>
                          </View>
                          <View style={dp.columns}>
                            <PickerColumn items={DOB_DAYS}   selected={tmpD} onSelect={setTmpD} />
                            <View style={dp.colSep} />
                            <PickerColumn items={DOB_MONTHS} selected={tmpM} onSelect={setTmpM} />
                            <View style={dp.colSep} />
                            <PickerColumn items={DOB_YEARS}  selected={tmpY} onSelect={setTmpY} />
                          </View>
                        </View>
                      </View>
                    </Modal>
                  </View>

                  {/* Divider */}
                  <View style={s.orRow}>
                    <View style={s.orLine} />
                    <Text style={s.orText}>Provide at least one for verification</Text>
                    <View style={s.orLine} />
                  </View>

                  {/* Email */}
                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>
                      Email Address <Text style={s.optionalTag}>(optional)</Text>
                    </Text>
                    <View style={s.inputWrapper}>
                      <Feather name="mail" size={17} color="#2563eb" style={s.inputIcon} />
                      <TextInput
                        placeholder="Enter email address"
                        placeholderTextColor="#94a3b8"
                        style={s.input}
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>
                  </View>

                  {/* Mobile Number */}
                  <View style={s.fieldBlock}>
                    <Text style={s.fieldLabel}>
                      Mobile Number <Text style={s.optionalTag}>(optional)</Text>
                    </Text>
                    <View style={s.phoneRow}>
                      <TouchableOpacity style={s.ccBtn} onPress={() => setCcOpen(true)} activeOpacity={0.75}>
                        <Text style={s.ccText}>{countryCode}</Text>
                        <Feather name="chevron-down" size={12} color="#64748b" />
                      </TouchableOpacity>
                      <View style={[s.inputWrapper, { flex: 1 }]}>
                        <TextInput
                          placeholder="3001234567"
                          placeholderTextColor="#94a3b8"
                          style={s.input}
                          value={mobileNumber}
                          onChangeText={setMobileNumber}
                          keyboardType="phone-pad"
                          maxLength={15}
                        />
                      </View>
                    </View>
                    <Text style={s.hintText}>Credentials will be sent to this number via WhatsApp</Text>
                  </View>

                  {/* Info Banner */}
                  <View style={[s.infoBanner, bothProvided && s.infoBannerGreen]}>
                    <MaterialIcons
                      name="info-outline"
                      size={16}
                      color={bothProvided ? "#166534" : "#1e40af"}
                    />
                    <Text style={[s.infoText, bothProvided && s.infoTextGreen]}>
                      {bothProvided
                        ? "Credentials will be sent to both your email and WhatsApp."
                        : email.trim()
                        ? "Credentials will be sent to your email address."
                        : mobileNumber.trim()
                        ? "Credentials will be sent to your WhatsApp number."
                        : "Provide an email and/or mobile number. Credentials will be sent to all provided channels."}
                    </Text>
                  </View>
                </>
              )}

              {/* Submit */}
              <TouchableOpacity
                style={[s.submitBtn, loading && s.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Feather name="send" size={17} color="#fff" />
                    <Text style={s.submitBtnText}>  Submit Registration</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Back to Login */}
              <TouchableOpacity
                style={s.backToLoginRow}
                onPress={() => navigation.navigate("Login")}
              >
                <Feather name="arrow-left" size={14} color="#2563eb" />
                <Text style={s.backToLoginText}>  Back to Login</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Country Code Picker Modal (shared) ── */}
          <Modal visible={ccOpen} transparent animationType="slide" onRequestClose={() => setCcOpen(false)}>
            <TouchableOpacity style={s.ccOverlay} onPress={() => setCcOpen(false)} activeOpacity={1}>
              <View style={s.ccSheet}>
                <View style={s.ccSheetHeader}>
                  <Text style={s.ccSheetTitle}>Select Country Code</Text>
                  <TouchableOpacity onPress={() => setCcOpen(false)}>
                    <Feather name="x" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={COUNTRY_CODES}
                  keyExtractor={(item, i) => item.value + i}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[s.ccOption, item.value === countryCode && s.ccOptionActive]}
                      onPress={() => { setCountryCode(item.value); setCcOpen(false); }}
                    >
                      <Text style={[s.ccOptionText, item.value === countryCode && s.ccOptionTextActive]}>
                        {item.label}
                      </Text>
                      {item.value === countryCode && (
                        <Feather name="check" size={16} color="#2563eb" />
                      )}
                    </TouchableOpacity>
                  )}
                  ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f1f5f9" }} />}
                />
              </View>
            </TouchableOpacity>
          </Modal>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safeArea:    { flex: 1, backgroundColor: "#f8fbff" },
  gradient:    { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: isTablet ? 60 : 20,
    paddingTop: isTablet ? 30 : 18,
  },

  // Header
  header: { alignItems: "center", marginBottom: 22 },
  backBtn: { alignSelf: "flex-start", padding: 6, marginBottom: 10 },
  logoOuter: { marginBottom: 14 },
  logoCircle: {
    width: isTablet ? 84 : 72,
    height: isTablet ? 84 : 72,
    borderRadius: 42,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#1d4ed8",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 7,
  },
  pageTitle: {
    fontSize: isTablet ? 26 : 20,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center",
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: isTablet ? 15 : 13,
    color: "#475569",
    textAlign: "center",
    lineHeight: 20,
    maxWidth: isTablet ? 500 : "100%",
  },

  // Card (form)
  card: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 22,
    padding: isTablet ? 30 : 22,
    shadowColor: "#0f172a",
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    maxWidth: isTablet ? 620 : "100%",
    alignSelf: "center",
    width: "100%",
  },

  // Role selector
  sectionLabel: { fontSize: 13, fontWeight: "600", color: "#334155", marginBottom: 10 },
  roleRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  roleBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#2563eb", borderRadius: 12,
    paddingVertical: 12, backgroundColor: "#eff6ff",
  },
  roleBtnActive: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  roleBtnText:   { fontSize: 14, fontWeight: "700", color: "#2563eb" },
  roleBtnTextActive: { color: "#fff" },

  // OR divider
  orRow: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 },
  orLine: { flex: 1, height: 1, backgroundColor: "#e2e8f0" },
  orText: { fontSize: 11, color: "#94a3b8", fontWeight: "500" },

  // Fields
  fieldBlock: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#334155", marginBottom: 7 },
  optionalTag: { fontWeight: "400", color: "#94a3b8", fontSize: 12 },
  inputWrapper: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc",
    borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 14,
    paddingHorizontal: 14, minHeight: isTablet ? 56 : 50,
  },
  inputIcon: { marginRight: 10 },
  input:     { flex: 1, color: "#0f172a", fontSize: isTablet ? 15 : 14, paddingVertical: 12 },
  hintText:  { fontSize: 11, color: "#94a3b8", marginTop: 4, marginLeft: 2 },

  // Info banner
  infoBanner: {
    flexDirection: "row", alignItems: "flex-start",
    backgroundColor: "#eff6ff", borderWidth: 1, borderColor: "#bfdbfe",
    borderRadius: 12, padding: 12, marginBottom: 20, gap: 8,
  },
  infoBannerGreen: { backgroundColor: "#f0fdf4", borderColor: "#86efac" },
  infoText:      { flex: 1, fontSize: 12, color: "#1e40af", lineHeight: 18 },
  infoTextGreen: { color: "#166534" },

  // Submit
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#2563eb", minHeight: 52, borderRadius: 14, marginBottom: 16,
    shadowColor: "#2563eb", shadowOpacity: 0.24, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  submitBtnDisabled: { backgroundColor: "#7aa3f7" },
  submitBtnText:     { color: "#fff", fontSize: 15, fontWeight: "700" },

  backToLoginRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 4,
  },
  backToLoginText: { color: "#2563eb", fontSize: 14, fontWeight: "600" },

  // Phone + country code
  phoneRow:  { flexDirection: "row", gap: 8, alignItems: "stretch" },
  ccBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: "#f8fafc", minWidth: 72,
  },
  ccText: { fontSize: 13, fontWeight: "700", color: "#0f172a" },

  // Country code picker modal
  ccOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  ccSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingBottom: Platform.OS === "ios" ? 36 : 20,
    maxHeight: "65%",
  },
  ccSheetHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: "#f1f5f9",
  },
  ccSheetTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  ccOption: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14,
  },
  ccOptionActive:     { backgroundColor: "#eff6ff" },
  ccOptionText:       { fontSize: 14, color: "#0f172a" },
  ccOptionTextActive: { color: "#2563eb", fontWeight: "700" },

  // ── Success card ──────────────────────────────────────────────────────────
  successCard: {
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: 22,
    padding: isTablet ? 30 : 22,
    shadowColor: "#0f172a",
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    maxWidth: isTablet ? 620 : "100%",
    alignSelf: "center",
    width: "100%",
    alignItems: "center",
  },
  successIconWrap: { marginBottom: 16 },
  successIconCircle: {
    width: isTablet ? 88 : 76,
    height: isTablet ? 88 : 76,
    borderRadius: 44,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#16a34a",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  successTitle: {
    fontSize: isTablet ? 24 : 20,
    fontWeight: "800",
    color: "#14532d",
    marginBottom: 6,
    textAlign: "center",
  },
  successName: {
    fontSize: isTablet ? 16 : 14,
    fontWeight: "600",
    color: "#166534",
    marginBottom: 10,
    textAlign: "center",
  },
  successSub: {
    fontSize: isTablet ? 14 : 13,
    color: "#475569",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 8,
  },

  // Channel box
  channelBox: {
    width: "100%",
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
    marginBottom: 20,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  channelIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  channelLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 2,
  },
  channelValue: {
    fontSize: 12,
    color: "#64748b",
  },
  channelDivider: {
    height: 1,
    backgroundColor: "#e2e8f0",
    marginVertical: 12,
  },

  // WhatsApp send button
  waBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 14,
    shadowColor: "#16a34a",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  waBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  waBtnHint: {
    fontSize: 11,
    color: "#64748b",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 16,
  },

  // Go to login
  loginBtn: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#2563eb",
    borderRadius: 14,
    paddingVertical: 13,
  },
  loginBtnText: {
    color: "#2563eb",
    fontSize: 15,
    fontWeight: "700",
  },
});

// ─── DOB picker styles ────────────────────────────────────────────────────────
const dp = StyleSheet.create({
  overlay:  { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:    {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingBottom: 32,
  },
  header:   {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  title:    { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  cancelTxt:{ fontSize: 15, color: '#64748b', fontWeight: '500' },
  doneTxt:  { fontSize: 15, color: '#2563eb', fontWeight: '700' },

  colLabels:{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  colLabel: { textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase' },

  columns:  { flexDirection: 'row', height: 280, paddingHorizontal: 12, paddingTop: 4 },
  colSep:   { width: 1, backgroundColor: '#e2e8f0', marginVertical: 6 },

  colItem:    { height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 10, marginHorizontal: 2, marginVertical: 1 },
  colItemSel: { backgroundColor: '#eff6ff' },
  colTxt:     { fontSize: 14, color: '#94a3b8', fontWeight: '500' },
  colTxtSel:  { fontSize: 16, color: '#2563eb', fontWeight: '800' },
});
