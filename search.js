// ============= SEARCH COMPONENT - AVEC NOUVELLE STRUCTURE THÈME =============
import { db } from './firebase-init.js';
import { 
  collection, query, where, getDocs, orderBy, limit 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';

class SearchComponent {
  constructor(options = {}) {
    this.options = {
      containerId: options.containerId || 'sierra-search-root',
      triggerSelector: options.triggerSelector || '.search-trigger, #desktopSearchIcon, #mobileSearchIcon',
      minChars: options.minChars || 2,
      maxResults: options.maxResults || 10,
      productsPerCategory: options.productsPerCategory || 5,
      presentationsPerPage: options.presentationsPerPage || 5,
      imageBasePath: options.imageBasePath || './',
      ...options
    };
    
    this.uniqueId = 'search_' + Math.random().toString(36).substr(2, 9);
    this.modal = null;
    this.isOpen = false;
    this.searchTimeout = null;
    this.currentResults = {
      products: [],
      presentations: []
    };
    
    this.theme = theme;
    this.boundTriggerClickHandler = null;
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = this.theme.subscribe((newTheme) => {
      if (this.modal) {
        this.applyThemeStyles();
      }
    });
    
    this.init();
  }

  formatPriceHTG(value) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }
  
  applyThemeStyles() {
    const colors = this.theme.getColors();
    const fonts = this.theme.getFonts();
    
    // Couleurs selon la nouvelle structure
    const titleColor = colors?.text?.title || '#1F1E1C';
    const subtitleColor = colors?.text?.subtitle || '#8B7E6B';
    const bodyColor = colors?.text?.body || '#4A4A4A';
    const buttonTextColor = colors?.text?.button || '#FFFFFF';
    const buttonBgColor = colors?.background?.button || '#C6A75E';
    const bgGeneralColor = colors?.background?.general || '#F5F1E8';
    const bgCardColor = colors?.background?.card || '#FFFFFF';
    const iconStandard = colors?.icon?.standard || '#8B7E6B';
    const iconHover = colors?.icon?.hover || '#C6A75E';
    
    const primaryFont = fonts?.primary || "'Cormorant Garamond', serif";
    const secondaryFont = fonts?.secondary || "'Manrope', sans-serif";
    
    // Appliquer les styles CSS
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .search-overlay-${this.uniqueId} {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 999999;
        display: none;
        opacity: 0;
        transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .search-container-${this.uniqueId} {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1000000;
        background: ${bgGeneralColor};
        transform: translateY(-100%);
        transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      }
      
      .search-container-${this.uniqueId}.visible {
        transform: translateY(0);
      }
      
      @media (min-width: 768px) {
        .search-container-${this.uniqueId} {
          top: 20%;
          left: 50%;
          right: auto;
          transform: translate(-50%, -30%) scale(0.95);
          width: 90%;
          max-width: 800px;
          border-radius: 1rem;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          opacity: 0;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .search-container-${this.uniqueId}.visible {
          transform: translate(-50%, 0) scale(1);
          opacity: 1;
        }
      }
      
      .search-header-${this.uniqueId} {
        padding: 1rem;
        border-bottom: 1px solid ${iconStandard}20;
        background: ${bgGeneralColor};
      }
      
      @media (min-width: 768px) {
        .search-header-${this.uniqueId} {
          padding: 1.5rem;
          border-radius: 1rem 1rem 0 0;
        }
      }
      
      .search-input-wrapper-${this.uniqueId} {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: ${bgCardColor};
        border: 2px solid ${iconStandard}20;
        border-radius: 3rem;
        padding: 0.25rem 0.25rem 0.25rem 1.5rem;
        transition: all 0.2s ease;
      }
      
      .search-input-wrapper-${this.uniqueId}:focus-within {
        border-color: ${iconHover};
        box-shadow: 0 0 0 4px ${iconHover}20;
      }
      
      .search-input-${this.uniqueId} {
        flex: 1;
        border: none;
        padding: 0.75rem 0;
        font-size: 1rem;
        background: transparent;
        outline: none;
        font-family: ${secondaryFont};
        color: ${titleColor};
      }
      
      .search-input-${this.uniqueId}::placeholder {
        color: ${subtitleColor};
        opacity: 0.6;
      }
      
      .search-clear-${this.uniqueId} {
        background: none;
        border: none;
        color: ${iconStandard};
        cursor: pointer;
        padding: 0.5rem;
        border-radius: 50%;
        display: none;
        transition: all 0.2s;
      }
      
      .search-clear-${this.uniqueId}:hover {
        color: ${iconHover};
        background: ${iconHover}20;
      }
      
      .search-close-${this.uniqueId} {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: ${bgCardColor};
        border: 1px solid ${iconStandard}20;
        color: ${iconStandard};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }
      
      .search-close-${this.uniqueId}:hover {
        background: ${iconHover}20;
        color: ${iconHover};
        transform: rotate(90deg);
      }
      
      .search-content-${this.uniqueId} {
        padding: 1rem;
        max-height: 70vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      
      @media (min-width: 768px) {
        .search-content-${this.uniqueId} {
          padding: 1.5rem;
          max-height: 60vh;
        }
      }
      
      .search-section-${this.uniqueId} {
        margin-bottom: 2rem;
        animation: fadeIn 0.3s ease;
      }
      
      .search-section-title-${this.uniqueId} {
        font-family: ${primaryFont};
        font-size: 1.2rem;
        color: ${titleColor};
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid ${iconHover};
        display: inline-block;
      }
      
      .search-grid-${this.uniqueId} {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
      }
      
      @media (min-width: 480px) {
        .search-grid-${this.uniqueId} {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      
      @media (min-width: 1024px) {
        .search-grid-${this.uniqueId} {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      
      .search-card-${this.uniqueId} {
        display: flex;
        gap: 1rem;
        padding: 1rem;
        background: ${bgCardColor};
        border: 1px solid ${iconStandard}20;
        border-radius: 0.75rem;
        cursor: pointer;
        transition: all 0.2s ease;
        animation: cardAppear 0.3s ease;
        animation-fill-mode: both;
      }
      
      .search-card-${this.uniqueId}:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 20px -10px rgba(0, 0, 0, 0.2);
        border-color: ${iconHover};
      }
      
      @keyframes cardAppear {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .search-card-${this.uniqueId}:nth-child(1) { animation-delay: 0.05s; }
      .search-card-${this.uniqueId}:nth-child(2) { animation-delay: 0.1s; }
      .search-card-${this.uniqueId}:nth-child(3) { animation-delay: 0.15s; }
      .search-card-${this.uniqueId}:nth-child(4) { animation-delay: 0.2s; }
      .search-card-${this.uniqueId}:nth-child(5) { animation-delay: 0.25s; }
      
      .search-card-image-${this.uniqueId} {
        width: 70px;
        height: 70px;
        border-radius: 0.5rem;
        overflow: hidden;
        background: ${bgGeneralColor};
        flex-shrink: 0;
      }
      
      .search-card-image-${this.uniqueId} img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      .search-card-image-${this.uniqueId} i {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
        color: ${iconHover};
      }
      
      .search-card-content-${this.uniqueId} {
        flex: 1;
        min-width: 0;
      }
      
      .search-card-title-${this.uniqueId} {
        font-weight: 600;
        margin-bottom: 0.25rem;
        color: ${titleColor};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: ${primaryFont};
      }
      
      .search-card-subtitle-${this.uniqueId} {
        font-size: 0.8rem;
        color: ${subtitleColor};
        margin-bottom: 0.25rem;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-family: ${secondaryFont};
      }
      
      .search-card-price-${this.uniqueId} {
        font-weight: 600;
        color: ${iconHover};
        font-size: 0.9rem;
      }
      
      .search-card-oldprice-${this.uniqueId} {
        font-size: 0.8rem;
        color: ${subtitleColor};
        text-decoration: line-through;
        margin-left: 0.5rem;
      }
      
      .search-card-badge-${this.uniqueId} {
        display: inline-block;
        padding: 0.15rem 0.5rem;
        background: ${iconHover}20;
        border-radius: 2rem;
        font-size: 0.7rem;
        color: ${iconHover};
        margin-top: 0.25rem;
        font-family: ${secondaryFont};
      }
      
      .search-empty-${this.uniqueId} {
        text-align: center;
        padding: 3rem 1rem;
        color: ${subtitleColor};
        animation: fadeIn 0.3s ease;
        font-family: ${secondaryFont};
      }
      
      .search-empty-${this.uniqueId} i {
        font-size: 3rem;
        margin-bottom: 1rem;
        color: ${iconStandard};
        opacity: 0.5;
      }
      
      .search-loading-${this.uniqueId} {
        text-align: center;
        padding: 3rem 1rem;
        color: ${subtitleColor};
      }
      
      .search-loading-spinner-${this.uniqueId} {
        display: inline-block;
        width: 40px;
        height: 40px;
        border: 3px solid ${iconHover}20;
        border-top-color: ${iconHover};
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .search-content-${this.uniqueId}::-webkit-scrollbar {
        width: 6px;
      }
      
      .search-content-${this.uniqueId}::-webkit-scrollbar-track {
        background: ${iconHover}20;
        border-radius: 3px;
      }
      
      .search-content-${this.uniqueId}::-webkit-scrollbar-thumb {
        background: ${iconHover};
        border-radius: 3px;
      }
      
      .search-suggestions-${this.uniqueId} {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid ${iconStandard}20;
      }
      
      .search-suggestion-${this.uniqueId} {
        padding: 0.4rem 1rem;
        background: ${bgCardColor};
        border: 1px solid ${iconStandard}20;
        border-radius: 2rem;
        font-size: 0.85rem;
        color: ${subtitleColor};
        cursor: pointer;
        transition: all 0.2s;
        font-family: ${secondaryFont};
      }
      
      .search-suggestion-${this.uniqueId}:hover {
        background: ${iconHover};
        color: ${buttonTextColor};
        border-color: ${iconHover};
      }
    `;
    
    // Remplacer l'ancien style
    const oldStyle = document.getElementById(`search-styles-${this.uniqueId}`);
    if (oldStyle) oldStyle.remove();
    
    styleEl.id = `search-styles-${this.uniqueId}`;
    document.head.appendChild(styleEl);
  }
  
  init() {
    this.render();
    this.attachEvents();
  }
  
  render() {
    this.applyThemeStyles();
    
    // Créer le modal de recherche
    const modal = document.createElement('div');
    modal.className = `search-overlay-${this.uniqueId}`;
    modal.innerHTML = `
      <div class="search-container-${this.uniqueId}">
        <div class="search-header-${this.uniqueId}">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="search-input-wrapper-${this.uniqueId}" style="flex: 1;">
              <i class="fas fa-search"></i>
              <input type="text" 
                     class="search-input-${this.uniqueId}" 
                     placeholder="Rechercher un produit, un article..."
                     id="searchInput-${this.uniqueId}"
                     autocomplete="off">
              <button class="search-clear-${this.uniqueId}" id="searchClear-${this.uniqueId}">
                <i class="fas fa-times-circle"></i>
              </button>
            </div>
            <button class="search-close-${this.uniqueId}" id="searchClose-${this.uniqueId}">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <div class="search-suggestions-${this.uniqueId}">
            <span class="search-suggestion-${this.uniqueId}" data-suggest="nouveautés">Nouveautés</span>
            <span class="search-suggestion-${this.uniqueId}" data-suggest="promotions">Promotions</span>
            <span class="search-suggestion-${this.uniqueId}" data-suggest="collection">Collection</span>
            <span class="search-suggestion-${this.uniqueId}" data-suggest="édition limitée">Édition limitée</span>
          </div>
        </div>
        
        <div class="search-content-${this.uniqueId}" id="searchContent-${this.uniqueId}">
          <div class="search-empty-${this.uniqueId}">
            <i class="fas fa-search"></i>
            <p>Que souhaitez-vous trouver ?</p>
            <p style="font-size: 0.9rem; margin-top: 0.5rem;">Tapez au moins 2 caractères</p>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    this.modal = modal;
  }
  
  attachEvents() {
    const overlay = this.modal;
    const closeBtn = this.modal.querySelector(`#searchClose-${this.uniqueId}`);
    const input = this.modal.querySelector(`#searchInput-${this.uniqueId}`);
    const clearBtn = this.modal.querySelector(`#searchClear-${this.uniqueId}`);
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    if (input) {
      input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        if (clearBtn) {
          clearBtn.style.display = query ? 'flex' : 'none';
        }
        
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          this.performSearch(query);
        }, 300);
      });
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.close();
        }
      });
    }
    
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (input) {
          input.value = '';
          input.focus();
          clearBtn.style.display = 'none';
          this.performSearch('');
        }
      });
    }
    
    this.modal.querySelectorAll(`.search-suggestion-${this.uniqueId}`).forEach(sugg => {
      sugg.addEventListener('click', () => {
        if (input) {
          input.value = sugg.dataset.suggest;
          input.focus();
          clearBtn.style.display = 'flex';
          this.performSearch(sugg.dataset.suggest);
        }
      });
    });
    
    this.setupGlobalTriggerHandler();
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
    
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.open();
      }
    });
  }

  setupGlobalTriggerHandler() {
    if (this.boundTriggerClickHandler) return;

    // Event delegation: fonctionne même si le header est rerendu plus tard.
    this.boundTriggerClickHandler = (e) => {
      const trigger = e.target.closest(this.options.triggerSelector);
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      this.open();
    };

    document.addEventListener('click', this.boundTriggerClickHandler);
  }
  
  open() {
    if (this.isOpen) return;
    
    this.isOpen = true;
    const overlay = this.modal;
    const container = this.modal.querySelector(`.search-container-${this.uniqueId}`);
    
    overlay.style.display = 'block';
    
    setTimeout(() => {
      overlay.style.opacity = '1';
      container.classList.add('visible');
      
      const input = this.modal.querySelector(`#searchInput-${this.uniqueId}`);
      if (input) {
        setTimeout(() => input.focus(), 100);
      }
    }, 50);
    
    document.body.style.overflow = 'hidden';
  }
  
  close() {
    if (!this.isOpen) return;
    
    this.isOpen = false;
    const overlay = this.modal;
    const container = this.modal.querySelector(`.search-container-${this.uniqueId}`);
    
    overlay.style.opacity = '0';
    container.classList.remove('visible');
    
    setTimeout(() => {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
      
      const input = this.modal.querySelector(`#searchInput-${this.uniqueId}`);
      const clearBtn = this.modal.querySelector(`#searchClear-${this.uniqueId}`);
      if (input) input.value = '';
      if (clearBtn) clearBtn.style.display = 'none';
      
      const content = this.modal.querySelector(`#searchContent-${this.uniqueId}`);
      if (content) {
        content.innerHTML = `
          <div class="search-empty-${this.uniqueId}">
            <i class="fas fa-search"></i>
            <p>Que souhaitez-vous trouver ?</p>
            <p style="font-size: 0.9rem; margin-top: 0.5rem;">Tapez au moins 2 caractères</p>
          </div>
        `;
      }
    }, 300);
  }
  
  async performSearch(searchTerm) {
    const contentDiv = this.modal.querySelector(`#searchContent-${this.uniqueId}`);
    
    if (!searchTerm || searchTerm.length < this.options.minChars) {
      contentDiv.innerHTML = `
        <div class="search-empty-${this.uniqueId}">
          <i class="fas fa-search"></i>
          <p>Tapez au moins ${this.options.minChars} caractères</p>
        </div>
      `;
      return;
    }
    
    contentDiv.innerHTML = `
      <div class="search-loading-${this.uniqueId}">
        <div class="search-loading-spinner-${this.uniqueId}"></div>
        <p style="margin-top: 1rem;">Recherche en cours...</p>
      </div>
    `;
    
    try {
      const searchLower = searchTerm.toLowerCase();
      
      const [products, presentations] = await Promise.all([
        this.searchProducts(searchLower),
        this.searchPresentations(searchLower)
      ]);
      
      this.currentResults = { products, presentations };
      this.renderResults(contentDiv, searchTerm);
      
    } catch (error) {
      console.error('❌ Erreur recherche:', error);
      contentDiv.innerHTML = `
        <div class="search-empty-${this.uniqueId}">
          <i class="fas fa-exclamation-triangle" style="color: #7F1D1D;"></i>
          <p>Une erreur est survenue</p>
        </div>
      `;
    }
  }
  
  async searchProducts(searchTerm) {
    const collectionsToTry = ['products', 'categories567'];
    const mergedResults = [];
    const seen = new Set();

    for (const collectionName of collectionsToTry) {
      try {
        const snapshot = await getDocs(collection(db, collectionName));
        snapshot.forEach(docSnap => {
          const product = { id: docSnap.id, ...docSnap.data() };

          const nameMatch = product.name?.toLowerCase().includes(searchTerm);
          const descMatch = product.shortDescription?.toLowerCase().includes(searchTerm);
          const fullDescMatch = product.description?.toLowerCase().includes(searchTerm);
          const skuMatch = product.sku?.toLowerCase().includes(searchTerm);
          const categoryMatch = product.categoryName?.toLowerCase().includes(searchTerm);

          if (nameMatch || descMatch || fullDescMatch || skuMatch || categoryMatch) {
            const key = `${collectionName}:${product.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              mergedResults.push(product);
            }
          }
        });
      } catch (error) {
        console.warn(`⚠️ Recherche produits ignorée sur ${collectionName}:`, error);
      }
    }

    return mergedResults.slice(0, this.options.maxResults);
  }
  
  async searchPresentations(searchTerm) {
    const collectionsToTry = ['presentations', 'articles'];
    const mergedResults = [];
    const seen = new Set();

    for (const collectionName of collectionsToTry) {
      try {
        const snapshot = await getDocs(collection(db, collectionName));
        snapshot.forEach(docSnap => {
          const entry = { id: docSnap.id, ...docSnap.data() };

          const titleMatch = entry.title?.toLowerCase().includes(searchTerm);
          const subtitleMatch = entry.subtitle?.toLowerCase().includes(searchTerm);
          const contentMatch = entry.content?.toLowerCase().includes(searchTerm);

          if (titleMatch || subtitleMatch || contentMatch) {
            const normalized = {
              ...entry,
              articleId: entry.articleId || entry.id
            };
            const key = `${collectionName}:${normalized.articleId}`;
            if (!seen.has(key)) {
              seen.add(key);
              mergedResults.push(normalized);
            }
          }
        });
      } catch (error) {
        console.warn(`⚠️ Recherche articles ignorée sur ${collectionName}:`, error);
      }
    }

    return mergedResults.slice(0, this.options.presentationsPerPage);
  }
  
  getImagePath(filename) {
    if (!filename) return '';
    if (filename.startsWith('http')) return filename;
    return `${this.options.imageBasePath}${filename.split('/').pop()}`;
  }
  
  renderResults(container, searchTerm) {
    const { products, presentations } = this.currentResults;
    const totalResults = products.length + presentations.length;
    
    if (totalResults === 0) {
      container.innerHTML = `
        <div class="search-empty-${this.uniqueId}">
          <i class="fas fa-search"></i>
          <p>Aucun résultat pour "${searchTerm}"</p>
        </div>
      `;
      return;
    }
    
    let html = '';
    
    if (products.length > 0) {
      html += `
        <div class="search-section-${this.uniqueId}">
          <h3 class="search-section-title-${this.uniqueId}">
            Produits (${products.length})
          </h3>
          <div class="search-grid-${this.uniqueId}">
            ${products.map(product => this.renderProductCard(product)).join('')}
          </div>
        </div>
      `;
    }
    
    if (presentations.length > 0) {
      html += `
        <div class="search-section-${this.uniqueId}">
          <h3 class="search-section-title-${this.uniqueId}">
            Articles (${presentations.length})
          </h3>
          <div class="search-grid-${this.uniqueId}">
            ${presentations.map(presentation => this.renderPresentationCard(presentation)).join('')}
          </div>
        </div>
      `;
    }
    
    container.innerHTML = html;
    this.attachResultClickEvents();
  }
  
  renderProductCard(product) {
    const productImages = product.images || [];
    const firstImage = productImages.length > 0 ? productImages[0] : null;
    const imageUrl = firstImage ? this.getImagePath(firstImage) : '';
    
    const productPrice = this.formatPriceHTG(product.price || 0);
    const oldPrice = product.comparePrice ? this.formatPriceHTG(product.comparePrice) : null;

    return `
      <div class="search-card-${this.uniqueId}" data-type="product" data-id="${product.id}">
        <div class="search-card-image-${this.uniqueId}">
          ${imageUrl ? 
            `<img src="${imageUrl}" alt="${product.name || ''}" onerror="this.src=''; this.parentElement.innerHTML='<i class=\'fas fa-image\'></i>';">` : 
            '<i class="fas fa-image"></i>'
          }
        </div>
        <div class="search-card-content-${this.uniqueId}">
          <div class="search-card-title-${this.uniqueId}">${product.name || 'Produit sans nom'}</div>
          ${product.shortDescription ? `<div class="search-card-subtitle-${this.uniqueId}">${product.shortDescription.substring(0, 60)}${product.shortDescription.length > 60 ? '...' : ''}</div>` : ''}
          <div>
            <span class="search-card-price-${this.uniqueId}">${productPrice}</span>
            ${oldPrice ? `<span class="search-card-oldprice-${this.uniqueId}">${oldPrice}</span>` : ''}
          </div>
          <span class="search-card-badge-${this.uniqueId}">Produit</span>
        </div>
      </div>
    `;
  }
  
  renderPresentationCard(presentation) {
    const imageUrl = presentation.image ? this.getImagePath(presentation.image) : '';
    
    return `
      <div class="search-card-${this.uniqueId}" data-type="presentation" data-id="${presentation.id}" data-article-id="${presentation.articleId || ''}">
        <div class="search-card-image-${this.uniqueId}">
          ${imageUrl ? 
            `<img src="${imageUrl}" alt="${presentation.title || ''}" onerror="this.src=''; this.parentElement.innerHTML='<i class=\'fas fa-image\'></i>';">` : 
            '<i class="fas fa-image"></i>'
          }
        </div>
        <div class="search-card-content-${this.uniqueId}">
          <div class="search-card-title-${this.uniqueId}">${presentation.title || 'Article sans titre'}</div>
          ${presentation.subtitle ? `<div class="search-card-subtitle-${this.uniqueId}">${presentation.subtitle.substring(0, 60)}${presentation.subtitle.length > 60 ? '...' : ''}</div>` : ''}
          <span class="search-card-badge-${this.uniqueId}">Article</span>
        </div>
      </div>
    `;
  }
  
  attachResultClickEvents() {
    const cards = this.modal.querySelectorAll(`.search-card-${this.uniqueId}`);
    
    cards.forEach(card => {
      card.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const type = card.dataset.type;
        const id = card.dataset.id;
        const articleId = card.dataset.articleId;
        
        
        this.close();
        
        if (type === 'product') {
          try {
            const module = await import('./product-modal.js');
            const ProductModal = module.default;
            
            new ProductModal({
              productId: id,
              imageBasePath: this.options.imageBasePath
            });
          } catch (error) {
            console.error('❌ Erreur ouverture produit:', error);
          }
        } else if (type === 'presentation' && articleId) {
          const event = new CustomEvent('openArticle', { 
            detail: { articleId: articleId }
          });
          document.dispatchEvent(event);
        }
      });
    });
  }
  
  static openSearch() {
    if (window.__searchInstance) {
      window.__searchInstance.open();
    }
  }
  
  static closeSearch() {
    if (window.__searchInstance) {
      window.__searchInstance.close();
    }
  }
  
  destroy() {
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
    if (this.boundTriggerClickHandler) {
      document.removeEventListener('click', this.boundTriggerClickHandler);
      this.boundTriggerClickHandler = null;
    }
  }
}

let searchInstance = null;

export function getSearchManager(options = {}) {
  if (!searchInstance) {
    searchInstance = new SearchComponent(options);
    window.__searchInstance = searchInstance;
  }
  return searchInstance;
}

export default SearchComponent;
