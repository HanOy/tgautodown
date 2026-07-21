import { Api } from 'telegram/tl/index.js';
import { log } from '../logger/index.js';

function classify(entity) {
  if (!entity) return null;
  if (entity.className === 'Channel') return 'channel';
  if (entity.className === 'Chat')    return 'group';
  if (entity.className === 'User')    return 'user';
  return null;
}

export async function resolveChannel(client, name) {
  if (name.startsWith('+')) {
    const hash = name.slice(1);
    try {
      const res = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
      if (res.className === 'ChatInviteAlready') {
        const chat = res.chat;
        const kind = classify(chat);
        log.info('private channel resolved', { name, id: chat.id, kind, title: chat.title });
        return { entity: chat, kind, id: chat.id, title: chat.title, name };
      }
      log.warn('not joined yet', { name });
      return null;
    } catch (e) {
      log.warn(e, 'check invite fail', { name });
      return null;
    }
  }
  try {
    const res = await client.invoke(new Api.contacts.ResolveUsername({ username: name }));
    // For bots/users the entity lives in res.users[0]; for channels/groups it's res.chats[0].
    const entity = res.chats?.[0] ?? res.users?.[0];
    if (!entity) {
      log.warn('resolve empty', { name });
      return null;
    }
    const kind = classify(entity);
    if (!kind) {
      log.warn('unknown entity class', { name, cls: entity.className });
      return null;
    }
    const title = kind === 'user'
      ? [entity.firstName, entity.lastName].filter(Boolean).join(' ') || entity.username || String(entity.id)
      : entity.title;
    log.info('resolved', { name, id: entity.id, kind, title });
    return { entity, kind, id: entity.id, title, name };
  } catch (e) {
    log.warn(e, 'resolve fail', { name });
    return null;
  }
}

export async function resolveAll(client, names) {
  const out = [];
  for (const n of names) {
    const r = await resolveChannel(client, n);
    if (r && r.kind !== 'user') out.push(r);   // listeners only care about channels/groups
  }
  return out;
}