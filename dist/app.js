const $ = id => document.getElementById(id);
const raw = $('raw-video'), cipher = $('cipher-video'), canvas = $('tracking-canvas');
const viewer = $('viewer'), viewerCanvas = $('viewer-canvas');
const state = {
  catalog: [], scene: 0, data: null, ready: false, playing: false, loading: true,
  token: 0, frame: -1, finished: false, scrubbing: false, resumeAfterScrub: false,
  view: null, idKey: null, focusedId: null, boxes: true, theater: false,
  completed: new Set(), positions: new Map(), cache: new Map(), controller: null,
};
const palette = ['#68e6c1', '#6bcfff', '#ffbe86', '#e1f28c', '#96b9ff', '#f2b6e5', '#9beddc', '#ffd876'];
const color = id => palette[Math.abs(id - 1) % palette.length];
const clock = seconds => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
const scene = () => state.catalog[state.scene];
const announce = message => { $('announcer').textContent = message; };
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function updatePlaying(playing) {
  state.playing = playing;
  $('app').classList.toggle('is-playing', playing);
  const button = $('play-button');
  button.disabled = state.loading;
  button.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  button.querySelector('span').textContent = state.loading ? '准备中' : state.finished ? '重新播放全部' : playing ? '暂停演示' : raw.currentTime > 0 ? '继续播放' : '播放演示';
  $('inline-play-button').disabled = state.loading;
  $('inline-play-button').querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  $('inline-play-button').setAttribute('aria-label', playing ? '暂停当前视频' : '播放当前视频');
  $('play-hint').textContent = state.finished ? '八段回放完成，点击重新开始' : playing ? `第 ${state.scene + 1} 段正在播放 · 共 8 段` : raw.currentTime > 0 ? '已暂停，可拖动进度或选择场景' : '点击播放，开启一次协同跟踪';
  $('result-state').querySelector('span').textContent = state.finished ? '回放完成' : playing ? '正在回放' : raw.currentTime > 0 ? '已暂停' : '等待播放';
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
    if (index === state.scene) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
    button.classList.toggle('is-complete', index !== state.scene && state.completed.has(index));
    button.style.setProperty('--played', `${(state.positions.get(index) || 0) * 100}%`);
  });
}

// The live canvas contains annotations only. Its transparent pixels reveal the
// encrypted video directly below it; the original video never supplies this view.
function drawBoxes(target, frameIndex, { background = false } = {}) {
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, target.width, target.height);
  if (!state.data || cipher.readyState < 2) return;
  const { width, height, frames } = state.data;
  ctx.save();
  ctx.scale(target.width / width, target.height / height);
  if (background) ctx.drawImage(cipher, 0, 0, width, height);
  if (!state.boxes) { ctx.restore(); return; }
  const labels = [];
  for (const object of frames[frameIndex]) {
    const [x, y, w, h] = object.bbox;
    const left = Math.max(0, x), top = Math.max(0, y);
    const right = Math.min(width, x + w), bottom = Math.min(height, y + h);
    if (right <= left || bottom <= top) continue;
    const focused = state.focusedId === object.id;
    const accent = color(object.id);
    ctx.save();
    ctx.globalAlpha = state.focusedId !== null && !focused ? .34 : 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = focused ? 2 : 1.2;
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#081c34b0'; ctx.shadowBlur = 2.5;
    ctx.strokeRect(left, top, right - left, bottom - top);
    const corner = Math.min(9, (right - left) / 4, (bottom - top) / 4);
    ctx.lineWidth = focused ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(left, top + corner); ctx.lineTo(left, top); ctx.lineTo(left + corner, top);
    ctx.moveTo(right - corner, top); ctx.lineTo(right, top); ctx.lineTo(right, top + corner);
    ctx.moveTo(right, bottom - corner); ctx.lineTo(right, bottom); ctx.lineTo(right - corner, bottom);
    ctx.moveTo(left + corner, bottom); ctx.lineTo(left, bottom); ctx.lineTo(left, bottom - corner);
    ctx.stroke();
    const label = `ID ${String(object.id).padStart(2, '0')}`;
    ctx.font = '600 9px ui-monospace, SFMono-Regular, Consolas, monospace';
    const labelWidth = ctx.measureText(label).width + 10;
    const labelX = Math.max(0, Math.min(left, width - labelWidth));
    let labelY = Math.max(0, top - 17);
    for (let attempt = 0; attempt < 7; attempt++) {
      if (!labels.some(([lx, ly, lw]) => labelX < lx + lw && labelX + labelWidth > lx && labelY < ly + 15 && labelY + 15 > ly)) break;
      labelY = Math.min(height - 15, labelY + 16);
    }
    labels.push([labelX, labelY, labelWidth]);
    ctx.fillStyle = accent; ctx.shadowBlur = 1;
    ctx.beginPath(); ctx.roundRect(labelX, labelY, labelWidth, 15, 3); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#142e36';
    ctx.fillText(label, labelX + 5, labelY + 10.5);
    ctx.restore();
  }
  ctx.restore();
}

