/**
 * services/ChatServiceApi.js
 * All API calls for the in-app chat feature.
 *
 * Routes to add in CakePHP routes.php (inside your JWT-protected scope):
 *   $builder->get('/ChatApi/getUsers',        ['controller'=>'ChatApi','action'=>'getUsers']);
 *   $builder->post('/ChatApi/heartbeat',       ['controller'=>'ChatApi','action'=>'heartbeat']);
 *   $builder->get('/ChatApi/getConversations', ['controller'=>'ChatApi','action'=>'getConversations']);
 *   $builder->get('/ChatApi/getMessages',      ['controller'=>'ChatApi','action'=>'getMessages']);
 *   $builder->post('/ChatApi/sendMessage',     ['controller'=>'ChatApi','action'=>'sendMessage']);
 */
import { BASE_URL } from '../Environment/EnvironmentConfig';
import { safeFetch } from './apiInterceptor';

const buildHeaders = (user) => ({
  Accept:           'application/json',
  'Content-Type':   'application/json',
  ssmsUserName:     user?.ssmsUserName   ?? user?.username   ?? '',
  ssmsUserRole:     user?.ssmsUserRole   ?? user?.role       ?? '',
  ssmsClientCode:   user?.ssmsClientCode ?? user?.clientCode ?? '',
  ssmsEnrollmentId: user?.enrollmentId   ?? '',
  branchId:         user?.branchId       ?? '',
  Authorization:    user?.token ? `Bearer ${user.token}` : '',
});

// ── GET /ChatApi/getUsers ─────────────────────────────────────────────────────
// Returns all users for the same school with online status + unread count.
export async function fetchChatUsers(user) {
  const res  = await safeFetch(`${BASE_URL}/ChatApi/getUsers`, {
    method:  'GET',
    headers: buildHeaders(user),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false)
    throw new Error(data.message || 'Failed to load users');
  return data.users ?? [];
}

// ── POST /ChatApi/heartbeat ───────────────────────────────────────────────────
// Should be called every ~30 s while the app is in foreground.
// Returns { total_unread: N }
export async function sendHeartbeat(user, pushToken = null) {
  try {
    const body = pushToken ? { push_token: pushToken } : {};
    const res  = await safeFetch(`${BASE_URL}/ChatApi/heartbeat`, {
      method:  'POST',
      headers: buildHeaders(user),
      body:    JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return data.total_unread ?? 0;
  } catch {
    return 0; // fail silently — heartbeat is best-effort
  }
}

// ── GET /ChatApi/getConversations ─────────────────────────────────────────────
// Returns all conversations the user is part of, newest first.
export async function fetchConversations(user) {
  const res  = await safeFetch(`${BASE_URL}/ChatApi/getConversations`, {
    method:  'GET',
    headers: buildHeaders(user),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false)
    throw new Error(data.message || 'Failed to load conversations');
  return data.conversations ?? [];
}

// ── GET /ChatApi/getMessages ──────────────────────────────────────────────────
// otherUsername : the person you're chatting with
// since         : ISO timestamp — only fetch messages newer than this (for polling)
//                 pass null / '' to get the last `limit` messages
export async function fetchMessages(user, otherUsername, since = null, limit = 50) {
  const params = new URLSearchParams({ with: otherUsername, limit: String(limit) });
  if (since) params.set('since', since);

  const res  = await safeFetch(`${BASE_URL}/ChatApi/getMessages?${params.toString()}`, {
    method:  'GET',
    headers: buildHeaders(user),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false)
    throw new Error(data.message || 'Failed to load messages');
  return {
    conversationId: data.conversation_id,
    messages:       data.messages ?? [],
  };
}

// ── POST /ChatApi/sendMessage ─────────────────────────────────────────────────
export async function sendChatMessage(user, toUsername, body) {
  const res  = await safeFetch(`${BASE_URL}/ChatApi/sendMessage`, {
    method:  'POST',
    headers: buildHeaders(user),
    body:    JSON.stringify({ to: toUsername, body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false)
    throw new Error(data.message || 'Failed to send message');
  return data; // { message_id, conversation_id }
}
