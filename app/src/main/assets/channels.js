// Rewind TV lineup: one tab per decade, each with its own channels starting at 1.
// A channel is a theme (an Internet Archive search) limited to that decade.
// The LINEUPS lists only include themes the archive has enough videos for in that decade.

// Every query gets SAFE added: videos only, and skip uploaders known to stamp a logo on the picture.
const SAFE = ' AND mediatype:movies' +
  // English only (tapes tagged with another language are skipped)
  ' AND NOT language:(spa OR spanish OR por OR portuguese OR fre OR french OR ger OR german OR ita OR italian OR jpn OR japanese OR rus OR russian OR chi OR chinese OR kor OR korean OR hin OR hindi OR ara OR arabic OR tur OR turkish)' +
  ' AND NOT (coffee4binky OR "Tyrone L. Warbasse" OR "Las Vegas Time Machine" OR Lazerverse OR "Going Buoy" OR "Spaced Out Truckers" OR "Phony Phootbawl" OR description:patreon OR title:patreon)';
// Adult channels also get this: drops anything titled or tagged in a way that suggests minors.
// Adult channels: no gay content (user preference).
const NO_GAY = ' AND NOT (subject:gay OR title:gay OR subject:homosexual OR subject:"gay porn" OR subject:"gay male" OR subject:twink OR title:twink OR subject:bareback OR title:bareback OR subject:lgbt OR subject:queer OR subject:"all male" OR subject:"men only" OR subject:"male on male" OR subject:bisexual OR title:bisexual OR subject:gayporn OR title:gayporn OR subject:"gay sex" OR subject:yiff OR subject:femboy OR subject:sissy OR subject:crossdress OR title:crossdress)';
// Drop anything that even hints at minors / underage / schoolgirl content.
const NO_MINORS = ' AND NOT (title:teen OR subject:teen OR title:teens OR title:young OR subject:young OR title:girl OR title:girls OR title:schoolgirl OR title:school OR title:lolita OR subject:lolita OR title:minor OR title:underage OR title:child OR title:kid OR title:barely OR title:petite OR subject:hentai OR subject:"18+" OR title:"18+" OR title:jailbait OR subject:jailbait)';

