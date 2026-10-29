/**
 * constants/Store.js
 *
 * Can a school's plan be bought / changed inside this app?
 *  • Android: yes – Google Play subscriptions (services/PlayBilling.js).
 *  • iOS: no. The app is sold to schools for their staff, students and parents, so it only lets them use the plan
 *    the school already has (App Review Guideline 3.1.3(c) Enterprise Services). Apple does not allow prices, buy
 *    buttons, "upgrade" calls to action or pointers to buying elsewhere (e.g. "buy it on Android") outside the US
 *    storefront, so on iOS the app shows only the school's current plan, neutrally.
 */
import { Platform } from "react-native";

export const PLANS_SOLD_IN_APP = Platform.OS === "android";
