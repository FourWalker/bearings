/**
 * The checks a thread ran (tests, lint, typecheck, build) and how each ended, read from the
 * commands its provider reported. A result is recorded only when the command shows whose exit
 * code it is.
 *
 * @module board/boardChecks
 */
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

type CommandItem = Pick<
  Extract<OrchestrationV2TurnItem, { type: "command_execution" }>,
  "input" | "output" | "exitCode" | "status"
> & { readonly nativeItemRef?: { readonly driver: string } | null | undefined };

export interface RanCheck {
  readonly command: string;
  readonly exitCode: number;
}

const CHECK =
  /^(?:(?:vp|npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|check(?::changed)?|build)|(?:npx\s+)?(?:vitest|tsc)|(?:go|cargo|dotnet)\s+test|(?:mvn|gradle|\.[/\\](?:mvnw|gradlew)(?:\.(?:cmd|bat))?)(?:\s+-(?:pl|f)\s+\S+|\s+-\S+)*\s+(?:test|verify)|(?:python\d?\s+-m\s+)?pytest|git\s+diff\s+--check)(?=\s|$)/;

const CLAUDE = "claudeAgent";

/** Claude reports no exit code: a failed command's result opens with it, and a completed one is 0. */
function exitCodeOf(item: CommandItem): number | undefined {
  if (item.exitCode !== undefined) return item.exitCode;
  if (item.nativeItemRef?.driver !== CLAUDE) return undefined;
  const output = item.output ?? "";
  if (item.status === "failed") {
    const code = /^(?:Error: )?Exit code (\d+)/.exec(output)?.[1];
    return code === undefined ? undefined : Number(code);
  }
  // A command sent to the background is reported completed while it still runs.
  if (item.status !== "completed" || output.startsWith("Command running in background"))
    return undefined;
  return 0;
}

/** The codes `echo "exit $?"` printed, by statement; left out when echoes and lines don't pair up. */
function echoedCodes(
  statements: ReadonlyArray<string>,
  output: string,
): ReadonlyMap<number, number> {
  const byTemplate = new Map<string, number[]>();
  statements.forEach((statement, index) => {
    const text =
      /^echo\s+(?:"([^"$`\\]*\$\?[^"$`\\]*)"|([^"'$`\\)]*\$\?[^"'$`\\)&|]*))\s*\)?$/.exec(
        statement,
      );
    const template = (text?.[1] ?? text?.[2])?.trim();
    if (template === undefined) return;
    byTemplate.set(template, [...(byTemplate.get(template) ?? []), index]);
  });
  const codes = new Map<number, number>();
  for (const [template, indexes] of byTemplate) {
    const [before, after] = template
      .split("$?")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const printed = [...output.matchAll(new RegExp(`^${before}(\\d{1,3})${after}\\s*$`, "gm"))];
    if (printed.length !== indexes.length) continue;
    indexes.forEach((index, at) => codes.set(index, Number(printed[at]?.[1])));
  }
  return codes;
}

const balanced = (text: string) =>
  text.split('"').length % 2 === 1 && text.split("'").length % 2 === 1;

export function checksOf(item: CommandItem): ReadonlyArray<RanCheck> {
  // Codex reports the Windows shell invocation rather than the command inside it.
  const powershell =
    /^(?:"(?:[^"\r\n]*[/\\])?(?:powershell|pwsh)(?:\.exe)?"|(?:powershell|pwsh)(?:\.exe)?)(?:\s+-(?:NoProfile|NoLogo|NonInteractive))*\s+-Command\s+(['"])(.*)\1$/i.exec(
      item.input.trim(),
    );
  const script = powershell?.[2] ?? item.input;
  // A here-document's lines are text, not commands.
  if (script.includes("<<")) return [];
  const statements = script
    .split(/[\r\n;]+/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  const printed = echoedCodes(statements, item.output ?? "");
  const last = statements.length - 1;
  const ran: RanCheck[] = [];
  statements.forEach((statement, index) => {
    const setup = statement.split(/\s*&&\s*/);
    const alone = (setup.pop() ?? "").replace(/^\(\s*/, "");
    const command = CHECK.exec(alone)?.[0].replace(/\s+/g, " ");
    if (command === undefined) return;
    // Two checks joined by && share one code.
    if (setup.some((part) => CHECK.test(part) || part.includes("||"))) return;
    // An open quote means this is text inside a longer string.
    if (!balanced(alone)) return;
    // Where the output goes ("> file", "*> file", "2>&1") doesn't change what ran.
    if (/[&|]/.test(alone.replace(/\s(?:\*|\d)?>>?\s*(?:&\d|[^\s&|]+)/g, ""))) return;
    const kept = /^\$?(\w+)\s*=\s*\$(?:LASTEXITCODE|\?)$/i.exec(statements[index + 1] ?? "")?.[1];
    const passedOn =
      kept !== undefined && statements[last]?.toLowerCase() === `exit $${kept.toLowerCase()}`;
    const exitCode =
      printed.get(index + 1) ?? (index === last || passedOn ? exitCodeOf(item) : undefined);
    // 126 and 127 mean the command never started.
    if (exitCode !== undefined && exitCode !== 126 && exitCode !== 127)
      ran.push({ command, exitCode });
  });
  return ran;
}
