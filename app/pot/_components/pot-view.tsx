"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { TeamPotView } from "@/lib/team-pot/read";
import type { PotPace, PotState } from "@/lib/team-pot/compute";
import {
  POT_ACCEL_BONUS,
  POT_AI_MULTIPLIER,
  POT_BONUS,
  POT_END_LEVEL,
  POT_GATE,
  POT_LAUNCH_DAY,
  POT_LEVELS,
  POT_MAX,
  POT_OFFICIAL_TARGET,
  POT_START,
} from "@/lib/team-pot/config";
import { eur, millions, shortDate, thousands } from "@/lib/team-pot/format";
import styles from "../pot.module.css";

const SCALE_MIN = 2_100_000;
const SCALE_MAX = 3_120_000;
const SEEN_KEY = "pot-seen";

const pct = (v: number) => ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

export function PotView({ view, pace, syncedLabel }: { view: TeamPotView; pace: PotPace; syncedLabel: string | null }) {
  const state = view.ok ? view.state : null;
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [filled, setFilled] = useState(false);
  const [toast, setToast] = useState<ReactNode>(null);
  const [toastOn, setToastOn] = useState(false);

  const confetti = useCallback((n: number) => {
    const cv = canvasRef.current;
    const page = pageRef.current;
    if (!cv || !page || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    ctx.scale(dpr, dpr);
    const cs = getComputedStyle(page);
    const cols = ["--accent", "--tan", "--ink", "--accent-soft"].map((v) => cs.getPropertyValue(v).trim()).concat("#FFC94D");
    const parts = Array.from({ length: n }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? -10 : w + 10,
        y: h * 0.7,
        vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 7),
        vy: -(9 + Math.random() * 9),
        r: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.3,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        c: cols[i % cols.length],
        star: Math.random() < 0.25,
      };
    });
    let frames = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.28;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        if (p.star) {
          ctx.beginPath();
          for (let j = 0; j < 8; j++) {
            const rr = j % 2 ? 2.5 : 7;
            const a = (j * Math.PI) / 4;
            ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 2);
        }
        ctx.restore();
      }
      if (++frames < 220) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    tick();
  }, []);

  // Barre animée au chargement.
  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Célébration de ce qui est tombé dans le pot depuis la dernière visite.
  useEffect(() => {
    if (!state) return;
    let seen: { pot: number; reached: number } | null = null;
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      if (raw) seen = JSON.parse(raw);
    } catch {}
    if (seen && state.pot > seen.pot) {
      const gained = state.pot - seen.pot;
      const newly = state.milestones.filter((m) => m.reached).slice(seen.reached);
      const top = newly[newly.length - 1];
      setToast(
        top ? (
          <>
            Since your last visit: <b>+{eur(gained)}</b> in the pot. We passed {millions(top.level)}.
          </>
        ) : (
          <>
            AI Roleplay deal signed. <b>+{eur(gained)}</b> bonus in the pot.
          </>
        ),
      );
      setToastOn(true);
      confetti(newly.some((m) => m.level > POT_GATE) ? 260 : newly.length ? 160 : 110);
      const t = setTimeout(() => setToastOn(false), 5200);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify({ pot: state.pot, reached: state.reachedCount }));
      } catch {}
      return () => clearTimeout(t);
    }
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify({ pot: state.pot, reached: state.reachedCount }));
    } catch {}
  }, [state, confetti]);

  return (
    <div className={styles.page} ref={pageRef}>
      <canvas className={styles.confetti} ref={canvasRef} aria-hidden="true" />
      <div className={cx(styles.toast, toastOn && styles.toastShow)} role="status" aria-live="polite">
        {toast}
      </div>

      <div className={styles.wrap}>
        <header className={styles.header}>
          <div className={styles.top}>
            <div className={styles.logo}>
              <Image src="/logo.png" alt="" width={28} height={28} />
              <div>
                COACH<span>ELLO</span>
              </div>
            </div>
            <div className={styles.eyebrow}>
              {view.ok && view.ended ? "Final figures · closed on 31 December 2026" : "Team pot · until 31 December 2026"}
            </div>
          </div>
          <h1>
            Every €50k we sign puts money in <em>the pot</em>.
          </h1>
          <p className={styles.sub}>
            One number for the whole company: 2026 revenue. Each time it crosses a €50k milestone, the pot grows by{" "}
            {eur(POT_BONUS)}. Past {millions(POT_GATE)} the accelerator kicks in and every €50k adds {eur(POT_ACCEL_BONUS)}.
            Every AI Roleplay deal earns {POT_AI_MULTIPLIER}x its share on top.
          </p>
        </header>

        {!view.ok ? (
          <div className={styles.banner}>Could not load the pot: {view.error}. Reload the page in a moment.</div>
        ) : !state ? (
          <div className={styles.empty}>
            The pot starts with the first sync of the revenue sheet. Figures appear within the hour.
          </div>
        ) : (
          <PotBody state={state} pace={pace} stale={view.stale} syncedLabel={syncedLabel} filled={filled} />
        )}

        <section className={styles.section} aria-labelledby="h-rules">
          <h2 id="h-rules">How it works</h2>
          <div className={styles.rules}>
            <div className={styles.rule}>
              <h3>What counts</h3>
              <p>
                Invoices in the 2026 Revenue Dashboard (New and Renew) dated from {shortDate(POT_LAUNCH_DAY)} to 31 Dec. We
                start from everything invoiced in 2026 before {shortDate(POT_LAUNCH_DAY)}. The page checks the sheet every
                hour from 8am to 8pm.
              </p>
            </div>
            <div className={styles.rule}>
              <h3>How the pot grows</h3>
              <p>
                {eur(POT_BONUS)} for every €50k from {millions(POT_START)} up to {millions(POT_GATE)}. {eur(POT_ACCEL_BONUS)} for
                every €50k from {millions(POT_GATE)} to {millions(POT_END_LEVEL)}. Maximum {eur(POT_MAX)}. Nothing is ever taken
                back out.
              </p>
            </div>
            <div className={cx(styles.rule, styles.rulePink)}>
              <h3>AI Roleplay bonus: {POT_AI_MULTIPLIER}x</h3>
              <p>
                Every €50k normally adds {eur(POT_BONUS)} ({eur(POT_ACCEL_BONUS)} past {millions(POT_GATE)}), so each euro
                invoiced has a share of the pot. When the invoice is an AI deal, that share counts {POT_AI_MULTIPLIER}x: a €30k
                AI Roleplay deal adds a €300 bonus on top of the milestones (€600 in the accelerator zone).
              </p>
            </div>
            <div className={styles.rule}>
              <h3>What we do with it</h3>
              <p>
                Everyone on the team on 31 December shares it. In January the team votes: split it equally, or spend it on
                something we do together.
              </p>
            </div>
          </div>
        </section>

        <div className={styles.foot}>
          <span>
            {view.ok && view.ended
              ? `Final figures${syncedLabel ? `, last updated ${syncedLabel}` : ""}`
              : syncedLabel
                ? `Updated ${syncedLabel} · checked every hour, 8am to 8pm`
                : "Not synced yet"}
          </span>
          <span>Figures follow the Revenue Dashboard 2026</span>
        </div>
      </div>
    </div>
  );
}

