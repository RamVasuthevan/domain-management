const transcriptsList = [];
const openaiKeyInput = document.getElementById('openaiKey');
const toggleBtn = document.getElementById('toggleBtn');
const copyAllBtn = document.getElementById('copyAllBtn');
const recordingTimer = document.getElementById('recordingTimer');
const transcriptsDiv = document.getElementById('transcripts');
const errorDisplay = document.getElementById('errorDisplay');
const autoCopyCheckbox = document.getElementById('autoCopyCheckbox');

let audioStream = null;
let mediaRecorder = null;
let audioChunks = [];
let timerInterval = null;
let startTime = null;
let isRecording = false;

window.addEventListener('beforeunload', (event) => {
  const hasPending = transcriptsList.some(t => t.status === 'pending');
  if (hasPending) {
    event.preventDefault();
    event.returnValue = 'You have pending transcriptions. Are you sure you want to leave?';
  }
});

// Helper function to stop the current recording and then start a new one
// This ensures we actually wait until the recording is fully stopped
function stopThenStartNew() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    // Listen once for the 'stop' event, then start a new recording
    const handler = () => {
      mediaRecorder.removeEventListener('stop', handler);
      startRecordingProcess();
    };
    mediaRecorder.addEventListener('stop', handler);
  }
  stopRecording();
}

document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName.toLowerCase();
  // Avoid toggling if user is typing in an input, textarea, or select
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  // Press Enter to toggle on/off
  if (e.code === 'Enter') {
    e.preventDefault();
    toggleRecording();
  }
  // Press Space to stop current and start new if running, or just start if stopped
  else if (e.code === 'Space') {
    e.preventDefault();
    if (isRecording) {
      // Stop and immediately begin a fresh new recording
      stopThenStartNew();
    } else {
      // If not currently recording, just start
      startRecordingProcess();
    }
  }
});

toggleBtn.addEventListener('click', () => {
  toggleRecording();
});

copyAllBtn.addEventListener('click', () => {
  copyAllTranscripts();
});

function toggleRecording() {
  resetError();
  const apiKey = openaiKeyInput.value.trim();
  if (!apiKey) {
    showError('Please enter a valid OpenAI API key.');
    return;
  }

  if (isRecording) {
    stopRecording();
  } else {
    startRecordingProcess();
  }
}

async function startRecordingProcess() {
  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    beginRecording();
  } catch (err) {
    showError('Could not get microphone access: ' + err.message);
  }
}

function beginRecording() {
  audioChunks = [];
  mediaRecorder = new MediaRecorder(audioStream);

  mediaRecorder.ondataavailable = (evt) => {
    if (evt.data.size > 0) audioChunks.push(evt.data);
  };

  mediaRecorder.onstop = handleRecordingStop;
  mediaRecorder.start();
  isRecording = true;
  toggleBtn.textContent = 'Stop Recording';

  startTime = Date.now();
  updateTimer();
  timerInterval = setInterval(updateTimer, 500);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
  }
  isRecording = false;
  toggleBtn.textContent = 'Start Recording';

  clearInterval(timerInterval);
  startTime = null;
  recordingTimer.textContent = '00:00';
}

async function handleRecordingStop() {
  const apiKey = openaiKeyInput.value.trim();
  if (!apiKey) {
    showError('OpenAI API key missing when stopping?');
    return;
  }

  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const entryIndex = transcriptsList.length;
  const newEntry = {
    blob: audioBlob,
    text: 'Transcribing...',
    status: 'pending',
    element: null
  };
  transcriptsList.push(newEntry);

  const uiElement = createTranscriptUI(entryIndex, newEntry.text, true);
  newEntry.element = uiElement;
  transcriptsDiv.appendChild(uiElement);

  try {
    const transcribedText = await sendAudioToOpenAI(audioBlob, apiKey);
    newEntry.text = transcribedText;
    newEntry.status = 'done';
    updateTranscriptUI(entryIndex, transcribedText, false);

    if (autoCopyCheckbox.checked) {
      copyAllTranscripts();
    }
  } catch (err) {
    newEntry.text = '[Error transcribing audio]';
    newEntry.status = 'error';
    updateTranscriptUI(entryIndex, newEntry.text, false, true);
    showError(err.message || err.toString());
  }
}

