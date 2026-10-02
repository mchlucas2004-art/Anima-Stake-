#!/usr/bin/env node
// Builds a self-contained test page (one .html, double-click to open) for one Spine skeleton.
//   node page-test-animation/make.js <folder containing the .json + .atlas + textures | path to skeleton .json>
// The skeleton, atlas and textures are embedded in the page; only the official Spine player comes from the CDN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLAYER_VERSION = '4.2.120'; // matches skeletons exported with Spine 4.2.x

const arg = process.argv[2];
if (!arg) {
  console.log('Usage: node page-test-animation/make.js <dossier du package | fichier skeleton .json>');
  process.exit(1);
}
const abs = path.resolve(arg);
const dir = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
const files = fs.readdirSync(dir);
const jsonFile = fs.statSync(abs).isDirectory() ? files.find((f) => f.endsWith('.json') && f !== 'metadata.json') : path.basename(abs);
if (!jsonFile) throw new Error(`Aucun skeleton .json dans ${dir}`);
const stem = jsonFile.replace(/\.json$/, '');
const atlasFile = files.find((f) => f === `${stem}.atlas`) || files.find((f) => f.endsWith('.atlas'));
if (!atlasFile) throw new Error(`Aucun .atlas dans ${dir}`);

const atlasText = fs.readFileSync(path.join(dir, atlasFile), 'utf8');
const pageNames = [];
let expectPage = true;
for (const raw of atlasText.replace(/\r/g, '').split('\n')) {
  const line = raw.trim();
  if (!line) {
    expectPage = true;
    continue;
  }
  if (expectPage && !line.includes(':')) pageNames.push(line);
  expectPage = false;
}
const pma = /^\s*pma:\s*true/m.test(atlasText);

const mime = (f) => (f.endsWith('.webp') ? 'image/webp' : f.endsWith('.jpg') || f.endsWith('.jpeg') ? 'image/jpeg' : 'image/png');
const dataUri = (file, type) => `data:${type};base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}`;
const raw = { [jsonFile]: dataUri(jsonFile, 'application/json'), [atlasFile]: dataUri(atlasFile, 'text/plain') };
const missing = [];
for (const p of pageNames) {
  if (files.includes(p)) raw[p] = dataUri(p, mime(p));
  else missing.push(p);
}
if (missing.length) console.warn(`Textures manquantes : ${missing.join(', ')}`);

const skel = JSON.parse(fs.readFileSync(path.join(dir, jsonFile), 'utf8'));
const animations = Object.keys(skel.animations || {});
const skins = (Array.isArray(skel.skins) ? skel.skins.map((s) => s.name) : Object.keys(skel.skins || {})) || [];
const version = skel.skeleton?.spine || '?';

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test ${stem}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@${PLAYER_VERSION}/dist/spine-player.css">
<script src="https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@${PLAYER_VERSION}/dist/iife/spine-player.min.js"></script>
<style>
  :root { --bg: #000; --fg: #eee; --panel: #161616; --line: #333; --accent: #4da3ff; }
  body.light { --bg: #fff; --fg: #111; --panel: #f2f2f2; --line: #ccc; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, system-ui, sans-serif; }
  .wrap { display: grid; grid-template-rows: auto 1fr; height: 100%; }
  header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); }
  h1 { font-size: 15px; margin: 0 12px 0 0; }
  .meta { opacity: .65; font-size: 12px; margin-right: auto; }
  button, select { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px; cursor: pointer; }
  button.on { border-color: var(--accent); color: var(--accent); }
  .anims { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px; border-bottom: 1px solid var(--line); background: var(--panel); }
  #player { width: 100%; height: 100%; min-height: 300px; }
  .stage { display: grid; grid-template-rows: auto 1fr; min-height: 0; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${stem}</h1>
    <span class="meta">Spine ${version} · ${animations.length} animation(s) · ${skins.length} skin(s)${missing.length ? ' · ⚠ textures manquantes : ' + missing.join(', ') : ''}</span>
    <button id="bg-black" class="on">Fond noir</button>
    <button id="bg-white">Fond blanc</button>
    <label><input type="checkbox" id="loop" checked> Boucle</label>
    ${skins.length > 1 ? `<select id="skin">${skins.map((s) => `<option>${s}</option>`).join('')}</select>` : ''}
  </header>
  <div class="stage">
    <div class="anims" id="anims"></div>
    <div id="player"></div>
  </div>
</div>
<script>
  const RAW = ${JSON.stringify(raw)};
  const ANIMS = ${JSON.stringify(animations)};
  const first = ANIMS.find(a => /^idle$/i.test(a)) || ANIMS.find(a => /idle|loop/i.test(a)) || ANIMS[0];
  let current = first;
  const player = new spine.SpinePlayer('player', {
    jsonUrl: ${JSON.stringify(jsonFile)},
    atlasUrl: ${JSON.stringify(atlasFile)},
    rawDataURIs: RAW,
    animation: first,
    premultipliedAlpha: ${pma},
    alpha: true,
    backgroundColor: '#00000000',
    showControls: true,
    success: () => render(),
    error: (p, msg) => { document.getElementById('player').textContent = 'Erreur : ' + msg; },
  });
  function play(name) {
    current = name;
    player.setAnimation(name, document.getElementById('loop').checked);
    player.play();
    render();
  }
  function render() {
    const box = document.getElementById('anims');
    box.innerHTML = '';
    for (const a of ANIMS) {
      const b = document.createElement('button');
      b.textContent = a;
      if (a === current) b.className = 'on';
      b.onclick = () => play(a);
      box.appendChild(b);
    }
  }
  document.getElementById('loop').onchange = () => play(current);
  const setBg = (light) => {
    document.body.classList.toggle('light', light);
    document.getElementById('bg-white').classList.toggle('on', light);
    document.getElementById('bg-black').classList.toggle('on', !light);
  };
  document.getElementById('bg-black').onclick = () => setBg(false);
  document.getElementById('bg-white').onclick = () => setBg(true);
  const skinSel = document.getElementById('skin');
  if (skinSel) skinSel.onchange = () => { player.skeleton.setSkinByName(skinSel.value); player.skeleton.setSlotsToSetupPose(); };
</script>
</body>
</html>
`;

const out = path.join(here, `${stem}.html`);
fs.writeFileSync(out, html);
console.log(`Page créée : ${out}`);
console.log(`Animations : ${animations.join(', ')}`);
