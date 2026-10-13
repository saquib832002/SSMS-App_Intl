import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { deviceDialCode, defaultDialFor } from '../../constants/Countries';
const DEFAULT_DIAL = deviceDialCode('+91');
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Dimensions,
  Image,
  Platform,
  FlatList,
  Keyboard,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchBranches } from "../../services/SetupServiceApi";
import { fetchUsers, createUser, updateUser, deleteUser } from "../../services/UserServiceApi";
import { fetchHiredStaff } from "../../services/StaffServiceApi";

import { fmtDateTime } from "../../services/Locale";
import { _t, _tx } from "../../services/i18n";
const { width } = Dimensions.get("window");
const isTablet = width >= 768;

const COUNTRY_CODES = [
  { get label() { return _t("🇮🇳 India (+91)"); },                         value: '+91'   },
  { get label() { return _t("🇦🇫 Afghanistan (+93)"); },                   value: '+93'   },
  { get label() { return _t("🇦🇱 Albania (+355)"); },                      value: '+355'  },
  { get label() { return _t("🇩🇿 Algeria (+213)"); },                      value: '+213'  },
  { get label() { return _t("🇦🇩 Andorra (+376)"); },                      value: '+376'  },
  { get label() { return _t("🇦🇴 Angola (+244)"); },                       value: '+244'  },
  { get label() { return _t("🇦🇬 Antigua & Barbuda (+1268)"); },           value: '+1268' },
  { get label() { return _t("🇦🇷 Argentina (+54)"); },                     value: '+54'   },
  { get label() { return _t("🇦🇲 Armenia (+374)"); },                      value: '+374'  },
  { get label() { return _t("🇦🇺 Australia (+61)"); },                     value: '+61'   },
  { get label() { return _t("🇦🇹 Austria (+43)"); },                       value: '+43'   },
  { get label() { return _t("🇦🇿 Azerbaijan (+994)"); },                   value: '+994'  },
  { get label() { return _t("🇧🇸 Bahamas (+1242)"); },                     value: '+1242' },
  { get label() { return _t("🇧🇭 Bahrain (+973)"); },                      value: '+973'  },
  { get label() { return _t("🇧🇩 Bangladesh (+880)"); },                   value: '+880'  },
  { get label() { return _t("🇧🇧 Barbados (+1246)"); },                    value: '+1246' },
  { get label() { return _t("🇧🇾 Belarus (+375)"); },                      value: '+375'  },
  { get label() { return _t("🇧🇪 Belgium (+32)"); },                       value: '+32'   },
  { get label() { return _t("🇧🇿 Belize (+501)"); },                       value: '+501'  },
  { get label() { return _t("🇧🇯 Benin (+229)"); },                        value: '+229'  },
  { get label() { return _t("🇧🇹 Bhutan (+975)"); },                       value: '+975'  },
  { get label() { return _t("🇧🇴 Bolivia (+591)"); },                      value: '+591'  },
  { get label() { return _t("🇧🇦 Bosnia & Herzegovina (+387)"); },         value: '+387'  },
  { get label() { return _t("🇧🇼 Botswana (+267)"); },                     value: '+267'  },
  { get label() { return _t("🇧🇷 Brazil (+55)"); },                        value: '+55'   },
  { get label() { return _t("🇧🇳 Brunei (+673)"); },                       value: '+673'  },
  { get label() { return _t("🇧🇬 Bulgaria (+359)"); },                     value: '+359'  },
  { get label() { return _t("🇧🇫 Burkina Faso (+226)"); },                 value: '+226'  },
  { get label() { return _t("🇧🇮 Burundi (+257)"); },                      value: '+257'  },
  { get label() { return _t("🇨🇻 Cabo Verde (+238)"); },                   value: '+238'  },
  { get label() { return _t("🇰🇭 Cambodia (+855)"); },                     value: '+855'  },
  { get label() { return _t("🇨🇲 Cameroon (+237)"); },                     value: '+237'  },
  { get label() { return _t("🇨🇦 Canada (+1)"); },                         value: '+1'    },
  { get label() { return _t("🇨🇫 Central African Republic (+236)"); },     value: '+236'  },
  { get label() { return _t("🇹🇩 Chad (+235)"); },                         value: '+235'  },
  { get label() { return _t("🇨🇱 Chile (+56)"); },                         value: '+56'   },
  { get label() { return _t("🇨🇳 China (+86)"); },                         value: '+86'   },
  { get label() { return _t("🇨🇴 Colombia (+57)"); },                      value: '+57'   },
  { get label() { return _t("🇰🇲 Comoros (+269)"); },                      value: '+269'  },
  { get label() { return _t("🇨🇩 Congo (DRC) (+243)"); },                  value: '+243'  },
  { get label() { return _t("🇨🇬 Congo (Republic) (+242)"); },             value: '+242'  },
  { get label() { return _t("🇨🇷 Costa Rica (+506)"); },                   value: '+506'  },
  { get label() { return _t("🇨🇮 Côte d'Ivoire (+225)"); },               value: '+225'  },
  { get label() { return _t("🇭🇷 Croatia (+385)"); },                      value: '+385'  },
  { get label() { return _t("🇨🇺 Cuba (+53)"); },                          value: '+53'   },
  { get label() { return _t("🇨🇾 Cyprus (+357)"); },                       value: '+357'  },
  { get label() { return _t("🇨🇿 Czech Republic (+420)"); },               value: '+420'  },
  { get label() { return _t("🇩🇰 Denmark (+45)"); },                       value: '+45'   },
  { get label() { return _t("🇩🇯 Djibouti (+253)"); },                     value: '+253'  },
  { get label() { return _t("🇩🇲 Dominica (+1767)"); },                    value: '+1767' },
  { get label() { return _t("🇩🇴 Dominican Republic (+1809)"); },          value: '+1809' },
  { get label() { return _t("🇪🇨 Ecuador (+593)"); },                      value: '+593'  },
  { get label() { return _t("🇪🇬 Egypt (+20)"); },                         value: '+20'   },
  { get label() { return _t("🇸🇻 El Salvador (+503)"); },                  value: '+503'  },
  { get label() { return _t("🇬🇶 Equatorial Guinea (+240)"); },            value: '+240'  },
  { get label() { return _t("🇪🇷 Eritrea (+291)"); },                      value: '+291'  },
  { get label() { return _t("🇪🇪 Estonia (+372)"); },                      value: '+372'  },
  { get label() { return _t("🇸🇿 Eswatini (+268)"); },                     value: '+268'  },
  { get label() { return _t("🇪🇹 Ethiopia (+251)"); },                     value: '+251'  },
  { get label() { return _t("🇫🇯 Fiji (+679)"); },                         value: '+679'  },
  { get label() { return _t("🇫🇮 Finland (+358)"); },                      value: '+358'  },
  { get label() { return _t("🇫🇷 France (+33)"); },                        value: '+33'   },
  { get label() { return _t("🇬🇦 Gabon (+241)"); },                        value: '+241'  },
  { get label() { return _t("🇬🇲 Gambia (+220)"); },                       value: '+220'  },
  { get label() { return _t("🇬🇪 Georgia (+995)"); },                      value: '+995'  },
  { get label() { return _t("🇩🇪 Germany (+49)"); },                       value: '+49'   },
  { get label() { return _t("🇬🇭 Ghana (+233)"); },                        value: '+233'  },
  { get label() { return _t("🇬🇷 Greece (+30)"); },                        value: '+30'   },
  { get label() { return _t("🇬🇩 Grenada (+1473)"); },                     value: '+1473' },
  { get label() { return _t("🇬🇹 Guatemala (+502)"); },                    value: '+502'  },
  { get label() { return _t("🇬🇳 Guinea (+224)"); },                       value: '+224'  },
  { get label() { return _t("🇬🇼 Guinea-Bissau (+245)"); },                value: '+245'  },
  { get label() { return _t("🇬🇾 Guyana (+592)"); },                       value: '+592'  },
  { get label() { return _t("🇭🇹 Haiti (+509)"); },                        value: '+509'  },
  { get label() { return _t("🇭🇳 Honduras (+504)"); },                     value: '+504'  },
  { get label() { return _t("🇭🇺 Hungary (+36)"); },                       value: '+36'   },
  { get label() { return _t("🇮🇸 Iceland (+354)"); },                      value: '+354'  },
  { get label() { return _t("🇮🇳 India (+91)"); },                         value: '+91'   },
  { get label() { return _t("🇮🇩 Indonesia (+62)"); },                     value: '+62'   },
  { get label() { return _t("🇮🇷 Iran (+98)"); },                          value: '+98'   },
  { get label() { return _t("🇮🇶 Iraq (+964)"); },                         value: '+964'  },
  { get label() { return _t("🇮🇪 Ireland (+353)"); },                      value: '+353'  },
  { get label() { return _t("🇮🇱 Israel (+972)"); },                       value: '+972'  },
  { get label() { return _t("🇮🇹 Italy (+39)"); },                         value: '+39'   },
  { get label() { return _t("🇯🇲 Jamaica (+1876)"); },                     value: '+1876' },
  { get label() { return _t("🇯🇵 Japan (+81)"); },                         value: '+81'   },
  { get label() { return _t("🇯🇴 Jordan (+962)"); },                       value: '+962'  },
  { get label() { return _t("🇰🇿 Kazakhstan (+7)"); },                     value: '+7'    },
  { get label() { return _t("🇰🇪 Kenya (+254)"); },                        value: '+254'  },
  { get label() { return _t("🇰🇮 Kiribati (+686)"); },                     value: '+686'  },
  { get label() { return _t("🇽🇰 Kosovo (+383)"); },                       value: '+383'  },
  { get label() { return _t("🇰🇼 Kuwait (+965)"); },                       value: '+965'  },
  { get label() { return _t("🇰🇬 Kyrgyzstan (+996)"); },                   value: '+996'  },
  { get label() { return _t("🇱🇦 Laos (+856)"); },                         value: '+856'  },
  { get label() { return _t("🇱🇻 Latvia (+371)"); },                       value: '+371'  },
  { get label() { return _t("🇱🇧 Lebanon (+961)"); },                      value: '+961'  },
  { get label() { return _t("🇱🇸 Lesotho (+266)"); },                      value: '+266'  },
  { get label() { return _t("🇱🇷 Liberia (+231)"); },                      value: '+231'  },
  { get label() { return _t("🇱🇾 Libya (+218)"); },                        value: '+218'  },
  { get label() { return _t("🇱🇮 Liechtenstein (+423)"); },                value: '+423'  },
  { get label() { return _t("🇱🇹 Lithuania (+370)"); },                    value: '+370'  },
  { get label() { return _t("🇱🇺 Luxembourg (+352)"); },                   value: '+352'  },
  { get label() { return _t("🇲🇬 Madagascar (+261)"); },                   value: '+261'  },
  { get label() { return _t("🇲🇼 Malawi (+265)"); },                       value: '+265'  },
  { get label() { return _t("🇲🇾 Malaysia (+60)"); },                      value: '+60'   },
  { get label() { return _t("🇲🇻 Maldives (+960)"); },                     value: '+960'  },
  { get label() { return _t("🇲🇱 Mali (+223)"); },                         value: '+223'  },
  { get label() { return _t("🇲🇹 Malta (+356)"); },                        value: '+356'  },
  { get label() { return _t("🇲🇭 Marshall Islands (+692)"); },             value: '+692'  },
  { get label() { return _t("🇲🇷 Mauritania (+222)"); },                   value: '+222'  },
  { get label() { return _t("🇲🇺 Mauritius (+230)"); },                    value: '+230'  },
  { get label() { return _t("🇲🇽 Mexico (+52)"); },                        value: '+52'   },
  { get label() { return _t("🇫🇲 Micronesia (+691)"); },                   value: '+691'  },
  { get label() { return _t("🇲🇩 Moldova (+373)"); },                      value: '+373'  },
  { get label() { return _t("🇲🇨 Monaco (+377)"); },                       value: '+377'  },
  { get label() { return _t("🇲🇳 Mongolia (+976)"); },                     value: '+976'  },
  { get label() { return _t("🇲🇪 Montenegro (+382)"); },                   value: '+382'  },
  { get label() { return _t("🇲🇦 Morocco (+212)"); },                      value: '+212'  },
  { get label() { return _t("🇲🇿 Mozambique (+258)"); },                   value: '+258'  },
  { get label() { return _t("🇲🇲 Myanmar (+95)"); },                       value: '+95'   },
  { get label() { return _t("🇳🇦 Namibia (+264)"); },                      value: '+264'  },
  { get label() { return _t("🇳🇷 Nauru (+674)"); },                        value: '+674'  },
  { get label() { return _t("🇳🇵 Nepal (+977)"); },                        value: '+977'  },
  { get label() { return _t("🇳🇱 Netherlands (+31)"); },                   value: '+31'   },
  { get label() { return _t("🇳🇿 New Zealand (+64)"); },                   value: '+64'   },
  { get label() { return _t("🇳🇮 Nicaragua (+505)"); },                    value: '+505'  },
  { get label() { return _t("🇳🇪 Niger (+227)"); },                        value: '+227'  },
  { get label() { return _t("🇳🇬 Nigeria (+234)"); },                      value: '+234'  },
  { get label() { return _t("🇲🇰 North Macedonia (+389)"); },              value: '+389'  },
  { get label() { return _t("🇳🇴 Norway (+47)"); },                        value: '+47'   },
  { get label() { return _t("🇴🇲 Oman (+968)"); },                         value: '+968'  },
  { get label() { return _t("🇵🇰 Pakistan (+92)"); },                      value: '+92'   },
  { get label() { return _t("🇵🇼 Palau (+680)"); },                        value: '+680'  },
  { get label() { return _t("🇵🇸 Palestine (+970)"); },                    value: '+970'  },
  { get label() { return _t("🇵🇦 Panama (+507)"); },                       value: '+507'  },
  { get label() { return _t("🇵🇬 Papua New Guinea (+675)"); },             value: '+675'  },
  { get label() { return _t("🇵🇾 Paraguay (+595)"); },                     value: '+595'  },
  { get label() { return _t("🇵🇪 Peru (+51)"); },                          value: '+51'   },
  { get label() { return _t("🇵🇭 Philippines (+63)"); },                   value: '+63'   },
  { get label() { return _t("🇵🇱 Poland (+48)"); },                        value: '+48'   },
  { get label() { return _t("🇵🇹 Portugal (+351)"); },                     value: '+351'  },
  { get label() { return _t("🇶🇦 Qatar (+974)"); },                        value: '+974'  },
  { get label() { return _t("🇷🇴 Romania (+40)"); },                       value: '+40'   },
  { get label() { return _t("🇷🇺 Russia (+7)"); },                         value: '+7'    },
  { get label() { return _t("🇷🇼 Rwanda (+250)"); },                       value: '+250'  },
  { get label() { return _t("🇰🇳 Saint Kitts & Nevis (+1869)"); },        value: '+1869' },
  { get label() { return _t("🇱🇨 Saint Lucia (+1758)"); },                 value: '+1758' },
  { get label() { return _t("🇻🇨 Saint Vincent & Grenadines (+1784)"); }, value: '+1784' },
  { get label() { return _t("🇼🇸 Samoa (+685)"); },                        value: '+685'  },
  { get label() { return _t("🇸🇲 San Marino (+378)"); },                   value: '+378'  },
  { get label() { return _t("🇸🇹 São Tomé & Príncipe (+239)"); },          value: '+239'  },
  { get label() { return _t("🇸🇦 Saudi Arabia (+966)"); },                 value: '+966'  },
  { get label() { return _t("🇸🇳 Senegal (+221)"); },                      value: '+221'  },
  { get label() { return _t("🇷🇸 Serbia (+381)"); },                       value: '+381'  },
  { get label() { return _t("🇸🇨 Seychelles (+248)"); },                   value: '+248'  },
  { get label() { return _t("🇸🇱 Sierra Leone (+232)"); },                 value: '+232'  },
  { get label() { return _t("🇸🇬 Singapore (+65)"); },                     value: '+65'   },
  { get label() { return _t("🇸🇰 Slovakia (+421)"); },                     value: '+421'  },
  { get label() { return _t("🇸🇮 Slovenia (+386)"); },                     value: '+386'  },
  { get label() { return _t("🇸🇧 Solomon Islands (+677)"); },              value: '+677'  },
  { get label() { return _t("🇸🇴 Somalia (+252)"); },                      value: '+252'  },
  { get label() { return _t("🇿🇦 South Africa (+27)"); },                  value: '+27'   },
  { get label() { return _t("🇸🇸 South Sudan (+211)"); },                  value: '+211'  },
  { get label() { return _t("🇪🇸 Spain (+34)"); },                         value: '+34'   },
  { get label() { return _t("🇱🇰 Sri Lanka (+94)"); },                     value: '+94'   },
  { get label() { return _t("🇸🇩 Sudan (+249)"); },                        value: '+249'  },
  { get label() { return _t("🇸🇷 Suriname (+597)"); },                     value: '+597'  },
  { get label() { return _t("🇸🇪 Sweden (+46)"); },                        value: '+46'   },
  { get label() { return _t("🇨🇭 Switzerland (+41)"); },                   value: '+41'   },
  { get label() { return _t("🇸🇾 Syria (+963)"); },                        value: '+963'  },
  { get label() { return _t("🇹🇼 Taiwan (+886)"); },                       value: '+886'  },
  { get label() { return _t("🇹🇯 Tajikistan (+992)"); },                   value: '+992'  },
  { get label() { return _t("🇹🇿 Tanzania (+255)"); },                     value: '+255'  },
  { get label() { return _t("🇹🇭 Thailand (+66)"); },                      value: '+66'   },
  { get label() { return _t("🇹🇱 Timor-Leste (+670)"); },                  value: '+670'  },
  { get label() { return _t("🇹🇬 Togo (+228)"); },                         value: '+228'  },
  { get label() { return _t("🇹🇴 Tonga (+676)"); },                        value: '+676'  },
  { get label() { return _t("🇹🇹 Trinidad & Tobago (+1868)"); },           value: '+1868' },
  { get label() { return _t("🇹🇳 Tunisia (+216)"); },                      value: '+216'  },
  { get label() { return _t("🇹🇷 Turkey (+90)"); },                        value: '+90'   },
  { get label() { return _t("🇹🇲 Turkmenistan (+993)"); },                 value: '+993'  },
  { get label() { return _t("🇹🇻 Tuvalu (+688)"); },                       value: '+688'  },
  { get label() { return _t("🇺🇬 Uganda (+256)"); },                       value: '+256'  },
  { get label() { return _t("🇺🇦 Ukraine (+380)"); },                      value: '+380'  },
  { get label() { return _t("🇦🇪 UAE (+971)"); },                          value: '+971'  },
  { get label() { return _t("🇬🇧 United Kingdom (+44)"); },                value: '+44'   },
  { get label() { return _t("🇺🇸 USA (+1)"); },                            value: '+1'    },
  { get label() { return _t("🇺🇾 Uruguay (+598)"); },                      value: '+598'  },
  { get label() { return _t("🇺🇿 Uzbekistan (+998)"); },                   value: '+998'  },
  { get label() { return _t("🇻🇺 Vanuatu (+678)"); },                      value: '+678'  },
  { get label() { return _t("🇻🇦 Vatican City (+39)"); },                  value: '+39'   },
  { get label() { return _t("🇻🇪 Venezuela (+58)"); },                     value: '+58'   },
  { get label() { return _t("🇻🇳 Vietnam (+84)"); },                       value: '+84'   },
  { get label() { return _t("🇾🇪 Yemen (+967)"); },                        value: '+967'  },
  { get label() { return _t("🇿🇲 Zambia (+260)"); },                       value: '+260'  },
  { get label() { return _t("🇿🇼 Zimbabwe (+263)"); },                     value: '+263'  },
];

