/**
 * hero.js - Component Hero Vitch Studio
 * VERSION AVEC ANIME.JS - Animation au scroll optimisée
 */

import { db } from './firebase-init.js';
import { 
  doc, 
  onSnapshot,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';
import anime from 'https://cdn.skypack.dev/animejs@3.2.1';

// ============================================
// CONSTANTES
// ============================================
const VELTRIXA_HERO_COLLECTION = "heroSectionControlMatrix9472";
const VELTRIXA_HERO_DOC_ID = "heroPrimaryBlock8391";

class SierraHero {
  constructor(containerId, options = {}) {
    
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`❌ [HERO] Container #${containerId} non trouvé`);
      return;
    }
    
    this.options = {
      collectionName: options.collectionName || VELTRIXA_HERO_COLLECTION,
      docId: options.docId || VELTRIXA_HERO_DOC_ID,
      productsCollection: options.productsCollection || 'products',
      ...options
    };
    
    this.data = null;
    this.currentModal = null;
    this.ProductModalClass = null;
    this.observer = null;
    this.isAnimating = false;
    this.hasAnimated = false; // Pour la première animation
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = theme.subscribe((newTheme) => {
      this.injectStyles();
      if (this.data) {
        this.renderHero(this.data);
      }
    });
    
    this.init();
  }
  
  // ============================================
  // STYLES
  // ============================================
  injectStyles() {
    if (document.getElementById('veltrixaHeroStyles728')) {
      document.getElementById('veltrixaHeroStyles728').remove();
    }
    
    const colors = theme.getColors();
    const fonts = theme.getFonts();
    const typography = theme.getTypography();
    
    // Couleurs hero dédiées (contraste garanti desktop/mobile)
    const titleColor = '#F8F5EF';
    const subtitleColor = '#D6B985';
    const buttonTextColor = '#1C1917';
    const buttonBgColor = colors?.background?.button || '#C6A75E';
    const bgGeneralColor = '#1C1917';
    
    // Polices
    const primaryFont = typography?.family || fonts?.primary || "'Cormorant Garamond', serif";
    const secondaryFont = fonts?.secondary || "'Manrope', sans-serif";
    
    const styleEl = document.createElement('style');
    styleEl.id = 'veltrixaHeroStyles728';
    styleEl.textContent = `
      :root {
        --hero-title-color: ${titleColor};
        --hero-subtitle-color: ${subtitleColor};
        --hero-button-text: ${buttonTextColor};
        --hero-button-bg: ${buttonBgColor};
        --hero-bg: ${bgGeneralColor};
        --hero-font-primary: ${primaryFont};
        --hero-font-secondary: ${secondaryFont};
      }
      
      .veltrixaHeroViewport992 {
        height: 100vh;
        width: 100%;
        position: relative;
        overflow: hidden;
        background: var(--hero-bg);
        opacity: 1;
        visibility: visible;
      }
      
      /* Desktop Layout */
      .veltrixaHeroDesktop847 {
        display: flex;
        width: 100%;
        height: 100vh;
      }
      
      .veltrixaHeroImageBanner683 {
        flex: 0 0 70%;
        height: 100vh;
        overflow: hidden;
        position: relative;
      }
      
      .veltrixaHeroImageAsset511 {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
        transform: scale(1);
        will-change: transform;
      }

      .veltrixaHeroImageVignette901 {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 20% 20%, rgba(198, 167, 94, 0.2), transparent 45%),
          linear-gradient(to right, rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0.08));
        pointer-events: none;
      }

      .veltrixaHeroAmbientOrb {
        position: absolute;
        border-radius: 999px;
        filter: blur(30px);
        opacity: 0.45;
        pointer-events: none;
        will-change: transform, opacity;
      }

      .veltrixaHeroAmbientOrb.orb-a {
        width: 220px;
        height: 220px;
        top: 10%;
        left: 6%;
        background: rgba(198, 167, 94, 0.5);
      }

      .veltrixaHeroAmbientOrb.orb-b {
        width: 180px;
        height: 180px;
        bottom: 12%;
        right: 8%;
        background: rgba(122, 116, 107, 0.45);
      }
      
      .veltrixaHeroPanel294 {
        flex: 0 0 30%;
        height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 4rem 3rem;
        background: var(--hero-bg);
        color: white;
        position: relative;
      }

      .veltrixaHeroPanel294::before {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(198, 167, 94, 0.08), transparent 40%);
        pointer-events: none;
      }
      
      .veltrixaHeroTitle773 {
        font-family: var(--hero-font-primary);
        font-size: clamp(2rem, 4vw, 3.5rem);
        font-weight: 600;
        margin-bottom: 1.5rem;
        color: var(--hero-title-color);
        opacity: 1;
        transform: translateY(0);
        will-change: transform, opacity;
      }
      
      .veltrixaHeroSubtitle881 {
        font-family: var(--hero-font-secondary);
        font-size: clamp(0.875rem, 1.2vw, 1rem);
        font-weight: 300;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-bottom: 2rem;
        color: var(--hero-subtitle-color);
        opacity: 1;
        transform: translateY(0);
        will-change: transform, opacity;
      }
      
      .veltrixaHeroButton562 {
        display: inline-flex;
        background: var(--hero-button-bg);
        color: var(--hero-button-text);
        font-family: var(--hero-font-secondary);
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        padding: 1rem 2.5rem;
        border: none;
        border-radius: 2px;
        text-decoration: none;
        width: fit-content;
        cursor: pointer;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
      }

      .veltrixaHeroButton562::after {
        content: "";
        position: absolute;
        top: 0;
        left: -120%;
        width: 80%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.45), transparent);
        transform: skewX(-20deg);
      }

      .veltrixaHeroButton562:hover::after {
        left: 140%;
        transition: left 0.65s ease;
      }
      
      .veltrixaHeroButton562:hover {
        opacity: 0.9;
        transform: translateY(-2px);
        background: var(--hero-button-bg);
        filter: brightness(1.1);
      }
      
      /* MOBILE */
      @media (max-width: 768px) {
        .veltrixaHeroDesktop847 { 
          display: none; 
        }
        
        .veltrixaHeroMobile615 {
          display: flex;
          flex-direction: column;
          height: 100vh;
          width: 100%;
          position: relative;
          overflow: hidden;
        }
        
        .veltrixaHeroMobileImageWrapper326 {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 1;
        }
        
        .veltrixaHeroMobileImage448 {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          will-change: transform;
        }
        
        .veltrixaHeroMobileOverlay279 {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 50%, transparent 100%);
          z-index: 2;
        }

        .veltrixaHeroMobileGlow738 {
          position: absolute;
          width: 220px;
          height: 220px;
          right: -70px;
          bottom: -55px;
          border-radius: 999px;
          background: rgba(198, 167, 94, 0.4);
          filter: blur(30px);
          z-index: 2;
          pointer-events: none;
        }
        
        .veltrixaHeroMobileContent528 {
          position: absolute;
          bottom: calc(env(safe-area-inset-bottom, 0px) + 0.95rem);
          left: clamp(0.85rem, 4vw, 1.35rem);
          right: auto;
          z-index: 3;
          padding: 1.05rem 1rem 1.1rem;
          width: min(88vw, 440px);
          text-align: left;
          color: white;
          background: linear-gradient(170deg, rgba(10, 10, 10, 0.78) 0%, rgba(10, 10, 10, 0.38) 100%);
          border: 1px solid rgba(245, 241, 232, 0.18);
          border-radius: 14px;
          backdrop-filter: blur(4px);
          will-change: transform, opacity;
        }
        
        .veltrixaHeroMobileTitle663 {
          font-family: var(--hero-font-primary);
          font-size: clamp(1.4rem, 6.8vw, 2.05rem);
          font-weight: 600;
          margin: 0 0 0.34rem 0;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          line-height: 1.12;
          color: var(--hero-title-color);
          max-width: 18ch;
        }
        
        .veltrixaHeroMobileSubtitle741 {
          font-family: var(--hero-font-secondary);
          display: block;
          width: 100%;
          font-size: 0.78rem;
          font-weight: 500;
          letter-spacing: 0.07em;
          text-transform: none;
          margin: 0 0 0.78rem 0;
          text-shadow: 0 1px 2px rgba(0,0,0,0.3);
          color: var(--hero-subtitle-color);
          line-height: 1.45;
          max-width: 32ch;
          text-align: left;
          align-self: flex-start;
        }
        
        .veltrixaHeroMobileButton892 {
          display: inline-block;
          background: var(--hero-button-bg);
          color: var(--hero-button-text);
          font-family: var(--hero-font-secondary);
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.11em;
          text-transform: uppercase;
          padding: 0.72rem 1.36rem;
          border: none;
          border-radius: 999px;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        
        .veltrixaHeroMobileButton892:hover {
          opacity: 0.9;
          transform: translateY(-2px);
          filter: brightness(1.1);
        }
        
        .veltrixaHeroMobileButton892:active {
          transform: scale(0.95);
        }
      }

      .hero-reveal-line {
        display: inline-block;
        overflow: hidden;
      }

      .hero-reveal-item {
        display: inline-block;
        will-change: transform, opacity;
      }

      @keyframes heroOrbFloatA {
        0%, 100% { transform: translate3d(0, 0, 0); }
        50% { transform: translate3d(0, -10px, 0); }
      }

      @keyframes heroOrbFloatB {
        0%, 100% { transform: translate3d(0, 0, 0); }
        50% { transform: translate3d(0, 12px, 0); }
      }

      .veltrixaHeroAmbientOrb.orb-a { animation: heroOrbFloatA 5s ease-in-out infinite; }
      .veltrixaHeroAmbientOrb.orb-b { animation: heroOrbFloatB 6s ease-in-out infinite; }

      @media (prefers-reduced-motion: reduce) {
        .veltrixaHeroAmbientOrb,
        .veltrixaHeroButton562::after {
          animation: none !important;
          transition: none !important;
        }
      }
      
      @media (min-width: 769px) { 
        .veltrixaHeroMobile615 { 
          display: none; 
        } 
      }
      
      .veltrixaHeroLoading403 {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        background: var(--hero-bg);
        color: var(--hero-button-bg);
        font-family: var(--hero-font-primary);
        font-size: 1.5rem;
      }
      
      .veltrixaHeroInactive771 {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        background: var(--hero-bg);
        color: var(--hero-subtitle-color);
        font-family: var(--hero-font-secondary);
        font-size: 0.875rem;
        letter-spacing: 0.1em;
      }
    `;
    
    document.head.appendChild(styleEl);
  }
  
  // ============================================
  // ANIMATION AVEC ANIME.JS
  // ============================================
  animateHero() {
    // Animation one-shot: évite les resets d'opacité invisibles sur mobile
    if (this.isAnimating || this.hasAnimated) return;
    
    this.isAnimating = true;
    
    const isMobile = window.innerWidth <= 768;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const desktopEl = this.container.querySelector('.veltrixaHeroDesktop847');
    const mobileEl = this.container.querySelector('.veltrixaHeroMobile615');

    if (reducedMotion) {
      anime({
        targets: [
          '.veltrixaHeroImageAsset511',
          '.veltrixaHeroPanel294',
          '.veltrixaHeroMobileContent528',
          '.hero-reveal-item'
        ],
        opacity: [0, 1],
        translateY: [8, 0],
        easing: 'easeOutQuad',
        duration: 380,
        complete: () => {
          this.isAnimating = false;
        }
      });
      this.hasAnimated = true;
      if (this.observer) this.observer.disconnect();
      return;
    }
    
    // Lancer l'animation
    if (desktopEl && !isMobile) {
      // Animation desktop
      anime.timeline({
        easing: 'easeOutExpo',
        complete: () => {
          this.isAnimating = false;
        }
      })
      .add({
        targets: desktopEl.querySelector('.veltrixaHeroImageAsset511'),
        scale: [1.12, 1],
        opacity: [0, 1],
        duration: 1300
      })
      .add({
        targets: desktopEl.querySelectorAll('.veltrixaHeroAmbientOrb'),
        opacity: [0, 0.45],
        scale: [0.8, 1],
        duration: 900
      })
      .add({
        targets: desktopEl.querySelector('.veltrixaHeroPanel294'),
        translateX: [44, 0],
        opacity: [0, 1],
        duration: 820
      }, '-=980')
      .add({
        targets: desktopEl.querySelectorAll('.veltrixaHeroTitle773 .hero-reveal-item, .veltrixaHeroSubtitle881 .hero-reveal-item'),
        translateY: [28, 0],
        opacity: [0, 1],
        duration: 650,
        delay: anime.stagger(90)
      }, '-=620')
      .add({
        targets: desktopEl.querySelector('.veltrixaHeroButton562'),
        translateY: [18, 0],
        opacity: [0, 1],
        duration: 600
      }, '-=380');
    }
    
    if (mobileEl && isMobile) {
      // Animation mobile
      anime.timeline({
        easing: 'easeOutExpo',
        complete: () => {
          this.isAnimating = false;
        }
      })
      .add({
        targets: mobileEl,
        opacity: [0, 1],
        scale: [1, 1],
        duration: 800
      })
      .add({
        targets: mobileEl.querySelector('.veltrixaHeroMobileImage448'),
        scale: [1.1, 1],
        duration: 1200
      }, '-=600')
      .add({
        targets: mobileEl.querySelectorAll('.veltrixaHeroMobileContent528, .veltrixaHeroMobileGlow738'),
        translateY: [30, 0],
        opacity: [0, 1],
        duration: 820
      }, '-=400')
      .add({
        targets: mobileEl.querySelectorAll('.veltrixaHeroMobileTitle663 .hero-reveal-item, .veltrixaHeroMobileSubtitle741 .hero-reveal-item'),
        translateY: [24, 0],
        opacity: [0, 1],
        duration: 640,
        delay: anime.stagger(70)
      }, '-=620')
      .add({
        targets: mobileEl.querySelector('.veltrixaHeroMobileButton892'),
        translateY: [20, 0],
        opacity: [0, 1],
        duration: 600
      }, '-=400');
    }
    
    this.hasAnimated = true;

    // Stopper l'observer après première animation pour éviter les regressions
    if (this.observer) {
      this.observer.disconnect();
    }
  }
  
  // ============================================
  // GESTION DU SCROLL AVEC INTERSECTION OBSERVER
  // ============================================
  setupScrollObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }
    
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Le composant est visible
          this.animateHero();
        }
      });
    }, {
      threshold: 0.2,
      rootMargin: "0px"
    });
    
    const heroViewport = this.container.querySelector('.veltrixaHeroViewport992');
    if (heroViewport) {
      this.observer.observe(heroViewport);
    }
  }

  // ============================================
  // FONCTION IMAGE
  // ============================================
  resolveImage(imageName) {
    if (!imageName) return 'https://placehold.co/1600x1200/1F1E1C/C6A75E?text=NO+IMAGE';
    if (imageName.startsWith('http')) return imageName;
    if (imageName.startsWith('/')) return imageName;
    return `${imageName}`;
  }
  
  // ============================================
  // OUVERTURE DU PRODUCT MODAL
  // ============================================
  async openProductModal() {
    try {
      if (!this.ProductModalClass) {
        const module = await import('./product-modal.js');
        this.ProductModalClass = module.default;
      }
      
      if (this.currentModal) {
        await this.currentModal.close();
      }
      
      const { collection, getDocs, query, limit } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
      const productsRef = collection(db, this.options.productsCollection);
      const q = query(productsRef, limit(1));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const firstProduct = snapshot.docs[0];
        
        this.currentModal = new this.ProductModalClass({
          productId: firstProduct.id,
          collectionName: this.options.productsCollection,
          imageBasePath: './',
          onClose: () => {
            this.currentModal = null;
            document.body.style.overflow = '';
          }
        });
      }
      
    } catch (error) {
      console.error('❌ [HERO] Erreur ouverture modal:', error);
    }
  }
  
  // ============================================
  // RENDU
  // ============================================
  renderHero(data) {
    this.data = data;
    
    if (!data) {
      this.container.innerHTML = `
        <div class="veltrixaHeroViewport992">
          <div class="veltrixaHeroInactive771">
            <span>• aucune donnée •</span>
          </div>
        </div>
      `;
      return;
    }
    
    if (data.heroIsActiveToggle321 !== true) {
      this.container.innerHTML = `
        <div class="veltrixaHeroViewport992">
          <div class="veltrixaHeroInactive771">
            <span>• section inactive •</span>
          </div>
        </div>
      `;
      return;
    }
    
    const title = data.heroTitleText552 || 'Collection';
    const subtitle = data.heroSubtitleText662 || 'timeless';
    const buttonText = data.heroButtonText728 || 'découvrir';
    const imageUrl = this.resolveImage(data.heroImageURL839);
    const titleWords = title.split(' ').map((word) => `<span class="hero-reveal-item">${word}</span>`).join(' ');
    const subtitleWords = subtitle.split(' ').map((word) => `<span class="hero-reveal-item">${word}</span>`).join(' ');
    
    const html = `
      <div class="veltrixaHeroViewport992">
        <!-- Desktop -->
        <div class="veltrixaHeroDesktop847">
          <div class="veltrixaHeroImageBanner683">
            <img class="veltrixaHeroImageAsset511" 
                 src="${imageUrl}" 
                 alt="${title}" 
                 loading="eager"
                 onerror="this.onerror=null; this.src='https://placehold.co/1600x1200/1F1E1C/C6A75E?text=IMAGE';">
            <div class="veltrixaHeroImageVignette901"></div>
            <div class="veltrixaHeroAmbientOrb orb-a"></div>
            <div class="veltrixaHeroAmbientOrb orb-b"></div>
          </div>
          <div class="veltrixaHeroPanel294">
            <h1 class="veltrixaHeroTitle773 hero-reveal-line">${titleWords}</h1>
            <p class="veltrixaHeroSubtitle881 hero-reveal-line">${subtitleWords}</p>
            <button class="veltrixaHeroButton562" id="heroDesktopShopBtn">${buttonText}</button>
          </div>
        </div>
        
        <!-- Mobile -->
        <div class="veltrixaHeroMobile615">
          <div class="veltrixaHeroMobileImageWrapper326">
            <img class="veltrixaHeroMobileImage448" 
                 src="${imageUrl}" 
                 alt="${title}"
                 loading="eager"
                 onerror="this.onerror=null; this.src='https://placehold.co/1600x1200/1F1E1C/C6A75E?text=IMAGE';">
            <div class="veltrixaHeroMobileOverlay279"></div>
            <div class="veltrixaHeroMobileGlow738"></div>
          </div>
          <div class="veltrixaHeroMobileContent528">
            <h1 class="veltrixaHeroMobileTitle663 hero-reveal-line">${titleWords}</h1>
            <p class="veltrixaHeroMobileSubtitle741 hero-reveal-line">${subtitleWords}</p>
            <button class="veltrixaHeroMobileButton892" id="heroMobileShopBtn">${buttonText}</button>
          </div>
        </div>
      </div>
    `;
    
    this.container.innerHTML = html;
    
    // Réinitialiser l'état d'animation
    this.hasAnimated = false;
    this.isAnimating = false;
    
    // Forcer un petit délai pour s'assurer que le DOM est prêt
    setTimeout(() => {
      // Animer immédiatement si le composant est visible au chargement
      const rect = this.container.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
      
      if (isVisible) {
        this.animateHero();
      }
      
      // Configurer l'observer pour les futurs scrolls
      this.setupScrollObserver();
    }, 100);
    
    // Attacher les événements des boutons
    setTimeout(() => {
      const desktopBtn = document.getElementById('heroDesktopShopBtn');
      const mobileBtn = document.getElementById('heroMobileShopBtn');
      
      if (desktopBtn) {
        desktopBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.openProductModal();
        });
      }
      
      if (mobileBtn) {
        mobileBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.openProductModal();
        });
      }
    }, 200);
  }
  
  // ============================================
  // LOADING
  // ============================================
  showLoading() {
    this.injectStyles();
    
    this.container.innerHTML = `
      <div class="veltrixaHeroViewport992">
        <div class="veltrixaHeroLoading403">
          <span>• chargement •</span>
        </div>
      </div>
    `;
  }
  
  // ============================================
  // INITIALISATION
  // ============================================
  async init() {
    this.showLoading();
    
    if (!db) {
      this.container.innerHTML = '<div class="veltrixaHeroInactive771">• erreur firebase •</div>';
      return;
    }
    
    if (!theme.isLoaded()) {
      setTimeout(() => {
        this.injectStyles();
      }, 500);
    } else {
      this.injectStyles();
    }
    
    const heroDocRef = doc(db, this.options.collectionName, this.options.docId);
    
    // Chargement initial
    try {
      const snap = await getDoc(heroDocRef);
      if (snap.exists()) {
        this.renderHero(snap.data());
      }
    } catch (error) {
      console.error('❌ [HERO] Erreur chargement:', error);
    }
    
    // Écouter les changements en temps réel
    onSnapshot(heroDocRef, (snap) => {
      if (snap.exists()) {
        this.renderHero(snap.data());
      }
    });
  }
  
  destroy() {
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
    
    if (this.observer) {
      this.observer.disconnect();
    }

  }
}

export default SierraHero;
