const form = document.querySelector('#transcript-form');
const input = document.querySelector('#youtube-url');
const statusMessage = document.querySelector('#status');
const result = document.querySelector('#result');
const title = document.querySelector('#video-title');
const language = document.querySelector('#language');
const transcript = document.querySelector('#transcript');
const download = document.querySelector('#download');

let currentTranscript = null;

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = isError ? '#b91c1c' : '#475569';
}

function fileSafeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || 'youtube-transcript';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  result.hidden = true;
  setStatus('Fetching captions from YouTube...');

  try {
    const response = await fetch(`/api/transcript?url=${encodeURIComponent(input.value)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to fetch transcript.');
    }

    currentTranscript = payload;
    title.textContent = payload.title;
    language.textContent = `Language: ${payload.languageName} (${payload.languageCode})`;
    transcript.value = payload.text;
    result.hidden = false;
    setStatus('Transcript ready. Preview it below or download it as a .txt file.');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

download.addEventListener('click', () => {
  if (!currentTranscript) return;

  const blob = new Blob([currentTranscript.text], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${fileSafeName(currentTranscript.title)}-${currentTranscript.videoId}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
});
