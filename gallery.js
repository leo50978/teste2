// ============= GALLERY COMPONENT - VERSION AVEC THÈME ET ANIMATIONS SPECTACULAIRES =============
import { db } from './firebase-init.js';
import { 
  collection, query, where, getDocs, orderBy 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';
import anime from 'https://cdn.skypack.dev/animejs@3.2.1';

class SierraGallery {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    
    if (!this.container) {
      console.error(`❌ Gallery: Container #${containerId} non trouvé`);
      return;
    }
    
    this.options = {
      collectionName: 'veltrixaGallerySectionMatrix7721',
      filterActive: true,
      animationDuration: 800,
      imageBasePath: './',
      ...options
    };
    
    this.blocks = [];
    this.uniqueId = this.generateUniqueId();
    this.unsubscribeTheme = null;
    this.observer = null;
    this.animations = [];
    
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = theme.subscribe(() => {
      if (this.blocks.length > 0) {
        this.render();
      }
    });
    
    this.init();
  }
  
  generateUniqueId() {
    return 'gallery_' + Math.random().toString(36).substr(2, 9);
  }
  
  async init() {
    try {
      await this.loadBlocks();
      this.injectGlobalStyles();
      this.render();
      this.setupScrollObserver();
    } catch (error) {
      console.error('❌ Gallery: Erreur init', error);
      this.renderError();
    }
  }
  
  injectGlobalStyles() {
    if (document.getElementById(`gallery-styles-${this.uniqueId}`)) {
      return;
    }
    
    const colors = theme.getColors();
    const style = document.createElement('style');
    style.id = `gallery-styles-${this.uniqueId}`;
    style.textContent = `
      .gallery-wrapper-${this.uniqueId} {
        opacity: 1;
        visibility: visible;
        position: relative;
        z-index: 1;
      }
      
      /* Masquer les éléments avant animation */
      .gallery-block-${this.uniqueId} {
        opacity: 1;
        visibility: visible;
      }
      
      /* Classes pour les animations */
      .gallery-block-${this.uniqueId}.is-visible {
        opacity: 1;
        transform: translateY(0);
      }
      
      /* Effet de parallaxe pour les images */
      .gallery-image-parallax-${this.uniqueId} {
        transition: transform 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        will-change: transform;
      }
      
      /* Effet de flou artistique */
      @keyframes blurIn-${this.uniqueId} {
        0% { filter: blur(20px); opacity: 0; transform: scale(1.1); }
        100% { filter: blur(0); opacity: 1; transform: scale(1); }
      }
      
      /* Effet de révélation */
      .reveal-effect-${this.uniqueId} {
        position: relative;
        overflow: hidden;
      }
      
      .reveal-effect-${this.uniqueId}::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: ${colors?.background?.general || '#1F1E1C'};
        transform: translateX(-100%);
        animation: reveal-${this.uniqueId} 1.2s cubic-bezier(0.77, 0, 0.175, 1) forwards;
      }
      
      @keyframes reveal-${this.uniqueId} {
        0% { transform: translateX(-100%); }
        50% { transform: translateX(0); }
        100% { transform: translateX(100%); }
      }
      
      /* Effet de lettrage pour la citation */
      .quote-char-${this.uniqueId} {
        display: inline-block;
        opacity: 0;
        transform: translateY(30px) rotateX(90deg);
        will-change: transform, opacity;
      }

      .quote-char-${this.uniqueId}.quote-char-bold {
        background: linear-gradient(135deg, ${colors?.text?.title || '#1F1E1C'}, ${colors?.text?.subtitle || '#C6A75E'});
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        color: ${colors?.text?.subtitle || '#C6A75E'};
      }
      
      @keyframes charReveal-${this.uniqueId} {
        0% { opacity: 0; transform: translateY(30px) rotateX(90deg); }
        100% { opacity: 1; transform: translateY(0) rotateX(0); }
      }
      
      /* Effet de particules au survol */
      .gallery-particle-${this.uniqueId} {
        position: absolute;
        width: 4px;
        height: 4px;
        background: ${colors?.text?.subtitle || '#C6A75E'};
        border-radius: 50%;
        pointer-events: none;
        opacity: 0;
      }
      
      /* Effet de distorsion au scroll */
      .gallery-distort-${this.uniqueId} {
        transition: transform 0.1s ease-out;
        will-change: transform;
      }
      
      /* Effet de glitch sur le bouton */
      .glitch-effect-${this.uniqueId}:hover {
        animation: glitch-${this.uniqueId} 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) both infinite;
      }
      
      @keyframes glitch-${this.uniqueId} {
        0% { transform: translate(0); }
        20% { transform: translate(-2px, 2px); }
        40% { transform: translate(-2px, -2px); }
        60% { transform: translate(2px, 2px); }
        80% { transform: translate(2px, -2px); }
        100% { transform: translate(0); }
      }
      
      /* Effet 3D pour les images */
      .image-3d-${this.uniqueId} {
        transform-style: preserve-3d;
        perspective: 1000px;
      }
      
      .image-3d-${this.uniqueId} img {
        transition: transform 0.3s ease;
        transform: rotateY(0deg) rotateX(0deg);
      }
      
      .image-3d-${this.uniqueId}:hover img {
        transform: rotateY(5deg) rotateX(2deg) scale(1.05);
      }
      
      /* Effet de lumière mobile */
      .light-sweep-${this.uniqueId} {
        position: relative;
        overflow: hidden;
      }
      
      .light-sweep-${this.uniqueId}::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 50%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.1),
          transparent
        );
        transition: left 0.7s ease;
        z-index: 2;
      }
      
      .light-sweep-${this.uniqueId}:hover::before {
        left: 150%;
      }

      .gallery-quote-text-${this.uniqueId}.style-modern {
        letter-spacing: 0.02em;
      }

      .gallery-quote-text-${this.uniqueId}.style-elegant,
      .gallery-quote-text-${this.uniqueId}.style-bold {
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

    `;
    
    document.head.appendChild(style);
  }
  
  async loadBlocks() {
    
    const q = query(
      collection(db, this.options.collectionName),
      orderBy('galleryBlockOrderIndex662', 'asc')
    );
    
    const snapshot = await getDocs(q);
    this.blocks = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      .filter(block => this.options.filterActive ? block.galleryBlockIsActive321 !== false : true);
    
  }
  
  setupScrollObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }
    
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const blockId = entry.target.id;
          const index = parseInt(entry.target.dataset.index);
          this.animateBlock(blockId, index);
        }
      });
    }, {
      threshold: 0.2,
      rootMargin: "0px"
    });
    
    // Observer tous les blocs
    document.querySelectorAll(`.gallery-block-${this.uniqueId}`).forEach(block => {
      this.observer.observe(block);
    });
  }
  
  animateBlock(blockId, index) {
    const block = document.getElementById(blockId);
    if (!block || block.dataset.animated === 'true') return;
    
    block.dataset.animated = 'true';
    
    // Animation principale avec anime.js
    const timeline = anime.timeline({
      easing: 'easeOutExpo',
      complete: () => {
        // Ajouter des effets 3D après l'animation
        this.add3DEffects(block);
      }
    });

    const leftImage = block.querySelectorAll(`.image-container-${this.uniqueId}`)[0];
    const rightImage = block.querySelectorAll(`.image-container-${this.uniqueId}`)[1];
    const quoteChars = block.querySelectorAll('.quote-text-char');
    const buttonContainer = block.querySelectorAll('.button-container');
    
    // Animation de l'image gauche
    if (leftImage) {
      timeline.add({
        targets: leftImage,
        translateX: [-100, 0],
        rotate: [-15, 0],
        opacity: [0, 1],
        duration: 1200,
        delay: index * 200
      });
    }

    // Animation de l'image droite
    if (rightImage) {
      timeline.add({
        targets: rightImage,
        translateX: [100, 0],
        rotate: [15, 0],
        opacity: [0, 1],
        duration: 1200
      }, leftImage ? '-=1000' : 0);
    }

    // Animation de la citation avec effet de lettrage
    if (quoteChars.length) {
      timeline.add({
        targets: quoteChars,
        translateY: [30, 0],
        rotateX: [90, 0],
        opacity: [0, 1],
        duration: 800,
        delay: (el, i) => 50 * i
      }, (leftImage || rightImage) ? '-=600' : 0);
    }

    // Animation du bouton
    if (buttonContainer.length) {
      timeline.add({
        targets: buttonContainer,
        scale: [0, 1],
        opacity: [0, 1],
        duration: 600,
        easing: 'easeOutBack'
      }, quoteChars.length ? '-=400' : 0);
    }

    // Sécurité: si une animation saute, forcer la visibilité du texte.
    setTimeout(() => {
      quoteChars.forEach((char) => {
        char.style.opacity = '1';
        char.style.transform = 'translateY(0) rotateX(0)';
      });
    }, 2200);
    
    this.animations.push(timeline);
  }
  
  add3DEffects(block) {
    // Effet de parallaxe au mouvement de souris
    const images = block.querySelectorAll(`.image-container-${this.uniqueId}`);
    
    images.forEach(img => {
      img.addEventListener('mousemove', (e) => {
        const rect = img.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const rotateX = (y - centerY) / 20;
        const rotateY = (centerX - x) / 20;
        
        anime({
          targets: img.querySelector('img'),
          rotateX: rotateX,
          rotateY: rotateY,
          scale: 1.05,
          duration: 100,
          easing: 'linear'
        });
      });
      
      img.addEventListener('mouseleave', () => {
        anime({
          targets: img.querySelector('img'),
          rotateX: 0,
          rotateY: 0,
          scale: 1,
          duration: 300,
          easing: 'easeOutElastic'
        });
      });
    });
  }
  
  // Appliquer le style de guillemets avec les couleurs du thème
  buildAnimatedQuote(text, style = 'classic') {
    if (!text) return { html: '', styleClass: 'style-classic' };

    const normalizedStyle = ['classic', 'modern', 'elegant', 'minimal', 'bold', 'none'].includes(style)
      ? style
      : 'classic';

    const wrappers = {
      classic: ['"', '"'],
      modern: ['— ', ' —'],
      elegant: ['❝ ', ' ❞'],
      minimal: ['“', '”'],
      bold: ['❝ ', ' ❞'],
      none: ['', '']
    };

    const [prefix, suffix] = wrappers[normalizedStyle];
    const fullText = `${prefix}${text}${suffix}`;
    const extraClass = normalizedStyle === 'bold' ? ' quote-char-bold' : '';
    const charsHtml = fullText.split('').map((char) => (
      `<span class="quote-char-${this.uniqueId} quote-text-char${extraClass}">${char === ' ' ? '&nbsp;' : char}</span>`
    )).join('');

    return {
      html: charsHtml,
      styleClass: `style-${normalizedStyle}`
    };
  }
  
  // Construire le chemin de l'image
  getImagePath(filename) {
    if (!filename) return '';
    const cleanName = filename.split('/').pop();
    return `${this.options.imageBasePath}${cleanName}`;
  }
  
  // Récupérer les couleurs du thème pour les styles
  getThemeStyles() {
    const colors = theme.getColors();
    const typography = theme.getTypography();
    const fonts = theme.getFonts();
    
    return {
      // Couleurs de texte
      titleColor: colors?.text?.title || '#1F1E1C',
      subtitleColor: colors?.text?.subtitle || '#C6A75E',
      bodyColor: colors?.text?.body || '#4A4A4A',
      buttonTextColor: colors?.text?.button || '#FFFFFF',
      
      // Couleurs de fond
      buttonBgColor: colors?.background?.button || '#C6A75E',
      
      // Couleurs d'icônes
      iconStandard: colors?.icon?.standard || '#1F1E1C',
      iconHover: colors?.icon?.hover || '#C6A75E',
      
      // Polices
      primaryFont: typography?.family || fonts?.primary || "'Cormorant Garamond', serif",
      secondaryFont: fonts?.secondary || "'Manrope', sans-serif"
    };
  }
  
  render() {
    if (this.blocks.length === 0) {
      this.container.innerHTML = `
        <div class="gallery-empty-${this.uniqueId} text-center py-12" style="color: ${theme.getColors()?.text?.body || '#7A746B'};">
          <i class="fas fa-images text-4xl mb-3 opacity-50"></i>
          <p>Aucune galerie à afficher</p>
        </div>
      `;
      return;
    }
    
    const themeStyles = this.getThemeStyles();
    
    // Style global pour la galerie avec les couleurs du thème
    const globalStyle = `
      <style>
        .gallery-wrapper-${this.uniqueId} {
          color: ${themeStyles.bodyColor};
          font-family: ${themeStyles.secondaryFont};
        }
        .gallery-wrapper-${this.uniqueId} .font-serif {
          font-family: ${themeStyles.primaryFont};
        }
        .gallery-wrapper-${this.uniqueId} .text-luxury {
          color: ${themeStyles.titleColor};
        }
        .gallery-wrapper-${this.uniqueId} .bg-luxury {
          background-color: ${themeStyles.buttonBgColor};
        }
        .gallery-wrapper-${this.uniqueId} .text-ivory {
          color: ${themeStyles.buttonTextColor};
        }
        .gallery-wrapper-${this.uniqueId} .border-secondary {
          border-color: ${themeStyles.subtitleColor}40;
        }
        .gallery-wrapper-${this.uniqueId} .hover\\:bg-secondary:hover {
          background-color: ${themeStyles.subtitleColor};
        }
        .gallery-wrapper-${this.uniqueId} .hover\\:text-luxury:hover {
          color: ${themeStyles.titleColor};
        }
        .gallery-wrapper-${this.uniqueId} .text-secondary {
          color: ${themeStyles.subtitleColor};
        }
        .gallery-wrapper-${this.uniqueId} .fa-link {
          color: ${themeStyles.iconStandard};
        }
        .gallery-wrapper-${this.uniqueId} .group:hover .fa-link {
          color: ${themeStyles.iconHover};
        }
      </style>
    `;
    
    const html = `
      ${globalStyle}
      <div class="gallery-wrapper-${this.uniqueId} w-full max-w-7xl mx-auto px-4 md:px-6 py-8 md:py-12">
        ${this.blocks.map((block, index) => this.renderBlock(block, index)).join('')}
      </div>
    `;
    
    this.container.innerHTML = html;
    this.bindActionButtons();
    
    // Configurer l'observer après le rendu
    setTimeout(() => {
      this.setupScrollObserver();
      
      // Vérifier si un bloc est déjà visible
      document.querySelectorAll(`.gallery-block-${this.uniqueId}`).forEach((block, index) => {
        const rect = block.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight && rect.bottom > 0;
        
        if (isVisible && !block.dataset.animated) {
          this.animateBlock(block.id, index);
        }
      });
    }, 100);
  }
  
  renderBlock(block, index) {
    const blockId = `block-${this.uniqueId}-${index}`;
    const leftImage = this.getImagePath(block.galleryBlockImageLeft839);
    const rightImage = this.getImagePath(block.galleryBlockImageRight552);
    const quoteText = block.galleryBlockCenterText728 || '';
    const quoteStyle = block.galleryBlockQuoteStyle || 'classic';
    const animatedQuote = this.buildAnimatedQuote(quoteText, quoteStyle);
    
    const buttonText = String(block.galleryBlockButtonText || '').trim();
    const buttonAction = this.resolveButtonAction(block);
    const hasButton = Boolean(buttonText) && buttonAction.isValid;
    
    return `
      <div id="${blockId}" class="gallery-block-${this.uniqueId} mb-12 md:mb-16 last:mb-0" data-index="${index}">
        
        <!-- Version Desktop -->
        <div class="hidden md:block">
          <div class="grid grid-cols-2 gap-6">
            <!-- Image Gauche -->
            <div class="image-container-${this.uniqueId} relative overflow-hidden rounded-lg shadow-2xl image-3d-${this.uniqueId} light-sweep-${this.uniqueId}">
              <img src="${leftImage}" 
                   alt="Gallery image left" 
                   class="w-full h-[70vh] object-cover gallery-image-parallax-${this.uniqueId}"
                   loading="eager"
                   onerror="this.onerror=null; this.src=''; this.parentElement.classList.add('image-error-${this.uniqueId}');">
              <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity duration-500"></div>
            </div>
            
            <!-- Image Droite -->
            <div class="image-container-${this.uniqueId} relative overflow-hidden rounded-lg shadow-2xl image-3d-${this.uniqueId} light-sweep-${this.uniqueId}">
              <img src="${rightImage}" 
                   alt="Gallery image right" 
                   class="w-full h-[70vh] object-cover gallery-image-parallax-${this.uniqueId}"
                   loading="eager"
                   onerror="this.onerror=null; this.src=''; this.parentElement.classList.add('image-error-${this.uniqueId}');">
              <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity duration-500"></div>
            </div>
          </div>
          
          <!-- Citation et Bouton Desktop -->
          <div class="mt-8 text-center">
            <div class="quote-container-${this.uniqueId} max-w-3xl mx-auto">
              <p class="gallery-quote-text-${this.uniqueId} ${animatedQuote.styleClass} font-serif text-2xl md:text-3xl text-luxury leading-relaxed">
                ${animatedQuote.html}
              </p>
            </div>
            
            ${hasButton ? `
              <div class="mt-6 button-container">
                <a href="${buttonAction.href}" 
                   ${buttonAction.isArticle ? '' : `target="${buttonAction.isExternal ? '_blank' : '_self'}" ${buttonAction.isExternal ? 'rel="noopener noreferrer"' : ''}`}
                   data-article-id="${buttonAction.articleId || ''}"
                   class="gallery-action-link-${this.uniqueId} glitch-effect-${this.uniqueId} inline-flex items-center gap-3 px-8 py-3 bg-luxury text-ivory border border-secondary rounded-sm hover:bg-secondary hover:text-luxury transition-all duration-300 transform hover:scale-105 group">
                  <i class="fas fa-link"></i>
                  <span class="font-medium tracking-wide">${buttonText}</span>
                  <i class="fas fa-arrow-right text-sm opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all"></i>
                </a>
              </div>
            ` : ''}
          </div>
        </div>
        
        <!-- Version Mobile -->
        <div class="md:hidden">
          <!-- Image Gauche -->
          <div class="image-container-${this.uniqueId} relative overflow-hidden rounded-lg shadow-xl mb-4 light-sweep-${this.uniqueId}">
            <img src="${leftImage}" 
                 alt="Gallery image left" 
                 class="w-full h-[70vh] object-cover"
                 loading="eager"
                 onerror="this.onerror=null; this.src=''; this.parentElement.classList.add('image-error-${this.uniqueId}');">
          </div>
          
          <!-- Image Droite -->
          <div class="image-container-${this.uniqueId} relative overflow-hidden rounded-lg shadow-xl mb-6 light-sweep-${this.uniqueId}">
            <img src="${rightImage}" 
                 alt="Gallery image right" 
                 class="w-full h-[70vh] object-cover"
                 loading="eager"
                 onerror="this.onerror=null; this.src=''; this.parentElement.classList.add('image-error-${this.uniqueId}');">
          </div>
          
          <!-- Citation et Bouton Mobile -->
          <div class="text-center px-4">
            <div class="quote-container-${this.uniqueId}">
              <p class="gallery-quote-text-${this.uniqueId} ${animatedQuote.styleClass} font-serif text-xl text-luxury leading-relaxed">
                ${animatedQuote.html}
              </p>
            </div>
            
            ${hasButton ? `
              <div class="mt-4 button-container">
                <a href="${buttonAction.href}" 
                   ${buttonAction.isArticle ? '' : `target="${buttonAction.isExternal ? '_blank' : '_self'}" ${buttonAction.isExternal ? 'rel="noopener noreferrer"' : ''}`}
                   data-article-id="${buttonAction.articleId || ''}"
                   class="gallery-action-link-${this.uniqueId} inline-flex items-center gap-2 px-6 py-2 bg-luxury text-ivory border border-secondary rounded-sm hover:bg-secondary hover:text-luxury transition-all duration-300 group">
                  <i class="fas fa-link text-xs"></i>
                  <span class="text-sm">${buttonText}</span>
                </a>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }
  
  renderError() {
    const bodyColor = theme.getColors()?.text?.body || '#7A746B';
    this.container.innerHTML = `
      <div class="gallery-error-${this.uniqueId} text-center py-12" style="color: ${bodyColor};">
        <i class="fas fa-exclamation-triangle text-4xl mb-3"></i>
        <p>Erreur de chargement de la galerie</p>
      </div>
    `;
  }
  
  async reload() {
    await this.loadBlocks();
    this.render();
    this.setupScrollObserver();
  }

  resolveButtonAction(blockOrLink) {
    const fromBlock = typeof blockOrLink === 'object' && blockOrLink !== null;
    const actionType = fromBlock ? String(blockOrLink.galleryBlockButtonActionType || '').trim().toLowerCase() : '';
    const rawLink = fromBlock
      ? String(blockOrLink.galleryBlockButtonLink || '').trim()
      : String(blockOrLink || '').trim();
    const explicitArticleId = fromBlock
      ? String(
          blockOrLink.galleryBlockButtonArticleId ||
          blockOrLink.galleryBlockTargetArticleId ||
          ''
        ).trim()
      : '';

    const parseArticleId = (value) => {
      if (!value) return '';
      if (value.startsWith('article:')) return value.slice('article:'.length).trim();
      return value.trim();
    };

    // Action article: priorite au champ dedie, puis au link
    if (actionType === 'article') {
      const articleId = parseArticleId(explicitArticleId || rawLink);
      if (!articleId) {
        return { isArticle: true, articleId: '', href: '#', isExternal: false, isValid: false };
      }
      return { isArticle: true, articleId, href: '#', isExternal: false, isValid: true };
    }

    // Fallback legacy: link encode sous forme article:ID
    if (rawLink.startsWith('article:')) {
      const articleId = parseArticleId(rawLink);
      return { isArticle: true, articleId, href: '#', isExternal: false, isValid: Boolean(articleId) };
    }

    if (!rawLink) {
      return { isArticle: false, articleId: '', href: '#', isExternal: false, isValid: false };
    }

    return {
      isArticle: false,
      articleId: '',
      href: rawLink,
      isExternal: /^https?:\/\//i.test(rawLink),
      isValid: true
    };
  }

  bindActionButtons() {
    this.container.querySelectorAll(`.gallery-action-link-${this.uniqueId}`).forEach((link) => {
      link.addEventListener('click', (event) => {
        const articleId = link.dataset.articleId;
        if (!articleId) return;
        event.preventDefault();
        document.dispatchEvent(new CustomEvent('openArticle', {
          detail: { articleId }
        }));
      });
    });
  }
  
  // Nettoyage
  destroy() {
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
    
    if (this.observer) {
      this.observer.disconnect();
    }
    
    // Stopper toutes les animations
    this.animations.forEach(anim => {
      if (anim) anim.pause();
    });
    
    // Supprimer les styles injectés
    const styles = document.getElementById(`gallery-styles-${this.uniqueId}`);
    if (styles) styles.remove();
  }
}

export default SierraGallery;
