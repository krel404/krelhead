import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

// Exercise the actual preload, renderer and main-process IPC without a player connection or OS startup changes.
app.setPath('userData', mkdtempSync(join(tmpdir(), 'tome-ui-test-')));
void import('./main.mjs').then(async ({ ready }) => {
  await ready;
  const window = BrowserWindow.getAllWindows()[0];
  assert(window);
  if (window.webContents.isLoading()) await once(window.webContents, 'did-finish-load');
  const result = await window.webContents.executeJavaScript(`(async () => {
    const response = await window.tome.state();
    render(response.state);
    return { title: document.title, heading: document.querySelector('h1').textContent,
      hasNode: typeof window.require !== 'undefined', connected: response.state.connected,
      button: document.getElementById('start').textContent, disabled: document.getElementById('start').disabled,
      tokenExposed: JSON.stringify(response).includes('"token"') };
  })()`);
  assert.equal(result.title, 'Tome Companion');
  assert.equal(result.heading, 'Tome Companion');
  assert.equal(result.hasNode, false); assert.equal(result.connected, false); assert.equal(result.tokenExposed, false);
  assert.match(result.button, /Install addon/);
  assert.equal(result.disabled, true);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await writeFile('/tmp/tome-companion-preview.png', (await window.webContents.capturePage()).toPNG());
  console.log('Companion UI smoke passed: actual renderer, sandboxed preload and main-process IPC.');
  app.quit();
}).catch(error => {
  console.error(error); app.exit(1);
});
