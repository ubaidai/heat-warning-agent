# heat-warning-agent

A voice agent that phones outdoor workers when heat crosses a dangerous limit, and confirms they understood.

Built on [AssemblyAI's Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api).

## The problem

Karachi's 2015 heatwave killed over a thousand people in a week, most of them working outdoors. Forecasts existed. They never reached the rickshaw drivers, construction labourers and delivery riders who were dying, because a citywide number on a website is not a warning that arrives.

The people at risk are on scaffolding, on a bike, in a concrete yard. No app, often no literacy in English, and frequently no employer telling them to stop.

Qatar's Decree 17 of 2021 stops all outdoor work when wet bulb globe temperature passes 32.1°C, at any hour. The UAE fines AED 5,000 per worker for breaching its midday ban. The obligation exists. The delivery does not.

## The design problem

A worker who says "haan" has not necessarily understood anything.

Reflexive agreement to an authoritative voice on a phone is the default behaviour, not the exception. A naive confirmation flow records that yes as a successful warning, and the employer ends up holding a compliance record full of agreement that meant nothing — which is worse than holding no record, because it reads as evidence they acted.

So this agent never asks a question that "yes" can answer.

It asks what the worker is going to do. It asks where they are going to sit. The answer either demonstrates comprehension or it does not, and the tool that records the outcome carries the worker's own words as evidence beside the judgement, so a reviewer can check the call rather than trust it.

```
record_understanding(established, evidence)
```

`established` is only true if the worker said something showing they understood. `evidence` is what they actually said. A bare "yes", "haan", "ok" or silence is recorded as **not** established, with the word itself preserved.

## What a call establishes

Three facts, in order:

1. They understood the warning
2. They have stopped, or are stopping, outdoor work
3. They have drinking water and shade

Plus one interrupt. If the worker describes dizziness, nausea, headache, confusion, cramps, or having stopped sweating, the agent calls `report_distress` immediately, abandons the script, tells them to sit in shade, and escalates to a human. Everything after that is a person's job.

## Two outcomes that matter more than success

**"I can't stop, I'm paid per delivery."** No temperature reading can tell you that. It is the single most useful thing a call can learn, and it gets its own status and its own field rather than being filed as a partial success.

**Nobody answered.** A worker who could not be reached is a liability event, not a gap in the data. It is a first-class outcome and it belongs at the top of the monthly report.

## Nothing is assumed

Every fact starts `null`, meaning *not established*, which is a different state from `false`. A call that drops before the water question must never record that the worker had no water. Confirmed, denied, and never-asked are three states, and collapsing them to a boolean puts a lie in a safety record.

## Languages

| Language | Model support |
|---|---|
| English | native |
| Hindi | native |
| Arabic | native |
| **Urdu** | **via the Hindi model — an approximation** |

AssemblyAI's streaming models cover 18 languages with native code-switching, and Urdu is not among them. Hindi is.

Spoken Urdu and spoken Hindi are the same language. They diverge in script and in formal register, not in *"I stopped, I have water."* Using the Hindi model for Urdu speakers is a documented approximation, and it needs testing against real Karachi speech before anyone relies on it. The code-switching matters too: Karachi workers mix Urdu and English constantly.

## Running it

```bash
node scripts/outcome-check.mjs
```

Runs the five ways a call actually ends — confirmed, reflexive yes, cannot stop, distress, unanswered — through the record logic. No API key, no microphone, no phone line. 16 checks.

A live call needs an AssemblyAI API key and a telephony leg to carry the audio. `src/session.mjs` handles the WebSocket, the tool-call loop, and clean teardown; `sendAudio()` takes base64 PCM16 from whatever is holding the phone line.

One detail worth keeping: closing the socket without sending `session.end` leaves the session billable for another thirty seconds, so every exit path sends it first.

## Structure

```
src/agent.mjs      system prompt, tool schemas, per-language greetings
src/session.mjs    the WebSocket session and tool-call loop
src/outcome.mjs    turning a call into a record
scripts/           the checks
```

## Status

The agent definition, the record logic and the session handling are written and tested. Live calling needs a key and a phone line.

Part of a heat-safety compliance system for outdoor workforces. This repo is the voice layer, MIT licensed and standalone.

## Licence

MIT.
