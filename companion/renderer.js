const byId = id => document.getElementById(id);
let initialized = false, lastRoot, lastAccounts = '', busy = false;
function render(state) {
  const rootChanged = lastRoot !== state.root;
  byId('game-path').textContent = state.root || 'Choose your World of Warcraft folder.';
  const signature = JSON.stringify(state.accounts);
  if (rootChanged || lastAccounts !== signature) {
    const selected = rootChanged ? state.account : byId('account').value || state.account;
    byId('account').replaceChildren();
    if (!state.accounts.length) byId('account').add(new Option('Log in to WoW once, then check again', ''));
    else {
      if (state.accounts.length > 1) byId('account').add(new Option('Choose the account you want to share', ''));
      for (const account of state.accounts) byId('account').add(new Option(account, account));
      if (state.accounts.includes(selected)) byId('account').value = selected;
    }
  }
  lastRoot = state.root; lastAccounts = signature;
  if (!initialized) { byId('startup').checked = state.openAtLogin; initialized = true; }
  byId('connection').textContent = state.connected ? `Linked${state.server ? ` to ${state.server}` : ''} · ${state.endpointHost}` : 'Not linked yet';
  byId('status-title').textContent = state.needsRelink ? 'Reconnect Discord' : state.paused ? 'Uploads paused' : state.configured ? 'Automatic sync enabled' : 'Let’s get connected';
  byId('dot').className = `dot ${state.needsRelink || state.paused ? 'warn' : state.configured ? 'ready' : ''}`;
  byId('status-message').textContent = state.message;
  byId('last-sync').textContent = state.lastSyncedAt ? `Last uploaded ${new Date(state.lastSyncedAt).toLocaleString()} · ${state.characters} character file(s)` : '';
  byId('start').textContent = state.configured ? 'Save settings & resume syncing' : 'Install addon & start syncing';
  byId('start').disabled = busy || !state.connected || !state.root || !state.accounts.length;
  byId('controls').hidden = !state.configured;
  byId('pause').textContent = state.paused ? 'Resume uploads' : 'Pause uploads';
  byId('startup-warning').textContent = state.startupWarning;
  byId('startup-warning').hidden = !state.startupWarning;
}
async function act(action) {
  if (busy) return;
  busy = true; byId('error').hidden = true;
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try {
    const result = await action();
    if (result.error) { byId('error').textContent = result.error; byId('error').hidden = false; }
    if (result.state) render(result.state);
  } catch { byId('error').textContent = 'Could not complete this step. Please try again.'; byId('error').hidden = false; }
  finally {
    busy = false;
    for (const button of document.querySelectorAll('button')) button.disabled = false;
    const result = await window.tome.state(); if (result.state) render(result.state);
  }
}
byId('folder').onclick = () => act(() => window.tome.folder());
byId('connect').onclick = () => act(() => window.tome.connect());
byId('start').onclick = () => act(() => window.tome.start({ account: byId('account').value, openAtLogin: byId('startup').checked }));
byId('pause').onclick = () => act(() => window.tome.pause());
byId('disconnect').onclick = () => act(async () => { const result = await window.tome.disconnect(); if (!result.error) byId('disconnect-help').hidden = false; return result; });
async function refresh() { if (!busy) { try { const result = await window.tome.state(); if (result.state) render(result.state); } catch { /* Next refresh retries. */ } } }
void refresh(); setInterval(refresh, 2000);
