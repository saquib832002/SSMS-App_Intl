// ============================================
// screens/NotificationsScreen.js
// ============================================
import { View, Text } from "react-native";
import { _t } from "../services/i18n";

const NotificationsScreen = () => {
return (
<View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
<Text style={{ fontSize: 22, fontWeight: "bold" }}>{_t("Notifications")}</Text>
<Text>{_t("No new notifications")}</Text>
</View>
)
}
export default NotificationsScreen
