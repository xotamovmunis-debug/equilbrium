import { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ============================================================
   EQUILIBRIUM — AP Micro & Macro
   Routes: #/  #/micro  #/macro  #/micro/3  #/tutor  #/admin
   Admin is unlinked. Reach it with #/admin or Ctrl/Cmd+Shift+A.
   Data lives in Supabase. Student progress and theme live in localStorage.
   ============================================================ */

const UNITS = {
  micro: [
    { n: 1, title: "Supply, demand and elasticity", weight: 13, blurb: "Trade, supply and demand, elasticity, marginal analysis" },
    { n: 2, title: "Surplus, taxes and trade", weight: 22, blurb: "Surpluses, deadweight loss, price controls, taxes, tariffs" },
    { n: 3, title: "Production, cost and perfect competition", weight: 23, blurb: "Production function, cost curves, economies of scale, perfect competition" },
    { n: 4, title: "Imperfect competition", weight: 18, blurb: "Monopoly, price discrimination, oligopoly, game theory, monopolistic competition" },
    { n: 5, title: "Factor markets", weight: 11, blurb: "Factor market basics, resource combinations, monopsony" },
    { n: 6, title: "Market failure and inequality", weight: 10, blurb: "Externalities, types of goods, government intervention, inequality" },
  ],
  macro: [
    { n: 1, title: "Basic economic concepts", weight: 8, blurb: "PPC, opportunity cost, comparative advantage" },
    { n: 2, title: "Economic indicators and the business cycle", weight: 14, blurb: "GDP, unemployment, inflation, the business cycle" },
    { n: 3, title: "National income and price determination", weight: 22, blurb: "AD-AS, multipliers, fiscal policy and automatic stabilizers" },
    { n: 4, title: "Financial sector", weight: 20, blurb: "Money, balance sheets, money market, monetary policy, loanable funds" },
    { n: 5, title: "Long-run consequences of stabilization policies", weight: 25, blurb: "Phillips curve, quantity theory, debt, crowding out, growth" },
    { n: 6, title: "Open economy: international trade and finance", weight: 11, blurb: "Balance of payments, foreign exchange, capital flows" },
  ],
};

/* College Board CED topic breakdown. Titles can be edited here if the
   Board revises its wording; the numbers are what the exam uses. */
const TOPICS = {
  micro: {
    1: [["1.1","Trade, supply and demand"],["1.2","Elasticity"],["1.3","Marginal analysis"]],
    2: [["2.1","Surpluses, deadweight loss and price controls"],["2.2","Taxes"],["2.3","Trade and tariffs"]],
    3: [["3.1","Production function"],["3.2","Revenue, cost, profit and cost curves"],["3.3","Short run and long run, SRATC and LRATC, economies of scale"],["3.4","Perfect competition"]],
    4: [["4.1","Monopoly and price discrimination"],["4.2","Oligopoly and game theory"],["4.3","Monopolistic competition"]],
    5: [["5.1","Factor markets intro and perfect competition"],["5.2","Resource combinations and monopsony"]],
    6: [["6.1","Externalities and efficiency"],["6.2","Types of goods, government intervention, inequality"]],
  },
  macro: {
    1: [["1.1","PPC, opportunity cost and comparative advantage"]],
    2: [["2.1","GDP"],["2.2","Unemployment"],["2.3","Inflation"],["2.4","Business cycle"]],
    3: [["3.1","AD-AS model"],["3.2","Long-run adjustments, propensities and multipliers"],["3.3","Fiscal policy and automatic stabilizers"]],
    4: [["4.1","Financial assets and money"],["4.2","Balance sheets and the money multiplier"],["4.3","Money market"],["4.4","Monetary policy and the loanable funds market"]],
    5: [["5.1","Policy interactions, Phillips curve, quantity theory"],["5.2","National budget and debt, crowding out, economic growth"]],
    6: [["6.1","Balance of payments"],["6.2","Foreign exchange market"],["6.3","FOREX, net exports, interest rates and capital flows"]],
  },
};
const topicTitle = (subject, code) => {
  const u = Number(String(code).split(".")[0]);
  const row = (TOPICS[subject]?.[u] || []).find((t) => t[0] === code);
  return row ? row[1] : "";
};

const SNAME = { micro: "Microeconomics", macro: "Macroeconomics" };
const SSHORT = { micro: "Micro", macro: "Macro" };
const L = ["A", "B", "C", "D", "E", "F"];

import { supabase } from "./db";
import {
  configured, loadBank, upsertQuestions, deleteQuestion, upsertMaterial, deleteMaterial,
  saveBands, recordSessionRow, loadSessions, signIn, signUp, signOut, getSession, onAuth,
  isAdmin, loadProgress, saveProgress, askTutor, loadMe, saveMe,
  sendReset, updatePassword, uploadImage,
} from "./db";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const pct = (c, a) => (a ? Math.round((c / a) * 100) : null);
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/* ---------------------------- AP scoring ----------------------------
   Exam structure (College Board CED, both courses):
     Section I  — 60 multiple choice  = 60 composite points (66.7%)
     Section II — 3 FRQ, 1 long (10) + 2 short (5 each) = 20 raw,
                  scaled to 30 composite points (33.3%)
     Composite is out of 90.
   College Board does not publish the raw-to-1-5 conversion table; it is
   re-set after each administration. The bands below are the widely used
   estimates from released exams and recent score distributions, and they
   are editable in the console under Settings.
--------------------------------------------------------------------- */

const DEFAULT_BANDS = {
  micro: { five: 73, four: 57, three: 44, two: 31 },
  macro: { five: 71, four: 55, three: 43, two: 32 },
};
const MCQ_POINTS = 60, FRQ_RAW = 20, FRQ_POINTS = 30, COMPOSITE = 90;

function apScore(composite, b) {
  if (composite >= b.five) return 5;
  if (composite >= b.four) return 4;
  if (composite >= b.three) return 3;
  if (composite >= b.two) return 2;
  return 1;
}
const bandRange = (b) => [
  { s: 5, lo: b.five, hi: COMPOSITE },
  { s: 4, lo: b.four, hi: b.five - 1 },
  { s: 3, lo: b.three, hi: b.four - 1 },
  { s: 2, lo: b.two, hi: b.three - 1 },
  { s: 1, lo: 0, hi: b.two - 1 },
];

/* Build a mock paper: draw from the bank in CED unit proportions, and
   inside each unit aim for roughly 25% easy / 50% medium / 25% hard. */
function buildMock(questions, subject) {
  const pool = questions.filter((q) => q.subject === subject);
  if (!pool.length) return [];
  const target = Math.min(60, pool.length);
  const units = UNITS[subject];
  const totalW = units.reduce((s, u) => s + u.weight, 0);
  const mix = { easy: 0.25, medium: 0.5, hard: 0.25 };
  const used = new Set();
  const out = [];

  units.forEach((u) => {
    const want = Math.round((target * u.weight) / totalW);
    const inUnit = shuffle(pool.filter((q) => q.unit === u.n));
    const buckets = {
      easy: inUnit.filter((q) => q.difficulty === "easy"),
      medium: inUnit.filter((q) => q.difficulty === "medium"),
      hard: inUnit.filter((q) => q.difficulty === "hard"),
    };
    ["medium", "easy", "hard"].forEach((d) => {
      const n = Math.round(want * mix[d]);
      buckets[d].slice(0, n).forEach((q) => { if (!used.has(q.id)) { used.add(q.id); out.push(q); } });
    });
    inUnit.forEach((q) => {
      if (out.filter((x) => x.unit === u.n).length >= want) return;
      if (!used.has(q.id)) { used.add(q.id); out.push(q); }
    });
  });

  shuffle(pool).forEach((q) => { if (out.length < target && !used.has(q.id)) { used.add(q.id); out.push(q); } });
  return shuffle(out).slice(0, target);
}

const askClaude = (messages, system, maxTokens = 1200) => askTutor(messages, system, maxTokens);

/* ---------------------------- styles ---------------------------- */

const CSS = `
@import url('https://api.fontshare.com/v2/css?f[]=stardom@400&f[]=satoshi@400,500,700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap');

.eq,.eq *{box-sizing:border-box;}
.eq{
  --bg:#070A12; --bg2:#0A0E1A; --surf:#111726; --surf2:#161E30; --surfhi:#1C2537;
  --line:#212B41; --line2:#2E3A55;
  --tx:#EEF2FA; --tx2:#9EAAC2; --tx3:#68738C;
  --micro:#F0A93A; --macro:#2FC0CD; --onacc:#04070E;
  --ok:#35D18A; --no:#FF6E6E; --okbg:rgba(53,209,138,.10); --nobg:rgba(255,110,110,.10);
  --pgrid:#1A2234; --paxis:#3A465F; --markbg:#0E1524; --markline:#293349;
  --navbg:rgba(7,10,18,.8); --glowA:rgba(47,192,205,.13); --glowB:rgba(240,169,58,.09);
  --shadow:0 30px 80px -30px rgba(0,0,0,.9);
  --accent:var(--macro);
  font-family:'Satoshi','Inter',system-ui,-apple-system,sans-serif;
  background:var(--bg); color:var(--tx); min-height:100vh;
  font-size:16px; line-height:1.55; -webkit-font-smoothing:antialiased;
  position:relative; overflow-x:hidden;
  transition:background .25s,color .25s;
}
.eq.light{
  --bg:#F4ECDE; --bg2:#FBF5EB; --surf:#FFFBF4; --surf2:#F1E7D7; --surfhi:#E7DAC6;
  --line:#E3D7C4; --line2:#CDBBA0;
  --tx:#1E1810; --tx2:#544A3B; --tx3:#867A67;
  --micro:#A8630A; --macro:#0A7A87; --onacc:#FFFFFF;
  --ok:#3A6B2C; --no:#A93226; --okbg:rgba(58,107,44,.10); --nobg:rgba(169,50,38,.08);
  --pgrid:#EBE0CE; --paxis:#B6A88F; --markbg:#FFFBF4; --markline:#DCCDB6;
  --navbg:rgba(244,236,222,.85); --glowA:rgba(10,122,135,.09); --glowB:rgba(168,99,10,.09);
  --shadow:0 18px 44px -22px rgba(80,60,30,.28);
}
.eq::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(680px 420px at 78% -8%,var(--glowA),transparent 70%),
             radial-gradient(560px 380px at 8% 4%,var(--glowB),transparent 70%);}
.eq .z{position:relative;z-index:1;}
.eq h1,.eq h2,.eq h3,.eq h4,.eq .wm{font-family:'Stardom','Playfair Display',Georgia,serif;
  font-weight:400;letter-spacing:-.012em;line-height:1.06;margin:0;}
.eq .ed{}
.eq .num{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;}
.eq button{font-family:inherit;font-size:inherit;cursor:pointer;color:inherit;}
.eq :focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px;}
.eq .wrap{max-width:1120px;margin:0 auto;padding:0 24px;}

.eq .nav{position:sticky;top:0;z-index:40;backdrop-filter:blur(14px);background:var(--navbg);
  border-bottom:1px solid var(--line);}
.eq .navin{display:flex;align-items:center;justify-content:space-between;height:62px;gap:18px;}
.eq .logo{display:flex;align-items:center;gap:10px;background:none;border:0;padding:0;}
.eq .logo .wm{font-size:19px;letter-spacing:-.01em;}
.eq .nlinks{display:flex;align-items:center;gap:4px;}
.eq .nlink{background:none;border:0;padding:7px 13px;border-radius:8px;font-size:14px;color:var(--tx2);}
.eq .nlink:hover,.eq .nlink.on{color:var(--tx);background:var(--surf2);}
.eq .tgl{background:none;border:1px solid var(--line);border-radius:8px;width:32px;height:32px;
  display:flex;align-items:center;justify-content:center;color:var(--tx2);margin-left:6px;}
.eq .tgl:hover{color:var(--tx);border-color:var(--line2);}

.eq .hero{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;padding:72px 0 64px;}
.eq .hero h1{font-size:clamp(42px,5.8vw,72px);font-weight:400;letter-spacing:-.02em;line-height:1.02;}
.eq .hero h1 .g{background:linear-gradient(96deg,var(--micro),var(--macro));-webkit-background-clip:text;
  background-clip:text;color:transparent;}
.eq .hero p{color:var(--tx2);font-size:17.5px;line-height:1.62;margin:22px 0 0;max-width:46ch;}
.eq .heroact{display:flex;gap:12px;margin-top:32px;flex-wrap:wrap;}
.eq .plotbox{position:relative;border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden;
  background:linear-gradient(168deg,#0C544B,#093A34);box-shadow:var(--shadow);}
.eq .plotbox .readout{border-top-color:rgba(255,255,255,.14);}
.eq .plotbox .readout div + div{border-left-color:rgba(255,255,255,.14);}
.eq .plotbox .readout .k{color:#9BC6BC;}
.eq .plotbox .readout .v{color:#EAF6F3;}
.eq .plotbox .draghint{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:#DCEFEA;}
.eq .plotbox svg{display:block;width:100%;height:auto;}
.eq .readout{display:flex;border-top:1px solid var(--line);}
.eq .readout div{flex:1;padding:12px 16px;}
.eq .readout div + div{border-left:1px solid var(--line);}
.eq .readout .k{font-size:11px;color:var(--tx3);}
.eq .readout .v{font-family:'JetBrains Mono',monospace;font-size:19px;font-weight:600;margin-top:2px;}

.eq .btn{display:inline-flex;align-items:center;gap:9px;background:var(--tx);color:var(--bg);
  border:1px solid var(--tx);border-radius:10px;padding:12px 22px;font-weight:600;font-size:15px;
  transition:transform .14s,filter .14s;}
.eq .btn:hover{filter:brightness(1.12);transform:translateY(-1px);}
.eq .btn:disabled{opacity:.32;cursor:not-allowed;transform:none;}
.eq .btn.ghost{background:transparent;color:var(--tx);border-color:var(--line2);}
.eq .btn.ghost:hover{background:var(--surf2);border-color:var(--tx3);filter:none;}
.eq .btn.acc{background:var(--accent);border-color:var(--accent);color:var(--onacc);}
.eq .btn.sm{padding:8px 15px;font-size:13.5px;border-radius:8px;}
.eq .mini{background:var(--surf);border:1px solid var(--line);border-radius:7px;padding:5px 11px;
  font-size:12.5px;color:var(--tx2);}
.eq .mini:hover{color:var(--tx);border-color:var(--line2);}
.eq .mini.danger:hover{color:var(--no);border-color:var(--no);}
.eq .hint{font-size:13px;color:var(--tx3);}

.eq .courses{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding-bottom:22px;}
.eq .course{position:relative;text-align:left;border:1px solid var(--line);border-radius:18px;
  background:linear-gradient(180deg,var(--surf),var(--bg2));padding:28px;overflow:hidden;box-shadow:var(--shadow);
  transition:border-color .3s cubic-bezier(.2,.7,.3,1),transform .3s cubic-bezier(.2,.7,.3,1),box-shadow .3s;}
/* the wash of colour that fills the card */
.eq .course::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s;
  background:radial-gradient(520px 300px at 85% -10%,var(--accent),transparent 62%),
             radial-gradient(360px 260px at 10% 110%,var(--accent),transparent 66%);}
/* a bright rim that lights along the top edge */
.eq .course::before{content:'';position:absolute;inset:0;border-radius:18px;pointer-events:none;opacity:0;
  transition:opacity .35s;
  background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 85%,transparent),transparent 42%);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;mask-composite:exclude;padding:1px;}
.eq .course:hover,.eq .course:focus-visible{
  transform:translateY(-6px);
  border-color:color-mix(in srgb,var(--accent) 45%,var(--line));
  box-shadow:var(--shadow),0 0 0 1px color-mix(in srgb,var(--accent) 22%,transparent),
             0 26px 60px -24px color-mix(in srgb,var(--accent) 70%,transparent);}
.eq .course:hover::after,.eq .course:focus-visible::after{opacity:.26;}
.eq .course:hover::before,.eq .course:focus-visible::before{opacity:1;}
.eq.light .course:hover::after,.eq.light .course:focus-visible::after{opacity:.14;}
.eq .course > *{position:relative;z-index:1;}
.eq .course .tag{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;color:var(--accent);
  border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);border-radius:999px;padding:3px 10px;
  transition:background .3s,color .3s,border-color .3s;}
.eq .course:hover .tag{background:var(--accent);color:var(--onacc);border-color:var(--accent);}
.eq .course h2,.eq .course .cstats b{transition:color .3s;}
.eq .course:hover h2{color:color-mix(in srgb,var(--accent) 30%,var(--tx));}
.eq .course h2{font-size:34px;margin:16px 0 0;}
.eq .course p{color:var(--tx2);font-size:14.5px;line-height:1.55;margin:10px 0 0;max-width:38ch;}
.eq .course .cstats{display:flex;gap:22px;margin-top:22px;padding-top:18px;border-top:1px solid var(--line);}
.eq .course .cstats b{display:block;font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;}
.eq .course .cstats span{font-size:11.5px;color:var(--tx3);}

.eq .feats{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(255,255,255,.12);
  border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden;margin:34px 0 70px;}
.eq .feat{background:linear-gradient(168deg,#0C544B,#093A34);padding:26px 24px;color:#E4F3EF;}
.eq .feat h3{font-size:18px;color:#fff;}
.eq .feat p{color:#A8CFC7;font-size:14px;margin:9px 0 0;line-height:1.6;}

.eq .crumb{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--tx3);padding:26px 0 0;flex-wrap:wrap;}
.eq .crumb button{background:none;border:0;padding:0;color:var(--tx3);}
.eq .crumb button:hover{color:var(--tx);}
.eq .phead{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:24px;padding:16px 0 30px;}
.eq .phead h1{font-size:clamp(32px,4.8vw,50px);font-weight:400;}
.eq .phead .sub{color:var(--tx2);font-size:14.5px;margin-top:10px;max-width:58ch;}
.eq .kpi{display:flex;gap:26px;}
.eq .kpi .v{font-family:'JetBrains Mono',monospace;font-size:30px;font-weight:600;line-height:1;}
.eq .kpi .l{font-size:11.5px;color:var(--tx3);margin-top:6px;}

.eq .urows{border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-bottom:26px;background:var(--bg2);}
.eq .urow{width:100%;display:grid;grid-template-columns:44px 1fr 180px 104px;gap:16px;align-items:center;
  background:var(--bg2);border:0;border-bottom:1px solid var(--line);padding:17px 18px;text-align:left;transition:background .16s;}
.eq .urow:last-child{border-bottom:0;}
.eq .urow:hover:not(:disabled){background:var(--surf2);}
.eq .urow:disabled{cursor:default;}
.eq .urow .idx{font-family:'JetBrains Mono',monospace;font-size:14px;color:var(--accent);font-weight:600;}
.eq .urow .t{font-weight:600;font-size:15.5px;}
.eq .urow .b{font-size:12.5px;color:var(--tx3);margin-top:4px;}
.eq .urow .wl{font-size:11.5px;color:var(--tx3);margin-bottom:6px;}
.eq .track{height:6px;background:var(--surfhi);border-radius:3px;overflow:hidden;}
.eq .track i{display:block;height:100%;background:var(--accent);border-radius:3px;}
.eq .urow .r{text-align:right;}
.eq .urow .r .acc{font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:600;}
.eq .urow .r .qn{font-size:11.5px;color:var(--tx3);margin-top:3px;}

.eq .mgrid{display:flex;flex-direction:column;gap:12px;margin-bottom:34px;}
.eq .matl{border:1px solid var(--line);border-radius:13px;background:var(--bg2);overflow:hidden;}
.eq .matl summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:auto 1fr auto;gap:14px;
  align-items:center;padding:16px 18px;}
.eq .matl summary::-webkit-details-marker{display:none;}
.eq .matl[open] summary{border-bottom:1px solid var(--line);background:var(--surf2);}
.eq .matl .mt{font-weight:600;font-size:15.5px;}
.eq .mk{font-size:11.5px;color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);
  border-radius:999px;padding:2px 9px;white-space:nowrap;}
.eq .matl .chev{color:var(--tx3);font-size:12px;}
.eq .prose{padding:18px 20px 22px;color:var(--tx2);font-size:15.5px;line-height:1.72;}
.eq .prose h4{font-size:16px;color:var(--tx);margin:18px 0 7px;}
.eq .prose h4:first-child{margin-top:0;}
.eq .prose p{margin:0 0 11px;}
.eq .prose ul{margin:0 0 12px;padding-left:19px;}
.eq .prose li{margin:4px 0;}
.eq .linkcard{display:flex;align-items:center;gap:14px;border:1px solid var(--line);border-radius:13px;
  background:var(--bg2);padding:16px 18px;text-decoration:none;color:inherit;transition:border-color .16s;}
.eq .linkcard:hover{border-color:var(--accent);}
.eq .linkcard .u{font-size:12.5px;color:var(--tx3);margin-top:3px;word-break:break-all;}

.eq .pbar{position:sticky;top:0;z-index:30;background:var(--navbg);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line);padding:13px 0;}
.eq .pbin{display:flex;align-items:center;gap:18px;}
.eq .segs{display:flex;gap:3px;flex:1;}
.eq .seg{height:5px;flex:1;background:var(--surfhi);border-radius:2px;transition:background .2s;}
.eq .seg.ok{background:var(--ok);} .eq .seg.no{background:var(--no);} .eq .seg.now{background:var(--accent);}
.eq .clock{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600;color:var(--tx2);}
.eq .qwrap{max-width:760px;margin:0 auto;padding:38px 24px 80px;}
.eq .qtag{font-size:12.5px;color:var(--tx3);margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.eq .qtag .dv{width:3px;height:3px;border-radius:50%;background:var(--tx3);}
.eq .qstem{font-size:21.5px;line-height:1.5;font-weight:500;margin:0 0 26px;letter-spacing:-.01em;}
.eq .opts{display:flex;flex-direction:column;gap:10px;}
.eq .opt{display:grid;grid-template-columns:30px 1fr;gap:14px;align-items:start;text-align:left;
  background:var(--surf);border:1px solid var(--line);border-radius:11px;padding:14px 16px;
  font-size:15.5px;line-height:1.5;transition:border-color .14s,background .14s;}
.eq .opt:hover:not(:disabled){border-color:var(--line2);background:var(--surf2);}
.eq .opt .k{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:12.5px;color:var(--tx3);
  border:1px solid var(--line2);border-radius:6px;height:26px;display:flex;align-items:center;justify-content:center;}
.eq .opt.good{border-color:var(--ok);background:var(--okbg);}
.eq .opt.good .k{background:var(--ok);color:#fff;border-color:var(--ok);}
.eq .opt.bad{border-color:var(--no);background:var(--nobg);}
.eq .opt.bad .k{background:var(--no);color:#fff;border-color:var(--no);}
.eq .opt:disabled{cursor:default;}
.eq .fb{margin-top:24px;background:var(--surf);border:1px solid var(--line);border-left:3px solid var(--accent);
  border-radius:11px;padding:18px 20px;}
.eq .fb .v{font-family:'Stardom',Georgia,serif;font-weight:400;font-size:18px;margin-bottom:9px;}
.eq .fb .v.y{color:var(--ok);} .eq .fb .v.n{color:var(--no);}
.eq .fb p{margin:0;color:var(--tx2);font-size:15.5px;line-height:1.68;}
.eq .actions{display:flex;align-items:center;gap:14px;margin-top:28px;flex-wrap:wrap;}

.eq .score{display:flex;align-items:flex-end;gap:34px;flex-wrap:wrap;padding:38px 0 10px;}
.eq .score .n{font-family:'JetBrains Mono',monospace;font-size:82px;font-weight:600;line-height:.82;letter-spacing:-.04em;}
.eq .score .side{font-size:13.5px;color:var(--tx3);}
.eq .score .side b{display:block;font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:600;color:var(--tx);}
.eq .rev{border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:30px 0 40px;}
.eq .ritem{border-bottom:1px solid var(--line);background:var(--bg2);}
.eq .ritem:last-child{border-bottom:0;}
.eq .ritem summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:26px 1fr 12px;gap:14px;
  padding:15px 18px;align-items:center;font-size:14.5px;}
.eq .ritem summary::-webkit-details-marker{display:none;}
.eq .ritem[open] summary{background:var(--surf2);}
.eq .dot{width:9px;height:9px;border-radius:50%;}
.eq .dot.y{background:var(--ok);} .eq .dot.n{background:var(--no);}
.eq .rbody{padding:4px 18px 20px 58px;font-size:14.5px;color:var(--tx2);}
.eq .rbody .ln{margin:7px 0;} .eq .rbody .ln b{color:var(--tx);font-weight:600;}

.eq .chat{border:1px solid var(--line);border-radius:16px;background:var(--bg2);overflow:hidden;
  display:flex;flex-direction:column;height:min(64vh,560px);}
.eq .msgs{flex:1;overflow-y:auto;padding:22px;display:flex;flex-direction:column;gap:16px;}
.eq .msg{max-width:82%;font-size:15px;line-height:1.65;white-space:pre-wrap;}
.eq .msg.u{align-self:flex-end;background:var(--surf2);border:1px solid var(--line);
  border-radius:14px 14px 4px 14px;padding:12px 16px;}
.eq .msg.a{align-self:flex-start;color:var(--tx2);border-left:2px solid var(--accent);padding:2px 0 2px 16px;}
.eq .composer{border-top:1px solid var(--line);padding:14px;display:flex;gap:10px;background:var(--surf);}
.eq .composer textarea{flex:1;background:var(--bg2);border:1px solid var(--line);border-radius:10px;
  padding:11px 14px;color:var(--tx);font-family:inherit;font-size:15px;resize:none;line-height:1.5;}
.eq .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;}
.eq .chip{background:var(--surf);border:1px solid var(--line);border-radius:999px;padding:7px 14px;
  font-size:13px;color:var(--tx2);}
.eq .chip:hover{border-color:var(--accent);color:var(--tx);}

.eq .field{display:block;margin-bottom:16px;}
.eq .field span{display:block;font-size:12.5px;color:var(--tx3);margin-bottom:6px;}
.eq input[type=text],.eq input[type=password],.eq textarea,.eq select{
  width:100%;background:var(--bg2);border:1px solid var(--line);border-radius:9px;padding:10px 13px;
  font-family:inherit;font-size:14.5px;color:var(--tx);}
.eq textarea{resize:vertical;line-height:1.55;}
.eq .row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;}

.eq .atabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:20px 0 26px;flex-wrap:wrap;}
.eq .atab{background:none;border:0;border-bottom:2px solid transparent;padding:11px 15px;color:var(--tx3);
  font-size:14.5px;margin-bottom:-1px;}
.eq .atab.on{color:var(--tx);border-bottom-color:var(--accent);font-weight:600;}
.eq .qlist{border:1px solid var(--line);border-radius:12px;overflow:hidden;}
.eq .qitem{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;padding:12px 14px;
  border-bottom:1px solid var(--line);background:var(--bg2);font-size:14px;}
.eq .qitem:last-child{border-bottom:0;}
.eq .pill{font-family:'JetBrains Mono',monospace;font-size:10.5px;border:1px solid var(--line2);
  border-radius:5px;padding:3px 7px;color:var(--tx3);white-space:nowrap;}
.eq .st{font-size:12px;color:var(--tx3);white-space:nowrap;}
.eq .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:30px;}
.eq .stat{background:var(--bg2);padding:18px 16px;}
.eq .stat .v{font-family:'JetBrains Mono',monospace;font-size:28px;font-weight:600;line-height:1;}
.eq .stat .l{font-size:11.5px;color:var(--tx3);margin-top:7px;}
.eq .abar{display:grid;grid-template-columns:180px 1fr 54px;gap:14px;align-items:center;padding:7px 0;
  font-size:13.5px;color:var(--tx2);}
.eq .abar .val{font-family:'JetBrains Mono',monospace;text-align:right;font-size:13px;color:var(--tx);}
.eq .sechead{font-family:'Stardom',Georgia,serif;font-weight:400;font-size:21px;margin:32px 0 12px;}
.eq .note{font-size:13.5px;color:var(--tx2);background:var(--surf);border:1px solid var(--line);
  border-left:3px solid var(--accent);border-radius:9px;padding:13px 16px;margin-bottom:20px;}
.eq .empty{border:1px dashed var(--line2);border-radius:14px;padding:42px 30px;text-align:center;
  color:var(--tx3);font-size:14.5px;}
.eq .empty h3{font-size:21px;color:var(--tx);margin-bottom:9px;}
.eq .draft{border:1px solid var(--line);border-radius:12px;background:var(--bg2);padding:18px;margin-bottom:14px;}
.eq .foot{border-top:1px solid var(--line);padding:26px 0 46px;font-size:12.5px;color:var(--tx3);
  display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.eq .spin{display:inline-block;width:13px;height:13px;border:2px solid var(--tx3);border-top-color:transparent;
  border-radius:50%;animation:sp .7s linear infinite;}
@keyframes sp{to{transform:rotate(360deg);}}

@media (max-width:860px){
  .eq .hero{grid-template-columns:1fr;gap:36px;padding:48px 0 44px;}
  .eq .courses,.eq .feats,.eq .row3{grid-template-columns:1fr;}
  .eq .stats{grid-template-columns:1fr 1fr;}
  .eq .urow{grid-template-columns:32px 1fr auto;}
  .eq .urow .wcol{display:none;}
  .eq .score .n{font-size:60px;}
  .eq .nlink.hideM{display:none;}
  .eq .abar{grid-template-columns:110px 1fr 46px;}
}
@media (prefers-reduced-motion:reduce){.eq *,.eq *::before,.eq *::after{animation:none !important;transition:none !important;}}

.eq .grab{cursor:grab;}
.eq .grab:active{cursor:grabbing;}
/* No focus box around the curve while dragging. Keyboard users still get
   a signal: the demand line itself thickens when it holds focus. */
.eq .grab:focus,.eq .grab:focus-visible{outline:none;}
.eq .grab:focus-visible line + line{stroke-width:4.4;}
.eq .plotbox svg:focus,.eq .plotbox g:focus{outline:none;}
.eq .plotbox svg{touch-action:none;}
.eq .draghint{position:absolute;top:14px;right:16px;font-size:11.5px;color:var(--tx3);
  background:var(--surf2);border:1px solid var(--line);border-radius:999px;padding:4px 11px;
  pointer-events:none;transition:opacity .3s;}

.eq .mockcard{display:flex;justify-content:space-between;align-items:center;gap:26px;flex-wrap:wrap;
  border:1px solid var(--line);border-radius:16px;padding:26px;margin:0 0 48px;box-shadow:var(--shadow);
  background:linear-gradient(120deg,var(--surf),var(--bg2));}
.eq .mockcard h3{font-size:25px;margin:13px 0 0;}
.eq .mockcard p{color:var(--tx2);font-size:14px;margin:9px 0 0;max-width:50ch;}
.eq .mockcard .ml{display:flex;gap:20px;margin-top:16px;}
.eq .mockcard .ml b{display:block;font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:600;}
.eq .mockcard .ml span{font-size:11.5px;color:var(--tx3);}

.eq .qgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(42px,1fr));gap:8px;}
.eq .gcell{aspect-ratio:1;border:1px solid var(--line);border-radius:8px;background:var(--bg2);
  font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--tx3);display:flex;
  align-items:center;justify-content:center;position:relative;}
.eq .gcell.done{background:var(--surfhi);color:var(--tx);border-color:var(--line2);}
.eq .gcell.now{border-color:var(--accent);color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);}
.eq .gcell.fl::after{content:'';position:absolute;top:4px;right:4px;width:5px;height:5px;border-radius:50%;background:var(--micro);}
.eq .sheet{position:fixed;inset:0;z-index:60;background:rgba(4,7,14,.55);backdrop-filter:blur(5px);
  display:flex;align-items:center;justify-content:center;padding:24px;}
.eq.light .sheet{background:rgba(30,45,75,.32);}
.eq .sheetin{background:var(--bg2);border:1px solid var(--line);border-radius:18px;padding:24px;
  max-width:540px;width:100%;max-height:82vh;overflow:auto;box-shadow:var(--shadow);}
.eq .bigscore{font-family:'JetBrains Mono',monospace;font-size:clamp(88px,16vw,132px);font-weight:600;
  line-height:.76;letter-spacing:-.06em;}
.eq .bands{border:1px solid var(--line);border-radius:12px;overflow:hidden;}
.eq .bandrow{display:grid;grid-template-columns:52px 1fr auto;gap:14px;padding:11px 16px;
  border-bottom:1px solid var(--line);background:var(--bg2);font-size:14px;align-items:center;color:var(--tx2);}
.eq .bandrow:last-child{border-bottom:0;}
.eq .bandrow.on{background:var(--surf2);color:var(--tx);}
.eq .bandrow .bs{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:16px;color:var(--tx);}
.eq .bandrow .br{font-family:'JetBrains Mono',monospace;font-size:13px;}
.eq input[type=range]{width:100%;accent-color:var(--accent);background:transparent;}
.eq .lowtime{color:var(--no);}

/* ---- landing, auth and dashboard ---- */
.eq .lnav{display:flex;align-items:center;justify-content:space-between;height:70px;}
.eq .land{max-width:1120px;margin:0 auto;padding:0 24px;}
.eq .lhero{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center;padding:56px 0 70px;}
.eq .lhero h1{font-size:clamp(40px,5.4vw,66px);line-height:1.02;}
.eq .lhero .ul{position:relative;white-space:nowrap;}
.eq .lhero .ul::after{content:'';position:absolute;left:0;right:0;bottom:-2px;height:4px;border-radius:3px;
  background:linear-gradient(90deg,var(--micro),var(--macro));}
.eq .lhero p{color:var(--tx2);font-size:18px;line-height:1.6;
  margin:24px 0 0;max-width:46ch;}

.eq .auth{display:grid;grid-template-columns:1fr 1fr;min-height:100vh;}
.eq .authform{display:flex;flex-direction:column;justify-content:center;padding:40px 8vw;max-width:620px;
  width:100%;margin:0 auto;}
.eq .authform h1{font-size:34px;margin-bottom:8px;}
.eq .authform .lead{color:var(--tx2);font-size:15.5px;line-height:1.6;margin:0 0 28px;}
.eq .authart{background:linear-gradient(168deg,#0C544B,#093A34);display:flex;align-items:center;
  justify-content:center;padding:40px;}
.eq .authart svg{width:100%;max-width:440px;height:auto;}
.eq .swap{font-size:14px;color:var(--tx3);margin-top:22px;text-align:center;}
.eq .swap button{background:none;border:0;color:var(--tx);font-weight:600;padding:0;}
.eq .swap button:hover{color:var(--accent);}

.eq .dash{display:grid;grid-template-columns:1fr 340px;gap:26px;align-items:start;}
.eq .greet{font-size:clamp(26px,3.4vw,36px);margin-bottom:6px;}
.eq .greet em{font-style:normal;color:var(--accent);}
.eq .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:22px 0 26px;}
.eq .kpi2{background:var(--bg2);padding:18px 16px;}
.eq .kpi2 .v{font-family:'JetBrains Mono',monospace;font-size:26px;font-weight:600;line-height:1;}
.eq .kpi2 .l{font-size:11.5px;color:var(--tx3);margin-top:7px;}
.eq .panel{border:1px solid var(--line);border-radius:14px;background:var(--bg2);padding:22px;margin-bottom:20px;}
.eq .panel h3{font-size:19px;margin-bottom:4px;}
.eq .panel .ptext{color:var(--tx2);font-size:14px;line-height:1.6;margin:8px 0 16px;}
.eq .nextrow{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:11px 0;
  border-bottom:1px solid var(--line);font-size:14px;width:100%;background:none;border-left:0;border-right:0;
  border-top:0;text-align:left;}
.eq .nextrow:last-child{border-bottom:0;}
.eq .nextrow:hover{color:var(--accent);}
@media (max-width:900px){
  .eq .lhero{grid-template-columns:1fr;gap:34px;padding:34px 0 46px;}
  .eq .auth{grid-template-columns:1fr;}
  .eq .authart{display:none;}
  .eq .dash{grid-template-columns:1fr;}
  .eq .kpis{grid-template-columns:1fr 1fr;}
}

/* question bank */
.eq .filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:22px;}
.eq .fbtn{display:inline-flex;align-items:center;gap:8px;background:var(--surf);border:1px solid var(--line);
  border-radius:10px;padding:8px 14px;font-size:13.5px;color:var(--tx2);}
.eq .fbtn:hover{border-color:var(--line2);color:var(--tx);}
.eq .fbtn.on{border-color:var(--accent);color:var(--tx);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 45%,transparent);}
.eq .allcard{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;
  border:1px solid var(--line);border-radius:14px;background:var(--surf);padding:20px 22px;margin-bottom:26px;}
.eq .allcard h3{font-size:20px;}
.eq .allcard p{color:var(--tx2);font-size:14px;margin:6px 0 0;}
.eq .ugroup{margin-bottom:30px;}
.eq .ugtitle{display:flex;align-items:baseline;gap:12px;margin-bottom:10px;}
.eq .ugtitle h3{font-size:21px;}
.eq .ugtitle span{font-size:12px;color:var(--tx3);}
.eq .btable{border:1px solid var(--line);border-radius:13px;overflow:hidden;background:var(--bg2);}
.eq .bhead,.eq .brow{display:grid;grid-template-columns:26px 1fr 150px 74px;gap:16px;align-items:center;
  padding:13px 18px;border-bottom:1px solid var(--line);}
.eq .bhead{font-size:11.5px;color:var(--tx3);background:var(--surf);}
.eq .brow{background:var(--bg2);transition:background .15s;text-align:left;width:100%;border-left:0;border-right:0;border-top:0;}
.eq .brow:last-child{border-bottom:0;}
.eq .brow:hover{background:var(--surf2);}
.eq .brow .tp{display:flex;align-items:baseline;gap:10px;}
.eq .brow .tc{font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--accent);}
.eq .brow .tt{font-size:14.5px;color:var(--tx);}
.eq .brow.none .tt{color:var(--tx3);}
.eq .prog{display:flex;align-items:center;gap:10px;}
.eq .prog .bar{flex:1;height:6px;background:var(--surfhi);border-radius:3px;overflow:hidden;}
.eq .prog .bar i{display:block;height:100%;background:var(--accent);border-radius:3px;}
.eq .prog .n{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--tx3);white-space:nowrap;}
.eq .acc2{font-family:'JetBrains Mono',monospace;font-size:13.5px;text-align:right;display:flex;
  align-items:center;justify-content:flex-end;gap:6px;}
.eq .acc2 .pip{width:7px;height:7px;border-radius:50%;}
.eq .selbar{position:sticky;bottom:0;z-index:20;display:flex;justify-content:space-between;align-items:center;
  gap:18px;flex-wrap:wrap;background:var(--navbg);backdrop-filter:blur(12px);border:1px solid var(--line2);
  border-radius:14px;padding:14px 18px;margin:8px 0 40px;box-shadow:var(--shadow);}
.eq .cbx{width:17px;height:17px;accent-color:var(--accent);cursor:pointer;}

/* ---- app shell with the left rail ---- */
.eq .shell{display:block;min-height:100vh;}
/* The rail sits above the page, so opening it never shifts the content. */
.eq .side{--sbg1:#0C544B;--sbg2:#093A34;--stx:#E4F3EF;--stx2:#9BC6BC;--shov:rgba(255,255,255,.1);
  position:fixed;left:0;top:0;bottom:0;width:70px;overflow-x:hidden;overflow-y:auto;
  background:linear-gradient(168deg,var(--sbg1),var(--sbg2));color:var(--stx);
  border-right:1px solid rgba(255,255,255,.08);padding:16px 10px;
  display:flex;flex-direction:column;gap:3px;z-index:60;
  transition:width .2s cubic-bezier(.3,.8,.3,1),box-shadow .2s;}
.eq .side:hover,.eq .side:has(:focus-visible){width:244px;box-shadow:24px 0 50px -20px rgba(0,0,0,.55);}
.eq.light .side{--sbg1:#0E5D53;--sbg2:#0A443D;}
.eq .side .brand{display:flex;align-items:center;justify-content:center;gap:0;background:none;border:0;
  padding:8px 0 18px;color:var(--stx);white-space:nowrap;width:100%;}
.eq .side .brand .bw{max-width:0;opacity:0;overflow:hidden;white-space:nowrap;
  transition:max-width .22s cubic-bezier(.3,.8,.3,1),opacity .16s;}
.eq .side:hover .brand,.eq .side:has(:focus-visible) .brand{justify-content:flex-start;padding-left:8px;}
.eq .side:hover .brand .bw.l,.eq .side:has(:focus-visible) .brand .bw.l{max-width:170px;opacity:1;}
.eq .side:hover .brand .bw.r,.eq .side:has(:focus-visible) .brand .bw.r{max-width:50px;opacity:1;}
.eq .brandwrap{display:inline-flex;align-items:center;gap:9px;letter-spacing:-.01em;line-height:1;}
.eq .brandwrap .bw-mark{display:flex;flex:0 0 auto;}
.eq .wm .ap{color:var(--micro);}
.eq .side .wm .ap{color:#F5C46B;}
.eq .sgroup{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--stx2);
  padding:18px 10px 6px;white-space:nowrap;height:32px;}
.eq .sitem{display:flex;align-items:center;gap:13px;width:100%;background:none;border:0;text-align:left;
  padding:10px 9px;border-radius:9px;font-size:14px;color:var(--stx2);white-space:nowrap;
  transition:background .14s,color .14s;}
.eq .sitem:hover{background:var(--shov);color:var(--stx);}
.eq .sitem.on{background:rgba(255,255,255,.14);color:#fff;font-weight:500;
  box-shadow:inset 2px 0 0 rgba(255,255,255,.75);}
.eq .sitem svg{flex:0 0 18px;}
.eq .sitem .sdot{width:7px;height:7px;border-radius:50%;flex:0 0 7px;margin-left:4px;}
.eq .sfoot{margin-top:auto;padding-top:14px;border-top:1px solid rgba(255,255,255,.12);}
.eq .side :focus-visible{outline-color:#fff;}
/* Labels fade in with the rail rather than reflowing it. */
.eq .lbl,.eq .sdot,.eq .sgroup span{opacity:0;transition:opacity .16s;}
.eq .side:hover .lbl,.eq .side:hover .sdot,.eq .side:hover .sgroup span,
.eq .side:has(:focus-visible) .lbl,.eq .side:has(:focus-visible) .sdot,.eq .side:has(:focus-visible) .sgroup span{opacity:1;}
.eq .main{min-width:0;margin-left:70px;position:relative;z-index:1;}
.eq .solo{min-height:100vh;}
/* While the rail is open the page dims, so it reads as a layer on top. */
.eq .railveil{position:fixed;inset:0 0 0 70px;background:rgba(0,0,0,.34);opacity:0;pointer-events:none;
  transition:opacity .2s;z-index:50;}
.eq.light .railveil{background:rgba(40,30,15,.22);}
.eq .side:hover ~ .main .railveil,.eq .side:has(:focus-visible) ~ .main .railveil{opacity:1;}
.eq .mtop{display:none;}

/* ---- question surface ---- */
.eq .qtop{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--surf);
  border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:26px;}
.eq .qnum{background:var(--tx);color:var(--bg);font-family:'JetBrains Mono',monospace;font-weight:600;
  font-size:14px;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;}
.eq .qtool{display:inline-flex;align-items:center;gap:7px;background:none;border:0;color:var(--tx2);
  font-size:13px;padding:6px 9px;border-radius:8px;}
.eq .qtool:hover{background:var(--surf2);color:var(--tx);}
.eq .qtool.on{color:var(--accent);}
.eq .qbody{font-size:20px;line-height:1.55;font-weight:400;margin:0 0 26px;letter-spacing:-.005em;
  user-select:text;}
.eq .qbody mark{background:color-mix(in srgb,var(--micro) 34%,transparent);color:inherit;
  border-radius:2px;padding:1px 0;cursor:pointer;}
.eq .qfig{display:block;margin:0 0 24px;border:1px solid var(--line);border-radius:12px;overflow:hidden;
  background:#fff;max-width:560px;}
.eq .qfig img{display:block;width:100%;height:auto;}
.eq .qfig:hover{border-color:var(--accent);}
.eq .orow{display:grid;grid-template-columns:1fr 42px;gap:10px;align-items:center;margin-bottom:11px;}
.eq .obtn{display:grid;grid-template-columns:30px 1fr;gap:14px;align-items:center;text-align:left;width:100%;
  background:var(--bg2);border:1.5px solid var(--line2);border-radius:12px;padding:14px 16px;
  font-size:15.5px;line-height:1.5;color:var(--tx);transition:border-color .14s,background .14s;}
.eq .obtn:hover:not(:disabled){border-color:var(--tx3);}
.eq .obtn .circ{width:28px;height:28px;border-radius:50%;border:1.5px solid var(--line2);display:flex;
  align-items:center;justify-content:center;font-size:13px;font-weight:600;color:var(--tx2);
  font-family:'JetBrains Mono',monospace;transition:all .14s;}
.eq .obtn.sel{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--bg2));}
.eq .obtn.sel .circ{background:var(--accent);color:var(--onacc);border-color:var(--accent);}
.eq .obtn.good{border-color:var(--ok);background:var(--okbg);}
.eq .obtn.good .circ{background:var(--ok);color:#fff;border-color:var(--ok);}
.eq .obtn.bad{border-color:var(--no);background:var(--nobg);}
.eq .obtn.bad .circ{background:var(--no);color:#fff;border-color:var(--no);}
.eq .obtn.out{opacity:.4;}
.eq .obtn.out span:last-child{text-decoration:line-through;}
.eq .elim{width:34px;height:34px;border-radius:50%;border:1.5px solid var(--line);background:none;
  color:var(--tx3);font-family:'JetBrains Mono',monospace;font-size:12.5px;position:relative;
  display:flex;align-items:center;justify-content:center;}
.eq .elim:hover{border-color:var(--tx2);color:var(--tx);}
.eq .elim::after{content:'';position:absolute;left:5px;right:5px;height:1.5px;background:currentColor;
  transform:scaleX(0);transition:transform .15s;}
.eq .elim.on{color:var(--tx);border-color:var(--tx2);}
.eq .elim.on::after{transform:scaleX(1);}
.eq .qfoot{position:sticky;bottom:0;display:flex;justify-content:space-between;align-items:center;gap:14px;
  flex-wrap:wrap;background:var(--navbg);backdrop-filter:blur(12px);border-top:1px solid var(--line);
  padding:14px 0;margin-top:30px;}
.eq .timer{display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 0 22px;}
.eq .timer .digits{font-family:'JetBrains Mono',monospace;font-size:30px;font-weight:600;
  letter-spacing:.02em;line-height:1;}
.eq .timer .digits.hid{visibility:hidden;}
.eq .timer .tctl{display:flex;gap:8px;align-items:center;}
.eq .tbtn2{width:30px;height:30px;border-radius:50%;border:1px solid var(--line2);background:var(--bg2);
  color:var(--tx2);display:flex;align-items:center;justify-content:center;}
.eq .tbtn2:hover{color:var(--tx);border-color:var(--tx3);}
.eq .tpill{border:1px solid var(--line2);background:var(--bg2);color:var(--tx2);border-radius:999px;
  padding:5px 14px;font-size:12.5px;}
.eq .tpill:hover{color:var(--tx);border-color:var(--tx3);}

.eq .hlpop{position:absolute;z-index:50;display:flex;gap:9px;align-items:center;background:var(--bg2);
  border:1px solid var(--line2);border-radius:999px;padding:7px 11px;box-shadow:var(--shadow);}
.eq .swatch{width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(0,0,0,.28);}
.eq .swatch:hover{transform:scale(1.12);}
.eq .swatch.erase{background:transparent;border-color:var(--line2);color:var(--tx3);
  display:flex;align-items:center;justify-content:center;}
.eq .swatch.erase:hover{color:var(--no);border-color:var(--no);}
.eq .qbody{position:relative;}
.eq .notepad{border:1px solid var(--line);border-radius:12px;background:var(--surf);padding:14px;margin-bottom:22px;}
.eq .notepad textarea{background:var(--bg2);}

@media (max-width:900px){
  .eq .main{margin-left:0;}
  .eq .railveil{display:none;}
  .eq .side{width:250px;transform:translateX(-100%);transition:transform .25s;}
  .eq .side:hover{width:250px;}
  .eq .side.open{transform:none;}
  .eq .lbl,.eq .sdot,.eq .sgroup span{opacity:1;}
  .eq .mtop{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);
    position:sticky;top:0;background:var(--navbg);backdrop-filter:blur(12px);z-index:20;}
  .eq .scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:25;}
}
@media (max-width:760px){
  .eq .bhead{display:none;}
  .eq .brow{grid-template-columns:24px 1fr auto;gap:12px;}
  .eq .brow .prog{display:none;}
}
`;

/* ---------------------------- logo + icons ---------------------------- */

function Mark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect x=".7" y=".7" width="24.6" height="24.6" rx="7.5" fill="var(--markbg)" stroke="var(--markline)" strokeWidth="1.2" />
      <line x1="6.5" y1="19" x2="19.5" y2="7" stroke="var(--macro)" strokeWidth="2.1" strokeLinecap="round" />
      <line x1="6.5" y1="7" x2="19.5" y2="19" stroke="var(--micro)" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="13" cy="13" r="3.1" fill="var(--markbg)" />
      <circle cx="13" cy="13" r="1.9" fill="var(--tx)" />
    </svg>
  );
}

