const $ = (id) => document.getElementById(id);
const raw = $('raw-video'), cipher = $('cipher-video'), canvas = $('tracking-canvas');
const viewer = $('viewer'), viewerCanvas = $('viewer-canvas');
const state = { catalog: [], scene: 0, data: null, ready: false, playing: false, loading: true,
  token: 0, frame: -1, finished: false, scrubbing: false, resumeAfterScrub: false,
  view: null, idKey: null, completed: new Set(), positions: new Map(), cache: new Map() };
const palette = ['#287f78', '#527aa9', '#9363a7', '#8b7433', '#547c3b', '#ae6278', '#5b6caa', '#a66c3b'];
const color = (id) => palette[Math.abs(id - 1) % palette.length];
const clock = (seconds) => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
const scene = () => state.catalog[state.scene];
const announce = (message) => { $('announcer').textContent = message; };

function updatePlaying(playing) {
  state.playing = playing;
  $('app').classList.toggle('is-playing', playing);
  const button = $('play-button');
  button.disabled = state.loading;
  button.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('inline-play-button').disabled = state.loading;
  $('inline-play-button').querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('inline-play-button').setAttribute('aria-label', playing ? '暂停当前视频' : '播放当前视频');
  button.querySelector('span').textContent = state.loading ? '准备中' : state.finished ? '重新播放全部' : playing ? '暂停播放' : raw.currentTime > 0 ? '继续播放' : '开始播放';
  $('play-hint').textContent = state.finished ? '八段场景已播放完成，可以重新开始或选择某一段' : playing ? `正在播放第 ${state.scene + 1} 段，共 8 段` : raw.currentTime > 0 ? '已暂停，可拖动进度或选择其他场景' : '点击播放，看看视频如何完成一次协同跟踪';
  $('result-state').replaceChildren(Object.assign(document.createElement('span'), {}), document.createTextNode(state.finished ? '回放完成' : playing ? '正在回放' : raw.currentTime > 0 ? '已暂停' : '等待播放'));
  $('prev-button').disabled = state.loading || state.scene === 0;
  $('next-button').disabled = state.loading || state.scene === state.catalog.length - 1;
  $('seek').disabled = state.loading;
}

function updateTimeline() {
  if (!scene()) return;
  const time = Math.min(raw.currentTime || 0, scene().duration);
  $('current-time').textContent = clock(time);
  $('duration').textContent = clock(scene().duration);
  if (!state.scrubbing) $('seek').value = time;
  $('seek').style.setProperty('--progress', `${time / scene().duration * 100}%`);
  state.positions.set(state.scene, time / scene().duration);
  document.querySelectorAll('.scene-item').forEach((button, index) => {
    const active = index === state.scene;
    if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    button.classList.toggle('is-complete', !active && state.completed.has(index));
    button.style.setProperty('--played', `${(state.positions.get(index) || 0) * 100}%`);
  });
  const phase = Math.floor(time) % 3;
  document.querySelectorAll('.route-step').forEach((step, index) => {
    step.classList.toggle('is-active', state.ready && index === phase);
    step.classList.toggle('is-done', state.ready && index < phase);
  });
}

function drawTracking(target, video, frameIndex) {
  if (!state.data || video.readyState < 2) return;
  const { width, height, frames } = state.data;
  const ctx = target.getContext('2d');
  ctx.save(); ctx.clearRect(0, 0, target.width, target.height);
  ctx.scale(target.width / width, target.height / height);
  ctx.drawImage(video, 0, 0, width, height);
  const labels = [];
  for (const object of frames[frameIndex]) {
    const accent = color(object.id);
    ctx.strokeStyle = accent; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
    ctx.beginPath(); let previous = -2;
    for (let f = Math.max(0, frameIndex - 29); f <= frameIndex; f++) {
      const item = frames[f].find((candidate) => candidate.id === object.id);
      if (!item) continue;
      const [x, y, w, h] = item.bbox;
      if (previous === f - 1) ctx.lineTo(x + w / 2, y + h); else ctx.moveTo(x + w / 2, y + h);
      previous = f;
    }
    ctx.stroke();
    const [x, y, w, h] = object.bbox;
    const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(width, x + w), bottom = Math.min(height, y + h);
    if (right <= left || bottom <= top) continue;
    ctx.strokeRect(left, top, right - left, bottom - top);
    const label = `ID ${String(object.id).padStart(2, '0')}`;
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Consolas, monospace';
    const labelWidth = ctx.measureText(label).width + 8;
    const labelX = Math.max(0, Math.min(left, width - labelWidth));
    let labelY = Math.max(0, top - 17);
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!labels.some(([lx, ly, lw]) => labelX < lx + lw && labelX + labelWidth > lx && labelY < ly + 16 && labelY + 16 > ly)) break;
      labelY = Math.min(height - 16, labelY + 17);
    }
    labels.push([labelX, labelY, labelWidth]);
    ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(labelX, labelY, labelWidth, 16, 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, labelX + 4, labelY + 11.5);
  }
  ctx.restore();
}

