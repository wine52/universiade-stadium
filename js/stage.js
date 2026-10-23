import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ==========================================================================
   张杰 1982 开往「未·LIVE」巡回演唱会 · 深圳站
   2026.10.16—18 / 深圳大运中心体育场

   依据官方座位图 + 现场剧照还原。巡演方没有公布舞台尺寸，下面 LAYOUT 里的
   数值只用来维持相对比例（按座位图占位与剧照目测推定），不代表实际工程尺寸。

     · 主舞台是一只立着的长方体行李箱：箱壳敞开朝观众，箱口内部整片是 LED 巨
       幕，箱顶前沿一条 1982 / 未·LIVE 胶片灯带，台口两侧吊 d&b SL 线阵列。
     · 双轨延伸台（蓝色 LED 包边）从箱口穿过内场，两侧有金属护栏。
     · 延伸台上先是一只倒扣的行李箱（两个各缺一面的长方体斜搭成人字），末端
       停着两节地铁车厢。
     · 内场按座位图分 A1—A6 / B1—B6 / C1—C4 / D1—D4 四列五行，每块铺满座
       椅（实例化），并可随「荧光棒星海」一起点亮。

   坐标系与 stadium.js 共用：
     x —— 场地长轴，球门在 x = ±47.25，舞台压在 x 为负的一端
     z —— 场地短轴
     y —— 0 为田径场地面（整组再整体下沉 13.8 m，即 PITCH_DROP）
   ========================================================================== */

const HALF_PI = Math.PI / 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const DEG = Math.PI / 180;

/* 平面布局（相对内场中心）。
   这些数值只为维持各部件之间的相对比例而定，巡演方没有公布过舞台尺寸，
   不作为任何实际工程数据引用。 */
const LAYOUT = {
  deck: 1.6,
  platform: { x0: -65, x1: -37, halfZ: 25 },
  housing: { x0: -63, x1: -40, halfZ: 24, h: 30 },
  band: { width: 50, height: 1.8, y: 31.4 },
  gate: { x: -52, zTop: 9.5, yTop: 9.5, zBottom: 3.2 },
  runway: { x0: -40, x1: 32.75, halfZ: 4.0 },
  prop: { x: 10, halfX: 6.2, ridgeY: 6.2, hingeZ: 1.4, footZ: 3.45, footY: 0.3, depth: 0.9 },
  pa: { x: -37.4, z: 22.3, top: 26.4, cabinets: 15, width: 1.7, height: 0.42, depth: 0.85 },
  rail: { z: 1.5, trainX: 17.9 },
  foh: { x: 58, z: 0 },
};

/* 内场分区：四列五行，内两列贴延伸台，外两列靠看台 */
const BLOCK_ROWS = [
  { ids: ['B1区', 'A1区', 'A2区', 'B2区'] },
  { ids: ['B3区', 'A3区', 'A4区', 'B4区'] },
  { ids: ['B5区', 'A5区', 'A6区', 'B6区'] },
  { ids: ['C1区', 'C2区', 'C3区', 'C4区'] },
  { ids: ['D1区', 'D2区', 'D3区', 'D4区'] },
];
const BLOCK_Z = [17.2, 8.8]; // 外列 / 内列的中心（镜像成 ±）
const BLOCK_WIDTH = 7.6;
const BLOCK_DEPTH = 9.6;
const BLOCK_GAP = 0.6;

const COLOR = {
  brass: 0xc2baa9,
  brassLight: 0xe6e0d2,
  bandSteel: 0x312d27,
  platform: 0xd6cec0,
  deck: 0x14171a,
  steel: 0x2b3134,
  rail: 0xcfd6d8,
  maroon: 0x7b2f2a,
  rose: 0x9d4b45,
  cream: 0xd5cec0,
};

/* --------------------------------------------------------------------------
   Canvas textures
   -------------------------------------------------------------------------- */

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}

function canvasTexture(canvas, { repeatX = 1, repeatY = 1 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  return texture;
}

/* 线阵箱体的格栅：横向细缝加一点上亮下暗，远看才不是一块纯黑。 */
function paGrilleTexture() {
  const { canvas, ctx } = makeCanvas(128, 256);
  ctx.fillStyle = '#15181c';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 5; y < 256; y += 7) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, y, 128, 3);
    ctx.fillStyle = 'rgba(140,152,164,0.16)';
    ctx.fillRect(0, y + 3, 128, 1);
  }
  const shade = ctx.createLinearGradient(0, 0, 0, 256);
  shade.addColorStop(0, 'rgba(155,170,185,0.20)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0.30)');
  shade.addColorStop(1, 'rgba(155,170,185,0.10)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 128, 256);
  return canvasTexture(canvas);
}

/* 吊挂框上的 d&b 小铝牌。 */
function paBadgeTexture() {
  const { canvas, ctx } = makeCanvas(256, 64);
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(236,241,245,0.94)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 40px "Helvetica Neue",Arial,sans-serif';
  ctx.fillText('d&b', 96, 34);
  ctx.font = '500 17px "Helvetica Neue",Arial,sans-serif';
  ctx.fillStyle = 'rgba(214,221,228,0.8)';
  ctx.fillText('SL', 186, 38);
  return canvasTexture(canvas);
}

/* 内屏：按这一轮巡演的宣传图重排——夜蓝底、右半边一辆迎面开来的 1982 列车
   与两盏暖橙车灯，左半边一大组「1982 开往《未·LIVE》」，底边一行场次。
   画布比例跟着箱口走（约 1.76 : 1），像素才是方的。 */
