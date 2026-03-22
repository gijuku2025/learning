


const app = document.getElementById("app");
const SUBJECT = "kanji"; // change to "geometry" or "civics" in other copies
const SUBJECT_LABEL = SUBJECT.charAt(0).toUpperCase() + SUBJECT.slice(1);

const CHAPTER_FILES = [
 "chapter1","chapter2","chapter3","chapter4","chapter5","chapter6","chapter7","chapter8","chapter9","chapter10",
 "chapter11","chapter12","chapter13","chapter14","chapter15","chapter16","chapter17","chapter18","chapter19","chapter20",
 "chapter21","chapter22","chapter23","chapter24","chapter25","chapter26","chapter27","chapter28","chapter29","chapter30",
 "chapter31","chapter32","chapter33","chapter34","chapter35","chapter36","chapter37","chapter38","chapter39","chapter40"
];

const MAX_NEW_PER_DAY = 10;
const MAX_ITEMS_PER_SESSION = 20;
const REQUIRED_STREAK = 5;
const MASTERY_INTERVAL = 30; // days
const RARE_REVIEW_INTERVAL = 60; // days

let sessionCount = 0;
let failedThisSession = new Set();
let sessionStartTime = null;


let state = {
  nickname: localStorage.getItem("nickname"),
  activeChapters: JSON.parse(localStorage.getItem(SUBJECT + "_activeChapters") || "[]"),
progress: JSON.parse(localStorage.getItem(SUBJECT + "_progress") || "{}"),
todayNewCount: Number(localStorage.getItem(SUBJECT + "_todayNewCount") || 0),

  stats: { correct: 0, wrong: 0, new: 0, review: 0 }
};

let kanjiList = [];
let newQueue = [];
let learningQueue = [];
let reviewQueue = [];
let current = null;
let direction = null;
let recentItems = [];
let recentTypes = [];
const RECENT_LIMIT = 3;
let errorQueue = [];
let reviewingErrors = false;




/* ================= STORAGE ================= */

function save() {
  localStorage.setItem("nickname", state.nickname);
  localStorage.setItem(SUBJECT + "_activeChapters", JSON.stringify(state.activeChapters));
localStorage.setItem(SUBJECT + "_progress", JSON.stringify(state.progress));
localStorage.setItem(SUBJECT + "_todayNewCount", state.todayNewCount);
}

function todayString() {
  return new Date().toISOString().slice(0,10);
}

function resetDailyCountIfNeeded() {
  const last = localStorage.getItem(SUBJECT + "_lastStudyDate");
  const today = todayString();

  if (last !== today) {
    state.todayNewCount = 0;
    localStorage.setItem(SUBJECT + "_lastStudyDate", today);
  }
}

/* ================= UI ================= */

function showNicknameScreen() {
  app.innerHTML = `
    <div class="center">
      <div class="card">
        <h1 class="heading">Smart Review</h1>
        <p>Enter your name to begin:</p>
        <input id="nickInput" placeholder="Nickname">
        <br><br>
        <button onclick="setNickname()">Continue</button>
      </div>
    </div>
  `;
}


function setNickname() {
  const val = document.getElementById("nickInput").value.trim();
  if (!val) return;
  state.nickname = val;
  save();
  showChapterScreen();
}

function showChapterScreen() {
  let html = `
    <div class="center">
    <div class="chapter-card">
        <h2 class="heading">Welcome to Smart Review, ${state.nickname}</h2>
      <h2 class="heading">${SUBJECT_LABEL}</h2>   
       

        <div class="chapter-grid">
  `;

  CHAPTER_FILES.forEach((ch,i)=>{
    const selected = state.activeChapters.includes(ch) ? "selected":"";
    html += `<div class="chapter-tile ${selected}" onclick="toggleChapter('${ch}',this)">${i+1}</div>`;
  });

  html += `
        </div>
        <button onclick="startStudy()">Start Study</button>
      </div>
    </div>
  `;

  app.innerHTML = html;
}



 

function toggleChapter(ch, el) {
  if (state.activeChapters.includes(ch)) {
    state.activeChapters = state.activeChapters.filter(c=>c!==ch);
    el.classList.remove("selected");
  } else {
    state.activeChapters.push(ch);
    el.classList.add("selected");
  }
  save();
}

