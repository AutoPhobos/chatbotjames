export function setupKeyboard(inputElement, keyboardBtn, containerElement) {
    const layout = [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'],
        ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
        ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
        ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '↵'],
        ['space']
    ];

    let isShift = false;
    let isVisible = false;

    function render() {
        containerElement.innerHTML = '';
        layout.forEach(row => {
            const rowEl = document.createElement('div');
            rowEl.className = 'vk-row';
            row.forEach(key => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'vk-key';
                
                let displayKey = key;
                if (key === 'space') {
                    btn.classList.add('space', 'special');
                    displayKey = ' ';
                } else if (key === '⌫' || key === '⇧' || key === '↵') {
                    btn.classList.add('special');
                } else {
                    displayKey = isShift ? key.toUpperCase() : key;
                }
                
                btn.textContent = displayKey;
                
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    handleKey(key);
                });
                // Prevent focus stealing from input element
                btn.addEventListener('mousedown', e => e.preventDefault());
                
                rowEl.appendChild(btn);
            });
            containerElement.appendChild(rowEl);
        });
    }

    function handleKey(key) {
        if (key === '⇧') {
            isShift = !isShift;
            render();
            return;
        }

        let val = inputElement.value;
        const start = inputElement.selectionStart;
        const end = inputElement.selectionEnd;

        if (key === '⌫') {
            if (start > 0 || start !== end) {
                const deleteStart = start === end ? start - 1 : start;
                inputElement.value = val.substring(0, deleteStart) + val.substring(end);
                inputElement.setSelectionRange(deleteStart, deleteStart);
            }
        } else if (key === '↵') {
            // Trigger enter keydown event on input to submit
            inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        } else {
            const charToInsert = key === 'space' ? ' ' : (isShift ? key.toUpperCase() : key);
            inputElement.value = val.substring(0, start) + charToInsert + val.substring(end);
            inputElement.setSelectionRange(start + 1, start + 1);
            if (isShift) {
                isShift = false;
                render();
            }
        }
        inputElement.focus();
    }

    keyboardBtn.addEventListener('click', () => {
        isVisible = !isVisible;
        if (isVisible) {
            containerElement.classList.remove('hidden');
            render();
        } else {
            containerElement.classList.add('hidden');
        }
    });
}
