/**
 * The agent's configuration: what it says, what it must establish, and the
 * tools it calls to record what it established.
 *
 * The design turns on one thing. A worker who says "haan" has not necessarily
 * understood anything — reflexive agreement to an authority voice on a phone is
 * the default behaviour, not the exception, and it is exactly what a naive
 * confirmation flow would record as a successful warning. A compliance record
 * full of yeses that meant nothing is worse than no record, because it reads as
 * evidence that the employer acted.
 *
 * So the agent never asks a question that "yes" can answer. It asks what the
 * worker is going to do, and the answer either demonstrates comprehension or
 * does not. The tools record the worker's own words as evidence alongside the
 * judgement, so a reviewer can check the call rather than trust it.
 *
 * That is the same principle as verifying a quote against its source: the model
 * decides, and the evidence for the decision travels with it.
 */

/** The three facts a call has to establish, in the order they matter. */
export const FACTS = ['understood', 'stopped_work', 'has_water_and_shade'];

export const TOOLS = [
  {
    type: 'function',
    name: 'record_understanding',
    description:
      'Record whether the worker demonstrated they understood the warning. Only ' +
      'set established to true if they said something showing comprehension, such ' +
      'as repeating back what they will do. A bare "yes", "haan", "ok" or silence ' +
      'is NOT understanding.',
    parameters: {
      type: 'object',
      properties: {
        established: {
          type: 'boolean',
          description: 'True only if the worker demonstrated comprehension in their own words.',
        },
        evidence: {
          type: 'string',
          description: 'What the worker actually said, in their own words, verbatim.',
        },
      },
      required: ['established', 'evidence'],
    },
  },
  {
    type: 'function',
    name: 'record_work_stopped',
    description:
      'Record whether the worker has stopped or is stopping outdoor work. If they ' +
      'say they cannot stop, set established to false and capture the reason — that ' +
      'is the most important thing this call can learn.',
    parameters: {
      type: 'object',
      properties: {
        established: { type: 'boolean' },
        evidence: { type: 'string', description: 'The worker\'s own words.' },
        blocker: {
          type: 'string',
          description:
            'If they cannot stop, why. Paid per delivery, supervisor said no, ' +
            'no shade available, and so on. Empty if they stopped.',
        },
      },
      required: ['established', 'evidence'],
    },
  },
  {
    type: 'function',
    name: 'record_water_and_shade',
    description: 'Record whether the worker has drinking water and somewhere shaded to rest.',
    parameters: {
      type: 'object',
      properties: {
        has_water: { type: 'boolean' },
        has_shade: { type: 'boolean' },
        evidence: { type: 'string' },
      },
      required: ['has_water', 'has_shade', 'evidence'],
    },
  },
  {
    type: 'function',
    name: 'report_distress',
    description:
      'Call this IMMEDIATELY, before anything else, if the worker describes ' +
      'symptoms of heat illness: dizziness, nausea, headache, confusion, cramps, ' +
      'having stopped sweating, or if they sound confused or cannot answer simple ' +
      'questions. Stop the script and call this. It escalates to a human.',
    parameters: {
      type: 'object',
      properties: {
        symptoms: { type: 'string', description: 'What they described, verbatim.' },
        severity: { type: 'string', enum: ['concerning', 'urgent'] },
      },
      required: ['symptoms', 'severity'],
    },
  },
];

/**
 * Per-language greeting and instructions.
 *
 * Urdu is absent on purpose. AssemblyAI's streaming models cover 18 languages
 * and Urdu is not among them, but Hindi is — and spoken Urdu and Hindi are the
 * same language, diverging in script and formal register rather than in
 * "I stopped, I have water". Using the Hindi model for Urdu speakers is an
 * approximation, it is documented as one, and it needs testing against real
 * Karachi speech before anyone relies on it.
 */
export const LANGUAGES = {
  en: {
    label: 'English',
    greeting: (name, employer) =>
      `Hello ${name}. This is an automated safety call on behalf of ${employer}. ` +
      `It is dangerously hot at your site right now. Can you hear me clearly?`,
  },
  hi: {
    label: 'Hindi (also used for Urdu speakers)',
    greeting: (name, employer) =>
      `Namaste ${name}. Yeh ${employer} ki taraf se ek safety call hai. ` +
      `Abhi aapke site par garmi khatarnaak hai. Kya aap meri awaaz saaf sun rahe hain?`,
  },
  ar: {
    label: 'Arabic',
    greeting: (name, employer) =>
      `Marhaban ${name}. This is an automated safety call from ${employer}. ` +
      `The heat at your site is dangerous right now. Can you hear me clearly?`,
  },
};

/**
 * Build the system prompt for one call.
 *
 * Deliberately short. A long prompt on a phone call to someone who may be
 * exhausted produces a long agent, and every extra second is a second the
 * worker is still standing in the sun.
 */
export function systemPrompt({ workerName, employerName, wbgtC, limitC, language = 'en' }) {
  const lang = LANGUAGES[language] ?? LANGUAGES.en;

  return [
    `You are making a short safety phone call on behalf of ${employerName}.`,
    `You are speaking to ${workerName}, who works outdoors.`,
    `The heat stress index at their site is ${wbgtC}, above their safe limit of ${limitC}.`,
    '',
    `Speak ${lang.label}. Be brief. This whole call should take under ninety seconds.`,
    '',
    'Your job is to establish three things, in this order:',
    '1. That they understood the warning.',
    '2. That they have stopped, or are stopping, outdoor work.',
    '3. That they have drinking water and shade.',
    '',
    'Never ask a question that can be answered with yes or no.',
    'Ask what they are going to do. Ask where they are going to sit.',
    'A worker who says only "yes" or "haan" has not understood anything, and you',
    'must not record understanding on that basis. Ask again, differently.',
    '',
    'If at any point they describe dizziness, nausea, headache, confusion, cramps,',
    'or say they have stopped sweating, call report_distress immediately and stop',
    'the script. Tell them to sit in shade and that someone is being called now.',
    '',
    'If they say they cannot stop working, do not argue and do not repeat yourself.',
    'Record why. That reason is the most useful thing this call can produce.',
    '',
    'Call the record tools as you establish each fact. Do not wait until the end.',
    'End the call once all three are recorded or the worker cannot continue.',
  ].join('\n');
}

/**
 * The full `session.update` payload for an inline agent.
 *
 * Inline rather than a stored agent_id: every call carries a different worker,
 * employer, temperature and language, and a stored agent would need updating
 * per call anyway.
 */
export function sessionConfig(call) {
  const lang = LANGUAGES[call.language] ?? LANGUAGES.en;
  return {
    type: 'session.update',
    session: {
      system_prompt: systemPrompt(call),
      greeting: lang.greeting(call.workerName, call.employerName),
      tools: TOOLS,
    },
  };
}
