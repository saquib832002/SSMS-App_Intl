import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

const Stack = createNativeStackNavigator();

export default function TransportStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="TransportHome"       getComponent={() => require("../screens/Transport/TransportScreen").default} />
      <Stack.Screen name="TransportEnrollment"    getComponent={() => require("../screens/Transport/TransportEnrollmentScreen").default} />
      <Stack.Screen name="TransportFeeStructure"  getComponent={() => require("../screens/Transport/TransportFeeStructureScreen").default} />
      <Stack.Screen name="StudentFeeTransport"   getComponent={() => require("../screens/Finance/StudentFeeTransportScreen").default} />
    </Stack.Navigator>
  );
}