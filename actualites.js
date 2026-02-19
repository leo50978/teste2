// ============= ACTUALITES COMPONENT - VERSION AVEC ANIMATIONS CRÉATIVES =============
import { db } from './firebase-init.js';
import { 
  collection, query, orderBy, getDocs 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';

class ActualitesCarousel {
  constructor(containerId, options = {}) {
    
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    
    if (!this.container) {
      console.error(`❌ Actualites: Container #${containerId} non trouvé dans le DOM`);
      return;
    }
    
    this.options = {
      collectionName: 'presentations',
      filterActive: true,
      imageBasePath: './',
      animationDuration: 800,
      visibleDesktop: 3,
      visibleMobile: 1.2,
      scrollIndicator: true,
      ...options
    };
    
    this.presentations = [];
    this.uniqueId = 'actu_' + Math.random().toString(36).substr(2, 9);
    this.isScrolling = false;
    this.articleViewer = null;
    this.unsubscribeTheme = null;
    this.observer = null;
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = theme.subscribe(() => {
      if (this.presentations.length > 0) {
        this.render();
        this.attachEvents();
      }
    });
    
    this.init().catch(error => {
      console.error('💥 Erreur fatale lors de l\'initialisation:', error);
      this.renderError(error);
    });
  }
  
  async init() {
    
    try {
      await this.loadPresentations();
      this.render();
      this.attachEvents();
      this.initScrollAnimation();
      
      const event = new CustomEvent('actualitesLoaded', { 
        detail: { count: this.presentations.length }
      });
      document.dispatchEvent(event);
      
    } catch (error) {
      console.error('💥 Erreur dans init():', error);
      this.renderError(error);
      throw error;
    }
  }
  
  async loadPresentations() {
    
    try {
      const presentationsRef = collection(db, this.options.collectionName);
      const q = query(presentationsRef, orderBy('createdAt', 'desc'));
      
      const snapshot = await getDocs(q);
      
      this.presentations = snapshot.docs
        .map(doc => {
          return this.normalizePresentation({
            id: doc.id,
            ...doc.data()
          });
        })
        .filter(p => this.options.filterActive ? true : true);
      
      
    } catch (error) {
      console.error('💥 Erreur lors du chargement des présentations:', error);
      throw error;
    }
  }

  normalizePresentation(presentation) {
    const title = presentation?.title || presentation?.presTitle || '';
    const subtitle = presentation?.subtitle || presentation?.presSubtitle || '';
    const image = presentation?.image || presentation?.presImage || '';
    return {
      ...presentation,
      title,
      subtitle,
      image
    };
  }
  
  // Récupérer les couleurs du thème
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
  
  getImagePath(filename) {
    if (!filename) return '';
    if (filename.startsWith('http')) return filename;
    const cleanName = filename.split('/').pop();
    return `${this.options.imageBasePath}${cleanName}`;
  }
  
  animateSectionEntrance() {
    const wrapper = this.container.querySelector(`.actu-wrapper-${this.uniqueId}`);
    if (!wrapper) return;
    wrapper.style.opacity = '1';
    wrapper.style.transform = 'none';
  }
  
  animateScrollParallax(carousel) {
    const scrollLeft = carousel.scrollLeft;
    this.animateArrowsOnScroll(scrollLeft, carousel);
  }
  
  animateArrowsOnScroll(scrollLeft, carousel) {
    const leftArrow = this.container.querySelector(`.scroll-left-${this.uniqueId}`);
    const rightArrow = this.container.querySelector(`.scroll-right-${this.uniqueId}`);
    
    const maxScroll = Math.max(1, carousel.scrollWidth - carousel.clientWidth);
    const atStart = scrollLeft <= 8;
    const atEnd = scrollLeft >= (maxScroll - 8);

    if (leftArrow) {
      leftArrow.style.opacity = atStart ? '0.28' : '1';
      leftArrow.style.transform = 'translateY(-50%)';
    }
    
    if (rightArrow) {
      rightArrow.style.opacity = atEnd ? '0.28' : '1';
      rightArrow.style.transform = 'translateY(-50%)';
    }
  }
  
  animateCardHover() {}
  
  animateCardClick() {}
  
  animateBackgroundGlow(card) {
    // Effet supprimé volontairement pour une animation plus sobre
  }
  
  render() {
    const themeStyles = this.getThemeStyles();
    
    if (this.presentations.length === 0) {
      this.container.innerHTML = `
        <div class="empty-state-${this.uniqueId}" style="
          text-align: center;
          padding: 4rem 2rem;
          background: ${themeStyles.subtitleColor}0D;
          border-radius: 1rem;
          color: ${themeStyles.bodyColor};
          opacity: 1;
        ">
          <i class="fas fa-images" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5; color: ${themeStyles.subtitleColor};"></i>
          <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">Aucune actualité disponible</p>
          <p style="font-size: 0.9rem;">Ajoutez des présentations dans le dashboard</p>
        </div>
      `;
      
      return;
    }
    
    const html = `
      <div class="actu-wrapper-${this.uniqueId}" style="width: 100%; position: relative; opacity: 1;">
        <!-- Style global avec les couleurs du thème -->
        <style>
          .actu-wrapper-${this.uniqueId} *,
          .actu-wrapper-${this.uniqueId} *::before,
          .actu-wrapper-${this.uniqueId} *::after {
            animation: none !important;
            transition: none !important;
          }

          .actu-wrapper-${this.uniqueId} {
            --title-color: ${themeStyles.titleColor};
            --subtitle-color: ${themeStyles.subtitleColor};
            --body-color: ${themeStyles.bodyColor};
            --button-text: ${themeStyles.buttonTextColor};
            --button-bg: ${themeStyles.buttonBgColor};
            --icon-standard: ${themeStyles.iconStandard};
            --icon-hover: ${themeStyles.iconHover};
            --primary-font: ${themeStyles.primaryFont};
            --secondary-font: ${themeStyles.secondaryFont};
          }
          
          .actu-wrapper-${this.uniqueId} .actu-title-animated {
            font-family: var(--primary-font);
            color: var(--title-color);
            position: relative;
            display: inline-block;
          }
          
          .actu-wrapper-${this.uniqueId} .actu-title-animated::after {
            content: '';
            position: absolute;
            bottom: -5px;
            left: 0;
            width: 100%;
            height: 2px;
            background: var(--subtitle-color);
          }
          
          .actu-wrapper-${this.uniqueId} .actu-card-${this.uniqueId} {
            position: relative;
            transform-style: flat;
          }
          
          .actu-wrapper-${this.uniqueId} .card-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(125deg, ${themeStyles.subtitleColor} 0%, transparent 70%);
            opacity: 0;
            pointer-events: none;
            z-index: 2;
            mix-blend-mode: overlay;
          }
          
          .actu-wrapper-${this.uniqueId} .card-content {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 2rem 1.5rem;
            color: white;
            z-index: 3;
            transform: translateY(0);
            opacity: 1;
            background: linear-gradient(to top, rgba(0,0,0,0.9), transparent);
            border-radius: 0 0 1rem 1rem;
          }
          
          .actu-wrapper-${this.uniqueId} .card-title {
            font-family: var(--primary-font);
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 0.25rem;
            transform: none;
          }
          
          .actu-wrapper-${this.uniqueId} .card-subtitle {
            font-family: var(--secondary-font);
            font-size: 0.9rem;
            opacity: 0.9;
            transform: none;
          }
          
          .actu-wrapper-${this.uniqueId} .actu-carousel-${this.uniqueId} {
            overflow-x: auto;
            overflow-y: visible;
            scroll-behavior: auto;
            padding-bottom: 1rem;
            cursor: grab;
            user-select: none;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          
          .actu-wrapper-${this.uniqueId} .actu-carousel-${this.uniqueId}::-webkit-scrollbar {
            display: none;
          }
          
          .actu-wrapper-${this.uniqueId} .scroll-arrow {
            transition: all 0.25s ease;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            backdrop-filter: blur(5px);
            background: ${themeStyles.buttonBgColor}CC;
          }
          
          .actu-wrapper-${this.uniqueId} .progress-dot {
            height: 4px;
            background: ${themeStyles.subtitleColor}4D;
            border-radius: 2px;
            transition: all 0.25s ease;
            cursor: pointer;
          }
          
          .actu-wrapper-${this.uniqueId} .progress-dot:hover {
            transform: scaleY(2);
          }
          
          .actu-wrapper-${this.uniqueId} .progress-dot.active {
            background: ${themeStyles.subtitleColor};
            width: 2.5rem;
          }
          
          .actu-wrapper-${this.uniqueId} .floating-indicator {
            animation: none;
          }
        </style>
        
        <!-- En-tête avec animation -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; padding: 0 1rem;">
          <h2 class="actu-title-animated" style="
            font-size: clamp(1.8rem, 4vw, 2.5rem);
            margin: 0;
            opacity: 1;
          ">
            Actualités
            <span style="color: ${themeStyles.subtitleColor}; font-size: 0.5em; vertical-align: super; margin-left: 0.5rem;">✨</span>
          </h2>
          
          ${this.options.scrollIndicator ? `
            <div class="scroll-indicator-${this.uniqueId} floating-indicator" style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; color: ${themeStyles.subtitleColor};">
              <span class="md:hidden">Découvrir</span>
              <i class="fas fa-arrow-right"></i>
            </div>
          ` : ''}
        </div>
        
        <!-- Carousel Container -->
        <div style="position: relative; margin: 0 -0.5rem;">
          <!-- Flèches navigation animées -->
          <button class="scroll-left-${this.uniqueId} scroll-arrow" style="
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%) translateX(-30px) scale(0.8);
            width: 45px;
            height: 45px;
            background: ${themeStyles.buttonBgColor}CC;
            color: ${themeStyles.buttonTextColor};
            border: 1px solid ${themeStyles.subtitleColor};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 10;
            opacity: 0;
            transition: all 0.3s;
            backdrop-filter: blur(5px);
          ">
            <i class="fas fa-chevron-left"></i>
          </button>
          
          <button class="scroll-right-${this.uniqueId} scroll-arrow" style="
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%) translateX(30px) scale(0.8);
            width: 45px;
            height: 45px;
            background: ${themeStyles.buttonBgColor}CC;
            color: ${themeStyles.buttonTextColor};
            border: 1px solid ${themeStyles.subtitleColor};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 10;
            opacity: 0;
            transition: all 0.3s;
            backdrop-filter: blur(5px);
          ">
            <i class="fas fa-chevron-right"></i>
          </button>
          
          <!-- Carousel avec effet de perspective -->
          <div class="actu-carousel-${this.uniqueId}" style="
            overflow-x: auto;
            overflow-y: visible;
            scroll-behavior: auto;
            padding: 1rem 0.5rem 2rem;
            cursor: grab;
            -webkit-overflow-scrolling: touch;
          ">
            <div style="display: flex; gap: 1.5rem; width: max-content; padding: 0 1rem;">
              ${this.presentations.map((pres, index) => this.renderCard(pres, index)).join('')}
            </div>
          </div>
        </div>
        
        <!-- Indicateur de progression créatif -->
        <div class="scroll-progress-${this.uniqueId}" style="
          display: flex;
          justify-content: center;
          margin-top: 1.5rem;
          gap: 0.5rem;
        ">
          ${this.presentations.slice(0, 8).map((_, i) => `
            <div class="progress-dot" data-index="${i}" style="
              height: 4px;
            width: 2rem;
            transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          "></div>
          `).join('')}
        </div>
      </div>
    `;
    
    this.container.innerHTML = html;
    this.animateSectionEntrance();
  }
  
  renderCard(presentation, index) {
    const themeStyles = this.getThemeStyles();
    const image = this.getImagePath(presentation.image || '');
    const articleId = presentation.articleId || presentation.id || null;
    
    return `
      <div class="actu-card-${this.uniqueId}" style="
        width: calc(80vw - 1rem);
        height: 90vh;
        max-width: 400px;
        position: relative;
        cursor: pointer;
        border-radius: 1rem;
        overflow: hidden;
        transform: translateZ(0);
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        opacity: 1;
      " data-id="${presentation.id}" data-article-id="${articleId || ''}">
        
        <!-- Overlay coloré pour l'effet de hover -->
        <div class="card-overlay"></div>
        
        <!-- Image avec effet de zoom -->
        ${image ? `
          <img src="${image}" 
               alt="${presentation.title || 'Actualité'}" 
               style="
                 width: 100%;
                 height: 100%;
                 object-fit: cover;
                 transition: transform 0.5s ease;
               "
               loading="lazy"
               onerror="this.style.display='none'; this.parentElement.innerHTML+='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:${themeStyles.subtitleColor}1A;\'><i class=\'fas fa-image\' style=\'font-size:2rem;color:${themeStyles.subtitleColor};\'></i></div>';">
        ` : `
          <div style="
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            background: ${themeStyles.subtitleColor}1A;
            color: ${themeStyles.subtitleColor};
          ">
            <i class="fas fa-image" style="font-size: 2rem;"></i>
          </div>
        `}
        
        <!-- Contenu animé -->
        <div class="card-content">
          <h3 class="card-title">${presentation.title || 'Sans titre'}</h3>
          ${presentation.subtitle ? `
            <p class="card-subtitle">${presentation.subtitle}</p>
          ` : ''}
          
          <!-- Indicateur visuel -->
          <div style="
            position: absolute;
            bottom: 1rem;
            right: 1rem;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: ${themeStyles.subtitleColor};
            display: flex;
            align-items: center;
            justify-content: center;
            transform: scale(0);
            transition: transform 0.3s ease;
          " class="card-indicator">
            <i class="fas fa-arrow-right" style="color: ${themeStyles.titleColor}; font-size: 0.8rem;"></i>
          </div>
        </div>
      </div>
    `;
  }
  
  renderError(error) {
    const themeStyles = this.getThemeStyles();
    
    this.container.innerHTML = `
      <div class="error-state-${this.uniqueId}" style="
        text-align: center;
        padding: 3rem 2rem;
        background: #7F1D1D0D;
        border-radius: 1rem;
        color: #7F1D1D;
        border: 1px solid #7F1D1D33;
        opacity: 1;
      ">
        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 1rem; color: #7F1D1D;"></i>
        <h3 style="font-family: ${themeStyles.primaryFont}; font-size: 1.5rem; margin-bottom: 0.5rem;">
          Erreur de chargement
        </h3>
        <p style="margin-bottom: 1rem; font-family: ${themeStyles.secondaryFont};">${error.message || 'Une erreur est survenue'}</p>
        <button onclick="location.reload()" class="retry-btn-${this.uniqueId}" style="
          margin-top: 1rem;
          padding: 0.5rem 1.5rem;
          background: ${themeStyles.buttonBgColor};
          color: ${themeStyles.buttonTextColor};
          border: 1px solid ${themeStyles.subtitleColor};
          border-radius: 2rem;
          cursor: pointer;
          font-family: ${themeStyles.secondaryFont};
          transition: all 0.3s;
        ">
          Réessayer
        </button>
      </div>
    `;
  }
  
  attachEvents() {
    const carousel = this.container.querySelector(`.actu-carousel-${this.uniqueId}`);
    if (!carousel) return;
    
    let isDown = false;
    let startX;
    let scrollLeft;
    let startScrollLeft;
    
    carousel.addEventListener('mousedown', (e) => {
      isDown = true;
      carousel.style.cursor = 'grabbing';
      startX = e.pageX - carousel.offsetLeft;
      startScrollLeft = carousel.scrollLeft;
    });
    
    carousel.addEventListener('mouseleave', () => {
      if (isDown) {
        isDown = false;
        carousel.style.cursor = 'grab';
      }
    });
    
    carousel.addEventListener('mouseup', () => {
      if (isDown) {
        isDown = false;
        carousel.style.cursor = 'grab';
      }
    });
    
    carousel.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - carousel.offsetLeft;
      const walk = (x - startX) * 2;
      carousel.scrollLeft = startScrollLeft - walk;
    });
    
    carousel.addEventListener('scroll', () => {
      if (!this.isScrolling) {
        requestAnimationFrame(() => {
          this.updateScrollIndicator(carousel);
          this.animateScrollParallax(carousel);
          this.isScrolling = false;
        });
        this.isScrolling = true;
      }
    });
    
    // Événements pour les flèches
    const leftBtn = this.container.querySelector(`.scroll-left-${this.uniqueId}`);
    const rightBtn = this.container.querySelector(`.scroll-right-${this.uniqueId}`);
    
    if (leftBtn) {
      leftBtn.addEventListener('click', () => {
        carousel.scrollBy({ left: -400, behavior: 'auto' });
      });
    }
    
    if (rightBtn) {
      rightBtn.addEventListener('click', () => {
        carousel.scrollBy({ left: 400, behavior: 'auto' });
      });
    }
    
    // Événements pour les cartes (délégué + fallback)
    this.container.addEventListener('click', (e) => {
      const card = e.target.closest(`.actu-card-${this.uniqueId}`);
      if (!card || !this.container.contains(card)) return;
      const articleId = card.dataset.articleId || card.dataset.id;
      if (!articleId) return;
      this.openArticle(articleId);
    });
    
    // Événements pour les points de progression
    const dots = this.container.querySelectorAll('.progress-dot');
    dots.forEach((dot, index) => {
      dot.addEventListener('click', () => {
        const cardWidth = 400 + 16; // Largeur de carte + gap
        const targetScroll = index * cardWidth;
        
        carousel.scrollTo({
          left: targetScroll,
          behavior: 'auto'
        });
      });
    });
  }
  
  openArticle(articleId) {
    if (!articleId) return;
    const event = new CustomEvent('openArticle', { 
      detail: { articleId: articleId }
    });
    document.dispatchEvent(event);
  }
  
  updateScrollIndicator(carousel) {
    const scrollPercentage = (carousel.scrollLeft / (carousel.scrollWidth - carousel.clientWidth)) * 100;
    const dots = this.container.querySelectorAll('.progress-dot');
    const themeStyles = this.getThemeStyles();
    
    if (dots.length > 0 && !isNaN(scrollPercentage)) {
      const activeDotIndex = Math.floor((scrollPercentage / 100) * (dots.length - 1));
      dots.forEach((dot, i) => {
        if (i <= activeDotIndex) {
          dot.style.background = themeStyles.subtitleColor;
          dot.style.width = '2.5rem';
          dot.classList.add('active');
        } else {
          dot.style.background = `${themeStyles.subtitleColor}4D`;
          dot.style.width = '2rem';
          dot.classList.remove('active');
        }
      });
    }
  }
  
  initScrollAnimation() {
    const carousel = this.container.querySelector(`.actu-carousel-${this.uniqueId}`);
    if (!carousel) return;
    requestAnimationFrame(() => {
      this.animateArrowsOnScroll(carousel.scrollLeft, carousel);
      this.updateScrollIndicator(carousel);
    });
  }
  
  async reload() {
    await this.loadPresentations();
    this.render();
    this.attachEvents();
  }
  
  // Nettoyage
  destroy() {
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
    
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}

export default ActualitesCarousel;
