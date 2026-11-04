import OpenAI from 'openai';
import { Syl, defaultModel, defaultResearchModel } from '../src/syl.js';
import { Wowhead } from '../src/wowhead.js';

const syl = new Syl(new OpenAI({ timeout: 60_000, maxRetries: 0 }), new Wowhead(),
  process.env.OPENAI_MODEL?.trim() || defaultModel, process.env.OPENAI_RESEARCH_MODEL?.trim() || defaultResearchModel);
const question = process.argv.includes('--research')
  ? 'What is rogue BiS at level 25 in WoW Forever? Research current sources and give a concise sourced shortlist for Horde PvP. State any coverage limits.'
  : 'What is Frostbolt? Show me the rank 1 spell tooltip.';
try {
  const result = await syl.answer(question, { history: [], facts: [], guildDefaults: { faction: 'Horde', focus: 'PvP' },
    members: async () => ({ error: 'Not connected in this smoke test.' }) });
  console.log(JSON.stringify({ text: result.text, tooltip: result.tooltip ? { name: result.tooltip.name, id: result.tooltip.id, type: result.tooltip.type } : null }, null, 2));
  if (!process.argv.includes('--research') && !result.tooltip) throw new Error('Expected a real tooltip.');
  if (process.argv.includes('--research') && !/https:\/\//.test(result.text)) throw new Error('Expected sourced research.');
} catch (error) {
  console.error('Syl smoke failed:', error instanceof OpenAI.APIError ? { status: error.status, code: error.code, type: error.type } : error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
}