function drawViewer() {
  if (!viewer.open || !state.ready || state.frame < 0) return;
  if (state.view === 'tracked') { drawTracking(viewerCanvas, raw, state.frame); return; }
  const video = state.view === 'cipher' ? cipher : raw;
  if (video.readyState < 2) return;
  const ctx = viewerCanvas.getContext('2d');
  ctx.clearRect(0, 0, viewerCanvas.width, viewerCanvas.height);
  ctx.drawImage(video, 0, 0, viewerCanvas.width, viewerCanvas.height);
}

function paint(time = raw.currentTime, force = false) {
  if (!state.ready || !state.data || raw.readyState < 2) return;
  const index = Math.max(0, Math.min(state.data.frames.length - 1, Math.floor(time * state.data.fps + 0.0001)));
  if (index === state.frame && !force) return;
  state.frame = index;
  drawTracking(canvas, raw, index);
  canvas.dataset.frameId = String(index + 1);
  const objects = state.data.frames[index];
  $('track-count').textContent = String(objects.length);
  $('result-count').textContent = String(objects.length).padStart(2, '0');
  $('result-summary').textContent = objects.length ? '已收到本帧的跟踪结果' : '本帧暂无跟踪目标';
  $('return-summary').textContent = objects.length ? `${objects.length} 个目标的位置已返回本地` : '跟随当前视频逐帧回放';
  const key = objects.map((o) => o.id).join(',');
  if (key !== state.idKey) {
    state.idKey = key;
    $('id-list').replaceChildren();
    if (!objects.length) {
      const empty = document.createElement('span'); empty.className = 'empty-result';
      empty.textContent = '等待目标进入画面'; $('id-list').append(empty);
    }
    for (const object of objects.slice(0, 4)) {
      const chip = document.createElement('span'); chip.className = 'id-chip';
      chip.style.setProperty('--id-color', color(object.id));
      chip.append(document.createElement('i'), document.createTextNode(`ID ${String(object.id).padStart(2, '0')}`));
      $('id-list').append(chip);
    }
    if (objects.length > 4) {
      const more = document.createElement('span'); more.className = 'empty-result'; more.textContent = `+${objects.length - 4}`; $('id-list').append(more);
    }
    $('id-list').dataset.ids = key;
  }
  updateTimeline(); drawViewer();
}

function syncCipher(force = false) {
  if (!state.ready || cipher.readyState < 1) return;
  if (force || Math.abs(cipher.currentTime - raw.currentTime) > 0.1) cipher.currentTime = Math.min(raw.currentTime, scene().duration);
  cipher.playbackRate = raw.playbackRate;
}

function waitForFrame(video) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ready = () => { clean(); resolve(); };
    const error = () => { clean(); reject(new Error('视频暂时无法加载')); };
    const clean = () => { video.removeEventListener('loadeddata', ready); video.removeEventListener('error', error); };
    video.addEventListener('loadeddata', ready, { once: true }); video.addEventListener('error', error, { once: true });
  });
}

function dataFor(item) {
  if (!state.cache.has(item.id)) {
    const promise = fetch(item.data).then((response) => { if (!response.ok) throw new Error('跟踪数据加载失败'); return response.json(); })
      .then((data) => { if (data.frames.length !== item.frames || data.fps !== item.fps) throw new Error('视频与跟踪结果不一致'); return data; })
      .catch((error) => { state.cache.delete(item.id); throw error; });
    state.cache.set(item.id, promise);
  }
  return state.cache.get(item.id);
}