/* ================= LOAD ================= */

async function loadKanji() {
  kanjiList = [];
  for (let ch of state.activeChapters) {
    try {
      const res = await fetch("data/" + ch + ".json");
      if (!res.ok) throw new Error("Missing " + ch);
      const data = await res.json();

// ensure every kanji has a stable id
data.forEach(item => {

  item.meaning = item.meaning || [];
  item.onyomi = item.onyomi || [];
  item.kunyomi = item.kunyomi || [];
  item.vocab = item.vocab || [];

  // AUTO-CONVERT "reading" → onyomi / kunyomi
  if (item.reading && !item.onyomi.length && !item.kunyomi.length) {
    item.onyomi = item.reading.filter(r => /[ァ-ン]/.test(r));
    item.kunyomi = item.reading.filter(r => /[ぁ-ん]/.test(r));
    delete item.reading;
  }

  if (item.vocab && item.vocab.length) {
  shuffle(item.vocab);
  item.vocabIndex = 0;
}

  // support both "word" and "kanji"
  if (!item.kanji && item.word) {
    item.kanji = item.word;
  }

  if (!item.id) {
    item.id = ch + "_" + item.kanji;
  }

});

kanjiList = kanjiList.concat(data);
    } catch (e) {
      console.error("Failed to load:", ch, e);
      alert("Could not load " + ch + ".json");
    }
  }
}


/* ================= SRS CORE ================= */

async function startStudy() {
  if (state.activeChapters.length===0) return alert("Select at least one chapter.");
  resetDailyCountIfNeeded();
  sessionStartTime = Date.now();
sessionCount = 0;
failedThisSession = new Set();
errorQueue = [];
reviewingErrors = false;
  state.stats = { correct: 0, wrong: 0, new: 0, review: 0 };
  await loadKanji();
  buildQueues();
  nextQuestion();
}

function buildQueues() {
  newQueue = [];
  learningQueue = [];
  reviewQueue = [];
  const now = Date.now();

  for (let item of kanjiList) {
    let p = state.progress[item.id];

    if (!p && state.todayNewCount < MAX_NEW_PER_DAY) {
  newQueue.push(item);
} 
    else if (p && now >= p.nextReview) {
  if (p.status === "learning") {
    learningQueue.push(item);
  } else if (p.status === "mastered") {
    reviewQueue.push(item); // rare reviews only
  } else {
    reviewQueue.push(item);
  }
}

  }

  shuffle(newQueue);
  shuffle(learningQueue);
  shuffle(reviewQueue);
		
  save();	
}


function renderProgress() {
  const currentNum = sessionCount;
  const total = MAX_ITEMS_PER_SESSION;
  const percent = Math.min((sessionCount / total) * 100, 100);

  return `
    <div class="progress-text">
      Question ${currentNum} / ${total}
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${percent}%"></div>
    </div>
  `;
		
		
		
}