function PotBody({
  state,
  pace,
  stale,
  syncedLabel,
  filled,
}: {
  state: PotState;
  pace: PotPace;
  stale: boolean;
  syncedLabel: string | null;
  filled: boolean;
}) {
  const goalPct = Math.round((state.total / POT_GATE) * 100);
  const ladder = [...state.milestones].reverse();
  const wins = [...state.wins].reverse();

  return (
    <>
      {stale && (
        <div className={styles.banner}>
          Figures not refreshed since {syncedLabel}. The revenue sheet may be unreachable; the numbers below are the last
          known ones.
        </div>
      )}

      <section className={styles.stats} aria-label="Where we stand">
        <div className={cx(styles.card, styles.potCard)}>
          <div className={styles.label}>In the pot</div>
          <div className={cx(styles.big, styles.num)}>{eur(state.pot)}</div>
          <div className={cx(styles.cap, styles.num)}>
            {state.reachedCount} of {POT_LEVELS.length} milestones
            {state.aiBonus > 0 ? ` · incl. ${eur(state.aiBonus)} AI Roleplay bonus` : ""} · {eur(POT_MAX)} + AI bonus at{" "}
            {millions(POT_END_LEVEL)}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.label}>2026 revenue</div>
          <div className={cx(styles.big, styles.num)}>{millions(state.total)}</div>
          <div className={cx(styles.cap, styles.num)}>
            +{thousands(state.added)} since {shortDate(POT_LAUNCH_DAY)} · {goalPct}% of the {millions(POT_GATE)} goal
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.label}>Next milestone</div>
          <div className={cx(styles.big, styles.num)}>{state.next ? millions(state.next.level) : "All done"}</div>
          <div className={cx(styles.cap, styles.num)}>
            {state.next ? `${thousands(state.next.toGo)} to go · +${eur(state.next.bonus)}` : "Every milestone reached"}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.label}>Days left</div>
          <div className={cx(styles.big, styles.num)}>{pace.daysLeft}</div>
          <div className={styles.cap}>until 31 Dec, 23:59</div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="h-track">
        <div className={styles.sectionHead}>
          <h2 id="h-track">
            The road to <em>{millions(POT_END_LEVEL)}</em>
          </h2>
          <span className={styles.eyebrow}>
            Goal {millions(POT_GATE)} · Accelerator {millions(POT_GATE)} to {millions(POT_END_LEVEL)}
          </span>
        </div>
        <div className={styles.trackbox}>
          <div className={styles.track}>
            <div className={styles.zonelabel} style={{ left: `${pct(POT_START)}%` }}>
              Goal zone · {thousands(POT_BONUS)} per €50k
            </div>
            <div className={cx(styles.zonelabel, styles.zonelabelAccel)} style={{ left: `${pct(POT_GATE)}%` }}>
              Accelerator · {thousands(POT_ACCEL_BONUS)}
            </div>
            <div className={styles.bar}>
              <div
                className={cx(styles.zone, styles.zoneBase)}
                style={{ left: `${pct(POT_START)}%`, width: `${pct(POT_GATE) - pct(POT_START)}%` }}
              />
              <div
                className={cx(styles.zone, styles.zoneAccel)}
                style={{ left: `${pct(POT_GATE)}%`, width: `${pct(POT_END_LEVEL) - pct(POT_GATE)}%` }}
              />
              {/* 0 puis la vraie largeur après le montage : la barre se remplit à l'ouverture. */}
              <div className={styles.fill} style={{ width: filled ? `${clamp(pct(state.total), 0, 100)}%` : 0 }} />
            </div>
            {state.milestones.map((m) => (
              <div key={m.level}>
                <div className={cx(styles.tick, m.reached && styles.tickHit)} style={{ left: `${pct(m.level)}%` }} />
                <div
                  className={cx(styles.coin, m.reached && styles.coinHit, m.bonus > POT_BONUS && styles.coinBig)}
                  style={{ left: `${pct(m.level)}%` }}
                  title={`${millions(m.level)}: +${eur(m.bonus)}`}
                />
              </div>
            ))}
            <div
              className={styles.marker}
              style={{ left: `${pct(POT_OFFICIAL_TARGET)}%` }}
              title={`Official 2026 target ${millions(POT_OFFICIAL_TARGET)}`}
            />
            {[
              { v: POT_START, minor: false },
              { v: 2_500_000, minor: true },
              { v: POT_GATE, minor: false },
              { v: POT_END_LEVEL, minor: false },
            ].map(({ v, minor }) => (
              <div key={v} className={cx(styles.axis, minor && styles.axisMinor)} style={{ left: `${pct(v)}%` }}>
                {millions(v)}
              </div>
            ))}
            <div className={cx(styles.youarehere, styles.num)} style={{ left: `${clamp(pct(state.total), 6, 92)}%` }}>
              {millions(state.total)}
            </div>
          </div>
          <div className={styles.pace}>
            <div>
              To {millions(POT_GATE)}: <b className={styles.num}>{thousands(pace.toGate)}</b> left
              {pace.toGate > 0 ? (
                <>
                  {" "}
                  · <span className={styles.num}>{thousands(pace.perWeekToGate)}</span> a week
                </>
              ) : (
                " · reached"
              )}
            </div>
            <div>
              To {millions(POT_END_LEVEL)}: <b className={styles.num}>{thousands(pace.toEnd)}</b> left
              {pace.toEnd > 0 ? (
                <>
                  {" "}
                  · <span className={styles.num}>{thousands(pace.perWeekToEnd)}</span> a week
                </>
              ) : (
                " · reached"
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="h-ladder">
        <div className={styles.sectionHead}>
          <h2 id="h-ladder">Milestones</h2>
          <span className={styles.eyebrow}>Who pushed us over each one</span>
        </div>
        <div className={styles.ladder}>
          {ladder.map((m) => {
            const isNext = state.next?.level === m.level;
            const who = m.reached
              ? m.crossedBy
                ? [m.crossedBy.company, m.crossedBy.owner].filter(Boolean).join(" · ")
                : "Reached"
              : isNext
                ? `${thousands(m.level - state.total)} to go`
                : `Pot reaches ${eur(m.potAt)}`;
            return (
              <div
                key={m.level}
                className={cx(
                  styles.rung,
                  m.bonus > POT_BONUS && styles.rungAccel,
                  m.reached && styles.rungHit,
                  isNext && styles.rungNext,
                  m.level === POT_GATE && styles.rungGate,
                )}
              >
                <div className={cx(styles.lvl, styles.num)}>{millions(m.level)}</div>
                <div className={cx(styles.add, styles.num)}>+{eur(m.bonus)}</div>
                <div className={styles.who}>{who}</div>
                {m.reached ? (
                  <span className={cx(styles.chip, styles.chipHit)}>Reached</span>
                ) : isNext ? (
                  <span className={cx(styles.chip, styles.chipNext)}>Next</span>
                ) : (
                  <span className={styles.chip}>Locked</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="h-wins">
        <div className={styles.sectionHead}>
          <h2 id="h-wins">Wins since launch</h2>
          {wins.length > 0 && (
            <span className={cx(styles.eyebrow, styles.num)}>
              {wins.length} win{wins.length > 1 ? "s" : ""} · {thousands(state.added)} added
            </span>
          )}
        </div>
        <div className={styles.wins}>
          {wins.length === 0 ? (
            <div className={styles.empty}>
              No invoice dated since {shortDate(POT_LAUNCH_DAY)} yet.
              {state.next ? ` The first ${thousands(state.next.toGo)} gets us to the first milestone.` : ""}
            </div>
          ) : (
            wins.map((w) => (
              <div key={w.key} className={styles.win}>
                <div className={styles.winClient}>
                  {w.company}
                  <span className={cx(styles.type, w.kind === "New" && styles.typeNew)}>{w.kind}</span>
                  {w.isAi && <span className={styles.rpchip}>AI Roleplay {POT_AI_MULTIPLIER}x</span>}
                </div>
                <div className={cx(styles.winAmount, styles.num)}>+{thousands(w.amount)}</div>
                <div className={styles.winMeta}>{[w.owner, shortDate(w.date)].filter(Boolean).join(" · ")}</div>
                <div className={cx(styles.winBonus, styles.num)}>{w.aiBonus ? `+${eur(w.aiBonus)} pot bonus` : ""}</div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
