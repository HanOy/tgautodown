import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock the logger so tests don't print noise.
import { Module } from 'node:module';
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
const noopLogger = {
  setLevel: () => {},
  trace: () => {}, debug: () => {}, info: () => {},
  warn: () => {}, error: () => {}, fatal: () => {},
  rid: () => noopLogger,
};
// Easier: stub the logger module via a single `import.meta.resolve` interception.
// We just dynamically replace the export after import.

const { resolveChannel, resolveAll } = await import('../src/tg/channel.js');

// Replace logger inside channel.js — module was already evaluated, so we
// can't intercept. Instead, silence by overriding console? Tests are quiet enough.
process.env.TG_LOG_LEVEL = 'fatal';

function mockClient(handlers) {
  return {
    invoke: async (req) => {
      const k = req?.className;
      const h = handlers[k];
      if (!h) throw new Error(`unmocked invoke: ${k}`);
      return h(req);
    },
  };
}

test('resolveChannel: private invite (joined) returns channel entity', async () => {
  const fakeEntity = { className: 'Channel', id: 999n, title: 'Private Chan', accessHash: 1n };
  const client = mockClient({
    'messages.CheckChatInvite': () => ({
      className: 'ChatInviteAlready',
      chat: fakeEntity,
    }),
  });

  const r = await resolveChannel(client, '+abc123');
  assert.equal(r.kind, 'channel');
  assert.equal(r.id, 999n);
  assert.equal(r.title, 'Private Chan');
  assert.equal(r.name, '+abc123');
  assert.strictEqual(r.entity, fakeEntity);
});

test('resolveChannel: private invite (not joined) returns null', async () => {
  const client = mockClient({
    'messages.CheckChatInvite': () => ({ className: 'ChatInvite' }),
  });
  const r = await resolveChannel(client, '+notjoined');
  assert.equal(r, null);
});

test('resolveChannel: private invite CheckChatInvite throws returns null', async () => {
  const client = mockClient({
    'messages.CheckChatInvite': () => { throw new Error('HASH_INVALID'); },
  });
  const r = await resolveChannel(client, '+expired');
  assert.equal(r, null);
});

test('resolveChannel: public channel', async () => {
  const fakeChannel = { className: 'Channel', id: 11111n, title: 'Public', username: 'public' };
  const client = mockClient({
    'contacts.ResolveUsername': () => ({ chats: [fakeChannel], users: [] }),
  });
  const r = await resolveChannel(client, 'public');
  assert.equal(r.kind, 'channel');
  assert.equal(r.title, 'Public');
});

test('resolveChannel: public group', async () => {
  const fakeChat = { className: 'Chat', id: 22222n, title: 'Group' };
  const client = mockClient({
    'contacts.ResolveUsername': () => ({ chats: [fakeChat], users: [] }),
  });
  const r = await resolveChannel(client, 'somegroup');
  assert.equal(r.kind, 'group');
  assert.equal(r.title, 'Group');
});

test('resolveChannel: bot (user entity from users[])', async () => {
  const fakeUser = { className: 'User', id: 33333n, firstName: 'Bot', lastName: '', username: 'botty' };
  const client = mockClient({
    'contacts.ResolveUsername': () => ({ chats: [], users: [fakeUser] }),
  });
  const r = await resolveChannel(client, 'botty');
  assert.equal(r.kind, 'user');
  assert.equal(r.title, 'Bot');
  assert.strictEqual(r.entity, fakeUser);
});

test('resolveChannel: bot title falls back to username / id', async () => {
  const fakeUser = { className: 'User', id: 44444n, firstName: '', lastName: '', username: null };
  const client = mockClient({
    'contacts.ResolveUsername': () => ({ chats: [], users: [fakeUser] }),
  });
  const r = await resolveChannel(client, 'noname');
  assert.equal(r.kind, 'user');
  assert.equal(r.title, '44444');
});

test('resolveChannel: ResolveUsername throws returns null', async () => {
  const client = mockClient({
    'contacts.ResolveUsername': () => { throw new Error('USERNAME_NOT_OCCUPIED'); },
  });
  const r = await resolveChannel(client, 'doesnotexist');
  assert.equal(r, null);
});

test('resolveChannel: ResolveUsername returns empty returns null', async () => {
  const client = mockClient({
    'contacts.ResolveUsername': () => ({ chats: [], users: [] }),
  });
  const r = await resolveChannel(client, 'whatever');
  assert.equal(r, null);
});

test('resolveAll: collects channels and groups, skips users', async () => {
  const fakeChan = { className: 'Channel', id: 1n, title: 'C' };
  const fakeBot = { className: 'User', id: 2n, firstName: 'B', lastName: '', username: 'b' };
  const client = mockClient({
    'messages.CheckChatInvite': () => ({ className: 'ChatInviteAlready', chat: fakeBot }),
    'contacts.ResolveUsername': () => ({ chats: [fakeChan], users: [] }),
  });
  const list = await resolveAll(client, ['+botinvite', 'public']);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'channel');
});

test('resolveAll: gracefully skips unresolvable entries', async () => {
  const fakeChan = { className: 'Channel', id: 1n, title: 'C' };
  const client = mockClient({
    'contacts.ResolveUsername': (req) => {
      if (req.username === 'public') return { chats: [fakeChan], users: [] };
      throw new Error('not found');
    },
  });
  const list = await resolveAll(client, ['public', 'missing']);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 1n);
});