/* The mark sits between the two words: Equilibrium ✕ AP */
function Brand({ size = 19, mark = 24 }) {
  return (
    <span className="brandwrap wm" style={{ fontSize: size }}>
      <span className="bw l">Equilibrium</span>
      <span className="bw-mark"><Mark size={mark} /></span>
      <span className="bw r ap">AP</span>
    </span>
  );
}

function ThemeIcon({ light }) {
  return light ? (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8 5.6 5.6 0 1 0 13.2 9.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
        <line key={d} x1="8" y1="1.4" x2="8" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" transform={`rotate(${d} 8 8)`} />
      ))}
    </svg>
  );
}

/* ---------------------------- hero plot ---------------------------- */

function HeroPlot() {
  const [dx, setDx] = useState(0);
  const [held, setHeld] = useState(false);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const raf = useRef(0);

  // Gentle drift until the student takes hold of the curve, then it is theirs.
  useEffect(() => {
    if (held) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now();
    const loop = (t) => { setDx(Math.sin((t - t0) / 2600) * 34); raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [held]);

  const clamp = (v) => Math.max(-72, Math.min(72, v));

  const onDown = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { x: e.clientX, from: dx, scale: 600 / rect.width };
    setHeld(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    setDx(clamp(d.from + (e.clientX - d.x) * d.scale));
  };
  const onUp = (e) => {
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onKey = (e) => {
    const step = e.shiftKey ? 12 : 4;
    if (e.key === "ArrowRight") { e.preventDefault(); setHeld(true); setDx((v) => clamp(v + step)); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setHeld(true); setDx((v) => clamp(v - step)); }
    if (e.key === "Home") { e.preventDefault(); setHeld(true); setDx(0); }
  };

  const X0 = 78, X1 = 552, Y0 = 40, Y1 = 292;
  const u = (230 + 0.5714 * dx) / 1.0714;
  const ex = X0 + u, ey = 290 - 0.5 * u;
  const Q = ((ex - X0) / (X1 - X0)) * 100;
  const P = ((Y1 - ey) / (Y1 - Y0)) * 100;

  /* The demand line keeps its length as it slides, so it is clipped to the
     plot area. The D label rides the line and is clamped to stay inside. */
  const dSlope = (302 - 62) / (500 - (X0 + 8));
  const labelX = Math.max(X0 + 30, Math.min(X1 + 8, 500 + dx));
  const labelY = Math.min(Y1 + 2, 62 + dSlope * (labelX - dx - X0 - 8));

  return (
    <div className="plotbox">
      <svg ref={svgRef} viewBox="0 0 600 330" role="img" aria-label="Supply and demand curves meeting at equilibrium">
        <defs>
          <clipPath id="plotclip">
            <rect x={X0} y={Y0 - 14} width={X1 + 12 - X0} height={Y1 + 8 - (Y0 - 14)} />
          </clipPath>
        </defs>
        <g stroke="rgba(255,255,255,.09)" strokeWidth="1">
          {[0, 1, 2, 3, 4, 5].map((i) => <line key={"h" + i} x1={X0} y1={Y0 + i * 50} x2={X1 + 20} y2={Y0 + i * 50} />)}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <line key={"v" + i} x1={X0 + i * 62} y1={Y0 - 10} x2={X0 + i * 62} y2={Y1 + 8} />)}
        </g>
        <line x1={X0} y1={Y0 - 12} x2={X0} y2={Y1 + 8} stroke="rgba(255,255,255,.3)" strokeWidth="1.4" />
        <line x1={X0 - 8} y1={Y1 + 8} x2={X1 + 30} y2={Y1 + 8} stroke="rgba(255,255,255,.3)" strokeWidth="1.4" />
        <text x={X0 - 26} y={Y0 - 2} fill="#8FB8B0" fontSize="12" fontFamily="JetBrains Mono">P</text>
        <text x={X1 + 34} y={Y1 + 13} fill="#8FB8B0" fontSize="12" fontFamily="JetBrains Mono">Q</text>
        <line x1={X0 + 8} y1="286" x2="540" y2="60" stroke="var(--macro)" strokeWidth="2.6" strokeLinecap="round" />
        <text x="546" y="58" fill="var(--macro)" fontSize="13" fontWeight="600" fontFamily="JetBrains Mono">S</text>
        <g className="grab" tabIndex={0} role="slider"
          aria-label="Drag the demand curve" aria-valuemin={-72} aria-valuemax={72} aria-valuenow={Math.round(dx)}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
          {/* The clip must sit on an outer group: a clip-path on the same
              element as the transform would slide along with the line. */}
          <g clipPath="url(#plotclip)">
            <g transform={`translate(${dx},0)`}>
              <line x1={X0 + 8} y1="62" x2="500" y2="302" stroke="transparent" strokeWidth="30" strokeLinecap="round" />
              <line x1={X0 + 8} y1="62" x2="500" y2="302" stroke="var(--micro)" strokeWidth="2.6" strokeLinecap="round" />
            </g>
          </g>
          <text x={labelX + 8} y={labelY + 2} fill="var(--micro)" fontSize="13" fontWeight="600" fontFamily="JetBrains Mono">D</text>
        </g>
        <line x1={X0} y1={ey} x2={ex} y2={ey} stroke="rgba(255,255,255,.28)" strokeWidth="1" strokeDasharray="3 4" />
        <line x1={ex} y1={ey} x2={ex} y2={Y1 + 8} stroke="rgba(255,255,255,.28)" strokeWidth="1" strokeDasharray="3 4" />
        <circle cx={ex} cy={ey} r="10" fill="var(--accent)" opacity=".2" />
        <circle cx={ex} cy={ey} r="5" fill="#FFFFFF" />
      </svg>
      <div className="draghint" style={{ opacity: held ? 0 : 1 }}>Drag the demand curve</div>
      <div className="readout">
        <div><div className="k">Equilibrium price</div><div className="v">{P.toFixed(1)}</div></div>
        <div><div className="k">Equilibrium quantity</div><div className="v">{Q.toFixed(1)}</div></div>
        <div><div className="k">Shift in demand</div>
          <div className="v" style={{ color: dx >= 0 ? "var(--micro)" : "var(--macro)" }}>{dx >= 0 ? "+" : ""}{(dx / 3.4).toFixed(1)}</div></div>
      </div>
    </div>
  );
}

/* ---------------------------- prose renderer ---------------------------- */

function Prose({ text }) {
  const blocks = useMemo(() => {
    const out = [];
    let ul = null;
    (text || "").split("\n").forEach((raw) => {
      const line = raw.trim();
      if (!line) { if (ul) { out.push(ul); ul = null; } return; }
      if (line.startsWith("- ") || line.startsWith("• ")) {
        if (!ul) ul = { t: "ul", items: [] };
        ul.items.push(line.slice(2));
      } else {
        if (ul) { out.push(ul); ul = null; }
        if (line.startsWith("## ")) out.push({ t: "h", v: line.slice(3) });
        else if (line.startsWith("# ")) out.push({ t: "h", v: line.slice(2) });
        else out.push({ t: "p", v: line });
      }
    });
    if (ul) out.push(ul);
    return out;
  }, [text]);

  return (
    <div className="prose">
      {blocks.map((b, i) =>
        b.t === "h" ? <h4 key={i}>{b.v}</h4>
          : b.t === "ul" ? <ul key={i}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul>
            : <p key={i}>{b.v}</p>
      )}
    </div>
  );
}

/* ============================================================
   APP
   ============================================================ */

/* Which rail entry lights up for the page being shown. */
function shellKey(r) {
  if (["planner", "analytics", "saved", "tutor"].includes(r.v)) return r.v;
  if (["tests", "mock", "mockresult"].includes(r.v)) return "test";
  if (r.subject) return `bank-${r.subject}`;
  return "home";
}

function parseRoute() {
  const p = (window.location.pathname || "/").toLowerCase().split("/").filter(Boolean);
  if (p[0] === "signin") return { v: "signin" };
  if (p[0] === "forgot") return { v: "forgot" };
  if (p[0] === "reset") return { v: "reset" };
  if (p[0] === "signup") return { v: "signup" };
  if (p[0] === "tutor") return { v: "tutor" };
  if (p[0] === "admin") return { v: "admin" };
  if (p[0] === "planner") return { v: "planner" };
  if (p[0] === "analytics") return { v: "analytics" };
  if (p[0] === "saved") return { v: "saved" };
  if (p[0] === "tests") return { v: "tests" };
  if (p[0] === "micro" || p[0] === "macro") {
    if (p[1] === "bank") return { v: "bank", subject: p[0] };
    const n = Number(p[1]);
    if (n >= 1 && n <= 6) return { v: "unit", subject: p[0], unit: n };
    return { v: "course", subject: p[0] };
  }
  return { v: "home" };
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);
  const [bank, setBank] = useState(null);
  const [me, setMe] = useState({ unit: {}, theme: "dark" });
  const [ready, setReady] = useState(false);

  const go = useCallback((r) => {
    setRoute(r);
    const path = r.v === "home" || r.v === "landing" ? "/"
      : r.v === "signin" ? "/signin" : r.v === "signup" ? "/signup"
      : r.v === "forgot" ? "/forgot" : r.v === "reset" ? "/reset"
      : r.v === "course" ? `/${r.subject}`
      : r.v === "bank" ? `/${r.subject}/bank`
        : r.v === "planner" ? "/planner" : r.v === "analytics" ? "/analytics"
          : r.v === "saved" ? "/saved" : r.v === "tests" ? "/tests"
        : r.v === "unit" ? `/${r.subject}/${r.unit}` : r.v === "tutor" ? "/tutor"
          : r.v === "admin" ? "/admin" : null;
    /* Practice, mock and result screens carry state in memory, so they
       deliberately leave the URL on the page the student came from. */
    if (path && path !== window.location.pathname) window.history.pushState(null, "", path);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const h = () => setRoute(parseRoute());
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);

  useEffect(() => {
    const k = (e) => {
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); go({ v: "admin" }); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go]);

  const [loadError, setLoadError] = useState("");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await getSession();
      setUser(data?.session?.user || null);
      setAuthReady(true);
    })();
    return onAuth(async (session) => {
      setUser(session?.user || null);
      if (session?.user) {
        const remote = await loadProgress();
        if (remote) setMe((p) => ({ ...p, ...remote, theme: p.theme }));
        setAdmin(await isAdmin());
      } else setAdmin(false);
    });
  }, []);

  useEffect(() => {
    (async () => {
      setMe(loadMe());
      if (!configured) { setLoadError("config"); setBank({ questions: [], materials: [], bands: DEFAULT_BANDS }); setReady(true); return; }
      try {
        const b = await loadBank();
        setBank({ questions: b.questions, materials: b.materials, bands: b.bands || DEFAULT_BANDS });
      } catch {
        setLoadError("network");
        setBank({ questions: [], materials: [], bands: DEFAULT_BANDS });
      }
      setReady(true);
    })();
  }, []);

  const toggleTheme = useCallback(() => {
    setMe((p) => { const n = { ...p, theme: p.theme === "light" ? "dark" : "light" }; saveMe(n); return n; });
  }, []);

  const refreshBank = useCallback(async () => {
    const b = await loadBank();
    setBank((p) => ({ ...p, questions: b.questions, materials: b.materials, bands: b.bands || DEFAULT_BANDS }));
  }, []);

  const recordSession = useCallback(async (s) => {
    const answers = s.items.map((it) => ({ qid: it.id, picked: it.picked, correct: it.correct }));
    const correct = s.items.filter((i) => i.correct).length;
    try {
      await recordSessionRow({
        subject: s.subject, unit: s.unit, mode: s.mode || "practice",
        total: s.items.length, correct, secs: s.secs, answers,
      });
    } catch { /* a dropped result must never block the student */ }

    const unit = { ...(me.unit || {}) };
    const key = `${s.subject}-${s.unit}`;
    const cur = unit[key] || { a: 0, c: 0 };
    unit[key] = { a: cur.a + s.items.length, c: cur.c + correct };

    /* Topic level progress drives the question bank rows. */
    const topic = { ...(me.topic || {}) };
    const answered = new Set(me.answered || []);
    const missed = new Set(me.missed || []);
    s.items.forEach((it) => {
      answered.add(it.id);
      if (it.correct) missed.delete(it.id); else missed.add(it.id);
      const code = it.q?.topic;
      if (!code) return;
      const k = `${s.subject}-${code}`;
      const c = topic[k] || { a: 0, c: 0 };
      topic[k] = { a: c.a + 1, c: c.c + (it.correct ? 1 : 0) };
    });

    const nm = { ...me, unit, topic, answered: [...answered].slice(-4000), missed: [...missed].slice(-2000) };
    setMe(nm); saveMe(nm);
    if (user) { try { await saveProgress(user.id, { unit, topic, answered: nm.answered, missed: nm.missed }); } catch { /* offline */ } }
  }, [me, user]);

  if (!ready || !authReady) return <div className="eq"><style>{CSS}</style><div className="wrap z" style={{ paddingTop: 90, color: "var(--tx3)" }}><span className="spin" /> Loading</div></div>;

  const accent = route.subject === "micro" ? "var(--micro)" : "var(--macro)";
  const nav = { go, theme: me.theme, toggleTheme };

  return (
    <div className={"eq" + (me.theme === "light" ? " light" : "")} style={{ "--accent": accent }}>
      <style>{CSS}</style>
      <div className="z">
        {route.v === "reset" ? <ResetPage go={go} />
        : !user && route.v !== "admin" ? (
          route.v === "signin" || route.v === "signup"
            ? <AuthPage mode={route.v} go={go} nav={nav} />
            : route.v === "forgot" ? <ForgotPage go={go} />
              : <Landing nav={nav} go={go} />
        ) : route.v === "admin" ? (
          <Admin bank={bank} setBank={setBank} refreshBank={refreshBank} go={go} admin={admin} />
        ) : route.v === "practice" || route.v === "mock" ? (
          <div className="solo">
            {route.v === "practice"
              ? <Practice {...route} go={go} onFinish={recordSession} nav={nav} />
              : <Mock {...route} go={go} onFinish={recordSession} nav={nav} />}
          </div>
        ) : (
        <Shell nav={nav} active={shellKey(route)}>
        {loadError && (
          <div className="wrap" style={{ paddingTop: 16 }}>
            <div className="note" style={{ borderLeftColor: "var(--no)" }}>
              {loadError === "config"
                ? "The database is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY and redeploy."
                : "Could not reach the database, so lessons and questions are not loading. Refresh in a moment."}
            </div>
          </div>
        )}
        {(route.v === "home" || route.v === "landing" || route.v === "signin" || route.v === "signup" || route.v === "forgot") && <Dashboard bank={bank} me={me} user={user} nav={nav} />}
        {route.v === "course" && <Course subject={route.subject} bank={bank} me={me} nav={nav} />}
        {route.v === "bank" && <Bank subject={route.subject} bank={bank} me={me} nav={nav} />}
        {route.v === "planner" && <Planner bank={bank} me={me} nav={nav} />}
        {route.v === "analytics" && <Analytics bank={bank} me={me} nav={nav} />}
        {route.v === "saved" && <Saved bank={bank} me={me} nav={nav} />}
        {route.v === "tests" && <Tests bank={bank} nav={nav} />}
        {route.v === "unit" && <UnitPage subject={route.subject} unit={route.unit} bank={bank} me={me} nav={nav} />}
        {route.v === "results" && <Results {...route} nav={nav} />}
        {route.v === "mockresult" && <MockResult {...route} bands={bank.bands} nav={nav} />}
        {route.v === "tutor" && <Tutor nav={nav} />}
        </Shell>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- chrome ---------------------------- */


/* ---------------------------- auth artwork ---------------------------- */

function AuthArt() {
  return (
    <svg viewBox="0 0 420 380" role="img" aria-label="Supply and demand meeting at equilibrium above a city skyline">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0A4841" /><stop offset="100%" stopColor="#0B5A50" />
        </linearGradient>
      </defs>
      <rect x="18" y="14" width="384" height="250" rx="16" fill="url(#sky)" stroke="rgba(255,255,255,.14)" />
      <g stroke="rgba(255,255,255,.08)">
        {[0, 1, 2, 3, 4].map((i) => <line key={i} x1="46" y1={54 + i * 42} x2="378" y2={54 + i * 42} />)}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <line key={"v" + i} x1={62 + i * 50} y1="40" x2={62 + i * 50} y2="236" />)}
      </g>
      <line x1="46" y1="34" x2="46" y2="238" stroke="rgba(255,255,255,.35)" strokeWidth="1.6" />
      <line x1="40" y1="238" x2="386" y2="238" stroke="rgba(255,255,255,.35)" strokeWidth="1.6" />
      <line x1="62" y1="226" x2="356" y2="58" stroke="#2FC0CD" strokeWidth="3" strokeLinecap="round" />
      <line x1="62" y1="62" x2="352" y2="228" stroke="#F0A93A" strokeWidth="3" strokeLinecap="round" />
      <circle cx="208" cy="143" r="20" fill="#FFFFFF" opacity=".14" />
      <circle cx="208" cy="143" r="6.5" fill="#FFFFFF" />
      <text x="360" y="54" fill="#2FC0CD" fontSize="14" fontWeight="600" fontFamily="JetBrains Mono">S</text>
      <text x="356" y="238" fill="#F0A93A" fontSize="14" fontWeight="600" fontFamily="JetBrains Mono">D</text>
      <g opacity=".95">
        <rect x="18" y="292" width="122" height="66" rx="12" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.16)" />
        <text x="34" y="318" fill="#9BC6BC" fontSize="11" fontFamily="Inter">Predicted score</text>
        <text x="34" y="344" fill="#fff" fontSize="22" fontWeight="600" fontFamily="JetBrains Mono">5</text>
        <rect x="150" y="292" width="140" height="66" rx="12" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.16)" />
        <text x="166" y="318" fill="#9BC6BC" fontSize="11" fontFamily="Inter">Topics covered</text>
        <text x="166" y="344" fill="#fff" fontSize="22" fontWeight="600" fontFamily="JetBrains Mono">76</text>
        <rect x="300" y="292" width="102" height="66" rx="12" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.16)" />
        <text x="316" y="318" fill="#9BC6BC" fontSize="11" fontFamily="Inter">Courses</text>
        <text x="316" y="344" fill="#fff" fontSize="22" fontWeight="600" fontFamily="JetBrains Mono">2</text>
      </g>
    </svg>
  );
}

