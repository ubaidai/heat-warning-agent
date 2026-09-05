/**
 * Turning a call into a record.
 *
 * The record is the point of the whole system. An alert that was sent proves
 * nothing; a call where someone said what they were going to do and it was
 * written down is the thing an employer can show when asked whether they acted.
 *
 * Two rules shape this file.
 *
 * Nothing is assumed. Every fact starts null, meaning "not established", which
 * is a different state from false. A call that dropped before the water
 * question must never record that the worker had no water.
 *
 * Nothing is silently dropped. A worker who could not be reached, or who said
 * they cannot stop, is the most important row in the month's report. Those
 * outcomes are first-class, not gaps.
 */

/** A fact nobody established yet. Not false. Not true. */
const UNSET = { established: null, evidence: null };

export function newOutcome({ workerId, alertId, language, startedAt = new Date() }) {
  return {
    workerId,
    alertId,
    language,
    startedAt: startedAt.toISOString(),
    endedAt: null,

    understood: { ...UNSET },
    stoppedWork: { ...UNSET, blocker: null },
    waterAndShade: { hasWater: null, hasShade: null, evidence: null },

    distress: null,
    transcript: [],
    toolCalls: [],
    endedBecause: null,
  };
}

/** Record a line of the conversation as it happens, for the audit trail. */
export function addTurn(outcome, speaker, text) {
  if (!text) return outcome;
  outcome.transcript.push({ speaker, text, at: new Date().toISOString() });
  return outcome;
}

/**
 * Apply a tool call from the agent.
 *
 * Returns { result, urgent } — result goes back over the socket as tool.result,
 * and urgent means stop the call and get a human on it now.
 */
export function applyToolCall(outcome, name, args) {
  outcome.toolCalls.push({ name, args, at: new Date().toISOString() });

  switch (name) {
    case 'record_understanding':
      outcome.understood = {
        established: Boolean(args.established),
        evidence: args.evidence ?? null,
      };
      return { result: { recorded: true }, urgent: false };

    case 'record_work_stopped':
      outcome.stoppedWork = {
        established: Boolean(args.established),
        evidence: args.evidence ?? null,
        blocker: args.blocker || null,
      };
      return { result: { recorded: true }, urgent: false };

    case 'record_water_and_shade':
      outcome.waterAndShade = {
        hasWater: Boolean(args.has_water),
        hasShade: Boolean(args.has_shade),
        evidence: args.evidence ?? null,
      };
      return { result: { recorded: true }, urgent: false };

    case 'report_distress':
      outcome.distress = {
        symptoms: args.symptoms ?? null,
        severity: args.severity ?? 'concerning',
        at: new Date().toISOString(),
      };
      // The agent is told to stop the script here. Everything after this is a
      // human's job, and the call exists now only to keep the worker talking
      // until that human arrives.
      return { result: { escalated: true, tell_worker: 'sit in shade, help is coming' }, urgent: true };

    default:
      return { result: { error: `unknown tool ${name}` }, urgent: false };
  }
}

export function endCall(outcome, reason) {
  outcome.endedAt = new Date().toISOString();
  outcome.endedBecause = reason;
  return outcome;
}

/**
 * What actually happened, for the report.
 *
 * `reached` is the number that matters. Not alerts sent — anyone can send
 * alerts. Whether the warning arrived is the only claim this product makes.
 */
export function summarise(outcome) {
  // Water AND shade. Counting water alone let a worker with a bottle and no
  // shade anywhere on site come back as fully confirmed, which is a clean
  // record for somebody standing in direct sun — the exact condition the call
  // exists to find.
  const hasBoth =
    outcome.waterAndShade.hasWater === true && outcome.waterAndShade.hasShade === true;

  const established = [
    outcome.understood.established,
    outcome.stoppedWork.established,
    hasBoth,
  ].filter((v) => v === true).length;

  const reached = outcome.transcript.some((t) => t.speaker === 'worker');

  let status;
  if (outcome.distress) status = 'distress_escalated';
  else if (!reached) status = 'not_reached';
  else if (outcome.stoppedWork.established === false) status = 'refused_or_unable_to_stop';
  else if (established === 3) status = 'fully_confirmed';
  else status = 'partially_confirmed';

  return {
    status,
    reached,
    factsEstablished: established,
    of: 3,
    // A worker who said why they cannot stop has told us something no
    // temperature reading can, so it is lifted to the top of the summary.
    blocker: outcome.stoppedWork.blocker ?? null,
    distress: outcome.distress,
    durationSeconds: outcome.endedAt
      ? Math.round((new Date(outcome.endedAt) - new Date(outcome.startedAt)) / 1000)
      : null,
  };
}
