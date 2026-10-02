// Indicative classification of a Spine package. Never used to drop anything: low evidence -> "unknown".

export function tokenize(...inputs) {
  return tokenizeOpts(inputs, true);
}

function tokenizeOpts(inputs, bigrams) {
  const tokens = new Set();
  for (const input of inputs.flat()) {
    if (!input) continue;
    const words = String(input)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([a-zA-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([a-zA-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    words.forEach((w, i) => {
      if (!/^\d+$/.test(w)) tokens.add(w);
      if (bigrams && i + 1 < words.length && !/^\d+$/.test(words[i + 1])) tokens.add(w + words[i + 1]); // "big win" -> "bigwin"
    });
    // keep symbol codes like h1 / l5 / m3 / wd / sc intact
    for (const m of String(input).toLowerCase().matchAll(/(?:^|[^a-z0-9])([hlm]\d{1,2})(?=$|[^a-z0-9])/g)) tokens.add(m[1]);
  }
  return tokens;
}

const CATEGORY_WORDS = {
  character: ['character', 'char', 'hero', 'heroine', 'mascot', 'girl', 'boy', 'man', 'woman', 'lady', 'king', 'queen', 'cowboy', 'bandit', 'pirate', 'wizard', 'witch', 'zeus', 'god', 'goddess', 'monster', 'dragon', 'cat', 'dog', 'raccoon', 'bear', 'avatar', 'npc', 'person', 'boss', 'ghost', 'zombie', 'vampire', 'robot', 'farmer', 'fisherman', 'sheriff', 'outlaw', 'dwarf', 'elf', 'viking', 'samurai', 'ninja', 'squid', 'octopus', 'croc', 'crocodile', 'gator', 'alligator', 'frog', 'rat', 'mouse', 'fox', 'wolf', 'lion', 'tiger', 'panda', 'monkey', 'pig', 'cow', 'horse', 'rabbit', 'bunny', 'bird', 'owl', 'eagle', 'shark', 'snake', 'detective', 'cop', 'police', 'thief', 'chef', 'pharaoh', 'knight', 'warrior', 'mermaid', 'leprechaun', 'santa', 'elvis'],
  symbol: ['symbol', 'symbols', 'sym', 'pic', 'gummy', 'candy', 'candies', 'lollipop', 'heart', 'diamond', 'crown', 'ring', 'chalice', 'hourglass', 'banana', 'grape', 'grapes', 'watermelon', 'plum', 'apple', 'wild', 'wilds', 'scatter', 'scatters', 'royal', 'royals', 'ace', 'jack', 'ten', 'nine', 'gem', 'gems', 'fruit', 'cherry', 'lemon', 'bell', 'seven', 'bar', 'multiplier', 'mult', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'm1', 'm2', 'm3', 'm4', 'm5', 'tile', 'cell', 'pay', 'high', 'low', 'hp', 'lp'],
  effect: ['fx', 'vfx', 'effect', 'effects', 'explosion', 'explode', 'fire', 'flame', 'flames', 'smoke', 'spark', 'sparks', 'sparkle', 'sparkles', 'particle', 'particles', 'glow', 'flash', 'burst', 'lightning', 'thunder', 'coin', 'coins', 'shine', 'shimmer', 'confetti', 'magic', 'dust', 'star', 'stars', 'trail', 'blast', 'splash', 'bubble', 'bubbles', 'electric', 'energy', 'aura', 'beam', 'ray', 'rays', 'impact', 'hit', 'shockwave', 'ripple', 'rain', 'snow', 'leaves', 'bigwin', 'megawin', 'epicwin', 'superwin', 'hugewin', 'maxwin', 'legendarywin', 'gloriouswin', 'ultrawin', 'sensationalwin', 'celebration'],
  background: ['bg', 'background', 'basegame', 'freegame', 'superfreegame', 'basegamebg', 'freegamebg', 'bonusgame', 'backdrop', 'sky', 'scene', 'environment', 'landscape', 'parallax', 'fg', 'foreground', 'clouds', 'cloud', 'ambient', 'ambience', 'mountain', 'mountains', 'city', 'forest', 'sea', 'ocean', 'room', 'interior', 'world'],
  transition: ['transition', 'transitions', 'trasition', 'transiton', 'tranzition', 'intro', 'outro', 'curtain', 'wipe', 'swipe', 'fade', 'freespinsintro', 'fsintro', 'featureintro', 'bonusintro', 'trigger', 'enterfreespins', 'portal'],
  ui: ['ui', 'hud', 'button', 'btn', 'buy', 'buyfeature', 'superbuyfeature', 'winframe', 'freespinscounter', 'paytable', 'autoplay', 'logo', 'title', 'frame', 'reel', 'reels', 'reelframe', 'panel', 'counter', 'meter', 'bar', 'banner', 'popup', 'menu', 'text', 'label', 'totalwin', 'wintext', 'plaque', 'board', 'jackpot', 'progress', 'indicator', 'icon', 'cursor', 'arrow'],
};

const BODY_PARTS = new Set(['head', 'eye', 'eyes', 'eyel', 'eyer', 'mouth', 'arm', 'arms', 'hand', 'hands', 'leg', 'legs', 'foot', 'feet', 'hair', 'torso', 'body', 'neck', 'chest', 'hip', 'hips', 'pelvis', 'shoulder', 'finger', 'fingers', 'brow', 'eyebrow', 'jaw', 'nose', 'ear', 'ears', 'knee', 'elbow', 'forearm', 'thigh', 'shin', 'wrist', 'pupil', 'eyelid', 'lip', 'lips', 'teeth', 'tail', 'face', 'hat', 'belly']);

const SUBTYPE_WORDS = {
  idle: ['idle', 'still', 'static', 'breath', 'breathing', 'stand'],
  loop: ['loop', 'looping', 'cycle'],
  win: ['win', 'wins', 'winning', 'payout', 'celebrate'],
  reaction: ['reaction', 'react', 'happy', 'sad', 'angry', 'surprise', 'surprised', 'excited', 'cheer', 'laugh', 'shock', 'scared', 'nod', 'wave', 'taunt', 'disappointed'],
  entrance: ['intro', 'in', 'appear', 'enter', 'entrance', 'start', 'show', 'spawn', 'open', 'arrive'],
  exit: ['outro', 'out', 'exit', 'hide', 'disappear', 'close', 'leave', 'end'],
  explosion: ['explosion', 'explode', 'blast', 'burst', 'destroy', 'break', 'shatter', 'pop'],
  smoke: ['smoke', 'fog', 'mist', 'steam', 'dust'],
  fire: ['fire', 'flame', 'flames', 'burn', 'burning', 'torch'],
  particle: ['particle', 'particles', 'spark', 'sparks', 'sparkle', 'sparkles', 'glitter', 'confetti', 'stars'],
  land: ['land', 'landing', 'drop', 'fall', 'stop'],
  spin: ['spin', 'spinning', 'blur', 'roll', 'rolling'],
  anticipation: ['anticipation', 'anticipate', 'tease', 'teaser', 'suspense', 'nearmiss'],
  big_win: ['bigwin', 'megawin', 'epicwin', 'superwin', 'hugewin', 'massivewin', 'sensationalwin', 'ultrawin', 'maxwin', 'legendarywin', 'gloriouswin'],
  walk: ['walk', 'run', 'move', 'jump', 'fly'],
  attack: ['attack', 'shoot', 'hit', 'strike', 'punch', 'slash'],
  bonus: ['bonus', 'feature'],
  free_spins: ['freespin', 'freespins', 'fs', 'freegames', 'free'],
  wild: ['wild', 'wilds'],
  scatter: ['scatter', 'scatters'],
  multiplier: ['multiplier', 'multi', 'mult', 'x2', 'x5', 'x10'],
  transition: ['transition', 'wipe', 'swipe', 'curtain'],
};

function score(tokens, words) {
  const hits = [];
  for (const w of words) if (tokens.has(w)) hits.push(w);
  return hits;
}

/**
 * @param {object} p { name, urlPath, animations[], skins[], bones[], slots[], regions[], events[] }
 */
export function classifyPackage(p) {
  const strong = tokenize(p.name, p.urlPath); // file name and CDN path are the most reliable hints
  for (const t of tokenize(p.ignore || [])) strong.delete(t); // e.g. the game's own name ("le bandit" is not a character hint)
  const anim = tokenize(p.animations || []);
  const skins = tokenize(p.skins || []);
  const parts = tokenize(p.bones || [], p.slots || []);
  const regions = tokenize((p.regions || []).slice(0, 400));

  const scores = {};
  const evidence = {};
  for (const [cat, words] of Object.entries(CATEGORY_WORDS)) {
    const s = score(strong, words);
    const a = score(anim, words);
    const k = score(skins, words);
    const b = score(parts, words);
    const r = score(regions, words);
    scores[cat] = s.length * 3 + a.length * 1.5 + k.length * 1 + b.length * 0.5 + r.length * 0.3;
    evidence[cat] = [...s.map((x) => `name:${x}`), ...a.map((x) => `anim:${x}`), ...k.map((x) => `skin:${x}`), ...b.map((x) => `bone:${x}`), ...r.slice(0, 5).map((x) => `region:${x}`)];
  }
  // "olfx", "bgfx", "winfx"… : the fx suffix is a reliable effect hint
  const fx = [...strong].filter((t) => t.length > 2 && t.endsWith('fx'));
  if (fx.length) {
    scores.effect += 3;
    evidence.effect.push(`name:${fx[0]}`);
  }
  // A rig with many body-part bones is almost certainly a character.
  const body = [...parts].filter((t) => BODY_PARTS.has(t));
  if (body.length >= 4) {
    scores.character += 3 + Math.min(body.length, 10) * 0.5;
    evidence.character.push(`body-parts:${body.slice(0, 8).join(',')}`);
  }
  // "win" alone is weak for UI; symbols commonly have land/win/idle triplets.
  const animNames = (p.animations || []).map((a) => String(a).toLowerCase());
  if (animNames.some((a) => /land|landing/.test(a)) && animNames.some((a) => /win/.test(a))) {
    scores.symbol += 2;
    evidence.symbol.push('anims:land+win');
  }

  // Win celebrations ("big_win", "max_win"…) are overlay effects, even when rigged with body parts.
  const celebration = score(strong, ['bigwin', 'megawin', 'epicwin', 'superwin', 'hugewin', 'maxwin', 'legendarywin', 'gloriouswin', 'ultrawin', 'sensationalwin']);
  if (celebration.length) {
    scores.effect += 6;
    evidence.effect.push(`win-celebration:${celebration[0]}`);
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestCat, best] = ranked[0];
  const second = ranked[1][1];
  let category = 'unknown';
  let confidence = 'none';
  if (best >= 3) {
    category = bestCat;
    confidence = best >= 6 && best - second >= 3 ? 'high' : best - second >= 1.5 ? 'medium' : 'low';
  }

  const allTokens = new Set([...strong, ...anim, ...skins]);
  const subtypes = new Set();
  for (const [st, words] of Object.entries(SUBTYPE_WORDS)) if (score(allTokens, words).length) subtypes.add(st);
  if (category === 'symbol') {
    if (subtypes.has('win')) subtypes.add('symbol_win');
    if (subtypes.has('idle')) subtypes.add('symbol_idle');
  }
  if (category === 'background' && (subtypes.has('loop') || subtypes.has('idle'))) subtypes.add('background_loop');

  const noise = new Set(['json', 'atlas', 'png', 'skel', 'spine', 'assets', 'asset', 'res', 'resources', 'static', 'cdn', 'game', 'games', 'img', 'images', 'export', 'animation', 'animations', 'anim', 'default', 'https', 'http', 'com', 'net', 'www']);
  const nameWords = tokenizeOpts([p.name, p.urlPath], false);
  for (const t of tokenize(p.ignore || [])) nameWords.delete(t);
  const known = new Set(Object.values(CATEGORY_WORDS).flat());
  for (const t of strong) if (known.has(t)) nameWords.add(t); // keep meaningful joined words like "bigwin"
  const tags = [...new Set([category, ...subtypes, ...[...nameWords].filter((t) => t.length > 1 && !noise.has(t) && !/^[0-9a-f]{6,}$/.test(t))])].filter((t) => t !== 'unknown');

  return {
    category,
    subtypes: [...subtypes],
    tags,
    confidence,
    scores: Object.fromEntries(ranked.map(([k, v]) => [k, Math.round(v * 10) / 10])),
    evidence: category === 'unknown' ? [] : evidence[category].slice(0, 12),
  };
}
