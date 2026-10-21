// UI strings. English only for now; add another table + a language picker later if needed.
(() => {
  'use strict';
  const CR = (globalThis.CR ??= {});

  const en = {
    'palette.placeholder': 'Search all your chats…  "exact phrase"  -exclude  from:me  since:7d',
    'scope.all': 'All chats',
    'scope.project': 'This project',
    'scope.chat': 'This chat',
    'scope.project.disabled': 'Open a project or a chat that belongs to a project to use this',
    'scope.chat.disabled': 'Open a chat to use this',
    'sender.any': 'Anyone',
    'sender.me': 'Me',
    'sender.claude': 'Claude',
    'results.none': 'No matches.',
    'results.hint': 'Type to search. Tips: "exact phrase", -word to exclude, from:me, since:2025-01-01, until:30d.',
    'results.recent': 'Recent chats',
    'results.matches': '{n} matching message(s)',
    'results.you': 'You',
    'results.claude': 'Claude',
    'results.inChatHit': 'Message {n}',
    'action.copy': 'Copy link',
    'action.copied': 'Copied',
    'action.sync': 'Sync now',
    'status.ready': '{n} chats searchable',
    'status.lastSync': 'last sync {when}',
    'status.indexing': 'Indexing {done}/{total}…',
    'status.listing': 'Reading your chat list…',
    'status.empty': 'Nothing indexed yet. Indexing starts automatically; results appear as it goes.',
    'status.auth': 'Not signed in to claude.ai (or the session expired). Sign in and press Sync.',
    'status.error': 'Sync finished with {errors} error(s). Press Sync to retry.',
    'status.noProject': 'Project info was not available for these chats, so the project filter may be empty.',
    'hints.nav': '↑↓ move',
    'hints.open': '↵ open',
    'hints.newTab': 'Ctrl/⌘+↵ new tab',
    'hints.close': 'Esc close',
    'time.justNow': 'just now',
    'time.minutes': '{n} min ago',
    'time.hours': '{n} h ago',
    'time.days': '{n} d ago',
    'time.never': 'never',
    'untitled': 'Untitled chat'
  };

  const tables = { en };

  CR.t = (key, vars) => {
    let s = tables.en[key] ?? key;
    if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
    return s;
  };

  if (typeof module !== 'undefined') module.exports = CR;
})();
