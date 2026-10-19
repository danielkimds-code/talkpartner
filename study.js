// TalkPartner study module: study notes, cloud sync, spaced-repetition review,
// pattern drill, script rehearsal, Vietnamese beginner course, PDF export.
(() => {
  const TP = window.TP;
  if (!TP) return;
  const COURSE = window.VI_COURSE || [];
  const UNITS = window.EN_UNITS || [];
  const DAY = 864e5;
  const BOX_DAYS = [0, 1, 3, 7, 14, 30];
  const $ = (id) => document.getElementById(id);

  // ---------- small helpers ----------
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const rc = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmtDate = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const hasHangul = (t) => /[가-힣]/.test(t || "");
  const firstAlt = (t) => String(t || "").split(" / ")[0].trim();

  function stripVi(t) { return String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D"); }
  function normWords(t, lang) {
    let s = String(t).toLowerCase();
    if (lang === "vi") s = stripVi(s);
    else s = s.replace(/[’‘]/g, "'").replace(/\bi'm\b/g, "i am").replace(/'re\b/g, " are").replace(/'ll\b/g, " will")
      .replace(/'ve\b/g, " have").replace(/\bcan't\b/g, "cannot").replace(/\bwon't\b/g, "will not").replace(/n't\b/g, " not").replace(/'d\b/g, " would");
    return s.replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);
  }
  function lcsMatch(a, b) {
    const m = a.length, n = b.length, dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const hit = new Array(m).fill(false); let i = 0, j = 0;
    while (i < m && j < n) { if (a[i] === b[j]) { hit[i] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
    return { len: dp[0][0], hit };
  }
  // Compare what was said with the target (accepting "A / B" alternatives).
  function check(target, said, lang) {
    const alts = String(target).split(" / ").map(x => x.trim()).filter(Boolean);
    const sw = normWords(said, lang);
    let best = null;
    for (const alt of alts) {
      const tw = normWords(alt, lang);
      const { len, hit } = lcsMatch(tw, sw);
      const score = tw.length + sw.length ? (2 * len) / (tw.length + sw.length) : 0;
      if (!best || score > best.score) best = { score, alt, hit, display: alt.split(/\s+/) };
    }
    const pass = best && best.score >= (lang === "vi" ? 0.6 : 0.8);
    return { ...best, pass };
  }
  function diffView(res) {
    // map normalized hits back onto display words (same order, best effort)
    const wrap = h("div", { class: "diff" });
    let k = 0;
    for (const w of res.display) {
      const n = normWords(w, "en").length || 1;
      const ok = res.hit.slice(k, k + n).every(Boolean); k += n;
      wrap.append(h("span", { class: ok ? "ok" : "miss" }, w), " ");
    }
    return wrap;
  }
  // Vietnamese tone of one syllable → arrow + Korean hint
  function toneOf(syl) {
    const d = String(syl).toLowerCase().normalize("NFD");
    if (d.includes("̀")) return { s: "↘", n: "내림" };
    if (d.includes("́")) return { s: "↗", n: "올림" };
    if (d.includes("̉")) return { s: "↘↗", n: "내렸다 올림" };
    if (d.includes("̃")) return { s: "↗~", n: "꺾어 올림" };
    if (d.includes("̣")) return { s: "↓", n: "짧고 낮게" };
    return { s: "→", n: "평평하게" };
  }
  function readBlock(v, r, big) {
    const vs = String(v).replace(/[?!.,]/g, "").split(/\s+/), rs = String(r).split(/\s+/);
    const row = h("div", { class: "syl-row" + (big ? " big" : "") });
    vs.forEach((sy, i) => {
      const t = toneOf(sy);
      row.append(h("div", { class: "syl" }, h("b", { text: rs[i] || "" }), h("i", { title: t.n, text: t.s }), h("small", { text: sy })));
    });
    return row;
  }

  // ---------- state + cloud sync ----------
  // Each account keeps its own copy on this device (key from the login token) and its own slot in the cloud.
  const lkey = () => "tp_state_v1_" + String((TP.relayToken && TP.relayToken()) || "anon").slice(0, 12);
  const blank = () => ({ v: 1, updatedAt: 0, notes: [], cards: [], vi: { done: {} }, en: { done: {}, reh: {}, talk: {}, custom: [], last: "" } });
  const fixShape = (o) => {
    o.vi = o.vi || { done: {} };
    o.en = Object.assign({ done: {}, reh: {}, talk: {}, custom: [], last: "" }, o.en || {});
    if (!Array.isArray(o.en.custom)) o.en.custom = [];
    return o;
  };
  const loadLocal = () => { try { return fixShape(Object.assign(blank(), JSON.parse(localStorage.getItem(lkey()) || "null") || {})); } catch { return blank(); } };
  let S = loadLocal();

  // English course with the signed-in learner's name filled in, plus lessons the AI wrote for this account
  let BASE = [];
  function personalize(v, u) {
    if (typeof v === "string") return v.replace(/\{NAME\}/g, u.en || "Kim").replace(/\{KNAME\}/g, u.id || "김");
    if (Array.isArray(v)) return v.map(x => personalize(x, u));
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = personalize(v[k], u); return o; }
    return v;
  }
  function loadCourse() { BASE = personalize(window.EN_COURSE || [], TP.user ? TP.user() : { id: "", en: "" }); }
  loadCourse();
  const allEN = () => BASE.concat(S.en.custom || []);
  let syncState = "local", saveTimer = null;
  const cloudURL = () => TP.BUILTIN_RELAY ? TP.BUILTIN_RELAY.replace(/\/+$/, "") + "/store/state" : "";
  const cloudOn = () => !!(cloudURL() && TP.useBuiltin() && TP.relayToken());
  function setSync(st) { syncState = st; const e = $("syncBadge"); if (e) e.replaceWith(syncBadge()); }
  function syncBadge() {
    const map = { local: ["이 기기에만 저장", "warn"], saving: ["저장 중…", ""], saved: ["☁ 클라우드 저장됨", "ok"], error: ["클라우드 저장 실패 · 이 기기에 보관 중", "warn"], loading: ["불러오는 중…", ""] };
    const [t, c] = map[syncState] || map.local;
    return h("span", { id: "syncBadge", class: "sync " + c, text: t });
  }
  function persist() {
    S.updatedAt = Date.now();
    try { localStorage.setItem(lkey(), JSON.stringify(S)); } catch {}
    if (!cloudOn()) { setSync("local"); return; }
    setSync("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const r = await fetch(cloudURL(), { method: "PUT", headers: { "content-type": "application/json", "x-tp-token": TP.relayToken() }, body: JSON.stringify(S) });
        setSync(r.ok ? "saved" : "error");
      } catch { setSync("error"); }
    }, 1500);
  }
  async function cloudLoad() {
    if (!cloudOn()) { setSync("local"); return; }
    setSync("loading");
    try {
      const r = await fetch(cloudURL(), { headers: { "x-tp-token": TP.relayToken() } });
      if (!r.ok) { setSync("error"); return; }
      const remote = await r.json();
      if (remote && remote.updatedAt > (S.updatedAt || 0)) {
        S = fixShape(Object.assign(blank(), remote));
        try { localStorage.setItem(lkey(), JSON.stringify(S)); } catch {}
      } else if ((S.updatedAt || 0) > ((remote && remote.updatedAt) || 0)) { persist(); return; }
      setSync("saved"); refreshHome();
    } catch { setSync("error"); }
  }

  // ---------- cards ----------
  function cardKey(lang, t) { return lang + ":" + normWords(firstAlt(t), lang).join(" "); }
  function addCard(c) {
    const key = cardKey(c.lang, c.t);
    if (!c.t || S.cards.some(x => cardKey(x.lang, x.t) === key)) return false;
    S.cards.push({ id: uid(), box: 0, due: Date.now(), created: Date.now(), hist: [], ...c });
    return true;
  }
  const dueCards = (lang) => S.cards.filter(c => (!lang || c.lang === lang) && c.due <= Date.now()).sort((a, b) => a.due - b.due);
  function grade(card, ok) {
    card.hist = (card.hist || []).concat(ok ? 1 : 0).slice(-10);
    card.last = Date.now();
    if (ok) { card.box = Math.min((card.box || 0) + 1, BOX_DAYS.length - 1); card.due = Date.now() + BOX_DAYS[card.box] * DAY; }
    else { card.box = 0; card.due = Date.now() + 5 * 60 * 1000; }
    persist();
  }

  // ---------- study note from a finished conversation (called by the app) ----------
  TP.makeNote = ({ lang, level, scene, d, turns, lessonId }) => {
    const look = TP.LOOK[scene.id] || {};
    const script = (Array.isArray(d.script) ? d.script : []).filter(x => x && x.t).slice(0, 14)
      .map(x => ({ who: /me|learner/i.test(x.who) ? "me" : "partner", t: TP.cleanSpoken(x.t), ko: hasHangul(x.ko) ? x.ko : "" }));
    const note = {
      id: uid(), date: Date.now(), lang, level, sceneId: scene.id, sceneTitle: scene.title, partner: look.name || "",
      score: Math.round(Number(d.score) || 0), summary: d.summary_ko || "",
      corrections: (d.corrections || []).map(c => ({ original: c.original || "", better: TP.cleanSpoken(c.better || ""), ko: hasHangul(c.ko) ? c.ko : "", why: c.why_ko || "", read: hasHangul(c.read) ? c.read : "" })),
      patterns: (d.patterns || []).map(p => ({ frame: p.frame || "", ko: p.ko || "", use: p.use_ko || "", examples: (p.examples || []).filter(e => e && e.t).slice(0, 3).map(e => ({ t: TP.cleanSpoken(e.t), ko: e.ko || "" })) })),
      expressions: (d.expressions || []).filter(x => x && (x.t || x.en)).map(x => ({ t: TP.cleanSpoken(x.t || x.en), ko: x.ko || "", read: hasHangul(x.read) ? x.read : "" })),
      script, turns: (turns || []).slice(-30), rehearsal: {},
    };
    let n = 0;
    const src = { noteId: note.id, src: scene.title };
    for (const c of note.corrections) if (c.better) n += addCard({ lang, kind: "corr", t: firstAlt(c.better), alt: c.better, ko: c.ko || c.why, old: c.original, read: c.read, ...src }) ? 1 : 0;
    for (const p of note.patterns) for (const e of p.examples) n += addCard({ lang, kind: "pat", t: e.t, ko: e.ko, frame: p.frame, frameKo: p.ko, ...src }) ? 1 : 0;
    for (const x of note.expressions.slice(0, 4)) n += addCard({ lang, kind: "expr", t: x.t, ko: x.ko, read: x.read, ...src }) ? 1 : 0;
    note.cardCount = n;
    note.targets = (Array.isArray(d.targets) ? d.targets : []).filter(x => x && x.t).map(x => ({ t: x.t, used: !!x.used, said: x.said || "" }));
    if (lessonId) { note.lessonId = lessonId; S.en.talk[lessonId] = { date: Date.now(), score: note.score }; }
    S.notes.unshift(note); S.notes = S.notes.slice(0, 200);
    persist();
    return note;
  };

  // expressions the learner has studied (used by free talk prompts)
  TP.learnedTargets = (lang) => {
    if (lang !== "en") return [];
    const recent = allEN().filter(L => S.en.done[L.id]).sort((a, b) => (S.en.done[b.id].date || 0) - (S.en.done[a.id].date || 0)).slice(0, 4);
    const out = [];
    for (const L of recent) for (const g of L.grammar) out.push(`${g.form} (e.g. ${g.ex[0].t})`);
    return out;
  };
  TP.lessonById = (id) => allEN().find(l => l.id === id) || null;

  // ---------- AI instant feedback ----------
  // Judges an answer that did not match the model sentence: accepts natural alternatives, explains real mistakes.
  async function aiJudge({ lang, target, said, ko, grammar, context }) {
    const L = lang === "vi" ? "Vietnamese" : "English";
    const prompt = `The learner (a Korean engineer) had to say this in ${L}. Meaning (Korean): "${ko || ""}". Model answer: "${target}".${grammar ? ` Target grammar: ${grammar}.` : ""}${context ? ` Context: ${context}` : ""}
The learner actually said (from speech recognition, punctuation and capitals may be missing): "${said}".
Judge it. ok = true if the learner's sentence is natural and grammatically correct and keeps the same meaning — different wording is fine${grammar ? ", but it should still use the target grammar" : ""}. Ignore capitalization, punctuation and obvious recognition glitches.
Return only JSON: {"ok": true or false, "feedback_ko": "1-2 short Korean sentences: what was good, what was wrong and why", "better": "the learner's own sentence fixed naturally (keep their words when possible)", "tip_ko": "one short Korean grammar tip, or empty"}`;
    try {
      const text = await TP.ask({ system: "You are a kind, precise speaking coach. Reply with only JSON.", messages: [{ role: "user", content: prompt }], max_tokens: 350 });
      const j = TP.parseJSON(text);
      return { ok: !!j.ok, feedback: String(j.feedback_ko || ""), better: TP.cleanSpoken(String(j.better || "")), tip: String(j.tip_ko || "") };
    } catch (e) { return { error: TP.errText(e) }; }
  }
  function aiBox(j, lang) {
    if (j.error) return h("div", { class: "ai-box warn" }, h("b", { text: "AI 피드백을 받지 못했어요" }), h("div", { class: "note", text: j.error }));
    return h("div", { class: "ai-box" + (j.ok ? " ok" : "") },
      h("div", { class: "ai-tag", text: j.ok ? "AI 코치 · 이렇게 말해도 자연스러워요" : "AI 코치" }),
      j.feedback ? h("div", { text: j.feedback }) : null,
      j.better ? h("div", { class: "ai-better" }, h("span", { text: j.better }), h("button", { class: "mini", text: "▶", onclick: () => say(j.better, lang) })) : null,
      j.tip ? h("div", { class: "note", text: "💡 " + j.tip }) : null);
  }
  const thinking = (t = "AI 코치가 확인하는 중…") => h("div", { class: "ai-box wait" }, h("span", { class: "dots" }), t);

  // ---------- home tabs ----------
  const TABS = {
    en: [["course", "코스"], ["review", "복습"], ["talk", "자유 대화"], ["notes", "내 노트"]],
    vi: [["course", "기초 코스"], ["review", "복습"], ["talk", "회화 (중급)"]],
  };
  let tab = null;
  const getTab = (lang) => { try { return localStorage.getItem("tp_tab2_" + lang) || "course"; } catch { return "course"; } };
  function setTab(t) { const lang = TP.getLang(); tab = t; try { localStorage.setItem("tp_tab2_" + lang, t); } catch {} refreshHome(); }

  function refreshHome() {
    const setup = $("setupView"); if (!setup) return;
    const lang = TP.getLang();
    if (!TABS[lang].some(([k]) => k === tab)) tab = getTab(lang);
    let nav = $("homeTabs");
    if (!nav) {
      nav = h("div", { id: "homeTabs", class: "hometabs" });
      setup.children[0].after(nav);
      nav.after(h("div", { id: "homePanel", class: "homepanel" }));
    }
    const due = dueCards(lang).length;
    rc(nav, ...TABS[lang].map(([k, label]) => h("button", { class: "htab", "aria-selected": String(k === tab), onclick: () => setTab(k) },
      label, k === "review" && due ? h("span", { class: "count", text: String(due) }) : null)), syncBadge());
    const panel = $("homePanel");
    const talkMode = tab === "talk";
    for (const ch of [...setup.children]) {
      if (ch === setup.children[0] || ch === nav || ch === panel) continue;
      if (ch.id === "reviewWrap") { ch.hidden = true; continue; }
      ch.hidden = !talkMode;
    }
    panel.hidden = talkMode;
    const lead = $("setupLead");
    if (lang === "en" && tab === "course") { $("setupTitle").textContent = "배우고, 연습하고, 그다음에 대화해요."; lead.textContent = "레슨마다 문법 → 대화문 듣기 → 따라 말하기 → 퀴즈 → 대본 리허설 → 실전 대화 순서예요. 대본과 다르게 말해도 AI 코치가 바로 봐 드려요."; }
    if (lang === "en" && tab === "talk") { $("setupTitle").textContent = "자유 대화"; lead.textContent = "대본 없이 대화해요. 코스에서 배운 표현을 AI가 알고 있어서, 쓸 기회를 만들어 주고 끝나면 썼는지 체크해 드려요."; }
    if (lang === "vi" && tab === "course") { $("setupTitle").textContent = "Xin chào! 베트남어 첫걸음"; lead.textContent = "글자를 못 읽어도 괜찮아요. 소리를 듣고 → 따라 하고 → 뜻을 고르면서 단어부터 익혀요. 큰 글씨는 한글 발음, 화살표는 성조(말의 높낮이)예요."; }
    if (tab === "review") lead.textContent = "틀린 문장과 배운 표현이 1 · 3 · 7 · 14 · 30일 간격으로 다시 나와요. 맞히면 간격이 늘고, 틀리면 바로 다시 나와요.";
    if (tab === "notes") lead.textContent = "대화가 끝날 때마다 교정 노트가 저장돼요. 다시 보기, 대본 리허설, 굿노트용 PDF를 여기서 할 수 있어요.";
    if (!talkMode) rc(panel, tab === "course" ? (lang === "en" ? enCoursePanel() : coursePanel()) : tab === "review" ? reviewPanel(lang) : notesPanel(lang));
  }
  TP.onRenderSetup = refreshHome;
  TP.onLang = () => { tab = getTab(TP.getLang()); refreshHome(); };
  TP.onHome = () => { stopAll(); };
  TP.onLogin = () => { S = loadLocal(); loadCourse(); cloudLoad(); refreshHome(); };

  // ---------- study screen plumbing ----------
  let stopFlag = 0;
  function stopAll() { stopFlag++; try { TP.listenOnce.stop && TP.listenOnce.stop(); } catch {} TP.cancelSpeech(); }
  function openStudy(title, ...content) {
    stopAll();
    const sv = $("studyView");
    rc(sv, h("div", { class: "study-head" }, h("h2", { text: title })), ...content);
    TP.show("study");
    return sv;
  }
  function backHome() { stopAll(); TP.show("setup"); TP.renderSetup(); }

  // mic button that listens once and hands back the text
  function micAnswer({ lang, onResult, label = "🎤 말하기" }) {
    const live = h("div", { class: "live", text: "" });
    const typed = h("div", { class: "typed", hidden: true },
      h("input", { type: "text", placeholder: "직접 입력해도 돼요", autocapitalize: "off", spellcheck: "false" }),
      h("button", { class: "ghost sm", text: "확인", onclick: () => { const v = typed.querySelector("input").value.trim(); if (v) onResult(v); } }));
    const btn = h("button", { class: "mic-btn", text: label });
    btn.onclick = async () => {
      if (!TP.hasSR) { typed.hidden = false; typed.querySelector("input").focus(); return; }
      if (btn.classList.contains("on")) { TP.listenOnce.stop && TP.listenOnce.stop(); return; }
      btn.classList.add("on"); btn.textContent = "듣는 중… (누르면 끝)"; live.textContent = "";
      try {
        const said = await TP.listenOnce({ lang, onInterim: (t) => { live.textContent = t; } });
        btn.classList.remove("on"); btn.textContent = label;
        if (said) onResult(said); else live.textContent = "소리가 안 들렸어요. 다시 눌러주세요.";
      } catch (e) {
        btn.classList.remove("on"); btn.textContent = label; typed.hidden = false;
        live.textContent = e && e.code === "mic" ? "마이크 권한이 필요해요. 주소창 aA → 웹사이트 설정 → 마이크 허용. 아래에 직접 입력해도 돼요." : "음성 인식을 쓸 수 없어요. 아래에 입력해 주세요.";
      }
    };
    const kb = h("button", { class: "mini", text: "⌨ 입력", onclick: () => { typed.hidden = !typed.hidden; if (!typed.hidden) typed.querySelector("input").focus(); } });
    return h("div", { class: "mic-area" }, h("div", { class: "mic-row" }, btn, kb), live, typed);
  }
  const say = (t, lang, opt = {}) => TP.speak(t, { force: true, lang, ...opt });

  // ---------- review ----------
  function reviewPanel(lang) {
    const due = dueCards(lang), all = S.cards.filter(c => c.lang === lang);
    const mastered = all.filter(c => (c.box || 0) >= 3).length;
    const next = all.filter(c => c.due > Date.now()).sort((a, b) => a.due - b.due)[0];
    const box = h("div", { class: "panel-card" },
      h("div", { class: "big-num" }, h("b", { text: String(due.length) }), h("span", { text: " 개 오늘 복습" })),
      h("div", { class: "note", text: `전체 카드 ${all.length}개 · 외운 카드(7일 이상 간격) ${mastered}개` + (next && !due.length ? ` · 다음 복습 ${fmtDate(next.due)}` : "") }),
      due.length ? h("button", { class: "primary", text: "복습 시작", onclick: () => startReview(lang) })
        : h("div", { class: "empty-good", text: all.length ? "오늘 복습은 끝났어요 👍" : (lang === "vi" ? "기초 코스에서 레슨을 하나 끝내면 복습 카드가 생겨요." : "대화를 한 번 마치면 교정된 문장이 복습 카드로 들어와요.") }),
      all.length ? h("button", { class: "ghost", text: "전체 카드 한 번 더 훑기", onclick: () => startReview(lang, true) }) : null);
    return box;
  }
  function startReview(lang, everything) {
    let queue = (everything ? shuffle(S.cards.filter(c => c.lang === lang)) : dueCards(lang)).slice(0, 20);
    const total = queue.length; let done = 0, right = 0; const retried = new Set();
    const body = h("div", { class: "rv" });
    openStudy(lang === "vi" ? "베트남어 복습" : "영어 복습", body);
    const run = stopFlag;
    function next() {
      if (run !== stopFlag) return;
      const card = queue.shift();
      if (!card) return finish();
      rc(body, h("div", { class: "progress" }, h("i", { style: `width:${Math.round(100 * done / Math.max(total, 1))}%` })), h("div", { class: "note", text: `${done + 1} / ${total}${card.src ? " · " + card.src : ""}` }), renderCard(card, (ok) => {
        grade(card, ok);
        if (ok) { done++; right++; } else if (!retried.has(card.id)) { retried.add(card.id); queue.push(card); } else done++;
        setTimeout(next, ok ? 900 : 0);
      }));
    }
    function finish() {
      rc(body, h("div", { class: "panel-card" },
        h("div", { class: "big-num" }, h("b", { text: `${right}/${total}` }), h("span", { text: " 바로 맞힘" })),
        h("div", { class: "note", text: "틀린 카드는 5분 뒤 · 맞힌 카드는 다음 간격에 다시 나와요." }),
        h("div", { class: "fb-actions" }, h("button", { class: "primary", text: "처음으로", onclick: backHome }))));
    }
    next();
  }
  function renderCard(card, done) {
    const lang = card.lang;
    if (lang === "vi" && card.kind === "vi" && (card.box || 0) < 2) return listenChoose(card, done);
    const wrap = h("div", { class: "qcard" });
    const prompt = h("div", { class: "q-prompt" });
    if (card.frame) prompt.append(h("div", { class: "frame" }, h("b", { text: card.frame }), card.frameKo ? h("span", { text: " · " + card.frameKo }) : null));
    prompt.append(h("div", { class: "q-ko", text: card.ko || "(뜻 없음)" }));
    prompt.append(h("div", { class: "note", text: lang === "vi" ? "베트남어로 말해 보세요" : card.frame ? "틀에 단어를 바꿔 넣어 영어로 말해 보세요" : "영어로 말해 보세요" }));
    const hintBox = h("div", { class: "q-hint", hidden: true });
    if (card.read || card.kind === "vi") hintBox.append(readBlock(card.t, card.read || "", false));
    else hintBox.append(h("div", { text: card.t.split(/\s+/).slice(0, 2).join(" ") + " …" }));
    if (card.old) hintBox.append(h("div", { class: "old", text: "전에 내가 한 말: " + card.old }));
    const res = h("div", { class: "q-res" });
    let answered = false;
    const onResult = async (said) => {
      if (answered) return;
      const r = check(card.alt || card.t, said, lang);
      const actions = h("div", { class: "fb-actions" },
        h("button", { class: "mini", text: "▶ 정답 듣기", onclick: () => say(card.t, lang) }));
      const aiSlot = h("div");
      rc(res, h("div", { class: r.pass ? "verdict ok" : "verdict bad", text: r.pass ? "좋아요! 맞았어요" : "정답과 조금 달라요" }),
        h("div", { class: "note", text: "내가 말한 것: " + said }), h("div", { class: "note", text: "모범 답:" }), diffView(r),
        card.read ? readBlock(card.t, card.read, false) : null, aiSlot, actions);
      if (r.pass) { answered = true; say(card.t, lang); done(true); return; }
      if (card.kind === "vi") { // beginner word cards: no AI, just show the answer
        say(card.t, lang);
        actions.append(h("button", { class: "mini", text: "맞은 걸로 할게요", onclick: () => { answered = true; done(true); } }), h("button", { class: "ghost sm", text: "다음", onclick: () => { answered = true; done(false); } }));
        return;
      }
      rc(aiSlot, thinking());
      const j = await aiJudge({ lang, target: card.t, said, ko: card.ko, grammar: card.frame || "", context: card.src ? "scene: " + card.src : "" });
      if (answered) return;
      rc(aiSlot, aiBox(j, lang));
      if (j.ok) {
        res.querySelector(".verdict").textContent = "다르게 말했지만 자연스러워요 👍"; res.querySelector(".verdict").className = "verdict ok";
        actions.append(h("button", { class: "primary sm", text: "다음", onclick: () => { answered = true; done(true); } }));
      } else {
        say(card.t, lang);
        actions.append(h("button", { class: "mini", text: "맞은 걸로 할게요", onclick: () => { answered = true; done(true); } }),
          h("button", { class: "ghost sm", text: "다음", onclick: () => { answered = true; done(false); } }));
      }
    };
    wrap.append(prompt, h("div", { class: "fb-actions" },
      h("button", { class: "mini", text: "💡 힌트", onclick: () => { hintBox.hidden = !hintBox.hidden; } }),
      h("button", { class: "mini", text: "모르겠어요 (정답 보기)", onclick: () => { if (answered) return; answered = true; rc(res, h("div", { class: "verdict bad", text: "정답" }), h("div", { class: "q-target", text: card.t }), card.read ? readBlock(card.t, card.read, false) : null, h("button", { class: "ghost sm", text: "다음", onclick: () => done(false) })); say(card.t, lang); } })),
      hintBox, micAnswer({ lang, onResult }), res);
    return wrap;
  }
  function listenChoose(card, done) {
    const same = (COURSE.find(l => l.id === card.lesson) || { items: [] }).items.map(i => i.k).filter(k => k !== card.ko);
    const pool = [...shuffle(same), ...shuffle(COURSE.flatMap(l => l.items).map(i => i.k).filter(k => k !== card.ko && !same.includes(k)))];
    const choices = shuffle([card.ko, ...pool.slice(0, 3)]);
    const wrap = h("div", { class: "qcard" });
    const play = () => say(card.t, "vi", { rate: 0.75 });
    wrap.append(h("button", { class: "play-big", "aria-label": "다시 듣기", text: "🔊", onclick: play }),
      h("div", { class: "note center", text: "소리를 듣고 뜻을 고르세요" }));
    const grid = h("div", { class: "choices" });
    let answered = false;
    for (const c of choices) grid.append(h("button", { class: "choice", text: c, onclick: (ev) => {
      if (answered) return; answered = true;
      const ok = c === card.ko;
      ev.currentTarget.classList.add(ok ? "ok" : "bad");
      [...grid.children].forEach(b => { if (b.textContent === card.ko) b.classList.add("ok"); });
      wrap.append(readBlock(card.t, card.read || "", true));
      if (!ok) wrap.append(h("button", { class: "ghost sm", text: "다음", onclick: () => done(false) }));
      play(); if (ok) setTimeout(() => done(true), 1200);
    } }));
    wrap.append(grid);
    setTimeout(play, 300);
    return wrap;
  }

  // ---------- notes ----------
  function notesPanel(lang) {
    const notes = S.notes.filter(n => n.lang === lang);
    if (!notes.length) return h("div", { class: "panel-card" }, h("div", { class: "empty-good", text: "아직 저장된 노트가 없어요. 대화를 마치고 「마치고 교정」을 누르면 여기에 쌓여요." }));
    return h("div", { class: "note-list" }, ...notes.map(n => h("div", { class: "note-item" },
      h("div", { class: "ni-top" }, h("b", { text: n.sceneTitle }), h("span", { class: "mono", text: `${fmtDate(n.date)} · ${n.score}점` })),
      h("div", { class: "note", text: `교정 ${n.corrections.length} · 문장 틀 ${n.patterns.length} · 대본 ${n.script.length}줄` + (n.rehearsal && n.rehearsal.best ? ` · 리허설 최고 ${n.rehearsal.best}%` : "") }),
      h("div", { class: "fb-actions" },
        h("button", { class: "ghost sm", text: "노트 보기", onclick: () => openNote(n) }),
        n.script.length ? h("button", { class: "ghost sm", text: "대본 리허설", onclick: () => TP.openRehearsal(n) }) : null,
        h("button", { class: "ghost sm", text: "PDF", onclick: () => TP.exportPDF(n) })))));
  }
  function openNote(n) {
    const lang = n.lang;
    const sec = (t, ...c) => h("div", { class: "fb-section" }, h("h3", { text: t }), ...c);
    openStudy(`${n.sceneTitle} · ${fmtDate(n.date)}`,
      h("div", { class: "fb-head" }, h("div", { class: "score", text: String(n.score) }, h("small", { text: "/100" })), h("p", { text: n.summary })),
      n.corrections.length ? sec("고쳐 말하기", h("div", { class: "corr" }, ...n.corrections.map(c => h("div", { class: "corr-item" },
        h("div", { class: "old", text: c.original }), h("div", { class: "new" }, h("span", { text: c.better }), h("button", { class: "mini", text: "▶", onclick: () => say(firstAlt(c.better), lang) })),
        c.ko ? h("div", { class: "why", text: c.ko }) : null, h("div", { class: "why", text: c.why }))))) : null,
      n.patterns.length ? sec("단어만 바꿔 쓰는 문장 틀", h("div", { class: "corr" }, ...n.patterns.map(p => h("div", { class: "corr-item" },
        h("div", { class: "new", text: p.frame }), h("div", { class: "why", text: p.ko + (p.use ? " · " + p.use : "") }),
        ...p.examples.map(e => h("button", { class: "mini left", text: `▶ ${e.t}  — ${e.ko}`, onclick: () => say(e.t, lang) })))))) : null,
      n.script.length ? sec("모범 대본", scriptView(n, true)) : null,
      h("div", { class: "fb-actions" },
        n.script.length ? h("button", { class: "primary", text: "대본 리허설", onclick: () => TP.openRehearsal(n) }) : null,
        h("button", { class: "ghost", text: "PDF로 내보내기", onclick: () => TP.exportPDF(n) }),
        h("button", { class: "ghost", text: "같은 상황 실전 대화", onclick: () => TP.startScene(n.sceneId) }),
        h("button", { class: "ghost", text: "목록으로", onclick: backHome })));
  }
  function scriptView(n, showAll) {
    return h("div", { class: "script" }, ...n.script.map(l => h("div", { class: "sl " + l.who },
      h("span", { class: "who", text: l.who === "me" ? "나" : (n.partner || "상대") }),
      h("div", {}, h("div", { class: "st", text: showAll || l.who === "partner" ? l.t : "" }), l.ko ? h("div", { class: "sk", text: l.ko }) : null))));
  }

  // one spoken (or typed) line from the learner
  function askLine(lang, status, row) {
    return new Promise((resolve) => {
      let settled = false;
      const input = row.querySelector("input"), okBtn = row.querySelector(".ok"), micBtn = row.querySelector(".mic-mini");
      input.value = ""; row.hidden = false;
      const fin = (t) => { if (settled) return; settled = true; row.hidden = true; try { TP.listenOnce.stop && TP.listenOnce.stop(); } catch {} resolve(t); };
      okBtn.onclick = () => { const v = input.value.trim(); if (v) fin(v); };
      input.onkeydown = (e) => { if (e.key === "Enter") okBtn.click(); };
      const listen = () => {
        if (!TP.hasSR) { status.textContent = "아래에 내 대사를 입력하세요."; micBtn.hidden = true; return; }
        micBtn.classList.add("on");
        TP.listenOnce({ lang, onInterim: (t) => { status.textContent = "듣는 중: " + t; } })
          .then((t) => { micBtn.classList.remove("on"); if (settled) return; if (t) fin(t); else status.textContent = "소리가 안 들렸어요. 🎤를 누르거나 입력하세요."; })
          .catch(() => { micBtn.classList.remove("on"); if (!settled) status.textContent = "마이크를 쓸 수 없어요. 아래에 입력하세요."; });
      };
      micBtn.onclick = () => { if (micBtn.classList.contains("on")) { TP.listenOnce.stop && TP.listenOnce.stop(); } else listen(); };
      listen();
    });
  }
  async function aiRehearse(n, i, said) {
    const l = n.script[i];
    const script = n.script.map((x, k) => `${k === i ? ">> " : ""}${x.who === "me" ? "LEARNER" : "PARTNER"}: ${x.t}`).join("\n");
    const next = n.script.slice(i + 1).find(x => x.who === "partner");
    const prompt = `Scripted role-play rehearsal ("${n.sceneTitle}"). Script:
${script}

At the line marked >>, the learner should say: "${l.t}"${l.ko ? ` (meaning: ${l.ko})` : ""}.
The learner actually said (speech recognition, punctuation may be missing): "${said}".
${next ? `The next scripted partner line is: "${next.t}".` : "This was the learner's last line."}
Return only JSON: {"ok": true if the learner's sentence is natural, correct and keeps the meaning of the scripted line (different words are fine), "feedback_ko": "1-2 short Korean sentences: what was good / wrong and why", "better": "the learner's sentence fixed naturally (keep their words when possible)", "off_script": true only if the learner's meaning is different so the next scripted partner line would not fit, "partner_reply": "only when off_script: what the partner says in character (max 20 words) to answer the learner naturally and steer back so the next scripted line still fits; otherwise empty"}`;
    try {
      const t = await TP.ask({ system: "You are a kind, precise English speaking coach and role-play partner. Reply with only JSON.", messages: [{ role: "user", content: prompt }], max_tokens: 400 });
      const j = TP.parseJSON(t);
      return { ok: !!j.ok, feedback: String(j.feedback_ko || ""), better: TP.cleanSpoken(String(j.better || "")), offScript: !!j.off_script, reply: TP.cleanSpoken(String(j.partner_reply || "")) };
    } catch (e) { return { error: TP.errText(e) }; }
  }

  // ---------- script rehearsal (adapts when the learner goes off script) ----------
  const LEVELS = [["see", "보면서"], ["first", "첫 단어만"], ["blind", "안 보고"]];
  TP.openRehearsal = (n) => {
    n.rehearsal = n.rehearsal || {};
    let lvl = n.rehearsal.next || "see";
    const lang = n.lang, female = (TP.LOOK[n.sceneId] || {}).female;
    const seg = h("div", { class: "levels" });
    const lines = h("div", { class: "script rh" });
    const status = h("div", { class: "rh-status" });
    const row = h("div", { class: "typed rh-input", hidden: true },
      h("button", { class: "mic-mini", text: "🎤", "aria-label": "다시 말하기" }),
      h("input", { type: "text", placeholder: "말하거나, 여기에 입력하세요", autocapitalize: "off", spellcheck: "false" }),
      h("button", { class: "ghost sm ok", text: "확인" }));
    const ctrl = h("div", { class: "fb-actions" });
    const sv = openStudy(`대본 리허설 · ${n.sceneTitle}`,
      h("p", { class: "note", text: `${n.partner || "상대"}의 대사는 소리로 읽어 드려요. 「나」 차례에 외운 문장을 말하세요. 대본과 다르게 말해도 AI 코치가 판단해서, 뜻이 통하면 인정하고 상대가 그에 맞춰 받아줘요.` }),
      seg, lines, h("div", { class: "rh-dock" }, status, row), ctrl);
    function drawSeg() { rc(seg, ...LEVELS.map(([k, t]) => h("button", { class: "seg", "aria-pressed": String(k === lvl), text: t, onclick: () => { lvl = k; drawSeg(); draw(-1); } }))); }
    function cue(t) { const w = t.split(/\s+/); return lvl === "see" ? t : lvl === "first" ? w[0] + " " + w.slice(1).map(x => "＿".repeat(Math.min(4, Math.max(2, Math.round(x.length / 2))))).join(" ") : "🎤 내 차례"; }
    const marks = {}, fbs = {}, adlib = {}, saidMap = {};
    function draw(cur) {
      const kids = [];
      n.script.forEach((l, i) => {
        kids.push(h("div", { class: "sl " + l.who + (i === cur ? " cur" : "") + (marks[i] ? " " + marks[i] : "") },
          h("span", { class: "who", text: l.who === "me" ? "나" : (n.partner || "상대") }),
          h("div", {}, h("div", { class: "st", text: l.who === "partner" ? l.t : (marks[i] ? l.t : cue(l.t)) }),
            saidMap[i] && saidMap[i] !== l.t ? h("div", { class: "said", text: "내가 한 말: " + saidMap[i] }) : null,
            (l.ko && (l.who === "partner" || lvl !== "see")) ? h("div", { class: "sk", text: l.ko }) : null)));
        if (fbs[i]) kids.push(aiBox(fbs[i], lang));
        if (adlib[i]) kids.push(h("div", { class: "sl partner adlib" }, h("span", { class: "who", text: (n.partner || "상대") + " · 즉흥" }), h("div", {}, h("div", { class: "st", text: adlib[i] }))));
      });
      rc(lines, ...kids);
      const c = lines.querySelector(".cur"); if (c) c.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    async function run() {
      const myRun = ++stopFlag; let passed = 0, mine = 0;
      for (const o of [marks, fbs, adlib, saidMap]) for (const k of Object.keys(o)) delete o[k];
      rc(ctrl, h("button", { class: "ghost", text: "그만하기", onclick: () => { stopAll(); row.hidden = true; finish(true); } }));
      const alive = () => myRun === stopFlag;
      for (let i = 0; i < n.script.length; i++) {
        if (!alive()) return;
        const l = n.script[i]; draw(i);
        if (l.who === "partner") { status.textContent = `${n.partner || "상대"}가 말하는 중…`; await say(l.t, lang, { female }); await new Promise(r => setTimeout(r, 250)); continue; }
        mine++;
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          if (!alive()) return;
          status.textContent = attempt ? "모범 문장을 들었으니 한 번 더 말해 보세요 (2/2)" : "내 차례 · 말해 보세요";
          const said = await askLine(lang, status, row);
          if (!alive()) return;
          saidMap[i] = said;
          const r = check(l.t, said, lang);
          if (r.pass) { ok = true; delete fbs[i]; status.textContent = `좋아요! (${Math.round(r.score * 100)}%)`; break; }
          status.textContent = "AI 코치가 확인하는 중…"; draw(i);
          const j = await aiRehearse(n, i, said);
          if (!alive()) return;
          fbs[i] = j.error ? { error: j.error } : { ok: j.ok, feedback: j.feedback, better: j.better };
          if (j.ok) { ok = true; status.textContent = "다르게 말했지만 자연스러워요 👍"; }
          if (j.offScript && j.reply) adlib[i] = j.reply;
          draw(i);
          if (adlib[i]) { status.textContent = `${n.partner || "상대"}가 내 말에 맞춰 대답하는 중…`; await say(adlib[i], lang, { female }); break; }
          if (!ok && attempt === 0) { status.textContent = "모범 문장을 들어 보세요"; await say(l.t, lang); }
        }
        marks[i] = ok ? "pass" : "fail"; if (ok) passed++;
        draw(i);
        await new Promise(r => setTimeout(r, 500));
      }
      finish(false, passed, mine);
    }
    function finish(stopped, passed = 0, mine = 0) {
      const pct = mine ? Math.round(100 * passed / mine) : 0;
      if (!stopped) {
        n.rehearsal.best = Math.max(n.rehearsal.best || 0, pct);
        n.rehearsal.last = { date: Date.now(), pct, lvl };
        if (pct >= 80) n.rehearsal.next = lvl === "see" ? "first" : "blind";
        persist();
      }
      status.textContent = stopped ? "멈췄어요." : `내 대사 ${passed}/${mine} 통과 (${pct}%)` + (pct >= 80 ? (lvl === "blind" ? " · 다 외웠어요! 실전 대화로 가 보세요." : " · 다음엔 한 단계 어렵게 해 보세요.") : " · AI 피드백을 보고 한 번 더 해 봐요.");
      rc(ctrl,
        h("button", { class: "primary", text: "다시 리허설", onclick: run }),
        pct >= 80 && lvl !== "blind" ? h("button", { class: "ghost", text: "한 단계 어렵게", onclick: () => { lvl = lvl === "see" ? "first" : "blind"; drawSeg(); draw(-1); run(); } }) : null,
        h("button", { class: "ghost", text: "실전 대화로", onclick: () => TP.startScene(n.sceneId, n.lessonId ? { lessonId: n.lessonId } : null) }),
        h("button", { class: "ghost", text: "처음으로", onclick: backHome }));
    }
    drawSeg(); draw(-1);
    rc(ctrl, h("button", { class: "primary", text: "리허설 시작", onclick: run }), h("button", { class: "ghost", text: "처음으로", onclick: backHome }));
    return sv;
  };

  // ---------- English course ----------
  function lessonNote(L) {
    S.en.reh[L.id] = S.en.reh[L.id] || {};
    return { id: L.id, lessonId: L.id, lang: "en", sceneId: L.scene, sceneTitle: L.title, partner: (TP.LOOK[L.scene] || {}).name || "",
      script: L.dialogue.map(d => ({ who: d.who, t: d.t, ko: d.ko })), rehearsal: S.en.reh[L.id] };
  }
  // ---------- English course: units ----------
  const unitOf = (L) => UNITS.find(u => u.id === L.unit) || { id: L.unit, title: "", icon: "", desc: "" };
  const unitLessons = (uid) => allEN().filter(l => l.unit === uid);
  const fullyDone = (L) => !!(S.en.done[L.id] && S.en.talk[L.id]);
  function nextLesson() {
    const all = allEN();
    const last = S.en.last && all.find(l => l.id === S.en.last);
    if (last && !fullyDone(last)) return last;
    if (last) { const u = unitLessons(last.unit), i = u.indexOf(last); const nx = u.slice(i + 1).find(l => !S.en.done[l.id]); if (nx) return nx; }
    return all.find(l => !S.en.done[l.id]) || all[0];
  }
  const OPEN_KEY = "tp_units_open";
  const getOpenUnits = () => { try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || "null"); return Array.isArray(v) ? v : null; } catch { return null; } };
  const setOpenUnits = (v) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(v)); } catch {} };
  function progMarks(L) {
    const done = S.en.done[L.id], reh = S.en.reh[L.id], talk = S.en.talk[L.id];
    const marks = h("div", { class: "lr-prog" },
      h("i", { class: done ? "on" : "", title: "학습" }), h("i", { class: reh && reh.best ? "on" : "", title: "리허설" }), h("i", { class: talk ? "on" : "", title: "실전" }));
    const txt = talk ? `실전 ${talk.score}점` : reh && reh.best ? `리허설 ${reh.best}%` : done ? `학습 ${done.quiz || "✓"}` : "";
    return h("div", { class: "lr-state" }, marks, txt ? h("small", { text: txt }) : null);
  }
  function enCoursePanel() {
    const all = allEN();
    const nx = nextLesson();
    const wrap = h("div", { class: "course" });
    if (nx) {
      const u = unitOf(nx), look = TP.LOOK[nx.scene] || {}, pos = unitLessons(nx.unit).indexOf(nx) + 1;
      const started = S.en.last === nx.id;
      const face = h("div", { class: "cont-face" }); face.innerHTML = TP.avatar(nx.scene);
      wrap.append(h("div", { class: "cont-card" }, face,
        h("div", { class: "cont-txt" },
          h("small", { text: `${started ? "이어서 하기" : "다음 레슨"} · ${u.title} ${pos}번째` }),
          h("b", { text: nx.title }),
          h("span", { text: nx.goal })),
        h("button", { class: "primary", text: started ? "이어서 하기" : "시작하기", onclick: () => openEnLesson(nx, S.en.done[nx.id] && !S.en.talk[nx.id] ? 4 : 0) })));
    }
    const nDone = all.filter(l => S.en.done[l.id]).length, nTalk = all.filter(l => S.en.talk[l.id]).length;
    wrap.append(h("div", { class: "course-stat", text: `레슨 ${all.length}개 중 ${nDone}개 학습 · 실전 대화 ${nTalk}개 완료` }));
    let open = getOpenUnits();
    if (!open) open = nx ? [nx.unit] : [UNITS[0] && UNITS[0].id];
    for (const u of UNITS) {
      const list = unitLessons(u.id), dn = list.filter(l => S.en.done[l.id]).length;
      const isOpen = open.includes(u.id);
      const body = h("div", { class: "unit-body", hidden: !isOpen });
      const head = h("button", { class: "unit-head", "aria-expanded": String(isOpen), onclick: () => {
        const now = body.hidden; body.hidden = !now; head.setAttribute("aria-expanded", String(now));
        const cur = (getOpenUnits() || open).filter(x => x !== u.id); if (now) cur.push(u.id); setOpenUnits(cur); open = cur;
        if (now && !body.childElementCount) fillUnit(body, u);
      } },
        h("span", { class: "unit-ic", text: u.icon }),
        h("span", { class: "unit-txt" }, h("b", { text: u.title }), h("small", { text: u.desc })),
        h("span", { class: "unit-count" }, h("span", { text: `${dn}/${list.length}` }), h("span", { class: "unit-bar" }, h("i", { style: `width:${list.length ? Math.round(100 * dn / list.length) : 0}%` }))),
        h("span", { class: "unit-chev", text: "›" }));
      if (isOpen) fillUnit(body, u);
      wrap.append(h("section", { class: "unit" }, head, body));
    }
    return wrap;
  }
  function fillUnit(body, u) {
    const list = unitLessons(u.id);
    const rows = list.map((L, i) => {
      const look = TP.LOOK[L.scene] || {};
      const face = h("div", { class: "lr-face" }); face.innerHTML = TP.avatar(L.scene);
      return h("button", { class: "lrow" + (S.en.done[L.id] ? " done" : "") + (S.en.last === L.id ? " last" : ""), onclick: () => openEnLesson(L) },
        h("span", { class: "lr-num", text: String(i + 1) }), face,
        h("span", { class: "lr-txt" },
          h("b", {}, L.title, L.custom ? h("span", { class: "ai-chip", text: "AI" }) : null),
          h("small", { text: `${look.name || ""} · ${L.goal}` })),
        progMarks(L));
    });
    rc(body, ...rows, genBox(u));
  }

  // ---------- AI-written scenario lessons ----------
  function normalizeLesson(j, unit) {
    if (!j || typeof j !== "object") throw new Error("AI 응답 형식이 맞지 않아요");
    const str = (x) => typeof x === "string" ? x.trim() : "";
    const clean = (t) => TP.cleanSpoken(str(t)).replace(/\s+/g, " ").trim();
    const grammar = (Array.isArray(j.grammar) ? j.grammar : []).slice(0, 3).map(g => ({
      title: str(g && g.title), form: str(g && g.form), ko: str(g && g.ko),
      ex: (Array.isArray(g && g.ex) ? g.ex : []).filter(e => e && str(e.t)).slice(0, 3).map(e => ({ t: clean(e.t), ko: str(e.ko) })),
    })).filter(g => g.form && g.ex.length);
    if (grammar.length < 2) throw new Error("문법 부분이 비어 있어요");
    const okG = (g) => Number.isInteger(g) && g >= 0 && g < grammar.length;
    const dialogue = (Array.isArray(j.dialogue) ? j.dialogue : []).filter(d => d && (d.who === "me" || d.who === "partner") && str(d.t)).slice(0, 12)
      .map(d => Object.assign({ who: d.who, t: clean(d.t), ko: str(d.ko) }, okG(d.g) ? { g: d.g } : {}));
    if (dialogue.length < 6 || dialogue.filter(d => d.who === "me").length < 3) throw new Error("대화문이 너무 짧아요");
    const blanks = (Array.isArray(j.blanks) ? j.blanks : []).map(b => {
      const a = str(b && b.a);
      return { s: str(b && b.s), a, o: [...new Set((Array.isArray(b && b.o) ? b.o : []).map(str).filter(x => x && x !== a))].slice(0, 3), g: okG(b && b.g) ? b.g : 0, ko: str(b && b.ko) };
    }).filter(b => (b.s.match(/___/g) || []).length === 1 && b.a && b.o.length >= 2).slice(0, 4);
    const look = TP.LOOK[unit.scene] || {};
    return { id: "x" + uid(), unit: unit.id, scene: unit.scene, icon: str(j.icon).slice(0, 4) || "✨", title: str(j.title).slice(0, 30) || "새 시나리오",
      goal: str(j.goal) || "새 상황에서 배운 표현을 써 본다.", role: str(j.role) || `You are ${look.name || "the partner"}. ${unit.en}`,
      grammar, dialogue, blanks, custom: true, created: Date.now() };
  }
  async function generateLesson(unit, wish, onProgress) {
    const sc = (TP.SCENES || []).find(x => x.id === unit.scene), look = TP.LOOK[unit.scene] || {};
    const existing = unitLessons(unit.id).map(l => l.title).join(" / ");
    const me = TP.user ? TP.user() : { en: "" };
    const prompt = `Create ONE new English speaking lesson for a Korean FPCB process engineer (ENIG surface finish, working at a plant in Vietnam, customers in the US and Korea). Learner level: intermediate (B1).
UNIT: ${unit.en}
PARTNER CHARACTER: ${sc ? sc.role : (look.name || "a business partner")}
${wish ? `THE LEARNER ASKED FOR THIS SITUATION (in Korean): "${wish}". Build the whole lesson around it.` : `Pick a realistic situation for this unit that is clearly different from these existing lessons: ${existing}.`}
The learner's name is ${me.en || "Kim"}.
Requirements:
- title: Korean, max 16 characters. goal: one Korean sentence saying what the learner will be able to do.
- icon: one emoji.
- role: English, 2-3 sentences starting "You are ${look.name || "the partner"}," describing the partner's situation and what they push for in a free role-play later.
- grammar: exactly 3 useful patterns for this situation, not too basic. Each: title (Korean, max 12 characters), form (the pattern with Korean placeholders such as 동사원형, 명사, 문장), ko (Korean explanation, max 70 characters; mention a common Korean learner mistake when useful), ex: exactly 2 examples {"t": English, "ko": Korean}.
- dialogue: exactly 10 lines alternating, starting with "partner"; who is "partner" or "me". Each {"who","t","ko"}. "me" lines max 14 words, natural spoken English with realistic technical details. Mark "me" lines that practise a grammar point with "g" (0, 1 or 2); every grammar point must be practised at least once.
- blanks: exactly 4 fill-in quizzes. Each {"s": sentence with exactly one ___, "a": the correct word(s), "o": 3 wrong options that are clearly wrong in that slot, "g": grammar index, "ko": Korean meaning}.
- No markdown, no em dashes.
Reply with ONLY the JSON object: {"title":"","goal":"","icon":"","role":"","grammar":[],"dialogue":[],"blanks":[]}`;
    const raw = await TP.ask({ system: "You write English speaking lessons for Korean engineers as strict JSON.", messages: [{ role: "user", content: prompt }], max_tokens: 4000, model: TP.MODEL_COACH, onProgress });
    return normalizeLesson(TP.parseJSON(raw), unit);
  }
  function genBox(u) {
    const input = h("input", { type: "text", class: "gen-in", placeholder: "원하는 상황 (예: 고객이 금 두께 부족을 제기) · 비워 두면 AI가 골라요", autocapitalize: "off" });
    const status = h("div", { class: "gen-status" });
    const btn = h("button", { class: "ghost sm", text: "✨ AI로 새 시나리오 만들기" });
    btn.onclick = async () => {
      btn.disabled = true; input.disabled = true;
      const box = thinking("AI가 시나리오를 쓰는 중… 1분쯤 걸려요"); rc(status, box);
      try {
        const L = await generateLesson(u, input.value.trim(), (t) => { box.lastChild.textContent = ` AI가 시나리오를 쓰는 중… (${t.length}자)`; });
        S.en.custom.push(L); S.en.last = L.id; persist();
        openEnLesson(L);
      } catch (e) {
        rc(status, h("div", { class: "ai-box warn" }, h("b", { text: "시나리오를 만들지 못했어요" }), h("div", { class: "note", text: ((e && e.message) || (TP.errText ? TP.errText(e) : String(e))) + " · 다시 눌러 주세요." })));
        btn.disabled = false; input.disabled = false;
      }
    };
    return h("div", { class: "gen-box" }, h("div", { class: "gen-row" }, input, btn), status);
  }
  function deleteCustom(L) {
    if (!L.custom) return;
    S.en.custom = S.en.custom.filter(x => x.id !== L.id);
    delete S.en.done[L.id]; delete S.en.reh[L.id]; delete S.en.talk[L.id];
    if (S.en.last === L.id) S.en.last = "";
    persist(); backHome();
  }
  const EN_STEPS = [["1", "문법"], ["2", "대화 듣기"], ["3", "따라 말하기"], ["4", "퀴즈"], ["5", "리허설"], ["6", "실전 대화"]];
  function openEnLesson(L, startStep = 0) {
    const look = TP.LOOK[L.scene] || {}, female = !!look.female, job = L.job || look.job || "";
    if (S.en.last !== L.id) { S.en.last = L.id; persist(); }
    const meVoice = { female: !female };
    const body = h("div", { class: "lesson-body" });
    const stepNav = h("div", { class: "steps big" });
    openStudy(L.title,
      h("div", { class: "lesson-top" }, h("div", { class: "lt-face" }), h("div", {}, h("div", { class: "note", text: `${unitOf(L).title} · 상대: ${look.name || ""} · ${job}` }), h("div", { class: "lt-goal", text: "목표 · " + L.goal })),
        h("button", { class: "ghost sm", text: "PDF 학습지", onclick: () => TP.exportEnLessonPDF(L) }),
        L.custom ? h("button", { class: "ghost sm", text: "이 레슨 삭제", onclick: () => deleteCustom(L) }) : null),
      stepNav, body);
    document.querySelector(".lt-face").innerHTML = TP.avatar(L.scene);
    let step = startStep, tok = 0;
    const go = (k) => { TP.cancelSpeech(); try { TP.listenOnce.stop && TP.listenOnce.stop(); } catch {} step = k; tok++; draw(); document.getElementById("main").scrollTop = 0; };
    const nextBtn = (label) => h("button", { class: "primary", text: label || `다음: ${EN_STEPS[step + 1][1]}`, onclick: () => go(step + 1) });
    const gBadge = (g) => g == null ? null : h("span", { class: "g-badge", text: "문법 " + (g + 1) + " · " + L.grammar[g].title });
    function draw() {
      rc(stepNav, ...EN_STEPS.map(([ic, t], i) => h("button", { class: (i === step ? "on" : "") + (i < step ? " past" : ""), onclick: () => go(i) }, h("span", { class: "sn", text: ic }), t)));
      rc(body, [grammarStep, listenStep, shadowStep, quizStep, rehearseStep, talkStep][step]());
    }
    function grammarStep() {
      return h("div", { class: "stack" },
        ...L.grammar.map((g, i) => h("div", { class: "g-card" },
          h("div", { class: "g-head" }, h("span", { class: "g-num", text: String(i + 1) }), h("b", { text: g.title })),
          h("div", { class: "g-form", text: g.form }),
          h("div", { class: "g-ko", text: g.ko }),
          ...g.ex.map(e => h("button", { class: "g-ex", onclick: () => say(e.t, "en", meVoice) }, h("span", { class: "g-play", text: "▶" }), h("div", {}, h("div", { class: "g-t", text: e.t }), h("div", { class: "g-k", text: e.ko })))))),
        h("div", { class: "fb-actions" }, nextBtn()));
    }
    function listenStep() {
      let showKo = true, myTok = tok;
      const list = h("div", { class: "script" });
      const drawLines = (cur) => rc(list, ...L.dialogue.map((d, i) => h("button", { class: "sl " + d.who + (i === cur ? " cur" : ""), onclick: () => say(d.t, "en", d.who === "me" ? meVoice : { female }) },
        h("span", { class: "who", text: d.who === "me" ? "나" : look.name }),
        h("div", {}, h("div", { class: "st", text: d.t }), showKo ? h("div", { class: "sk", text: d.ko }) : null, gBadge(d.g)))));
      const playBtn = h("button", { class: "primary sm", text: "▶ 전체 듣기" });
      playBtn.onclick = async () => {
        const mine = ++tok; myTok = mine; playBtn.disabled = true;
        for (let i = 0; i < L.dialogue.length; i++) {
          if (mine !== tok) break;
          drawLines(i); const c = list.querySelector(".cur"); if (c) c.scrollIntoView({ block: "center", behavior: "smooth" });
          await say(L.dialogue[i].t, "en", L.dialogue[i].who === "me" ? meVoice : { female });
          await new Promise(r => setTimeout(r, 350));
        }
        if (mine === tok) drawLines(-1);
        playBtn.disabled = false;
      };
      const koBtn = h("button", { class: "ghost sm", text: "한국어 뜻 숨기기" });
      koBtn.onclick = () => { showKo = !showKo; koBtn.textContent = showKo ? "한국어 뜻 숨기기" : "한국어 뜻 보기"; drawLines(-1); };
      drawLines(-1);
      return h("div", { class: "stack" }, h("p", { class: "note", text: "줄을 누르면 그 줄만 들려요. 📐 표시는 오늘 배운 문법이 쓰인 줄이에요." }),
        h("div", { class: "fb-actions" }, playBtn, h("button", { class: "ghost sm", text: "■ 멈춤", onclick: () => { tok++; TP.cancelSpeech(); playBtn.disabled = false; drawLines(-1); } }), koBtn), list,
        h("div", { class: "fb-actions" }, nextBtn()));
    }
    function shadowStep() {
      const mine = L.dialogue.map((d, i) => ({ ...d, i })).filter(d => d.who === "me");
      let k = 0;
      const box = h("div", { class: "stack" });
      const render = () => {
        const d = mine[k], myTok = tok;
        const prevLine = L.dialogue[d.i - 1];
        const res = h("div", { class: "q-res" });
        rc(box,
          h("div", { class: "progress" }, h("i", { style: `width:${Math.round(100 * k / mine.length)}%` })),
          h("div", { class: "note", text: `내 대사 ${k + 1} / ${mine.length}` }),
          prevLine && prevLine.who === "partner" ? h("div", { class: "sl partner" }, h("span", { class: "who", text: look.name }), h("div", {}, h("div", { class: "st", text: prevLine.t }), h("div", { class: "sk", text: prevLine.ko }))) : null,
          h("div", { class: "qcard" },
            h("div", { class: "q-target big", text: d.t }), h("div", { class: "q-ko", text: d.ko }), gBadge(d.g),
            h("div", { class: "fb-actions" }, h("button", { class: "ghost sm", text: "▶ 듣기", onclick: () => say(d.t, "en", meVoice) }), h("button", { class: "ghost sm", text: "🐢 천천히", onclick: () => say(d.t, "en", { ...meVoice, rate: 0.7 }) })),
            micAnswer({ lang: "en", label: "🎤 따라 말하기", onResult: async (said) => {
              const r = check(d.t, said, "en");
              rc(res, h("div", { class: r.pass ? "verdict ok" : "verdict bad", text: r.pass ? "좋아요! 👍" : "조금 달라요" }), h("div", { class: "note", text: "내가 한 말: " + said }), diffView(r));
              if (r.pass) return;
              const slot = thinking(); res.append(slot);
              const j = await aiJudge({ lang: "en", target: d.t, said, ko: d.ko, grammar: d.g != null ? L.grammar[d.g].form : "", context: "repeating a line of the model dialogue: " + L.title });
              if (myTok !== tok) return;
              slot.replaceWith(aiBox(j, "en"));
              if (j.ok) { const v = res.querySelector(".verdict"); v.textContent = "그대로는 아니지만 자연스러워요 👍"; v.className = "verdict ok"; }
            } }), res),
          h("div", { class: "fb-actions" },
            k > 0 ? h("button", { class: "ghost", text: "이전", onclick: () => { k--; tok++; render(); } }) : null,
            k < mine.length - 1 ? h("button", { class: "primary", text: "다음 줄", onclick: () => { k++; tok++; render(); } }) : nextBtn()));
        setTimeout(() => { if (myTok === tok) say(d.t, "en", meVoice); }, 300);
      };
      render();
      return box;
    }
    function quizStep() {
      const mineLines = L.dialogue.filter(d => d.who === "me");
      const orderable = shuffle(mineLines.filter(d => { const n = d.t.split(/\s+/).length; return n >= 5 && n <= 12; })).slice(0, 2);
      const sayable = shuffle(mineLines).slice(0, 3);
      const items = [...L.blanks.map(b => ({ type: "blank", b })), ...orderable.map(d => ({ type: "order", d })), ...sayable.map(d => ({ type: "say", d }))];
      let k = 0, right = 0;
      const box = h("div", { class: "stack" });
      const advance = (ok) => { if (ok) right++; k++; tok++; render(); };
      const render = () => {
        if (k >= items.length) return finish();
        const it = items[k], myTok = tok;
        const head = [h("div", { class: "progress" }, h("i", { style: `width:${Math.round(100 * k / items.length)}%` })),
          h("div", { class: "note", text: `${k + 1} / ${items.length} · ${it.type === "blank" ? "빈칸 채우기" : it.type === "order" ? "단어 순서 맞추기" : "한국어 보고 말하기"}` })];
        if (it.type === "blank") {
          const b = it.b, g = L.grammar[b.g];
          const full = b.s.replace("___", b.a);
          const res = h("div", { class: "q-res" });
          const grid = h("div", { class: "choices" });
          let answered = false;
          for (const o of shuffle([b.a, ...b.o])) grid.append(h("button", { class: "choice", text: o, onclick: (ev) => {
            if (answered) return; answered = true;
            const ok = o === b.a;
            ev.currentTarget.classList.add(ok ? "ok" : "bad");
            [...grid.children].forEach(x => { if (x.textContent === b.a) x.classList.add("ok"); });
            rc(res, h("div", { class: ok ? "verdict ok" : "verdict bad", text: ok ? "정답!" : "아쉬워요" }),
              h("div", { class: "q-target", text: full }), h("div", { class: "g-mini" }, h("b", { text: g.title }), " ", h("span", { class: "hl", text: g.form })), h("div", { class: "note", text: g.ko }),
              h("button", { class: "primary sm", text: "다음", onclick: () => advance(ok) }));
            say(full, "en", meVoice);
          } }));
          rc(box, ...head, h("div", { class: "qcard" },
            h("div", { class: "q-blank" }, ...b.s.split("___").flatMap((part, i) => i ? [h("span", { class: "blank", text: "  ?  " }), part] : [part])),
            h("div", { class: "q-ko", text: b.ko }), grid, res));
        } else if (it.type === "order") {
          const words = it.d.t.split(/\s+/);
          let picked = [];
          const pool = shuffle(words.map((w, i) => ({ w, i })));
          const ans = h("div", { class: "order-ans" }), bank = h("div", { class: "order-bank" }), res = h("div", { class: "q-res" });
          const paint = () => {
            rc(ans, ...(picked.length ? picked.map((p, j) => h("button", { class: "chip on", text: p.w, onclick: () => { picked.splice(j, 1); paint(); } })) : [h("span", { class: "note", text: "아래 단어를 순서대로 누르세요" })]));
            rc(bank, ...pool.filter(p => !picked.includes(p)).map(p => h("button", { class: "chip", text: p.w, onclick: () => { picked.push(p); paint(); if (picked.length === words.length) checkIt(); } })));
          };
          const checkIt = () => {
            const ok = picked.map(p => p.w).join(" ") === it.d.t;
            rc(res, h("div", { class: ok ? "verdict ok" : "verdict bad", text: ok ? "완벽해요!" : "순서가 조금 달라요" }), h("div", { class: "q-target", text: it.d.t }), gBadge(it.d.g),
              h("div", { class: "fb-actions" }, ok ? null : h("button", { class: "ghost sm", text: "다시 해보기", onclick: () => { picked = []; rc(res); paint(); } }), h("button", { class: "primary sm", text: "다음", onclick: () => advance(ok) })));
            say(it.d.t, "en", meVoice);
          };
          paint();
          rc(box, ...head, h("div", { class: "qcard" }, h("div", { class: "q-ko", text: it.d.ko }), ans, bank, res));
        } else {
          const d = it.d, res = h("div", { class: "q-res" });
          const hint = h("div", { class: "q-hint", hidden: true, text: d.t.split(/\s+/).slice(0, 3).join(" ") + " …" });
          let done = false;
          rc(box, ...head, h("div", { class: "qcard" },
            h("div", { class: "q-ko big", text: d.ko }), gBadge(d.g), h("div", { class: "note", text: "영어로 말해 보세요. 대화문과 똑같지 않아도 뜻이 통하고 자연스러우면 정답이에요." }),
            h("div", { class: "fb-actions" }, h("button", { class: "mini", text: "💡 첫 단어 힌트", onclick: () => { hint.hidden = false; } })), hint,
            micAnswer({ lang: "en", onResult: async (said) => {
              if (done) return;
              const r = check(d.t, said, "en");
              rc(res, h("div", { class: r.pass ? "verdict ok" : "verdict bad", text: r.pass ? "정답! 👍" : "모범 문장과 달라요" }), h("div", { class: "note", text: "내가 한 말: " + said }), h("div", { class: "note", text: "모범 문장:" }), diffView(r));
              if (r.pass) { done = true; res.append(h("button", { class: "primary sm", text: "다음", onclick: () => advance(true) })); say(d.t, "en", meVoice); return; }
              const slot = thinking(); res.append(slot);
              const j = await aiJudge({ lang: "en", target: d.t, said, ko: d.ko, grammar: d.g != null ? L.grammar[d.g].form : "", context: "lesson: " + L.title });
              if (myTok !== tok) return;
              slot.replaceWith(aiBox(j, "en"));
              if (j.ok) { const v = res.querySelector(".verdict"); v.textContent = "다르게 말했지만 정답이에요 👍"; v.className = "verdict ok"; }
              else say(d.t, "en", meVoice);
              done = true;
              res.append(h("div", { class: "fb-actions" }, j.ok ? null : h("button", { class: "ghost sm", text: "다시 말하기", onclick: () => { done = false; rc(res); } }), h("button", { class: "primary sm", text: "다음", onclick: () => advance(!!j.ok) })));
            } }), res));
        }
      };
      const finish = () => {
        let added = 0;
        L.dialogue.forEach(d => { if (d.who === "me") added += addCard({ lang: "en", kind: "line", t: d.t, ko: d.ko, frame: d.g != null ? L.grammar[d.g].form : "", frameKo: d.g != null ? L.grammar[d.g].title : "", src: L.title, lesson: L.id, box: 1, due: Date.now() + DAY - 3600e3 }) ? 1 : 0; });
        L.grammar.forEach(g => g.ex.forEach(e => { added += addCard({ lang: "en", kind: "pat", t: e.t, ko: e.ko, frame: g.form, frameKo: g.title, src: L.title, lesson: L.id, box: 1, due: Date.now() + DAY - 3600e3 }) ? 1 : 0; }));
        S.en.done[L.id] = { date: Date.now(), quiz: `${right}/${items.length}` };
        persist();
        rc(box, h("div", { class: "panel-card" },
          h("div", { class: "big-num" }, h("b", { text: `${right}/${items.length}` }), h("span", { text: " 퀴즈 정답" })),
          h("div", { class: "note", text: added ? `복습 카드 ${added}개를 만들었어요. 내일부터 「복습」에 나와요.` : "복습 카드는 이미 만들어져 있어요." }),
          h("div", { class: "fb-actions" }, h("button", { class: "primary", text: "다음: 대본 리허설", onclick: () => go(4) }), h("button", { class: "ghost", text: "퀴즈 다시", onclick: () => { k = 0; right = 0; tok++; render(); } }))));
      };
      render();
      return box;
    }
    function rehearseStep() {
      const reh = S.en.reh[L.id] || {};
      return h("div", { class: "stack" }, h("div", { class: "panel-card" },
        h("b", { text: "대본을 외워서 말해 보는 단계예요" }),
        h("div", { class: "note", text: `${look.name}의 대사는 소리로 나오고, 내 차례에 외운 문장을 말해요. 보면서 → 첫 단어만 → 안 보고, 세 단계로 어렵게 할 수 있어요. 대본과 다르게 말해도 AI 코치가 판단해 주고, 뜻이 달라지면 ${look.name}가 내 말에 맞춰 받아줘요.` }),
        reh.best ? h("div", { class: "note", text: `최고 기록 ${reh.best}% · 다음 단계: ${({ see: "보면서", first: "첫 단어만", blind: "안 보고" })[reh.next || "see"]}` }) : null,
        h("div", { class: "fb-actions" }, h("button", { class: "primary", text: "🎭 리허설 시작", onclick: () => TP.openRehearsal(lessonNote(L)) }), nextBtn("다음: 실전 대화"))));
    }
    function talkStep() {
      const talk = S.en.talk[L.id];
      return h("div", { class: "stack" }, h("div", { class: "panel-card" },
        h("b", { text: "이제 대본 없이 실전이에요" }),
        h("div", { class: "note", text: `같은 상황이지만 ${look.name}가 숫자·날짜·질문을 조금씩 바꿔서 말해요. 오늘 배운 표현을 쓸 기회를 만들어 주고, 끝나면 교정 노트에서 배운 표현을 썼는지 체크해 드려요.` }),
        h("div", { class: "g-list" }, ...L.grammar.map(g => h("div", { class: "g-mini" }, h("b", { text: g.title }), " ", h("span", { class: "hl", text: g.form })))),
        talk ? h("div", { class: "note", text: `지난 실전: ${fmtDate(talk.date)} · ${talk.score}점` }) : null,
        h("div", { class: "fb-actions" }, h("button", { class: "primary", text: "💬 실전 대화 시작", onclick: () => TP.startScene(L.scene, { lessonId: L.id }) }),
          nextInUnit ? h("button", { class: "ghost", text: `다음 레슨: ${nextInUnit.title}`, onclick: () => openEnLesson(nextInUnit) }) : null)));
    }
    const unitList = unitLessons(L.unit), nextInUnit = unitList[unitList.indexOf(L) + 1] || null;
    draw();
  }

  TP.exportEnLessonPDF = (L) => {
    const d = new Date(), ds = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
    const look = TP.LOOK[L.scene] || {};
    const mine = L.dialogue.filter(x => x.who === "me");
    const el = sheet(`영어 · ${L.title}`, `${ds} · 코스 레슨 · 상대: ${look.name || ""}`,
      h("div", { class: "p-summary", text: "목표 · " + L.goal }),
      pblock("1. 오늘의 문법 · 표현", ...L.grammar.map((g, i) => h("div", { class: "p-row p-avoid" }, h("div", { class: "p-num", text: String(i + 1) }), h("div", {},
        h("div", { class: "p-frame", text: `${g.title} — ${g.form}` }), h("div", { class: "p-why", text: g.ko }),
        ...g.ex.map(e => h("div", { class: "p-ex", text: `• ${e.t}  —  ${e.ko}` })),
        h("div", { class: "p-label", text: "이 틀로 내 문장 2개 만들기" }), lines(2))))),
      pblock("2. 대화문 (소리 내어 3번 읽기 □ □ □)", ...L.dialogue.map(x => h("div", { class: "p-script " + x.who },
        h("span", { class: "p-who", text: x.who === "me" ? "나" : (look.name || "상대") }), h("div", {}, h("div", { text: x.t }), h("div", { class: "p-why", text: x.ko + (x.g != null ? "  (문법 " + (x.g + 1) + ")" : "") }))))),
      h("div", { class: "p-break" }),
      pblock("3. 빈칸 채우기", ...L.blanks.map((b, i) => h("div", { class: "p-row p-avoid" }, h("div", { class: "p-num", text: String(i + 1) }), h("div", {},
        h("div", { class: "p-q", text: b.s.replace("___", "________") }), h("div", { class: "p-why", text: `${b.ko}   (${shuffle([b.a, ...b.o]).join(" / ")})` }))))),
      pblock("4. 한국어 보고 내 대사 써 보기", ...mine.map((x, i) => h("div", { class: "p-row p-avoid" }, h("div", { class: "p-num", text: String(i + 1) }), h("div", {}, h("div", { class: "p-q", text: x.ko }), lines(2))))),
      pblock("정답", ...L.blanks.map((b, i) => h("div", { class: "p-ans", text: `빈칸 ${i + 1}. ${b.s.replace("___", b.a)}` })), ...mine.map((x, i) => h("div", { class: "p-ans", text: `대사 ${i + 1}. ${x.t}` }))));
    makeAndShare(el, `TalkPartner_EN_${L.id}_${L.title.replace(/[^\p{L}\p{N}]+/gu, "_")}.pdf`);
  };

  // ---------- Vietnamese beginner course ----------
  function coursePanel() {
    const tile = (L) => {
      const d = S.vi.done[L.id];
      return h("button", { class: "lesson" + (d ? " done" : ""), onclick: () => openLesson(L) },
        h("span", { class: "li", text: L.icon }), h("b", { text: L.title }),
        h("small", { text: (L.frame ? L.frame + " · " : "") + `${L.items.length}개` + (d ? ` · ✓ ${fmtDate(d.date)}` : "") }));
    };
    const s1 = COURSE.filter(l => l.stage === 1), s2 = COURSE.filter(l => l.stage === 2);
    const doneWords = s1.filter(l => S.vi.done[l.id]).length;
    return h("div", { class: "course" },
      h("div", { class: "group-label", text: `1단계 · 단어 (${doneWords}/${s1.length})` }), h("div", { class: "lessons" }, ...s1.map(tile)),
      h("div", { class: "group-label", text: "2단계 · 짧은 문장" + (doneWords < 4 ? " · 단어 레슨 4개 이상 끝내고 추천" : "") }), h("div", { class: "lessons" }, ...s2.map(tile)));
  }
  function openLesson(L) {
    const items = L.items;
    const body = h("div", { class: "lesson-body" });
    openStudy(`${L.icon} ${L.title}`, body);
    const run = stopFlag;
    const steps = [["learn", "듣고 따라 하기"], ["listen", "듣고 뜻 고르기"], ["speak", "뜻 보고 말하기"]];
    let phase = 0, idx = 0, score = { listen: 0, speak: 0 };
    const stepBar = () => h("div", { class: "steps" }, ...steps.map(([k, t], i) => h("span", { class: i === phase ? "on" : i < phase ? "done" : "", text: `${i + 1}. ${t}` })));
    function frameBanner() { return L.frame ? h("div", { class: "frame" }, h("b", { text: L.frame }), h("span", { text: ` (${L.frameR}) · ${L.frameK}` })) : null; }
    let learnTok = 0;
    function learn() {
      if (run !== stopFlag) return;
      const tok = ++learnTok; TP.cancelSpeech();
      const it = items[idx];
      const res = h("div", { class: "q-res" });
      const play = (rate) => say(it.v, "vi", { rate });
      rc(body, stepBar(), h("div", { class: "note", text: `${idx + 1} / ${items.length}` }), frameBanner(),
        h("div", { class: "qcard center" },
          h("button", { class: "play-big", text: "🔊", "aria-label": "듣기", onclick: () => play(0.8) }),
          readBlock(it.v, it.r, true), h("div", { class: "q-ko", text: it.k }),
          h("div", { class: "fb-actions center" },
            h("button", { class: "ghost sm", text: "▶ 보통", onclick: () => play(0.85) }),
            h("button", { class: "ghost sm", text: "🐢 천천히", onclick: () => play(0.5) })),
          micAnswer({ lang: "vi", label: "🎤 따라 하기", onResult: (said) => {
            const r = check(it.v, said, "vi");
            rc(res, h("div", { class: r.pass ? "verdict ok" : "verdict bad", text: r.pass ? "좋아요! 비슷해요 👍" : "괜찮아요, 한 번 더 들어 보고 따라 해요" }), h("div", { class: "note", text: "들린 말: " + said }));
            if (!r.pass) play(0.6);
          } }), res),
        h("div", { class: "fb-actions" },
          idx > 0 ? h("button", { class: "ghost", text: "이전", onclick: () => { idx--; learn(); } }) : null,
          h("button", { class: "primary", text: idx < items.length - 1 ? "다음" : "퀴즈로", onclick: () => { if (idx < items.length - 1) { idx++; learn(); } else { phase = 1; startListen(); } } })));
      const alive = () => run === stopFlag && tok === learnTok;
      (async () => { await new Promise(r => setTimeout(r, 250)); if (!alive()) return; await play(0.85); if (!alive()) return; await new Promise(r => setTimeout(r, 500)); if (alive()) await play(0.55); })();
    }
    let q = [];
    function startListen() { q = shuffle(items.map((it, i) => i)); score.listen = 0; listenStep(new Set()); }
    function listenStep(wrongOnce) {
      if (run !== stopFlag) return;
      const i = q.shift(); if (i === undefined) { phase = 2; q = shuffle(items.map((it, k) => k)); return speakStep(); }
      const it = items[i];
      const card = { t: it.v, read: it.r, ko: it.k };
      const pool = shuffle(items.filter(x => x !== it).map(x => x.k));
      const choices = shuffle([it.k, ...pool.slice(0, 3)]);
      const grid = h("div", { class: "choices" });
      const play = () => say(it.v, "vi", { rate: 0.75 });
      const qc = h("div", { class: "qcard center" }, h("button", { class: "play-big", text: "🔊", onclick: play }), h("div", { class: "note center", text: "소리를 듣고 뜻을 고르세요" }), grid);
      let answered = false;
      for (const c of choices) grid.append(h("button", { class: "choice", text: c, onclick: (ev) => {
        if (answered) return; answered = true;
        const ok = c === it.k;
        ev.currentTarget.classList.add(ok ? "ok" : "bad");
        [...grid.children].forEach(b => { if (b.textContent === it.k) b.classList.add("ok"); });
        qc.append(readBlock(card.t, card.read, true));
        if (ok) { if (!wrongOnce.has(i)) score.listen++; setTimeout(() => listenStep(wrongOnce), 1100); }
        else { wrongOnce.add(i); q.push(i); qc.append(h("button", { class: "ghost sm", text: "다음", onclick: () => listenStep(wrongOnce) })); }
        play();
      } }));
      rc(body, stepBar(), h("div", { class: "note", text: `남은 문제 ${q.length + 1}` }), qc);
      setTimeout(play, 300);
    }
    function speakStep() {
      if (run !== stopFlag) return;
      const i = q.shift(); if (i === undefined) return finish();
      const it = items[i];
      const res = h("div", { class: "q-res" });
      const hint = h("div", { class: "q-hint", hidden: true }, readBlock(it.v, it.r, true));
      const nextBtn = h("button", { class: "primary", text: q.length ? "다음" : "끝내기", onclick: speakStep });
      rc(body, stepBar(), h("div", { class: "note", text: `남은 문제 ${q.length + 1}` }), frameBanner(),
        h("div", { class: "qcard center" }, h("div", { class: "q-ko big", text: it.k }), h("div", { class: "note", text: "베트남어로 말해 보세요. 생각이 안 나면 발음 보기를 누르세요." }),
          h("div", { class: "fb-actions center" }, h("button", { class: "mini", text: "💡 발음 보기", onclick: () => { hint.hidden = false; say(it.v, "vi", { rate: 0.6 }); } })), hint,
          micAnswer({ lang: "vi", onResult: (said) => {
            const r = check(it.v, said, "vi");
            if (r.pass && hint.hidden) score.speak++;
            hint.hidden = false;
            rc(res, h("div", { class: r.pass ? "verdict ok" : "verdict bad", text: r.pass ? "통과! 👏" : "아쉬워요. 소리를 듣고 한 번 더 해 봐요" }), h("div", { class: "note", text: "들린 말: " + said }));
            say(it.v, "vi", { rate: 0.7 });
          } }), res),
        h("div", { class: "fb-actions" }, nextBtn));
    }
    function finish() {
      const added = items.reduce((n, it) => n + (addCard({ lang: "vi", kind: "vi", t: it.v, read: it.r, ko: it.k, src: L.title, lesson: L.id, box: 1, due: Date.now() + DAY - 3600e3 }) ? 1 : 0), 0);
      S.vi.done[L.id] = { date: Date.now(), listen: score.listen, speak: score.speak, n: items.length };
      persist();
      const nextL = COURSE[COURSE.indexOf(L) + 1];
      rc(body, h("div", { class: "panel-card" },
        h("div", { class: "big-num" }, h("b", { text: "완료 🎉" })),
        h("div", { class: "note", text: `듣고 고르기 한 번에 맞힘 ${score.listen}/${items.length} · 말하기 혼자 통과 ${score.speak}/${items.length}` }),
        h("div", { class: "note", text: added ? `복습 카드 ${added}개를 추가했어요. 내일부터 「복습」에 나와요.` : "이미 복습 카드에 있는 표현이에요." }),
        h("div", { class: "fb-actions" },
          h("button", { class: "primary", text: "PDF 학습지 (굿노트)", onclick: () => TP.exportLessonPDF(L) }),
          nextL ? h("button", { class: "ghost", text: `다음 레슨: ${nextL.title}`, onclick: () => openLesson(nextL) }) : null,
          h("button", { class: "ghost", text: "한 번 더", onclick: () => openLesson(L) }),
          h("button", { class: "ghost", text: "코스로", onclick: backHome }))));
    }
    learn();
  }

  // ---------- PDF export ----------
  let pdfLib = null;
  function loadPdfLib() {
    if (window.html2pdf) return Promise.resolve();
    if (pdfLib) return pdfLib;
    pdfLib = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
      s.onload = () => res(); s.onerror = () => { pdfLib = null; rej(new Error("load")); };
      document.head.append(s);
    });
    return pdfLib;
  }
  function lines(n) { return h("div", { class: "p-lines" }, ...Array.from({ length: n }, () => h("div", { class: "p-line" }))); }
  function sheet(title, sub, ...blocks) {
    return h("div", { class: "pdf-sheet" }, h("div", { class: "p-head" }, h("div", { class: "p-brand", text: "TalkPartner 학습지" }), h("h1", { text: title }), h("div", { class: "p-sub", text: sub })), ...blocks);
  }
  const pblock = (title, ...c) => h("div", { class: "p-block" }, h("h2", { text: title }), ...c);
  async function makeAndShare(el, filename) {
    const modal = h("div", { class: "pdf-modal" }, h("div", { class: "pm-card" }, h("b", { text: "PDF 만드는 중…" }), h("div", { class: "note", text: "몇 초 걸려요." })));
    document.body.append(modal);
    const host = h("div", { class: "pdf-host" }, el); document.body.append(host);
    try {
      await loadPdfLib();
      await (document.fonts && document.fonts.ready);
      const blob = await window.html2pdf().set({
        margin: [10, 10, 12, 10], filename,
        image: { type: "jpeg", quality: 0.92 },
        html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"], avoid: [".p-avoid", ".p-row"] },
      }).from(el).outputPdf("blob");
      host.remove();
      const file = new File([blob], filename, { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const canShare = navigator.canShare && navigator.canShare({ files: [file] });
      rc(modal.firstChild, 
        h("b", { text: "PDF가 준비됐어요" }),
        h("div", { class: "note", text: canShare ? "「굿노트로 보내기」를 누르고 공유 목록에서 GoodNotes를 고르세요." : "「PDF 열기」를 누른 뒤 공유 버튼 → GoodNotes를 고르세요." }),
        h("div", { class: "fb-actions" },
          canShare ? h("button", { class: "primary", text: "굿노트로 보내기", onclick: async () => { try { await navigator.share({ files: [file], title: filename }); } catch {} } }) : null,
          h("a", { class: "ghost", href: url, target: "_blank", rel: "noopener", download: filename, text: "PDF 열기" }),
          h("button", { class: "ghost", text: "닫기", onclick: () => { modal.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); } })));
    } catch (e) {
      host.remove();
      rc(modal.firstChild, h("b", { text: "PDF를 만들지 못했어요" }), h("div", { class: "note", text: "인터넷 연결을 확인하고 다시 눌러주세요." }), h("button", { class: "ghost", text: "닫기", onclick: () => modal.remove() }));
    }
  }
  TP.exportPDF = (n) => {
    const d = new Date(n.date), ds = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
    const langName = n.lang === "vi" ? "베트남어" : "영어";
    const el = sheet(n.sceneTitle, `${ds} · ${langName} · ${n.partner || ""} · 점수 ${n.score}/100`,
      n.summary ? h("div", { class: "p-summary", text: n.summary }) : null,
      n.corrections.length ? pblock("1. 고쳐 말하기", ...n.corrections.map((c, i) => h("div", { class: "p-row" },
        h("div", { class: "p-num", text: String(i + 1) }),
        h("div", {}, h("div", { class: "p-old", text: "내 말: " + c.original }), h("div", { class: "p-new", text: c.better }),
          c.read ? h("div", { class: "p-read", text: c.read }) : null,
          h("div", { class: "p-why", text: (c.ko ? c.ko + " · " : "") + c.why }),
          h("div", { class: "p-label", text: "3번 써 보기" }), lines(3))))) : null,
      n.patterns.length ? pblock("2. 단어만 바꿔 쓰는 문장 틀", ...n.patterns.map(p => h("div", { class: "p-row p-avoid" }, h("div", {},
        h("div", { class: "p-frame", text: p.frame }), h("div", { class: "p-why", text: p.ko + (p.use ? " · " + p.use : "") }),
        ...p.examples.map(e => h("div", { class: "p-ex", text: `• ${e.t}  —  ${e.ko}` })),
        h("div", { class: "p-label", text: "내 상황으로 직접 만들어 보기" }), lines(3))))) : null,
      n.script.length ? pblock("3. 모범 대본 (소리 내어 3번 읽기 □ □ □)", ...n.script.map(l => h("div", { class: "p-script " + l.who },
        h("span", { class: "p-who", text: l.who === "me" ? "나" : (n.partner || "상대") }), h("div", {}, h("div", { text: l.t }), l.ko ? h("div", { class: "p-why", text: l.ko }) : null)))) : null,
      n.corrections.length ? h("div", { class: "p-break" }) : null,
      n.corrections.length ? pblock("4. 셀프 퀴즈 · 한국어를 보고 써 보세요", ...[...n.corrections.filter(c => c.ko), ...n.patterns.flatMap(p => p.examples)].slice(0, 10).map((x, i) => h("div", { class: "p-row p-avoid" },
        h("div", { class: "p-num", text: String(i + 1) }), h("div", {}, h("div", { class: "p-q", text: x.ko }), lines(2))))) : null,
      n.corrections.length ? pblock("정답", ...[...n.corrections.filter(c => c.ko).map(c => firstAlt(c.better)), ...n.patterns.flatMap(p => p.examples).map(e => e.t)].slice(0, 10).map((t, i) => h("div", { class: "p-ans", text: `${i + 1}. ${t}` }))) : null);
    makeAndShare(el, `TalkPartner_${ds.replace(/\./g, "")}_${n.sceneTitle.replace(/[^\p{L}\p{N}]+/gu, "_")}.pdf`);
  };
  TP.exportLessonPDF = (L) => {
    const d = new Date(), ds = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
    const el = sheet(`베트남어 ${L.title}`, `${ds} · 기초 코스 · ${L.items.length}개`,
      L.frame ? h("div", { class: "p-summary", text: `문장 틀: ${L.frame} (${L.frameR}) — ${L.frameK}` }) : null,
      h("div", { class: "p-summary", text: "성조 화살표: → 평평하게 · ↗ 올림 · ↘ 내림 · ↘↗ 내렸다 올림 · ↗~ 꺾어 올림 · ↓ 짧고 낮게" }),
      pblock("1. 표현 익히기", h("table", { class: "p-table" },
        h("tr", {}, h("th", { text: "베트남어" }), h("th", { text: "한글 발음" }), h("th", { text: "성조" }), h("th", { text: "뜻" }), h("th", { text: "따라 쓰기" })),
        ...L.items.map(it => h("tr", { class: "p-avoid" }, h("td", { class: "p-vi", text: it.v }), h("td", { text: it.r }),
          h("td", { text: it.v.replace(/[?!.,]/g, "").split(/\s+/).map(sy => toneOf(sy).s).join(" ") }), h("td", { text: it.k }), h("td", { class: "p-write" }))))),
      h("div", { class: "p-break" }),
      pblock("2. 셀프 퀴즈 · 뜻을 보고 베트남어(또는 한글 발음)로 써 보세요", ...shuffle(L.items).map((it, i) => h("div", { class: "p-row p-avoid" },
        h("div", { class: "p-num", text: String(i + 1) }), h("div", {}, h("div", { class: "p-q", text: it.k }), lines(1))))),
      pblock("정답", ...L.items.map(it => h("div", { class: "p-ans", text: `${it.k} → ${it.v} (${it.r})` }))));
    makeAndShare(el, `TalkPartner_VI_${L.id}_${L.title.replace(/[^\p{L}\p{N}]+/gu, "_")}.pdf`);
  };

  // ---------- styles ----------
  const css = `
  .hometabs { display: flex; flex-wrap: wrap; gap: 4px 26px; align-items: flex-end; border-bottom: 1px solid var(--line); }
  .htab { border: 0; background: none; padding: 10px 2px 12px; font-weight: 600; font-size: 17px; color: var(--muted); display: inline-flex; gap: 8px; align-items: center; border-bottom: 3px solid transparent; margin-bottom: -1px; border-radius: 0; }
  .htab[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--ink); }
  .htab .count { background: var(--accent); color: #fff; border-radius: 99px; font-size: 12.5px; padding: 1px 8px; font-variant-numeric: tabular-nums; }
  .sync { margin-left: auto; font-size: 13px; color: var(--muted); padding-bottom: 14px; }
  .sync.ok { color: var(--good); } .sync.warn { color: var(--signal); }
  .homepanel { display: grid; gap: 18px; }
  .hl { background: linear-gradient(transparent 52%, var(--hl-soft) 52%, var(--hl-soft) 92%, transparent 92%); padding: 0 2px; }
  .panel-card { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: 24px; display: grid; gap: 14px; justify-items: start; box-shadow: var(--shadow); }
  .big-num b { font-family: var(--font-display); font-weight: 700; font-size: 48px; line-height: 1; color: var(--ink); font-variant-numeric: tabular-nums; }
  .big-num span { font-size: 18px; color: var(--muted); }
  .ghost.sm, .primary.sm { padding: 9px 15px; font-size: 15px; border-radius: 12px; }
  .primary.sm { box-shadow: none; }
  a.ghost { text-decoration: none; display: inline-block; }
  .study { padding-block: 22px 70px; display: grid; gap: 18px; }
  .study-head h2 { font-family: var(--font-display); font-weight: 700; margin: 0; font-size: 30px; letter-spacing: -0.01em; }
  .stack { display: grid; gap: 16px; }
  .progress { height: 5px; background: var(--line); border-radius: 99px; overflow: hidden; }
  .progress i { display: block; height: 100%; background: var(--ink); transition: width .3s; }
  .qcard { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: 26px 24px; display: grid; gap: 14px; box-shadow: var(--shadow); }
  .qcard.center, .center { justify-items: center; text-align: center; justify-content: center; }
  .q-ko { font-size: 21px; font-weight: 600; text-wrap: balance; }
  .q-ko.big { font-size: 27px; }
  .q-target { font-family: var(--font-serif); font-size: 21px; font-weight: 600; line-height: 1.45; }
  .q-target.big { font-size: 26px; text-wrap: balance; }
  .q-hint { background: var(--bg); border: 1px dashed var(--line-strong); border-radius: 14px; padding: 12px 14px; display: grid; gap: 6px; font-family: var(--font-serif); }
  .frame { background: var(--surface); border-left: 4px solid var(--hl); border-radius: 6px; padding: 10px 14px; font-size: 15.5px; }
  .frame b { font-family: var(--font-serif); font-size: 18px; background: linear-gradient(transparent 55%, var(--hl-soft) 55%); }
  .verdict { font-weight: 700; font-size: 18px; } .verdict.ok { color: var(--good); } .verdict.bad { color: var(--bad); }
  .diff { font-family: var(--font-serif); font-size: 20px; line-height: 1.6; } .diff .ok { color: var(--good); } .diff .miss { color: var(--bad); text-decoration: underline wavy; text-underline-offset: 4px; }
  .mic-area { display: grid; gap: 8px; justify-items: center; width: 100%; }
  .mic-row { display: flex; gap: 12px; align-items: center; }
  .mic-btn { background: var(--ink); color: var(--bg); border: 0; border-radius: 99px; padding: 16px 30px; font-weight: 700; font-size: 17px; }
  .mic-btn.on { background: var(--good); color: #fff; }
  @media (prefers-reduced-motion: no-preference) { .mic-btn.on, .mic-mini.on { animation: pulse 1.3s ease-in-out infinite; } }
  .live { min-height: 1.4em; color: var(--muted); font-size: 16px; font-family: var(--font-serif); }
  .typed { display: flex; gap: 8px; width: 100%; max-width: 560px; align-items: center; }
  .typed input { flex: 1; min-width: 0; font: inherit; font-size: 17px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink); }
  .play-big { width: 96px; height: 96px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); font-size: 38px; box-shadow: var(--shadow); }
  .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 10px; width: 100%; }
  .choice { border: 1.5px solid var(--line-strong); background: var(--surface); border-radius: 16px; padding: 16px; font-size: 18px; font-weight: 600; }
  .choice.ok { border-color: var(--good); background: var(--good-soft); color: var(--good); }
  .choice.bad { border-color: var(--bad); background: var(--bad-soft); color: var(--bad); }
  .syl-row { display: flex; flex-wrap: wrap; gap: 6px 16px; justify-content: center; }
  .syl { display: grid; justify-items: center; gap: 0; }
  .syl b { font-size: 22px; } .syl i { font-style: normal; color: var(--signal); font-size: 16px; font-weight: 700; } .syl small { color: var(--muted); font-size: 13px; font-family: var(--font-serif); }
  .syl-row.big .syl b { font-size: 42px; line-height: 1.15; } .syl-row.big .syl i { font-size: 22px; } .syl-row.big .syl small { font-size: 17px; }
  .steps { display: flex; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
  .steps span { padding: 4px 10px; border-radius: 99px; background: var(--line); color: var(--muted); }
  .steps .on { background: var(--ink); color: var(--bg); } .steps .done { background: var(--good-soft); color: var(--good); }
  .steps.big { gap: 6px; overflow-x: auto; padding-bottom: 2px; flex-wrap: nowrap; }
  .steps.big button { flex: none; border: 1px solid var(--line); background: var(--surface); border-radius: 99px; padding: 8px 14px 8px 8px; font-size: 15px; font-weight: 600; color: var(--muted); display: inline-flex; gap: 8px; align-items: center; }
  .steps.big .sn { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; background: var(--bg); color: var(--muted); font-variant-numeric: tabular-nums; }
  .steps.big button.past { color: var(--ink); } .steps.big button.past .sn { background: var(--good-soft); color: var(--good); }
  .steps.big button.on { background: var(--ink); color: var(--bg); border-color: var(--ink); } .steps.big button.on .sn { background: var(--hl); color: #1B2340; }
  .course { display: grid; gap: 16px; }
  .lessons { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 12px; }
  .lesson { border: 1px solid var(--line); background: var(--surface); border-radius: 18px; padding: 16px; text-align: left; display: grid; gap: 4px; box-shadow: var(--shadow); }
  .lesson .li { font-size: 28px; } .lesson b { font-size: 17px; } .lesson small { color: var(--muted); font-size: 13.5px; }
  .lesson.done { border-color: color-mix(in srgb, var(--good) 45%, var(--line)); }
  .en-lessons { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap: 14px; }
  .en-lesson { border: 1px solid var(--line); background: var(--surface); border-radius: 22px; padding: 16px 18px; text-align: left; display: grid; grid-template-columns: 76px 1fr; gap: 16px; align-items: start; box-shadow: var(--shadow); }
  .el-face { width: 76px; height: 76px; border-radius: 50%; overflow: hidden; }
  .el-txt { display: grid; gap: 4px; min-width: 0; }
  .el-tag { color: var(--muted); font-size: 13px; }
  .el-txt b { font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1.25; }
  .el-goal { font-size: 14px; color: var(--muted); line-height: 1.45; }
  .el-prog { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 8px; }
  .el-prog span { font-size: 12px; color: var(--muted); padding-top: 6px; border-top: 4px solid var(--line); }
  .el-prog span.on { color: var(--ink); border-top-color: var(--good); font-weight: 600; }
  .cont-card { display: grid; grid-template-columns: 84px 1fr auto; gap: 18px; align-items: center; padding: 20px 22px; border-radius: 24px; background: var(--ink); color: var(--bg); box-shadow: var(--shadow); }
  .cont-face { width: 84px; height: 84px; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 3px color-mix(in srgb, var(--hl) 80%, transparent); }
  .cont-face svg { width: 100%; height: 100%; }
  .cont-txt { display: grid; gap: 4px; min-width: 0; }
  .cont-txt small { font-size: 13px; opacity: .75; }
  .cont-txt b { font-family: var(--font-display); font-size: 24px; line-height: 1.2; }
  .cont-txt span { font-size: 14.5px; opacity: .85; line-height: 1.45; }
  .cont-card .primary { background: var(--hl); color: #1B2340; border-color: var(--hl); white-space: nowrap; }
  .course-stat { color: var(--muted); font-size: 14px; padding: 2px 4px; }
  .unit { background: var(--surface); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; }
  .unit-head { width: 100%; display: grid; grid-template-columns: 44px 1fr auto 20px; gap: 14px; align-items: center; padding: 16px 18px; text-align: left; background: none; border: 0; border-radius: 0; }
  .unit-ic { font-size: 26px; text-align: center; }
  .unit-txt { display: grid; gap: 2px; min-width: 0; }
  .unit-txt b { font-family: var(--font-display); font-size: 19px; }
  .unit-txt small { color: var(--muted); font-size: 13.5px; line-height: 1.4; }
  .unit-count { display: grid; gap: 5px; justify-items: end; font-size: 13.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .unit-bar { width: 72px; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
  .unit-bar i { display: block; height: 100%; background: var(--good); }
  .unit-chev { font-size: 22px; color: var(--muted); transition: transform .2s; text-align: center; }
  .unit-head[aria-expanded="true"] .unit-chev { transform: rotate(90deg); }
  .unit-body { border-top: 1px solid var(--line); padding: 6px 10px 14px; display: grid; gap: 2px; }
  .lrow { display: grid; grid-template-columns: 26px 46px 1fr auto; gap: 12px; align-items: center; padding: 10px 8px; border: 0; border-radius: 14px; background: none; text-align: left; width: 100%; }
  .lrow:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
  .lrow.last { background: color-mix(in srgb, var(--hl) 22%, transparent); }
  .lr-num { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 14px; text-align: right; }
  .lrow.done .lr-num { color: var(--good); font-weight: 700; }
  .lr-face { width: 46px; height: 46px; border-radius: 50%; overflow: hidden; }
  .lr-face svg { width: 100%; height: 100%; }
  .lr-txt { display: grid; gap: 2px; min-width: 0; }
  .lr-txt b { font-size: 16.5px; font-weight: 600; }
  .lr-txt small { color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ai-chip { display: inline-block; margin-left: 8px; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 8px; background: var(--accent); color: #fff; vertical-align: 2px; }
  .lr-state { display: grid; gap: 4px; justify-items: end; }
  .lr-state small { font-size: 12px; color: var(--muted); white-space: nowrap; }
  .lr-prog { display: flex; gap: 3px; }
  .lr-prog i { width: 16px; height: 5px; border-radius: 3px; background: var(--line); }
  .lr-prog i.on { background: var(--good); }
  .gen-box { margin-top: 8px; padding: 12px 8px 0; border-top: 1px dashed var(--line-strong); display: grid; gap: 10px; }
  .gen-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .gen-in { flex: 1 1 260px; min-width: 0; padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: 12px; background: var(--bg); color: var(--ink); font: inherit; font-size: 15px; }
  @media (max-width: 640px) {
    .cont-card { grid-template-columns: 64px 1fr; }
    .cont-face { width: 64px; height: 64px; }
    .cont-card .primary { grid-column: 1 / -1; }
    .lrow { grid-template-columns: 22px 40px 1fr; }
    .lr-face { width: 40px; height: 40px; }
    .lr-state { grid-column: 3; justify-items: start; }
    .unit-head { grid-template-columns: 36px 1fr auto 16px; padding: 14px; }
  }
  .lesson-top { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .lesson-top > div:nth-child(2) { flex: 1; min-width: 200px; }
  .lt-face { width: 64px; height: 64px; border-radius: 50%; overflow: hidden; flex: none; }
  .lt-goal { font-size: 16px; font-weight: 500; }
  .g-card { background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: 22px 22px 14px; display: grid; gap: 10px; box-shadow: var(--shadow); }
  .g-head { display: flex; gap: 10px; align-items: center; }
  .g-num { width: 28px; height: 28px; border-radius: 50%; background: var(--ink); color: var(--bg); display: grid; place-items: center; font-size: 14px; font-weight: 700; }
  .g-head b { font-size: 19px; }
  .g-form { font-family: var(--font-serif); font-size: 23px; font-weight: 600; justify-self: start; background: linear-gradient(transparent 50%, var(--hl-soft) 50%, var(--hl-soft) 92%, transparent 92%); padding: 0 4px; }
  .g-ko { color: var(--muted); font-size: 15.5px; max-width: 62ch; }
  .g-ex { display: grid; grid-template-columns: 34px 1fr; gap: 10px; align-items: start; text-align: left; border: 0; border-top: 1px solid var(--line); background: none; padding: 12px 0 8px; border-radius: 0; }
  .g-play { width: 30px; height: 30px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; font-size: 12px; }
  .g-t { font-family: var(--font-serif); font-size: 19px; } .g-k { font-size: 14px; color: var(--muted); }
  .g-badge { justify-self: start; display: inline-block; font-size: 12.5px; font-weight: 600; color: var(--ink); background: var(--hl-soft); border-radius: 6px; padding: 2px 8px; margin-top: 4px; }
  .g-mini { font-size: 15px; } .g-mini .hl { font-family: var(--font-serif); font-size: 17px; }
  .g-list { display: grid; gap: 6px; }
  .q-blank { font-family: var(--font-serif); font-size: 26px; line-height: 1.5; text-wrap: balance; }
  .q-blank .blank { display: inline-block; min-width: 3.4em; border-bottom: 3px solid var(--ink); color: transparent; margin: 0 4px; background: var(--hl-soft); border-radius: 4px 4px 0 0; }
  .order-ans { min-height: 58px; border: 1.5px dashed var(--line-strong); border-radius: 16px; padding: 10px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .order-bank { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { border: 1px solid var(--line-strong); background: var(--surface); border-radius: 12px; padding: 9px 14px; font-family: var(--font-serif); font-size: 18px; }
  .chip.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .ai-box { border-radius: 16px; padding: 14px 16px; background: var(--accent-soft); display: grid; gap: 6px; text-align: left; font-size: 15.5px; }
  .ai-box.ok { background: var(--good-soft); } .ai-box.warn { background: var(--signal-soft); }
  .ai-box.wait { display: flex; gap: 10px; align-items: center; color: var(--muted); }
  .ai-tag { font-size: 13px; font-weight: 700; color: var(--accent); } .ai-box.ok .ai-tag { color: var(--good); }
  .ai-better { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-family: var(--font-serif); font-size: 18px; font-weight: 600; }
  .dots { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid var(--line-strong); border-top-color: var(--accent); }
  @media (prefers-reduced-motion: no-preference) { .dots { animation: spin .8s linear infinite; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .note-list { display: grid; gap: 12px; }
  .note-item { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 16px 18px; display: grid; gap: 6px; box-shadow: var(--shadow); }
  .ni-top { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .ni-top b { font-size: 17px; }
  .mini.left { text-align: left; }
  .script { display: grid; gap: 8px; }
  .sl { display: grid; grid-template-columns: 70px 1fr; gap: 12px; padding: 12px 14px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); text-align: left; width: 100%; }
  .sl.me { background: var(--accent-soft); border-color: transparent; }
  .sl .who { font-size: 13px; font-weight: 700; color: var(--muted); padding-top: 4px; }
  .sl .st { font-family: var(--font-serif); font-size: 18.5px; line-height: 1.45; } .sl .sk { font-size: 14px; color: var(--muted); margin-top: 2px; }
  .sl .said { font-size: 14px; color: var(--signal); margin-top: 2px; }
  .sl.cur { box-shadow: inset 0 0 0 2px var(--ink); }
  .sl.cur .st { display: inline; background: linear-gradient(transparent 55%, var(--hl-soft) 55%, var(--hl-soft) 94%, transparent 94%); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .sl.cur .st + * { margin-top: 4px; }
  .sl.pass { border-color: var(--good); } .sl.pass .who { color: var(--good); } .sl.fail { border-color: var(--bad); } .sl.fail .who { color: var(--bad); }
  .sl.adlib { border-style: dashed; background: var(--bg); }
  .rh-dock { position: sticky; bottom: 0; background: var(--bg); padding: 12px 0 calc(8px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 8px; border-top: 1px solid var(--line); }
  .rh-status { font-size: 16px; font-weight: 600; min-height: 1.4em; }
  .mic-mini { flex: none; width: 46px; height: 46px; border-radius: 50%; border: 0; background: var(--ink); color: var(--bg); font-size: 18px; }
  .mic-mini.on { background: var(--good); color: #fff; }
  .corr-item.target.used { border-color: color-mix(in srgb, var(--good) 45%, var(--line)); } .corr-item.target.used .new { color: var(--good); }
  .corr-item.target.missed .new { color: var(--muted); }
  .pdf-modal { position: fixed; inset: 0; z-index: 60; background: rgba(14, 19, 34, .45); display: grid; place-items: center; padding: 20px; }
  .pm-card { background: var(--surface); color: var(--ink); border-radius: 22px; padding: 24px; max-width: 440px; width: 100%; display: grid; gap: 12px; box-shadow: var(--shadow); }
  .pdf-host { position: fixed; left: -12000px; top: 0; }
  .pdf-sheet { width: 720px; background: #fff; color: #1b2340; font-family: "IBM Plex Sans KR", "Apple SD Gothic Neo", sans-serif; font-size: 13.5px; line-height: 1.55; padding: 4px 6px; }
  .pdf-sheet h1 { font-family: "Hahmlet", Georgia, serif; font-size: 26px; margin: 2px 0 2px; } .pdf-sheet h2 { font-size: 16px; margin: 20px 0 8px; padding-bottom: 5px; border-bottom: 2px solid #1b2340; color: #1b2340; }
  .p-brand { font-size: 11.5px; color: #8a6d00; font-weight: 700; } .p-sub { color: #5e6680; font-size: 12.5px; }
  .p-summary { background: #f6f7fa; border-radius: 8px; padding: 8px 12px; margin-top: 10px; }
  .p-row { display: grid; grid-template-columns: 26px 1fr; gap: 8px; padding: 8px 0; border-bottom: 1px dashed #e2e5ee; page-break-inside: avoid; }
  .p-row > div:only-child { grid-column: 1 / -1; }
  .p-num { font-weight: 700; color: #2f4bd8; }
  .p-old { color: #5e6680; text-decoration: line-through; } .p-new { font-family: "Hahmlet", Georgia, serif; font-weight: 600; font-size: 15.5px; } .p-why { color: #5e6680; font-size: 12.5px; }
  .p-read { color: #b26a12; font-size: 12.5px; } .p-frame { font-weight: 600; font-size: 15.5px; color: #1b2340; background: linear-gradient(transparent 55%, #fff1a8 55%); justify-self: start; } .p-ex { padding-left: 6px; font-family: "Hahmlet", Georgia, serif; }
  .p-label { font-size: 11.5px; color: #8a94a3; margin-top: 4px; } .p-q { font-weight: 600; }
  .p-lines { display: grid; gap: 0; } .p-line { height: 27px; border-bottom: 1px solid #cbd1df; }
  .p-script { display: grid; grid-template-columns: 54px 1fr; gap: 8px; padding: 5px 0; page-break-inside: avoid; font-family: "Hahmlet", Georgia, serif; } .p-script.me { color: #2f4bd8; }
  .p-script .p-why { font-family: "IBM Plex Sans KR", sans-serif; }
  .p-who { font-size: 11.5px; font-weight: 700; color: #8a94a3; padding-top: 2px; font-family: "IBM Plex Sans KR", sans-serif; }
  .p-break { page-break-before: always; height: 0; }
  .p-ans { font-size: 12.5px; padding: 2px 0; }
  .p-table { width: 100%; border-collapse: collapse; } .p-table th, .p-table td { border: 1px solid #cbd1df; padding: 6px 7px; text-align: left; vertical-align: middle; }
  .p-table th { background: #f0f2f7; font-size: 12px; } .p-vi { font-weight: 700; } .p-write { width: 28%; height: 34px; }
  `;
  document.head.append(h("style", { text: css }));

  // ---------- boot ----------
  tab = getTab(TP.getLang());
  refreshHome();
  cloudLoad();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) cloudLoad(); });
})();
