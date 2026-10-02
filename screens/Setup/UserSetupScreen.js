import React, { useCallback, useContext, useEffect, useState } from "react";
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
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { Feather } from "@expo/vector-icons";
import { AuthContext } from "../../context/AuthContext";
import { fetchBranches } from "../../services/SetupServiceApi";
import { fetchUsers, createUser, updateUser, deleteUser } from "../../services/UserServiceApi";
import { fetchHiredStaff } from "../../services/StaffServiceApi";

const { width } = Dimensions.get("window");
const isTablet = width >= 768;

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

function parseMobileNumber(stored) {
  if (!stored) return { countryCode: '+91', mobileNumber: '' };
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
          {selected?.label ?? label}
        </Text>
        <Feather name="chevron-down" size={16} color="#475569" />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={ddSt.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={ddSt.sheet}>
            <Text style={ddSt.title}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o, i) => String(o.value) + i}
              renderItem={({ item: o }) => (
                <TouchableOpacity
                  style={[ddSt.option, String(o.value) === String(value) && ddSt.optionActive]}
                  onPress={() => { onChange(o.value); setOpen(false); }}
                >
                  <Text style={[ddSt.optionTxt, String(o.value) === String(value) && ddSt.optionTxtActive]}>
                    {o.label}
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
  const [countryCode, setCountryCode] = useState('+91');
  const [mobileNumber, setMobileNumber] = useState('');
  const [ccPickerVisible, setCcPickerVisible] = useState(false);

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
      const [userData, branchData, staffData] = await Promise.all([
        fetchUsers(user),
        fetchBranches(user),
        fetchHiredStaff(user).catch(() => []),
      ]);
      const allUsers = Array.isArray(userData) ? userData : userData?.data || [];
      const EXCLUDED = ['student', 'parent'];
      setUsers(allUsers.filter(u => !EXCLUDED.includes((u.ssms_user_role ?? '').toLowerCase().trim())));
      setBranches(Array.isArray(branchData.data) ? branchData.data : []);
      setStaffList(Array.isArray(staffData) ? staffData : []);
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to load users");
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
    setCountryCode('+91');
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
      Alert.alert("Validation", "Please fill all required fields");
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
        Alert.alert("Success", "User updated successfully");
      } else {
        await createUser(payload, user);
        Alert.alert("Success", "User created successfully");
      }
      setModalVisible(false);
      resetForm();
      loadData();
    } catch (error) {
      Alert.alert("Error", error.message || "Failed to save user");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (userName) => {
    Alert.alert("Delete User", "Are you sure you want to delete this user?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteUser(userName, user);
            Alert.alert("Success", "User deleted successfully");
            loadData();
          } catch (error) {
            Alert.alert("Error", error.message || "Failed to delete user");
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
      <Text style={styles.pageTitle}>List of Users</Text>
      <Text style={styles.pageSubtitle}>
        Manage school users, staff roles and permissions.
      </Text>

      <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
        <MaterialIcons name="person-add-alt-1" size={20} color="#fff" />
        <Text style={styles.addButtonText}>Add New User</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator size="large" color="#1e40af" style={{ marginTop: 40 }} />
      ) : users.length === 0 ? (
        <View style={styles.emptyCard}>
          <MaterialIcons name="group" size={60} color="#94a3b8" />
          <Text style={styles.emptyTitle}>No Users Found</Text>
          <Text style={styles.emptyText}>Start by creating your first user account.</Text>
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
                  {editingUser ? "Edit User" : "Add New User"}
                </Text>
                <Text style={styles.drawerSubtitle}>
                  {editingUser
                    ? `Editing @${editingUser.ssms_user_name}`
                    : "Fill in the details below"}
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
            style={styles.drawerBody}
            contentContainerStyle={styles.drawerBodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── ACCOUNT INFO ──────────────────────────────────────────────── */}
            <Text style={styles.sectionLabel}>ACCOUNT INFO</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                Username <Text style={styles.required}>*</Text>
              </Text>
              <View style={[styles.inputWrap, editingUser ? styles.inputWrapDisabled : null]}>
                <MaterialIcons name="alternate-email" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={styles.inputInner}
                  placeholder="e.g. john_doe"
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
                <Text style={styles.inputLabel}>
                  First Name <Text style={styles.required}>*</Text>
                </Text>
                <View style={styles.inputWrap}>
                  <MaterialIcons name="person-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputInner}
                    placeholder="First name"
                    placeholderTextColor="#94a3b8"
                    value={form.ssms_user_firstname}
                    onChangeText={(v) => setForm((p) => ({ ...p, ssms_user_firstname: v }))}
                    autoCorrect={false}
                  />
                </View>
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Last Name</Text>
                <View style={styles.inputWrap}>
                  <MaterialIcons name="person-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputInner}
                    placeholder="Last name"
                    placeholderTextColor="#94a3b8"
                    value={form.ssms_user_lastname}
                    onChangeText={(v) => setForm((p) => ({ ...p, ssms_user_lastname: v }))}
                    autoCorrect={false}
                  />
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                Email <Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.inputWrap}>
                <MaterialIcons name="mail-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
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
              <Text style={styles.inputLabel}>Mobile Number</Text>
              <View style={styles.mobileRow}>
                <TouchableOpacity
                  style={styles.ccBtn}
                  onPress={() => setCcPickerVisible(true)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.ccBtnTxt}>{countryCode}</Text>
                  <Feather name="chevron-down" size={14} color="#475569" />
                </TouchableOpacity>
                <View style={[styles.inputWrap, { flex: 1 }]}>
                  <MaterialIcons name="phone" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
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
                  <Text style={styles.ccSheetTitle}>Select Country Code</Text>
                  <FlatList
                    data={COUNTRY_CODES}
                    keyExtractor={(item, i) => item.value + i}
                    renderItem={({ item: cc }) => (
                      <TouchableOpacity
                        style={[styles.ccOption, cc.value === countryCode && styles.ccOptionActive]}
                        onPress={() => { setCountryCode(cc.value); setCcPickerVisible(false); }}
                      >
                        <Text style={[styles.ccOptionTxt, cc.value === countryCode && styles.ccOptionTxtActive]}>
                          {cc.label}
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
                {editingUser ? "New Password" : "Password"}
              </Text>
              {editingUser && (
                <Text style={styles.inputHint}>Leave blank to keep current password</Text>
              )}
              <View style={styles.inputWrap}>
                <MaterialIcons name="lock-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
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
              <Text style={styles.inputLabel}>Staff Member</Text>
              <Dropdown
                label="Select Staff"
                value={form.staff_id}
                options={[
                  { label: "— None (Admin / Owner) —", value: "" },
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
              <Text style={styles.inputLabel}>Role</Text>
              <Dropdown
                label="Select Role"
                value={form.ssms_user_role}
                options={[
                  { label: "Select Role",      value: ""           },
                  { label: "Teacher / User",   value: "user"       },
                  { label: "Admin",            value: "admin"      },
                  { label: "Accountant",       value: "accountant" },
                  { label: "Owner",            value: "owner"      },
                ]}
                onChange={(v) => setForm((p) => ({ ...p, ssms_user_role: v }))}
                disabled={saving}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Branch</Text>
              <Dropdown
                label="Select Branch"
                value={form.branch_id}
                options={[
                  { label: "Select Branch", value: "" },
                  ...branches.map(b => ({ label: b.branch_name, value: String(b.branch_id) })),
                ]}
                onChange={(v) => setForm((p) => ({ ...p, branch_id: v }))}
                disabled={saving}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Status</Text>
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
                      {s}
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
                <Text style={styles.footerCancelText}>Cancel</Text>
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
                      {editingUser ? "Update User" : "Save User"}
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
            {item.ssms_user_firstname} {item.ssms_user_lastname}
          </Text>
          <Text style={styles.userRole}>{item.ssms_user_role}</Text>
          <Text style={styles.userEmail}>{item.ssms_user_email}</Text>
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
            {item.ssms_user_status}
          </Text>
        </View>
      </View>
      <Text style={styles.infoText}>Username: {item.ssms_user_name}</Text>
      <Text style={styles.infoText}>Branch: {item.branch_name || "N/A"}</Text>
      <Text style={styles.infoText}>Staff: {item.staff_name?.trim() || "N/A"}</Text>
      <Text style={styles.infoText}>
        Last Login:{" "}
        {item.last_login_date
          ? new Date(item.last_login_date.replace(" ", "T") + "Z").toLocaleString("en-GB", {
              day: "2-digit", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit", hour12: true,
            })
          : "Never"}
      </Text>
      <View style={styles.footerButtons}>
        <TouchableOpacity style={styles.editButton} onPress={() => onEdit(item)}>
          <MaterialIcons name="edit" size={18} color="#1e40af" />
          <Text style={styles.editButtonText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteButton} onPress={() => onDelete(item.ssms_user_name)}>
          <MaterialIcons name="delete-outline" size={18} color="#dc2626" />
          <Text style={styles.deleteButtonText}>Delete</Text>
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