function nextQuestion() {
  if (sessionCount >= MAX_ITEMS_PER_SESSION) {

  if (!reviewingErrors && errorQueue.length) {

    reviewingErrors = true;

    app.innerHTML = `
      <div class="center">
        <div class="card">
          <h2>Review Your Mistakes</h2>
          <p>Let's retry the questions you missed.</p>
          <button onclick="startErrorReview()">Start</button>
        </div>
      </div>
    `;

    return;

  } else {
    return showResults();
  }

}
  if (!reviewQueue.length && !learningQueue.length && !newQueue.length) return showResults();

  

let typeAttempts = 0;
let type;

do {

  if (learningQueue.length) current = learningQueue.shift();
  else if (reviewQueue.length) current = reviewQueue.shift();
  else if (newQueue.length) current = newQueue.shift();
  else break;

  const types = ["meaning","meaning","reading","reading"];

if ((current.onyomi && current.onyomi.length) || (current.kunyomi && current.kunyomi.length)) {
  types.push("reading");
}
  if (Array.isArray(current.vocab) && current.vocab.length) {
    types.push("vocabMeaning");
    if (current.vocab.some(v => v.reading && v.reading.length)) {
      types.push("vocabReading");
    }
  }

  type = types[Math.floor(Math.random() * types.length)];

  typeAttempts++;

} while (
  typeAttempts < 10 &&
  recentItems.includes(current.id) &&
  recentTypes.includes(type)
);

current.questionType = type;
if (!current || !(current.kanji || current.word)) {
  console.warn("Invalid item skipped:", current);
  return nextQuestion();
}				   
				   

if (!current) return showResults();



 

  let prompt = "";
  let label = "";
  

recentItems.push(current.id);
recentTypes.push(type);

if (recentItems.length > RECENT_LIMIT) {
  recentItems.shift();
  recentTypes.shift();
}

  if (type === "meaning") {
    prompt = current.kanji || current.word || "⚠️";
    label = "Type the English meaning:";
  }

  if (type === "reading") {
  prompt = current.kanji || current.word || "⚠️";
  label = "Type any reading (hiragana or katakana). You can enter multiple:";
}

  

  if (type === "vocabMeaning" && current.vocab && current.vocab.length) {
  if (!current.vocabPool || current.vocabPool.length === 0) {
  current.vocabPool = [...current.vocab];
  shuffle(current.vocabPool);
}

const v = current.vocabPool.pop();
current.activeVocab = v;
  prompt = v.word || current.kanji || "";
  label = "Type the meaning:";
}
		
	if (type === "vocabReading" && current.vocab && current.vocab.length) {
  if (!current.vocabPool || current.vocabPool.length === 0) {
  current.vocabPool = [...current.vocab];
  shuffle(current.vocabPool);
}

const v = current.vocabPool.pop();
current.activeVocab = v;
  prompt = v.word || current.kanji || "";
  label = "Type the reading (hiragana):";
}	

  app.innerHTML = `
  <div class="center">
    <div class="card">
      ${renderProgress()}
      <div class="word">${prompt}</div>
      <div class="prompt-label">${label}</div>
      <input id="answer" class="answer-input" autofocus
             onkeydown="if(event.key==='Enter') submitAnswer()">
      <div class="bottom-area center">
  <button onclick="submitAnswer()">Submit</button>
</div>
    </div>
  </div>
  `;
}

		
function startErrorReview() {
  learningQueue = [...errorQueue];
  errorQueue = [];
  sessionCount = 0;
  nextQuestion();
}
		
		
		
/* ================= CHECKING ================= */

function normalizeJP(str) {
  return str.replace(/[\u30a1-\u30f6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0)-0x60)
  );
}

function levenshtein(a,b){
  const dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++)dp[i][0]=i;
  for(let j=0;j<=b.length;j++)dp[0][j]=j;
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      dp[i][j]=Math.min(
        dp[i-1][j]+1,
        dp[i][j-1]+1,
        dp[i-1][j-1]+(a[i-1]==b[j-1]?0:1)
      );
    }
  }
  return dp[a.length][b.length];
}

function submitAnswer() {
  const input = document.getElementById("answer")
  .value
  .trim()
  .toLowerCase()
  .replace(/^to\s+/, "");
  let correct = false;

  if (current.questionType === "meaning") {
  const answers = Array.isArray(current.meaning)
    ? current.meaning
    : [current.meaning];

  correct = answers.some(m => {
    const target = String(m).toLowerCase().replace(/^an?\s+/, "");
    return input === target || levenshtein(input, target) <= 1;
  });
}
  
else if (current.questionType === "reading") {
  const normalizedInput = normalizeJP(input);

  // split multiple answers
  const inputs = normalizedInput.split(/[\s,]+/).filter(Boolean);

if (inputs.length === 0) {
  correct = false;
  current._readingFeedback = {
    correctInputs: [],
    wrongInputs: [],
    allReadings: [
      ...(current.onyomi || []),
      ...(current.kunyomi || [])
    ]
  };
  return;
}

  const allReadings = [
    ...(current.onyomi || []),
    ...(current.kunyomi || [])
  ].map(r => normalizeJP(r));

  const correctInputs = inputs.filter(ans => allReadings.includes(ans));
  const wrongInputs = inputs.filter(ans => !allReadings.includes(ans));

  // at least one correct = pass
  correct = correctInputs.length > 0;

  // store for feedback display
  current._readingFeedback = {
    correctInputs,
    wrongInputs,
    allReadings
  };
}

else if (current.questionType === "vocabMeaning") {
  const meanings = Array.isArray(current.activeVocab.meaning)
    ? current.activeVocab.meaning
    : [current.activeVocab.meaning];

  correct = meanings.some(m => {
    const target = m.toLowerCase().trim().replace(/^an?\s+/, "");
    return input === target || levenshtein(input, target) <= 1;
  });
}

else if (current.questionType === "vocabReading") {
  const normalizedInput = normalizeJP(input);

  const readings = current.activeVocab.reading
    ? (Array.isArray(current.activeVocab.reading)
        ? current.activeVocab.reading
        : [current.activeVocab.reading])
    : [];

  correct = readings.length && readings.some(r => normalizeJP(r) === normalizedInput);
}
  

  sessionCount++;

  if (!correct) {

  state.stats.wrong++;

  if (!errorQueue.includes(current)) {
    errorQueue.push(current);
  }

  updateProgress("again");
  showSimpleFeedback(false);
  return;
}

  state.stats.correct++;
  updateProgress("good"); // automatic grading
  showSimpleFeedback(true);
}







