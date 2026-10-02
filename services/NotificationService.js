/**
 * services/NotificationService.js
 * Local push notifications for class-period reminders (teacher / user role).
 *
 * Flow:
 *   1. Call requestPermissions() once (usually on first dashboard load).
 *   2. Call scheduleClassReminders(user, leadMins) whenever the dashboard
 *      gains focus — it cancels old reminders and schedules today's fresh set.
 *   3. Lead time is persisted in AsyncStorage (getLeadTime / saveLeadTime).
 */

import * as Notifications from 'expo-notifications';
import AsyncStorage        from '@react-native-async-storage/async-storage';
import { fetchTeacherTimetable } from './TimeTableServiceApi';

// ── Show the notification even when the app is in the foreground ──────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
});

// ── Constants ─────────────────────────────────────────────────────────────────
const LEAD_KEY     = '@ssms_notif_lead_mins';
const ENABLED_KEY  = '@ssms_notif_enabled';
export const DEFAULT_LEAD = 5;

// ── Permissions ───────────────────────────────────────────────────────────────
export async function requestPermissions() {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// ── Lead time persistence ─────────────────────────────────────────────────────
export async function getLeadTime() {
  try {
    const v = await AsyncStorage.getItem(LEAD_KEY);
    return v ? parseInt(v, 10) : DEFAULT_LEAD;
  } catch {
    return DEFAULT_LEAD;
  }
}

export async function saveLeadTime(mins) {
  try { await AsyncStorage.setItem(LEAD_KEY, String(mins)); } catch {}
}

// ── Enabled flag ──────────────────────────────────────────────────────────────
export async function getEnabled() {
  try {
    const v = await AsyncStorage.getItem(ENABLED_KEY);
    return v === null ? true : v === 'true'; // default ON
  } catch {
    return true;
  }
}

export async function setEnabled(flag) {
  try { await AsyncStorage.setItem(ENABLED_KEY, flag ? 'true' : 'false'); } catch {}
}

// ── Cancel all pending reminders ──────────────────────────────────────────────
export async function cancelAllReminders() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {}
}

// ── Schedule today's class reminders ─────────────────────────────────────────
/**
 * Fetches the teacher's full-week timetable, filters for today's day-of-week,
 * and schedules one local notification per upcoming period.
 *
 * JS getDay() → 0=Sun, 1=Mon … 6=Sat
 * Backend day_of_week → 1=Mon … 6=Sat  (no Sunday slot = no match for 0)
 *
 * @param {object} user      — AuthContext user object (must have staffId)
 * @param {number} leadMins  — minutes before period start to fire notification
 * @returns {number}         — count of notifications scheduled
 */
export async function scheduleClassReminders(user, leadMins = DEFAULT_LEAD) {
  try {
    const staffId = user?.staffId;
    if (!staffId) return 0; // user has no linked staff record

    const enabled = await getEnabled();
    if (!enabled) return 0;

    const granted = await requestPermissions();
    if (!granted) return 0;

    // Fetch the teacher's complete weekly timetable
    const slots = await fetchTeacherTimetable(user, { staffId: String(staffId) });
    if (!Array.isArray(slots) || !slots.length) return 0;

    // Today's day_of_week in backend numbering (1=Mon … 6=Sat; 0=Sun → no match)
    const backendToday = new Date().getDay(); // 0=Sun,1=Mon,…,6=Sat

    const todaySlots = slots.filter(
      s => Number(s.day_of_week) === backendToday
    );
    if (!todaySlots.length) return 0; // no classes today

    // Cancel existing reminders before scheduling fresh ones
    await cancelAllReminders();

    const now   = Date.now();
    let   count = 0;

    for (const slot of todaySlots) {
      const [hhStr, mmStr] = (slot.start_time ?? '').split(':');
      const hh = parseInt(hhStr, 10);
      const mm = parseInt(mmStr, 10);
      if (isNaN(hh) || isNaN(mm)) continue;

      // Build the exact fire time for today
      const periodDate = new Date();
      periodDate.setHours(hh, mm, 0, 0);

      const fireDate = new Date(periodDate.getTime() - leadMins * 60_000);
      if (fireDate.getTime() <= now) continue; // missed — period already started

      const subject = slot.subject_name  ?? 'Class';
      const cls     = slot.class_name    ?? '';
      const sec     = slot.section_name  ?? '';
      const period  = slot.period_name   ?? `Period ${slot.period_number ?? ''}`;
      const clsStr  = [cls, sec].filter(Boolean).join(' – ');

      await Notifications.scheduleNotificationAsync({
        content: {
          title: `📚 ${subject} in ${leadMins} min`,
          body:  `${period}${clsStr ? ' · ' + clsStr : ''} starts at ${slot.start_time}`,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireDate,
        },
      });
      count++;
    }

    return count;
  } catch (e) {
    console.log('[NotificationService] scheduleClassReminders error:', e.message);
    return 0;
  }
}
