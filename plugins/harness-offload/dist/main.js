import {
  VERSION,
  killChildrenOnSignals2,
  UsageError2,
  ExitError2,
  color,
  banner
} from "./chunk-yrbt2j5y.js";

// src/cli.ts
var core = () => import("./chunk-jde8bg46.js");
var admin = () => import("./chunk-d0esc7r3.js");
var SELF = () => process.env.npm_command === "exec" ? "npx harness-offload" : "offload";
var HELP = () => `${banner()}
  ${color.bold("Get started")}
    ${`${SELF()} install`.padEnd(40)}asks which agents and where, shows what will change,
    ${"".padEnd(40)}installs only after you say yes
    ${`${SELF()} uninstall`.padEnd(40)}the same, in reverse

  ${color.bold("Delegate")}
    offload read -q QUESTION PATH...        answer a question about files (dirs, file:START-END ok);
                                            citations are checked against the files
    offload explore QUESTION                read-only agent searches the repo itself and answers
    offload run [-q FOCUS] -- CMD...        run a noisy command; long output becomes a digest
    offload summarize [-q FOCUS] [FILE]     digest text from FILE or stdin
    offload write --spec S --ref FILE [--context FILE] [--out PATH] [--check 'CMD']
    offload ask [--stdin|-f FILE] QUESTION  one-off question to the cheap model
    offload task NAME [-q Q] [PATH...]      run one of your own tasks (offload tasks lists them)
    offload outline FILE                    symbol outline with line numbers (no model)
    offload dashboard [--open] [--sample]   HTML report of what was kept out of context

  ${color.bold("Set up")}
    offload model [TASK] [REF]              show or change which model does the work
                                            (e.g. offload model groq:llama-3.3-70b · offload model read claude:haiku)
    offload key [NAME] [--remove]           store an API key (hidden prompt or stdin; file mode 600)
    offload setup                           interactive wizard: backends, keys, models, hosts
    offload demo                            10-second tour, no model calls
    offload install --yes [--agents a,b] [--scope user|project] [--dry-run]   the same without questions
    offload install <host> | uninstall <host>   just one: claude · codex · cursor · gemini · copilot · qwen
                                            crush · pi · opencode · kilo · devin · aider · mcp
    offload sync                            refresh every installed integration (after an upgrade)
    offload doctor [--ping] [--reset]       check everything; --ping makes one tiny call per model
    offload models [BACKEND...]             list models your backends offer
    offload config [show|path|init|set KEY VALUE|get|trust] [--project]
    offload stats [--days N] [--json|--csv] delegations and estimated tokens saved
    offload explain [N]                     what the hooks did lately, why, and how to change it
    offload statusline                      one short line for status bars
    offload mcp                             run as an MCP server (stdio)

  ${color.bold("Models")} are written BACKEND:MODEL — e.g. ${color.cyan("openrouter:qwen/qwen3-coder")}, ${color.cyan("ollama:qwen3:8b")},
  ${color.cyan("pi:openai-codex/gpt-6-luna")}; a bare ${color.cyan("provider/model")} means OpenCode;
  ${color.cyan("@host")} (the default) is your harness's own small model on your own plan;
  ${color.cyan("@host-api")} is the same model family through an API key — a backup if the plan route stops working.

  Common options: -m/--model REF (one-off override), --allow-secrets
  Exit codes: 0 ok · 2 usage · 10 quota · 11 auth · 12 timeout · 13 unknown model · 14 worker error
              15 backend missing · 16 refused (secrets/size)
`;
async function main(argv) {
  if (argv[0] !== "hook")
    killChildrenOnSignals2();
  const [cmd = "help", ...rest] = argv;
  const { HELP_JSON } = await import("./chunk-rk7gt2jq.js");
  const topic = cmd === "help" ? rest[0] : rest[0] === "--help" || rest[0] === "-h" ? cmd : undefined;
  if (topic && typeof HELP_JSON[topic] === "string" && !topic.startsWith("_")) {
    process.stdout.write(HELP_JSON[topic] + `
`);
    return 0;
  }
  switch (cmd) {
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(HELP());
      return 0;
    case "version":
    case "-v":
    case "--version":
      process.stdout.write(`offload ${VERSION}
`);
      return 0;
    case "read":
    case "bulk-read":
      await (await core()).cmdRead(rest);
      return 0;
    case "explore":
      await (await core()).cmdExplore(rest);
      return 0;
    case "run":
      return (await core()).cmdRun(rest);
    case "summarize":
    case "digest":
      await (await core()).cmdSummarize(rest);
      return 0;
    case "write":
    case "code-write":
      return (await core()).cmdWrite(rest);
    case "ask":
      await (await core()).cmdAsk(rest);
      return 0;
    case "task":
      await (await core()).cmdTask(rest);
      return 0;
    case "tasks":
      await (await core()).cmdTasks(rest);
      return 0;
    case "model":
      return (await import("./chunk-g65vnv8b.js")).cmdModel(rest);
    case "key":
      return (await import("./chunk-yy7hkfwg.js")).cmdKey(rest);
    case "outline":
      (await core()).cmdOutline(rest);
      return 0;
    case "dashboard":
      return (await import("./chunk-gvbnxg4e.js")).cmdDashboard(rest);
    case "doctor":
      return (await admin()).cmdDoctor(rest);
    case "stats":
      (await admin()).cmdStats(rest);
      return 0;
    case "explain":
      (await admin()).cmdExplain(rest);
      return 0;
    case "demo":
      return (await import("./chunk-aggy1qme.js")).cmdDemo();
    case "statusline":
      await (await admin()).cmdStatusline();
      return 0;
    case "config":
      (await admin()).cmdConfig(rest);
      return 0;
    case "models":
      await (await admin()).cmdModels(rest);
      return 0;
    case "setup":
      return (await import("./chunk-zy9kev3j.js")).cmdSetup(rest);
    case "install":
    case "uninstall":
      return (await import("./chunk-r9xx069j.js")).cmdInstall(cmd, rest);
    case "sync":
      return (await import("./chunk-r9xx069j.js")).cmdSync(rest);
    case "mcp":
      return (await import("./chunk-8s2xkq19.js")).cmdMcp(rest);
    case "hook":
      return (await import("./chunk-a75bmh8h.js")).cmdHook(rest);
    case "worker":
      return (await import("./chunk-4qgfrkv0.js")).cmdWorker(rest);
  }
  process.stderr.write(`offload: unknown command: ${cmd}
`);
  process.stderr.write(HELP());
  return 2;
}
main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}, (e) => {
  if (e instanceof ExitError2)
    process.exitCode = e.code;
  else if (e instanceof UsageError2) {
    process.stderr.write(`offload: ${e.message}
`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`offload: ${e?.stack ?? e}
`);
    process.exitCode = 14;
  }
});