function gradeAnswer(grade) {
  updateProgress(grade);
  nextQuestion();
}




function updateProgress(grade) {
  let p = state.progress[current.id];

  if (!p) {

  state.todayNewCount++;
    p = {
      status:"learning",
      interval:1,
      ease:2.3,
      streak:0,
      mastered:false,
      nextReview:Date.now(),
      totalCorrect: 0,
      masteredInterval: RARE_REVIEW_INTERVAL,
      lapses: 0 

    };
    state.progress[current.id]=p;
    state.stats.new++;
    
  } else {
    state.stats.review++;
  }

 if (grade === "again") {
  p.lapses = (p.lapses || 0) + 1;

  p.streak = 0;
  p.interval = 1;
  p.status = "learning";

  if (p.mastered) {
    p.mastered = false;
    p.masteredInterval = RARE_REVIEW_INTERVAL;
  }

  // stronger ease penalty based on lapse history
  p.ease = Math.max(1.35, p.ease - 0.25 - (p.lapses * 0.04));

  

  if (!failedThisSession.has(current.id)) {
    failedThisSession.add(current.id);
    learningQueue.push(current);
  }

  save();
  return;
}




  if (grade === "hard") {
    p.streak = Math.max(0, p.streak - 1);
    p.interval = Math.max(1, Math.round(p.interval * 0.8));
    p.ease = Math.max(1.5, p.ease - 0.15);
    
  }

  if (grade === "good") {
  p.streak++;
  p.totalCorrect++;

  if (p.interval < 2) {
    p.interval = 2;
  } else if (p.interval < 7) {
    p.interval = Math.round(p.interval * 1.8);
  } else {
    p.interval = Math.round(p.interval * p.ease);
  }

  p.ease = Math.min(p.ease + 0.08, 2.8);
}

  if (grade === "easy") {
  p.streak += 2;
  p.totalCorrect++;

  if (p.interval < 3) {
    p.interval = 4;
  } else {
    p.interval = Math.round(p.interval * p.ease * 1.25);
  }

  p.ease = Math.min(p.ease + 0.12, 2.8);
}

  if (p.streak >= REQUIRED_STREAK && p.interval >= MASTERY_INTERVAL) {
    p.mastered = true;
    p.status = "mastered";
  } else if (p.interval >= 3) {
    p.status = "review";
  } else {
    p.status = "learning";
  }

  if (p.mastered) {
    p.masteredInterval = Math.min(
      Math.round(p.masteredInterval * 1.4),
      365
    );
    p.nextReview = Date.now() + p.masteredInterval * 86400000;
  } else {
    p.nextReview = Date.now() + p.interval * 86400000;
  }

  save();
}


/* ================= MASTERY BAR ================= */


function masterySegments(p) {
  const total = REQUIRED_STREAK;

  // cap bar until actually mastered
  const filled = p.mastered
    ? total
    : Math.min(p.streak, total - 1);

  let html = "";
  for (let i = 0; i < total; i++) {
    if (i < filled) {
      html += `<span class="mastery-seg filled"></span>`;
    } else {
      html += `<span class="mastery-seg"></span>`;
    }
  }
  return html;
}