function screenTexture() {
  const W = 1536;
  const H = 875;
  const { canvas, ctx } = makeCanvas(W, H);
  const GOLD = '#f0cd8e';

  let seed = 1982;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const rr = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // 夜蓝底
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#162c38');
  bg.addColorStop(0.5, '#0b1820');
  bg.addColorStop(1, '#04080a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 夜空里的一点雾
  const fog = ctx.createRadialGradient(W * 0.62, H * 0.32, 60, W * 0.62, H * 0.32, H * 0.95);
  fog.addColorStop(0, 'rgba(72,108,124,0.28)');
  fog.addColorStop(1, 'rgba(20,40,52,0)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, W, H);

  // —— 列车正面（右半边） ——
  const noseL = 652;
  const noseR = 1290;
  const topY = 172;
  const cx = (noseL + noseR) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(noseL, H);
  ctx.lineTo(noseL, topY + 152);
  ctx.quadraticCurveTo(noseL, topY, noseL + 156, topY);
  ctx.lineTo(noseR - 156, topY);
  ctx.quadraticCurveTo(noseR, topY, noseR, topY + 152);
  ctx.lineTo(noseR, H);
  ctx.closePath();
  const metal = ctx.createLinearGradient(noseL, 0, noseR, 0);
  metal.addColorStop(0, '#4d5652');
  metal.addColorStop(0.12, '#9ba39c');
  metal.addColorStop(0.38, '#cfd4cc');
  metal.addColorStop(0.62, '#b3bab2');
  metal.addColorStop(1, '#3f4844');
  ctx.fillStyle = metal;
  ctx.fill();

  // 压进夜色
  const sink = ctx.createLinearGradient(0, topY, 0, H);
  sink.addColorStop(0, 'rgba(5,12,16,0.28)');
  sink.addColorStop(0.4, 'rgba(5,12,16,0.46)');
  sink.addColorStop(1, 'rgba(5,12,16,0.78)');
  ctx.fillStyle = sink;
  ctx.fill();

  // 车顶冷高光、车侧暖边缘光
  ctx.strokeStyle = 'rgba(188,214,226,0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(noseL + 156, topY + 3);
  ctx.lineTo(noseR - 156, topY + 3);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,164,86,0.22)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(noseL + 2, 430);
  ctx.lineTo(noseL + 2, H);
  ctx.moveTo(noseR - 2, 430);
  ctx.lineTo(noseR - 2, H);
  ctx.stroke();

  // 车头两侧的暗面
  ctx.fillStyle = 'rgba(6,12,16,0.30)';
  ctx.fillRect(noseL, 430, 46, H - 430);
  ctx.fillRect(noseR - 46, 430, 46, H - 430);

  // 分缝
  ctx.strokeStyle = 'rgba(8,14,18,0.18)';
  ctx.lineWidth = 2;
  for (const x of [noseL + 96, noseR - 96]) {
    ctx.beginPath();
    ctx.moveTo(x, 490);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.restore();

  // 风挡
  ctx.save();
  rr(noseL + 48, 312, noseR - noseL - 96, 224, 38);
  const glass = ctx.createLinearGradient(0, 316, 0, 536);
  glass.addColorStop(0, '#33566a');
  glass.addColorStop(0.45, '#162934');
  glass.addColorStop(1, '#0b1720');
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,214,218,0.22)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // 玻璃上的一道天光
  ctx.beginPath();
  ctx.moveTo(noseL + 92, 364);
  ctx.lineTo(noseL + 272, 340);
  ctx.lineTo(noseL + 224, 428);
  ctx.lineTo(noseL + 78, 448);
  ctx.closePath();
  ctx.fillStyle = 'rgba(186,220,238,0.09)';
  ctx.fill();
  // 雨刷
  ctx.strokeStyle = 'rgba(12,18,22,0.5)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(noseL + 286, 526);
  ctx.lineTo(noseL + 372, 420);
  ctx.stroke();
  ctx.restore();

  // 车头灯牌：1982
  ctx.save();
  rr(cx - 62, 200, 124, 56, 12);
  ctx.fillStyle = '#171008';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,178,74,0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffb24a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 36px "Times New Roman",serif';
  ctx.fillText('1982', cx, 229);
  ctx.restore();

  // 两盏车灯
  const lamp = (x, y, r) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 8);
    g.addColorStop(0, 'rgba(255,252,240,0.96)');
    g.addColorStop(0.06, 'rgba(255,212,146,0.9)');
    g.addColorStop(0.22, 'rgba(255,146,58,0.42)');
    g.addColorStop(0.55, 'rgba(255,116,32,0.12)');
    g.addColorStop(1, 'rgba(255,96,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fffdf4';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,52,40,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 7, 0, Math.PI * 2);
    ctx.stroke();
  };
  lamp(noseL + 34, 664, 18);
  lamp(noseR - 34, 664, 18);

  // 车灯在场地上的暖雾：纵向渐变，不能有硬边
  const floorGlow = ctx.createLinearGradient(0, H * 0.52, 0, H);
  floorGlow.addColorStop(0, 'rgba(255,140,52,0)');
  floorGlow.addColorStop(0.62, 'rgba(255,132,46,0.16)');
  floorGlow.addColorStop(1, 'rgba(255,120,40,0.3)');
  ctx.fillStyle = floorGlow;
  ctx.fillRect(0, H * 0.52, W, H * 0.48);
  const lampWash = ctx.createRadialGradient(W * 0.63, H - 40, 50, W * 0.63, H - 40, H * 0.7);
  lampWash.addColorStop(0, 'rgba(255,150,60,0.28)');
  lampWash.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = lampWash;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);

  // 光雾颗粒
  for (let i = 0; i < 120; i++) {
    const x = rnd() * W;
    const y = H * 0.42 + rnd() * H * 0.58;
    ctx.fillStyle = `rgba(255,196,130,${0.04 + rnd() * 0.13})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + rnd() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // —— 主标题 ——
  const brush = (text, x, y, size, rot, color, skew) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.transform(1, 0, skew, 1, 0, 0);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = `900 ${size}px "Arial Black","Microsoft YaHei",Impact,sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.shadowColor = 'rgba(0,0,0,0)';
    const w = ctx.measureText(text).width;
    ctx.strokeStyle = 'rgba(8,14,18,0.34)';
    ctx.lineWidth = 2;
    const rows = Math.max(3, Math.round(size / 24));
    for (let i = 0; i < rows; i++) {
      const yy = -size + (i + 0.6) * (size / rows) + (rnd() - 0.5) * 5;
      const x0 = rnd() * w * 0.45;
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x0 + w * (0.2 + rnd() * 0.6), yy + (rnd() - 0.5) * 4);
      ctx.stroke();
    }
    ctx.restore();
  };

  brush('1982', 62, 476, 200, -0.065, GOLD, -0.15);
  brush('开往', 94, 588, 68, -0.05, GOLD, -0.1);
  brush('《未·LIVE》', 136, 704, 96, -0.035, GOLD, -0.09);
  brush('巡回演唱会', 168, 766, 34, -0.02, 'rgba(246,216,162,0.95)', -0.05);

  // 右上角
  ctx.save();
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(240,226,196,0.9)';
  ctx.font = '700 32px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('张 杰', W - 52, 76);
  ctx.fillStyle = 'rgba(240,205,142,0.85)';
  ctx.font = '600 21px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('深 圳 站', W - 52, 112);
  ctx.restore();

  // 左上角
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(226,232,236,0.5)';
  ctx.font = '600 19px "Helvetica Neue",Arial,sans-serif';
  ctx.fillText('J A S O N   Z H A N G', 56, 74);
  ctx.restore();

  // —— 底边 ——
  const barTop = H - 78;
  const bar = ctx.createLinearGradient(0, barTop, 0, H);
  bar.addColorStop(0, 'rgba(4,8,10,0)');
  bar.addColorStop(0.45, 'rgba(4,8,10,0.86)');
  bar.addColorStop(1, 'rgba(4,8,10,0.96)');
  ctx.fillStyle = bar;
  ctx.fillRect(0, barTop, W, H - barTop);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(232,221,196,0.88)';
  ctx.font = '600 23px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('2026.10.16 — 10.18', 56, H - 34);
  ctx.fillStyle = 'rgba(214,220,226,0.6)';
  ctx.font = '500 20px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('地点：深圳大运中心体育场', 318, H - 34);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,146,60,0.88)';
  ctx.font = '700 19px "Helvetica Neue",Arial,sans-serif';
  ctx.fillText('LIVE IN SHENZHEN', W - 56, H - 34);

  // 暗角
  const vig = ctx.createRadialGradient(W / 2, H * 0.52, H * 0.36, W / 2, H * 0.52, H * 1.1);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  return canvasTexture(canvas);
}

