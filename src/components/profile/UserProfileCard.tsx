type NightSpot = {
  name: string;
  area: string;
  date: string;
};

type UserProfileCardProps = {
  displayName: string;
  memberId: string;
  foundSpots: NightSpot[];
  favoriteSpots: NightSpot[];
};

function StatPill({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="min-w-[74px] rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-center">
      <div className="text-[10px] text-white/60">{label}</div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-white/50">
      {text}
    </div>
  );
}

function parseDateSafe(s: string): Date | null {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatWhenParts(dateStr: string): { primary: string; secondary?: string } {
  const d = parseDateSafe(dateStr);
  if (!d) return { primary: dateStr };

  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());

  const hasTime = /[:T]/.test(dateStr) && !(hh === "00" && mi === "00");
  if (hasTime) return { primary: `${hh}:${mi}`, secondary: `${mm}/${dd}` };

  return { primary: `${mm}/${dd}`, secondary: `${yyyy}` };
}

export function UserProfileCard({
  displayName,
  memberId,
  foundSpots,
  favoriteSpots,
}: UserProfileCardProps) {
  const foundCount = foundSpots.length;
  const favoriteCount = favoriteSpots.length;

  const recentFound = [...foundSpots]
    .sort((a, b) => {
      const da = parseDateSafe(a.date)?.getTime();
      const db = parseDateSafe(b.date)?.getTime();
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return db - da;
    })
    .slice(0, 4);
  const recentFav = favoriteSpots.slice(0, 3);

  return (
    <div className="rounded-xl border border-white/10 bg-black/50 p-3 text-white shadow-lg backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 text-lg font-semibold">
          {displayName?.trim()?.charAt(0) ?? "?"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white/90">
            {displayName}
          </div>
          <div className="text-[11px] text-white/60">
            Member <span className="font-mono text-white/70">{memberId}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StatPill label="発見数" value={foundCount} />
          <StatPill label="お気に入り" value={favoriteCount} />
        </div>
      </div>

      {/* Recently found */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] text-white/60">最近見つけた夜景</div>
          <div className="text-[10px] text-white/40">最新 {Math.min(foundCount, 4)} 件</div>
        </div>

        {recentFound.length === 0 ? (
          <div className="mt-2">
            <EmptyState text="まだ発見した夜景がありません。地図で夜景スポットを探してみましょう。" />
          </div>
        ) : (
          <ol
            className="relative mt-2 space-y-2 pl-6
      before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-white/10"
          >
            {recentFound.map((spot, i) => {
              const when = formatWhenParts(spot.date);
              return (
                <li key={`${spot.name}-${spot.date}-${i}`} className="relative flex items-start gap-3">
                  <div className="absolute left-[12px] top-3 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-white/30 bg-black/80" />
                  <div className="w-14 shrink-0 pt-1 text-right text-[10px] tabular-nums text-white/50 leading-tight">
                    <div className="text-white/70">{when.primary}</div>
                    {when.secondary ? <div className="text-white/45">{when.secondary}</div> : null}
                  </div>
                  <div className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                    <div className="truncate text-xs text-white/90">{spot.name}</div>
                    <div className="truncate text-[10px] text-white/50">{spot.area}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Favorites */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] text-white/60">お気に入り</div>
          <div className="text-[10px] text-white/40">表示 {Math.min(favoriteCount, 3)} 件</div>
        </div>

        <div className="mt-2 space-y-2">
          {recentFav.length === 0 ? (
            <EmptyState text="お気に入りはまだありません。気に入った夜景を登録しておくと便利です。" />
          ) : (
            recentFav.map((spot, i) => (
              <div
                key={`${spot.name}-${spot.date}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs text-white/90">{spot.name}</div>
                  <div className="truncate text-[10px] text-white/50">{spot.area}</div>
                </div>
                <div className="shrink-0 text-right text-[10px] tabular-nums text-white/50">
                  {spot.date}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-2 text-[10px] text-white/50">
          お気に入り登録 <span className="tabular-nums">{favoriteCount}</span> 件
        </div>
      </div>
    </div>
  );
}
