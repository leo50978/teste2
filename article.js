// ============= ARTICLE COMPONENT - AVEC NOUVELLE STRUCTURE THÈME =============
import { db } from './firebase-init.js';
import { 
  doc, getDoc 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';
import VitchStudioHeader from './header.js';
import FooterComponent from './footer.js';

class ArticleViewer {
  constructor(options = {}) {
    this.options = {
      articleId: null,
      onClose: null,
      imageBasePath: './',
      ...options
    };
    
    this.article = null;
    this.uniqueId = 'article_' + Math.random().toString(36).substr(2, 9);
    this.modal = null;
    this.mountEl = null;
    this.hiddenSections = [];
    this.theme = theme;
    
    if (!this.options.articleId) {
      console.error('❌ ArticleViewer: ID article requis');
      return;
    }
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = this.theme.subscribe((themeData) => {
      // Re-rendre si nécessaire (optionnel)
    });
    
    this.init();
  }
  
  async init() {
    await this.ensureHeaderAndFooter();
    await this.loadArticle();
    this.render();
    this.hideBackgroundSections();
    this.attachEvents();
    this.animateIn();
  }

  async ensureHeaderAndFooter() {
    const headerRootId = 'sierra-header-root';
    const footerRootId = 'sierra-footer-root';

    let headerRoot = document.getElementById(headerRootId);
    if (!headerRoot) {
      headerRoot = document.createElement('div');
      headerRoot.id = headerRootId;
      document.body.prepend(headerRoot);
    }

    if (!document.getElementById('headerNebulaX92')) {
      try {
        this.headerInstance = new VitchStudioHeader();
      } catch (error) {
        console.error('❌ Erreur initialisation header depuis article.js:', error);
      }
    }
    let footerRoot = document.getElementById(footerRootId);
    if (!footerRoot) {
      footerRoot = document.createElement('div');
      footerRoot.id = footerRootId;
      footerRoot.className = 'mt-auto';
      document.body.appendChild(footerRoot);
    }

    if (!footerRoot.querySelector('footer')) {
      try {
        this.footerInstance = new FooterComponent(footerRootId, {
          imageBasePath: this.options.imageBasePath
        });
      } catch (error) {
        console.error('❌ Erreur initialisation footer depuis article.js:', error);
      }
    }
    const articleRootId = 'sierra-article-root';
    let articleRoot = document.getElementById(articleRootId);
    if (!articleRoot) {
      articleRoot = document.createElement('div');
      articleRoot.id = articleRootId;
      articleRoot.style.width = '100%';
      articleRoot.style.maxWidth = '100%';
    }
    articleRoot.style.overflowX = 'hidden';
    // Toujours placer la vue article juste sous le header
    if (headerRoot.nextSibling !== articleRoot) {
      document.body.insertBefore(articleRoot, headerRoot.nextSibling);
    }
    this.mountEl = articleRoot;
  }

  hideBackgroundSections() {
    const sectionIds = [
      'sierra-hero-root',
      'sierra-categories-root',
      'sierra-gallery-root',
      'sierra-products-root',
      'sierra-actualites-root',
      'sierra-commentaire-root'
    ];

    this.hiddenSections = [];
    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      this.hiddenSections.push({ el, prevDisplay: el.style.display });
      el.style.display = 'none';
    });
  }

  restoreBackgroundSections() {
    this.hiddenSections.forEach(({ el, prevDisplay }) => {
      el.style.display = prevDisplay || '';
    });
    this.hiddenSections = [];
  }

  async loadArticle() {
    try {
      const docRef = doc(db, 'articles', this.options.articleId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        this.article = {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        console.error('❌ Article non trouvé');
      }
    } catch (error) {
      console.error('❌ Erreur chargement article:', error);
    }
  }
  
  getMediaPath(filename) {
    if (!filename) return '';
    if (filename.startsWith('http')) return filename;
    return `${this.options.imageBasePath}${filename.split('/').pop()}`;
  }
  
  formatDate(dateString) {
    if (!dateString) return '';
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateString).toLocaleDateString('fr-FR', options);
  }
  
  getThemeStyles() {
    const colors = this.theme.getColors();
    const typography = this.theme.getTypography();
    const fonts = this.theme.getFonts();
    
    return {
      // Couleurs de texte
      titleColor: colors?.text?.title || '#FFFFFF',
      subtitleColor: colors?.text?.subtitle || '#C6A75E',
      bodyColor: colors?.text?.body || 'rgba(255,255,255,0.9)',
      buttonTextColor: colors?.text?.button || '#1F1E1C',
      
      // Couleurs de fond
      bgGeneral: colors?.background?.general || 'rgba(0, 0, 0, 0.95)',
      bgCard: colors?.background?.card || '#1F1E1C',
      bgButton: colors?.background?.button || '#C6A75E',
      
      // Couleurs d'icônes
      iconStandard: colors?.icon?.standard || '#FFFFFF',
      iconHover: colors?.icon?.hover || '#C6A75E',
      
      // Polices
      primaryFont: typography?.family || fonts?.primary || "'Cormorant Garamond', serif",
      secondaryFont: fonts?.secondary || "'Manrope', sans-serif"
    };
  }
  
  render() {
    if (!this.article) {
      this.renderError();
      return;
    }
    
    const styles = this.getThemeStyles();
    const heroMedia = this.article.heroMedia || '';
    const isVideo = heroMedia.match(/\.(mp4|webm|ogg)$/i);
    const sections = this.article.sections || [];
    
    const modalHTML = `
      <div class="article-overlay-${this.uniqueId}" style="
        width: 100%;
        min-height: 100vh;
        background: ${styles.bgGeneral};
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      ">
        <div class="article-container-${this.uniqueId}" style="
          width: 100%;
          max-width: none;
          margin: 0 auto;
          padding: 0 0 2rem 0;
          color: white;
        ">
          <button class="article-back-${this.uniqueId}" type="button" style="
            position: fixed;
            bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
            left: 1rem;
            z-index: 20;
            display: inline-flex;
            align-items: center;
            gap: 0.55rem;
            border: 1px solid ${styles.iconHover};
            background: rgba(15, 15, 15, 0.85);
            color: #FFFFFF;
            border-radius: 999px;
            padding: 0.62rem 1.1rem;
            cursor: pointer;
            font-family: ${styles.secondaryFont};
            font-size: 0.86rem;
            font-weight: 700;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
            backdrop-filter: blur(8px);
            max-width: calc(100vw - 2rem);
          ">
            <i class="fas fa-arrow-left" aria-hidden="true"></i>
            <span>Retour a l'accueil</span>
          </button>
          <!-- Hero Section -->
          <div style="
            width: 100%;
            height: 100vh;
            min-height: 100vh;
            position: relative;
            left: 0;
            right: 0;
            margin-left: 0;
            margin-right: 0;
            border-radius: 0;
            overflow: hidden;
            margin-bottom: 4rem;
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
          ">
            ${isVideo ? `
              <video src="${this.getMediaPath(heroMedia)}" 
                     autoplay 
                     loop 
                     muted 
                     playsinline
                     style="
                       width: 100%;
                       height: 100%;
                       object-fit: cover;
                     "></video>
            ` : `
              <img src="${this.getMediaPath(heroMedia)}" 
                   alt="${this.article.title || ''}"
                   style="
                     width: 100%;
                     height: 100%;
                     object-fit: cover;
                   ">
            `}
            
            <div style="
              position: absolute;
              bottom: 0;
              left: 0;
              right: 0;
              background: linear-gradient(to top, ${styles.bgGeneral}, transparent);
              padding: 4rem 3rem 2rem;
            ">
              <h1 style="
                font-family: ${styles.primaryFont};
                font-size: clamp(2.5rem, 6vw, 4rem);
                font-weight: 700;
                margin-bottom: 0.75rem;
                color: ${styles.titleColor};
                text-shadow: 0 2px 10px rgba(0,0,0,0.3);
              ">${this.article.title || ''}</h1>
              
              ${this.article.subtitle ? `
                <p style="
                  font-size: 1.3rem;
                  opacity: 0.9;
                  margin-bottom: 0.75rem;
                  font-family: ${styles.secondaryFont};
                  font-weight: 300;
                  color: ${styles.subtitleColor};
                ">${this.article.subtitle}</p>
              ` : ''}
              
              ${this.article.date ? `
                <p style="
                  font-size: 1rem;
                  opacity: 0.7;
                  display: flex;
                  align-items: center;
                  gap: 0.5rem;
                  font-family: ${styles.secondaryFont};
                  color: ${styles.bodyColor};
                ">
                  <i class="fas fa-calendar-alt" style="color: ${styles.iconHover};"></i>
                  ${this.formatDate(this.article.date)}
                </p>
              ` : ''}
            </div>
          </div>
          
          <!-- Sections avec alternance -->
          <div style="
            display: flex;
            flex-direction: column;
            gap: 5rem;
            width: min(1200px, calc(100% - 2rem));
            margin: 0 auto;
          ">
            ${sections.map((section, index) => this.renderSection(section, index, styles)).join('')}
          </div>
        </div>
      </div>
      
      <style>
        .article-overlay-${this.uniqueId} {
          overflow-x: hidden;
        }

        .article-container-${this.uniqueId} {
          animation: articleFadeIn 0.6s ease;
          width: 100%;
          overflow-x: hidden;
        }
        
        @keyframes articleFadeIn {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .article-section-${this.uniqueId} {
          animation: sectionFadeIn 0.6s ease;
          animation-delay: calc(0.15s * var(--index));
          opacity: 0;
          animation-fill-mode: forwards;
          width: 100%;
          overflow: hidden;
        }
        
        @keyframes sectionFadeIn {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .article-media-${this.uniqueId} {
          border-radius: 1rem;
          overflow: hidden;
          box-shadow: 0 20px 40px rgba(0,0,0,0.3);
          transition: transform 0.4s ease;
          height: 100%;
        }
        
        .article-media-${this.uniqueId}:hover {
          transform: scale(1.03);
        }
        
        .article-media-${this.uniqueId} img,
        .article-media-${this.uniqueId} video {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .article-text-${this.uniqueId} {
          font-family: ${styles.secondaryFont};
          letter-spacing: 0.2px;
        }

        .article-back-${this.uniqueId} {
          white-space: nowrap;
        }
        
        @media (max-width: 768px) {
          .article-container-${this.uniqueId} {
            padding: 1rem;
          }

          .article-section-grid-${this.uniqueId} {
            grid-template-columns: 1fr !important;
            gap: 1.25rem !important;
          }
          
          .article-text-${this.uniqueId} {
            font-size: 1rem;
            line-height: 1.7;
          }
        }

        @media (min-width: 769px) {
          .article-back-${this.uniqueId} {
            left: 1.5rem;
            bottom: 1.5rem;
            font-size: 0.95rem;
          }
        }
      </style>
    `;
    
    this.mountEl.innerHTML = modalHTML;
    this.modal = this.mountEl.querySelector(`.article-overlay-${this.uniqueId}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  
  renderSection(section, index, styles) {
    const hasMedia = section.media && section.mediaType !== 'none';
    const isVideo = section.mediaType === 'video';
    const mediaPath = hasMedia ? this.getMediaPath(section.media) : '';
    
    // Alternance : pair = image à gauche, impair = image à droite
    const isImageLeft = index % 2 === 0;
    
    if (!hasMedia && !section.text) return '';
    
    // Si seulement du texte sans média
    if (!hasMedia && section.text) {
      return `
        <div class="article-section-${this.uniqueId}" style="--index: ${index}">
          <div style="
            max-width: 800px;
            margin: 0 auto;
            text-align: center;
          ">
            <div class="article-text-${this.uniqueId}" style="
              font-size: 1.2rem;
              line-height: 1.9;
              color: ${styles.bodyColor};
            ">
              ${section.text.replace(/\n/g, '<br>')}
            </div>
          </div>
        </div>
      `;
    }
    
    // Si seulement un média sans texte
    if (hasMedia && !section.text) {
      return `
        <div class="article-section-${this.uniqueId}" style="--index: ${index}">
          <div style="
            max-width: 900px;
            margin: 0 auto;
          ">
            <div class="article-media-${this.uniqueId}" style="
              aspect-ratio: 16/9;
            ">
              ${isVideo ? `
                <video src="${mediaPath}" 
                       controls
                       style="width: 100%; height: 100%; object-fit: cover;"></video>
              ` : `
                <img src="${mediaPath}" 
                     alt=""
                     style="width: 100%; height: 100%; object-fit: cover;">
              `}
            </div>
          </div>
        </div>
      `;
    }
    
    // Média + texte avec alternance
    return `
      <div class="article-section-${this.uniqueId}" style="--index: ${index}">
        <div style="
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 3rem;
          align-items: center;
        " class="article-section-grid-${this.uniqueId}">
          <!-- Image (gauche si pair, droite si impair) -->
          ${isImageLeft ? `
            <div class="article-media-${this.uniqueId}" style="
              aspect-ratio: 4/3;
            ">
              ${isVideo ? `
                <video src="${mediaPath}" 
                       controls
                       style="width: 100%; height: 100%; object-fit: cover;"></video>
              ` : `
                <img src="${mediaPath}" 
                     alt=""
                     style="width: 100%; height: 100%; object-fit: cover;">
              `}
            </div>
            
            <div class="article-text-${this.uniqueId}" style="
              font-size: 1.15rem;
              line-height: 1.8;
              color: ${styles.bodyColor};
            ">
              ${section.text.replace(/\n/g, '<br>')}
            </div>
          ` : `
            <div class="article-text-${this.uniqueId}" style="
              font-size: 1.15rem;
              line-height: 1.8;
              color: ${styles.bodyColor};
            ">
              ${section.text.replace(/\n/g, '<br>')}
            </div>
            
            <div class="article-media-${this.uniqueId}" style="
              aspect-ratio: 4/3;
            ">
              ${isVideo ? `
                <video src="${mediaPath}" 
                       controls
                       style="width: 100%; height: 100%; object-fit: cover;"></video>
              ` : `
                <img src="${mediaPath}" 
                     alt=""
                     style="width: 100%; height: 100%; object-fit: cover;">
              `}
            </div>
          `}
        </div>
      </div>
    `;
  }
  
  renderError() {
    const styles = this.getThemeStyles();
    
    const errorHTML = `
      <div class="article-overlay-${this.uniqueId}" style="
        width: 100%;
        min-height: 100vh;
        background: ${styles.bgGeneral};
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      ">
        <div style="
          background: ${styles.bgCard};
          border-radius: 1rem;
          padding: 2.5rem;
          max-width: 450px;
          text-align: center;
          border: 1px solid ${styles.subtitleColor}20;
        ">
          <i class="fas fa-exclamation-triangle" style="font-size: 3.5rem; color: ${styles.iconHover}; margin-bottom: 1.5rem;"></i>
          <h3 style="font-family: ${styles.primaryFont}; font-size: 1.8rem; margin-bottom: 1rem; color: ${styles.titleColor};">Article non trouvé</h3>
          <p style="color: ${styles.bodyColor}; margin-bottom: 2rem; font-size: 1.1rem;">L'article que vous recherchez n'existe pas ou a été supprimé.</p>
          <button class="article-close-${this.uniqueId}" style="
            background: ${styles.bgButton};
            color: ${styles.buttonTextColor};
            border: 1px solid ${styles.iconHover};
            padding: 0.9rem 2.5rem;
            border-radius: 0.5rem;
            cursor: pointer;
            font-size: 1.1rem;
            font-weight: 500;
            transition: all 0.3s;
          " onmouseover="this.style.background='${styles.iconHover}'; this.style.color='${styles.buttonTextColor}'" onmouseout="this.style.background='${styles.bgButton}'; this.style.color='${styles.buttonTextColor}'">
            Fermer
          </button>
        </div>
      </div>
    `;
    
    this.mountEl.innerHTML = errorHTML;
    this.modal = this.mountEl.querySelector(`.article-overlay-${this.uniqueId}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  
  attachEvents() {
    const backBtn = this.modal.querySelector(`.article-back-${this.uniqueId}`);
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        window.scrollTo({ top: 0, behavior: 'auto' });
      });
    }

    // Fermeture
    const closeBtn = this.modal.querySelector(`.article-close-${this.uniqueId}`);
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
      });
    }
    
    // Touche Echap
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  }
  
  animateIn() {
    setTimeout(() => {
      const container = this.modal.querySelector(`.article-container-${this.uniqueId}`);
      if (container) {
        container.style.opacity = '1';
      }
    }, 50);
  }
  
  animateOut() {
    return new Promise(resolve => {
      const container = this.modal.querySelector(`.article-container-${this.uniqueId}`);
      if (container) {
        container.style.opacity = '0';
        container.style.transform = 'translateY(30px)';
      }
      setTimeout(resolve, 400);
    });
  }
  
  async close() {
    await this.animateOut();
    if (this.modal) this.modal.remove();
    if (this.mountEl) this.mountEl.innerHTML = '';
    this.restoreBackgroundSections();
    
    if (this.options.onClose) {
      this.options.onClose();
    }
    
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
  }
}

export default ArticleViewer;