const THEMES = {
  // ---- networks & blocks ----
  swim:         { call: 'SWIM', name: 'Adult Swim', color: '#d4d4d4', q: '(title:"adult swim" OR subject:"adult swim" OR subject:adultswim OR title:adultswim)' },
  toonami:      { call: 'TNAMI', name: 'Toonami', color: '#00e5ff', q: '(title:toonami OR subject:toonami)' },
  cn:           { call: 'CN', name: 'Cartoon Network', color: '#f5f5f5', q: '(title:"cartoon network" OR subject:"cartoon network")' },
  boomerang:    { call: 'BOOM', name: 'Boomerang', color: '#ff4081', q: '(title:boomerang AND (subject:cartoon OR subject:"cartoon network" OR subject:cartoons))' },
  nick:         { call: 'NICK', name: 'Nickelodeon / Nicktoons', color: '#ff7a00', q: '(title:nickelodeon OR subject:nickelodeon OR title:nicktoons OR subject:nicktoons OR title:snick)' },
  nickjr:       { call: 'NKJR', name: 'Nick Jr.', color: '#ffd600', q: '(title:"nick jr" OR subject:"nick jr" OR title:noggin OR subject:noggin)' },
  nickatnite:   { call: 'NITE', name: 'Nick at Nite', color: '#536dfe', q: '(title:"nick at nite" OR subject:"nick at nite" OR title:"tv land" OR subject:"tv land")' },
  disney:       { call: 'DSNY', name: 'Disney Channel', color: '#2979ff', q: '(title:"disney channel" OR subject:"disney channel" OR title:"toon disney" OR subject:"toon disney")' },
  foxkids:      { call: 'FOXK', name: 'Fox Kids', color: '#ff1744', q: '(title:"fox kids" OR subject:"fox kids" OR title:"fox box" OR title:"4kids")' },
  kidswb:       { call: 'KWB', name: 'Kids WB', color: '#00b0ff', q: '(title:"kids wb" OR subject:"kids wb")' },
  abcsat:       { call: '1SAT', name: 'One Saturday Morning', color: '#ffab00', q: '(title:"one saturday morning" OR title:"abc saturday morning" OR subject:"one saturday morning")' },
  jetix:        { call: 'JETX', name: 'Jetix', color: '#76ff03', q: '(title:jetix OR subject:jetix)' },
  pbskids:      { call: 'PBSK', name: 'PBS Kids', color: '#00c853', q: '(title:"pbs kids" OR subject:"pbs kids")' },
  tgif:         { call: 'TGIF', name: 'TGIF', color: '#e040fb', q: '(title:tgif OR subject:tgif)' },
  mtv:          { call: 'MTV', name: 'MTV', color: '#ffeb3b', q: '(title:mtv OR subject:mtv)' },
  vh1:          { call: 'VH1', name: 'VH1', color: '#ff5252', q: '(title:vh1 OR subject:vh1)' },
  comedycentral: { call: 'CMDY', name: 'Comedy Central', color: '#ffc400', q: '(title:"comedy central" OR subject:"comedy central")' },
  scifi:        { call: 'SCIFI', name: 'Sci-Fi Channel', color: '#7c4dff', q: '(title:"sci-fi channel" OR subject:"sci-fi channel" OR title:"scifi channel")' },
  upallnight:   { call: 'UPALL', name: 'Up All Night', color: '#651fff', q: '(title:"up all night" OR subject:"up all night" OR title:monstervision)' },
  // ---- channel types ----
  cartoons:    { call: 'TOON',  name: 'Cartoons',            color: '#ff3d7f', q: '(subject:cartoon OR subject:cartoons OR subject:animation OR collection:classic_cartoons)' },
  satam:       { call: 'SAT',   name: 'Saturday Morning',    color: '#ffb300', q: 'subject:"saturday morning"' },
  kidbreaks:   { call: 'KIDBK', name: 'Kids Network Breaks', color: '#ff9100', q: 'collection:classic_tv_commercials AND (subject:nickelodeon OR subject:"cartoon network" OR subject:"fox kids" OR subject:"kids wb" OR subject:disney)' },
  toyads:      { call: 'TOYS',  name: 'Toy Commercials',     color: '#f50057', q: '(subject:"toy commercials" OR (subject:toys AND subject:commercials))' },
  gameads:     { call: 'PRESS', name: 'Game Commercials',    color: '#76ff03', q: '(subject:"video game commercials" OR (subject:"video games" AND subject:commercials))' },
  ads:         { call: 'ADS',   name: 'Commercials',         color: '#ff6d00', q: '(collection:classic_tv_commercials OR subject:commercials OR subject:commercial)' },
  tv:          { call: 'RERUN', name: 'Classic TV',          color: '#ffd600', q: 'collection:classic_tv' },
  sitcom:      { call: 'LAFF',  name: 'Sitcoms',             color: '#ff4081', q: 'subject:sitcom' },
  gameshow:    { call: 'BUZZR', name: 'Game Shows',          color: '#e040fb', q: 'subject:"game show"' },
  music:       { call: 'JAMZ',  name: 'Music Videos',        color: '#ff1744', q: '(subject:"music video" OR subject:"music videos")' },
  vhs:         { call: 'VHS',   name: 'Taped Off TV',        color: '#00b8d4', q: 'collection:vhsvault' },
  news:        { call: 'NEWS',  name: 'Taped News',          color: '#448aff', q: '(subject:news AND collection:vhsvault)' },
  sports:      { call: 'SPRT',  name: 'Sports',              color: '#00e5ff', q: '(subject:sports OR subject:football OR subject:baseball OR subject:basketball) AND collection:vhsvault' },
  wrestling:   { call: 'SLAM',  name: 'Wrestling',           color: '#ffc400', q: 'subject:wrestling' },
  anime:       { call: 'OTAKU', name: 'Anime Block',         color: '#ff80ab', q: 'subject:anime' },
  computers:   { call: 'BYTE',  name: 'Computer TV',         color: '#00e676', q: '(collection:computerchronicles OR subject:computers)' },
  weather:     { call: 'WX',    name: 'Weather Watch',       color: '#40c4ff', q: 'subject:"weather channel"' },
  infomercial: { call: 'BUY',   name: 'Infomercials',        color: '#ffab40', q: 'subject:infomercial' },
  psa:         { call: 'PSA',   name: 'The More You Know',   color: '#69f0ae', q: 'subject:"public service announcement"' },
  school:      { call: 'CLASS', name: 'School Films',        color: '#b2ff59', q: '(collection:prelinger OR subject:"educational film")' },
  trailers:    { call: 'PREV',  name: 'Coming Attractions',  color: '#ea80fc', q: '(subject:trailer OR subject:trailers)' },
  movies:      { call: 'FLIX',  name: 'Movies',              color: '#ffea00', q: 'collection:feature_films' },
  comedyfilm:  { call: 'LOL',   name: 'Comedy Movies',       color: '#fff176', q: 'collection:Comedy_Films' },
  noir:        { call: 'NOIR',  name: 'Film Noir',           color: '#9e9e9e', q: 'collection:Film_Noir' },
  western:     { call: 'OATER', name: 'Westerns',            color: '#a1887f', q: 'subject:western' },
  horror:      { call: 'FRITE', name: 'Creature Feature',    color: '#76ff03', q: '(collection:SciFi_Horror OR subject:horror)' },
  latenight:   { call: 'LATE',  name: 'Late Night',          color: '#7c4dff', q: 'subject:"late night"' },
  skin:        { call: 'SKIN',  name: 'Late-Night Thrillers', color: '#c51162', q: '(subject:"erotic thriller" OR subject:softcore)', adult: true },
  // Hardcore only: broad real porn / adult film search across Archive collections and tags.
  // Prioritizes actual pornographic video (VHS, adult film, stag, hardcore) while excluding
  // gay content (via NO_GAY), anything that looks underage (via NO_MINORS), softcore/Playboy,
  // cartoons/hentai, music/punk, streams, podcasts, news, and documentaries.
  xxx:         { call: 'XXX',   name: 'After Dark · Hardcore', color: '#d50000', q: '(subject:porn OR subject:pornography OR subject:xxx OR subject:hardcore OR subject:"adult film" OR subject:adultvhs OR collection:adultvhs OR collection:adultfilm OR collection:pornography OR title:xxx OR title:porn OR subject:anal OR title:anal OR subject:"anal sex" OR subject:stag OR subject:"stag film" OR subject:erotica) AND NOT (collection:twitchstreams OR collection:social-media-video OR collection:loggedin OR collection:altcensored OR collection:fringe OR subject:punk OR subject:metal OR subject:band OR subject:music OR subject:podcast OR subject:news OR subject:documentary OR subject:comedy OR subject:anime OR subject:hentai OR subject:cartoon OR subject:animation OR subject:softcore OR subject:playboy OR subject:gaming OR subject:workout OR subject:exercise)', adult: true, allYears: true },
};

