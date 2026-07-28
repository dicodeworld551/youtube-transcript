const WATCH_URL = 'https://www.youtube.com/watch?v=';
const TIMED_TEXT_URL = 'https://video.google.com/timedtext';

function createTranscriptError(message, statusCode, code, cause) {
  const error = Object.assign(new Error(message), { statusCode, code });
  if (cause) error.cause = cause;
  return error;
}

function logExtraction(message, details = {}) {
  console.error(`[transcript] ${message}`, details);
}

function extractVideoId(input) {
  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch (error) {
    logExtraction('Invalid URL', { input, reason: error.message });
    throw createTranscriptError('Enter a valid YouTube URL.', 400, 'INVALID_URL', error);
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  let videoId = '';

  if (host === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v') || '';
    } else if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/live/')) {
      videoId = parsed.pathname.split('/').filter(Boolean)[1] || '';
    }
  }

  if (!/^[\w-]{11}$/.test(videoId)) {
    logExtraction('Invalid YouTube URL or missing video ID', { input, host, pathname: parsed.pathname });
    throw createTranscriptError('Could not find a valid YouTube video ID in that URL.', 400, 'INVALID_VIDEO_ID');
  }

  return videoId;
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, '');
}

function normalizeCaptionText(value) {
  return decodeHtml(stripTags(value)).replace(/\s+/g, ' ').trim();
}

function extractJsonObjectAfter(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = html.indexOf('{', markerIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') inString = true;
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  return null;
}

function parsePlayerResponse(html) {
  const json = extractJsonObjectAfter(html, 'ytInitialPlayerResponse');
  if (!json) {
    throw createTranscriptError('Unable to read YouTube player metadata.', 502, 'PLAYER_METADATA_MISSING');
  }

  try {
    return JSON.parse(json);
  } catch (error) {
    throw createTranscriptError('Unable to parse YouTube player metadata.', 502, 'PLAYER_METADATA_PARSE_ERROR', error);
  }
}

function chooseTrack(captionTracks, preferredLang) {
  if (!captionTracks?.length) return null;

  if (preferredLang) {
    const requested = captionTracks.find((track) => track.languageCode === preferredLang || track.lang_code === preferredLang);
    if (requested) return requested;
  }

  return (
    captionTracks.find((track) => (track.languageCode || track.lang_code) === 'en' && track.kind !== 'asr') ||
    captionTracks.find((track) => (track.languageCode || track.lang_code) === 'en') ||
    captionTracks[0]
  );
}

function parseTranscriptXml(xml) {
  return [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => normalizeCaptionText(match[1]))
    .filter(Boolean)
    .join('\n');
}

function parseTranscriptJson3(jsonText) {
  const payload = JSON.parse(jsonText);
  return (payload.events || [])
    .filter((event) => Array.isArray(event.segs))
    .map((event) => event.segs.map((seg) => seg.utf8 || '').join(''))
    .map(normalizeCaptionText)
    .filter(Boolean)
    .join('\n');
}

function parseTimedTextTrackList(xml, videoId = '') {
  return [...xml.matchAll(/<track\b([^>]*)>/g)].map((match) => {
    const attrs = {};
    for (const attr of match[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[attr[1]] = decodeHtml(attr[2]);
    return {
      baseUrl: `${TIMED_TEXT_URL}?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(attrs.lang_code || '')}${attrs.kind ? `&kind=${encodeURIComponent(attrs.kind)}` : ''}`,
      languageCode: attrs.lang_code,
      kind: attrs.kind,
      name: { simpleText: attrs.name || attrs.lang_translated || attrs.lang_code }
    };
  }).filter((track) => track.languageCode);
}

async function fetchText(url, options, context) {
  const response = await fetch(url, options);
  if (response.status === 429) throw createTranscriptError('YouTube rate limited the transcript request.', 429, 'RATE_LIMITED');
  if (!response.ok) throw createTranscriptError(`${context} failed with HTTP ${response.status}.`, 502, 'YOUTUBE_API_ERROR');
  return response.text();
}

async function getTracksFromPlayer(videoId) {
  const html = await fetchText(`${WATCH_URL}${videoId}`, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }, 'Loading YouTube video page');
  const playerResponse = parsePlayerResponse(html);
  return {
    title: playerResponse?.videoDetails?.title || `YouTube video ${videoId}`,
    tracks: playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []
  };
}

async function getTracksFromTimedText(videoId) {
  const xml = await fetchText(`${TIMED_TEXT_URL}?type=list&v=${videoId}`, undefined, 'Loading YouTube timedtext caption list');
  return { title: `YouTube video ${videoId}`, tracks: parseTimedTextTrackList(xml, videoId) };
}

async function downloadTrack(track) {
  const transcriptUrl = new URL(track.baseUrl);
  transcriptUrl.searchParams.set('fmt', 'json3');
  let text = '';

  try {
    const raw = await fetchText(transcriptUrl, undefined, 'Downloading JSON caption track');
    text = parseTranscriptJson3(raw);
  } catch (error) {
    logExtraction('JSON caption parsing failed; retrying as XML', { reason: error.message, code: error.code });
  }

  if (!text) {
    transcriptUrl.searchParams.set('fmt', 'srv3');
    const raw = await fetchText(transcriptUrl, undefined, 'Downloading XML caption track');
    text = parseTranscriptXml(raw);
  }
  return text;
}

async function getTranscript(videoId, { lang } = {}) {
  const attempts = [getTracksFromPlayer, getTracksFromTimedText];
  const failures = [];

  for (const method of attempts) {
    try {
      const { title, tracks } = await method(videoId);
      logExtraction('Caption track lookup completed', { videoId, method: method.name, trackCount: tracks.length });
      const track = chooseTrack(tracks, lang);
      if (!track) {
        failures.push(`${method.name}: no caption tracks returned`);
        continue;
      }
      const text = await downloadTrack(track);
      if (!text) throw createTranscriptError('The selected caption track was empty.', 404, 'EMPTY_TRANSCRIPT');
      return {
        videoId,
        languageCode: track.languageCode || track.lang_code,
        languageName: track.name?.simpleText || track.name?.runs?.map((run) => run.text).join('') || track.languageCode || track.lang_code,
        title,
        text
      };
    } catch (error) {
      failures.push(`${method.name}: ${error.code || 'ERROR'} - ${error.message}`);
      logExtraction('Transcript extraction method failed', { videoId, method: method.name, code: error.code, reason: error.message });
      if (error.statusCode === 429) throw error;
    }
  }

  logExtraction('No transcript available after all extraction methods failed', { videoId, failures });
  throw createTranscriptError('No transcript available.', 404, 'NO_TRANSCRIPT_AVAILABLE');
}

module.exports = {
  chooseTrack,
  extractVideoId,
  normalizeCaptionText,
  parseTranscriptXml,
  parseTranscriptJson3,
  parsePlayerResponse,
  parseTimedTextTrackList,
  getTranscript
};