/* ---------------------------- landing ---------------------------- */

function Landing({ nav, go }) {
  return (
    <>
      <div className="land">
        <div className="lnav">
          <button className="logo" onClick={() => go({ v: "landing" })}>
            <Brand />
          </button>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="tgl" onClick={nav.toggleTheme} aria-label="Switch theme">
              <ThemeIcon light={nav.theme === "light"} />
            </button>
            <button className="btn ghost sm" onClick={() => go({ v: "signin" })}>Log in</button>
          </span>
        </div>

        <div className="lhero">
          <div>
            <h1>Your all-in-one resource to <span className="ul">ace AP Econ</span></h1>
            <p>Every topic in the course outline, exam-style questions with written explanations, timed full-length tests with a predicted score, and a tutor that answers in the language of the course.</p>
            <div className="heroact">
              <button className="btn" onClick={() => go({ v: "signup" })}>Get started for free</button>
            </div>
          </div>
          <HeroPlot />
        </div>

        <div className="feats">
          <div className="feat"><h3>Built on the course outline</h3><p>Micro and Macro split into all six units and every numbered topic, so you always know what you are practising.</p></div>
          <div className="feat"><h3>Weighted like the real exam</h3><p>Full-length tests draw from each unit in College Board proportions and return a composite out of 90.</p></div>
          <div className="feat"><h3>A tutor that knows the graphs</h3><p>Ask about crowding out or excess capacity and get an answer built around the curves you have to draw.</p></div>
        </div>
      </div>
    </>
  );
}

