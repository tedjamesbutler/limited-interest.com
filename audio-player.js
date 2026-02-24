/**
 * Audio Player Component with Waveform Visualization
 * Integrates with global AudioManager for transport bar control
 *
 * Usage: new AudioPlayer(containerElement, playlist, options)
 *
 * playlist = [
 *   { title: 'Track Name', src: '/path/to/audio.mp3' },
 *   ...
 * ]
 *
 * options = {
 *   name: 'Playlist Name',  // Required for AudioManager registration
 *   waveformColor: '#0066cc'
 * }
 */

class AudioPlayer {
    constructor(container, playlist, options = {}) {
        this.container = container;
        this.playlist = playlist;
        this.name = options.name || 'Untitled';
        this.artist = options.artist || null;
        this.year = options.year || null;
        this.currentIndex = 0;
        this.isPlaying = false;
        this.waveformColor = options.waveformColor || getComputedStyle(document.documentElement).getPropertyValue('--waveform-color').trim() || '#21EDD9';
        this.waveforms = {};

        // Master playlist mode: this player acts as an alias to a master playlist
        this.masterPlaylist = options.masterPlaylist || null;

        // Register with global AudioManager if available (only if not using master playlist)
        if (window.audioManager && !this.masterPlaylist) {
            window.audioManager.register(this.name, playlist, {
                player: this,
                artist: this.artist,
                year: this.year
            });
            window.audioManager.tryReconnect(this.name);
        }

        this.render();
        this.bindEvents();
        this.updateFromManager();
        this.generateAllWaveforms();
    }

    /**
     * Find track index in master playlist by matching src
     */
    findMasterIndex(localIndex) {
        if (!this.masterPlaylist || !window.audioManager) return -1;
        const localTrack = this.playlist[localIndex];
        if (!localTrack) return -1;

        const masterPlayer = window.audioManager.players[this.masterPlaylist];
        if (!masterPlayer) return -1;

        // Match by src (normalize for comparison)
        const localSrc = decodeURIComponent(localTrack.src);
        return masterPlayer.playlist.findIndex(t =>
            decodeURIComponent(t.src) === localSrc
        );
    }

    /**
     * Find local index from master playlist index
     */
    findLocalIndex(masterIndex) {
        if (!this.masterPlaylist || !window.audioManager) return -1;
        const masterPlayer = window.audioManager.players[this.masterPlaylist];
        if (!masterPlayer) return -1;

        const masterTrack = masterPlayer.playlist[masterIndex];
        if (!masterTrack) return -1;

        const masterSrc = decodeURIComponent(masterTrack.src);
        return this.playlist.findIndex(t =>
            decodeURIComponent(t.src) === masterSrc
        );
    }

    /**
     * Format track display with artist, title, album, and year
     * Format: "{artist} - {title} - {album} ({year})"
     */
    formatTrackDisplay(track) {
        const parts = [];
        if (this.artist) parts.push(this.artist);
        parts.push(track.title);
        if (this.name) parts.push(this.name);

        let display = parts.join(' - ');
        if (this.year) display += ` (${this.year})`;
        return display;
    }

    render() {
        this.container.classList.add('audio-player');
        const isSingleTrack = this.playlist.length === 1;

        // Add class for single-track styling
        if (isSingleTrack) {
            this.container.classList.add('single-track');
        }

        this.container.innerHTML = `
            <div class="now-playing"><span class="now-playing-inner"></span></div>
            <div class="controls">
                <button class="play-btn" aria-label="Play">&#9654;</button>
                <div class="progress-container">
                    <div class="progress-bar">
                        ${isSingleTrack ? '<canvas class="progress-waveform"></canvas>' : ''}
                        <div class="progress"></div>
                    </div>
                    <span class="time">0:00 / 0:00</span>
                </div>
            </div>
            ${!isSingleTrack ? '<div class="playlist"></div>' : ''}
        `;

        this.playBtn = this.container.querySelector('.play-btn');
        this.progressBar = this.container.querySelector('.progress-bar');
        this.progress = this.container.querySelector('.progress');
        this.timeDisplay = this.container.querySelector('.time');
        this.nowPlaying = this.container.querySelector('.now-playing');
        this.nowPlayingInner = this.container.querySelector('.now-playing-inner');
        this.playlistEl = this.container.querySelector('.playlist');
        this.progressWaveform = this.container.querySelector('.progress-waveform');

        if (this.playlistEl) {
            this.renderPlaylist();
        }

        // Size the progress waveform canvas
        if (this.progressWaveform) {
            this.resizeProgressWaveform();
            window.addEventListener('resize', () => this.resizeProgressWaveform());
        }

        this.updateNowPlaying(this.playlist[0]);
    }

