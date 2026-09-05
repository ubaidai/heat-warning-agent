/**
 * The WebSocket session against AssemblyAI's Voice Agent API.
 *
 * One socket carries everything: audio out, audio back, transcripts, and tool
 * calls. There is no separate speech-to-text, language model or text-to-speech
 * to wire together, which is the reason to use this API rather than assembling
 * the stack by hand.
 *
 * Event names are taken from a live session, not from the reference page's
 * prose headings, which differ from the wire format. The server sends
 * transcript.agent and transcript.user carrying `text`, and reply.audio
 * carrying `data` — not agent.transcript or reply.audio_chunk. Audio is PCM16
 * at 24 kHz in both directions.
 */

import { newOutcome, addTurn, applyToolCall, endCall } from './outcome.mjs';
import { sessionConfig } from './agent.mjs';

export const ENDPOINT = 'wss://agents.assemblyai.com/v1/ws';

/**
 * @param {object} call    worker, employer, temperature, language
 * @param {object} io      { onAudio(base64Pcm16), close() } — the telephony leg
 * @param {object} opts    { apiKey, WebSocketImpl, onEvent }
 */
export async function runCall(call, io, { apiKey, WebSocketImpl, onEvent = () => {} } = {}) {
  if (!apiKey) throw new Error('Missing AssemblyAI API key.');

  const WS = WebSocketImpl ?? globalThis.WebSocket;
  if (!WS) throw new Error('No WebSocket implementation available. Node 22+ has one built in.');

  const outcome = newOutcome({
    workerId: call.workerId,
    alertId: call.alertId,
    language: call.language,
  });

  // Server-side, so the key goes in the upgrade header. A browser cannot set
  // headers on a WebSocket and must use a one-time token instead; this path is
  // deliberately server-only so the permanent key never reaches a client.
  const socket = new WS(ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` } });

  let urgent = false;

  return await new Promise((resolve, reject) => {
    // finish is reachable from reply.done, session.error, session.ended and the
    // close handler, and more than one of those fires on a normal teardown.
    // resolve() is idempotent but endCall is not: a second call rewrote
    // endedBecause, so a distress escalation could end up recorded as
    // 'server_ended'. First reason wins, because it is the true one.
    let finished = false;
    const finish = (reason) => {
      if (finished) return;
      finished = true;
      endCall(outcome, reason);
      try { socket.send(JSON.stringify({ type: 'session.end' })); } catch { /* already gone */ }
      resolve(outcome);
    };

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(sessionConfig(call)));
    });

    socket.addEventListener('message', (raw) => {
      let event;
      try {
        event = JSON.parse(typeof raw.data === 'string' ? raw.data : raw.data.toString());
      } catch {
        return;
      }
      onEvent(event);

      switch (event.type) {
        case 'session.ready':
          io.onReady?.(socket);
          break;

        case 'transcript.user':
          addTurn(outcome, 'worker', event.text);
          break;

        case 'transcript.agent':
          addTurn(outcome, 'agent', event.text);
          break;

        case 'reply.audio':
          io.onAudio?.(event.data);
          break;

        case 'tool.call': {
          const args = typeof event.arguments === 'string'
            ? JSON.parse(event.arguments)
            : (event.arguments ?? {});
          const { result, urgent: isUrgent } = applyToolCall(outcome, event.name, args);
          // Sent immediately rather than queued until reply.done. Holding them
          // meant that a session ending first — an error, a dropped socket,
          // the distress path — discarded every acknowledgement silently, while
          // the browser client, which sends on receipt, worked. Two
          // implementations of one protocol, and only the untested one lost
          // messages.
          //
          // call_id on both the call and the result. A wrong name here does not
          // fail the tool, it ends the session with invalid_format.
          try {
            socket.send(JSON.stringify({
              type: 'tool.result',
              call_id: event.call_id,
              result: JSON.stringify(result),
            }));
          } catch (err) {
            outcome.toolCalls.push({ name: event.name, error: `ack failed: ${err.message}` });
          }
          if (isUrgent) urgent = true;
          break;
        }

        case 'reply.done':
          if (urgent) {
            // A worker describing heat illness is not a conversation to finish.
            finish('distress_escalated');
          } else if (
            outcome.understood.established !== null &&
            outcome.stoppedWork.established !== null &&
            outcome.waterAndShade.hasWater !== null
          ) {
            finish('all_facts_established');
          }
          break;

        case 'session.error':
          finish(`session_error: ${event.error ?? 'unknown'}`);
          break;

        case 'session.ended':
          if (!outcome.endedAt) finish(event.reason ?? 'server_ended');
          break;
      }
    });

    socket.addEventListener('error', (err) => {
      endCall(outcome, `socket_error: ${err?.message ?? 'unknown'}`);
      reject(new Error(`Voice session failed: ${err?.message ?? 'unknown'}`));
    });

    // Closing without session.end leaves the session billable for another
    // thirty seconds, so every exit path above sends it first.
    socket.addEventListener('close', () => {
      if (!outcome.endedAt) finish('socket_closed');
    });
  });
}

/** Stream one chunk of the caller's audio to the agent. */
export function sendAudio(socket, base64Pcm16) {
  socket.send(JSON.stringify({ type: 'input.audio', audio: base64Pcm16 }));
}
