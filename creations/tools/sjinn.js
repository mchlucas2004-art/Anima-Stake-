#!/usr/bin/env node
// Minimal sjinn.ai client: create an image task, wait for it, download the result.
//   node creations/tools/sjinn.js <out.png> "<prompt>" [--ref url1,url2] [--ar 1:1] [--res 2K] [--tool nano-banana-image-pro-api]
// Every call is appended to <out dir>/prompts.jsonl (prompt, task id, result URL) for traceability.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'config', 'secrets.json'), 'utf8')).sjinn_api_key;
const API = 'https://sjinn.ai/api/un-api';
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

export async function generate({ prompt, refs = [], aspect = '1:1', resolution = '2K', tool = 'nano-banana-image-pro-api' }) {
  const input = { prompt, aspect_ratio: aspect, resolution };
  if (refs.length) input.image_list = refs;
  const r = await fetch(`${API}/create_tool_task`, { method: 'POST', headers, body: JSON.stringify({ tool_type: tool, input }) });
  const j = await r.json();
  if (!j.success) throw new Error(`create_tool_task: ${j.errorMsg || JSON.stringify(j)}`);
  const id = j.data.task_id;
  for (let i = 0; i < 180; i++) {
    await new Promise((ok) => setTimeout(ok, 5000));
    const s = await (await fetch(`${API}/query_tool_task_status?task_id=${id}`, { headers })).json();
    const st = s.data?.status;
    if (st === 1) return { id, urls: s.data.output_urls };
    if (st === -1) throw new Error(`task ${id} failed: ${JSON.stringify(s.data).slice(0, 300)}`);
  }
  throw new Error(`task ${id}: timeout`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out, prompt, ...rest] = process.argv.slice(2);
  const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
  const refs = opt('--ref', '') ? opt('--ref', '').split(',') : [];
  const t0 = Date.now();
  const res = await generate({ prompt, refs, aspect: opt('--ar', '1:1'), resolution: opt('--res', '2K'), tool: opt('--tool', 'nano-banana-image-pro-api') });
  const buf = Buffer.from(await (await fetch(res.urls[0])).arrayBuffer());
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buf);
  fs.appendFileSync(path.join(path.dirname(path.resolve(out)), 'prompts.jsonl'), JSON.stringify({ file: path.basename(out), prompt, refs, task_id: res.id, url: res.urls[0], seconds: Math.round((Date.now() - t0) / 1000) }) + '\n');
  console.log(`${out}  ←  ${res.urls[0]}  (${Math.round((Date.now() - t0) / 1000)}s)`);
}
