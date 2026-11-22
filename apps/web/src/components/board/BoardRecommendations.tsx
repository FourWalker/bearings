import type { BoardTask, BoardView } from "@t3tools/contracts";
import { T, useGT } from "gt-react";

import { Badge } from "~/components/ui/badge";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";

import {
  ancestorsOf,
  recommendationsOf,
  type BoardIndex,
  type RecommendationFilter,
} from "./board.logic";

function registerUrl(url: string): string | undefined {
  const parsed = URL.parse(url);
  return parsed?.protocol === "https:" || parsed?.protocol === "http:" ? parsed.href : undefined;
}

export function BoardRecommendations(props: {
  readonly index: BoardIndex;
  readonly registers: NonNullable<BoardView["registers"]>;
  readonly filter: RecommendationFilter;
  readonly onFilterChange: (filter: RecommendationFilter) => void;
  readonly onOpen: (task: BoardTask) => void;
}) {
  const gt = useGT();
  const all = recommendationsOf(props.index);
  const open = all.filter(({ decision }) => decision.status === "open");
  const decided = all.filter(({ decision }) => decision.status !== "open");
  const rows = { open, decided, all }[props.filter];
  const registers = props.registers.flatMap((register) => {
    const href = registerUrl(register.url);
    return href ? [{ ...register, href }] : [];
  });

  return (
    <section aria-labelledby="board-register-title" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="board-register-title" className="font-medium text-lg">
          <T>Recommendations register</T>
        </h2>
        <ToggleGroup
          aria-label={gt("Recommendation status")}
          value={[props.filter]}
          onValueChange={([next]) => {
            if (next === "open" || next === "decided" || next === "all") props.onFilterChange(next);
          }}
        >
          <Toggle value="open">{gt("Open ({count})", { count: open.length })}</Toggle>
          <Toggle value="decided">{gt("Resolved ({count})", { count: decided.length })}</Toggle>
          <Toggle value="all">{gt("All ({count})", { count: all.length })}</Toggle>
        </ToggleGroup>
      </div>
      {registers.length > 0 && (
        <nav
          aria-label={gt("External registers")}
          className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
        >
          {registers.map(({ id, href, topic }) => (
            <a key={id} href={href} target="_blank" rel="noreferrer" className="underline">
              {topic}
            </a>
          ))}
        </nav>
      )}
      {rows.length === 0 ? (
        <p className="rounded-lg border p-5 text-muted-foreground text-sm">
          <T>No recommendations match this filter.</T>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-160 text-start text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-start">
                  R#
                </th>
                <th scope="col" className="px-3 py-2 text-start">
                  <T>Area</T>
                </th>
                <th scope="col" className="px-3 py-2 text-start">
                  <T>Recommendation</T>
                </th>
                <th scope="col" className="px-3 py-2 text-start">
                  <T>Task</T>
                </th>
                <th scope="col" className="px-3 py-2 text-start">
                  <T>Status</T>
                </th>
                <th scope="col" className="px-3 py-2 text-start">
                  <T>Decision</T>
                </th>
                <th scope="col" className="px-3 py-2 text-start">
                  <T>Implementation</T>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ decision, r, task, owner }) => {
                const rec = decision.recommendation;
                const register = registers.find(
                  ({ id, topic }) => id === rec?.register || topic === rec?.register,
                );
                return (
                  <tr key={`${owner.id}:${decision.id}`} className="border-t align-top">
                    <td className="px-3 py-2 font-mono">
                      {register ? (
                        <a
                          href={register.href}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`${r} · ${register.topic}`}
                          className="underline"
                        >
                          {r}
                        </a>
                      ) : (
                        r
                      )}
                    </td>
                    <td className="wrap-anywhere px-3 py-2">{rec?.area}</td>
                    <td className="wrap-anywhere px-3 py-2">
                      <button
                        type="button"
                        className="text-start font-medium hover:underline"
                        onClick={() => props.onOpen(task)}
                      >
                        {decision.title}
                      </button>
                      {rec?.description && (
                        <p className="line-clamp-3 text-muted-foreground">{rec.description}</p>
                      )}
                    </td>
                    <td className="wrap-anywhere px-3 py-2">
                      {[...ancestorsOf(props.index, task), task]
                        .map((node) => node.title)
                        .join(" › ")}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary">
                        {decision.status === "open"
                          ? gt("Open")
                          : decision.status === "decided"
                            ? gt("Decided")
                            : gt("Dropped")}
                      </Badge>
                    </td>
                    <td className="wrap-anywhere px-3 py-2">{rec?.verdict}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {rec?.implemented
                        ? gt("Recorded")
                        : decision.status === "decided" && rec
                          ? gt("Pending")
                          : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