function drawViewer() {
  if (!viewer.open || !state.ready || state.frame < 0) return;
  viewerCanvas.dataset.source = state.view === 'tracked' ? 'encrypted' : 'original';
  if (state.view === 'tracked') {
    drawBoxes(viewerCanvas, state.frame, { background: true });
  } else if (raw.readyState >= 2) {
    const ctx = viewerCanvas.getContext('2d');
    ctx.clearRect(0, 0, viewerCanvas.width, viewerCanvas.height);
    ctx.drawImage(raw, 0, 0, viewerCanvas.width, viewerCanvas.height);
  }
}

function updateFocus() {
  document.querySelectorAll('.target-chip').forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.id) === state.focusedId));
  });
}

function paint(time = cipher.currentTime, force = false) {
  if (!state.ready || !state.data || cipher.readyState < 2) return;
  const index = Math.max(0, Math.min(state.data.frames.length - 1, Math.floor(time * state.data.fps + .0001)));
  if (index === state.frame && !force) return;
  state.frame = index;
  const objects = state.data.frames[index];
  if (state.focusedId !== null && !objects.some(object => object.id === state.focusedId)) state.focusedId = null;
  drawBoxes(canvas, index);
  canvas.dataset.frameId = String(index + 1);
  canvas.dataset.source = 'encrypted';
  $('track-count').textContent = String(objects.length).padStart(2, '0');
  $('result-summary').textContent = objects.length ? '本帧目标 · 点击 ID 高亮' : '本帧暂无目标';
  $('return-summary').textContent = objects.length ? `已收到 ${String(objects.length).padStart(2, '0')} 个目标的 ID 与位置` : '等待目标进入当前画面';
  const key = objects.map(object => object.id).join(',');
  if (key !== state.idKey) {
    state.idKey = key;
    $('id-list').replaceChildren();
    if (!objects.length) {
      const empty = document.createElement('span'); empty.className = 'empty-result';
      empty.textContent = '等待目标进入画面'; $('id-list').append(empty);
    }
    for (const object of objects) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'target-chip'; button.dataset.id = object.id;
      button.style.setProperty('--id-color', color(object.id));
      button.setAttribute('aria-label', `高亮目标 ID ${String(object.id).padStart(2, '0')}`);
      button.append(document.createElement('i'), document.createTextNode(`ID ${String(object.id).padStart(2, '0')}`));
      button.addEventListener('click', () => {
        state.focusedId = state.focusedId === object.id ? null : object.id;
        if (!state.boxes) toggleBoxes(true);
        paint(cipher.currentTime, true);
        announce(state.focusedId === null ? '显示全部目标' : `已高亮目标 ID ${object.id}`);
      });
      $('id-list').append(button);
    }
    $('id-list').dataset.ids = key;
  }
  updateFocus(); updateTimeline(); drawViewer();
}

function syncCipher(force = false) {
  if (!state.ready || cipher.readyState < 1) return;
  const drift = Math.abs(cipher.currentTime - raw.currentTime);
  if (drift > (force ? .002 : .08)) cipher.currentTime = Math.min(raw.currentTime, scene().duration);
  cipher.playbackRate = raw.playbackRate;
}

