/**
 * Serves the agent's configuration to the browser.
 *
 * The page used to carry its own copy of the system prompt inline. Two copies
 * of a prompt is two prompts, and the one that gets improved is never the one
 * that runs. This endpoint makes src/agent.mjs the only place the words live.
 */
import { systemPrompt, LANGUAGES, TOOLS } from '../src/agent.mjs';

export default function handler(req, res) {
  const language = (req.query?.language ?? 'en');
  const lang = LANGUAGES[language] ? language : 'en';

  // Demo values. A real call gets these from the alert that triggered it.
  const call = {
    workerName: 'Imran',
    employerName: 'Al-Habib Construction',
    wbgtC: 31.4,
    limitC: 26.0,
    language: lang,
  };

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    system_prompt: systemPrompt(call),
    greeting: LANGUAGES[lang].greeting(call.workerName, call.employerName),
    tools: TOOLS,
  });
}
