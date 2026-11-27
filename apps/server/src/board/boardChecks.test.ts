import { describe, expect, it } from "vite-plus/test";

import { checksOf, type RanCheck } from "./boardChecks.ts";

const claude = (input: string, output = "", status: "completed" | "failed" = "completed") =>
  checksOf({ input, output, status, nativeItemRef: { driver: "claudeAgent" } });

const ran = (command: string, exitCode: number): RanCheck => ({ command, exitCode });

describe("checksOf", () => {
  // Shapes taken from real Claude threads, which report no exit code.
  it.each<[string, string, string, RanCheck[]]>([
    ["a check alone", "npm test", "", [ran("npm test", 0)]],
    ["after cd", "cd /c/fe && npx vitest run a.ts > t.log 2>&1", "", [ran("npx vitest", 0)]],
    [
      "a printed code",
      'cd /c/be; mvn -B test -Dtest=A > c.log 2>&1; echo "exit=$?"; grep BUILD c.log | tail -8',
      "exit=1\n[INFO] BUILD FAILURE",
      [ran("mvn -B test", 1)],
    ],
    ["a subshell", "(mvn test > $L 2>&1; echo rc $?) ; tail $L", "rc 0\nok", [ran("mvn test", 0)]],
    [
      "two checks, each printed",
      "vp test run > a.log; echo rc $?; tail a.log; vp run typecheck > b.log; echo rc $?",
      "rc 0\n36 passed\nrc 2",
      [ran("vp test", 0), ran("vp run typecheck", 2)],
    ],
    ["a log line like the echo", "vp test > a.log; echo rc $?; cat a.log", "rc 0\nrc 1", []],
    ["the code lost to a pipe", "npm test 2>&1 | tail -5", "ok", []],
    ["the code lost to a later command", "npm test > a.log; tail a.log", "ok", []],
    ["two checks on one code", "npm run lint && npm test", "", []],
    ["sent to the background", "npm test", "Command running in background with ID: b1.", []],
    ["a here-document", "cat > f <<'EOF'\nnpm test", "", []],
    ["quoted text", 'git commit -m "fix\n\nnpm test passes"', "", []],
    ["a command not found", "vp test; echo rc $?", "rc 127", []],
    ["a single-quoted echo", "npm test; echo 'rc $?'", "rc 0", []],
  ])("%s", (_name, input, output, expected) => {
    expect(claude(input, output)).toEqual(expected);
  });

  it("reads a failed Claude command's code from its result", () => {
    expect(claude("npm test", "Error: Exit code 3\nboom", "failed")).toEqual([ran("npm test", 3)]);
    expect(claude("npm test", "The user rejected this command.", "failed")).toEqual([]);
  });

  it("does not guess for another provider that reports no exit code", () => {
    expect(checksOf({ input: "npm test", output: "", status: "completed" })).toEqual([]);
  });
});