function waitForFrame(video, signal) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ready = () => { clean(); resolve(); };
    const error = () => { clean(); reject(new Error('视频暂时无法加载')); };
    const abort = () => { clean(); reject(new DOMException('场景已切换', 'AbortError')); };
    const clean = () => {
      video.removeEventListener('loadeddata', ready); video.removeEventListener('error', error);
      signal.removeEventListener('abort', abort);
    };
    video.addEventListener('loadeddata', ready, { once: true });
    video.addEventListener('error', error, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function dataFor(item) {
  if (!state.cache.has(item.id)) {
    const promise = fetch(item.data)
      .then(response => { if (!response.ok) throw new Error('跟踪数据加载失败'); return response.json(); })
      .then(data => { if (data.frames.length !== item.frames || data.fps !== item.fps) throw new Error('视频与跟踪结果不一致'); return data; })
      .catch(error => { state.cache.delete(item.id); throw error; });
    state.cache.set(item.id, promise);
  }
  return state.cache.get(item.id);
}

async function selectScene(index, { autoplay = false } = {}) {
  if (index < 0 || index >= state.catalog.length) return;
  const token = ++state.token;
  state.controller?.abort();
  state.controller = new AbortController();
  raw.pause(); cipher.pause();
  state.scene = index; state.loading = true; state.ready = false; state.data = null;
  state.frame = -1; state.idKey = null; state.focusedId = null; state.finished = false;
  state.completed.delete(index); state.positions.set(index, 0);
  $('error-banner').hidden = true; $('app').setAttribute('aria-busy', 'true');
  $('app').classList.add('is-loading'); $('app').classList.remove('scene-reveal');
  $('media-loader').hidden = false; updatePlaying(false);
  const item = scene();
  $('scene-number').textContent = `${String(index + 1).padStart(2, '0')} / 08`;
  $('scene-title').textContent = item.label; $('scene-code').textContent = item.id;
  $('camera-label').textContent = `CAM ${String(index + 1).padStart(2, '0')}`;
  $('seek').max = item.duration; $('seek').value = 0; $('seek').style.setProperty('--progress', '0%');
  $('current-time').textContent = '00:00'; $('duration').textContent = clock(item.duration);
  $('viewer-scene').textContent = item.id;
  canvas.width = item.width * 2; canvas.height = item.height * 2;
  viewerCanvas.width = item.width * 2; viewerCanvas.height = item.height * 2;
  canvas.dataset.frameId = '';
  $('track-count').textContent = '00'; $('id-list').replaceChildren();
  $('result-summary').textContent = '正在准备当前场景'; $('return-summary').textContent = '正在等待当前场景就绪';
  raw.poster = item.poster; cipher.poster = item.encryptedPoster;
  raw.src = item.original; cipher.src = item.encrypted;
  raw.load(); cipher.load(); updateTimeline();
  const activeButton = document.querySelectorAll('.scene-item')[index];
  if (matchMedia('(max-width: 1000px)').matches && activeButton) {
    $('playlist').scrollTo({ left: activeButton.offsetLeft - $('playlist').offsetLeft - 8, behavior: reducedMotion() ? 'instant' : 'smooth' });
  }
  try {
    const [data] = await Promise.all([dataFor(item), waitForFrame(raw, state.controller.signal), waitForFrame(cipher, state.controller.signal)]);
    if (token !== state.token) return;
    state.data = data; state.loading = false; state.ready = true;
    raw.playbackRate = Number($('speed').value); cipher.playbackRate = raw.playbackRate;
    $('app').setAttribute('aria-busy', 'false'); $('media-loader').hidden = true;
    $('app').classList.remove('is-loading'); $('app').classList.add('scene-reveal');
    updatePlaying(false); paint(cipher.currentTime, true); layoutFlows();
    announce(`已选择第 ${index + 1} 段，${item.label}，${item.duration} 秒`);
    if (autoplay) await play();
  } catch (error) {
    if (token !== state.token || error.name === 'AbortError') return;
    state.loading = false; state.ready = false; updatePlaying(false);
    $('media-loader').hidden = true; $('app').classList.remove('is-loading'); $('app').setAttribute('aria-busy', 'false');
    $('error-message').textContent = `${error.message}，请重新加载或选择其他场景。`; $('error-banner').hidden = false;
    announce('当前场景加载失败，可重新加载。');
  }
}

async function play() {
  if (state.loading) return;
  if (!state.ready) { await selectScene(state.scene, { autoplay: true }); return; }
  if (state.finished) { state.completed.clear(); state.positions.clear(); await selectScene(0, { autoplay: true }); return; }
  if (raw.ended || raw.currentTime >= scene().duration - .01) { raw.currentTime = 0; cipher.currentTime = 0; }
  const token = state.token; syncCipher(true);
  try {
    await Promise.all([raw.play(), cipher.play()]);
    if (token === state.token) updatePlaying(true);
  } catch {
    if (token === state.token) { raw.pause(); cipher.pause(); updatePlaying(false); $('play-hint').textContent = '点击播放继续演示'; }
  }
}
function pause() { raw.pause(); cipher.pause(); updatePlaying(false); }
function toggle() { if (state.playing) pause(); else void play(); }
function seek(time) {
  if (!state.ready) return;
  state.finished = false; state.completed.delete(state.scene);
  raw.currentTime = Math.max(0, Math.min(time, scene().duration));
  syncCipher(true); updateTimeline(); updatePlaying(state.playing);
}
function toggleBoxes(value = !state.boxes) {
  state.boxes = value;
  $('overlay-toggle').setAttribute('aria-pressed', String(value));
  $('overlay-toggle').setAttribute('aria-label', value ? '隐藏目标框' : '显示目标框');
  if (state.ready) paint(cipher.currentTime, true);
}
function toggleTheater() {
  state.theater = !state.theater;
  document.body.classList.toggle('is-theater', state.theater);
  $('theater-button').setAttribute('aria-pressed', String(state.theater));
  $('theater-button').querySelector('span').textContent = state.theater ? '退出演示模式' : '演示模式';
  requestAnimationFrame(layoutFlows);
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'instant' : 'smooth' });
  announce(state.theater ? '已进入演示模式，按 Escape 退出' : '已退出演示模式');
}

