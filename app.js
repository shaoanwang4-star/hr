// 漫画站：邮箱登录 + 上传可编辑 + 水印防截图 + 弹幕
// 数据：Firestore manga/{id}（存 storage 路径，不存公开链接）
//      Firestore manga/{id}/dm/{cid}（弹幕）
//      Storage manga/{uid}/{mangaId}/{page}
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  deleteField, serverTimestamp, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAC0PCCyY5hL4lS3PYHZ0iMtsWPJqIV_wU",
  authDomain: "download-account-edc1b.firebaseapp.com",
  projectId: "download-account-edc1b",
  storageBucket: "download-account-edc1b.firebasestorage.app",
  messagingSenderId: "882882904924",
  appId: "1:882882904924:web:c6007e969fff5ac648b799",
  measurementId: "G-6BW960QBPR",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const st = getStorage(app);

const $ = (id) => document.getElementById(id);
const show = (name) => {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "view-" + name));
};

const S = { user: null, list: [], manga: null, id: null, page: 0, paths: [], pageOpenAt: 0, dmUnsub: null };

/* ---------- 水印：把当前账号烙进画面，外传可溯源 ---------- */
function paintMark() {
  const u = S.user;
  const tag = u ? `${u.email} · ${u.uid.slice(0, 6)} · ${new Date().toISOString().slice(0, 10)}` : "未登录";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='170'>
    <text x='10' y='90' fill='%23ffffff' font-size='15' font-family='sans-serif'
      transform='rotate(-24 150 85)' opacity='0.75'>${encodeURIComponent(tag)}</text></svg>`;
  $("mark").style.backgroundImage = `url("data:image/svg+xml,${svg.replace(/\s+/g, " ")})`;
  $("mark").style.backgroundRepeat = "repeat";
}

/* ---------- 防截图干扰：能挡的只有手滑，挡不了工具 ---------- */
document.addEventListener("contextmenu", e => e.preventDefault());          // 右键另存
document.addEventListener("dragstart", e => e.preventDefault());            // 拖出图片
document.addEventListener("keydown", e => {
  if (e.key === "s" && (e.ctrlKey || e.metaKey)) e.preventDefault();          // Ctrl+S
  if (e.key === "p" && (e.ctrlKey || e.metaKey)) e.preventDefault();          // Ctrl+P
  if (e.key === "PrintScreen") blackout(400);                                 // 系统截屏键，截图变全黑
});
document.addEventListener("visibilitychange", () => blackout(document.hidden ? 999999 : 0));
window.addEventListener("blur", () => blackout(1200));                        // 切窗口/唤起截图工具
function blackout(ms) {
  document.body.classList.add("blacked");
  clearTimeout(blackout.t);
  if (ms) blackout.t = setTimeout(() => document.body.classList.remove("blacked"), ms);
}
setInterval(() => { if (!document.body.classList.contains("blacked")) return; if (!document.hidden) document.body.classList.remove("blacked"); }, 500);

/* ---------- 登录 ---------- */
async function login(kind) {
  const email = $("email").value.trim(), pass = $("pass").value;
  $("auth-err").textContent = "";
  try {
    const fn = kind === "reg" ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
    await fn(auth, email, pass);
  } catch (e) { $("auth-err").textContent = e.message.replace("Firebase: ", ""); }
}
$("btn-login").onclick = () => login("in");
$("btn-reg").onclick = () => login("reg");
$("btn-logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (u) => {
  S.user = u;
  if (!u) return show("auth");
  paintMark();
  $("whoami").textContent = u.email;
  await loadList();
  show("list");
});

/* ---------- 书架 ---------- */
async function loadList() {
  S.list = (await getDocs(collection(db, "manga"))).docs.map(d => ({ id: d.id, ...d.data() }));
  const grid = $("grid");
  grid.innerHTML = "";
  for (const m of S.list) {
    const f = document.createElement("figure");
    f.innerHTML = `<img alt=""><figcaption>${escapeHtml(m.title)}<div class="dim">${escapeHtml(m.authorName || "")} · ${(m.pages || []).length} 页</div></figcaption>`;
    f.onclick = () => open(m.id);
    grid.append(f);
    if (m.pages?.[0]) getDownloadURL(ref(st, m.pages[0])).then(u => (f.querySelector("img").src = u)).catch(() => {});
  }
}

/* 上传：图片先落到 manga/{uid}/{随机id}/，再写元数据，路径前缀被安全规则锁死 */
$("btn-upload").onclick = async () => {
  const files = [...$("new-files").files], title = $("new-title").value.trim();
  if (!title || !files.length) { $("up-msg").textContent = "标题和图片都要填"; return; }
  const dir = `manga/${S.user.uid}/${Date.now().toString(36)}`;
  const paths = [];
  for (let i = 0; i < files.length; i++) {
    $("up-msg").textContent = `上传中 ${i + 1}/${files.length}`;
    const r = ref(st, `${dir}/${i}`);
    await uploadBytes(r, files[i]);
    paths.push(r.fullPath);
  }
  await addDoc(collection(db, "manga"), {
    title, uid: S.user.uid, authorName: S.user.email, pages: paths, createdAt: serverTimestamp(),
  });
  $("new-title").value = ""; $("new-files").value = "";
  $("up-msg").textContent = "已上传";
  await loadList();
};

