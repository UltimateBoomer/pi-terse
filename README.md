# pi-terse

Terse reply style for [Pi](https://github.com/earendil-works/pi). Port of the [claude-terse](https://github.com/lowenbjer/claude-terse) Claude Code plugin: the same 22 writing rules, delivered through Pi's extension system.

```bash
pi -e .                                  # one run, nothing written to settings
pi install ./                            # persistent, local copy
pi install git:github.com/lowenbjer/pi-terse
```

`/terse status | on | off | rules | meter on | meter off`.

## What it does

| Claude Code | pi | Effect |
|---|---|---|
| `output-styles/terse.md` | `before_agent_start` sets `systemPromptOptions.sections.terse` | pi has no output styles. The rules become a `<terse>` section placed after the built-in prompt sections, so they sit closer to the current turn than in Claude Code |
| `UserPromptSubmit` hook | `context` event | The condensed reminder is appended to the request as a user message. Request local: nothing is written to the session file. Applied only above `TERSE_REMINDER_CONTEXT` (30 percent context fill), which is when drift shows up |
| `SubagentStart` hook | `tool_call` on subagent tools | The rule 14 line is appended to the `task`, `prompt`, `message`, `instruction` or `query` argument of another extension's subagent tool before it runs |
| `statusline/context-meter.js` | `ctx.ui.setStatus("terse", ...)` | pi's footer already prints context percent, warning only at 70 and 90. This adds the 37, 49 and 60 thresholds with the color ramp and the skull |
| `skills/install-meter` | `/terse` | Extensions load on install, so there is nothing to copy into settings |

The extension never blocks, rewrites or truncates output. It is prompt injection only, and it makes no network calls.

## Cross-extension plumbing

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
- `TERSE_SUBAGENT_TOOLS=<names>`: tool names whose task argument gets the rule 14 line. Default `subagent,subagents,sub_agent,delegate,spawn_agent`. Empty string turns it off
- `TERSE_DEBUG=1`: prints loaded sizes and injection events on stderr

## Checks

```
pi -e . -p "List the three largest files in this repo"     # 86 words, no dashes, no first person
```

`bench/score.py` from claude-terse runs unchanged on replies from this extension.

## License

MIT, same as claude-terse.