function layoutFlows() {
  if (matchMedia('(max-width: 1000px)').matches) {
    $('demo-board').style.removeProperty('--surface-height');
    return;
  }
  if (state.theater && scene()) {
    const width = $('raw-surface').getBoundingClientRect().width;
    const height = Math.max(220, Math.min(window.innerHeight - 310, width * scene().height / scene().width));
    $('demo-board').style.setProperty('--surface-height', `${height}px`);
  } else {
    $('demo-board').style.removeProperty('--surface-height');
  }
  const board = $('demo-board').getBoundingClientRect();
  const edge = document.querySelector('.edge-panel').getBoundingClientRect();
  const server = document.querySelector('.server-panel').getBoundingClientRect();
  const from = $('raw-surface').getBoundingClientRect(), to = $('cipher-surface').getBoundingClientRect();
  $('flow-overlay').setAttribute('viewBox', `0 0 ${board.width} ${board.height}`);
  document.querySelector('.bridge-core').style.top = `${from.top - board.top + from.height * .49}px`;
  for (const [prefix, fraction, forward] of [['uplink', .26, true], ['downlink', .79, false]]) {
    const x1 = (forward ? edge.right : server.left) - board.left;
    const x2 = (forward ? server.left : edge.right) - board.left;
    const y1 = from.top - board.top + from.height * fraction;
    const y2 = to.top - board.top + to.height * fraction;
    const bend = (x2 - x1) * .45;
    const d = `M ${x1} ${y1} C ${x1 + bend} ${y1 - 10}, ${x2 - bend} ${y2 - 10}, ${x2} ${y2}`;
    const path = $(`${prefix}-path`); path.setAttribute('d', d);
    const packet = $(`${prefix}-packet`); packet.setAttribute('d', d);
    const length = path.getTotalLength() + 8;
    packet.style.strokeDasharray = `8 ${length}`;
    packet.style.setProperty('--route-length', `${length}px`);
    $(`${prefix}-label`).style.left = `${(x1 + x2) / 2}px`;
    $(`${prefix}-label`).style.top = `${(y1 + y2) / 2 - 13}px`;
  }
}

function buildPlaylist() {
  for (const [index, item] of state.catalog.entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'scene-item';
    button.setAttribute('aria-label', `第 ${index + 1} 段，${item.label}，${item.id}，${item.duration} 秒`);
    const thumbnail = document.createElement('span'); thumbnail.className = 'scene-thumbnail';
    const poster = document.createElement('img'); poster.src = item.poster; poster.alt = ''; poster.loading = 'lazy';
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    thumbnail.append(poster, number);
    const copy = document.createElement('span'); copy.className = 'scene-item-copy';
    const title = document.createElement('span'); title.className = 'scene-item-title'; title.textContent = item.label;
    const meta = document.createElement('span'); meta.className = 'scene-item-meta';
    const code = document.createElement('span'); code.className = 'scene-item-code'; code.textContent = item.id;
    const duration = document.createElement('span'); duration.textContent = `${item.duration}s`;
    meta.append(code, duration); copy.append(title, meta); button.append(thumbnail, copy);
    button.addEventListener('click', () => void selectScene(index, { autoplay: state.playing }));
    $('playlist').append(button);
  }
}