    resizeProgressWaveform() {
        if (!this.progressWaveform) return;
        const rect = this.progressBar.getBoundingClientRect();
        this.progressWaveform.width = rect.width * window.devicePixelRatio;
        this.progressWaveform.height = rect.height * window.devicePixelRatio;
        this.progressWaveform.style.width = rect.width + 'px';
        this.progressWaveform.style.height = rect.height + 'px';
        // Redraw if we have waveform data
        if (this.waveforms[0]) {
            this.drawWaveform(this.progressWaveform, this.waveforms[0]);
        }
    }

    renderPlaylist() {
        this.playlistEl.innerHTML = this.playlist.map((track, i) =>
            `<div class="playlist-item${i === this.currentIndex ? ' active' : ''}" data-index="${i}">
                <span class="track-title"><span class="track-title-inner">${this.formatPlaylistItem(track, i)}</span></span>
                <canvas class="waveform" data-index="${i}"></canvas>
            </div>`
        ).join('');

        // Size canvases for retina displays
        this.playlistEl.querySelectorAll('canvas.waveform').forEach(canvas => {
            const rect = canvas.getBoundingClientRect();
            const width = rect.width || 100;
            const height = rect.height || 20;
            canvas.width = width * window.devicePixelRatio;
            canvas.height = height * window.devicePixelRatio;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
        });

        // Check for scrolling titles after layout
        requestAnimationFrame(() => this.updatePlaylistScrolling());
    }

    /**
     * Check playlist items for overflow and add scrolling animation
     */
    updatePlaylistScrolling() {
        if (!this.playlistEl) return;

        this.playlistEl.querySelectorAll('.playlist-item').forEach(item => {
            const titleContainer = item.querySelector('.track-title');
            const titleInner = item.querySelector('.track-title-inner');
            if (!titleContainer || !titleInner) return;

            const containerWidth = titleContainer.offsetWidth;
            const textWidth = titleInner.scrollWidth;

            if (textWidth > containerWidth) {
                const scrollDistance = textWidth - containerWidth + 20;
                const scrollDuration = Math.max(8, scrollDistance / 30);

                titleContainer.style.setProperty('--scroll-distance', `-${scrollDistance}px`);
                titleContainer.style.setProperty('--scroll-duration', `${scrollDuration}s`);
                titleContainer.classList.add('scrolling');
            } else {
                titleContainer.classList.remove('scrolling');
            }
        });
    }

    /**
     * Format a playlist item with full metadata
     * Format: "{artist} - {track#}. {title} - {album} ({year})"
     */
    formatPlaylistItem(track, index) {
        const parts = [];
        if (this.artist) parts.push(this.artist);
        parts.push(`${index + 1}. ${track.title}`);
        if (this.name) parts.push(this.name);

        let display = parts.join(' - ');
        if (this.year) display += ` (${this.year})`;
        return display;
    }

    async generateAllWaveforms() {
        // Wait for DOM to be fully ready
        await new Promise(resolve => requestAnimationFrame(resolve));

        // Load first track immediately
        await this.generateWaveform(0);

        // Defer the rest until browser is idle
        const loadRest = async () => {
            for (let i = 1; i < this.playlist.length; i++) {
                await this.generateWaveform(i);
            }
        };
        if (window.requestIdleCallback) {
            requestIdleCallback(() => loadRest());
        } else {
            setTimeout(() => loadRest(), 2000);
        }
    }

    async generateWaveform(index) {
        const track = this.playlist[index];

        // Find the appropriate canvas
        let canvas;
        if (this.progressWaveform && index === 0) {
            // Single-track player uses progress bar canvas
            canvas = this.progressWaveform;
        } else if (this.playlistEl) {
            // Multi-track player uses playlist canvases
            canvas = this.playlistEl.querySelector(`canvas[data-index="${index}"]`);
        }

        if (!canvas) {
            // Still load and store waveform even without canvas for transport bar
            const waveformData = await this.loadWaveformJson(track.src);
            if (waveformData) {
                this.waveforms[index] = waveformData;
                if (window.audioManager) {
                    window.audioManager.setWaveform(this.name, index, waveformData);
                }
            }
            return;
        }

        // Load pre-generated waveform JSON
        // We don't fall back to decoding full audio files as this causes
        // memory issues on mobile devices (iOS crashes with large MP3s)
        const waveformData = await this.loadWaveformJson(track.src);
        if (waveformData) {
            this.drawWaveform(canvas, waveformData);
            this.waveforms[index] = waveformData;
            if (window.audioManager) {
                window.audioManager.setWaveform(this.name, index, waveformData);
            }
        }
        // If no JSON available, waveform simply won't display
    }

