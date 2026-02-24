/**
 * Global Audio Manager
 * Coordinates multiple audio players, ensures only one plays at a time
 * Provides state for the transport bar
 */

class AudioManager {
    constructor() {
        this.players = {};          // Registered players by name
        this.activePlayerName = null;
        this.audio = new Audio();
        this.currentPlaylist = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.waveformData = null;

        // Callbacks for UI updates (arrays to support multiple listeners)
        this._stateChangeListeners = [];
        this._timeUpdateListeners = [];
        this._playlistChangeListeners = [];

        // Legacy callbacks for transport bar
        this.onStateChange = () => {};
        this.onTimeUpdate = () => {};
        this.onPlaylistChange = () => {};

        this.bindAudioEvents();
    }

    bindAudioEvents() {
        this.audio.addEventListener('timeupdate', () => {
            const time = {
                currentTime: this.audio.currentTime,
                duration: this.audio.duration || 0
            };
            this.onTimeUpdate(time);
            this._notifyTimeListeners(time);
        });

        this.audio.addEventListener('ended', () => {
            this.next();
        });

        this.audio.addEventListener('play', () => {
            this.isPlaying = true;
            this.notifyStateChange();
        });

        this.audio.addEventListener('pause', () => {
            this.isPlaying = false;
            this.notifyStateChange();
        });

        this.audio.addEventListener('error', (e) => {
            console.error('Audio error:', this.audio.error);
            this.isPlaying = false;
            this.notifyStateChange();
        });

        this.audio.addEventListener('loadedmetadata', () => {
            this.notifyStateChange();
            this.onTimeUpdate({
                currentTime: this.audio.currentTime,
                duration: this.audio.duration || 0
            });
        });
    }

    /**
     * Register a player with its playlist
     * @param {string} name - Unique identifier for this player
     * @param {Array} playlist - Array of {title, src} objects
     * @param {Object} options - Optional settings including artist, year
     */
    register(name, playlist, options = {}) {
        // Preserve existing waveforms if player already registered
        const existingWaveforms = this.players[name]?.waveforms || {};
        this.players[name] = {
            name,
            playlist,
            options,
            artist: options.artist || null,
            year: options.year || null,
            waveforms: existingWaveforms
        };
        this.onPlaylistChange(this.getPlaylists());
    }

    /**
     * Unregister a player (e.g., when navigating away)
     */
    unregister(name) {
        // If this was the active player, stop playback
        if (this.activePlayerName === name) {
            this.pause();
            this.activePlayerName = null;
            this.currentPlaylist = [];
        }
        delete this.players[name];
        this.onPlaylistChange(this.getPlaylists());
    }

    /**
     * Clear all players (called on navigation)
     */
    clearPlayers() {
        // Don't stop playback, just clear registrations
        // This allows audio to continue if same playlist exists on new page
        const wasActive = this.activePlayerName;
        const wasPlaying = this.isPlaying;
        const currentSrc = this.audio.src;
        const currentTime = this.audio.currentTime;

        // Destroy player instances to clean up listeners
        Object.values(this.players).forEach(player => {
            if (player.options?.player?.destroy) {
                player.options.player.destroy();
            }
        });

        this.players = {};

        // Store state for potential reconnection
        this._pendingReconnect = {
            playerName: wasActive,
            src: currentSrc,
            time: currentTime,
            playing: wasPlaying
        };

        // Notify transport bar that playlists changed
        this.onPlaylistChange(this.getPlaylists());
    }

    /**
     * Try to reconnect to a player after navigation
     */
    tryReconnect(name) {
        if (!this._pendingReconnect) return false;
        if (this._pendingReconnect.playerName !== name) return false;

        const player = this.players[name];
        if (!player) return false;

        // Check if any track in the playlist matches
        const matchIndex = player.playlist.findIndex(
            track => this._pendingReconnect.src.includes(track.src)
        );

        if (matchIndex >= 0) {
            this.activePlayerName = name;
            this.currentPlaylist = player.playlist;
            this.currentIndex = matchIndex;
            this._pendingReconnect = null;
            this.notifyStateChange();
            return true;
        }

        this._pendingReconnect = null;
        return false;
    }

    /**
     * Get list of all registered playlists
     */
    getPlaylists() {
        return Object.keys(this.players).map(name => ({
            name,
            trackCount: this.players[name].playlist.length,
            isActive: name === this.activePlayerName
        }));
    }

    /**
     * Switch to a different playlist
     */
    setActivePlaylist(name) {
        const player = this.players[name];
        if (!player) return;

        this.activePlayerName = name;
        this.currentPlaylist = player.playlist;
        this.loadTrack(0);
        this.notifyStateChange();
    }

