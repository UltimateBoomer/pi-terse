/**
 * terse - writing rules for pi. Port of the claude-terse Claude Code plugin.
 *
 * Component map:
 *   output-styles/terse.md       -> `terse` system prompt section (before_agent_start)
 *   hooks UserPromptSubmit       -> reminder appended to the current user turn (context event)
 *   hooks SubagentStart          -> no pi equivalent (pi has no subagents); rule 14 becomes a
 *                                   prompt guideline so nested model calls get the style line
 *   statusline/context-meter.js  -> ctx.ui.setStatus() context meter in the footer
 *   skills/install-meter         -> not needed, extensions load automatically; /terse replaces it
 *
 * Try:     pi -e .            from this directory
 * Install: pi install ./      or pi install git:github.com/lowenbjer/pi-terse
 *
 * Knobs: TERSE_RULES, TERSE_REMINDER (paths), TERSE_REMINDER=off,
 *        TERSE_REMINDER_CONTEXT=<percent, default 30>,
 *        TERSE_SUBAGENT_TOOLS=<tool names> for the rule 14 patch
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const HERE = dirname(fileURLToPath(import.meta.url));

// Rules live in the repo's rules/ directory. A standalone package copy keeps them next to
// the extension. TERSE_RULES overrides both.
function loadText(candidates: string[]): string {
	for (const file of candidates) {
		if (!file) continue;
		try {
			const text = readFileSync(file, "utf8").trim();
			if (text) return text;
		} catch {
			// try the next candidate
		}
	}
	return "";
}

const RULES = loadText([
	process.env.TERSE_RULES ?? "",
	resolve(HERE, "rules/RULES.md"),
	resolve(HERE, "../rules/RULES.md"),
	resolve(HERE, "../../rules/RULES.md"),
]);

// The Claude reminder names the Output Style section. In pi the rules sit in the terse section.
const REMINDER = loadText([
	process.env.TERSE_REMINDER ?? "",
	resolve(HERE, "rules/REMINDER.md"),
	resolve(HERE, "../rules/REMINDER.md"),
	resolve(HERE, "../../rules/REMINDER.md"),
]).replace("the Output Style section of your system prompt", "the <terse> section of your system prompt");

const REMINDER_OFF = process.env.TERSE_REMINDER === "off";
const REMINDER_CONTEXT = Number(process.env.TERSE_REMINDER_CONTEXT ?? 30);

// Rule 14, shortened for a guideline bullet: nested model calls get the style line.
const NESTED_LINE =
	'When writing a prompt to another model or subagent, include: "No mannered prose. Answer first, short sentences, numbers and names, end on the result."';

// Tools that hand a task to another model. Cross-extension hook: patch their arguments so the
// style line travels with the task. Set TERSE_SUBAGENT_TOOLS to a comma separated list, or empty
// to turn the patching off.
const SUBAGENT_TOOLS = new Set(
	(process.env.TERSE_SUBAGENT_TOOLS ?? "subagent,subagents,sub_agent,delegate,spawn_agent").split(",").map((name) => name.trim()).filter(Boolean),
);
const TASK_FIELDS = ["task", "prompt", "message", "instruction", "query"];

// Context meter thresholds, same numbers as statusline/context-meter.js. pi's own footer only
// warns at 70 and 90 percent.
const WARN = 37;
const HOT = 49;
const CRITICAL = 60;

function meterText(percent: number | null): string {
	if (percent == null || Number.isNaN(percent)) return "";
	const used = Math.max(0, Math.min(100, Math.round(percent)));
	if (used >= CRITICAL) return `\x1b[5;31m💀 context ${used}%\x1b[0m`;
	if (used >= HOT) return `\x1b[38;5;208mcontext ${used}%\x1b[0m`;
	if (used >= WARN) return `\x1b[33mcontext ${used}%\x1b[0m`;
	return `\x1b[32mcontext ${used}%\x1b[0m`;
}

export default function terseExtension(pi: ExtensionAPI) {
	let enabled = true;
	let meter = true;
	let bigContext = false;

	const refreshMeter = (ctx: ExtensionContext) => {
		const percent = ctx.getContextUsage()?.percent ?? null;
		if (percent != null) bigContext = percent >= REMINDER_CONTEXT;
		if (!meter || !ctx.hasUI) return;
		const text = meterText(ctx.getContextUsage()?.percent ?? null);
		ctx.ui.setStatus("terse", text || undefined);
	};

	pi.on("session_start", async (_event, ctx) => {
		if (process.env.TERSE_DEBUG) {
			console.error(`terse: rules ${RULES.length} chars, reminder ${REMINDER.length} chars`);
		}
		if (!RULES) ctx.ui.notify("terse: rules/RULES.md not found, style rules disabled", "warning");
		// Other extensions (a subagent tool, for example) can read the rules off the bus.
		pi.events.emit("terse:rules", { rules: RULES, reminder: REMINDER, nestedLine: NESTED_LINE });
		refreshMeter(ctx);
	});

	// The rules as a system prompt section: pi wraps it as <terse>...</terse> and places it after
	// the built-in sections.
	pi.on("before_agent_start", (event) => {
		const sections = event.systemPromptOptions.sections;
		if (!enabled) {
			delete sections.terse;
			return;
		}
		if (RULES) sections.terse = RULES;
		event.systemPromptOptions.promptGuidelines.push(NESTED_LINE);
	});

	// Anti-drift. The rules sit at the front of a long transcript, so replies stop following them
	// after a while. When the context is big, append the condensed reminder to the user turn for
	// this request only; pi restores the transcript afterwards, so nothing is persisted.
	pi.on("context", (event) => {
		if (!enabled || REMINDER_OFF || !REMINDER) return;
		if (!bigContext) return;
		// A new user turn at the end of the request, next to the current one. Tool results are
		// user role in the Anthropic API, so a user message after them is the normal shape.
		const messages = [...event.messages, { role: "user", content: [{ type: "text", text: `<terse_reminder>${REMINDER}</terse_reminder>` }] }];
		if (process.env.TERSE_DEBUG) console.error(`terse: reminder appended to the request (${REMINDER.length} chars)`);
		return { messages };
	});

	// Cross-extension rule 14. A subagent tool's task text gets the style line before it runs.
	pi.on("tool_call", (event) => {
		if (!enabled || !SUBAGENT_TOOLS.has(event.toolName)) return;
		const input = event.input as Record<string, unknown>;
		for (const field of TASK_FIELDS) {
			const value = input[field];
			if (typeof value === "string" && !value.includes("No mannered prose")) {
				input[field] = `${value}\n\n${NESTED_LINE.replace(/When writing a prompt to another model or subagent, include: /, "")}`;
				if (process.env.TERSE_DEBUG) console.error(`terse: style line added to ${event.toolName}.${field}`);
				return;
			}
		}
	});

	// Readable by other extensions through ctx.executeTool("terse_rules") or the codemode tool.
	pi.registerTool({
		name: "terse_rules",
		label: "Terse rules",
		description: "Return the terse writing rules, the condensed reminder, and the line to pass to nested model calls.",
		parameters: Type.Object({}),
		exposure: "codemode",
		execute: async () => ({
			content: [{ type: "text", text: RULES }],
			details: { rules: RULES, reminder: REMINDER, nestedLine: NESTED_LINE },
		}),
	});

	pi.on("turn_end", async (_event, ctx) => refreshMeter(ctx));
	pi.on("model_select", async (_event, ctx) => refreshMeter(ctx));

	pi.registerCommand("terse", {
		description: "terse style rules: on | off | rules | meter on | meter off | status",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();
			if (arg === "off" || arg === "disable") {
				enabled = false;
				ctx.ui.setStatus("terse", undefined);
				ctx.ui.notify("terse rules off", "info");
				return;
			}
			if (arg === "on" || arg === "enable") {
				enabled = true;
				ctx.ui.notify("terse rules on", "info");
				return;
			}
			if (arg === "meter off") {
				meter = false;
				ctx.ui.setStatus("terse", undefined);
				return;
			}
			if (arg === "meter on") {
				meter = true;
				refreshMeter(ctx);
				return;
			}
			if (arg === "rules") {
				ctx.ui.notify(RULES ? `terse rules loaded: ${RULES.length} characters from rules/RULES.md` : "terse: no rules file", "info");
				return;
			}
			ctx.ui.notify(
				`terse: rules ${enabled ? "on" : "off"} (${RULES.length} chars), reminder ${REMINDER.length} chars above ${REMINDER_CONTEXT}% context, meter ${meter ? "on" : "off"}`,
				"info",
			);
		},
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("terse", undefined);
	});
}
