const WATCH_URL = 'https://www.youtube.com/watch?v=';

function extractVideoId(input) {
  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw Object.assign(new Error('Enter a valid YouTube URL.'), { statusCode: 400 });
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  let videoId = '';

  if (host === 'youtu.be') {
    videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
  } else if (host.endsWith('youtube.com')) {
    if (parsed.pathname === '/watch') {
      videoId = parsed.searchParams.get('v') || '';
    } else if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.split('/').filter(Boolean)[1] || '';
    }
  }

  if (!/^[\w-]{11}$/.test(videoId)) {
    throw Object.assign(new Error('Could not find a valid YouTube video ID in that URL.'), { statusCode: 400 });
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
    .replace(/&#x27;/g, "'");
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, '');
}

function normalizeCaptionText(value) {
  return decodeHtml(stripTags(value)).replace(/\s+/g, ' ').trim();
}

function parsePlayerResponse(html) {
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;<\/script>/s,
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*var/s
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return JSON.parse(match[1]);
    }
  }

  throw Object.assign(new Error('Unable to read YouTube player metadata.'), { statusCode: 502 });
}

function chooseTrack(captionTracks, preferredLang) {
  if (!captionTracks?.length) {
    return null;
  }

  if (preferredLang) {
    const requested = captionTracks.find((track) => track.languageCode === preferredLang);
    if (requested) return requested;
  }

  return (
    captionTracks.find((track) => track.languageCode === 'en' && track.kind !== 'asr') ||
    captionTracks.find((track) => track.languageCode === 'en') ||
    captionTracks[0]
  );
}

function parseTranscriptXml(xml) {
  return [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map((match) => normalizeCaptionText(match[1]))
    .filter(Boolean)
    .join('\n');
}

async function getTranscript(videoId, { lang } = {}) {
  const watchResponse = await fetch(`${WATCH_URL}${videoId}`, {
    headers: { 'Accept-Language': 'en-US,en;q=0.9' }
  });

  if (!watchResponse.ok) {
    throw Object.assign(new Error('Could not load the YouTube video page.'), { statusCode: 502 });
  }

  const html = await watchResponse.text();
  const playerResponse = parsePlayerResponse(html);
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  const track = chooseTrack(tracks, lang);

  if (!track) {
    throw Object.assign(new Error('This video does not expose captions or transcripts.'), { statusCode: 404 });
  }

  const transcriptUrl = new URL(track.baseUrl);
  transcriptUrl.searchParams.set('fmt', 'srv3');
  const transcriptResponse = await fetch(transcriptUrl);

  if (!transcriptResponse.ok) {
    throw Object.assign(new Error('Could not download the selected caption track.'), { statusCode: 502 });
  }

  const xml = await transcriptResponse.text();
  const text = parseTranscriptXml(xml);

  if (!text) {
    throw Object.assign(new Error('The selected caption track was empty.'), { statusCode: 404 });
  }

  return {
    videoId,
    languageCode: track.languageCode,
    languageName: track.name?.simpleText || track.name?.runs?.map((run) => run.text).join('') || track.languageCode,
    title: playerResponse?.videoDetails?.title || `YouTube video ${videoId}`,
    text
  };
}

module.exports = {
  chooseTrack,
  extractVideoId,
  normalizeCaptionText,
  parseTranscriptXml,
  getTranscript
};
