// ============================================
// screens/FinanceScreen.js
// ============================================
import { View, Text } from "react-native";
import { _t } from "../services/i18n";

const FinanceScreen = () => {

return (
<View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
<Text style={{ fontSize: 22, fontWeight: "bold" }}>{_t("Finance Management")}</Text>
</View>
)
}
export default FinanceScreen