    async loadWaveformJson(audioSrc) {
        // Convert audio path to waveform JSON path
        // Try multiple locations:
        // 1. Same directory: /head-dress/foo.mp3 -> /head-dress/waveforms/foo.json
        // 2. Parent directory: /norelcomori/episodes/foo.mp3 -> /norelcomori/waveforms/foo.json
        const parts = audioSrc.split('/');
        const filename = parts.pop().replace(/\.[^.]+$/, '');
        const dir = parts.join('/');

        // Paths to try
        const pathsToTry = [
            `${dir}/waveforms/${filename}.json`,  // same directory
        ];

        // If there's a parent directory, also try that
        if (parts.length > 1) {
            const parentDir = parts.slice(0, -1).join('/');
            pathsToTry.push(`${parentDir}/waveforms/${filename}.json`);
        }

        for (const jsonPath of pathsToTry) {
            try {
                const response = await fetch(jsonPath);
                if (response.ok) {
                    return await response.json();
                }
            } catch (e) {
                // Try next path
            }
        }
        return null;
    }

    drawWaveform(canvas, data) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Create gradient from blue to waveform color
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const blueColor = isDark ? '#6db3f2' : '#0066cc';
        gradient.addColorStop(0, blueColor);
        gradient.addColorStop(1, this.waveformColor);
        ctx.fillStyle = gradient;

        // Draw as a continuous filled path for truly solid waveform
        ctx.beginPath();
        ctx.moveTo(0, height / 2);

        // Top edge
        data.forEach((value, i) => {
            const x = (i / data.length) * width;
            const barHeight = value * height * 0.9;
            const y = (height - barHeight) / 2;
            ctx.lineTo(x, y);
        });
        ctx.lineTo(width, height / 2);

        // Bottom edge (reverse)
        for (let i = data.length - 1; i >= 0; i--) {
            const x = (i / data.length) * width;
            const barHeight = data[i] * height * 0.9;
            const y = (height + barHeight) / 2;
            ctx.lineTo(x, y);
        }

