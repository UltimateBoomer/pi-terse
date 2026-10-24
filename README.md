# pi-terse

Terse reply style for [Pi](https://github.com/earendil-works/pi). Port of the [claude-terse](https://github.com/lowenbjer/claude-terse) Claude Code plugin: the same 22 writing rules, delivered through Pi's extension system.

```bash
pi -e .                                  # one run, nothing written to settings
pi install ./                            # persistent, local copy
pi install git:github.com/UltimateBoomer/pi-terse
```

`/terse status | on | off | rules | meter on | meter off`.

## What it does

| Claude Code | pi | Effect |
|---|---|---|
| `output-styles/terse.md` | `before_agent_start` sets `systemPromptOptions.sections.terse` | pi has no output styles. The rules become a `<terse>` section placed after the built-in prompt sections, so they sit closer to the current turn than in Claude Code |
| `UserPromptSubmit` hook | `before_agent_start` message | The condensed reminder rides along with each user prompt as a hidden custom message, once context passes `TERSE_REMINDER_CONTEXT` (30 percent), which is when drift shows up. It is saved to the session like the Claude Code hook output, so earlier requests stay byte identical and the prompt cache keeps hitting |
| `SubagentStart` hook | `tool_call` on subagent tools | The rule 14 line is appended to every task string in another extension's subagent tool call, at any depth, so `{ tasks: [{ agent, task }] }` and chain shapes are covered |
| `statusline/context-meter.js` | `ctx.ui.setStatus("terse", ...)` | pi's footer already prints context percent, warning only at 70 and 90. This adds the 37, 49 and 60 thresholds with the color ramp and the skull |
| `skills/install-meter` | `/terse` | Extensions load on install, so there is nothing to copy into settings |

The extension never blocks, rewrites or truncates output. It is prompt injection only, and it makes no network calls.

## Cross-extension plumbing

Subagent tools are found three ways, first match wins:

- `pi.events.emit("terse:subagent-tool", { name, fields? })` from the subagent extension. `fields` names the arguments that hold task text.
- `TERSE_SUBAGENT_TOOLS`, when set: names or globs such as `crew_*`.
- Otherwise detection: the tool name contains `subagent`, `delegate` or `spawn_agent`, or its description mentions subagents or delegating to an agent or model.

A subagent extension can read the rules three ways:

- `pi.events.on("terse:rules", …)` at session start: rules, reminder and the nested-call line.
- `ctx.executeTool("terse_rules", {})`: registered with `exposure: "codemode"`, callable by other tools and codemode scripts, not declared to the model.
- Installed extensions are inherited. Spawn-based subagents are separate `pi` processes and read the same settings, so `pi install ./` gives every child the rules without the subagent extension cooperating.

Hooks do not reach raw nested model calls made with `ctx.modelRegistry.streamSimple()` or `complete()`. Those get the context the calling extension builds, so they must pull the rules from the bus or from `terse_rules`.

## Layout

```
pi-terse/
├── extensions/terse.ts
├── rules/RULES.md          22 rules, 5,099 characters
├── rules/REMINDER.md       condensed reminder, 576 characters
├── package.json            pi package manifest
└── sync-rules.sh           copy rules from ../claude-terse/rules
```

`rules/` is a copy of the claude-terse rule text so the package is self-contained. Run `./sync-rules.sh` after editing the upstream rules. The extension looks for `TERSE_RULES`, then `rules/` next to the extension, then `../rules`, then `../../rules`.

## Knobs

- `TERSE_RULES`, `TERSE_REMINDER`: paths to the rule files
- `TERSE_REMINDER=off`: no per-request reminder
- `TERSE_REMINDER_CONTEXT=<percent>`: context fill from which the reminder is injected, default 30
- `TERSE_SUBAGENT_TOOLS=<names or globs>`: tool names whose task text gets the rule 14 line. Replaces name and description detection. Empty string turns it off
- `TERSE_SUBAGENT_FIELDS=<names>`: argument names that hold task text, matched at any depth. Default `task,prompt,message,instruction,instructions,query,goal`
- `TERSE_DEBUG=1`: prints loaded sizes and injection events on stderr

## Checks

```
pi -e . -p "List the three largest files in this repo"     # 86 words, no dashes, no first person
```

`bench/score.py` from claude-terse runs unchanged on replies from this extension.

## License

MIT, same as claude-terse.