function parseMobileNumber(stored) {
  if (!stored) return { countryCode: DEFAULT_DIAL, mobileNumber: '' };
  const normalized = stored.startsWith('+') ? stored : '+' + stored;
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.value.length - a.value.length);
  for (const cc of sorted) {
    if (normalized.startsWith(cc.value)) {
      return { countryCode: cc.value, mobileNumber: normalized.slice(cc.value.length) };
    }
  }
  return { countryCode: '+91', mobileNumber: stored.replace(/^\+/, '') };
}


// ── Custom Dropdown ───────────────────────────────────────────────────────────
function Dropdown({ label, value, options, onChange, disabled }) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find(o => String(o.value) === String(value));
  return (
    <>
      <TouchableOpacity
        style={[ddSt.trigger, disabled && ddSt.disabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={[ddSt.triggerTxt, !selected?.value && ddSt.placeholder]} numberOfLines={1}>
          {_tx(selected?.label) ?? _tx(label)}
        </Text>
        <Feather name="chevron-down" size={16} color="#475569" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={ddSt.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={ddSt.sheet}>
            <Text style={ddSt.title}>{_tx(label)}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[ddSt.option, String(o.value) === String(value) && ddSt.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[ddSt.optionTxt, String(o.value) === String(value) && ddSt.optionTxtActive]}>
                    {_tx(o.label)}
                  </Text>
                  {String(o.value) === String(value) && <Feather name="check" size={14} color="#1e40af" />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f8fafc" }} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
const ddSt = StyleSheet.create({
  trigger:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#e2e8f0", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13 },
  disabled:    { opacity: 0.45 },
  triggerTxt:  { flex: 1, fontSize: 15, color: "#0f172a" },
  placeholder: { color: "#94a3b8" },
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  sheet:       { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  title:       { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  option:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  optionActive:{ backgroundColor: "#eff6ff" },
  optionTxt:   { fontSize: 15, color: "#0f172a" },
  optionTxtActive: { color: "#1e40af", fontWeight: "700" },
});

export default function UserSetupScreen() {
  const { user } = useContext(AuthContext);

  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [countryCode, setCountryCode] = useState(() => defaultDialFor(user));
  const [mobileNumber, setMobileNumber] = useState('');
  const [ccPickerVisible, setCcPickerVisible] = useState(false);

  // ── Keyboard handling for the Add/Edit User form ──────────────────────────
  // Android (edge-to-edge) does not resize a Modal when the keyboard opens,
  // so fields near the bottom ended up hidden under the keyboard. We add the
  // keyboard height as extra bottom space (so everything can scroll above it)
  // and scroll the focused field into view.
  const [kbHeight, setKbHeight] = useState(0);
  const formScrollRef = useRef(null);
  const formScrollY   = useRef(0);

  const scrollToFocused = useCallback(() => {
    setTimeout(() => {
      const input  = TextInput.State?.currentlyFocusedInput?.();
      const scroll = formScrollRef.current;
      if (!input || !scroll) return;
      const target = scroll.getNativeScrollRef?.() ?? scroll;
      try {
        input.measureLayout(
          target,
          (_x, y) => {
            // keep ~120px of space above the field
            scroll.scrollTo({ y: Math.max(0, formScrollY.current + y - 120), animated: true });
          },
          () => {}
        );
      } catch { /* ignore – best effort */ }
    }, 120);
  }, []);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s1 = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e?.endCoordinates?.height ?? 0);
      scrollToFocused();
    });
    const s2 = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { s1.remove(); s2.remove(); };
  }, [scrollToFocused]);

  const [form, setForm] = useState({
    ssms_user_name: "",
    ssms_user_firstname: "",
    ssms_user_lastname: "",
    ssms_user_password: "",
    ssms_user_email: "",
    ssms_user_role: "Teacher",
    staff_id: "",
    branch_id: "",
    ssms_user_status: "Active",
  });

  const loadData = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      // allSettled: a denied branch/staff lookup must not hide the user list
      const [rUsers, rBranch, rStaff] = await Promise.allSettled([
        fetchUsers(user),
        fetchBranches(user),
        fetchHiredStaff(user).catch(() => []),
      ]);
      const userData   = rUsers.status  === "fulfilled" ? rUsers.value  : null;
      const branchData = rBranch.status === "fulfilled" ? rBranch.value : null;
      const staffData  = rStaff.status  === "fulfilled" ? rStaff.value  : null;
      const allUsers = Array.isArray(userData) ? userData : Array.isArray(userData?.data) ? userData.data : [];
      const EXCLUDED = ['student', 'parent'];
      setUsers(allUsers.filter(u => !EXCLUDED.includes((u?.ssms_user_role ?? '').toLowerCase().trim())));
      setBranches(Array.isArray(branchData?.data) ? branchData.data : []);
      setStaffList(Array.isArray(staffData) ? staffData : []);
      if (rUsers.status === "rejected") Alert.alert(_t("Error"), _tx(rUsers.reason?.message) || _t("Failed to load users"));
    } catch (error) {
      Alert.alert(_t("Error"), _tx(error.message) || _t("Failed to load users"));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setForm({
      ssms_user_name: "",
      ssms_user_firstname: "",
      ssms_user_lastname: "",
      ssms_user_password: "",
      ssms_user_email: "",
      ssms_user_role: "Teacher",
      staff_id: "",
      branch_id: "",
      ssms_user_status: "Active",
    });
    setCountryCode(defaultDialFor(user));
    setMobileNumber('');
    setEditingUser(null);
  };

  const openAddModal = () => {
    resetForm();
    setEditingUser(null);
    setModalVisible(true);
  };

  const openEditModal = (item) => {
    setEditingUser(item);
    setForm({
      ssms_user_name: item.ssms_user_name || "",
      ssms_user_firstname: item.ssms_user_firstname || "",
      ssms_user_lastname: item.ssms_user_lastname || "",
      ssms_user_email: item.ssms_user_email || "",
      ssms_user_password: "",
      ssms_user_role: item.ssms_user_role || "user",
      staff_id: String(item.staff_id || ""),
      branch_id: String(item.branch_id || ""),
      ssms_user_status: item.ssms_user_status || "active",
    });
    const parsed = parseMobileNumber(item.mobile_number || "");
    setCountryCode(parsed.countryCode);
    setMobileNumber(parsed.mobileNumber);
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!form.ssms_user_name || !form.ssms_user_firstname || !form.ssms_user_email) {
      Alert.alert(_t("Validation"), _t("Please fill all required fields"));
      return;
    }
    try {
      setSaving(true);
      const ccDigits = countryCode.replace(/\D/g, '');
      const mobile = mobileNumber.trim()
        ? '+' + ccDigits + mobileNumber.trim().replace(/\D/g, '')
        : '';
      const payload = { ...form, mobile_number: mobile || null };
      if (editingUser) {
        await updateUser(editingUser.ssms_user_name, payload, user);
        Alert.alert(_t("Success"), _t("User updated successfully"));
      } else {
        await createUser(payload, user);
        Alert.alert(_t("Success"), _t("User created successfully"));
      }
      setModalVisible(false);
      resetForm();
      loadData();
    } catch (error) {
      Alert.alert(_t("Error"), _tx(error.message) || _t("Failed to save user"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (userName) => {
    Alert.alert(_t("Delete User"), _t("Are you sure you want to delete this user?"), [
      { text: _t("Cancel"), style: "cancel" },
      {
        text: _t("Delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteUser(userName, user);
            Alert.alert(_t("Success"), _t("User deleted successfully"));
            loadData();
          } catch (error) {
            Alert.alert(_t("Error"), _tx(error.message) || _t("Failed to delete user"));
          }
        },
      },
    ]);
  };

  const renderUserCards = () => {
    if (isTablet) {
      const rows = [];
      for (let i = 0; i < users.length; i += 2) {
        rows.push(
          <View key={i} style={styles.tabletRow}>
            <UserCard item={users[i]} onEdit={openEditModal} onDelete={handleDelete} />
            {users[i + 1] ? (
              <UserCard item={users[i + 1]} onEdit={openEditModal} onDelete={handleDelete} />
            ) : (
              <View style={styles.tabletCardPlaceholder} />
            )}
          </View>
        );
      }
      return rows;
    }
    return users.map((item, index) => (
      <UserCard
        key={`${item.ssms_user_name || "user"}-${index}`}
        item={item}
        onEdit={openEditModal}
        onDelete={handleDelete}
      />
    ));
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.pageTitle}>{_t("List of Users")}</Text>
      <Text style={styles.pageSubtitle}>{_t("Manage school users, staff roles and permissions.")}</Text>

      <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
        <MaterialIcons name="person-add-alt-1" size={20} color="#fff" />
        <Text style={styles.addButtonText}>{_t("Add New User")}</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="large" color="#1e40af" style={{ marginTop: 40 }} />
      ) : users.length === 0 ? (
        <View style={styles.emptyCard}>
          <MaterialIcons name="group" size={60} color="#94a3b8" />
          <Text style={styles.emptyTitle}>{_t("No Users Found")}</Text>
          <Text style={styles.emptyText}>{_t("Start by creating your first user account.")}</Text>
        </View>
      ) : (
        renderUserCards()
      )}

      {/*
        ─── MODAL ───────────────────────────────────────────────────────────────
        KEY FIXES for hidden buttons:
        1. transparent={false} + plain <View> root — no KeyboardAvoidingView
           (KAV with behavior="height" shrinks the whole container on Android,
            pushing the footer below the screen edge)
        2. Footer buttons placed INSIDE the ScrollView as the last item so they
           are always reachable by scrolling regardless of keyboard state.
        3. contentContainerStyle has paddingBottom so buttons are never under
           the home indicator on iOS.
      */}
      <Modal
        visible={modalVisible}
        transparent={false}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setModalVisible(false); resetForm(); }}
      >
        <View style={styles.drawerRoot}>

          {/* Fixed header */}
          <View style={styles.drawerHeader}>
            <View style={styles.drawerHeaderLeft}>
              <View style={styles.drawerIconWrap}>
                <MaterialIcons
                  name={editingUser ? "manage-accounts" : "person-add-alt-1"}
                  size={22}
                  color="#1e40af"
                />
              </View>
              <View>
                <Text style={styles.drawerTitle}>
                  {editingUser ? _t("Edit User") : _t("Add New User")}
                </Text>
                <Text style={styles.drawerSubtitle}>
                  {editingUser
                    ? _t("Editing @{ssms_user_name}", { ssms_user_name: editingUser.ssms_user_name })
                    : _t("Fill in the details below")}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.drawerCloseBtn}
              onPress={() => { setModalVisible(false); resetForm(); }}
            >
              <MaterialIcons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          <View style={styles.drawerDivider} />

          {/* Single ScrollView: form + buttons at the bottom */}
          <ScrollView
            ref={formScrollRef}
            style={styles.drawerBody}
            contentContainerStyle={[styles.drawerBodyContent, kbHeight > 0 && { paddingBottom: kbHeight + 40 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator
            onScroll={(e) => { formScrollY.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
          >
            {/* ── ACCOUNT INFO ──────────────────────────────────────────────── */}
            <Text style={styles.sectionLabel}>{_t("ACCOUNT INFO")}</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{_t("Username")}{" "}<Text style={styles.required}>*</Text>
              </Text>
              <View style={[styles.inputWrap, editingUser ? styles.inputWrapDisabled : null]}>
                <MaterialIcons name="alternate-email" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  onFocus={scrollToFocused}
                  style={styles.inputInner}
                  placeholder={_t("e.g. john_doe")}
                  placeholderTextColor="#94a3b8"
                  value={form.ssms_user_name}
                  onChangeText={(v) => setForm((p) => ({ ...p, ssms_user_name: v }))}
                  autoCorrect={false}
                  autoCapitalize="none"
                  editable={!editingUser}
                />
                {editingUser && (
                  <MaterialIcons name="lock-outline" size={16} color="#cbd5e1" style={{ marginRight: 12 }} />
                )}
              </View>
            </View>

            <View style={styles.inputRow}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
                <Text style={styles.inputLabel}>{_t("First Name")}{" "}<Text style={styles.required}>*</Text>
                </Text>
                <View style={styles.inputWrap}>
                  <MaterialIcons name="person-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                  onFocus={scrollToFocused}
                    style={styles.inputInner}
                    placeholder={_t("First name")}
                    placeholderTextColor="#94a3b8"
                    value={form.ssms_user_firstname}
                    onChangeText={(v) => setForm((p) => ({ ...p, ssms_user_firstname: v }))}
                    autoCorrect={false}
                  />
                </View>
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>{_t("Last Name")}</Text>
                <View style={styles.inputWrap}>
                  <MaterialIcons name="person-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                  onFocus={scrollToFocused}
                    style={styles.inputInner}
                    placeholder={_t("Last name")}
                    placeholderTextColor="#94a3b8"
                    value={form.ssms_user_lastname}
                    onChangeText={(v) => setForm((p) => ({ ...p, ssms_user_lastname: v }))}
                    autoCorrect={false}
                  />
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{_t("Email")}{" "}<Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.inputWrap}>
                <MaterialIcons name="mail-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  onFocus={scrollToFocused}
                  style={styles.inputInner}
                  placeholder="user@example.com"
                  placeholderTextColor="#94a3b8"
                  value={form.ssms_user_email}
                  onChangeText={(v) => setForm((p) => ({ ...p, ssms_user_email: v }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>

            {/* ── MOBILE NUMBER ─────────────────────────────────────────────── */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{_t("Mobile Number")}</Text>
              <View style={styles.mobileRow}>
                <TouchableOpacity
                  style={styles.ccBtn}
                  onPress={() => setCcPickerVisible(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.ccBtnTxt}>{_tx(countryCode)}</Text>
                  <Feather name="chevron-down" size={14} color="#475569" />
                </TouchableOpacity>
                <View style={[styles.inputWrap, { flex: 1 }]}>
                  <MaterialIcons name="phone" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                  onFocus={scrollToFocused}
                    style={styles.inputInner}
                    placeholder="9876543210"
                    placeholderTextColor="#94a3b8"
                    value={mobileNumber}
                    onChangeText={setMobileNumber}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                  />
                </View>
              </View>
            </View>

            {/* Country code picker modal */}
            <Modal
              visible={ccPickerVisible}
              transparent
              animationType="fade"
              onRequestClose={() => setCcPickerVisible(false)}
            >
              <TouchableOpacity
                style={styles.ccOverlay}
                onPress={() => setCcPickerVisible(false)}
                activeOpacity={1}
              >
                <View style={styles.ccSheet}>
                  <Text style={styles.ccSheetTitle}>{_t("Select Country Code")}</Text>
                  <FlatList
                    data={COUNTRY_CODES}
                    keyExtractor={(item, i) => item.value + i}
                    renderItem={({ item: cc }) => (
                      <TouchableOpacity
                        style={[styles.ccOption, cc.value === countryCode && styles.ccOptionActive]}
                        onPress={() => { setCountryCode(cc.value); setCcPickerVisible(false); }}
                      >
                        <Text style={[styles.ccOptionTxt, cc.value === countryCode && styles.ccOptionTxtActive]}>
                          {_tx(cc.label)}
                        </Text>
                        {cc.value === countryCode && <Feather name="check" size={14} color="#1e40af" />}
                      </TouchableOpacity>
                    )}
                    ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#f8fafc" }} />}
                  />
                </View>
              </TouchableOpacity>
            </Modal>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                {editingUser ? _t("New Password") : _t("Password")}
              </Text>
              {editingUser && (
                <Text style={styles.inputHint}>{_t("Leave blank to keep current password")}</Text>
              )}
              <View style={styles.inputWrap}>
                <MaterialIcons name="lock-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  onFocus={scrollToFocused}
                  style={styles.inputInner}
                  placeholder="••••••••"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry
                  value={form.ssms_user_password}
                  onChangeText={(v) => setForm((p) => ({ ...p, ssms_user_password: v }))}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            </View>

            {/* ── ROLE & ASSIGNMENT ─────────────────────────────────────────── */}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{_t("Staff Member")}</Text>
              <Dropdown
                label={_t("Select Staff")}
                value={form.staff_id}
                options={[
                  { label: _t("— None (Admin / Owner) —"), value: "" },
                  ...staffList.map(s => ({
                    value: String(s.staff_id),
                    label: `${s.full_name?.trim() || `${s.first_name} ${s.last_name}`.trim()}`,
                  })),
                ]}
                onChange={(v) => setForm((p) => ({ ...p, staff_id: v }))}
                disabled={saving}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{_t("Role")}</Text>
              <Dropdown
                label={_t("Select Role")}
                value={form.ssms_user_role}
                options={[
                  { label: _t("Select Role"),      value: ""           },
                  { label: _t("Teacher / User"),   value: "user"       },
                  { label: _t("Admin"),            value: "admin"      },
                  { label: _t("Accountant"),       value: "accountant" },
                  { label: _t("Owner"),            value: "owner"      },
                ]}
                onChange={(v) => setForm((p) => ({ ...p, ssms_user_role: v }))}
                disabled={saving}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{_t("Branch")}</Text>
              <Dropdown
                label={_t("Select Branch")}
                value={form.branch_id}
                options={[
                  { label: _t("Select Branch"), value: "" },
                  ...branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) })),
                ]}
                onChange={(v) => setForm((p) => ({ ...p, branch_id: v }))}
                disabled={saving}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{_t("Status")}</Text>
              <View style={styles.statusToggleRow}>
                {["Active", "Inactive"].map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.statusToggleBtn,
                      form.ssms_user_status === s &&
                        (s === "Active" ? styles.statusActiveSel : styles.statusInactiveSel),
                    ]}
                    onPress={() => setForm((p) => ({ ...p, ssms_user_status: s }))}
                  >
                    <MaterialIcons
                      name={s === "Active" ? "check-circle" : "cancel"}
                      size={16}
                      color={
                        form.ssms_user_status === s
                          ? s === "Active" ? "#16a34a" : "#dc2626"
                          : "#94a3b8"
                      }
                    />
                    <Text
                      style={[
                        styles.statusToggleText,
                        form.ssms_user_status === s && {
                          color: s === "Active" ? "#16a34a" : "#dc2626",
                          fontWeight: "700",
                        },
                      ]}
                    >
                      {_tx(s)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* ── Action buttons — inside ScrollView, never clipped by keyboard ── */}
            <View style={styles.drawerFooter}>
              <TouchableOpacity
                style={styles.footerCancelBtn}
                onPress={() => { setModalVisible(false); resetForm(); }}
              >
                <MaterialIcons name="close" size={18} color="#475569" style={{ marginRight: 6 }} />
                <Text style={styles.footerCancelText}>{_t("Cancel")}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.footerSaveBtn, saving && { opacity: 0.65 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <MaterialIcons
                      name={editingUser ? "save" : "person-add-alt-1"}
                      size={18}
                      color="#fff"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.footerSaveText}>
                      {editingUser ? _t("Update User") : _t("Save User")}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── User card component ────────────────────────────────────────────────────────
function UserCard({ item, onEdit, onDelete }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Image
          source={{
            uri: item.ssms_user_image || "https://via.placeholder.com/100x100.png?text=User",
          }}
          style={styles.avatar}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>
            {_tx(item.ssms_user_firstname)} {_tx(item.ssms_user_lastname)}
          </Text>
          <Text style={styles.userRole}>{_tx(item.ssms_user_role)}</Text>
          <Text style={styles.userEmail}>{_tx(item.ssms_user_email)}</Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: item.ssms_user_status === "Active" ? "#dcfce7" : "#fee2e2" },
          ]}
        >
          <Text
            style={{
              color: item.ssms_user_status === "Active" ? "#16a34a" : "#dc2626",
              fontWeight: "700",
              fontSize: 12,
            }}
          >
            {_tx(item.ssms_user_status)}
          </Text>
        </View>
      </View>
      <Text style={styles.infoText}>{_t("Username: {ssms_user_name}", { ssms_user_name: item.ssms_user_name })}</Text>
      <Text style={styles.infoText}>{_t("Branch: {v}", { v: item.branch_name || "N/A" })}</Text>
      <Text style={styles.infoText}>{_t("Staff: {v}", { v: item.staff_name?.trim() || "N/A" })}</Text>
      <Text style={styles.infoText}>{_t("Last Login: {v}", { v: item.last_login_date
          ? fmtDateTime(new Date(item.last_login_date.replace(" ", "T") + "Z"))
          : _t("Never") })}</Text>
      <View style={styles.footerButtons}>
        <TouchableOpacity style={styles.editButton} onPress={() => onEdit(item)}>
          <MaterialIcons name="edit" size={18} color="#1e40af" />
          <Text style={styles.editButtonText}>{_t("Edit")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteButton} onPress={() => onDelete(item.ssms_user_name)}>
          <MaterialIcons name="delete-outline" size={18} color="#dc2626" />
          <Text style={styles.deleteButtonText}>{_t("Delete")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ─── List screen ─────────────────────────────────────────────────────────────
  container: { flex: 1, backgroundColor: "#f8fafc" },
  contentContainer: { padding: 16, paddingBottom: 100 },
  pageTitle: { fontSize: 22, fontWeight: "800", color: "#7d5493", letterSpacing: -0.3 },
  pageSubtitle: { fontSize: 14, color: "#64748b", marginBottom: 20, marginTop: 4 },
  addButton: {
    backgroundColor: "#1e40af",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  addButtonText: { color: "#fff", fontWeight: "700", marginLeft: 8 },
  emptyCard: { backgroundColor: "#fff", borderRadius: 20, padding: 30, alignItems: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700", marginTop: 12 },
  emptyText: { color: "#64748b", marginTop: 8 },
  tabletRow: { flexDirection: "row", justifyContent: "space-between" },
  tabletCardPlaceholder: { width: "48%" },
  card: {
    width: isTablet ? "48%" : "100%",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    elevation: 4,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  avatar: { width: 60, height: 60, borderRadius: 18, marginRight: 12, backgroundColor: "#e2e8f0" },
  userName: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  userRole: { color: "#1e40af", fontWeight: "700", marginTop: 2 },
  userEmail: { color: "#64748b", marginTop: 2, fontSize: 13 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  infoText: { color: "#475569", marginBottom: 6, fontSize: 13 },
  footerButtons: { flexDirection: "row", marginTop: 14 },
  editButton: {
    flex: 1,
    backgroundColor: "#eff6ff",
    padding: 12,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  editButtonText: { color: "#1e40af", fontWeight: "700", marginLeft: 6 },
  deleteButton: {
    flex: 1,
    backgroundColor: "#fef2f2",
    padding: 12,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButtonText: { color: "#dc2626", fontWeight: "700", marginLeft: 6 },

  // ─── Drawer / modal ──────────────────────────────────────────────────────────
  drawerRoot: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 18 : 20,
    paddingBottom: 16,
    backgroundColor: "#ffffff",
  },
  drawerHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  drawerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  drawerTitle: { fontSize: 20, fontWeight: "800", color: "#0f172a" },
  drawerSubtitle: { fontSize: 13, color: "#64748b", marginTop: 2 },
  drawerCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  drawerDivider: { height: 1, backgroundColor: "#e2e8f0" },
  drawerBody: { flex: 1 },
  drawerBodyContent: {
    padding: 20,
    // generous bottom padding so buttons clear the home indicator on iOS
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
  },

  // ─── Form elements ───────────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 1.2,
    marginBottom: 14,
    marginTop: 4,
  },
  inputGroup: { marginBottom: 16 },
  inputRow: { flexDirection: "row" },
  mobileRow: { flexDirection: "row", gap: 10 },
  ccBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  ccBtnTxt: { fontSize: 15, fontWeight: "600", color: "#0f172a" },
  ccOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", paddingHorizontal: 20 },
  ccSheet: { backgroundColor: "#fff", borderRadius: 18, padding: 16, maxHeight: "70%" },
  ccSheetTitle: { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  ccOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10 },
  ccOptionActive: { backgroundColor: "#eff6ff" },
  ccOptionTxt: { fontSize: 15, color: "#0f172a", flex: 1 },
  ccOptionTxtActive: { color: "#1e40af", fontWeight: "700" },
  inputLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  required: { color: "#ef4444" },
  inputHint: { fontSize: 12, color: "#94a3b8", marginBottom: 6, marginTop: -2 },

  // icon-prefixed text input
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    overflow: "hidden",
  },
  inputWrapDisabled: { backgroundColor: "#f8fafc" },
  inputIcon: { marginLeft: 14, marginRight: 4 },
  inputInner: {
    flex: 1,
    paddingVertical: 13,
    paddingRight: 14,
    fontSize: 15,
    color: "#0f172a",
  },

  // icon-prefixed dropdown
  dropdownWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 14,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  dropdownIconWrap: {
    paddingLeft: 14,
    paddingRight: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  dropdownPickerWrap: { flex: 1 },
  picker: { color: "#0f172a" },

  // status toggle
  statusToggleRow: { flexDirection: "row", gap: 12 },
  statusToggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
    gap: 6,
  },
  statusActiveSel: { backgroundColor: "#f0fdf4", borderColor: "#16a34a" },
  statusInactiveSel: { backgroundColor: "#fef2f2", borderColor: "#dc2626" },
  statusToggleText: { fontSize: 14, fontWeight: "600", color: "#94a3b8" },

  // ─── Footer buttons (inside ScrollView) ─────────────────────────────────────
  drawerFooter: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
    gap: 12,
  },
  footerCancelBtn: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
  },
  footerCancelText: { fontSize: 15, fontWeight: "700", color: "#475569" },
  footerSaveBtn: {
    flex: 2,
    flexDirection: "row",
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: "#1e40af",
    alignItems: "center",
    justifyContent: "center",
  },
  footerSaveText: { fontSize: 15, fontWeight: "700", color: "#ffffff" },
});