$('play-button').addEventListener('click', toggle);
$('inline-play-button').addEventListener('click', toggle);
$('viewer-play').addEventListener('click', toggle);
$('prev-button').addEventListener('click', () => void selectScene(state.scene - 1, { autoplay: state.playing }));
$('next-button').addEventListener('click', () => void selectScene(state.scene + 1, { autoplay: state.playing }));
$('overlay-toggle').addEventListener('click', () => toggleBoxes());
$('theater-button').addEventListener('click', toggleTheater);
$('retry-button').addEventListener('click', () => { if (state.catalog.length) void selectScene(state.scene); else location.reload(); });
$('speed').addEventListener('change', () => { raw.playbackRate = Number($('speed').value); cipher.playbackRate = raw.playbackRate; });
$('auto-next').setAttribute('aria-label', '自动播放下一段');
$('seek').addEventListener('pointerdown', () => { state.scrubbing = true; state.resumeAfterScrub = state.playing; pause(); });
$('seek').addEventListener('input', () => seek(Number($('seek').value)));
window.addEventListener('pointerup', () => { if (!state.scrubbing) return; state.scrubbing = false; if (state.resumeAfterScrub) void play(); });
window.addEventListener('pointercancel', () => { state.scrubbing = false; });
raw.addEventListener('timeupdate', () => { if (state.ready) { syncCipher(); updateTimeline(); } });
raw.addEventListener('seeked', () => { if (state.ready) { syncCipher(true); updateTimeline(); } });
cipher.addEventListener('seeked', () => { if (state.ready) paint(cipher.currentTime, true); });
cipher.addEventListener('loadeddata', () => { if (state.ready) paint(cipher.currentTime, true); });
raw.addEventListener('ended', () => {
  if (!state.ready || state.scrubbing) return;
  state.completed.add(state.scene); pause(); updateTimeline();
  if ($('auto-next').checked && state.scene < state.catalog.length - 1) void selectScene(state.scene + 1, { autoplay: true });
  else if (state.scene === state.catalog.length - 1) { state.finished = true; updatePlaying(false); announce('八段演示已播放完成。'); }
});
if ('requestVideoFrameCallback' in cipher) {
  const nextFrame = (_now, metadata) => { paint(metadata.mediaTime); cipher.requestVideoFrameCallback(nextFrame); };
  cipher.requestVideoFrameCallback(nextFrame);
} else {
  const nextFrame = () => { if (state.playing) paint(); requestAnimationFrame(nextFrame); };
  requestAnimationFrame(nextFrame);
}
raw.addEventListener('timeupdate', () => { if (viewer.open && state.view === 'raw') drawViewer(); });
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    if (!state.ready) return;
    state.view = button.dataset.view;
    $('viewer-title').textContent = state.view === 'tracked' ? '加密画面 · 目标跟踪' : '摄像头原始画面';
    $('viewer-description').textContent = state.view === 'tracked' ? '加密视频与真实目标框同步呈现' : '当前场景的原始画面';
    viewer.showModal(); drawViewer();
  });
}
$('close-viewer').addEventListener('click', () => viewer.close());
viewer.addEventListener('click', event => {
  if (event.target !== viewer) return;
  const rect = viewer.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) viewer.close();
});
viewer.addEventListener('close', () => { state.view = null; });
window.addEventListener('keydown', event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'Escape' && !viewer.open && state.theater) { toggleTheater(); return; }
  if (event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
  if (event.code === 'KeyF' && !viewer.open) { event.preventDefault(); toggleTheater(); return; }
  if (event.code === 'Space' && !event.target.closest('button,a')) { event.preventDefault(); toggle(); }
});
let layoutFrame;
function scheduleLayout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(layoutFlows);
}
new ResizeObserver(scheduleLayout).observe($('demo-board'));
window.addEventListener('resize', scheduleLayout);

try {
  const response = await fetch('catalog.json');
  if (!response.ok) throw new Error('播放列表加载失败');
  const catalog = await response.json(); state.catalog = catalog.sequences;
  $('total-duration').textContent = `完整回放 ${clock(catalog.totalDuration)}`;
  buildPlaylist(); await selectScene(0);
} catch (error) {
  state.loading = false; updatePlaying(false); $('app').setAttribute('aria-busy', 'false');
  $('error-message').textContent = `${error.message}，请刷新页面后重试。`; $('error-banner').hidden = false;
}