const DECADES = [
  { id: '50s', y: 1950 }, { id: '60s', y: 1960 }, { id: '70s', y: 1970 },
  { id: '80s', y: 1980 }, { id: '90s', y: 1990 }, { id: '00s', y: 2000 },
];
const DEFAULT_DECADE = '90s';

const LINEUPS = {
  "50s": [
    "cartoons",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "wrestling",
    "anime",
    "psa",
    "school",
    "trailers",
    "movies",
    "comedyfilm",
    "noir",
    "western",
    "horror",
    "xxx"
  ],
  "60s": [
    "cartoons",
    "satam",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "wrestling",
    "anime",
    "computers",
    "psa",
    "school",
    "trailers",
    "movies",
    "comedyfilm",
    "noir",
    "western",
    "horror",
    "latenight",
    "xxx"
  ],
  "70s": [
    "cartoons",
    "satam",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "wrestling",
    "anime",
    "psa",
    "school",
    "trailers",
    "movies",
    "comedyfilm",
    "noir",
    "western",
    "horror",
    "latenight",
    "skin",
    "xxx"
  ],
  "80s": [
    "nick",
    "nickatnite",
    "disney",
    "mtv",
    "vh1",
    "upallnight",
    "cartoons",
    "satam",
    "toyads",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "sports",
    "wrestling",
    "anime",
    "computers",
    "infomercial",
    "psa",
    "school",
    "trailers",
    "movies",
    "comedyfilm",
    "western",
    "horror",
    "latenight",
    "skin",
    "xxx"
  ],
  "90s": [
    "toonami",
    "cn",
    "nick",
    "nickjr",
    "nickatnite",
    "disney",
    "foxkids",
    "kidswb",
    "abcsat",
    "pbskids",
    "tgif",
    "mtv",
    "vh1",
    "comedycentral",
    "scifi",
    "upallnight",
    "cartoons",
    "satam",
    "kidbreaks",
    "toyads",
    "gameads",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "sports",
    "wrestling",
    "anime",
    "computers",
    "weather",
    "infomercial",
    "psa",
    "school",
    "trailers",
    "movies",
    "western",
    "horror",
    "latenight",
    "skin",
    "xxx"
  ],
  "00s": [
    "swim",
    "toonami",
    "cn",
    "boomerang",
    "nick",
    "nickjr",
    "nickatnite",
    "disney",
    "foxkids",
    "kidswb",
    "abcsat",
    "jetix",
    "pbskids",
    "mtv",
    "vh1",
    "comedycentral",
    "scifi",
    "cartoons",
    "satam",
    "kidbreaks",
    "toyads",
    "gameads",
    "ads",
    "tv",
    "sitcom",
    "gameshow",
    "music",
    "vhs",
    "news",
    "sports",
    "wrestling",
    "anime",
    "computers",
    "weather",
    "infomercial",
    "psa",
    "trailers",
    "movies",
    "comedyfilm",
    "western",
    "horror",
    "latenight",
    "skin",
    "xxx"
  ]
};

