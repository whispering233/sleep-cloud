import { RAIN_CROSSFADE_S, RAIN_INTRO_URL, RAIN_LOOP_URL } from '../shared/constants';

/**
 * 雨天雨声（原生 WebAudio，**不走 Phaser 的 `this.sound`**：见 `docs/design/architecture.md` §3）。
 *
 * 两个 `AudioBufferSourceNode`（8 s 早播小循环 → 30 s 主循环）各接一个 `GainNode`：小文件解码即出声，
 * 主文件就绪后 1 s 交叉淡化并停掉小 source。对外只有 `setRain(on)` 与 `unlock()`；
 * **不挂定时器、不进逐帧路径**——只在天气状态变化时驱动一次。
 */

let context: AudioContext | undefined;
let rain = false;
/** 每次开 / 关递增：异步解码回来时若已经切走，就丢弃这次结果（关了不许再出声）。 */
let generation = 0;
let inFlight: AbortController | undefined;
let introSource: AudioBufferSourceNode | undefined;
let mainSource: AudioBufferSourceNode | undefined;
let introGain: GainNode | undefined;
/** 主循环解码一次就留着：切「无雨」再切回来不必重解（字节本来也在 HTTP 缓存里）。 */
let loopBuffer: AudioBuffer | undefined;

/** 懒建 `AudioContext`：它只在进厅手势之后才有意义，且没有 WebAudio 的环境要能静默不响。 */
function ensureContext(): AudioContext | undefined {
  if (context) return context;
  if (typeof AudioContext === 'undefined') return undefined;
  const created = new AudioContext();
  context = created;
  // 回到前台：系统可能在后台把 context 挂起，雨天就得接着响（不需要常驻心跳 / 定时器）
  document.addEventListener('visibilitychange', () => {
    if (rain && document.visibilityState === 'visible' && created.state === 'suspended') {
      void created.resume().catch(() => {});
    }
  });
  return created;
}

/** 停掉两个 source（对已停的再 `stop()` 会抛，静默忽略）。 */
function stopSources(): void {
  for (const source of [introSource, mainSource]) {
    if (!source) continue;
    try {
      source.stop();
    } catch {
      // 还没 start 就被关掉：本来就没在响
    }
    source.disconnect();
  }
  introSource = undefined;
  mainSource = undefined;
  introGain = undefined;
}

/** 取一个 WAV 并解码（`signal` 取消在途请求）。 */
async function decode(ctx: AudioContext, url: string, signal: AbortSignal): Promise<AudioBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`雨声文件取不到：${response.status}`);
  return ctx.decodeAudioData(await response.arrayBuffer());
}

/**
 * 早播 → 主循环：小文件先出声（解码即循环），随后顺序取 30 s 主文件，
 * 解码完成后 1 s 交叉淡化、停掉小 source 并释放它的 buffer。
 */
async function play(ctx: AudioContext, token: number, signal: AbortSignal): Promise<void> {
  const intro = ctx.createBufferSource();
  intro.buffer = await decode(ctx, RAIN_INTRO_URL, signal);
  if (token !== generation) return;
  intro.loop = true;
  introGain = ctx.createGain();
  intro.connect(introGain).connect(ctx.destination);
  intro.start();
  introSource = intro;

  const buffer = loopBuffer ?? (await decode(ctx, RAIN_LOOP_URL, signal));
  if (token !== generation) return;
  loopBuffer = buffer;

  const main = ctx.createBufferSource();
  main.buffer = buffer;
  main.loop = true;
  const mainGain = ctx.createGain();
  const now = ctx.currentTime;
  mainGain.gain.setValueAtTime(0, now);
  mainGain.gain.linearRampToValueAtTime(1, now + RAIN_CROSSFADE_S);
  main.connect(mainGain).connect(ctx.destination);
  main.start(now);
  mainSource = main;

  if (introSource === intro && introGain) {
    const fading = introGain;
    fading.gain.setValueAtTime(1, now);
    fading.gain.linearRampToValueAtTime(0, now + RAIN_CROSSFADE_S);
    intro.stop(now + RAIN_CROSSFADE_S);
    // 淡出结束后释放早播 buffer（主循环已接管）；在那之前 `introSource` 仍留着，
    // 好让这 1 s 里切「无雨」也能把它真停掉，而不是只靠 `suspend()` 冻住
    intro.onended = () => {
      intro.buffer = null;
      if (introSource === intro) introSource = undefined;
    };
    introGain = undefined;
  }
}

function start(): void {
  const ctx = ensureContext();
  if (!ctx || inFlight) return;
  void ctx.resume().catch(() => {});
  const token = ++generation;
  const controller = new AbortController();
  inFlight = controller;
  void play(ctx, token, controller.signal)
    .catch(() => {
      // 静默：取不到就只是不响（静默类错误不弹提示）。关了之后的 `AbortError` 也走这里
    })
    .finally(() => {
      if (inFlight === controller) inFlight = undefined;
    });
}

function stop(): void {
  generation += 1;
  inFlight?.abort();
  inFlight = undefined;
  stopSources();
  if (context && context.state === 'running') void context.suspend().catch(() => {});
}

/** 天气开关驱动：开 = 早播小循环 → 主循环交叉淡化；关 = 停源 + 挂起 + 取消在途请求。 */
export function setRain(on: boolean): void {
  if (rain === on) return;
  rain = on;
  if (on) start();
  else stop();
}

/**
 * 进厅手势里调一次：浏览器只允许在用户手势之后出声。拉起之后若还没有雨就立刻挂回去，
 * 不白占音频线程；此后同一页面里的 `resume()` 不再需要手势。
 */
export function unlock(): void {
  const ctx = ensureContext();
  if (!ctx || ctx.state === 'running') return;
  void ctx
    .resume()
    .then(() => {
      if (!rain) void ctx.suspend().catch(() => {});
    })
    .catch(() => {});
}
