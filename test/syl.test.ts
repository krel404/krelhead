import test from 'node:test';
import assert from 'node:assert/strict';
import type { Response } from 'openai/resources/responses/responses';
import { Syl, citedText, type ModelClient } from '../src/syl.js';
import { Wowhead } from '../src/wowhead.js';

const context = { history: [], facts: [], members: async () => ({ members: [] }) };
function result(text: string, output: unknown[] = []): Response { return { output_text: text, output } as Response; }
function call(name: string, args: unknown) { return { type: 'function_call', call_id: 'call-1', name, arguments: JSON.stringify(args) }; }
function client(handler: (request: any, options: any) => Response | Promise<Response>): ModelClient {
  return { responses: { create: handler } } as unknown as ModelClient;
}

test('Astra configurations are rejected before any model request, including dated variants', () => {
  let requests = 0;
  const api = client(() => { requests++; return result('Unexpected request'); });
  for (const model of ['gpt-6-astra', 'gpt-6-astra-2026-09-01', 'GPT-6-ASTRA']) {
    assert.throws(() => new Syl(api, new Wowhead(), model), /Astra models are disabled/);
    assert.throws(() => new Syl(api, new Wowhead(), 'gpt-6-luna', model), /Astra models are disabled/);
  }
  assert.equal(new Syl(api, new Wowhead()).model, 'gpt-6-luna');
  assert.equal(new Syl(api, new Wowhead()).researchModel, 'gpt-6.1-sol');
  assert.equal(requests, 0);
});

test('Syl executes validated lookup tools, replays tool results and returns the real card', async () => {
  let calls = 0;
  let lookedUp = 0;
  const source = { tooltip: async (ref: unknown) => { lookedUp++; assert.deepEqual(ref, { type: 'spell', id: 116 });
    return { type: 'spell', id: 116, name: 'Frostbolt', html: '<b>Frostbolt</b><br>Rank 1' }; } } as unknown as Wowhead;
  const syl = new Syl(client(request => {
    assert.equal(request.store, false);
    assert.equal(request.model, 'gpt-6-luna');
    if (++calls === 1) return result('', [call('get_tooltip', { type: 'spell', id: 116, display: true })]);
    assert.match(request.input.at(-1).output, /Rank 1/);
    return result('Frostbolt, rank 1.');
  }), source);
  const answer = await syl.answer('What is Frostbolt?', context);
  assert.equal(answer.tooltip?.id, 116); assert.equal(lookedUp, 1); assert.equal(calls, 2);
});

test('invalid tool references do not reach the source and tool loops have a hard stop', async () => {
  let calls = 0;
  const syl = new Syl(client(request => {
    calls++;
    if (calls > 1) assert.match(request.input.at(-1).output, /Invalid tooltip reference/);
    if (request.tool_choice === 'none') return result('I could not verify that spell.');
    return result('', [call('get_tooltip', { type: 'spell', id: -1, display: true })]);
  }), { tooltip: () => { throw new Error('Should not reach source'); } } as unknown as Wowhead);
  const answer = await syl.answer('lookup', context);
  assert.equal(calls, 6); assert.equal(answer.tooltip, undefined);
});

test('research uses Sol without private context; Luna handles routing and final formatting', async () => {
  let mainCalls = 0;
  let researchCalls = 0;
  const syl = new Syl(client(request => {
    if (request.tools[0].type === 'web_search') {
      researchCalls++;
      assert.equal(request.model, 'gpt-6.1-sol');
      assert.equal(request.store, false);
      assert.equal(request.input, 'WoW Forever rogue level 25 gear');
      assert.deepEqual(request.tools[0].filters.allowed_domains, ['wowhead.com', 'icy-veins.com']);
      assert(!JSON.stringify(request).includes('private guild fact'));
      return result('Some evidence.', [{ type: 'message', content: [{ type: 'output_text', text: 'Some evidence.', annotations: [
        { type: 'url_citation', url: 'https://www.wowhead.com/forever', title: 'Wowhead', start_index: 0, end_index: 4 },
      ] }] }]);
    }
    assert.equal(request.model, 'gpt-6-luna');
    if (++mainCalls === 1) return result('', [call('research', { question: 'WoW Forever rogue level 25 gear', scope: 'preferred' })]);
    assert.match(request.input.at(-1).output, /https:\/\/www.wowhead.com\/forever/);
    return result('Here is sourced guidance.');
  }), new Wowhead());
  await syl.answer('Help with gear', { ...context, facts: [{ id: 'a', fact: 'private guild fact', created: 'now' }] });
  assert.equal(researchCalls, 1);
});

test('research cannot exceed two calls per answer', async () => {
  let research = 0;
  let main = 0;
  const syl = new Syl(client(request => {
    if (request.tools[0].type === 'web_search') { research++; return result('No verified evidence.'); }
    if (++main < 4) return result('', [call('research', { question: 'Forever gear', scope: 'preferred' })]);
    assert.match(request.input.at(-1).output, /Research budget reached/);
    return result('Evidence is incomplete.');
  }), new Wowhead());
  await syl.answer('gear', context);
  assert.equal(research, 2);
});

