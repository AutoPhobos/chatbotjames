export function setupAudioDictation(inputElement, micBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        micBtn.style.display = 'none';
        console.warn('Speech Recognition API not supported in this browser.');
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    let isRecording = false;
    let finalTranscript = '';

    recognition.onstart = () => {
        isRecording = true;
        micBtn.classList.add('recording');
        finalTranscript = inputElement.value; // Keep existing text
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }
        inputElement.value = finalTranscript + interimTranscript;
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        stopRecording();
    };

    recognition.onend = () => {
        // If it was meant to be recording but stopped (e.g. timeout), restart it or handle UI state
        stopRecording();
    };

    function startRecording() {
        try {
            recognition.start();
        } catch(e) {
            console.error('Could not start recognition:', e);
        }
    }

    function stopRecording() {
        isRecording = false;
        micBtn.classList.remove('recording');
        try {
            recognition.stop();
        } catch(e) {}
    }

    micBtn.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });
}
