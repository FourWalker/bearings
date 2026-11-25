// Builds the shareable Bearings preview page from the attention concept's live demos, so the
// demos and Tack's real artwork are not copied by hand.
// Run from the repo root, after build-tack-reference.mjs:
//   node docs/board/concepts/build-bearings-preview.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "pin-attention-concept.html"), "utf8").replaceAll("\r\n", "\n");
const cut = (from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`missing: ${from.slice(0, 50)} … ${to.slice(0, 50)}`);
  return src.slice(a, b);
};
const demoCss = cut("<style>", "</style>").slice("<style>".length);
const themeToolbar = cut('  <div class="toolbar"><span class="lbl">State</span>', '  <div class="pair">');
const themePair = cut('  <div class="pair">', "  <h2>Option 2");
const focusDemo = cut(
  '  <div class="toolbar"><span class="lbl">Tack skin</span>',
  '  <p class="cap">The Sub Tack stands',
).replace(/  <div class="toolbar"><span class="lbl">Plotter's<\/span>[\s\S]*?<\/div>\n/, "");
let scripts = src.slice(src.indexOf("<script>\n/*TACK-ART:data*/"), src.lastIndexOf("</script>") + 9);

// Extra, inside the demo's own script: the skins gallery beside Tack's introduction.
const gallery = `
  const skinRow = $("skins");
  if (skinRow) for (const [name, label] of [["claude", "Claude"], ["ivory", "Ivory"], ["mint", "Mint"], ["night", "Night"], ["pin", "Pushpin"]]) {
    const s = ART.strips[name].idle, scale = 3, w = ART.cell.width * scale, h = ART.cell.height * scale;
    const c = document.createElement("canvas"); c.width = s.frames * ART.cell.width; c.height = ART.cell.height; const g = c.getContext("2d");
    s.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== ".") { g.fillStyle = s.palette[row.charCodeAt(x) - 97]; g.fillRect(x, y, 1, 1); } });
    const fig = document.createElement("figure");
    fig.innerHTML = '<span class="tack-avatar" style="width:' + w + 'px;height:' + h + 'px;background-image:url(' + c.toDataURL() + ');background-size:' + s.frames * w + 'px ' + h + 'px;--tack-strip-end:-' + s.frames * w + 'px;animation:tack-strip ' + s.frames / s.fps + 's steps(' + s.frames + ') infinite"></span><figcaption>' + label + '</figcaption>';
    skinRow.append(fig);
  }
`;
const hook = '  document.addEventListener("click", (e) => {\n    const b = e.target.closest("button"); if (!b) return;';
if (!scripts.includes(hook)) throw new Error("missing click hook");
scripts = scripts.replace(hook, gallery + hook);

const sections = readFileSync(resolve(here, "bearings-sections.html"), "utf8").replaceAll("\r\n", "\n");
const part = (name) => {
  const a = sections.indexOf(`<!--@${name}-->`);
  if (a < 0) throw new Error(`no section ${name}`);
  const from = a + name.length + 8;
  const b = sections.indexOf("<!--@", from);
  return sections.slice(from, b < 0 ? undefined : b);
};
scripts = scripts.replace(hook, part("js") + hook);

const anon = (text) => text.replaceAll("NEFX", "Acme");

const page = `<title>Bearings Preview</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap">
<style>
${demoCss}
  /* ---------- the preview page: a chart table. Grid paper, navy ink, one rust mark. ---------- */
  :root { --paper:#efe4d0; --sheet:#f6efe2; --ink:#1f2a48; --ink-soft:#545c72; --rust:#c4552d; --rule:rgb(31 42 72 / .1); --line:#d2c6b0;
    --display:"Source Serif 4","Iowan Old Style","Palatino Linotype",Georgia,serif; --text:"Inter",-apple-system,"Segoe UI",system-ui,sans-serif; --label:"IBM Plex Mono",ui-monospace,Consolas,monospace;
    --d-bg:var(--paper); --d-card:var(--sheet); --d-border:var(--line); --d-fg:var(--ink); --d-muted:var(--ink-soft); --d-accent:var(--rust); }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper:#1c2333; --sheet:#252f45; --ink:#c3cce0; --ink-soft:#8692ae; --rust:#e98a5e; --rule:rgb(170 182 208 / .08); --line:#313b52; color-scheme:dark } }
  :root[data-theme="dark"] { --paper:#1c2333; --sheet:#252f45; --ink:#c3cce0; --ink-soft:#8692ae; --rust:#e98a5e; --rule:rgb(170 182 208 / .08); --line:#313b52; color-scheme:dark }
  body { background-color:var(--paper); color:var(--ink); font:16px/1.55 var(--text);
    background-image:linear-gradient(var(--rule) 1px,transparent 1px),linear-gradient(90deg,var(--rule) 1px,transparent 1px); background-size:24px 24px; }
  .wrap { max-width:1120px; margin:0 auto; padding-block:48px 96px; padding-left:max(16px, env(safe-area-inset-left, 0px)); padding-right:max(16px, env(safe-area-inset-right, 0px)); display:grid; gap:72px; }
  .wrap h1, .wrap h2, .wrap h3 { font-family:var(--display); font-weight:500; letter-spacing:-.01em; text-wrap:balance; margin:0; color:var(--ink); }
  .eyebrow { font:500 12px var(--label); letter-spacing:.12em; text-transform:uppercase; color:var(--rust); margin:0 0 14px; }
  .hero h1 { font-size:clamp(56px, 11vw, 128px); line-height:.92; }
  .hero h1 em { font-style:italic; color:var(--rust); }
  .hero .tag { font:400 clamp(20px, 2.6vw, 28px)/1.3 var(--display); max-width:22em; margin:22px 0 0; }
  .hero .sub { max-width:60ch; color:var(--ink-soft); margin:16px 0 0; }
  .tenses { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:0; margin-top:36px; border-top:2px solid var(--ink); }
  .tenses div { padding:16px 18px 4px 0; min-width:0; } .tenses div + div { padding-left:18px; border-left:1px solid var(--line); }
  .tenses b { display:block; font:500 12px var(--label); letter-spacing:.1em; text-transform:uppercase; color:var(--ink-soft); margin-bottom:6px; }
  .tenses span { font:400 19px/1.3 var(--display); }
  .section { display:grid; gap:20px; min-width:0; }
  .section > header { display:grid; gap:10px; max-width:68ch; }
  .section h2 { font-size:clamp(30px, 4.4vw, 46px); line-height:1.05; }
  .section p { margin:0; } .section .lede { font-size:18px; color:var(--ink); } .section .more { color:var(--ink-soft); }
  .not { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:14px 40px; }
  .not p { padding-left:16px; border-left:2px solid var(--rust); min-width:0; } .not b { font-weight:600; }
  .points { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:18px 28px; margin:0; padding:0; list-style:none; }
  .points li { min-width:0; font-size:15px; color:var(--ink-soft); } .points b { display:block; font:500 17px/1.3 var(--display); color:var(--ink); margin-bottom:3px; }
  .meet { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,340px); gap:28px; align-items:start; }
  .chat { background:var(--sheet); border:1px solid var(--line); border-radius:6px; padding:14px; display:grid; gap:10px; font-size:14px; box-shadow:0 10px 24px -18px rgb(31 42 72 / .5); }
  .chat .who { font:500 11px var(--label); letter-spacing:.08em; text-transform:uppercase; color:var(--ink-soft); }
  .chat .me { justify-self:end; background:var(--ink); color:var(--paper); border-radius:10px 10px 2px 10px; padding:6px 10px; max-width:85%; }
  .chat .tack { border-left:2px solid var(--rust); padding-left:10px; } .chat .tack b { font-weight:600; }
  #skins { display:flex; flex-wrap:wrap; gap:18px 26px; align-items:flex-end; margin:6px 0 0; }
  #skins figure { margin:0; display:grid; gap:6px; justify-items:center; } #skins figcaption { font:11px var(--label); color:var(--ink-soft); letter-spacing:.06em; text-transform:uppercase; }
  .wrap .btn { background:var(--sheet); color:var(--ink); border:1px solid var(--line); border-radius:4px; font:500 12.5px var(--text); }
  .wrap .btn:hover { background:var(--paper); } .wrap .btn.on { border-color:var(--rust); color:var(--rust); }
  .wrap .toolbar .lbl { font:500 11px var(--label); letter-spacing:.08em; text-transform:uppercase; color:var(--ink-soft); }
  .wrap .stage { border:1px solid var(--line); border-radius:8px; overflow-x:auto; box-shadow:0 18px 40px -28px rgb(31 42 72 / .6); margin:6px 0 0; }
  .wrap .stage > .app { min-width:780px; }
  .wrap .pair h3 { font:500 20px var(--display); margin:0 0 2px; }
  .wrap .cap { color:var(--ink-soft); font-size:13.5px; max-width:70ch; margin:8px 0 0; }
  .foot { border-top:1px solid var(--line); padding-top:18px; color:var(--ink-soft); font-size:13.5px; max-width:75ch; }
${part("css")}
  @media (max-width:760px) { .tenses, .not, .points, .meet { grid-template-columns:minmax(0,1fr); } .tenses div + div { padding-left:0; border-left:0; border-top:1px solid var(--line); } .wrap { gap:56px; } }
  @media (prefers-reduced-motion: reduce) { .wrap * { animation:none !important; transition:none !important; } }
</style>

<main class="wrap">
  <section class="hero">
    <p class="eyebrow">Preview · for developers who run coding agents</p>
    <h1>Bear<em>ings</em></h1>
    <p class="tag">Know what your agents did, what they are doing, and what they will do next.</p>
    <p class="sub">Technical debt used to be the thing that slowed a team down. With agents writing the code, the new cost is knowledge debt: work gets done faster than anyone can follow it. Bearings sits between you and your agents and keeps the whole picture in front of you.</p>
    <div class="tenses">
      <div><b>What happened</b><span>Every finished step, with the evidence it was done.</span></div>
      <div><b>What is happening</b><span>Which agent is on which task, live, and what it is running.</span></div>
      <div><b>What happens next</b><span>The plan each agent follows, and the step it is on.</span></div>
    </div>
  </section>

  <section class="section">
    <header>
      <p class="eyebrow">What it is not</p>
      <h2>Not a ticket tracker. Not a wiki.</h2>
    </header>
    <div class="not">
      <p><b>Nobody files updates.</b> The board reads the agents' own work: the plan they saved, the steps they ticked, the files they changed, the checks they ran. It stays true without anyone maintaining it.</p>
      <p><b>Nothing to look up.</b> A knowledge base answers questions you think to ask. Bearings shows the state of the work before you ask, and tells you when something is waiting on you.</p>
    </div>
  </section>

${part("board")}
  <section class="section">
    <header>
      <p class="eyebrow">The board assistant</p>
      <h2>Meet Tack. It lives on the board.</h2>
      <p class="lede">Tack is a small character that sleeps in the corner of your board until you call it. Ask it where things stand and it answers from the board itself, then walks to the note it is talking about.</p>
    </header>
    <div class="meet">
      <div style="display:grid;gap:22px;min-width:0">
        <ul class="points">
          <li><b>Ask in plain words</b>"What is blocked?" "What should I pick up next?" Tack finds it and shows you the task.</li>
          <li><b>It holds your notices</b>When a chat finishes, fails or needs an answer, Tack announces it once and keeps it until you deal with it.</li>
          <li><b>It asks before it writes</b>Tack reads and points. Creating anything on the board needs your yes first.</li>
          <li><b>It follows you into a task</b>Open a task and Tack is there too, ready for a question or to continue the work.</li>
          <li><b>Pick its model</b>Choose which AI model answers on the board and inside a task.</li>
          <li><b>Make it yours</b>Seven skins, three levels of motion, and it can live in a corner, in the side panel, or float.</li>
        </ul>
        <div><p class="eyebrow" style="margin-bottom:8px">Some of Tack's skins</p><div id="skins"></div></div>
      </div>
      <div class="chat" aria-label="An example conversation with Tack">
        <span class="who">Tack · Acme board</span>
        <span class="me">What needs me right now?</span>
        <span class="tack">Two things. <b>Retry loop spins</b> is waiting for your approval to push. <b>Key rotation</b> is blocked by the SFTP auth module.</span>
        <span class="me">Show me the first one.</span>
        <span class="tack">Walking over to it now.</span>
        <span class="who">An example, not a recording</span>
      </div>
    </div>
${part("fly")}
  </section>

  <section class="section">
    <header>
      <p class="eyebrow">Focus Mode</p>
      <h2>Pin the one thing you cannot miss.</h2>
      <p class="lede">Pin a task or a module and a slim bar about it stays at the top of the board, on every view. It shows the step in hand, how far the plan has come, and what the agent is doing this minute.</p>
      <p class="more">When the pinned work needs an approval, asks a question, hits an open decision, gets blocked or stops, the bar changes colour and stays that way until you deal with it. If you want it harder to miss, Tack sends a Sub Tack: a small helper that goes to the bar and makes a fuss, while Tack stays where it is. All of it is read from the agent's own activity, so it costs no extra tokens.</p>
    </header>
${part("pin")}
    <h3 style="font-size:24px">When it needs you, it will not sit quietly.</h3>
    <p class="cap" style="margin:0">Live demo. Press "The pinned chat needs you", then "You dealt with it". Switch Tack's skin and the theme.</p>
${anon(focusDemo)}
    <ul class="points">
      <li><b>The step in hand, always</b>Not a flash when something ticks: the current step has its own place and moves on when the agent finishes it.</li>
      <li><b>One button, the right one</b>Review, Answer, Decide, Open blocker. The bar offers the next move for the state it is in.</li>
      <li><b>A peek without leaving</b>Open the bar to see the last few things the agent ran and the whole plan.</li>
    </ul>
  </section>

${part("plan")}
  <section class="section">
    <header>
      <p class="eyebrow">Themes</p>
      <h2>Two looks made for it, day and night.</h2>
      <p class="lede">Plotter is grid paper, navy ink and one rust pin, where notes are cards and a pen draws what matters. Plotter Tide is the calmer sibling, with colour notes and soft edges. Each catches your eye in its own manner.</p>
    </header>
${anon(themeToolbar)}${anon(themePair)}
  </section>

  <p class="foot">Bearings is a working preview built on the open source T3 Code. The boards on this page are illustrations using the product's real artwork and motion; the names and tasks in them are made up.</p>
  <div id="cands" hidden></div>
</main>
${anon(scripts)}
`;
writeFileSync(resolve(here, "bearings-preview.html"), page);
console.log("bearings-preview.html", Math.round(page.length / 1024) + " KB");