async function selectScene(index, { autoplay = false } = {}) {
  if (index < 0 || index >= state.catalog.length) return;
  const token = ++state.token;
  raw.pause(); cipher.pause();
  state.scene = index; state.loading = true; state.ready = false; state.data = null;
  state.frame = -1; state.idKey = null; state.finished = false; state.completed.delete(index); state.positions.set(index, 0);
  $('error-banner').hidden = true; $('app').setAttribute('aria-busy', 'true'); $('media-loader').hidden = false;
  updatePlaying(false);
  const item = scene();
  $('scene-number').textContent = `${String(index + 1).padStart(2, '0')} / 08`;
  $('scene-title').textContent = item.label; $('scene-code').textContent = item.id;
  $('raw-card').querySelector('.media-tag').lastChild.textContent = `CAM ${String(index + 1).padStart(2, '0')}`;
  $('seek').max = item.duration; $('seek').value = 0; $('seek').style.setProperty('--progress', '0%');
  $('current-time').textContent = '00:00'; $('duration').textContent = clock(item.duration);
  $('viewer-scene').textContent = item.id;
  canvas.width = item.width * 2; canvas.height = item.height * 2;
  viewerCanvas.width = item.width * 2; viewerCanvas.height = item.height * 2;
  $('track-count').textContent = '0'; $('result-count').textContent = '00';
  $('id-list').replaceChildren(); $('result-summary').textContent = '正在准备当前场景';
  canvas.dataset.frameId = '';
  raw.poster = item.poster; cipher.poster = item.encryptedPoster;
  raw.src = item.original; cipher.src = item.encrypted;
  raw.load(); cipher.load();
  updateTimeline();
  try {
    const [data] = await Promise.all([dataFor(item), waitForFrame(raw), waitForFrame(cipher)]);
    if (token !== state.token) return;
    state.data = data; state.loading = false; state.ready = true;
    raw.playbackRate = Number($('speed').value); cipher.playbackRate = raw.playbackRate;
    $('app').setAttribute('aria-busy', 'false'); $('media-loader').hidden = true;
    updatePlaying(false); paint(0, true); layoutFlows();
    announce(`已选择第 ${index + 1} 段，${item.label}，${item.duration} 秒`);
    if (autoplay) await play();
  } catch (error) {
    if (token !== state.token) return;
    state.loading = false; state.ready = false; updatePlaying(false);
    $('media-loader').hidden = true; $('app').setAttribute('aria-busy', 'false');
    $('error-message').textContent = `${error.message}，请重新加载或选择其他场景。`; $('error-banner').hidden = false;
    announce('当前场景加载失败，可重新加载。');
  }
}

async function play() {
  if (state.loading) return;
  if (!state.ready) { await selectScene(state.scene, { autoplay: true }); return; }
  if (state.finished) { state.completed.clear(); state.positions.clear(); await selectScene(0, { autoplay: true }); return; }
  if (raw.ended || raw.currentTime >= scene().duration - 0.01) { raw.currentTime = 0; cipher.currentTime = 0; }
  const token = state.token;
  syncCipher(true);
  try { await Promise.all([raw.play(), cipher.play()]); if (token === state.token) updatePlaying(true); }
  catch { if (token === state.token) { raw.pause(); cipher.pause(); updatePlaying(false); $('play-hint').textContent = '点击播放继续演示'; } }
}

function pause() { raw.pause(); cipher.pause(); updatePlaying(false); }
function toggle() { if (state.playing) pause(); else void play(); }
function seek(time) {
  if (!state.ready) return;
  state.finished = false; state.completed.delete(state.scene);
  raw.currentTime = Math.max(0, Math.min(time, scene().duration));
  syncCipher(true); updateTimeline(); updatePlaying(state.playing);
}

function layoutFlows() {
  if (window.matchMedia('(max-width: 1000px)').matches) return;
  const board = $('demo-board').getBoundingClientRect();
  const edge = document.querySelector('.edge-panel').getBoundingClientRect();
  const server = document.querySelector('.server-panel').getBoundingClientRect();
  $('flow-overlay').setAttribute('viewBox', `0 0 ${board.width} ${board.height}`);
  for (const [prefix, from, to, forward] of [['uplink', $('raw-surface'), $('cipher-surface'), true], ['downlink', $('server-result'), $('tracked-surface'), false]]) {
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const x1 = (forward ? edge.right + 1 : server.left - 1) - board.left;
    const x2 = (forward ? server.left - 1 : edge.right + 1) - board.left;
    const y1 = a.top + a.height / 2 - board.top, y2 = b.top + b.height / 2 - board.top;
    const curve = (x2 - x1) * 0.48;
    $(`${prefix}-path`).setAttribute('d', `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`);
    $(`${prefix}-label`).style.left = `${(x1 + x2) / 2}px`;
    $(`${prefix}-label`).style.top = `${(y1 + y2) / 2 - 11}px`;
  }
}