/* ---------- 阅读 ---------- */
async function open(id) {
  const snap = await getDoc(doc(db, "manga", id));
  if (!snap.exists()) return;
  S.id = id; S.manga = { id, ...snap.data() }; S.page = 0;
  $("read-title").textContent = S.manga.title;
  $("edit-title").value = S.manga.title;
  $("btn-edit").classList.toggle("hidden", S.manga.uid !== S.user.uid);   // 只有作者能编辑
  $("editor").classList.add("hidden");
  watchDanmaku();
  show("read");
  await goTo(0);
}

$("btn-back").onclick = () => { S.dmUnsub?.(); S.manga = null; show("list"); return loadList(); };

async function goTo(p) {
  const n = (S.manga.pages || []).length;
  if (!n) { $("page-img").removeAttribute("src"); $("page-no").textContent = "0/0"; return; }
  S.page = Math.max(0, Math.min(n - 1, p));
  const url = await getDownloadURL(ref(st, S.manga.pages[S.page]));          // 每页现取签名链接，规则才管得住
  $("page-img").src = url;
  $("page-no").textContent = `${S.page + 1}/${n}`;
  S.pageOpenAt = Date.now();
  $("dm-layer").innerHTML = "";
  replayDanmaku();
}
const goPage = (delta) => goTo(S.page + delta);
$("btn-prev").onclick = () => goPage(-1);
$("btn-next").onclick = () => goPage(1);
document.addEventListener("keydown", e => {
  if (!S.manga || e.target.tagName === "INPUT") return;
  if (e.key === "ArrowLeft") goPage(-1);
  if (e.key === "ArrowRight") goPage(1);
});

/* ---------- 弹幕：t = 相对本页打开的毫秒，重开本页会在同一时刻重现 ---------- */
function watchDanmaku() {
  S.dmUnsub?.();
  S.dm = [];
  S.dmUnsub = onSnapshot(collection(db, "manga", S.id, "dm"), (snap) => {
    snap.docChanges().forEach(ch => {
      const c = { cid: ch.doc.id, ...ch.doc.data() };
      if (ch.type === "removed") S.dm = S.dm.filter(x => x.cid !== c.cid);
      else if (ch.type === "added") S.dm.push(c);
    });
    replayDanmaku();
  });
}

function replayDanmaku() {
  if (!S.manga) return;
  const layer = $("dm-layer");
  layer.innerHTML = "";
  S.dm?.filter(d => d.page === S.page).sort((a, b) => a.t - b.t).forEach((d, i) => {
    const off = Math.max(d.t ?? 0, i * 260);        // 历史弹幕按 260ms 依次放行，避免堆叠
    setTimeout(() => fly(d), Math.min(off, 8000));
  });
}

function fly(d) {
  const s = document.createElement("span");
  s.className = "dm";
  s.textContent = d.text;
  s.style.top = (8 + Math.random() * 70) + "%";
  s.style.color = d.uid === S.user.uid ? "#ffd166" : "#fff";
  $("dm-layer").append(s);
  s.addEventListener("animationend", () => s.remove());
}

async function sendDanmaku() {
  const text = $("dm-input").value.trim().slice(0, 60);
  if (!text || !S.manga) return;
  $("dm-input").value = "";
  await addDoc(collection(db, "manga", S.manga.id, "dm"), {
    text, page: S.page, t: Date.now() - S.pageOpenAt,
    uid: S.user.uid, name: S.user.email, createdAt: serverTimestamp(),
  });
}
$("btn-send").onclick = sendDanmaku;
$("dm-input").addEventListener("keydown", e => { if (e.key === "Enter") sendDanmaku(); });

/* ---------- 作者编辑 ---------- */
$("btn-edit").onclick = () => $("editor").classList.toggle("hidden");

$("btn-save-title").onclick = async () => {
  const title = $("edit-title").value.trim();
  if (!title) return;
  await updateDoc(doc(db, "manga", S.id), { title });
  S.manga.title = title;
  $("read-title").textContent = title;
};

$("btn-add-pages").onclick = async () => {
  const files = [...$("add-files").files];
  if (!files.length) return;
  const base = S.manga.pages[0] || `manga/${S.user.uid}/${Date.now().toString(36)}/0`;
  const dir = base.split("/").slice(0, 3).join("/");
  const pages = [...S.manga.pages];
  for (let i = 0; i < files.length; i++) {
    const r = ref(st, `${dir}/${pages.length + i}.png`);
    await uploadBytes(r, files[i]);
    pages.push(r.fullPath);
  }
  await updateDoc(doc(db, "manga", S.id), { pages });
  S.manga.pages = pages;
  $("add-files").value = "";
};

$("btn-del-page").onclick = async () => {
  if (!confirm("删除当前页？")) return;
  const pages = [...S.manga.pages];
  const [gone] = pages.splice(S.page, 1);
  await deleteObject(ref(st, gone)).catch(() => {});
  await updateDoc(doc(db, "manga", S.id), { pages });
  S.manga.pages = pages;
  await goTo(Math.min(S.page, pages.length - 1));
};

$("btn-del-manga").onclick = async () => {
  if (!confirm("整部删除，不可恢复，确认？")) return;
  for (const p of S.manga.pages) await deleteObject(ref(st, p)).catch(() => {});
  const dms = await getDocs(collection(db, "manga", S.id, "dm"));
  await Promise.all(dms.docs.map(d => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "manga", S.id));
  $("btn-back").onclick();
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

show("auth");