async function sendAudioToOpenAI(audioBlob, apiKey) {
  const formData = new FormData();
  const file = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });
  formData.append('file', file);
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error('OpenAI API error: ' + errText);
  }

  const result = await response.json();
  return result.text || JSON.stringify(result, null, 2);
}

function createTranscriptUI(index, text, showSpinner = false, isError = false) {
  const entryDiv = document.createElement('div');
  entryDiv.className = 'transcript-entry';
  entryDiv.dataset.index = index;

  const textSpan = document.createElement('div');
  textSpan.className = 'transcript-text';
  textSpan.textContent = text;

  if (showSpinner) {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.textContent = '⏳';
    textSpan.appendChild(spinner);
  }

  const buttonsDiv = document.createElement('div');
  buttonsDiv.className = 'entry-buttons';

  const copyButton = document.createElement('button');
  copyButton.textContent = 'Copy';
  copyButton.className = 'copyBtn';
  copyButton.addEventListener('click', () => {
    const copyText = textSpan.textContent.replace('⏳', '').trim();
    navigator.clipboard.writeText(copyText);
  });
  buttonsDiv.appendChild(copyButton);

  const retryButton = document.createElement('button');
  retryButton.textContent = 'Retry';
  retryButton.className = 'retryBtn hidden';
  retryButton.addEventListener('click', () => {
    retryTranscription(index);
  });
  buttonsDiv.appendChild(retryButton);

  entryDiv.appendChild(textSpan);
  entryDiv.appendChild(buttonsDiv);
  return entryDiv;
}

function updateTranscriptUI(index, newText, showSpinner = false, isError = false) {
  const entry = transcriptsList[index];
  if (!entry || !entry.element) return;

  const textSpan = entry.element.querySelector('.transcript-text');
  textSpan.textContent = newText;

  if (showSpinner) {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.textContent = '⏳';
    textSpan.appendChild(spinner);
  }

  const retryBtn = entry.element.querySelector('.retryBtn');
  if (isError) {
    retryBtn.classList.remove('hidden');
  } else {
    retryBtn.classList.add('hidden');
  }
}

async function retryTranscription(index) {
  const apiKey = openaiKeyInput.value.trim();
  if (!apiKey) {
    showError('Cannot retry: missing API key.');
    return;
  }
  const entry = transcriptsList[index];
  if (!entry) return;

  entry.status = 'pending';
  entry.text = 'Transcribing...';
  updateTranscriptUI(index, entry.text, true, false);

  try {
    const transcribedText = await sendAudioToOpenAI(entry.blob, apiKey);
    entry.text = transcribedText;
    entry.status = 'done';
    updateTranscriptUI(index, transcribedText, false, false);

    if (autoCopyCheckbox.checked) {
      copyAllTranscripts();
    }
  } catch (err) {
    entry.text = '[Error transcribing audio]';
    entry.status = 'error';
    updateTranscriptUI(index, entry.text, false, true);
    showError(err.message || err.toString());
  }
}

function copyAllTranscripts() {
  const allTexts = transcriptsList
    .map(e => e.text.replace('⏳','').trim())
    .filter(t => t && !t.startsWith('Transcribing...'));
  const combined = allTexts.join('\n\n');
  if (!combined) return;

  navigator.clipboard.writeText(combined).catch(err => showError(`Error copying all transcripts: ${err}`));
}

function updateTimer() {
  if (!startTime) {
    recordingTimer.textContent = '00:00';
    return;
  }
  const elapsedMs = Date.now() - startTime;
  const secs = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  recordingTimer.textContent = `${mm}:${ss}`;
}

function showError(msg) {
  errorDisplay.textContent = msg;
  errorDisplay.classList.remove('hidden');
}
function resetError() {
  errorDisplay.textContent = '';
  errorDisplay.classList.add('hidden');
}
