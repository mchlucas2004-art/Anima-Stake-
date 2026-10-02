// Best-effort provider identification from the Stake slug and from the CDN hosts the game loaded from.

const SLUG_PREFIX = [
  ['pragmatic-play-', 'Pragmatic Play'], ['pragmatic-', 'Pragmatic Play'], ['hacksaw-', 'Hacksaw Gaming'], ['nolimit-', 'Nolimit City'],
  ['push-gaming-', 'Push Gaming'], ['relax-', 'Relax Gaming'], ['play-n-go-', "Play'n GO"], ['playngo-', "Play'n GO"], ['netent-', 'NetEnt'],
  ['red-tiger-', 'Red Tiger'], ['elk-', 'ELK Studios'], ['big-time-gaming-', 'Big Time Gaming'], ['btg-', 'Big Time Gaming'],
  ['thunderkick-', 'Thunderkick'], ['quickspin-', 'Quickspin'], ['yggdrasil-', 'Yggdrasil'], ['avatarux-', 'AvatarUX'],
  ['bgaming-', 'BGaming'], ['backseat-gaming-', 'Backseat Gaming'], ['massive-studios-', 'Massive Studios'], ['titan-gaming-', 'Titan Gaming'],
  ['twist-gaming-', 'Twist Gaming'], ['peter-and-sons-', 'Peter & Sons'], ['paperclip-gaming-', 'Paperclip Gaming'], ['octoplay-', 'Octoplay'],
  ['print-studios-', 'Print Studios'], ['gamomat-', 'Gamomat'], ['blueprint-', 'Blueprint Gaming'], ['evolution-', 'Evolution'],
  ['playtech-', 'Playtech'], ['endorphina-', 'Endorphina'], ['3oaks-', '3 Oaks Gaming'], ['booming-', 'Booming Games'], ['spinomenal-', 'Spinomenal'],
  ['hacksaw-gaming-', 'Hacksaw Gaming'], ['popiplay-', 'Popiplay'], ['bullshark-', 'Bullshark Games'], ['fantasma-', 'Fantasma Games'],
  ['stake-engine-', 'Stake Engine'], ['stake-', 'Stake Originals'],
];

const HOST_PATTERNS = [
  [/pragmaticplay|ppgames|pragmatic/i, 'Pragmatic Play'], [/hacksaw/i, 'Hacksaw Gaming'], [/nolimit/i, 'Nolimit City'],
  [/pushgaming|push-gaming/i, 'Push Gaming'], [/relax-?g|relaxg/i, 'Relax Gaming'], [/playngo|pngame/i, "Play'n GO"],
  [/netent/i, 'NetEnt'], [/redtiger/i, 'Red Tiger'], [/elk-?studios|elkstudios/i, 'ELK Studios'], [/bigtimegaming|btg/i, 'Big Time Gaming'],
  [/thunderkick/i, 'Thunderkick'], [/quickspin/i, 'Quickspin'], [/yggdrasil|yggdrasilgaming/i, 'Yggdrasil'], [/avatarux/i, 'AvatarUX'],
  [/bgaming/i, 'BGaming'], [/backseat/i, 'Backseat Gaming'], [/massive/i, 'Massive Studios'], [/titangaming/i, 'Titan Gaming'],
  [/twistgaming/i, 'Twist Gaming'], [/peterandsons/i, 'Peter & Sons'], [/paperclip/i, 'Paperclip Gaming'], [/octoplay/i, 'Octoplay'],
  [/printstudios/i, 'Print Studios'], [/gamomat/i, 'Gamomat'], [/blueprint/i, 'Blueprint Gaming'], [/evolution|evo-games/i, 'Evolution'],
  [/playtech/i, 'Playtech'], [/endorphina/i, 'Endorphina'], [/spinomenal/i, 'Spinomenal'], [/booming/i, 'Booming Games'],
];

export function providerFromSlug(slug) {
  const s = String(slug || '').toLowerCase();
  for (const [p, name] of SLUG_PREFIX) if (s.startsWith(p)) return name;
  return null;
}

export function providerFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/casino\/games\/([^/?#]+)/);
    return m ? providerFromSlug(m[1]) : null;
  } catch {
    return null;
  }
}

/** hosts: Map host -> count of collected resources. */
export function providerFromHosts(hosts) {
  const tally = new Map();
  for (const [h, n] of hosts) for (const [re, name] of HOST_PATTERNS) if (re.test(h)) tally.set(name, (tally.get(name) || 0) + n);
  return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