test('citation conversion rejects non-web URLs and replaces API citation markers', () => {
  const response = result('Claim citeturn1search0', [{ type: 'message', content: [{ type: 'output_text', annotations: [
    { type: 'url_citation', url: 'javascript:alert(1)', title: 'bad' },
    { type: 'url_citation', url: 'https://www.icy-veins.com/wow-forever/', title: 'Icy Veins' },
  ] }] }]);
  assert(!citedText(response).includes('javascript:'));
  assert(!citedText(response).includes(''));
  assert.match(citedText(response), /\[Icy Veins\]/);
});

test('a slow second search leaves 35 seconds to answer using the first search', async t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  let main = 0;
  let research = 0;
  const evidence = 'Verified item: [Wowhead](https://www.wowhead.com/forever/item=123).';
  const syl = new Syl(client((request, options) => {
    assert.equal(options.maxRetries, 0);
    if (request.tools[0].type === 'web_search') {
      if (++research === 1) { now = 70_000; return result(evidence); }
      assert.equal(options.timeout, 15_000);
      now = 85_000;
      throw Object.assign(new Error('Simulated slow search'), { name: 'APIConnectionTimeoutError' });
    }
    if (++main <= 2) return result('', [call('research', { question: 'Forever gear', scope: main === 1 ? 'preferred' : 'broad' })]);
    assert.equal(request.tool_choice, 'none');
    assert.equal(options.timeout, 35_000);
    assert(request.input.some((item: any) => item.output?.includes(evidence)));
    return result(evidence + ' Other sources could not be checked.');
  }), new Wowhead());
  const answer = await syl.answer('gear', context);
  assert.match(answer.text, /Verified item/);
  assert.equal(main, 3); assert.equal(research, 2);
});

test('research cannot start after the final-answer reserve begins', async t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  let main = 0;
  const syl = new Syl(client(request => {
    assert.notEqual(request.tools[0].type, 'web_search');
    if (++main === 1) {
      now = 86_000;
      return result('', [call('research', { question: 'Forever gear', scope: 'preferred' })]);
    }
    assert.equal(request.tool_choice, 'none');
    assert.match(request.input.at(-1).output, /Research time is up/);
    return result('I could not verify the gear.');
  }), new Wowhead());
  await syl.answer('gear', context);
  assert.equal(main, 2);
});

test('failed final formatting preserves sourced findings without extra requests', async () => {
  let main = 0;
  const syl = new Syl(client(request => {
    if (request.tools[0].type === 'web_search') return result('Evidence [Wowhead](https://www.wowhead.com/forever).');
    if (++main === 1) return result('', [call('research', { question: 'Forever gear', scope: 'preferred' })]);
    throw new Error('Provider timeout');
  }), new Wowhead());
  const answer = await syl.answer('gear', context);
  assert.match(answer.text, /Partial findings/);
  assert.match(answer.text, /https:\/\/www.wowhead.com\/forever/);
  assert.equal(main, 2);
});

test('slow routing cannot consume the time reserved for a tool-free final answer', async t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  let main = 0;
  const syl = new Syl(client((request, options) => {
    if (request.tools[0].type === 'web_search') { now = 60_000; return result('Sourced findings.'); }
    if (++main === 1) return result('', [call('research', { question: 'Forever gear', scope: 'preferred' })]);
    if (main === 2) {
      assert.equal(options.timeout, 25_000);
      now = 85_000;
      throw new Error('Routing timed out');
    }
    assert.equal(request.tool_choice, 'none');
    assert.equal(options.timeout, 35_000);
    return result('Answer from existing evidence.');
  }), new Wowhead());
  const answer = await syl.answer('gear', context);
  assert.equal(answer.text, 'Answer from existing evidence.');
  assert.equal(main, 3);
});

test('a total timeout during follow-up research still returns earlier findings', async () => {
  const controller = new AbortController();
  let research = 0;
  const syl = new Syl(client(request => {
    if (request.tools[0].type === 'web_search') {
      if (++research === 1) return result('First findings [Wowhead](https://www.wowhead.com/forever).');
      controller.abort();
      throw new Error('Aborted');
    }
    return result('', [call('research', { question: 'Forever gear', scope: research ? 'broad' : 'preferred' })]);
  }), new Wowhead());
  const answer = await syl.answer('gear', context, controller.signal);
  assert.match(answer.text, /Partial findings/);
  assert.match(answer.text, /First findings/);
});

test('a failed first research call forces a final answer without retrying research', async () => {
  let main = 0;
  let research = 0;
  const syl = new Syl(client(request => {
    if (request.tools[0].type === 'web_search') { research++; throw new Error('Timeout'); }
    if (++main === 1) return result('', [call('research', { question: 'Forever gear', scope: 'preferred' })]);
    assert.equal(request.tool_choice, 'none');
    return result('I could not verify current gear sources.');
  }), new Wowhead());
  const answer = await syl.answer('gear', context);
  assert.match(answer.text, /could not verify/);
  assert.equal(main, 2); assert.equal(research, 1);
});
