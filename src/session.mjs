/**
 * The WebSocket session against AssemblyAI's Voice Agent API.
 *
 * One socket carries everything: audio out, audio back, transcripts, and tool
 * calls. There is no separate speech-to-text, language model or text-to-speech
 * to wire together, which is the reason to use this API rather than assembling
 * the stack by hand.
 *
 * Endpoint and event names are from the published API reference. The client
 * sends session.update, input.audio, tool.result and session.end; the server
 * sends session.ready, user.transcript, agent.transcript, reply.audio_chunk,
 * reply.done, tool.call and the session lifecycle events.
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

  /** Tool results are batched and flushed on reply.done, as the API expects. */
  let pendingResults = [];
  let urgent = false;

  return await new Promise((resolve, reject) => {
    const finish = (reason) => {
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

        case 'user.transcript':
          addTurn(outcome, 'worker', event.transcript ?? event.text);
          break;

        case 'agent.transcript':
          addTurn(outcome, 'agent', event.transcript ?? event.text);
          break;

        case 'reply.audio_chunk':
          io.onAudio?.(event.audio);
          break;

        case 'tool.call': {
          const args = typeof event.arguments === 'string'
            ? JSON.parse(event.arguments)
            : (event.arguments ?? {});
          const { result, urgent: isUrgent } = applyToolCall(outcome, event.name, args);
          pendingResults.push({
            type: 'tool.result',
            tool_call_id: event.tool_call_id ?? event.id,
            result: JSON.stringify(result),
          });
          if (isUrgent) urgent = true;
          break;
        }

        case 'reply.done':
          // The reference says to send accumulated tool results on this event.
          for (const r of pendingResults) socket.send(JSON.stringify(r));
          pendingResults = [];

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