function buildPlaylist() {
  for (const [index, item] of state.catalog.entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'scene-item';
    button.setAttribute('aria-label', `第 ${index + 1} 段，${item.label}，${item.id}，${item.duration} 秒`);
    button.innerHTML = `<span class="scene-item-top">${String(index + 1).padStart(2, '0')}</span><span class="scene-item-title"></span><span class="scene-item-meta"><span class="scene-item-code"></span><span>${item.duration}s</span></span>`;
    button.querySelector('.scene-item-title').textContent = item.label;
    button.querySelector('.scene-item-code').textContent = item.id;
    button.addEventListener('click', () => void selectScene(index, { autoplay: state.playing }));
    $('playlist').append(button);
  }
}

$('play-button').addEventListener('click', toggle);
$('inline-play-button').addEventListener('click', toggle);
$('viewer-play').addEventListener('click', toggle);
$('prev-button').addEventListener('click', () => void selectScene(state.scene - 1, { autoplay: state.playing }));
$('next-button').addEventListener('click', () => void selectScene(state.scene + 1, { autoplay: state.playing }));
$('retry-button').addEventListener('click', () => { if (state.catalog.length) void selectScene(state.scene); else location.reload(); });
$('speed').addEventListener('change', () => { raw.playbackRate = Number($('speed').value); cipher.playbackRate = raw.playbackRate; });
$('auto-next').setAttribute('aria-label', '自动播放下一段');
$('seek').addEventListener('pointerdown', () => { state.scrubbing = true; state.resumeAfterScrub = state.playing; pause(); });
$('seek').addEventListener('input', () => { seek(Number($('seek').value)); });
window.addEventListener('pointerup', () => { if (!state.scrubbing) return; state.scrubbing = false; if (state.resumeAfterScrub) void play(); });
window.addEventListener('pointercancel', () => { state.scrubbing = false; });
raw.addEventListener('timeupdate', () => { if (state.ready) { syncCipher(); updateTimeline(); } });
raw.addEventListener('seeked', () => { if (state.ready) { syncCipher(true); paint(raw.currentTime, true); } });
raw.addEventListener('ended', () => {
  if (!state.ready || state.scrubbing) return;
  state.completed.add(state.scene); pause(); updateTimeline();
  if ($('auto-next').checked && state.scene < state.catalog.length - 1) void selectScene(state.scene + 1, { autoplay: true });
  else if (state.scene === state.catalog.length - 1) { state.finished = true; updatePlaying(false); announce('八段演示已播放完成。'); }
});
if ('requestVideoFrameCallback' in raw) {
  const nextFrame = (_now, metadata) => { paint(metadata.mediaTime); raw.requestVideoFrameCallback(nextFrame); };
  raw.requestVideoFrameCallback(nextFrame);
} else {
  const nextFrame = () => { if (state.playing) paint(); requestAnimationFrame(nextFrame); };
  requestAnimationFrame(nextFrame);
}

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    $('viewer-title').textContent = { raw: '摄像头原始视频', tracked: '处理后的跟踪视频', cipher: '加密画面预览' }[state.view];
    viewer.showModal(); drawViewer();
  });
}
$('close-viewer').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', (event) => { if (event.target === viewer) { const r = viewer.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) viewer.close(); } });
viewer.addEventListener('close', () => { state.view = null; });
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.target.closest('button,input,select,a')) return;
  event.preventDefault(); toggle();
});
new ResizeObserver(layoutFlows).observe($('demo-board'));
window.addEventListener('resize', layoutFlows);

try {
  const response = await fetch('catalog.json');
  if (!response.ok) throw new Error('播放列表加载失败');
  const catalog = await response.json();
  state.catalog = catalog.sequences;
  $('total-duration').textContent = `总时长 ${clock(catalog.totalDuration)}`;
  buildPlaylist(); await selectScene(0);
} catch (error) {
  state.loading = false; updatePlaying(false); $('app').setAttribute('aria-busy', 'false');
  $('error-message').textContent = `${error.message}，请刷新页面后重试。`; $('error-banner').hidden = false;
}
