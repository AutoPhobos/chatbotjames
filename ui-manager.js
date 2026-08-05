class UIManager {
    constructor() {
        this.cmdInput = document.getElementById('cmdInput')
            || document.getElementById('userInput')
            || document.getElementById('user-input');

        this.sendBtn = document.getElementById('sendBtn')
            || document.getElementById('sendButton')
            || document.getElementById('send-button');

        this.statusTextEl = document.getElementById('statusText');
        this.progressFillEl = document.querySelector('.progress-fill');
        this.statusMetaEl = document.querySelector('.status-meta');
        this.activeModelLabel = document.getElementById('activeModelLabel');
        this.applyModelBtn = document.getElementById('applyModelBtn');
    }

    setIdleState(isIdle, isGeneratingUIFlagCallback) {
        if (!this.cmdInput || !this.sendBtn) return;
        if (isIdle) {
            this.cmdInput.disabled = false;
            this.sendBtn.innerHTML = '➔';
            this.sendBtn.classList.remove('stop-btn');
            
            this.cmdInput.classList.remove('loading-state');
            this.cmdInput.placeholder = "Message JAMES...";
            this.cmdInput.focus();
            if (isGeneratingUIFlagCallback) isGeneratingUIFlagCallback(false);
        } else {
            this.cmdInput.classList.add('loading-state');
            this.cmdInput.placeholder = "Generating response...";
            
            this.sendBtn.innerHTML = '⏸';
            this.sendBtn.classList.add('stop-btn');
            if (isGeneratingUIFlagCallback) isGeneratingUIFlagCallback(true);
        }
    }

    updateStatusText(text) {
        if (this.statusTextEl) this.statusTextEl.textContent = text;
    }

    updateStatusMeta(text) {
        if (this.statusMetaEl) this.statusMetaEl.innerText = text;
    }

    updateProgress(percent) {
        if (this.progressFillEl) this.progressFillEl.style.width = `${percent}%`;
    }

    updateActiveModelLabel(label) {
        if (this.activeModelLabel) this.activeModelLabel.textContent = `Active: ${label}`;
        if (this.applyModelBtn) this.applyModelBtn.disabled = true;
    }

    resetApplyModelBtn() {
        if (this.applyModelBtn) this.applyModelBtn.disabled = false;
    }

    showAppendBanner(active) {
        const banner = document.getElementById('appendModeBanner');
        const inputWrapper = document.querySelector('.input-wrapper');

        if (active) {
            banner?.classList.remove('hidden');
            inputWrapper?.classList.add('append-active');
            this.cmdInput?.focus();
        } else {
            banner?.classList.add('hidden');
            inputWrapper?.classList.remove('append-active');
        }
    }

    closeSidebar() {
        document.getElementById('sidebar')?.classList.add('collapsed');
        document.getElementById('sidebarOverlay')?.classList.remove('visible');
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const nowCollapsed = sidebar?.classList.toggle('collapsed');
        overlay?.classList.toggle('visible', !nowCollapsed);
        return nowCollapsed; // To save to localStorage
    }

    initTVMode() {
        document.body.classList.add('tv-mode');
        document.getElementById('sidebar')?.classList.add('collapsed');
    }

    initSidebarState(savedSidebarState) {
        if (savedSidebarState === 'true' || window.innerWidth <= 768) {
            document.getElementById('sidebar')?.classList.add('collapsed');
        } else if (savedSidebarState === 'false') {
            document.getElementById('sidebar')?.classList.remove('collapsed');
        }
    }

    getWelcomeMessage(isMobileDevice, isTVDevice, showTools = true) {
        if (isMobileDevice) return this.getLightweightWelcomeMessage(showTools);
        if (isTVDevice) return this.getTVWelcomeMessage(showTools);
        return this.getFullWelcomeMessage(showTools);
    }

    getLightweightWelcomeMessage(showTools) {
        const toolsHtml = showTools ? `
            <div class="welcome-box-tools">
                <span class="tool-tag">web_search</span>
                <span class="tool-tag">make_move</span>
            </div>
        ` : '';
        return {
            role: 'system',
            content: `JAMES (Mobile Mode) is online.\n${showTools ? 'Tools enabled.' : 'Tools disabled.'}`,
            displayContent: `
                <div class="welcome-box">
                    <div class="welcome-box-header">⚡ JAMES Mobile Edition</div>
                    <div class="welcome-box-body">Optimized for lightweight devices. Keep prompts concise.</div>
                    ${toolsHtml}
                </div>
            `
        };
    }

    getFullWelcomeMessage(showTools) {
        const toolsHtml = showTools ? `
            <div class="welcome-box-tools">
                <span class="tool-tag">web_search</span>
                <span class="tool-tag">wikipedia</span>
                <span class="tool-tag">eval_python</span>
                <span class="tool-tag">get_current_weather</span>
                <span class="tool-tag">make_move</span>
            </div>
        ` : '';
        return {
            role: 'system',
            content: `JAMES is online and fully initialized.\n${showTools ? 'Tools available:\n- web_search\n- wikipedia\n- eval_python\n- get_current_weather\n- make_move' : 'Tools disabled.'}`,
            displayContent: `
                <div class="welcome-box">
                    <div class="welcome-box-header">👋 Hello, I'm JAMES.</div>
                    <div class="welcome-box-body">I'm a local WebGPU AI. I run entirely on your device for maximum privacy.</div>
                    ${toolsHtml}
                </div>
            `
        };
    }

    getTVWelcomeMessage(showTools) {
        const toolsHtml = showTools ? `
            <div class="welcome-box-tools">
                <span class="tool-tag" style="font-size: 1.2rem; padding: 6px 12px;">web_search</span>
            </div>
        ` : '';
        return {
            role: 'system',
            content: `JAMES TV Edition is online.`,
            displayContent: `
                <div class="welcome-box" style="padding: 24px;">
                    <div class="welcome-box-header" style="font-size: 1.5rem;">📺 JAMES TV Edition</div>
                    <div class="welcome-box-body" style="font-size: 1.2rem;">Use voice input on your remote to chat.</div>
                    ${toolsHtml}
                </div>
            `
        };
    }
}

export const uiManager = new UIManager();
