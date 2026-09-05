/**
 * The five ways a heat warning call actually ends, checked without a key,
 * a microphone or a phone line.
 *
 * The happy path is the least interesting one here. What the record has to get
 * right is the call where someone said yes and meant nothing by it, the call
 * where someone cannot afford to stop, and the call where someone is already
 * ill. Those are the rows a safety manager reads.
 */
import { newOutcome, addTurn, applyToolCall, endCall, summarise } from '../src/outcome.mjs';

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`ok    ${l}`); };
const bad = (l, d) => { fail++; console.log(`FAIL  ${l}\n        ${d}`); };
const is = (l, got, want) =>
  got === want ? ok(`${l} (${got})`) : bad(l, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

const start = (lang = 'hi') => newOutcome({ workerId: 'w1', alertId: 'a1', language: lang });

// ── 1. the call that worked ────────────────────────────────────────────────
{
  const o = start();
  addTurn(o, 'agent', 'It is dangerously hot. What are you going to do now?');
  addTurn(o, 'worker', 'Main abhi neeche jaa raha hoon, chaaon mein baithunga.');
  applyToolCall(o, 'record_understanding', {
    established: true,
    evidence: 'Main abhi neeche jaa raha hoon, chaaon mein baithunga.',
  });
  applyToolCall(o, 'record_work_stopped', { established: true, evidence: 'Haan, ruk gaya hoon.' });
  applyToolCall(o, 'record_water_and_shade', {
    has_water: true, has_shade: true, evidence: 'Paani hai, chaaon bhi hai.',
  });
  endCall(o, 'all_facts_established');

  const s = summarise(o);
  is('a complete call is fully_confirmed', s.status, 'fully_confirmed');
  is('and all three facts are established', s.factsEstablished, 3);
  is('and it counts as reached', s.reached, true);
}

// ── 1b. water but no shade ─────────────────────────────────────────────────
// A bottle in your hand and nowhere out of the sun is not a safe worker. This
// used to count as the third fact established and come back fully_confirmed.
{
  const o = start();
  addTurn(o, 'worker', 'I have water but there is no shade anywhere here.');
  applyToolCall(o, 'record_understanding', { established: true, evidence: 'I will come down.' });
  applyToolCall(o, 'record_work_stopped', { established: true, evidence: 'I have stopped.' });
  applyToolCall(o, 'record_water_and_shade', {
    has_water: true, has_shade: false,
    evidence: 'I have water but there is no shade anywhere here.',
  });
  endCall(o, 'all_facts_established');

  const s = summarise(o);
  is('water without shade is not a third established fact', s.factsEstablished, 2);
  is('and the call is not fully confirmed', s.status, 'partially_confirmed');
}

// ── 2. the reflexive yes ───────────────────────────────────────────────────
// The one this whole design exists for. Someone said yes to an authoritative
// voice on a phone. That is not comprehension, and recording it as such would
// put a lie in a compliance record.
{
  const o = start();
  addTurn(o, 'agent', 'What are you going to do now?');
  addTurn(o, 'worker', 'Haan.');
  applyToolCall(o, 'record_understanding', { established: false, evidence: 'Haan.' });
  endCall(o, 'could_not_establish');

  const s = summarise(o);
  is('a bare yes does not count as understanding', o.understood.established, false);
  is('and the worker\'s own word is kept as evidence', o.understood.evidence, 'Haan.');
  is('the call is only partially confirmed', s.status, 'partially_confirmed');
  is('with nothing established', s.factsEstablished, 0);
}

// ── 3. cannot stop ─────────────────────────────────────────────────────────
// The most valuable call in the month. A temperature reading cannot tell you
// that a man keeps working because he is paid per delivery.
{
  const o = start();
  addTurn(o, 'worker', 'Main ruk nahi sakta, har delivery ka paisa milta hai.');
  applyToolCall(o, 'record_understanding', {
    established: true, evidence: 'Samajh gaya, garmi zyada hai.',
  });
  applyToolCall(o, 'record_work_stopped', {
    established: false,
    evidence: 'Main ruk nahi sakta, har delivery ka paisa milta hai.',
    blocker: 'Paid per delivery, stopping costs him income',
  });
  endCall(o, 'worker_cannot_stop');

  const s = summarise(o);
  is('refusal is its own status', s.status, 'refused_or_unable_to_stop');
  is('and the reason is lifted into the summary',
     s.blocker, 'Paid per delivery, stopping costs him income');
  s.status !== 'partially_confirmed'
    ? ok('a refusal is never filed as a partial success')
    : bad('refusal status', 'it was flattened into partially_confirmed');
}

// ── 4. distress ────────────────────────────────────────────────────────────
{
  const o = start();
  addTurn(o, 'worker', 'Mujhe chakkar aa raha hai aur sar dard hai.');
  const { urgent } = applyToolCall(o, 'report_distress', {
    symptoms: 'Mujhe chakkar aa raha hai aur sar dard hai.',
    severity: 'urgent',
  });
  endCall(o, 'distress_escalated');

  is('distress is urgent', urgent, true);
  is('and it outranks every other status', summarise(o).status, 'distress_escalated');
  is('and the symptoms are kept verbatim',
     o.distress.symptoms, 'Mujhe chakkar aa raha hai aur sar dard hai.');
}

// ── 5. nobody answered ─────────────────────────────────────────────────────
// A worker we could not reach is a liability event, not an absence of data.
{
  const o = start();
  addTurn(o, 'agent', 'Hello, this is a safety call.');
  endCall(o, 'no_answer');

  const s = summarise(o);
  is('an unanswered call is not_reached', s.status, 'not_reached');
  is('and reached is false', s.reached, false);
}

// ── nothing is assumed ─────────────────────────────────────────────────────
// A call that dropped before the water question must never record that the
// worker had no water. Null is a third state and it has to survive.
{
  const o = start();
  addTurn(o, 'worker', 'Ji, main ruk gaya hoon.');
  applyToolCall(o, 'record_understanding', { established: true, evidence: 'Ji, main ruk gaya hoon.' });
  endCall(o, 'call_dropped');

  o.waterAndShade.hasWater === null && o.stoppedWork.established === null
    ? ok('an unasked question stays null, never false')
    : bad('null preserved', JSON.stringify(o.waterAndShade));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
