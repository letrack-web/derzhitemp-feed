// Собирает docs/episodes.json из RSS-ленты подкаста «Держи темп» на Mave.
// Запускается GitHub Actions раз в час (.github/workflows/update.yml), можно и вручную: node build.js
// Без внешних зависимостей, нужен Node 18+.
const fs = require('fs');
const { DT_TOPICS, dtClassify } = require('./classify.js');
const { MANUAL, POPULAR } = require('./config.js');

const FEED = process.env.FEED_URL || 'https://cloud.mave.digital/36668';
const OUT = 'docs/episodes.json';
const IMG_PREFIX = 'https://cdn.mave.digital/storage/podcasts/b5842bba-10e4-48cf-9a32-2e383c9181b0/images/';

function decode(s) {
  return String(s || '')
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
}
function tag(xml, name) {
  const m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>'));
  return m ? decode(m[1].trim()) : '';
}
function attr(xml, name, a) {
  const m = xml.match(new RegExp('<' + name + '\\s[^>]*' + a + '="([^"]*)"'));
  return m ? decode(m[1]) : '';
}
function plain(html) {
  return decode(html).replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function snip(d) {
  let s = d.split(/Из выпуска ты узнаешь:?/i)[0].replace(/[📹🎬💎⭐️ℹ️▪️▫️❤️🎧]/gu, '').replace(/\s+/g, ' ').trim();
  if (s.length < 60) s = d.replace(/Из выпуска ты узнаешь:?/i, '').trim();
  if (s.length > 260) { s = s.slice(0, 260); s = s.slice(0, s.lastIndexOf(' ')) + '…'; }
  return s;
}
function cutLinks(d) { // хвост со ссылками («📲 Калькуляторы… https://…») в описание не берём
  const i = d.search(/(📲|🏆|🎙|🐢)\s|https?:\/\//);
  return i > 80 ? d.slice(0, i).trim() : d;
}
function duration(s) {
  s = String(s || '').trim();
  if (/^\d+$/.test(s)) return +s;
  const p = s.split(':').map(Number); let t = 0; p.forEach(x => { t = t * 60 + (x || 0); }); return t;
}

function parse(xml) {
  const items = xml.split(/<item[\s>]/).slice(1).map(x => x.split('</item>')[0]);
  const ids = DT_TOPICS.map(t => t[0]);
  const NEWT = ['moscow', 'women', 'over40', 'podmar'].map(x => ids.indexOf(x));
  const POP = ids.indexOf('popular');
  return items.map(it => {
    const title = tag(it, 'title');
    const enc = attr(it, 'enclosure', 'url');
    const g = (enc.split('/episodes/')[1] || '').replace(/\.mp3.*$/, '');
    if (!g) return null;
    const desc = cutLinks(plain(tag(it, 'description') || tag(it, 'content:encoded') || tag(it, 'itunes:summary')));
    const image = attr(it, 'itunes:image', 'href');
    const file = image.split('/images/')[1] || '';
    const m = title.match(/^(\d+)\.\s*(.*)$/);
    const date = new Date(tag(it, 'pubDate'));
    let tags = dtClassify(title, desc);
    if (MANUAL[g]) tags = MANUAL[g].map(x => ids.indexOf(x)).filter(i => i >= 0).concat(tags.filter(t => NEWT.includes(t)));
    if (POPULAR.includes(g) && POP >= 0) tags.push(POP);
    tags = tags.filter((t, i, a) => a.indexOf(t) === i);
    return [
      m ? +m[1] : 0,                                   // номер выпуска (0 — разминки и спецвыпуски)
      m ? m[2] : title,                                // название без номера
      snip(desc),                                      // короткое описание для карточки
      isNaN(date) ? '' : date.toISOString().slice(0, 10),
      Math.round(duration(tag(it, 'itunes:duration')) / 60),
      +tag(it, 'itunes:season') || 0,
      +((tag(it, 'link').split('ep-')[1]) || 0),       // номер страницы выпуска на Mave
      g,
      file && file !== g + '.jpg' ? (image.startsWith(IMG_PREFIX) ? file : image) : '', // обложка, если её имя отличается от guid
      tags.map(x => x.toString(36)).join('')
    ];
  }).filter(Boolean).sort((a, b) => a[3] < b[3] ? 1 : -1);
}

async function main() {
  let xml;
  if (process.argv[2]) xml = fs.readFileSync(process.argv[2], 'utf8');          // node build.js feed.xml — для проверки
  else { const r = await fetch(FEED, { headers: { 'User-Agent': 'derzhitemp-feed (+github actions)' } }); if (!r.ok) throw new Error('RSS ' + r.status); xml = await r.text(); }
  const data = parse(xml);
  if (data.length < 50) throw new Error('В ленте подозрительно мало выпусков: ' + data.length + ' — файл не перезаписываю');
  const topics = DT_TOPICS.map(t => [t[0], t[1], t[4]]);
  const out = { v: 1, updated: new Date().toISOString(), count: data.length, topics: topics, data: data };
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  if (prev && JSON.stringify(prev.data) === JSON.stringify(data) && JSON.stringify(prev.topics) === JSON.stringify(topics)) { console.log('Без изменений:', data.length, 'выпусков'); return; }
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('Обновлено:', data.length, 'выпусков, свежий —', data[0][0], data[0][1].slice(0, 60));
}
main().catch(e => { console.error(e.message); process.exit(1); });
