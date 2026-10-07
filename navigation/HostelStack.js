/**
 * navigation/HostelStack.js
 * All Hostel screens — lazy loaded via getComponent.
 * Bottom tabs + custom header stay visible on all screens.
 */
import React from "react";
import { featureScreenLayout } from "../components/FeatureGate";
import { createStackNavigator } from "@react-navigation/stack";

const Stack = createStackNavigator();

export default function HostelStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} screenLayout={featureScreenLayout}>
      <Stack.Screen name="HostelHome" getComponent={() => require("../screens/Hostel/HostelScreen").default}
      />
      <Stack.Screen name="HostelBuildings" getComponent={() => require("../screens/Hostel/HostelBuildingScreen").default}
      />
      <Stack.Screen name="HostelRooms" getComponent={() => require("../screens/Hostel/HostelRoomScreen").default}
      />
      <Stack.Screen name="HostelSeats" getComponent={() => require("../screens/Hostel/HostelRoomSeatScreen").default}
      />
      <Stack.Screen name="HostelRegistration" getComponent={() => require("../screens/Hostel/HostelRegistrationScreen").default}
      />
      <Stack.Screen name="HostelEnrollment"  getComponent={() => require("../screens/Hostel/HostelEnrollmentScreen").default}
      />
      <Stack.Screen name="HostelEnrolledStudents" getComponent={() => require("../screens/Hostel/HostelEnrolledStudentsScreen").default}
      />
      <Stack.Screen name="HostelFeeStructure" getComponent={() => require("../screens/Finance/HostelFeeStructureScreen").default}
      />
      <Stack.Screen name="HostelFee" getComponent={() => require("../screens/Finance/HostelFeeScreen").default}
      />
     <Stack.Screen name="FeeCollectionApproval" getComponent={() => require("../screens/Finance/FeeCollectionApprovalScreen").default} options={{ title: "Collection Approval", headerShown: false }} />

    </Stack.Navigator>
  );
}