        ctx.closePath();
        ctx.fill();
    }

    bindEvents() {
        this.playBtn.addEventListener('click', () => this.togglePlay());

        this.progressBar.addEventListener('click', (e) => {
            const rect = this.progressBar.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            const targetPlaylist = this.masterPlaylist || this.name;
            if (window.audioManager && window.audioManager.activePlayerName === targetPlaylist) {
                window.audioManager.seek(percent);
            }
        });

        if (this.playlistEl) {
            this.playlistEl.addEventListener('click', (e) => {
                const item = e.target.closest('.playlist-item');
                if (item) {
                    const index = parseInt(item.dataset.index);
                    if (window.audioManager) {
                        if (this.masterPlaylist) {
                            // Play from master playlist at the matching position
                            const masterIndex = this.findMasterIndex(index);
                            if (masterIndex >= 0) {
                                window.audioManager.playPlaylist(this.masterPlaylist, masterIndex);
                            }
                        } else {
                            window.audioManager.playPlaylist(this.name, index);
                        }
                    }
                }
            });
        }

        // Listen for AudioManager state changes using proper listener system
        // This avoids callback chain buildup that causes memory issues on iOS
        if (window.audioManager) {
            this._unsubscribeState = window.audioManager.addStateListener((state) => {
                this.handleManagerState(state);
            });

            this._unsubscribeTime = window.audioManager.addTimeListener((time) => {
                const targetPlaylist = this.masterPlaylist || this.name;
                if (window.audioManager.activePlayerName === targetPlaylist) {
                    // In master mode, only update if current track is in this album
                    if (this.masterPlaylist) {
                        const localIndex = this.findLocalIndex(window.audioManager.currentIndex);
                        if (localIndex >= 0) {
                            this.updateProgress(time);
                        }
                    } else {
                        this.updateProgress(time);
                    }
                }
            });
        }
    }

    /**
     * Clean up listeners when player is destroyed
     */
    destroy() {
        if (this._unsubscribeState) this._unsubscribeState();
        if (this._unsubscribeTime) this._unsubscribeTime();
    }

    handleManagerState(state) {
        const targetPlaylist = this.masterPlaylist || this.name;

        // Check if this player's content is currently playing
        if (state.playlistName === targetPlaylist) {
            // Find local index from master index if in master mode
            const localIndex = this.masterPlaylist
                ? this.findLocalIndex(state.currentIndex)
                : state.currentIndex;

            // Only show as playing if current track is in this album
            const isTrackInThisAlbum = localIndex >= 0;

            this.isPlaying = state.isPlaying && isTrackInThisAlbum;
            this.currentIndex = isTrackInThisAlbum ? localIndex : 0;
            this.playBtn.innerHTML = (state.isPlaying && isTrackInThisAlbum) ? '&#10074;&#10074;' : '&#9654;';
            this.playBtn.setAttribute('aria-label', (state.isPlaying && isTrackInThisAlbum) ? 'Pause' : 'Play');

            if (isTrackInThisAlbum && state.currentTrack) {
                this.updateNowPlaying(state.currentTrack);
            }

            if (this.playlistEl) {
                this.playlistEl.querySelectorAll('.playlist-item').forEach((el, i) => {
                    el.classList.toggle('active', isTrackInThisAlbum && i === localIndex);
                });
            }
        } else {
            // Another player is active, show paused state
            this.isPlaying = false;
            this.playBtn.innerHTML = '&#9654;';
            this.playBtn.setAttribute('aria-label', 'Play');

            if (this.playlistEl) {
                this.playlistEl.querySelectorAll('.playlist-item').forEach(el => {
                    el.classList.remove('active');
                });
            }
        }
    }

    updateFromManager() {
        if (window.audioManager) {
            const state = window.audioManager.getState();
            const targetPlaylist = this.masterPlaylist || this.name;
            if (state.playlistName === targetPlaylist) {
                this.handleManagerState(state);
            }
        }
    }

    togglePlay() {
        if (window.audioManager) {
            if (this.masterPlaylist) {
                // Master playlist mode
                // Check if current track is in THIS album
                const localIndex = this.findLocalIndex(window.audioManager.currentIndex);
                const isPlayingThisAlbum = window.audioManager.activePlayerName === this.masterPlaylist && localIndex >= 0;

                if (isPlayingThisAlbum) {
                    // Currently playing this album - toggle play/pause
                    window.audioManager.togglePlay();
                } else {
                    // Playing different album or paused - start this album
                    const masterIndex = this.findMasterIndex(0);
                    if (masterIndex >= 0) {
                        window.audioManager.playPlaylist(this.masterPlaylist, masterIndex);
                    }
                }
            } else {
                if (window.audioManager.activePlayerName === this.name) {
                    window.audioManager.togglePlay();
                } else {
                    // Start this playlist
                    window.audioManager.playPlaylist(this.name, 0);
                }
            }
        }
    }

    updateProgress(time) {
        const percent = time.duration ? (time.currentTime / time.duration) * 100 : 0;
        this.progress.style.width = percent + '%';
        this.timeDisplay.textContent = `${this.formatTime(time.currentTime)} / ${this.formatTime(time.duration)}`;
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Update now playing display with scroll detection
     */
    updateNowPlaying(track) {
        if (!track || !this.nowPlayingInner) return;

        const displayText = this.formatTrackDisplay(track);
        this.nowPlayingInner.textContent = displayText;

        // Check if text overflows and needs scrolling
        requestAnimationFrame(() => {
            const containerWidth = this.nowPlaying.offsetWidth;
            const textWidth = this.nowPlayingInner.scrollWidth;

            if (textWidth > containerWidth) {
                const scrollDistance = textWidth - containerWidth + 20; // 20px padding
                const scrollDuration = Math.max(8, scrollDistance / 30); // ~30px/sec

                this.nowPlaying.style.setProperty('--scroll-distance', `-${scrollDistance}px`);
                this.nowPlaying.style.setProperty('--scroll-duration', `${scrollDuration}s`);
                this.nowPlaying.classList.add('scrolling');
            } else {
                this.nowPlaying.classList.remove('scrolling');
            }
        });
    }
}
