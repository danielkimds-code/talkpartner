// TalkPartner study module: study notes, cloud sync, spaced-repetition review,
// pattern drill, script rehearsal, Vietnamese beginner course, PDF export.
(() => {
  const TP = window.TP;
  if (!TP) return;
  const COURSE = window.VI_COURSE || [];
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
  const LKEY = "tp_state_v1";
  const blank = () => ({ v: 1, updatedAt: 0, notes: [], cards: [], vi: { done: {} } });
  let S = (() => { try { return Object.assign(blank(), JSON.parse(localStorage.getItem(LKEY) || "null") || {}); } catch { return blank(); } })();
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
    try { localStorage.setItem(LKEY, JSON.stringify(S)); } catch {}
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
        S = Object.assign(blank(), remote);
        try { localStorage.setItem(LKEY, JSON.stringify(S)); } catch {}
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
  TP.makeNote = ({ lang, level, scene, d, turns }) => {
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
    S.notes.unshift(note); S.notes = S.notes.slice(0, 200);
    persist();
    return note;
  };

  // ---------- home tabs ----------
  const TABS = {
    en: [["talk", "💬 대화 연습"], ["review", "🔁 복습"], ["notes", "📒 내 노트"]],
    vi: [["course", "🌱 기초 코스"], ["review", "🔁 복습"], ["talk", "💬 회화 (중급)"]],
  };
  let tab = null;
  const getTab = (lang) => { try { return localStorage.getItem("tp_tab_" + lang) || (lang === "vi" ? "course" : "talk"); } catch { return lang === "vi" ? "course" : "talk"; } };
  function setTab(t) { const lang = TP.getLang(); tab = t; try { localStorage.setItem("tp_tab_" + lang, t); } catch {} refreshHome(); }

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
    if (lang === "vi" && tab === "course") { $("setupTitle").textContent = "Xin chào! 베트남어 첫걸음"; lead.textContent = "글자를 못 읽어도 괜찮아요. 소리를 듣고 → 따라 하고 → 뜻을 고르면서 단어부터 익혀요. 큰 글씨는 한글 발음, 화살표는 성조(말의 높낮이)예요."; }
    if (tab === "review") lead.textContent = "틀린 문장과 배운 표현이 1 · 3 · 7 · 14 · 30일 간격으로 다시 나와요. 맞히면 간격이 늘고, 틀리면 바로 다시 나와요.";
    if (tab === "notes") lead.textContent = "대화가 끝날 때마다 교정 노트가 저장돼요. 다시 보기, 대본 리허설, 굿노트용 PDF를 여기서 할 수 있어요.";
    if (!talkMode) rc(panel, tab === "course" ? coursePanel() : tab === "review" ? reviewPanel(lang) : notesPanel(lang));
  }
  TP.onRenderSetup = refreshHome;
  TP.onLang = () => { tab = getTab(TP.getLang()); refreshHome(); };
  TP.onHome = () => { stopAll(); };
  TP.onLogin = () => { cloudLoad(); refreshHome(); };

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
    const onResult = (said) => {
      if (answered) return;
      const r = check(card.alt || card.t, said, lang);
      rc(res, h("div", { class: r.pass ? "verdict ok" : "verdict bad", text: r.pass ? "좋아요! 맞았어요" : "조금 달라요" }),
        h("div", { class: "note", text: "내가 말한 것: " + said }), h("div", { class: "note", text: "정답:" }), diffView(r),
        card.read ? readBlock(card.t, card.read, false) : null,
        h("div", { class: "fb-actions" },
          h("button", { class: "mini", text: "▶ 정답 듣기", onclick: () => say(card.t, lang) }),
          r.pass ? null : h("button", { class: "mini", text: "맞은 걸로 할게요", onclick: () => { answered = true; done(true); } }),
          r.pass ? null : h("button", { class: "ghost sm", text: "다음", onclick: () => { answered = true; done(false); } })));
      say(card.t, lang);
      if (r.pass) { answered = true; done(true); }
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

  // ---------- script rehearsal ----------
  const LEVELS = [["see", "보면서"], ["first", "첫 단어만"], ["blind", "안 보고"]];
  TP.openRehearsal = (n) => {
    let lvl = (n.rehearsal && n.rehearsal.next) || "see";
    const lang = n.lang, female = (TP.LOOK[n.sceneId] || {}).female;
    const seg = h("div", { class: "levels" });
    const lines = h("div", { class: "script rh" });
    const status = h("div", { class: "note" });
    const ctrl = h("div", { class: "fb-actions" });
    const sv = openStudy(`대본 리허설 · ${n.sceneTitle}`,
      h("p", { class: "note", text: `${n.partner || "상대"}의 대사는 소리로 읽어 드려요. 「나」 차례가 오면 외운 문장을 말하세요.` }), seg, lines, status, ctrl);
    function drawSeg() { rc(seg, ...LEVELS.map(([k, t]) => h("button", { class: "seg", "aria-pressed": String(k === lvl), text: t, onclick: () => { lvl = k; drawSeg(); draw(-1); } }))); }
    function cue(t) { const w = t.split(/\s+/); return lvl === "see" ? t : lvl === "first" ? w[0] + " " + w.slice(1).map(x => "＿".repeat(Math.min(4, Math.max(2, x.length / 2)))).join(" ") : "🎤 내 차례"; }
    const marks = {};
    function draw(cur) {
      rc(lines, ...n.script.map((l, i) => h("div", { class: "sl " + l.who + (i === cur ? " cur" : "") + (marks[i] ? " " + marks[i] : "") },
        h("span", { class: "who", text: l.who === "me" ? "나" : (n.partner || "상대") }),
        h("div", {}, h("div", { class: "st", text: l.who === "partner" ? l.t : (marks[i] ? l.t : cue(l.t)) }), (l.ko && (l.who === "partner" || lvl !== "see")) ? h("div", { class: "sk", text: l.ko }) : null))));
      const c = lines.children[cur]; if (c) c.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    async function run() {
      const myRun = ++stopFlag; let passed = 0, mine = 0;
      for (const k of Object.keys(marks)) delete marks[k];
      rc(ctrl, h("button", { class: "ghost", text: "그만하기", onclick: () => { stopAll(); finish(true); } }));
      for (let i = 0; i < n.script.length; i++) {
        if (myRun !== stopFlag) return;
        const l = n.script[i]; draw(i);
        if (l.who === "partner") { status.textContent = `${n.partner || "상대"}가 말하는 중…`; await say(l.t, lang, { female }); await new Promise(r => setTimeout(r, 250)); continue; }
        mine++;
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          if (myRun !== stopFlag) return;
          status.textContent = attempt ? "한 번 더 말해 보세요 (2/2)" : "내 차례 · 말해 보세요";
          let said = "";
          try { said = await TP.listenOnce({ lang, onInterim: (t) => { status.textContent = "듣는 중: " + t; } }); }
          catch { status.textContent = "마이크를 쓸 수 없어요. 리허설은 음성 인식이 필요해요."; return; }
          if (myRun !== stopFlag) return;
          const r = check(l.t, said, lang);
          ok = r.pass;
          status.textContent = ok ? `좋아요! (${Math.round(r.score * 100)}%)` : `「${said || "…"}」 → 정답과 ${Math.round((r.score || 0) * 100)}% 일치`;
          if (!ok && attempt === 0) await say(l.t, lang);
        }
        marks[i] = ok ? "pass" : "fail"; if (ok) passed++;
        draw(i);
        if (!ok) await say(l.t, lang);
        await new Promise(r => setTimeout(r, 400));
      }
      finish(false, passed, mine);
    }
    function finish(stopped, passed = 0, mine = 0) {
      const pct = mine ? Math.round(100 * passed / mine) : 0;
      if (!stopped) {
        n.rehearsal = n.rehearsal || {};
        n.rehearsal.best = Math.max(n.rehearsal.best || 0, pct);
        if (pct >= 80) n.rehearsal.next = lvl === "see" ? "first" : "blind";
        persist();
      }
      status.textContent = stopped ? "멈췄어요." : `내 대사 ${passed}/${mine} 통과 (${pct}%)` + (pct >= 80 ? (lvl === "blind" ? " · 다 외웠어요! 실전 대화로 가 보세요." : " · 다음엔 한 단계 어렵게 해 보세요.") : " · 틀린 줄을 한 번 더 들어 보세요.");
      rc(ctrl, 
        h("button", { class: "primary", text: "다시 리허설", onclick: run }),
        pct >= 80 && lvl !== "blind" ? h("button", { class: "ghost", text: "한 단계 어렵게", onclick: () => { lvl = lvl === "see" ? "first" : "blind"; drawSeg(); draw(-1); run(); } }) : null,
        h("button", { class: "ghost", text: "같은 상황 실전 대화", onclick: () => TP.startScene(n.sceneId) }),
        h("button", { class: "ghost", text: "처음으로", onclick: backHome }));
    }
    drawSeg(); draw(-1);
    rc(ctrl, h("button", { class: "primary", text: "리허설 시작", onclick: run }), h("button", { class: "ghost", text: "처음으로", onclick: backHome }));
    return sv;
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
          idx > 0 ? h("button", { class: "ghost", text: "← 이전", onclick: () => { idx--; learn(); } }) : null,
          h("button", { class: "primary", text: idx < items.length - 1 ? "다음 →" : "퀴즈로 →", onclick: () => { if (idx < items.length - 1) { idx++; learn(); } else { phase = 1; startListen(); } } })));
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
      const nextBtn = h("button", { class: "primary", text: q.length ? "다음 →" : "끝내기", onclick: speakStep });
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
  .hometabs { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .htab { border: 1px solid var(--line); background: var(--surface); border-radius: 12px; padding: 11px 18px; font-weight: 600; font-size: 16px; display: inline-flex; gap: 8px; align-items: center; }
  .htab[aria-selected="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
  .htab .count { background: var(--bad); color: #fff; border-radius: 99px; font-size: 12.5px; padding: 1px 8px; font-family: var(--font-mono); }
  .sync { margin-left: auto; font-size: 13px; color: var(--muted); }
  .sync.ok { color: var(--good); } .sync.warn { color: var(--signal); }
  .homepanel { display: grid; gap: 16px; }
  .panel-card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 22px; display: grid; gap: 14px; justify-items: start; }
  .big-num b { font-family: var(--font-display); font-size: 44px; line-height: 1; color: var(--accent); }
  .big-num span { font-size: 18px; color: var(--muted); }
  .ghost.sm, .primary.sm { padding: 9px 14px; font-size: 14.5px; border-radius: 10px; }
  a.ghost { text-decoration: none; color: var(--ink); display: inline-block; }
  .study { padding-block: 22px 60px; display: grid; gap: 18px; }
  .study-head h2 { font-family: var(--font-display); margin: 0; font-size: 26px; }
  .progress { height: 6px; background: var(--line); border-radius: 99px; overflow: hidden; }
  .progress i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
  .qcard { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 22px; display: grid; gap: 14px; }
  .qcard.center, .center { justify-items: center; text-align: center; justify-content: center; }
  .q-ko { font-size: 22px; font-weight: 600; }
  .q-ko.big { font-size: 28px; }
  .q-target { font-size: 20px; font-weight: 600; }
  .q-hint { background: var(--accent-soft); border-radius: 12px; padding: 12px 14px; display: grid; gap: 6px; }
  .frame { background: var(--signal-soft); color: var(--ink); border-radius: 12px; padding: 10px 14px; font-size: 15.5px; }
  .frame b { color: var(--signal); font-size: 17px; }
  .verdict { font-weight: 700; font-size: 18px; } .verdict.ok { color: var(--good); } .verdict.bad { color: var(--bad); }
  .diff { font-size: 19px; line-height: 1.6; } .diff .ok { color: var(--good); } .diff .miss { color: var(--bad); text-decoration: underline wavy; text-underline-offset: 4px; }
  .mic-area { display: grid; gap: 8px; justify-items: center; width: 100%; }
  .mic-row { display: flex; gap: 10px; align-items: center; }
  .mic-btn { background: var(--accent); color: #fff; border: 0; border-radius: 99px; padding: 15px 28px; font-weight: 700; font-size: 17px; }
  .mic-btn.on { background: var(--good); }
  .live { min-height: 1.4em; color: var(--muted); font-size: 16px; }
  .typed { display: flex; gap: 8px; width: 100%; max-width: 520px; }
  .typed input { flex: 1; min-width: 0; font: inherit; font-size: 17px; padding: 11px 13px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--ink); }
  .play-big { width: 96px; height: 96px; border-radius: 50%; border: 0; background: var(--accent-soft); font-size: 40px; }
  .choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 10px; width: 100%; }
  .choice { border: 1.5px solid var(--line); background: var(--surface); border-radius: 14px; padding: 16px; font-size: 18px; font-weight: 600; }
  .choice.ok { border-color: var(--good); background: var(--good-soft); color: var(--good); }
  .choice.bad { border-color: var(--bad); background: var(--bad-soft); color: var(--bad); }
  .syl-row { display: flex; flex-wrap: wrap; gap: 6px 14px; justify-content: center; }
  .syl { display: grid; justify-items: center; gap: 0; }
  .syl b { font-size: 22px; } .syl i { font-style: normal; color: var(--signal); font-size: 16px; font-weight: 700; } .syl small { color: var(--muted); font-size: 13px; }
  .syl-row.big .syl b { font-size: 40px; line-height: 1.15; } .syl-row.big .syl i { font-size: 22px; } .syl-row.big .syl small { font-size: 16px; }
  .steps { display: flex; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
  .steps span { padding: 4px 10px; border-radius: 99px; background: var(--line); color: var(--muted); }
  .steps .on { background: var(--accent); color: #fff; } .steps .done { background: var(--good-soft); color: var(--good); }
  .course { display: grid; gap: 14px; }
  .lessons { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); gap: 12px; }
  .lesson { border: 1px solid var(--line); background: var(--surface); border-radius: 16px; padding: 16px; text-align: left; display: grid; gap: 4px; }
  .lesson .li { font-size: 28px; } .lesson b { font-size: 17px; } .lesson small { color: var(--muted); font-size: 13.5px; }
  .lesson.done { border-color: var(--good); background: var(--good-soft); }
  .note-list { display: grid; gap: 12px; }
  .note-item { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; display: grid; gap: 6px; }
  .ni-top { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .mini.left { text-align: left; }
  .script { display: grid; gap: 8px; }
  .sl { display: grid; grid-template-columns: 64px 1fr; gap: 10px; padding: 10px 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); }
  .sl.me { background: var(--accent-soft); }
  .sl .who { font-size: 12.5px; font-weight: 700; color: var(--muted); padding-top: 3px; }
  .sl .st { font-size: 17px; } .sl .sk { font-size: 14px; color: var(--muted); }
  .sl.cur { outline: 2.5px solid var(--accent); } .sl.pass { border-color: var(--good); } .sl.pass .who { color: var(--good); } .sl.fail { border-color: var(--bad); } .sl.fail .who { color: var(--bad); }
  .pdf-modal { position: fixed; inset: 0; z-index: 60; background: rgba(10,14,20,.45); display: grid; place-items: center; padding: 20px; }
  .pm-card { background: var(--surface); color: var(--ink); border-radius: 18px; padding: 22px; max-width: 440px; width: 100%; display: grid; gap: 12px; }
  .pdf-host { position: fixed; left: -12000px; top: 0; }
  .pdf-sheet { width: 720px; background: #fff; color: #17202e; font-family: "IBM Plex Sans KR", "Apple SD Gothic Neo", sans-serif; font-size: 13.5px; line-height: 1.55; padding: 4px 6px; }
  .pdf-sheet h1 { font-size: 24px; margin: 2px 0 2px; } .pdf-sheet h2 { font-size: 16px; margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #1e56c8; color: #1e56c8; }
  .p-brand { font-size: 11px; letter-spacing: .1em; color: #c7781a; font-weight: 700; text-transform: uppercase; } .p-sub { color: #5b6676; font-size: 12.5px; }
  .p-summary { background: #f3f5f8; border-radius: 8px; padding: 8px 12px; margin-top: 10px; }
  .p-row { display: grid; grid-template-columns: 26px 1fr; gap: 8px; padding: 8px 0; border-bottom: 1px dashed #dce2ea; page-break-inside: avoid; }
  .p-row > div:only-child { grid-column: 1 / -1; }
  .p-num { font-weight: 700; color: #1e56c8; }
  .p-old { color: #5b6676; text-decoration: line-through; } .p-new { font-weight: 600; font-size: 15px; } .p-why { color: #5b6676; font-size: 12.5px; }
  .p-read { color: #c7781a; font-size: 12.5px; } .p-frame { font-weight: 600; font-size: 15.5px; color: #c7781a; } .p-ex { padding-left: 6px; }
  .p-label { font-size: 11.5px; color: #8a94a3; margin-top: 4px; } .p-q { font-weight: 600; }
  .p-lines { display: grid; gap: 0; } .p-line { height: 26px; border-bottom: 1px solid #c9d1dc; }
  .p-script { display: grid; grid-template-columns: 54px 1fr; gap: 8px; padding: 5px 0; page-break-inside: avoid; } .p-script.me { color: #1e56c8; }
  .p-who { font-size: 11.5px; font-weight: 700; color: #8a94a3; padding-top: 2px; }
  .p-break { page-break-before: always; height: 0; }
  .p-ans { font-size: 12.5px; padding: 2px 0; }
  .p-table { width: 100%; border-collapse: collapse; } .p-table th, .p-table td { border: 1px solid #c9d1dc; padding: 6px 7px; text-align: left; vertical-align: middle; }
  .p-table th { background: #eef2f8; font-size: 12px; } .p-vi { font-weight: 700; } .p-write { width: 28%; height: 34px; }
  `;
  document.head.append(h("style", { text: css }));

  // ---------- boot ----------
  tab = getTab(TP.getLang());
  refreshHome();
  cloudLoad();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) cloudLoad(); });
})();
