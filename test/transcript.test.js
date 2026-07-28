const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseTrack,
  extractVideoId,
  normalizeCaptionText,
  parseTranscriptXml,
  parseTranscriptJson3,
  parseTimedTextTrackList
} = require('../src/transcript');

test('extractVideoId supports common YouTube URL formats', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ?t=42'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
});

test('extractVideoId rejects non-YouTube URLs', () => {
  assert.throws(() => extractVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), /valid YouTube video ID/);
});

test('chooseTrack prefers the requested language, then English, then first track', () => {
  const tracks = [
    { languageCode: 'es', name: { simpleText: 'Spanish' } },
    { languageCode: 'en', kind: 'asr', name: { simpleText: 'English auto' } },
    { languageCode: 'fr', name: { simpleText: 'French' } }
  ];

  assert.equal(chooseTrack(tracks, 'fr').languageCode, 'fr');
  assert.equal(chooseTrack(tracks).languageCode, 'en');
  assert.equal(chooseTrack([{ languageCode: 'es' }]).languageCode, 'es');
});

test('parseTranscriptXml turns caption XML into readable plain text', () => {
  const xml = '<transcript><text start="0" dur="1">Hello &amp; welcome</text><text start="1" dur="1"><b>to</b> YouTube</text></transcript>';
  assert.equal(parseTranscriptXml(xml), 'Hello & welcome\nto YouTube');
});

test('normalizeCaptionText strips tags, decodes entities, and collapses whitespace', () => {
  assert.equal(normalizeCaptionText('<i>A&nbsp; B</i> &quot;C&quot;'), 'A B "C"');
});

test('parseTranscriptJson3 preserves caption event order', () => {
  const json = JSON.stringify({
    events: [
      { tStartMs: 0, segs: [{ utf8: 'First ' }, { utf8: 'line' }] },
      { tStartMs: 1000, segs: [{ utf8: 'Second line' }] }
    ]
  });
  assert.equal(parseTranscriptJson3(json), 'First line\nSecond line');
});

test('parseTimedTextTrackList includes manual and auto-generated caption tracks', () => {
  const xml = '<transcript_list><track id="0" name="English" lang_code="en" lang_translated="English"/><track id="1" name="English auto" lang_code="en" lang_translated="English" kind="asr"/></transcript_list>';
  const tracks = parseTimedTextTrackList(xml, 'dQw4w9WgXcQ');
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].languageCode, 'en');
  assert.equal(tracks[1].kind, 'asr');
  assert.match(tracks[0].baseUrl, /v=dQw4w9WgXcQ/);
});
