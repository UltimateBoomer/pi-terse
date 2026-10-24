/**
 * terse - writing rules for pi. Port of the claude-terse Claude Code plugin.
 *
 * Component map:
 *   output-styles/terse.md       -> `terse` system prompt section (before_agent_start)
 *   hooks UserPromptSubmit       -> hidden custom message added to each user run (before_agent_start)
 *   hooks SubagentStart          -> pi has no built-in subagents; rule 14 becomes a prompt guideline,
 *                                   and subagent tools from other extensions get the style line
 *   statusline/context-meter.js  -> ctx.ui.setStatus() context meter in the footer
 *   skills/install-meter         -> not needed, extensions load automatically; /terse replaces it
 *
 * Try:     pi -e .            from this directory
 * Install: pi install ./      or pi install git:github.com/UltimateBoomer/pi-terse
 *
 * Knobs: TERSE_RULES, TERSE_REMINDER (paths), TERSE_REMINDER=off,
 *        TERSE_REMINDER_CONTEXT=<percent, default 30>,
 *        TERSE_SUBAGENT_TOOLS=<tool name globs>, TERSE_SUBAGENT_FIELDS=<argument names>
 *        for the rule 14 patch
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
const REMINDER_OFF = process.env.TERSE_REMINDER === "off";
const REMINDER = loadText([
	REMINDER_OFF ? "" : (process.env.TERSE_REMINDER ?? ""),
	resolve(HERE, "rules/REMINDER.md"),
	resolve(HERE, "../rules/REMINDER.md"),
	resolve(HERE, "../../rules/REMINDER.md"),
]).replace("the Output Style section of your system prompt", "the <terse> section of your system prompt");

const reminderContext = Number(process.env.TERSE_REMINDER_CONTEXT);
const REMINDER_CONTEXT = process.env.TERSE_REMINDER_CONTEXT && Number.isFinite(reminderContext) ? reminderContext : 30;

// Rule 14, shortened for a guideline bullet: nested model calls get the style line.
const STYLE_LINE = "No mannered prose. Answer first, short sentences, numbers and names, end on the result.";
const NESTED_LINE = `When writing a prompt to another model or subagent, include: "${STYLE_LINE}"`;

// Tools that hand a task to another model. Cross-extension hook: patch their arguments so the
// style line travels with the task. Three ways a tool counts as a subagent tool:
//   1. TERSE_SUBAGENT_TOOLS, a comma separated list of names or globs ("*agent*"). When set it
//      replaces detection 2; an empty string turns the patching off.
//   2. Its name or description mentions subagents or delegation.
//   3. Another extension emits "terse:subagent-tool" with { name, fields? }.
const TOOL_PATTERNS = process.env.TERSE_SUBAGENT_TOOLS?.split(",").map((name) => name.trim()).filter(Boolean).map(globToRegExp);
const SUBAGENT_NAME = /sub_?agent|delegat|spawn_?agent|agent_?(task|run|spawn)/i;
const SUBAGENT_DESCRIPTION = /\bsub-?agents?\b|\bdelegat(e|es|ing)\b[^.]*\b(agent|model)s?\b/i;

// Argument names that carry task text, matched at any depth so parallel and chain shapes such
// as { tasks: [{ agent, task }] } are covered.
const TASK_FIELDS = new Set(
	(process.env.TERSE_SUBAGENT_FIELDS ?? "task,prompt,message,instruction,instructions,query,goal").split(",").map((name) => name.trim()).filter(Boolean),
);
const MAX_DEPTH = 6;

function globToRegExp(glob: string): RegExp {
	return new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
}

// Appends the style line to every task string in the input. Returns the patched paths.
function patchTaskText(value: unknown, fields: Set<string>, path = "", depth = 0): string[] {
	if (depth > MAX_DEPTH || value == null || typeof value !== "object") return [];
	const patched: string[] = [];
	const entries: [string | number, unknown][] = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
	for (const [key, item] of entries) {
		const at = path ? `${path}.${key}` : String(key);
		if (typeof key === "string" && fields.has(key) && typeof item === "string") {
			if (!item.includes(STYLE_LINE)) {
				(value as Record<string, unknown>)[key] = `${item}\n\n${STYLE_LINE}`;
				patched.push(at);
			}
		} else {
			patched.push(...patchTaskText(item, fields, at, depth + 1));
		}
	}
	return patched;
}

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
	// Tools registered through "terse:subagent-tool", with their task fields when given.
	const registeredTools = new Map<string, Set<string>>();

	pi.events.on("terse:subagent-tool", (data) => {
		const { name, fields } = (data ?? {}) as { name?: unknown; fields?: unknown };
		if (typeof name !== "string" || !name) return;
		const names = Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string") : [];
		registeredTools.set(name, names.length > 0 ? new Set(names) : TASK_FIELDS);
	});

	const subagentFields = (toolName: string): Set<string> | undefined => {
		const registered = registeredTools.get(toolName);
		if (registered) return registered;
		if (TOOL_PATTERNS) return TOOL_PATTERNS.some((pattern) => pattern.test(toolName)) ? TASK_FIELDS : undefined;
		if (SUBAGENT_NAME.test(toolName)) return TASK_FIELDS;
		const description = pi.getAllTools().find((tool) => tool.name === toolName)?.description ?? "";
		return SUBAGENT_DESCRIPTION.test(description) ? TASK_FIELDS : undefined;
	};

	const refreshMeter = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const text = enabled && meter ? meterText(ctx.getContextUsage()?.percent ?? null) : "";
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
	// the built-in sections. pi rebuilds these options from its base for every run, so a disabled
	// run simply adds nothing.
	//
	// Anti-drift. The rules sit at the front of a long transcript, so replies stop following them
	// after a while. When the context is big, a hidden custom message carries the condensed
	// reminder into the run, the way the UserPromptSubmit hook does in Claude Code. pi stamps and
	// persists it with the user prompt, so the transcript prefix stays byte identical across
	// requests and the prompt cache keeps hitting. Compaction runs before this event, so the
	// percent is null right after it and the reminder waits for real usage numbers.
	pi.on("before_agent_start", (event, ctx) => {
		if (!enabled) return;
		if (RULES) event.systemPromptOptions.sections.terse = RULES;
		event.systemPromptOptions.promptGuidelines.push(NESTED_LINE);

		if (REMINDER_OFF || !REMINDER || event.messageType !== "user") return;
		const percent = ctx.getContextUsage()?.percent;
		if (percent == null || percent < REMINDER_CONTEXT) return;
		if (process.env.TERSE_DEBUG) console.error(`terse: reminder added at ${Math.round(percent)}% context (${REMINDER.length} chars)`);
		return {
			message: {
				customType: "terse-reminder",
				content: `<terse_reminder>${REMINDER}</terse_reminder>`,
				display: false,
			},
		};
	});

	// Cross-extension rule 14. A subagent tool's task text gets the style line before it runs.
	pi.on("tool_call", (event) => {
		if (!enabled) return;
		const fields = subagentFields(event.toolName);
		if (!fields) return;
		const patched = patchTaskText(event.input, fields);
		if (process.env.TERSE_DEBUG && patched.length > 0) {
			console.error(`terse: style line added to ${event.toolName}: ${patched.join(", ")}`);
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
				refreshMeter(ctx);
				ctx.ui.notify("terse rules off", "info");
				return;
			}
			if (arg === "on" || arg === "enable") {
				enabled = true;
				refreshMeter(ctx);
				ctx.ui.notify("terse rules on", "info");
				return;
			}
			if (arg === "meter off") {
				meter = false;
				refreshMeter(ctx);
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
