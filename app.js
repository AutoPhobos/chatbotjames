const chatStream = document.getElementById('chat-stream');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const statusBadge = document.getElementById('status-badge');

const aiWorker = new Worker('worker.js');

aiWorker.onmessage = function (e) {
  const { type, payload } = e.data;
  switch (type) {
    case 'MODEL_READY':
      statusBadge.textContent = 'Engine Ready (WebGPU)';
      statusBadge.className = 'badge ready';
      break;
    case 'MODEL_READY_SIMULATED':
      statusBadge.textContent = 'Engine Ready (Simulated)';
      statusBadge.className = 'badge ready';
      break;
    case 'STREAM_START':
      appendMessage('assistant', '');
      break;
    case 'STREAM_CHUNK':
      updateLastMessage(payload);
      break;
    case 'ERROR':
      console.error(payload);
      statusBadge.textContent = 'Engine Error';
      statusBadge.className = 'badge loading';
      break;
  }
};

aiWorker.postMessage({
  type: 'INIT_MODEL',
  payload: { modelPath: './models/model.onnx' }
});

function appendMessage(sender, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${sender}`;
  msgDiv.textContent = text;
  chatStream.appendChild(msgDiv);
  chatStream.scrollTop = chatStream.scrollHeight;
}

function updateLastMessage(text) {
  const messages = chatStream.querySelectorAll('.message.assistant');
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    lastMsg.textContent += text;
    chatStream.scrollTop = chatStream.scrollHeight;
  }
}

async function handleSend() {
  const text = userInput.value.trim();
  if (!text) return;

  appendMessage('user', text);
  userInput.value = '';
  userInput.style.height = 'auto';

  if (text.startsWith('/tool ')) {
    const parts = text.replace('/tool ', '').split(' ');
    const toolName = parts[0];
    const argText = parts.slice(1).join(' ');
    const result = await toolRouter.execute(toolName, { text: argText });
    appendMessage('assistant', JSON.stringify(result, null, 2));
    return;
  }

  aiWorker.postMessage({
    type: 'RUN_INFERENCE',
    payload: { prompt: text }
  });
}

sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

userInput.addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = `${this.scrollHeight}px`;
});