/* ================= FEEDBACK ================= */

function showSimpleFeedback(isCorrect) {
  const p = state.progress[current.id] || { streak: 0, mastered: false };
  const bars = masterySegments(p);

  app.innerHTML = `
    <div class="center">
      <div class="card">

        <h3 class="feedback-title ${isCorrect ? "correct" : "incorrect"}">
          ${isCorrect ? "✔ Correct!" : "✘ Incorrect"}
        </h3>

       <div class="feedback-word">
  ${
    current.questionType === "meaning"
      ? `${current.kanji} – ${Array.isArray(current.meaning) ? current.meaning.join(", ") : current.meaning}`

    : current.questionType === "reading"
      ? (() => {
          const fb = current._readingFeedback || {};
          const all = fb.allReadings || [
            ...(current.onyomi || []),
            ...(current.kunyomi || [])
          ];

          let text = `${current.kanji} – Readings: ${all.join(", ")}`;

          if (fb.correctInputs?.length) {
            text += `<br><span class="correct">✔ You got: ${fb.correctInputs.join(", ")}</span>`;
          }

          if (fb.wrongInputs?.length) {
            text += `<br><span class="incorrect">✘ Not correct: ${fb.wrongInputs.join(", ")}</span>`;
          }

          // ✅ THIS IS YOUR NEW "missing" PART
          const missing = all.filter(r => {
  const normalized = normalizeJP(r);
  return !(fb.correctInputs || []).includes(normalized);
});

          if (missing.length) {
            text += `<br><span style="color:#2563eb;">Missing: ${missing.join(", ")}</span>`;
          }

          return text;
        })()

    : current.questionType === "vocabMeaning"
      ? `${current.activeVocab.word || current.kanji} – ${Array.isArray(current.activeVocab.meaning) ? current.activeVocab.meaning.join(", ") : current.activeVocab.meaning}`

    : current.questionType === "vocabReading"
      ? `${current.activeVocab.word || current.kanji} – ${Array.isArray(current.activeVocab.reading) ? current.activeVocab.reading.join(", ") : current.activeVocab.reading}`

    : ""
  }
</div>

	<div style="margin:10px 0;">
          <div>Mastery:</div>
          <div>
            ${bars} ${p.mastered ? "⭐ Mastered!" : ""}
          </div>
        </div>

        <button onclick="nextQuestion()">Continue</button>

      </div>
    </div>
  `;
}



/* ================= RESULTS ================= */

function showResults() {
  const now = new Date();
  const chapters = state.activeChapters.map(ch=>ch.replace("chapter","")).join(", ");

const elapsed = sessionStartTime ? Date.now() - sessionStartTime : 0;
const totalSeconds = Math.floor(elapsed / 1000);
const minutes = Math.floor(totalSeconds / 60);
const seconds = totalSeconds % 60;


  app.innerHTML = `
    <div class="center">
      <div class="card">

        <h2>Smart Review – Junior High ${SUBJECT_LABEL}</h2>
        
        <!-- student name stays centered -->
        <h3 style="text-align:center;">${state.nickname}</h3>

        <!-- results aligned left -->
        <div style="text-align:left; margin-top:15px;">
          <p>Date: ${now.toLocaleDateString()}</p>
          <p>Chapters studied: ${chapters}</p>

          <p>Total study time: ${minutes} min ${seconds} sec</p>

          <p>New: ${state.stats.new}</p>
          <p>Review: ${state.stats.review}</p>
          <p>Correct: ${state.stats.correct}</p>
          <p>Incorrect: ${state.stats.wrong}</p>

          <p>Accuracy: ${ (state.stats.correct + state.stats.wrong) ? Math.round((state.stats.correct / (state.stats.correct + state.stats.wrong)) * 100) : 0}%</p>
        </div>

        <p style="margin-top:15px;"><strong>Great work today!</strong></p>

      </div>
    </div>
  `;
}



/* ================= UTILS ================= */

function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}

/* ================= START ================= */

if (!state.nickname) showNicknameScreen();
else showChapterScreen();