/* 幕下通栏灯带：1982 开往『未·LIVE』，像胶片一样连续排布。 */
function bandTexture() {
  const { canvas, ctx } = makeCanvas(2048, 256);
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, 2048, 256);

  // Film-strip perforations top and bottom.
  for (const y of [10, 226]) {
    for (let x = 8; x < 2048; x += 42) {
      ctx.fillStyle = 'rgba(150,190,255,0.5)';
      ctx.fillRect(x, y, 22, 20);
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const draw = (x, text, size, color) => {
    ctx.fillStyle = color;
    ctx.font = `700 ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText(text, x, 118);
  };
  for (let i = 0; i < 4; i++) {
    const x = 256 + i * 512;
    draw(x, '1982', 96, '#f5f2e8');
    ctx.save();
    ctx.translate(x + 132, 74);
    ctx.rotate(-0.12);
    ctx.fillStyle = '#e8443a';
    ctx.fillRect(-26, -10, 52, 20);
    ctx.restore();
    draw(x + 210, '开往『未·LIVE』', 62, '#e9e4d6');
  }
  return canvasTexture(canvas, { repeatX: 2 });
}

/* 延伸台盖板：蓝底 + 金属骨架 + 1982，和剧照里那两块翻起来的盖板一致。 */
function propPanelTexture() {
  const { canvas, ctx } = makeCanvas(768, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#2f6ec4');
  g.addColorStop(0.5, '#23538f');
  g.addColorStop(1, '#12294d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 768, 512);

  // 金属骨架：横向三道、纵向两道，带高光
  ctx.strokeStyle = 'rgba(210,220,230,0.8)';
  ctx.lineWidth = 10;
  for (const y of [90, 250, 410]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(768, y);
    ctx.stroke();
  }
  ctx.lineWidth = 7;
  for (const x of [140, 384, 630]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }

  // 斜撑
  ctx.strokeStyle = 'rgba(190,205,220,0.55)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(40, 460);
  ctx.lineTo(300, 120);
  ctx.moveTo(730, 460);
  ctx.lineTo(470, 120);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(236,244,255,0.92)';
  ctx.font = '700 74px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('1982', 384, 250);

  // 底部暖光，像剧照里灯打在板脚
  const warm = ctx.createLinearGradient(0, 400, 0, 512);
  warm.addColorStop(0, 'rgba(255,170,80,0)');
  warm.addColorStop(1, 'rgba(255,150,60,0.35)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 400, 768, 112);
  return canvasTexture(canvas);
}

/* 延伸台：深色台面 + 蓝色 LED 包边，和剧照俯视图一致。 */
function runwayTexture() {
  const { canvas, ctx } = makeCanvas(1024, 256);
  ctx.fillStyle = '#0d1013';
  ctx.fillRect(0, 0, 1024, 256);

  const wash = ctx.createLinearGradient(0, 0, 0, 256);
  wash.addColorStop(0, 'rgba(60,120,220,0.22)');
  wash.addColorStop(0.5, 'rgba(20,26,44,0.05)');
  wash.addColorStop(1, 'rgba(60,120,220,0.22)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 1024, 256);

  // Centre guide light, muted so the rail itself still reads.
  ctx.fillStyle = 'rgba(180,215,255,0.35)';
  ctx.fillRect(0, 124, 1024, 6);
  for (let i = 0; i < 26; i++) {
    const x = (i / 26) * 1024;
    ctx.fillStyle = `rgba(120,190,255,${0.05 + ((i * 3) % 7) / 22})`;
    ctx.fillRect(x, 16, 4, 224);
  }
  return canvasTexture(canvas, { repeatX: 3 });
}

/* 每块内场分区的铭牌，沿用座位图的配色。 */
function zonePlateTexture(label, kind) {
  const { canvas, ctx } = makeCanvas(512, 256);
  const fill = kind === 'cream' ? '#d8d1c3' : kind === 'rose' ? '#9d4b45' : '#7b2f2a';
  const ink = kind === 'cream' ? '#4a3520' : '#f3e4c6';

  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = kind === 'cream' ? 'rgba(90,70,40,0.5)' : 'rgba(255,235,200,0.45)';
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 484, 228);

  ctx.fillStyle = kind === 'cream' ? 'rgba(90,70,40,0.45)' : 'rgba(255,235,200,0.4)';
  for (let i = 0; i < 8; i++) {
    const x = 34 + (i / 7) * 444;
    for (const y of [26, 230]) {
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  ctx.font = '700 104px "PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
  ctx.fillText(label, 256, 132);
  return canvasTexture(canvas);
}

/* 车厢侧面：一整张画。大窗 + 细金框 + 腰线 + 未·LIVE 号，和剧照里的车厢一致。 */
function trainSideTexture(scheme) {
  const W = 1152;
  const H = 384;
  const { canvas, ctx } = makeCanvas(W, H);
  const isBlue = scheme === 'blue';

  ctx.fillStyle = isBlue ? '#1b4fb8' : '#c22a28';
  ctx.fillRect(0, 0, W, H);
  if (!isBlue) {
    // 前车车头一段是白的
    const g = ctx.createLinearGradient(W * 0.62, 0, W, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.22, 'rgba(250,250,248,0.98)');
    g.addColorStop(1, '#fafaf8');
    ctx.fillStyle = g;
    ctx.fillRect(W * 0.62, 0, W * 0.38, H);
  }

  // 金色腰线
  ctx.fillStyle = '#d9b271';
  ctx.fillRect(0, 236, W, 8);

  const goldWindow = (x, y, w, h, r = 22) => {
    ctx.fillStyle = '#d9b271';
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.fill();
    const inset = 7;
    const glass = ctx.createLinearGradient(0, y + inset, 0, y + h - inset);
    glass.addColorStop(0, '#fdf6e2');
    glass.addColorStop(0.55, '#f7e7c0');
    glass.addColorStop(1, '#c9a86f');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.moveTo(x + inset + r * 0.6, y + inset);
    ctx.arcTo(x + w - inset, y + inset, x + w - inset, y + h - inset, r * 0.6);
    ctx.arcTo(x + w - inset, y + h - inset, x + inset, y + h - inset, r * 0.6);
    ctx.arcTo(x + inset, y + h - inset, x + inset, y + inset, r * 0.6);
    ctx.arcTo(x + inset, y + inset, x + w - inset, y + inset, r * 0.6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.fillRect(x + inset + 12, y + inset + 10, (w - inset * 2) * 0.26, h - inset * 2 - 20);
  };

  // 窗：三扇大窗 + 一扇门
  goldWindow(46, 44, 214, 158);
  goldWindow(300, 44, 214, 158);
  goldWindow(830, 44, 214, 158);

  // 车门（内凹，金框）
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(600, 26, 150, 268);
  goldWindow(616, 44, 118, 232, 26);

  // 铭牌
  ctx.fillStyle = '#141310';
  ctx.beginPath();
  ctx.roundRect(360, 262, 190, 40, 20);
  ctx.fill();
  ctx.fillStyle = '#e8c98d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 28px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('未 · LIVE 号', 455, 283);

  // 底部深色裙边
  ctx.fillStyle = 'rgba(12,14,16,0.9)';
  ctx.fillRect(0, H - 46, W, 46);
  return canvasTexture(canvas);
}

/* 箱体外侧的旅行贴纸：1982、巡演日期、一枚红章，和剧照里箱侧的排版一致。 */
function caseDecalTexture() {
  const { canvas, ctx } = makeCanvas(1024, 1024);
  ctx.clearRect(0, 0, 1024, 1024);

  const sticker = (x, y, w, h, rot, fill, text, color, size) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = fill;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = 'rgba(30,24,16,0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    if (text) {
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.fillText(text, 0, 0);
    }
    ctx.restore();
  };

  sticker(250, 250, 330, 200, -0.12, '#e6dcc4', '1982', '#3a2a18', 96);
  sticker(740, 300, 300, 170, 0.1, '#d8cdb4', '12.12.26', '#8c2318', 62);
  sticker(300, 620, 330, 170, 0.06, '#e2d8c0', '10.07.16', '#3a2a18', 62);
  sticker(700, 700, 260, 260, -0.16, 'rgba(178,42,32,0.92)', '未·LIVE', '#f6ecd8', 54);
  sticker(180, 880, 240, 120, 0.03, '#cfc4a8', 'SHENZHEN', '#3a2a18', 40);
  sticker(860, 520, 200, 120, 0.22, '#d8cdb4', '1992', '#8c2318', 54);
  return canvasTexture(canvas);
}

/* 同一张贴纸图的不同平铺比例，避免在窄条和宽面上被拉伸。 */
function decalVariant(rx, ry) {
  const texture = caseDecalTexture();
  texture.repeat.set(rx, ry);
  return texture;
}

/* 幕布：深紫，带垂坠的竖向明暗。 */
function curtainTexture() {
  const { canvas, ctx } = makeCanvas(512, 512);
  ctx.fillStyle = '#160c22';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 26; i++) {
    const x = (i / 26) * 512;
    const g = ctx.createLinearGradient(x, 0, x + 20, 0);
    g.addColorStop(0, 'rgba(90,40,120,0.45)');
    g.addColorStop(0.5, 'rgba(20,8,32,0.1)');
    g.addColorStop(1, 'rgba(90,40,120,0.4)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 20, 512);
  }
  return canvasTexture(canvas);
}

/* 一点柔光，用于内场荧光棒。 */
function glowSprite() {
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* --------------------------------------------------------------------------
   Geometry helpers
   -------------------------------------------------------------------------- */

function roundedRectShape(width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/* 车厢断面：上缘大圆角、下缘小圆角，像地铁车身。 */
function carProfileShape(width, height) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = 0;
  const top = 0.78;
  const bottom = 0.3;
  shape.moveTo(x + bottom, y);
  shape.lineTo(x + width - bottom, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + bottom);
  shape.lineTo(x + width, y + height - top);
  shape.quadraticCurveTo(x + width, y + height, x + width - top, y + height);
  shape.lineTo(x + top, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - top);
  shape.lineTo(x, y + bottom);
  shape.quadraticCurveTo(x, y, x + bottom, y);
  return shape;
}

function roundedSlab(width, height, depth, radius, bevel, material) {
  const geometry = new THREE.ExtrudeGeometry(roundedRectShape(width, height, radius), {
    depth: Math.max(0.2, depth - bevel * 2),
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geometry.center();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = HALF_PI;
  return mesh;
}

function box(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

/* --------------------------------------------------------------------------
   Stage
   -------------------------------------------------------------------------- */

function buildPlatform(materials) {
  const group = new THREE.Group();
  const { platform, deck, runway } = LAYOUT;
  const width = platform.x1 - platform.x0;
  const centerX = (platform.x0 + platform.x1) / 2;

  const slab = roundedSlab(platform.halfZ * 2, deck, width, 1.8, 0.12, materials.platform);
  slab.position.set(centerX, deck / 2, 0);
  slab.receiveShadow = true;
  group.add(slab);

  for (const z of [platform.halfZ - 0.2, -platform.halfZ + 0.2]) {
    group.add(box(width - 0.8, 0.12, 0.16, materials.brassLight, centerX, deck - 0.02, z));
  }
  for (const x of [platform.x0 + 0.2, platform.x1 - 0.2]) {
    group.add(box(0.16, 0.12, platform.halfZ * 2 - 0.8, materials.brassLight, x, deck - 0.02, 0));
  }

  group.add(box(1.4, deck - 0.45, runway.halfZ * 2 + 5, materials.platform, platform.x1 + 0.7, (deck - 0.45) / 2, 0));
  return group;
}

/* 主舞台＝一只立着的长方体行李箱：外壳是硬边箱子，**朝观众的一面整片敞开**，
   只留一圈箱口边框，LED 巨幕缩在箱体内部约 6 m 处，从箱口望进去才看得到。 */
function buildHousing(materials) {
  const group = new THREE.Group();
  const { housing, deck, band } = LAYOUT;
  const W = housing.halfZ * 2;
  const D = housing.x1 - housing.x0;
  const H = housing.h;
  const cx = (housing.x0 + housing.x1) / 2;
  const t = 0.8; // 板厚
  const rim = 2.8; // 箱口边框宽度

  /* 单面换材质的盒子：0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z */
  const wall = (w, h, d, innerFace) => {
    const mats = [
      materials.brass, materials.brass, materials.brass,
      materials.brass, materials.brass, materials.brass,
    ];
    mats[innerFace] = materials.interior;
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  };

  // 后墙 / 左右墙 / 底板 / 顶板，前面留空
  const back = wall(t, H, W, 0);
  back.position.set(housing.x0 + t / 2, deck + H / 2, 0);
  back.castShadow = true;
  back.receiveShadow = true;
  group.add(back);

  for (const side of [-1, 1]) {
    const sideWall = wall(D, H, t, side > 0 ? 5 : 4);
    sideWall.position.set(cx, deck + H / 2, side * (housing.halfZ - t / 2));
    sideWall.castShadow = true;
    group.add(sideWall);
  }

  const floor = wall(D, t, W, 2);
  floor.position.set(cx, deck + t / 2, 0);
  floor.receiveShadow = true;
  group.add(floor);

  const ceiling = wall(D, t, W, 3);
  ceiling.position.set(cx, deck + H - t / 2, 0);
  group.add(ceiling);

  // 箱口边框：上、下、左、右四条
  const rimX = housing.x1 - t / 2;
  group.add(box(t * 1.4, rim, W, materials.rimMetal, rimX, deck + H - rim / 2, 0));
  group.add(box(t * 1.4, rim, W, materials.rimMetal, rimX, deck + rim / 2, 0));
  for (const side of [-1, 1]) {
    group.add(box(t * 1.4, H - rim * 2, rim, materials.rimMetal, rimX, deck + H / 2, side * (housing.halfZ - rim / 2)));
  }
  // 箱口内一圈亮边，像箱壳的翻边
  for (const side of [-1, 1]) {
    group.add(box(0.14, H - rim * 2 - 0.4, 0.16, materials.rimLight, rimX + 0.62, deck + H / 2, side * (housing.halfZ - rim + 0.1)));
  }
  group.add(box(0.12, 0.14, W - rim * 2 - 0.4, materials.rimLight, rimX + 0.62, deck + H - rim + 0.1, 0));
  group.add(box(0.12, 0.14, W - rim * 2 - 0.4, materials.rimLight, rimX + 0.62, deck + rim - 0.1, 0));

  // 箱口四边的贴纸贴面（剧照里边框上也糊满了行李贴）
  const decalX = rimX + t * 0.7 + 0.015;
  for (const y of [deck + H - rim / 2, deck + rim / 2]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, rim - 0.1), materials.decalH);
    strip.rotation.y = HALF_PI;
    strip.position.set(decalX, y, 0);
    group.add(strip);
  }
  for (const side of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(rim - 0.1, H - rim * 2 - 0.2), materials.decalV);
    strip.rotation.y = HALF_PI;
    strip.position.set(decalX, deck + H / 2, side * (housing.halfZ - rim / 2));
    group.add(strip);
  }

  // 外侧两面同样贴满
  for (const side of [-1, 1]) {
    const skin = new THREE.Mesh(new THREE.PlaneGeometry(D - 2, H - 2), materials.decalSide);
    skin.position.set(cx, deck + H / 2, side * (housing.halfZ + 0.015));
    skin.rotation.y = side > 0 ? 0 : Math.PI;
    group.add(skin);
  }

  // 贴纸贴在箱体内侧的左右墙上——从箱口望进去，两侧都是巡演日期
  for (const side of [-1, 1]) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(D - 3.4, H - 4.2), materials.caseDecal);
    decal.position.set(cx + 1.2, deck + H / 2 - 0.4, side * (housing.halfZ - t - 0.06));
    decal.rotation.y = side > 0 ? Math.PI : 0;
    group.add(decal);
  }

  // 外侧钢带
  for (let i = 0; i < 3; i++) {
    const y = deck + 2.4 + (i / 2) * (H - 5);
    group.add(box(D * 0.6, 0.7, 0.4, materials.bandSteel, housing.x0 + 2.6, y, housing.halfZ + 0.1));
    group.add(box(D * 0.6, 0.7, 0.4, materials.bandSteel, housing.x0 + 2.6, y, -housing.halfZ - 0.1));
  }

  // 银色护角：前后各四处
  for (const x of [housing.x0 + 1.1, housing.x1 - 1.1]) {
    for (const z of [-housing.halfZ + 1.1, housing.halfZ - 1.1]) {
      for (const y of [deck + 1.3, deck + H - 1.3]) {
        group.add(box(2.4, 2.4, 2.4, materials.silver, x, y, z));
      }
    }
  }

  // 提手
  const handleY = deck + H;
  for (const z of [-7, 7]) {
    group.add(box(0.7, 1.6, 0.7, materials.silver, cx, handleY + 0.8, z));
  }
  group.add(box(0.7, 0.7, 14.8, materials.silver, cx, handleY + 1.6, 0));

  // —— 箱体内部 ——
  // 舞台地板
  const innerFloor = box(D - 3, 0.5, W - 1.6, materials.interiorDeck, cx - 1, deck + t + 0.25, 0);
  group.add(innerFloor);

  // 内部巨幕：左右上下占满箱口，只留一圈窄收边，整体缩进箱体内部
  const screenX = housing.x1 - 6.6;
  const screenW = W - rim * 2 - 0.6;
  const screenH = H - rim * 2 - 0.6;
  const screenCY = deck + H / 2;
  group.add(box(0.5, screenH + 0.9, screenW + 0.9, materials.bandSteel, screenX - 0.3, screenCY, 0));
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH), materials.screen);
  screenMesh.rotation.y = HALF_PI;
  screenMesh.position.set(screenX + 0.02, screenCY, 0);
  group.add(screenMesh);

  // 箱顶前沿的通栏灯带：1982 开往『未·LIVE』
  const bandMesh = new THREE.Mesh(new THREE.PlaneGeometry(band.width, band.height), materials.band);
  bandMesh.rotation.y = HALF_PI;
  bandMesh.position.set(housing.x1 + 0.35, deck + housing.h + 0.75, 0);
  group.add(bandMesh);
  group.add(box(0.8, band.height + 0.5, band.width + 0.6, materials.bandSteel, housing.x1 + 0.1, deck + housing.h + 0.75, 0));

  // 箱内两盏暖光：把两侧贴纸和箱内壁照出来
  for (const z of [-15, 15]) {
    const inner = new THREE.PointLight(0xffd0a0, 380, 34, 2);
    inner.position.set(screenX + 2, deck + 9, z);
    group.add(inner);
  }

  return group;
}

/* --------------------------------------------------------------------------
   Runway
   -------------------------------------------------------------------------- */

function buildRunway(materials) {
  const group = new THREE.Group();
  const { runway, deck, rail } = LAYOUT;
  const length = runway.x1 - runway.x0;
  const centerX = (runway.x0 + runway.x1) / 2;

  const deckSlab = box(length, deck, runway.halfZ * 2, materials.deck, centerX, deck / 2, 0);
  deckSlab.receiveShadow = true;
  group.add(deckSlab);

  const surface = new THREE.Mesh(new THREE.PlaneGeometry(length, runway.halfZ * 2 - 0.4), materials.runway);
  surface.rotation.x = -HALF_PI;
  surface.position.set(centerX, deck + 0.02, 0);
  group.add(surface);

  // 双轨 + 枕木
  for (const z of [-rail.z, rail.z]) {
    group.add(box(length, 0.16, 0.2, materials.rail, centerX, deck + 0.16, z));
  }
  const sleepers = Math.floor(length / 2.6);
  for (let i = 0; i <= sleepers; i++) {
    const x = runway.x0 + (i / sleepers) * length;
    group.add(box(0.34, 0.1, rail.z * 2 + 1.5, materials.bandSteel, x, deck + 0.08, 0));
  }

  // 蓝色 LED 包边：剧照里这条边就是跑道的轮廓
  for (const z of [runway.halfZ - 0.12, -runway.halfZ + 0.12]) {
    group.add(box(length, 0.16, 0.34, materials.kerb, centerX, deck + 0.06, z));
  }
  for (const x of [runway.x0 + 0.1, runway.x1 - 0.1]) {
    group.add(box(0.34, 0.16, runway.halfZ * 2, materials.kerb, x, deck + 0.06, 0));
  }

  return group;
}

/* 延伸台两侧的护栏：把跑道和内场座椅隔开。倒扣箱压住的那一段留空，
   免得栏杆从箱体上穿过去。 */
function buildRunwayBarriers(materials) {
  const group = new THREE.Group();
  const { runway, prop, platform, deck } = LAYOUT;
  const z = runway.halfZ - 0.42;
  const h = 1.16;
  const spans = [
    [platform.x1 + 0.6, prop.x - prop.halfX - 0.7],
    [prop.x + prop.halfX + 1.1, runway.x1 - 0.9],
  ];

  for (const side of [-1, 1]) {
    for (const [x0, x1] of spans) {
      const len = x1 - x0;
      if (len < 1.2) continue;
      const cx = (x0 + x1) / 2;
      const sz = side * z;

      // 扶手 / 中间横杆 / 踢脚
      group.add(box(len, 0.11, 0.17, materials.barrierTop, cx, deck + h, sz));
      group.add(box(len, 0.055, 0.055, materials.barrier, cx, deck + h * 0.56, sz));
      group.add(box(len, 0.15, 0.08, materials.barrier, cx, deck + 0.1, sz));

      const posts = Math.max(2, Math.round(len / 2.7));
      for (let i = 0; i <= posts; i++) {
        const x = x0 + (i / posts) * len;
        group.add(box(0.085, h, 0.085, materials.barrier, x, deck + h / 2, sz));
      }
      for (const x of [x0, x1]) {
        group.add(box(0.13, h + 0.06, 0.13, materials.barrier, x, deck + (h + 0.06) / 2, sz));
      }
    }
  }

  return group;
}

/* 车头正面：风挡、头灯、色带。远看全靠这三样认出"这是列车"。 */
function dressNose(materials, x, baseY, bodyH, dir) {
  const group = new THREE.Group();
  const yaw = dir > 0 ? HALF_PI : -HALF_PI;

  const frame = box(0.1, 1.62, 2.62, materials.trainBand, x - dir * 0.08, baseY + bodyH * 0.64, 0);
  group.add(frame);
  const wind = new THREE.Mesh(new THREE.PlaneGeometry(2.38, 1.42), materials.windshield);
  wind.position.set(x + dir * 0.03, baseY + bodyH * 0.65, 0);
  wind.rotation.y = yaw;
  group.add(wind);

  const band = box(0.12, 0.42, 2.9, materials.trainBand, x - dir * 0.02, baseY + bodyH * 0.36, 0);
  group.add(band);

  for (const z of [-1.0, 1.0]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), materials.lamp);
    lamp.position.set(x + dir * 0.04, baseY + 0.55, z);
    group.add(lamp);
  }
  return group;
}

/* 跑道上的倒扣箱：两个**缺一面的长方体**斜搭成一个人字形，缺口朝跑道内侧，
   列车从两箱之间的缝里露出车头。 */
function buildRunwayProp(materials) {
  const group = new THREE.Group();
  const { prop, deck } = LAYOUT;
  const cx = prop.x;
  const len = prop.halfX * 2;
  const hingeY = deck + prop.ridgeY;
  const footY = deck + prop.footY;
  const depth = prop.depth;

  for (const side of [-1, 1]) {
    const hinge = new THREE.Vector3(cx, hingeY - 0.1, side * prop.hingeZ);
    const foot = new THREE.Vector3(cx, footY, side * prop.footZ);
    const dir = hinge.clone().sub(foot); // 局部 +Y 由脚指向脊
    const slope = dir.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());

    // 让局部 +Z 指向跑道内侧（缺口朝内）
    const inward = new THREE.Vector3(0, 0, -side);
    if (new THREE.Vector3(0, 0, 1).applyQuaternion(quat).dot(inward) < 0) {
      quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    }

    const shell = new THREE.Group();
    shell.position.copy(foot).lerp(hinge, 0.5);
    shell.quaternion.copy(quat);

    // 外板（封住的那一面）
    const plate = new THREE.Mesh(new THREE.BoxGeometry(len, slope, 0.28), materials.propFrame);
    plate.position.z = -0.42;
    shell.add(plate);

    // 外板上的发光面
    const skin = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.24, slope - 0.24), materials.propPanel);
    skin.position.z = -0.58;
    skin.rotation.y = Math.PI;
    shell.add(skin);

    // 四边围板，围出 1.15 m 的箱深（缺的一面朝内）
    for (const y of [-slope / 2 + 0.11, slope / 2 - 0.11]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, 0.22, depth), materials.rimMetal);
      wall.position.set(0, y, -0.42 + depth / 2);
      shell.add(wall);
    }
    for (const x of [-len / 2 + 0.11, len / 2 - 0.11]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.22, slope, depth), materials.rimMetal);
      wall.position.set(x, 0, -0.42 + depth / 2);
      shell.add(wall);
    }

    group.add(shell);
  }

  // 顶缝上方的一道横梁
  group.add(box(len + 0.5, 0.3, 0.7, materials.propFrame, cx, hingeY, 0));
  return group;
}

/* 蓝 / 红白两节地铁车厢，金色窗框与腰线，从门洞里开出来。 */
function buildTrain(materials) {
  const train = new THREE.Group();
  const units = [
    { length: 7.0, scheme: 'blue' },
    { length: 7.0, scheme: 'red' },
  ];
  let cursor = 0;

  for (const unit of units) {
    const car = new THREE.Group();
    const bodyH = 3.05;
    const baseY = 0.72;
    const bodyLen = unit.length - 0.6;
    const centerX = cursor + unit.length / 2;

    // 车身：圆顶断面沿 x 挤出，前后各留出车头的位置
    const profile = carProfileShape(3.1, bodyH);
    const geo = new THREE.ExtrudeGeometry(profile, {
      depth: bodyLen,
      bevelEnabled: true,
      bevelSize: 0.06,
      bevelThickness: 0.12,
      bevelSegments: 3,
      curveSegments: 14,
    });
    geo.translate(0, 0, -bodyLen / 2);
    geo.rotateY(-HALF_PI);
    const body = new THREE.Mesh(geo, unit.scheme === 'blue' ? materials.trainShellBlue : materials.trainShellRed);
    body.position.set(centerX, baseY, 0);
    body.castShadow = true;
    car.add(body);

    // 侧面整幅贴图：窗、金框、腰线、铭牌
    const sideMat = unit.scheme === 'blue' ? materials.trainBlue : materials.trainRedWhite;
    const sideH = bodyH - 0.62;
    for (const side of [-1, 1]) {
      const sideMesh = new THREE.Mesh(new THREE.PlaneGeometry(bodyLen * 0.99, sideH), sideMat);
      sideMesh.position.set(centerX, baseY + sideH / 2, side * 1.625);
      sideMesh.rotation.y = side > 0 ? 0 : Math.PI;
      car.add(sideMesh);
    }

    // 车顶：一道脊 + 空调箱
    car.add(box(bodyLen * 0.78, 0.09, 0.32, materials.bandSteel, centerX, baseY + bodyH + 0.02, 0));
    car.add(box(1.3, 0.2, 1.0, materials.bandSteel, centerX - 1.8, baseY + bodyH + 0.06, 0.5));

    // 车头 / 车尾：圆头 + 风挡 + 头灯 + 色带
    const headX = cursor + unit.length - 0.5;
    const cap = roundedSlab(2.96, bodyH - 0.12, 1.0, 1.1, 0.22, unit.scheme === 'blue' ? materials.trainShellBlue : materials.trainShell);
    cap.position.set(headX, baseY + bodyH / 2, 0);
    car.add(cap);
    car.add(dressNose(materials, cursor + unit.length + 0.12, baseY, bodyH, 1));

    if (cursor === 0) {
      const tail = roundedSlab(2.96, bodyH - 0.12, 1.0, 1.1, 0.22, materials.trainShellBlue);
      tail.position.set(0.5, baseY + bodyH / 2, 0);
      car.add(tail);
      car.add(dressNose(materials, 0.38, baseY, bodyH, -1));
    }

    // 黑色裙板 + 转向架
    car.add(box(bodyLen * 0.99, 0.6, 2.86, materials.bandSteel, centerX, baseY - 0.24, 0));
    for (const dx of [1.7, unit.length - 1.7]) {
      car.add(box(2.0, 0.34, 2.3, materials.bandSteel, cursor + dx, 0.3, 0));
      for (const side of [-1, 1]) {
        for (const wx of [-0.55, 0.55]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.2, 12), materials.rimMetal);
          wheel.rotation.x = HALF_PI;
          wheel.position.set(cursor + dx + wx, 0.36, side * 1.12);
          car.add(wheel);
        }
      }
    }

    train.add(car);
    cursor += unit.length;
  }

  // 车厢之间的风挡
  train.add(box(0.9, 2.6, 2.4, materials.bandSteel, units[0].length - 0.1, 0.72 + 1.5, 0));

  return train;
}

/* --------------------------------------------------------------------------
   In-field blocks: platforms, name plates and seats
   -------------------------------------------------------------------------- */

function seatGeometry() {
  const parts = [];
  const pan = new THREE.BoxGeometry(0.44, 0.08, 0.42);
  pan.translate(0, 0.44, 0);
  parts.push(pan);
  const back = new THREE.BoxGeometry(0.1, 0.52, 0.42);
  back.translate(0.2, 0.7, 0);
  parts.push(back);
  const leg = new THREE.BoxGeometry(0.34, 0.42, 0.1);
  leg.translate(0, 0.21, 0);
  parts.push(leg);
  return mergeGeometries(parts);
}

function buildFieldBlocks(materials) {
  const group = new THREE.Group();
  const { runway } = LAYOUT;
  const rowStart = runway.x0 + 2;
  const seatGeo = seatGeometry();
  const buckets = { maroon: [], rose: [], cream: [] };
  const stickSpots = [];

  // 五行沿赛道全长均分，把内场铺满
  const span = LAYOUT.runway.x1 - 4 - rowStart;
  const rowSpan = span / BLOCK_ROWS.length;
  BLOCK_ROWS.forEach((row, rowIndex) => {
    const x0 = rowStart + rowIndex * rowSpan;
    const x1 = x0 + rowSpan - BLOCK_GAP;
    row.ids.forEach((id, index) => {
      const side = index < 2 ? 1 : -1;
      const outer = index === 0 || index === 3;
      const z = side * BLOCK_Z[outer ? 0 : 1];
      const kind = id.startsWith('A') ? 'maroon' : id.startsWith('B') ? 'rose' : 'cream';
      const material = kind === 'maroon' ? materials.blockA : kind === 'rose' ? materials.blockB : materials.blockC;

      const height = 0.55;
      const body = box(x1 - x0, height, BLOCK_WIDTH, material, (x0 + x1) / 2, height / 2, z);
      body.receiveShadow = true;
      group.add(body);

      // 铭牌铺在分区靠舞台一侧的空带上，座椅从它后面开始排
      const plateDepth = 2.4;
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(BLOCK_WIDTH - 1.0, plateDepth - 0.3),
        materials.zonePlate(id, kind)
      );
      plate.rotation.x = -HALF_PI;
      plate.rotation.z = HALF_PI;
      plate.position.set(x0 + plateDepth / 2, height + 0.01, z);
      group.add(plate);

      // 座椅：沿 z 排座，沿 x 排行，全部朝舞台
      const cols = Math.floor((BLOCK_WIDTH - 0.8) / 0.55);
      const rows = Math.floor(((x1 - x0) - plateDepth - 0.6) / 0.85);
      const zStart = z - ((cols - 1) * 0.55) / 2;
      const xStart = x0 + plateDepth + 0.5;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const seatX = xStart + r * 0.85;
          const seatZ = zStart + c * 0.55;
          buckets[kind].push([seatX, height, seatZ]);
          if (Math.random() < 0.16) stickSpots.push([seatX, height + 1.25, seatZ]);
        }
      }
    });
  });

  // 三个颜色的实例化座椅，一次画完
  const dummy = new THREE.Object3D();
  for (const [kind, spots] of Object.entries(buckets)) {
    if (!spots.length) continue;
    const mesh = new THREE.InstancedMesh(seatGeo, materials[`seat_${kind}`], spots.length);
    spots.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return { group, stickSpots };
}

/* 内场荧光棒：座位上方一层加色光点，跟看台星海一起亮灭。 */
function buildFieldSticks(stickSpots) {
  const positions = new Float32Array(stickSpots.length * 3);
  const colors = new Float32Array(stickSpots.length * 3);
  stickSpots.forEach(([x, y, z], i) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y + Math.random() * 0.25;
    positions[i * 3 + 2] = z;
    colors[i * 3] = 1;
    colors[i * 3 + 1] = 0.4;
    colors[i * 3 + 2] = 0.4;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.85,
    map: glowSprite(),
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.visible = false;
  return points;
}

/* 场地铺装：把草皮盖掉，只留深色地面。 */
function buildFieldFloor(materials) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, 85.0, 50.0, 0, Math.PI * 2, false, 0);
  const geometry = new THREE.ShapeGeometry(shape, 96);
  geometry.rotateX(-HALF_PI);
  const floor = new THREE.Mesh(geometry, materials.fieldFloor);
  floor.position.y = 0.16;
  floor.receiveShadow = true;
  return floor;
}

/* d&b SL-系列线阵列：吊在台口两侧，每组 14 只箱体，从上到下逐渐张开成
   J 形。吊挂框上一根细索往上，没有横跨场地的桁架，也没有摇头灯——这版
   主舞台上方是干净的。 */
function buildPASystem(materials) {
  const group = new THREE.Group();
  const { pa, deck } = LAYOUT;
  const { width, height, depth, cabinets } = pa;

  const cabinetGeo = new THREE.BoxGeometry(depth, height * 0.94, width * 0.98);
  const grilleGeo = new THREE.PlaneGeometry(width * 0.9, height * 0.84);

  for (const side of [-1, 1]) {
    const tower = new THREE.Group();
    tower.position.set(pa.x, deck + pa.top, side * pa.z);

    // 吊挂框 + 两只卸扣
    tower.add(box(depth + 0.34, 0.34, width + 0.3, materials.paFrame, 0, -0.17, 0));
    for (const dz of [-width / 2 + 0.12, width / 2 - 0.12]) {
      tower.add(box(0.14, 0.62, 0.14, materials.paFrame, 0, 0.2, dz));
    }
    // 三根细索一直往上，吊点在画面之外
    for (const dz of [-0.42, 0, 0.42]) {
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 12, 5), materials.paCable);
      wire.position.set(0, 6.15, dz);
      tower.add(wire);
    }

    let px = 0;
    let py = -0.38;
    for (let i = 0; i < cabinets; i++) {
      const t = i / (cabinets - 1);
      // 上段接近垂直，下段越张越开，就是 SL 阵列的 J 形
      const tilt = 0.02 + Math.pow(t, 2.4) * 0.52;
      const dx = Math.sin(tilt);
      const dy = Math.cos(tilt);
      px += (dx * (height - 0.02)) / 2;
      py -= (dy * (height - 0.02)) / 2;

      const cab = new THREE.Mesh(cabinetGeo, materials.paShell);
      cab.position.set(px, py, 0);
      cab.rotation.z = -tilt;
      cab.castShadow = true;
      tower.add(cab);

      const grille = new THREE.Mesh(grilleGeo, materials.paGrille);
      grille.rotation.y = HALF_PI;
      grille.position.set(depth / 2 + 0.006, 0, 0);
      cab.add(grille);

      px += (dx * (height - 0.02)) / 2;
      py -= (dy * (height - 0.02)) / 2;
    }

    // 吊挂框正面一块 d&b 小铝牌
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.17), materials.paBadge);
    badge.rotation.y = HALF_PI;
    badge.position.set(depth / 2 + 0.19, -0.17, width / 2 - 0.46);
    tower.add(badge);

    // 一盏很弱的补光，只把箱体的接缝和圆弧勾出来，不照场地
    const fill = new THREE.PointLight(0xffe6c8, 45, 15, 2);
    fill.position.set(pa.x + 3.4, deck + pa.top - 2.2, side * pa.z);
    group.add(fill);

    group.add(tower);
  }

  return group;
}

function buildFoh(materials) {
  const group = new THREE.Group();
  const { foh } = LAYOUT;
  group.add(box(13, 1.4, 8, materials.deck, foh.x, 0.7, foh.z));
  for (const dz of [-2.4, 2.4]) {
    group.add(box(5.2, 1.4, 2.2, materials.steel, foh.x, 2.1, foh.z + dz));
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.9), materials.fohGlow);
  glow.rotation.x = -HALF_PI;
  glow.position.set(foh.x, 1.43, foh.z);
  group.add(glow);
  return group;
}

/* --------------------------------------------------------------------------
   Materials
   -------------------------------------------------------------------------- */

function createStageMaterials() {
  const screenTex = screenTexture();
  const bandTex = bandTexture();
  const runwayTex = runwayTexture();
  const curtainTex = curtainTexture();
  const plateCache = new Map();

  const seat = (color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.15 });

  return {
    brass: new THREE.MeshStandardMaterial({ color: COLOR.brass, roughness: 0.42, metalness: 0.45, emissive: 0x14110c }),
    interior: new THREE.MeshStandardMaterial({ color: 0x2a2521, roughness: 0.95, metalness: 0.05 }),
    interiorDeck: new THREE.MeshStandardMaterial({ color: 0x1c1815, roughness: 0.9, metalness: 0.1 }),
    rimLight: new THREE.MeshBasicMaterial({ color: 0xffd79a, toneMapped: false }),
    silver: new THREE.MeshStandardMaterial({ color: 0xdde3e6, roughness: 0.26, metalness: 0.88 }),
    rimMetal: new THREE.MeshStandardMaterial({ color: 0x9a9d9f, roughness: 0.5, metalness: 0.35 }),
    decalH: new THREE.MeshBasicMaterial({ map: decalVariant(4, 1), transparent: true, depthWrite: false }),
    decalV: new THREE.MeshBasicMaterial({ map: decalVariant(1, 3), transparent: true, depthWrite: false }),
    decalSide: new THREE.MeshBasicMaterial({ map: decalVariant(2, 2), transparent: true, depthWrite: false }),
    caseDecal: new THREE.MeshBasicMaterial({
      map: (() => {
        const texture = caseDecalTexture();
        texture.repeat.set(1, 3);
        return texture;
      })(),
      transparent: true,
      depthWrite: false,
    }),
    brassLight: new THREE.MeshStandardMaterial({ color: COLOR.brassLight, roughness: 0.3, metalness: 0.55, emissive: 0x1a1712 }),
    bandSteel: new THREE.MeshStandardMaterial({ color: COLOR.bandSteel, roughness: 0.52, metalness: 0.62 }),
    platform: new THREE.MeshStandardMaterial({ color: COLOR.platform, roughness: 0.78, metalness: 0.06 }),
    fieldFloor: new THREE.MeshStandardMaterial({ color: 0x1b1815, roughness: 0.96, metalness: 0.05 }),
    deck: new THREE.MeshStandardMaterial({ color: COLOR.deck, roughness: 0.68, metalness: 0.28 }),
    steel: new THREE.MeshStandardMaterial({ color: COLOR.steel, roughness: 0.55, metalness: 0.6 }),
    rail: new THREE.MeshStandardMaterial({ color: COLOR.rail, roughness: 0.3, metalness: 0.85 }),
    blockA: new THREE.MeshStandardMaterial({ color: COLOR.maroon, roughness: 0.66, metalness: 0.2 }),
    blockB: new THREE.MeshStandardMaterial({ color: COLOR.rose, roughness: 0.66, metalness: 0.2 }),
    blockC: new THREE.MeshStandardMaterial({ color: COLOR.cream, roughness: 0.72, metalness: 0.08 }),
    seat_maroon: seat(0x8c3a33),
    seat_rose: seat(0xa9574f),
    seat_cream: seat(0xc9c2b4),
    kerb: new THREE.MeshBasicMaterial({ color: 0x6fc6ff, toneMapped: false }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff0cc, toneMapped: false }),
    fohGlow: new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.6, toneMapped: false }),
    screen: new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }),
    band: new THREE.MeshBasicMaterial({ map: bandTex, toneMapped: false }),
    curtain: new THREE.MeshStandardMaterial({ map: curtainTex, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    runway: new THREE.MeshBasicMaterial({ map: runwayTex, toneMapped: false }),
    barrier: new THREE.MeshStandardMaterial({ color: 0x3c434a, roughness: 0.5, metalness: 0.5, emissive: 0x12161a }),
    barrierTop: new THREE.MeshStandardMaterial({ color: 0xc6ced6, roughness: 0.34, metalness: 0.55 }),
    propFrame: new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.55, metalness: 0.5 }),
    propPanel: new THREE.MeshBasicMaterial({ map: propPanelTexture(), toneMapped: false }),
    paShell: new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.85, metalness: 0.25, emissive: 0x0b0e12 }),
    paFrame: new THREE.MeshStandardMaterial({ color: 0x505963, roughness: 0.5, metalness: 0.6 }),
    paGrille: new THREE.MeshStandardMaterial({ map: paGrilleTexture(), roughness: 0.9, metalness: 0.18 }),
    paCable: new THREE.MeshStandardMaterial({ color: 0x5b6066, roughness: 0.45, metalness: 0.75 }),
    paBadge: new THREE.MeshBasicMaterial({ map: paBadgeTexture(), transparent: true, toneMapped: false }),
    trainShell: new THREE.MeshStandardMaterial({ color: 0xf1f3f2, roughness: 0.35, metalness: 0.35 }),
    trainShellBlue: new THREE.MeshStandardMaterial({ color: 0x1b4fb8, roughness: 0.34, metalness: 0.35 }),
    trainShellRed: new THREE.MeshStandardMaterial({ color: 0xc22a28, roughness: 0.34, metalness: 0.35 }),
    windshield: new THREE.MeshBasicMaterial({ color: 0x0c1424, toneMapped: false }),
    trainBand: new THREE.MeshBasicMaterial({ color: 0xe07a2c, toneMapped: false }),
    trainBlue: new THREE.MeshBasicMaterial({ map: trainSideTexture('blue'), toneMapped: false }),
    trainRedWhite: new THREE.MeshBasicMaterial({ map: trainSideTexture('red'), toneMapped: false }),
    beam: new THREE.MeshBasicMaterial({
      color: 0xffdcae,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    zonePlate: (id, kind) => {
      const key = `${id}-${kind}`;
      if (!plateCache.has(key)) {
        plateCache.set(key, new THREE.MeshBasicMaterial({ map: zonePlateTexture(id, kind), toneMapped: false }));
      }
      return plateCache.get(key);
    },
  };
}

/* --------------------------------------------------------------------------
   Assembly
   -------------------------------------------------------------------------- */

export function buildConcertStage({ floorY = -13.8 } = {}) {
  const group = new THREE.Group();
  group.name = 'concert-stage';
  group.position.y = floorY;
  group.visible = false;

  const materials = createStageMaterials();

  group.add(buildPlatform(materials));
  group.add(buildHousing(materials));
  group.add(buildRunway(materials));
  group.add(buildRunwayBarriers(materials));
  group.add(buildRunwayProp(materials));
  group.add(buildFoh(materials));
  group.add(buildFieldFloor(materials));

  const blocks = buildFieldBlocks(materials);
  group.add(blocks.group);

  const sticks = buildFieldSticks(blocks.stickSpots);
  group.add(sticks);

  group.add(buildPASystem(materials));

  const train = buildTrain(materials);
  train.position.set(LAYOUT.rail.trainX, LAYOUT.deck + 0.02, 0);
  group.add(train);

  const washFront = new THREE.PointLight(0xffcf94, 1600, 120, 2);
  washFront.position.set(LAYOUT.housing.x1 + 14, LAYOUT.deck + 12, 0);
  group.add(washFront);
  const washTop = new THREE.PointLight(0xffe4bd, 1100, 90, 2);
  washTop.position.set((LAYOUT.housing.x0 + LAYOUT.housing.x1) / 2, LAYOUT.deck + LAYOUT.housing.h + 8, 0);
  group.add(washTop);

  const baseColors = sticks.geometry.attributes.color;
  const swayTable = new Float32Array(256);
  for (let i = 0; i < 256; i++) swayTable[i] = Math.sin((i / 256) * Math.PI * 2);
  const tint = new THREE.Color();

  let night = 0.85;
  let stickMode = false;
  const setNight = (value) => {
    night = clamp01(value);
  };
  const setSticks = (enabled) => {
    stickMode = Boolean(enabled);
    sticks.visible = stickMode && group.visible;
  };

  const update = (elapsed) => {
    if (!group.visible) return;
    const lit = 0.36 + 0.64 * night;

    materials.screen.color.setScalar(lit * (0.94 + Math.sin(elapsed * 1.2) * 0.05));
    materials.band.color.setScalar(lit);
    materials.kerb.color.setScalar(0.28 + 0.72 * night);
    materials.beam.opacity = 0.05 * (0.4 + 0.6 * night);
    materials.fohGlow.opacity = 0.25 + 0.35 * night;

    materials.lamp.color.setScalar(0.5 + 0.5 * night);


    if (stickMode) {
      // 全场同一时刻一种颜色，和看台的星海一致
      tint.setHSL((elapsed * 0.06) % 1, 0.9, 0.66);
      const arr = baseColors.array;
      for (let i = 0; i < arr.length; i += 3) {
        const k = (i / 3) % 97;
        const f = 0.75 + swayTable[(k + Math.floor(elapsed * 8)) & 255] * 0.25;
        arr[i] = tint.r * f;
        arr[i + 1] = tint.g * f;
        arr[i + 2] = tint.b * f;
      }
      baseColors.needsUpdate = true;
    }
  };

  const setVisible = (enabled) => {
    group.visible = Boolean(enabled);
    sticks.visible = Boolean(enabled) && stickMode;
  };

  return { group, materials, update, setNight, setSticks, setVisible, layout: LAYOUT };
}