/* ---------------------------- sign up and sign in ---------------------------- */

function AuthPage({ mode, go, nav }) {
  const isUp = mode === "signup";
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [pw, setPw] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [sent, setSent] = useState(false);

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      if (isUp) {
        await signUp(email.trim(), pw, name.trim());
        setSent(true);
      } else {
        await signIn(email.trim(), pw);
      }
    } catch (e) {
      const m = e.message || "";
      setErr(m.includes("Invalid login") ? "That email and password don't match."
        : m.includes("already") ? "There is already an account with that email."
          : m.includes("6 characters") ? "Use a password of at least six characters."
            : m || "Something went wrong. Try again.");
    }
    setBusy(false);
  };

  return (
    <div className="auth">
      <div className="authform">
        <button className="logo" style={{ marginBottom: 30 }} onClick={() => go({ v: "landing" })}>
          <Brand />
        </button>
        {sent ? (
          <>
            <h1>Check your email</h1>
            <p className="lead">We sent a confirmation link to {email}. Open it and you are in.</p>
            <button className="btn ghost" onClick={() => go({ v: "signin" })}>Back to log in</button>
          </>
        ) : (
          <>
            <h1>{isUp ? "Create your free account" : "Welcome back"}</h1>
            <p className="lead">{isUp ? "Practice AP Microeconomics and Macroeconomics, and keep your progress on every device." : "Pick up where you left off."}</p>
            {isUp && (
              <label className="field"><span>First name</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Munis" /></label>
            )}
            <label className="field"><span>Email</span>
              <input type="text" autoComplete="username" value={email}
                onChange={(e) => { setEmail(e.target.value); setErr(""); }} placeholder="you@example.com" /></label>
            <label className="field"><span>Password</span>
              <input type="password" autoComplete={isUp ? "new-password" : "current-password"} value={pw}
                onChange={(e) => { setPw(e.target.value); setErr(""); }}
                onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
            {err && <div style={{ color: "var(--no)", fontSize: 13.5, marginBottom: 14 }}>{err}</div>}
            <button className="btn" onClick={submit} disabled={busy || !email || !pw || (isUp && !name)}>
              {busy ? <><span className="spin" /> Working</> : isUp ? "Create account" : "Log in"}
            </button>
            {!isUp && (
              <div className="swap" style={{ marginTop: 14 }}>
                <button onClick={() => go({ v: "forgot" })}>Forgot your password?</button>
              </div>
            )}
            <div className="swap">
              {isUp
                ? <>Already have an account? <button onClick={() => go({ v: "signin" })}>Log in</button></>
                : <>New here? <button onClick={() => go({ v: "signup" })}>Create a free account</button></>}
            </div>
          </>
        )}
      </div>
      <div className="authart"><AuthArt /></div>
    </div>
  );
}


/* ---------------------------- password recovery ---------------------------- */

function ForgotPage({ go }) {
  const [email, setEmail] = useState(""), [sent, setSent] = useState(false);
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr("");
    try { await sendReset(email.trim()); setSent(true); }
    catch (e) { setErr(e.message || "Could not send that. Check the address and try again."); }
    setBusy(false);
  };

  return (
    <div className="auth">
      <div className="authform">
        <button className="logo" style={{ marginBottom: 30 }} onClick={() => go({ v: "landing" })}>
          <Brand />
        </button>
        {sent ? (
          <>
            <h1>Check your email</h1>
            <p className="lead">If there is an account for {email}, a reset link is on its way. It expires in an hour.</p>
            <button className="btn ghost" onClick={() => go({ v: "signin" })}>Back to log in</button>
          </>
        ) : (
          <>
            <h1>Reset your password</h1>
            <p className="lead">Enter the email you signed up with and we will send you a link.</p>
            <label className="field"><span>Email</span>
              <input type="text" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }}
                onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="you@example.com" /></label>
            {err && <div style={{ color: "var(--no)", fontSize: 13.5, marginBottom: 14 }}>{err}</div>}
            <button className="btn" onClick={submit} disabled={busy || !email}>
              {busy ? <><span className="spin" /> Sending</> : "Send the link"}
            </button>
            <div className="swap"><button onClick={() => go({ v: "signin" })}>Back to log in</button></div>
          </>
        )}
      </div>
      <div className="authart"><AuthArt /></div>
    </div>
  );
}

function ResetPage({ go }) {
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);

  const submit = async () => {
    if (pw.length < 6) { setErr("Use at least six characters."); return; }
    if (pw !== pw2) { setErr("The two passwords do not match."); return; }
    setBusy(true); setErr("");
    try { await updatePassword(pw); setDone(true); }
    catch (e) {
      setErr(e.message?.includes("session")
        ? "This link has expired. Ask for a new one."
        : e.message || "Could not change the password.");
    }
    setBusy(false);
  };

  return (
    <div className="auth">
      <div className="authform">
        <button className="logo" style={{ marginBottom: 30 }} onClick={() => go({ v: "landing" })}>
          <Brand />
        </button>
        {done ? (
          <>
            <h1>Password changed</h1>
            <p className="lead">You are signed in with the new password.</p>
            <button className="btn" onClick={() => go({ v: "home" })}>Go to your dashboard</button>
          </>
        ) : (
          <>
            <h1>Choose a new password</h1>
            <p className="lead">Open this page from the link in your email, then set the password you want.</p>
            <label className="field"><span>New password</span>
              <input type="password" autoFocus autoComplete="new-password" value={pw}
                onChange={(e) => { setPw(e.target.value); setErr(""); }} /></label>
            <label className="field"><span>Repeat it</span>
              <input type="password" autoComplete="new-password" value={pw2}
                onChange={(e) => { setPw2(e.target.value); setErr(""); }}
                onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
            {err && <div style={{ color: "var(--no)", fontSize: 13.5, marginBottom: 14 }}>{err}</div>}
            <button className="btn" onClick={submit} disabled={busy || !pw || !pw2}>
              {busy ? <><span className="spin" /> Saving</> : "Save the password"}
            </button>
          </>
        )}
      </div>
      <div className="authart"><AuthArt /></div>
    </div>
  );
}

/* ---------------------------- dashboard ---------------------------- */

function Dashboard({ bank, me, user, nav }) {
  const { go } = nav;
  const [savedIds] = useLocal("equilibrium:saved", []);
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = user?.user_metadata?.name || (user?.email || "").split("@")[0];

  let a = 0, c = 0;
  Object.values(me.unit || {}).forEach((v) => { a += v.a; c += v.c; });
  const missed = (me.missed || []).length;

  const next = ["micro", "macro"].flatMap((sub) =>
    UNITS[sub].flatMap((u) => (TOPICS[sub][u.n] || []).map(([code, title]) => {
      const st = (me.topic || {})[`${sub}-${code}`];
      const have = bank.questions.filter((q) => q.subject === sub && q.topic === code).length;
      return { sub, code, title, weight: u.weight, have, p: st ? pct(st.c, st.a) : null };
    }))).filter((r) => r.have > 0)
    .map((r) => ({ ...r, score: r.weight * (r.p === null ? 1 : (100 - r.p) / 100 + 0.15) }))
    .sort((x, y) => y.score - x.score).slice(0, 4);

  return (
    <div className="wrap" style={{ paddingTop: 30 }}>
      <h1 className="greet">{part}, <em>{name}</em></h1>
      <div className="sub" style={{ color: "var(--tx2)", fontSize: 16 }}>
        {a ? "Here is where you stand and what to do next." : "Pick a course below and answer your first questions."}
      </div>

      <div className="kpis">
        <div className="kpi2"><div className="v">{a}</div><div className="l">questions attempted</div></div>
        <div className="kpi2"><div className="v">{a ? pct(c, a) + "%" : "—"}</div><div className="l">current accuracy</div></div>
        <div className="kpi2"><div className="v">{savedIds.length}</div><div className="l">saved questions</div></div>
        <div className="kpi2"><div className="v" style={{ color: missed ? "var(--no)" : "var(--tx)" }}>{missed}</div><div className="l">still getting wrong</div></div>
      </div>

      <div className="dash">
        <div>
          <div className="panel">
            <h3>What to work on next</h3>
            <p className="ptext">Ranked by how much each topic is worth on the exam against how you are doing on it.</p>
            {next.length === 0
              ? <div className="empty" style={{ padding: 26 }}>No questions in the bank yet.</div>
              : next.map((r) => (
                <button className="nextrow" key={r.sub + r.code}
                  style={{ "--accent": r.sub === "micro" ? "var(--micro)" : "var(--macro)" }}
                  onClick={() => go({ v: "practice", subject: r.sub, unit: 0, pool: shuffle(bank.questions.filter((q) => q.subject === r.sub && q.topic === r.code)) })}>
                  <span><span className="num" style={{ color: r.sub === "micro" ? "var(--micro)" : "var(--macro)", marginRight: 10 }}>{r.code}</span>{r.title}</span>
                  <span className="hint">{r.p === null ? "not started" : r.p + "%"}</span>
                </button>
              ))}
          </div>

          <div className="panel">
            <h3>Keep going</h3>
            <p className="ptext">Two courses, twelve units, every numbered topic from the course outline.</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button className="btn sm acc" style={{ "--accent": "var(--micro)" }} onClick={() => go({ v: "bank", subject: "micro" })}>Micro question bank</button>
              <button className="btn sm acc" style={{ "--accent": "var(--macro)" }} onClick={() => go({ v: "bank", subject: "macro" })}>Macro question bank</button>
              <button className="btn sm ghost" onClick={() => go({ v: "tests" })}>Full-length test</button>
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <h3>Fix your mistakes</h3>
            <p className="ptext">{missed ? `${missed} question${missed === 1 ? "" : "s"} you have missed and not yet got right.` : "Nothing outstanding. Questions you miss collect here."}</p>
            <button className="btn sm" disabled={!missed} onClick={() => go({ v: "saved" })}>Start review</button>
          </div>
          <div className="panel">
            <h3>Ask Equi</h3>
            <p className="ptext">A tutor that stays inside AP Micro and Macro and answers with the graphs.</p>
            <button className="btn sm ghost" onClick={() => go({ v: "tutor" })}>Open the tutor</button>
          </div>
        </div>
      </div>
      <div style={{ height: 50 }} />
    </div>
  );
}

/* ---------------------------- home ---------------------------- */

function Home({ bank, me, nav }) {
  const { go } = nav;
  const card = (s) => {
    const n = bank.questions.filter((q) => q.subject === s).length;
    const mt = bank.materials.filter((m) => m.subject === s).length;
    let a = 0, c = 0;
    Object.entries(me.unit || {}).forEach(([k, v]) => { if (k.startsWith(s + "-")) { a += v.a; c += v.c; } });
    const p = pct(c, a);
    return (
      <button className="course" style={{ "--accent": s === "micro" ? "var(--micro)" : "var(--macro)" }}
        onClick={() => go({ v: "course", subject: s })}>
        <span className="tag">
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <line x1="1" y1="10" x2="10" y2="1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="1" y1={s === "micro" ? 1 : 10} x2="10" y2={s === "micro" ? 10 : 1} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
          </svg>
          AP {SSHORT[s]}
        </span>
        <h2>{SNAME[s]}</h2>
        <p>{s === "micro"
          ? "One market at a time. Firms, consumers, prices, and where markets stop working."
          : "The whole economy at once. Output, inflation, interest rates, and the policy that moves them."}</p>
        <div className="cstats">
          <div><b className="num">{mt}</b><span>lessons</span></div>
          <div><b className="num">{n}</b><span>questions</span></div>
          <div><b className="num">{p === null ? "—" : p + "%"}</b><span>your accuracy</span></div>
        </div>
      </button>
    );
  };

  return (
    <>
      
      <div className="wrap">
        <div className="hero">
          <div>
            <h1>Find your <span className="g">equilibrium</span> before the exam finds it for you.</h1>
            <p>Unit notes and exam-style multiple choice for AP Micro and AP Macro, with a written explanation after every question and an AI tutor that speaks the language of the course.</p>
            <div className="heroact">
              <button className="btn" onClick={() => go({ v: "course", subject: "micro" })}>Start with Micro</button>
              <button className="btn ghost" onClick={() => go({ v: "course", subject: "macro" })}>Start with Macro</button>
            </div>
          </div>
          <HeroPlot />
        </div>
        <div className="courses">{card("micro")}{card("macro")}</div>
        <div className="feats">
          <div className="feat"><h3>Notes then practice</h3><p>Each unit opens with the material you need, and the question set sits at the bottom of the same page.</p></div>
          <div className="feat"><h3>Weighted by the real exam</h3><p>Every unit shows how much of the multiple-choice section it carries, so you spend time where the points are.</p></div>
          <div className="feat"><h3>A tutor that knows the course</h3><p>Stuck on crowding out or excess capacity? Ask, and get an answer built around the graphs you will have to draw.</p></div>
        </div>
      </div>
    </>
  );
}