    /**
     * Start playing a specific player's playlist
     */
    playPlaylist(name, startIndex = 0) {
        const player = this.players[name];
        if (!player) return;

        this.activePlayerName = name;
        this.currentPlaylist = player.playlist;
        this.loadTrack(startIndex);
        this.play();
    }

    loadTrack(index) {
        if (index < 0 || index >= this.currentPlaylist.length) return;

        this.currentIndex = index;
        const track = this.currentPlaylist[index];
        this.audio.src = track.src;
        this.notifyStateChange();
    }

    play() {
        if (this.currentPlaylist.length === 0) return;

        // Pause any playing videos
        if (window.videoManager) {
            window.videoManager.pauseAll();
        }

        const playPromise = this.audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error('Play error:', error);
                this.isPlaying = false;
                this.notifyStateChange();
            });
        }
    }

    pause() {
        this.audio.pause();
    }

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    next() {
        if (this.currentIndex < this.currentPlaylist.length - 1) {
            this.loadTrack(this.currentIndex + 1);
            this.play();
        } else {
            // Loop to beginning but don't auto-play
            this.loadTrack(0);
            this.pause();
        }
    }

    previous() {
        // If more than 3 seconds in, restart current track
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
        } else if (this.currentIndex > 0) {
            this.loadTrack(this.currentIndex - 1);
            if (this.isPlaying) this.play();
        }
    }

    seek(percent) {
        if (this.audio.duration) {
            this.audio.currentTime = percent * this.audio.duration;
        }
    }

    getCurrentTrack() {
        if (this.currentPlaylist.length === 0) return null;
        return this.currentPlaylist[this.currentIndex];
    }

    getState() {
        const player = this.activePlayerName ? this.players[this.activePlayerName] : null;
        return {
            isPlaying: this.isPlaying,
            currentTrack: this.getCurrentTrack(),
            currentIndex: this.currentIndex,
            playlistName: this.activePlayerName,
            playlistLength: this.currentPlaylist.length,
            currentTime: this.audio.currentTime,
            duration: this.audio.duration || 0,
            artist: player?.artist || null,
            year: player?.year || null
        };
    }

    notifyStateChange() {
        const state = this.getState();
        this.onStateChange(state);
        this._notifyStateListeners(state);
    }

    /**
     * Store waveform data for a track
     */
    setWaveform(playerName, trackIndex, data) {
        if (this.players[playerName]) {
            this.players[playerName].waveforms[trackIndex] = data;
        }
    }

    getWaveform(playerName, trackIndex) {
        return this.players[playerName]?.waveforms[trackIndex] || null;
    }

    getCurrentWaveform() {
        if (!this.activePlayerName) return null;
        return this.getWaveform(this.activePlayerName, this.currentIndex);
    }

    /**
     * Get active playlist with full track data for the transport dropdown
     */
    getActivePlaylistData() {
        if (!this.activePlayerName) return null;

        // Try to get from registered players first
        const playerData = this.getPlaylistData(this.activePlayerName);
        if (playerData) return playerData;

        // Fall back to cached data if player was cleared but audio is still playing
        if (this._cachedActivePlaylist && this._cachedActivePlaylist.name === this.activePlayerName) {
            return {
                ...this._cachedActivePlaylist,
                currentIndex: this.currentIndex
            };
        }

        return null;
    }

    /**
     * Get playlist data by name
     */
    getPlaylistData(name) {
        const player = this.players[name];
        if (!player) return null;

        const data = {
            name: player.name,
            artist: player.artist,
            year: player.year,
            tracks: player.playlist,
            currentIndex: name === this.activePlayerName ? this.currentIndex : -1
        };

        // Cache active playlist data for when player is cleared
        if (name === this.activePlayerName) {
            this._cachedActivePlaylist = {
                name: player.name,
                artist: player.artist,
                year: player.year,
                tracks: player.playlist
            };
        }

        return data;
    }

    /**
     * Add a state change listener (returns unsubscribe function)
     */
    addStateListener(callback) {
        this._stateChangeListeners.push(callback);
        return () => {
            const idx = this._stateChangeListeners.indexOf(callback);
            if (idx > -1) this._stateChangeListeners.splice(idx, 1);
        };
    }

    /**
     * Add a time update listener (returns unsubscribe function)
     */
    addTimeListener(callback) {
        this._timeUpdateListeners.push(callback);
        return () => {
            const idx = this._timeUpdateListeners.indexOf(callback);
            if (idx > -1) this._timeUpdateListeners.splice(idx, 1);
        };
    }

    /**
     * Notify all state listeners
     */
    _notifyStateListeners(state) {
        this._stateChangeListeners.forEach(cb => cb(state));
    }

    /**
     * Notify all time listeners
     */
    _notifyTimeListeners(time) {
        this._timeUpdateListeners.forEach(cb => cb(time));
    }
}

// Global singleton
window.audioManager = new AudioManager();
