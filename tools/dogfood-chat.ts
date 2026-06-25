/**
 * Post a message to the live Northbound team chat from the developer side.
 *
 *   bun run dogfood:chat Kai "Shipped the grid footer fix — pull latest."
 *   bun run dogfood:chat Mira "Trying to embed the pipeline into the brief…"
 *
 * Speaker is one of Mira / Marcus / Priya / Kai (case-insensitive). Founder
 * sessions normally post via `s.chat()`; this CLI is for the engineer (Kai) to
 * respond between sessions, and for ad-hoc seeding.
 */

import { SPEAKER, postToTeamChat, resolveSpeaker } from "../tests/dogfood/lib/team-chat";

const [, , nameArg, ...rest] = process.argv;
const message = rest.join(" ").trim();

if (!nameArg || !message) {
	console.error('usage: bun run dogfood:chat <Mira|Marcus|Priya|Kai> "message"');
	process.exit(1);
}

const speaker = resolveSpeaker(nameArg);
if (!speaker) {
	console.error(`unknown speaker "${nameArg}". Known: ${Object.keys(SPEAKER).join(", ")}`);
	process.exit(1);
}

postToTeamChat(speaker, message);
console.log(`posted to team chat as ${speaker}`);