function decadeClause(y) {
  // Exact year words (1990 OR 1991 ...) instead of a wildcard: same results, about 10x faster.
  const years = Array.from({ length: 10 }, (_, i) => y + i).join(' OR ');
  return ` AND (year:[${y} TO ${y + 9}] OR subject:${y}s OR subject:"${String(y).slice(2)}s" OR title:(${years}))`;
}

function lineup(decId) {
  const d = DECADES.find(x => x.id === decId) || DECADES.find(x => x.id === DEFAULT_DECADE);
  const avail = (typeof window !== 'undefined' && window.AVAIL && window.AVAIL[d.id]) || null;
  const allAvail = (typeof window !== 'undefined' && window.AVAIL && window.AVAIL.all) || {};
  let keys = avail ? LINEUPS[d.id].filter(k => ((THEMES[k].allYears ? allAvail[k] : avail[k]) || 0) >= 10) : LINEUPS[d.id];
  // A decade still being checked: keep the full dial (unchecked channels use live search).
  if (keys.length < 10) keys = LINEUPS[d.id].filter(k => THEMES[k].allYears || !avail || !(k in avail) || avail[k] >= 10);
  return keys.map((key, i) => {
    const t = THEMES[key];
    // allYears channels (the hardcore channel) pull from every decade and share one schedule on every tab.
    return { num: i + 1, key: (t.allYears ? 'all' : d.id) + ':' + key, dec: d.id, call: t.call, name: t.name, color: t.color,
             q: '(' + t.q + ')' + (t.allYears ? '' : decadeClause(d.y)) + (t.adult ? NO_MINORS + NO_GAY : '') };
  });
}