/* ---------------------------- course ---------------------------- */

function Course({ subject, bank, me, nav }) {
  const { go } = nav;
  const qOf = (u) => bank.questions.filter((q) => q.subject === subject && q.unit === u);
  const mOf = (u) => bank.materials.filter((m) => m.subject === subject && m.unit === u);
  let ta = 0, tc = 0;
  Object.entries(me.unit || {}).forEach(([k, v]) => { if (k.startsWith(subject + "-")) { ta += v.a; tc += v.c; } });
  const anything = bank.questions.some((q) => q.subject === subject) || bank.materials.some((m) => m.subject === subject);

  const mixed = () => {
    const p = shuffle(bank.questions.filter((q) => q.subject === subject)).slice(0, 20);
    if (p.length) go({ v: "practice", subject, unit: 0, pool: p });
  };
  const mockCount = Math.min(60, bank.questions.filter((q) => q.subject === subject).length);
  const startMock = () => {
    const p = buildMock(bank.questions, subject);
    if (p.length >= 5) go({ v: "mock", subject, pool: p });
  };

  return (
    <>
      
      <div className="wrap">
        <div className="crumb"><button onClick={() => go({ v: "home" })}>Equilibrium</button><span>/</span><span>AP {SNAME[subject]}</span></div>
        <div className="phead">
          <div>
            <h1>AP {SNAME[subject]}</h1>
            <div className="sub">Six units in College Board order. The bar on each row is that unit's share of the multiple-choice section.</div>
          </div>
          <div className="kpi">
            <div><div className="v">{pct(tc, ta) === null ? "—" : pct(tc, ta) + "%"}</div><div className="l">your accuracy</div></div>
            <div><div className="v num">{ta}</div><div className="l">questions answered</div></div>
          </div>
        </div>

        {!anything ? (
          <div className="empty" style={{ marginBottom: 40 }}>
            <h3>This course is being built</h3>
            Notes and questions for AP {SNAME[subject]} are on the way. In the meantime the AI tutor can answer anything from the course.
            <div style={{ marginTop: 20 }}><button className="btn sm acc" onClick={() => go({ v: "tutor" })}>Open the tutor</button></div>
          </div>
        ) : (
          <>
            <div className="urows">
              {UNITS[subject].map((u) => {
                const nq = qOf(u.n).length, nm = mOf(u.n).length;
                const st = (me.unit || {})[`${subject}-${u.n}`];
                const a = st ? pct(st.c, st.a) : null;
                const has = nq + nm > 0;
                return (
                  <button key={u.n} className="urow" disabled={!has} style={{ opacity: has ? 1 : .45 }}
                    onClick={() => go({ v: "unit", subject, unit: u.n })}>
                    <div className="idx">0{u.n}</div>
                    <div>
                      <div className="t">{u.title}</div>
                      <div className="b">{u.blurb}</div>
                    </div>
                    <div className="wcol">
                      <div className="wl">{u.weight}% of the exam</div>
                      <div className="track"><i style={{ width: `${(u.weight / 25) * 100}%` }} /></div>
                    </div>
                    <div className="r">
                      <div className="acc" style={{ color: a === null ? "var(--tx3)" : "var(--tx)" }}>{a === null ? "—" : a + "%"}</div>
                      <div className="qn">{has ? `${nm} lesson${nm === 1 ? "" : "s"} · ${nq} q` : "coming soon"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 34 }}>
              <button className="btn acc" onClick={() => go({ v: "bank", subject })}>Open the question bank</button>
              <button className="btn ghost" onClick={mixed} disabled={!bank.questions.some((q) => q.subject === subject)}>Mixed set from all units</button>
              <span className="hint">The bank breaks the course into the topics the exam uses</span>
            </div>

            <div className="mockcard">
              <div>
                <span className="mk">Full-length test</span>
                <h3>Sit the paper and get a predicted score</h3>
                <p>A timed multiple-choice paper drawn in College Board unit proportions, then a full score report: composite out of 90 and a predicted 1 to 5.</p>
                <div className="ml">
                  <div><b className="num">{mockCount}</b><span>questions</span></div>
                  <div><b className="num">{Math.round(Math.min(4200, mockCount * 70) / 60)}</b><span>minutes</span></div>
                  <div><b className="num">70s</b><span>per question</span></div>
                </div>
              </div>
              <button className="btn" onClick={startMock} disabled={mockCount < 5}>
                {mockCount < 5 ? "Needs at least 5 questions" : "Start the mock"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ---------------------------- unit page ---------------------------- */

function UnitPage({ subject, unit, bank, me, nav }) {
  const { go } = nav;
  const u = UNITS[subject][unit - 1];
  const mats = bank.materials.filter((m) => m.subject === subject && m.unit === unit);
  const qs = bank.questions.filter((q) => q.subject === subject && q.unit === unit);
  const st = (me.unit || {})[`${subject}-${unit}`];

  return (
    <>
      
      <div className="wrap" style={{ maxWidth: 900 }}>
        <div className="crumb">
          <button onClick={() => go({ v: "home" })}>Equilibrium</button><span>/</span>
          <button onClick={() => go({ v: "course", subject })}>AP {SNAME[subject]}</button><span>/</span>
          <span>Unit {unit}</span>
        </div>
        <div className="phead">
          <div>
            <div className="num" style={{ fontSize: 13, color: "var(--accent)", marginBottom: 10 }}>Unit 0{unit}</div>
            <h1>{u.title}</h1>
            <div className="sub">{u.blurb}. Worth about {u.weight}% of the multiple-choice section.</div>
          </div>
          {st && <div className="kpi"><div><div className="v">{pct(st.c, st.a)}%</div><div className="l">your accuracy here</div></div></div>}
        </div>

        <div className="sechead" style={{ marginTop: 0 }}>Lessons</div>
        {mats.length === 0 ? (
          <div className="empty" style={{ marginBottom: 32 }}>Notes for this unit are coming soon.</div>
        ) : (
          <div className="mgrid">
            {mats.map((m) => m.kind === "link" ? (
              <a key={m.id} className="linkcard" href={m.url} target="_blank" rel="noreferrer">
                <span className="mk">Link</span>
                <span><div className="mt" style={{ fontWeight: 600, fontSize: 15.5 }}>{m.title}</div><div className="u">{m.url}</div></span>
              </a>
            ) : (
              <details key={m.id} className="matl">
                <summary>
                  <span className="mk">{m.kind === "formula" ? "Formulas" : "Notes"}</span>
                  <span className="mt">{m.title}</span>
                  <span className="chev">open</span>
                </summary>
                <Prose text={m.body} />
              </details>
            ))}
          </div>
        )}

        <div className="sechead">Practice</div>
        {qs.length === 0 ? (
          <div className="empty">No questions in this unit yet.</div>
        ) : (
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn acc" onClick={() => go({ v: "practice", subject, unit, pool: shuffle(qs) })}>
              Start {qs.length} question{qs.length === 1 ? "" : "s"}
            </button>
            <button className="btn ghost" onClick={() => go({ v: "tutor" })}>Ask about this unit</button>
          </div>
        )}
        <div style={{ height: 56 }} />
      </div>
    </>
  );
}



/* ---------------------------- icons ---------------------------- */
const I = {
  home: <path d="M2.5 7.2 9 2.2l6.5 5V15a.8.8 0 0 1-.8.8h-3.4v-4.4H6.7v4.4H3.3a.8.8 0 0 1-.8-.8Z" />,
  tutor: <path d="M2.6 3.5h12.8v8.2H9.9L6.4 14.6v-2.9H2.6Z" />,
  planner: <path d="M3 4.2h12v11H3Zm0 3.4h12M6.2 2.4v3.2m5.6-3.2v3.2" />,
  analytics: <path d="M3 15.2V9m4.7 6.2V3.6m4.7 11.6v-7" />,
  saved: <path d="M4.6 2.6h8.8v13l-4.4-3.3-4.4 3.3Z" />,
  bank: <path d="M3 4.4h12v9.2H3Zm0 3.1h12M7.2 7.5v6.1" />,
  test: <path d="M9 2.6a6.4 6.4 0 1 1 0 12.8A6.4 6.4 0 0 1 9 2.6Zm0 3v3.6l2.4 1.6" />,
};
const Icon = ({ d }) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">{d}</svg>
);

/* ---------------------------- app shell ---------------------------- */

function Shell({ nav, active, children }) {
  const { go, theme, toggleTheme } = nav;
  const [open, setOpen] = useState(false);
  const item = (key, label, icon, route, dot) => (
    <button className={"sitem" + (active === key ? " on" : "")} title={label}
      onClick={(e) => { e.currentTarget.blur(); setOpen(false); go(route); }}>
      <Icon d={icon} /><span className="lbl">{label}</span>
      {dot && <span className="sdot" style={{ background: dot }} />}
    </button>
  );

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={"side" + (open ? " open" : "")}>
        <button className="brand" title="AP Equilibrium"
          onClick={(e) => { e.currentTarget.blur(); setOpen(false); go({ v: "home" }); }}>
          <Brand size={20} mark={26} />
        </button>
        {item("home", "Home", I.home, { v: "home" })}
        {item("tutor", "Ask Equi tutor", I.tutor, { v: "tutor" })}
        {item("planner", "Study planner", I.planner, { v: "planner" })}
        {item("analytics", "Analytics", I.analytics, { v: "analytics" })}
        {item("saved", "Saved and mistakes", I.saved, { v: "saved" })}
        <div className="sgroup"><span>Practice</span></div>
        {item("bank-micro", "Question bank · Micro", I.bank, { v: "bank", subject: "micro" }, "var(--micro)")}
        {item("bank-macro", "Question bank · Macro", I.bank, { v: "bank", subject: "macro" }, "var(--macro)")}
        {item("test", "Full-length test", I.test, { v: "tests" })}
        <div className="sfoot">
          <button className="sitem" title="Switch theme"
            onClick={(e) => { e.currentTarget.blur(); toggleTheme(); }}>
            <ThemeIcon light={theme === "light"} />
            <span className="lbl">{theme === "light" ? "Dark mode" : "Light mode"}</span>
          </button>
          <button className="sitem" title="Log out"
            onClick={async (e) => { e.currentTarget.blur(); await signOut(); go({ v: "landing" }); }}>
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"><path d="M7 15.4H3.6V2.6H7M11.4 12.2 14.6 9l-3.2-3.2M14.6 9H7" /></svg>
            <span className="lbl">Log out</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="railveil" aria-hidden="true" />
        <div className="mtop">
          <button className="mini" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <Brand size={17} mark={21} />
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------------------- question surface ----------------------------
   Shared by practice and the full-length test: circled letters, an answer
   eliminator, text highlighting, a private note, and check-then-next.
--------------------------------------------------------------------------- */

function useLocal(key, initial) {
  const [v, setV] = useState(() => {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : initial; } catch { return initial; }
  });
  const set = useCallback((next) => {
    setV((prev) => {
      const val = typeof next === "function" ? next(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ }
      return val;
    });
  }, [key]);
  return [v, set];
}

const HL_COLORS = ["#FCE588", "#BFDCF5", "#F8CCE0"];

function Highlightable({ text, marks, onAdd, onRemove }) {
  const ref = useRef(null);
  const [pop, setPop] = useState(null);

  const grab = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !ref.current) { setPop(null); return; }
    const range = sel.getRangeAt(0);
    if (!ref.current.contains(range.commonAncestorContainer)) return;
    const pre = range.cloneRange();
    pre.selectNodeContents(ref.current);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = Math.max(0, Math.min(text.length, pre.toString().length));
    const end = Math.max(0, Math.min(text.length, start + range.toString().length));
    if (end <= start) return;
    const r = range.getBoundingClientRect();
    const box = ref.current.getBoundingClientRect();
    setPop({ start, end, x: r.left - box.left + r.width / 2, y: r.top - box.top - 44 });
  };

  const apply = (c) => {
    if (c) onAdd({ start: pop.start, end: pop.end, c });
    else onRemove(pop.start, pop.end);
    window.getSelection()?.removeAllRanges();
    setPop(null);
  };

  /* Colour every character, then walk the run. Overlapping marks simply
     paint over each other, so no span is ever emitted twice. */
  const pieces = useMemo(() => {
    const paint = new Array(text.length).fill(null);
    marks.forEach((m) => {
      const from = Math.max(0, m.start), to = Math.min(text.length, m.end);
      for (let i = from; i < to; i++) paint[i] = m.c || HL_COLORS[0];
    });
    const out = [];
    let i = 0;
    while (i < text.length) {
      const c = paint[i];
      let j = i + 1;
      while (j < text.length && paint[j] === c) j++;
      out.push({ t: text.slice(i, j), c, start: i, end: j });
      i = j;
    }
    return out;
  }, [text, marks]);

  return (
    <p className="qbody" ref={ref} onMouseUp={grab} onTouchEnd={grab}>
      {pieces.map((p, i) => p.c
        ? <mark key={i} style={{ background: p.c, color: "#12171F" }}
          title="Click to remove" onClick={() => onRemove(p.start, p.end)}>{p.t}</mark>
        : <span key={i}>{p.t}</span>)}
      {pop && (
        <span className="hlpop" style={{ left: Math.max(0, pop.x - 58), top: Math.max(-10, pop.y) }}
          onMouseDown={(e) => e.preventDefault()}>
          {HL_COLORS.map((c) => (
            <button key={c} className="swatch" style={{ background: c }} onClick={() => apply(c)}
              aria-label="Highlight in this colour" />
          ))}
          <button className="swatch erase" onClick={() => apply(null)} aria-label="Remove the highlight">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round"><path d="M2.4 2.4 9.6 9.6M9.6 2.4 2.4 9.6" /></svg>
          </button>
        </span>
      )}
    </p>
  );
}


function Timer({ seconds, paused, onToggle }) {
  const [hidden, setHidden] = useState(false);
  return (
    <div className="timer">
      <div className={"digits" + (hidden ? " hid" : "")}>{mmss(seconds)}</div>
      <div className="tctl">
        <button className="tbtn2" onClick={onToggle} aria-label={paused ? "Resume the timer" : "Pause the timer"}>
          {paused
            ? <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor"><path d="M0 0l11 6-11 6z" /></svg>
            : <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect width="3.2" height="12" rx="1" /><rect x="6.8" width="3.2" height="12" rx="1" /></svg>}
        </button>
        <button className="tpill" onClick={() => setHidden((v) => !v)}>{hidden ? "Show" : "Hide"}</button>
      </div>
    </div>
  );
}

function QuestionView({ q, index, total, picked, onPick, revealed, saved, onToggleSave, accentSubject }) {
  const [elim, setElim] = useState([]);
  const [elimOn, setElimOn] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [notes, setNotes] = useLocal("equilibrium:notes", {});
  const [hl, setHl] = useLocal("equilibrium:highlights", {});

  useEffect(() => { setElim([]); setNoteOpen(false); }, [q.id]);

  const marks = hl[q.id] || [];
  const addMark = (m) => setHl((p) => ({ ...p, [q.id]: [...(p[q.id] || []), m] }));
  const removeMark = (from, to) => setHl((p) => ({
    ...p,
    [q.id]: (p[q.id] || []).flatMap((x) => {
      if (x.end <= from || x.start >= to) return [x];          // untouched
      const kept = [];
      if (x.start < from) kept.push({ ...x, end: from });       // keep the head
      if (x.end > to) kept.push({ ...x, start: to });           // keep the tail
      return kept;
    }),
  }));

  return (
    <>
      <div className="qtop">
        <span className="qnum">{index + 1}</span>
        <button className={"qtool" + (saved ? " on" : "")} onClick={onToggleSave}>
          <svg width="13" height="15" viewBox="0 0 13 15" fill={saved ? "currentColor" : "none"}
            stroke="currentColor" strokeWidth="1.5"><path d="M1.2 1.2h10.6v12.6L6.5 10l-5.3 3.8Z" /></svg>
          {saved ? "Saved" : "Mark for review"}
        </button>
        <button className={"qtool" + (noteOpen ? " on" : "")} onClick={() => setNoteOpen((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2.5 2.5h11v11h-11Zm2.6 3h5.8m-5.8 3h5.8m-5.8 3h3.4" /></svg>
          {notes[q.id] ? "Note saved" : "Note"}
        </button>
        {marks.length > 0 && (
          <button className="qtool" onClick={() => setHl((p) => ({ ...p, [q.id]: [] }))}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round"><path d="M3 13h10M4.6 10.4 9 6l3 3-4.4 4.4Z" /></svg>
            Clear highlights
          </button>
        )}
        <button className={"qtool" + (elimOn ? " on" : "")} onClick={() => setElimOn((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="6" /><path d="M3.8 12.2 12.2 3.8" /></svg>
          Eliminate
        </button>
        <span style={{ flex: 1 }} />
        <span className="hint num">{index + 1} / {total}</span>
      </div>

      {noteOpen && (
        <div className="notepad">
          <textarea rows={3} placeholder="Your note on this question — only you see it."
            value={notes[q.id] || ""}
            onChange={(e) => setNotes((p) => ({ ...p, [q.id]: e.target.value }))} />
        </div>
      )}

      <Highlightable text={q.stem} marks={marks} onAdd={addMark} onRemove={removeMark} />

      {q.image && (
        <a className="qfig" href={q.image} target="_blank" rel="noreferrer" title="Open full size">
          <img src={q.image} alt="Figure for this question" loading="lazy" />
        </a>
      )}

      <div>
        {q.choices.map((c, i) => {
          let cls = "obtn";
          if (revealed) {
            if (i === q.answer) cls += " good";
            else if (i === picked) cls += " bad";
          } else if (picked === i) cls += " sel";
          if (!revealed && elim.includes(i)) cls += " out";
          return (
            <div className="orow" key={i}>
              <button className={cls} disabled={revealed} onClick={() => onPick(i)}>
                <span className="circ">{L[i]}</span><span>{c}</span>
              </button>
              {elimOn && !revealed ? (
                <button className={"elim" + (elim.includes(i) ? " on" : "")}
                  aria-label={`Cross out ${L[i]}`}
                  onClick={() => setElim((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))}>
                  {L[i]}
                </button>
              ) : <span />}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------------------------- question bank ---------------------------- */

const STATUS = [["all", "All questions"], ["unseen", "Not yet answered"], ["wrong", "Previously missed"]];

function Bank({ subject, bank, me, nav }) {
  const { go } = nav;
  const [status, setStatus] = useState("all");
  const [picked, setPicked] = useState([]);

  const seen = me.topic || {};
  const wrongIds = me.missed || [];

  const pool = useMemo(() => bank.questions.filter((q) => {
    if (q.subject !== subject) return false;
    if (status === "wrong" && !wrongIds.includes(q.id)) return false;
    if (status === "unseen" && (me.answered || []).includes(q.id)) return false;
    return true;
  }), [bank.questions, subject, status, wrongIds, me.answered]);

  const forTopic = (code) => pool.filter((q) => q.topic === code);
  const total = pool.length;

  const start = (list) => { if (list.length) go({ v: "practice", subject, unit: 0, pool: shuffle(list) }); };
  const startPicked = () => start(pool.filter((q) => picked.includes(q.topic)));
  const toggle = (code) => setPicked((p) => (p.includes(code) ? p.filter((x) => x !== code) : [...p, code]));

  const pickedCount = pool.filter((q) => picked.includes(q.topic)).length;

  return (
    <>
      
      <div className="wrap">
        <div className="crumb">
          <button onClick={() => go({ v: "home" })}>Equilibrium</button><span>/</span>
          <button onClick={() => go({ v: "course", subject })}>AP {SNAME[subject]}</button><span>/</span>
          <span>Question bank</span>
        </div>
        <div className="phead">
          <div>
            <h1>Question bank</h1>
            <div className="sub">Every topic in the course outline. Tick the ones you want and practise them together, or open a single topic on its own.</div>
          </div>
        </div>

        <div className="filters">
          {STATUS.map(([k, v]) => (
            <button key={k} className={"fbtn" + (status === k ? " on" : "")} onClick={() => setStatus(k)}>{v}</button>
          ))}
        </div>

        <div className="allcard">
          <div>
            <h3>Practise every topic</h3>
            <p>{total ? `${total} question${total === 1 ? "" : "s"} across all six units.` : "No questions here yet."}</p>
          </div>
          <button className="btn acc" disabled={!total} onClick={() => start(pool)}>Start practice</button>
        </div>

        {UNITS[subject].map((u) => {
          const rows = TOPICS[subject][u.n] || [];
          const unitTotal = rows.reduce((n, [code]) => n + forTopic(code).length, 0);
          return (
            <div className="ugroup" key={u.n}>
              <div className="ugtitle">
                <h3>Unit {u.n}. {u.title}</h3>
                <span className="num">{unitTotal} question{unitTotal === 1 ? "" : "s"} · {u.weight}% of the exam</span>
              </div>
              <div className="btable">
                <div className="bhead"><span /><span>Topic</span><span>Progress</span><span style={{ textAlign: "right" }}>Accuracy</span></div>
                {rows.map(([code, title]) => {
                  const n = forTopic(code).length;
                  const st = seen[`${subject}-${code}`];
                  const acc = st ? pct(st.c, st.a) : null;
                  const done = st ? Math.min(st.a, n) : 0;
                  return (
                    <div className={"brow" + (n ? "" : " none")} key={code}>
                      <input type="checkbox" className="cbx" disabled={!n} checked={picked.includes(code)}
                        onChange={() => toggle(code)} aria-label={`Select topic ${code}`} />
                      <button className="tp" style={{ background: "none", border: 0, padding: 0 }}
                        disabled={!n} onClick={() => start(forTopic(code))}>
                        <span className="tc">{code}</span>
                        <span className="tt">{title}</span>
                      </button>
                      <span className="prog">
                        <span className="bar"><i style={{ width: n ? `${(done / n) * 100}%` : "0%" }} /></span>
                        <span className="n">{n ? `${done}/${n}` : "—"}</span>
                      </span>
                      <span className="acc2" style={{ color: acc === null ? "var(--tx3)" : "var(--tx)" }}>
                        {acc !== null && <span className="pip" style={{ background: acc >= 80 ? "var(--ok)" : acc >= 55 ? "var(--micro)" : "var(--no)" }} />}
                        {acc === null ? "—" : acc + "%"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {picked.length > 0 && (
          <div className="selbar">
            <span style={{ fontSize: 14 }}>
              <b className="num">{picked.length}</b> topic{picked.length === 1 ? "" : "s"} selected ·{" "}
              <b className="num">{pickedCount}</b> question{pickedCount === 1 ? "" : "s"}
            </span>
            <span style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost sm" onClick={() => setPicked([])}>Clear</button>
              <button className="btn acc sm" disabled={!pickedCount} onClick={startPicked}>Start practice</button>
            </span>
          </div>
        )}
        <div style={{ height: 40 }} />
      </div>
    </>
  );
}

/* ---------------------------- practice ---------------------------- */

function Practice({ subject, unit, pool, go, onFinish, nav }) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [items, setItems] = useState([]);
  const [secs, setSecs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [help, setHelp] = useState(null);
  const [helping, setHelping] = useState(false);
  const [savedIds, setSavedIds] = useLocal("equilibrium:saved", []);
  const q = pool[idx];

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [paused]);

  const check = useCallback(() => {
    if (picked === null || revealed) return;
    setRevealed(true);
    setItems((p) => [...p, { id: q.id, picked, correct: picked === q.answer, q }]);
  }, [picked, revealed, q]);

  const next = useCallback(() => {
    if (idx + 1 >= pool.length) {
      onFinish({ subject, unit, items, secs });
      go({ v: "results", subject, unit, items, secs });
    } else {
      setIdx((i) => i + 1); setPicked(null); setRevealed(false); setHelp(null);
    }
  }, [idx, pool.length, items, secs, subject, unit, onFinish, go]);

  useEffect(() => {
    const h = (e) => {
      if (e.target && ["TEXTAREA", "INPUT"].includes(e.target.tagName)) return;
      if (!revealed) {
        const li = L.indexOf(e.key.toUpperCase());
        const ni = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
        const pick = li >= 0 && li < q.choices.length ? li : ni >= 0 && ni < q.choices.length ? ni : -1;
        if (pick >= 0) { e.preventDefault(); return setPicked(pick); }
      }
      if (e.key === "Enter") { e.preventDefault(); revealed ? next() : check(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [q, revealed, check, next]);

  const askDeeper = async () => {
    setHelping(true);
    try {
      setHelp(await askClaude(
        [{ role: "user", content: `AP ${SNAME[subject]} question:\n\n${q.stem}\n\n${q.choices.map((c, i) => `${L[i]}. ${c}`).join("\n")}\n\nCorrect answer: ${L[q.answer]}\nI chose ${L[picked]}.\n\nExplain this a different way from a standard answer key. Use the relevant graph and walk through what shifts and why. Under 160 words.` }],
        "You are an AP Economics tutor. Be precise with terminology, reference the exact graph and curves involved, and never pad. Plain text, no markdown.", 600));
    } catch { setHelp("The tutor could not be reached. Try again in a moment."); }
    setHelping(false);
  };

  const label = q.topic ? `${q.topic} ${topicTitle(subject, q.topic)}`
    : unit === 0 ? "Mixed set" : `Unit ${unit}`;

  return (
    <>
      <div className="wrap" style={{ maxWidth: 820 }}>
        <div className="crumb" style={{ justifyContent: "space-between" }}>
          <span style={{ display: "flex", gap: 9, alignItems: "center" }}>
            <button onClick={() => go({ v: "bank", subject })}>Question bank</button>
            <span>/</span><span>{label}</span>
          </span>
          <button className="mini" onClick={() => go({ v: "bank", subject })}>End set</button>
        </div>

        <Timer seconds={secs} paused={paused} onToggle={() => setPaused((v) => !v)} />
        <div className="segs" style={{ marginBottom: 22 }}>
          {pool.map((_, i) => {
            const r = items[i];
            return <div key={i} className={"seg " + (r ? (r.correct ? "ok" : "no") : i === idx ? "now" : "")} />;
          })}
        </div>

        <QuestionView q={q} index={idx} total={pool.length} picked={picked} revealed={revealed}
          onPick={setPicked} saved={savedIds.includes(q.id)}
          onToggleSave={() => setSavedIds((p) => (p.includes(q.id) ? p.filter((x) => x !== q.id) : [...p, q.id]))} />

        {revealed && (
          <div className="fb">
            <div className={"v " + (picked === q.answer ? "y" : "n")}>
              {picked === q.answer ? "Correct" : `Not quite — the answer is ${L[q.answer]}`}
            </div>
            <p>{q.explanation}</p>
            {help && <p style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--line)" }}>{help}</p>}
            {!help && <button className="mini" style={{ marginTop: 14 }} onClick={askDeeper} disabled={helping}>
              {helping ? <><span className="spin" /> Thinking</> : "Explain it another way"}</button>}
          </div>
        )}

        <div className="qfoot">
          <span className="hint">
            {revealed ? "Press Enter for the next question" : "Pick with A–E, then Enter to check"}
          </span>
          {revealed
            ? <button className="btn acc" onClick={next}>{idx + 1 >= pool.length ? "See results" : "Next"}</button>
            : <button className="btn" onClick={check} disabled={picked === null}>Check</button>}
        </div>
      </div>
    </>
  );
}


/* ---------------------------- saved and mistakes ---------------------------- */

function Saved({ bank, me, nav }) {
  const { go } = nav;
  const [savedIds] = useLocal("equilibrium:saved", []);
  const [notes] = useLocal("equilibrium:notes", {});
  const [tab, setTab] = useState("saved");
  const missed = me.missed || [];

  const list = tab === "saved"
    ? bank.questions.filter((q) => savedIds.includes(q.id))
    : bank.questions.filter((q) => missed.includes(q.id));

  const start = () => { if (list.length) go({ v: "practice", subject: list[0].subject, unit: 0, pool: shuffle(list) }); };

  return (
    <>
      <div className="wrap">
        <div className="phead" style={{ paddingTop: 30 }}>
          <div>
            <h1>Saved and mistakes</h1>
            <div className="sub">Questions you marked for review, and every question you have got wrong and not yet fixed.</div>
          </div>
        </div>
        <div className="filters">
          <button className={"fbtn" + (tab === "saved" ? " on" : "")} onClick={() => setTab("saved")}>Marked for review ({savedIds.length})</button>
          <button className={"fbtn" + (tab === "missed" ? " on" : "")} onClick={() => setTab("missed")}>Still getting wrong ({missed.length})</button>
        </div>

        {list.length === 0 ? (
          <div className="empty">
            <h3>Nothing here yet</h3>
            {tab === "saved"
              ? "Use the bookmark on any question to keep it for later."
              : "Questions you answer incorrectly land here, and leave once you get them right."}
          </div>
        ) : (
          <>
            <div className="actions" style={{ marginTop: 0, marginBottom: 20 }}>
              <button className="btn acc" onClick={start}>Practise these {list.length}</button>
            </div>
            <div className="qlist">
              {list.map((q) => (
                <div key={q.id} className="qitem">
                  <span className="pill">{q.topic || (q.subject === "micro" ? "MI" : "MA") + "·" + q.unit}</span>
                  <span>
                    {q.stem.length > 96 ? q.stem.slice(0, 96) + "…" : q.stem}
                    {notes[q.id] && <span className="hint" style={{ display: "block", marginTop: 4 }}>Note: {notes[q.id]}</span>}
                  </span>
                  <span className="st">{SSHORT[q.subject]}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ height: 50 }} />
      </div>
    </>
  );
}

/* ---------------------------- analytics ---------------------------- */

function Analytics({ bank, me, nav }) {
  const rows = (subject) => UNITS[subject].flatMap((u) =>
    (TOPICS[subject][u.n] || []).map(([code, title]) => {
      const st = (me.topic || {})[`${subject}-${code}`];
      return { code, title, unit: u.n, a: st?.a || 0, p: st ? pct(st.c, st.a) : null };
    })).filter((r) => r.a > 0);

  const overall = (subject) => {
    let a = 0, c = 0;
    Object.entries(me.unit || {}).forEach(([k, v]) => { if (k.startsWith(subject + "-")) { a += v.a; c += v.c; } });
    return { a, p: pct(c, a) };
  };

  return (
    <>
      <div className="wrap">
        <div className="phead" style={{ paddingTop: 30 }}>
          <div>
            <h1>Analytics</h1>
            <div className="sub">Your accuracy on every topic you have practised, weakest first. This is stored on this device.</div>
          </div>
        </div>
        {["micro", "macro"].map((sub) => {
          const list = rows(sub).sort((x, y) => x.p - y.p);
          const o = overall(sub);
          return (
            <div key={sub} style={{ marginBottom: 34, "--accent": sub === "micro" ? "var(--micro)" : "var(--macro)" }}>
              <div className="ugtitle">
                <h3>AP {SNAME[sub]}</h3>
                <span className="num">{o.a ? `${o.p}% across ${o.a} questions` : "nothing yet"}</span>
              </div>
              {list.length === 0
                ? <div className="empty" style={{ padding: 26 }}>Practise a topic and it will show up here.</div>
                : <div className="btable">
                  {list.map((r) => (
                    <div className="brow" key={r.code} style={{ gridTemplateColumns: "1fr 150px 74px" }}>
                      <span className="tp"><span className="tc">{r.code}</span><span className="tt">{r.title}</span></span>
                      <span className="prog"><span className="bar"><i style={{ width: `${r.p}%` }} /></span>
                        <span className="n">{r.a}</span></span>
                      <span className="acc2">
                        <span className="pip" style={{ background: r.p >= 80 ? "var(--ok)" : r.p >= 55 ? "var(--micro)" : "var(--no)" }} />
                        {r.p}%
                      </span>
                    </div>
                  ))}
                </div>}
            </div>
          );
        })}
        <div style={{ height: 50 }} />
      </div>
    </>
  );
}

/* ---------------------------- study planner ---------------------------- */

function Planner({ bank, me, nav }) {
  const { go } = nav;
  const weak = (subject) => UNITS[subject].flatMap((u) =>
    (TOPICS[subject][u.n] || []).map(([code, title]) => {
      const st = (me.topic || {})[`${subject}-${code}`];
      const have = bank.questions.filter((q) => q.subject === subject && q.topic === code).length;
      return { code, title, weight: u.weight, have, a: st?.a || 0, p: st ? pct(st.c, st.a) : null };
    })).filter((r) => r.have > 0);

  /* Rank by what the exam rewards: heavy units you are weak or untested on. */
  const plan = (subject) => weak(subject)
    .map((r) => ({ ...r, score: r.weight * (r.p === null ? 1 : (100 - r.p) / 100 + 0.15) }))
    .sort((x, y) => y.score - x.score).slice(0, 6);

  return (
    <>
      <div className="wrap">
        <div className="phead" style={{ paddingTop: 30 }}>
          <div>
            <h1>Study planner</h1>
            <div className="sub">What to work on next, ranked by how much each topic is worth on the exam against how well you are doing on it.</div>
          </div>
        </div>
        {["micro", "macro"].map((sub) => {
          const list = plan(sub);
          return (
            <div key={sub} style={{ marginBottom: 34, "--accent": sub === "micro" ? "var(--micro)" : "var(--macro)" }}>
              <div className="ugtitle"><h3>AP {SNAME[sub]}</h3></div>
              {list.length === 0
                ? <div className="empty" style={{ padding: 26 }}>No questions in this course yet.</div>
                : <div className="btable">
                  {list.map((r, i) => (
                    <button className="brow" key={r.code} style={{ gridTemplateColumns: "26px 1fr 150px 74px" }}
                      onClick={() => go({ v: "practice", subject: sub, unit: 0, pool: shuffle(bank.questions.filter((q) => q.subject === sub && q.topic === r.code)) })}>
                      <span className="num" style={{ color: "var(--tx3)", fontSize: 12.5 }}>{i + 1}</span>
                      <span className="tp"><span className="tc">{r.code}</span><span className="tt">{r.title}</span></span>
                      <span className="hint">{r.p === null ? "not started" : `${r.p}% so far`} · unit worth {r.weight}%</span>
                      <span className="acc2" style={{ color: "var(--accent)" }}>{r.have} q</span>
                    </button>
                  ))}
                </div>}
            </div>
          );
        })}
        <div style={{ height: 50 }} />
      </div>
    </>
  );
}

/* ---------------------------- full-length test picker ---------------------------- */

function Tests({ bank, nav }) {
  const { go } = nav;
  const startTest = (subject) => {
    const p = buildMock(bank.questions, subject);
    if (p.length >= 5) go({ v: "mock", subject, pool: p });
  };
  return (
    <>
      <div className="wrap">
        <div className="phead" style={{ paddingTop: 30 }}>
          <div>
            <h1>Full-length test</h1>
            <div className="sub">A timed multiple-choice paper drawn in College Board unit proportions, then a score report with a predicted 1 to 5.</div>
          </div>
        </div>
        {["micro", "macro"].map((sub) => {
          const n = Math.min(60, bank.questions.filter((q) => q.subject === sub).length);
          return (
            <div className="mockcard" key={sub} style={{ "--accent": sub === "micro" ? "var(--micro)" : "var(--macro)" }}>
              <div>
                <span className="mk">AP {SSHORT[sub]}</span>
                <h3>{SNAME[sub]}</h3>
                <p>Weighted across all six units, roughly a quarter easy, half medium, a quarter hard.</p>
                <div className="ml">
                  <div><b className="num">{n}</b><span>questions</span></div>
                  <div><b className="num">{Math.round(Math.min(4200, n * 70) / 60)}</b><span>minutes</span></div>
                  <div><b className="num">70s</b><span>per question</span></div>
                </div>
              </div>
              <button className="btn" onClick={() => startTest(sub)} disabled={n < 5}>
                {n < 5 ? "Needs at least 5 questions" : "Start the test"}
              </button>
            </div>
          );
        })}
        <div style={{ height: 50 }} />
      </div>
    </>
  );
}

/* ---------------------------- results ---------------------------- */

function Results({ subject, unit, items, secs, nav }) {
  const { go } = nav;
  const correct = items.filter((i) => i.correct).length;
  const p = pct(correct, items.length) ?? 0;
  const verdict = p >= 85 ? "Strong. Move to a heavier unit." : p >= 60 ? "Close. Redo the ones you missed today, not next week." : "Read every explanation below before trying this unit again.";
  return (
    <>
      
      <div className="wrap">
        <div className="crumb">
          <button onClick={() => go({ v: "home" })}>Equilibrium</button><span>/</span>
          <button onClick={() => go({ v: "course", subject })}>AP {SNAME[subject]}</button><span>/</span>
          <span>{unit === 0 ? "Mixed set" : `Unit ${unit}`}</span>
        </div>
        <div className="score">
          <div className="n">{p}%</div>
          <div className="side"><b>{correct} of {items.length} correct</b>{mmss(secs)} total · {items.length ? Math.round(secs / items.length) : 0}s per question</div>
          <div className="side" style={{ marginLeft: "auto", maxWidth: 250, color: "var(--tx2)" }}>{verdict}</div>
        </div>
        <div className="rev">
          {items.map((it, i) => (
            <details key={i} className="ritem">
              <summary>
                <span className="num" style={{ color: "var(--tx3)", fontSize: 13 }}>{String(i + 1).padStart(2, "0")}</span>
                <span>{it.q.stem.length > 96 ? it.q.stem.slice(0, 96) + "…" : it.q.stem}</span>
                <span className={"dot " + (it.correct ? "y" : "n")} />
              </summary>
              <div className="rbody">
                <div className="ln"><b>Correct:</b> {L[it.q.answer]}. {it.q.choices[it.q.answer]}</div>
                {!it.correct && <div className="ln"><b>You chose:</b> {L[it.picked]}. {it.q.choices[it.picked]}</div>}
                <div className="ln" style={{ marginTop: 12 }}>{it.q.explanation}</div>
              </div>
            </details>
          ))}
        </div>
        <div className="actions" style={{ paddingBottom: 50 }}>
          <button className="btn acc" onClick={() => go({ v: "course", subject })}>Back to units</button>
          <button className="btn ghost" onClick={() => go({ v: "tutor" })}>Ask the tutor about a question</button>
        </div>
      </div>
    </>
  );
}

/* ---------------------------- mock exam ---------------------------- */

function Mock({ subject, pool, go, onFinish, nav }) {
  const [idx, setIdx] = useState(0);
  const [ans, setAns] = useState({});
  const [left, setLeft] = useState(Math.min(4200, pool.length * 70));
  const [grid, setGrid] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [savedIds, setSavedIds] = useLocal("equilibrium:saved", []);
  const doneRef = useRef(false);
  const q = pool[idx];
  const answered = Object.keys(ans).length;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const items = pool.map((x) => ({ id: x.id, picked: ans[x.id] ?? null, correct: ans[x.id] === x.answer, q: x }));
    const secs = Math.min(4200, pool.length * 70) - left;
    onFinish({ subject, unit: 0, mode: "test", items: items.filter((i) => i.picked !== null), secs });
    go({ v: "mockresult", subject, items, secs });
  }, [pool, ans, left, subject, onFinish, go]);

  useEffect(() => {
    const t = setInterval(() => setLeft((x) => { if (x <= 1) { clearInterval(t); finish(); return 0; } return x - 1; }), 1000);
    return () => clearInterval(t);
  }, [finish]);

  useEffect(() => {
    const h = (e) => {
      if (grid || confirm) return;
      if (e.target && ["TEXTAREA", "INPUT"].includes(e.target.tagName)) return;
      const li = L.indexOf(e.key.toUpperCase());
      const ni = ["1", "2", "3", "4", "5", "6"].indexOf(e.key);
      const pick = li >= 0 && li < q.choices.length ? li : ni >= 0 && ni < q.choices.length ? ni : -1;
      if (pick >= 0) { e.preventDefault(); return setAns((p) => ({ ...p, [q.id]: pick })); }
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); setIdx((i) => Math.min(pool.length - 1, i + 1)); }
      if (e.key === "ArrowLeft") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [q, pool.length, grid, confirm]);

  return (
    <>
      <div className="wrap" style={{ maxWidth: 820 }}>
        <div className="crumb" style={{ justifyContent: "space-between" }}>
          <span>Full-length test · AP {SNAME[subject]}</span>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="mini" onClick={() => setGrid(true)}>Review</button>
            <button className="mini" onClick={() => setConfirm(true)}>Submit</button>
          </span>
        </div>
        <div className="timer">
          <div className={"digits" + (left < 300 ? " lowtime" : "")}>{mmss(left)}</div>
        </div>
        <div className="segs" style={{ marginBottom: 22 }}>
          {pool.map((x, i) => <div key={i} className={"seg " + (ans[x.id] !== undefined ? "seen" : i === idx ? "now" : "")}
            style={ans[x.id] !== undefined ? { background: "var(--tx3)" } : undefined} />)}
        </div>

        <QuestionView q={q} index={idx} total={pool.length} picked={ans[q.id] ?? null} revealed={false}
          onPick={(i) => setAns((p) => ({ ...p, [q.id]: i }))} saved={savedIds.includes(q.id)}
          onToggleSave={() => setSavedIds((p) => (p.includes(q.id) ? p.filter((x) => x !== q.id) : [...p, q.id]))} />

        <div className="qfoot">
          <span className="hint">{answered} of {pool.length} answered · no feedback until you submit</span>
          <span style={{ display: "flex", gap: 10 }}>
            <button className="btn ghost" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>Back</button>
            {idx + 1 < pool.length
              ? <button className="btn" onClick={() => setIdx((i) => i + 1)}>Next</button>
              : <button className="btn acc" onClick={() => setConfirm(true)}>Finish and score</button>}
          </span>
        </div>
      </div>

      {grid && (
        <div className="sheet" onClick={() => setGrid(false)}>
          <div className="sheetin" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 21, marginBottom: 6 }}>Question map</h2>
            <p className="hint" style={{ marginTop: 0, marginBottom: 18 }}>{answered} of {pool.length} answered. A dot marks a saved question.</p>
            <div className="qgrid">
              {pool.map((x, i) => (
                <button key={x.id} className={"gcell" + (ans[x.id] !== undefined ? " done" : "") + (i === idx ? " now" : "") + (savedIds.includes(x.id) ? " fl" : "")}
                  onClick={() => { setIdx(i); setGrid(false); }}>{i + 1}</button>
              ))}
            </div>
            <div className="actions"><button className="btn ghost" onClick={() => setGrid(false)}>Close</button></div>
          </div>
        </div>
      )}

      {confirm && (
        <div className="sheet" onClick={() => setConfirm(false)}>
          <div className="sheetin" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2 style={{ fontSize: 21, marginBottom: 10 }}>Submit the paper?</h2>
            <p style={{ color: "var(--tx2)", fontSize: 14.5, marginTop: 0 }}>
              {answered === pool.length
                ? "Everything is answered. You will see your score and every explanation next."
                : `${pool.length - answered} question${pool.length - answered === 1 ? " is" : "s are"} still blank. Blanks are marked wrong, and there is no guessing penalty on the real exam.`}
            </p>
            <div className="actions">
              <button className="btn acc" onClick={finish}>Submit</button>
              <button className="btn ghost" onClick={() => setConfirm(false)}>Keep working</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MockResult({ subject, items, secs, bands, nav }) {
  const { go } = nav;
  const b = (bands && bands[subject]) || DEFAULT_BANDS[subject];
  const n = items.length;
  const correct = items.filter((i) => i.correct).length;
  const blank = items.filter((i) => i.picked === null).length;
  const mcqPct = n ? correct / n : 0;
  const mcqPts = mcqPct * MCQ_POINTS;
  const [frq, setFrq] = useState(Math.round(mcqPct * FRQ_RAW));
  const composite = Math.round(mcqPts + (frq / FRQ_RAW) * FRQ_POINTS);
  const score = apScore(composite, b);
  const rows = bandRange(b);
  const next = rows.find((r) => r.s === score + 1);

  const unitRows = UNITS[subject].map((u) => {
    const set = items.filter((i) => i.q.unit === u.n);
    return { ...u, n: set.length, p: set.length ? Math.round((set.filter((i) => i.correct).length / set.length) * 100) : null };
  }).filter((u) => u.n > 0);

  return (
    <>
      
      <div className="wrap" style={{ maxWidth: 940 }}>
        <div className="crumb">
          <button onClick={() => go({ v: "home" })}>Equilibrium</button><span>/</span>
          <button onClick={() => go({ v: "course", subject })}>AP {SNAME[subject]}</button><span>/</span>
          <span>Full-length test</span>
        </div>

        <div style={{ display: "flex", gap: 44, alignItems: "flex-end", flexWrap: "wrap", padding: "30px 0 8px" }}>
          <div>
            <div className="hint" style={{ marginBottom: 12 }}>Predicted AP score</div>
            <div className="bigscore" style={{ color: score >= 4 ? "var(--ok)" : score === 3 ? "var(--accent)" : "var(--tx)" }}>{score}</div>
          </div>
          <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
            <div><div className="v num" style={{ fontSize: 28, fontWeight: 600 }}>{composite}<span style={{ color: "var(--tx3)", fontSize: 16 }}>/90</span></div><div className="hint">composite</div></div>
            <div><div className="v num" style={{ fontSize: 28, fontWeight: 600 }}>{correct}<span style={{ color: "var(--tx3)", fontSize: 16 }}>/{n}</span></div><div className="hint">multiple choice</div></div>
            <div><div className="v num" style={{ fontSize: 28, fontWeight: 600 }}>{Math.round(mcqPct * 100)}%</div><div className="hint">accuracy</div></div>
            <div><div className="v num" style={{ fontSize: 28, fontWeight: 600 }}>{mmss(secs)}</div><div className="hint">time used</div></div>
          </div>
        </div>
        {blank > 0 && <p className="hint" style={{ marginTop: 4 }}>{blank} left blank and counted wrong.</p>}

        <div className="sechead">What the free-response section would do</div>
        <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--bg2)", padding: "20px 22px", maxWidth: 620 }}>
          <p style={{ margin: "0 0 16px", color: "var(--tx2)", fontSize: 14.5 }}>
            This mock is multiple choice only, which is 60 of the 90 composite points. The slider assumes how you would do on the three FRQs — one long worth 10 raw points and two short worth 5 each. It starts matched to your multiple-choice accuracy.
          </p>
          <input type="range" min={0} max={FRQ_RAW} value={frq} onChange={(e) => setFrq(Number(e.target.value))} aria-label="Estimated FRQ raw points" />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            <span className="hint">FRQ raw points</span>
            <span className="num" style={{ fontWeight: 600 }}>{frq} / {FRQ_RAW} → {Math.round((frq / FRQ_RAW) * FRQ_POINTS)} composite</span>
          </div>
        </div>

        <div className="sechead">Where the bands sit</div>
        <div className="bands" style={{ maxWidth: 620 }}>
          {rows.map((r) => (
            <div key={r.s} className={"bandrow" + (r.s === score ? " on" : "")}>
              <span className="bs">{r.s}</span>
              <span>{r.s === 5 ? "Extremely well qualified" : r.s === 4 ? "Well qualified" : r.s === 3 ? "Qualified" : r.s === 2 ? "Possibly qualified" : "No recommendation"}</span>
              <span className="br">{r.lo}–{r.hi}</span>
            </div>
          ))}
        </div>
        <p className="hint" style={{ maxWidth: 620, marginTop: 12 }}>
          College Board sets the raw-to-score conversion after each administration and does not publish it in advance, so these bands are estimates from released exams and recent score distributions. They can be adjusted in the console.
          {next && ` You are ${next.lo - composite} composite point${next.lo - composite === 1 ? "" : "s"} from a ${next.s}.`}
        </p>

        <div className="sechead">By unit</div>
        {unitRows.map((u) => (
          <div key={u.n} className="abar" style={{ maxWidth: 620 }}>
            <span>{u.n}. {u.title.length > 24 ? u.title.slice(0, 24) + "…" : u.title}</span>
            <span className="track"><i style={{ width: `${u.p}%` }} /></span>
            <span className="val">{u.p}%</span>
          </div>
        ))}

        <div className="sechead">Every question</div>
        <div className="rev">
          {items.map((it, i) => (
            <details key={i} className="ritem">
              <summary>
                <span className="num" style={{ color: "var(--tx3)", fontSize: 13 }}>{String(i + 1).padStart(2, "0")}</span>
                <span>{it.q.stem.length > 92 ? it.q.stem.slice(0, 92) + "…" : it.q.stem}</span>
                <span className={"dot " + (it.correct ? "y" : "n")} />
              </summary>
              <div className="rbody">
                <div className="ln"><b>Correct:</b> {L[it.q.answer]}. {it.q.choices[it.q.answer]}</div>
                <div className="ln"><b>You chose:</b> {it.picked === null ? "left blank" : `${L[it.picked]}. ${it.q.choices[it.picked]}`}</div>
                <div className="ln" style={{ marginTop: 12 }}>{it.q.explanation}</div>
              </div>
            </details>
          ))}
        </div>

        <div className="actions" style={{ paddingBottom: 54 }}>
          <button className="btn acc" onClick={() => go({ v: "course", subject })}>Back to the course</button>
          <button className="btn ghost" onClick={() => go({ v: "tutor" })}>Ask the tutor about a question</button>
        </div>
      </div>
    </>
  );
}

/* ---------------------------- tutor ---------------------------- */

const TUTOR_SYS = `You are the tutor inside Equilibrium, a practice site for AP Microeconomics and AP Macroeconomics.
Answer only economics questions at the level of those two courses. If asked something unrelated, say briefly that you only cover AP Micro and Macro and offer a related econ topic.
Be precise with AP terminology. When a graph is involved, name the axes, name each curve, and say exactly which curve shifts in which direction and why.
Prefer short paragraphs over lists. No markdown headers, no bold. Keep answers under 220 words unless asked for a full walkthrough.
If a student's reasoning has a specific error, name the error rather than restating the correct answer.`;

const CHIPS = [
  "Why is the LRAS curve vertical?",
  "Shift versus movement along the demand curve",
  "Walk me through crowding out on a graph",
  "When do I use MRP versus MRC?",
];

function Tutor({ nav }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  const send = async (text) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    const nm = [...msgs, { role: "user", content: t }];
    setMsgs(nm); setInput(""); setBusy(true);
    try { setMsgs([...nm, { role: "assistant", content: await askClaude(nm, TUTOR_SYS, 900) }]); }
    catch { setMsgs([...nm, { role: "assistant", content: "The tutor could not be reached just now. Send that again in a moment." }]); }
    setBusy(false);
  };

  return (
    <>
      
      <div className="wrap" style={{ maxWidth: 860 }}>
        <div className="phead" style={{ paddingTop: 34 }}>
          <div><h1>Ask the tutor</h1>
            <div className="sub">Anything from either course — a concept, a graph, or a question you got wrong.</div></div>
        </div>
        {msgs.length === 0 && <div className="chips">{CHIPS.map((c) => <button key={c} className="chip" onClick={() => send(c)}>{c}</button>)}</div>}
        <div className="chat">
          <div className="msgs">
            {msgs.length === 0 && <div style={{ color: "var(--tx3)", fontSize: 14.5, margin: "auto", textAlign: "center", maxWidth: 340 }}>
              Start with a question above, or type your own. The tutor sticks to AP Micro and Macro.</div>}
            {msgs.map((m, i) => <div key={i} className={"msg " + (m.role === "user" ? "u" : "a")}>{m.content}</div>)}
            {busy && <div className="msg a" style={{ color: "var(--tx3)" }}><span className="spin" /> Working through it</div>}
            <div ref={endRef} />
          </div>
          <div className="composer">
            <textarea rows={2} value={input} placeholder="Ask about a concept, a graph, or a question you missed"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="btn acc" onClick={() => send()} disabled={busy || !input.trim()}>Send</button>
          </div>
        </div>
        <div style={{ height: 46 }} />
      </div>
    </>
  );
}

/* ============================================================
   ADMIN
   ============================================================ */

const BLANK_Q = { id: "", subject: "micro", unit: 1, topic: "", image: "", difficulty: "medium", stem: "", choices: ["", "", "", "", ""], answer: 0, explanation: "" };
const BLANK_M = { id: "", subject: "micro", unit: 1, kind: "note", title: "", body: "", url: "" };

function Admin({ bank, setBank, refreshBank, go, admin }) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState(""), [pw, setPw] = useState("");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("materials");
  const [stats, setStats] = useState({ byQ: {}, sessions: [] });

  useEffect(() => {
    (async () => {
      const { data } = await getSession();
      setAuthed(Boolean(data?.session) && (admin || await isAdmin()));
      setChecking(false);
    })();
  }, []);

  /* Sessions are readable only by an admin, so they load after sign in. */
  const loadStats = useCallback(async () => {
    try {
      const rows = await loadSessions();
      const byQ = {};
      rows.forEach((r) => (r.answers || []).forEach((a) => {
        const c = byQ[a.qid] || { a: 0, c: 0 };
        byQ[a.qid] = { a: c.a + 1, c: c.c + (a.correct ? 1 : 0) };
      }));
      setStats({ byQ, sessions: rows.map((r) => ({ ts: new Date(r.created_at).getTime(), ...r })) });
    } catch { /* leave the panel empty rather than breaking it */ }
  }, []);

  useEffect(() => { if (authed) loadStats(); }, [authed, loadStats]);

  const tryIn = async () => {
    setBusy(true); setErr("");
    try {
      await signIn(email.trim(), pw);
      if (await isAdmin()) setAuthed(true);
      else { await signOut(); setErr("That account does not have console access."); }
    }
    catch (e) { setErr(e.message === "Invalid login credentials" ? "That email and password don't match." : e.message || "Could not sign in."); }
    setBusy(false);
  };

  if (checking) return <div className="wrap" style={{ paddingTop: 90, color: "var(--tx3)" }}><span className="spin" /> Checking</div>;

  if (!authed) return (
    <div className="wrap" style={{ maxWidth: 400, paddingTop: 90 }}>
      <Mark size={34} />
      <h1 style={{ fontSize: 28, margin: "22px 0 8px" }}>Console</h1>
      <p style={{ color: "var(--tx3)", fontSize: 14, marginTop: 0, marginBottom: 24 }}>Sign in to manage lessons, questions, and results.</p>
      <label className="field"><span>Email</span>
        <input type="text" value={email} autoFocus autoComplete="username"
          onChange={(e) => { setEmail(e.target.value); setErr(""); }} /></label>
      <label className="field"><span>Password</span>
        <input type="password" value={pw} autoComplete="current-password"
          onChange={(e) => { setPw(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && tryIn()} /></label>
      {err && <div style={{ color: "var(--no)", fontSize: 13, marginBottom: 14 }}>{err}</div>}
      <button className="btn" onClick={tryIn} disabled={busy || !email || !pw}>{busy ? <><span className="spin" /> Signing in</> : "Sign in"}</button>
      <button className="btn ghost" style={{ marginLeft: 10 }} onClick={() => go({ v: "home" })}>Back to site</button>
    </div>
  );

  return (
    <div className="wrap">
      <div className="navin" style={{ borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Brand size={17} mark={21} /><span className="wm" style={{ fontSize: 17, marginLeft: 10, color: "var(--tx3)" }}>Console</span></div>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="mini" onClick={() => go({ v: "home" })}>View site</button>
          <button className="mini" onClick={async () => { await signOut(); setAuthed(false); }}>Sign out</button>
        </span>
      </div>
      <div className="atabs">
        {[["materials", "Lessons"], ["questions", "Questions"], ["generate", "Write with AI"], ["results", "Results"], ["settings", "Settings"]].map(([k, v]) => (
          <button key={k} className={"atab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{v}</button>
        ))}
      </div>
      {tab === "materials" && <AMaterials bank={bank} refreshBank={refreshBank} />}
      {tab === "questions" && <AQuestions bank={bank} refreshBank={refreshBank} stats={stats} />}
      {tab === "generate" && <AGenerate bank={bank} refreshBank={refreshBank} />}
      {tab === "results" && <AResults bank={bank} stats={stats} reload={loadStats} />}
      {tab === "settings" && <ASettings bank={bank} setBank={setBank} refreshBank={refreshBank} reload={loadStats} />}
      <div style={{ height: 60 }} />
    </div>
  );
}

function AMaterials({ bank, refreshBank }) {
  const [fs, setFs] = useState("all"), [fu, setFu] = useState("all");
  const [editing, setEditing] = useState(null);
  const list = bank.materials.filter((m) => (fs === "all" || m.subject === fs) && (fu === "all" || String(m.unit) === fu));

  const [err, setErr] = useState("");
  const save = async (m) => {
    try { await upsertMaterial(m); await refreshBank(); setEditing(null); setErr(""); }
    catch (e) { setErr(e.message || "Could not save. Are you still signed in?"); }
  };
  const remove = async (id) => {
    if (!window.confirm("Delete this lesson?")) return;
    try { await deleteMaterial(id); await refreshBank(); } catch (e) { setErr(e.message || "Could not delete."); }
  };

  if (editing) return <MForm m={editing} onSave={save} onCancel={() => setEditing(null)} />;

  return (
    <>
      <div className="note">Lessons appear on the unit page above the practice set. Notes support plain paragraphs, lines starting with <span className="num">##</span> for a subheading, and lines starting with <span className="num">-</span> for bullets.</div>
      <div className="row3" style={{ marginBottom: 18 }}>
        <label className="field" style={{ margin: 0 }}><span>Course</span>
          <select value={fs} onChange={(e) => setFs(e.target.value)}>
            <option value="all">All courses</option><option value="micro">Microeconomics</option><option value="macro">Macroeconomics</option></select></label>
        <label className="field" style={{ margin: 0 }}><span>Unit</span>
          <select value={fu} onChange={(e) => setFu(e.target.value)}>
            <option value="all">All units</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={String(n)}>Unit {n}</option>)}</select></label>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
        <button className="btn sm" onClick={() => setEditing({ ...BLANK_M, id: uid() })}>Add lesson</button>
        <span className="hint">{list.length} shown · {bank.materials.length} total</span>
      </div>
      {list.length === 0 ? (
        <div className="empty"><h3>No lessons yet</h3>Add notes, a formula sheet, or a link to a video for any unit.</div>
      ) : (
        <div className="qlist">
          {list.map((m) => (
            <div key={m.id} className="qitem">
              <span className="pill">{m.subject === "micro" ? "MI" : "MA"}·{m.unit}</span>
              <span><b style={{ fontWeight: 600 }}>{m.title}</b> <span className="st" style={{ marginLeft: 8 }}>{m.kind}</span></span>
              <span style={{ display: "flex", gap: 8 }}>
                <button className="mini" onClick={() => setEditing(m)}>Edit</button>
                <button className="mini danger" onClick={() => remove(m.id)}>Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MForm({ m, onSave, onCancel }) {
  const [d, setD] = useState(m);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  const u = UNITS[d.subject][d.unit - 1];
  const valid = d.title.trim() && (d.kind === "link" ? d.url.trim() : d.body.trim());

  const draft = async () => {
    setBusy(true);
    try {
      const txt = await askClaude([{ role: "user", content:
`Write student notes for AP ${SNAME[d.subject]}, Unit ${d.unit}: ${u.title}. Content of the unit: ${u.blurb}.${d.title ? ` Focus on: ${d.title}.` : ""}
Format: short paragraphs. Use a line starting with "## " for each subheading and lines starting with "- " for bullets. No bold, no markdown tables.
Cover the definitions, the graph or graphs involved (name axes and curves), the shifts that matter, and the two or three mistakes students make most. Around 350 words.` }],
        "You write concise AP Economics study notes. Plain text with ## subheadings and - bullets only.", 1600);
      set("body", txt);
    } catch { set("body", d.body || "Could not reach the writer. Try again."); }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <h2 style={{ fontSize: 23, marginBottom: 20 }}>{m.title ? "Edit lesson" : "New lesson"}</h2>
      <div className="row3">
        <label className="field"><span>Course</span>
          <select value={d.subject} onChange={(e) => setD((p) => ({ ...p, subject: e.target.value, unit: 1 }))}>
            <option value="micro">Microeconomics</option><option value="macro">Macroeconomics</option></select></label>
        <label className="field"><span>Unit</span>
          <select value={d.unit} onChange={(e) => set("unit", Number(e.target.value))}>
            {UNITS[d.subject].map((x) => <option key={x.n} value={x.n}>{x.n}. {x.title}</option>)}</select></label>
        <label className="field"><span>Type</span>
          <select value={d.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="note">Notes</option><option value="formula">Formula sheet</option><option value="link">External link</option></select></label>
      </div>
      <label className="field"><span>Title</span>
        <input type="text" value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="Price controls and deadweight loss" /></label>
      {d.kind === "link" ? (
        <label className="field"><span>URL</span>
          <input type="text" value={d.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" /></label>
      ) : (
        <label className="field"><span>Content</span>
          <textarea rows={14} value={d.body} onChange={(e) => set("body", e.target.value)}
            placeholder={"## What the graph shows\nPrice on the vertical axis, quantity on the horizontal…\n\n- A binding ceiling sits below equilibrium\n- The result is a shortage, not a surplus"} /></label>
      )}
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn" onClick={() => onSave(d)} disabled={!valid}>Save lesson</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        {d.kind !== "link" && <button className="mini" onClick={draft} disabled={busy}>{busy ? <><span className="spin" /> Writing</> : "Draft with AI"}</button>}
        {d.kind !== "link" && <span className="hint">Drafting replaces the content box. Edit it before saving.</span>}
      </div>
    </div>
  );
}

function AQuestions({ bank, refreshBank, stats }) {
  const [fs, setFs] = useState("all"), [fu, setFu] = useState("all"), [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const list = useMemo(() => bank.questions.filter((q) =>
    (fs === "all" || q.subject === fs) && (fu === "all" || String(q.unit) === fu) &&
    (!search || (q.stem + q.explanation).toLowerCase().includes(search.toLowerCase()))), [bank.questions, fs, fu, search]);

  const [err, setErr] = useState("");
  const save = async (q) => {
    try { await upsertQuestions([q]); await refreshBank(); setEditing(null); setErr(""); }
    catch (e) { setErr(e.message || "Could not save. Are you still signed in?"); }
  };
  const remove = async (id) => {
    if (!window.confirm("Delete this question?")) return;
    try { await deleteQuestion(id); await refreshBank(); } catch (e) { setErr(e.message || "Could not delete."); }
  };
  if (editing) return <QForm q={editing} onSave={save} onCancel={() => setEditing(null)} />;

  return (
    <>
      <div className="row3" style={{ marginBottom: 18 }}>
        <label className="field" style={{ margin: 0 }}><span>Course</span>
          <select value={fs} onChange={(e) => setFs(e.target.value)}>
            <option value="all">All courses</option><option value="micro">Microeconomics</option><option value="macro">Macroeconomics</option></select></label>
        <label className="field" style={{ margin: 0 }}><span>Unit</span>
          <select value={fu} onChange={(e) => setFu(e.target.value)}>
            <option value="all">All units</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={String(n)}>Unit {n}</option>)}</select></label>
        <label className="field" style={{ margin: 0 }}><span>Search</span>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="elasticity, multiplier…" /></label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <button className="btn sm" onClick={() => setEditing({ ...BLANK_Q, id: uid() })}>Add question</button>
        <span className="hint">{list.length} shown · {bank.questions.length} in the bank</span>
      </div>
      {list.length === 0 ? (
        <div className="empty"><h3>Nothing here yet</h3>Add a question by hand, or draft a batch under “Write with AI” and approve the ones you like.</div>
      ) : (
        <div className="qlist">
          {list.map((q) => {
            const st = stats.byQ[q.id];
            return (
              <div key={q.id} className="qitem">
                <span className="pill">{q.topic || (q.subject === "micro" ? "MI" : "MA") + "·" + q.unit}{q.image ? " ▣" : ""}</span>
                <span>{q.stem.length > 90 ? q.stem.slice(0, 90) + "…" : q.stem}</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="st num">{st ? `${pct(st.c, st.a)}% of ${st.a}` : "no data"}</span>
                  <button className="mini" onClick={() => setEditing(q)}>Edit</button>
                  <button className="mini" onClick={() => setEditing({ ...q, id: uid() })}>Copy</button>
                  <button className="mini danger" onClick={() => remove(q.id)}>Delete</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function QForm({ q, onSave, onCancel }) {
  const [d, setD] = useState(q);
  const [up, setUp] = useState(false), [imgErr, setImgErr] = useState("");
  const set = (k, v) => setD((p) => ({ ...p, [k]: v }));
  const valid = d.stem.trim() && d.choices.filter((c) => c.trim()).length >= 2 && d.choices[d.answer]?.trim() && d.explanation.trim();
  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ fontSize: 23, marginBottom: 20 }}>{q.stem ? "Edit question" : "New question"}</h2>
      <div className="row3">
        <label className="field"><span>Course</span>
          <select value={d.subject} onChange={(e) => setD((p) => ({ ...p, subject: e.target.value, unit: 1, topic: "" }))}>
            <option value="micro">Microeconomics</option><option value="macro">Macroeconomics</option></select></label>
        <label className="field"><span>Unit</span>
          <select value={d.unit} onChange={(e) => setD((p) => ({ ...p, unit: Number(e.target.value), topic: "" }))}>
            {UNITS[d.subject].map((u) => <option key={u.n} value={u.n}>{u.n}. {u.title}</option>)}</select></label>
        <label className="field"><span>Difficulty</span>
          <select value={d.difficulty} onChange={(e) => set("difficulty", e.target.value)}>
            <option value="easy">easy</option><option value="medium">medium</option><option value="hard">hard</option></select></label>
      </div>
      <label className="field"><span>Topic — this is what the question bank groups by</span>
        <select value={d.topic || ""} onChange={(e) => set("topic", e.target.value)}>
          <option value="">Not set</option>
          {(TOPICS[d.subject][d.unit] || []).map(([code, title]) => (
            <option key={code} value={code}>{code} {title}</option>
          ))}
        </select></label>
      <label className="field"><span>Question</span>
        <textarea rows={3} value={d.stem} onChange={(e) => set("stem", e.target.value)} /></label>

      <div className="field">
        <span>Figure — a graph or table, shown under the question</span>
        {d.image ? (
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <img src={d.image} alt="" style={{ maxWidth: 240, borderRadius: 10, border: "1px solid var(--line)" }} />
            <button className="mini danger" onClick={() => set("image", "")}>Remove</button>
          </div>
        ) : (
          <>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 4 * 1024 * 1024) { setImgErr("That file is over 4 MB. Shrink it first."); return; }
                setImgErr(""); setUp(true);
                try { set("image", await uploadImage(f)); }
                catch (er) { setImgErr(er.message || "Upload failed. Is the storage bucket set up?"); }
                setUp(false);
              }} />
            {up && <div className="hint" style={{ marginTop: 8 }}><span className="spin" /> Uploading</div>}
            {imgErr && <div style={{ color: "var(--no)", fontSize: 13, marginTop: 8 }}>{imgErr}</div>}
            <input type="text" style={{ marginTop: 10 }} value={d.image}
              onChange={(e) => set("image", e.target.value)} placeholder="…or paste an image URL" />
          </>
        )}
      </div>

      <div className="field">
        <span>Answer choices — mark the correct one</span>
        {d.choices.map((c, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <input type="radio" name="ans" checked={d.answer === i} onChange={() => set("answer", i)} aria-label={`Mark ${L[i]} correct`} />
            <span className="pill">{L[i]}</span>
            <input type="text" value={c} onChange={(e) => setD((p) => ({ ...p, choices: p.choices.map((x, j) => (j === i ? e.target.value : x)) }))} />
            <button className="mini danger" disabled={d.choices.length <= 2}
              onClick={() => setD((p) => ({ ...p, choices: p.choices.filter((_, j) => j !== i), answer: p.answer >= i && p.answer > 0 ? p.answer - 1 : p.answer }))}>Remove</button>
          </div>
        ))}
        {d.choices.length < 6 && <button className="mini" onClick={() => setD((p) => ({ ...p, choices: [...p.choices, ""] }))}>Add choice</button>}
      </div>
      <label className="field"><span>Explanation shown after answering</span>
        <textarea rows={5} value={d.explanation} onChange={(e) => set("explanation", e.target.value)} /></label>
      <div className="actions">
        <button className="btn" onClick={() => onSave(d)} disabled={!valid}>Save question</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        {!valid && <span className="hint">Needs a stem, two or more choices, a marked answer, and an explanation.</span>}
      </div>
    </div>
  );
}

function AGenerate({ bank, refreshBank }) {
  const [subject, setSubject] = useState("micro"), [unit, setUnit] = useState(1);
  const [difficulty, setDifficulty] = useState("medium"), [count, setCount] = useState(5);
  const [topic, setTopic] = useState(""), [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [drafts, setDrafts] = useState([]), [err, setErr] = useState("");
  const u = UNITS[subject][unit - 1];

  const run = async () => {
    setBusy(true); setErr(""); setDrafts([]);
    try {
      const raw = await askClaude([{ role: "user", content:
`Write ${count} exam-style multiple-choice questions for AP ${SNAME[subject]}, Unit ${unit}: ${u.title}.
Content of this unit: ${u.blurb}.
${code ? `Stay inside CED topic ${code}: ${topicTitle(subject, code)}.` : ""}\n${topic ? `Focus narrowly on: ${topic}.` : ""}
Difficulty: ${difficulty}.

Rules: five answer choices each; distractors must reflect real student errors, not filler; no "all of the above"; stems under 55 words; explanations 40-80 words saying why the answer is right and why the most tempting wrong choice is wrong.

Return ONLY JSON, no prose and no code fences:
{"questions":[{"stem":"","choices":["","","","",""],"answer":0,"explanation":"","difficulty":"${difficulty}"}]}
"answer" is the zero-based index of the correct choice.` }],
        "You write AP Economics assessment items. You return valid JSON only, never wrapped in code fences.", 4000);
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
      const list = (parsed.questions || []).filter((x) => x.stem && Array.isArray(x.choices) && x.choices.length >= 2);
      if (!list.length) throw new Error();
      setDrafts(list.map((x) => ({ ...x, id: uid(), subject, unit, topic: code, difficulty: x.difficulty || difficulty, answer: Number(x.answer) || 0, _keep: true })));
    } catch { setErr("The draft came back unreadable. Run it again, or lower the count."); }
    setBusy(false);
  };

  const keepAll = async () => {
    const add = drafts.filter((d) => d._keep).map(({ _keep, ...q }) => q);
    if (!add.length) return;
    try { await upsertQuestions(add); await refreshBank(); setDrafts([]); }
    catch (e) { setErr(e.message || "Could not save these. Are you still signed in?"); }
  };

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="note">Drafts are never published on their own. Review each one, untick anything weak, then add the rest.</div>
      <div className="row3">
        <label className="field"><span>Course</span>
          <select value={subject} onChange={(e) => { setSubject(e.target.value); setUnit(1); setCode(""); }}>
            <option value="micro">Microeconomics</option><option value="macro">Macroeconomics</option></select></label>
        <label className="field"><span>Unit</span>
          <select value={unit} onChange={(e) => { setUnit(Number(e.target.value)); setCode(""); }}>
            {UNITS[subject].map((x) => <option key={x.n} value={x.n}>{x.n}. {x.title}</option>)}</select></label>
        <label className="field"><span>Difficulty</span>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="easy">easy</option><option value="medium">medium</option><option value="hard">hard</option></select></label>
      </div>
      <div className="row3">
        <label className="field"><span>How many</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} questions</option>)}</select></label>
        <label className="field"><span>CED topic</span>
          <select value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">Spread across the unit</option>
            {(TOPICS[subject][unit] || []).map(([c, t]) => <option key={c} value={c}>{c} {t}</option>)}
          </select></label>
        <label className="field"><span>Narrow it further (optional)</span>
          <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="price ceilings and deadweight loss" /></label>
      </div>
      <div className="actions" style={{ marginTop: 4 }}>
        <button className="btn" onClick={run} disabled={busy}>{busy ? <><span className="spin" /> Writing</> : "Draft questions"}</button>
        {err && <span style={{ color: "var(--no)", fontSize: 13.5 }}>{err}</span>}
      </div>
      {drafts.length > 0 && (<>
        <div className="sechead">{drafts.length} drafts · {drafts.filter((d) => d._keep).length} selected</div>
        {drafts.map((d, i) => (
          <div className="draft" key={d.id}>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={d._keep} style={{ marginTop: 5 }}
                onChange={() => setDrafts((p) => p.map((x, j) => (j === i ? { ...x, _keep: !x._keep } : x)))} />
              <span style={{ fontSize: 15.5, fontWeight: 500 }}>{d.stem}</span>
            </label>
            <div style={{ margin: "12px 0 0 28px", fontSize: 14, color: "var(--tx2)" }}>
              {d.choices.map((c, j) => (
                <div key={j} style={{ padding: "3px 0", color: j === d.answer ? "var(--ok)" : "var(--tx2)" }}>
                  <span className="num" style={{ marginRight: 8 }}>{L[j]}</span>{c}</div>
              ))}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 13.5, color: "var(--tx3)" }}>{d.explanation}</div>
            </div>
          </div>
        ))}
        <div className="actions">
          <button className="btn acc" onClick={keepAll}>Add {drafts.filter((d) => d._keep).length} to the bank</button>
          <button className="btn ghost" onClick={() => setDrafts([])}>Discard all</button>
        </div>
      </>)}
    </div>
  );
}

function AResults({ bank, stats, reload }) {
  const totals = useMemo(() => { let a = 0, c = 0; Object.values(stats.byQ).forEach((v) => { a += v.a; c += v.c; }); return { a, c }; }, [stats.byQ]);
  const unitRows = (s) => UNITS[s].map((u) => {
    let a = 0, c = 0;
    bank.questions.filter((q) => q.subject === s && q.unit === u.n).forEach((q) => { const v = stats.byQ[q.id]; if (v) { a += v.a; c += v.c; } });
    return { ...u, p: pct(c, a) };
  });
  const hardest = useMemo(() => bank.questions.map((q) => ({ q, st: stats.byQ[q.id] })).filter((x) => x.st && x.st.a >= 3)
    .map((x) => ({ ...x, p: pct(x.st.c, x.st.a) })).sort((x, y) => x.p - y.p).slice(0, 8), [bank.questions, stats.byQ]);

  if (!totals.a) return <div className="empty"><h3>No practice data yet</h3>Accuracy by unit, the hardest questions, and every completed set will appear here.</div>;

  return (
    <div>
      <div className="stats">
        <div className="stat"><div className="v">{stats.sessions.length}</div><div className="l">sets completed</div></div>
        <div className="stat"><div className="v">{totals.a}</div><div className="l">answers recorded</div></div>
        <div className="stat"><div className="v">{pct(totals.c, totals.a)}%</div><div className="l">overall accuracy</div></div>
        <div className="stat"><div className="v">{bank.questions.length}</div><div className="l">questions live</div></div>
      </div>
      <div className="sechead" style={{ marginTop: 0 }}>Accuracy by unit</div>
      {["micro", "macro"].map((s) => (
        <div key={s} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: "var(--tx3)", marginBottom: 8 }}>AP {SNAME[s]}</div>
          {unitRows(s).map((u) => (
            <div key={u.n} className="abar">
              <span>{u.n}. {u.title.length > 22 ? u.title.slice(0, 22) + "…" : u.title}</span>
              <span className="track"><i style={{ width: `${u.p ?? 0}%`, background: s === "micro" ? "var(--micro)" : "var(--macro)" }} /></span>
              <span className="val">{u.p === null ? "—" : u.p + "%"}</span>
            </div>
          ))}
        </div>
      ))}
      {hardest.length > 0 && (<>
        <div className="sechead">Missed most often</div>
        <div className="qlist">
          {hardest.map(({ q, st, p }) => (
            <div key={q.id} className="qitem">
              <span className="pill">{q.subject === "micro" ? "MI" : "MA"}·{q.unit}</span>
              <span>{q.stem.length > 88 ? q.stem.slice(0, 88) + "…" : q.stem}</span>
              <span className="st num" style={{ color: p < 40 ? "var(--no)" : "var(--tx3)" }}>{p}% of {st.a}</span>
            </div>
          ))}
        </div>
      </>)}
      <div className="sechead">Recent sets</div>
      <div className="qlist">
        {stats.sessions.slice(0, 12).map((s, i) => (
          <div key={i} className="qitem">
            <span className="pill">{s.subject === "micro" ? "MI" : "MA"}·{s.unit || "mix"}</span>
            <span>{new Date(s.ts).toLocaleString()}</span>
            <span className="st num">{s.correct}/{s.total} · {mmss(s.secs)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ASettings({ bank, refreshBank, reload }) {
  const [io, setIo] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [bands, setBandsLocal] = useState(bank.bands || DEFAULT_BANDS);

  const exportAll = () => setIo(JSON.stringify({ questions: bank.questions, materials: bank.materials }, null, 2));

  const importAll = async () => {
    setBusy(true);
    try {
      const raw = JSON.parse(io);
      const qArr = Array.isArray(raw) ? raw : raw.questions || [];
      const mArr = Array.isArray(raw) ? [] : raw.materials || [];
      const qs = qArr.filter((q) => q && q.stem && Array.isArray(q.choices)).map((q) => ({
        id: q.id || uid(), subject: q.subject === "macro" ? "macro" : "micro",
        unit: Math.min(6, Math.max(1, Number(q.unit) || 1)),
        difficulty: ["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : "medium",
        stem: String(q.stem), choices: q.choices.map(String),
        answer: Math.min(q.choices.length - 1, Math.max(0, Number(q.answer) || 0)),
        explanation: String(q.explanation || ""),
      }));
      const ms = mArr.filter((m) => m && m.title).map((m) => ({
        id: m.id || uid(), subject: m.subject === "macro" ? "macro" : "micro",
        unit: Math.min(6, Math.max(1, Number(m.unit) || 1)),
        kind: ["note", "formula", "link"].includes(m.kind) ? m.kind : "note",
        title: String(m.title), body: String(m.body || ""), url: String(m.url || ""), position: 0,
      }));
      if (!qs.length && !ms.length) throw new Error("empty");
      if (qs.length) await upsertQuestions(qs);
      for (const m of ms) await upsertMaterial(m);
      await refreshBank();
      setMsg(`Imported ${qs.length} questions and ${ms.length} lessons.`);
    } catch (e) {
      setMsg(e.message === "empty" ? "Nothing usable in there. Export first to see the shape." : e.message || "Import failed.");
    }
    setBusy(false);
  };

  const setBand = (s, k, v) => setBandsLocal((p) => ({ ...p, [s]: { ...p[s], [k]: v } }));

  const commitBands = async (next) => {
    try { await saveBands(next); await refreshBank(); setMsg("Cutoffs saved."); }
    catch (e) { setMsg(e.message || "Could not save the cutoffs."); }
  };

  return (
    <div style={{ maxWidth: 660 }}>
      <div className="note" style={{ marginTop: 0 }}>
        Admin accounts live in the Supabase dashboard under Authentication → Users. Add a teacher there to give them this
        console, remove them there to take it away, and change passwords in the same place.
      </div>

      <div className="sechead" style={{ marginTop: 0 }}>Mock exam score cutoffs</div>
      <p style={{ fontSize: 13.5, color: "var(--tx3)", marginTop: 0, marginBottom: 14 }}>
        Composite is out of 90: 60 points of multiple choice plus 30 scaled from the free-response section.
        College Board sets the raw-to-score conversion after each administration and never publishes it in advance,
        so these are estimates from released exams and recent score distributions. Change them when better data lands.
      </p>
      {["micro", "macro"].map((s) => (
        <div key={s} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: "var(--tx2)", marginBottom: 8 }}>AP {SNAME[s]} — minimum composite for each score</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[["five", 5], ["four", 4], ["three", 3], ["two", 2]].map(([k, label]) => (
              <label key={k} className="field" style={{ margin: 0 }}>
                <span>Score {label}</span>
                <input type="text" inputMode="numeric" value={bands[s][k]}
                  onChange={(e) => setBand(s, k, Math.max(0, Math.min(90, Number(e.target.value.replace(/\D/g, "")) || 0)))} />
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="actions" style={{ marginTop: 4 }}>
        <button className="btn sm" onClick={() => commitBands(bands)}>Save cutoffs</button>
        <button className="btn sm ghost" onClick={() => { setBandsLocal(DEFAULT_BANDS); commitBands(DEFAULT_BANDS); }}>Reset to defaults</button>
      </div>

      <div className="sechead">Import and export</div>
      <p style={{ fontSize: 13.5, color: "var(--tx3)", marginTop: 0 }}>Covers questions and lessons together. Matching ids are replaced, new ids are added.</p>
      <textarea rows={9} value={io} onChange={(e) => setIo(e.target.value)} placeholder='{"questions":[…],"materials":[…]}' />
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn sm ghost" onClick={exportAll}>Export everything</button>
        <button className="btn sm" onClick={importAll} disabled={!io.trim() || busy}>{busy ? <><span className="spin" /> Importing</> : "Import"}</button>
      </div>

      <div className="sechead">Student results</div>
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn sm ghost" onClick={reload}>Reload results</button>
        <button className="btn sm ghost" onClick={async () => {
          if (!window.confirm("Delete every recorded result? Lessons and questions are kept.")) return;
          try { await supabase.from("sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000"); await reload(); setMsg("Results cleared."); }
          catch (e) { setMsg(e.message || "Could not clear results."); }
        }}>Clear all results</button>
      </div>

      {msg && <div className="note" style={{ marginTop: 22 }}>{msg}</div>}
      <div className="note" style={{ marginTop: 16 }}>
        The console is not linked anywhere on the site. Reach it at /admin, or with Ctrl+Shift+A. Access is enforced by
        Supabase row level security, so a visitor who finds this page still cannot read or change anything without an account.
      </div>
    </div>
  );
}
