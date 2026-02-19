import { db } from './firebase-init.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class MusiqueComponent {
  constructor(options = {}) {
    if (window.__vitchMusicComponent) {
      return window.__vitchMusicComponent;
    }

    this.options = {
      configCollection: 'siteMusicConfig',
      configDocId: 'main',
      audioBasePath: './',
      defaultVolume: 0.35,
      ...options
    };

    this.storage = {
      choice: 'vitch_music_choice',
      hidePrompt: 'vitch_music_hide_prompt',
      dismissedSession: 'vitch_music_session_dismissed',
      playbackTime: 'vitch_music_playback_time',
      bubblePosX: 'vitch_music_bubble_x',
      bubblePosY: 'vitch_music_bubble_y'
    };

    this.config = null;
    this.audio = null;
    this.modal = null;
    this.controlBubble = null;
    this.needsRetryAfterGesture = false;
    this.gestureRetryBound = false;
    this.lastPersistedSecond = -1;

    window.__vitchMusicComponent = this;
    this.init();
  }

  async init() {
    try {
      await this.loadConfig();
      if (!this.isConfigPlayable()) return;
      this.mountAudio();
      this.bindLifecycle();
      this.handleStartupDecision();
    } catch (error) {
      console.error('❌ Musique: erreur init', error);
    }
  }

  async loadConfig() {
    const configRef = doc(db, this.options.configCollection, this.options.configDocId);
    const snapshot = await getDoc(configRef);

    if (!snapshot.exists()) {
      this.config = {
        isActive: false,
        mp3FileName: ''
      };
      return;
    }

    this.config = snapshot.data() || {};
  }

  isConfigPlayable() {
    if (!this.config) return false;
    if (this.config.isActive === false) return false;
    return Boolean((this.config.mp3FileName || '').trim());
  }

  resolveAudioPath(fileName) {
    if (!fileName) return '';
    if (fileName.startsWith('http://') || fileName.startsWith('https://')) return fileName;
    const cleanName = fileName.split('/').pop();
    return `${this.options.audioBasePath}${cleanName}`;
  }

  mountAudio() {
    const src = this.resolveAudioPath((this.config.mp3FileName || '').trim());
    if (!src) return;

    this.audio = new Audio(src);
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.volume = Math.min(1, Math.max(0, Number(this.options.defaultVolume) || 0.35));

    const savedTime = Number(localStorage.getItem(this.storage.playbackTime));
    if (Number.isFinite(savedTime) && savedTime > 0) {
      this.audio.addEventListener('loadedmetadata', () => {
        try {
          const maxTime = Math.max(0, (this.audio.duration || savedTime) - 0.25);
          this.audio.currentTime = Math.min(savedTime, maxTime);
        } catch (error) {
          console.warn('⚠️ Musique: reprise position impossible', error);
        }
      }, { once: true });
    }
  }

  bindLifecycle() {
    const persistTime = () => {
      if (!this.audio) return;
      const sec = Math.floor(this.audio.currentTime || 0);
      if (sec !== this.lastPersistedSecond && sec >= 0) {
        this.lastPersistedSecond = sec;
        localStorage.setItem(this.storage.playbackTime, String(sec));
      }
    };

    this.audio?.addEventListener('timeupdate', persistTime);

    const pauseAudio = () => {
      persistTime();
      if (!this.audio) return;
      this.audio.pause();
    };

    window.addEventListener('pagehide', pauseAudio);
    window.addEventListener('beforeunload', pauseAudio);
  }

  handleStartupDecision() {
    const savedChoice = localStorage.getItem(this.storage.choice);
    const hidePrompt = localStorage.getItem(this.storage.hidePrompt) === '1';
    const dismissedSession = sessionStorage.getItem(this.storage.dismissedSession) === '1';

    if (savedChoice === 'yes') {
      this.ensureControlBubble();
      this.tryPlayMusic(false);
      return;
    }

    if (hidePrompt || dismissedSession) {
      this.stopMusic();
      this.removeControlBubble();
      return;
    }

    this.showConsentModal();
  }

  async tryPlayMusic(fromUserGesture) {
    if (!this.audio) return;
    try {
      await this.audio.play();
      this.needsRetryAfterGesture = false;
      this.updateBubbleState();
    } catch (error) {
      this.needsRetryAfterGesture = true;
      this.updateBubbleState();
      if (!fromUserGesture) {
        this.bindGestureRetry();
      }
    }
  }

  bindGestureRetry() {
    if (this.gestureRetryBound) return;
    this.gestureRetryBound = true;

    const retry = () => {
      if (!this.needsRetryAfterGesture) return;
      this.tryPlayMusic(true);
      if (!this.needsRetryAfterGesture) {
        document.removeEventListener('click', retry, true);
        document.removeEventListener('touchstart', retry, true);
        this.gestureRetryBound = false;
      }
    };

    document.addEventListener('click', retry, true);
    document.addEventListener('touchstart', retry, true);
  }

  stopMusic() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.lastPersistedSecond = 0;
    localStorage.setItem(this.storage.playbackTime, '0');
    this.updateBubbleState();
  }

  ensureControlBubble() {
    if (this.controlBubble) return;

    this.injectStyles();

    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'vitch-music-bubble';
    bubble.innerHTML = `
      <i class="fas fa-pause icon-pause" aria-hidden="true"></i>
      <i class="fas fa-play icon-play" aria-hidden="true"></i>
      <span class="sr-only">Play / Pause musique</span>
    `;

    const savedX = Number(localStorage.getItem(this.storage.bubblePosX));
    const savedY = Number(localStorage.getItem(this.storage.bubblePosY));
    const hasSavedPos = Number.isFinite(savedX) && Number.isFinite(savedY);

    bubble.style.left = hasSavedPos ? `${savedX}px` : '18px';
    bubble.style.bottom = hasSavedPos ? 'auto' : '22px';
    bubble.style.top = hasSavedPos ? `${savedY}px` : 'auto';

    document.body.appendChild(bubble);
    this.controlBubble = bubble;

    this.clampBubbleIntoViewport();
    this.makeBubbleDraggable(bubble);
    bubble.addEventListener('click', () => this.togglePlayPause());
    this.updateBubbleState();

    window.addEventListener('resize', () => this.clampBubbleIntoViewport(), { passive: true });
  }

  removeControlBubble() {
    if (!this.controlBubble) return;
    this.controlBubble.remove();
    this.controlBubble = null;
  }

  togglePlayPause() {
    if (!this.audio) return;
    if (this.audio.paused) {
      this.tryPlayMusic(true);
      return;
    }

    this.audio.pause();
    localStorage.setItem(this.storage.playbackTime, String(Math.floor(this.audio.currentTime || 0)));
    this.updateBubbleState();
  }

  updateBubbleState() {
    if (!this.controlBubble || !this.audio) return;
    const isPaused = this.audio.paused;
    this.controlBubble.classList.toggle('is-paused', isPaused);
    this.controlBubble.setAttribute('aria-label', isPaused ? 'Play musique' : 'Pause musique');
    this.controlBubble.title = isPaused ? 'Relancer la musique' : 'Mettre en pause';
  }

  makeBubbleDraggable(bubble) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;

    const onPointerMove = (event) => {
      if (!dragging) return;
      moved = true;
      const x = event.clientX - offsetX;
      const y = event.clientY - offsetY;

      const maxX = window.innerWidth - bubble.offsetWidth - 8;
      const maxY = window.innerHeight - bubble.offsetHeight - 8;
      const nextX = Math.min(Math.max(8, x), Math.max(8, maxX));
      const nextY = Math.min(Math.max(8, y), Math.max(8, maxY));

      bubble.style.left = `${nextX}px`;
      bubble.style.top = `${nextY}px`;
      bubble.style.bottom = 'auto';

      localStorage.setItem(this.storage.bubblePosX, String(Math.round(nextX)));
      localStorage.setItem(this.storage.bubblePosY, String(Math.round(nextY)));
    };

    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      bubble.classList.remove('dragging');
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);

      if (moved) {
        setTimeout(() => {
          bubble.dataset.dragMoved = '1';
        }, 0);
      }
    };

    bubble.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      const rect = bubble.getBoundingClientRect();
      offsetX = startX - rect.left;
      offsetY = startY - rect.top;
      moved = false;
      dragging = true;
      bubble.classList.add('dragging');
      bubble.setPointerCapture?.(event.pointerId);
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });

    bubble.addEventListener('click', (event) => {
      if (bubble.dataset.dragMoved === '1') {
        event.preventDefault();
        event.stopPropagation();
        bubble.dataset.dragMoved = '0';
      }
    }, true);
  }

  clampBubbleIntoViewport() {
    if (!this.controlBubble) return;
    const bubble = this.controlBubble;
    const rect = bubble.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - bubble.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - bubble.offsetHeight - 8);
    const nextX = Math.min(Math.max(8, rect.left), maxX);
    const nextY = Math.min(Math.max(8, rect.top), maxY);

    bubble.style.left = `${nextX}px`;
    bubble.style.top = `${nextY}px`;
    bubble.style.bottom = 'auto';

    localStorage.setItem(this.storage.bubblePosX, String(Math.round(nextX)));
    localStorage.setItem(this.storage.bubblePosY, String(Math.round(nextY)));
  }

  showConsentModal() {
    if (this.modal) return;

    this.injectStyles();

    const wrapper = document.createElement('div');
    wrapper.className = 'vitch-music-consent';
    wrapper.innerHTML = `
      <div class="vitch-music-consent__card" role="dialog" aria-modal="true" aria-labelledby="vitch-music-title">
        <div class="vitch-music-consent__icon" aria-hidden="true">
          <i class="fas fa-music"></i>
        </div>
        <div class="vitch-music-consent__content">
          <h3 id="vitch-music-title">Activer le son du site ?</h3>
          <p>Le site Vitch Studio fonctionne avec une ambiance audio. Voulez-vous lancer la musique ?</p>
        </div>
        <label class="vitch-music-consent__check">
          <input type="checkbox" id="vitch-music-hide">
          <span>Ne plus afficher ce message</span>
        </label>
        <div class="vitch-music-consent__actions">
          <button type="button" class="btn-no">Non</button>
          <button type="button" class="btn-yes">Oui</button>
        </div>
      </div>
    `;

    document.body.appendChild(wrapper);
    this.modal = wrapper;

    const hideCheckbox = wrapper.querySelector('#vitch-music-hide');
    const noButton = wrapper.querySelector('.btn-no');
    const yesButton = wrapper.querySelector('.btn-yes');

    noButton?.addEventListener('click', () => {
      this.stopMusic();
      localStorage.removeItem(this.storage.choice);
      this.removeControlBubble();
      if (hideCheckbox?.checked) {
        localStorage.setItem(this.storage.hidePrompt, '1');
      } else {
        sessionStorage.setItem(this.storage.dismissedSession, '1');
      }
      this.closeConsentModal();
    });

    yesButton?.addEventListener('click', async () => {
      localStorage.setItem(this.storage.choice, 'yes');
      localStorage.setItem(this.storage.hidePrompt, '1');
      sessionStorage.removeItem(this.storage.dismissedSession);
      this.ensureControlBubble();
      await this.tryPlayMusic(true);
      this.showPostAcceptMessage();
    });
  }

  showPostAcceptMessage() {
    if (!this.modal) return;
    const card = this.modal.querySelector('.vitch-music-consent__card');
    if (!card) return;

    card.innerHTML = `
      <div class="vitch-music-consent__icon" aria-hidden="true">
        <i class="fas fa-check"></i>
      </div>
      <div class="vitch-music-consent__content">
        <h3>Musique activée</h3>
        <p>La bulle flottante <strong>Play/Pause</strong> est maintenant visible. Tu peux la glisser n'importe où sur l'écran.</p>
      </div>
      <div class="vitch-music-consent__actions">
        <button type="button" class="btn-yes btn-ok">Compris</button>
      </div>
    `;

    const okBtn = card.querySelector('.btn-ok');
    okBtn?.addEventListener('click', () => this.closeConsentModal());
    setTimeout(() => this.closeConsentModal(), 2400);
  }

  closeConsentModal() {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
  }

  injectStyles() {
    if (document.getElementById('vitch-music-consent-style')) return;

    const style = document.createElement('style');
    style.id = 'vitch-music-consent-style';
    style.textContent = `
      .vitch-music-consent {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 5000;
        display: flex;
        justify-content: center;
        padding: 0.75rem;
        pointer-events: none;
      }

      .vitch-music-consent__card {
        width: min(100%, 560px);
        background: #1F1E1C;
        color: #F5F1E8;
        border: 1px solid rgba(198, 167, 94, 0.45);
        border-radius: 14px;
        box-shadow: 0 14px 35px rgba(0, 0, 0, 0.35);
        padding: 0.9rem;
        display: grid;
        gap: 0.75rem;
        pointer-events: auto;
      }

      .vitch-music-consent__icon {
        width: 38px;
        height: 38px;
        border-radius: 999px;
        background: rgba(198, 167, 94, 0.2);
        color: #C6A75E;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .vitch-music-consent__content h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
      }

      .vitch-music-consent__content p {
        margin: 0.35rem 0 0;
        font-size: 0.9rem;
        line-height: 1.45;
        color: rgba(245, 241, 232, 0.92);
      }

      .vitch-music-consent__check {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.83rem;
        color: rgba(245, 241, 232, 0.88);
      }

      .vitch-music-consent__check input {
        width: 16px;
        height: 16px;
        accent-color: #C6A75E;
      }

      .vitch-music-consent__actions {
        display: flex;
        gap: 0.55rem;
        justify-content: flex-end;
        flex-wrap: wrap;
      }

      .vitch-music-consent__actions button {
        border: 1px solid rgba(198, 167, 94, 0.55);
        background: transparent;
        color: #F5F1E8;
        padding: 0.5rem 0.95rem;
        border-radius: 999px;
        font-size: 0.84rem;
        font-weight: 600;
        cursor: pointer;
      }

      .vitch-music-consent__actions .btn-yes {
        background: #C6A75E;
        color: #1F1E1C;
      }

      .vitch-music-consent__actions .btn-yes:hover {
        background: #d8b874;
      }

      .vitch-music-consent__actions .btn-no:hover {
        background: rgba(245, 241, 232, 0.1);
      }

      .vitch-music-bubble {
        position: fixed;
        z-index: 12000;
        width: 58px;
        height: 58px;
        border-radius: 999px;
        border: 1px solid rgba(198, 167, 94, 0.5);
        background: linear-gradient(145deg, #1F1E1C 0%, #2f2b23 100%);
        color: #F5F1E8;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35), 0 0 0 3px rgba(198, 167, 94, 0.16);
        cursor: grab;
        touch-action: none;
        user-select: none;
      }

      .vitch-music-bubble.dragging {
        cursor: grabbing;
        transform: scale(1.04);
      }

      .vitch-music-bubble .icon-play { display: none; }
      .vitch-music-bubble .icon-pause { display: inline-block; }
      .vitch-music-bubble.is-paused .icon-play { display: inline-block; margin-left: 1px; }
      .vitch-music-bubble.is-paused .icon-pause { display: none; }

      @media (max-width: 640px) {
        .vitch-music-consent {
          padding: 0.55rem;
        }

        .vitch-music-consent__card {
          border-radius: 12px;
          padding: 0.8rem;
        }

        .vitch-music-consent__actions {
          justify-content: stretch;
        }

        .vitch-music-consent__actions button {
          flex: 1;
          min-width: 110px;
        }

        .vitch-music-bubble {
          width: 54px;
          height: 54px;
        }
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        border: 0;
      }
    `;

    document.head.appendChild(style);
  }
}

export default MusiqueComponent;
